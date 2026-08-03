import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import {
  parseAuditArguments,
  runLocalAuditCommand,
} from "../../src/cli/local-audit-command.js";

describe("local audit command arguments", () => {
  test("parses exact Run and bounded ChangeSet commands", () => {
    const controlRoot = path.resolve("fixture-control");
    assert.deepEqual(
      parseAuditArguments([
        "run",
        "run-1",
        "--control-root",
        "fixture-control",
      ]),
      {
        subject: "run",
        subject_id: "run-1",
        control_root: controlRoot,
        locale: "zh-CN",
        query: {},
      },
    );
    assert.deepEqual(
      parseAuditArguments([
        "changeset",
        "change-1",
        "--control-root",
        "fixture-control",
        "--detail-page",
        "2",
        "--page-size",
        "25",
        "--locale",
        "en",
      ]),
      {
        subject: "changeset",
        subject_id: "change-1",
        control_root: controlRoot,
        locale: "en",
        query: { detail_page: 2, page_size: 25 },
      },
    );
  });

  test("rejects ambiguous or unsupported invocation before execution", () => {
    const invalidArguments = [
      [],
      ["all", "subject", "--control-root", "root"],
      ["run", "--control-root", "root"],
      ["run", "bad/id", "--control-root", "root"],
      ["run", "run-1"],
      ["run", "run-1", "--control-root", "root", "--page-size", "1"],
      ["run", "run-1", "--control-root", "root", "--unknown", "value"],
      [
        "run",
        "run-1",
        "--control-root",
        "root",
        "--control-root",
        "other",
      ],
      ["run", "run-1", "--control-root", "--locale", "en"],
      ["run", "run-1", "--control-root", "root", "--locale", "fr"],
      [
        "changeset",
        "change-1",
        "--control-root",
        "root",
        "--detail-page",
        "0",
      ],
      [
        "changeset",
        "change-1",
        "--control-root",
        "root",
        "--page-size",
        "101",
      ],
    ];

    for (const arguments_ of invalidArguments) {
      assert.throws(() => parseAuditArguments(arguments_), {
        code: "INVALID_AUDIT_INVOCATION",
      });
    }
  });

  test("bounds caller-controlled invocation details", () => {
    const option = `--${"x".repeat(256)}`;
    assert.throws(
      () =>
        parseAuditArguments([
          "run",
          "run-1",
          "--control-root",
          "root",
          option,
          "value",
        ]),
      (error) => {
        assert.equal(error.code, "INVALID_AUDIT_INVOCATION");
        assert.equal(error.details.option.length, 128);
        return true;
      },
    );
  });

  test("writes one localized typed invocation error without stdout", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await runLocalAuditCommand(
      ["changeset", "change-1", "--control-root", "root", "--page-size", "101", "--locale", "en"],
      {
        stdout: { write: (value) => (stdout += value) },
        stderr: { write: (value) => (stderr += value) },
      },
    );

    assert.equal(exitCode, 2);
    assert.equal(stdout, "");
    assert.deepEqual(JSON.parse(stderr), {
      error: {
        code: "INVALID_AUDIT_INVOCATION",
        message: "Local audit command arguments are invalid.",
        locale: "en",
        details: {
          reason: "integer_out_of_range",
          option: "--page-size",
          maximum: 100,
        },
      },
    });
  });
});
