import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { runCommand } from "../../src/adapters/filesystem/command-runner.js";
import { createFixtureRoot } from "../support/git-fixture.js";

describe("structured validation command runner", () => {
  test(
    "preserves metacharacter argv through the resolved Windows npm.cmd adapter",
    { skip: process.platform !== "win32" },
    async (t) => {
      const root = await createFixtureRoot(t, "changefleet-command-runner-");
      const capturePath = path.join(root, "argv.json");
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          private: true,
          scripts: { capture: "node capture.mjs" },
        }),
      );
      await writeFile(
        path.join(root, "capture.mjs"),
        [
          'import { writeFile } from "node:fs/promises";',
          "await writeFile(process.env.CAPTURE_PATH, JSON.stringify(process.argv.slice(2)));",
          "",
        ].join("\n"),
      );
      const values = [
        "ampersand&value",
        "pipe|value",
        "caret^value",
        "percent%value",
        "paren(value)",
        "space value",
        'quote"value',
      ];
      const result = await runCommand(
        {
          command_id: "npm-metacharacters",
          executable: "npm",
          argv: ["run", "capture", "--", ...values],
          timeout_ms: 30_000,
        },
        {
          cwd: root,
          environment: { CAPTURE_PATH: capturePath },
        },
      );

      assert.equal(result.exit_code, 0);
      assert.equal(result.adapter, "windows_batch");
      assert.match(result.resolved_executable.toLowerCase(), /npm\.cmd$/u);
      assert.deepEqual(JSON.parse(await readFile(capturePath, "utf8")), values);
      assert.deepEqual(result.argv, ["run", "capture", "--", ...values]);
      assert.equal(JSON.stringify(result).includes("CAPTURE_PATH"), false);
    },
  );

  test("records timeout and cancellation without accepting a shell command", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-command-stop-");
    const scriptPath = path.join(root, "long-running.mjs");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);\n");
    let executable = process.execPath;
    let argv = [scriptPath];
    if (process.platform === "win32") {
      executable = path.join(root, "long-running.cmd");
      argv = [];
      await writeFile(
        executable,
        `@ECHO OFF\r\n"${process.execPath}" "${scriptPath}"\r\n`,
      );
    }
    const command = {
      command_id: "long-running",
      executable,
      argv,
      timeout_ms: 50,
    };
    const timedOut = await runCommand(command);
    assert.equal(timedOut.timed_out, true);
    assert.equal(timedOut.cancelled, false);
    assert.equal(
      timedOut.adapter,
      process.platform === "win32" ? "windows_batch" : "direct",
    );

    const controller = new AbortController();
    const cancelledPromise = runCommand(
      { ...command, command_id: "cancelled", timeout_ms: 5_000 },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    const cancelled = await cancelledPromise;
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.timed_out, false);
  });

  test("returns structured effective invocation evidence when spawn fails", async () => {
    await assert.rejects(
      runCommand({
        command_id: "missing",
        executable: "changefleet-command-that-does-not-exist",
        argv: ["literal&argument"],
        timeout_ms: 1_000,
      }),
      (error) => {
        assert.equal(error.code, "COMMAND_SPAWN_FAILED");
        assert.equal(
          error.details.command_result.requested_executable,
          "changefleet-command-that-does-not-exist",
        );
        assert.deepEqual(error.details.command_result.argv, ["literal&argument"]);
        assert.equal("environment" in error.details.command_result, false);
        return true;
      },
    );
  });
});
