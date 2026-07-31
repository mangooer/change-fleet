import { randomUUID } from "node:crypto";
import path from "node:path";

import { sha256 } from "../domain/canonical-json.js";
import {
  commandFingerprint,
  createCandidate,
  createCandidateBundle,
  createValidationSubject,
  normalizeHumanDecision,
  normalizeId,
  normalizeIntent,
  normalizePlan,
  normalizeRepositorySelectionRequest,
} from "../domain/model.js";
import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../domain/runtime-context.js";
import { normalizeAgentProfile } from "../domain/agent-profile.js";
import { createRuntimeInvocationEvidence } from "../domain/runtime-evidence.js";
import { ChangeFleetError, invariant } from "../domain/errors.js";
import { ControlStore, CONTROL_SCHEMA_VERSION } from "../adapters/filesystem/control-store.js";
import { EvidenceStore } from "../adapters/filesystem/evidence-store.js";
import { runCommand } from "../adapters/filesystem/command-runner.js";
import { RunStore } from "../adapters/filesystem/run-store.js";
import { RepositoryWorker } from "../adapters/git/repository-worker.js";
import {
  invokeRuntime,
  measureInitialContext,
} from "../adapters/runtime/runtime-port.js";
import { CombinedValidator } from "./combined-validator.js";

// 应用服务是确定性编排入口：语义工作交给 Runtime，权限、状态和证据在此裁决。
export class ChangeFleetService {
  constructor({
    controlRoot,
    workspaceRoot,
    runtime,
    agentProfile,
    clock = () => new Date(),
    idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  }) {
    this.controlRoot = path.resolve(controlRoot);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runtime = runtime;
    // 生产构造必须显式装配 Profile；测试 Runtime 也只能通过测试代码主动注入。
    this.agentProfile = normalizeAgentProfile(agentProfile);
    this.clock = clock;
    this.idFactory = idFactory;
    this.instanceId = idFactory("controller");
    this.controlStore = new ControlStore(this.controlRoot, { clock });
    this.runStore = new RunStore(this.controlRoot);
    this.evidenceStore = new EvidenceStore(this.controlRoot);
    this.repositoryWorker = new RepositoryWorker({
      workspaceRoot: this.workspaceRoot,
    });
    this.combinedValidator = new CombinedValidator({
      controlRoot: this.controlRoot,
      repositoryWorker: this.repositoryWorker,
      evidenceStore: this.evidenceStore,
      clock,
    });
  }

  static async open(options) {
    // 只返回完成存储初始化的实例，避免首个命令与目录创建发生竞争。
    const service = new ChangeFleetService(options);
    await Promise.all([
      service.controlStore.initialize(),
      service.runStore.initialize(),
      service.evidenceStore.initialize(),
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
      });
    }
    repositories.sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
    const normalizedProject = {
      project_id: project.project_id,
      description: optionalString(project.description),
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

  async createChangeSet({
    idempotency_key,
    change_set_id,
    project_id,
    intent,
    planning_repository_ids,
    repository_selections,
  }) {
    // 创建命令先固定调用者请求，再解析分支；已完成重试绝不能重新观察移动后的 ref。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("project_id", project_id);
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
    const result = {
      change_set_id,
      repository_selection_revision: 1,
      repositories: structuredClone(repositorySelection.repositories),
    };
    const fingerprint = commandFingerprint("createChangeSet", input);
    const state = {
      schema_version: CONTROL_SCHEMA_VERSION,
      change_set_id,
      project_id,
      state: "analyzing",
      intents: [normalizedIntent],
      current_intent_revision: 1,
      repository_selection_revisions: [repositorySelection],
      current_repository_selection_revision: 1,
      repository_selection_change_requests: [],
      plans: [],
      current_plan_revision: null,
      work_units: [],
      run_references: [],
      candidates: [],
      bundles: [],
      decisions: [],
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

  async reviseRepositorySelection({
    idempotency_key,
    change_set_id,
    current_repository_selection_revision,
    planning_repository_ids,
    repository_selections,
    actor = "human",
  }) {
    // 修订先校验旧 revision，再解析新分支，避免旧页面覆盖刚刚确认的新选择。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
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
      actor,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "reviseRepositorySelection",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    await this.recoverInterruptedPlanningRuns(change_set_id, project);
    initialState = await this.controlStore.readChangeSet(change_set_id);
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

    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "reviseRepositorySelection",
        input: commandInput,
        perform: () => {
          assertRepositorySelectionRevisionAllowed(
            state,
            current_repository_selection_revision,
          );
          const priorSelection = currentRepositorySelection(state);
          priorSelection.status = "superseded";
          priorSelection.superseded_at = this.now();

          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of unitsForCurrentPlan(state)) {
            if (!["candidate_ready", "failed", "blocked"].includes(workUnit.state)) {
              workUnit.state = "superseded";
            }
          }

          state.repository_selection_revisions.push(nextSelection);
          state.current_repository_selection_revision = nextRevision;
          state.current_plan_revision = null;
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
            actor,
            decided_at: this.now(),
          });
          state.state = "analyzing";
          state.updated_at = this.now();
          return {
            change_set_id,
            repository_selection_revision: nextRevision,
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

  async planChangeSet({
    idempotency_key,
    change_set_id,
    agent_profile = null,
  }) {
    normalizeId("idempotency_key", idempotency_key);
    const agentProfile = normalizeAgentProfile(
      agent_profile ?? this.agentProfile,
    );
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const commandInput = { change_set_id, agent_profile: agentProfile };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "planChangeSet",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    await this.recoverInterruptedPlanningRuns(change_set_id, project);
    initialState = await this.controlStore.readChangeSet(change_set_id);

    const repositorySelection = currentRepositorySelection(initialState);
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
    const nextRevision = initialState.plans.length + 1;
    const planningAttempt =
      initialState.run_references.filter(
        (reference) => reference.operation === "planning",
      ).length + 1;
    const runId = this.idFactory("run");
    const bases = {};
    const repositoriesForContext = [];
    const planningWorkspaces = [];
    // 规划只消费创建时已冻结的选择，不能再次读取分支 tip 或登记默认值。
    try {
      for (const selection of repositorySelection.repositories) {
        const repository = projectRepositories.get(selection.repository_id);
        const base = {
          repository_id: selection.repository_id,
          target_ref: selection.target_ref,
          base_sha: selection.resolved_base_sha,
        };
        const workspace =
          await this.repositoryWorker.preparePlanningWorkspace({
            repository,
            baseSha: base.base_sha,
            workspaceId: `planning-${runId}`,
          });
        planningWorkspaces.push(workspace);
        bases[selection.repository_id] = base;
        repositoriesForContext.push({
          repository_id: repository.repository_id,
          description: repository.description,
          branch_ref: selection.branch_ref,
          target_ref: base.target_ref,
          base_sha: base.base_sha,
          root_path: workspace.workspace_path,
          harness_resources: await this.repositoryWorker.discoverHarness(
            repository,
            base.base_sha,
          ),
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
      authorizedRepositories: repositorySelection.repositories.map(
        (selection) => selection.repository_id,
      ),
      allowedOutcomes: [
        "plan_proposed",
        "repository_selection_change_request",
        "scope_expansion",
        "decision_request",
        "blocked",
      ],
      humanGates: ["multi_repository_plan_confirmation"],
    });
    const contextProjection = createContextProjection({
      operation: "planning",
      changeSet: initialState,
      plan: currentPlan(initialState),
      repositorySelection,
      repositories: repositoriesForContext,
      capability: {
        mode: "read_only",
        paths: planningWorkspaces.map(
          (workspace) => workspace.workspace_path,
        ),
      },
      requiredEvidence: ["change_plan", "risks", "unverified_boundaries"],
      historyReferences: initialState.plans.map((plan) => ({
        kind: "plan_revision",
        revision: plan.revision,
        status: plan.status,
      })),
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
    await this.runStore.create({
      schema_version: 1,
      run_id: runId,
      change_set_id,
      work_unit_id: null,
      operation: "planning",
      attempt: planningAttempt,
      status: "running",
      agent_profile: agentProfile,
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
    await this.controlStore.transactChangeSet(change_set_id, (state) => {
      invariant(
        state.current_repository_selection_revision ===
          repositorySelection.revision,
        "STALE_REPOSITORY_SELECTION_REVISION",
        "Repository selection changed before planning dispatch",
      );
      state.run_references.push({
        run_id: runId,
        operation: "planning",
        plan_revision: state.current_plan_revision,
        attempt: planningAttempt,
        status: "running",
      });
      state.updated_at = this.now();
    });

    let outcome;
    let providerEvidence = null;
    let repositorySelectionChangeRequest = null;
    let normalizedPlan = null;
    let runtimeError = null;
    try {
      const result = await invokeRuntime(this.runtime, invocation, {
        onEvent: (event) => this.appendRuntimeEvent(runId, event),
      });
      outcome = result.outcome;
      providerEvidence = result.provider_evidence;
      invariant(
        ["plan_proposed", "repository_selection_change_request"].includes(
          outcome.type,
        ),
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Planning returned unsupported outcome ${outcome.type}`,
      );
      if (outcome.type === "repository_selection_change_request") {
        repositorySelectionChangeRequest =
          normalizeRepositorySelectionChangeRequest(outcome, project);
      } else {
        // Runtime 输出在 Run 完成前完成规范化，非法计划不能被误记为成功的规划 Run。
        normalizedPlan = normalizePlan(outcome.plan, {
          project: planningProject,
          bases,
          intentRevision: initialState.current_intent_revision,
          repositorySelectionRevision: repositorySelection.revision,
          revision: nextRevision,
          createdAt: this.now(),
        });
        normalizedPlan.agent_profile = structuredClone(agentProfile);
        normalizedPlan.planning_run_id = runId;
      }
    } catch (error) {
      runtimeError = error;
      providerEvidence = error.runtime_evidence ?? null;
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
      run.outcome = { type: outcome.type };
    });

    return this.controlStore.transactChangeSet(change_set_id, (state) => {
      const result = applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "planChangeSet",
        input: commandInput,
        perform: () => {
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
          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of state.work_units.filter(
            (unit) => unit.plan_revision === state.current_plan_revision,
          )) {
            if (!["candidate_ready", "failed", "blocked"].includes(workUnit.state)) {
              workUnit.state = "superseded";
            }
          }
          const plan = structuredClone(normalizedPlan);
          state.plans.push(plan);
          state.current_plan_revision = plan.revision;
          state.work_units.push(
            ...plan.work_units.map((workUnit) => ({
              ...workUnit,
              plan_revision: plan.revision,
              state: "pending",
              workspace: null,
              run_references: [],
              candidate: null,
              last_error: null,
            })),
          );
          const runReference = state.run_references.find(
            (reference) => reference.run_id === runId,
          );
          invariant(
            runReference?.status === "running",
            "RUN_REFERENCE_STATE_MISMATCH",
            `Planning Run ${runId} has no running reference`,
          );
          runReference.plan_revision = plan.revision;
          runReference.status = "completed";
          state.state = "awaiting_plan_confirmation";
          state.updated_at = this.now();
          return {
            change_set_id,
            plan_revision: plan.revision,
            plan: structuredClone(plan),
          };
        },
      });
      return result;
    });
  }

  async confirmPlanRevision({
    idempotency_key,
    change_set_id,
    plan_revision,
    actor = "human",
  }) {
    // 确认绑定当前精确 revision，旧页面上的批准不能套用到新计划。
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "confirmPlanRevision",
        input: { change_set_id, plan_revision, actor },
        perform: () => {
          invariant(
            state.state === "awaiting_plan_confirmation",
            "INVALID_CHANGE_SET_STATE",
            `ChangeSet is not awaiting plan confirmation`,
          );
          invariant(
            state.current_plan_revision === plan_revision,
            "STALE_PLAN_CONFIRMATION",
            `Plan revision ${plan_revision} is not current`,
          );
          const plan = currentPlan(state);
          plan.status = "confirmed";
          plan.confirmed_at = this.now();
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "plan_confirmation",
            plan_revision,
            actor,
            decided_at: this.now(),
          });
          state.state = "ready";
          state.updated_at = this.now();
          return { change_set_id, plan_revision, status: "confirmed" };
        },
      }),
    );
  }

  async executeChangeSet({ idempotency_key, change_set_id }) {
    // 单一 scheduler 所有者负责恢复和派发，防止多控制器重复执行 WorkUnit。
    normalizeId("idempotency_key", idempotency_key);
    const commandInput = { change_set_id };
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
          if (existing?.status === "failed") {
            throw new ChangeFleetError(
              "COMMAND_PREVIOUSLY_FAILED",
              `Execution command ${idempotency_key} previously failed`,
              existing.error,
            );
          }
          invariant(
            ["ready", "executing", "validating", "candidate_review"].includes(
              state.state,
            ),
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

      while (true) {
        const state = await this.controlStore.readChangeSet(change_set_id);
        const plan = currentPlan(state);
        invariant(
          plan?.status === "confirmed",
          "PLAN_CONFIRMATION_REQUIRED",
          "Current plan is not confirmed",
        );
        const currentUnits = unitsForCurrentPlan(state);
        const incomplete = currentUnits.filter(
          (unit) => unit.state !== "candidate_ready",
        );
        if (incomplete.length === 0) break;
        const ready = incomplete.find(
          (unit) =>
            unit.state === "pending" &&
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
        await this.executeWorkUnit(change_set_id, ready.work_unit_id);
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
      const combinedEvidence = await this.combinedValidator.validate({
        subject,
        candidates,
        repositories,
        command: plan.combined_check,
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

  async recordBundleDecision({
    idempotency_key,
    change_set_id,
    bundle_revision,
    bundle_hash,
    decision,
    actor = "human",
  }) {
    // 人工决策同时绑定 revision 与 hash，Candidate 或证据变化后旧批准立即失效。
    const normalizedDecision = normalizeHumanDecision(decision);
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
          actor,
        },
        perform: () => {
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
            actor,
            decided_at: this.now(),
          };
          state.decisions.push(record);
          state.state =
            normalizedDecision === "accept"
              ? "delivery_ready"
              : normalizedDecision === "request_revision"
                ? "replanning"
                : "done";
          state.updated_at = this.now();
          return structuredClone(record);
        },
      }),
    );
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

  async executeWorkUnit(changeSetId, workUnitId) {
    // 先创建 Run 再标记 running，崩溃最多留下孤立记录，不留下无来源派发。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const workUnit = unitsForCurrentPlan(state).find(
      (candidate) => candidate.work_unit_id === workUnitId,
    );
    invariant(
      workUnit?.state === "pending",
      "WORK_UNIT_NOT_READY",
      `WorkUnit ${workUnitId} is not pending`,
    );
    const repository = project.repositories.find(
      (candidate) => candidate.repository_id === workUnit.repository_id,
    );
    const selectedRepository = repositorySelection.repositories.find(
      (candidate) => candidate.repository_id === workUnit.repository_id,
    );
    const workspaceId = `${changeSetId}.${plan.revision}.${workUnitId}`;
    const workspace = await this.repositoryWorker.prepareWorkspace({
      repository,
      targetRef: workUnit.target_ref,
      baseSha: workUnit.base_sha,
      workspaceId,
    });
    const runId = this.idFactory("run");
    const attempt = workUnit.run_references.length + 1;
    const run = {
      schema_version: 1,
      run_id: runId,
      change_set_id: changeSetId,
      work_unit_id: workUnitId,
      operation: "execution",
      attempt,
      status: "running",
      agent_profile: plan.agent_profile,
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
        currentUnit.state === "pending",
        "DUPLICATE_DISPATCH",
        `WorkUnit ${workUnitId} already left pending state`,
      );
      currentUnit.state = "running";
      currentUnit.workspace = workspace;
      currentUnit.run_references.push({
        run_id: runId,
        attempt,
        status: "running",
      });
      current.run_references.push({
        run_id: runId,
        operation: "execution",
        plan_revision: plan.revision,
        work_unit_id: workUnitId,
        status: "running",
      });
      current.state = "executing";
      current.updated_at = this.now();
    });

    const currentState = await this.controlStore.readChangeSet(changeSetId);
    const currentUnit = unitsForCurrentPlan(currentState).find(
      (candidate) => candidate.work_unit_id === workUnitId,
    );
    const controlContract = createControlContract({
      operation: "execution",
      changeSetId,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      workUnitId,
      authorizedRepositories: [workUnit.repository_id],
      allowedOutcomes: [
        "implementation_completed",
        "plan_revision",
        "scope_expansion",
        "decision_request",
        "blocked",
      ],
      humanGates: [],
    });
    const contextProjection = createContextProjection({
      operation: "execution",
      changeSet: currentState,
      plan,
      repositorySelection,
      workUnit: currentUnit,
      repositories: [
        {
          repository_id: repository.repository_id,
          branch_ref: selectedRepository.branch_ref,
          target_ref: workUnit.target_ref,
          base_sha: workUnit.base_sha,
          harness_resources: await this.repositoryWorker.discoverHarness(
            repository,
            workUnit.base_sha,
          ),
        },
      ],
      capability: {
        mode: "read_write",
        paths: [workspace.workspace_path],
      },
      requiredEvidence: ["structured_outcome", "candidate", "repository_check"],
      historyReferences: workUnit.run_references.map((reference) => ({
        kind: "run",
        run_id: reference.run_id,
        status: reference.status,
      })),
    });
    const invocation = {
      operation: "execution",
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
        outcome.type === "implementation_completed",
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Execution returned ${outcome.type}, expected implementation_completed`,
      );
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
        current.outcome = { type: outcome.type };
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) => candidate.work_unit_id === workUnitId,
        );
        unit.run_references.at(-1).status = "completed";
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
      await this.failWorkUnit(changeSetId, workUnitId, error);
      throw error;
    }

    try {
      const published = await this.repositoryWorker.publishCandidate({
        repository,
        workspace,
        expectedHead: workUnit.base_sha,
        message: `ChangeFleet ${changeSetId} ${workUnitId}`,
      });
      const repositoryEvidence = await this.validateRepositoryCandidate({
        repository,
        candidate: published,
        command: workUnit.repository_check,
      });
      const candidate = createCandidate({
        repositoryId: published.repository_id,
        targetRef: published.target_ref,
        baseSha: published.base_sha,
        candidateSha: published.candidate_sha,
        workspaceId: published.workspace_id,
        workspacePath: published.workspace_path,
        changedPaths: published.changed_paths,
        repositoryEvidence,
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        unit.state = "candidate_ready";
        unit.candidate = candidate;
        unit.run_references.at(-1).status = "completed";
        const runReference = current.run_references.find(
          (reference) => reference.run_id === runId,
        );
        runReference.status = "completed";
        current.candidates.push(candidate);
        current.updated_at = this.now();
      });
      return candidate;
    } catch (error) {
      await this.failWorkUnit(changeSetId, workUnitId, error);
      throw error;
    }
  }

  async validateRepositoryCandidate({ repository, candidate, command }) {
    // 检查前后锁定 HEAD 与 clean 状态，Evidence 始终对应同一精确 SHA 主体。
    await this.repositoryWorker.preflightCandidate({ repository, candidate });
    const commandResult = await runCommand(command, {
      cwd: candidate.workspace_path,
    });
    let postflightError = null;
    try {
      await this.repositoryWorker.preflightCandidate({ repository, candidate });
    } catch (error) {
      postflightError = error;
    }
    const evidence = await this.evidenceStore.record({
      kind: "repository_validation",
      subject: {
        repository_id: candidate.repository_id,
        target_ref: candidate.target_ref,
        base_sha: candidate.base_sha,
        candidate_sha: candidate.candidate_sha,
      },
      payload: {
        command: commandResult,
        postflight: postflightError
          ? {
              status: "failed",
              code: postflightError.code,
              message: postflightError.message,
            }
          : { status: "passed" },
      },
      createdAt: this.now(),
    });
    if (
      commandResult.exit_code !== 0 ||
      commandResult.timed_out ||
      commandResult.output_overflow ||
      postflightError
    ) {
      throw new ChangeFleetError(
        "REPOSITORY_VALIDATION_FAILED",
        `Repository check failed for ${candidate.repository_id}`,
        { evidence, command_result: commandResult },
      );
    }
    return evidence;
  }

  async cleanupPlanningWorkspaces({
    planningWorkspaces,
    projectRepositories,
  }) {
    // 逐个清理并保留首个错误，避免一个仓库异常导致其余临时 worktree 永久泄漏。
    let firstError = null;
    for (const workspace of [...planningWorkspaces].reverse()) {
      const repository = projectRepositories.get(workspace.repository_id);
      try {
        await this.repositoryWorker.cleanupPlanningWorkspace({
          repository,
          workspace,
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
      if (workUnit.run_references.at(-1)?.status === "running") {
        workUnit.run_references.at(-1).status = "failed";
      }
      const runReference = state.run_references.find(
        (reference) =>
          reference.run_id === workUnit.run_references.at(-1)?.run_id,
      );
      if (runReference) runReference.status = "failed";
      state.state = "failed";
      state.blockers.push({
        code: error.code ?? "UNEXPECTED_ERROR",
        work_unit_id: workUnitId,
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
      if (!["candidate_review", "delivery_ready", "done"].includes(state.state)) {
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

function assertRepositorySelectionRevisionAllowed(state, expectedRevision) {
  invariant(
    Number.isSafeInteger(expectedRevision) && expectedRevision > 0,
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "Current Repository selection revision must be a positive integer",
  );
  invariant(
    ["analyzing", "awaiting_plan_confirmation", "replanning"].includes(
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
