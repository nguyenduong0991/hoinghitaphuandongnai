require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || undefined });
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./config/database");
(async () => {
    try {
        const sql = await fs.readFile(path.join(__dirname, "..", "database", "schema-v6.sql"), "utf8");
        await pool.query(sql);
        console.log("Database migration v6 applied successfully.");
    } catch (error) {
        console.error("Database migration v6 failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();