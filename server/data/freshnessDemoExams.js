const now = Date.now();
const day = 24 * 60 * 60 * 1000;

// Three standalone records used to exercise the freshness lifecycle across its
// states (a recent verification, an expired one, and none at all). They flow
// through the exact same discovery/recommend pipeline as every other exam, so
// the resulting CURRENT / STALE / UNVERIFIED verdicts render naturally.
const demoScenarios = [
    {
        name: "National Science Merit Scholarship",
        fullForm: "National Science Merit Scholarship Examination",
        description:
            "A national scholarship examination for Class 12 students seeking undergraduate science and research programmes.",
        registrationStartDate: new Date(now - 10 * day),
        registrationEndDate: new Date(now + 20 * day),
        lastVerifiedAt: new Date(now - 2 * day),
        careerType: "SCIENCE_RESEARCH",
        examType: "SCHOLARSHIP_EXAM",
    },
    {
        name: "State Engineering Entrance Examination",
        fullForm: "State Engineering Entrance Examination",
        description:
            "A state-level entrance examination for admission to undergraduate engineering programmes.",
        registrationStartDate: new Date(now - 80 * day),
        registrationEndDate: new Date(now - 20 * day),
        lastVerifiedAt: new Date(now - 45 * day),
        careerType: "ENGINEERING",
        examType: "ENTRANCE_EXAM",
    },
    {
        name: "Central Research Fellowship Test",
        fullForm: "Central Research Fellowship Test",
        description:
            "A research fellowship selection test for postgraduate students in science and technology.",
        registrationStartDate: new Date(now + 5 * day),
        registrationEndDate: new Date(now + 60 * day),
        lastVerifiedAt: null,
        careerType: "SCIENCE_RESEARCH",
        examType: "ELIGIBILITY_TEST",
    },
];

module.exports = demoScenarios.map((scenario) => ({
    ...scenario,
    educationLevel: "12",
    streams: ["Any stream"],
    subjects: null,
    eligibility: { minimumPercentage: null },
    minimumAge: null,
    maximumAge: null,
    officialWebsite: "https://example.com/",
    origin: "SEED",
    isDemo: true,
}));
