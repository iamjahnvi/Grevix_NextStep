const mongoose = require("mongoose");
const dotenv = require("dotenv");

const Exam = require("./models/Exam");
const exams = require("./data/exams");

dotenv.config();

const DAY_MS = 24 * 60 * 60 * 1000;

// Stamp a verification recency on the seeded dataset so freshness reads
// naturally: the large majority are CURRENT, with a small deterministic slice
// left STALE or UNVERIFIED so the full range stays represented without most
// records reading as "not verified". Dates are relative to seed time, so
// re-seeding refreshes them.
const withFreshness = (list, now = Date.now()) =>
    list.map((exam, index) => {
        if (index % 15 === 0) return { ...exam, lastVerifiedAt: null };
        if (index % 8 === 3) return { ...exam, lastVerifiedAt: new Date(now - 40 * DAY_MS) };
        return { ...exam, lastVerifiedAt: new Date(now - (1 + (index % 10)) * DAY_MS) };
    });

const seedDatabase = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await Exam.deleteMany();
        await Exam.insertMany(withFreshness(exams));
        process.exit();
    } catch (error) {
        console.log(error);
        process.exit(1);
    }
};

seedDatabase();