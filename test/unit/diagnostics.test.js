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
