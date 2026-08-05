import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { CodexSdkRuntime } from "../../src/adapters/runtime/codex-sdk-runtime.js";

const PROFILE = {
  profile_id: "codex-default",
  revision: 1,
  provider: "openai",
  runtime: "codex-sdk",
  model: "gpt-5.4",
  reasoning: "high",
  permissions: "host_user",
  network_access: true,
  skills: [],
  credential_profile_id: "test-credentials",
};
const RUNTIME_OPTIONS = Object.freeze({
  codexHome: path.resolve("test-provider-home"),
  credentialProfileId: "test-credentials",
});

describe("Codex SDK Runtime protocol", () => {
  test("starts a fresh controlled thread and maps aggregate usage", async () => {
    const factoryCalls = [];
    const threadOptions = [];
    const turnOptions = [];
    const prompts = [];
    const events = [];
    const finalResponse = JSON.stringify({
      type: "plan_proposed",
      plan: {
        rationale: null,
        revision_feedback_assessments: [],
        work_units: [
          {
            work_unit_id: "api-unit",
            repository_id: "api",
            task: "Implement the change",
            dependencies: [],
            repository_check: {
              command_id: "api-check",
              executable: "node",
              argv: ["check.mjs"],
              timeout_ms: 10_000,
            },
          },
        ],
        combined_check: {
          command_id: "combined-check",
          executable: "node",
          argv: ["combined-check.mjs"],
          timeout_ms: 10_000,
        },
        risks: [],
        unverified_boundaries: [],
      },
      request: null,
    });
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      environment: {
        PATH: process.env.PATH,
        SECRET_SHOULD_NOT_PASS: "secret",
      },
      codexFactory(options) {
        factoryCalls.push(options);
        return {
          startThread(options_) {
            threadOptions.push(options_);
            return {
              async runStreamed(prompt, turnOptions_) {
                prompts.push(prompt);
                turnOptions.push(turnOptions_);
                return {
                  events: providerEvents(finalResponse),
                };
              },
            };
          },
        };
      },
    });
    const invocation = planningInvocation(process.cwd());

    const first = await runtime.invoke(invocation, {
      onEvent(event) {
        events.push(event);
      },
    });
    const firstHome = factoryCalls[0].env.CODEX_HOME;
    const second = await runtime.invoke(invocation);

    assert.equal(first.outcome.type, "plan_proposed");
    assert.equal(first.provider_evidence.provider.thread_id, "thread-1");
    assert.equal(
      first.provider_evidence.usage_observations[0].coverage,
      "aggregate_only",
    );
    assert.equal(first.provider_evidence.usage_observations[0].total_tokens, 15);
    assert.notEqual(
      first.provider_evidence.invocation_id,
      second.provider_evidence.invocation_id,
    );
    assert.equal(factoryCalls.length, 2);
    assert.equal(factoryCalls[1].env.CODEX_HOME, firstHome);
    assert.equal(firstHome, RUNTIME_OPTIONS.codexHome);
    assert.equal(factoryCalls[0].env.SECRET_SHOULD_NOT_PASS, "secret");
    assert.equal(factoryCalls[0].config, undefined);
    assert.equal(threadOptions[0].sandboxMode, "danger-full-access");
    assert.equal(threadOptions[0].networkAccessEnabled, undefined);
    assert.equal(threadOptions[0].webSearchMode, undefined);
    assert.equal(threadOptions[0].approvalPolicy, "never");
    assert.match(
      prompts[0],
      /at most one WorkUnit for each repository_id; combine all tasks for the same Repository/u,
    );
    assert.match(
      prompts[0],
      /reviewer claim to evaluate, not as an automatic fact or command/u,
    );
    assert.match(prompts[0], /using adopt, adapt, or decline/u);
    assert.equal(turnOptions[0].outputSchema.additionalProperties, false);
    assert.equal(
      events.some(
        (event) => JSON.stringify(event).includes("private reasoning"),
      ),
      false,
    );
    assert.equal(
      events.some((event) =>
        JSON.stringify(event).includes("secret command output"),
      ),
      false,
    );
    const commandEvent = events.find(
      (event) =>
        event.payload.item_type === "command_execution" &&
        event.payload.item_status === "completed",
    );
    assert.equal(commandEvent.payload.output_bytes > 0, true);
    assert.match(commandEvent.payload.output_sha256, /^[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(first).includes("SECRET_SHOULD_NOT_PASS"), false);
  });

  test("retains constrained behavior only for an explicit operation-scoped profile", async () => {
    const factoryCalls = [];
    const threadOptions = [];
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      environment: {
        PATH: process.env.PATH,
        SECRET_SHOULD_NOT_PASS: "secret",
      },
      codexFactory(options) {
        factoryCalls.push(options);
        return {
          startThread(options_) {
            threadOptions.push(options_);
            return {
              async runStreamed() {
                return { events: providerEvents("not-json") };
              },
            };
          },
        };
      },
    });
    const invocation = planningInvocation(process.cwd());
    invocation.agent_profile = {
      ...PROFILE,
      permissions: "operation_scoped",
      network_access: false,
    };

    await assert.rejects(runtime.invoke(invocation), {
      code: "CODEX_RUNTIME_OUTPUT_INVALID",
    });
    assert.equal(factoryCalls[0].env.SECRET_SHOULD_NOT_PASS, undefined);
    assert.equal(factoryCalls[0].config, undefined);
    assert.equal(threadOptions[0].sandboxMode, "read-only");
    assert.equal(threadOptions[0].networkAccessEnabled, false);
    assert.equal(threadOptions[0].webSearchMode, "disabled");
    assert.equal(threadOptions[0].approvalPolicy, "never");
  });

  test("preserves terminal failure evidence without accepting text output", async () => {
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread() {
            return {
              async runStreamed() {
                return {
                  events: (async function* () {
                    yield { type: "thread.started", thread_id: "failed-thread" };
                    yield {
                      type: "turn.failed",
                      error: { message: "provider rejected request" },
                    };
                  })(),
                };
              },
            };
          },
        };
      },
    });

    await assert.rejects(
      runtime.invoke(planningInvocation(path.resolve("."))),
      (error) => {
        assert.equal(error.code, "CODEX_PROVIDER_FAILED");
        assert.equal(
          error.runtime_evidence.provider.thread_id,
          "failed-thread",
        );
        assert.deepEqual(error.runtime_evidence.usage_observations, []);
        return true;
      },
    );
  });

  test("rejects invalid structured output with observed usage attached", async () => {
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread() {
            return {
              async runStreamed() {
                return {
                  events: providerEvents("not-json"),
                };
              },
            };
          },
        };
      },
    });

    await assert.rejects(
      runtime.invoke(planningInvocation(process.cwd())),
      (error) => {
        assert.equal(error.code, "CODEX_RUNTIME_OUTPUT_INVALID");
        assert.equal(
          error.runtime_evidence.usage_observations[0].total_tokens,
          15,
        );
        return true;
      },
    );
  });

  test("maps an aborted owned process to deterministic cancellation evidence", async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread() {
            return {
              async runStreamed() {
                const error = new Error("operation aborted");
                error.name = "AbortError";
                throw error;
              },
            };
          },
        };
      },
    });
    const invocation = planningInvocation(process.cwd());
    invocation.signal = controller.signal;

    await assert.rejects(runtime.invoke(invocation), (error) => {
      assert.equal(error.code, "RUNTIME_CANCELLED");
      assert.equal(error.runtime_evidence.completed_at !== null, true);
      return true;
    });
  });

  test("rejects a missing explicit Provider environment before starting Codex", async () => {
    const runtime = new CodexSdkRuntime({
      credentialProfileId: "test-credentials",
      codexFactory() {
        throw new Error("Provider must not start");
      },
    });

    await assert.rejects(
      runtime.invoke(planningInvocation(process.cwd())),
      { code: "INVALID_RUNTIME_INVOCATION" },
    );
  });
});

function planningInvocation(repositoryPath) {
  return {
    operation: "planning",
    agent_profile: PROFILE,
    control_contract: {
      schema_version: 2,
      operation: "planning",
      change_set_id: "change-1",
      authorized_repositories: ["api"],
    },
    context_projection: {
      schema_version: 2,
      operation: "planning",
      repositories: [{ repository_id: "api", root_path: repositoryPath }],
    },
    capabilities: {
      mode: "read_only",
      paths: [repositoryPath],
    },
    workspace: null,
    signal: null,
  };
}

async function* providerEvents(finalResponse) {
  yield { type: "thread.started", thread_id: "thread-1" };
  yield { type: "turn.started" };
  yield {
    type: "item.completed",
    item: {
      id: "reasoning-1",
      type: "reasoning",
      text: "private reasoning",
    },
  };
  yield {
    type: "item.completed",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "secret command",
      aggregated_output: "secret command output",
      exit_code: 0,
      status: "completed",
    },
  };
  yield {
    type: "item.completed",
    item: {
      id: "message-1",
      type: "agent_message",
      text: finalResponse,
    },
  };
  yield {
    type: "turn.completed",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 4,
      cache_write_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 3,
    },
  };
}
