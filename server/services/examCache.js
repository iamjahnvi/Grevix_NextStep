// =============================================================================
// EXAM READ CACHE — server/services/examCache.js
// =============================================================================
// WHAT: A time-limited cache in front of the full-exam Mongo read used by the
//   recommend/discover endpoints. Every entry expires after EXAM_CACHE_TTL_SECONDS
//   (default 60s); when off (0/invalid) reads always hit the database.
// WHY: Bounds how often the whole collection is re-read, and gives the freshness
//   redesign a concrete, observable "cache with expiration". Freshness itself is
//   always computed at response time from each record's lastVerifiedAt — the
//   cache never freezes a freshness verdict, only the underlying records.
// INVALIDATION: Any write that changes eligibility/verification (manual
//   correction, re-verify) calls invalidateExamCache() so the next read reloads.
// =============================================================================

const Exam = require("../models/Exam");
const { TtlCache } = require("./ttlCache");

const DEFAULT_EXAM_CACHE_TTL_SECONDS = 60;

function resolveExamCacheTtlMs(value = process.env.EXAM_CACHE_TTL_SECONDS) {
    if (value === undefined || value === null || String(value).trim() === "") {
        return DEFAULT_EXAM_CACHE_TTL_SECONDS * 1000;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0; // disabled
    return parsed * 1000;
}

const examCache = new TtlCache({ defaultTtlMs: resolveExamCacheTtlMs() });

const cacheKey = (includeDemoData) => (includeDemoData ? "exams:with-demo" : "exams:live");

const loadExams = (includeDemoData) =>
    Exam.find(includeDemoData ? {} : { isDemo: { $ne: true } });

// Returns { exams, cache } where cache = { enabled, hit, ageMs, ttlMs }.
async function getExams(includeDemoData = false) {
    const ttlMs = resolveExamCacheTtlMs();
    if (ttlMs <= 0) {
        const exams = await loadExams(includeDemoData);
        return { exams, cache: { enabled: false, hit: false, ageMs: 0, ttlMs: 0 } };
    }
    const result = await examCache.getOrSet(
        cacheKey(includeDemoData),
        () => loadExams(includeDemoData),
        ttlMs
    );
    return {
        exams: result.value,
        cache: { enabled: true, hit: result.hit, ageMs: result.ageMs, ttlMs: result.ttlMs },
    };
}

function invalidateExamCache() {
    examCache.clear();
}

function examCacheStats() {
    return { ...examCache.stats(), enabled: resolveExamCacheTtlMs() > 0 };
}

module.exports = {
    DEFAULT_EXAM_CACHE_TTL_SECONDS,
    resolveExamCacheTtlMs,
    getExams,
    invalidateExamCache,
    examCacheStats,
    examCache,
};
