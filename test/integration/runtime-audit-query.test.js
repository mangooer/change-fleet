import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import { ChangeFleetError } from "../../src/domain/errors.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("read-only Runtime audit queries", () => {
  test("keeps the query component outside Runtime, scheduler, Git, and workspace adapters", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src",
        "application",
        "runtime-audit-query-service.js",
      ),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /adapters\/|ChangeFleetService|RepositoryWorker|WorkUnitScheduler|invokeRuntime/,
    );
  });

  test("reproduces bounded Run and ChangeSet facts without writing or entering context", async (t) => {
    const fixture = await createAuditFixture(t, "complete", UsageRuntime);
    const execution = await fixture.service.executeChangeSet({
      idempotency_key: "execute",
      change_set_id: "change",
    });
    await fixture.service.recordBundleDecision({
      idempotency_key: "decision",
      change_set_id: "change",
      bundle_revision: execution.bundle_revision,
      bundle_hash: execution.bundle_hash,
      decision: "accept",
    });
    await fixture.service.closeChangeSet({
      idempotency_key: "close",
      change_set_id: "change",
      actor: "human",
      reason: {
        code: "no_longer_needed",
        summary: "Close after preserving the measured Runtime history",
      },
    });
    const query = createQuery(fixture.service, "2026-08-03T10:00:00.000Z");
    const before = await directoryDigest(fixture.controlRoot);
    const changeAudit = await query.getChangeSetAudit("change", {
      detail_page: 1,
      page_size: 1,
    });
    const state = await fixture.service.readChangeSet("change");
    const planningRunId = state.run_references.find(
      (reference) => reference.operation === "planning",
    ).run_id;
    const runAudit = await query.getRunAudit(planningRunId);
    const after = await directoryDigest(fixture.controlRoot);

    assert.equal(before, after);
    assert.equal(changeAudit.payload.usage.referenced_run_count, 2);
    assert.equal(changeAudit.payload.usage.observed_run_count, 2);
    assert.equal(changeAudit.payload.usage.unknown_run_count, 0);
    assert.equal(changeAudit.payload.usage.observed_total_tokens, 350);
    assert.equal(changeAudit.payload.identity.state, "abandoned");
    assert.equal(changeAudit.payload.timing.change_set_wall.complete, true);
    assert.equal(
      changeAudit.payload.usage.token_fields.cached_input_tokens.observed_sum,
      120,
    );
    assert.equal(
      changeAudit.payload.timing.provider_duration_sum.observed_sum,
      3_000,
    );
    assert.equal(changeAudit.payload.runs.referenced_count, 2);
    assert.equal(changeAudit.payload.runs.shown_count, 1);
    assert.equal(changeAudit.payload.runs.rows.length, 1);
    assert.deepEqual(changeAudit.payload.outcomes.runtime_attempts, {
      completed: 2,
    });
    assert.deepEqual(changeAudit.payload.outcomes.planning, {
      conversation_message: 1,
    });
    assert.deepEqual(changeAudit.payload.outcomes.work_units, {
      candidate_ready: 1,
    });
    assert.deepEqual(changeAudit.payload.outcomes.validation, { passed: 2 });
    assert.equal(changeAudit.payload.validation.referenced_count, 2);
    assert.equal(
      changeAudit.payload.validation.rows.every(
        (row) =>
          row.attempt?.effective_budget?.timeout_ms === 10_000 &&
          typeof row.attempt.check_identity?.check_identity_hash === "string",
      ),
      true,
    );
    assert.deepEqual(changeAudit.payload.outcomes.human_review, { accept: 1 });
    assert.equal(changeAudit.payload.outcomes.delivery.reason, "not_started");
    assert.equal(runAudit.payload.usage.canonical.coverage, "aggregate_only");
    assert.equal(runAudit.payload.usage.canonical.total_tokens, 120);
    assert.equal(runAudit.payload.usage.canonical.input_tokens, 100);
    assert.equal(runAudit.payload.usage.canonical.cached_input_tokens, 40);
    assert.equal(runAudit.payload.usage.canonical.output_tokens, 20);
    assert.equal(runAudit.payload.usage.canonical.reasoning_output_tokens, 5);
    assert.doesNotMatch(
      JSON.stringify(fixture.runtime.invocations),
      /RunAuditProjection|ChangeSetAuditProjection|observed_total_tokens/,
    );

    const reopened = await ChangeFleetService.open({
      ...fixture.options,
      runtime: fixture.runtime,
    });
    const restartedAudit = await createQuery(
      reopened,
      "2026-08-03T11:00:00.000Z",
    ).getChangeSetAudit("change", { detail_page: 1, page_size: 1 });
    assert.notEqual(changeAudit.generated_at, restartedAudit.generated_at);
    assert.equal(changeAudit.payload_digest, restartedAudit.payload_digest);

    await assert.rejects(
      query.getChangeSetAudit("change", { page_size: 101 }),
      { code: "INVALID_AUDIT_QUERY" },
    );

    const planningRun = await fixture.service.runStore.read(planningRunId);
    const evidencePath = path.join(
      fixture.controlRoot,
      "evidence",
      `${planningRun.runtime_evidence.evidence_id}.json`,
    );
    const corrupted = JSON.parse(await readFile(evidencePath, "utf8"));
    corrupted.payload.provider.name = "tampered-provider";
    await writeFile(evidencePath, `${JSON.stringify(corrupted)}\n`, "utf8");
    await assert.rejects(query.getRunAudit(planningRunId), {
      code: "AUDIT_SOURCE_IDENTITY_MISMATCH",
    });
  });

  test("keeps cancellation separate from WorkUnit failure", async (t) => {
    const fixture = await createAuditFixture(t, "cancelled", CancellationRuntime);
    await assert.rejects(
      fixture.service.executeChangeSet({
        idempotency_key: "execute",
        change_set_id: "change",
      }),
      { code: "RUNTIME_CANCELLED" },
    );
    const audit = await createQuery(
      fixture.service,
      "2026-08-03T12:00:00.000Z",
    ).getChangeSetAudit("change");
    assert.deepEqual(audit.payload.outcomes.runtime_attempts, {
      cancelled: 1,
      completed: 1,
    });
    assert.deepEqual(audit.payload.outcomes.work_units, { failed: 1 });
    assert.equal(audit.payload.usage.observed_total_tokens, null);
    assert.equal(audit.payload.usage.unknown_run_count, 2);
  });

  test("preserves abandoned attempts and retry outcomes after restart", async (t) => {
    const fixture = await createAuditFixture(t, "abandoned", InterruptRuntime);
    await assert.rejects(
      fixture.service.executeChangeSet({
        idempotency_key: "execute",
        change_set_id: "change",
      }),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await ChangeFleetService.open({
      ...fixture.options,
      runtime: retryRuntime,
    });
    await reopened.executeChangeSet({
      idempotency_key: "execute",
      change_set_id: "change",
    });
    const audit = await createQuery(
      reopened,
      "2026-08-03T13:00:00.000Z",
    ).getChangeSetAudit("change");
    assert.deepEqual(audit.payload.outcomes.runtime_attempts, {
      abandoned: 1,
      completed: 2,
    });
    assert.equal(audit.payload.usage.referenced_run_count, 3);
    assert.equal(audit.payload.usage.unknown_run_count, 3);
    assert.deepEqual(
      audit.payload.runs.rows.map((row) => row.terminal.status),
      ["completed", "abandoned", "completed"],
    );
  });

  test("attributes blocked and successful pre-Candidate attempts to one ChangeSet", async (t) => {
    const fixture = await createAuditFixture(t, "provider-retry", BlockedUsageRuntime);
    await assert.rejects(
      fixture.service.executeChangeSet({
        idempotency_key: "execute-blocked",
        change_set_id: "change",
      }),
      { code: "RUNTIME_IMPLEMENTATION_BLOCKED" },
    );
    const retryRuntime = new UsageRuntime({ plan: fixture.plan });
    const reopened = await ChangeFleetService.open({
      ...fixture.options,
      runtime: retryRuntime,
    });
    await reopened.executeChangeSet({
      idempotency_key: "execute-retry",
      change_set_id: "change",
    });

    const audit = await createQuery(
      reopened,
      "2026-08-03T14:00:00.000Z",
    ).getChangeSetAudit("change");
    const state = await reopened.readChangeSet("change");
    assert.equal(audit.payload.usage.referenced_run_count, 3);
    assert.equal(audit.payload.usage.observed_run_count, 3);
    assert.equal(audit.payload.usage.observed_total_tokens, 580);
    assert.deepEqual(audit.payload.outcomes.runtime_attempts, {
      completed: 3,
    });
    assert.equal(
      state.decisions.some((decision) => decision.type === "provider_retry"),
      true,
    );
  });
});

class UsageRuntime extends ScriptedRuntime {
  async invoke(invocation) {
    const result = await super.invoke(invocation);
    const planning = invocation.operation === "planning";
    result.provider_evidence = {
      ...result.provider_evidence,
      duration_ms: planning ? 1_000 : 2_000,
      usage_observations: [
        {
          scope: "aggregate",
          confidence: "provider_reported",
          coverage: "aggregate_only",
          input_tokens: planning ? 100 : 200,
          cached_input_tokens: planning ? 40 : 80,
          cache_write_input_tokens: 0,
          output_tokens: planning ? 20 : 30,
          reasoning_output_tokens: planning ? 5 : 10,
          total_tokens: planning ? 120 : 230,
          provider_cost: null,
        },
      ],
    };
    return result;
  }
}

class CancellationRuntime extends ScriptedRuntime {
  async invoke(invocation) {
    if (invocation.operation === "execution") {
      throw new ChangeFleetError(
        "RUNTIME_CANCELLED",
        "Scripted cancellation for audit coverage",
      );
    }
    return super.invoke(invocation);
  }
}

class BlockedUsageRuntime extends UsageRuntime {
  constructor(options) {
    super({
      ...options,
      executionOutcome: {
        type: "implementation_blocked",
        summary: "sandbox setup unavailable",
        changed_paths: [],
        blocker: {
          code: "sandbox_unavailable",
          message: "sandbox setup unavailable",
        },
      },
    });
  }
}

class InterruptRuntime extends ScriptedRuntime {
  constructor(options) {
    super({ ...options, interruptRepository: "api" });
  }
}

async function createAuditFixture(testContext, name, RuntimeClass) {
  const root = await createFixtureRoot(
    testContext,
    `changefleet-audit-${name}-`,
  );
  const repository = await createGitRepository(root, "api");
  const plan = createOneRepositoryPlan(
    await writeCombinedCheckScript(root, 1),
  );
  const runtime = new RuntimeClass({ plan });
  const controlRoot = path.join(root, "control");
  const options = {
    controlRoot,
    workspaceRoot: path.join(root, "workspaces"),
    agentProfile: TEST_AGENT_PROFILE,
  };
  const service = await ChangeFleetService.open({ ...options, runtime });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Audit one exact Repository change" },
  });
  const planned = await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: "change",
  });
  await service.confirmPlanMessage({
    idempotency_key: "confirm",
    change_set_id: "change",
    message_id: planned.message.message_id,
    content_digest: planned.message.content_digest,
  });
  return { root, controlRoot, options, service, runtime, plan };
}

function createQuery(service, generatedAt) {
  return new RuntimeAuditQueryService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    evidenceStore: service.evidenceStore,
    clock: () => new Date(generatedAt),
  });
}

async function directoryDigest(root) {
  const hash = createHash("sha256");
  await appendDirectory(hash, root, root);
  return hash.digest("hex");
}

async function appendDirectory(hash, root, current) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    hash.update(relative);
    if (entry.isDirectory()) await appendDirectory(hash, root, absolute);
    else hash.update(await readFile(absolute));
  }
}
