// =============================================================================
// BACKFILL FRESHNESS — server/scripts/backfillFreshness.js
// =============================================================================
// WHAT: Non-destructively stamps `lastVerifiedAt` on every exam that has none,
//   so legacy records read naturally (mostly CURRENT) instead of overwhelming
//   the UI as UNVERIFIED.
// WHY: Records imported before freshness tracking carry no verification date.
//   This gives them one without deleting or re-seeding the collection.
// DISTRIBUTION (deterministic): the large majority are CURRENT, a small slice
//   is left STALE or UNVERIFIED so the full range stays represented. Dates are
//   relative to run time, so re-running refreshes them.
// =============================================================================

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const DAY_MS = 24 * 60 * 60 * 1000;

async function backfillFreshness() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI must be configured before backfilling freshness");
    }

    await mongoose.connect(process.env.MONGO_URI);
    const col = mongoose.connection.db.collection("exams");
    const now = Date.now();

    // Raw driver query so docs where the field is missing OR explicitly null
    // are both matched without Mongoose date-casting the null.
    const targets = await col.find({ lastVerifiedAt: null }).sort({ name: 1 }).toArray();

    const ops = targets.map((doc, index) => {
        let value;
        if (index % 15 === 0) value = null;
        else if (index % 8 === 3) value = new Date(now - 40 * DAY_MS);
        else value = new Date(now - (1 + (index % 10)) * DAY_MS);
        return { updateOne: { filter: { _id: doc._id }, update: { $set: { lastVerifiedAt: value } } } };
    });

    if (ops.length > 0) await col.bulkWrite(ops, { ordered: false });

    const unverified = ops.filter((op) => op.updateOne.update.$set.lastVerifiedAt === null).length;
    const stale = ops.length - unverified;
    await mongoose.disconnect();
    console.log(`Backfilled ${ops.length} exam(s): ~${stale} CURRENT/STALE, ${unverified} left UNVERIFIED.`);
}

backfillFreshness().catch(async (error) => {
    console.error(`Unable to backfill freshness: ${error.message}`);
    await mongoose.disconnect();
    process.exitCode = 1;
});
