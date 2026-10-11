// =============================================================================
// server/tests/examFreshness.test.js
// =============================================================================
// WHAT: Coverage for the configurable freshness TTL, its age/expiry metadata,
//   the expiry predicate, and the operator re-verification service.
// WHY: The delayed-update safeguard depends on the TTL boundary being exact and
//   tunable, and on expiry being resettable without editing data values.
// RUN: npm test (node --test tests/)
// =============================================================================

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const Exam = require("../models/Exam");
const {
    DEFAULT_FRESHNESS_TTL_DAYS,
    resolveTtlDays,
    getExamFreshness,
    isFreshnessExpired,
    withExamFreshness,
} = require("../utils/examFreshness");
const { markVerified, getFieldProvenance } = require("../services/examEligibilityService");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-11T00:00:00.000Z");

describe("freshness TTL — configuration", () => {
    it("falls back to the default for missing/invalid values", () => {
        assert.equal(resolveTtlDays(undefined), DEFAULT_FRESHNESS_TTL_DAYS);
        assert.equal(resolveTtlDays(""), DEFAULT_FRESHNESS_TTL_DAYS);
        assert.equal(resolveTtlDays("abc"), DEFAULT_FRESHNESS_TTL_DAYS);
        assert.equal(resolveTtlDays("0"), DEFAULT_FRESHNESS_TTL_DAYS);
        assert.equal(resolveTtlDays("-5"), DEFAULT_FRESHNESS_TTL_DAYS);
    });

    it("honours a positive override", () => {
        assert.equal(resolveTtlDays("7"), 7);
        assert.equal(resolveTtlDays(2.5), 2.5);
    });
});

describe("freshness TTL — boundary & metadata", () => {
    it("a per-call TTL moves the CURRENT/STALE boundary", () => {
        const checkedAt = new Date(NOW.getTime() - 10 * DAY_MS);
        assert.equal(getExamFreshness({ lastVerifiedAt: checkedAt }, NOW, 20).status, "CURRENT");
        assert.equal(getExamFreshness({ lastVerifiedAt: checkedAt }, NOW, 5).status, "STALE");
    });

    it("the boundary is inclusive at the expiry instant", () => {
        const checkedAt = new Date(NOW.getTime() - 30 * DAY_MS);
        assert.equal(getExamFreshness({ lastVerifiedAt: checkedAt }, NOW, 30).status, "CURRENT");
        const justOver = new Date(NOW.getTime() - 30 * DAY_MS - 1);
        assert.equal(getExamFreshness({ lastVerifiedAt: justOver }, NOW, 30).status, "STALE");
    });

    it("reports age, countdown and effective TTL for a current record", () => {
        const checkedAt = new Date(NOW.getTime() - 5 * DAY_MS);
        const freshness = getExamFreshness({ lastVerifiedAt: checkedAt }, NOW, 30);
        assert.equal(freshness.status, "CURRENT");
        assert.equal(freshness.ttlDays, 30);
        assert.equal(freshness.ageInDays, 5);
        assert.equal(freshness.daysUntilExpiry, 25);
        assert.equal(freshness.expiresAt, new Date(checkedAt.getTime() + 30 * DAY_MS).toISOString());
    });

    it("reports a negative countdown for a stale record", () => {
        const checkedAt = new Date(NOW.getTime() - 35 * DAY_MS);
        const freshness = getExamFreshness({ lastVerifiedAt: checkedAt }, NOW, 30);
        assert.equal(freshness.status, "STALE");
        assert.equal(freshness.ageInDays, 35);
        assert.equal(freshness.daysUntilExpiry, -5);
    });

    it("keeps unverified records free of derived metadata", () => {
        const freshness = getExamFreshness({}, NOW, 30);
        assert.equal(freshness.status, "UNVERIFIED");
        assert.equal(freshness.ttlDays, 30);
        assert.equal(freshness.ageInDays, null);
        assert.equal(freshness.daysUntilExpiry, null);
        assert.equal(freshness.expiresAt, null);
    });

    it("isFreshnessExpired mirrors the STALE verdict (never UNVERIFIED)", () => {
        const stale = new Date(NOW.getTime() - 40 * DAY_MS);
        const current = new Date(NOW.getTime() - 1 * DAY_MS);
        assert.equal(isFreshnessExpired({ lastVerifiedAt: stale }, NOW, 30), true);
        assert.equal(isFreshnessExpired({ lastVerifiedAt: current }, NOW, 30), false);
        assert.equal(isFreshnessExpired({}, NOW, 30), false);
    });

    it("withExamFreshness annotates a plain object", () => {
        const verified = new Date(NOW.getTime() - 2 * DAY_MS);
        const result = withExamFreshness({ name: "X", lastVerifiedAt: verified }, NOW, 30);
        assert.equal(result.name, "X");
        assert.equal(result.freshness.status, "CURRENT");
    });

    it("points a current record at its next automated check (TTL lapse)", () => {
        const checkedAt = new Date(NOW.getTime() - 5 * DAY_MS);
        const freshness = getExamFreshness({ lastVerifiedAt: checkedAt }, NOW, 30);
        assert.equal(freshness.nextCheckAt, freshness.expiresAt);
        assert.equal(freshness.daysUntilNextCheck, 25);
        assert.equal(freshness.autoRecheck, true);
        assert.equal(typeof freshness.recheckIntervalMinutes, "number");
    });

    it("marks stale and unverified records as due for the next sweep", () => {
        const stale = getExamFreshness({ lastVerifiedAt: new Date(NOW.getTime() - 40 * DAY_MS) }, NOW, 30);
        assert.equal(stale.status, "STALE");
        assert.equal(stale.daysUntilNextCheck, 0);
        assert.equal(stale.nextCheckAt, NOW.toISOString());

        const unverified = getExamFreshness({}, NOW, 30);
        assert.equal(unverified.status, "UNVERIFIED");
        assert.equal(unverified.daysUntilNextCheck, 0);
        assert.equal(unverified.nextCheckAt, NOW.toISOString());
    });
});

describe("re-verification (markVerified)", () => {
    const baseExam = (overrides = {}) => ({
        name: "Reverify Exam",
        fullForm: "Reverify Examination",
        streams: ["Science"],
        subjects: ["Physics"],
        educationLevel: "12",
        registrationStartDate: new Date("2026-01-15"),
        registrationEndDate: new Date("2026-02-20"),
        officialWebsite: "https://example.com/exam",
        ...overrides,
    });

    it("stamps a fresh verification and restarts the TTL", () => {
        const doc = new Exam(baseExam({ lastVerifiedAt: new Date("2026-01-01") }));
        markVerified(doc, { updatedBy: "operator@example.com", note: "SOURCE_REVIEW", verifiedAt: NOW });
        assert.equal(doc.lastVerifiedAt.toISOString(), NOW.toISOString());
        assert.equal(getExamFreshness(doc, NOW, 30).status, "CURRENT");
    });

    it("audits the verification without flipping data provenance", () => {
        const doc = new Exam(baseExam({ origin: "SCRAPER" }));
        markVerified(doc, { updatedBy: "operator@example.com", verifiedAt: NOW });
        assert.equal(doc.origin, "SCRAPER");
        assert.equal(doc.manualEdits.length, 1);
        assert.equal(doc.manualEdits[0].field, "lastVerifiedAt");
        assert.equal(doc.manualEdits[0].updatedBy, "operator@example.com");
        // lastVerifiedAt is not an eligibility field, so field provenance is
        // unchanged by a pure verification.
        assert.equal(getFieldProvenance(doc, "streams"), "SCRAPER");
    });

    it("rejects an invalid verification date", () => {
        const doc = new Exam(baseExam({}));
        assert.throws(() => markVerified(doc, { verifiedAt: "not-a-date" }), /valid date/);
    });

    it("turns a stale record current after re-verification", () => {
        const stale = new Date(NOW.getTime() - 40 * DAY_MS);
        const doc = new Exam(baseExam({ lastVerifiedAt: stale }));
        assert.equal(getExamFreshness(doc, NOW, 30).status, "STALE");
        markVerified(doc, { verifiedAt: NOW });
        assert.equal(getExamFreshness(doc, NOW, 30).status, "CURRENT");
    });
});
