const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createReverificationScheduler } = require("../services/reverificationScheduler");

const router = express.Router();
const scheduler = createReverificationScheduler();

// For demo/ops: trigger a single re-verification pass.
router.post("/run", protect, async (req, res) => {
    try {
        const summary = await scheduler.runOnce();
        return res.status(200).json({ success: true, data: summary });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Stats/health for the scheduler.
router.get("/stats", protect, async (req, res) => {
    return res.status(200).json({ success: true, data: scheduler.stats() });
});

module.exports = { router, scheduler };
