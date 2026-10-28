const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

pool.on("connect", () => {
    console.log("Đã kết nối PostgreSQL");
});

pool.on("error", (err) => {
    console.error("Lỗi PostgreSQL:", err);
});

module.exports = pool;