import { commandFingerprint, normalizeId } from "../domain/model.js";
import { sha256 } from "../domain/canonical-json.js";
import {
  attachSecondaryFailure,
  invariant,
  preserveSecondaryFailure,
  wrapError,
} from "../domain/errors.js";
import {
  appendAgentSessionRun,
  requireAgentSession,
} from "../domain/agent-session.js";
import {
  assertCurrentActionGrant,
  createActionGrant,
  createIntegrationActionOffer,
  createIntegrationResult,
  normalizeBranchRef,
  normalizeIntegrationActionKind,
  normalizeIntegrationMaximumAttempts,
  normalizePushRemote,
} from "../domain/integration.js";
import {
  createAgentRunRecord,
  createRunReference,
  setChangeSetPhase,
} from "../domain/lifecycle.js";
import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../domain/runtime-context.js";
import { measureInitialContext } from "../adapters/runtime/runtime-port.js";

const OFFER_LIFETIME_MS = 60 * 60 * 1_000;

export class IntegrationService {
  constructor({
    controlStore,
    runStore,
    evidenceStore,
    runCoordinator,
    taskWorkspaceManager,
    integrationGitAdapter,
    runtime,
    agentProfile,
    idFactory,
    now,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.evidenceStore = evidenceStore;
    this.runCoordinator = runCoordinator;
    this.taskWorkspaceManager = taskWorkspaceManager;
    this.integrationGitAdapter = integrationGitAdapter;
    this.runtime = runtime;
    this.agentProfile = agentProfile;
    this.idFactory = idFactory;
    this.now = now;
  }

  async offerAction({
    idempotency_key,
    change_set_id,
    bundle_revision,
    bundle_hash,
    repository_id,
    action_kind,
    push_remote,
    destination_ref,
    maximum_attempts = 2,
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("repository_id", repository_id);
    const actionKind = normalizeIntegrationActionKind(action_kind);
    const pushRemote = normalizePushRemote(push_remote);
    const destinationRef = normalizeBranchRef(destination_ref);
    const maximumAttempts = normalizeIntegrationMaximumAttempts(maximum_attempts);
    const input = {
      change_set_id,
      bundle_revision,
      bundle_hash,
      repository_id,
      action_kind: actionKind,
      push_remote: pushRemote,
      destination_ref: destinationRef,
      maximum_attempts: maximumAttempts,
    };
    const initial = await this.controlStore.readChangeSet(change_set_id);
    const existing = existingCommand(
      initial,
      idempotency_key,
      "offerIntegrationAction",
      input,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    const { bundle, candidate } = requireAcceptedBundle(
      initial,
      bundle_revision,
      bundle_hash,
      repository_id,
    );
    const session = requireAgentSession(
      initial.task_workspace,
      this.agentProfile,
      "integration",
    );
    const { project, repository } = await this.loadRepository(initial, repository_id);
    void project;
    const preflight = await this.integrationGitAdapter.preflight({
      repository,
      actionKind,
      pushRemote,
      destinationRef,
      targetRef: candidate.target_ref,
      baseSha: candidate.base_sha,
      candidateSha: candidate.candidate_sha,
    });
    const offeredAt = this.now();
    const offer = createIntegrationActionOffer({
      changeSet: initial,
      bundle,
      candidate,
      agentSession: session,
      actionKind,
      pushRemote,
      destinationRef,
      observedDestinationSha: preflight.observed_destination_sha,
      maximumAttempts,
      offeredAt,
      expiresAt: new Date(
        Date.parse(offeredAt) + OFFER_LIFETIME_MS,
      ).toISOString(),
      idFactory: this.idFactory,
    });
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyCompletedCommand({
        state,
        idempotencyKey: idempotency_key,
        command: "offerIntegrationAction",
        input,
        perform: () => {
          const current = requireAcceptedBundle(
            state,
            bundle_revision,
            bundle_hash,
            repository_id,
          );
          invariant(
            current.candidate.candidate_sha === candidate.candidate_sha &&
              state.task_workspace.task_workspace_id ===
                offer.task_workspace_id,
            "INTEGRATION_SUBJECT_MISMATCH",
            "Integration subject changed while the action was offered",
          );
          for (const existingOffer of state.integration_action_offers) {
            if (
              existingOffer.status === "offered" &&
              existingOffer.repository_id === offer.repository_id
            ) {
              existingOffer.status = "superseded";
              existingOffer.superseded_at = this.now();
            }
          }
          state.integration_action_offers.push(offer);
          state.updated_at = this.now();
          return structuredClone(offer);
        },
      }),
    );
  }

  async grantAction({
    idempotency_key,
    change_set_id,
    action_offer_id,
    input_digest,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("integration_action_offer_id", action_offer_id);
    const input = {
      change_set_id,
      action_offer_id,
      input_digest,
      actor,
    };
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyCompletedCommand({
        state,
        idempotencyKey: idempotency_key,
        command: "grantIntegrationAction",
        input,
        perform: () => {
          const offer = state.integration_action_offers.find(
            (candidate) => candidate.action_offer_id === action_offer_id,
          );
          invariant(
            offer?.input_digest === input_digest &&
              Date.parse(offer.expires_at) > Date.parse(this.now()),
            "INTEGRATION_OFFER_NOT_CURRENT",
            "Integration action offer is missing, stale, or expired",
          );
          requireAcceptedBundle(
            state,
            offer.bundle_revision,
            offer.bundle_hash,
            offer.repository_id,
          );
          requireAgentSession(
            state.task_workspace,
            this.agentProfile,
            "integration",
          );
          invariant(
            !state.action_grants.some(
              (candidate) =>
                candidate.repository_id === offer.repository_id &&
                candidate.destination_ref === offer.destination_ref &&
                ["granted", "running"].includes(candidate.status),
            ),
            "ACTION_GRANT_ALREADY_ACTIVE",
            "An integration ActionGrant is already active for this destination",
          );
          const grant = createActionGrant({
            offer,
            actor,
            grantedAt: this.now(),
            idFactory: this.idFactory,
          });
          offer.status = "granted";
          offer.granted_at = grant.granted_at;
          offer.action_grant_id = grant.action_grant_id;
          state.action_grants.push(grant);
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "action_grant",
            action_grant_id: grant.action_grant_id,
            action_offer_id: offer.action_offer_id,
            input_digest: offer.input_digest,
            actor: grant.granted_by,
            decided_at: grant.granted_at,
          });
          state.updated_at = this.now();
          return structuredClone(grant);
        },
      }),
    );
  }

  async executeAction({
    idempotency_key,
    change_set_id,
    action_grant_id,
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("action_grant_id", action_grant_id);
    let state = await this.controlStore.readChangeSet(change_set_id);
    const existing = existingCommand(
      state,
      idempotency_key,
      "executeIntegrationAction",
      { change_set_id, action_grant_id },
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    let grant = requireGrant(state, action_grant_id);
    if (grant.status === "completed") {
      return structuredClone(
        state.integration_results.find(
          (result) => result.integration_result_id === grant.result_id,
        ),
      );
    }
    const lock = await this.controlStore.acquireDeliveryLock(
      grant.repository_id,
      grant.destination_ref,
      action_grant_id,
    );
    let runId = null;
    let invocation = null;
    let providerEvidence = null;
    let boundaryProject = null;
    let boundaryHarnessSelection = null;
    let boundaryWorkspaces = null;
    let boundarySnapshots = null;
    try {
      state = await this.controlStore.readChangeSet(change_set_id);
      grant = requireGrant(state, action_grant_id);
      const { bundle, candidate } = assertCurrentActionGrant({
        state,
        grant,
        now: this.now(),
      });
      const { project, repository } = await this.loadRepository(
        state,
        grant.repository_id,
      );
      boundaryProject = project;
      boundaryHarnessSelection = currentHarnessSelection(state);
      boundaryWorkspaces = state.task_workspace.repositories;
      boundarySnapshots = await this.taskWorkspaceManager.captureSnapshots({
        project,
        repositoryWorkspaces: boundaryWorkspaces,
      });
      for (const snapshot of boundarySnapshots) {
        const exactCandidate = bundle.candidates.find(
          (item) => item.repository_id === snapshot.repository_id,
        );
        invariant(
          exactCandidate?.candidate_sha === snapshot.head_sha,
          "INTEGRATION_WORKSPACE_SUBJECT_CHANGED",
          "A task RepositoryWorkspace no longer matches the accepted exact Candidate",
          {
            repository_id: snapshot.repository_id,
            expected_sha: exactCandidate?.candidate_sha ?? null,
            observed_sha: snapshot.head_sha,
          },
        );
      }
      const preflight = await this.integrationGitAdapter.preflight({
        repository,
        actionKind: grant.action_kind,
        pushRemote: grant.push_remote,
        destinationRef: grant.destination_ref,
        targetRef: grant.target_ref,
        baseSha: grant.candidate_base_sha,
        candidateSha: grant.candidate_sha,
      });
      invariant(
        preflight.already_satisfied ||
          preflight.observed_destination_sha ===
            grant.observed_destination_sha,
        "ACTION_GRANT_SUBJECT_CHANGED",
        "Integration destination changed after the human grant",
      );
      if (preflight.already_satisfied) {
        const result = await this.recordObservedSuccess({
          state,
          grant,
          repository,
          // A prior interrupted Run remains terminally interrupted. Recovery is
          // admitted from the independent ref observation, not by rewriting that Run.
          runId: null,
          outcome: {
            type: "integration_action_completed",
            action_grant_id: grant.action_grant_id,
            input_digest: grant.input_digest,
            summary: "Exact destination already satisfied the granted action.",
            reported_destination_sha: grant.candidate_sha,
          },
        });
        await this.maybeReleaseResources(change_set_id);
        return result;
      }

      const session = requireAgentSession(
        state.task_workspace,
        this.agentProfile,
        "integration",
      );
      const attempt = grant.attempt_count + 1;
      runId = this.idFactory("run");
      const repositorySelection = currentRepositorySelection(state);
      const harnessSelection = currentHarnessSelection(state);
      const workspaceRecord = state.task_workspace.repositories.find(
        (item) => item.repository_id === grant.repository_id,
      );
      invariant(
        workspaceRecord?.workspace?.workspace_path,
        "TASK_WORKSPACE_NOT_READY",
        "Integration AgentSession has no RepositoryWorkspace",
      );
      const controlContract = createControlContract({
        operation: "integration",
        changeSetId: change_set_id,
        planRevision: state.current_plan_revision,
        repositorySelectionRevision: repositorySelection.revision,
        repositoryHarnessSelectionRevision: harnessSelection.revision,
        authorizedRepositories: [grant.repository_id],
        writableRepositories: [grant.repository_id],
        allowedOutcomes: [
          "integration_action_completed",
          "integration_action_blocked",
        ],
        humanGates: [],
      });
      const contextProjection = createContextProjection({
        operation: "integration",
        changeSet: state,
        plan: currentPlan(state),
        repositorySelection,
        repositoryHarnessSelection: harnessSelection,
        repositories: [
          {
            repository_id: grant.repository_id,
            root_path: workspaceRecord.workspace.workspace_path,
            base_sha: candidate.base_sha,
            candidate_sha: candidate.candidate_sha,
            target_ref: candidate.target_ref,
            access: "read_write",
          },
        ],
        capability: {
          mode: "read_write",
          paths: [workspaceRecord.workspace.workspace_path],
        },
        requiredEvidence: ["independent_remote_ref_observation"],
        workspaceControl: null,
        integration: {
          action_grant_id: grant.action_grant_id,
          input_digest: grant.input_digest,
          action_kind: grant.action_kind,
          repository_id: grant.repository_id,
          candidate_base_sha: grant.candidate_base_sha,
          candidate_sha: grant.candidate_sha,
          push_remote: grant.push_remote,
          destination_ref: grant.destination_ref,
          observed_destination_sha: grant.observed_destination_sha,
          maximum_attempts: grant.maximum_attempts,
          attempt,
        },
      });
      invocation = {
        operation: "integration",
        agent_profile: this.agentProfile,
        control_contract: controlContract,
        context_projection: contextProjection,
        capabilities: contextProjection.capability,
        workspace: structuredClone(workspaceRecord.workspace),
        signal: null,
      };
      const contextEvidence = assessInitialContext({
        controlContract,
        contextProjection,
        agentProfile: this.agentProfile,
        runtimeMeasurement: await measureInitialContext(this.runtime, invocation),
      });
      await this.runStore.create(
        createAgentRunRecord({
          runId,
          changeSetId: change_set_id,
          workUnitId: null,
          operation: "integration",
          trigger: attempt === 1 ? "initial" : "retry",
          attempt,
          agentProfile: this.agentProfile,
          continuationOfRunId: grant.current_run_id,
          repositoryHarnessSelection: {
            revision: harnessSelection.revision,
            repositories: [],
          },
          repositoryHarnessObservation: { repositories: [] },
          contextEvidence,
          contextProjectionIdentity: {
            schema_version: contextProjection.schema_version,
            digest: sha256(contextProjection),
          },
          createdAt: this.now(),
          extra: {
            task_workspace_id: state.task_workspace.task_workspace_id,
            agent_session_id: session.agent_session_id,
            action_grant_id: grant.action_grant_id,
          },
        }),
      );
      await this.controlStore.transactChangeSet(change_set_id, (current) => {
        const currentGrant = requireGrant(current, action_grant_id);
        assertCurrentActionGrant({
          state: current,
          grant: currentGrant,
          now: this.now(),
        });
        currentGrant.status = "running";
        currentGrant.attempt_count = attempt;
        currentGrant.current_run_id = runId;
        const reference = createRunReference({
          runId,
          operation: "integration",
          trigger: attempt === 1 ? "initial" : "retry",
          attempt,
          agent_session_id: session.agent_session_id,
          action_grant_id,
          bundle_revision: grant.bundle_revision,
          bundle_hash: grant.bundle_hash,
          repository_id: grant.repository_id,
        });
        current.run_references.push(reference);
        appendAgentSessionRun(
          current.task_workspace,
          session.agent_session_id,
          reference,
        );
        beginCommand(current, idempotency_key, "executeIntegrationAction", {
          change_set_id,
          action_grant_id,
        });
        current.updated_at = this.now();
      });

      const runtimeResult = await this.runCoordinator.invoke(
        this.runtime,
        runId,
        invocation,
      );
      providerEvidence = runtimeResult.provider_evidence;
      await this.taskWorkspaceManager.assertUnchanged({
        project: boundaryProject,
        repositoryWorkspaces: boundaryWorkspaces,
        repositoryHarnessSelection: boundaryHarnessSelection,
        beforeSnapshots: boundarySnapshots,
        errorCode: "INTEGRATION_WORKSPACE_MODIFIED",
        errorMessage:
          "Integration Runtime modified a task RepositoryWorkspace outside the granted remote ref action",
      });
      const outcome = runtimeResult.outcome;
      invariant(
        outcome.type === "integration_action_completed" &&
          outcome.action_grant_id === grant.action_grant_id &&
          outcome.input_digest === grant.input_digest,
        "INVALID_INTEGRATION_RUNTIME_OUTCOME",
        "Integration Runtime did not complete the exact granted action",
      );
      const result = await this.recordObservedSuccess({
        state,
        grant: { ...grant, current_run_id: runId },
        repository,
        runId,
        outcome,
        invocation,
        providerEvidence,
      });
      await this.maybeReleaseResources(change_set_id);
      return result;
    } catch (error) {
      let failure = wrapError(
        error,
        "INTEGRATION_ACTION_FAILED",
        "The exact granted integration action failed",
      );
      if (boundarySnapshots !== null) {
        try {
          await this.taskWorkspaceManager.assertUnchanged({
            project: boundaryProject,
            repositoryWorkspaces: boundaryWorkspaces,
            repositoryHarnessSelection: boundaryHarnessSelection,
            beforeSnapshots: boundarySnapshots,
            errorCode: "INTEGRATION_WORKSPACE_MODIFIED",
            errorMessage:
              "Integration Runtime modified a task RepositoryWorkspace outside the granted remote ref action",
          });
        } catch (boundaryError) {
          failure = attachSecondaryFailure(
            boundaryError,
            "integration_runtime_failure",
            failure,
          );
        }
      }
      // This code represents controller/process loss. Keep the persisted Run and
      // grant in progress so the next controller can reconcile and observe whether
      // the exact idempotent action already reached the remote.
      if (failure?.code === "CONTROLLER_INTERRUPTED") throw failure;
      if (runId !== null && invocation !== null) {
        await preserveSecondaryFailure(failure, "integration_run_failure", async () => {
          const terminal = await this.runCoordinator.failAttempt({
            runId,
            invocation,
            providerEvidence:
              providerEvidence ?? failure.runtime_evidence ?? null,
            error: failure,
          });
          await this.controlStore.transactChangeSet(change_set_id, (current) => {
            const currentGrant = requireGrant(current, action_grant_id);
            markReference(current.run_references, runId, terminal.status);
            markSessionReference(
              current.task_workspace,
              currentGrant.agent_session_id,
              runId,
              terminal.status,
            );
            currentGrant.status =
              failure.code !== "INTEGRATION_WORKSPACE_MODIFIED" &&
              currentGrant.attempt_count < currentGrant.maximum_attempts &&
              Date.parse(currentGrant.expires_at) > Date.parse(this.now())
                ? "granted"
                : "failed";
            currentGrant.last_error = {
              code: failure.code ?? "UNEXPECTED_ERROR",
              at: this.now(),
            };
            failCommand(current, idempotency_key, failure, this.now());
            current.updated_at = this.now();
          });
        });
      } else {
        await preserveSecondaryFailure(failure, "integration_grant_failure", async () => {
          await this.controlStore.transactChangeSet(change_set_id, (current) => {
            const currentGrant = requireGrant(current, action_grant_id);
            if (["granted", "running"].includes(currentGrant.status)) {
              currentGrant.status = "failed";
              currentGrant.last_error = {
                code: failure.code ?? "UNEXPECTED_ERROR",
                at: this.now(),
              };
            }
            recordFailedCommand(
              current,
              idempotency_key,
              "executeIntegrationAction",
              { change_set_id, action_grant_id },
              failure,
              this.now(),
            );
            current.updated_at = this.now();
          });
        });
      }
      throw failure;
    } finally {
      await lock.release();
    }
  }

  async completeWithoutManagedIntegration({
    idempotency_key,
    change_set_id,
    bundle_revision,
    bundle_hash,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    const input = {
      change_set_id,
      bundle_revision,
      bundle_hash,
      actor,
    };
    const result = await this.controlStore.transactChangeSet(
      change_set_id,
      (state) =>
        applyCompletedCommand({
          state,
          idempotencyKey: idempotency_key,
          command: "completeWithoutManagedIntegration",
          input,
          perform: () => {
            const { bundle } = requireAcceptedBundle(
              state,
              bundle_revision,
              bundle_hash,
              null,
            );
            invariant(
              !state.run_references.some(
                (reference) =>
                  reference.operation === "integration" &&
                  ["queued", "running"].includes(reference.status),
              ),
              "INTEGRATION_RUN_ACTIVE",
              "Cannot finish while an integration Run is active",
            );
            const decidedAt = this.now();
            const unintegratedCandidates = bundle.candidates
              .filter(
                (candidate) =>
                  !candidateHasExactIntegration(state, bundle.bundle_id, candidate),
              )
              .map((candidate) => ({
                repository_id: candidate.repository_id,
                candidate_id: candidate.candidate_id,
                candidate_sha: candidate.candidate_sha,
                target_ref: candidate.target_ref,
              }));
            const disposition = {
              schema_version: 1,
              integration_disposition_id: this.idFactory(
                "integration-disposition",
              ),
              type: "complete_without_managed_integration",
              reason: "accepted_without_managed_integration",
              bundle_id: bundle.bundle_id,
              bundle_revision: bundle.revision,
              bundle_hash: bundle.bundle_hash,
              unintegrated_candidates: unintegratedCandidates,
              actor: normalizeId("actor", actor),
              decided_at: decidedAt,
            };
            state.integration_dispositions.push(disposition);
            state.decisions.push({
              decision_id: this.idFactory("decision"),
              type: "integration_disposition",
              integration_disposition_id:
                disposition.integration_disposition_id,
              reason: disposition.reason,
              bundle_revision,
              bundle_hash,
              actor: disposition.actor,
              decided_at: decidedAt,
            });
            setChangeSetPhase(state, "terminal", "done");
            state.updated_at = decidedAt;
            return structuredClone(disposition);
          },
        }),
    );
    await this.taskWorkspaceManager.releaseResources(change_set_id);
    return result;
  }

  project(state) {
    return {
      agent_sessions: (state.task_workspace?.agent_sessions ?? []).map(
        (session) => ({
          agent_session_id: session.agent_session_id,
          agent_profile_id: session.agent_profile.profile_id,
          agent_profile_revision: session.agent_profile.revision,
          allowed_run_purposes: [...session.allowed_run_purposes],
          status: session.status,
          run_count: session.run_references.length,
        }),
      ),
      action_offers: structuredClone(state.integration_action_offers ?? []),
      action_grants: structuredClone(state.action_grants ?? []),
      results: structuredClone(state.integration_results ?? []),
      disposition: structuredClone(
        (state.integration_dispositions ?? []).at(-1) ?? null,
      ),
    };
  }

  async recordObservedSuccess({
    state,
    grant,
    repository,
    runId,
    outcome,
    invocation = null,
    providerEvidence = null,
  }) {
    const observation = await this.integrationGitAdapter.observeResult({
      repository,
      pushRemote: grant.push_remote,
      destinationRef: grant.destination_ref,
      candidateSha: grant.candidate_sha,
    });
    const completedAt = this.now();
    const evidence = await this.evidenceStore.record({
      kind: "integration_result",
      subject: {
        change_set_id: grant.change_set_id,
        action_grant_id: grant.action_grant_id,
        run_id: runId,
        repository_id: grant.repository_id,
        candidate_sha: grant.candidate_sha,
        destination_ref: grant.destination_ref,
      },
      payload: {
        action_kind: grant.action_kind,
        input_digest: grant.input_digest,
        reported_outcome: structuredClone(outcome),
        independent_observation: observation,
      },
      createdAt: completedAt,
    });
    const result = createIntegrationResult({
      grant,
      runId,
      evidence,
      observedDestinationSha: observation.observed_destination_sha,
      completedAt,
      idFactory: this.idFactory,
    });
    if (runId !== null && invocation !== null) {
      await this.runCoordinator.completeAttempt({
        runId,
        invocation,
        providerEvidence,
        eventPayload: {
          type: outcome.type,
          action_grant_id: grant.action_grant_id,
          input_digest: grant.input_digest,
          reported_destination_sha: outcome.reported_destination_sha,
        },
        runOutcome: {
          ...structuredClone(outcome),
          integration_result_id: result.integration_result_id,
          evidence,
        },
        completedAt,
      });
    }
    await this.controlStore.transactChangeSet(
      grant.change_set_id,
      (current) => {
        const currentGrant = requireGrant(current, grant.action_grant_id);
        const existingResult = current.integration_results.find(
          (candidate) =>
            candidate.action_grant_id === grant.action_grant_id &&
            candidate.candidate_sha === grant.candidate_sha,
        );
        if (existingResult) return;
        if (runId !== null) {
          markReference(current.run_references, runId, "completed");
          markSessionReference(
            current.task_workspace,
            currentGrant.agent_session_id,
            runId,
            "completed",
          );
        }
        current.integration_results.push(result);
        currentGrant.status = "completed";
        currentGrant.result_id = result.integration_result_id;
        currentGrant.current_run_id = runId;
        const command = Object.values(current.commands).find(
          (candidate) =>
            candidate.command === "executeIntegrationAction" &&
            candidate.status === "in_progress" &&
            candidate.fingerprint ===
              commandFingerprint("executeIntegrationAction", {
                change_set_id: grant.change_set_id,
                action_grant_id: grant.action_grant_id,
              }),
        );
        if (command) {
          command.status = "completed";
          command.result = structuredClone(result);
          command.completed_at = completedAt;
        }
        if (
          grant.action_kind === "fast_forward_target" &&
          allCandidatesIntegrated(current, grant.bundle_id)
        ) {
          const disposition = {
            schema_version: 1,
            integration_disposition_id: this.idFactory(
              "integration-disposition",
            ),
            type: "managed_integration_completed",
            reason: "managed_integration_completed",
            bundle_id: grant.bundle_id,
            bundle_revision: grant.bundle_revision,
            bundle_hash: grant.bundle_hash,
            actor: "changefleet",
            decided_at: completedAt,
          };
          current.integration_dispositions.push(disposition);
          setChangeSetPhase(current, "terminal", "done");
        }
        current.updated_at = completedAt;
      },
    );
    return structuredClone(result);
  }

  async loadRepository(state, repositoryId) {
    const catalog = await this.controlStore.readCatalog();
    const project = catalog.projects[state.project_id];
    invariant(project, "PROJECT_NOT_FOUND", "Integration Project does not exist");
    const repository = project.repositories.find(
      (candidate) => candidate.repository_id === repositoryId,
    );
    invariant(
      repository,
      "REPOSITORY_NOT_REGISTERED",
      "Integration Repository is not registered",
    );
    return { project, repository };
  }

  async maybeReleaseResources(changeSetId) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    if (state.phase === "terminal" && state.terminal_outcome === "done") {
      await this.taskWorkspaceManager.releaseResources(changeSetId);
    }
  }
}

function requireAcceptedBundle(
  state,
  bundleRevision,
  bundleHash,
  repositoryId,
) {
  invariant(
    state.phase === "review",
    "INVALID_CHANGE_SET_STATE",
    "ChangeSet is not awaiting integration",
  );
  const bundle = state.bundles.at(-1);
  const accepted = state.decisions.some(
    (decision) =>
      decision.type === "bundle_review" &&
      decision.decision === "accept" &&
      decision.bundle_revision === bundleRevision &&
      decision.bundle_hash === bundleHash,
  );
  invariant(
    accepted &&
      bundle?.revision === bundleRevision &&
      bundle.bundle_hash === bundleHash,
    "BUNDLE_ACCEPTANCE_REQUIRED",
    "Integration requires the current exact accepted Bundle",
  );
  if (repositoryId === null) return { bundle, candidate: null };
  const bundleCandidate = bundle.candidates.find(
    (candidate) => candidate.repository_id === repositoryId,
  );
  const candidate = state.candidates.find(
    (item) => item.candidate_id === bundleCandidate?.candidate_id,
  );
  invariant(
    candidate?.candidate_sha === bundleCandidate?.candidate_sha,
    "INTEGRATION_CANDIDATE_NOT_FOUND",
    "Accepted integration Candidate is missing",
  );
  return { bundle, candidate };
}

function requireGrant(state, grantId) {
  const grant = state.action_grants.find(
    (candidate) => candidate.action_grant_id === grantId,
  );
  invariant(grant, "ACTION_GRANT_NOT_FOUND", "ActionGrant does not exist");
  return grant;
}

function currentPlan(state) {
  return (
    state.plans.find((plan) => plan.revision === state.current_plan_revision) ??
    null
  );
}

function currentRepositorySelection(state) {
  return state.repository_selection_revisions.find(
    (selection) =>
      selection.revision === state.current_repository_selection_revision,
  );
}

function currentHarnessSelection(state) {
  return state.repository_harness_selection_revisions.find(
    (selection) =>
      selection.revision ===
      state.current_repository_harness_selection_revision,
  );
}

function allCandidatesIntegrated(state, bundleId) {
  const bundle = state.bundles.find((candidate) => candidate.bundle_id === bundleId);
  return bundle.candidates.every((candidate) =>
    candidateHasExactIntegration(state, bundleId, candidate),
  );
}

function candidateHasExactIntegration(state, bundleId, candidate) {
  const runtimeIntegrated = state.integration_results.some(
    (result) =>
      result.bundle_id === bundleId &&
      result.repository_id === candidate.repository_id &&
      result.candidate_sha === candidate.candidate_sha &&
      result.action_kind === "fast_forward_target" &&
      result.status === "succeeded",
  );
  const githubIntegrated = state.delivery_requests.some(
    (request) =>
      request.bundle_id === bundleId &&
      request.repository_id === candidate.repository_id &&
      request.candidate_sha === candidate.candidate_sha &&
      request.state === "merged",
  );
  return runtimeIntegrated || githubIntegrated;
}

function existingCommand(state, idempotencyKey, command, input) {
  const existing = state.commands?.[idempotencyKey];
  if (!existing) return null;
  invariant(
    existing.command === command &&
      existing.fingerprint === commandFingerprint(command, input),
    "IDEMPOTENCY_KEY_REUSED",
    "Integration idempotency key was reused for different input",
  );
  return existing;
}

function applyCompletedCommand({
  state,
  idempotencyKey,
  command,
  input,
  perform,
}) {
  const existing = existingCommand(state, idempotencyKey, command, input);
  if (existing) {
    invariant(
      existing.status === "completed",
      "COMMAND_IN_PROGRESS",
      "Integration command is not complete",
    );
    return structuredClone(existing.result);
  }
  const result = perform();
  state.commands[idempotencyKey] = {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "completed",
    result: structuredClone(result),
    completed_at: state.updated_at,
  };
  return result;
}

function beginCommand(state, idempotencyKey, command, input) {
  const existing = existingCommand(state, idempotencyKey, command, input);
  if (existing?.status === "in_progress") return;
  invariant(
    !existing || existing.status === "failed",
    "COMMAND_STATE_MISMATCH",
    "Integration command cannot be started from its current state",
  );
  state.commands[idempotencyKey] = {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "in_progress",
  };
}

function failCommand(state, idempotencyKey, error, failedAt) {
  const command = state.commands[idempotencyKey];
  if (!command || command.status !== "in_progress") return;
  command.status = "failed";
  command.failed_at = failedAt;
  command.error = {
    code: error.code ?? "UNEXPECTED_ERROR",
    message: String(error.message ?? "Integration action failed").slice(0, 1024),
  };
}

function recordFailedCommand(
  state,
  idempotencyKey,
  command,
  input,
  error,
  failedAt,
) {
  state.commands[idempotencyKey] ??= {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "in_progress",
  };
  failCommand(state, idempotencyKey, error, failedAt);
}

function markReference(references, runId, status) {
  const reference = references.find((candidate) => candidate.run_id === runId);
  if (reference) reference.status = status;
}

function markSessionReference(taskWorkspace, sessionId, runId, status) {
  const session = taskWorkspace.agent_sessions.find(
    (candidate) => candidate.agent_session_id === sessionId,
  );
  markReference(session?.run_references ?? [], runId, status);
}
