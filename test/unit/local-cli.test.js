import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import { describe, test } from "node:test";

import { CodexSdkRuntime } from "../../src/adapters/runtime/codex-sdk-runtime.js";
import {
  parseCommandLine,
} from "../../src/cli/command-line-arguments.js";
import { runChangeFleetCommand } from "../../src/cli/changefleet-command.js";
import {
  createProductionRuntime,
} from "../../src/cli/lifecycle-command.js";
import {
  loadLocalCliConfig,
  loadStructuredRequest,
} from "../../src/cli/local-input.js";
import { executeServeCommand } from "../../src/cli/serve-command.js";
import { ChangeFleetError } from "../../src/domain/errors.js";

describe("unified local CLI grammar", () => {
  test("maps every accepted mutation route to one application operation", () => {
    const routes = [
      [["project", "register"], "project.register"],
      [
        ["project", "repository-policy", "revise"],
        "project.repository_workspace_policy.revise",
      ],
      [
        ["project", "github-delivery", "configure"],
        "project.repository_delivery.github.configure",
      ],
      [["changeset", "create"], "changeset.create"],
      [["changeset", "close"], "changeset.close"],
      [["changeset", "feedback", "submit"], "changeset.feedback.submit"],
      [["changeset", "gate", "resolve"], "changeset.gate.resolve"],
      [
        ["changeset", "repository-selection", "revise"],
        "changeset.repository_selection.revise",
      ],
      [
        ["changeset", "harness-selection", "revise"],
        "changeset.repository_harness_selection.revise",
      ],
      [["changeset", "plan"], "changeset.plan"],
      [["changeset", "plan", "confirm"], "changeset.plan.confirm"],
      [["changeset", "execute"], "changeset.execute"],
      [["changeset", "supervision", "start"], "changeset.supervision.start"],
      [["changeset", "supervision", "pause"], "changeset.supervision.pause"],
      [["changeset", "supervision", "resume"], "changeset.supervision.resume"],
      [["changeset", "bundle", "decide"], "changeset.bundle.decide"],
      [["changeset", "delivery", "publish"], "changeset.delivery.publish"],
      [["changeset", "delivery", "refresh"], "changeset.delivery.refresh"],
    ];
    for (const [tokens, operation] of routes) {
      assert.deepEqual(
        parseCommandLine([
          ...tokens,
          "--config",
          "changefleet.json",
          "--request",
          "request.json",
        ]),
        {
          kind: "lifecycle",
          operation,
          config_path: "changefleet.json",
          request_source: "request.json",
        },
      );
    }
  });

  test("parses exact ChangeSet reads and bounded debug audit queries", () => {
    assert.deepEqual(
      parseCommandLine([
        "changeset",
        "supervision",
        "show",
        "change-1",
        "--config",
        "changefleet.json",
      ]),
      {
        kind: "lifecycle",
        operation: "changeset.supervision.progress",
        config_path: "changefleet.json",
        request: { change_set_id: "change-1" },
      },
    );
    assert.deepEqual(
      parseCommandLine([
        "serve",
        "--config",
        "changefleet.json",
        "--port",
        "4311",
      ]),
      {
        kind: "serve",
        config_path: "changefleet.json",
        port: 4311,
      },
    );
    assert.deepEqual(
      parseCommandLine([
        "changeset",
        "delivery",
        "show",
        "change-1",
        "--config",
        "changefleet.json",
      ]),
      {
        kind: "lifecycle",
        operation: "changeset.delivery.read",
        config_path: "changefleet.json",
        request: { change_set_id: "change-1" },
      },
    );
    assert.deepEqual(
      parseCommandLine([
        "changeset",
        "show",
        "change-1",
        "--config",
        "changefleet.json",
      ]),
      {
        kind: "lifecycle",
        operation: "changeset.read",
        config_path: "changefleet.json",
        request: { change_set_id: "change-1" },
      },
    );
    assert.deepEqual(
      parseCommandLine([
        "debug",
        "audit",
        "changeset",
        "change-1",
        "--control-root",
        "control",
        "--detail-page",
        "2",
        "--page-size",
        "25",
        "--locale",
        "en",
      ]),
      {
        kind: "audit",
        subject: "changeset",
        subject_id: "change-1",
        control_root: path.resolve("control"),
        locale: "en",
        query: { detail_page: 2, page_size: 25 },
      },
    );
  });

  test("rejects internal resolve helpers and ambiguous input", () => {
    const invalid = [
      [],
      ["changeset", "repository-selection", "resolve"],
      ["changeset", "harness-selection", "resolve"],
      ["changeset", "plan", "--config", "config.json"],
      [
        "changeset",
        "plan",
        "--config",
        "a.json",
        "--config",
        "b.json",
        "--request",
        "request.json",
      ],
      ["changeset", "show", "bad/id", "--config", "config.json"],
      [
        "debug",
        "audit",
        "changeset",
        "change-1",
        "--control-root",
        "control",
        "--page-size",
        "101",
      ],
    ];
    for (const arguments_ of invalid) {
      assert.throws(() => parseCommandLine(arguments_), (error) => {
        assert.match(
          error.code,
          /^INVALID_(?:CLI|AUDIT)_INVOCATION$/,
        );
        return true;
      });
    }
  });
});

describe("local CLI structured input", () => {
  test("loads one strict secret-free config and resolves owned roots from its file", async () => {
    const configPath = path.resolve("fixtures", "changefleet.json");
    const config = await loadLocalCliConfig(configPath, {
      readFileImpl: async () => Buffer.from(JSON.stringify(validConfig())),
    });
    assert.equal(
      config.control_root,
      path.resolve("fixtures", "control"),
    );
    assert.equal(
      config.workspace_root,
      path.resolve("fixtures", "workspaces"),
    );
    assert.equal(config.locale, "en");
    assert.equal(config.runtime.adapter, "codex-sdk");
    assert.equal(
      config.runtime.codex_home,
      path.resolve("fixtures", "provider-home"),
    );
    assert.equal(config.agent_profile.provider, "openai");

    const hostUser = validConfig();
    hostUser.agent_profile.permissions = "host_user";
    hostUser.agent_profile.network_access = true;
    const hostConfig = await loadLocalCliConfig(configPath, {
      readFileImpl: async () => Buffer.from(JSON.stringify(hostUser)),
    });
    assert.equal(hostConfig.agent_profile.permissions, "host_user");
    assert.equal(hostConfig.agent_profile.network_access, true);
  });

  test("rejects unknown secret fields, fake Runtime selection, and oversized input", async () => {
    const withSecret = validConfig();
    withSecret.runtime.api_key = "must-not-be-accepted";
    await assert.rejects(
      loadLocalCliConfig("config.json", {
        readFileImpl: async () => Buffer.from(JSON.stringify(withSecret)),
      }),
      { code: "INVALID_CLI_CONFIG" },
    );

    const fake = validConfig();
    fake.runtime.adapter = "scripted";
    fake.agent_profile.provider = "test";
    fake.agent_profile.runtime = "scripted";
    await assert.rejects(
      loadLocalCliConfig("config.json", {
        readFileImpl: async () => Buffer.from(JSON.stringify(fake)),
      }),
      { code: "INVALID_CLI_CONFIG" },
    );

    await assert.rejects(
      loadLocalCliConfig("config.json", {
        readFileImpl: async () => Buffer.alloc(64 * 1024 + 1),
      }),
      { code: "INVALID_CLI_CONFIG" },
    );
  });

  test("requires a Provider environment outside control and workspace roots", async () => {
    const missing = validConfig();
    delete missing.runtime.codex_home;
    await assert.rejects(
      loadLocalCliConfig("config.json", {
        readFileImpl: async () => Buffer.from(JSON.stringify(missing)),
      }),
      { code: "INVALID_CLI_CONFIG" },
    );

    for (const codexHome of ["./control/codex", "./workspaces/codex"]) {
      const overlapping = validConfig();
      overlapping.runtime.codex_home = codexHome;
      await assert.rejects(
        loadLocalCliConfig("config.json", {
          readFileImpl: async () => Buffer.from(JSON.stringify(overlapping)),
        }),
        { code: "INVALID_CLI_CONFIG" },
      );
    }
  });

  test("reads request JSON from a file or bounded stdin without changing fields", async () => {
    const request = { idempotency_key: "create-1", nested: { value: 1 } };
    assert.deepEqual(
      await loadStructuredRequest("request.json", {
        readFileImpl: async () => Buffer.from(JSON.stringify(request)),
      }),
      request,
    );
    assert.deepEqual(
      await loadStructuredRequest("-", {
        stdin: Readable.from([JSON.stringify(request)]),
      }),
      request,
    );
    await assert.rejects(
      loadStructuredRequest("request.json", {
        readFileImpl: async () => Buffer.from("[]"),
      }),
      { code: "INVALID_CLI_REQUEST" },
    );
  });
});

describe("local CLI composition and presentation", () => {
  test("uses only accepted Codex credential sources in production composition", () => {
    const local = createProductionRuntime(validNormalizedConfig(), {
      environment: {},
    });
    assert.equal(local instanceof CodexSdkRuntime, true);
    assert.equal(local.codexHome, path.resolve("provider-home"));
    assert.equal(local.credentialProfileId, "local-codex-credentials");

    const api = createProductionRuntime(
      validNormalizedConfig("openai_api_key"),
      {
        environment: { OPENAI_API_KEY: "test-key" },
      },
    );
    assert.equal(api instanceof CodexSdkRuntime, true);
    assert.equal(api.apiKey, "test-key");
    assert.equal(api.codexHome, path.resolve("provider-home"));
    assert.throws(
      () =>
        createProductionRuntime(
          validNormalizedConfig("openai_api_key"),
          { environment: {} },
        ),
      { code: "CODEX_CREDENTIALS_UNAVAILABLE" },
    );
  });

  test("writes one result or localized typed failure on isolated streams", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await runChangeFleetCommand(
      [
        "changeset",
        "plan",
        "--config",
        "config.json",
        "--request",
        "request.json",
      ],
      {
        stdout: { write: (value) => (stdout += value) },
        stderr: { write: (value) => (stderr += value) },
        lifecycleExecutor: async (command) => ({
          operation: command.operation,
        }),
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), { operation: "changeset.plan" });

    stdout = "";
    stderr = "";
    const failed = await runChangeFleetCommand(
      [
        "changeset",
        "plan",
        "--config",
        "config.json",
        "--request",
        "request.json",
      ],
      {
        stdout: { write: (value) => (stdout += value) },
        stderr: { write: (value) => (stderr += value) },
        lifecycleExecutor: async () => {
          const error = new ChangeFleetError(
            "PLAN_CONFIRMATION_REQUIRED",
            "fallback",
          );
          error.presentation_locale = "en";
          throw error;
        },
      },
    );
    assert.equal(failed, 1);
    assert.equal(stdout, "");
    assert.deepEqual(JSON.parse(stderr), {
      error: {
        code: "PLAN_CONFIRMATION_REQUIRED",
        message: "The plan has not received human confirmation and cannot execute.",
        locale: "en",
        details: null,
      },
    });
  });

  test("delegates the retained serve command without JSON wrapping", async () => {
    let stdout = "";
    const exitCode = await runChangeFleetCommand(
      ["serve", "--config", "config.json"],
      {
        stdout: { write: (value) => (stdout += value) },
        stderr: { write() {} },
        serveExecutor: async (command, { stdout: stream }) => {
          stream.write(`serving ${command.config_path}\n`);
        },
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(stdout, "serving config.json\n");
  });

  test("composes the configured production Runtime into the planning-capable console", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "changefleet-serve-unit-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = path.join(root, "changefleet.json");
    await writeFile(configPath, JSON.stringify(validConfig()), "utf8");
    const runtime = { kind: "configured-runtime" };
    let openedWith = null;
    let stdout = "";
    const controlStore = {
      changeSetsRoot: path.join(root, "control", "changesets"),
      readChangeSet: async () => ({}),
      readCatalog: async () => ({ projects: {} }),
    };
    const service = new Proxy(
      {
        controlStore,
        runStore: {
          read: async () => ({}),
          readJsonArtifact: async () => ({}),
          readEvents: async () => [],
        },
        evidenceStore: { read: async () => ({}) },
      },
      {
        get(target, property) {
          // Proxy 只补齐应用方法；不能伪装成 Promise，否则 openService 的 await 会一直等待。
          if (property === "then") return undefined;
          return property in target ? target[property] : async () => ({});
        },
      },
    );
    const signalHandlers = {
      on(signal, listener) {
        if (signal === "SIGTERM") queueMicrotask(listener);
      },
      off() {},
    };

    await executeServeCommand(
      { config_path: configPath, port: 0 },
      {
        stdout: { write: (value) => (stdout += value) },
        runtimeFactory: () => runtime,
        openService: async (options) => {
          openedWith = options;
          return service;
        },
        signalHandlers,
      },
    );

    assert.equal(openedWith.runtime, runtime);
    assert.match(stdout, /^ChangeFleet local console listening on http:\/\/127\.0\.0\.1:\d+\/$/mu);
  });
});

function validConfig() {
  return {
    schema_version: 1,
    control_root: "./control",
    workspace_root: "./workspaces",
    locale: "en",
    runtime: {
      adapter: "codex-sdk",
      credential_source: "local_codex_home",
      codex_home: "./provider-home",
    },
    agent_profile: {
      profile_id: "local-codex-profile",
      revision: 1,
      provider: "openai",
      runtime: "codex-sdk",
      model: "gpt-5.4",
      reasoning: "medium",
      permissions: "operation_scoped",
      network_access: false,
      skills: [],
      credential_profile_id: "local-codex-credentials",
    },
  };
}

function validNormalizedConfig(
  credentialSource = "local_codex_home",
) {
  const input = validConfig();
  return {
    ...input,
    runtime: {
      adapter: "codex-sdk",
      credential_source: credentialSource,
      codex_home: path.resolve("provider-home"),
    },
  };
}
