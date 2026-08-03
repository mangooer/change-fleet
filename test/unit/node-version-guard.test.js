import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import {
  REQUIRED_NODE_MAJOR,
  unsupportedNodeVersionDiagnostic,
} from "../../scripts/node-version-guard.mjs";

describe("Node.js check version guard", () => {
  test("accepts only the configured Node.js major", () => {
    assert.equal(unsupportedNodeVersionDiagnostic("24.0.0"), null);
    assert.equal(unsupportedNodeVersionDiagnostic("24.14.0"), null);

    for (const version of ["22.19.0", "25.0.0", "invalid", null]) {
      const diagnostic = unsupportedNodeVersionDiagnostic(version);
      assert.equal(diagnostic.code, "UNSUPPORTED_NODE_VERSION");
      assert.equal(diagnostic.required_major, 24);
    }
  });

  test("stays aligned with the package engine contract", async () => {
    const packageRecord = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    );
    assert.equal(REQUIRED_NODE_MAJOR, 24);
    assert.equal(packageRecord.engines.node, ">=24 <25");
  });
});
