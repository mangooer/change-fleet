import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkRepositoryHarness } from "../../scripts/check-harness.mjs";

test("accepts this repository's bounded WorkItem and eager Harness contract", async (t) => {
  const root = await createHarnessFixture(t);

  const result = await checkRepositoryHarness(root);

  assert.deepEqual(result.violations, []);
  assert.equal(result.eagerFileCount, 3);
  assert.equal(result.workItemCount, 1);
});

test("rejects invalid WorkItem metadata without learning target-project formats", async (t) => {
  const root = await createHarnessFixture(t);
  await writeFile(
    path.join(root, "docs", "work-items", "WI-0001-sample.md"),
    workItemFrontmatter({ id: "WI-9999", status: "complete", title: "" }),
    "utf8",
  );

  const result = await checkRepositoryHarness(root);
  const codes = result.violations.map((item) => item.code);

  assert.equal(codes.includes("WORK_ITEM_ID_MISMATCH"), true);
  assert.equal(codes.includes("INVALID_WORK_ITEM_STATUS"), true);
  assert.equal(codes.includes("EMPTY_WORK_ITEM_FIELD"), true);
});

test("allows an unconfirmed draft while requiring its stable metadata", async (t) => {
  const root = await createHarnessFixture(t);
  await writeFile(
    path.join(root, "docs", "work-items", "WI-0001-sample.md"),
    workItemFrontmatter({
      id: "WI-0001",
      status: "draft",
      title: "Sample draft",
      confirmedBy: "",
      confirmedAt: "",
    }),
    "utf8",
  );

  const result = await checkRepositoryHarness(root);

  assert.deepEqual(result.violations, []);
});

test("rejects an eager Harness resource above this repository's size limit", async (t) => {
  const root = await createHarnessFixture(t);
  await writeFile(path.join(root, "AGENTS.md"), "x".repeat(6 * 1024 + 1), "utf8");

  const result = await checkRepositoryHarness(root);

  assert.equal(
    result.violations.some(
      (item) =>
        item.code === "EAGER_HARNESS_SIZE_EXCEEDED" && item.path === "AGENTS.md",
    ),
    true,
  );
});

async function createHarnessFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "changefleet-harness-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs", "work-items"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "# Agent rules\n", "utf8");
  await writeFile(path.join(root, "WORKFLOW.md"), "# Workflow\n", "utf8");
  await writeFile(
    path.join(root, "docs", "current-state.md"),
    "# Current State\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "docs", "work-items", "WI-0001-sample.md"),
    workItemFrontmatter({ id: "WI-0001", status: "done", title: "Sample" }),
    "utf8",
  );
  return root;
}

function workItemFrontmatter({
  id,
  status,
  title,
  confirmedBy = "test",
  confirmedAt = "2026-08-11",
}) {
  return [
    "---",
    "artifact_type: development_work_item",
    `id: ${id}`,
    `status: ${status}`,
    `title: ${title}`,
    "source: Test fixture",
    `confirmed_by: ${confirmedBy}`,
    `confirmed_at: ${confirmedAt}`,
    "---",
    "",
    "# Sample",
    "",
  ].join("\n");
}
