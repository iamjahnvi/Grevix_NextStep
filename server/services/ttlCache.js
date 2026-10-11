// =============================================================================
// TTL CACHE — server/services/ttlCache.js
// =============================================================================
// WHAT: A tiny in-memory cache where every entry carries an expiration time.
//   Reads return the stored value plus its age/expiry; expired entries are
//   treated as a miss and evicted lazily.
// WHY: The freshness challenge needs an explicit "caching with expiration"
//   mechanism. Together with examFreshness.js (which decides whether a stored
//   verification is still trustworthy), this cache bounds how often we re-read
//   the database and lets a caller observe whether it served cached data.
// CONTRACT:
//   - Values are stored by reference and must be treated as read-only: never
//     mutate a value returned from the cache (serialize/copy at the edges).
//   - `now` is injectable on every read for deterministic tests.
//   - Eviction is lazy (on read) plus a bounded-size sweep on write.
// =============================================================================

class TtlCache {
    constructor({ defaultTtlMs = 60_000, maxEntries = 500 } = {}) {
        this.defaultTtlMs = defaultTtlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
        this.metrics = { hits: 0, misses: 0, expired: 0, sets: 0, evictions: 0 };
    }

    // Returns { value, ageMs, expiresAt, ttlMs } on a live entry, else null.
    get(key, now = Date.now()) {
        const entry = this.entries.get(key);
        if (!entry) {
            this.metrics.misses += 1;
            return null;
        }
        if (now >= entry.expiresAt) {
            this.entries.delete(key);
            this.metrics.expired += 1;
            this.metrics.misses += 1;
            return null;
        }
        this.metrics.hits += 1;
        return {
            value: entry.value,
            ageMs: now - entry.storedAt,
            expiresAt: entry.expiresAt,
            ttlMs: entry.ttlMs,
        };
    }

    set(key, value, ttlMs = this.defaultTtlMs, now = Date.now()) {
        // A non-positive TTL means "do not cache" — store nothing so the next
        // read is always a miss. Keeps the disable switch at the call site.
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            this.entries.delete(key);
            return null;
        }
        this.entries.set(key, { value, storedAt: now, expiresAt: now + ttlMs, ttlMs });
        this.metrics.sets += 1;
        this.#enforceCapacity();
        return value;
    }

    // Read-through helper: serve a live entry, otherwise await the loader, store
    // and return it. Concurrent callers may both run the loader (no de-dup) —
    // acceptable here because loaders are cheap, idempotent reads.
    async getOrSet(key, loader, ttlMs = this.defaultTtlMs, now = Date.now()) {
        const cached = this.get(key, now);
        if (cached) {
            return { value: cached.value, hit: true, ageMs: cached.ageMs, ttlMs: cached.ttlMs };
        }
        const value = await loader();
        this.set(key, value, ttlMs, now);
        return { value, hit: false, ageMs: 0, ttlMs };
    }

    has(key, now = Date.now()) {
        return this.get(key, now) !== null;
    }

    delete(key) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }

    stats() {
        return {
            size: this.entries.size,
            maxEntries: this.maxEntries,
            defaultTtlMs: this.defaultTtlMs,
            ...this.metrics,
        };
    }

    #enforceCapacity() {
        while (this.entries.size > this.maxEntries) {
            // Map preserves insertion order, so this evicts the oldest key.
            const oldest = this.entries.keys().next().value;
            this.entries.delete(oldest);
            this.metrics.evictions += 1;
        }
    }
}

module.exports = { TtlCache };
