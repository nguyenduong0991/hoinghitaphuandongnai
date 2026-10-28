const express = require("express");
const pool = require("../config/database");
const { requireRole } = require("../auth");

const router = express.Router();
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const rating = value => value === "" || value == null ? null : Number(value);

router.post("/", requireRole("COMMUNE"), async (req, res) => {
    const organizationId = req.user.organization_id;
    if (!organizationId) return res.status(400).json({ success: false, message: "Tài khoản chưa được gắn với đơn vị." });
    const body = req.body || {};
    const conferenceId = text(body.conference_id, 64) || null;
    const stage = body.survey_stage === "AFTER_EVENT" ? "AFTER_EVENT" : "NEED";
    const participants = body.expected_participants === "" || body.expected_participants == null ? null : Number(body.expected_participants);
    const quality = rating(body.quality_rating), coordination = rating(body.coordination_rating);
    if (participants != null && (!Number.isInteger(participants) || participants < 0 || participants > 100000)) return res.status(400).json({ success: false, message: "Số người dự kiến không hợp lệ." });
    if ([quality, coordination].some(value => value != null && (!Number.isInteger(value) || value < 1 || value > 5))) return res.status(400).json({ success: false, message: "Điểm đánh giá phải từ 1 đến 5." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (conferenceId) {
            const owned = await client.query("SELECT 1 FROM conferences WHERE id=$1 AND organization_id=$2", [conferenceId, organizationId]);
            if (!owned.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị của đơn vị." }); }
        }
        const saved = await client.query(`INSERT INTO conference_need_surveys
            (user_id, organization_id, conference_id, survey_stage, legal_aid_need, conference_need, training_need, suggested_area, target_audience,
             expected_participants, topics, questions, quality_rating, coordination_rating, coordination_agencies, comments)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, created_at`, [
            req.user.id, organizationId, conferenceId, stage, text(body.legal_aid_need, 3000), Boolean(body.conference_need), text(body.training_need, 3000),
            text(body.suggested_area, 300), text(body.target_audience, 1500), participants, text(body.topics, 3000), text(body.questions, 5000),
            quality, coordination, text(body.coordination_agencies, 1500), text(body.comments, 3000)
        ]);
        await client.query("COMMIT");
        res.status(201).json({ success: true, data: saved.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Survey submission failed:", error);
        res.status(500).json({ success: false, message: "Không lưu được phiếu khảo sát." });
    } finally { client.release(); }
});

router.get("/mine", requireRole("COMMUNE"), async (req, res) => {
    try {
        const result = await pool.query(`SELECT s.*, c.title AS conference_title FROM conference_need_surveys s
            LEFT JOIN conferences c ON c.id=s.conference_id WHERE s.organization_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [req.user.organization_id]);
        res.json({ success: true, data: result.rows });
    } catch (error) { console.error("My survey list failed:", error); res.status(500).json({ success: false, message: "Không tải được phiếu đã gửi." }); }
});

router.get("/", requireRole("ADMIN"), async (_req, res) => {
    try {
        const result = await pool.query(`SELECT s.*, o.name AS organization_name, c.title AS conference_title
            FROM conference_need_surveys s JOIN organizations o ON o.id=s.organization_id
            LEFT JOIN conferences c ON c.id=s.conference_id ORDER BY s.created_at DESC LIMIT 5000`);
        res.json({ success: true, data: result.rows });
    } catch (error) { console.error("Survey report failed:", error); res.status(500).json({ success: false, message: "Không tải được dữ liệu khảo sát." }); }
});

module.exports = router;
