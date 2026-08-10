import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attachSecondaryFailure,
  boundedFailureDiagnostic,
  boundedSecondaryFailures,
  preserveSecondaryFailure,
} from "../../src/domain/errors.js";

test("secondary failures stay bounded at attachment and persistence boundaries", async () => {
  const primary = new Error("primary");
  for (let index = 0; index < 12; index += 1) {
    attachSecondaryFailure(
      primary,
      `stage-${"阶".repeat(200)}-${index}`,
      Object.assign(new Error("错".repeat(2_000)), {
        code: `CODE_${"码".repeat(200)}`,
      }),
    );
  }

  assert.equal(primary.secondary_failures.length, 8);
  for (const failure of primary.secondary_failures) {
    assert.ok(Buffer.byteLength(failure.stage, "utf8") <= 128);
    assert.ok(Buffer.byteLength(failure.code, "utf8") <= 128);
    assert.ok(Buffer.byteLength(failure.message, "utf8") <= 1_024);
  }

  const normalized = boundedSecondaryFailures([
    ...primary.secondary_failures,
    ...Array.from({ length: 20 }, () => ({
      stage: "external",
      code: "EXTERNAL_FAILURE",
      message: "x".repeat(10_000),
    })),
  ]);
  assert.equal(normalized.length, 8);

  await preserveSecondaryFailure(primary, "cleanup", async () => {
    throw new Error("secondary");
  });
  assert.equal(primary.message, "primary");
  assert.equal(primary.secondary_failures.length, 8);
});

test("primary failure diagnostics keep only bounded stable classification", () => {
  const diagnostic = boundedFailureDiagnostic({
    stage: `verification-${"阶".repeat(200)}`,
    rule: `pass-${"规".repeat(200)}`,
    provider_output: "must not persist",
  });
  assert.deepEqual(Object.keys(diagnostic), ["stage", "rule"]);
  assert.match(diagnostic.stage, /^verification-/u);
  assert.match(diagnostic.rule, /^pass-/u);
  assert.ok(Buffer.byteLength(diagnostic.stage, "utf8") <= 128);
  assert.ok(Buffer.byteLength(diagnostic.rule, "utf8") <= 128);
  assert.equal(Object.hasOwn(diagnostic, "provider_output"), false);
  assert.equal(boundedFailureDiagnostic({ provider_output: "ignored" }), null);
});
