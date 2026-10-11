// =============================================================================
// EXAM DATA FRESHNESS — server/utils/examFreshness.js
// =============================================================================
// WHAT: Turns a stored `lastVerifiedAt` timestamp into a freshness verdict so
//   the app can distinguish data that is still trustworthy from data that may
//   have silently drifted (authorities often delay updating their sites/PDFs).
// WHY: Eligibility and registration dates are only as good as the last time a
//   human/probe confirmed them. Rather than trusting every record as live, we
//   attach a time-to-live (TTL) to each verification. When the TTL lapses the
//   record is reported STALE — still visible (core discovery is unaffected) but
//   clearly flagged so a student is never misled into a false "you qualify".
// MODEL:
//   UNVERIFIED -> no usable lastVerifiedAt (also covers a future timestamp,
//                 which is treated as untrustworthy rather than valid).
//   CURRENT    -> now <= lastVerifiedAt + TTL.
//   STALE      -> verification older than the TTL (may be outdated).
// TUNABILITY: The TTL defaults to 30 days but can be tuned per deployment with
//   FRESHNESS_TTL_DAYS. A shorter TTL raises accuracy (catches drift sooner) at
//   the cost of more records needing re-verification; a longer TTL favours
//   availability. Callers may also override the TTL per call for what-if use.
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FRESHNESS_TTL_DAYS = 30;

// Reads a positive, finite TTL (in days) from the environment, falling back to
// the default for anything missing/malformed. Never throws — a bad config
// degrades to the safe default rather than breaking reads.
function resolveTtlDays(value = process.env.FRESHNESS_TTL_DAYS) {
    if (value === undefined || value === null || String(value).trim() === "") {
        return DEFAULT_FRESHNESS_TTL_DAYS;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_FRESHNESS_TTL_DAYS;
    }
    return parsed;
}

// Resolved at import time so the exported constant stays stable for callers
// that compute CURRENT/STALE boundaries themselves; per-call overrides remain
// available through the `ttlDays` parameter.
const FRESHNESS_TTL_DAYS = resolveTtlDays();

function getExamFreshness(exam, now = new Date(), ttlDays = FRESHNESS_TTL_DAYS) {
    const lastVerifiedAt = exam?.lastVerifiedAt ? new Date(exam.lastVerifiedAt) : null;
    const validVerificationDate = lastVerifiedAt && !Number.isNaN(lastVerifiedAt.getTime());

    if (!validVerificationDate || lastVerifiedAt > now) {
        return {
            status: "UNVERIFIED",
            lastVerifiedAt: null,
            expiresAt: null,
            ttlDays,
            ageInDays: null,
            daysUntilExpiry: null,
        };
    }

    const ttlMs = ttlDays * DAY_MS;
    const expiresAt = new Date(lastVerifiedAt.getTime() + ttlMs);
    const isCurrent = now <= expiresAt;
    return {
        status: isCurrent ? "CURRENT" : "STALE",
        lastVerifiedAt: lastVerifiedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttlDays,
        // Whole days since verification, and whole days left before the TTL
        // lapses (negative once stale). Both null when there is nothing to age.
        ageInDays: Math.floor((now.getTime() - lastVerifiedAt.getTime()) / DAY_MS),
        daysUntilExpiry: Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
    };
}

// True when a record has a usable verification timestamp that is already past
// its TTL — the trigger for re-verification (see the operator verify endpoint).
function isFreshnessExpired(exam, now = new Date(), ttlDays = FRESHNESS_TTL_DAYS) {
    return getExamFreshness(exam, now, ttlDays).status === "STALE";
}

function withExamFreshness(exam, now = new Date(), ttlDays = FRESHNESS_TTL_DAYS) {
    const value = typeof exam?.toObject === "function" ? exam.toObject() : { ...exam };
    return { ...value, freshness: getExamFreshness(value, now, ttlDays) };
}

module.exports = {
    DEFAULT_FRESHNESS_TTL_DAYS,
    FRESHNESS_TTL_DAYS,
    resolveTtlDays,
    getExamFreshness,
    isFreshnessExpired,
    withExamFreshness,
};
