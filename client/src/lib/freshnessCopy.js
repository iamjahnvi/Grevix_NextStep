// Single source of truth for user-facing freshness copy.
// WHY: verification status must build trust, not alarm. Every message is
// positive and transparent: it states when the automated re-check runs next so
// the student knows they can simply check back, instead of being told their
// data is "expired" and pushed to do the verification work themselves.
// The server supplies the transparency data (nextCheckAt, daysUntilNextCheck,
// recheckIntervalMinutes, autoRecheck); we only phrase it.

const DATE_OPTS = { day: "numeric", month: "short", year: "numeric" };

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-IN", DATE_OPTS);
}

// "30 min" / "1 hour" / "2 hours" / "1 day" — a human cadence for the worker.
function formatCadence(minutes) {
    if (typeof minutes !== "number" || minutes <= 0) return null;
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 24) {
        const rounded = Math.round(hours);
        return `${rounded} hour${rounded === 1 ? "" : "s"}`;
    }
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"}`;
}

function dayWord(days) {
    return `${days} day${days === 1 ? "" : "s"}`;
}

// Compact chip copy for discovery/recommendation cards.
function freshnessBadge(freshness) {
    const status = freshness?.status || "UNVERIFIED";
    const auto = freshness?.autoRecheck !== false;
    const verified = formatDate(freshness?.lastVerifiedAt);
    const nextDays = freshness?.daysUntilNextCheck;
    const cadence = formatCadence(freshness?.recheckIntervalMinutes);

    if (status === "CURRENT") {
        const note = !auto
            ? ""
            : typeof nextDays === "number" && nextDays > 0
                ? ` · next auto-check in ${dayWord(nextDays)}`
                : " · auto-renewing";
        return { label: verified ? `Verified ${verified}` : "Recently verified", note };
    }
    if (status === "STALE") {
        return auto
            ? { label: "Auto-refresh in progress", note: cadence ? ` · checks run every ${cadence}` : "" }
            : { label: "Verification due", note: " · confirm with the official source" };
    }
    return auto
        ? { label: "First auto-check queued", note: " · no action needed" }
        : { label: "Not yet verified", note: " · confirm with the official source" };
}

// Full sentence(s) for the exam details panel.
function freshnessDetail(freshness) {
    const status = freshness?.status || "UNVERIFIED";
    const auto = freshness?.autoRecheck !== false;
    const last = formatDate(freshness?.lastVerifiedAt);
    const next = formatDate(freshness?.nextCheckAt);
    const nextDays = freshness?.daysUntilNextCheck;
    const cadence = formatCadence(freshness?.recheckIntervalMinutes) || "30 minutes";

    if (!auto) {
        return {
            title: status === "CURRENT" ? "Recently verified information" : "Not yet verified here",
            body: `${last ? `Last checked ${last}. ` : ""}Automatic re-checks are off for this deployment — please confirm eligibility and dates with the official exam authority before applying.`,
        };
    }

    if (status === "CURRENT") {
        const when = next && typeof nextDays === "number"
            ? ` Next check due ${next} (in about ${dayWord(nextDays)}).`
            : "";
        return {
            title: "Verified against the official source",
            body: `${last ? `Last checked ${last}. ` : ""}We re-check the official source automatically and refresh this on its own.${when} Nothing needed from you.`,
        };
    }

    if (status === "STALE") {
        return {
            title: "Auto-refresh in progress",
            body: `${last ? `Last confirmed ${last}. ` : ""}Our automated check re-reads the official source every ~${cadence} and will update this the moment it's confirmed — usually within ${cadence}. No action needed from you.`,
        };
    }

    return {
        title: "First verification queued",
        body: `We're automatically confirming this against the official source (runs about every ${cadence}). It'll be marked verified as soon as it's confirmed — no action needed from you.`,
    };
}

export { freshnessBadge, freshnessDetail, formatCadence };
