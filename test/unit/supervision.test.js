import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  actionRequiresSupervisor,
  deriveSupervisionActionSet,
  normalizePlanSupervision,
  normalizeSupervisorDecisionProposal,
  normalizeSupervisionPolicy,
} from "../../src/domain/supervision.js";

describe("deterministic supervision authority", () => {
  test("defaults existing Projects and Plans to manual and enforces Project ceilings", () => {
    const policy = normalizeSupervisionPolicy();
    assert.equal(policy.default_mode, "manual");
    assert.equal(normalizePlanSupervision(null, policy).mode, "manual");
    assert.throws(
      () =>
        normalizePlanSupervision(
          {
            mode: "autonomous_until_review",
            execution_attempt_limit_per_work_unit: 4,
            verification_attempt_limit_per_work_unit: 3,
            feedback_cycle_limit_per_work_unit: 2,
            elapsed_time_limit_ms: 1_800_000,
          },
          policy,
        ),
      { code: "SUPERVISION_BUDGET_EXCEEDS_PROJECT_POLICY" },
    );
    assert.throws(
      () => normalizeSupervisionPolicy({ workflow: "invented" }),
      { code: "INVALID_SUPERVISION_POLICY" },
    );
  });

  test("derives one stable forced dispatch without spending a Supervisor decision", () => {
    const state = createState();
    const first = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:01.000Z",
    });
    const later = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:02.000Z",
    });

    assert.equal(actionRequiresSupervisor(first), false);
    assert.equal(first.actions.length, 1);
    assert.equal(first.actions[0].type, "dispatch_execution");
    assert.equal(first.actions[0].action_id, later.actions[0].action_id);
    assert.equal(
      first.actions[0].budget_identity,
      later.actions[0].budget_identity,
    );
  });

  test("offers only bounded retry, Feedback, or Gate routes for an exact failed validation", () => {
    const state = createState();
    const unit = state.work_units[0];
    unit.phase = "verification";
    unit.candidate_checkpoint_id = "checkpoint-1";
    unit.validation_attempt_ids = ["validation-1"];
    unit.last_error = {
      code: "REPOSITORY_VALIDATION_FAILED",
      message: "The exact check failed",
      validation_attempt_id: "validation-1",
    };
    state.blockers.push({
      code: "REPOSITORY_VALIDATION_FAILED",
      work_unit_id: "unit-1",
      validation_attempt_id: "validation-1",
    });
    const actions = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:02.000Z",
    });

    assert.equal(actionRequiresSupervisor(actions), true);
    assert.deepEqual(
      actions.actions.map((action) => action.type),
      ["retry_validation", "submit_feedback", "open_gate"],
    );
    const selected = actions.actions[1];
    assert.deepEqual(
      normalizeSupervisorDecisionProposal(
        {
          type: "supervisor_decision_proposal",
          action_id: selected.action_id,
          projection_digest: actions.projection_digest,
          rationale: "The failure is an implementation defect inside the Plan.",
          expected_result: "The executor assesses and repairs the exact finding.",
          evidence_reference_ids: ["validation-1"],
        },
        {
          offeredActions: actions.actions,
          projectionDigest: actions.projection_digest,
        },
      ).action_id,
      selected.action_id,
    );
    assert.throws(
      () =>
        normalizeSupervisorDecisionProposal(
          {
            type: "supervisor_decision_proposal",
            action_id: "invented-action",
            projection_digest: actions.projection_digest,
            rationale: "Invented route",
            expected_result: "Unsafe mutation",
            evidence_reference_ids: [],
          },
          {
            offeredActions: actions.actions,
            projectionDigest: actions.projection_digest,
          },
        ),
      { code: "SUPERVISOR_ACTION_NOT_OFFERED" },
    );
    assert.throws(
      () =>
        normalizeSupervisorDecisionProposal(
          {
            type: "supervisor_decision_proposal",
            action_id: selected.action_id,
            projection_digest: "f".repeat(64),
            rationale: "The proposal binds an obsolete projection.",
            expected_result: "The kernel rejects the stale subject.",
            evidence_reference_ids: [],
          },
          {
            offeredActions: actions.actions,
            projectionDigest: actions.projection_digest,
          },
        ),
      { code: "STALE_SUPERVISOR_PROPOSAL" },
    );
  });

  test("turns an accepted provider retry into one forced execution dispatch", () => {
    const state = createState();
    const unit = state.work_units[0];
    unit.run_references = [
      {
        run_id: "run-failed",
        operation: "execution",
        trigger: "initial",
        status: "failed",
      },
    ];
    unit.last_error = {
      code: "PROVIDER_RETRY_SCHEDULED",
      previous_code: "CODEX_PROVIDER_FAILED",
      source_run_id: "run-failed",
      decision_id: "decision-1",
    };

    const actions = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:02.000Z",
    });

    assert.equal(actionRequiresSupervisor(actions), false);
    assert.deepEqual(
      actions.actions.map((action) => action.type),
      ["dispatch_execution"],
    );
  });

  test("offers the bounded retry route after controller-restart execution recovery", () => {
    const state = createState();
    const unit = state.work_units[0];
    unit.run_references = [
      {
        run_id: "run-interrupted",
        operation: "execution",
        trigger: "initial",
        status: "interrupted",
      },
    ];
    unit.last_error = {
      code: "RUN_INTERRUPTED_AFTER_RESTART",
      run_id: "run-interrupted",
    };

    const actions = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:02.000Z",
    });

    assert.equal(actionRequiresSupervisor(actions), true);
    assert.deepEqual(
      actions.actions.map((action) => action.type),
      ["retry_execution", "open_gate"],
    );
  });

  test("opens one forced Gate when exact combined-validation attempts exhaust the Plan budget", () => {
    const state = createState();
    state.work_units[0].phase = "complete";
    state.work_units[0].candidate = { candidate_id: "candidate-1" };
    state.blockers.push({
      code: "COMBINED_VALIDATION_FAILED",
      validation_subject_hash: "combined-subject",
    });
    state.validation_attempts = [1, 2, 3].map((attempt) => ({
      kind: "combined_validation",
      subject_id: "combined-subject",
      attempt,
      status: "failed",
    }));

    const actions = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:02.000Z",
    });

    assert.equal(actionRequiresSupervisor(actions), false);
    assert.equal(actions.progress.combined_validation.exhausted, true);
    assert.equal(actions.actions[0].type, "open_gate");
    assert.equal(
      actions.actions[0].details.reason,
      "combined_validation_budget_exhausted",
    );
  });

  test("projects holds, elapsed exhaustion, and Bundle review as stop facts instead of phases", () => {
    const held = createState();
    held.supervision_control.hold = {
      hold_id: "hold-1",
      reason: "operator_hold",
      actor: "human",
      held_at: "2026-08-07T00:00:01.000Z",
    };
    assert.equal(
      deriveSupervisionActionSet(held, {
        now: "2026-08-07T00:00:02.000Z",
      }).actions[0].type,
      "pause",
    );

    const review = createState();
    review.phase = "review";
    const reviewAction = deriveSupervisionActionSet(review, {
      now: "2026-08-07T00:00:02.000Z",
    }).actions[0];
    assert.equal(reviewAction.type, "stop");
    assert.equal(reviewAction.details.reason, "bundle_review_ready");

    const expired = createState();
    const expiredAction = deriveSupervisionActionSet(expired, {
      now: "2026-08-07T00:30:00.000Z",
    }).actions[0];
    assert.equal(expiredAction.type, "stop");
    assert.equal(expiredAction.details.reason, "elapsed_budget_exhausted");
  });

  test("forces exact Bundle review dispatch and opens a Gate only after its frozen budget", () => {
    const state = createState();
    state.phase = "review";
    state.plans[0].bundle_review = {
      mode: "independent",
      agent_profile_id: "reviewer",
      agent_profile_revision: 1,
      attempt_limit: 2,
    };
    state.bundles = [
      {
        bundle_id: "bundle-1",
        revision: 1,
        bundle_hash: "a".repeat(64),
        candidates: [],
      },
    ];
    state.bundle_review_assessments = [];
    state.current_bundle_review_assessment_id = null;

    let actions = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:02.000Z",
    });
    assert.equal(actionRequiresSupervisor(actions), false);
    assert.equal(actions.actions[0].type, "dispatch_bundle_review");

    state.run_references = [1, 2].map((attempt) => ({
      run_id: `review-${attempt}`,
      operation: "review",
      bundle_id: "bundle-1",
      attempt,
      status: "failed",
    }));
    actions = deriveSupervisionActionSet(state, {
      now: "2026-08-07T00:00:03.000Z",
    });
    assert.equal(actions.progress.bundle_review.exhausted, true);
    assert.equal(actions.actions[0].type, "open_gate");
    assert.equal(
      actions.actions[0].details.reason,
      "bundle_review_budget_exhausted",
    );
  });
});

function createState() {
  const supervision = {
    mode: "autonomous_until_review",
    execution_attempt_limit_per_work_unit: 3,
    verification_attempt_limit_per_work_unit: 3,
    feedback_cycle_limit_per_work_unit: 2,
    elapsed_time_limit_ms: 1_800_000,
  };
  return {
    change_set_id: "change-1",
    phase: "working",
    terminal_outcome: null,
    current_plan_revision: 1,
    current_repository_selection_revision: 1,
    current_repository_harness_selection_revision: 1,
    plans: [
      {
        revision: 1,
        status: "confirmed",
        confirmed_at: "2026-08-07T00:00:00.000Z",
        bundle_review: {
          mode: "none",
          agent_profile_id: null,
          agent_profile_revision: null,
          attempt_limit: 2,
        },
        supervision,
      },
    ],
    work_units: [
      {
        plan_revision: 1,
        work_unit_id: "unit-1",
        repository_id: "repository-1",
        phase: "execution",
        disposition: "current",
        dependencies: [],
        run_references: [],
        validation_attempt_ids: [],
        candidate_checkpoint_id: null,
        pending_feedback_id: null,
        candidate: null,
        last_error: null,
      },
    ],
    run_references: [],
    validation_attempts: [],
    bundles: [],
    bundle_review_assessments: [],
    current_bundle_review_assessment_id: null,
    blockers: [],
    gates: [],
    supervision_control: {
      plan_revision: 1,
      authorized_at: "2026-08-07T00:00:00.000Z",
      hold: null,
      last_stop_reason: null,
      updated_at: "2026-08-07T00:00:00.000Z",
    },
  };
}
