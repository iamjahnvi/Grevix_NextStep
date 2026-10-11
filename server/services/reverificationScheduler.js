// =============================================================================
// RE-VERIFICATION SCHEDULER — server/services/reverificationScheduler.js
// =============================================================================
// WHAT: Lightweight, pluggable scheduler for automatic source re-verification.
//   Runs on an interval using setInterval (no external cron deps). Starts from
//   server.js. Can be stopped/restarted via returned methods.
// WHY: Keeps EXAM freshness CURRENT when the official source is unchanged;
//   only leaves STALE when drift/unreachable is detected (or never if forever
//   unchanged). Configurable by env.
// =============================================================================

const { reverifyExpiredExams } = require("./examReverification");

function envNumber(name, fallback) {
    if (typeof process.env[name] === "undefined") return fallback;
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function createReverificationScheduler(opts = {}) {
    const enabled = opts.enabled !== undefined ? Boolean(opts.enabled) : process.env.REVERIFY_ENABLED !== "false";
    const intervalMinutes = envNumber("REVERIFY_INTERVAL_MINUTES", opts.intervalMinutes !== undefined ? opts.intervalMinutes : 30);
    const limit = envNumber("REVERIFY_LIMIT_PER_RUN", opts.limit !== undefined ? opts.limit : 5);
    const intervalMs = intervalMinutes * 60 * 1000;
    let timer = null;
    let running = false;
    let lastRunAt = null;
    let lastSummary = null;

    async function runOnce(ctx = {}) {
        if (running) return { skipped: true, reason: "already running" };
        running = true;
        try {
            const summary = await reverifyExpiredExams({ limit, ...ctx });
            lastRunAt = new Date();
            lastSummary = summary;
            return summary;
        } finally {
            running = false;
        }
    }

    function start() {
        if (!enabled) return { started: false, reason: "disabled" };
        if (timer) return { started: false, reason: "already started" };
        timer = setInterval(() => runOnce().catch(() => {}), intervalMs);
        if (timer.unref) timer.unref();
        return { started: true, intervalMs, intervalMinutes, limit };
    }

    function stop() {
        if (!timer) return { stopped: false, reason: "not started" };
        clearInterval(timer);
        timer = null;
        return { stopped: true };
    }

    function stats() {
        return {
            enabled,
            started: Boolean(timer),
            running,
            intervalMinutes,
            intervalMs,
            limit,
            lastRunAt,
            lastSummary,
        };
    }

    return { start, stop, runOnce, stats };
}

module.exports = { createReverificationScheduler };
