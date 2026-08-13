import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LIVE_CONNECTION_STATUS,
  beginLiveConnectionAttempt,
  createLiveConnectionState,
  markLiveConnectionInterrupted,
  markLiveConnectionOpened,
  markLiveProjectionReceived,
  markLiveRecoveryRefreshFailed,
  markLiveReconnectWaiting,
  markLiveRecoveryComplete,
  reconnectDelayMs,
} from "../../src/ui/local-console/live-connection.js";

describe("local console live connection state", () => {
  test("tracks the initial connection until the first projection arrives", () => {
    let connection = createLiveConnectionState("change");
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.INITIAL_CONNECTING);

    connection = beginLiveConnectionAttempt(connection);
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.INITIAL_CONNECTING);

    connection = markLiveProjectionReceived(connection, "2026-08-12T00:00:00Z");
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.CONNECTED);
    assert.equal(connection.has_connected, true);
    assert.equal(connection.reconnect_attempts, 0);
  });

  test("makes repeated initial failures visible as reconnecting and failed", () => {
    let connection = createLiveConnectionState("change");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      connection = beginLiveConnectionAttempt(connection);
      connection = markLiveConnectionInterrupted(connection, new Error("offline"));
      connection = markLiveReconnectWaiting(connection);
    }

    assert.equal(connection.has_connected, false);
    assert.equal(connection.reconnect_attempts, 3);
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.RECONNECT_FAILED);
    assert.equal(reconnectDelayMs(connection), 4_000);
  });

  test("distinguishes interruption, reconnecting, and recovery resync", () => {
    let connection = createLiveConnectionState("change");
    connection = markLiveProjectionReceived(connection, "2026-08-12T00:00:00Z");

    connection = markLiveConnectionInterrupted(
      connection,
      new Error("stream closed"),
      "2026-08-12T00:00:05Z",
    );
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.INTERRUPTED);
    assert.equal(connection.last_error, "stream closed");

    connection = beginLiveConnectionAttempt(connection);
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.RECONNECTING);
    assert.equal(connection.reconnect_attempts, 1);

    connection = markLiveConnectionOpened(connection, "2026-08-12T00:00:06Z");
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.RESYNCING);
    assert.equal(connection.recovery_pending, true);

    connection = markLiveProjectionReceived(connection, "2026-08-12T00:00:06Z");
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.RESYNCING);

    connection = markLiveRecoveryRefreshFailed(
      connection,
      new Error("HTTP 503"),
      "2026-08-12T00:00:08Z",
    );
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.RESYNCING);
    assert.equal(connection.recovery_refresh_attempts, 1);
    assert.equal(connection.next_recovery_attempt_at, "2026-08-12T00:00:08Z");

    connection = markLiveRecoveryComplete(connection, "2026-08-12T00:00:09Z");
    assert.equal(connection.status, LIVE_CONNECTION_STATUS.CONNECTED);
    assert.equal(connection.last_recovered_at, "2026-08-12T00:00:09Z");
    assert.equal(connection.recovery_pending, false);
    assert.equal(connection.recovery_refresh_attempts, 0);
  });

  test("surfaces repeated reconnect failures without treating idle as disconnected", () => {
    let connection = createLiveConnectionState("change");
    connection = markLiveProjectionReceived(connection, "2026-08-12T00:00:00Z");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      connection = markLiveConnectionInterrupted(connection, new Error("offline"));
      connection = beginLiveConnectionAttempt(connection);
    }
    connection = markLiveReconnectWaiting(connection);

    assert.equal(connection.status, LIVE_CONNECTION_STATUS.RECONNECT_FAILED);
    assert.equal(reconnectDelayMs(connection), 4_000);
  });
});
