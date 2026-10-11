// =============================================================================
// server/tests/examReverification.test.js
// =============================================================================
// WHAT: Coverage for the source-driven auto re-verification decisions: renew
//   freshness only when the fetched source is unchanged; flag drift, and treat
//   unreachable sources as a failed (never verified) check.
// RUN: npm test
// =============================================================================

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { reverifyExam } = require("../services/examReverification");
const { createReverificationScheduler } = require("../services/reverificationScheduler");
const { getExamFreshness } = require("../utils/examFreshness");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-12T00:00:00.000Z");
const hashOf = (text) => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const staleExam = (overrides = {}) => ({
    _id: "exam-1",
    name: "Reverify Exam",
    officialWebsite: "https://example.com/exam",
    lastVerifiedAt: new Date(NOW.getTime() - 40 * DAY_MS),
    verificationSnapshot: null,
    manualEdits: [],
    ...overrides,
});

describe("auto re-verification — evidence-driven renewal", () => {
    it("renews freshness when the source is unchanged", async () => {
        const exam = staleExam({
            verificationSnapshot: { sourceHash: hashOf("stable page") },
        });
        const fetchImpl = async (url) => ({ ok: true, finalUrl: url, content: Buffer.from("stable page") });

        const result = await reverifyExam(exam, { fetchImpl, now: NOW, ttlDays: 30 });

        assert.equal(result.verified, true);
        assert.equal(result.outcome, "OK");
        assert.equal(getExamFreshness(exam, NOW, 30).status, "CURRENT");
        assert.equal(exam.verificationSnapshot.outcome, "OK");
        assert.equal(exam.manualEdits[0].updatedBy, "auto:reverify");
    });

    it("establishes a baseline and renews on the first reachable check", async () => {
        const exam = staleExam(); // no prior verificationSnapshot
        const fetchImpl = async (url) => ({ ok: true, finalUrl: url, content: Buffer.from("first sight") });

        const result = await reverifyExam(exam, { fetchImpl, now: NOW, ttlDays: 30 });

        assert.equal(result.verified, true);
        assert.equal(result.reason, "baseline");
        assert.equal(result.baselineEstablished, true);
        assert.equal(getExamFreshness(exam, NOW, 30).status, "CURRENT");
    });

    it("does not renew when the source content changed (drift)", async () => {
        const exam = staleExam({
            verificationSnapshot: { sourceHash: hashOf("old page") },
        });
        const fetchImpl = async (url) => ({ ok: true, finalUrl: url, content: Buffer.from("new page") });

        const result = await reverifyExam(exam, { fetchImpl, now: NOW, ttlDays: 30 });

        assert.equal(result.verified, false);
        assert.equal(result.outcome, "CHANGED");
        assert.equal(getExamFreshness(exam, NOW, 30).status, "STALE");
        assert.equal(exam.verificationSnapshot.outcome, "CHANGED");
    });

    it("treats a non-ok response as unreachable and keeps the record stale", async () => {
        const exam = staleExam();
        const fetchImpl = async (url) => ({ ok: false, status: 500, finalUrl: url, content: Buffer.alloc(0) });

        const result = await reverifyExam(exam, { fetchImpl, now: NOW, ttlDays: 30 });

        assert.equal(result.verified, false);
        assert.equal(result.outcome, "UNREACHABLE");
        assert.equal(getExamFreshness(exam, NOW, 30).status, "STALE");
    });

    it("treats a thrown fetch error as unreachable", async () => {
        const exam = staleExam();
        const fetchImpl = async () => { throw new Error("connect timeout"); };

        const result = await reverifyExam(exam, { fetchImpl, now: NOW, ttlDays: 30 });

        assert.equal(result.verified, false);
        assert.equal(result.outcome, "UNREACHABLE");
        assert.equal(result.error, "connect timeout");
    });

    it("can observe an unchanged source without renewing (dry signal)", async () => {
        const exam = staleExam({
            verificationSnapshot: { sourceHash: hashOf("stable page") },
        });
        const fetchImpl = async (url) => ({ ok: true, finalUrl: url, content: Buffer.from("stable page") });

        const result = await reverifyExam(exam, { fetchImpl, now: NOW, ttlDays: 30, setVerifiedIfOk: false });

        assert.equal(result.verified, false);
        assert.equal(result.outcome, "OK");
        assert.equal(getExamFreshness(exam, NOW, 30).status, "STALE");
    });
});

describe("auto re-verification — scheduler config", () => {
    it("is disabled by default and does not start", () => {
        const scheduler = createReverificationScheduler();
        const stats = scheduler.stats();
        assert.equal(stats.enabled, false);
        assert.equal(stats.started, false);
        assert.deepEqual(scheduler.start(), { started: false, reason: "disabled" });
    });

    it("starts and stops on an explicit interval", () => {
        const scheduler = createReverificationScheduler({ enabled: true, intervalMinutes: 45, limit: 2 });
        const started = scheduler.start();
        assert.equal(started.started, true);
        assert.equal(scheduler.stats().intervalMinutes, 45);
        assert.equal(scheduler.stats().limit, 2);
        assert.equal(scheduler.stats().started, true);
        scheduler.stop();
        assert.equal(scheduler.stats().started, false);
    });
});
