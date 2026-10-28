require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./config/database");
(async () => {
    try {
        const sql = await fs.readFile(path.join(__dirname, "..", "database", "schema-v2.sql"), "utf8");
        await pool.query(sql);
        console.log("Database migration v2 applied successfully.");
    } catch (error) {
        console.error("Database migration v2 failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
