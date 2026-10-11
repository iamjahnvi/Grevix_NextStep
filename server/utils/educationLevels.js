// =============================================================================
// EDUCATION LEVELS — server/utils/educationLevels.js
// =============================================================================
// Normalize profile and exam values to canonical strings so eligibility can compare education levels exactly.

const ALLOWED_EDUCATION_LEVELS = [
    "8",
    "9",
    "10",
    "11",
    "12",
    "Graduate",
    "Post-Graduate",
    "Doctorate",
];

// Accepts numbers, numeric strings, "Class N" variants and case variations of
// the qualification labels. Returns the canonical key or null.
const normalizeEducationLevel = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" && Number.isFinite(value)) {
        const asString = String(Math.trunc(value));
        return ALLOWED_EDUCATION_LEVELS.includes(asString) ? asString : null;
    }
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    // "Class 10" / "class 8" variants.
    const classMatch = trimmed.match(/^class\s+(\d{1,2})$/i);
    if (classMatch) {
        return ALLOWED_EDUCATION_LEVELS.includes(classMatch[1]) ? classMatch[1] : null;
    }

    // Bare numeric strings ("8", "10", "12").
    if (/^\d{1,2}$/.test(trimmed)) {
        return ALLOWED_EDUCATION_LEVELS.includes(trimmed) ? trimmed : null;
    }

    const lower = trimmed.toLowerCase().replace(/\./g, "");
    if (lower === "graduate" || lower === "graduation" || lower === "ug") return "Graduate";
    if (
        lower === "post-graduate" ||
        lower === "postgraduate" ||
        lower === "post graduate" ||
        lower === "pg"
    ) return "Post-Graduate";
    if (lower === "doctorate" || lower === "phd" || lower === "ph d" || lower === "doctorate/phd") {
        return "Doctorate";
    }

    // Exact canonical match (case-insensitive fallback).
    const exact = ALLOWED_EDUCATION_LEVELS.find((level) => level.toLowerCase() === lower);
    return exact || null;
};

const isValidEducationLevel = (value) => normalizeEducationLevel(value) !== null;

module.exports = {
    ALLOWED_EDUCATION_LEVELS,
    normalizeEducationLevel,
    isValidEducationLevel,
};
