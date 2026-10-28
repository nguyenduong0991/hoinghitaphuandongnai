const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config({ path: (process.env.DOTENV_CONFIG_PATH || "").trim() || path.resolve(__dirname, "..", ".env.demo"), override: true });
const fs = require("node:fs/promises");
const pool = require("./config/database");
(async () => {
    try {
        const sql = await fs.readFile(path.join(__dirname, "..", "database", "schema-v21-public-attendee-consultation-ai.sql"), "utf8");
        await pool.query(sql);
        console.log("Database migration v21 applied successfully.");
    } catch (error) {
        console.error("Database migration v21 failed:", error.message);
        process.exitCode = 1;
    } finally { await pool.end(); }
})();
