import {
  assertChangeSetMutable,
  commandFingerprint,
} from "../domain/model.js";
import { ChangeFleetError, invariant } from "../domain/errors.js";
import {
  createDeliveryProjection,
  createDeliveryRequest,
  createGithubDeliveryBinding,
  normalizeGithubDeliveryBindingRequest,
} from "../domain/github-delivery.js";
import { normalizeId } from "../domain/model.js";
import { setChangeSetPhase } from "../domain/lifecycle.js";

// 交付应用服务拥有授权、幂等、状态和证据；Git 与 GitHub 适配器只执行窄外部能力。
export class GithubDeliveryService {
  constructor({
    controlStore,
    evidenceStore,
    repositoryWorker,
    deliveryGitAdapter,
    githubPullRequestAdapter,
    clock,
    controllerId,
  }) {
    this.controlStore = controlStore;
    this.evidenceStore = evidenceStore;
    this.repositoryWorker = repositoryWorker;
    this.deliveryGitAdapter = deliveryGitAdapter;
    this.githubPullRequestAdapter = githubPullRequestAdapter;
    this.clock = clock;
    this.controllerId = controllerId;
  }

  async configureGithubDelivery({
    idempotency_key,
    project_id,
    repository_id,
    github_repository,
    push_remote,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("project_id", project_id);
    normalizeId("repository_id", repository_id);
    normalizeId("actor", actor);
    const requested = normalizeGithubDeliveryBindingRequest({
      github_repository,
      push_remote,
    });
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, project_id);
    const repository = requireRepository(project, repository_id);
    const inspection = await this.deliveryGitAdapter.inspectBinding({
      repository,
      pushRemote: requested.push_remote,
      githubRepository: requested.github_repository,
    });
    const input = {
      project_id,
      repository_id,
      ...requested,
      actor,
    };
    return this.controlStore.transactCatalog((current) => {
      const existing = readExistingCommand(
        current.idempotency,
        idempotency_key,
        "configureGithubDelivery",
        input,
      );
      if (existing) return structuredClone(existing.result);
      const currentProject = requireProject(current, project_id);
      const currentRepository = requireRepository(
        currentProject,
        repository_id,
      );
      current.idempotency ??= {};
      currentRepository.delivery_binding_revisions ??= [];
      const revision =
        (currentRepository.current_delivery_binding_revision ?? 0) + 1;
      const binding = createGithubDeliveryBinding({
        request: requested,
        normalizedRemote: inspection.normalized_remote,
        revision,
        actor,
        confirmedAt: this.now(),
      });
      const previous = currentRepository.delivery_binding_revisions.find(
        (candidate) =>
          candidate.revision ===
          currentRepository.current_delivery_binding_revision,
      );
      if (previous) {
        previous.status = "superseded";
        previous.superseded_at = this.now();
      }
      currentRepository.delivery_binding_revisions.push(binding);
      currentRepository.current_delivery_binding_revision = revision;
      const result = {
        project_id,
        repository_id,
        delivery_binding_revision: revision,
        binding: structuredClone(binding),
      };
      current.idempotency[idempotency_key] = completedCommand(
        "configureGithubDelivery",
        input,
        result,
        this.now(),
      );
      return result;
    });
  }

  async publishDelivery({
    idempotency_key,
    change_set_id,
    title = null,
    body = null,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    const commandInput = {
      change_set_id,
      title: normalizeOptionalText(title, "title", 256),
      body: normalizeOptionalText(body, "body", 16 * 1024),
      actor,
    };
    const catalog = await this.controlStore.readCatalog();
    const initial = await this.controlStore.transactChangeSet(
      change_set_id,
      (state) => {
        const existing = readExistingCommand(
          state.commands,
          idempotency_key,
          "publishDelivery",
          commandInput,
        );
        if (existing?.status === "completed") {
          return { completed: true, result: structuredClone(existing.result) };
        }
        assertChangeSetMutable(state);
        if (existing?.status === "failed") {
          throw new ChangeFleetError(
            "COMMAND_PREVIOUSLY_FAILED",
            `Delivery command ${idempotency_key} previously failed`,
            existing.error,
          );
        }
        invariant(
          state.phase === "delivery",
          "INVALID_CHANGE_SET_STATE",
          `ChangeSet cannot publish delivery from phase ${state.phase}`,
        );
        const bundle = requireAcceptedCurrentBundle(state);
        const project = requireProject(catalog, state.project_id);
        state.delivery_requests ??= [];
        for (const bundleCandidate of bundle.candidates) {
          const candidate = requireCandidate(state, bundleCandidate);
          invariant(
            candidate.candidate_sha !== candidate.base_sha,
            "DELIVERY_EMPTY_CANDIDATE_UNSUPPORTED",
            `Repository ${candidate.repository_id} has no deliverable change`,
          );
          const existingSubject = state.delivery_requests.find(
            (item) =>
              item.bundle_id === bundle.bundle_id &&
              item.repository_id === candidate.repository_id &&
              item.target_ref === candidate.target_ref,
          );
          if (existingSubject) continue;
          const repository = requireRepository(
            project,
            candidate.repository_id,
          );
          const binding = requireCurrentBinding(repository);
          const request = createDeliveryRequest({
            changeSetId: change_set_id,
            planRevision: state.current_plan_revision,
            bundle,
            candidate,
            binding,
            createdAt: this.now(),
          });
          const existingRequest = state.delivery_requests.find(
            (item) => item.delivery_request_id === request.delivery_request_id,
          );
          if (!existingRequest) state.delivery_requests.push(request);
        }
        if (!existing) {
          state.commands[idempotency_key] = inProgressCommand(
            "publishDelivery",
            commandInput,
            this.now(),
          );
        }
        setChangeSetPhase(state, "delivery");
        state.updated_at = this.now();
        return { completed: false, bundle_id: bundle.bundle_id };
      },
    );
    if (initial.completed) return initial.result;

    try {
      const prepared = await this.loadCurrentDeliverySubjects(
        change_set_id,
        initial.bundle_id,
      );
      // 所有目标先只读预检，尽量在任何远端写入前暴露整体陈旧或绑定漂移。
      for (const subject of prepared) {
        try {
          await this.preflightSubject(subject);
        } catch (error) {
          await this.preservePrimaryFailure(
            error,
            "delivery_preflight_failure_persistence",
            () => this.recordFailure(change_set_id, subject.request, error),
          );
          throw error;
        }
      }
      for (const subject of prepared) {
        await this.publishSubject(change_set_id, subject, commandInput);
      }
      return this.controlStore.transactChangeSet(change_set_id, (state) => {
        deriveAggregateDeliveryState(state);
        const result = createDeliveryProjection(state);
        finishCommand(state, idempotency_key, result, this.now());
        state.updated_at = this.now();
        return result;
      });
    } catch (error) {
      if (error?.code !== "CONTROLLER_INTERRUPTED") {
        await this.preservePrimaryFailure(
          error,
          "delivery_command_failure_persistence",
          () => this.failCommand(change_set_id, idempotency_key, error),
        );
      }
      throw error;
    }
  }

  async refreshDelivery({ idempotency_key, change_set_id }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    const commandInput = { change_set_id };
    const initial = await this.controlStore.transactChangeSet(
      change_set_id,
      (state) => {
        const existing = readExistingCommand(
          state.commands,
          idempotency_key,
          "refreshDelivery",
          commandInput,
        );
        if (existing?.status === "completed") {
          if (!refreshResultRemainsAmbiguous(existing.result)) {
            return {
              completed: true,
              result: structuredClone(existing.result),
            };
          }
          // 当 refresh 结果仍停留在非终态 delivery 视图时，允许同一 attempt identity
          // 继续复用同一 idempotency key 重新观察外部状态，而不是把 partial 结果永久缓存成终值。
          existing.status = "in_progress";
          delete existing.result;
          delete existing.completed_at;
        }
        assertChangeSetMutable(state);
        if (existing?.status === "failed") {
          throw new ChangeFleetError(
            "COMMAND_PREVIOUSLY_FAILED",
            `Delivery refresh ${idempotency_key} previously failed`,
            existing.error,
          );
        }
        invariant(
          state.phase === "delivery" ||
            (state.phase === "terminal" && state.terminal_outcome === "done"),
          "INVALID_CHANGE_SET_STATE",
          `ChangeSet cannot refresh delivery from phase ${state.phase}`,
        );
        const bundle = requireAcceptedCurrentBundle(state);
        const requests = currentRequests(state, bundle.bundle_id);
        invariant(
          requests.length === bundle.candidates.length,
          "DELIVERY_NOT_PUBLISHED",
          "Current Bundle does not have a complete delivery request set",
        );
        if (!existing) {
          state.commands[idempotency_key] = inProgressCommand(
            "refreshDelivery",
            commandInput,
            this.now(),
          );
        }
        return { completed: false, bundle_id: bundle.bundle_id };
      },
    );
    if (initial.completed) return initial.result;

    try {
      const subjects = await this.loadCurrentDeliverySubjects(
        change_set_id,
        initial.bundle_id,
      );
      for (const subject of subjects) {
        if (subject.request.pull_request === null) continue;
        await this.refreshSubject(change_set_id, subject);
      }
      return this.controlStore.transactChangeSet(change_set_id, (state) => {
        deriveAggregateDeliveryState(state);
        const result = createDeliveryProjection(state);
        finishCommand(state, idempotency_key, result, this.now());
        state.updated_at = this.now();
        return result;
      });
    } catch (error) {
      if (error?.code !== "CONTROLLER_INTERRUPTED") {
        await this.preservePrimaryFailure(
          error,
          "delivery_command_failure_persistence",
          () => this.failCommand(change_set_id, idempotency_key, error),
        );
      }
      throw error;
    }
  }

  async readDelivery({ change_set_id }) {
    normalizeId("change_set_id", change_set_id);
    return createDeliveryProjection(
      await this.controlStore.readChangeSet(change_set_id),
    );
  }

  async loadCurrentDeliverySubjects(changeSetId, bundleId) {
    const [state, catalog] = await Promise.all([
      this.controlStore.readChangeSet(changeSetId),
      this.controlStore.readCatalog(),
    ]);
    const project = requireProject(catalog, state.project_id);
    const bundle = state.bundles.find((item) => item.bundle_id === bundleId);
    invariant(bundle, "DELIVERY_BUNDLE_NOT_FOUND", "Delivery Bundle is missing");
    return currentRequests(state, bundleId).map((request) => {
      const repository = requireRepository(project, request.repository_id);
      const binding = requireBindingRevision(
        repository,
        request.binding_revision,
      );
      const candidate = state.candidates.find(
        (item) => item.candidate_id === request.candidate_id,
      );
      invariant(
        candidate?.candidate_sha === request.candidate_sha,
        "DELIVERY_CANDIDATE_NOT_FOUND",
        "Exact delivery Candidate is missing from ChangeSet state",
      );
      return { request, repository, binding, candidate };
    });
  }

  async preflightSubject(subject) {
    await this.repositoryWorker.preflightCandidate({
      repository: subject.repository,
      candidate: subject.candidate,
    });
    await this.deliveryGitAdapter.inspectBinding({
      repository: subject.repository,
      pushRemote: subject.binding.push_remote,
      githubRepository: subject.binding.github_repository,
    });
    subject.existing_pull_request =
      await this.githubPullRequestAdapter.findPullRequest({
        githubRepository: subject.request.github_repository,
        headBranch: subject.request.remote_branch,
        targetRef: subject.request.target_ref,
      });
    if (subject.existing_pull_request === null) {
      const targetSha = await this.deliveryGitAdapter.readRemoteRef({
        repository: subject.repository,
        pushRemote: subject.binding.push_remote,
        ref: subject.request.target_ref,
      });
      invariant(
        targetSha === subject.request.candidate_base_sha,
        "DELIVERY_TARGET_MOVED",
        "Delivery target moved after Candidate creation",
        {
          expected_sha: subject.request.candidate_base_sha,
          observed_sha: targetSha,
          repository_id: subject.request.repository_id,
        },
      );
    }
  }

  async publishSubject(changeSetId, subject, commandInput) {
    const request = subject.request;
    const lock = await this.controlStore.acquireDeliveryLock(
      request.repository_id,
      request.target_ref,
      `${this.controllerId}:${request.delivery_request_id}`,
    );
    try {
      if (subject.existing_pull_request !== null) {
        // 先恢复已存在的精确 PR；它可能在控制器丢失期间已经被人合入并移动目标。
        const [pullRequest, targetSha] = await Promise.all([
          this.githubPullRequestAdapter.readPullRequest({
            githubRepository: request.github_repository,
            number: subject.existing_pull_request.number,
          }),
          this.deliveryGitAdapter.readRemoteRef({
            repository: subject.repository,
            pushRemote: request.push_remote,
            ref: request.target_ref,
          }),
        ]);
        await this.applyPullRequestObservation({
          changeSetId,
          subject,
          pullRequest,
          targetSha,
          phase: "publication_recovery",
        });
        return;
      }
      const targetSha = await this.deliveryGitAdapter.readRemoteRef({
        repository: subject.repository,
        pushRemote: request.push_remote,
        ref: request.target_ref,
      });
      invariant(
        targetSha === request.candidate_base_sha,
        "DELIVERY_TARGET_MOVED",
        "Delivery target moved before publication",
        { expected_sha: request.candidate_base_sha, observed_sha: targetSha },
      );
      await this.controlStore.transactChangeSet(changeSetId, (state) => {
        const current = requireDeliveryRequest(
          state,
          request.delivery_request_id,
        );
        current.state = "publishing";
        current.attempt_count += 1;
        current.last_error = null;
        current.updated_at = this.now();
        state.updated_at = this.now();
      });
      await this.deliveryGitAdapter.publishExactCandidate({
        repository: subject.repository,
        pushRemote: request.push_remote,
        candidateSha: request.candidate_sha,
        remoteBranch: request.remote_branch,
      });
      let pullRequest = await this.githubPullRequestAdapter.findPullRequest({
        githubRepository: request.github_repository,
        headBranch: request.remote_branch,
        targetRef: request.target_ref,
      });
      if (pullRequest === null) {
        pullRequest = await this.githubPullRequestAdapter.createPullRequest({
          githubRepository: request.github_repository,
          headBranch: request.remote_branch,
          targetRef: request.target_ref,
          title:
            commandInput.title ??
            `ChangeFleet ${changeSetId} (${request.repository_id})`,
          body:
            commandInput.body ??
            deliveryBody(changeSetId, request),
        });
      }
      await this.applyPullRequestObservation({
        changeSetId,
        subject,
        pullRequest,
        targetSha,
        phase: "publication",
      });
    } catch (error) {
      if (error?.code !== "CONTROLLER_INTERRUPTED") {
        await this.preservePrimaryFailure(
          error,
          "delivery_failure_persistence",
          () => this.recordFailure(changeSetId, request, error),
        );
      }
      throw error;
    } finally {
      await lock.release();
    }
  }

  async refreshSubject(changeSetId, subject) {
    const request = subject.request;
    const lock = await this.controlStore.acquireDeliveryLock(
      request.repository_id,
      request.target_ref,
      `${this.controllerId}:${request.delivery_request_id}`,
    );
    try {
      const [pullRequest, targetSha] = await Promise.all([
        this.githubPullRequestAdapter.readPullRequest({
          githubRepository: request.github_repository,
          number: request.pull_request.number,
        }),
        this.deliveryGitAdapter.readRemoteRef({
          repository: subject.repository,
          pushRemote: request.push_remote,
          ref: request.target_ref,
        }),
      ]);
      await this.applyPullRequestObservation({
        changeSetId,
        subject,
        pullRequest,
        targetSha,
        phase: "refresh",
      });
    } catch (error) {
      if (error?.code !== "CONTROLLER_INTERRUPTED") {
        await this.preservePrimaryFailure(
          error,
          "delivery_failure_persistence",
          () => this.recordFailure(changeSetId, request, error),
        );
      }
      throw error;
    } finally {
      await lock.release();
    }
  }

  async applyPullRequestObservation({
    changeSetId,
    subject,
    pullRequest,
    targetSha,
    phase,
  }) {
    const request = subject.request;
    let nextState;
    let integrationEvidenceState;
    let mergeReachable = null;
    if (
      request.state === "candidate_diverged" ||
      pullRequest.head_sha !== request.candidate_sha
    ) {
      nextState = "candidate_diverged";
      integrationEvidenceState = "invalid";
    } else if (pullRequest.state === "merged") {
      invariant(
        pullRequest.merge_commit_sha,
        "DELIVERY_RESULT_UNVERIFIED",
        "Merged GitHub pull request has no exact merge result SHA",
      );
      mergeReachable = await this.deliveryGitAdapter.verifyRemoteContains({
        repository: subject.repository,
        pushRemote: request.push_remote,
        targetRef: request.target_ref,
        commitSha: pullRequest.merge_commit_sha,
      });
      invariant(
        mergeReachable,
        "DELIVERY_RESULT_UNVERIFIED",
        "GitHub merge result is not reachable from the delivery target",
      );
      nextState = "merged";
      integrationEvidenceState = "current";
    } else if (pullRequest.state === "closed") {
      nextState = "closed_unmerged";
      integrationEvidenceState = "closed";
    } else {
      nextState = "open";
      integrationEvidenceState =
        targetSha === request.candidate_base_sha &&
        pullRequest.base_sha === targetSha
          ? "current"
          : "stale";
    }
    const reference = await this.recordObservation({
      changeSetId,
      request,
      phase,
      payload: {
        pull_request: pullRequest,
        target_sha: targetSha,
        merge_result_reachable: mergeReachable,
        outcome: nextState,
        integration_evidence_state: integrationEvidenceState,
      },
    });
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const current = requireDeliveryRequest(
        state,
        request.delivery_request_id,
      );
      current.target_sha_at_publication ??= request.candidate_base_sha;
      current.pull_request = structuredClone(pullRequest);
      current.state = nextState;
      current.integration_evidence_state = integrationEvidenceState;
      current.latest_observation_reference = reference;
      current.observation_count += 1;
      current.last_error = null;
      current.updated_at = this.now();
      deriveAggregateDeliveryState(state);
      state.updated_at = this.now();
    });
  }

  async recordObservation({ changeSetId, request, phase, payload }) {
    const current = requireDeliveryRequest(
      await this.controlStore.readChangeSet(changeSetId),
      request.delivery_request_id,
    );
    return this.evidenceStore.record({
      kind: "github_delivery_observation",
      subject: {
        change_set_id: changeSetId,
        delivery_request_id: request.delivery_request_id,
        candidate_sha: request.candidate_sha,
        sequence: current.observation_count + 1,
        phase,
      },
      payload: {
        previous_observation_reference:
          current.latest_observation_reference,
        ...payload,
      },
      createdAt: this.now(),
    });
  }

  async recordFailure(changeSetId, request, error) {
    const failureState = failureDeliveryState(error?.code);
    const reference = await this.recordObservation({
      changeSetId,
      request,
      phase: "failure",
      payload: {
        outcome: failureState,
        error: {
          code: error?.code ?? "UNEXPECTED_ERROR",
          message: String(error?.message ?? "Unexpected delivery failure").slice(
            0,
            1_024,
          ),
          details: error?.details ?? null,
          secondary_failures: structuredClone(
            error?.secondary_failures ?? [],
          ),
        },
      },
    });
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const current = requireDeliveryRequest(
        state,
        request.delivery_request_id,
      );
      current.state = failureState;
      current.integration_evidence_state =
        failureState === "integration_stale" ? "stale" : "unknown";
      current.latest_observation_reference = reference;
      current.observation_count += 1;
      current.last_error = {
        code: error?.code ?? "UNEXPECTED_ERROR",
        at: this.now(),
      };
      current.updated_at = this.now();
      deriveAggregateDeliveryState(state);
      state.updated_at = this.now();
    });
  }

  async failCommand(changeSetId, idempotencyKey, error) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const command = state.commands[idempotencyKey];
      if (!command || command.status !== "in_progress") return;
      command.status = "failed";
      command.failed_at = this.now();
      command.error = {
        code: error?.code ?? "UNEXPECTED_ERROR",
        message: String(error?.message ?? "Delivery command failed").slice(
          0,
          1_024,
        ),
        secondary_failures: structuredClone(
          error?.secondary_failures ?? [],
        ),
      };
      deriveAggregateDeliveryState(state);
      state.updated_at = this.now();
    });
  }

  async preservePrimaryFailure(primaryError, stage, operation) {
    // 交付审计写入失败不会覆盖最初的远端或 Git 错误，但会随主错误返回。
    try {
      await operation();
    } catch (secondaryError) {
      primaryError.secondary_failures ??= [];
      primaryError.secondary_failures.push({
        stage,
        code: secondaryError?.code ?? "UNEXPECTED_ERROR",
        message: secondaryError?.message ?? String(secondaryError),
      });
    }
  }

  now() {
    return this.clock().toISOString();
  }
}

function requireAcceptedCurrentBundle(state) {
  const bundle = state.bundles.at(-1);
  invariant(bundle, "DELIVERY_BUNDLE_NOT_FOUND", "Current Bundle is missing");
  invariant(
    state.decisions.some(
      (decision) =>
        decision.type === "bundle_review" &&
        decision.bundle_revision === bundle.revision &&
        decision.bundle_hash === bundle.bundle_hash &&
        decision.decision === "accept",
    ),
    "BUNDLE_ACCEPTANCE_REQUIRED",
    "Current exact Bundle is not accepted for delivery",
  );
  return bundle;
}

function requireCandidate(state, bundleCandidate) {
  const candidate = state.candidates.find(
    (item) => item.candidate_id === bundleCandidate.candidate_id,
  );
  invariant(
    candidate?.candidate_sha === bundleCandidate.candidate_sha,
    "DELIVERY_CANDIDATE_NOT_FOUND",
    "Exact Bundle Candidate is missing from ChangeSet state",
  );
  return candidate;
}

function requireProject(catalog, projectId) {
  const project = catalog.projects?.[projectId];
  invariant(
    project,
    "PROJECT_NOT_FOUND",
    `Project ${projectId} does not exist`,
  );
  return project;
}

function requireRepository(project, repositoryId) {
  const repository = project.repositories.find(
    (candidate) => candidate.repository_id === repositoryId,
  );
  invariant(
    repository,
    "REPOSITORY_NOT_REGISTERED",
    `Repository ${repositoryId} is not registered`,
  );
  return repository;
}

function requireCurrentBinding(repository) {
  invariant(
    repository.current_delivery_binding_revision !== null &&
      repository.current_delivery_binding_revision !== undefined,
    "GITHUB_DELIVERY_BINDING_REQUIRED",
    `Repository ${repository.repository_id} has no confirmed GitHub delivery binding`,
  );
  return requireBindingRevision(
    repository,
    repository.current_delivery_binding_revision,
  );
}

function requireBindingRevision(repository, revision) {
  const binding = (repository.delivery_binding_revisions ?? []).find(
    (candidate) => candidate.revision === revision,
  );
  invariant(
    binding,
    "GITHUB_DELIVERY_BINDING_NOT_FOUND",
    `GitHub delivery binding revision ${revision} is missing`,
  );
  return binding;
}

function requireDeliveryRequest(state, requestId) {
  const request = (state.delivery_requests ?? []).find(
    (candidate) => candidate.delivery_request_id === requestId,
  );
  invariant(
    request,
    "DELIVERY_REQUEST_NOT_FOUND",
    `Delivery request ${requestId} is missing`,
  );
  return request;
}

function currentRequests(state, bundleId) {
  return (state.delivery_requests ?? [])
    .filter((request) => request.bundle_id === bundleId)
    .sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
}

function deriveAggregateDeliveryState(state) {
  const bundleId = state.bundles.at(-1)?.bundle_id;
  const requests = currentRequests(state, bundleId);
  if (requests.length === 0) return;
  if (requests.every((request) => request.state === "merged")) {
    setChangeSetPhase(state, "terminal", "done");
  } else if (
    requests.some((request) =>
      new Set([
        "candidate_diverged",
        "closed_unmerged",
        "integration_stale",
      ]).has(request.state),
    )
  ) {
    setChangeSetPhase(state, "delivery");
  } else {
    setChangeSetPhase(state, "delivery");
  }
}

function failureDeliveryState(code) {
  if (code === "DELIVERY_TARGET_MOVED") return "integration_stale";
  if (
    new Set([
      "DELIVERY_BRANCH_DIVERGED",
      "GITHUB_PR_HEAD_DIVERGED",
    ]).has(code)
  ) {
    return "candidate_diverged";
  }
  return "failed";
}

function inProgressCommand(command, input, startedAt) {
  return {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "in_progress",
    started_at: startedAt,
  };
}

function completedCommand(command, input, result, completedAt) {
  return {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "completed",
    result: structuredClone(result),
    completed_at: completedAt,
  };
}

function readExistingCommand(commands, idempotencyKey, command, input) {
  const existing = commands?.[idempotencyKey];
  if (!existing) return null;
  invariant(
    existing.command === command &&
      existing.fingerprint === commandFingerprint(command, input),
    "IDEMPOTENCY_KEY_REUSED",
    `Idempotency key ${idempotencyKey} was used for different input`,
  );
  return existing;
}

function finishCommand(state, idempotencyKey, result, completedAt) {
  const command = state.commands[idempotencyKey];
  invariant(
    command?.status === "in_progress",
    "COMMAND_STATE_MISMATCH",
    `Command ${idempotencyKey} is not in progress`,
  );
  command.status = "completed";
  command.result = structuredClone(result);
  command.completed_at = completedAt;
}

function refreshResultRemainsAmbiguous(result) {
  return result?.activity === "running";
}

function normalizeOptionalText(value, field, maximum) {
  if (value === null || value === undefined) return null;
  invariant(
    typeof value === "string" &&
      value.length <= maximum &&
      (field !== "title" || value.trim().length > 0),
    "INVALID_GITHUB_PULL_REQUEST_TEXT",
    `GitHub pull request ${field} is invalid`,
  );
  return value;
}

function deliveryBody(changeSetId, request) {
  return [
    `ChangeSet: ${changeSetId}`,
    `Bundle: ${request.bundle_id} revision ${request.bundle_revision}`,
    `Candidate: ${request.candidate_sha}`,
    `Target: ${request.target_ref}`,
  ].join("\n");
}
