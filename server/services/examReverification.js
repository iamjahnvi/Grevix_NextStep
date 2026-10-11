// =============================================================================
// EXAM AUTO RE-VERIFICATION — server/services/examReverification.js
// =============================================================================
// WHAT: A source-driven re-verification worker that finds STALE exams and
//   re-checks their `officialWebsite` against the last stored snapshot hash.
// WHY: Users should not need a human to "kick" re-verification on a timer;
//   we still only renew freshness when evidence shows the source is unchanged.
// CONTRACT:
//   - selectExpiredExams({ ttlDays, now, limit }) → exams past TTL
//   - reverifyExam(exam, { fetchImpl, ttlDays, now, setVerifiedIfOk }) → result
//   - reverifyExpiredExams({ ttlDays, now, limit, fetchImpl, setVerifiedIfOk })
// =============================================================================

const crypto = require("crypto");
const Exam = require("../models/Exam");
const { markVerified } = require("./examEligibilityService");
const { getExamFreshness, resolveTtlDays, DEFAULT_FRESHNESS_TTL_DAYS } = require("../utils/examFreshness");

const DEFAULT_FETCH_TIMEOUT_MS = 8000;

function sha256Hex(buf) {
    if (Buffer.isBuffer(buf)) return crypto.createHash("sha256").update(buf).digest("hex");
    return crypto.createHash("sha256").update(Buffer.from(String(buf), "utf8")).digest("hex");
}

// Default HTTP fetch impl (Node 18+ global fetch). Safe for demo.
async function defaultFetchImpl(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
        const body = await res.arrayBuffer();
        const content = Buffer.from(body);
        const finalUrl = res.url || url;
        return {
            ok: res.ok,
            status: res.status,
            finalUrl,
            content,
            contentType: res.headers.get("content-type") || null,
        };
    } finally {
        clearTimeout(timeout);
    }
}

function hasEnoughEvidence(fetchRes) {
    // Accept ok responses with non-empty content (HEAD isn't universal; GET is fine).
    return Boolean(fetchRes && fetchRes.ok && fetchRes.content && fetchRes.content.length > 0);
}

// Persist only when the caller handed us a real (Mongoose) document, so the
// decision logic stays unit-testable with plain objects.
async function persist(exam) {
    if (exam && typeof exam.save === "function") await exam.save();
}

function selectExpiredExams(opts = {}) {
    const ttlDays = resolveTtlDays(opts.ttlDays);
    const now = opts.now instanceof Date ? opts.now : new Date();
    const limit = typeof opts.limit === "number" && opts.limit >= 1 ? opts.limit : 20;
    const query = { lastVerifiedAt: { $ne: null }, officialWebsite: { $exists: true, $ne: null } };
    return Exam.find(query)
        .then((exams) =>
            exams
                .filter((exam) => {
                    const freshness = getExamFreshness(exam, now, ttlDays);
                    return freshness.status === "STALE";
                })
                .slice(0, limit)
        );
}

async function reverifyExam(exam, opts = {}) {
    const ttlDays = resolveTtlDays(opts.ttlDays);
    const now = opts.now instanceof Date ? opts.now : new Date();
    const fetchImpl = typeof opts.fetchImpl === "function" ? opts.fetchImpl : defaultFetchImpl;
    const setVerifiedIfOk = opts.setVerifiedIfOk !== false;
    const started = Date.now();
    const url = exam.officialWebsite;
    if (!url) {
        return {
            ok: false,
            reason: "no officialWebsite",
            verified: false,
            durationMs: 0,
            examId: String(exam._id),
            examName: exam.name,
        };
    }
    try {
        const res = await fetchImpl(url);
        if (!hasEnoughEvidence(res)) {
            exam.verificationSnapshot = {
                sourceHash: null,
                checkedAt: now,
                documentUrl: res && res.finalUrl ? res.finalUrl : url,
                outcome: "UNREACHABLE",
                fetchMethod: "http",
                durationMs: Date.now() - started,
            };
            await persist(exam);
            return {
                ok: false,
                reason: "fetch failed",
                verified: false,
                durationMs: Date.now() - started,
                outcome: "UNREACHABLE",
                examId: String(exam._id),
                examName: exam.name,
            };
        }
        const currentHash = sha256Hex(res.content);
        const lastHash = exam.verificationSnapshot && exam.verificationSnapshot.sourceHash;
        // No prior hash means this is the first successful check of the source:
        // there is nothing to compare against, so a reachable source is
        // accepted as a baseline and counts as a verification. Subsequent
        // checks must match the stored hash to renew.
        const baselineEstablished = !lastHash;
        const unchanged = baselineEstablished || lastHash === currentHash;
        const outcome = unchanged ? "OK" : "CHANGED";
        exam.verificationSnapshot = {
            sourceHash: currentHash,
            checkedAt: now,
            documentUrl: res.finalUrl || url,
            outcome,
            fetchMethod: "http",
            durationMs: Date.now() - started,
        };
        if (unchanged && setVerifiedIfOk) {
            markVerified(exam, { updatedBy: "auto:reverify", note: "auto source re-check (unchanged)" });
        }
        await persist(exam);
        return {
            ok: true,
            reason: baselineEstablished ? "baseline" : unchanged ? "unchanged" : "drift",
            verified: unchanged && setVerifiedIfOk,
            baselineEstablished,
            durationMs: Date.now() - started,
            outcome,
            examId: String(exam._id),
            examName: exam.name,
        };
    } catch (error) {
        exam.verificationSnapshot = {
            sourceHash: null,
            checkedAt: now,
            documentUrl: url,
            outcome: "UNREACHABLE",
            fetchMethod: "http",
            durationMs: Date.now() - started,
        };
        await persist(exam);
        return {
            ok: false,
            reason: "error",
            verified: false,
            durationMs: Date.now() - started,
            outcome: "UNREACHABLE",
            examId: String(exam._id),
            examName: exam.name,
            error: error.message,
        };
    }
}

async function reverifyExpiredExams(opts = {}) {
    const ttlDays = resolveTtlDays(opts.ttlDays);
    const now = opts.now instanceof Date ? opts.now : new Date();
    const limit = typeof opts.limit === "number" && opts.limit >= 1 ? opts.limit : 20;
    const fetchImpl = typeof opts.fetchImpl === "function" ? opts.fetchImpl : defaultFetchImpl;
    const setVerifiedIfOk = opts.setVerifiedIfOk !== false;
    const exams = await selectExpiredExams({ ttlDays, now, limit });
    const results = [];
    for (const exam of exams) {
        const res = await reverifyExam(exam, { fetchImpl, ttlDays, now, setVerifiedIfOk });
        results.push(res);
    }
    return {
        total: exams.length,
        results,
        verified: results.filter((r) => r.verified).length,
        unchanged: results.filter((r) => r.outcome === "OK").length,
        drift: results.filter((r) => r.outcome === "CHANGED").length,
        unreachable: results.filter((r) => r.outcome === "UNREACHABLE").length,
        ttlDays: ttlDays === undefined ? DEFAULT_FRESHNESS_TTL_DAYS : ttlDays,
        ranAt: now.toISOString(),
    };
}

module.exports = {
    defaultFetchImpl,
    reverifyExam,
    reverifyExpiredExams,
    selectExpiredExams,
};
