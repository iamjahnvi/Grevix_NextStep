const mongoose = require("mongoose");
const dotenv = require("dotenv");

const Exam = require("../models/Exam");
const demoExams = require("../data/freshnessDemoExams");

dotenv.config();

async function seedFreshnessDemo() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI must be configured before inserting demo exams");
    }

    await mongoose.connect(process.env.MONGO_URI);
    for (const exam of demoExams) {
        await Exam.updateOne(
            { name: exam.name, isDemo: true },
            { $set: exam },
            { upsert: true }
        );
    }
    await mongoose.disconnect();
    console.log(`Inserted or refreshed ${demoExams.length} demo freshness exams.`);
}

seedFreshnessDemo().catch(async (error) => {
    console.error(`Unable to seed freshness demo exams: ${error.message}`);
    await mongoose.disconnect();
    process.exitCode = 1;
});
