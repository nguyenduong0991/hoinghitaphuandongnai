const express = require("express");
const cors = require("cors");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const configuredHost = process.env.HOST;
const lanMode = process.env.TGPL_LAN_MODE === "1";
const configuredDotenvPath = (process.env.DOTENV_CONFIG_PATH || "").trim();
const dotenvPath = configuredDotenvPath || (process.env.NODE_ENV === "production" ? undefined : path.resolve(__dirname, "..", ".env.demo"));
const dotenvResult = require("dotenv").config({ path: dotenvPath, ...(dotenvPath ? { override: true } : {}) });
if (dotenvPath && dotenvResult.error) throw dotenvResult.error;
if (dotenvPath && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing in " + dotenvPath);
if (dotenvPath) console.log("Database host selected from config: " + new URL(process.env.DATABASE_URL).hostname);

const pool = require("./config/database");
const upload = require("./upload");
const auth = require("./auth");
const managementRouter = require("./management");
const analyticsRouter = require("./analytics");
const aiRouter = require("./routes/ai.routes");
const surveysRouter = require("./routes/surveys.routes");
const ollamaService = require("./services/ollama.service");

const app = express();

if (process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in production.");
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("A persistent JWT_SECRET of at least 32 characters is required in production.");
    if (!process.env.ALLOWED_ORIGINS) throw new Error("Set ALLOWED_ORIGINS to the exact HTTPS website origin in production.");
    for (const origin of process.env.ALLOWED_ORIGINS.split(",").map(value => value.trim()).filter(Boolean)) {
        let parsed;
        try { parsed = new URL(origin); } catch { throw new Error(`Invalid ALLOWED_ORIGINS entry: ${origin}`); }
        if (parsed.protocol !== "https:") throw new Error("Production ALLOWED_ORIGINS entries must use HTTPS.");
    }
}
const PORT = process.env.PORT || 3000;
const HOST = configuredHost || process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
function isPrivateAddress(address = "") {
    const ip = address.replace(/^::ffff:/, "").split("%")[0];
    if (ip === "::1" || /^fc[0-9a-f]{2}:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254);
}
const configuredOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8080,http://127.0.0.1:8080").split(",").map(value => value.trim()).filter(Boolean);
const lanOrigins = Object.values(os.networkInterfaces()).flat().filter(entry => entry && entry.family === "IPv4" && !entry.internal && isPrivateAddress(entry.address)).map(entry => `http://${entry.address}:8080`);
const allowedOrigins = [...new Set(lanMode ? [...configuredOrigins.filter(origin => !origin.includes("github.io") && !origin.includes("trycloudflare.com")), ...lanOrigins] : configuredOrigins)];

// Middleware
if (lanMode) app.use((req, res, next) => isPrivateAddress(req.socket.remoteAddress) ? next() : res.status(403).json({ success: false, message: "Chỉ cho phép truy cập từ mạng nội bộ." }));
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", auth.router);
// Public, privacy-filtered catalog. Only an administrator-marked approved event
// that has not ended may appear here; never expose private workflow fields.
app.get("/api/public/conferences", async (_req, res) => {
    try {
        const result = await pool.query(`SELECT c.id,c.code,c.title,c.description,c.start_time,c.end_time,
                c.location_name,c.location_address,o.name AS organization_name
            FROM conferences c JOIN organizations o ON o.id=c.organization_id
            WHERE c.is_public=TRUE AND c.status='APPROVED'
              AND COALESCE(c.end_time,c.start_time)>=NOW()
            ORDER BY c.start_time ASC LIMIT 50`);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Public conference list failed:", error);
        res.status(500).json({ success: false, message: "Chưa tải được danh sách hội nghị công khai." });
    }
});
app.post("/api/public/attendance-registrations", async (req, res) => {
    const conferenceId = String(req.body?.conference_id || "").trim();
    const fullName = String(req.body?.full_name || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    const address = String(req.body?.address || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    const email = String(req.body?.email || "").normalize("NFKC").trim().toLowerCase();
    const consultationSituation = String(req.body?.consultation_situation || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 2000)
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[đã ẩn email]")
        .replace(/\b(?:\+?84|0)(?:[\s().-]*\d){8,10}\b/g, "[đã ẩn số điện thoại]");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conferenceId)) {
        return res.status(400).json({ success: false, message: "Hội nghị không hợp lệ." });
    }
    if (!fullName || fullName.length > 160 || !address || address.length > 500) {
        return res.status(400).json({ success: false, message: "Vui lòng cung cấp họ tên và địa chỉ hợp lệ." });
    }
    if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return res.status(400).json({ success: false, message: "Địa chỉ email chưa hợp lệ." });
    }
    const attendeeKey = createHash("sha256").update(`${fullName.toLocaleLowerCase("vi-VN")}\n${address.toLocaleLowerCase("vi-VN")}`).digest("hex");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const event = await client.query(`SELECT id,status,is_public,
                start_time>=NOW() AS upcoming,COALESCE(end_time,start_time)>=NOW() AS not_ended,
                (start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS conference_date
            FROM conferences WHERE id=$1 FOR UPDATE`, [conferenceId]);
        if (!event.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị công khai." });
        }
        const conference = event.rows[0];
        if (conference.status === "COMPLETED") {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hội nghị đã hoàn thành, hệ thống không nhận đăng ký tham dự thêm." });
        }
        if (!conference.is_public || conference.status !== "APPROVED" || !conference.upcoming || !conference.not_ended) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hội nghị không còn mở đăng ký hoặc chưa được công khai, phê duyệt." });
        }
        const result = await client.query(`INSERT INTO public_attendance_registrations
            (conference_id,attendee_name,attendee_address,attendee_email,attendee_key,conference_date,consultation_situation)
            VALUES($1,$2,$3,$4,$5,$6,$7)
            RETURNING id,conference_id,created_at`,
        [conferenceId, fullName, address, email || null, attendeeKey, conference.conference_date, consultationSituation]);
        await client.query("COMMIT");
        res.status(201).json({ success: true, data: result.rows[0], message: "Đã ghi nhận đăng ký tham dự." });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") return res.status(409).json({ success: false, message: "Bạn đã đăng ký một hội nghị diễn ra trong ngày này. Bạn có thể chọn hội nghị vào ngày khác." });
        console.error("Public attendance registration failed:", error);
        res.status(500).json({ success: false, message: "Chưa lưu được đăng ký. Vui lòng thử lại sau." });
    } finally { client.release(); }
});
// Public consultation intake; only returns a receipt message so contact details
// stay in the authenticated admin/staff workflow.
app.post("/api/public/legal-aid-requests", async (req, res) => {
    const requesterName = String(req.body?.requester_name || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    const phone = String(req.body?.phone || "").normalize("NFKC").trim();
    const phoneDigits = phone.replace(/\D/g, "");
    const question = String(req.body?.question || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    const honeypot = String(req.body?.website || "").trim();
    if (honeypot) return res.status(201).json({ success: true, message: "Đã ghi nhận yêu cầu." });
    if (requesterName.length < 2 || requesterName.length > 160) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập họ tên hợp lệ (2–160 ký tự)." });
    }
    if (phoneDigits.length < 9 || phoneDigits.length > 12) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập số điện thoại hợp lệ." });
    }
    if (question.length < 10 || question.length > 4000) {
        return res.status(400).json({ success: false, message: "Nội dung cần hỗ trợ phải từ 10 đến 4.000 ký tự." });
    }
    try {
        await pool.query(`INSERT INTO legal_aid_contact_requests
            (user_id,username,requester_name,user_role,organization_name,email,phone,question,status)
            VALUES(NULL,'',$1,'PUBLIC','','',$2,$3,'PENDING')`, [requesterName, phone, question]);
        res.status(201).json({ success: true, message: "Đã ghi nhận yêu cầu. Quản trị viên sẽ tiếp nhận và phân công cán bộ liên hệ." });
    } catch (error) {
        console.error("Public legal aid request could not be saved:", error);
        res.status(500).json({ success: false, message: "Chưa lưu được yêu cầu. Vui lòng thử lại sau." });
    }
});
// Public dependency status for the small startup indicator in the web UI.
// Keep this endpoint read-only and limited to availability/model names.
app.get("/api/health/services", async (_req, res) => {
    const generationModel = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
    const embeddingModel = process.env.OLLAMA_EMBED_MODEL || "bge-m3";
    try {
        const tags = await ollamaService.checkOllama();
        const installed = new Set((tags.models || []).map(model => String(model.name || "").toLowerCase()));
        const hasModel = wanted => installed.has(String(wanted).toLowerCase()) ||
            [...installed].some(name => name.startsWith(`${String(wanted).toLowerCase()}:`));
        const generationReady = hasModel(generationModel);
        const embeddingReady = hasModel(embeddingModel);
        res.json({
            success: true,
            checked_at: new Date().toISOString(),
            services: {
                backend: { ready: true, label: "Backend" },
                ollama: {
                    ready: generationReady,
                    api_ready: true,
                    label: "Ollama",
                    model: generationModel,
                    embedding_model: embeddingModel,
                    embedding_ready: embeddingReady,
                    message: generationReady ? "Mô hình trả lời đã sẵn sàng." : `Ollama đang chạy nhưng chưa có mô hình ${generationModel}.`
                }
            }
        });
    } catch (error) {
        res.json({
            success: true,
            checked_at: new Date().toISOString(),
            services: {
                backend: { ready: true, label: "Backend" },
                ollama: {
                    ready: false,
                    api_ready: false,
                    label: "Ollama",
                    model: generationModel,
                    embedding_model: embeddingModel,
                    embedding_ready: false,
                    message: "Không kết nối được Ollama trên máy đang chạy backend."
                }
            }
        });
    }
});
app.use("/api", auth.authenticate);
function enforceConferenceScope(req, res, next) {
    auth.checkConferenceAccess(req, res).then(allowed => { if (allowed) next(); }).catch(next);
}
app.use("/api", managementRouter);
app.use("/api/ai", aiRouter);
app.use("/api/surveys", surveysRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/uploads", auth.authenticate, async (req, res, next) => {
    try {
        if (req.user.role === "ADMIN") return next();
        const storageKey = path.basename(req.path);
        const access = req.user.organization_id ? await pool.query(`SELECT 1 FROM conference_attachments a JOIN conferences c ON c.id=a.conference_id
            WHERE a.storage_key=$1 AND a.is_deleted=FALSE AND c.organization_id=$2`, [storageKey, req.user.organization_id]) : { rowCount: 0 };
        const taskAccess = req.user.role === "TASK_ASSIGNEE" ? await pool.query(`SELECT 1 FROM conference_task_attachments a
            JOIN conference_task_assignments t ON t.id=a.task_assignment_id WHERE a.storage_key=$1 AND t.assignee_user_id=$2`, [storageKey, req.user.id]) : { rowCount: 0 };
        const assignedConferenceAccess = ["TASK_ASSIGNEE", "SPEAKER"].includes(req.user.role) ? await pool.query(`SELECT 1 FROM conference_attachments a
            WHERE a.storage_key=$1 AND a.is_deleted=FALSE AND (
                EXISTS (SELECT 1 FROM conference_task_assignments t WHERE t.conference_id=a.conference_id AND t.assignee_user_id=$2) OR
                EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=a.conference_id AND s.speaker_user_id=$2)
            )`, [storageKey, req.user.id]) : { rowCount: 0 };
        if (!access.rowCount && !taskAccess.rowCount && !assignedConferenceAccess.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy tệp trong phạm vi tài khoản." });
        next();
    } catch (error) { next(error); }
}, express.static(upload.uploadDir, { fallthrough: false }));


// =====================================================
// API 1: Kiểm tra Backend
// =====================================================
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "TGPL API đang hoạt động",
        timestamp: new Date().toISOString()
    });
});


// =====================================================
// API 2: Kiểm tra PostgreSQL
// =====================================================
app.get("/api/db-test", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT NOW() AS current_time"
        );

        res.json({
            success: true,
            message: "Kết nối PostgreSQL thành công",
            database: "tgpl",
            time: result.rows[0].current_time
        });

    } catch (error) {
        console.error("Lỗi database:", error);

        res.status(500).json({
            success: false,
            message: "Không kết nối được PostgreSQL",
            error: error.message
        });
    }
});


// =====================================================
// API 3: Lấy danh sách hội nghị
// =====================================================
app.get("/api/conferences", async (req, res) => {
    try {
        if (req.user.role !== "ADMIN" && !req.user.organization_id) return res.status(403).json({ success: false, message: "Tài khoản chưa được gán xã/phường/đơn vị. Vui lòng liên hệ quản trị viên." });
        const result = await pool.query(`
            SELECT
                c.id,
                c.organization_id,
                c.code,
                c.title,
                c.description,
                c.start_time,
                c.end_time,
                c.location_name,
                c.location_address,
                c.expected_participants,
                c.status,
                c.is_public,
                c.proposed_start_time,
                c.proposed_end_time,
                c.reschedule_note,
                c.reschedule_response,
                c.reschedule_responded_at,
                c.created_at,
                c.updated_at,
                o.name AS organization_name,
                u.full_name AS created_by_name
            FROM conferences c
            JOIN organizations o
                ON o.id = c.organization_id
            JOIN users u
                ON u.id = c.created_by
            ORDER BY c.start_time DESC
        `);

        res.json({
            success: true,
            data: req.user.role === "ADMIN" ? result.rows : result.rows.filter(item => String(item.organization_id) === String(req.user.organization_id))
        });

    } catch (error) {
        console.error("Lỗi lấy danh sách hội nghị:", error);

        res.status(500).json({
            success: false,
            message: "Không lấy được danh sách hội nghị",
            error: error.message
        });
    }
});


// =====================================================
// API 4: Lấy chi tiết một hội nghị theo ID
// =====================================================
app.get("/api/conferences/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `
            SELECT
                c.id,
                c.code,
                c.title,
                c.description,
                c.start_time,
                c.end_time,
                c.location_name,
                c.location_address,
                c.expected_participants,
                c.status,
                c.is_public,
                c.notes,
c.cancel_reason,
c.rejection_reason,
c.approved_at,
c.cancelled_at,
c.cancelled_by,
c.proposed_start_time,
c.proposed_end_time,
c.reschedule_note,
c.reschedule_response,
c.reschedule_responded_at,
c.created_at,
c.updated_at,

                o.id AS organization_id,
                o.code AS organization_code,
                o.name AS organization_name,

                u.id AS created_by,
                u.username AS created_by_username,
                u.full_name AS created_by_name

            FROM conferences c

            JOIN organizations o
                ON o.id = c.organization_id

            JOIN users u
                ON u.id = c.created_by

            WHERE c.id = $1
            `,
            [id]
        );

        if (result.rows.length === 0 || (req.user.role !== "ADMIN" && String(result.rows[0].organization_id) !== String(req.user.organization_id))) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy hội nghị"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Lỗi lấy hội nghị theo ID:", error);

        res.status(500).json({
            success: false,
            message: "Không lấy được thông tin hội nghị",
            error: error.message
        });
    }
});


// =====================================================
// API 5: Tạo hội nghị mới
// =====================================================
app.post("/api/conferences", async (req, res) => {
    try {
        const {
    title,
    description,
    organization_id,
    start_time,
    end_time,
    location_name,
    location_address,
    expected_participants,
    notes
} = req.body;

const created_by = req.user.id;
const conferenceOrganizationId = req.user.role === "ADMIN" ? organization_id : req.user.organization_id;
if (req.user.role !== "ADMIN" && (!conferenceOrganizationId || String(organization_id || conferenceOrganizationId) !== String(conferenceOrganizationId))) return res.status(403).json({ success: false, message: "Bạn chỉ được đăng ký hội nghị cho xã/phường/đơn vị đã gắn với tài khoản." });

// Tự sinh mã hội nghị: HN-0003, HN-0004, HN-0005...
const codeResult = await pool.query(`
    SELECT COALESCE(
        MAX(
            CAST(
                SUBSTRING(code FROM 4)
                AS INTEGER
            )
        ),
        0
    ) + 1 AS next_number
    FROM conferences
    WHERE code ~ '^HN-[0-9]+$'
`);

const nextNumber = codeResult.rows[0].next_number;
const code = `HN-${String(nextNumber).padStart(4, "0")}`;


        // Kiểm tra dữ liệu bắt buộc
        if (
            !code ||
            !title ||
            !conferenceOrganizationId ||
            !created_by ||
            !start_time
        ) {
            return res.status(400).json({
                success: false,
                message: "Thiếu dữ liệu bắt buộc"
            });
        }


        const result = await pool.query(
            `
            INSERT INTO conferences (
                code,
                title,
                description,
                organization_id,
                created_by,
                start_time,
                end_time,
                location_name,
                location_address,
                expected_participants,
                status,
                notes
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12
            )
            RETURNING *
            `,
            [
                code,
                title,
                description || null,
                conferenceOrganizationId,
                created_by,
                start_time,
                end_time || null,
                location_name || null,
                location_address || null,
                expected_participants || 0,
                "PENDING",
                notes || null
            ]
        );


        res.status(201).json({
            success: true,
            message: "Tạo hội nghị thành công",
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Lỗi tạo hội nghị:", error);

        res.status(500).json({
            success: false,
            message: "Không tạo được hội nghị",
            error: error.message
        });
    }
});
app.get("/api/test-route", (req, res) => {
    res.json({
        success: true,
        message: "Route mới đang được Node nhận"
    });
});
// =====================================================
// API: Upload file đính kèm cho hội nghị
// =====================================================
app.post(
    "/api/conferences/:id/attachments",
    enforceConferenceScope,
    upload.single("file"),
    async (req, res) => {
        try {
            const { id } = req.params;

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "Chưa chọn file"
                });
            }

            const conferenceResult = await pool.query(
                "SELECT id FROM conferences WHERE id = $1",
                [id]
            );

            if (conferenceResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Không tìm thấy hội nghị"
                });
            }

            const uploadedBy =
                req.body.uploaded_by || null;

            const attachmentType =
                req.body.attachment_type || null;

            const result = await pool.query(
                `
                INSERT INTO conference_attachments (
                    conference_id,
                    file_name,
                    storage_key,
                    file_size,
                    mime_type,
                    attachment_type,
                    uploaded_by
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7
                )
                RETURNING *
                `,
                [
                    id,
                    req.file.originalname,
                    req.file.filename,
                    req.file.size,
                    req.file.mimetype,
                    attachmentType,
                    uploadedBy
                ]
            );

            res.status(201).json({
                success: true,
                message: "Upload file thành công",
                data: result.rows[0]
            });

        } catch (error) {
            console.error(
                "Lỗi upload file:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Không upload được file",
                error: error.message
            });
        }
    }
);
// =====================================================
// =====================================================
// API: Lấy danh sách file đính kèm của hội nghị
// =====================================================
app.get(
    "/api/conferences/:id/attachments",
    enforceConferenceScope,
    async (req, res) => {
        try {
            const { id } = req.params;

            const conferenceResult = await pool.query(
                "SELECT id FROM conferences WHERE id = $1",
                [id]
            );

            if (conferenceResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Không tìm thấy hội nghị"
                });
            }

            const result = await pool.query(
                `
                SELECT
                    id,
                    conference_id,
                    file_name,
                    storage_key,
                    file_size,
                    mime_type,
                    attachment_type,
                    uploaded_by,
                    uploaded_at
                FROM conference_attachments
                WHERE conference_id = $1
                  AND is_deleted = FALSE
                ORDER BY uploaded_at DESC
                `,
                [id]
            );

            res.json({
                success: true,
                data: result.rows
            });

        } catch (error) {
            console.error(
                "Lỗi lấy danh sách file:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Không lấy được danh sách file",
                error: error.message
            });
        }
    }
);
// Khởi động server
// =====================================================
console.log("=== KIEM TRA ROUTE ===");
app.router.stack.forEach((layer) => {
    if (layer.route) {
        console.log(
            layer.route.methods,
            layer.route.path
        );
    }
});
console.log("======================");
app.get("/api/organizations", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, code, name
            FROM organizations
            WHERE is_active = TRUE
            ORDER BY name
        `);
        res.json({ success: true, data: req.user.role === "ADMIN" ? result.rows : result.rows.filter(item => String(item.id) === String(req.user.organization_id)) });
    } catch (error) {
        console.error("Lỗi lấy danh sách đơn vị:", error);
        res.status(500).json({ success: false, message: "Không lấy được danh sách đơn vị" });
    }
});


app.use((error, req, res, next) => {
    console.error("Request failed:", error);
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Máy chủ gặp lỗi khi xử lý yêu cầu." });
});
app.listen(PORT, HOST, () => {
    console.log(
        `TGPL Backend đang chạy tại http://${HOST}:${PORT}`
    );
});











