import { measureInitialContext } from "../adapters/runtime/runtime-port.js";
import { sha256 } from "../domain/canonical-json.js";
import { invariant } from "../domain/errors.js";
import {
  createAgentRunRecord,
  createRunReference,
  setChangeSetPhase,
  setWorkUnitPhase,
} from "../domain/lifecycle.js";
import { createValidationSubject } from "../domain/model.js";
import { HARNESS_SELECTION_MODES } from "../domain/repository-harness.js";
import {
  assessInitialContext,
  createControlContract,
} from "../domain/runtime-context.js";
import {
  blockingFeedbackByWorkUnit,
  bundleReviewAssessmentMatches,
  createBundleReviewAssessment,
  normalizeBundleReviewOutcome,
} from "../domain/bundle-review.js";
import { runTerminalStatusForError } from "./run-coordinator.js";

// BundleReviewOrchestrator 拥有 Bundle 组装、独立质量复核、复核预算循环与失败 Gate；
// 聚合权威与顶层状态机仍由 ChangeFleetService 保留。
export class BundleReviewOrchestrator {
  constructor({
    controlStore,
    runStore,
    runCoordinator,
    runService,
    feedbackService,
    bundleAssembler,
    repositoryWorker,
    harnessSnapshotStore,
    reviewRuntime,
    reviewAgentProfile,
    idFactory,
    now,
    validateCombinedCandidates,
    currentPlan,
    currentRepositorySelection,
    currentRepositoryHarnessSelection,
    unitsForCurrentPlan,
    requireProject,
    requireRepository,
    resolveValidationBlockers,
    resolveFailedExecutionCommandBlockers,
    harnessSelectionForContext,
    overlayHarnessResources,
    repositoryHarnessObservation,
    cleanupBundleReviewResources,
    bundleReviewEvidenceReferenceIds,
    createBundleReviewProjection,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.runCoordinator = runCoordinator;
    this.runService = runService;
    this.feedbackService = feedbackService;
    this.bundleAssembler = bundleAssembler;
    this.repositoryWorker = repositoryWorker;
    this.harnessSnapshotStore = harnessSnapshotStore;
    this.reviewRuntime = reviewRuntime;
    this.reviewAgentProfile = reviewAgentProfile;
    this.idFactory = idFactory;
    this.now = now;
    this.validateCombinedCandidates = validateCombinedCandidates;
    this.currentPlan = currentPlan;
    this.currentRepositorySelection = currentRepositorySelection;
    this.currentRepositoryHarnessSelection = currentRepositoryHarnessSelection;
    this.unitsForCurrentPlan = unitsForCurrentPlan;
    this.requireProject = requireProject;
    this.requireRepository = requireRepository;
    this.resolveValidationBlockers = resolveValidationBlockers;
    this.resolveFailedExecutionCommandBlockers =
      resolveFailedExecutionCommandBlockers;
    this.harnessSelectionForContext = harnessSelectionForContext;
    this.overlayHarnessResources = overlayHarnessResources;
    this.repositoryHarnessObservation = repositoryHarnessObservation;
    this.cleanupBundleReviewResources = cleanupBundleReviewResources;
    this.bundleReviewEvidenceReferenceIds = bundleReviewEvidenceReferenceIds;
    this.createBundleReviewProjection = createBundleReviewProjection;
  }

  async finalizeCurrentBundle(changeSetId, { budgetRequest = null } = {}) {
    const beforeValidation = await this.controlStore.readChangeSet(changeSetId);
    const plan = this.currentPlan(beforeValidation);
    const project = this.requireProject(
      await this.controlStore.readCatalog(),
      beforeValidation.project_id,
    );
    const repositories = Object.fromEntries(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const candidates = this.unitsForCurrentPlan(beforeValidation).map(
      (unit) => unit.candidate,
    );
    invariant(
      candidates.length > 0 && candidates.every(Boolean),
      "CANDIDATE_BUNDLE_NOT_READY",
      "Every current WorkUnit requires one exact Candidate",
    );
    const subject = createValidationSubject(
      beforeValidation,
      plan,
      candidates,
    );
    const combinedEvidence = await this.validateCombinedCandidates({
      changeSetId,
      subject,
      candidates,
      repositories,
      command: plan.combined_check,
      selectionRationale: plan.combined_check_rationale,
      projectPolicy: beforeValidation.verification_policy,
      budgetRequest,
    });
    const stateForBundle = await this.controlStore.readChangeSet(changeSetId);
    const bundle = await this.bundleAssembler.assemble({
      changeSet: stateForBundle,
      plan,
      candidates,
      combinedEvidence,
    });
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      invariant(
        state.current_plan_revision === plan.revision &&
          state.phase === "running" &&
          this.unitsForCurrentPlan(state).every(
            (unit) => unit.phase === "complete",
          ),
        "STALE_SUPERVISION_ACTION",
        "Bundle subject changed before assembly completed",
      );
      state.bundles.push(bundle);
      state.current_bundle_review_assessment_id = null;
      state.bundle_review_last_error = null;
      this.feedbackService.clear(state);
      this.resolveValidationBlockers(state, {
        validationSubjectHash: subject.validation_subject_hash,
        resolvedAt: this.now(),
      });
      this.resolveFailedExecutionCommandBlockers(state, this.now());
      setChangeSetPhase(state, "review");
      state.updated_at = this.now();
      return null;
    });
    return bundle;
  }

  async reviewCurrentBundle(changeSetId) {
    let state = await this.controlStore.readChangeSet(changeSetId);
    const plan = this.currentPlan(state);
    const bundle = state.bundles.at(-1) ?? null;
    invariant(
      state.phase === "review" &&
        plan?.status === "confirmed" &&
        plan.bundle_review?.mode === "independent" &&
        bundle,
      "BUNDLE_REVIEW_REQUIRED",
      "The current ChangeSet has no independently reviewable exact Bundle",
    );
    const existing = (state.bundle_review_assessments ?? []).find(
      (assessment) =>
        assessment.assessment_id ===
        state.current_bundle_review_assessment_id,
    );
    if (bundleReviewAssessmentMatches(existing, bundle, plan)) {
      return structuredClone(existing);
    }
    invariant(
      plan.bundle_review.agent_profile_id ===
          this.reviewAgentProfile.profile_id &&
        plan.bundle_review.agent_profile_revision ===
          this.reviewAgentProfile.revision,
      "REVIEW_AGENT_PROFILE_MISMATCH",
      "The configured Review AgentProfile does not match the confirmed Plan",
    );
    const attempt =
      state.run_references.filter(
        (reference) =>
          reference.operation === "review" &&
          reference.bundle_id === bundle.bundle_id,
      ).length + 1;
    invariant(
      attempt <= plan.bundle_review.attempt_limit,
      "BUNDLE_REVIEW_BUDGET_EXCEEDS_PROJECT_POLICY",
      "Bundle review attempt limit is exhausted",
    );

    const catalog = await this.controlStore.readCatalog();
    const project = this.requireProject(catalog, state.project_id);
    const repositorySelection = this.currentRepositorySelection(state);
    const harnessSelection = this.currentRepositoryHarnessSelection(state);
    const runId = this.idFactory("run");
    const reviewResources = [];
    try {
      for (const candidate of bundle.candidates) {
        const repository = this.requireRepository(
          project,
          candidate.repository_id,
        );
        const selectedRepository = repositorySelection.repositories.find(
          (item) => item.repository_id === candidate.repository_id,
        );
        const selectedHarness = harnessSelection.repositories.find(
          (item) => item.repository_id === candidate.repository_id,
        );
        invariant(
          selectedRepository &&
            selectedHarness?.resolved_base_sha === candidate.base_sha,
          "STALE_BUNDLE_REVIEW",
          "Bundle review subject no longer matches Repository authority",
        );
        let workspace =
          await this.repositoryWorker.prepareBundleReviewWorkspace({
            repository,
            candidateSha: candidate.candidate_sha,
            harnessBaseSha: candidate.base_sha,
            workspaceId: `bundle-review-${runId}-${candidate.repository_id}`.slice(
              0,
              128,
            ),
          });
        // 工作区一经创建就登记清理责任，后续 Harness 读取失败也不会泄漏临时目录。
        const reviewResource = {
          repository,
          selected_repository: selectedRepository,
          selected_harness: selectedHarness,
          workspace,
          overlay_snapshot: null,
          harness_observation: null,
          available_harness: [],
          candidate,
        };
        reviewResources.push(reviewResource);
        let overlaySnapshot = null;
        if (
          selectedHarness.mode ===
          HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
        ) {
          overlaySnapshot = await this.harnessSnapshotStore.read(
            selectedHarness.artifact_reference,
          );
          workspace = await this.repositoryWorker.materializeHarnessOverlay({
            repository,
            workspace: {
              ...workspace,
              harness_overlay: {
                ...selectedHarness.artifact_reference,
                paths: [...selectedHarness.resolved_relative_paths],
              },
            },
            snapshot: overlaySnapshot,
          });
          reviewResource.workspace = workspace;
          reviewResource.overlay_snapshot = overlaySnapshot;
        }
        const exactCandidateHarness =
          await this.repositoryWorker.discoverHarness(
            repository,
            candidate.candidate_sha,
          );
        const overlayResources = this.overlayHarnessResources(overlaySnapshot);
        Object.assign(reviewResource, {
          harness_observation: this.repositoryHarnessObservation({
            repositoryId: repository.repository_id,
            exactBaseResources: exactCandidateHarness,
            overlayResources,
          }),
          available_harness: [...exactCandidateHarness, ...overlayResources],
        });
      }
    } catch (error) {
      await this.cleanupBundleReviewResources(
        this.repositoryWorker,
        reviewResources,
      );
      throw error;
    }

    const evidenceReferenceIds = this.bundleReviewEvidenceReferenceIds(
      state,
      bundle,
    );
    const contextProjection = this.createBundleReviewProjection({
      state,
      plan,
      bundle,
      repositorySelection,
      harnessSelection,
      resources: reviewResources,
      evidenceReferenceIds,
    });
    const controlContract = createControlContract({
      operation: "review",
      changeSetId,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision: harnessSelection.revision,
      authorizedRepositories: bundle.candidates.map(
        (candidate) => candidate.repository_id,
      ),
      allowedOutcomes: ["bundle_review_completed"],
      humanGates: ["bundle_quality_decision", "candidate_bundle_acceptance"],
    });
    const invocation = {
      operation: "review",
      agent_profile: this.reviewAgentProfile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace: null,
      signal: null,
    };
    const createdAt = this.now();
    await this.runStore.create(
      createAgentRunRecord({
        runId,
        changeSetId,
        workUnitId: null,
        operation: "review",
        trigger: attempt === 1 ? "initial" : "retry",
        attempt,
        agentProfile: this.reviewAgentProfile,
        continuationOfRunId:
          state.run_references
            .filter(
              (reference) =>
                reference.operation === "review" &&
                reference.bundle_id === bundle.bundle_id,
            )
            .at(-1)?.run_id ?? null,
        repositoryHarnessSelection: {
          revision: harnessSelection.revision,
          repositories: reviewResources.map((resource) =>
            this.harnessSelectionForContext(resource.selected_harness),
          ),
        },
        repositoryHarnessObservation: {
          repositories: reviewResources.map(
            (resource) => resource.harness_observation,
          ),
        },
        contextEvidence: null,
        contextProjectionIdentity: null,
        createdAt,
        extra: {
          review_workspaces: reviewResources.map(
            (resource) => resource.workspace,
          ),
          bundle_subject: {
            bundle_id: bundle.bundle_id,
            bundle_revision: bundle.revision,
            bundle_hash: bundle.bundle_hash,
          },
        },
      }),
    );
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const currentBundle = current.bundles.at(-1);
      invariant(
        current.phase === "review" &&
          current.current_plan_revision === plan.revision &&
          currentBundle?.bundle_id === bundle.bundle_id &&
          current.current_bundle_review_assessment_id === null,
        "STALE_BUNDLE_REVIEW",
        "Bundle review subject changed before Runtime dispatch",
      );
      current.run_references.push(
        createRunReference({
          runId,
          operation: "review",
          trigger: attempt === 1 ? "initial" : "retry",
          plan_revision: plan.revision,
          work_unit_id: null,
          bundle_id: bundle.bundle_id,
          bundle_revision: bundle.revision,
          bundle_hash: bundle.bundle_hash,
          attempt,
        }),
      );
      current.updated_at = this.now();
    });

    let providerEvidence = null;
    let runtimeError = null;
    let rawOutcome = null;
    try {
      const contextEvidence = assessInitialContext({
        controlContract,
        contextProjection,
        agentProfile: this.reviewAgentProfile,
        runtimeMeasurement: await measureInitialContext(
          this.reviewRuntime,
          invocation,
        ),
      });
      await this.runStore.update(runId, (run) => {
        run.context_evidence = contextEvidence;
        run.context_projection_identity = {
          schema_version: contextProjection.schema_version,
          digest: sha256(contextProjection),
        };
      });
      const result = await this.runCoordinator.invoke(
        this.reviewRuntime,
        runId,
        invocation,
      );
      providerEvidence = result.provider_evidence;
      rawOutcome = result.outcome;
      normalizeBundleReviewOutcome(rawOutcome, {
        bundle,
        plan,
        workUnits: plan.work_units,
        evidenceReferenceIds,
      });
      for (const resource of reviewResources) {
        await this.repositoryWorker.preflightVerificationWorkspace({
          repository: resource.repository,
          workspace: resource.workspace,
        });
      }
    } catch (error) {
      runtimeError = error;
      providerEvidence = error.runtime_evidence ?? providerEvidence;
    }
    if (runtimeError?.code === "CONTROLLER_INTERRUPTED") throw runtimeError;
    try {
      await this.cleanupBundleReviewResources(
        this.repositoryWorker,
        reviewResources,
      );
    } catch (error) {
      runtimeError ??= error;
    }
    if (runtimeError) {
      await this.runCoordinator.failAttempt({
        runId,
        invocation,
        providerEvidence,
        error: runtimeError,
        errorCode: runtimeError.code ?? "INVALID_BUNDLE_REVIEW_OUTCOME",
      });
      await this.runService.markRunReference(
        changeSetId,
        runId,
        runTerminalStatusForError(runtimeError),
      );
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        current.bundle_review_last_error = {
          code: runtimeError.code ?? "INVALID_BUNDLE_REVIEW_OUTCOME",
          run_id: runId,
        };
        current.updated_at = this.now();
      });
      throw runtimeError;
    }

    const completedAt = this.now();
    const assessment = createBundleReviewAssessment({
      bundle,
      plan,
      runId,
      agentProfile: this.reviewAgentProfile,
      outcome: rawOutcome,
      createdAt: completedAt,
      evidenceReferenceIds,
    });
    const assessmentArtifact = await this.runStore.writeJsonArtifact(
      runId,
      "bundle-review-assessment",
      assessment,
    );
    await this.runCoordinator.completeAttempt({
      runId,
      invocation,
      providerEvidence,
      completedAt,
      eventPayload: rawOutcome,
      runOutcome: {
        type: rawOutcome.type,
        disposition: assessment.disposition,
        summary: assessment.summary,
        assessment_id: assessment.assessment_id,
        assessment_artifact: assessmentArtifact,
      },
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const currentBundle = current.bundles.at(-1);
      invariant(
        current.phase === "review" &&
          current.current_plan_revision === plan.revision &&
          currentBundle?.bundle_id === bundle.bundle_id,
        "STALE_BUNDLE_REVIEW",
        "Bundle review subject changed before its assessment was recorded",
      );
      const reference = current.run_references.find(
        (item) => item.run_id === runId,
      );
      reference.status = "completed";
      current.bundle_review_assessments.push(assessment);
      current.current_bundle_review_assessment_id = assessment.assessment_id;
      current.bundle_review_last_error = null;
      if (assessment.disposition === "feedback") {
        const grouped = blockingFeedbackByWorkUnit(assessment);
        const currentUnits = this.unitsForCurrentPlan(current);
        const exhaustedTargets = [...grouped.keys()].filter((workUnitId) => {
          const unit = currentUnits.find(
            (candidate) => candidate.work_unit_id === workUnitId,
          );
          return (
            unit?.run_references.filter(
              (item) =>
                item.operation === "execution" && item.trigger === "feedback",
            ).length >= plan.supervision.feedback_cycle_limit_per_work_unit
          );
        });
        if (exhaustedTargets.length > 0) {
          // Reviewer 不能越过已确认的返工上限；保留 finding 并把超限选择交给人类。
          current.gates.push({
            gate_id: this.idFactory("gate"),
            kind: "bundle_review_decision",
            status: "open",
            change_set_id: changeSetId,
            work_unit_id: null,
            bundle_id: bundle.bundle_id,
            bundle_revision: bundle.revision,
            bundle_hash: bundle.bundle_hash,
            bundle_review_assessment_id: assessment.assessment_id,
            request: {
              question:
                "Bundle review Feedback exceeds the confirmed repair ceiling.",
              options: ["request_plan_revision", "close_changeset"],
            },
            created_at: completedAt,
          });
        } else {
          for (const [workUnitId, findings] of grouped) {
            const unit = this.unitsForCurrentPlan(current).find(
              (candidate) => candidate.work_unit_id === workUnitId,
            );
            invariant(
              unit?.phase === "complete" && unit.candidate,
              "STALE_BUNDLE_REVIEW",
              "Bundle review Feedback target is no longer complete",
            );
            const feedback = this.feedbackService.record(current, {
              source: "review",
              target: {
                change_set_id: changeSetId,
                plan_revision: plan.revision,
                bundle_id: bundle.bundle_id,
                bundle_revision: bundle.revision,
                bundle_hash: bundle.bundle_hash,
                bundle_review_assessment_id: assessment.assessment_id,
                work_unit_id: workUnitId,
              },
              content: { summary: assessment.summary, findings },
              createdAt: completedAt,
            });
            setWorkUnitPhase(unit, "execution");
            // 同 Plan 修正从当前精确 Candidate 继续；持久 RepositoryWorkspace 和 checkpoint 不得丢失。
            unit.verification_admission_id = null;
            unit.verification_review_id = null;
            unit.pending_feedback_id = feedback.feedback_id;
            unit.validation_attempt_ids = [];
            unit.candidate = null;
            unit.last_error = null;
            this.resolveValidationBlockers(current, {
              workUnitId,
              resolvedAt: completedAt,
            });
          }
        }
        if (exhaustedTargets.length === 0) {
          current.current_bundle_review_assessment_id = null;
          setChangeSetPhase(current, "running");
        }
      } else if (assessment.disposition === "gate") {
        current.gates.push({
          gate_id: this.idFactory("gate"),
          kind: "bundle_review_decision",
          status: "open",
          change_set_id: changeSetId,
          work_unit_id: null,
          bundle_id: bundle.bundle_id,
          bundle_revision: bundle.revision,
          bundle_hash: bundle.bundle_hash,
          bundle_review_assessment_id: assessment.assessment_id,
          request: structuredClone(assessment.human_decision),
          created_at: completedAt,
        });
      }
      current.updated_at = completedAt;
    });
    return structuredClone(assessment);
  }

  async reviewCurrentBundleUntilBoundary(changeSetId) {
    // 手工执行入口也消费同一冻结预算；失败只会重试当前精确 Bundle，耗尽后显式开 Gate。
    while (true) {
      try {
        const assessment = await this.reviewCurrentBundle(changeSetId);
        const state = await this.controlStore.readChangeSet(changeSetId);
        return {
          assessment,
          gate:
            assessment.disposition === "gate"
              ? state.gates.find(
                  (gate) =>
                    gate.status === "open" &&
                    gate.bundle_review_assessment_id ===
                      assessment.assessment_id,
                ) ?? null
              : null,
        };
      } catch (error) {
        if (
          ["CONTROLLER_INTERRUPTED", "RUNTIME_INTERRUPTED"].includes(
            error.code,
          )
        ) {
          throw error;
        }
        const state = await this.controlStore.readChangeSet(changeSetId);
        const plan = this.currentPlan(state);
        const bundle = state.bundles.at(-1) ?? null;
        const attempts = state.run_references.filter(
          (reference) =>
            reference.operation === "review" &&
            reference.bundle_id === bundle?.bundle_id,
        ).length;
        if (bundle && attempts < plan.bundle_review.attempt_limit) continue;
        return {
          assessment: null,
          gate: await this.openBundleReviewFailureGate(
            changeSetId,
            bundle,
            error,
          ),
        };
      }
    }
  }

  async openBundleReviewFailureGate(changeSetId, bundle, error) {
    return this.controlStore.transactChangeSet(changeSetId, (state) => {
      const currentBundle = state.bundles.at(-1) ?? null;
      invariant(
        state.phase === "review" &&
          bundle &&
          currentBundle?.bundle_id === bundle.bundle_id,
        "STALE_BUNDLE_REVIEW",
        "Bundle review failure no longer binds the current exact Bundle",
      );
      const existing = state.gates.find(
        (gate) =>
          gate.status === "open" &&
          gate.kind === "bundle_review_failure" &&
          gate.bundle_id === bundle.bundle_id,
      );
      if (existing) return structuredClone(existing);
      const gate = {
        gate_id: this.idFactory("gate"),
        kind: "bundle_review_failure",
        status: "open",
        change_set_id: changeSetId,
        work_unit_id: null,
        bundle_id: bundle.bundle_id,
        bundle_revision: bundle.revision,
        bundle_hash: bundle.bundle_hash,
        bundle_review_assessment_id: null,
        request: {
          question: `Bundle review stopped: ${error.code ?? "UNEXPECTED_ERROR"}.`,
          options: ["request_plan_revision", "close_changeset"],
        },
        created_at: this.now(),
      };
      state.gates.push(gate);
      state.updated_at = this.now();
      return structuredClone(gate);
    });
  }
}
