// =============================================================================
// server/tests/ttlCache.test.js
// =============================================================================
// WHAT: Coverage for the in-memory cache with expiration (the "caching with
//   expiration" primitive behind the freshness redesign).
// WHY: Expiry, read-through, metrics and the disable switch must be exact —
//   a cache that serves expired data silently undermines the whole safeguard.
// RUN: npm test (node --test tests/)
// =============================================================================

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { TtlCache } = require("../services/ttlCache");
const { resolveExamCacheTtlMs, DEFAULT_EXAM_CACHE_TTL_SECONDS } = require("../services/examCache");

const t0 = 1_000_000;

describe("TtlCache — expiry", () => {
    it("serves a value before its TTL and reports its age", () => {
        const cache = new TtlCache();
        cache.set("k", "v", 1000, t0);
        const hit = cache.get("k", t0 + 400);
        assert.ok(hit);
        assert.equal(hit.value, "v");
        assert.equal(hit.ageMs, 400);
        assert.equal(hit.ttlMs, 1000);
    });

    it("treats an entry as expired at the boundary instant", () => {
        const cache = new TtlCache();
        cache.set("k", "v", 1000, t0);
        assert.equal(cache.get("k", t0 + 999).value, "v");
        assert.equal(cache.get("k", t0 + 1000), null);
        assert.equal(cache.get("k", t0 + 1000), null);
    });

    it("counts hits, misses and evictions in stats", () => {
        const cache = new TtlCache();
        cache.set("k", "v", 1000, t0);
        cache.get("k", t0 + 1); // hit
        cache.get("missing", t0 + 1); // miss
        cache.get("k", t0 + 5000); // expired -> miss
        cache.get("k", t0 + 5000); // miss
        const stats = cache.stats();
        assert.equal(stats.hits, 1);
        assert.equal(stats.misses, 3);
        assert.equal(stats.expired, 1);
        assert.equal(stats.size, 0);
    });

    it("does not cache when TTL is non-positive (disable switch)", () => {
        const cache = new TtlCache();
        assert.equal(cache.set("k", "v", 0, t0), null);
        assert.equal(cache.get("k", t0), null);
    });
});

describe("TtlCache — read-through & capacity", () => {
    it("loads once then serves from cache", async () => {
        const cache = new TtlCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return ["exam"];
        };
        const first = await cache.getOrSet("exams", loader, 1000, t0);
        const second = await cache.getOrSet("exams", loader, 1000, t0 + 10);
        assert.equal(loads, 1);
        assert.equal(first.hit, false);
        assert.equal(second.hit, true);
        assert.deepEqual(second.value, ["exam"]);
    });

    it("reloads after the entry expires", async () => {
        const cache = new TtlCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return loads;
        };
        await cache.getOrSet("k", loader, 1000, t0);
        await cache.getOrSet("k", loader, 1000, t0 + 2000);
        assert.equal(loads, 2);
    });

    it("evicts the oldest entries beyond capacity", () => {
        const cache = new TtlCache({ maxEntries: 2 });
        cache.set("a", 1, 1000, t0);
        cache.set("b", 2, 1000, t0 + 1);
        cache.set("c", 3, 1000, t0 + 2);
        assert.equal(cache.get("a", t0 + 3), null);
        assert.equal(cache.get("c", t0 + 3).value, 3);
        assert.equal(cache.stats().evictions, 1);
    });

    it("clear() empties the cache", () => {
        const cache = new TtlCache();
        cache.set("k", "v", 1000, t0);
        cache.clear();
        assert.equal(cache.get("k", t0), null);
        assert.equal(cache.stats().size, 0);
    });
});

describe("exam cache — configuration", () => {
    it("defaults to 60 seconds and disables on non-positive values", () => {
        assert.equal(resolveExamCacheTtlMs(undefined), DEFAULT_EXAM_CACHE_TTL_SECONDS * 1000);
        assert.equal(resolveExamCacheTtlMs("30"), 30_000);
        assert.equal(resolveExamCacheTtlMs("0"), 0);
        assert.equal(resolveExamCacheTtlMs("nope"), 0);
    });
});
