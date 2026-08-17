import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  appendAgentSessionRun,
  assertAgentSessions,
  createAgentSessionRecords,
  requireAgentSession,
} from "../../src/domain/agent-session.js";
import { TEST_AGENT_PROFILE } from "../support/scripted-runtime.js";

describe("task-scoped AgentSession authority", () => {
  test("coalesces one exact Profile into a stable role-scoped session", () => {
    const sessions = createAgentSessionRecords({
      taskWorkspaceId: "task-workspace-1",
      assignments: [
        {
          agentProfile: TEST_AGENT_PROFILE,
          allowedRunPurposes: ["execution", "planning"],
        },
        {
          agentProfile: TEST_AGENT_PROFILE,
          allowedRunPurposes: ["verification", "integration"],
        },
      ],
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].allowed_run_purposes, [
      "execution",
      "integration",
      "planning",
      "verification",
    ]);
    assert.equal(
      sessions[0].agent_session_id,
      createAgentSessionRecords({
        taskWorkspaceId: "task-workspace-1",
        assignments: [
          {
            agentProfile: TEST_AGENT_PROFILE,
            allowedRunPurposes: [
              "verification",
              "planning",
              "integration",
              "execution",
            ],
          },
        ],
        createdAt: "2026-08-18T00:00:00.000Z",
      })[0].agent_session_id,
    );
  });

  test("authorizes and records only Runs covered by the selected session", () => {
    const taskWorkspace = {
      task_workspace_id: "task-workspace-1",
      agent_sessions: createAgentSessionRecords({
        taskWorkspaceId: "task-workspace-1",
        assignments: [
          {
            agentProfile: TEST_AGENT_PROFILE,
            allowedRunPurposes: ["planning", "execution"],
          },
        ],
        createdAt: "2026-08-17T00:00:00.000Z",
      }),
    };
    assertAgentSessions(taskWorkspace);
    const session = requireAgentSession(
      taskWorkspace,
      TEST_AGENT_PROFILE,
      "execution",
    );
    appendAgentSessionRun(taskWorkspace, session.agent_session_id, {
      run_id: "run-1",
      operation: "execution",
      status: "running",
    });
    assert.equal(session.run_references.length, 1);

    assert.throws(
      () => requireAgentSession(taskWorkspace, TEST_AGENT_PROFILE, "review"),
      { code: "AGENT_SESSION_NOT_AUTHORIZED" },
    );
    assert.throws(
      () =>
        appendAgentSessionRun(taskWorkspace, session.agent_session_id, {
          run_id: "run-2",
          operation: "integration",
          status: "queued",
        }),
      { code: "AGENT_SESSION_NOT_AUTHORIZED" },
    );
  });
});
