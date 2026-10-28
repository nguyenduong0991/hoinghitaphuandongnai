const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "..", ".env.demo"), override: true });
const fs = require("node:fs/promises");
const pool = require("./config/database");
(async () => {
    try {
        const sql = await fs.readFile(path.join(__dirname, "..", "database", "schema-v18.sql"), "utf8");
        await pool.query(sql);
        console.log("Database migration v18 applied successfully.");
    } catch (error) {
        console.error("Database migration v18 failed:", error.message);
        process.exitCode = 1;
    } finally { await pool.end(); }
})();