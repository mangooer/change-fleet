export const LIVE_CONNECTION_STATUS = Object.freeze({
  INITIAL_CONNECTING: "initial_connecting",
  CONNECTED: "connected",
  INTERRUPTED: "interrupted",
  RECONNECTING: "reconnecting",
  RESYNCING: "resyncing",
  RECONNECT_FAILED: "reconnect_failed",
});

export function createLiveConnectionState(changeSetId = null) {
  return {
    change_set_id: changeSetId,
    status: LIVE_CONNECTION_STATUS.INITIAL_CONNECTING,
    has_connected: false,
    reconnect_attempts: 0,
    recovery_refresh_attempts: 0,
    interrupted_at: null,
    last_connected_at: null,
    last_recovered_at: null,
    last_error: null,
    next_recovery_attempt_at: null,
    recovery_pending: false,
  };
}

export function beginLiveConnectionAttempt(connection) {
  const reconnectAttempts = connection.reconnect_attempts + 1;
  return {
    ...connection,
    status:
      !connection.has_connected && reconnectAttempts === 1
        ? LIVE_CONNECTION_STATUS.INITIAL_CONNECTING
        : LIVE_CONNECTION_STATUS.RECONNECTING,
    reconnect_attempts: reconnectAttempts,
  };
}

export function markLiveConnectionOpened(connection, at = new Date().toISOString()) {
  if (!connection.has_connected) return connection;
  return {
    ...connection,
    status: LIVE_CONNECTION_STATUS.RESYNCING,
    recovery_pending: true,
    recovery_refresh_attempts: 0,
    last_connected_at: at,
    last_error: null,
    next_recovery_attempt_at: null,
  };
}

export function markLiveProjectionReceived(connection, at = new Date().toISOString()) {
  if (connection.recovery_pending) {
    return {
      ...connection,
      has_connected: true,
      last_connected_at: at,
      last_error: null,
    };
  }
  return {
    ...connection,
    status: LIVE_CONNECTION_STATUS.CONNECTED,
    has_connected: true,
    reconnect_attempts: 0,
    recovery_refresh_attempts: 0,
    interrupted_at: null,
    last_connected_at: at,
    last_error: null,
    next_recovery_attempt_at: null,
  };
}

export function markLiveConnectionInterrupted(
  connection,
  error,
  at = new Date().toISOString(),
) {
  return {
    ...connection,
    status: LIVE_CONNECTION_STATUS.INTERRUPTED,
    interrupted_at: at,
    last_error: errorMessage(error),
    next_recovery_attempt_at: null,
    recovery_pending: connection.has_connected,
  };
}

export function markLiveReconnectWaiting(connection) {
  return {
    ...connection,
    status:
      connection.reconnect_attempts >= 3
        ? LIVE_CONNECTION_STATUS.RECONNECT_FAILED
        : LIVE_CONNECTION_STATUS.RECONNECTING,
  };
}

export function markLiveRecoveryComplete(connection, at = new Date().toISOString()) {
  return {
    ...connection,
    status: LIVE_CONNECTION_STATUS.CONNECTED,
    has_connected: true,
    reconnect_attempts: 0,
    recovery_refresh_attempts: 0,
    interrupted_at: null,
    last_connected_at: at,
    last_recovered_at: at,
    last_error: null,
    next_recovery_attempt_at: null,
    recovery_pending: false,
  };
}

export function markLiveRecoveryRefreshFailed(connection, error, nextAttemptAt) {
  return {
    ...connection,
    status: LIVE_CONNECTION_STATUS.RESYNCING,
    recovery_pending: true,
    recovery_refresh_attempts: connection.recovery_refresh_attempts + 1,
    last_error: errorMessage(error),
    next_recovery_attempt_at: nextAttemptAt,
  };
}

export function reconnectDelayMs(connection) {
  const attempt = Math.max(connection.reconnect_attempts, 1);
  return Math.min(1_000 * 2 ** (attempt - 1), 8_000);
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "unknown_error");
}
