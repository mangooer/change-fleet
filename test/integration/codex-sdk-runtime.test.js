import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import {
  CODEX_SDK_VERSION,
  CodexSdkRuntime,
} from "../../src/adapters/runtime/codex-sdk-runtime.js";

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
      type: "conversation_message",
      message: {
        text: "The exact plan is ready for approval.",
        intent_draft: {
          objective: "Implement the requested API behavior.",
          rationale: null,
          constraints: [],
          non_goals: [],
          acceptance_criteria: ["The requested API behavior works."],
          resolved_decisions: [],
          open_questions: [],
        },
        plan: {
          summary: "Implement the requested API behavior.",
          steps: ["Update the API implementation."],
          validation: ["Run the relevant project-native checks."],
          risks: [],
          assumptions: [],
          revision_feedback_assessments: [],
        },
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

    assert.equal(first.outcome.type, "conversation_message");
    assert.equal(first.provider_evidence.provider.thread_id, "thread-1");
    assert.equal(
      first.provider_evidence.provider.sdk_version,
      CODEX_SDK_VERSION,
    );
    assert.equal(first.provider_evidence.provider.cli_version, null);
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
      /A ready plan contains only summary, steps, validation, risks, assumptions/u,
    );
    assert.match(
      prompts[0],
      /Do not echo WorkUnit ids, Git SHAs or refs, AgentProfile, budgets/u,
    );
    assert.match(
      prompts[0],
      /ChangeFleet owns those facts in workspace_control/u,
    );
    assert.match(
      prompts[0],
      /Validation describes what should be proven semantically/u,
    );
    assert.match(prompts[0], /do not manufacture argv commands/u);
    assert.match(
      prompts[0],
      /reviewer claim to evaluate, not as an automatic fact or command/u,
    );
    assert.match(
      prompts[0],
      /include their completion in the same Repository WorkUnit and evidence/u,
    );
    assert.match(
      prompts[0],
      /Do not invent requirements, artifacts, commands, or formats/u,
    );
    assert.doesNotMatch(prompts[0], /maintenance, governance|documentation, or status/u);
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

  test("runs independent verification with a strict read-only schema and prompt", async () => {
    const threadOptions = [];
    const turnOptions = [];
    const prompts = [];
    const finalResponse = JSON.stringify({
      type: "verification_completed",
      review_depth: "deep_review",
      summary: "The exact diff satisfies the confirmed contract.",
      assessment: {
        verdict: "pass_with_notes",
        findings: [],
        notes: [
          { note_id: "note-1", message: "Another host remains unverified." },
        ],
        human_decision: null,
        requested_checks: [],
      },
    });
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread(options) {
            threadOptions.push(options);
            return {
              async runStreamed(prompt, options_) {
                prompts.push(prompt);
                turnOptions.push(options_);
                return { events: providerEvents(finalResponse) };
              },
            };
          },
        };
      },
    });

    const result = await runtime.invoke(verificationInvocation(process.cwd()));

    assert.equal(result.outcome.verdict, "pass_with_notes");
    assert.equal(threadOptions[0].sandboxMode, "read-only");
    assert.equal(turnOptions[0].outputSchema.additionalProperties, false);
    assert.equal(turnOptions[0].outputSchema.required.includes("assessment"), true);
    assert.equal(
      turnOptions[0].outputSchema.properties.assessment.anyOf.length,
      4,
    );
    assert.match(prompts[0], /Do not edit files, change Git state/u);
    assert.match(prompts[0], /Every item in findings is blocking/u);
    assert.match(
      prompts[0],
      /A repository-evidenced violation is a blocking finding; an absent, optional, unsupported, stylistic, or unknown convention is not/u,
    );
    assert.doesNotMatch(prompts[0], /maintenance, governance|documentation, or status/u);
    assert.match(prompts[0], /scheduled_later_checks are controller-owned future gates/u);
  });

  test("rejects a passing verification assessment that carries blocking findings", async () => {
    const finalResponse = JSON.stringify({
      type: "verification_completed",
      review_depth: "deep_review",
      summary: "The candidate passes, with one positive observation.",
      assessment: {
        verdict: "pass_with_notes",
        findings: [
          {
            finding_id: "positive-observation",
            category: "correctness",
            message: "The changed path is correct.",
            path: "src/a.js",
          },
        ],
        notes: [
          { note_id: "note-1", message: "Another host remains unverified." },
        ],
        human_decision: null,
        requested_checks: [],
      },
    });
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread() {
            return {
              async runStreamed() {
                return { events: providerEvents(finalResponse) };
              },
            };
          },
        };
      },
    });

    await assert.rejects(runtime.invoke(verificationInvocation(process.cwd())), {
      code: "CODEX_RUNTIME_OUTPUT_INVALID",
    });
  });

  test("runs feedback-triggered execution with writable capability and explicit assessments", async () => {
    const threadOptions = [];
    const prompts = [];
    const finalResponse = JSON.stringify({
      type: "implementation_completed",
      summary: "Corrected the confirmed compatibility defect.",
      changed_paths: ["src/api.js"],
      blocker: null,
      revision_feedback_assessments: [
        {
          finding_id: "finding-1",
          disposition: "adapt",
          rationale: "The exact diff needs a narrower compatibility guard.",
        },
      ],
    });
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread(options) {
            threadOptions.push(options);
            return {
              async runStreamed(prompt) {
                prompts.push(prompt);
                return { events: providerEvents(finalResponse) };
              },
            };
          },
        };
      },
    });

    const result = await runtime.invoke(feedbackExecutionInvocation(process.cwd()));

    assert.equal(result.outcome.type, "implementation_completed");
    assert.equal(threadOptions[0].sandboxMode, "workspace-write");
    assert.match(prompts[0], /Feedback is review input rather than independent authority/u);
    assert.match(prompts[0], /assess every finding exactly once/u);
    assert.match(
      prompts[0],
      /selected repository_check becomes authoritative only when ChangeFleet reruns its frozen argv after Candidate publication/u,
    );
    assert.match(
      prompts[0],
      /distinguish local execution-time diagnostics from the later controller-owned Candidate-bound attempt/u,
    );
    assert.match(
      prompts[0],
      /workspace starts at the current Candidate when candidate_sha is supplied/u,
    );
    assert.match(
      prompts[0],
      /fully assessed feedback execution that needs no Git change is valid/u,
    );
    assert.match(prompts[0], /do not rewrite unrelated Plan work/u);
    assert.match(
      prompts[0],
      /Ensure this Candidate satisfies those project-owned requirements before reporting completion/u,
    );
    assert.match(
      prompts[0],
      /Do not create or update Harness, artifacts, commands, or formats unless the repository or confirmed task requires it/u,
    );
    assert.doesNotMatch(prompts[0], /maintenance, governance|documentation, or status/u);
  });

  test("runs exact Bundle review with read-only repositories and a strict assessment", async () => {
    const threadOptions = [];
    const turnOptions = [];
    const prompts = [];
    const finalResponse = JSON.stringify({
      type: "bundle_review_completed",
      disposition: "pass",
      summary: "The exact Bundle satisfies the confirmed intent.",
      findings: [
        {
          finding_id: "optional-cleanup",
          severity: "advisory",
          category: "correctness",
          message: "A later cleanup could simplify one path.",
          evidence_reference_ids: [],
          repository_ids: ["api"],
          work_unit_ids: [],
        },
      ],
      human_decision: null,
    });
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread(options) {
            threadOptions.push(options);
            return {
              async runStreamed(prompt, options_) {
                prompts.push(prompt);
                turnOptions.push(options_);
                return { events: providerEvents(finalResponse) };
              },
            };
          },
        };
      },
    });

    const result = await runtime.invoke(bundleReviewInvocation(process.cwd()));

    assert.equal(result.outcome.disposition, "pass");
    assert.equal(threadOptions[0].sandboxMode, "read-only");
    assert.equal(threadOptions[0].skipGitRepoCheck, false);
    assert.equal(turnOptions[0].outputSchema.additionalProperties, false);
    assert.match(prompts[0], /exact CandidateBundle across all supplied/u);
    assert.match(
      prompts[0],
      /A repository-evidenced violation is blocking; an absent, optional, unsupported, stylistic, or unknown convention is not/u,
    );
    assert.doesNotMatch(prompts[0], /maintenance, governance|documentation, or status/u);
    assert.match(prompts[0], /A passage recommendation is not Bundle acceptance/u);
  });

  test("runs semantic supervision in a non-Repository read-only thread", async () => {
    const threadOptions = [];
    const turnOptions = [];
    const prompts = [];
    const finalResponse = JSON.stringify({
      type: "supervisor_decision_proposal",
      action_id: "supervision-action-1",
      projection_digest: "a".repeat(64),
      rationale: "The exact validation failure is implementation Feedback.",
      expected_result: "The WorkUnit assesses and repairs the bounded finding.",
      evidence_reference_ids: ["validation-1"],
    });
    const runtime = new CodexSdkRuntime({
      ...RUNTIME_OPTIONS,
      codexFactory() {
        return {
          startThread(options) {
            threadOptions.push(options);
            return {
              async runStreamed(prompt, options_) {
                prompts.push(prompt);
                turnOptions.push(options_);
                return { events: providerEvents(finalResponse) };
              },
            };
          },
        };
      },
    });

    const result = await runtime.invoke(supervisionInvocation(process.cwd()));

    assert.equal(result.outcome.type, "supervisor_decision_proposal");
    assert.equal(threadOptions[0].sandboxMode, "read-only");
    assert.equal(threadOptions[0].skipGitRepoCheck, true);
    assert.equal(turnOptions[0].outputSchema.additionalProperties, false);
    assert.match(prompts[0], /Choose exactly one action_id/u);
    assert.match(prompts[0], /may not invent, modify, combine, or execute/u);
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

function verificationInvocation(repositoryPath) {
  return {
    operation: "verification",
    agent_profile: {
      ...PROFILE,
      permissions: "operation_scoped",
      network_access: false,
    },
    control_contract: {
      schema_version: 4,
      operation: "verification",
      change_set_id: "change-1",
      authorized_repositories: ["api"],
    },
    context_projection: {
      schema_version: 10,
      operation: "verification",
      repositories: [{ repository_id: "api", root_path: repositoryPath }],
      verification: {
        candidate: {
          base_sha: "a".repeat(40),
          candidate_sha: "b".repeat(40),
        },
        scheduled_later_checks: [
          {
            stage: "candidate_bundle_assembly",
            status: "scheduled",
            check: { command_id: "combined-check" },
          },
        ],
      },
    },
    capabilities: {
      mode: "read_only",
      paths: [repositoryPath],
    },
    workspace: { workspace_path: repositoryPath },
    signal: null,
  };
}

function feedbackExecutionInvocation(repositoryPath) {
  return {
    operation: "execution",
    agent_profile: {
      ...PROFILE,
      permissions: "operation_scoped",
      network_access: false,
    },
    control_contract: {
      schema_version: 4,
      operation: "execution",
      change_set_id: "change-1",
      authorized_repositories: ["api"],
    },
    context_projection: {
      schema_version: 10,
      operation: "execution",
      work_unit: { task: "Handle the API compatibility feedback" },
      repositories: [{ repository_id: "api", root_path: repositoryPath }],
      feedback: {
        feedback_id: "feedback-1",
        source: "verification",
        target: { work_unit_id: "api-unit" },
        summary: "Assess one compatibility finding.",
        findings: [
          {
            finding_id: "finding-1",
            text: "The API breaks the confirmed compatibility contract.",
          },
        ],
      },
    },
    capabilities: {
      mode: "read_write",
      paths: [repositoryPath],
    },
    workspace: { workspace_path: repositoryPath },
    signal: null,
  };
}

function supervisionInvocation(runtimePath) {
  return {
    operation: "supervision",
    agent_profile: {
      ...PROFILE,
      profile_id: "codex-supervisor",
      permissions: "operation_scoped",
      network_access: false,
    },
    control_contract: {
      schema_version: 4,
      operation: "supervision",
      change_set_id: "change-1",
      authorized_repositories: ["api"],
    },
    context_projection: {
      schema_version: 1,
      operation: "supervision",
      projection_digest: "a".repeat(64),
      offered_actions: [
        { action_id: "supervision-action-1", type: "submit_feedback" },
      ],
    },
    capabilities: {
      mode: "read_only",
      paths: [runtimePath],
      typed_operations_only: true,
    },
    workspace: null,
    signal: null,
  };
}

function bundleReviewInvocation(repositoryPath) {
  return {
    operation: "review",
    agent_profile: {
      ...PROFILE,
      profile_id: "codex-reviewer",
      permissions: "operation_scoped",
      network_access: false,
    },
    control_contract: {
      schema_version: 5,
      operation: "review",
      change_set_id: "change-1",
      authorized_repositories: ["api"],
    },
    context_projection: {
      schema_version: 1,
      operation: "review",
      bundle: {
        bundle_id: "bundle-1",
        bundle_hash: "a".repeat(64),
      },
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
