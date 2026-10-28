require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || undefined });
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./config/database");

(async () => {
    try {
        for (const [label, file] of [["schema v1", "schema-v1.sql"], ["schema v2", "schema-v2.sql"], ["schema v3", "schema-v3.sql"], ["schema v4", "schema-v4.sql"], ["schema v5", "schema-v5.sql"], ["schema v6", "schema-v6.sql"], ["schema v7", "schema-v7.sql"], ["schema v8", "schema-v8.sql"], ["schema v9", "schema-v9.sql"]]) {
            let sql = await fs.readFile(path.join(__dirname, "..", "database", file), "utf8");
            if (file === "schema-v1.sql" && process.env.SEED_SAMPLE_DATA !== "true") {
                const seedStart = sql.indexOf("-- 6. SAMPLE ORGANIZATIONS");
                const commit = sql.lastIndexOf("COMMIT;");
                if (seedStart >= 0 && commit > seedStart) sql = `${sql.slice(0, seedStart)}\nCOMMIT;\n`;
            }
            await pool.query(sql);
            console.log(`Applied ${label}.`);
        }
    } catch (error) {
        console.error("Database initialization failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
