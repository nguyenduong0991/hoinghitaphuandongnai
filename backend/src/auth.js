const express = require("express");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const pool = require("./config/database");
const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const roles = new Set(["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"]);
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
    jwtSecret = crypto.randomBytes(32).toString("hex");
    console.warn("JWT_SECRET is not configured; sessions will expire when the backend restarts. Configure JWT_SECRET for deployment.");
}
const loginAttempts = new Map();

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
    if (!stored) return false;
    const [algorithm, salt, hash] = String(stored).split("$");
    if (algorithm !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = await scrypt(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function issueToken(user) {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ sub: user.id, iat: now, exp: now + 8 * 60 * 60 })).toString("base64url");
    const signature = crypto.createHmac("sha256", jwtSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

function parseToken(token) {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", jwtSecret).update(payload).digest();
    let supplied;
    try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    try {
        const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return value.exp > Math.floor(Date.now() / 1000) ? value : null;
    } catch { return null; }
}

router.get("/me", authenticate, (req, res) => res.json({ success: true, user: req.user }));

function isLoopback(address) {
    return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

router.get("/status", async (req, res) => {
    const result = await pool.query("SELECT EXISTS(SELECT 1 FROM users WHERE role='ADMIN' AND password_hash IS NOT NULL AND is_active=TRUE) AS configured");
    res.json({ success: true, setup_required: !result.rows[0].configured });
});

router.post("/setup-admin", async (req, res) => {
    if (process.env.REQUIRE_ADMIN_BOOTSTRAP_TOKEN === "true" || !isLoopback(req.ip)) {
        const expectedToken = Buffer.from(String(process.env.ADMIN_BOOTSTRAP_TOKEN || ""));
        const suppliedToken = Buffer.from(String(req.get("x-admin-bootstrap-token") || req.body?.bootstrap_token || ""));
        const validToken = expectedToken.length >= 32 && expectedToken.length === suppliedToken.length && crypto.timingSafeEqual(expectedToken, suppliedToken);
        if (!validToken) return res.status(403).json({ success: false, message: "Cần mã khởi tạo hợp lệ để thiết lập admin trên máy chủ công khai." });
    }
    const { username = "admin", full_name, password } = req.body || {};
    if (String(password || "").length < 12) return res.status(400).json({ success: false, message: "Mật khẩu quản trị phải có ít nhất 12 ký tự." });
    const alreadyConfigured = await pool.query("SELECT 1 FROM users WHERE role='ADMIN' AND password_hash IS NOT NULL AND is_active=TRUE LIMIT 1");
    if (alreadyConfigured.rowCount) return res.status(409).json({ success: false, message: "Tài khoản quản trị đã được thiết lập." });
    const existing = await pool.query("SELECT id FROM users WHERE username=$1 LIMIT 1", [username]);
    const passwordHash = await hashPassword(password);
    let result;
    if (existing.rowCount) {
        result = await pool.query(`UPDATE users SET password_hash=$1,full_name=COALESCE(NULLIF($2,''),full_name),role='ADMIN',is_active=TRUE,updated_at=NOW()
            WHERE id=$3 RETURNING id,username,full_name,role`, [passwordHash, full_name || "", existing.rows[0].id]);
    } else {
        result = await pool.query(`INSERT INTO users(username,password_hash,full_name,role,is_active)
            VALUES($1,$2,$3,'ADMIN',TRUE) RETURNING id,username,full_name,role`, [username, passwordHash, String(full_name || "Quản trị hệ thống").trim()]);
    }
    res.status(201).json({ success: true, user: result.rows[0], token: issueToken(result.rows[0]) });
});

router.post("/login", async (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const record = loginAttempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
    if (record.until < now) { record.count = 0; record.until = now + 15 * 60 * 1000; }
    if (record.count >= 10) return res.status(429).json({ success: false, message: "Quá nhiều lần đăng nhập không thành công. Hãy thử lại sau 15 phút." });
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const result = await pool.query(`SELECT u.id,u.username,u.password_hash,u.full_name,u.role,u.is_active,u.organization_id,u.email,u.phone,o.name AS organization_name
        FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE LOWER(u.username)=LOWER($1)
        ORDER BY CASE WHEN u.username=$1 THEN 0 ELSE 1 END LIMIT 2`, [username]);
    if (result.rowCount > 1) return res.status(409).json({ success: false, message: "Tên đăng nhập bị trùng khác chữ hoa/thường. Hãy liên hệ quản trị viên để xử lý." });
    const user = result.rows[0];
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
        record.count++;
        loginAttempts.set(ip, record);
        return res.status(401).json({ success: false, message: "Tên đăng nhập hoặc mật khẩu không đúng." });
    }
    loginAttempts.delete(ip);
    await pool.query("UPDATE users SET last_login_at=NOW() WHERE id=$1", [user.id]);
    const safeUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role,
        organization_id: user.organization_id, organization_name: user.organization_name, email: user.email, phone: user.phone };
    res.json({ success: true, user: safeUser, token: issueToken(safeUser) });
});

async function checkConferenceAccess(req, res, conferenceId = req.params.id) {
    if (req.user?.role === "ADMIN") return true;
    if (!req.user?.organization_id) {
        res.status(403).json({ success: false, message: "Tài khoản chưa được gán xã/phường/đơn vị. Vui lòng liên hệ quản trị viên." });
        return false;
    }
    const result = await pool.query("SELECT 1 FROM conferences WHERE id=$1 AND organization_id=$2", [conferenceId, req.user.organization_id]);
    if (!result.rowCount) {
        res.status(404).json({ success: false, message: "Không tìm thấy hội nghị trong đơn vị của tài khoản." });
        return false;
    }
    return true;
}

async function authenticate(req, res, next) {
        if (req.path === "/health" || req.path.startsWith("/auth/")) return next();
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const claims = parseToken(token);
    if (!claims) return res.status(401).json({ success: false, message: "Phiên đăng nhập hết hạn hoặc không hợp lệ." });
    try {
        const lookup = req.app?.locals?.authUserLookup;
        const result = lookup ? await lookup(claims.sub) : await pool.query(`SELECT u.id,u.username,u.full_name,u.role,u.is_active,u.organization_id,u.email,u.phone,o.name AS organization_name
            FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1`, [claims.sub]);
        const user = result.rows[0];
        if (!user || !user.is_active) return res.status(401).json({ success: false, message: "Tài khoản đã bị khóa hoặc không tồn tại." });
        if (["TASK_ASSIGNEE", "SPEAKER"].includes(user.role)) {
            const isIdentityCheck = req.method === "GET" && ["/me", "/auth/me"].includes(req.path);
            const isOwnPasswordChange = req.method === "POST" && req.path === "/account/change-password";
            const isSharedAssignmentRead = req.method === "GET" && req.path === "/my-assignments";
            const isDeadlineReminderRead = req.method === "GET" && req.path === "/my-reminders";
            const isOwnChangeRequestRead = req.method === "GET" && req.path === "/my-assignments/change-requests";
            const isOwnChangeRequestWrite = req.method === "POST" && req.path === "/my-assignments/change-requests";
            const isOwnTaskStatus = user.role === "TASK_ASSIGNEE" && req.method === "PATCH" && /^\/my-assignments\/tasks\/[^/]+\/status$/.test(req.path);
            const isOwnTaskAttachment = user.role === "TASK_ASSIGNEE" && ["GET", "POST"].includes(req.method) && /^\/my-assignments\/tasks\/[^/]+\/attachments$/.test(req.path);
            const isAssignedConferenceAttachment = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role) && ["GET", "POST"].includes(req.method) && /^\/conferences\/[^/]+\/attachments$/.test(req.path);
            const isAttachmentReplacement = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role) && req.method === "PUT" && (/^\/conference-attachments\/[^/]+\/file$/.test(req.path) || (user.role === "TASK_ASSIGNEE" && /^\/task-attachments\/[^/]+\/file$/.test(req.path)));
            const isAssignedAttachmentDownload = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role) && req.method === "GET" && req.baseUrl === "/uploads";
            const isAiChatRequest = req.method === "POST" && /^\/ai\/tgpl-chat(?:\/stream|\/feedback)?$/.test(req.path);
            const isReadOnlyAiPlanning = req.method === "POST" && ["/ai/conference-plan-proposal", "/ai/conference-topic-advisor"].includes(req.path);
            const isAssignedLegalAidRequestRead = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role) && req.method === "GET" && req.path === "/ai/my-contact-requests";
            const isAssignedLegalAidFeedbackWrite = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role) && req.method === "POST" && /^\/ai\/my-contact-requests\/[^/]+\/feedback$/.test(req.path);
            const isAssignedPublicAttendanceRead = user.role === "TASK_ASSIGNEE" && req.method === "GET" && /^\/conferences\/[^/]+\/public-attendance$/.test(req.path);
            const isAssignedPublicAttendanceManual = user.role === "TASK_ASSIGNEE" && req.method === "POST" && [req.path, req.originalUrl].some(path => /^\/(?:api\/)?conferences\/[^/]+\/public-attendance\/manual\/?$/.test(String(path || "").split("?")[0]));
            const isAssignedPublicAttendanceCheckIn = user.role === "TASK_ASSIGNEE" && req.method === "PATCH" && /^\/public-attendance\/[^/]+\/check-in$/.test(req.path);
            if (!isIdentityCheck && !isOwnPasswordChange && !isSharedAssignmentRead && !isDeadlineReminderRead && !isOwnChangeRequestRead && !isOwnChangeRequestWrite && !isOwnTaskStatus && !isOwnTaskAttachment && !isAssignedConferenceAttachment && !isAttachmentReplacement && !isAssignedAttachmentDownload && !isAiChatRequest && !isReadOnlyAiPlanning && !isAssignedLegalAidRequestRead && !isAssignedLegalAidFeedbackWrite && !isAssignedPublicAttendanceRead && !isAssignedPublicAttendanceManual && !isAssignedPublicAttendanceCheckIn) return res.status(403).json({ success: false, message: "Tài khoản này chỉ được quản lý tệp trong phạm vi hội nghị hoặc nhiệm vụ được phân công." });
        }
        req.user = user;
        next();
    } catch (error) { next(error); }
}

function requireRole(...allowed) {
    return (req, res, next) => {
        if (!req.user || !roles.has(req.user.role) || !allowed.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "Bạn không có quyền thực hiện thao tác này." });
        }
        next();
    };
}

module.exports = { router, authenticate, requireRole, hashPassword, verifyPassword, checkConferenceAccess };



