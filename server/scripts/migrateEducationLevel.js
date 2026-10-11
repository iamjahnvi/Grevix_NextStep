require("dotenv").config();
const mongoose = require("mongoose");
const Exam = require("../models/Exam");
const { normalizeEducationLevel } = require("../utils/educationLevels");

async function migrateEducationLevels() {
    const exams = await Exam.collection
        .find({ minimumEducationLevel: { $exists: true } })
        .toArray();

    const operations = [];
    let skipped = 0;

    for (const exam of exams) {
        const educationLevel =
            normalizeEducationLevel(exam.educationLevel) ||
            normalizeEducationLevel(exam.minimumEducationLevel);

        if (!educationLevel) {
            skipped += 1;
            continue;
        }

        operations.push({
            updateOne: {
                filter: { _id: exam._id },
                update: {
                    $set: { educationLevel },
                    $unset: { minimumEducationLevel: "" },
                },
            },
        });
    }

    const result = operations.length
        ? await Exam.collection.bulkWrite(operations, { ordered: false })
        : { modifiedCount: 0 };

    return {
        matched: exams.length,
        migrated: result.modifiedCount,
        skipped,
    };
}

if (require.main === module) {
    (async () => {
        try {
            if (!process.env.MONGO_URI) {
                throw new Error("MONGO_URI is required to migrate exam education levels.");
            }
            await mongoose.connect(process.env.MONGO_URI);
            const result = await migrateEducationLevels();
            console.log(`Education-level migration complete: ${result.migrated} migrated, ${result.skipped} skipped.`);
            if (result.skipped) {
                console.warn("Skipped records with unrecognized education values; inspect them before retrying.");
            }
        } catch (error) {
            console.error("Education-level migration failed:", error.message);
            process.exitCode = 1;
        } finally {
            await mongoose.disconnect();
        }
    })();
}

module.exports = { migrateEducationLevels };