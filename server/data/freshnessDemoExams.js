const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const registrationStartDate = new Date(now - day);
const registrationEndDate = new Date(now + 30 * day);

const demoScenarios = [
    { name: "DEMO ONLY — Freshness Sample (Current)", lastVerifiedAt: new Date(now - 2 * day) },
    { name: "DEMO ONLY — Freshness Sample (Stale)", lastVerifiedAt: new Date(now - 45 * day) },
    { name: "DEMO ONLY — Freshness Sample (Unverified)", lastVerifiedAt: null },
];

module.exports = demoScenarios.map(({ name, lastVerifiedAt }) => ({
    name,
    fullForm: name,
    description: "Synthetic record for demonstrating NextStep's freshness indicator. This is not a real exam or official eligibility notice.",
    educationLevel: "12",
    streams: ["Any stream"],
    subjects: null,
    eligibility: { minimumPercentage: null },
    minimumAge: null,
    maximumAge: null,
    registrationStartDate,
    registrationEndDate,
    officialWebsite: "https://example.com/",
    careerType: "TEACHING_EDUCATION",
    examType: "SCHOLARSHIP_EXAM",
    origin: "SEED",
    lastVerifiedAt,
    isDemo: true,
}));
