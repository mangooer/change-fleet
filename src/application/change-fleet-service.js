import { randomUUID } from "node:crypto";
import path from "node:path";

import { sha256 } from "../domain/canonical-json.js";
import {
  assertChangeSetMutable,
  commandFingerprint,
  createCandidate,
  createCandidateCheckpoint,
  createCandidateBundle,
  createConfirmedPlan,
  createValidationAttempt,
  createValidationSubject,
  normalizeHumanDecision,
  normalizeChangeSetCloseRequest,
  normalizeId,
  normalizeIntent,
  normalizePlanContent,
  normalizePlanningMessageText,
  normalizeRepositorySelectionRequest,
  normalizeRevisionFeedback,
  normalizeRevisionFeedbackAssessments,
} from "../domain/model.js";
import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../domain/runtime-context.js";
import { normalizeAgentProfile } from "../domain/agent-profile.js";
import { createRuntimeInvocationEvidence } from "../domain/runtime-evidence.js";
import {
  admissionModeAtLeast,
  assertValidationAttemptBudgetRequestsMatchPlan,
  createCheckIdentity,
  createVerificationReview,
  createVerificationAdmissionDecision,
  normalizeVerificationOutcome,
  normalizeOperatorAdmissionMode,
  normalizeValidationAttemptBudgetRequests,
  normalizeVerificationPolicy,
  resolveValidationAttemptBudget,
  selectValidationAttemptBudgetRequest,
  validationEnvironmentIdentity,
  verificationReviewAllowsCandidate,
} from "../domain/verification.js";
import {
  HARNESS_SELECTION_MODES,
  createExactBaseHarnessSelection,
  createOverlayHarnessSelection,
  normalizeRepositoryHarnessSelectionRequest,
  normalizeRepositoryWorkspacePolicy,
} from "../domain/repository-harness.js";
import { ChangeFleetError, invariant } from "../domain/errors.js";
import { ControlStore, CONTROL_SCHEMA_VERSION } from "../adapters/filesystem/control-store.js";
import { EvidenceStore } from "../adapters/filesystem/evidence-store.js";
import { HarnessSnapshotStore } from "../adapters/filesystem/harness-snapshot-store.js";
import { runCommand } from "../adapters/filesystem/command-runner.js";
import { RunStore } from "../adapters/filesystem/run-store.js";
import { DeliveryGitAdapter } from "../adapters/git/delivery-git-adapter.js";
import { RepositoryWorker } from "../adapters/git/repository-worker.js";
import { GhPullRequestAdapter } from "../adapters/github/gh-pull-request-adapter.js";
import {
  invokeRuntime,
  measureInitialContext,
} from "../adapters/runtime/runtime-port.js";
import { CombinedValidator } from "./combined-validator.js";
import { GithubDeliveryService } from "./github-delivery-service.js";

const MAX_CONTEXT_HARNESS_RESOURCES = 32;
const CLOSABLE_CHANGE_SET_STATES = new Set([
  "analyzing",
  "awaiting_plan_confirmation",
  "replanning",
  "ready",
  "executing",
  "validating",
  "candidate_review",
  "delivery_ready",
  "failed",
  "blocked",
]);

// 应用服务是确定性编排入口：语义工作交给 Runtime，权限、状态和证据在此裁决。
export class ChangeFleetService {
  constructor({
    controlRoot,
    workspaceRoot,
    runtime,
    agentProfile,
    verificationRuntime = runtime,
    verificationAgentProfile = agentProfile,
    clock = () => new Date(),
    idFactory = (prefix) => `${prefix}-${randomUUID()}`,
    deliveryGitAdapter = new DeliveryGitAdapter(),
    githubPullRequestAdapter = new GhPullRequestAdapter(),
  }) {
    this.controlRoot = path.resolve(controlRoot);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runtime = runtime;
    // 生产构造必须显式装配 Profile；测试 Runtime 也只能通过测试代码主动注入。
    this.agentProfile = normalizeAgentProfile(agentProfile);
    // 验证独立记录 Profile/Run；首个本地装配可复用 Provider，但调用者能够注入不同模型或 Runtime。
    this.verificationRuntime = verificationRuntime;
    this.verificationAgentProfile = normalizeAgentProfile(
      verificationAgentProfile,
    );
    this.clock = clock;
    this.idFactory = idFactory;
    this.instanceId = idFactory("controller");
    this.controlStore = new ControlStore(this.controlRoot, { clock });
    this.runStore = new RunStore(this.controlRoot);
    this.evidenceStore = new EvidenceStore(this.controlRoot);
    this.harnessSnapshotStore = new HarnessSnapshotStore(this.controlRoot);
    this.repositoryWorker = new RepositoryWorker({
      workspaceRoot: this.workspaceRoot,
    });
    this.combinedValidator = new CombinedValidator({
      controlRoot: this.controlRoot,
      repositoryWorker: this.repositoryWorker,
      evidenceStore: this.evidenceStore,
      clock,
    });
    this.githubDeliveryService = new GithubDeliveryService({
      controlStore: this.controlStore,
      evidenceStore: this.evidenceStore,
      repositoryWorker: this.repositoryWorker,
      deliveryGitAdapter,
      githubPullRequestAdapter,
      clock,
      controllerId: this.instanceId,
    });
  }

  static async open(options) {
    // 只返回完成存储初始化的实例，避免首个命令与目录创建发生竞争。
    const service = new ChangeFleetService(options);
    await Promise.all([
      service.controlStore.initialize(),
      service.runStore.initialize(),
      service.evidenceStore.initialize(),
      service.harnessSnapshotStore.initialize(),
    ]);
    return service;
  }

  async registerProject({ idempotency_key, project }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("project_id", project.project_id);
    invariant(
      // 项目可只有一个仓库；计划阶段才决定本次 ChangeSet 实际授权的非空子集。
      Array.isArray(project.repositories) && project.repositories.length >= 1,
      "INVALID_PROJECT_REPOSITORIES",
      "A Project requires at least one explicitly registered Repository",
    );
    const repositories = [];
    const repositoryIds = new Set();
    for (const input of project.repositories) {
      normalizeId("repository_id", input.repository_id);
      invariant(
        !repositoryIds.has(input.repository_id),
        "DUPLICATE_REPOSITORY",
        `Duplicate Repository ${input.repository_id}`,
      );
      repositoryIds.add(input.repository_id);
      const inspected = await this.repositoryWorker.inspectRegistration({
        repositoryId: input.repository_id,
        locator: input.locator.path,
        defaultTargetRef: input.default_target_ref ?? null,
      });
      repositories.push({
        ...inspected,
        description: optionalString(input.description),
        workspace_policy_revisions: [],
        current_workspace_policy_revision: null,
        delivery_binding_revisions: [],
        current_delivery_binding_revision: null,
      });
    }
    repositories.sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
    const normalizedProject = {
      project_id: project.project_id,
      description: optionalString(project.description),
      verification_policy: normalizeVerificationPolicy(
        project.verification_policy,
      ),
      repositories,
      registered_at: this.now(),
    };
    const fingerprintInput = {
      project_id: normalizedProject.project_id,
      description: normalizedProject.description,
      repositories: normalizedProject.repositories.map((repository) => ({
        repository_id: repository.repository_id,
        locator: repository.locator,
        description: repository.description,
        default_target_ref: repository.default_target_ref,
      })),
    };
    if (project.verification_policy !== undefined) {
      fingerprintInput.verification_policy = normalizedProject.verification_policy;
    }

    return this.controlStore.transactCatalog((catalog) =>
      applyIdempotentCommand({
        record: catalog,
        idempotencyKey: idempotency_key,
        command: "registerProject",
        input: fingerprintInput,
        perform: () => {
          invariant(
            !catalog.projects[project.project_id],
            "PROJECT_ALREADY_EXISTS",
            `Project ${project.project_id} already exists`,
          );
          const registeredRoots = new Set(
            Object.values(catalog.projects).flatMap((existingProject) =>
              existingProject.repositories.map((repository) =>
                comparablePath(repository.resolved_git_root),
              ),
            ),
          );
          for (const repository of repositories) {
            invariant(
              !registeredRoots.has(comparablePath(repository.resolved_git_root)),
              "AMBIGUOUS_SHARED_REPOSITORY",
              `Repository ${repository.resolved_git_root} is already registered to another Project`,
            );
          }
          catalog.projects[project.project_id] = normalizedProject;
          return structuredClone(normalizedProject);
        },
      }),
    );
  }

  async reviseRepositoryWorkspacePolicy({
    idempotency_key,
    project_id,
    repository_id,
    policy,
    actor = "human",
  }) {
    // 策略修订只改变后续 ChangeSet 的默认授权；既有 ChangeSet 快照不会被反向改写。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("project_id", project_id);
    normalizeId("repository_id", repository_id);
    const commandInput = {
      project_id,
      repository_id,
      policy: structuredClone(policy),
      actor,
    };
    return this.controlStore.transactCatalog((catalog) =>
      applyIdempotentCommand({
        record: catalog,
        idempotencyKey: idempotency_key,
        command: "reviseRepositoryWorkspacePolicy",
        input: commandInput,
        perform: () => {
          const project = requireProject(catalog, project_id);
          const repository = requireRepository(project, repository_id);
          const revision = repository.workspace_policy_revisions.length + 1;
          const normalized = normalizeRepositoryWorkspacePolicy(policy, {
            revision,
            confirmedAt: this.now(),
            actor,
          });
          const current = repository.workspace_policy_revisions.find(
            (candidate) =>
              candidate.revision ===
              repository.current_workspace_policy_revision,
          );
          if (current) {
            current.status = "superseded";
            current.superseded_at = this.now();
          }
          repository.workspace_policy_revisions.push(normalized);
          repository.current_workspace_policy_revision = revision;
          return {
            project_id,
            repository_id,
            workspace_policy_revision: revision,
            policy: structuredClone(normalized),
          };
        },
      }),
    );
  }

  async createChangeSet({
    idempotency_key,
    change_set_id,
    project_id,
    intent,
    planning_repository_ids,
    repository_selections,
    repository_harness_selections,
    actor = "human",
  }) {
    // 创建命令先固定调用者请求，再解析分支；已完成重试绝不能重新观察移动后的 ref。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("project_id", project_id);
    normalizeId("actor", actor);
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, project_id);
    const requestedSelection = normalizeRepositorySelectionRequest(project, {
      planningRepositoryIds: planning_repository_ids,
      repositorySelections: repository_selections,
    });
    const intentForFingerprint = normalizeIntent(intent, {
      revision: 1,
      confirmedAt: "",
    });
    const input = {
      change_set_id,
      project_id,
      intent: intentFingerprint(intentForFingerprint),
      repository_selection: requestedSelection,
      repository_harness_selection_request:
        harnessSelectionRequestFingerprint(
          repository_harness_selections,
        ),
      actor,
    };
    try {
      const existing = await this.controlStore.readChangeSet(change_set_id);
      return readIdempotentResult(
        existing,
        idempotency_key,
        "createChangeSet",
        input,
      );
    } catch (error) {
      if (error.code !== "CHANGE_SET_NOT_FOUND") throw error;
    }
    const requestedHarnessSelection =
      normalizeRepositoryHarnessSelectionRequest(project, {
        repositoryIds: requestedSelection.repository_ids,
        repositoryHarnessSelections: repository_harness_selections,
      });

    const now = this.now();
    const normalizedIntent = normalizeIntent(intent, {
      revision: 1,
      confirmedAt: now,
    });
    const repositorySelection = await this.resolveRepositorySelectionRevision({
      project,
      request: requestedSelection,
      revision: 1,
      confirmedAt: now,
    });
    const repositoryHarnessSelection =
      await this.resolveRepositoryHarnessSelectionRevision({
        project,
        repositorySelection,
        request: requestedHarnessSelection,
        revision: 1,
        confirmedAt: now,
        confirmedBy: actor,
      });
    const result = {
      change_set_id,
      repository_selection_revision: 1,
      repository_harness_selection_revision: 1,
      repositories: structuredClone(repositorySelection.repositories),
      repository_harness: structuredClone(
        repositoryHarnessSelection.repositories,
      ),
    };
    const fingerprint = commandFingerprint("createChangeSet", input);
    const state = {
      schema_version: CONTROL_SCHEMA_VERSION,
      change_set_id,
      project_id,
      verification_policy: structuredClone(project.verification_policy),
      state: "analyzing",
      intents: [normalizedIntent],
      current_intent_revision: 1,
      repository_selection_revisions: [repositorySelection],
      current_repository_selection_revision: 1,
      repository_selection_change_requests: [],
      repository_harness_selection_revisions: [
        repositoryHarnessSelection,
      ],
      current_repository_harness_selection_revision: 1,
      plans: [],
      current_plan_revision: null,
      planning_message_references: [],
      current_approvable_plan_message_id: null,
      legacy_unconfirmed_plans: [],
      work_units: [],
      run_references: [],
      candidate_checkpoints: [],
      verification_admissions: [],
      verification_reviews: [],
      validation_attempts: [],
      candidates: [],
      bundles: [],
      delivery_requests: [],
      decisions: [],
      current_revision_feedback: null,
      blockers: [],
      commands: {
        [idempotency_key]: {
          command: "createChangeSet",
          fingerprint,
          status: "completed",
          result,
          completed_at: now,
        },
      },
      created_at: now,
      updated_at: now,
    };
    try {
      await this.controlStore.createChangeSet(state);
      return structuredClone(result);
    } catch (error) {
      if (error.code !== "CHANGE_SET_ALREADY_EXISTS") throw error;
      const existing = await this.controlStore.readChangeSet(change_set_id);
      return readIdempotentResult(
        existing,
        idempotency_key,
        "createChangeSet",
        input,
      );
    }
  }

  async closeChangeSet(request) {
    // 关闭只写控制事实：不解析基线、不触碰工作区，也不调用 Runtime、验证或交付端口。
    const {
      idempotency_key,
      change_set_id,
      actor,
      reason,
    } = normalizeChangeSetCloseRequest(request);
    const commandInput = { change_set_id, actor, reason };
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "closeChangeSet",
        input: commandInput,
        perform: () => {
          invariant(
            !["done", "abandoned"].includes(state.state),
            "CHANGE_SET_ALREADY_TERMINAL",
            `ChangeSet cannot close from terminal state ${state.state}`,
          );
          invariant(
            !state.run_references.some(
              (reference) => reference.status === "running",
            ) &&
              !Object.values(state.commands ?? {}).some(
                (command) => command.status === "in_progress",
              ),
            "CHANGE_SET_NOT_QUIESCENT",
            "ChangeSet has active lifecycle work",
          );
          invariant(
            (state.delivery_requests ?? []).length === 0,
            "CHANGE_SET_DELIVERY_STARTED",
            "ChangeSet delivery has already begun",
          );
          invariant(
            CLOSABLE_CHANGE_SET_STATES.has(state.state),
            "INVALID_CHANGE_SET_STATE",
            `ChangeSet cannot close from state ${state.state}`,
          );
          const closedAt = this.now();
          const decision = {
            decision_id: this.idFactory("decision"),
            type: "changeset_closure",
            disposition: "abandoned",
            actor,
            reason: structuredClone(reason),
            decided_at: closedAt,
          };
          state.decisions.push(decision);
          state.state = "abandoned";
          state.updated_at = closedAt;
          return {
            change_set_id,
            status: "abandoned",
            decision_id: decision.decision_id,
            closed_at: closedAt,
          };
        },
      }),
    );
  }

  async reviseRepositorySelection({
    idempotency_key,
    change_set_id,
    current_repository_selection_revision,
    planning_repository_ids,
    repository_selections,
    repository_harness_selections,
    actor = "human",
  }) {
    // 修订先校验旧 revision，再解析新分支，避免旧页面覆盖刚刚确认的新选择。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const requestedSelection = normalizeRepositorySelectionRequest(project, {
      planningRepositoryIds: planning_repository_ids,
      repositorySelections: repository_selections,
    });
    const commandInput = {
      change_set_id,
      current_repository_selection_revision,
      repository_selection: requestedSelection,
      repository_harness_selection_request:
        harnessSelectionRequestFingerprint(
          repository_harness_selections,
        ),
      actor,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "reviseRepositorySelection",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    assertChangeSetMutable(initialState);
    const requestedHarnessSelection =
      normalizeRepositoryHarnessSelectionRequest(project, {
        repositoryIds: requestedSelection.repository_ids,
        repositoryHarnessSelections: repository_harness_selections,
      });
    await this.recoverInterruptedPlanningRuns(change_set_id, project);
    initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);
    assertRepositorySelectionRevisionAllowed(
      initialState,
      current_repository_selection_revision,
    );
    const nextRevision = initialState.repository_selection_revisions.length + 1;
    const nextSelection = await this.resolveRepositorySelectionRevision({
      project,
      request: requestedSelection,
      revision: nextRevision,
      confirmedAt: this.now(),
    });
    const nextHarnessRevision =
      initialState.repository_harness_selection_revisions.length + 1;
    const nextHarnessSelection =
      await this.resolveRepositoryHarnessSelectionRevision({
        project,
        repositorySelection: nextSelection,
        request: requestedHarnessSelection,
        revision: nextHarnessRevision,
        confirmedAt: this.now(),
        confirmedBy: actor,
      });

    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "reviseRepositorySelection",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          assertRepositorySelectionRevisionAllowed(
            state,
            current_repository_selection_revision,
          );
          const priorSelection = currentRepositorySelection(state);
          priorSelection.status = "superseded";
          priorSelection.superseded_at = this.now();
          const priorHarnessSelection =
            currentRepositoryHarnessSelection(state);
          priorHarnessSelection.status = "superseded";
          priorHarnessSelection.superseded_at = this.now();

          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of unitsForCurrentPlan(state)) {
            if (!["candidate_ready", "failed", "blocked"].includes(workUnit.state)) {
              workUnit.state = "superseded";
            }
          }

          state.repository_selection_revisions.push(nextSelection);
          state.current_repository_selection_revision = nextRevision;
          state.repository_harness_selection_revisions.push(
            nextHarnessSelection,
          );
          state.current_repository_harness_selection_revision =
            nextHarnessRevision;
          state.current_plan_revision = null;
          state.current_approvable_plan_message_id = null;
          state.current_revision_feedback = null;
          for (const request of state.repository_selection_change_requests) {
            if (request.status === "pending") {
              request.status = "resolved_by_revision";
              request.resolved_by_revision = nextRevision;
              request.resolved_at = this.now();
            }
          }
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "repository_selection_revision",
            from_revision: priorSelection.revision,
            to_revision: nextRevision,
            repository_harness_selection_revision: nextHarnessRevision,
            actor,
            decided_at: this.now(),
          });
          state.state = "analyzing";
          state.updated_at = this.now();
          return {
            change_set_id,
            repository_selection_revision: nextRevision,
            repository_harness_selection_revision: nextHarnessRevision,
            repositories: structuredClone(nextSelection.repositories),
            repository_harness: structuredClone(
              nextHarnessSelection.repositories,
            ),
          };
        },
      }),
    );
  }

  async reviseRepositoryHarnessSelection({
    idempotency_key,
    change_set_id,
    current_repository_harness_selection_revision,
    repository_harness_selections,
    actor = "human",
  }) {
    // Harness 修订沿用同一 ChangeSet，但必须废弃当前计划并生成新的上下文身份。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const repositorySelection = currentRepositorySelection(initialState);
    const commandInput = {
      change_set_id,
      current_repository_harness_selection_revision,
      repository_harness_selection_request:
        harnessSelectionRequestFingerprint(
          repository_harness_selections,
        ),
      actor,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "reviseRepositoryHarnessSelection",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    assertChangeSetMutable(initialState);
    const request = normalizeRepositoryHarnessSelectionRequest(project, {
      repositoryIds: repositorySelection.repositories.map(
        (repository) => repository.repository_id,
      ),
      repositoryHarnessSelections: repository_harness_selections,
    });
    await this.recoverInterruptedPlanningRuns(change_set_id, project);
    initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);
    assertRepositoryHarnessSelectionRevisionAllowed(
      initialState,
      current_repository_harness_selection_revision,
    );
    const revision =
      initialState.repository_harness_selection_revisions.length + 1;
    const nextSelection =
      await this.resolveRepositoryHarnessSelectionRevision({
        project,
        repositorySelection: currentRepositorySelection(initialState),
        request,
        revision,
        confirmedAt: this.now(),
        confirmedBy: actor,
      });

    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "reviseRepositoryHarnessSelection",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          assertRepositoryHarnessSelectionRevisionAllowed(
            state,
            current_repository_harness_selection_revision,
          );
          const prior = currentRepositoryHarnessSelection(state);
          prior.status = "superseded";
          prior.superseded_at = this.now();
          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of unitsForCurrentPlan(state)) {
            if (
              !["candidate_ready", "failed", "blocked"].includes(
                workUnit.state,
              )
            ) {
              workUnit.state = "superseded";
            }
          }
          state.repository_harness_selection_revisions.push(nextSelection);
          state.current_repository_harness_selection_revision = revision;
          state.current_plan_revision = null;
          state.current_approvable_plan_message_id = null;
          state.current_revision_feedback = null;
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "repository_harness_selection_revision",
            from_revision: prior.revision,
            to_revision: revision,
            actor,
            decided_at: this.now(),
          });
          state.state = "analyzing";
          state.updated_at = this.now();
          return {
            change_set_id,
            repository_harness_selection_revision: revision,
            repositories: structuredClone(nextSelection.repositories),
          };
        },
      }),
    );
  }

  async resolveRepositorySelectionRevision({
    project,
    request,
    revision,
    confirmedAt,
  }) {
    // 严格按规范化后的仓库顺序解析，使持久化和幂等结果具有稳定次序。
    const repositoriesById = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const repositories = [];
    for (const requested of request.repositories) {
      const resolved = await this.repositoryWorker.resolveRepositorySelection(
        repositoriesById.get(requested.repository_id),
        {
          branchRef: requested.branch_ref,
          targetRef: requested.target_ref,
        },
      );
      repositories.push({
        ...resolved,
        resolved_at: this.now(),
      });
    }
    return {
      revision,
      status: "current",
      confirmed_at: confirmedAt,
      repositories,
    };
  }

  async resolveRepositoryHarnessSelectionRevision({
    project,
    repositorySelection,
    request,
    revision,
    confirmedAt,
    confirmedBy,
  }) {
    // 先持久化内容寻址快照，再把其不可变引用与 Git base 一起写入 ChangeSet。
    const repositoriesById = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const basesById = new Map(
      repositorySelection.repositories.map((selection) => [
        selection.repository_id,
        selection,
      ]),
    );
    const repositories = [];
    for (const requested of request.repositories) {
      const repository = repositoriesById.get(requested.repository_id);
      const base = basesById.get(requested.repository_id);
      invariant(
        repository && base,
        "REPOSITORY_HARNESS_SELECTION_MISMATCH",
        `Harness selection has no matching Repository base: ${requested.repository_id}`,
      );
      if (requested.mode === HARNESS_SELECTION_MODES.EXACT_BASE_ONLY) {
        repositories.push(
          createExactBaseHarnessSelection({
            repositoryId: requested.repository_id,
            baseSha: base.resolved_base_sha,
          }),
        );
        continue;
      }
      const policy = repository.workspace_policy_revisions.find(
        (candidate) =>
          candidate.revision === requested.workspace_policy_revision,
      );
      invariant(
        policy,
        "REPOSITORY_HARNESS_POLICY_NOT_FOUND",
        `Repository ${requested.repository_id} has no Harness policy revision ${requested.workspace_policy_revision}`,
      );
      const overlay = await this.repositoryWorker.resolveHarnessOverlay({
        repository,
        baseSha: base.resolved_base_sha,
        policy,
      });
      const snapshotReference = await this.harnessSnapshotStore.record({
        repositoryId: repository.repository_id,
        baseSha: base.resolved_base_sha,
        providerFamily: requested.provider_family,
        policyRevision: policy.revision,
        selectorDigest: overlay.selector_digest,
        files: overlay.files,
        createdAt: this.now(),
      });
      repositories.push(
        createOverlayHarnessSelection({
          repositoryId: repository.repository_id,
          baseSha: base.resolved_base_sha,
          policy,
          snapshotReference,
          selectorDigest: overlay.selector_digest,
          files: overlay.files,
          skippedResources: overlay.skipped_resources,
        }),
      );
    }
    return {
      revision,
      status: "current",
      confirmed_by: confirmedBy,
      confirmed_at: confirmedAt,
      repositories,
    };
  }

  async planChangeSet({
    idempotency_key,
    change_set_id,
    agent_profile = null,
    message = null,
  }) {
    normalizeId("idempotency_key", idempotency_key);
    const userMessage =
      message === null
        ? null
        : normalizePlanningMessageText(message, "planning.message");
    const agentProfile = normalizeAgentProfile(
      agent_profile ?? this.agentProfile,
    );
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const commandInput = {
      change_set_id,
      agent_profile: agentProfile,
      message: userMessage,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "planChangeSet",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    assertChangeSetMutable(initialState);
    await this.recoverInterruptedPlanningRuns(change_set_id, project);
    initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);

    const repositorySelection = currentRepositorySelection(initialState);
    const repositoryHarnessSelection =
      currentRepositoryHarnessSelection(initialState);
    const projectRepositories = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const selectedRepositories = repositorySelection.repositories.map(
      (selection) => projectRepositories.get(selection.repository_id),
    );
    const planningProject = {
      ...project,
      repositories: selectedRepositories,
    };
    const planningAttempt =
      initialState.run_references.filter(
        (reference) => reference.operation === "planning",
      ).length + 1;
    const runId = this.idFactory("run");
    const bases = {};
    const repositoriesForContext = [];
    const harnessObservations = [];
    const planningWorkspaces = [];
    // 规划只消费创建时已冻结的选择，不能再次读取分支 tip 或登记默认值。
    try {
      for (const selection of repositorySelection.repositories) {
        const repository = projectRepositories.get(selection.repository_id);
        const harnessSelection =
          repositoryHarnessSelection.repositories.find(
            (candidate) =>
              candidate.repository_id === selection.repository_id,
          );
        invariant(
          harnessSelection?.resolved_base_sha ===
            selection.resolved_base_sha,
          "REPOSITORY_HARNESS_SELECTION_MISMATCH",
          `Harness selection does not match Repository ${selection.repository_id}`,
        );
        const base = {
          repository_id: selection.repository_id,
          target_ref: selection.target_ref,
          base_sha: selection.resolved_base_sha,
        };
        let workspace =
          await this.repositoryWorker.preparePlanningWorkspace({
            repository,
            baseSha: base.base_sha,
            workspaceId: `planning-${runId}`,
          });
        planningWorkspaces.push(workspace);
        let overlaySnapshot = null;
        if (
          harnessSelection.mode ===
          HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
        ) {
          overlaySnapshot = await this.harnessSnapshotStore.read(
            harnessSelection.artifact_reference,
          );
          workspace = {
            ...workspace,
            harness_overlay: {
              ...harnessSelection.artifact_reference,
              paths: [...harnessSelection.resolved_relative_paths],
            },
          };
          planningWorkspaces[planningWorkspaces.length - 1] = workspace;
          workspace =
            await this.repositoryWorker.materializeHarnessOverlay({
              repository,
              workspace,
              snapshot: overlaySnapshot,
            });
          planningWorkspaces[planningWorkspaces.length - 1] = workspace;
        }
        bases[selection.repository_id] = base;
        const exactBaseHarness =
          await this.repositoryWorker.discoverHarness(
            repository,
            base.base_sha,
          );
        const frozenOverlayHarness =
          overlayHarnessResources(overlaySnapshot);
        const availableHarness = [
          ...exactBaseHarness,
          ...frozenOverlayHarness,
        ];
        harnessObservations.push(
          repositoryHarnessObservation({
            repositoryId: repository.repository_id,
            exactBaseResources: exactBaseHarness,
            overlayResources: frozenOverlayHarness,
          }),
        );
        repositoriesForContext.push({
          repository_id: repository.repository_id,
          description: repository.description,
          branch_ref: selection.branch_ref,
          target_ref: base.target_ref,
          base_sha: base.base_sha,
          root_path: workspace.workspace_path,
          harness_selection: harnessSelectionForContext(harnessSelection),
          ...harnessResourcesForContext(availableHarness),
        });
      }
    } catch (error) {
      // 部分创建失败时，只清理已经验证归属的规划 worktree。
      await this.cleanupPlanningWorkspaces({
        planningWorkspaces,
        projectRepositories,
      }).catch(() => {});
      throw error;
    }

    const controlContract = createControlContract({
      operation: "planning",
      changeSetId: change_set_id,
      planRevision: initialState.current_plan_revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision:
        repositoryHarnessSelection.revision,
      authorizedRepositories: repositorySelection.repositories.map(
        (selection) => selection.repository_id,
      ),
      allowedOutcomes: [
        "conversation_message",
        "repository_selection_change_request",
        "scope_expansion",
        "decision_request",
        "blocked",
      ],
      humanGates: ["multi_repository_plan_confirmation"],
    });
    const currentMessageReference =
      initialState.planning_message_references.find(
        (reference) =>
          reference.message_id ===
          initialState.current_approvable_plan_message_id,
      ) ?? null;
    const currentApprovableMessage = currentMessageReference
      ? await this.runStore.readJsonArtifact(
          currentMessageReference.artifact_reference,
        )
      : null;
    const contextProjection = createContextProjection({
      operation: "planning",
      changeSet: initialState,
      plan: currentPlan(initialState),
      repositorySelection,
      repositoryHarnessSelection,
      repositories: repositoriesForContext,
      capability: {
        mode: "read_only",
        paths: planningWorkspaces.map(
          (workspace) => workspace.workspace_path,
        ),
      },
      requiredEvidence: ["change_plan", "risks", "unverified_boundaries"],
      historyReferences: initialState.plans.slice(-16).map((plan) => ({
        kind: "plan_revision",
        revision: plan.revision,
        status: plan.status,
      })),
      planningConversation: {
        user_message: userMessage,
        current_approvable_message: currentApprovableMessage,
      },
      verificationPolicy: initialState.verification_policy,
    });
    const invocation = {
      operation: "planning",
      agent_profile: agentProfile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace: null,
      signal: null,
    };
    const contextEvidence = assessInitialContext({
      controlContract,
      contextProjection,
      agentProfile,
      runtimeMeasurement: await measureInitialContext(this.runtime, invocation),
    });
    try {
      await this.runStore.create({
        schema_version: 1,
        run_id: runId,
        change_set_id,
        work_unit_id: null,
        operation: "planning",
        attempt: planningAttempt,
        status: "running",
        agent_profile: agentProfile,
        repository_harness_selection: {
          revision: repositoryHarnessSelection.revision,
          repositories: repositoryHarnessSelection.repositories.map(
            harnessSelectionForContext,
          ),
        },
        repository_harness_observation: {
          repositories: harnessObservations,
        },
        context_evidence: contextEvidence,
        context_projection_identity: {
          schema_version: contextProjection.schema_version,
          digest: sha256(contextProjection),
        },
        planning_workspaces: planningWorkspaces,
        runtime_evidence: null,
        created_at: this.now(),
        completed_at: null,
        outcome: null,
      });
      if (userMessage !== null) {
        await this.runStore.appendEvent(runId, {
          event_id: this.idFactory("event"),
          type: "planning.input",
          at: this.now(),
          payload: { role: "user", text: userMessage },
        });
      }
      await this.controlStore.transactChangeSet(change_set_id, (state) => {
        assertChangeSetMutable(state);
        invariant(
          state.current_repository_selection_revision ===
            repositorySelection.revision,
          "STALE_REPOSITORY_SELECTION_REVISION",
          "Repository selection changed before planning dispatch",
        );
        invariant(
          state.current_repository_harness_selection_revision ===
            repositoryHarnessSelection.revision,
          "STALE_REPOSITORY_HARNESS_SELECTION_REVISION",
          "Repository Harness selection changed before planning dispatch",
        );
        state.run_references.push({
          run_id: runId,
          operation: "planning",
          plan_revision: state.current_plan_revision,
          repository_harness_selection_revision:
            repositoryHarnessSelection.revision,
          attempt: planningAttempt,
          status: "running",
        });
        state.updated_at = this.now();
      });
    } catch (error) {
      // 关闭若先赢得状态事务，规划不得调用 Runtime；只回收本次尚未授权的隔离工作区。
      await this.cleanupPlanningWorkspaces({
        planningWorkspaces,
        projectRepositories,
      }).catch(() => {});
      throw error;
    }

    let outcome;
    let providerEvidence = null;
    let repositorySelectionChangeRequest = null;
    let planningMessage = null;
    let planningMessageArtifact = null;
    let runtimeError = null;
    try {
      const result = await invokeRuntime(this.runtime, invocation, {
        onEvent: (event) => this.appendRuntimeEvent(runId, event),
      });
      outcome = result.outcome;
      providerEvidence = result.provider_evidence;
      invariant(
        ["conversation_message", "repository_selection_change_request"].includes(
          outcome.type,
        ),
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Planning returned unsupported outcome ${outcome.type}`,
      );
      if (outcome.type === "repository_selection_change_request") {
        repositorySelectionChangeRequest =
          normalizeRepositorySelectionChangeRequest(outcome, project);
      } else {
        // 规划输出先成为对话消息；只有其中的结构化内容在精确批准后才成为 Plan revision。
        const text = normalizePlanningMessageText(
          outcome.message.text,
          "planning.outcome.message.text",
        );
        const planContent =
          outcome.message.plan === null
            ? null
            : normalizePlanContent(outcome.message.plan, {
                project: planningProject,
                bases,
                intentRevision: initialState.current_intent_revision,
                repositorySelectionRevision: repositorySelection.revision,
                repositoryHarnessSelectionRevision:
                  repositoryHarnessSelection.revision,
                revisionFeedback: initialState.current_revision_feedback,
              });
        const contentDigest = sha256({ text, plan_content: planContent });
        planningMessage = {
          schema_version: 1,
          message_id: this.idFactory("planning-message"),
          role: "assistant",
          text,
          plan_content: planContent,
          content_digest: contentDigest,
          planning_run_id: runId,
          created_at: this.now(),
        };
        planningMessageArtifact = await this.runStore.writeJsonArtifact(
          runId,
          "planning-message",
          planningMessage,
        );
      }
    } catch (error) {
      runtimeError = error;
      // Provider 已完成而领域规范化失败时，保留已观测证据；仅在错误携带更新证据时覆盖。
      providerEvidence = error.runtime_evidence ?? providerEvidence;
    }
    // 该错误模拟进程已直接消失；保留 running Run 和 worktree 供下一控制器执行确定性恢复。
    if (runtimeError?.code === "CONTROLLER_INTERRUPTED") {
      throw runtimeError;
    }
    try {
      await this.cleanupPlanningWorkspaces({
        planningWorkspaces,
        projectRepositories,
      });
    } catch (error) {
      runtimeError ??= error;
    }
    if (runtimeError) {
      await this.recordRuntimeEvidence({
        runId,
        invocation,
        providerEvidence,
        terminal: {
          status:
            runtimeError.code === "RUNTIME_CANCELLED"
              ? "cancelled"
              : "failed",
          outcome_type: "failed",
          error_code: runtimeError.code ?? "UNEXPECTED_ERROR",
          completed_at: this.now(),
        },
      });
      await this.failRun(runId, runtimeError);
      await this.markRunReference(change_set_id, runId, "failed");
      throw runtimeError;
    }
    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: "runtime.outcome",
      at: this.now(),
      payload: outcome,
    });
    const runCompletedAt = this.now();
    await this.recordRuntimeEvidence({
      runId,
      invocation,
      providerEvidence,
      terminal: {
        status: "completed",
        outcome_type: outcome.type,
        error_code: null,
        completed_at: runCompletedAt,
      },
    });
    await this.runStore.update(runId, (run) => {
      run.status = "completed";
      run.completed_at = runCompletedAt;
      run.outcome = {
        type: outcome.type,
        planning_message_id: planningMessage?.message_id ?? null,
      };
    });

    return this.controlStore.transactChangeSet(change_set_id, (state) => {
      const result = applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "planChangeSet",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            [
              "analyzing",
              "awaiting_plan_confirmation",
              "replanning",
            ].includes(state.state),
            "INVALID_CHANGE_SET_STATE",
            `Cannot plan ChangeSet in state ${state.state}`,
          );
          invariant(
            state.current_repository_selection_revision ===
              repositorySelection.revision,
            "STALE_REPOSITORY_SELECTION_REVISION",
            "Repository selection changed while planning was running",
          );
          invariant(
            state.current_repository_harness_selection_revision ===
              repositoryHarnessSelection.revision,
            "STALE_REPOSITORY_HARNESS_SELECTION_REVISION",
            "Repository Harness selection changed while planning was running",
          );
          if (repositorySelectionChangeRequest) {
            const request = {
              request_id: this.idFactory("selection-request"),
              run_id: runId,
              status: "pending",
              ...repositorySelectionChangeRequest,
              requested_at: this.now(),
            };
            state.repository_selection_change_requests.push(request);
            const runReference = state.run_references.find(
              (reference) => reference.run_id === runId,
            );
            invariant(
              runReference?.status === "running",
              "RUN_REFERENCE_STATE_MISMATCH",
              `Planning Run ${runId} has no running reference`,
            );
            runReference.status = "completed";
            state.updated_at = this.now();
            return {
              change_set_id,
              status: "repository_selection_change_requested",
              request: structuredClone(request),
            };
          }
          const runReference = state.run_references.find(
            (reference) => reference.run_id === runId,
          );
          invariant(
            runReference?.status === "running",
            "RUN_REFERENCE_STATE_MISMATCH",
            `Planning Run ${runId} has no running reference`,
          );
          runReference.status = "completed";
          const reference = {
            message_id: planningMessage.message_id,
            run_id: runId,
            role: planningMessage.role,
            content_digest: planningMessage.content_digest,
            has_plan: planningMessage.plan_content !== null,
            artifact_reference: structuredClone(planningMessageArtifact),
            created_at: planningMessage.created_at,
          };
          state.planning_message_references.push(reference);
          // 任一新回复都会使旧批准主体失效；只有新回复携带计划时才出现批准按钮。
          state.current_approvable_plan_message_id =
            reference.has_plan ? reference.message_id : null;
          state.state = reference.has_plan
            ? "awaiting_plan_confirmation"
            : state.current_plan_revision === null
              ? "analyzing"
              : "replanning";
          state.updated_at = this.now();
          return {
            change_set_id,
            status: state.state,
            message: structuredClone(planningMessage),
            artifact_reference: structuredClone(planningMessageArtifact),
          };
        },
      });
      return result;
    });
  }

  async confirmPlanMessage({
    idempotency_key,
    change_set_id,
    message_id,
    content_digest,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("message_id", message_id);
    invariant(
      typeof content_digest === "string" && /^[0-9a-f]{64}$/u.test(content_digest),
      "INVALID_PLAN_MESSAGE_DIGEST",
      "Plan confirmation requires one SHA-256 content digest",
    );
    const input = { change_set_id, message_id, content_digest, actor };
    const initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "confirmPlanMessage",
      input,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    const reference = initialState.planning_message_references.find(
      (item) => item.message_id === message_id,
    );
    invariant(
      initialState.current_approvable_plan_message_id === message_id &&
        reference?.content_digest === content_digest &&
        reference.has_plan,
      "STALE_PLAN_MESSAGE_CONFIRMATION",
      "Plan confirmation does not bind the current exact planning message",
    );
    const [planningMessage, planningRun] = await Promise.all([
      this.runStore.readJsonArtifact(reference.artifact_reference),
      this.runStore.read(reference.run_id),
    ]);
    invariant(
      planningMessage.message_id === message_id &&
        planningMessage.content_digest === content_digest &&
        planningMessage.plan_content !== null &&
        sha256({
          text: planningMessage.text,
          plan_content: planningMessage.plan_content,
        }) === content_digest,
      "PLAN_MESSAGE_SUBJECT_MISMATCH",
      "Planning message artifact does not match the approval subject",
    );

    // 确认在一个聚合事务中分配 revision、创建 WorkUnit 并开放执行。
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "confirmPlanMessage",
        input,
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            state.state === "awaiting_plan_confirmation",
            "INVALID_CHANGE_SET_STATE",
            `ChangeSet is not awaiting plan confirmation`,
          );
          const currentReference = state.planning_message_references.find(
            (item) => item.message_id === message_id,
          );
          invariant(
            state.current_approvable_plan_message_id === message_id &&
              currentReference?.content_digest === content_digest,
            "STALE_PLAN_MESSAGE_CONFIRMATION",
            "Plan confirmation subject changed before the transaction committed",
          );
          normalizeRevisionFeedbackAssessments(
            planningMessage.plan_content.revision_feedback_assessments,
            state.current_revision_feedback,
          );
          const planRevision =
            state.plans.reduce(
              (maximum, plan) => Math.max(maximum, plan.revision),
              0,
            ) + 1;
          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          const plan = createConfirmedPlan(planningMessage.plan_content, {
            revision: planRevision,
            confirmedAt: this.now(),
            agentProfile: planningRun.agent_profile,
            planningRunId: planningRun.run_id,
            sourceMessageId: message_id,
            sourceContentDigest: content_digest,
          });
          state.plans.push(plan);
          state.current_plan_revision = planRevision;
          state.work_units.push(
            ...plan.work_units.map((workUnit) => ({
              ...workUnit,
              plan_revision: planRevision,
              state: "pending",
              workspace: null,
              run_references: [],
              candidate_checkpoint_id: null,
              verification_admission_id: null,
              verification_run_references: [],
              verification_review_id: null,
              correction_run_references: [],
              correction_source_review_id: null,
              validation_attempt_ids: [],
              candidate: null,
              last_error: null,
            })),
          );
          state.current_approvable_plan_message_id = null;
          state.current_revision_feedback = null;
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "plan_confirmation",
            plan_revision: planRevision,
            source_message_id: message_id,
            source_content_digest: content_digest,
            actor,
            decided_at: this.now(),
          });
          state.state = "ready";
          state.updated_at = this.now();
          return {
            change_set_id,
            plan_revision: planRevision,
            status: "confirmed",
            plan: structuredClone(plan),
          };
        },
      }),
    );
  }

  async executeChangeSet({
    idempotency_key,
    change_set_id,
    verification_admission_mode = null,
    validation_attempt_budgets = [],
  }) {
    // 单一 scheduler 所有者负责恢复和派发，防止多控制器重复执行 WorkUnit。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    const operatorAdmissionMode = normalizeOperatorAdmissionMode(
      verification_admission_mode,
    );
    const attemptBudgetRequests =
      normalizeValidationAttemptBudgetRequests(validation_attempt_budgets);
    // 缺省请求保持旧命令指纹，升级后重放既有幂等键不会因新增可选字段而冲突。
    const commandInput = { change_set_id };
    if (operatorAdmissionMode !== null) {
      commandInput.verification_admission_mode = operatorAdmissionMode;
    }
    if (attemptBudgetRequests.length > 0) {
      commandInput.validation_attempt_budgets = attemptBudgetRequests;
    }
    const initialState = await this.controlStore.readChangeSet(change_set_id);
    const initialCommand = existingCommand(
      initialState,
      idempotency_key,
      "executeChangeSet",
      commandInput,
    );
    if (initialCommand?.status === "completed") {
      return structuredClone(initialCommand.result);
    }
    assertChangeSetMutable(initialState);
    const schedulerLock = await this.controlStore.acquireSchedulerLock(
      this.instanceId,
    );
    try {
      await this.recoverInterruptedRuns(change_set_id);
      const commandState = await this.controlStore.transactChangeSet(
        change_set_id,
        (state) => {
          const existing = existingCommand(
            state,
            idempotency_key,
            "executeChangeSet",
            commandInput,
          );
          if (existing?.status === "completed") {
            return { completed: true, result: structuredClone(existing.result) };
          }
          assertChangeSetMutable(state);
          if (existing?.status === "failed") {
            throw new ChangeFleetError(
              "COMMAND_PREVIOUSLY_FAILED",
              `Execution command ${idempotency_key} previously failed`,
              existing.error,
            );
          }
          invariant(
            ["ready", "executing", "validating"].includes(state.state) ||
              (state.state === "failed" &&
                (hasResumableValidation(state) ||
                  hasRetryableExecution(state) ||
                  hasResumableCorrection(state))) ||
              (state.state === "blocked" &&
                hasCorrectableVerification(state)),
            "PLAN_CONFIRMATION_REQUIRED",
            `ChangeSet cannot execute from state ${state.state}`,
          );
          if (!existing) {
            state.commands[idempotency_key] = {
              command: "executeChangeSet",
              fingerprint: commandFingerprint(
                "executeChangeSet",
                commandInput,
              ),
              status: "in_progress",
              started_at: this.now(),
            };
          }
          return { completed: false };
        },
      );
      if (commandState.completed) return commandState.result;

      await this.prepareRetryableExecutions(
        change_set_id,
        idempotency_key,
      );

      while (true) {
        const state = await this.controlStore.readChangeSet(change_set_id);
        const plan = currentPlan(state);
        invariant(
          plan?.status === "confirmed",
          "PLAN_CONFIRMATION_REQUIRED",
          "Current plan is not confirmed",
        );
        assertValidationAttemptBudgetRequestsMatchPlan(
          attemptBudgetRequests,
          plan,
        );
        const currentUnits = unitsForCurrentPlan(state);
        const incomplete = currentUnits.filter(
          (unit) => unit.state !== "candidate_ready",
        );
        if (incomplete.length === 0) break;
        const ready = incomplete.find(
          (unit) =>
            [
              "pending",
              "validation_pending",
              "validation_failed",
              "verification_pending",
              "verification_failed",
              "verification_changes_required",
              "correction_pending",
              "correction_failed",
            ].includes(unit.state) &&
            unit.dependencies.every(
              (dependency) =>
                currentUnits.find(
                  (candidate) => candidate.work_unit_id === dependency,
                )?.state === "candidate_ready",
            ),
        );
        invariant(
          ready,
          "WORK_UNIT_DEPENDENCY_BLOCKED",
          "No WorkUnit is ready and the current plan is incomplete",
          {
            units: incomplete.map((unit) => ({
              work_unit_id: unit.work_unit_id,
              state: unit.state,
            })),
          },
        );
        let executionResult = null;
        if (ready.state === "pending") {
          executionResult = await this.executeWorkUnit(
            change_set_id,
            ready.work_unit_id,
            { operatorAdmissionMode, attemptBudgetRequests },
          );
        } else if (
          [
            "verification_changes_required",
            "correction_pending",
            "correction_failed",
          ].includes(ready.state)
        ) {
          // 初审 finding 与恢复中的修正都回到同一 Plan，不经过规划 Runtime。
          executionResult = await this.executeWorkUnit(
            change_set_id,
            ready.work_unit_id,
            {
              operatorAdmissionMode,
              attemptBudgetRequests,
              correctionReviewId:
                ready.correction_source_review_id ??
                ready.verification_review_id,
            },
          );
        } else {
          executionResult = await this.resumeWorkUnitValidation(
            change_set_id,
            ready.work_unit_id,
            { operatorAdmissionMode, attemptBudgetRequests },
          );
        }
        if (executionResult?.status === "plan_invalidation_required") {
          return this.controlStore.transactChangeSet(change_set_id, (state) => {
            const result = {
              change_set_id,
              status: "replanning",
              plan_revision: executionResult.plan_revision,
              run_id: executionResult.run_id,
            };
            completeCommand(state, idempotency_key, result, this.now());
            return structuredClone(result);
          });
        }
      }

      const beforeValidation =
        await this.controlStore.readChangeSet(change_set_id);
      const plan = currentPlan(beforeValidation);
      const project = requireProject(
        await this.controlStore.readCatalog(),
        beforeValidation.project_id,
      );
      const repositories = Object.fromEntries(
        project.repositories.map((repository) => [
          repository.repository_id,
          repository,
        ]),
      );
      const candidates = unitsForCurrentPlan(beforeValidation).map(
        (unit) => unit.candidate,
      );
      await this.controlStore.transactChangeSet(change_set_id, (state) => {
        state.state = "validating";
        state.updated_at = this.now();
      });
      const subject = createValidationSubject(
        beforeValidation,
        plan,
        candidates,
      );
      const combinedEvidence = await this.validateCombinedCandidates({
        changeSetId: change_set_id,
        subject,
        candidates,
        repositories,
        command: plan.combined_check,
        projectPolicy: beforeValidation.verification_policy,
        budgetRequest: selectValidationAttemptBudgetRequest(
          attemptBudgetRequests,
          {
            kind: "combined_validation",
            commandId: plan.combined_check.command_id,
          },
        ),
      });
      const stateForBundle =
        await this.controlStore.readChangeSet(change_set_id);
      const bundle = createCandidateBundle({
        changeSet: stateForBundle,
        plan,
        candidates,
        combinedEvidence,
        createdAt: this.now(),
      });
      await this.controlStore.writeBundle(bundle);
      return this.controlStore.transactChangeSet(change_set_id, (state) => {
        state.bundles.push(bundle);
        // 反馈已由本轮 correction Run 逐项评估；历史仍保留在 review Decision 与 Run evidence。
        state.current_revision_feedback = null;
        resolveValidationBlockers(state, {
          validationSubjectHash: subject.validation_subject_hash,
          resolvedAt: this.now(),
        });
        resolveFailedExecutionCommandBlockers(state, this.now());
        state.state = "candidate_review";
        state.updated_at = this.now();
        completeCommand(state, idempotency_key, {
          change_set_id,
          bundle_revision: bundle.revision,
          bundle_hash: bundle.bundle_hash,
          bundle_id: bundle.bundle_id,
        }, this.now());
        return structuredClone(state.commands[idempotency_key].result);
      });
    } catch (error) {
      if (error.code !== "CONTROLLER_INTERRUPTED") {
        await this.markCommandFailed(
          change_set_id,
          idempotency_key,
          error,
        ).catch(() => {});
      }
      throw error;
    } finally {
      await schedulerLock.release();
    }
  }

  async recoverLegacyCandidate({
    idempotency_key,
    change_set_id,
    plan_revision,
    work_unit_id,
    source_run_id,
    base_sha,
    candidate_sha,
    actor = "human",
  }) {
    // 旧私有 schema 只能在精确人工输入下补建 Checkpoint，不能成为通用 commit 导入。
    for (const [label, value] of Object.entries({
      idempotency_key,
      change_set_id,
      work_unit_id,
      source_run_id,
      actor,
    })) {
      normalizeId(label, value);
    }
    const commandInput = {
      change_set_id,
      plan_revision,
      work_unit_id,
      source_run_id,
      base_sha,
      candidate_sha,
      actor,
    };
    const schedulerLock = await this.controlStore.acquireSchedulerLock(
      this.instanceId,
    );
    try {
      const initialState = await this.controlStore.readChangeSet(change_set_id);
      const existing = existingCommand(
        initialState,
        idempotency_key,
        "recoverLegacyCandidate",
        commandInput,
      );
      if (existing?.status === "completed") {
        return structuredClone(existing.result);
      }
      assertChangeSetMutable(initialState);
      invariant(
        !existing,
        "COMMAND_IN_PROGRESS",
        `Legacy recovery command ${idempotency_key} is not complete`,
      );
      const plan = currentPlan(initialState);
      invariant(
        plan?.status === "confirmed" && plan.revision === plan_revision,
        "STALE_PLAN_REVISION",
        "Legacy recovery must bind the current confirmed plan",
      );
      const workUnit = unitsForCurrentPlan(initialState).find(
        (unit) => unit.work_unit_id === work_unit_id,
      );
      invariant(
        workUnit &&
          workUnit.candidate_checkpoint_id === null &&
          workUnit.candidate === null &&
          workUnit.base_sha === base_sha &&
          workUnit.repository_selection_revision ===
            initialState.current_repository_selection_revision &&
          workUnit.repository_harness_selection_revision ===
            initialState.current_repository_harness_selection_revision &&
          workUnit.workspace,
        "LEGACY_RECOVERY_SUBJECT_MISMATCH",
        "Legacy recovery does not match one pre-checkpoint WorkUnit",
      );
      invariant(
        workUnit.run_references.some(
          (reference) =>
            reference.run_id === source_run_id &&
            reference.status === "completed",
        ),
        "LEGACY_RECOVERY_RUN_MISMATCH",
        "Legacy recovery source Run is not the completed WorkUnit Run",
      );
      const sourceRun = await this.runStore.read(source_run_id);
      invariant(
        sourceRun.change_set_id === change_set_id &&
          sourceRun.work_unit_id === work_unit_id &&
          sourceRun.status === "completed" &&
          sourceRun.outcome?.type === "implementation_completed",
        "LEGACY_RECOVERY_RUN_MISMATCH",
        "Legacy recovery source Run is not an exact completed implementation",
      );
      const catalog = await this.controlStore.readCatalog();
      const project = requireProject(catalog, initialState.project_id);
      const repository = project.repositories.find(
        (item) => item.repository_id === workUnit.repository_id,
      );
      const published = await this.repositoryWorker.recoverPublishedCandidate({
        repository,
        workspace: workUnit.workspace,
        baseSha: base_sha,
        candidateSha: candidate_sha,
      });
      const decisionId = this.idFactory("decision");
      const checkpoint = createCandidateCheckpoint({
        changeSetId: change_set_id,
        intentRevision: plan.intent_revision,
        planRevision: plan.revision,
        repositorySelectionRevision:
          initialState.current_repository_selection_revision,
        repositoryHarnessSelectionRevision:
          initialState.current_repository_harness_selection_revision,
        workUnitId: work_unit_id,
        repositoryId: published.repository_id,
        targetRef: published.target_ref,
        baseSha: published.base_sha,
        candidateSha: published.candidate_sha,
        workspaceId: published.workspace_id,
        workspacePath: published.workspace_path,
        changedPaths: published.changed_paths,
        sourceRunId: source_run_id,
        provenance: "legacy_candidate_recovery",
        recoveryDecisionId: decisionId,
        createdAt: this.now(),
      });

      return this.controlStore.transactChangeSet(change_set_id, (state) =>
        applyIdempotentCommand({
          record: state,
          idempotencyKey: idempotency_key,
          command: "recoverLegacyCandidate",
          input: commandInput,
          perform: () => {
            assertChangeSetMutable(state);
            const currentUnit = unitsForCurrentPlan(state).find(
              (unit) => unit.work_unit_id === work_unit_id,
            );
            invariant(
              state.current_plan_revision === plan_revision &&
                currentUnit?.candidate_checkpoint_id === null &&
                currentUnit.candidate === null &&
                currentUnit.workspace?.workspace_id === published.workspace_id,
              "LEGACY_RECOVERY_SUBJECT_MISMATCH",
              "Legacy recovery subject changed before persistence",
            );
            const decision = {
              decision_id: decisionId,
              type: "legacy_candidate_recovery",
              actor,
              plan_revision,
              work_unit_id,
              source_run_id,
              base_sha,
              candidate_sha,
              checkpoint_id: checkpoint.checkpoint_id,
              decided_at: this.now(),
            };
            // 决策和 Checkpoint 在同一控制事务中落盘，避免出现无人工来源的恢复主体。
            state.decisions.push(decision);
            state.candidate_checkpoints.push(checkpoint);
            currentUnit.candidate_checkpoint_id = checkpoint.checkpoint_id;
            currentUnit.validation_attempt_ids = [];
            currentUnit.state = "validation_pending";
            currentUnit.last_error = null;
            resolveValidationBlockers(state, {
              workUnitId: work_unit_id,
              resolvedAt: this.now(),
              resolvedByDecisionId: decisionId,
            });
            resolveFailedExecutionCommandBlockers(
              state,
              this.now(),
              decisionId,
            );
            state.state = "ready";
            state.updated_at = this.now();
            return {
              change_set_id,
              work_unit_id,
              checkpoint_id: checkpoint.checkpoint_id,
              candidate_sha,
              status: "validation_pending",
            };
          },
        }),
      );
    } finally {
      await schedulerLock.release();
    }
  }

  async recordBundleDecision({
    idempotency_key,
    change_set_id,
    bundle_revision,
    bundle_hash,
    decision,
    feedback = null,
    actor = "human",
  }) {
    // 人工决策同时绑定 revision 与 hash，Candidate 或证据变化后旧批准立即失效。
    const normalizedDecision = normalizeHumanDecision(decision);
    const normalizedFeedback =
      normalizedDecision === "request_revision"
        ? normalizeRevisionFeedback(feedback)
        : null;
    invariant(
      normalizedDecision === "request_revision" || feedback === null,
      "INVALID_REVISION_FEEDBACK",
      "Only request_revision may carry revision feedback",
    );
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "recordBundleDecision",
        input: {
          change_set_id,
          bundle_revision,
          bundle_hash,
          decision: normalizedDecision,
          feedback: normalizedFeedback,
          actor,
        },
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            state.state === "candidate_review",
            "INVALID_CHANGE_SET_STATE",
            "ChangeSet is not awaiting CandidateBundle review",
          );
          const bundle = state.bundles.at(-1);
          invariant(
            bundle?.revision === bundle_revision &&
              bundle.bundle_hash === bundle_hash,
            "STALE_BUNDLE_DECISION",
            "Human decision does not bind to the current exact Bundle",
          );
          const record = {
            decision_id: this.idFactory("decision"),
            type: "bundle_review",
            bundle_revision,
            bundle_hash,
            decision: normalizedDecision,
            feedback: normalizedFeedback,
            actor,
            decided_at: this.now(),
          };
          state.decisions.push(record);
          state.current_revision_feedback =
            normalizedDecision === "request_revision"
              ? {
                  decision_id: record.decision_id,
                  bundle_revision,
                  bundle_hash,
                  ...structuredClone(normalizedFeedback),
                  applies_to_plan_revision: state.current_plan_revision,
                  decided_at: record.decided_at,
                }
              : null;
          if (normalizedDecision === "request_revision") {
            // Bundle 纠正默认沿用已确认 Plan；Candidate 和验证主体会由新的执行尝试重建。
            for (const workUnit of unitsForCurrentPlan(state)) {
              workUnit.state = "pending";
              workUnit.workspace = null;
              workUnit.candidate_checkpoint_id = null;
              workUnit.verification_admission_id = null;
              workUnit.verification_review_id = null;
              workUnit.correction_source_review_id = null;
              workUnit.validation_attempt_ids = [];
              workUnit.candidate = null;
              workUnit.last_error = null;
            }
            state.state = "ready";
          } else {
            state.state =
              normalizedDecision === "accept" ? "delivery_ready" : "done";
          }
          state.updated_at = this.now();
          return structuredClone(record);
        },
      }),
    );
  }

  configureGithubDelivery(request) {
    // GitHub 绑定由独立交付应用服务确认；生命周期服务只保留统一操作入口。
    return this.githubDeliveryService.configureGithubDelivery(request);
  }

  publishDelivery(request) {
    // 发布与 Bundle 接受分离，避免 Agent 或审核动作隐式获得外部写权限。
    return this.githubDeliveryService.publishDelivery(request);
  }

  readDelivery(request) {
    return this.githubDeliveryService.readDelivery(request);
  }

  refreshDelivery(request) {
    return this.githubDeliveryService.refreshDelivery(request);
  }

  readChangeSet(changeSetId) {
    return this.controlStore.readChangeSet(changeSetId);
  }

  async recoverInterruptedPlanningRuns(changeSetId, project) {
    // 新的规划调用先放弃上一控制器遗留的尝试；Provider thread 不会被盲目续接。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const runningReferences = state.run_references.filter(
      (reference) =>
        reference.operation === "planning" &&
        reference.status === "running",
    );
    if (runningReferences.length === 0) return;
    const repositories = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const recovered = [];
    for (const reference of runningReferences) {
      const run = await this.runStore.read(reference.run_id);
      if (run.status !== "running" || run.runtime_evidence) {
        recovered.push({
          run_id: run.run_id,
          status: "blocked",
          error_code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
        });
        continue;
      }
      let cleanupError = null;
      try {
        await this.cleanupPlanningWorkspaces({
          planningWorkspaces: run.planning_workspaces ?? [],
          projectRepositories: repositories,
        });
      } catch (error) {
        cleanupError = error;
      }
      const completedAt = this.now();
      await this.recordRuntimeEvidence({
        runId: run.run_id,
        invocation: null,
        providerEvidence: null,
        terminal: {
          status: "abandoned",
          outcome_type: "controller_restart",
          error_code: cleanupError?.code ?? null,
          completed_at: completedAt,
        },
      });
      await this.runStore.update(run.run_id, (current) => {
        current.status = "abandoned";
        current.completed_at = completedAt;
        current.outcome = { type: "controller_restart" };
      });
      await this.runStore.appendEvent(run.run_id, {
        event_id: this.idFactory("event"),
        type: "run.abandoned",
        at: completedAt,
        payload: {
          reason: "controller_restart",
          cleanup_error: cleanupError?.code ?? null,
        },
      });
      recovered.push({
        run_id: run.run_id,
        status: cleanupError ? "blocked" : "abandoned",
        error_code: cleanupError?.code ?? null,
      });
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const item of recovered) {
        const reference = current.run_references.find(
          (candidate) => candidate.run_id === item.run_id,
        );
        reference.status = item.status;
        if (item.status === "blocked") {
          current.blockers.push({
            code:
              item.error_code ?? "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
            run_id: item.run_id,
          });
        }
      }
      if (recovered.some((item) => item.status === "blocked")) {
        current.state = "decision_required";
      }
      current.updated_at = this.now();
    });
    const blocked = recovered.find((item) => item.status === "blocked");
    invariant(
      !blocked,
      blocked?.error_code ?? "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
      `Planning Run ${blocked?.run_id} could not be recovered safely`,
    );
  }

  async recoverInterruptedRuns(changeSetId) {
    // 明确中断可重试；终态 Run 与 running WorkUnit 冲突时阻塞，不能猜测结果。
    await this.recoverInterruptedCorrectionRuns(changeSetId);
    await this.recoverInterruptedVerificationRuns(changeSetId);
    const state = await this.controlStore.readChangeSet(changeSetId);
    const running = unitsForCurrentPlan(state).filter(
      (unit) => unit.state === "running",
    );
    if (running.length === 0) return;
    const recovery = [];
    for (const workUnit of running) {
      const runReference = workUnit.run_references.at(-1);
      const run = await this.runStore.read(runReference.run_id);
      if (run.status === "running" && !run.runtime_evidence) {
        const completedAt = this.now();
        await this.recordRuntimeEvidence({
          runId: run.run_id,
          invocation: null,
          providerEvidence: null,
          terminal: {
            status: "abandoned",
            outcome_type: "controller_restart",
            error_code: null,
            completed_at: completedAt,
          },
        });
        await this.runStore.update(run.run_id, (current) => {
          current.status = "abandoned";
          current.completed_at = completedAt;
          current.outcome = { type: "controller_restart" };
        });
        await this.runStore.appendEvent(run.run_id, {
          event_id: this.idFactory("event"),
          type: "run.abandoned",
          at: completedAt,
          payload: { reason: "controller_restart" },
        });
        recovery.push({
          work_unit_id: workUnit.work_unit_id,
          action: "retry",
          run_id: run.run_id,
        });
      } else {
        recovery.push({
          work_unit_id: workUnit.work_unit_id,
          action: "block",
          run_id: run.run_id,
        });
      }
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const item of recovery) {
        const workUnit = current.work_units.find(
          (candidate) =>
            candidate.plan_revision === current.current_plan_revision &&
            candidate.work_unit_id === item.work_unit_id,
        );
        if (item.action === "retry") {
          workUnit.state = "pending";
          workUnit.last_error = {
            code: "RUN_ABANDONED_AFTER_RESTART",
            run_id: item.run_id,
          };
          workUnit.run_references.at(-1).status = "abandoned";
        } else {
          workUnit.state = "blocked";
          workUnit.last_error = {
            code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
            run_id: item.run_id,
          };
          current.blockers.push({
            code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
            work_unit_id: item.work_unit_id,
            run_id: item.run_id,
          });
        }
      }
      current.state = recovery.some((item) => item.action === "block")
        ? "decision_required"
        : "executing";
      current.updated_at = this.now();
    });
  }

  async recoverInterruptedCorrectionRuns(changeSetId) {
    // 只放弃没有终态证据的修正；已完成或状态含糊的 Run 必须阻塞，不能重复语义修改。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const correcting = unitsForCurrentPlan(state).filter(
      (unit) => unit.state === "correcting",
    );
    if (correcting.length === 0) return;
    const recovered = [];
    for (const workUnit of correcting) {
      const reference = workUnit.correction_run_references.at(-1);
      const run = reference ? await this.runStore.read(reference.run_id) : null;
      if (run?.status === "running" && !run.runtime_evidence) {
        const completedAt = this.now();
        await this.recordRuntimeEvidence({
          runId: run.run_id,
          invocation: null,
          providerEvidence: null,
          terminal: {
            status: "abandoned",
            outcome_type: "controller_restart",
            error_code: null,
            completed_at: completedAt,
          },
        });
        await this.runStore.update(run.run_id, (current) => {
          current.status = "abandoned";
          current.completed_at = completedAt;
          current.outcome = { type: "controller_restart" };
        });
        await this.runStore.appendEvent(run.run_id, {
          event_id: this.idFactory("event"),
          type: "run.abandoned",
          at: completedAt,
          payload: { reason: "controller_restart" },
        });
        recovered.push({
          work_unit_id: workUnit.work_unit_id,
          run_id: run.run_id,
          status: "abandoned",
        });
      } else {
        recovered.push({
          work_unit_id: workUnit.work_unit_id,
          run_id: reference?.run_id ?? null,
          status: "blocked",
        });
      }
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const item of recovered) {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) => candidate.work_unit_id === item.work_unit_id,
        );
        const unitReference = unit.correction_run_references.find(
          (candidate) => candidate.run_id === item.run_id,
        );
        const aggregateReference = current.run_references.find(
          (candidate) => candidate.run_id === item.run_id,
        );
        if (unitReference) unitReference.status = item.status;
        if (aggregateReference) aggregateReference.status = item.status;
        if (item.status === "abandoned") {
          unit.state = "correction_pending";
          unit.last_error = {
            code: "CORRECTION_RUN_ABANDONED_AFTER_RESTART",
            run_id: item.run_id,
          };
        } else {
          unit.state = "blocked";
          unit.last_error = {
            code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
            run_id: item.run_id,
          };
          current.blockers.push({
            code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
            work_unit_id: item.work_unit_id,
            run_id: item.run_id,
          });
        }
      }
      current.state = recovered.some((item) => item.status === "blocked")
        ? "decision_required"
        : "executing";
      current.updated_at = this.now();
    });
    const blocked = recovered.find((item) => item.status === "blocked");
    invariant(
      !blocked,
      "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
      `Correction Run ${blocked?.run_id} could not be recovered safely`,
    );
  }

  async recoverInterruptedVerificationRuns(changeSetId) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const verifying = unitsForCurrentPlan(state).filter(
      (unit) => unit.state === "verifying",
    );
    if (verifying.length === 0) return;
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const harnessSelection = currentRepositoryHarnessSelection(state);
    const recovered = [];

    for (const workUnit of verifying) {
      const reference = workUnit.verification_run_references.at(-1);
      const run = reference ? await this.runStore.read(reference.run_id) : null;
      if (run?.status === "running" && !run.runtime_evidence) {
        const repository = requireRepository(project, workUnit.repository_id);
        const selectedHarness = harnessSelection.repositories.find(
          (item) => item.repository_id === workUnit.repository_id,
        );
        let overlaySnapshot = null;
        if (
          selectedHarness?.mode ===
          HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
        ) {
          overlaySnapshot = await this.harnessSnapshotStore.read(
            selectedHarness.artifact_reference,
          );
        }
        let cleanupError = null;
        try {
          await this.repositoryWorker.cleanupVerificationWorkspace({
            repository,
            workspace: run.verification_workspace,
            harnessSnapshot: overlaySnapshot,
          });
        } catch (error) {
          cleanupError = error;
        }
        const completedAt = this.now();
        await this.recordRuntimeEvidence({
          runId: run.run_id,
          invocation: null,
          providerEvidence: null,
          terminal: {
            status: "abandoned",
            outcome_type: "controller_restart",
            error_code: cleanupError?.code ?? null,
            completed_at: completedAt,
          },
        });
        await this.runStore.update(run.run_id, (current) => {
          current.status = "abandoned";
          current.completed_at = completedAt;
          current.outcome = { type: "controller_restart" };
        });
        recovered.push({
          work_unit_id: workUnit.work_unit_id,
          run_id: run.run_id,
          status: cleanupError ? "blocked" : "abandoned",
          error_code: cleanupError?.code ?? null,
        });
      } else {
        recovered.push({
          work_unit_id: workUnit.work_unit_id,
          run_id: reference?.run_id ?? null,
          status: "blocked",
          error_code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
        });
      }
    }

    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const item of recovered) {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) => candidate.work_unit_id === item.work_unit_id,
        );
        const unitReference = unit.verification_run_references.find(
          (candidate) => candidate.run_id === item.run_id,
        );
        const aggregateReference = current.run_references.find(
          (candidate) => candidate.run_id === item.run_id,
        );
        if (unitReference) unitReference.status = item.status;
        if (aggregateReference) aggregateReference.status = item.status;
        if (item.status === "abandoned") {
          unit.state = "verification_pending";
          unit.last_error = {
            code: "VERIFICATION_RUN_ABANDONED_AFTER_RESTART",
            run_id: item.run_id,
          };
        } else {
          unit.state = "blocked";
          unit.last_error = {
            code: item.error_code,
            run_id: item.run_id,
          };
          current.blockers.push({
            code: item.error_code,
            work_unit_id: item.work_unit_id,
            run_id: item.run_id,
          });
        }
      }
      current.state = recovered.some((item) => item.status === "blocked")
        ? "decision_required"
        : "validating";
      current.updated_at = this.now();
    });
    const blocked = recovered.find((item) => item.status === "blocked");
    invariant(
      !blocked,
      blocked?.error_code ?? "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
      `Verification Run ${blocked?.run_id} could not be recovered safely`,
    );
  }

  async prepareRetryableExecutions(changeSetId, commandId) {
    // 新 execute 命令是唯一人工触发点；只有无真实 Candidate 的干净 base 工作区才会再次调用 Provider。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const retryable = retryableExecutionUnits(state);
    if (retryable.length === 0) return;
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const planRevision = state.current_plan_revision;
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const repositoryHarnessSelection =
      currentRepositoryHarnessSelection(state);
    invariant(
      plan?.status === "confirmed" && plan.revision === planRevision,
      "STALE_PLAN_REVISION",
      "Provider retry requires the current confirmed plan",
    );

    for (const snapshotUnit of retryable) {
      const repository = requireRepository(
        project,
        snapshotUnit.repository_id,
      );
      const selectedRepository = repositorySelection.repositories.find(
        (candidate) =>
          candidate.repository_id === snapshotUnit.repository_id,
      );
      const selectedHarness =
        repositoryHarnessSelection.repositories.find(
          (candidate) =>
            candidate.repository_id === snapshotUnit.repository_id,
        );
      invariant(
        snapshotUnit.plan_revision === planRevision &&
          snapshotUnit.repository_selection_revision ===
            repositorySelection.revision &&
          snapshotUnit.repository_harness_selection_revision ===
            repositoryHarnessSelection.revision &&
          selectedRepository?.resolved_base_sha === snapshotUnit.base_sha &&
          selectedRepository?.target_ref === snapshotUnit.target_ref &&
          selectedHarness?.resolved_base_sha === snapshotUnit.base_sha,
        "EXECUTION_RETRY_SUBJECT_MISMATCH",
        "Execution retry no longer matches current plan, Repository, and Harness authority",
      );
      await this.repositoryWorker.preflightExecutionRetry({
        repository,
        workspace: snapshotUnit.workspace,
        baseSha: snapshotUnit.base_sha,
        targetRef: snapshotUnit.target_ref,
      });
      if (
        selectedHarness.mode ===
        HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
      ) {
        const overlaySnapshot = await this.harnessSnapshotStore.read(
          selectedHarness.artifact_reference,
        );
        await this.repositoryWorker.verifyHarnessOverlay({
          repository,
          workspace: snapshotUnit.workspace,
          snapshot: overlaySnapshot,
        });
      }
    }

    // 所有主体都先完成只读预检，再用一次控制事务共同切换为 pending，避免多 WorkUnit 半重试。
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      invariant(
        current.current_plan_revision === planRevision &&
          current.current_repository_selection_revision ===
            repositorySelection.revision &&
          current.current_repository_harness_selection_revision ===
            repositoryHarnessSelection.revision,
        "EXECUTION_RETRY_SUBJECT_MISMATCH",
        "Current retry authority changed before dispatch",
      );
      for (const snapshotUnit of retryable) {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) =>
            candidate.work_unit_id === snapshotUnit.work_unit_id,
        );
        const reason = retryableExecutionReason(current, unit);
        invariant(
          reason &&
            unit.plan_revision === snapshotUnit.plan_revision &&
            unit.base_sha === snapshotUnit.base_sha &&
            unit.target_ref === snapshotUnit.target_ref &&
            unit.repository_selection_revision ===
              snapshotUnit.repository_selection_revision &&
            unit.repository_harness_selection_revision ===
              snapshotUnit.repository_harness_selection_revision &&
            unit.workspace?.workspace_id === snapshotUnit.workspace?.workspace_id &&
            unit.workspace?.workspace_path === snapshotUnit.workspace?.workspace_path,
          "EXECUTION_RETRY_SUBJECT_MISMATCH",
          "WorkUnit retry subject changed before dispatch",
        );
        const decision = {
          decision_id: this.idFactory("decision"),
          type: "provider_retry",
          work_unit_id: unit.work_unit_id,
          source_run_id: reason.source_run_id,
          retired_candidate_checkpoint_id: reason.checkpoint_id,
          reason_code: reason.reason_code,
          command_id: commandId,
          actor: "human",
          decided_at: this.now(),
        };
        current.decisions.push(decision);
        for (const blocker of current.blockers) {
          if (blocker.resolved_at !== undefined) continue;
          const failedCommand = blocker.command_id
            ? current.commands[blocker.command_id]
            : null;
          if (
            blocker.work_unit_id === unit.work_unit_id ||
            failedCommand?.command === "executeChangeSet"
          ) {
            blocker.resolved_at = decision.decided_at;
            blocker.resolved_by_decision_id = decision.decision_id;
          }
        }
        unit.state = "pending";
        unit.candidate_checkpoint_id = null;
        unit.last_error = {
          code: "PROVIDER_RETRY_SCHEDULED",
          previous_code: reason.reason_code,
          source_run_id: reason.source_run_id,
          decision_id: decision.decision_id,
        };
      }
      current.state = "executing";
      current.updated_at = this.now();
    });
  }

  async executeWorkUnit(
    changeSetId,
    workUnitId,
    {
      operatorAdmissionMode = null,
      attemptBudgetRequests = [],
      correctionReviewId = null,
    } = {},
  ) {
    // 先创建 Run 再标记 running，崩溃最多留下孤立记录，不留下无来源派发。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const repositoryHarnessSelection =
      currentRepositoryHarnessSelection(state);
    const workUnit = unitsForCurrentPlan(state).find(
      (candidate) => candidate.work_unit_id === workUnitId,
    );
    const correctionReview =
      correctionReviewId === null
        ? null
        : state.verification_reviews.find(
            (review) => review.review_id === correctionReviewId,
          );
    const isCorrection = correctionReview !== null;
    const correctionCheckpoint = isCorrection
      ? state.candidate_checkpoints.find(
          (checkpoint) =>
            checkpoint.checkpoint_id === workUnit?.candidate_checkpoint_id,
        )
      : null;
    // 修正只能绑定当前 checkpoint 的一次 initial changes_required，focused review 不得递归派发。
    invariant(
      workUnit &&
        (isCorrection
          ? [
              "verification_changes_required",
              "correction_pending",
              "correction_failed",
            ].includes(workUnit.state) &&
            correctionReview.verdict === "changes_required" &&
            (correctionReview.review_scope ?? "initial") === "initial" &&
            correctionReview.checkpoint_id ===
              workUnit.candidate_checkpoint_id &&
            correctionCheckpoint &&
            workUnit.candidate === null &&
            (workUnit.correction_source_review_id === null ||
              workUnit.correction_source_review_id ===
                correctionReview.review_id) &&
            !(workUnit.correction_run_references ?? []).some(
              (reference) =>
                reference.status === "completed" &&
                reference.outcome_type === "implementation_completed",
            )
          : workUnit.state === "pending"),
      "WORK_UNIT_NOT_READY",
      `WorkUnit ${workUnitId} is not ready for ${isCorrection ? "correction" : "execution"}`,
    );
    const repository = project.repositories.find(
      (candidate) => candidate.repository_id === workUnit.repository_id,
    );
    const selectedRepository = repositorySelection.repositories.find(
      (candidate) => candidate.repository_id === workUnit.repository_id,
    );
    const selectedHarness =
      repositoryHarnessSelection.repositories.find(
        (candidate) =>
          candidate.repository_id === workUnit.repository_id,
      );
    invariant(
      selectedHarness?.resolved_base_sha === workUnit.base_sha &&
        workUnit.repository_harness_selection_revision ===
          repositoryHarnessSelection.revision,
      "REPOSITORY_HARNESS_SELECTION_MISMATCH",
      `WorkUnit ${workUnitId} does not match the current Harness selection`,
    );
    const attempt = isCorrection
      ? (workUnit.correction_run_references ?? []).length + 1
      : workUnit.run_references.length + 1;
    const workspaceId = isCorrection
      ? workUnit.workspace.workspace_id
      : `${changeSetId}.${plan.revision}.${workUnitId}.${attempt}`;
    let workspace;
    if (isCorrection) {
      // Correction 只复用当前 Checkpoint 的受控执行工作区；不复制验证 worktree，也不 reset 部分修改。
      await this.repositoryWorker.preflightCandidate({
        repository,
        candidate: {
          ...correctionCheckpoint,
          workspace_id: workUnit.workspace.workspace_id,
          workspace_path: workUnit.workspace.workspace_path,
        },
      });
      workspace = structuredClone(workUnit.workspace);
    } else {
      workspace = await this.repositoryWorker.prepareWorkspace({
        repository,
        targetRef: workUnit.target_ref,
        baseSha: workUnit.base_sha,
        workspaceId,
      });
    }
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
        workspace,
        snapshot: overlaySnapshot,
      });
    }
    const harnessCommit = isCorrection
      ? correctionCheckpoint.candidate_sha
      : workUnit.base_sha;
    const exactBaseHarness = await this.repositoryWorker.discoverHarness(
      repository,
      harnessCommit,
    );
    const frozenOverlayHarness = overlayHarnessResources(overlaySnapshot);
    const availableHarness = [
      ...exactBaseHarness,
      ...frozenOverlayHarness,
    ];
    const harnessObservation = repositoryHarnessObservation({
      repositoryId: repository.repository_id,
      exactBaseResources: exactBaseHarness,
      overlayResources: frozenOverlayHarness,
    });
    const runId = this.idFactory("run");
    const run = {
      schema_version: 1,
      run_id: runId,
      change_set_id: changeSetId,
      work_unit_id: workUnitId,
      operation: isCorrection ? "correction" : "execution",
      attempt,
      status: "running",
      agent_profile: plan.agent_profile,
      repository_harness_selection: {
        revision: repositoryHarnessSelection.revision,
        repositories: [
          harnessSelectionForContext(selectedHarness),
        ],
      },
      repository_harness_observation: {
        repositories: [harnessObservation],
      },
      context_evidence: null,
      context_projection_identity: null,
      runtime_evidence: null,
      created_at: this.now(),
      completed_at: null,
      outcome: null,
    };
    await this.runStore.create(run);
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const currentUnit = unitsForCurrentPlan(current).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      invariant(
        isCorrection
          ? [
              "verification_changes_required",
              "correction_pending",
              "correction_failed",
            ].includes(currentUnit.state) &&
              currentUnit.candidate_checkpoint_id ===
                correctionCheckpoint.checkpoint_id &&
              (currentUnit.correction_source_review_id === null ||
                currentUnit.correction_source_review_id ===
                  correctionReview.review_id)
          : currentUnit.state === "pending",
        "DUPLICATE_DISPATCH",
        `WorkUnit ${workUnitId} already left its dispatchable state`,
      );
      currentUnit.state = isCorrection ? "correcting" : "running";
      currentUnit.workspace = workspace;
      if (isCorrection) {
        currentUnit.correction_source_review_id = correctionReview.review_id;
        currentUnit.correction_run_references.push({
          run_id: runId,
          attempt,
          source_review_id: correctionReview.review_id,
          status: "running",
        });
      } else {
        currentUnit.run_references.push({
          run_id: runId,
          attempt,
          status: "running",
        });
      }
      current.run_references.push({
        run_id: runId,
        operation: isCorrection ? "correction" : "execution",
        plan_revision: plan.revision,
        work_unit_id: workUnitId,
        ...(isCorrection
          ? { source_review_id: correctionReview.review_id }
          : {}),
        status: "running",
      });
      if (isCorrection) {
        resolveValidationBlockers(current, {
          workUnitId,
          resolvedAt: this.now(),
        });
      }
      current.state = "executing";
      current.updated_at = this.now();
    });

    const currentState = await this.controlStore.readChangeSet(changeSetId);
    const currentUnit = unitsForCurrentPlan(currentState).find(
      (candidate) => candidate.work_unit_id === workUnitId,
    );
    const controlContract = createControlContract({
      operation: isCorrection ? "correction" : "execution",
      changeSetId,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision:
        repositoryHarnessSelection.revision,
      workUnitId,
      authorizedRepositories: [workUnit.repository_id],
      allowedOutcomes: [
        "implementation_completed",
        "implementation_blocked",
        "plan_invalidation_required",
      ],
      humanGates: [],
    });
    const contextProjection = createContextProjection({
      operation: isCorrection ? "correction" : "execution",
      changeSet: currentState,
      plan,
      repositorySelection,
      repositoryHarnessSelection,
      workUnit: currentUnit,
      repositories: [
        {
          repository_id: repository.repository_id,
          branch_ref: selectedRepository.branch_ref,
          target_ref: workUnit.target_ref,
          base_sha: workUnit.base_sha,
          ...(isCorrection
            ? { candidate_sha: correctionCheckpoint.candidate_sha }
            : {}),
          root_path: workspace.workspace_path,
          harness_selection: harnessSelectionForContext(selectedHarness),
          ...harnessResourcesForContext(availableHarness),
        },
      ],
      capability: {
        mode: "read_write",
        paths: [workspace.workspace_path],
      },
      requiredEvidence: isCorrection
        ? [
            "structured_outcome",
            "finding_assessments",
            "corrected_candidate",
            "repository_check",
          ]
        : ["structured_outcome", "candidate", "repository_check"],
      correction: isCorrection
        ? {
            // 只投影当前 claim、通过的证据索引和精确旧主体，不回放完整审核历史。
            source_review: {
              review_id: correctionReview.review_id,
              checkpoint_id: correctionReview.checkpoint_id,
              summary: correctionReview.summary,
              findings: structuredClone(correctionReview.findings),
              check_status: correctionReview.check_status,
              validation_attempts: projectCorrectionValidationAttempts(
                currentState,
                correctionReview,
                correctionCheckpoint,
              ),
            },
            candidate: {
              repository_id: correctionCheckpoint.repository_id,
              target_ref: correctionCheckpoint.target_ref,
              base_sha: correctionCheckpoint.base_sha,
              candidate_sha: correctionCheckpoint.candidate_sha,
              changed_paths: [...correctionCheckpoint.changed_paths],
            },
          }
        : null,
      historyReferences: isCorrection
        ? []
        : workUnit.run_references.slice(-16).map((reference) => ({
            kind: "run",
            run_id: reference.run_id,
            status: reference.status,
          })),
    });
    const invocation = {
      operation: isCorrection ? "correction" : "execution",
      agent_profile: plan.agent_profile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace,
      signal: null,
    };
    const contextEvidence = assessInitialContext({
      controlContract,
      contextProjection,
      agentProfile: plan.agent_profile,
      runtimeMeasurement: await measureInitialContext(this.runtime, invocation),
    });
    await this.runStore.update(runId, (current) => {
      current.context_evidence = contextEvidence;
      current.context_projection_identity = {
        schema_version: contextProjection.schema_version,
        digest: sha256(contextProjection),
      };
    });

    let outcome;
    let providerEvidence = null;
    try {
      const result = await invokeRuntime(this.runtime, invocation, {
        onEvent: (event) => this.appendRuntimeEvent(runId, event),
      });
      outcome = result.outcome;
      providerEvidence = result.provider_evidence;
      invariant(
        [
          "implementation_completed",
          "implementation_blocked",
          "plan_invalidation_required",
        ].includes(outcome.type),
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Execution returned unsupported outcome ${outcome.type}`,
      );
      outcome = {
        ...outcome,
        revision_feedback_assessments:
          // Core 只验证逐项覆盖和结构，不替 Agent 判断 finding 是否正确。
          normalizeRevisionFeedbackAssessments(
            outcome.revision_feedback_assessments,
            isCorrection
              ? verificationReviewAsRevisionFeedback(correctionReview)
              : currentState.current_revision_feedback
                    ?.applies_to_plan_revision === plan.revision
                ? currentState.current_revision_feedback
                : null,
          ),
      };
      await this.runStore.appendEvent(runId, {
        event_id: this.idFactory("event"),
        type: "runtime.outcome",
        at: this.now(),
        payload: outcome,
      });
      const runCompletedAt = this.now();
      await this.recordRuntimeEvidence({
        runId,
        invocation,
        providerEvidence,
        terminal: {
          status: "completed",
          outcome_type: outcome.type,
          error_code: null,
          completed_at: runCompletedAt,
        },
      });
      await this.runStore.update(runId, (current) => {
        current.status = "completed";
        current.completed_at = runCompletedAt;
        current.outcome = {
          type: outcome.type,
          // 只保留有界路径声明用于和最终 Git 主体做确定性比对，不保存 Agent 推理。
          reported_changed_paths: [...outcome.changed_paths].sort(),
          revision_feedback_assessments: structuredClone(
            outcome.revision_feedback_assessments,
          ),
        };
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) => candidate.work_unit_id === workUnitId,
        );
        const unitReference = isCorrection
          ? unit.correction_run_references.at(-1)
          : unit.run_references.at(-1);
        unitReference.status = "completed";
        unitReference.outcome_type = outcome.type;
        const reference = current.run_references.find(
          (candidate) => candidate.run_id === runId,
        );
        reference.status = "completed";
        current.updated_at = this.now();
      });
    } catch (error) {
      if (error.code === "CONTROLLER_INTERRUPTED") throw error;
      await this.recordRuntimeEvidence({
        runId,
        invocation,
        providerEvidence: error.runtime_evidence ?? providerEvidence,
        terminal: {
          status:
            error.code === "RUNTIME_CANCELLED" ? "cancelled" : "failed",
          outcome_type: "failed",
          error_code: error.code ?? "UNEXPECTED_ERROR",
          completed_at: this.now(),
        },
      });
      await this.failRun(runId, error);
      if (isCorrection) {
        await this.failCorrectionWorkUnit(
          changeSetId,
          workUnitId,
          runId,
          error,
        );
      } else {
        await this.failWorkUnit(changeSetId, workUnitId, error);
      }
      throw error;
    }

    if (outcome.type === "implementation_blocked") {
      const error = new ChangeFleetError(
        "RUNTIME_IMPLEMENTATION_BLOCKED",
        outcome.summary || outcome.blocker.message,
        { blocker_code: outcome.blocker.code },
      );
      if (isCorrection) {
        await this.blockCorrectionWorkUnit(
          changeSetId,
          workUnitId,
          runId,
          error,
        );
      } else {
        await this.blockWorkUnit(changeSetId, workUnitId, error);
      }
      throw error;
    }

    if (outcome.type === "plan_invalidation_required") {
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const currentPlanRecord = currentPlan(current);
        invariant(
          currentPlanRecord?.revision === plan.revision,
          "STALE_PLAN_INVALIDATION",
          "Execution invalidation no longer refers to the current Plan",
        );
        currentPlanRecord.status = "invalidated";
        for (const unit of unitsForCurrentPlan(current)) {
          if (unit.state !== "candidate_ready") unit.state = "superseded";
        }
        current.current_approvable_plan_message_id = null;
        current.state = "replanning";
        current.decisions.push({
          decision_id: this.idFactory("decision"),
          type: "plan_invalidation",
          plan_revision: plan.revision,
          run_id: runId,
          code: outcome.blocker.code,
          message: outcome.blocker.message,
          revision_feedback_assessments: structuredClone(
            outcome.revision_feedback_assessments,
          ),
          decided_at: this.now(),
        });
        current.updated_at = this.now();
      });
      return {
        status: "plan_invalidation_required",
        plan_revision: plan.revision,
        run_id: runId,
      };
    }

    let checkpointPersisted = false;
    try {
      const requestedPrivateHarnessChanges =
        overlaySnapshot === null
          ? []
          : outcome.changed_paths
              .map((item) => item.replaceAll("\\", "/"))
              .filter((item) =>
                overlaySnapshot.files.some(
                  (file) =>
                    item === file.relative_path,
                ),
              );
      invariant(
        requestedPrivateHarnessChanges.length === 0,
        "NON_GIT_HARNESS_CHANGE_UNSUPPORTED",
        "A durable change to private non-Git Harness is unsupported",
        { paths: requestedPrivateHarnessChanges.sort() },
      );
      if (overlaySnapshot) {
        await this.repositoryWorker.verifyAndRemoveHarnessOverlay({
          repository,
          workspace,
          snapshot: overlaySnapshot,
        });
      }
      const published = await this.repositoryWorker.publishCandidate({
        repository,
        workspace,
        expectedHead: isCorrection
          ? correctionCheckpoint.candidate_sha
          : workUnit.base_sha,
        baseSha: workUnit.base_sha,
        message: isCorrection
          ? `ChangeFleet ${changeSetId} ${workUnitId} correction`
          : `ChangeFleet ${changeSetId} ${workUnitId}`,
      });
      invariant(
        !isCorrection ||
          !published.no_change ||
          outcome.changed_paths.length === 0,
        "CORRECTION_CHANGED_PATHS_MISMATCH",
        "A no-change correction cannot report changed paths",
        { source_run_id: runId, reported_changed_paths: outcome.changed_paths },
      );
      invariant(
        isCorrection ||
          (!published.no_change && published.changed_paths.length > 0),
        "EMPTY_IMPLEMENTATION_RESULT",
        "Runtime implementation produced no Git change for the WorkUnit",
        { source_run_id: runId },
      );
      const checkpoint = published.no_change
        ? correctionCheckpoint
        : createCandidateCheckpoint({
            changeSetId,
            intentRevision: plan.intent_revision,
            planRevision: plan.revision,
            repositorySelectionRevision: repositorySelection.revision,
            repositoryHarnessSelectionRevision:
              repositoryHarnessSelection.revision,
            workUnitId,
            repositoryId: published.repository_id,
            targetRef: published.target_ref,
            baseSha: published.base_sha,
            candidateSha: published.candidate_sha,
            workspaceId: published.workspace_id,
            workspacePath: published.workspace_path,
            changedPaths: published.changed_paths,
            sourceRunId: runId,
            createdAt: this.now(),
          });
      if (isCorrection) {
        // Provider 声明与真实 old-to-new Git delta 分开保存，聚焦复审消费后者。
        await this.runStore.update(runId, (current) => {
          current.outcome.actual_changed_paths = [
            ...published.round_changed_paths,
          ];
          current.outcome.published_candidate_sha =
            published.candidate_sha;
          current.outcome.no_change = published.no_change;
        });
      }
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          isCorrection
            ? unit.state === "correcting" &&
                unit.candidate_checkpoint_id ===
                  correctionCheckpoint.checkpoint_id &&
                unit.correction_source_review_id ===
                  correctionReview.review_id &&
                unit.candidate === null
            : unit.state === "running" &&
                unit.candidate_checkpoint_id === null &&
                unit.candidate === null,
          "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
          `WorkUnit ${workUnitId} cannot persist its CandidateCheckpoint`,
        );
        if (!published.no_change) {
          current.candidate_checkpoints.push(checkpoint);
        }
        unit.candidate_checkpoint_id = checkpoint.checkpoint_id;
        if (isCorrection) {
          unit.verification_review_id = null;
          if (!published.no_change) {
            unit.verification_admission_id = null;
            unit.validation_attempt_ids = [];
          }
          resolveValidationBlockers(current, {
            workUnitId,
            resolvedAt: this.now(),
          });
        }
        unit.state = "validation_pending";
        unit.last_error = null;
        current.state = "validating";
        current.updated_at = this.now();
      });
      checkpointPersisted = true;
      return this.resumeWorkUnitValidation(changeSetId, workUnitId, {
        operatorAdmissionMode,
        attemptBudgetRequests,
      });
    } catch (error) {
      if (!checkpointPersisted) {
        if (isCorrection) {
          await this.failCorrectionFinalization(
            changeSetId,
            workUnitId,
            runId,
            error,
          );
        } else {
          await this.failWorkUnit(changeSetId, workUnitId, error);
        }
      }
      throw error;
    }
  }

  async resumeWorkUnitValidation(
    changeSetId,
    workUnitId,
    { operatorAdmissionMode = null, attemptBudgetRequests = [] } = {},
  ) {
    // 恢复只消费持久化 Checkpoint，不创建 Run，也不调用 Runtime。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const repositoryHarnessSelection = currentRepositoryHarnessSelection(state);
    const workUnit = unitsForCurrentPlan(state).find(
      (unit) => unit.work_unit_id === workUnitId,
    );
    invariant(
      workUnit &&
        [
          "validation_pending",
          "validation_failed",
          "verification_pending",
          "verification_failed",
        ].includes(workUnit.state) &&
        workUnit.candidate_checkpoint_id &&
        !workUnit.candidate,
      "CANDIDATE_CHECKPOINT_NOT_RESUMABLE",
      `WorkUnit ${workUnitId} has no resumable CandidateCheckpoint`,
    );
    const checkpoint = state.candidate_checkpoints.find(
      (item) => item.checkpoint_id === workUnit.candidate_checkpoint_id,
    );
    invariant(
      checkpoint &&
        checkpoint.change_set_id === changeSetId &&
        checkpoint.intent_revision === plan.intent_revision &&
        checkpoint.plan_revision === plan.revision &&
        checkpoint.repository_selection_revision ===
          repositorySelection.revision &&
        checkpoint.repository_harness_selection_revision ===
          repositoryHarnessSelection.revision &&
        checkpoint.work_unit_id === workUnitId &&
        checkpoint.repository_id === workUnit.repository_id &&
        checkpoint.target_ref === workUnit.target_ref &&
        checkpoint.base_sha === workUnit.base_sha &&
        checkpoint.workspace_id === workUnit.workspace?.workspace_id &&
        checkpoint.workspace_path === workUnit.workspace?.workspace_path,
      "CANDIDATE_CHECKPOINT_SUBJECT_MISMATCH",
      "CandidateCheckpoint does not match the current exact WorkUnit authority",
    );
    const sourceRun = await this.runStore.read(checkpoint.source_run_id);
    invariant(
      sourceRun.change_set_id === changeSetId &&
        sourceRun.work_unit_id === workUnitId &&
        sourceRun.status === "completed" &&
        sourceRun.outcome?.type === "implementation_completed",
      "CANDIDATE_CHECKPOINT_RUN_MISMATCH",
      "CandidateCheckpoint source Run is not the exact completed implementation",
    );
    let admission = (state.verification_admissions ?? []).find(
      (item) => item.admission_id === workUnit.verification_admission_id,
    );
    if (admission) {
      invariant(
        operatorAdmissionMode === null ||
          admissionModeAtLeast(admission.mode, operatorAdmissionMode),
        "VERIFICATION_ADMISSION_ALREADY_DECIDED",
        "The immutable admission decision cannot be elevated after validation began",
      );
    } else {
      admission = createVerificationAdmissionDecision({
        checkpointId: checkpoint.checkpoint_id,
        projectPolicy: state.verification_policy,
        planExpectation: plan.verification_expectation,
        // 一旦进入修正 lineage，聚焦复审就是闭环义务；控制器重启后不能因新请求省略参数而降级。
        operatorMode:
          workUnit.correction_source_review_id === null
            ? operatorAdmissionMode
            : "independent_review",
        sourceReportedChangedPaths:
          sourceRun.outcome.reported_changed_paths ?? checkpoint.changed_paths,
        actualChangedPaths: checkpoint.changed_paths,
        unverifiedBoundaries: plan.unverified_boundaries,
        createdAt: this.now(),
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
            unit.verification_admission_id === null,
          "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
          "CandidateCheckpoint changed before verification admission",
        );
        current.verification_admissions.push(admission);
        unit.verification_admission_id = admission.admission_id;
        current.updated_at = this.now();
      });
    }
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const repository = project.repositories.find(
      (item) => item.repository_id === checkpoint.repository_id,
    );
    const repositoryEvidence = await this.ensureRepositoryValidationPassed({
      changeSetId,
      workUnitId,
      workUnit,
      checkpoint,
      repository,
      projectPolicy: state.verification_policy,
      attemptBudgetRequests,
    });
    let verificationFocus = null;
    if (workUnit.correction_source_review_id !== null) {
      // 持久化 lineage 决定是否必须复审，不能依赖重启请求再次携带 operator 参数。
      const sourceReview = state.verification_reviews.find(
        (review) =>
          review.review_id === workUnit.correction_source_review_id,
      );
      const sourceCheckpoint = state.candidate_checkpoints.find(
        (candidate) =>
          candidate.checkpoint_id === sourceReview?.checkpoint_id,
      );
      const correctionReference = (
        workUnit.correction_run_references ?? []
      )
        .filter(
          (reference) =>
            reference.source_review_id === sourceReview?.review_id &&
            reference.status === "completed" &&
            reference.outcome_type === "implementation_completed",
        )
        .at(-1);
      const correctionRun = correctionReference
        ? await this.runStore.read(correctionReference.run_id)
        : null;
      invariant(
        sourceReview?.verdict === "changes_required" &&
          (sourceReview.review_scope ?? "initial") === "initial" &&
          sourceCheckpoint &&
          correctionRun?.operation === "correction" &&
          correctionRun.status === "completed" &&
          correctionRun.outcome?.type === "implementation_completed",
        "CORRECTION_LINEAGE_MISMATCH",
        "Focused verification requires one exact completed correction lineage",
      );
      normalizeRevisionFeedbackAssessments(
        correctionRun.outcome.revision_feedback_assessments,
        verificationReviewAsRevisionFeedback(sourceReview),
      );
      verificationFocus = {
        sourceReview,
        sourceCheckpoint,
        correctionRun,
      };
    }
    let verificationReview = null;
    if (admission.mode === "independent_review") {
      verificationReview = await this.ensureIndependentVerificationPassed({
        changeSetId,
        workUnitId,
        checkpoint,
        admission,
        repositoryEvidence,
        focus: verificationFocus,
      });
      if (verificationReview.verdict === "changes_required") {
        if ((verificationReview.review_scope ?? "initial") === "initial") {
          return this.executeWorkUnit(changeSetId, workUnitId, {
            operatorAdmissionMode,
            attemptBudgetRequests,
            correctionReviewId: verificationReview.review_id,
          });
        }
        throw new ChangeFleetError(
          "VERIFICATION_FOCUSED_REVIEW_UNRESOLVED",
          "Focused verification still requires Candidate changes",
          { verification_review_id: verificationReview.review_id },
        );
      }
      if (verificationReview.verdict === "human_decision_required") {
        throw new ChangeFleetError(
          "VERIFICATION_HUMAN_DECISION_REQUIRED",
          "Independent verification requires a human decision",
          { verification_review_id: verificationReview.review_id },
        );
      }
    }
    const candidate = createCandidate({
      repositoryId: checkpoint.repository_id,
      targetRef: checkpoint.target_ref,
      baseSha: checkpoint.base_sha,
      candidateSha: checkpoint.candidate_sha,
      workspaceId: checkpoint.workspace_id,
      workspacePath: checkpoint.workspace_path,
      changedPaths: checkpoint.changed_paths,
      repositoryEvidence,
      verificationAdmissionId: admission.admission_id,
      verificationReviewId: verificationReview?.review_id ?? null,
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const unit = unitsForCurrentPlan(current).find(
        (item) => item.work_unit_id === workUnitId,
      );
      invariant(
        unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
          (verificationReview
            ? unit.state === "verification_passed" &&
              unit.verification_review_id === verificationReview.review_id
            : ["validation_pending", "validation_failed"].includes(
                unit.state,
              )) &&
          unit.candidate === null,
        "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
        "CandidateCheckpoint changed before Candidate promotion",
      );
      unit.state = "candidate_ready";
      unit.candidate = candidate;
      unit.last_error = null;
      current.candidates.push(candidate);
      resolveValidationBlockers(current, {
        workUnitId,
        resolvedAt: this.now(),
      });
      current.state = "executing";
      current.updated_at = this.now();
    });
    return candidate;
  }

  async ensureIndependentVerificationPassed({
    changeSetId,
    workUnitId,
    checkpoint,
    admission,
    repositoryEvidence,
    focus = null,
  }) {
    let state = await this.controlStore.readChangeSet(changeSetId);
    // initial 与 focused 使用不同不可变身份；focused 只允许绑定一个来源 review 和 correction Run。
    const reviewScope = focus === null ? "initial" : "focused";
    const existingReview = state.verification_reviews
      .filter(
        (review) =>
          review.admission_id === admission.admission_id &&
          review.checkpoint_id === checkpoint.checkpoint_id &&
          (review.review_scope ?? "initial") === reviewScope &&
          (reviewScope === "initial" ||
            review.source_review_id === focus.sourceReview.review_id),
      )
      .at(-1);
    if (verificationReviewAllowsCandidate(existingReview)) {
      return structuredClone(existingReview);
    }
    if (
      existingReview &&
      ["changes_required", "human_decision_required"].includes(
        existingReview.verdict,
      )
    ) {
      return structuredClone(existingReview);
    }

    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const repository = requireRepository(project, checkpoint.repository_id);
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const repositoryHarnessSelection = currentRepositoryHarnessSelection(state);
    const selectedRepository = repositorySelection.repositories.find(
      (item) => item.repository_id === checkpoint.repository_id,
    );
    const selectedHarness = repositoryHarnessSelection.repositories.find(
      (item) => item.repository_id === checkpoint.repository_id,
    );
    invariant(
      selectedRepository &&
        selectedHarness?.resolved_base_sha === checkpoint.base_sha,
      "REPOSITORY_HARNESS_SELECTION_MISMATCH",
      "Verification subject no longer matches the frozen Repository authority",
    );
    const workUnit = unitsForCurrentPlan(state).find(
      (item) => item.work_unit_id === workUnitId,
    );
    const sourceRun = await this.runStore.read(checkpoint.source_run_id);
    const attempt = (workUnit.verification_run_references ?? []).length + 1;
    const runId = this.idFactory("run");
    let workspace = null;
    let overlaySnapshot = null;

    try {
      workspace = await this.repositoryWorker.prepareVerificationWorkspace({
        repository,
        candidateSha: checkpoint.candidate_sha,
        harnessBaseSha: checkpoint.base_sha,
        workspaceId: `verification-${runId}`,
      });
      if (
        selectedHarness.mode ===
        HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
      ) {
        overlaySnapshot = await this.harnessSnapshotStore.read(
          selectedHarness.artifact_reference,
        );
        workspace = {
          ...workspace,
          harness_overlay: {
            ...selectedHarness.artifact_reference,
            paths: [...selectedHarness.resolved_relative_paths],
          },
        };
        workspace = await this.repositoryWorker.materializeHarnessOverlay({
          repository,
          workspace,
          snapshot: overlaySnapshot,
        });
      }
    } catch (error) {
      if (workspace) {
        await this.repositoryWorker
          .cleanupVerificationWorkspace({
            repository,
            workspace,
            harnessSnapshot: overlaySnapshot,
          })
          .catch(() => {});
      }
      throw error;
    }

    let exactCandidateHarness;
    try {
      exactCandidateHarness = await this.repositoryWorker.discoverHarness(
        repository,
        checkpoint.candidate_sha,
      );
    } catch (error) {
      await this.repositoryWorker
        .cleanupVerificationWorkspace({
          repository,
          workspace,
          harnessSnapshot: overlaySnapshot,
        })
        .catch(() => {});
      throw error;
    }
    const frozenOverlayHarness = overlayHarnessResources(overlaySnapshot);
    const availableHarness = [
      ...exactCandidateHarness,
      ...frozenOverlayHarness,
    ];
    const harnessObservation = repositoryHarnessObservation({
      repositoryId: repository.repository_id,
      exactBaseResources: exactCandidateHarness,
      overlayResources: frozenOverlayHarness,
    });
    const run = {
      schema_version: 1,
      run_id: runId,
      change_set_id: changeSetId,
      work_unit_id: workUnitId,
      operation: "verification",
      attempt,
      status: "running",
      agent_profile: this.verificationAgentProfile,
      repository_harness_selection: {
        revision: repositoryHarnessSelection.revision,
        repositories: [harnessSelectionForContext(selectedHarness)],
      },
      repository_harness_observation: {
        repositories: [harnessObservation],
      },
      verification_workspace: workspace,
      context_evidence: null,
      context_projection_identity: null,
      runtime_evidence: null,
      created_at: this.now(),
      completed_at: null,
      outcome: null,
    };
    try {
      await this.runStore.create(run);
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
            unit.verification_admission_id === admission.admission_id &&
            unit.candidate === null,
          "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
          "Verification subject changed before Runtime dispatch",
        );
        unit.state = "verifying";
        unit.verification_run_references.push({
          run_id: runId,
          attempt,
          review_scope: reviewScope,
          source_review_id: focus?.sourceReview.review_id ?? null,
          status: "running",
        });
        current.run_references.push({
          run_id: runId,
          operation: "verification",
          plan_revision: plan.revision,
          work_unit_id: workUnitId,
          verification_admission_id: admission.admission_id,
          review_scope: reviewScope,
          source_review_id: focus?.sourceReview.review_id ?? null,
          attempt,
          status: "running",
        });
        current.state = "validating";
        current.updated_at = this.now();
      });
    } catch (error) {
      await this.repositoryWorker
        .cleanupVerificationWorkspace({
          repository,
          workspace,
          harnessSnapshot: overlaySnapshot,
        })
        .catch(() => {});
      throw error;
    }

    state = await this.controlStore.readChangeSet(changeSetId);
    const currentUnit = unitsForCurrentPlan(state).find(
      (item) => item.work_unit_id === workUnitId,
    );
    const controlContract = createControlContract({
      operation: "verification",
      changeSetId,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision:
        repositoryHarnessSelection.revision,
      workUnitId,
      authorizedRepositories: [checkpoint.repository_id],
      allowedOutcomes: ["verification_completed"],
      humanGates: ["candidate_bundle_acceptance"],
    });
    const contextProjection = createContextProjection({
      operation: "verification",
      changeSet: state,
      plan,
      repositorySelection,
      repositoryHarnessSelection,
      workUnit: currentUnit,
      repositories: [
        {
          repository_id: repository.repository_id,
          branch_ref: selectedRepository.branch_ref,
          target_ref: checkpoint.target_ref,
          base_sha: checkpoint.base_sha,
          candidate_sha: checkpoint.candidate_sha,
          root_path: workspace.workspace_path,
          harness_selection: harnessSelectionForContext(selectedHarness),
          ...harnessResourcesForContext(availableHarness),
        },
      ],
      capability: {
        mode: "read_only",
        paths: [workspace.workspace_path],
      },
      requiredEvidence: [
        "exact_candidate_diff",
        "repository_check_evidence",
        "structured_verification_outcome",
        ...(focus === null ? [] : ["focused_correction_lineage"]),
      ],
      verificationPolicy: state.verification_policy,
      verification: {
        admission: structuredClone(admission),
        candidate: {
          checkpoint_id: checkpoint.checkpoint_id,
          repository_id: checkpoint.repository_id,
          target_ref: checkpoint.target_ref,
          base_sha: checkpoint.base_sha,
          candidate_sha: checkpoint.candidate_sha,
          changed_paths: [...checkpoint.changed_paths],
        },
        source_execution: {
          run_id: sourceRun.run_id,
          outcome_type: sourceRun.outcome?.type ?? null,
          summary: sourceRun.outcome?.summary ?? null,
          reported_changed_paths:
            sourceRun.outcome?.reported_changed_paths ?? [],
        },
        completed_checks: [
          {
            check: structuredClone(workUnit.repository_check),
            status: "passed",
            evidence: structuredClone(repositoryEvidence),
          },
        ],
        focus:
          focus === null
            ? null
            : {
                source_review: {
                  review_id: focus.sourceReview.review_id,
                  checkpoint_id: focus.sourceReview.checkpoint_id,
                  summary: focus.sourceReview.summary,
                  findings: structuredClone(focus.sourceReview.findings),
                  candidate: {
                    candidate_sha: focus.sourceCheckpoint.candidate_sha,
                    changed_paths: [
                      ...focus.sourceCheckpoint.changed_paths,
                    ],
                  },
                },
                correction: {
                  run_id: focus.correctionRun.run_id,
                  reported_changed_paths:
                    focus.correctionRun.outcome.reported_changed_paths ?? [],
                  actual_changed_paths:
                    focus.correctionRun.outcome.actual_changed_paths ?? [],
                  candidate_sha:
                    focus.correctionRun.outcome.published_candidate_sha ??
                    checkpoint.candidate_sha,
                  revision_feedback_assessments: structuredClone(
                    focus.correctionRun.outcome
                      .revision_feedback_assessments ?? [],
                  ),
                },
              },
      },
      historyReferences: [],
    });
    const invocation = {
      operation: "verification",
      agent_profile: this.verificationAgentProfile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace,
      signal: null,
    };
    let outcome = null;
    let providerEvidence = null;
    let runtimeError = null;
    let checkResult = {
      attemptIds: [],
      failedError: null,
      missingEvidence: false,
    };
    try {
      const contextEvidence = assessInitialContext({
        controlContract,
        contextProjection,
        agentProfile: this.verificationAgentProfile,
        runtimeMeasurement: await measureInitialContext(
          this.verificationRuntime,
          invocation,
        ),
      });
      await this.runStore.update(runId, (current) => {
        current.context_evidence = contextEvidence;
        current.context_projection_identity = {
          schema_version: contextProjection.schema_version,
          digest: sha256(contextProjection),
        };
      });
      const result = await invokeRuntime(this.verificationRuntime, invocation, {
        onEvent: (event) => this.appendRuntimeEvent(runId, event),
      });
      providerEvidence = result.provider_evidence;
      outcome = normalizeVerificationOutcome(result.outcome, {
        projectPolicy: state.verification_policy,
        existingCommandIds: [
          ...plan.work_units.map(
            (item) => item.repository_check.command_id,
          ),
          plan.combined_check.command_id,
        ],
      });
      await this.repositoryWorker.preflightVerificationWorkspace({
        repository,
        workspace,
      });
      checkResult = await this.executeVerificationRequestedChecks({
        changeSetId,
        workUnitId,
        checkpoint,
        repository,
        workspace,
        commands: outcome.requested_checks,
        projectPolicy: state.verification_policy,
      });
      invariant(
        !checkResult.missingEvidence,
        "MISSING_REQUIRED_EVIDENCE",
        "A verification-requested check failed without immutable evidence",
      );
    } catch (error) {
      runtimeError = error;
      providerEvidence = error.runtime_evidence ?? providerEvidence;
    }
    // 进程级中断保留 running Run 和一次性工作区，下一控制器据此执行确定性放弃与重试。
    if (runtimeError?.code === "CONTROLLER_INTERRUPTED") {
      throw runtimeError;
    }
    try {
      await this.repositoryWorker.cleanupVerificationWorkspace({
        repository,
        workspace,
        harnessSnapshot: overlaySnapshot,
      });
    } catch (error) {
      runtimeError ??= error;
    }

    if (runtimeError) {
      await this.recordRuntimeEvidence({
        runId,
        invocation,
        providerEvidence,
        terminal: {
          status:
            runtimeError.code === "RUNTIME_CANCELLED"
              ? "cancelled"
              : "failed",
          outcome_type: "failed",
          error_code: runtimeError.code ?? "UNEXPECTED_ERROR",
          completed_at: this.now(),
        },
      });
      await this.failRun(runId, runtimeError);
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        unit.verification_run_references.at(-1).status = "failed";
        const reference = current.run_references.find(
          (item) => item.run_id === runId,
        );
        reference.status = "failed";
        unit.state = "verification_failed";
        unit.last_error = {
          code: runtimeError.code ?? "UNEXPECTED_ERROR",
          message: runtimeError.message,
          run_id: runId,
        };
        current.state = "failed";
        current.blockers.push({
          code: runtimeError.code ?? "UNEXPECTED_ERROR",
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          verification_admission_id: admission.admission_id,
          run_id: runId,
        });
        current.updated_at = this.now();
      });
      throw runtimeError;
    }

    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: "runtime.outcome",
      at: this.now(),
      payload: outcome,
    });
    const completedAt = this.now();
    await this.recordRuntimeEvidence({
      runId,
      invocation,
      providerEvidence,
      terminal: {
        status: "completed",
        outcome_type: outcome.type,
        error_code: null,
        completed_at: completedAt,
      },
    });
    await this.runStore.update(runId, (current) => {
      current.status = "completed";
      current.completed_at = completedAt;
      current.outcome = {
        type: outcome.type,
        review_depth: outcome.review_depth,
        verdict: outcome.verdict,
        summary: outcome.summary,
      };
    });

    const checkStatus =
      outcome.requested_checks.length === 0
        ? "not_required"
        : checkResult.failedError
          ? "failed"
          : "passed";
    const review = createVerificationReview({
      admissionId: admission.admission_id,
      checkpoint,
      runId,
      outcome,
      validationAttemptIds: checkResult.attemptIds,
      checkStatus,
      reviewScope,
      sourceReviewId: focus?.sourceReview.review_id ?? null,
      correctionRunId: focus?.correctionRun.run_id ?? null,
      createdAt: completedAt,
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const unit = unitsForCurrentPlan(current).find(
        (item) => item.work_unit_id === workUnitId,
      );
      invariant(
        unit?.state === "verifying" &&
          unit.candidate_checkpoint_id === checkpoint.checkpoint_id,
        "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
        "Verification subject changed before its result was recorded",
      );
      unit.verification_run_references.at(-1).status = "completed";
      const reference = current.run_references.find(
        (item) => item.run_id === runId,
      );
      reference.status = "completed";
      current.verification_reviews.push(review);
      unit.verification_review_id = review.review_id;
      if (checkResult.failedError) {
        unit.state = "verification_failed";
        unit.last_error = {
          code: "VERIFICATION_CHECK_FAILED",
          message: checkResult.failedError.message,
          verification_review_id: review.review_id,
        };
        current.state = "failed";
        current.blockers.push({
          code: "VERIFICATION_CHECK_FAILED",
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          verification_review_id: review.review_id,
        });
      } else if (review.verdict === "changes_required") {
        // 只有初审可以自动进入修正；聚焦复审仍不同意时终止自动循环并交给人。
        if (reviewScope === "initial") {
          unit.state = "verification_changes_required";
          unit.correction_source_review_id = review.review_id;
          unit.last_error = {
            code: "VERIFICATION_CHANGES_REQUIRED",
            verification_review_id: review.review_id,
          };
          current.state = "executing";
          current.blockers.push({
            code: "VERIFICATION_CHANGES_REQUIRED",
            work_unit_id: workUnitId,
            checkpoint_id: checkpoint.checkpoint_id,
            verification_review_id: review.review_id,
          });
        } else {
          unit.state = "verification_human_decision_required";
          unit.last_error = {
            code: "VERIFICATION_FOCUSED_REVIEW_UNRESOLVED",
            verification_review_id: review.review_id,
          };
          current.state = "decision_required";
          current.blockers.push({
            code: "VERIFICATION_FOCUSED_REVIEW_UNRESOLVED",
            work_unit_id: workUnitId,
            checkpoint_id: checkpoint.checkpoint_id,
            verification_review_id: review.review_id,
          });
        }
      } else if (review.verdict === "human_decision_required") {
        unit.state = "verification_human_decision_required";
        unit.last_error = {
          code: "VERIFICATION_HUMAN_DECISION_REQUIRED",
          verification_review_id: review.review_id,
        };
        current.state = "decision_required";
        current.blockers.push({
          code: "VERIFICATION_HUMAN_DECISION_REQUIRED",
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          verification_review_id: review.review_id,
        });
      } else {
        unit.state = "verification_passed";
        unit.last_error = null;
        resolveValidationBlockers(current, {
          workUnitId,
          resolvedAt: this.now(),
        });
        current.state = "validating";
      }
      current.updated_at = this.now();
    });

    if (checkResult.failedError) {
      throw new ChangeFleetError(
        "VERIFICATION_CHECK_FAILED",
        "An independent verification check failed for the exact Candidate",
        { verification_review_id: review.review_id },
      );
    }
    if (review.verdict === "changes_required") {
      if (reviewScope === "focused") {
        throw new ChangeFleetError(
          "VERIFICATION_FOCUSED_REVIEW_UNRESOLVED",
          "Focused verification still requires Candidate changes",
          { verification_review_id: review.review_id },
        );
      }
      return review;
    }
    if (review.verdict === "human_decision_required") {
      throw new ChangeFleetError(
        "VERIFICATION_HUMAN_DECISION_REQUIRED",
        "Independent verification requires a human decision",
        { verification_review_id: review.review_id },
      );
    }
    return review;
  }

  async executeVerificationRequestedChecks({
    changeSetId,
    workUnitId,
    checkpoint,
    repository,
    workspace,
    commands,
    projectPolicy,
  }) {
    const attemptIds = [];
    let failedError = null;
    let missingEvidence = false;
    for (const command of commands) {
      const before = await this.controlStore.readChangeSet(changeSetId);
      const checkIdentity = createCheckIdentity(command);
      const attemptNumber =
        before.validation_attempts.filter(
          (attempt) =>
            attempt.kind === "verification_check" &&
            attempt.subject_id === checkpoint.checkpoint_id &&
            attempt.check_identity?.check_identity_hash ===
              checkIdentity.check_identity_hash,
        ).length + 1;
      const attemptBudget = resolveValidationAttemptBudget({
        command,
        projectPolicy,
        commandSource: "verification_request",
      });
      const environmentIdentity = validationEnvironmentIdentity();
      const startedAt = this.now();
      let evidence;
      let commandError = null;
      try {
        evidence = await this.validateRepositoryCandidate({
          repository,
          candidate: {
            ...checkpoint,
            workspace_id: workspace.workspace_id,
            workspace_path: workspace.workspace_path,
          },
          command: {
            ...command,
            timeout_ms: attemptBudget.effective.timeout_ms,
          },
          checkIdentity,
          attemptBudget,
          environmentIdentity,
          evidenceKind: "verification_check",
        });
      } catch (error) {
        commandError = error;
        evidence = error.details?.evidence ?? null;
      }
      const completedAt = this.now();
      const attempt = evidence
        ? createValidationAttempt({
            kind: "verification_check",
            subjectId: checkpoint.checkpoint_id,
            attempt: attemptNumber,
            status: commandError ? "failed" : "passed",
            evidence,
            errorCode: commandError?.code ?? null,
            checkIdentity,
            requestedBudget: attemptBudget.requested,
            effectiveBudget: attemptBudget.effective,
            budgetSource: attemptBudget.source,
            budgetLimit: attemptBudget.limit,
            environmentIdentity,
            startedAt,
            completedAt,
          })
        : null;
      if (attempt) {
        await this.controlStore.transactChangeSet(changeSetId, (current) => {
          const unit = unitsForCurrentPlan(current).find(
            (item) => item.work_unit_id === workUnitId,
          );
          current.validation_attempts.push(attempt);
          unit.validation_attempt_ids.push(attempt.validation_attempt_id);
          current.updated_at = this.now();
        });
        attemptIds.push(attempt.validation_attempt_id);
      }
      if (commandError) {
        failedError ??= commandError;
        missingEvidence ||= attempt === null;
        if (
          [
            "CANDIDATE_HEAD_MISMATCH",
            "DIRTY_CANDIDATE_WORKSPACE",
            "CANDIDATE_CHANGED_PATHS_MISMATCH",
            "VERIFICATION_WORKSPACE_HEAD_CHANGED",
            "VERIFICATION_WORKSPACE_MODIFIED",
          ].includes(commandError.code)
        ) {
          break;
        }
      }
    }
    return { attemptIds, failedError, missingEvidence };
  }

  async ensureRepositoryValidationPassed({
    changeSetId,
    workUnitId,
    workUnit,
    checkpoint,
    repository,
    projectPolicy,
    attemptBudgetRequests,
  }) {
    const checkIdentity = createCheckIdentity(workUnit.repository_check);
    const latestState = await this.controlStore.readChangeSet(changeSetId);
    const passedAttempt = latestState.validation_attempts.find(
      (attempt) =>
        attempt.kind === "repository_validation" &&
        attempt.subject_id === checkpoint.checkpoint_id &&
        attempt.status === "passed" &&
        attempt.check_identity?.check_identity_hash ===
          checkIdentity.check_identity_hash,
    );
    if (passedAttempt) {
      // Checkpoint 与 check identity 都未改变时复用不可变证据，不因后续验证失败而重复昂贵命令。
      return structuredClone(passedAttempt.evidence);
    }

    const attemptNumber =
      latestState.validation_attempts.filter(
        (attempt) =>
          attempt.kind === "repository_validation" &&
          attempt.subject_id === checkpoint.checkpoint_id,
      ).length + 1;
    const budgetRequest = selectValidationAttemptBudgetRequest(
      attemptBudgetRequests,
      {
        kind: "repository_validation",
        workUnitId,
        commandId: workUnit.repository_check.command_id,
      },
    );
    const attemptBudget = resolveValidationAttemptBudget({
      command: workUnit.repository_check,
      projectPolicy,
      request: budgetRequest,
    });
    const environmentIdentity = validationEnvironmentIdentity();
    const startedAt = this.now();

    let repositoryEvidence;
    try {
      repositoryEvidence = await this.validateRepositoryCandidate({
        repository,
        candidate: checkpoint,
        command: {
          ...workUnit.repository_check,
          timeout_ms: attemptBudget.effective.timeout_ms,
        },
        checkIdentity,
        attemptBudget,
        environmentIdentity,
      });
    } catch (error) {
      const completedAt = this.now();
      const evidence = error.details?.evidence ?? null;
      const attempt = evidence
        ? createValidationAttempt({
            kind: "repository_validation",
            subjectId: checkpoint.checkpoint_id,
            attempt: attemptNumber,
            status: "failed",
            evidence,
            errorCode: error.code ?? "UNEXPECTED_ERROR",
            checkIdentity,
            requestedBudget: attemptBudget.requested,
            effectiveBudget: attemptBudget.effective,
            budgetSource: attemptBudget.source,
            budgetLimit: attemptBudget.limit,
            environmentIdentity,
            startedAt,
            completedAt,
          })
        : null;
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          unit?.candidate_checkpoint_id === checkpoint.checkpoint_id,
          "CANDIDATE_CHECKPOINT_SUBJECT_MISMATCH",
          "CandidateCheckpoint changed while validation was running",
        );
        if (attempt) {
          current.validation_attempts.push(attempt);
          unit.validation_attempt_ids.push(attempt.validation_attempt_id);
        }
        unit.state = "validation_failed";
        unit.last_error = {
          code: error.code ?? "UNEXPECTED_ERROR",
          message: error.message,
          validation_attempt_id: attempt?.validation_attempt_id ?? null,
        };
        current.state = "failed";
        current.blockers.push({
          code: error.code ?? "UNEXPECTED_ERROR",
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          validation_attempt_id: attempt?.validation_attempt_id ?? null,
        });
        current.updated_at = this.now();
      });
      throw error;
    }

    const completedAt = this.now();
    const attempt = createValidationAttempt({
      kind: "repository_validation",
      subjectId: checkpoint.checkpoint_id,
      attempt: attemptNumber,
      status: "passed",
      evidence: repositoryEvidence,
      checkIdentity,
      requestedBudget: attemptBudget.requested,
      effectiveBudget: attemptBudget.effective,
      budgetSource: attemptBudget.source,
      budgetLimit: attemptBudget.limit,
      environmentIdentity,
      startedAt,
      completedAt,
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const unit = unitsForCurrentPlan(current).find(
        (item) => item.work_unit_id === workUnitId,
      );
      invariant(
        unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
          unit.candidate === null,
        "CANDIDATE_CHECKPOINT_SUBJECT_MISMATCH",
        "CandidateCheckpoint changed before validation evidence was recorded",
      );
      current.validation_attempts.push(attempt);
      unit.validation_attempt_ids.push(attempt.validation_attempt_id);
      unit.state = "validation_pending";
      unit.last_error = null;
      resolveValidationBlockers(current, {
        workUnitId,
        resolvedAt: this.now(),
      });
      current.state = "validating";
      current.updated_at = this.now();
    });
    return repositoryEvidence;
  }

  async validateRepositoryCandidate({
    repository,
    candidate,
    command,
    checkIdentity,
    attemptBudget,
    environmentIdentity,
    evidenceKind = "repository_validation",
  }) {
    // 包括 spawn 失败在内的每次尝试都先写 Evidence，再把引用附到控制聚合。
    let preflightError = null;
    try {
      await this.repositoryWorker.preflightCandidate({ repository, candidate });
    } catch (error) {
      preflightError = error;
    }
    let commandResult = null;
    let commandError = null;
    if (!preflightError) {
      try {
        commandResult = await runCommand(command, {
          cwd: candidate.workspace_path,
        });
      } catch (error) {
        commandError = error;
        commandResult = error.details?.command_result ?? null;
      }
    }
    let postflightError = null;
    if (commandResult) {
      try {
        await this.repositoryWorker.preflightCandidate({ repository, candidate });
      } catch (error) {
        postflightError = error;
      }
    }
    const evidence = await this.evidenceStore.record({
      kind: evidenceKind,
      subject: {
        repository_id: candidate.repository_id,
        target_ref: candidate.target_ref,
        base_sha: candidate.base_sha,
        candidate_sha: candidate.candidate_sha,
      },
      payload: {
        check_identity: checkIdentity,
        attempt_budget: attemptBudget,
        environment_identity: environmentIdentity,
        preflight: validationErrorProjection(preflightError),
        command:
          commandResult ?? {
            status: "not_run",
            requested: structuredClone(command),
          },
        command_error: commandError
          ? validationErrorProjection(commandError)
          : commandResult
            ? { status: "passed" }
            : { status: "not_run" },
        postflight: postflightError
          ? {
              status: "failed",
              code: postflightError.code,
              message: postflightError.message,
            }
          : commandResult
            ? { status: "passed" }
            : { status: "not_run" },
      },
      createdAt: this.now(),
    });
    if (
      preflightError ||
      commandError ||
      commandResult.exit_code !== 0 ||
      commandResult.timed_out ||
      commandResult.cancelled ||
      commandResult.output_overflow ||
      postflightError
    ) {
      const code =
        preflightError?.code ??
        commandError?.code ??
        "REPOSITORY_VALIDATION_FAILED";
      throw new ChangeFleetError(
        code,
        `Repository check failed for ${candidate.repository_id}`,
        {
          evidence,
          command_result: commandResult,
          preflight_error: preflightError?.code,
          command_error: commandError?.code,
          postflight_error: postflightError?.code,
        },
      );
    }
    return evidence;
  }

  async validateCombinedCandidates({
    changeSetId,
    subject,
    candidates,
    repositories,
    command,
    projectPolicy,
    budgetRequest,
  }) {
    const before = await this.controlStore.readChangeSet(changeSetId);
    const attemptNumber =
      before.validation_attempts.filter(
        (attempt) =>
          attempt.kind === "combined_validation" &&
          attempt.subject_id === subject.validation_subject_hash,
      ).length + 1;
    const checkIdentity = createCheckIdentity(command);
    const attemptBudget = resolveValidationAttemptBudget({
      command,
      projectPolicy,
      request: budgetRequest,
    });
    const environmentIdentity = validationEnvironmentIdentity();
    const startedAt = this.now();
    try {
      const evidence = await this.combinedValidator.validate({
        subject,
        candidates,
        repositories,
        command: {
          ...command,
          timeout_ms: attemptBudget.effective.timeout_ms,
        },
        checkIdentity,
        attemptBudget,
        environmentIdentity,
      });
      const completedAt = this.now();
      const attempt = createValidationAttempt({
        kind: "combined_validation",
        subjectId: subject.validation_subject_hash,
        attempt: attemptNumber,
        status: "passed",
        evidence,
        checkIdentity,
        requestedBudget: attemptBudget.requested,
        effectiveBudget: attemptBudget.effective,
        budgetSource: attemptBudget.source,
        budgetLimit: attemptBudget.limit,
        environmentIdentity,
        startedAt,
        completedAt,
      });
      await this.controlStore.transactChangeSet(changeSetId, (state) => {
        state.validation_attempts.push(attempt);
        resolveValidationBlockers(state, {
          validationSubjectHash: subject.validation_subject_hash,
          resolvedAt: this.now(),
        });
        state.updated_at = this.now();
      });
      return evidence;
    } catch (error) {
      const completedAt = this.now();
      const evidence = error.details?.evidence ?? null;
      const attempt = evidence
        ? createValidationAttempt({
            kind: "combined_validation",
            subjectId: subject.validation_subject_hash,
            attempt: attemptNumber,
            status: "failed",
            evidence,
            errorCode: error.code ?? "UNEXPECTED_ERROR",
            checkIdentity,
            requestedBudget: attemptBudget.requested,
            effectiveBudget: attemptBudget.effective,
            budgetSource: attemptBudget.source,
            budgetLimit: attemptBudget.limit,
            environmentIdentity,
            startedAt,
            completedAt,
          })
        : null;
      await this.controlStore.transactChangeSet(changeSetId, (state) => {
        if (attempt) state.validation_attempts.push(attempt);
        state.state = "failed";
        state.blockers.push({
          code: error.code ?? "UNEXPECTED_ERROR",
          validation_subject_hash: subject.validation_subject_hash,
          validation_attempt_id: attempt?.validation_attempt_id ?? null,
        });
        state.updated_at = this.now();
      });
      throw error;
    }
  }

  async cleanupPlanningWorkspaces({
    planningWorkspaces,
    projectRepositories,
  }) {
    // 逐个清理并保留首个错误，避免一个仓库异常导致其余临时 worktree 永久泄漏。
    let firstError = null;
    for (const workspace of [...planningWorkspaces].reverse()) {
      const repository = projectRepositories.get(workspace.repository_id);
      let harnessSnapshot = null;
      if (workspace.harness_overlay) {
        try {
          harnessSnapshot = await this.harnessSnapshotStore.read(
            workspace.harness_overlay,
          );
        } catch (error) {
          firstError ??= error;
        }
      }
      try {
        await this.repositoryWorker.cleanupPlanningWorkspace({
          repository,
          workspace,
          harnessSnapshot,
        });
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  async appendRuntimeEvent(runId, event) {
    invariant(
      event &&
        typeof event.type === "string" &&
        event.payload &&
        typeof event.payload === "object",
      "INVALID_RUNTIME_EVENT",
      "Runtime event must contain a type and bounded payload",
    );
    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: event.type,
      at: this.now(),
      payload: event.payload,
    });
  }

  async recordRuntimeEvidence({
    runId,
    invocation,
    providerEvidence,
    terminal,
  }) {
    // 最终调用证据按内容寻址；Run 只保存引用，普通 Agent 上下文不会投影该记录。
    const run = await this.runStore.read(runId);
    const payload = createRuntimeInvocationEvidence({
      run,
      invocation,
      providerEvidence,
      terminal,
    });
    const reference = await this.evidenceStore.record({
      kind: "runtime_invocation",
      subject: {
        run_id: run.run_id,
        attempt: run.attempt,
        operation: run.operation,
        change_set_id: run.change_set_id,
        work_unit_id: run.work_unit_id,
      },
      payload,
      createdAt: terminal.completed_at,
    });
    await this.runStore.update(runId, (current) => {
      current.runtime_evidence = reference;
    });
    return reference;
  }

  async markRunReference(changeSetId, runId, status) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const reference = state.run_references.find(
        (candidate) => candidate.run_id === runId,
      );
      if (reference?.status === "running") reference.status = status;
      state.updated_at = this.now();
    });
  }

  async failRun(runId, error) {
    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: "run.failed",
      at: this.now(),
      payload: {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
      },
    });
    await this.runStore.update(runId, (run) => {
      run.status = "failed";
      run.completed_at = this.now();
      run.outcome = {
        type: "failed",
        code: error.code ?? "UNEXPECTED_ERROR",
      };
    });
  }

  async failWorkUnit(changeSetId, workUnitId, error) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = unitsForCurrentPlan(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      workUnit.state = "failed";
      workUnit.last_error = {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
      };
      const latestRunReference = workUnit.run_references.at(-1);
      if (latestRunReference?.status === "running") {
        latestRunReference.status = "failed";
        const aggregateReference = state.run_references.find(
          (reference) => reference.run_id === latestRunReference.run_id,
        );
        if (aggregateReference) aggregateReference.status = "failed";
      }
      state.state = "failed";
      state.blockers.push({
        code: error.code ?? "UNEXPECTED_ERROR",
        work_unit_id: workUnitId,
      });
      state.updated_at = this.now();
    });
  }

  async failCorrectionWorkUnit(changeSetId, workUnitId, runId, error) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = unitsForCurrentPlan(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      const unitReference = workUnit.correction_run_references.find(
        (reference) => reference.run_id === runId,
      );
      const aggregateReference = state.run_references.find(
        (reference) => reference.run_id === runId,
      );
      if (unitReference?.status === "running") unitReference.status = "failed";
      if (aggregateReference?.status === "running") {
        aggregateReference.status = "failed";
      }
      workUnit.state = "correction_failed";
      workUnit.last_error = {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
        run_id: runId,
      };
      state.state = "failed";
      state.blockers.push({
        code: error.code ?? "UNEXPECTED_ERROR",
        work_unit_id: workUnitId,
        run_id: runId,
      });
      state.updated_at = this.now();
    });
  }

  async blockCorrectionWorkUnit(changeSetId, workUnitId, runId, error) {
    // 语义阻塞保留 completed correction Run；下一显式 execute 可在工作区仍精确干净时重试该阶段。
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = unitsForCurrentPlan(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      workUnit.state = "correction_failed";
      workUnit.last_error = {
        code: error.code,
        message: error.message,
        blocker_code: error.details?.blocker_code ?? null,
        run_id: runId,
      };
      state.state = "failed";
      state.blockers.push({
        code: error.code,
        work_unit_id: workUnitId,
        run_id: runId,
        blocker_code: error.details?.blocker_code ?? null,
      });
      state.updated_at = this.now();
    });
  }

  async failCorrectionFinalization(changeSetId, workUnitId, runId, error) {
    // Runtime 已完成但新 Git 主体未能确定发布时不可再次调用 Agent，否则可能重复语义修改。
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = unitsForCurrentPlan(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      workUnit.state = "blocked";
      workUnit.last_error = {
        code: error.code ?? "CORRECTION_FINALIZATION_FAILED",
        message: error.message,
        run_id: runId,
      };
      state.state = "decision_required";
      state.blockers.push({
        code: error.code ?? "CORRECTION_FINALIZATION_FAILED",
        work_unit_id: workUnitId,
        run_id: runId,
      });
      state.updated_at = this.now();
    });
  }

  async blockWorkUnit(changeSetId, workUnitId, error) {
    // Provider 正常结束但无法完成语义工作时保留 completed Run，WorkUnit 单独进入可审计阻塞态。
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = unitsForCurrentPlan(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      workUnit.state = "blocked";
      workUnit.last_error = {
        code: error.code,
        message: error.message,
        blocker_code: error.details?.blocker_code ?? null,
      };
      state.state = "failed";
      state.blockers.push({
        code: error.code,
        work_unit_id: workUnitId,
        blocker_code: error.details?.blocker_code ?? null,
      });
      state.updated_at = this.now();
    });
  }

  async markCommandFailed(changeSetId, idempotencyKey, error) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const command = state.commands[idempotencyKey];
      if (!command || command.status !== "in_progress") return;
      command.status = "failed";
      command.failed_at = this.now();
      command.error = {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
      };
      const preservesVerificationState = [
        "VERIFICATION_CHANGES_REQUIRED",
        "VERIFICATION_HUMAN_DECISION_REQUIRED",
        "VERIFICATION_FOCUSED_REVIEW_UNRESOLVED",
      ].includes(command.error.code);
      if (
        !preservesVerificationState &&
        !["candidate_review", "delivery_ready", "done"].includes(state.state)
      ) {
        state.state = "failed";
        if (
          !state.blockers.some(
            (blocker) =>
              blocker.code === command.error.code &&
              blocker.command_id === idempotencyKey,
          )
        ) {
          state.blockers.push({
            code: command.error.code,
            command_id: idempotencyKey,
          });
        }
      }
      state.updated_at = this.now();
    });
  }

  now() {
    return this.clock().toISOString();
  }
}

function hasResumableValidation(state) {
  const units = unitsForCurrentPlan(state);
  const hasCurrentBundle = state.bundles.some(
    (bundle) => bundle.plan_revision === state.current_plan_revision,
  );
  return (
    units.some(
      (unit) =>
        [
          "validation_pending",
          "validation_failed",
          "verification_pending",
          "verification_failed",
        ].includes(unit.state) &&
        isNonEmptyCheckpoint(
          state.candidate_checkpoints.find(
            (checkpoint) =>
              checkpoint.checkpoint_id === unit.candidate_checkpoint_id,
          ),
        ),
    ) ||
    (!hasCurrentBundle &&
      units.length > 0 &&
      units.every((unit) => unit.state === "candidate_ready"))
  );
}

function hasCorrectableVerification(state) {
  // 调度器只把当前 initial blocking review 识别为可修正输入。
  return unitsForCurrentPlan(state).some((unit) => {
    if (unit.state !== "verification_changes_required") return false;
    const review = (state.verification_reviews ?? []).find(
      (candidate) => candidate.review_id === unit.verification_review_id,
    );
    return Boolean(
      review &&
        review.verdict === "changes_required" &&
        (review.review_scope ?? "initial") === "initial" &&
        unit.candidate === null,
    );
  });
}

function hasResumableCorrection(state) {
  // 失败或重启后的再次执行仍需 exact source review，不能靠状态名猜测来源。
  return unitsForCurrentPlan(state).some(
    (unit) =>
      ["correction_pending", "correction_failed"].includes(unit.state) &&
      typeof unit.correction_source_review_id === "string" &&
      unit.candidate === null,
  );
}

const RETRYABLE_PRE_CANDIDATE_CODES = new Set([
  "CODEX_CREDENTIALS_UNAVAILABLE",
  "CODEX_PROVIDER_FAILED",
  "CODEX_RUNTIME_OUTPUT_INVALID",
  "RUNTIME_CANCELLED",
  "RUNTIME_IMPLEMENTATION_BLOCKED",
  "UNEXPECTED_RUNTIME_OUTCOME",
  "EMPTY_IMPLEMENTATION_RESULT",
]);

function hasRetryableExecution(state) {
  return retryableExecutionUnits(state).length > 0;
}

function retryableExecutionUnits(state) {
  return unitsForCurrentPlan(state).filter(
    (unit) => retryableExecutionReason(state, unit) !== null,
  );
}

function retryableExecutionReason(state, unit) {
  if (!unit || unit.candidate) return null;
  const checkpoint = state.candidate_checkpoints.find(
    (candidate) => candidate.checkpoint_id === unit.candidate_checkpoint_id,
  );
  if (
    ["validation_pending", "validation_failed", "failed"].includes(
      unit.state,
    ) &&
    checkpoint &&
    !isNonEmptyCheckpoint(checkpoint)
  ) {
    return {
      reason_code: "EMPTY_IMPLEMENTATION_RESULT",
      source_run_id: checkpoint.source_run_id,
      checkpoint_id: checkpoint.checkpoint_id,
    };
  }
  if (
    ["failed", "blocked"].includes(unit.state) &&
    unit.candidate_checkpoint_id === null &&
    RETRYABLE_PRE_CANDIDATE_CODES.has(unit.last_error?.code)
  ) {
    return {
      reason_code: unit.last_error.code,
      source_run_id: unit.run_references.at(-1)?.run_id ?? null,
      checkpoint_id: null,
    };
  }
  return null;
}

function isNonEmptyCheckpoint(checkpoint) {
  return Boolean(
    checkpoint &&
      checkpoint.candidate_sha !== checkpoint.base_sha &&
      Array.isArray(checkpoint.changed_paths) &&
      checkpoint.changed_paths.length > 0,
  );
}

function verificationReviewAsRevisionFeedback(review) {
  return {
    summary: review.summary,
    findings: review.findings.map((finding) => ({
      finding_id: finding.finding_id,
      text: finding.message,
    })),
  };
}

function projectCorrectionValidationAttempts(state, review, checkpoint) {
  // 只给修正 Agent 当前主体的通过证据索引；完整命令输出继续留在 EvidenceStore。
  const requestedAttemptIds = new Set(review.validation_attempt_ids ?? []);
  const latestRepositoryAttempt = (state.validation_attempts ?? [])
    .filter(
      (attempt) =>
        attempt.kind === "repository_validation" &&
        attempt.subject_id === checkpoint.checkpoint_id &&
        attempt.status === "passed",
    )
    .at(-1);
  const selectedIds = new Set([
    ...(latestRepositoryAttempt
      ? [latestRepositoryAttempt.validation_attempt_id]
      : []),
    ...requestedAttemptIds,
  ]);
  return (state.validation_attempts ?? [])
    .filter((attempt) => selectedIds.has(attempt.validation_attempt_id))
    .map((attempt) => ({
      validation_attempt_id: attempt.validation_attempt_id,
      kind: attempt.kind,
      status: attempt.status,
      command_id: attempt.check_identity.command_id,
      evidence: structuredClone(attempt.evidence),
    }));
}

function resolveValidationBlockers(
  state,
  {
    workUnitId = null,
    validationSubjectHash = null,
    resolvedAt,
    resolvedByDecisionId = null,
  },
) {
  // 历史 blocker 不删除；标记已解决后不再进入当前 Runtime 投影。
  for (const blocker of state.blockers) {
    if (blocker.resolved_at !== undefined) continue;
    if (
      (workUnitId && blocker.work_unit_id === workUnitId) ||
      (validationSubjectHash &&
        blocker.validation_subject_hash === validationSubjectHash)
    ) {
      blocker.resolved_at = resolvedAt;
      if (resolvedByDecisionId) {
        blocker.resolved_by_decision_id = resolvedByDecisionId;
      }
    }
  }
}

function resolveFailedExecutionCommandBlockers(
  state,
  resolvedAt,
  resolvedByDecisionId = null,
) {
  for (const blocker of state.blockers) {
    if (blocker.resolved_at !== undefined || !blocker.command_id) continue;
    const command = state.commands[blocker.command_id];
    if (command?.command !== "executeChangeSet") continue;
    blocker.resolved_at = resolvedAt;
    if (resolvedByDecisionId) {
      blocker.resolved_by_decision_id = resolvedByDecisionId;
    }
  }
}

function validationErrorProjection(error) {
  return error
    ? {
        status: "failed",
        code: error.code ?? "UNEXPECTED_ERROR",
        message: String(error.message ?? "Validation failed").slice(0, 2_048),
      }
    : { status: "passed" };
}

function applyIdempotentCommand({
  record,
  idempotencyKey,
  command,
  input,
  perform,
}) {
  // 同 key 同输入返回首次结果；同 key 不同输入必须拒绝，不能覆盖历史。
  const commands =
    record.commands ??
    record.idempotency ??
    (record.idempotency = {});
  const existing = existingCommand(
    { commands },
    idempotencyKey,
    command,
    input,
  );
  if (existing) {
    invariant(
      existing.status === "completed",
      "COMMAND_IN_PROGRESS",
      `Command ${idempotencyKey} is not complete`,
    );
    return structuredClone(existing.result);
  }
  const result = perform();
  commands[idempotencyKey] = {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "completed",
    result: structuredClone(result),
  };
  return result;
}

function existingCommand(record, idempotencyKey, command, input) {
  const existing = record.commands?.[idempotencyKey];
  if (!existing) return null;
  const fingerprint = commandFingerprint(command, input);
  invariant(
    existing.command === command && existing.fingerprint === fingerprint,
    "IDEMPOTENCY_KEY_REUSED",
    `Idempotency key ${idempotencyKey} was used for different input`,
  );
  return existing;
}

function readIdempotentResult(
  record,
  idempotencyKey,
  command,
  input,
) {
  const existing = existingCommand(
    record,
    idempotencyKey,
    command,
    input,
  );
  invariant(
    existing?.status === "completed",
    "CHANGE_SET_ALREADY_EXISTS",
    `ChangeSet already exists without matching idempotency evidence`,
  );
  return structuredClone(existing.result);
}

function completeCommand(state, idempotencyKey, result, completedAt) {
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

function requireProject(catalog, projectId) {
  const project = catalog.projects[projectId];
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
    `Repository ${repositoryId} is not registered in Project ${project.project_id}`,
    { repository_id: repositoryId, project_id: project.project_id },
  );
  return repository;
}

function normalizeRepositorySelectionChangeRequest(outcome, project) {
  // Agent 只能提出完整的新选择请求；这里验证结构，但不会解析 ref 或改变任何权限。
  invariant(
    outcome.request && typeof outcome.request === "object",
    "INVALID_REPOSITORY_SELECTION_CHANGE_REQUEST",
    "Repository selection change outcome requires a request object",
  );
  try {
    const selection = normalizeRepositorySelectionRequest(project, {
      planningRepositoryIds: outcome.request.planning_repository_ids,
      repositorySelections: outcome.request.repository_selections,
    });
    return {
      requested_repository_selection: selection,
      rationale: optionalString(outcome.request.rationale),
    };
  } catch (error) {
    if (error instanceof ChangeFleetError) {
      throw new ChangeFleetError(
        "INVALID_REPOSITORY_SELECTION_CHANGE_REQUEST",
        "Runtime requested an invalid Repository selection change",
        { cause_code: error.code },
      );
    }
    throw error;
  }
}

function currentPlan(state) {
  return (
    state.plans.find(
      (plan) => plan.revision === state.current_plan_revision,
    ) ?? null
  );
}

function currentRepositorySelection(state) {
  // 当前指针是唯一可执行权威；历史 revision 只保留用于审计和恢复判断。
  const selection =
    state.repository_selection_revisions.find(
      (candidate) =>
        candidate.revision ===
        state.current_repository_selection_revision,
    ) ?? null;
  invariant(
    selection?.status === "current",
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "ChangeSet has no current Repository selection revision",
  );
  return selection;
}

function currentRepositoryHarnessSelection(state) {
  const selection = state.repository_harness_selection_revisions.find(
    (candidate) =>
      candidate.revision ===
      state.current_repository_harness_selection_revision,
  );
  invariant(
    selection?.status === "current",
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "ChangeSet has no current Repository Harness selection revision",
  );
  return selection;
}

function assertRepositorySelectionRevisionAllowed(state, expectedRevision) {
  invariant(
    Number.isSafeInteger(expectedRevision) && expectedRevision > 0,
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "Current Repository selection revision must be a positive integer",
  );
  invariant(
    ["analyzing", "awaiting_plan_confirmation", "replanning", "ready"].includes(
      state.state,
    ),
    "INVALID_CHANGE_SET_STATE",
    `Cannot revise Repository selection in state ${state.state}`,
  );
  invariant(
    state.current_repository_selection_revision === expectedRevision,
    "STALE_REPOSITORY_SELECTION_REVISION",
    `Repository selection revision ${expectedRevision} is not current`,
  );
}

function assertRepositoryHarnessSelectionRevisionAllowed(
  state,
  expectedRevision,
) {
  invariant(
    Number.isSafeInteger(expectedRevision) && expectedRevision > 0,
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "Current Repository Harness selection revision must be positive",
  );
  invariant(
    ["analyzing", "awaiting_plan_confirmation", "replanning", "ready"].includes(
      state.state,
    ),
    "INVALID_CHANGE_SET_STATE",
    `Cannot revise Repository Harness selection in state ${state.state}`,
  );
  invariant(
    state.current_repository_harness_selection_revision === expectedRevision,
    "STALE_REPOSITORY_HARNESS_SELECTION_REVISION",
    `Repository Harness selection revision ${expectedRevision} is not current`,
  );
}

function unitsForCurrentPlan(state) {
  return state.work_units.filter(
    (workUnit) => workUnit.plan_revision === state.current_plan_revision,
  );
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") return null;
  invariant(
    typeof value === "string",
    "INVALID_STRING",
    "Expected a string",
  );
  return value.trim();
}

function comparablePath(value) {
  return path.resolve(value).toLowerCase();
}

function harnessSelectionForContext(selection) {
  return {
    repository_id: selection.repository_id,
    resolved_base_sha: selection.resolved_base_sha,
    mode: selection.mode,
    provider_family: selection.provider_family,
    workspace_policy_revision: selection.workspace_policy_revision,
    selector_digest: selection.selector_digest,
    resolved_relative_paths: [...selection.resolved_relative_paths],
    skipped_resources: structuredClone(selection.skipped_resources ?? []),
    content_digest: selection.content_digest,
    artifact_reference: selection.artifact_reference
      ? {
          snapshot_id: selection.artifact_reference.snapshot_id,
          snapshot_hash: selection.artifact_reference.snapshot_hash,
        }
      : null,
  };
}

function overlayHarnessResources(snapshot) {
  if (!snapshot) return [];
  return snapshot.files.map((file) => ({
    path: file.relative_path,
    source: "frozen_overlay",
    content_sha256: file.sha256,
    bytes: file.bytes,
    executable: file.executable,
    snapshot_id: snapshot.snapshot_id,
  }));
}

function repositoryHarnessObservation({
  repositoryId,
  exactBaseResources,
  overlayResources,
}) {
  // Run 证据保留完整的资源身份，并诚实声明当前 Codex 接口无法报告实际加载事件。
  return {
    repository_id: repositoryId,
    exact_base_resources: structuredClone(exactBaseResources),
    frozen_overlay_resources: structuredClone(overlayResources),
    provider_discovery: {
      coverage: "unavailable",
      discovered_resources: [],
      loaded_resources: [],
    },
  };
}

function harnessResourcesForContext(resources) {
  // Agent 投影只广告有界样本；完整无正文清单留在 Run 证据中按引用审计。
  const advertised = resources.slice(0, MAX_CONTEXT_HARNESS_RESOURCES);
  return {
    harness_resources: structuredClone(advertised),
    harness_resource_summary: {
      total_count: resources.length,
      advertised_count: advertised.length,
      omitted_count: resources.length - advertised.length,
      identity_digest: sha256(resources),
    },
  };
}

function harnessSelectionRequestFingerprint(value) {
  if (value === undefined) return null;
  invariant(
    Array.isArray(value),
    "INVALID_REPOSITORY_HARNESS_SELECTION",
    "repository_harness_selections must be an array",
  );
  return value
    .map((selection) => ({
      repository_id: normalizeId(
        "repository_harness_selection.repository_id",
        selection.repository_id,
      ),
      mode: selection.mode ?? null,
      provider_family: selection.provider_family ?? null,
      workspace_policy_revision:
        selection.workspace_policy_revision ?? null,
    }))
    .sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
}

function intentFingerprint(intent) {
  return {
    objective: intent.objective,
    rationale: intent.rationale,
    constraints: intent.constraints,
    non_goals: intent.non_goals,
    acceptance_criteria: intent.acceptance_criteria,
    resolved_decisions: intent.resolved_decisions,
    open_questions: intent.open_questions,
    source: intent.source,
  };
}
