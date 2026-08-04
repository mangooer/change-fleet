import assert from "node:assert/strict";
import { test } from "node:test";

import { diagnosticMessage, presentDiagnostic } from "../../src/domain/diagnostics.js";
import { ChangeFleetError } from "../../src/domain/errors.js";

test("diagnostics default to Chinese while codes remain stable", () => {
  const error = new ChangeFleetError("INVALID_PLAN", "English fallback");
  assert.equal(error.code, "INVALID_PLAN");
  assert.equal(error.locale, "zh-CN");
  assert.equal(error.message, "变更计划无效。");
});

test("diagnostics support English and deterministic fallback", () => {
  assert.equal(diagnosticMessage("INVALID_PLAN", { locale: "en" }), "Change plan is invalid.");
  assert.equal(diagnosticMessage("UNMAPPED", { locale: "fr", fallback: "fallback" }), "fallback");
});

test("a caller can present one stable error in another supported locale", () => {
  const error = new ChangeFleetError("PLAN_CONFIRMATION_REQUIRED", "fallback", { change_set_id: "change-1" });
  assert.deepEqual(presentDiagnostic(error, "en"), {
    code: "PLAN_CONFIRMATION_REQUIRED",
    message: "The plan has not received human confirmation and cannot execute.",
    details: { change_set_id: "change-1" },
    locale: "en",
  });
});

test("Repository selection diagnostics keep one stable code across locales", () => {
  assert.equal(
    diagnosticMessage("REPOSITORY_BRANCH_SELECTION_REQUIRED"),
    "检出点不在分支上，必须显式选择仓库分支。",
  );
  assert.equal(
    diagnosticMessage("REPOSITORY_BRANCH_SELECTION_REQUIRED", {
      locale: "en",
    }),
    "The checkout is detached; an explicit Repository branch is required.",
  );
});

test("Repository Harness failures are localized without changing stable codes", () => {
  for (const [code, chinese, english] of [
    [
      "HARNESS_OVERLAY_MODIFIED",
      "运行过程修改了冻结的 Harness overlay。",
      "The Run modified the frozen Harness overlay.",
    ],
    [
      "NON_GIT_HARNESS_CHANGE_UNSUPPORTED",
      "ChangeFleet 不支持交付未由 Git 管理的 Harness 修改。",
      "ChangeFleet cannot deliver a Harness change that is not maintained in Git.",
    ],
  ]) {
    assert.equal(diagnosticMessage(code), chinese);
    assert.equal(diagnosticMessage(code, { locale: "en" }), english);
  }
});

test("Runtime audit diagnostics keep unknown and overlap failures explicit", () => {
  assert.equal(
    diagnosticMessage("AMBIGUOUS_OBSERVATION_OVERLAP"),
    "用量观察可能重叠，无法安全计算唯一总量。",
  );
  assert.equal(
    diagnosticMessage("AUDIT_SOURCE_IDENTITY_MISMATCH", { locale: "en" }),
    "Audit source identity or content digest does not match.",
  );
});

test("Candidate recovery and revision feedback diagnostics remain localized", () => {
  assert.equal(
    diagnosticMessage("CANDIDATE_CHECKPOINT_NOT_RESUMABLE"),
    "候选检查点当前不可恢复验证。",
  );
  assert.equal(
    diagnosticMessage("INVALID_REVISION_FEEDBACK", { locale: "en" }),
    "Revision feedback is missing, duplicated, or outside its bounds.",
  );
});

test("ChangeSet closure diagnostics remain stable across locales", () => {
  assert.equal(
    diagnosticMessage("CHANGE_SET_NOT_QUIESCENT"),
    "变更单仍有运行或命令正在执行，当前不能关闭。",
  );
  assert.equal(
    diagnosticMessage("CHANGE_SET_ABANDONED", { locale: "en" }),
    "The ChangeSet is abandoned and cannot receive lifecycle mutations.",
  );
});

test("pre-Candidate retry diagnostics remain stable across locales", () => {
  assert.equal(
    diagnosticMessage("EMPTY_IMPLEMENTATION_RESULT"),
    "Agent Runtime 没有产生可交付的 Git 修改。",
  );
  assert.equal(
    diagnosticMessage("EXECUTION_RETRY_WORKSPACE_DIRTY", { locale: "en" }),
    "The retry workspace contains partial changes and cannot be reset automatically.",
  );
});
