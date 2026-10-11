const DEMO_FRESHNESS_BY_EXAM = {
    "JEE Main": "CURRENT",
    "NEET UG": "STALE",
    NTSE: "UNVERIFIED",
};

export function isFreshnessDemoEnabled() {
    return new URLSearchParams(window.location.search).get("freshnessDemo") === "1";
}

export function getDemoFreshnessStatus(examName, enabled) {
    return enabled ? DEMO_FRESHNESS_BY_EXAM[examName] || null : null;
}
