import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  commandFingerprint,
  createCandidate,
  createCandidateBundle,
  createValidationSubject,
  normalizeHumanDecision,
  normalizeId,
  normalizeIntent,
  normalizePlan,
} from "../domain/model.js";
import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../domain/runtime-context.js";
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

const DEFAULT_AGENT_PROFILE = Object.freeze({
  profile_id: "deterministic-fake",
  provider: "deterministic",
  runtime: "scripted",
  model: "fixture",
  reasoning: "deterministic",
  permissions: "operation_scoped",
  skills: [],
});

// 应用服务是确定性编排入口：语义工作交给 Runtime，权限、状态和证据在此裁决。
export class ChangeFleetService {
  constructor({
    controlRoot,
    workspaceRoot,
    runtime,
    clock = () => new Date(),
    idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  }) {
    this.controlRoot = path.resolve(controlRoot);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runtime = runtime;
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
  }) {
    // 创建时即落下幂等结果，客户端重试不会生成第二个业务变更。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("project_id", project_id);
    const catalog = await this.controlStore.readCatalog();
    invariant(
      catalog.projects[project_id],
      "PROJECT_NOT_FOUND",
      `Project ${project_id} does not exist`,
    );
    const now = this.now();
    const normalizedIntent = normalizeIntent(intent, {
      revision: 1,
      confirmedAt: now,
    });
    const input = {
      change_set_id,
      project_id,
      intent: intentFingerprint(normalizedIntent),
    };
    const fingerprint = commandFingerprint("createChangeSet", input);
    const state = {
      schema_version: CONTROL_SCHEMA_VERSION,
      change_set_id,
      project_id,
      state: "analyzing",
      intents: [normalizedIntent],
      current_intent_revision: 1,
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
          result: { change_set_id },
          completed_at: now,
        },
      },
      created_at: now,
      updated_at: now,
    };
    try {
      await this.controlStore.createChangeSet(state);
      return { change_set_id };
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

  async planChangeSet({
    idempotency_key,
    change_set_id,
    agent_profile = DEFAULT_AGENT_PROFILE,
  }) {
    normalizeId("idempotency_key", idempotency_key);
    const catalog = await this.controlStore.readCatalog();
    const initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const bases = {};
    const repositoriesForContext = [];
    // Project 是授权上限；先冻结可授权基线，再由计划选择本次非空子集。
    for (const repository of project.repositories) {
      const base = await this.repositoryWorker.freezeBase(repository);
      bases[repository.repository_id] = base;
      repositoriesForContext.push({
        repository_id: repository.repository_id,
        description: repository.description,
        target_ref: base.target_ref,
        base_sha: base.base_sha,
        root_path: repository.resolved_git_root,
        harness_resources: await this.repositoryWorker.discoverHarness(
          repository,
          base.base_sha,
        ),
      });
    }
    const commandInput = { change_set_id, agent_profile };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "planChangeSet",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);

    const nextRevision = initialState.plans.length + 1;
    const runId = this.idFactory("run");
    const controlContract = createControlContract({
      operation: "planning",
      changeSetId: change_set_id,
      planRevision: initialState.current_plan_revision,
      authorizedRepositories: project.repositories.map(
        (repository) => repository.repository_id,
      ),
      allowedOutcomes: [
        "plan_proposed",
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
      repositories: repositoriesForContext,
      capability: {
        mode: "read_only",
        paths: project.repositories.map(
          (repository) => repository.resolved_git_root,
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
      agent_profile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace: null,
      signal: null,
    };
    const contextEvidence = assessInitialContext({
      controlContract,
      contextProjection,
      agentProfile: agent_profile,
      runtimeMeasurement: await measureInitialContext(this.runtime, invocation),
    });
    await this.runStore.create({
      schema_version: 1,
      run_id: runId,
      change_set_id,
      work_unit_id: null,
      operation: "planning",
      attempt: nextRevision,
      status: "running",
      agent_profile,
      context_evidence: contextEvidence,
      created_at: this.now(),
      completed_at: null,
      outcome: null,
    });

    let outcome;
    try {
      outcome = await invokeRuntime(this.runtime, invocation);
      invariant(
        outcome.type === "plan_proposed",
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Planning returned ${outcome.type}, expected plan_proposed`,
      );
      await this.runStore.appendEvent(runId, {
        event_id: this.idFactory("event"),
        type: "runtime.outcome",
        at: this.now(),
        payload: outcome,
      });
      await this.runStore.update(runId, (run) => {
        run.status = "completed";
        run.completed_at = this.now();
        run.outcome = { type: outcome.type };
      });
    } catch (error) {
      await this.failRun(runId, error);
      throw error;
    }

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
          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of state.work_units.filter(
            (unit) => unit.plan_revision === state.current_plan_revision,
          )) {
            if (!["candidate_ready", "failed", "blocked"].includes(workUnit.state)) {
              workUnit.state = "superseded";
            }
          }
          const plan = normalizePlan(outcome.plan, {
            project,
            bases,
            intentRevision: state.current_intent_revision,
            revision: nextRevision,
            createdAt: this.now(),
          });
          plan.agent_profile = structuredClone(agent_profile);
          plan.planning_run_id = runId;
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
          state.run_references.push({
            run_id: runId,
            operation: "planning",
            plan_revision: plan.revision,
            status: "completed",
          });
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
      if (run.status === "running") {
        await this.runStore.update(run.run_id, (current) => {
          current.status = "abandoned";
          current.completed_at = this.now();
          current.outcome = { type: "controller_restart" };
        });
        await this.runStore.appendEvent(run.run_id, {
          event_id: this.idFactory("event"),
          type: "run.abandoned",
          at: this.now(),
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
      workUnit: currentUnit,
      repositories: [
        {
          repository_id: repository.repository_id,
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
    });

    let outcome;
    try {
      outcome = await invokeRuntime(this.runtime, invocation);
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
      await this.runStore.update(runId, (current) => {
        current.status = "completed";
        current.completed_at = this.now();
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

function currentPlan(state) {
  return (
    state.plans.find(
      (plan) => plan.revision === state.current_plan_revision,
    ) ?? null
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
