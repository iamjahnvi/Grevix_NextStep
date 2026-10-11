const FRESHNESS_TTL_DAYS = 30;
const FRESHNESS_TTL_MS = FRESHNESS_TTL_DAYS * 24 * 60 * 60 * 1000;

function getExamFreshness(exam, now = new Date()) {
    const lastVerifiedAt = exam?.lastVerifiedAt ? new Date(exam.lastVerifiedAt) : null;
    const validVerificationDate = lastVerifiedAt && !Number.isNaN(lastVerifiedAt.getTime());

    if (!validVerificationDate || lastVerifiedAt > now) {
        return { status: "UNVERIFIED", lastVerifiedAt: null, expiresAt: null };
    }

    const expiresAt = new Date(lastVerifiedAt.getTime() + FRESHNESS_TTL_MS);
    return {
        status: now <= expiresAt ? "CURRENT" : "STALE",
        lastVerifiedAt: lastVerifiedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
    };
}

function withExamFreshness(exam, now = new Date()) {
    const value = typeof exam?.toObject === "function" ? exam.toObject() : { ...exam };
    return { ...value, freshness: getExamFreshness(value, now) };
}

module.exports = { FRESHNESS_TTL_DAYS, getExamFreshness, withExamFreshness };
