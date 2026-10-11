require("dotenv").config();

const app = require("./app");
// import the express app

const connectDB = require("./config/db");
// connecting database

const { scheduler } = require("./routes/reverifyRoutes");

const PORT = process.env.PORT || 5000;
// we are hardcoding it , rn we'll use .env.

const startServer = async() => {
    // we have used async so that  functions keep on happening in background , which takes time to operate and have heavy code , and proceed further with functions with non-heavy code.
    await connectDB();

    // Auto re-verification: periodically re-checks expired exams against their
    // official source and renews freshness only when the source is unchanged.
    // Env: REVERIFY_ENABLED (default true), REVERIFY_INTERVAL_MINUTES (30),
    // REVERIFY_LIMIT_PER_RUN (5).
    scheduler.start();

    app.listen(PORT , () => {
    console.log(`Server is running on port ${PORT}`)
    });

    // this starts the server , like it means keep listening to the incoming requests

}

// Exam routes are mounted exactly once via routes/index.js —
// do not re-mount them here (that registered every endpoint twice).

startServer();


