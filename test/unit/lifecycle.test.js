import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertAgentRunTransition,
  derivePresentationActivity,
  setChangeSetPhase,
  setWorkUnitPhase,
} from "../../src/domain/lifecycle.js";

describe("unified lifecycle transitions", () => {
  test("accepts only the coarse ChangeSet routes", () => {
    const changeSet = { phase: "planning", terminal_outcome: null };
    setChangeSetPhase(changeSet, "working");
    setChangeSetPhase(changeSet, "review");
    setChangeSetPhase(changeSet, "working");
    setChangeSetPhase(changeSet, "planning");
    assert.throws(() => setChangeSetPhase(changeSet, "delivery"), {
      code: "INVALID_CHANGE_SET_TRANSITION",
    });
    setChangeSetPhase(changeSet, "terminal", "abandoned");
    assert.throws(() => setChangeSetPhase(changeSet, "planning"), {
      code: "INVALID_CHANGE_SET_TRANSITION",
    });

    const delivered = { phase: "delivery", terminal_outcome: null };
    setChangeSetPhase(delivered, "terminal", "done");
    assert.equal(delivered.terminal_outcome, "done");
  });

  test("keeps WorkUnit phase independent from disposition and attempt outcomes", () => {
    const workUnit = { phase: "execution", disposition: "current" };
    setWorkUnitPhase(workUnit, "verification");
    setWorkUnitPhase(workUnit, "execution");
    setWorkUnitPhase(workUnit, "verification");
    setWorkUnitPhase(workUnit, "complete");
    setWorkUnitPhase(workUnit, "execution");
    assert.equal(workUnit.disposition, "current");
    assert.throws(() => setWorkUnitPhase(workUnit, "complete"), {
      code: "INVALID_WORK_UNIT_TRANSITION",
    });
  });

  test("makes Run terminals immutable across every operation", () => {
    for (const operation of [
      "planning",
      "execution",
      "verification",
      "supervision",
      "review",
    ]) {
      const running = {
        run_id: `run-${operation}`,
        operation,
        trigger: "initial",
        status: "running",
      };
      const completed = { ...running, status: "completed" };
      assert.doesNotThrow(() => assertAgentRunTransition(running, completed));
      assert.throws(
        () =>
          assertAgentRunTransition(completed, {
            ...completed,
            status: "running",
          }),
        { code: "INVALID_RUN_TRANSITION" },
      );
      assert.throws(
        () =>
          assertAgentRunTransition(running, {
            ...completed,
            trigger: "feedback",
          }),
        { code: "INVALID_RUN_TRANSITION" },
      );
      for (const terminalStatus of [
        "completed",
        "failed",
        "interrupted",
        "cancelled",
      ]) {
        const terminal = { ...running, status: terminalStatus };
        assert.doesNotThrow(() => assertAgentRunTransition(running, terminal));
        assert.doesNotThrow(() => assertAgentRunTransition(terminal, terminal));
        assert.throws(() => assertAgentRunTransition(terminal, running), {
          code: "INVALID_RUN_TRANSITION",
        });
      }
    }
  });

  test("derives activity from Runs, Gates, Blockers, and exact completion", () => {
    const changeSet = {
      phase: "working",
      run_references: [],
      gates: [],
      blockers: [],
    };
    const workUnit = {
      work_unit_id: "unit-1",
      phase: "execution",
      run_references: [],
    };
    assert.equal(derivePresentationActivity(changeSet, workUnit), "ready");
    workUnit.run_references.push({ status: "running" });
    assert.equal(derivePresentationActivity(changeSet, workUnit), "running");
    workUnit.run_references[0].status = "completed";
    changeSet.gates.push({ status: "open", work_unit_id: "unit-1" });
    assert.equal(derivePresentationActivity(changeSet, workUnit), "waiting");
    changeSet.gates[0].status = "resolved";
    changeSet.blockers.push({ work_unit_id: "unit-1" });
    assert.equal(derivePresentationActivity(changeSet, workUnit), "blocked");
    changeSet.blockers[0].resolved_at = "2026-08-06T00:00:00.000Z";
    workUnit.phase = "complete";
    assert.equal(derivePresentationActivity(changeSet, workUnit), "complete");
  });
});
