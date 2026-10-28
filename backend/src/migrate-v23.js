const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config({ path: (process.env.DOTENV_CONFIG_PATH || "").trim() || path.resolve(__dirname, "..", ".env.demo"), override: true });
const pool = require("./config/database");

(async () => {
    try {
        await pool.query(`ALTER TABLE conference_task_assignments
            ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
        console.log("Database migration v23 applied successfully.");
    } catch (error) {
        console.error("Database migration v23 failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
