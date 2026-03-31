/**
 * Lightweight in-memory usage metrics.
 *
 * Tracks cumulative counters for key events. Counters reset on restart
 * (ephemeral by design, like the rest of ready-check). The periodic log
 * line is picked up by Lightsail → CloudWatch for historical visibility.
 */

const metrics = {
  startedAt: Date.now(),

  // Cumulative counters
  sessionsCreated: 0,
  participantsJoined: 0,
  readyChecksIssued: 0,
  responsesReady: 0,
  responsesNeedHelp: 0,
  checksAutoCompleted: 0,
  checksTimedOut: 0,
  checksManuallyEnded: 0,
};

/** Increment a counter by name */
function inc(name, amount = 1) {
  if (name in metrics && typeof metrics[name] === 'number') {
    metrics[name] += amount;
  }
}

/** Get a snapshot of all metrics */
function snapshot(store) {
  const uptime = Math.floor((Date.now() - metrics.startedAt) / 1000);
  const storeStats = store ? store.getStats() : {};

  return {
    uptime,
    // Current state (from session store)
    activeSessions: storeStats.activeSessions || 0,
    activeParticipants: storeStats.totalParticipants || 0,

    // Cumulative counters (since last restart)
    sessionsCreated: metrics.sessionsCreated,
    participantsJoined: metrics.participantsJoined,
    readyChecksIssued: metrics.readyChecksIssued,
    responsesReady: metrics.responsesReady,
    responsesNeedHelp: metrics.responsesNeedHelp,
    checksAutoCompleted: metrics.checksAutoCompleted,
    checksTimedOut: metrics.checksTimedOut,
    checksManuallyEnded: metrics.checksManuallyEnded,
  };
}

/** Log a summary line to stdout (picked up by CloudWatch) */
function logSummary(store) {
  const s = snapshot(store);
  console.log(
    `[metrics] uptime=${s.uptime}s active_sessions=${s.activeSessions} ` +
      `active_participants=${s.activeParticipants} sessions_created=${s.sessionsCreated} ` +
      `participants_joined=${s.participantsJoined} checks_issued=${s.readyChecksIssued} ` +
      `responses_ready=${s.responsesReady} responses_need_help=${s.responsesNeedHelp} ` +
      `auto_completed=${s.checksAutoCompleted} timed_out=${s.checksTimedOut} ` +
      `manually_ended=${s.checksManuallyEnded}`
  );
}

/**
 * Start periodic logging. Call once at server startup.
 * Logs every 5 minutes by default.
 */
function startPeriodicLogging(store, intervalMs = 5 * 60 * 1000) {
  const timer = setInterval(() => logSummary(store), intervalMs);
  timer.unref();
  return timer;
}

module.exports = { inc, snapshot, logSummary, startPeriodicLogging };
