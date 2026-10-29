const express = require("express");
const pool = require("../config/database");
const { requireRole } = require("../auth");
const { MODES, OLLAMA_ANALYSIS_MODEL, chatWithOllama, streamChatWithOllama } = require("../services/ollama.service");
const { classifyQuestion, retrieveHybrid, buildContext, sourcesForResponse, loadKnowledgeBase, normalize } = require("../services/rag.service");
const {
    feedbackCorrectionScope,
    consultationTrainingScope,
    canReadPublicAttendeeTraining,
    filterPromptHistory,
    filterPrivateRagRows
} = require("../services/ai-rag-access");
const { normalizeConversationHistory, resolveConversationContext, buildConversationMemory } = require("../services/conversation-memory");
const { requestedConferenceFields, formatConferenceDetails, formatConferenceStatusList } = require("../services/conference-answer");
const { findVerifiedLegalArticle, answerFromExactLegalArticle, isLegalAidRequiredDocumentsQuestion, hasCompleteAnswerEnding } = require("../services/legal-answer");
const { formatRankedSurveyTopics, formatSurveyRatings } = require("../services/survey-aggregation");
const { formatAccountTaskCount, formatAccountTaskStatusCount, formatAccountTaskRatings } = require("../services/task-account-summary");
const { isPendingConferenceRequestCountQuestion, formatPendingConferenceRequestCount } = require("../services/pending-conference-requests");
const { isPendingConferenceOverlapCountQuestion } = require("../services/pending-conference-overlaps");
const { shouldResolveIntent, enforceIntentFit, applyIntentResolution, resolveIntentWithOllama } = require("../services/intent-resolution.service");
const { AI_ROLE_POLICIES } = require("../services/ai-role-policy");

const router = express.Router();
const aiRoles = ["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"];
const legalFallback = "Kho nguồn hiện chưa có căn cứ phù hợp để trả lời chính xác. Vui lòng liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để được giải đáp; chatbot không suy đoán thay cho tư vấn pháp lý.";
const criminalScopeFallback = "Chưa đủ căn cứ để kết luận tội danh hoặc đánh giá hành vi. Chatbot không tra cứu Bộ luật Hình sự; vui lòng liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai hoặc luật sư để được tư vấn.";
const outOfScopeFallback = "Tôi hỗ trợ tổng hợp báo cáo, phiếu khảo sát và số liệu website trong phạm vi quyền tài khoản; tra cứu hội nghị, hướng dẫn hệ thống và nhiệm vụ; hoặc trả lời Luật Trợ giúp pháp lý có căn cứ trong kho.";

async function loadTaskContext(user) {
    if (!user?.id || !["ADMIN", "TASK_ASSIGNEE", "SPEAKER"].includes(user.role)) {
        return "Tài khoản này không có danh sách nhiệm vụ được phân công trên website.";
    }
    const [tasks, speakers] = await Promise.all([
        pool.query(`SELECT a.title,a.description,a.due_at,a.completed_at,a.status,a.assignee_name,c.code,c.title AS conference_title,
                c.start_time,c.location_name,c.location_address,o.name AS organization_name
            FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE a.status<>'CANCELLED' AND ($1='ADMIN' OR ($1='TASK_ASSIGNEE' AND a.assignee_user_id=$2::uuid))
            ORDER BY a.due_at NULLS LAST,c.start_time LIMIT 100`, [user.role,user.id]),
        pool.query(`SELECT s.presentation_title AS title,s.notes,s.speaking_order,s.duration_minutes,c.code,
                c.title AS conference_title,c.start_time,c.location_name,c.location_address,o.name AS organization_name
            FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE ($1='ADMIN' OR ($1='SPEAKER' AND s.speaker_user_id=$2::uuid))
            ORDER BY c.start_time,s.speaking_order LIMIT 100`, [user.role,user.id])
    ]);
    const rows = [
        ...tasks.rows.map(row => `- Nhiệm vụ: ${row.title}; hội nghị ${row.code} – ${row.conference_title}; trạng thái ${row.status}${row.completed_at ? `, hoàn thành lúc ${formatAiDate(row.completed_at)}` : ""}; hạn ${row.due_at || "chưa đặt"}; đơn vị ${row.organization_name || "chưa có"}; địa điểm ${[row.location_name,row.location_address].filter(Boolean).join(" – ") || "chưa có"}${row.description ? `; mô tả ${String(row.description).slice(0,300)}` : ""}.`),
        ...speakers.rows.map(row => `- Báo cáo viên: ${row.title}; hội nghị ${row.code} – ${row.conference_title}; thời gian ${row.start_time}; thứ tự ${row.speaking_order}; thời lượng ${row.duration_minutes} phút; đơn vị ${row.organization_name || "chưa có"}; địa điểm ${[row.location_name,row.location_address].filter(Boolean).join(" – ") || "chưa có"}${row.notes ? `; ghi chú ${String(row.notes).slice(0,250)}` : ""}.`)
    ];
    return rows.length ? `NHIỆM VỤ TRONG PHẠM VI TÀI KHOẢN (${user.role==='ADMIN' ? "admin được phép xem toàn hệ thống" : "chỉ phân công gắn với tài khoản hiện tại"}):\n${rows.join("\n")}` : "Không có nhiệm vụ hoặc lịch báo cáo viên phù hợp trong phạm vi tài khoản trên website.";
}

function formatAiDate(value) {
    if (!value) return "chưa đặt hạn";
    return new Date(value).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

function isConferenceCountQuestion(question) {
    const normalized = normalize(question);
    const asksCount = /\b(?:bao nhieu|so luong|dem)\b/.test(normalized);
    const asksForSchedule = /du kien|sap dien ra|se dien ra|to chuc/.test(normalized);
    const asksForDetails = /liet ke|danh sach|ra soat|chi tiet|theo tung|phan tich|bao cao/.test(normalized);
    const asksForFinalizedStatus = /hoan thanh|da huy|tu choi|bi tu choi/.test(normalized);
    return asksCount && asksForSchedule && !asksForDetails && !asksForFinalizedStatus;
}

async function loadPendingConferenceRequestCount(user, question) {
    const period = parseReportPeriod(question);
    if (!period) return "Bạn muốn đếm hồ sơ chờ phê duyệt theo thời gian nào? Vui lòng nêu hôm nay, tuần này, tháng này hoặc kỳ cụ thể.";
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND c.organization_id=$2::uuid)
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (
            SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid
        ))
        OR ($1::text='SPEAKER' AND EXISTS (
            SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid
        ))
    )`;
    const result = await pool.query(`SELECT COUNT(*)::int AS total
        FROM conferences c
        WHERE ${scope}
          AND c.status='PENDING'
          AND c.created_at IS NOT NULL
          AND ($4::date IS NULL OR (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date)
          AND ($5::date IS NULL OR (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date)`,
    [user.role,user.organization_id || null,user.id,period.from,period.to]);
    const count = Number(result.rows[0]?.total) || 0;
    const scopeLabel = user.role === "ADMIN" ? "toàn hệ thống" : "phạm vi tài khoản được phép xem";
    return formatPendingConferenceRequestCount(count, period.label, scopeLabel);
}
async function loadPendingConferenceOverlapCount(user) {
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND c.organization_id=$2::uuid)
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (
            SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid
        ))
        OR ($1::text='SPEAKER' AND EXISTS (
            SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid
        ))
    )`;
    const result = await pool.query(`WITH pending AS (
            SELECT c.id,c.code,
                COALESCE(c.proposed_start_time,c.start_time) AS start_at,
                COALESCE(c.proposed_end_time,c.end_time) AS end_at
            FROM conferences c
            WHERE ${scope} AND c.status='PENDING'
        ), valid AS (
            SELECT * FROM pending WHERE start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at
        ), pairs AS (
            SELECT a.id AS first_id,b.id AS second_id
            FROM valid a JOIN valid b ON a.id < b.id AND a.start_at < b.end_at AND b.start_at < a.end_at
        ), conflicted AS (
            SELECT first_id AS id FROM pairs UNION SELECT second_id AS id FROM pairs
        )
        SELECT (SELECT COUNT(*)::int FROM pending) AS pending_count,
            (SELECT COUNT(*)::int FROM valid) AS timed_count,
            (SELECT COUNT(*)::int FROM conflicted) AS conflict_count,
            (SELECT COUNT(*)::int FROM pairs) AS pair_count,
            (SELECT string_agg(DISTINCT p.code, ', ' ORDER BY p.code)
                FROM pending p JOIN conflicted x ON x.id=p.id) AS conflict_codes`,
    [user.role,user.organization_id || null,user.id]);
    const row = result.rows[0] || {};
    const pendingCount = Number(row.pending_count) || 0;
    const timedCount = Number(row.timed_count) || 0;
    const conflictCount = Number(row.conflict_count) || 0;
    const pairCount = Number(row.pair_count) || 0;
    const incompleteCount = Math.max(0, pendingCount - timedCount);
    const scopeLabel = user.role === 'ADMIN' ? 'toàn hệ thống' : 'phạm vi tài khoản được phép xem';
    if (!pendingCount) return `Hiện không có hội nghị chờ phê duyệt trong ${scopeLabel}.`;
    const caveat = incompleteCount ? ` Có ${incompleteCount} hồ sơ thiếu khung giờ hợp lệ nên chưa thể kiểm tra trùng.` : '';
    if (!conflictCount) return `Chưa phát hiện hội nghị chờ phê duyệt nào trùng thời gian trong ${pendingCount} hồ sơ có phạm vi xem.${caveat}`;
    return `Có ${conflictCount} hội nghị chờ phê duyệt bị trùng thời gian (${pairCount} cặp trùng): ${row.conflict_codes || 'chưa xác định được mã'}.${caveat}`;
}
async function loadConferenceCountAnswer(user, question) {
    const period = parseReportPeriod(question);
    if (!period) {
        return "Bạn muốn đếm hội nghị trong khoảng thời gian nào? Vui lòng cho biết tháng/năm, quý/năm hoặc khoảng ngày cụ thể.";
    }
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (
            ($2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
            OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time >= NOW())
        ))
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const result = await pool.query(`SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE c.status='APPROVED')::int AS approved,
            COUNT(*) FILTER (WHERE c.status='PENDING')::int AS pending,
            COUNT(*) FILTER (WHERE c.status='RESCHEDULED')::int AS rescheduled
        FROM conferences c
        WHERE ${scope}
          AND c.status IN ('PENDING','APPROVED','RESCHEDULED')
          AND ((COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date)
          AND ((COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date)`,
    [user.role,user.organization_id || null,user.id,period.from,period.to]);
    const counts = result.rows[0] || {};
    const total = Number(counts.total) || 0;
    const scopeLabel = user.role === "ADMIN" ? "toàn hệ thống" : "phạm vi dữ liệu tài khoản được phép xem";
    if (!total) return `Không có hội nghị dự kiến bắt đầu trong ${period.label} thuộc ${scopeLabel}.`;
    return `Trong ${period.label} có ${total} hội nghị dự kiến bắt đầu thuộc ${scopeLabel}: ${Number(counts.approved) || 0} đã phê duyệt, ${Number(counts.pending) || 0} chờ phê duyệt, ${Number(counts.rescheduled) || 0} đề xuất dời lịch. Tổng có tính hồ sơ chờ phê duyệt và đã ghi rõ trạng thái.`;
}

async function loadLargestExpectedConferenceAnswer(user, question) {
    const period = parseReportPeriod(question);
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (
            ($2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
            OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time >= NOW())
        ))
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const result = await pool.query(`WITH visible AS (
            SELECT c.code,c.title,c.status,c.expected_participants,
                COALESCE(c.proposed_start_time,c.start_time) AS start_time,
                COALESCE(c.proposed_end_time,c.end_time) AS end_time,
                c.location_name,c.location_address,o.name AS organization_name
            FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE ${scope}
              AND c.expected_participants IS NOT NULL
              AND ($4::date IS NULL OR (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date)
              AND ($5::date IS NULL OR (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date)
        ), ranked AS (
            SELECT visible.*,MAX(expected_participants) OVER() AS largest_expected
            FROM visible
        )
        SELECT * FROM ranked
        WHERE expected_participants=largest_expected
        ORDER BY start_time DESC,code
        LIMIT 5`, [user.role,user.organization_id || null,user.id,period?.from || null,period?.to || null]);
    if (!result.rowCount) {
        const range = period ? ` trong ${period.label}` : "";
        return `Không tìm thấy hội nghị có quy mô dự kiến trong phạm vi tài khoản được phép xem${range}.`;
    }
    const max = Number(result.rows[0].expected_participants) || 0;
    const range = period ? ` ${period.label}` : " toàn bộ thời gian";
    const entries = result.rows.map(row => {
        const start = row.start_time ? formatAiDate(row.start_time) : "chưa có ngày";
        const location = [row.location_name,row.location_address].filter(Boolean).join(" – ") || "chưa cập nhật địa điểm";
        const status = ({ PENDING:"chờ phê duyệt",APPROVED:"đã phê duyệt",COMPLETED:"hoàn thành",REJECTED:"bị từ chối",CANCELLED:"đã hủy",RESCHEDULED:"đề xuất dời lịch" })[row.status] || row.status;
        return `• ${row.code} ${row.title} — ${max} người dự kiến; ${row.organization_name || "chưa rõ đơn vị"}; ${start}; ${location}; ${status}.`;
    });
    return `Hội nghị có số người dự kiến cao nhất trong${range} (phạm vi tài khoản được phép xem): ${max} người${result.rowCount > 1 ? `, đồng hạng ${result.rowCount} hội nghị` : ""}.\n${entries.join("\n")}`;
}

async function loadConferenceActionReviewAnswer(user) {
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND $2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const [rescheduleResult, reassignmentResult] = await Promise.all([
        pool.query(`SELECT c.code,c.title,c.status,c.reschedule_response,c.reschedule_note,
                c.start_time,c.proposed_start_time,c.proposed_end_time,o.name AS organization_name
            FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE ${scope} AND c.status='RESCHEDULED'
              AND COALESCE(c.reschedule_response,'PENDING')='PENDING'
            ORDER BY COALESCE(c.proposed_start_time,c.start_time),c.code LIMIT 30`,
        [user.role,user.organization_id || null,user.id]),
        pool.query(`SELECT r.request_type,r.reason,r.created_at,r.status,
                COALESCE(a.title,s.presentation_title) AS assignment_title,
                COALESCE(a.assignee_name,s.full_name) AS current_staff,
                c.code,c.title AS conference_title,c.status AS conference_status,
                c.start_time,o.name AS organization_name
            FROM conference_staff_change_requests r
            LEFT JOIN conference_task_assignments a ON a.id=r.task_assignment_id
            LEFT JOIN conference_speakers s ON s.id=r.speaker_assignment_id
            LEFT JOIN conferences c ON c.id=COALESCE(a.conference_id,s.conference_id)
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE r.status='PENDING' AND c.id IS NOT NULL
              AND c.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
              AND ($1::text='ADMIN'
                OR ($1::text='COMMUNE' AND $2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
                OR ($1::text IN ('TASK_ASSIGNEE','SPEAKER') AND r.requester_user_id=$3::uuid))
            ORDER BY r.created_at ASC LIMIT 30`,
        [user.role,user.organization_id || null,user.id])
    ]);
    const formatDate = value => value ? formatAiDate(value) : "chưa xác định";
    const reschedules = rescheduleResult.rows.map(row => {
        const proposedStart = row.proposed_start_time ? formatDate(row.proposed_start_time) : "chưa có ngày đề xuất";
        const proposedEnd = row.proposed_end_time ? ` đến ${formatDate(row.proposed_end_time)}` : "";
        const previousStart = row.start_time ? ` (lịch cũ ${formatDate(row.start_time)})` : "";
        return `• ${row.code} ${row.title} — cần xử lý đề xuất dời lịch${previousStart}; lịch đề xuất ${proposedStart}${proposedEnd}; đơn vị ${row.organization_name || "chưa rõ"}${row.reschedule_note ? `; lý do: ${String(row.reschedule_note).replace(/\s+/g," ").slice(0,180)}` : ""}.`;
    });
    const reassignments = reassignmentResult.rows.map(row => {
        const kind = row.request_type === "SPEAKER" ? "báo cáo viên" : "cán bộ nhận nhiệm vụ";
        const conferenceStatus = ({ PENDING:"chờ phê duyệt",APPROVED:"đã phê duyệt",RESCHEDULED:"đề xuất dời lịch" })[row.conference_status] || row.conference_status || "chưa rõ";
        return `• ${row.code} ${row.conference_title} — cần xem xét phân công lại ${kind} cho “${row.assignment_title || "nhiệm vụ"}”; hiện giao ${row.current_staff || "chưa rõ"}; đơn vị ${row.organization_name || "chưa rõ"}; trạng thái hội nghị ${conferenceStatus}${row.reason ? `; lý do: ${String(row.reason).replace(/\s+/g," ").slice(0,180)}` : ""}.`;
    });
    if (!reschedules.length && !reassignments.length) {
        return "Hiện không có đề xuất dời lịch hoặc yêu cầu đổi cán bộ/báo cáo viên đang chờ xử lý trong phạm vi tài khoản được phép xem.";
    }
    return [
        reschedules.length ? `Cần xử lý dời lịch (${reschedules.length}):\n${reschedules.join("\n")}` : "Không có đề xuất dời lịch đang chờ xử lý.",
        reassignments.length ? `Cần xem xét phân công lại (${reassignments.length}):\n${reassignments.join("\n")}` : "Không có yêu cầu đổi cán bộ/báo cáo viên đang chờ xử lý."
    ].join("\n");
}

function validateStructuredAnswer(answer, messages) {
    const output = String(answer || "");
    const evidence = normalize((messages || []).map(message => message.content || "").join("\n"));
    // For data-backed analysis, reject conference identifiers and numeric claims
    // that are not present in the filtered evidence or the user's own question.
    const codes = output.match(/\b(?:HN|HCN|CONF)[-_ ]?\d{2,}\b/gi) || [];
    for (const code of codes) {
        const compactCode = normalize(code).replace(/[^a-z0-9]/g, "");
        const compactEvidence = evidence.replace(/[^a-z0-9]/g, "");
        if (!compactEvidence.includes(compactCode)) return { ok: false, reason: `unverified_conference_code:${code}` };
    }
    const organizations = output.match(/\bUBND\s+(?:xã|phường)\s+[\p{L}]+(?:\s+[\p{L}]+){0,3}/giu) || [];
    for (const organization of organizations) {
        if (!normalize(evidence).includes(normalize(organization))) return { ok: false, reason: `unverified_organization:${organization}` };
    }
    const numbers = [...output.matchAll(/\b(\d{1,6}(?:[.,]\d{1,3})?)\s*(%|người|hội nghị|phiếu|đơn vị|nhiệm vụ|lượt|ngày|tháng|năm|quý)\b/gi)];
    for (const match of numbers) {
        const raw = match[1];
        const value = raw.replace(/\s/g, "").replace(/,/g, ".");
        if (!evidence.includes(value) && !evidence.includes(value.replace(/\.0+$/, ""))) {
            return { ok: false, reason: `unverified_numeric_claim:${raw}` };
        }
    }
    return { ok: true };
}

async function loadTaskAnswer(user, question) {
    if (!user?.id || !["ADMIN", "TASK_ASSIGNEE", "SPEAKER"].includes(user.role)) {
        return "Tài khoản này không được phân công nhiệm vụ trên hệ thống. Vui lòng xem tiến độ hội nghị tại trang danh sách hội nghị.";
    }
    const normalized = normalize(question);
    if (/(?:huong dan.{0,45}cap nhat trang thai|cap nhat trang thai.{0,45}ghi y kien)/.test(normalized)) {
        return "Trên thẻ nhiệm vụ, chọn trạng thái rồi bấm “Cập nhật tiến độ”. Chỉ chọn “Hoàn thành” khi đã hoàn tất. Để gửi ý kiến tư vấn, mở mục “Yêu cầu tư vấn được giao”, nhập ý kiến vào ô ghi ý kiến và bấm “Gửi ý kiến”. Nhiệm vụ hội nghị không có ô ghi chú chung; ô “Đề nghị đổi cán bộ” chỉ dùng khi cần xin đổi người nhận.";
    }
    const asksNearestTaskConference = /hoi nghi.{0,45}nhiem vu gan nhat|nhiem vu gan nhat.{0,45}hoi nghi/.test(normalized) &&
        /(?:dien ra|khi nao|o dau|dia diem)/.test(normalized);
    if (asksNearestTaskConference) {
        const result = await pool.query(`SELECT a.title AS task_title,a.due_at,c.code,c.title,c.start_time,c.location_name,c.location_address
            FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
            WHERE ($1::text='ADMIN' OR a.assignee_user_id=$2::uuid) AND a.status<>'CANCELLED'
            ORDER BY ABS(EXTRACT(EPOCH FROM (a.due_at-NOW()))) NULLS LAST,a.created_at DESC LIMIT 1`, [user.role,user.id]);
        if (!result.rowCount) return "Chưa có nhiệm vụ được giao trong phạm vi tài khoản để xác định hội nghị liên quan.";
        const row = result.rows[0];
        return `Theo hạn nhiệm vụ gần nhất (${row.task_title}, ${formatAiDate(row.due_at)}), hội nghị ${row.code} – ${row.title} diễn ra ${formatAiDate(row.start_time)} tại ${[row.location_name,row.location_address].filter(Boolean).join(" – ") || "chưa ghi địa điểm"}.`;
    }
    const asksPendingStaffChange = /(?:doi can bo|thay doi can bo|thay the can bo|de nghi doi|de nghi thay)/.test(normalized) &&
        /(?:cho admin|admin xu ly|dang cho|cho duyet|xu ly de nghi)/.test(normalized);
    if (user.role === "ADMIN" && asksPendingStaffChange) {
        const result = await pool.query(`SELECT r.request_type,r.reason,r.created_at,
                COALESCE(a.title,s.presentation_title) AS assignment_title,c.code,c.title AS conference_title,
                COALESCE(a.assignee_name,s.full_name) AS current_staff,o.name AS organization_name
            FROM conference_staff_change_requests r
            LEFT JOIN conference_task_assignments a ON a.id=r.task_assignment_id
            LEFT JOIN conference_speakers s ON s.id=r.speaker_assignment_id
            LEFT JOIN conferences c ON c.id=COALESCE(a.conference_id,s.conference_id)
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE r.status='PENDING'
            ORDER BY r.created_at ASC LIMIT 30`);
        if (!result.rowCount) return "Hiện không có đề nghị đổi cán bộ/báo cáo viên nào đang chờ admin xử lý.";
        return `Đề nghị đổi cán bộ/báo cáo viên đang chờ xử lý (${result.rowCount}):\n` + result.rows.map(row =>
            `• ${row.code || "Chưa có mã"} ${row.conference_title || ""} — ${row.assignment_title || "nhiệm vụ"}; người hiện được giao ${row.current_staff || "chưa rõ"}; đơn vị ${row.organization_name || "chưa rõ"}; lý do: ${row.reason || "không ghi"}.`
        ).join("\n");
    }    const conferenceCodeMatch = normalized.match(/\b(hn|hcn|conf)[\s_-]*(\d{2,})\b/i);
    if (conferenceCodeMatch && /phan cong|bao cao vien|ai duoc giao|ai la nguoi|ai nhan|ai thuyet trinh|nguoi thuyet trinh/.test(normalized)) {
        const conferenceCode = `${conferenceCodeMatch[1].toUpperCase()}-${conferenceCodeMatch[2].padStart(4, "0")}`;
        const asksMyTaskTitles = user.role === "TASK_ASSIGNEE" && /(?:toi duoc phan cong|phan cong chuan bi|chuan bi nhung viec gi|nhung viec gi cho hoi nghi)/.test(normalized);
        const conferenceResult = await pool.query(`SELECT c.id,c.code,c.title FROM conferences c
            WHERE UPPER(c.code)=$1 AND (
                $2::text='ADMIN' OR
                ($2::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid)) OR
                ($2::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
            ) LIMIT 1`, [conferenceCode,user.role,user.id]);
        const conference = conferenceResult.rows[0];
        if (!conference) return `Không tìm thấy hội nghị mã ${conferenceCode} trong dữ liệu website.`;
        if (asksMyTaskTitles) {
            const ownTasks = await pool.query(`SELECT a.title,a.status,a.due_at FROM conference_task_assignments a
                WHERE a.conference_id=$1 AND a.assignee_user_id=$2::uuid AND a.status<>'CANCELLED'
                ORDER BY a.due_at NULLS LAST,a.title`, [conference.id,user.id]);
            if (!ownTasks.rowCount) return `Bạn không có nhiệm vụ đang hiệu lực được giao cho hội nghị ${conferenceCode}.`;
            return `${conference.code} – ${conference.title}; nhiệm vụ của bạn: ` + ownTasks.rows.map(row => `${row.title} (hạn ${formatAiDate(row.due_at)}, trạng thái ${{ASSIGNED:"đã giao",IN_PROGRESS:"đang thực hiện",COMPLETED:"hoàn thành"}[row.status] || row.status})`).join("; ") + ".";
        }
        if (user.role === "TASK_ASSIGNEE" && /(?:ai.{0,35}phoi hop|nguoi phoi hop|dong nghiep)/.test(normalized)) {
            const ownTasks = await pool.query(`SELECT a.title,a.due_at,a.status FROM conference_task_assignments a
                WHERE a.conference_id=$1 AND a.assignee_user_id=$2::uuid AND a.status<>'CANCELLED'
                ORDER BY a.due_at NULLS LAST,a.title`, [conference.id,user.id]);
            return ownTasks.rowCount
                ? `Trong phạm vi tài khoản, bạn được giao: ${ownTasks.rows.map(row => `${row.title} (hạn ${formatAiDate(row.due_at)})`).join("; ")}. Danh sách người phối hợp khác không được hiển thị trong phần dữ liệu chatbot của vai trò này.`
                : `Không có nhiệm vụ của bạn đang hiệu lực tại ${conferenceCode}; không đủ dữ liệu được phép xem để xác định người phối hợp.`;
        }
        const [assignmentResult, speakerResult] = await Promise.all([
            pool.query(`SELECT a.title AS task_title,COALESCE(NULLIF(a.assignee_name,''),u.full_name) AS assignee_name,a.status,a.due_at
                FROM conference_task_assignments a LEFT JOIN users u ON u.id=a.assignee_user_id
                WHERE a.conference_id=$1 AND a.status<>'CANCELLED'
                  AND ($2::text='ADMIN' OR ($2::text='TASK_ASSIGNEE' AND a.assignee_user_id=$3::uuid))
                ORDER BY a.created_at,a.title`, [conference.id,user.role,user.id]),
            pool.query(`SELECT s.full_name,s.presentation_title,s.speaking_order
                FROM conference_speakers s
                WHERE s.conference_id=$1
                  AND ($2::text='ADMIN' OR $2::text IN ('TASK_ASSIGNEE','SPEAKER') AND ($2::text='TASK_ASSIGNEE' OR s.speaker_user_id=$3::uuid))
                ORDER BY s.speaking_order NULLS LAST,s.full_name`, [conference.id,user.role,user.id])
        ]);
        const assignments = assignmentResult.rows.length
            ? user.role === "TASK_ASSIGNEE"
                ? assignmentResult.rows.map(row => `${row.task_title} của bạn (hạn ${formatAiDate(row.due_at)}; trạng thái ${row.status})`).join("; ")
                : [...new Set(assignmentResult.rows.map(row => `${row.task_title}: ${row.assignee_name || "chưa rõ"}`))].join("; ")
            : "chưa có người được phân công";
        const speakers = speakerResult.rows.length
            ? speakerResult.rows.map(row => `${row.full_name || "chưa rõ tên"}${row.presentation_title ? ` (${row.presentation_title})` : ""}`).join("; ")
            : "chưa có báo cáo viên được ghi nhận";
        return `${conference.code} – ${conference.title}: Người được phân công: ${assignments}. Báo cáo viên: ${speakers}.`;
    }
    const asksNextCalendarWeek = /tuan sau/.test(normalized);
    const requestedDaysMatch = normalized.match(/\b(?:trong\s+)?(\d{1,3})\s+ngay(?:\s+toi)?\b/);
    const asksUpcoming = /sap den han|sap toi han|han gan nhat|den han|deadline|trong 24 gio|ngay mai|tuan toi/.test(normalized) || Boolean(requestedDaysMatch) || asksNextCalendarWeek;
    const { asksToday, asksOverdue, asksInProgress, asksUncompleted, asksCompleted, asksProgress } = require("../services/task-question-intent").classifyTaskQuestion(normalized);
    const requestedAccountMatch = normalized.match(/tai khoan\s+([a-z0-9._-]+)/);
    let requestedAssigneeId = null;
    if (requestedAccountMatch) {
        const requestedUsername = requestedAccountMatch[1];
        if (user.role !== "ADMIN") {
            if (String(user.username || "").toLocaleLowerCase("vi-VN") !== requestedUsername.toLocaleLowerCase("vi-VN")) {
                return "Bạn chỉ được tra cứu nhiệm vụ của tài khoản đang đăng nhập.";
            }
        } else {
            const accountResult = await pool.query(
                "SELECT id FROM users WHERE lower(username)=lower($1) LIMIT 2",
                [requestedUsername]
            );
            if (accountResult.rowCount !== 1) {
                return "Không tìm thấy duy nhất một tài khoản phù hợp để tra cứu nhiệm vụ.";
            }
            requestedAssigneeId = accountResult.rows[0].id;
        }
    }
    let requestedPeriod = parseReportPeriod(question);
    const horizonDays = asksUpcoming && !asksNextCalendarWeek && !requestedPeriod
        ? Math.min(365, Math.max(1, Number(requestedDaysMatch?.[1]) || (/tuan toi/.test(normalized) ? 7 : 1)))
        : null;
    const asksTaskUpdateQueue = /(?:dang cho toi|cho toi|can toi|toi can).{0,45}(?:cap nhat|gui y kien|cap nhat tien do|bao cao tien do)/.test(normalized);
    const asksTaskTypeRanking = /(?:nhom cong viec|loai cong viec).{0,70}(?:nhieu nhat|chiem nhieu|chiem ty trong)|(?:nhieu nhat|chiem nhieu).{0,70}(?:nhom cong viec|loai cong viec)/.test(normalized);
    const asksTaskDelayRisk = /(?:nguy co tre han|nguy co cham han|de tre han|de cham han|rui ro tre han)/.test(normalized);
    if (["ADMIN", "TASK_ASSIGNEE"].includes(user.role) && (asksTaskUpdateQueue || asksTaskTypeRanking || asksTaskDelayRisk)) {
        const baseScope = `($1::text='ADMIN' OR a.assignee_user_id=$2::uuid) AND ($3::uuid IS NULL OR a.assignee_user_id=$3::uuid)`;
        if (asksTaskUpdateQueue) {
            const result = await pool.query(`SELECT a.title,a.status,a.due_at,c.code,c.title AS conference_title
                FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
                WHERE ${baseScope} AND a.status IN ('ASSIGNED','IN_PROGRESS')
                ORDER BY a.due_at NULLS LAST,a.created_at LIMIT 50`, [user.role,user.id,requestedAssigneeId]);
            if (!result.rowCount) return "Không có nhiệm vụ đang mở cần cập nhật hoặc gửi ý kiến trong phạm vi tài khoản này.";
            const lines = result.rows.map(row => `• ${row.title} — hạn ${formatAiDate(row.due_at)}; trạng thái ${{ASSIGNED:"đã giao",IN_PROGRESS:"đang thực hiện"}[row.status]}; ${row.code} ${row.conference_title}.`);
            return `Nhiệm vụ đang mở cần bạn cập nhật (${result.rowCount} mục):\n${lines.join("\n")}`;
        }
        if (asksTaskTypeRanking) {
            const result = await pool.query(`SELECT a.title,COUNT(*)::int AS count
                FROM conference_task_assignments a WHERE ${baseScope} AND a.status<>'CANCELLED'
                GROUP BY a.title ORDER BY count DESC,a.title LIMIT 20`, [user.role,user.id,requestedAssigneeId]);
            if (!result.rowCount) return "Chưa có nhiệm vụ để xếp hạng trong phạm vi tài khoản này.";
            const maxCount = Number(result.rows[0].count);
            const leaders = result.rows.filter(row => Number(row.count) === maxCount);
            const total = result.rows.reduce((sum,row) => sum + Number(row.count),0);
            return `Nhóm công việc được giao nhiều nhất: ${leaders.map(row => `${row.title} (${row.count})`).join("; ")} — ${maxCount}/${total} nhiệm vụ không bị hủy, tính theo tên công việc; các nhóm đồng hạng được nêu cùng nhau.`;
        }
        const result = await pool.query(`SELECT a.title,a.status,a.due_at,c.code,c.title AS conference_title
            FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
            WHERE ${baseScope} AND a.status IN ('ASSIGNED','IN_PROGRESS') AND a.due_at IS NOT NULL
            ORDER BY a.due_at ASC LIMIT 20`, [user.role,user.id,requestedAssigneeId]);
        if (!result.rowCount) return "Chưa có nhiệm vụ còn mở với hạn cụ thể để xếp hạng nguy cơ trễ hạn.";
        const nearest = result.rows[0];
        const sameDeadline = result.rows.filter(row => new Date(row.due_at).getTime() === new Date(nearest.due_at).getTime());
        return `Nhiệm vụ cần ưu tiên rà soát hạn sớm nhất: ${sameDeadline.map(row => `${row.title} (${row.code})`).join("; ")} — hạn ${formatAiDate(nearest.due_at)}; trạng thái ${{ASSIGNED:"đã giao",IN_PROGRESS:"đang thực hiện"}[nearest.status]}. Xếp theo hạn sớm nhất trong các nhiệm vụ còn mở; đây là chỉ báo ưu tiên, không phải dự báo chắc chắn sẽ trễ.`;
    }
    const horizonLabel = asksNextCalendarWeek ? "tuần sau" : horizonDays === 1 && /24 gio/.test(normalized) ? "24 giờ tới" : `${horizonDays} ngày tới`;
    if (!requestedPeriod && /\bthang nay\b/.test(normalized)) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
        const year = Number(parts.year), month = Number(parts.month);
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        requestedPeriod = { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`, label: `tháng ${String(month).padStart(2, "0")}/${year}` };
    }
    // For an in-progress reporting period, include records from its first day
    // through today. Keep the exclusive upper bound at tomorrow so date-only
    // comparisons include all of today's records in the configured timezone.
    if (asksCompleted && requestedPeriod) {
        const localToday = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
        }).format(new Date());
        const tomorrow = new Date(`${localToday}T00:00:00Z`);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const tomorrowLocal = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
        }).format(tomorrow);
        const explicitlyThroughToday = /(?:den hom nay|toi hom nay|den hien tai)/.test(normalize(question));
        if (requestedPeriod.from <= localToday && (requestedPeriod.to > localToday || explicitlyThroughToday)) {
            const displayDate = value => value.split("-").reverse().join("/");
            requestedPeriod = {
                ...requestedPeriod,
                to: tomorrowLocal,
                label: `${requestedPeriod.label} (từ ${displayDate(requestedPeriod.from)} đến ${displayDate(localToday)})`
            };
        }
    }
    const periodLabel = requestedPeriod?.label ? ` trong ${requestedPeriod.label}` : "";
    const asksNamedAccountTaskCount = Boolean(requestedAssigneeId) && /bao nhieu/.test(normalized) && /nhiem vu|cong viec/.test(normalized);
    const asksNamedAccountTaskRatings = Boolean(requestedAssigneeId) && /diem trung binh|danh gia/.test(normalized) && /nhiem vu|cong viec|tai khoan/.test(normalized);
    if (user.role === "ADMIN" && requestedAssigneeId && (asksNamedAccountTaskCount || asksNamedAccountTaskRatings)) {
        const periodFrom = asksNamedAccountTaskCount ? requestedPeriod?.from || null : null;
        const periodTo = asksNamedAccountTaskCount ? requestedPeriod?.to || null : null;
        const aggregate = await pool.query(`SELECT
                COUNT(*) FILTER (WHERE a.status<>'CANCELLED')::int AS total,
                COUNT(*) FILTER (WHERE a.status='ASSIGNED')::int AS assigned,
                COUNT(*) FILTER (WHERE a.status='IN_PROGRESS')::int AS in_progress,
                COUNT(*) FILTER (WHERE a.status='COMPLETED')::int AS completed,
                COUNT(*) FILTER (WHERE a.status='COMPLETED' AND a.completed_at IS NOT NULL)::int AS completed_in_period,
                COUNT(*) FILTER (WHERE a.status='COMPLETED' AND a.completed_at IS NULL)::int AS completed_without_timestamp,
                COUNT(a.evaluation_rating) FILTER (WHERE a.status<>'CANCELLED')::int AS evaluated_count,
                ROUND(AVG(a.evaluation_rating) FILTER (WHERE a.status<>'CANCELLED')::numeric,2) AS average_rating,
                COUNT(*) FILTER (WHERE a.status<>'CANCELLED' AND a.evaluation_rating>3)::int AS above_three
            FROM conference_task_assignments a
            WHERE a.assignee_user_id=$1::uuid
              AND ($2::date IS NULL OR (
                    ($4::boolean=FALSE AND (a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date)
                    OR ($4::boolean=TRUE AND (
                        ((a.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date)
                        OR (a.completed_at IS NULL AND (a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date)
                    ))
              ))
              AND ($3::date IS NULL OR (
                    ($4::boolean=FALSE AND (a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $3::date)
                    OR ($4::boolean=TRUE AND (
                        ((a.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $3::date)
                        OR (a.completed_at IS NULL AND (a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $3::date)
                    ))
              ))`,
        [requestedAssigneeId, periodFrom, periodTo, asksCompleted]);
        const stats = aggregate.rows[0] || {};
        const username = requestedAccountMatch[1];
        if (asksNamedAccountTaskRatings) return formatAccountTaskRatings(stats, username, asksNamedAccountTaskCount ? requestedPeriod?.label : null);
        if (asksNamedAccountTaskCount && asksCompleted) return formatAccountTaskStatusCount(stats, username, requestedPeriod?.label, "completed");
        if (asksNamedAccountTaskCount && asksInProgress) return formatAccountTaskStatusCount(stats, username, requestedPeriod?.label, "in_progress");
        if (asksNamedAccountTaskCount && asksUncompleted) return formatAccountTaskStatusCount({ ...stats, uncompleted: (Number(stats.assigned) || 0) + (Number(stats.in_progress) || 0) }, username, requestedPeriod?.label, "uncompleted");
        const periodDescription = requestedPeriod ? `${requestedPeriod.label} theo hạn nhiệm vụ` : "toàn bộ thời gian";
        return formatAccountTaskCount(stats, username, periodDescription);
    }
    const taskRows = ["ADMIN", "TASK_ASSIGNEE"].includes(user.role)
        ? await pool.query(`SELECT a.title,a.description,a.due_at,a.updated_at,a.completed_at,a.status,
                COALESCE(NULLIF(u.full_name,''),NULLIF(a.assignee_name,'')) AS assignee_display_name,c.code,c.title AS conference_title,
                c.start_time,c.location_name,o.name AS organization_name
            FROM conference_task_assignments a
            JOIN conferences c ON c.id=a.conference_id
            LEFT JOIN users u ON u.id=a.assignee_user_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE (($10::boolean=TRUE AND a.status='IN_PROGRESS') OR ($5::boolean=TRUE AND $8::boolean=FALSE AND $9::boolean=FALSE AND $10::boolean=FALSE AND a.status<>'CANCELLED') OR ($9::boolean=TRUE AND a.status IN ('ASSIGNED','IN_PROGRESS') AND $10::boolean=FALSE) OR ($8::boolean=TRUE AND a.status='COMPLETED') OR ($5::boolean=FALSE AND $8::boolean=FALSE AND $9::boolean=FALSE AND $10::boolean=FALSE AND a.status IN ('ASSIGNED','IN_PROGRESS')))
              AND ($1::text='ADMIN' OR a.assignee_user_id=$2::uuid)
              AND ($11::uuid IS NULL OR a.assignee_user_id=$11::uuid)
              AND ($3::integer IS NULL OR (a.due_at > NOW() AND a.due_at <= NOW() + ($3::integer * INTERVAL '1 day')))
              AND ($4::boolean=FALSE OR (a.due_at IS NOT NULL AND a.due_at < NOW()))
              AND ($6::date IS NULL OR ((CASE WHEN ($8::boolean OR ($5::boolean AND a.status='COMPLETED')) THEN a.completed_at ELSE a.due_at END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $6::date)
              AND ($7::date IS NULL OR ((CASE WHEN ($8::boolean OR ($5::boolean AND a.status='COMPLETED')) THEN a.completed_at ELSE a.due_at END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $7::date)
            ORDER BY a.due_at NULLS LAST,c.start_time
            LIMIT 100`, [user.role,user.id,horizonDays,asksOverdue,asksProgress,requestedPeriod?.from || null,requestedPeriod?.to || null,asksCompleted,asksUncompleted,asksInProgress,requestedAssigneeId])
        : { rows: [] };
    const speakerRows = !asksToday && !asksOverdue && !asksUncompleted && !asksCompleted && ["ADMIN", "SPEAKER"].includes(user.role)
        ? await pool.query(`SELECT s.presentation_title AS title,s.full_name,c.code,c.title AS conference_title,
                c.start_time AS due_at,c.location_name,o.name AS organization_name
            FROM conference_speakers s
            JOIN conferences c ON c.id=s.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE c.status='APPROVED'
              AND ($1::text='ADMIN' OR s.speaker_user_id=$2::uuid)
              AND ($6::uuid IS NULL OR s.speaker_user_id=$6::uuid)
              AND ($3::integer IS NULL OR (c.start_time > NOW() AND c.start_time <= NOW() + ($3::integer * INTERVAL '1 day')))
              AND c.start_time >= NOW()
              AND ($4::date IS NULL OR (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date)
              AND ($5::date IS NULL OR (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date)
            ORDER BY c.start_time,s.speaking_order
            LIMIT 100`, [user.role,user.id,horizonDays,requestedPeriod?.from || null,requestedPeriod?.to || null,requestedAssigneeId])
        : { rows: [] };

    const lines = [
        ...taskRows.rows.map(row => `• ${row.title} — ${row.status === "COMPLETED" && asksCompleted ? `hoàn thành ${row.completed_at ? formatAiDate(row.completed_at) : "chưa lưu mốc (hoàn thành trước nâng cấp)"}` : `hạn ${formatAiDate(row.due_at)}; trạng thái ${{ ASSIGNED: "đã giao", IN_PROGRESS: "đang thực hiện", COMPLETED: "hoàn thành" }[row.status] || row.status}`}; hội nghị ${row.code} ${row.conference_title}${user.role === "ADMIN" ? `; người nhận ${row.assignee_display_name || "chưa rõ"}` : ""}${row.organization_name ? `; ${row.organization_name}` : ""}${row.location_name ? `; địa điểm ${row.location_name}` : ""}.`),
        ...speakerRows.rows.map(row => `• Lịch báo cáo viên “${row.title}” — ${formatAiDate(row.due_at)}; hội nghị ${row.code} ${row.conference_title}${user.role === "ADMIN" ? `; báo cáo viên ${row.full_name || "chưa rõ"}` : ""}${row.organization_name ? `; ${row.organization_name}` : ""}${row.location_name ? `; địa điểm ${row.location_name}` : ""}.`)
    ];
    if (!lines.length) {
        if (asksCompleted && requestedPeriod) {
            const legacy = await pool.query(`SELECT COUNT(*)::int AS count FROM conference_task_assignments a
                WHERE a.status='COMPLETED' AND a.completed_at IS NULL AND ($1::text='ADMIN' OR a.assignee_user_id=$2::uuid)`, [user.role,user.id]);
            if (legacy.rows[0]?.count) return `Chưa thể xác định đầy đủ nhiệm vụ nào hoàn thành trong ${requestedPeriod.label}: hiện không có bản ghi nào có thời điểm hoàn thành được lưu trong kỳ. Có ${legacy.rows[0].count} nhiệm vụ đang ở trạng thái hoàn thành nhưng thiếu mốc hoàn thành; không thể xác nhận chúng thuộc kỳ này chỉ dựa vào hạn công việc.`;
            return `Không tìm thấy nhiệm vụ được ghi nhận hoàn thành trong ${requestedPeriod.label}, trong phạm vi dữ liệu và quyền xem của tài khoản này.`;
        }
        if (asksToday) return "Không có nhiệm vụ đến hạn hôm nay trong phạm vi dữ liệu và quyền xem của tài khoản này.";
        if (asksInProgress) return `Không có nhiệm vụ ở trạng thái đang thực hiện${periodLabel} trong phạm vi dữ liệu và quyền xem của tài khoản này.`;
        if (asksOverdue) return "Không có nhiệm vụ quá hạn chưa hoàn thành trong phạm vi dữ liệu và quyền xem của tài khoản này.";
        if (asksCompleted) return "Không tìm thấy nhiệm vụ có trạng thái hoàn thành trong phạm vi dữ liệu và quyền xem của tài khoản này.";
        if (asksUncompleted && requestedPeriod) return `Không có nhiệm vụ chưa hoàn thành${periodLabel} trong phạm vi dữ liệu và quyền xem của tài khoản này.`;
        if (asksUncompleted) return "Không có nhiệm vụ chưa hoàn thành trong phạm vi dữ liệu và quyền xem của tài khoản này.";
        if (asksProgress && requestedPeriod) return `Không có nhiệm vụ${periodLabel} trong phạm vi dữ liệu và quyền xem của tài khoản này.`;
        if (asksUpcoming && requestedPeriod) return `Không có nhiệm vụ hoặc lịch báo cáo viên đến hạn${periodLabel} theo dữ liệu và quyền xem của tài khoản này.`;
        if (asksUpcoming) return `Không có nhiệm vụ hoặc lịch báo cáo viên đến hạn trong ${horizonLabel} theo dữ liệu và quyền xem của tài khoản này.`;
        return "Không có nhiệm vụ đang mở hoặc lịch báo cáo viên sắp tới trong phạm vi tài khoản này.";
    }
    if (asksToday) return `Nhiệm vụ đến hạn hôm nay (${taskRows.rows.length} mục):` + `\n${lines.join("\n")}`;
    if (asksInProgress) return `Nhiệm vụ đang thực hiện${periodLabel} (${taskRows.rows.length} mục):`
        + (lines.length ? `\n${lines.join("\n")}` : "\nKhông có nhiệm vụ ở trạng thái đang thực hiện trong kỳ này.");
    if (asksCompleted) {
        const legacy = await pool.query(`SELECT COUNT(*)::int AS count FROM conference_task_assignments a
            WHERE a.status='COMPLETED' AND a.completed_at IS NULL AND ($1::text='ADMIN' OR a.assignee_user_id=$2::uuid)`, [user.role,user.id]);
        const legacyNote = legacy.rows[0]?.count ? `\nNgoài danh sách trên, còn ${legacy.rows[0].count} nhiệm vụ đã hoàn thành nhưng thiếu thời điểm hoàn thành; chưa xác định được chúng có thuộc kỳ này hay không.` : "";
        return `Nhiệm vụ được ghi nhận hoàn thành${periodLabel} (${taskRows.rows.length} mục):\n${lines.join("\n")}${legacyNote}`;
    }    if (asksOverdue) return `Nhiệm vụ quá hạn chưa hoàn thành (${lines.length}${lines.length === 12 ? ", tối đa 12 mục" : " mục"}):\n${lines.join("\n")}`;
    if (asksUncompleted) return `Nhiệm vụ chưa hoàn thành${periodLabel} (${taskRows.rows.length} mục):\n${lines.join("\n")}`;
    if (asksProgress && requestedPeriod) {
        const assigned = taskRows.rows.filter(row => row.status === "ASSIGNED").length;
        const inProgress = taskRows.rows.filter(row => row.status === "IN_PROGRESS").length;
        const completed = taskRows.rows.filter(row => row.status === "COMPLETED").length;
        return `Tiến độ nhiệm vụ${periodLabel}: ${taskRows.rows.length} nhiệm vụ theo hạn/thời điểm hoàn thành (đã giao ${assigned}, đang thực hiện ${inProgress}, hoàn thành ${completed}); ${speakerRows.rows.length} lịch báo cáo viên cùng kỳ.`;
    }    const title = asksUpcoming && requestedPeriod ? `Nhiệm vụ/lịch đến hạn${periodLabel}` : asksUpcoming ? `Nhiệm vụ/lịch đến hạn trong ${horizonLabel}` : "Nhiệm vụ và lịch được phân công";
    return `${title} (${lines.length}${lines.length === 12 ? ", tối đa 12 mục" : " mục"}):\n${lines.join("\n")}`;
}

async function loadConferenceStaffByDate(user, period) {
    if (!user?.id || !["ADMIN", "TASK_ASSIGNEE", "SPEAKER"].includes(user.role)) {
        return "Tài khoản này không được xem danh sách phân công và báo cáo viên của hội nghị.";
    }
    const result = await pool.query(`SELECT c.code,c.title,c.status,c.start_time,o.name AS organization_name,
            (SELECT string_agg(DISTINCT COALESCE(NULLIF(a.assignee_name,''),u.full_name), ', ')
             FROM conference_task_assignments a LEFT JOIN users u ON u.id=a.assignee_user_id
             WHERE a.conference_id=c.id AND a.status<>'CANCELLED'
               AND ($1::text='ADMIN' OR ($1::text='TASK_ASSIGNEE' AND a.assignee_user_id=$2::uuid))) AS assigned_names,
            (SELECT string_agg(DISTINCT concat_ws(' ',s.full_name, NULLIF('('||s.presentation_title||')','()')), '; ')
             FROM conference_speakers s WHERE s.conference_id=c.id
               AND ($1::text IN ('ADMIN','TASK_ASSIGNEE') OR ($1::text='SPEAKER' AND s.speaker_user_id=$2::uuid))) AS speaker_names
        FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
        WHERE (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $3::date
          AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $4::date
          AND ($1::text='ADMIN'
            OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$2::uuid AND a.status<>'CANCELLED'))
            OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$2::uuid)))
        ORDER BY c.start_time,c.code`, [user.role,user.id,period.from,period.to]);
    if (!result.rowCount) return `Không tìm thấy hội nghị trong ngày ${period.label} có phân công/báo cáo viên thuộc phạm vi tài khoản được xem.`;
    const statuses = { PENDING:"chờ phê duyệt", APPROVED:"đã phê duyệt", COMPLETED:"hoàn thành", REJECTED:"bị từ chối", CANCELLED:"đã hủy", RESCHEDULED:"đề xuất dời lịch" };
    return `Hội nghị trong ngày ${period.label} (${result.rowCount}):\n` + result.rows.map(row =>
        `• ${row.code} – ${row.title}; ${formatAiDate(row.start_time)}; ${row.organization_name || "chưa ghi đơn vị"}; trạng thái ${statuses[row.status] || row.status}. Người được phân công: ${row.assigned_names || (user.role === "SPEAKER" ? "không hiển thị trong quyền tài khoản này" : "chưa ghi nhận")}. Báo cáo viên: ${row.speaker_names || "chưa ghi nhận trong phạm vi tài khoản"}.`
    ).join("\n");
}
function parseReportPeriod(question) {
    const normalized = normalize(question);
    const localParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const today = new Date(Date.UTC(Number(localParts.year), Number(localParts.month) - 1, Number(localParts.day)));
    const isoDate = date => date.toISOString().slice(0, 10);
    const makePeriod = (start, end, label) => ({ from: isoDate(start), to: isoDate(end), label });
    if (/(?:toan bo thoi gian|tat ca thoi gian|toan bo lich su|tu truoc den nay|tu truoc toi nay)/.test(normalized)) {
        return { from: null, to: null, label: "toàn bộ thời gian" };
    }
    const currentYear = today.getUTCFullYear();
    const currentMonth = today.getUTCMonth();
    const currentQuarterStart = Math.floor(currentMonth / 3) * 3;
    if (/tuan sau/.test(normalized)) {
        const currentWeekStart = new Date(today);
        currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - ((currentWeekStart.getUTCDay() + 6) % 7));
        const nextWeekStart = new Date(currentWeekStart);
        nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
        const weekAfterStart = new Date(nextWeekStart);
        weekAfterStart.setUTCDate(weekAfterStart.getUTCDate() + 7);
        return makePeriod(nextWeekStart, weekAfterStart, `tuần sau (${nextWeekStart.toLocaleDateString("vi-VN", { timeZone: "UTC" })}–${new Date(weekAfterStart.getTime() - 86400000).toLocaleDateString("vi-VN", { timeZone: "UTC" })})`);
    }
    const quarterThroughToday = normalized.match(/\b(?:tu dau )?quy\s+(iv|iii|ii|i|[1-4]|nay|hien tai)(?:\s*(?:nam|[/.-])\s*(\d{4}))?.{0,35}\b(?:den|toi)\s+hom nay\b/);
    if (quarterThroughToday) {
        const quarterNumber = ({ i: 1, ii: 2, iii: 3, iv: 4 })[quarterThroughToday[1]] ||
            (quarterThroughToday[1] === "nay" || quarterThroughToday[1] === "hien tai" ? Math.floor(currentMonth / 3) + 1 : Number(quarterThroughToday[1]));
        const year = Number(quarterThroughToday[2] || normalized.match(/\bnam\s+(\d{4})\b/)?.[1] || currentYear);
        if (quarterNumber >= 1 && quarterNumber <= 4 && year >= 1900 && year <= 2200) {
            const startMonth = (quarterNumber - 1) * 3;
            const quarterEndMonth = startMonth + 3;
            const endYear = quarterEndMonth >= 12 ? year + 1 : year;
            const endMonth = quarterEndMonth >= 12 ? quarterEndMonth - 12 : quarterEndMonth;
            return makePeriod(new Date(Date.UTC(year, startMonth, 1)), new Date(Date.UTC(endYear, endMonth, 1)), `Quý ${["I", "II", "III", "IV"][quarterNumber - 1]}/${year}`);
        }
    }    if (/(?:hom nay|ngay hom nay)/.test(normalized)) {
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        return makePeriod(today, tomorrow, "hôm nay");
    }
    if (/(?:thang toi|thang sau|thang tiep theo)/.test(normalized)) {
        const month = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
        return makePeriod(month, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)), `tháng ${String(month.getUTCMonth() + 1).padStart(2, "0")}/${month.getUTCFullYear()}`);
    }
    if (/(?:thang nay|thang hien tai)/.test(normalized)) {
        return makePeriod(new Date(Date.UTC(currentYear, currentMonth, 1)), new Date(Date.UTC(currentYear, currentMonth + 1, 1)), `tháng ${String(currentMonth + 1).padStart(2, "0")}/${currentYear}`);
    }
    if (/(?:thang truoc|thang vua qua)/.test(normalized)) {
        const month = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
        return makePeriod(month, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)), `tháng ${String(month.getUTCMonth() + 1).padStart(2, "0")}/${month.getUTCFullYear()}`);
    }
    if (/(?:quy nay|quy hien tai)/.test(normalized)) {
        const quarter = Math.floor(currentQuarterStart / 3) + 1;
        return makePeriod(new Date(Date.UTC(currentYear, currentQuarterStart, 1)), new Date(Date.UTC(currentYear, currentQuarterStart + 3, 1)), `Quý ${["I", "II", "III", "IV"][quarter - 1]}/${currentYear}`);
    }
    if (/(?:quy truoc|quy vua qua)/.test(normalized)) {
        const start = new Date(Date.UTC(currentYear, currentQuarterStart - 3, 1));
        const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
        return makePeriod(start, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1)), `Quý ${["I", "II", "III", "IV"][quarter - 1]}/${start.getUTCFullYear()}`);
    }
    if (/(?:nam nay|nam hien tai|tu dau nam den nay)/.test(normalized)) {
        return makePeriod(new Date(Date.UTC(currentYear, 0, 1)), new Date(Date.UTC(currentYear + 1, 0, 1)), 
`Năm ${currentYear}`);
    }
    if (/(?:nam truoc|nam vua qua)/.test(normalized)) {
        return makePeriod(new Date(Date.UTC(currentYear - 1, 0, 1)), new Date(Date.UTC(currentYear, 0, 1)), 
`Năm ${currentYear - 1}`);
    }
    const relativeDays = normalized.match(/\b(\d{1,3})\s+ngay\s+(qua|gan day|toi|sap toi)\b/);
    if (relativeDays) {
        const days = Number(relativeDays[1]);
        if (days > 0 && days <= 366) {
            const start = new Date(today);
            const end = new Date(today);
            if (["qua", "gan day"].includes(relativeDays[2])) start.setUTCDate(start.getUTCDate() - days + 1);
            else end.setUTCDate(end.getUTCDate() + days);
            end.setUTCDate(end.getUTCDate() + 1);
            return makePeriod(start, end, `${days} ngày ${["qua", "gan day"].includes(relativeDays[2]) ? "qua" : "tới"}`);
        }
    }
    if (/(?:tuan nay|tuan hien tai|7 ngay toi|7 ngay qua)/.test(normalized)) {
        if (normalized.includes("tuan")) {
            const start = new Date(today);
            const weekday = (start.getUTCDay() + 6) % 7;
            start.setUTCDate(start.getUTCDate() - weekday);
            return makePeriod(start, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7)), "tuần này");
        }
        const start = new Date(today);
        const end = new Date(today);
        if (normalized.includes("qua")) start.setUTCDate(start.getUTCDate() - 6);
        else end.setUTCDate(end.getUTCDate() + 7);
        end.setUTCDate(end.getUTCDate() + 1);
        return makePeriod(start, end, normalized.includes("qua") ? "7 ngày qua" : "7 ngày tới");
    }
    const numericDateRange = normalized.match(/\btu ngay\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s+den(?: ngay)?\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
    if (numericDateRange) {
        const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = numericDateRange;
        const start = new Date(Date.UTC(Number(fromYear), Number(fromMonth) - 1, Number(fromDay)));
        const end = new Date(Date.UTC(Number(toYear), Number(toMonth) - 1, Number(toDay)));
        if (start.getUTCFullYear() === Number(fromYear) && start.getUTCMonth() === Number(fromMonth) - 1 && start.getUTCDate() === Number(fromDay) &&
            end.getUTCFullYear() === Number(toYear) && end.getUTCMonth() === Number(toMonth) - 1 && end.getUTCDate() === Number(toDay) && start <= end) {
            const toExclusive = new Date(end.getTime() + 86400000);
            return { from: start.toISOString().slice(0, 10), to: toExclusive.toISOString().slice(0, 10), label: `${fromDay}/${fromMonth}/${fromYear}–${toDay}/${toMonth}/${toYear}` };
        }
    }
    const writtenDateRange = normalized.match(/\btu ngay\s+(\d{1,2}) thang\s+(\d{1,2}) nam\s+(\d{4})\s+den(?: ngay)?\s+(\d{1,2}) thang\s+(\d{1,2}) nam\s+(\d{4})\b/);
    if (writtenDateRange) {
        const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = writtenDateRange;
        return parseReportPeriod(`từ ngày ${fromDay}/${fromMonth}/${fromYear} đến ngày ${toDay}/${toMonth}/${toYear}`);
    }
    const singleDate = normalized.match(/(?:\bngay\s+)?\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
    if (singleDate) {
        const [, dayText, monthText, yearText] = singleDate;
        const day = Number(dayText), month = Number(monthText), year = Number(yearText);
        const start = new Date(Date.UTC(year, month - 1, day));
        if (start.getUTCFullYear() === year && start.getUTCMonth() === month - 1 && start.getUTCDate() === day) {
            const end = new Date(start.getTime() + 86400000);
            return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), label: `${day}/${month}/${year}` };
        }
    }
    const yearRange = normalized.match(/\btu nam\s+(\d{4})\s+den nam?\s+(\d{4})\b/);
    if (yearRange) {
        const fromYear = Number(yearRange[1]), toYear = Number(yearRange[2]);
        if (fromYear >= 1900 && toYear <= 2200 && fromYear <= toYear) {
            return { from: `${fromYear}-01-01`, to: `${toYear + 1}-01-01`, label: `${fromYear}–${toYear}` };
        }
    }
    const monthRange = normalized.match(/\btu thang\s+(0?[1-9]|1[0-2])(?:\s*(?:nam|[/.-])\s*(\d{4}))?\s+den(?: thang)?\s+(0?[1-9]|1[0-2])(?:\s*(?:nam|[/.-])\s*(\d{4}))?\b/);
    if (monthRange) {
        const startMonth = Number(monthRange[1]);
        const startYear = Number(monthRange[2] || monthRange[4] || new Date().getFullYear());
        const endMonth = Number(monthRange[3]);
        const endYear = Number(monthRange[4] || startYear);
        if (startYear >= 1900 && endYear <= 2200 && (startYear < endYear || startMonth <= endMonth)) {
            const toMonth = endMonth === 12 ? 1 : endMonth + 1;
            const toYear = endMonth === 12 ? endYear + 1 : endYear;
            return { from: `${startYear}-${String(startMonth).padStart(2, "0")}-01`, to: `${toYear}-${String(toMonth).padStart(2, "0")}-01`, label: `${String(startMonth).padStart(2, "0")}/${startYear}–${String(endMonth).padStart(2, "0")}/${endYear}` };
        }
    }
    // In a follow-up, the new period may be appended after an older question.
    // Select the last stated month so stale context cannot override the user's
    // latest month. Also accept a bare “11/2026” reply to a clarification.
    const writtenMonthMatches = [...normalized.matchAll(/\bthang\s+(0?[1-9]|1[0-2])(?:\s*(?:nam|[/.-])\s*(\d{4}))?\b/g)]
        .map(match => ({ match, index: match.index }));
    const numericMonthMatches = [...normalized.matchAll(/(?<![\d/])(0?[1-9]|1[0-2])\s*[/.-]\s*(\d{4})\b/g)]
        .map(match => ({ match, index: match.index }));
    const lastMonth = [...writtenMonthMatches, ...numericMonthMatches].sort((a, b) => a.index - b.index).at(-1)?.match;
    if (lastMonth) {
        const month = Number(lastMonth[1]);
        const years = [...normalized.matchAll(/\bnam\s+(\d{4})\b/g)];
        const year = Number(lastMonth[2] || years.at(-1)?.[1] || new Date().getFullYear());
        if (year >= 1900 && year <= 2200) {
            const toMonth = month === 12 ? 1 : month + 1;
            const toYear = month === 12 ? year + 1 : year;
            return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${toYear}-${String(toMonth).padStart(2, "0")}-01`, label: `${String(month).padStart(2, "0")}/${year}` };
        }
    }
    const quarterMatch = normalized.match(/\bquy\s+(iv|iii|ii|i|[1-4])(?:\s*(?:nam|[/.-])\s*(\d{4}))?\b/);
    if (quarterMatch) {
        const quarterNumber = ({ i: 1, ii: 2, iii: 3, iv: 4 })[quarterMatch[1]] || Number(quarterMatch[1]);
        const year = Number(quarterMatch[2] || normalized.match(/\bnam\s+(\d{4})\b/)?.[1] || new Date().getFullYear());
        if (quarterNumber >= 1 && quarterNumber <= 4 && year >= 1900 && year <= 2200) {
            const startMonth = (quarterNumber - 1) * 3 + 1;
            const endMonth = startMonth + 3;
            const endYear = endMonth > 12 ? year + 1 : year;
            const exclusiveMonth = endMonth > 12 ? endMonth - 12 : endMonth;
            const roman = ["I", "II", "III", "IV"][quarterNumber - 1];
            return { from: `${year}-${String(startMonth).padStart(2, "0")}-01`, to: `${endYear}-${String(exclusiveMonth).padStart(2, "0")}-01`, label: `Quý ${roman}/${year}` };
        }
    }
    const yearMatch = normalized.match(/\bnam\s+(\d{4})\b/);
    if (yearMatch && Number(yearMatch[1]) >= 1900 && Number(yearMatch[1]) <= 2200) {
        const year = Number(yearMatch[1]);
        return { from: `${year}-01-01`, to: `${year + 1}-01-01`, label: String(year) };
    }
    return null;
}

function isContactRequestStatusQuestion(question) {
    return classifyQuestion(question).isContactRequestStatusQuestion;
}
function isContactRequestSummaryIntent(question) {
    const normalized = normalize(question);
    const mentionsContactRequests = /(?:yeu cau|de nghi).{0,70}(?:tu van|tro giup phap ly|tgpl)|(?:tu van|tro giup phap ly|tgpl).{0,70}(?:yeu cau|gui den|cua nguoi dan)/.test(normalized);
    return mentionsContactRequests &&
        (/(?:tong hop|thong ke|bao cao|ra soat|liet ke|bao nhieu|danh sach)/.test(normalized) || Boolean(parseReportPeriod(question)));
}

async function loadLegalAidContactRequestSummary(user, question, requestedPeriod) {
    const unassignedOnly = /chua phan cong/.test(normalize(question));
    const scope = "($1::text='ADMIN' OR r.user_id=$2::uuid)";
    const params = [user.role, user.id, requestedPeriod?.from || null, requestedPeriod?.to || null];
    const where = `${scope}
        AND ($3::date IS NULL OR (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $3::date)
        AND ($4::date IS NULL OR (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $4::date)` +
        (unassignedOnly ? " AND r.status='PENDING' AND r.assigned_staff_user_id IS NULL" : "");
    const [totalsResult, samplesResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE r.status='PENDING')::int AS pending,
                COUNT(*) FILTER (WHERE r.status='ASSIGNED')::int AS assigned,
                COUNT(*) FILTER (WHERE r.status='CONTACTED')::int AS contacted,
                COUNT(*) FILTER (WHERE r.status='CLOSED')::int AS closed
            FROM legal_aid_contact_requests r WHERE ${where}`, params),
        pool.query(`SELECT r.requester_name,r.phone,r.question,r.created_at
            FROM legal_aid_contact_requests r WHERE ${where}
            ORDER BY r.created_at DESC,r.id DESC LIMIT 100`, params)
    ]);
    const totals = totalsResult.rows[0] || {};
    const periodLabel = requestedPeriod ? `trong kỳ ${requestedPeriod.label}` : "trong toàn bộ thời gian";
    const total = Number(totals.total) || 0;
    if (!total) return unassignedOnly
        ? `Không có yêu cầu tư vấn chưa phân công ${periodLabel} trong phạm vi dữ liệu tài khoản được xem.`
        : `Không có yêu cầu tư vấn nào được ghi nhận ${periodLabel} trong phạm vi dữ liệu tài khoản được xem.`;

    const redact = (value, requesterName, phone) => {
        let text = String(value || "").replace(/\s+/g, " ").trim();
        for (const sensitive of [requesterName, phone]) {
            if (!sensitive) continue;
            const escaped = String(sensitive).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            text = text.replace(new RegExp(escaped, "giu"), "[đã ẩn thông tin liên hệ]");
        }
        return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[đã ẩn email]")
            .replace(/(?:\+?\d[\s().-]*){9,}/g, "[đã ẩn số điện thoại]")
            .slice(0, 220);
    };
    const asksGeneralContent = /(?:noi dung chung|noi dung tong quat|phan loai chu de)/.test(normalize(question));
    if (!unassignedOnly && asksGeneralContent) {
        const topics = new Map();
        for (const row of samplesResult.rows) {
            const q = normalize(row.question);
            const topic = /(?:dat|ranh gioi|thua ke|boi thuong|tranh chap)/.test(q) ? "Đất đai, ranh giới, thừa kế hoặc tranh chấp dân sự"
                : /(?:to giac|toi pham|hinh su|bi bat|bi tam giu)/.test(q) ? "Tố giác hoặc vấn đề hình sự (chỉ phân loại nội dung, không kết luận vụ việc)"
                : /(?:quyet dinh hanh chinh|khoi kien|khieu nai|hanh chinh)/.test(q) ? "Khiếu nại hoặc khởi kiện hành chính"
                : /(?:tro giup phap ly|tgpl|giay to|thuoc dien|tu van)/.test(q) ? "Điều kiện, quyền hoặc thủ tục yêu cầu trợ giúp pháp lý"
                : "Nội dung tư vấn khác";
            topics.set(topic, (topics.get(topic) || 0) + 1);
        }
        const topicLines = [...topics.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],"vi"))
            .map(([topic,count]) => `• ${topic}: ${count} yêu cầu`).join("\n");
        return `Tổng hợp yêu cầu tư vấn ${periodLabel}: ${total} yêu cầu; chưa phân công ${totals.pending || 0}, đã phân công ${totals.assigned || 0}, đã liên hệ ${totals.contacted || 0}, hoàn tất ${totals.closed || 0}.\nNội dung chung theo chủ đề (phân loại tối đa ${samplesResult.rows.length} yêu cầu gần nhất):\n${topicLines || "Chưa có nội dung mô tả."}`;
    }    if (unassignedOnly) {
        const examples = samplesResult.rows.map(row => redact(row.question, row.requester_name, row.phone)).filter(Boolean).slice(0, 5);
        return `Tổng hợp yêu cầu tư vấn chưa phân công ${periodLabel}: ${total} yêu cầu.${examples.length ? `\nNội dung đã ẩn thông tin liên hệ:\n${examples.map(item => `• ${item}`).join("\n")}` : ""}`;
    }
    const uniqueRequests = new Map();
    for (const row of samplesResult.rows) {
        const summary = redact(row.question, row.requester_name, row.phone);
        if (summary) uniqueRequests.set(summary.toLocaleLowerCase("vi-VN"), summary);
        if (uniqueRequests.size >= 5) break;
    }
    const details = uniqueRequests.size
        ? `Một số nội dung đã ẩn thông tin liên hệ:\n${[...uniqueRequests.values()].map(item => `• ${item}`).join("\n")}`
        : "Các yêu cầu chưa có nội dung mô tả.";
    return `Tổng hợp yêu cầu tư vấn ${periodLabel}: ${total} yêu cầu; chưa phân công ${totals.pending || 0}, đã phân công ${totals.assigned || 0}, đã liên hệ ${totals.contacted || 0}, hoàn tất ${totals.closed || 0}.\n${details}${Number(samplesResult.rows.length) < total ? `\nDanh sách nội dung minh họa lấy từ tối đa ${samplesResult.rows.length} yêu cầu gần nhất; số đếm trạng thái tính trên toàn bộ kỳ.` : ""}`;
}

async function loadConferenceContext(user, question) {
    if (!user?.id || !["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"].includes(user.role)) {
        return { context: "Không có phạm vi dữ liệu hội nghị cho tài khoản này.", fallback: "" };
    }
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (
            ($2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
            OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time >= NOW())
        ))
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const params = [user.role, user.organization_id || null, user.id];
    const normalizedQuestion = normalize(question);
    const requestedCodeMatch = normalizedQuestion.match(/\b(hn|hcn|conf)[\s_-]*(\d{2,})\b/i);
    const questionIntent = classifyQuestion(question);
    const requestedCode = questionIntent.querySlots?.conferenceCode || (requestedCodeMatch ? `${requestedCodeMatch[1].toUpperCase()}-${requestedCodeMatch[2].padStart(4, "0")}` : null);
    const subjectMatch = String(question || "").match(/\bvề\s+(.+?)(?=\s+(?:đã|được|trong|vào|không|chưa)\s|[?.!;]|$)/iu);
    const requestedTopic = subjectMatch?.[1]?.trim() || null;
    const locationMatch = String(question || "").match(/(?:(?:địa điểm|nơi tổ chức)\s+(?:(?:là|ở|tại)\s+)?|(?:diễn ra|tổ chức)\s+(?:ở|tại)\s+)(?<location>.+?)(?=\s+(?:và\s+(?:cho biết|nêu|liệt kê)|cho biết|nêu|liệt kê|trong|vào|tháng|quý|năm|kể cả|bao gồm|trạng thái)|[?.!;]|$)/iu);
    const requestedLocation = locationMatch?.groups?.location?.trim().replace(/["“”']/g, "") || null;
    const includeOnlyPlannedStatuses = questionIntent.isConferenceReviewQuestion || /du kien|sap dien ra|sap toi/.test(normalizedQuestion);
    const generic = new Set(["hoi", "nghi", "su", "kien", "cho", "toi", "biet", "xem", "tim", "kiem", "thong", "tin", "danh", "sach", "nao", "bao", "nhieu", "ma", "lich", "gi", "co", "cua", "tren", "web", "trang", "website", "he", "thong", "du", "lieu", "don", "vi", "xa", "phuong", "hay", "giup", "ve", "mot", "cac", "nhung", "la", "va", "can", "ngay", "thang", "nam", "duoc", "phe", "duyet", "hoan", "thanh", "sap", "dien", "ra", "nhanh", "chuc", "dau", "theo", "tai", "moi", "hien", "dia", "diem", "dang", "chua", "tong", "so", "tat", "ca", "hon", "tu", "den", "voi", "con", "roi", "the", "trong"]);
    const searchWords = question.toLocaleLowerCase("vi-VN").normalize("NFC").split(/[^\p{L}\p{N}]+/u);
    const normalizedWords = normalizedQuestion.split(/[^a-z0-9]+/);
    const terms = requestedCode || requestedTopic || requestedLocation || /\b(?:thang|nam|quy)\s/.test(normalizedQuestion) || questionIntent.isConferenceAnalysisQuestion || questionIntent.isConferenceReviewQuestion ? [] : [...new Set(normalizedWords.map((word, index) => ({ word, original: searchWords[index] }))
        .filter(({ word, original }) => word.length >= 3 && original && !generic.has(word) && !/^\d+$/.test(word))
        .map(({ original }) => original))].slice(0, 8);
    // Only apply a status filter when the user is asking for one state. Phrases
    // such as "kể cả yêu cầu chưa phê duyệt" mean include pending, not pending-only.
    const requestedStatus = questionIntent.querySlots?.status || null;
    let requestedDate = null;
    const slashDate = normalizedQuestion.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
    const writtenDate = normalizedQuestion.match(/ngay\s+(\d{1,2})\s+thang\s+(\d{1,2})\s+nam\s+(\d{4})/);
    const dateParts = slashDate ? [slashDate[1], slashDate[2], slashDate[3]] : writtenDate ? [writtenDate[1], writtenDate[2], writtenDate[3]] : null;
    if (dateParts) {
        const day = Number(dateParts[0]), month = Number(dateParts[1]), year = Number(dateParts[2]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
            requestedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }
    const requestedPeriod = parseReportPeriod(question);
    const requestedMonth = null;
    const requestedYear = null;
    const [countResult, eventResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE c.status='PENDING')::int AS pending,
                COUNT(*) FILTER (WHERE c.status='APPROVED')::int AS approved,
                COUNT(*) FILTER (WHERE c.status='COMPLETED')::int AS completed,
                COUNT(*) FILTER (WHERE c.status='REJECTED')::int AS rejected,
                COUNT(*) FILTER (WHERE c.status='CANCELLED')::int AS cancelled,
                COUNT(*) FILTER (WHERE c.status='RESCHEDULED')::int AS rescheduled,
                COALESCE(SUM(c.expected_participants),0)::int AS expected_participants
            FROM conferences c JOIN organizations o ON o.id=c.organization_id
            WHERE ${scope}
              AND ($5::text IS NULL OR c.status=$5::text)
              AND ($6::date IS NULL OR ((COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= $6::date AND (COALESCE(c.proposed_end_time,c.end_time,c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $6::date))
              AND ($7::integer IS NULL OR EXTRACT(MONTH FROM c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::integer=$7::integer)
              AND ($8::integer IS NULL OR EXTRACT(YEAR FROM c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::integer=$8::integer)
              AND ($9::date IS NULL OR (COALESCE(c.proposed_end_time,c.end_time,c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $9::date)
              AND ($10::date IS NULL OR (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $10::date)
              AND (${includeOnlyPlannedStatuses ? "c.status IN ('PENDING','APPROVED','RESCHEDULED')" : "TRUE"})
              AND ($11::text IS NULL OR UPPER(c.code)=$11::text) AND ($12::text IS NULL OR concat_ws(' ',c.title,c.description) ILIKE '%'||$12::text||'%') AND ($13::text IS NULL OR concat_ws(' ',c.location_name,c.location_address) ILIKE '%'||$13::text||'%') AND (cardinality($4::text[])=0 OR EXISTS (SELECT 1 FROM unnest($4::text[]) term
                WHERE concat_ws(' ',c.code,c.title,c.description,c.location_name,c.location_address,o.name) ILIKE '%'||term||'%'))`,
        [...params, terms, requestedStatus, requestedDate, requestedMonth, requestedYear, requestedPeriod?.from || null, requestedPeriod?.to || null, requestedCode, requestedTopic, requestedLocation]),
        (() => {
            return pool.query(`SELECT c.id,c.code,c.title,c.description,c.status,COALESCE(c.proposed_start_time,c.start_time) AS start_time,COALESCE(c.proposed_end_time,c.end_time) AS end_time,c.reschedule_response,
                    c.location_name,c.location_address,c.expected_participants,o.name AS organization_name,
                    attendance.registration_count,attendance.registered_participants
                FROM conferences c JOIN organizations o ON o.id=c.organization_id
                LEFT JOIN LATERAL (SELECT COUNT(*)::int AS registration_count,
                        COALESCE(SUM(r.expected_count),0)::int AS registered_participants
                    FROM conference_attendance_registrations r WHERE r.conference_id=c.id) attendance ON TRUE
                WHERE ${scope}
                  AND ($5::text IS NULL OR c.status=$5::text)
                  AND ($6::date IS NULL OR ((COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= $6::date AND (COALESCE(c.proposed_end_time,c.end_time,c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $6::date))
                  AND ($7::integer IS NULL OR EXTRACT(MONTH FROM c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::integer=$7::integer)
                  AND ($8::integer IS NULL OR EXTRACT(YEAR FROM c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::integer=$8::integer)
                  AND ($9::date IS NULL OR (COALESCE(c.proposed_end_time,c.end_time,c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $9::date)
                  AND ($10::date IS NULL OR (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $10::date)
                  AND (${includeOnlyPlannedStatuses ? "c.status IN ('PENDING','APPROVED','RESCHEDULED')" : "TRUE"})
                  AND ($11::text IS NULL OR UPPER(c.code)=$11::text) AND ($12::text IS NULL OR concat_ws(' ',c.title,c.description) ILIKE '%'||$12::text||'%') AND ($13::text IS NULL OR concat_ws(' ',c.location_name,c.location_address) ILIKE '%'||$13::text||'%') AND (cardinality($4::text[])=0 OR EXISTS (
                    SELECT 1 FROM unnest($4::text[]) term
                    WHERE concat_ws(' ',c.code,c.title,c.description,c.location_name,c.location_address,o.name) ILIKE '%'||term||'%'
                  ))
                ORDER BY CASE WHEN cardinality($4::text[])=0 THEN 0 ELSE (
                    SELECT COUNT(*) FROM unnest($4::text[]) term
                    WHERE concat_ws(' ',c.code,c.title,c.description,c.location_name,c.location_address,o.name) ILIKE '%'||term||'%'
                ) END DESC, CASE WHEN COALESCE(c.proposed_start_time,c.start_time) >= NOW() THEN 0 ELSE 1 END, COALESCE(c.proposed_start_time,c.start_time) DESC
                LIMIT 12`, [...params, terms, requestedStatus, requestedDate, requestedMonth, requestedYear, requestedPeriod?.from || null, requestedPeriod?.to || null, requestedCode, requestedTopic, requestedLocation]);
        })()
    ]);
    const counts = countResult.rows[0] || {};
    const statusText = `Tổng ${counts.total || 0}; chờ duyệt ${counts.pending || 0}; đã phê duyệt ${counts.approved || 0}; hoàn thành ${counts.completed || 0}; từ chối ${counts.rejected || 0}; đã hủy ${counts.cancelled || 0}; dời lịch ${counts.rescheduled || 0}; quy mô dự kiến ${counts.expected_participants || 0} người.`;
    const scopeText = user.role === "ADMIN" ? "toàn hệ thống" : user.role === "COMMUNE"
        ? "hội nghị của đơn vị đăng nhập và hội nghị đã phê duyệt đang mở cho đăng ký tham dự"
        : "các hội nghị được phân công cho tài khoản đăng nhập";
    const statusLabels = { PENDING: "chờ phê duyệt", APPROVED: "đã phê duyệt", COMPLETED: "hoàn thành", REJECTED: "từ chối", CANCELLED: "đã hủy", RESCHEDULED: "đề xuất dời lịch" };    const noMatchFilters = [
        requestedTopic ? `chủ đề “${requestedTopic}”` : null,
        requestedLocation ? `địa điểm “${requestedLocation}”` : null,
        requestedCode ? `mã ${requestedCode}` : null,
        requestedStatus ? `trạng thái ${statusLabels[requestedStatus] || requestedStatus}` : null,
        requestedPeriod ? `thời gian ${requestedPeriod.label}` : null,
        requestedDate ? `ngày ${requestedDate}` : null,
        requestedMonth ? `tháng ${requestedMonth}` : null,
        requestedYear ? `năm ${requestedYear}` : null
    ].filter(Boolean);
    const noMatchText = noMatchFilters.length
        ? `Không tìm thấy hội nghị nào đồng thời đáp ứng ${noMatchFilters.join(", ")} trong phạm vi ${scopeText}.`
        : `Không có hội nghị phù hợp trong phạm vi ${scopeText}.`;
    const asksStatusField = /trạng thái|tình trạng|đang ở trạng thái/i.test(String(question || ""));
    const rows = eventResult.rows.map(row => {
        const start = new Date(row.start_time).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        const end = row.end_time ? new Date(row.end_time).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "";
        const location = [row.location_name, row.location_address].filter(Boolean).join(" – ") || "chưa cập nhật";
        if (requestedLocation) return `- ${row.code}: ${start}${end ? ` đến ${end}` : ""}${asksStatusField ? `; trạng thái ${row.status === "RESCHEDULED" && row.reschedule_response === "PENDING" ? "đề xuất dời lịch, chờ người đăng ký phản hồi" : statusLabels[row.status] || row.status || "chưa có dữ liệu trạng thái"}` : ""}.`;
        const description = String(row.description || "").replace(/\s+/g, " ").slice(0, 240);
        const displayStatus = row.status === "RESCHEDULED" && row.reschedule_response === "PENDING" ? "đề xuất dời lịch, chờ người đăng ký phản hồi" : statusLabels[row.status] || row.status;
        const attendance = ["ADMIN", "COMMUNE"].includes(user.role)
            ? `; ${row.registration_count || 0} đơn vị đã đăng ký tham dự, dự kiến ${row.registered_participants || 0} người`
            : "";
        return `- ${row.code}: ${row.title}; đơn vị tổ chức ${row.organization_name}; trạng thái ${displayStatus}; thời gian ${start}${end ? ` đến ${end}` : ""}; địa điểm ${location}; dự kiến ${row.expected_participants} người${attendance}${description ? `; nội dung ${description}` : ""}.`;
    });
    const asksAnalysis = questionIntent.isConferenceAnalysisQuestion || /du bao|xu huong|thong ke|tong hop|bao cao|so lieu|bieu do|nhu cau to chuc|goi y dia ban|nen to chuc|de xuat dia ban|so sanh|tang giam|hieu qua|nhieu nhat|it nhat|noi bat|thuong xuyen|tan suat/.test(normalizedQuestion);
    let planningSummary = "";
    if (asksAnalysis && !requestedPeriod) {
        const [monthlyResult, organizationResult, topicResult] = await Promise.all([
            pool.query(`SELECT date_trunc('month',c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS month,
                    COUNT(*)::int AS conferences, COALESCE(SUM(c.expected_participants),0)::int AS expected_participants
                FROM conferences c WHERE ${scope} AND c.status IN ('APPROVED','COMPLETED')
                  AND c.start_time >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '12 months') AT TIME ZONE 'Asia/Ho_Chi_Minh'
                  AND c.start_time < date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
                GROUP BY 1 ORDER BY 1`, params),
            pool.query(`SELECT o.name AS label,COUNT(*)::int AS conferences,
                    COALESCE(SUM(c.expected_participants),0)::int AS expected_participants
                FROM conferences c JOIN organizations o ON o.id=c.organization_id
                WHERE ${scope} AND c.status IN ('APPROVED','COMPLETED')
                  AND c.start_time >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '12 months') AT TIME ZONE 'Asia/Ho_Chi_Minh'
                  AND c.start_time < date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
                GROUP BY o.name ORDER BY conferences DESC, expected_participants DESC LIMIT 100`, params),
            pool.query(`SELECT c.title AS label,COUNT(*)::int AS conferences,
                    COALESCE(SUM(c.expected_participants),0)::int AS expected_participants
                FROM conferences c WHERE ${scope} AND c.status IN ('APPROVED','COMPLETED')
                  AND c.start_time >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '12 months') AT TIME ZONE 'Asia/Ho_Chi_Minh'
                  AND c.start_time < date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
                GROUP BY c.title ORDER BY conferences DESC, expected_participants DESC LIMIT 100`, params)
        ]);
        const monthly = monthlyResult.rows.map(row => ({
            month: new Date(row.month).toLocaleDateString("vi-VN", { month: "2-digit", year: "numeric", timeZone: "UTC" }),
            count: Number(row.conferences) || 0,
            participants: Number(row.expected_participants) || 0
        }));
        const now = new Date();
        const monthCounts = [];
        for (let offset = 12; offset >= 1; offset--) {
            const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
            const key = `${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}/${monthDate.getUTCFullYear()}`;
            const record = monthly.find(item => item.month === key);
            monthCounts.push(record?.count || 0);
        }
        const recent3 = monthCounts.slice(-3);
        const previous3 = monthCounts.slice(-6, -3);
        const recentTotal = recent3.reduce((sum, count) => sum + count, 0);
        const previousTotal = previous3.reduce((sum, count) => sum + count, 0);
        const totalHistory = monthCounts.reduce((sum, count) => sum + count, 0);
        const trend = previousTotal > 0
            ? `${((recentTotal - previousTotal) / previousTotal * 100).toFixed(1)}% ${recentTotal >= previousTotal ? "tăng" : "giảm"} so với 3 tháng liền trước`
            : recentTotal > 0 ? `tăng từ 0 lên ${recentTotal} hội nghị; chưa thể tính tỷ lệ phần trăm` : "chưa ghi nhận hội nghị trong 6 tháng gần đây";
        const forecast = totalHistory < 3
            ? "Chưa đủ dữ liệu lịch sử (cần tối thiểu 3 hội nghị trong 12 tháng) để dự báo có ý nghĩa."
            : recentTotal === 0
                ? "Không ghi nhận hội nghị trong 3 tháng gần nhất nên chưa đưa ra dự báo cho quý tới."
                : `Ước tính tham khảo quý tới: khoảng ${Math.round(recentTotal)} hội nghị (ngoại suy mức trung bình 3 tháng gần đây; không phải cam kết).`;
        const organizationsByCount = organizationResult.rows;
        const topicsByCount = topicResult.rows;
        const organizations = organizationsByCount.slice(0, 3).map(row => `${row.label}: ${row.conferences} hội nghị, dự kiến ${row.expected_participants} người`).join("; ") || "chưa có dữ liệu";
        const lowOrganizations = [...organizationsByCount].sort((a, b) => a.conferences - b.conferences).slice(0, 3)
            .map(row => `${row.label}: ${row.conferences} hội nghị`).join("; ") || "chưa có dữ liệu";
        const topics = topicsByCount.slice(0, 3).map(row => `${row.label}: ${row.conferences} hội nghị`).join("; ") || "chưa có dữ liệu";
        const lowTopics = [...topicsByCount].sort((a, b) => a.conferences - b.conferences).slice(0, 3)
            .map(row => `${row.label}: ${row.conferences} hội nghị`).join("; ") || "chưa có dữ liệu";
        const monthSummary = monthCounts.map((count, index) => {
            const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (12 - index), 1));
            return `${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}/${monthDate.getUTCFullYear()}: ${count}`;
        }).join("; ");
        planningSummary = `\nPHÂN TÍCH KẾ HOẠCH TỪ DỮ LIỆU WEBSITE (12 tháng đầy đủ gần nhất; chỉ hội nghị đã duyệt/hoàn thành): Theo tháng: ${monthSummary}. Biến động 3 tháng gần nhất: ${trend}. ${forecast} Đơn vị ghi nhận nhiều hội nghị: ${organizations}. Đơn vị ghi nhận ít nhất trong nhóm có dữ liệu: ${lowOrganizations}. Chủ đề thường tổ chức: ${topics}. Chủ đề ít ghi nhận: ${lowTopics}. Đây là tần suất ghi nhận, không khẳng định nhu cầu thực tế. Số người là quy mô dự kiến, không phải số thực tế tham dự. Nhận định không khẳng định hội nghị là nguyên nhân duy nhất của xu hướng.`;
    }
    if (asksAnalysis && requestedPeriod) {
        const periodParams = [user.role, user.organization_id || null, user.id, requestedPeriod.from, requestedPeriod.to];
        const multiYear = Number(requestedPeriod.to.slice(0, 4)) - Number(requestedPeriod.from.slice(0, 4)) > 1;
        const bucket = multiYear ? "year" : "month";
        const [periodBuckets, periodOrganizations, periodTopics] = await Promise.all([
            pool.query(`SELECT date_trunc('${bucket}',c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS period,
                    COUNT(*)::int AS conferences,COALESCE(SUM(c.expected_participants),0)::int AS expected
                FROM conferences c WHERE ${scope}
                  AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date
                  AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date
                GROUP BY 1 ORDER BY 1`, periodParams),
            pool.query(`SELECT o.name AS label,COUNT(*)::int AS conferences,
                    COALESCE(SUM(c.expected_participants),0)::int AS expected
                FROM conferences c JOIN organizations o ON o.id=c.organization_id
                WHERE ${scope}
                  AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date
                  AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date
                GROUP BY o.name ORDER BY conferences DESC,o.name LIMIT 5`, periodParams),
            pool.query(`SELECT c.title AS label,COUNT(*)::int AS conferences
                FROM conferences c WHERE ${scope}
                  AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date
                  AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date
                GROUP BY c.title ORDER BY conferences DESC,c.title LIMIT 5`, periodParams)
        ]);
        const periods = periodBuckets.rows.map(row => {
            const date = new Date(row.period);
            const label = multiYear ? date.getUTCFullYear() : date.toLocaleDateString("vi-VN", { month: "2-digit", year: "numeric", timeZone: "UTC" });
            return `${label}: ${row.conferences} hội nghị, dự kiến ${row.expected} người`;
        }).join("; ") || "không ghi nhận hội nghị";
        const organizations = periodOrganizations.rows.map(row => `${row.label}: ${row.conferences} hội nghị, dự kiến ${row.expected} người`).join("; ") || "chưa có dữ liệu";
        const topics = periodTopics.rows.map(row => `${row.label}: ${row.conferences}`).join("; ") || "chưa có dữ liệu";
        planningSummary = `\nTỔNG HỢP ĐÚNG KỲ ${requestedPeriod.label}: Theo ${multiYear ? "năm" : "tháng"}: ${periods}. Đơn vị ghi nhận: ${organizations}. Chủ đề ghi nhận: ${topics}. Các con số người tham dự là quy mô dự kiến; tần suất không tự chứng minh nhu cầu thực tế.`;
    }
    const context = [
        `DỮ LIỆU HỘI NGHỊ ĐƯỢC PHÉP TRA CỨU (${scopeText}).`,
        requestedPeriod ? `Kỳ báo cáo đã lọc: ${requestedPeriod.label} (${requestedPeriod.from} đến trước ${requestedPeriod.to}).` : "Kỳ báo cáo: toàn bộ thời gian, trừ khi câu hỏi có bộ lọc khác.",
        requestedLocation ? "Kết quả chỉ gồm hội nghị khớp bộ lọc địa điểm." : `Tổng hợp trạng thái trong phạm vi: ${statusText}`,
        planningSummary,
        rows.length ? `Các kết quả phù hợp (tối đa 12):\n${rows.join("\n")}` : (requestedCode ? `Không tìm thấy hội nghị mã ${requestedCode} trong phạm vi tài khoản được phép xem.` : terms.length ? "Không tìm thấy hội nghị khớp từ khóa trong phạm vi được phép." : noMatchText),
        "Chỉ được trả lời theo các dữ liệu này; không suy đoán hồ sơ, người tham dự, tài liệu hoặc thông tin không xuất hiện ở đây. Nếu thiếu trường cần hỏi, hãy nói rõ dữ liệu chưa có."
    ].join("\n");
    const reviewPeriod = requestedPeriod ? ` trong kỳ ${requestedPeriod.label}` : "";
    const fallbackText = questionIntent.isConferenceReviewQuestion
        ? rows.length
            ? `Các hội nghị dự kiến tổ chức${reviewPeriod} (gồm cả hồ sơ chờ phê duyệt; tối đa 12):\n${rows.join("\n")}${Number(counts.total) > rows.length ? `\nCòn ${Number(counts.total) - rows.length} hội nghị.` : ""}`
            : `Không có hội nghị còn hiệu lực dự kiến tổ chức${reviewPeriod} trong phạm vi tài khoản được phép xem.`
        : asksAnalysis && planningSummary
        ? [planningSummary.trim(), rows.length ? `\nHội nghị phù hợp:\n${rows.join("\n")}` : ""].join("")
        : requestedLocation
        ? (rows.length ? `Hội nghị tại địa điểm “${requestedLocation}”:\n${rows.join("\n")}` : noMatchText)
        : [
        `Dữ liệu website trong phạm vi của bạn: ${statusText}`,
        rows.length ? `Hội nghị phù hợp:\n${rows.join("\n")}` : (requestedCode ? `Không tìm thấy hội nghị mã ${requestedCode} trong phạm vi tài khoản được phép xem.` : terms.length ? "Không tìm thấy hội nghị khớp từ khóa trong phạm vi được phép." : noMatchText)
    ].join("\n");
    const fallback = trimAtLineBoundary(fallbackText, 2200);
    return { context, fallback };
}

async function loadCompletedOrganizationRanking(user) {
    const result = await pool.query(`SELECT o.name AS organization_name, COUNT(*)::int AS completed_count
        FROM conferences c JOIN organizations o ON o.id=c.organization_id
        WHERE c.status='COMPLETED'
          AND ($1::text='ADMIN'
            OR ($1::text='COMMUNE' AND c.organization_id=$2::uuid)
            OR ($1::text='TASK_ASSIGNEE' AND EXISTS (
                SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid
            ))
            OR ($1::text='SPEAKER' AND EXISTS (
                SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid
            )))
        GROUP BY o.id,o.name
        ORDER BY completed_count DESC,o.name ASC
        LIMIT 10`, [user.role, user.organization_id || null, user.id]);
    if (!result.rows.length) {
        const scope = user.role === "ADMIN" ? "toàn hệ thống" : "phạm vi dữ liệu tài khoản được phép xem";
        return `Chưa ghi nhận hội nghị nào ở trạng thái hoàn thành trong ${scope}.`;
    }
    const topCount = Number(result.rows[0].completed_count) || 0;
    const leaders = result.rows.filter(row => Number(row.completed_count) === topCount);
    const names = leaders.map(row => row.organization_name).join(", ");
    return `Trong phạm vi dữ liệu được phép xem, ${leaders.length > 1 ? "các đơn vị hoàn thành nhiều hội nghị nhất là" : "đơn vị hoàn thành nhiều hội nghị nhất là"} ${names} (${topCount} hội nghị).`;
}

async function loadConferenceTopicFrequency(user, question) {
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (
            ($2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
            OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time >= NOW())
        ))
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const period = parseReportPeriod(question);
    const result = await pool.query(`SELECT MIN(BTRIM(COALESCE(NULLIF(c.description,''),c.title))) AS topic,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE c.status='PENDING')::int AS pending,
            COUNT(*) FILTER (WHERE c.status='APPROVED')::int AS approved,
            COUNT(*) FILTER (WHERE c.status='COMPLETED')::int AS completed,
            COUNT(*) FILTER (WHERE c.status='RESCHEDULED')::int AS rescheduled
        FROM conferences c
        WHERE ${scope}
          AND c.status IN ('PENDING','APPROVED','COMPLETED','RESCHEDULED')
          AND NULLIF(BTRIM(COALESCE(NULLIF(c.description,''),c.title)),'') IS NOT NULL
          AND ($4::date IS NULL OR (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date)
          AND ($5::date IS NULL OR (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date)
        GROUP BY LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(c.description,''),c.title)),'\s+',' ','g'))
        ORDER BY total DESC,topic ASC
        LIMIT 5`, [user.role,user.organization_id || null,user.id,period?.from || null,period?.to || null]);
    if (!result.rows.length) {
        return `Chưa có nội dung hội nghị được đề xuất trong phạm vi tài khoản${period ? ` kỳ ${period.label}` : ""}.`;
    }
    const label = period ? ` trong kỳ ${period.label}` : "";
    const rows = result.rows.map((row, index) =>
        `${index + 1}. ${String(row.topic).replace(/\s+/g, " ").slice(0, 180)} — ${row.total} lượt (chờ duyệt ${row.pending}, đã duyệt ${row.approved}, hoàn thành ${row.completed}, dời lịch ${row.rescheduled}).`
    );
    return `Nội dung hội nghị được đề xuất nhiều nhất${label}, trong phạm vi tài khoản (tối đa 5):\n${rows.join("\n")}\nĐã tính hồ sơ chờ duyệt, đã duyệt, hoàn thành và đề xuất dời lịch; không tính hồ sơ từ chối hoặc đã hủy.`;
}

async function loadOrganizationConferenceSummary(user, question) {
    const normalized = normalize(question);
    const organizations = await pool.query("SELECT id,name FROM organizations");
    const exactMention = organizations.rows
        .filter(row => normalized.includes(normalize(row.name)) || normalized.includes(normalize(row.name.replace(/^UBND\s+/i, ""))))
        .sort((left, right) => normalize(right.name).length - normalize(left.name).length)[0];
    const match = normalized.match(/\b(?:xa|phuong|don vi)\s+(.+?)(?=\s+(?:hien|co|bao nhieu|dang ky|hoi nghi|ket qua|tong hop|thong ke|bao cao|theo|trong|tren|thi|nay|nao|dang o|trang thai|phe duyet)\b|[,.!?;]|$)/i);
    const requestedName = exactMention ? normalize(exactMention.name) : match?.[1]?.trim();
    if (!requestedName) return "Tôi chưa nhận diện được tên xã/phường cần tổng hợp. Vui lòng ghi rõ, ví dụ: xã Lộc Tấn.";
    const organization = exactMention || organizations.rows
        .filter(row => normalize(row.name).includes(requestedName))
        .sort((left, right) => normalize(right.name).length - normalize(left.name).length)[0];
    if (!organization) return `Không tìm thấy đơn vị “${requestedName}” trong danh mục đơn vị của hệ thống.`;

    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (
            ($2::uuid IS NOT NULL AND c.organization_id=$2::uuid)
            OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time >= NOW())
        ))
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const params = [user.role, user.organization_id || null, user.id, organization.id];
    const normalizedQuestion = normalize(question);
    const asksOnlyStatus = /(?:trang thai|tinh trang)/.test(normalizedQuestion) && !/(?:tong hop|bao cao|phan tich|thong ke|xu huong|du bao)/.test(normalizedQuestion);
    const asksStatusPerConference = asksOnlyStatus && /(?:ma hoi nghi|tung ma|tung hoi nghi|moi hoi nghi|liet ke|danh sach|neu tung)/.test(normalizedQuestion);
    const [summary, conferences] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE c.status='PENDING')::int AS pending,
                COUNT(*) FILTER (WHERE c.status='APPROVED')::int AS approved,
                COUNT(*) FILTER (WHERE c.status='COMPLETED')::int AS completed,
                COUNT(*) FILTER (WHERE c.status='REJECTED')::int AS rejected,
                COUNT(*) FILTER (WHERE c.status='CANCELLED')::int AS cancelled,
                COUNT(*) FILTER (WHERE c.status='RESCHEDULED')::int AS rescheduled,
                COALESCE(SUM(c.expected_participants),0)::int AS expected_participants,
                COALESCE(SUM(unit_registrations.units),0)::int AS registered_units,
                COALESCE(SUM(unit_registrations.people),0)::int AS registered_people,
                COALESCE(SUM(public_registrations.people),0)::int AS public_signups,
                COALESCE(SUM(public_registrations.checked_in),0)::int AS public_attended
            FROM conferences c
            LEFT JOIN LATERAL (SELECT COUNT(*)::int AS units,COALESCE(SUM(r.expected_count),0)::int AS people
                FROM conference_attendance_registrations r WHERE r.conference_id=c.id) unit_registrations ON TRUE
            LEFT JOIN LATERAL (SELECT COUNT(*)::int AS people,COUNT(*) FILTER (WHERE r.attended_at IS NOT NULL)::int AS checked_in
                FROM public_attendance_registrations r WHERE r.conference_id=c.id) public_registrations ON TRUE
            WHERE ${scope} AND c.organization_id=$4::uuid`, params),
        pool.query(`SELECT c.code,c.title,c.status,c.start_time,c.expected_participants,c.location_name,c.location_address,
                unit_registrations.units,unit_registrations.people,public_registrations.people AS public_signups,
                public_registrations.checked_in AS public_attended
            FROM conferences c
            LEFT JOIN LATERAL (SELECT COUNT(*)::int AS units,COALESCE(SUM(r.expected_count),0)::int AS people
                FROM conference_attendance_registrations r WHERE r.conference_id=c.id) unit_registrations ON TRUE
            LEFT JOIN LATERAL (SELECT COUNT(*)::int AS people,COUNT(*) FILTER (WHERE r.attended_at IS NOT NULL)::int AS checked_in
                FROM public_attendance_registrations r WHERE r.conference_id=c.id) public_registrations ON TRUE
            WHERE ${scope} AND c.organization_id=$4::uuid
            ORDER BY c.start_time DESC LIMIT CASE WHEN $5::boolean THEN 500 ELSE 8 END`, [...params, asksStatusPerConference])
    ]);
    const totals = summary.rows[0] || {};
    if (asksOnlyStatus && Number(totals.total) && !asksStatusPerConference) return `Tình trạng hội nghị của ${organization.name}: tổng ${totals.total}; chờ phê duyệt ${totals.pending}, đã phê duyệt ${totals.approved}, hoàn thành ${totals.completed}, từ chối ${totals.rejected}, đã hủy ${totals.cancelled}, đề xuất dời lịch ${totals.rescheduled}.`;
    if (!Number(totals.total)) return `Không tìm thấy hội nghị do ${organization.name} đăng ký trong phạm vi tài khoản được phép xem.`;
    const labels = { PENDING: "chờ phê duyệt", APPROVED: "đã phê duyệt", COMPLETED: "hoàn thành", REJECTED: "từ chối", CANCELLED: "đã hủy", RESCHEDULED: "đề xuất dời lịch" };
    if (asksStatusPerConference) {
        return formatConferenceStatusList(conferences.rows, organization.name, totals.total);
    }
    const lines = conferences.rows.map(row => {
        const date = new Date(row.start_time).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        const location = [row.location_name, row.location_address].filter(Boolean).join(", ");
        return `• ${row.code} ${String(row.title || "").slice(0, 100)} — ${labels[row.status] || row.status}; ${date}${location ? `; ${location}` : ""}; dự kiến ${row.expected_participants || 0} người; đăng ký dự: ${row.units || 0} đơn vị/${row.people || 0} người; người dân: ${row.public_signups || 0} đăng ký, ${row.public_attended || 0} đã điểm danh.`;
    });
    const more = Number(totals.total) > lines.length ? `\nCòn ${Number(totals.total) - lines.length} hội nghị khác.` : "";
    const answer = [
        `Kết quả đăng ký hội nghị của ${organization.name}: ${totals.total} hội nghị; chờ duyệt ${totals.pending}, đã duyệt ${totals.approved}, hoàn thành ${totals.completed}, từ chối ${totals.rejected}, đã hủy ${totals.cancelled}, đề xuất dời lịch ${totals.rescheduled}.`,
        `Quy mô dự kiến ${totals.expected_participants} người; đăng ký từ đơn vị: ${totals.registered_units} lượt, ${totals.registered_people} người; người dân: ${totals.public_signups} đăng ký, ${totals.public_attended} đã điểm danh.`,
        "Danh sách hội nghị:", ...lines
    ].join("\n") + more;
    return trimAtLineBoundary(answer, 2000);
}

async function loadPlannedConferenceStatusList(user, period, question = "") {
    if (!user?.id || !["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"].includes(user.role)) {
        return "Không có hội nghị phù hợp trong phạm vi tài khoản được phép xem.";
    }
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (($2::uuid IS NOT NULL AND c.organization_id=$2::uuid) OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time>=NOW())) )
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const result = await pool.query(`SELECT c.code,c.title,o.name AS organization_name,c.status,c.reschedule_response,
            COALESCE(CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time END,c.start_time) AS effective_start,
            COALESCE(CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_end_time END,c.end_time,c.start_time) AS effective_end
        FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id WHERE ${scope}
          AND c.status IN ('PENDING','APPROVED','RESCHEDULED')
          AND (COALESCE(CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time END,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date
          AND (COALESCE(CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_end_time END,c.end_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date
        ORDER BY effective_start,c.code`, [user.role,user.organization_id || null,user.id,period.from,period.to]);
    if (!result.rowCount) return `Không có hội nghị dự kiến tổ chức trong kỳ ${period.label} trong phạm vi dữ liệu tài khoản được phép xem.`;
    const labels = { PENDING:"chờ phê duyệt", APPROVED:"đã phê duyệt", RESCHEDULED:"đề xuất dời lịch" };
    const normalizedQuestion = normalize(question);
    const includeOrganization = /(?:don vi|xa|phuong)/.test(normalizedQuestion);
    const includeDate = /(?:ngay to chuc|ngay dien ra|ngay nao|thoi gian)/.test(normalizedQuestion);
    const lines = result.rows.map(row => {
        const status = row.status === "RESCHEDULED" && row.reschedule_response === "PENDING"
            ? "đề xuất dời lịch, chờ người đăng ký phản hồi"
            : row.status === "RESCHEDULED" && row.reschedule_response === "ACCEPTED"
                ? "đề xuất dời lịch đã được chấp thuận"
                : labels[row.status] || row.status;
        const organization = includeOrganization ? `; đơn vị ${row.organization_name || "chưa ghi nhận"}` : "";
        const date = includeDate ? `; ngày ${formatAiDate(row.effective_start)}` : "";
        return `• ${row.code}${organization}${date}; ${status}.`;
    });
    return `Hội nghị dự kiến tổ chức trong kỳ ${period.label} (${lines.length}; gồm hồ sơ chưa phê duyệt và đề xuất dời lịch):\n${lines.join("\n")}`;
}

async function loadConferenceAttendanceSummary(user, period, completedOnly = false) {
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND (($2::uuid IS NOT NULL AND c.organization_id=$2::uuid) OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time>=NOW())) )
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const result = await pool.query(`WITH scoped_conferences AS (
            SELECT c.id,COALESCE(c.expected_participants,0)::bigint AS expected_participants
            FROM conferences c
            WHERE ${scope} AND c.status NOT IN ('REJECTED','CANCELLED') AND ($6::boolean=FALSE OR c.status='COMPLETED')
              AND c.start_time >= ($4::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
              AND c.start_time < ($5::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ), participant_groups AS (
            SELECT g.conference_id,COUNT(*)::int AS group_count,COALESCE(SUM(g.actual_count),0)::bigint AS actual_people
            FROM conference_participant_groups g JOIN scoped_conferences c ON c.id=g.conference_id
            GROUP BY g.conference_id
        ), unit_registrations AS (
            SELECT r.conference_id,COUNT(*)::int AS registrations,COALESCE(SUM(r.expected_count),0)::bigint AS people
            FROM conference_attendance_registrations r JOIN scoped_conferences c ON c.id=r.conference_id
            GROUP BY r.conference_id
        ), public_registrations AS (
            SELECT r.conference_id,COUNT(*)::bigint AS people,COUNT(*) FILTER (WHERE r.attended_at IS NOT NULL)::bigint AS checked_in
            FROM public_attendance_registrations r JOIN scoped_conferences c ON c.id=r.conference_id
            GROUP BY r.conference_id
        )
        SELECT COUNT(*)::int AS conferences,
            COALESCE(SUM(c.expected_participants),0)::int AS expected_people,
            COALESCE(SUM(groups.actual_people),0)::int AS reported_actual_people,
            COUNT(*) FILTER (WHERE groups.conference_id IS NOT NULL)::int AS conferences_with_attendance_record,
            COALESCE(SUM(units.registrations),0)::int AS unit_registration_count,
            COALESCE(SUM(units.people),0)::int AS unit_registered_people,
            COALESCE(SUM(public.people),0)::int AS public_registered_people,
            COALESCE(SUM(public.checked_in),0)::int AS public_checked_in
        FROM scoped_conferences c
        LEFT JOIN participant_groups groups ON groups.conference_id=c.id
        LEFT JOIN unit_registrations units ON units.conference_id=c.id
        LEFT JOIN public_registrations public ON public.conference_id=c.id`,
        [user.role,user.organization_id || null,user.id,period.from,period.to,completedOnly]);
    const row = result.rows[0] || {};
    const conferences = Number(row.conferences) || 0;
    if (!conferences) return completedOnly ? `Không có hội nghị đã hoàn thành trong kỳ ${period.label} trong phạm vi dữ liệu tài khoản được phép xem.` : `Không có hội nghị trong kỳ ${period.label} trong phạm vi dữ liệu tài khoản được phép xem.`;
    const participantListActual = Number(row.conferences_with_attendance_record) > 0
        ? `${Number(row.reported_actual_people) || 0} người ở ${Number(row.conferences_with_attendance_record)} hội nghị`
        : `chưa có báo cáo điểm danh trong danh sách thành phần của ${conferences} hội nghị`;
    return `${completedOnly ? `Tổng hợp các hội nghị đã hoàn thành trong ${period.label}` : `Tổng hợp ${period.label}`}: ${conferences} hội nghị, quy mô dự kiến ${Number(row.expected_people)||0} người. Số thực tế báo cáo theo danh sách thành phần: ${participantListActual} (chưa thể xác nhận là người duy nhất). Đơn vị: ${Number(row.unit_registration_count)||0} lượt đăng ký, khai báo quy mô ${Number(row.unit_registered_people)||0} người. Người dân: ${Number(row.public_registered_people)||0} lượt đăng ký, ${Number(row.public_checked_in)||0} lượt đã điểm danh. Không cộng các nhóm thành tổng người duy nhất vì dữ liệu không có mã định danh chung.`;}
async function loadCompletedConferenceOutcomeSummary(user, period) {
    const scope = `(
        $1::text='ADMIN'
        OR ($1::text='COMMUNE' AND ($2::uuid IS NOT NULL AND c.organization_id=$2::uuid))
        OR ($1::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$3::uuid))
        OR ($1::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$3::uuid))
    )`;
    const result = await pool.query(`SELECT c.code,c.title,o.name AS organization_name,c.start_time,
            COALESCE(c.expected_participants,0)::int AS expected_participants,
            COALESCE(reg.registered_units,0)::int AS registered_units,
            COALESCE(reg.registered_people,0)::int AS registered_people,
            COALESCE(att.public_signups,0)::int AS public_signups,
            COALESCE(att.checked_in,0)::int AS checked_in,
            survey.quality_avg,survey.quality_count,survey.coordination_avg,survey.coordination_count
        FROM conferences c
        LEFT JOIN organizations o ON o.id=c.organization_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS registered_units,COALESCE(SUM(r.expected_count),0)::int AS registered_people
            FROM conference_attendance_registrations r WHERE r.conference_id=c.id
        ) reg ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS public_signups,COUNT(*) FILTER (WHERE r.attended_at IS NOT NULL)::int AS checked_in
            FROM public_attendance_registrations r WHERE r.conference_id=c.id
        ) att ON TRUE
        LEFT JOIN LATERAL (
            SELECT ROUND(AVG(s.quality_rating)::numeric,1) AS quality_avg,COUNT(s.quality_rating)::int AS quality_count,
                ROUND(AVG(s.coordination_rating)::numeric,1) AS coordination_avg,COUNT(s.coordination_rating)::int AS coordination_count
            FROM conference_need_surveys s WHERE s.conference_id=c.id AND s.survey_stage='AFTER_EVENT'
        ) survey ON TRUE
        WHERE ${scope} AND c.status='COMPLETED'
          AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $4::date
          AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $5::date
        ORDER BY c.start_time LIMIT 30`, [user.role,user.organization_id || null,user.id,period.from,period.to]);
    if (!result.rows.length) return `Không có hội nghị đã hoàn thành trong ${period.label} thuộc phạm vi dữ liệu tài khoản này.`;
    const lines = result.rows.map(row => {
        const date = new Date(row.start_time).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        const registeredResidents = Number(row.public_signups);
        const rate = registeredResidents > 0 ? `${Math.round(Number(row.checked_in) / registeredResidents * 100)}%` : "chưa tính được vì chưa có đăng ký người dân";
        const quality = Number(row.quality_count) ? `${row.quality_avg}/5 (${row.quality_count} phiếu)` : "chưa có phiếu đánh giá";
        const coordination = Number(row.coordination_count) ? `${row.coordination_avg}/5 (${row.coordination_count} phiếu)` : "chưa có phiếu đánh giá";
        return `• ${row.code} ${String(row.title || "").slice(0,90)} (${date}): đơn vị đăng ký ${row.registered_units} lượt/${row.registered_people} người; người dân đăng ký ${registeredResidents}, đã điểm danh ${row.checked_in} (${rate}); quy mô dự kiến ${row.expected_participants}; chất lượng ${quality}; phối hợp ${coordination}.`;
    });
    return `Hội nghị hoàn thành trong ${period.label} (${result.rows.length}):\n${lines.join("\n")}\nTỷ lệ điểm danh tính trên số người dân đăng ký. Hệ thống chưa ghi nhận số điểm danh theo từng đơn vị; không gộp dữ liệu đó vào tỷ lệ.`;
}

function trimAtLineBoundary(text, limit = 2200) {
    if (text.length <= limit) return text;
    const prefix = text.slice(0, limit);
    const lineBoundary = prefix.lastIndexOf("\n");
    const sentenceBoundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf(".\n"));
    const cut = lineBoundary > limit * 0.55 ? lineBoundary : sentenceBoundary > limit * 0.55 ? sentenceBoundary + 1 : prefix.lastIndexOf(" ");
    return `${prefix.slice(0, cut > 0 ? cut : limit).trimEnd()}\n… Danh sách đã được rút gọn để tránh cắt giữa nội dung.`;
}

async function loadSurveyRows(user, question) {
    if (user?.role !== "ADMIN" && user?.role !== "COMMUNE") {
        return "Phiếu khảo sát chỉ hiển thị cho admin hoặc tài khoản xã/phường của chính đơn vị đó.";
    }
    if (user.role === "COMMUNE" && !user.organization_id) {
        return "Tài khoản chưa được gắn với đơn vị nên chưa thể xác định phiếu khảo sát. Vui lòng liên hệ admin.";
    }
    const normalizedQuestion = normalize(question);
    const orgMatch = normalizedQuestion.match(/(?:phuong|xa|don vi)\s+(.+?)(?=\s+(?:trong|tren|duoc|da|ma|nay|va)\b|[,.!?]|$)/i);
    const organizationTerm = orgMatch?.[1]?.trim().slice(0, 120) || "";
    const organizations = user.role === "COMMUNE"
        ? await pool.query("SELECT id,name FROM organizations WHERE id=$1", [user.organization_id])
        : await pool.query("SELECT id,name FROM organizations");
    const targetOrganization = organizationTerm
        ? organizations.rows
            .filter(row => normalize(row.name).includes(organizationTerm))
            .sort((a, b) => normalize(b.name).length - normalize(a.name).length)[0]
        : null;
    if (organizationTerm && !targetOrganization) {
        return `Không tìm thấy phiếu khảo sát của “${organizationTerm}” trong phạm vi dữ liệu tài khoản được phép xem.`;
    }
    const params = [];
    const filters = [];
    if (targetOrganization) {
        params.push(targetOrganization.id);
        filters.push(`s.organization_id=$${params.length}::uuid`);
    } else if (user.role === "COMMUNE") {
        params.push(user.organization_id);
        filters.push(`s.organization_id=$${params.length}::uuid`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(`SELECT s.id,s.created_at,s.survey_stage,s.legal_aid_need,s.conference_need,
            s.training_need,s.suggested_area,s.target_audience,s.expected_participants,s.topics,s.questions,
            s.quality_rating,s.coordination_rating,s.coordination_agencies,s.comments,
            o.name AS organization_name,c.title AS conference_title
        FROM conference_need_surveys s JOIN organizations o ON o.id=s.organization_id
        LEFT JOIN conferences c ON c.id=s.conference_id
        ${where} ORDER BY s.created_at DESC LIMIT 10`, params);
    if (!result.rows.length) {
        return targetOrganization
            ? `Không tìm thấy phiếu khảo sát của “${organizationTerm}” trong phạm vi dữ liệu tài khoản được phép xem.`
            : "Chưa có phiếu khảo sát trong phạm vi dữ liệu tài khoản được phép xem.";
    }
    const compact = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const rows = result.rows.map((row, index) => {
        const date = new Date(row.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        const stage = row.survey_stage === "AFTER_EVENT" ? "Đánh giá sau hội nghị" : "Nhu cầu trước hội nghị";
        const topics = compact(row.topics);
        const area = compact(row.suggested_area);
        const audience = compact(row.target_audience);
        const questions = compact(row.questions);
        return `${index + 1}. ${row.organization_name} · ${date} · ${stage}${row.conference_title ? ` · Hội nghị: ${compact(row.conference_title)}` : ""}${area ? ` · Địa bàn: ${area}` : ""}${topics ? ` · Nội dung: ${topics}` : ""}${audience ? ` · Đối tượng: ${audience}` : ""}${row.expected_participants != null ? ` · Quy mô dự kiến: ${row.expected_participants}` : ""}${row.conference_need ? " · Có nhu cầu tổ chức hội nghị" : ""}${row.legal_aid_need ? ` · Nhu cầu TGPL: ${compact(row.legal_aid_need)}` : ""}${row.training_need ? ` · Tập huấn: ${compact(row.training_need)}` : ""}${questions ? ` · Vướng mắc: ${questions}` : ""}${row.quality_rating != null ? ` · Chất lượng: ${row.quality_rating}/5` : ""}${row.coordination_rating != null ? ` · Phối hợp: ${row.coordination_rating}/5` : ""}`;
    });
    return `Tìm thấy ${result.rows.length} phiếu khảo sát${organizationTerm ? ` của “${organizationTerm}”` : " mới nhất"} trong phạm vi tài khoản được phép xem (tối đa 10 phiếu):\n${rows.join("\n")}`;
}

async function loadSurveySummary(user, question) {
    if (user?.role !== "ADMIN" && user?.role !== "COMMUNE") {
        return "Phiếu khảo sát chỉ được tổng hợp cho admin hoặc người đăng ký của đơn vị; tài khoản hiện tại không có quyền xem báo cáo khảo sát.";
    }
    if (user.role === "COMMUNE" && !user.organization_id) {
        return "Tài khoản chưa được gắn với đơn vị nên chưa thể xác định phiếu khảo sát trong phạm vi được phép. Vui lòng liên hệ admin.";
    }
    const requestedPeriod = parseReportPeriod(question);
    const fromDate = requestedPeriod?.from || null;
    const toDateExclusive = requestedPeriod?.to || null;
    const params = [];
    const filters = [];
    if (user.role === "COMMUNE") {
        params.push(user.organization_id);
        filters.push(`s.organization_id=$${params.length}::uuid`);
    }
    if (fromDate) {
        params.push(fromDate);
        filters.push(`s.created_at >= $${params.length}::date`);
        params.push(toDateExclusive);
        filters.push(`s.created_at < $${params.length}::date`);
    }
    const where = filters.length ? filters.join(" AND ") : "TRUE";
    const [summaryResult, areasResult, topicsResult, audiencesResult, organizationsResult, issuesResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE survey_stage='NEED')::int AS need_stage,
                COUNT(*) FILTER (WHERE survey_stage='AFTER_EVENT')::int AS after_stage,
                COUNT(DISTINCT organization_id)::int AS organizations,
                COUNT(DISTINCT user_id)::int AS respondents,
                COUNT(*) FILTER (WHERE conference_need=TRUE)::int AS conference_need,
                COUNT(*) FILTER (WHERE NULLIF(TRIM(legal_aid_need),'') IS NOT NULL)::int AS legal_aid_need,
                COUNT(*) FILTER (WHERE NULLIF(TRIM(training_need),'') IS NOT NULL)::int AS training_need,
                ROUND(AVG(quality_rating)::numeric,1) AS quality_average,
                COUNT(quality_rating)::int AS quality_count,
                ROUND(AVG(coordination_rating)::numeric,1) AS coordination_average,
                COUNT(coordination_rating)::int AS coordination_count
            FROM conference_need_surveys s WHERE ${where}`, params),
        pool.query(`SELECT NULLIF(TRIM(s.suggested_area),'') AS label,COUNT(*)::int AS responses
            FROM conference_need_surveys s WHERE ${where} AND NULLIF(TRIM(s.suggested_area),'') IS NOT NULL
            GROUP BY NULLIF(TRIM(s.suggested_area),'') ORDER BY responses DESC,label LIMIT 5`, params),
        pool.query(`WITH topic_counts AS (
                SELECT MIN(TRIM(split.topic)) AS label,COUNT(DISTINCT s.id)::int AS responses
                FROM conference_need_surveys s
                CROSS JOIN LATERAL regexp_split_to_table(CONCAT_WS(',',NULLIF(s.topics,''),NULLIF(s.training_need,'')), E'[,;\\n]+') AS split(topic)
                WHERE ${where} AND TRIM(split.topic)<>''
                GROUP BY LOWER(REGEXP_REPLACE(TRIM(split.topic), '\\s+', ' ', 'g'))
            ), ranked_topics AS (
                SELECT label,responses,RANK() OVER (ORDER BY responses DESC) AS position FROM topic_counts
            )
            SELECT label,responses,position FROM ranked_topics WHERE position<=5 ORDER BY position,label`, params),
        pool.query(`SELECT NULLIF(TRIM(s.target_audience),'') AS label,COUNT(*)::int AS responses
            FROM conference_need_surveys s WHERE ${where} AND NULLIF(TRIM(s.target_audience),'') IS NOT NULL
            GROUP BY NULLIF(TRIM(s.target_audience),'') ORDER BY responses DESC,label LIMIT 5`, params),
        pool.query(`SELECT o.name AS label,COUNT(*)::int AS responses
            FROM conference_need_surveys s JOIN organizations o ON o.id=s.organization_id WHERE ${where}
            GROUP BY o.name ORDER BY responses DESC,label LIMIT 5`, params),
        pool.query(`SELECT MIN(TRIM(issue.text)) AS label,COUNT(*)::int AS responses
            FROM conference_need_surveys s
            CROSS JOIN LATERAL regexp_split_to_table(CONCAT_WS(E'\\n',NULLIF(s.questions,''),NULLIF(s.legal_aid_need,'')), E'[;\\n]+') AS issue(text)
            WHERE ${where} AND NULLIF(TRIM(issue.text),'') IS NOT NULL
            GROUP BY LOWER(TRIM(issue.text)) ORDER BY responses DESC,label LIMIT 10`, params)
    ]);
    const stats = summaryResult.rows[0] || {};
    const total = Number(stats.total) || 0;
    if (!total) {
        const period = requestedPeriod ? ` trong kỳ ${requestedPeriod.label}` : "";
        return `Chưa có phiếu khảo sát${period} trong phạm vi dữ liệu tài khoản được phép xem.`;
    }
    const normalizedQuestion = normalize(question);
    const asksTopSuggestedArea = /dia ban/.test(normalizedQuestion) && /(nhieu nhat|cao nhat|duoc de xuat|uu tien)/.test(normalizedQuestion);
    const asksTopSurveyTopic = /(?:chu de|noi dung)/.test(normalizedQuestion) && /(?:quan tam|nhieu nhat|cao nhat|duoc nhac|duoc de xuat|xep hang|top\s*\d*|so sanh so luot)/.test(normalizedQuestion);
    const asksSurveyRating = /(?:chat luong|phoi hop|danh gia diem|diem trung binh)/.test(normalizedQuestion) && /(?:danh gia|diem|chat luong|phoi hop)/.test(normalizedQuestion);
    const asksSurveyAudience = /(?:doi tuong|nhom doi tuong)/.test(normalizedQuestion) && /(?:tham du|tham gia|de xuat|khao sat)/.test(normalizedQuestion);
    const asksSurveyIssues = /(?:vuong mac|kho khan|cau hoi)/.test(normalizedQuestion) && /(?:phap ly|phap luat|duoc neu|nhieu|pho bien|khao sat)/.test(normalizedQuestion);
    if (asksSurveyIssues) {
        if (!issuesResult.rows.length) return "Phiếu khảo sát trong phạm vi tài khoản chưa ghi nhận vướng mắc pháp lý hoặc câu hỏi cần giải đáp.";
        const highestCount = Math.max(...issuesResult.rows.map(row => Number(row.responses) || 0));
        const topIssues = issuesResult.rows.filter(row => Number(row.responses) === highestCount).slice(0, 5);
        const items = topIssues.map(row => `“${String(row.label).trim()}” (${row.responses} phiếu)`).join("; ");
        if (highestCount === 1) return `Các vướng mắc pháp lý được nêu trong khảo sát (mỗi nội dung 1 phiếu; chưa có nội dung nào nổi trội): ${items}.`;
        return `Vướng mắc pháp lý được nêu nhiều nhất (${highestCount} phiếu mỗi nội dung): ${items}.`;
    }
    if (asksSurveyAudience) {
        if (!audiencesResult.rows.length) return "Phiếu khảo sát trong phạm vi tài khoản chưa ghi nhận nhóm đối tượng tham dự được đề xuất.";
        return `Các nhóm đối tượng tham dự được đề xuất trong phiếu khảo sát: ${audiencesResult.rows.map(row => `“${String(row.label).trim()}” (${row.responses} phiếu)`).join("; ")}.`;
    }
    if (asksTopSurveyTopic) {
        return formatRankedSurveyTopics(topicsResult.rows, { periodLabel: requestedPeriod?.label, total });
    }
    if (asksSurveyRating) {
        return formatSurveyRatings(stats, requestedPeriod?.label);
    }
    if (asksTopSuggestedArea) {
        if (!areasResult.rows.length) return "Các phiếu khảo sát trong phạm vi tài khoản chưa ghi nhận địa bàn được đề xuất.";
        const highestCount = Math.max(...areasResult.rows.map(row => Number(row.responses) || 0));
        const tiedAreas = areasResult.rows.filter(row => Number(row.responses) === highestCount).slice(0, 5);
        const names = tiedAreas.map(row => `“${String(row.label).trim()}”`).join(", ");
        if (tiedAreas.length > 1) {
            return `Các địa bàn đồng hạng cao nhất trong phiếu khảo sát là ${names}, mỗi địa bàn có ${highestCount} phiếu. Chưa có địa bàn nào được đề xuất nhiều hơn.`;
        }
        return `Địa bàn được đề xuất nhiều nhất là ${names} với ${highestCount} phiếu.`;
    }
    const list = (rows, formatter) => rows.length ? rows.map(formatter).join("; ") : "chưa có dữ liệu";
    const quality = stats.quality_average == null ? "chưa có đánh giá" : `${stats.quality_average}/5 (${stats.quality_count} phiếu)`;
    const coordination = stats.coordination_average == null ? "chưa có đánh giá" : `${stats.coordination_average}/5 (${stats.coordination_count} phiếu)`;
    const period = requestedPeriod ? ` · thời gian ${requestedPeriod.label}` : " · toàn bộ thời gian";
    const answer = [
        `Tổng hợp phiếu khảo sát${period}: ${total} phiếu từ ${stats.organizations || 0} đơn vị (${stats.respondents || 0} tài khoản gửi).`,
        `Giai đoạn: ${stats.need_stage || 0} phiếu nhu cầu trước hội nghị, ${stats.after_stage || 0} phiếu đánh giá sau hội nghị. Nhu cầu TGPL được ghi nhận ở ${stats.legal_aid_need || 0} phiếu; nhu cầu tổ chức hội nghị ở ${stats.conference_need || 0}; nhu cầu tập huấn ở ${stats.training_need || 0}.`,
        `Địa bàn được đề xuất: ${list(areasResult.rows, row => `${String(row.label).slice(0, 100)} (${row.responses})`)}.`,
        `Chủ đề/nội dung được nhắc nhiều: ${list(topicsResult.rows, row => `${String(row.label).slice(0, 120)} (${row.responses})`)}.`,
        `Đối tượng tham gia: ${list(audiencesResult.rows, row => `${String(row.label).slice(0, 100)} (${row.responses})`)}. Đơn vị gửi nhiều phiếu: ${list(organizationsResult.rows, row => `${row.label} (${row.responses})`)}.`,
        `Đánh giá trung bình: chất lượng hội nghị ${quality}; phối hợp giữa cơ quan ${coordination}.`,
        areasResult.rows[0] || topicsResult.rows[0]
            ? `Gợi ý lập kế hoạch: ${areasResult.rows.length ? (() => { const max = Math.max(...areasResult.rows.map(row => Number(row.responses) || 0)); const tied = areasResult.rows.filter(row => Number(row.responses) === max); return tied.length > 1 ? `cân nhắc các địa bàn đồng hạng ${tied.map(row => `“${row.label}”`).join(", ")} (${max} phiếu mỗi địa bàn)` : `cân nhắc địa bàn “${tied[0].label}” (${max} phiếu)`; })() : "chưa có địa bàn được nêu"}${topicsResult.rows[0] ? ` và chủ đề “${topicsResult.rows[0].label}” (${topicsResult.rows[0].responses} phiếu)` : ""}. Đây là tín hiệu từ khảo sát, không đại diện chắc chắn cho toàn bộ nhu cầu.`
            : "Chưa đủ dữ liệu gợi ý địa bàn hoặc chủ đề ưu tiên."
    ].join("\n");
    return answer;
}

function answerFromSources(sources) {
    if (!sources?.length) return "";
    return sources.slice(0, 2).map(source => {
        const basis = (source.legal_basis || []).join(", ");
        const content = String(source.answer || "").replace(/\s+/g, " ").slice(0, 500);
        return `${basis ? basis + ": " : ""}${content}`;
    }).join("\n\n").slice(0, 1200);
}

async function loadAiAnswerFeedbackSummary(user, question, requestedPeriod) {
    if (user?.role !== "ADMIN") {
        return "Dữ liệu phản hồi và câu trả lời AI cần hiệu chỉnh chỉ dành cho tài khoản admin. Tôi vẫn có thể tổng hợp hội nghị, khảo sát, nhiệm vụ hoặc yêu cầu tư vấn trong phạm vi quyền xem của tài khoản này.";
    }
    const period = requestedPeriod || parseReportPeriod(question);
    const params = [period?.from || null, period?.to || null];
    const where = `vote='INCORRECT'
        AND ($1::date IS NULL OR (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $1::date)
        AND ($2::date IS NULL OR (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $2::date)`;
    const [totals, reasons, examples] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','REVIEWED'))::int AS awaiting_review,
                COUNT(*) FILTER (WHERE status='RESOLVED')::int AS resolved,
                COUNT(*) FILTER (WHERE status='REVIEWED')::int AS reviewed
            FROM ai_answer_feedback WHERE ${where}`, params),
        pool.query(`SELECT COALESCE(reason_code,'UNSPECIFIED') AS reason_code,COUNT(*)::int AS total
            FROM ai_answer_feedback WHERE ${where} GROUP BY reason_code ORDER BY total DESC,reason_code LIMIT 8`, params),
        pool.query(`SELECT question,reason_code,status,created_at,correction_text
            FROM ai_answer_feedback WHERE ${where} ORDER BY (status NOT IN ('RESOLVED','REVIEWED')) DESC,created_at DESC LIMIT 10`, params)
    ]);
    const stats = totals.rows[0] || {};
    const periodLabel = period?.label ? ` (${period.label})` : " (toàn bộ thời gian)";
    if (!Number(stats.total)) return `Nguồn dữ liệu: phản hồi câu trả lời AI. Không có phản hồi bị đánh dấu sai${periodLabel}.`;
    const reasonLabels = { WRONG_DATA: "sai dữ liệu", WRONG_SCOPE: "sai phạm vi", IRRELEVANT: "lạc đề", INCOMPLETE: "thiếu ý", TOO_LONG: "quá dài", MISSING_SOURCE: "thiếu căn cứ", OTHER: "lý do khác", UNSPECIFIED: "chưa nêu lý do" };
    const reasonSummary = reasons.rows.map(row => `${reasonLabels[row.reason_code] || "lý do khác"}: ${row.total}`).join("; ");
    const statusLabels = { NEW: "chờ rà soát", PENDING: "chờ rà soát", REVIEWED: "đã xem", RESOLVED: "đã hiệu chỉnh" };
    const lines = examples.rows.map(row => {
        const questionText = String(row.question || "").replace(/\s+/g, " ").trim().slice(0, 180);
        const date = new Date(row.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        return `• ${questionText}${String(row.question || "").length > 180 ? "…" : ""} — ${reasonLabels[row.reason_code] || "lý do khác"}; ${statusLabels[row.status] || row.status}; ${date}${row.correction_text ? "; đã có nội dung đính chính" : ""}.`;
    });
    return trimAtLineBoundary([
        `Nguồn dữ liệu: phản hồi câu trả lời AI bị đánh dấu sai${periodLabel}. Tổng ${stats.total}: ${stats.awaiting_review} chờ admin rà soát, ${stats.reviewed} đã xem, ${stats.resolved} đã hiệu chỉnh.`,
        `Lý do thường gặp: ${reasonSummary || "chưa phân loại"}.`,
        "Một số câu hỏi cần rà soát:", ...lines
    ].join("\n"), 2200);
}

async function loadSurveyConferenceComparison(user, question) {
    if (!["ADMIN", "COMMUNE"].includes(user?.role)) {
        return "Tài khoản này không có quyền xem phiếu khảo sát để đối chiếu với hội nghị.";
    }
    const period = parseReportPeriod(question);
    if (!period) return "Bạn muốn đối chiếu phiếu khảo sát với hội nghị trong khoảng thời gian nào? Hãy cho biết tháng, quý, năm hoặc khoảng ngày.";
    if (user.role === "COMMUNE" && !user.organization_id) {
        return "Tài khoản chưa được gắn với đơn vị nên chưa xác định được phạm vi khảo sát. Vui lòng liên hệ admin.";
    }

    const surveyParams = [period.from, period.to];
    const surveyOrgFilter = user.role === "COMMUNE" ? "AND s.organization_id=$3::uuid" : "";
    if (user.role === "COMMUNE") surveyParams.push(user.organization_id);
    const [surveyResult, conferenceResult] = await Promise.all([
        pool.query(`SELECT s.suggested_area,s.topics,s.training_need
            FROM conference_need_surveys s
            WHERE s.created_at >= $1::date AND s.created_at < $2::date ${surveyOrgFilter}
            ORDER BY s.created_at DESC`, surveyParams),
        pool.query(`SELECT c.code,c.title,c.description,c.location_name,c.location_address,o.name AS organization_name
            FROM conferences c JOIN organizations o ON o.id=c.organization_id
            WHERE ($1::text='ADMIN' OR ($1::text='COMMUNE' AND c.organization_id=$2::uuid))
            AND c.status='COMPLETED'
            AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $3::date
            AND (c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $4::date
            ORDER BY c.start_time,c.code LIMIT 100`, [user.role,user.organization_id || null,period.from,period.to])
    ]);
    if (!surveyResult.rows.length) return `Không có phiếu khảo sát trong kỳ ${period.label} để đối chiếu.`;

    const countLabels = rows => {
        const counts = new Map();
        for (const row of rows) {
            const label = String(row || "").replace(/\s+/g, " ").trim();
            if (label) counts.set(label, (counts.get(label) || 0) + 1);
        }
        return [...counts.entries()].map(([label,count]) => ({label,count}))
            .sort((a,b) => b.count-a.count || a.label.localeCompare(b.label,"vi"));
    };
    const areas = countLabels(surveyResult.rows.map(row => row.suggested_area));
    const topics = countLabels(surveyResult.rows.flatMap(row => [row.topics,row.training_need]
        .filter(Boolean).flatMap(value => String(value).split(/[,;\n]+/))));
    const conferences = conferenceResult.rows;
    const normalizedEvent = row => normalize([row.title,row.description,row.organization_name,row.location_name,row.location_address].filter(Boolean).join(" "));
    const eventMatches = label => {
        const key = normalize(label);
        if (key.length < 4) return [];
        return conferences.filter(row => normalizedEvent(row).includes(key));
    };
    const topGroup = rows => {
        if (!rows.length) return [];
        const max = rows[0].count;
        return rows.filter(row => row.count === max).slice(0,5);
    };
    const topAreas = topGroup(areas);
    const topTopics = topGroup(topics);
    const formatTop = rows => rows.length ? rows.map(row => `“${row.label}” (${row.count} phiếu)`).join(", ") : "chưa ghi nhận";
    const topicMatches = topTopics.flatMap(topic => eventMatches(topic.label).map(event => `${topic.label} — ${event.code} ${event.title}`));
    const areaMatches = topAreas.flatMap(area => eventMatches(area.label).map(event => `${area.label} — ${event.code} ${event.organization_name}`));
    const isEvaluation = /danh gia|dap ung|chuyen doi|doi chieu/.test(normalize(question));
    if (isEvaluation) {
        return [
            `Khảo sát kỳ ${period.label}: chủ đề được nhắc nhiều nhất là ${formatTop(topTopics)}; địa bàn được đề xuất nhiều nhất là ${formatTop(topAreas)}.`,
            `Hồ sơ hội nghị đã hoàn thành có nội dung khớp trực tiếp: ${topicMatches.length ? topicMatches.slice(0,5).join("; ") : "chưa ghi nhận kết quả khớp rõ"}${areaMatches.length ? `; địa bàn khớp: ${areaMatches.slice(0,5).join("; ")}` : ""}.`,
            "Chỉ có thể xác nhận mức độ khớp trên tên/nội dung hồ sơ; website chưa lưu biên bản hoặc kết quả thực tế để kết luận nhu cầu đã được đáp ứng. Không tìm thấy kết quả khớp cũng không đồng nghĩa nhu cầu chắc chắn chưa được đáp ứng."
        ].join("\n");
    }
    return [
        `Khảo sát kỳ ${period.label}: địa bàn đồng hạng cao nhất ${formatTop(topAreas)}; chủ đề đồng hạng cao nhất ${formatTop(topTopics)}.`,
        `Đối chiếu với ${conferences.length} hội nghị đã hoàn thành trong kỳ: ${topicMatches.length ? `có hồ sơ cùng chủ đề: ${topicMatches.slice(0,4).join("; ")}` : "chưa thấy hồ sơ trùng chủ đề rõ ràng"}${areaMatches.length ? `; cùng địa bàn: ${areaMatches.slice(0,4).join("; ")}` : ""}.`,
        "Gợi ý: ưu tiên xem xét các chủ đề/địa bàn đồng hạng nêu trên; đây là tín hiệu từ phiếu khảo sát, không đại diện chắc chắn cho toàn bộ nhu cầu. Số liệu hồ sơ không chứng minh tác động thực tế của hội nghị."
    ].join("\n");
}

async function prepareChat(req) {
    const question = String(req.body?.question || "").trim();
    if (question.length < 3) return { error: "Vui lòng nhập câu hỏi từ 3 ký tự trở lên." };
    if (question.length > 4000) return { error: "Câu hỏi không được vượt quá 4.000 ký tự." };
    // Deterministic contact-request intents bypass generic classification and all Ollama calls.
    const contactIntent = classifyQuestion(question);
    if (contactIntent.isContactRequestSummaryQuestion) {
        const requestedPeriod = parseReportPeriod(question);
        if (!requestedPeriod) {
            return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "contact_request_period_clarification", semantic: false, complexity: "simple" }, sources: [],
                directAnswer: "Bạn muốn tổng hợp yêu cầu tư vấn trong khoảng thời gian nào? Hãy cho biết tháng/năm, quý/năm hoặc khoảng ngày cụ thể; bạn cũng có thể chọn toàn bộ thời gian.", messages: [] };
        }
        try {
            const directAnswer = await loadLegalAidContactRequestSummary(req.user, question, requestedPeriod);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_legal_aid_contact_requests", semantic: false, complexity: "simple" }, sources: [], directAnswer, messages: [] };
        } catch (error) {
            console.error("AI legal aid contact request summary failed:", error.message);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_legal_aid_contact_requests", semantic: false, complexity: "simple" }, sources: [],
                directAnswer: "Hiện chưa truy xuất được yêu cầu tư vấn trong kỳ này. Vui lòng thử lại sau.", messages: [] };
        }
    }
    // This structured count must bypass intent-resolution and answer-generation Ollama calls.
    if (isPendingConferenceRequestCountQuestion(question)) {
        try {
            const result = await loadPendingConferenceRequestCount(req.user, question);
            return { question, mode: "fast", rag: { used: false, topK: 0, database: true, method: "scoped_sql_pending_conference_requests_by_received_period", semantic: false, complexity: "simple" }, sources: [], directAnswer: result.answer, messages: [] };
        } catch (error) {
            console.error("AI pending conference request count failed:", error.message);
            return { question, mode: "fast", rag: { used: false, topK: 0, database: true, method: "scoped_sql_pending_conference_requests_by_received_period", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Hiện chưa đếm được yêu cầu hội nghị chờ phê duyệt theo kỳ. Vui lòng thử lại sau.", messages: [] };
        }
    }

    if (contactIntent.isContactRequestStatusQuestion || isContactRequestStatusQuestion(question)) {
        if (!req.user?.id) return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "contact_request_status_guidance", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Đăng nhập tài khoản đã gửi yêu cầu để tra trạng thái cá nhân; không cung cấp mã truy cập hoặc thông tin nhạy cảm trong khung chat.", messages: [] };
        try {
            const result = await pool.query(`SELECT status,created_at FROM legal_aid_contact_requests
                WHERE user_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 1`, [req.user.id]);
            if (!result.rowCount) {
                return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_own_contact_request_status", semantic: false, complexity: "simple" }, sources: [],
                    directAnswer: "Chưa tìm thấy yêu cầu tư vấn gắn với tài khoản này. Nếu bạn vừa gửi, hãy kiểm tra thông báo gửi thành công; nếu không có, gửi lại yêu cầu từ trang chủ hoặc liên hệ Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai.", messages: [] };
            }
            const request = result.rows[0];
            const statusText = ({ PENDING: "đã được ghi nhận và đang chờ admin phân công", ASSIGNED: "đã được ghi nhận và phân công cán bộ; đang chờ liên hệ", CONTACTED: "đã được ghi nhận và cán bộ đã đánh dấu đã liên hệ", CLOSED: "đã được xử lý và đóng trên hệ thống" })[request.status] || "đã được ghi nhận; trạng thái đang được cập nhật";
            const directAnswer = `Yêu cầu tư vấn gần nhất của tài khoản này ${statusText} (gửi lúc ${formatAiDate(request.created_at)}). Hãy theo dõi thông báo trong tài khoản; hệ thống không cam kết thời hạn liên hệ cụ thể.`;
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_own_contact_request_status", semantic: false, complexity: "simple" }, sources: [], directAnswer, messages: [] };
        } catch (error) {
            console.error("Own contact request status lookup failed:", error.message);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_own_contact_request_status", semantic: false, complexity: "simple" }, sources: [],
                directAnswer: "Hiện chưa tra được trạng thái yêu cầu tư vấn của tài khoản này. Vui lòng thử lại sau hoặc liên hệ admin.", messages: [] };
        }
    }
    const history = normalizeConversationHistory(req.body?.history, 6);
    let currentClassification = classifyQuestion(question);
    let resolvedIntent = null;
    const intentFallbackAttempted = shouldResolveIntent(question, currentClassification, history.length > 0);
    if (intentFallbackAttempted) {
        resolvedIntent = await resolveIntentWithOllama(question);
        // Fail closed: an ambiguous app-like question must not continue into generic
        // retrieval/generation after the classifier timed out or returned invalid JSON.
        if (!resolvedIntent) {
            return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "intent_fallback_unavailable", semantic: false, complexity: "simple" }, sources: [],
                directAnswer: "Tôi chưa xác định chắc yêu cầu thuộc tra cứu hội nghị, tổng hợp báo cáo, nhiệm vụ hay lập kế hoạch. Bạn vui lòng nêu rõ mục đích hoặc mã hội nghị để tôi tra cứu đúng dữ liệu.", messages: [] };
        }
        resolvedIntent = enforceIntentFit(question, resolvedIntent);
        if (resolvedIntent?.requires_clarification || resolvedIntent?.intent === "clarify") {
            return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "intent_clarification", semantic: false, complexity: "simple" }, sources: [],
                directAnswer: resolvedIntent.clarification_question || "Bạn muốn tra cứu dữ liệu, tổng hợp báo cáo, xem nhiệm vụ hay lập kế hoạch hội nghị? Vui lòng nói rõ mục đích để tôi chọn đúng nguồn.", messages: [],
                resolvedClassification: currentClassification };
        }
        if (resolvedIntent) currentClassification = applyIntentResolution(currentClassification, resolvedIntent);
    }
    if (currentClassification.isExternalDataQuestion) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "out_of_scope_no_external_source", semantic: false, complexity: "simple" }, sources: [],
            directAnswer: "Hệ thống chưa tích hợp nguồn dữ liệu để xác minh thời tiết, tỷ giá hoặc tin tức bên ngoài. Vui lòng tra cứu tại nguồn chuyên môn phù hợp.", messages: [] };
    }
    if (currentClassification.isConferenceAttendanceGuidanceQuestion) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "attendance_metric_definition", semantic: false, complexity: "simple" }, sources: [],
            directAnswer: "Số đăng ký là số lượt ghi tên trước sự kiện; số đã điểm danh là lượt được đánh dấu có mặt; số người thực tế theo danh sách thành phần lấy từ báo cáo điểm danh nếu đã nhập. Cơ sở dữ liệu chưa xác định được số người duy nhất gộp giữa các danh sách, nên không cộng các nhóm với nhau.", messages: [] };
    }
    const roleFilteredHistory = filterPromptHistory(history, req.user);
    const userOnlyHistory = roleFilteredHistory.filter(item => item.role === "user");
    const conversation = resolveConversationContext(question, history, currentClassification, classifyQuestion);
    const permittedUserText = new Set(userOnlyHistory.map(item => item.content));
    conversation.relevantUserTurns = conversation.relevantUserTurns.filter(content => permittedUserText.has(content));
    const conversationMemory = buildConversationMemory(userOnlyHistory, conversation, classifyQuestion, question);
    const shortLocalityOnly = /^(?:ubnd\s+)?(?:xa|phuong)\s+[\p{L}\s'-]{2,50}$/u.test(normalize(question))
        && normalize(question).split(/\s+/).filter(Boolean).length <= 4;
    if (shortLocalityOnly && !conversation.usesContext) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "locality_clarification", semantic: false, complexity: "simple" }, sources: [],
            directAnswer: `Bạn muốn tra cứu hoặc đề xuất nội dung gì tại ${question}? Hãy nêu rõ, chẳng hạn: hội nghị, nhiệm vụ, phiếu khảo sát hoặc kế hoạch tập huấn.`, messages: [] };
    }
    const anchorEntry = conversation.previous || null;
    const isFollowUp = conversation.usesContext;
    const explicitCodeMatch = question.match(/\b(hn|hcn|conf)[\s_-]*(\d{2,})\b/i);
    if (conversation.clarify && !explicitCodeMatch) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [],
            directAnswer: "Tôi chưa có nội dung trước đó trong phiên để hiểu bạn đang nhắc đến trường hợp nào. Vui lòng gửi lại câu hỏi hoặc nêu ngắn gọn đối tượng, tình tiết hay mã hội nghị cần tra cứu.", messages: [] };
    }
    const inheritedConferenceCode = !explicitCodeMatch ? conversation.conferenceReferenceCode : null;
    if (!explicitCodeMatch && conversation.conferenceReferenceAmbiguous) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [],
            directAnswer: "Trong ngữ cảnh gần đây có nhiều mã hội nghị. Vui lòng cho biết mã cần tra cứu để tôi không nhầm dữ liệu.", messages: [] };
    }
    const followsLegalArticle = Boolean(isFollowUp && anchorEntry?.classification.isLegalAidQuestion && /\bdieu\s+\d+[a-z]?\b/.test(normalize(question)));
    let retrievalQuestion = isFollowUp
        ? followsLegalArticle
            ? `${question}. Luật Trợ giúp pháp lý. ${conversationMemory.retrievalText}`
            : conversationMemory.retrievalText
        : question;
    if (inheritedConferenceCode) retrievalQuestion = `${inheritedConferenceCode} ${question}`;
    const classification = inheritedConferenceCode
        ? classifyQuestion(retrievalQuestion)
        : currentClassification.isInScope || !isFollowUp ? currentClassification : classifyQuestion(retrievalQuestion);
    const normalizedCurrentQuestion = normalize(question);
    const normalizedQuestion = normalize(question);    if (/(?:sau hoi nghi)/.test(normalizedQuestion) && /(?:danh gia ket qua|so lieu)/.test(normalizedQuestion) && /(?:dang ky|diem danh|phieu khao sat)/.test(normalizedQuestion)) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "conference_evaluation_metrics_guidance", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Nên báo cáo riêng từng nhóm: (1) số đăng ký và quy mô dự kiến; (2) số đã điểm danh và tỷ lệ trên số đăng ký; (3) số phiếu khảo sát, điểm trung bình chất lượng/phối hợp kèm cỡ mẫu; (4) các chủ đề góp ý lặp lại; (5) tỷ lệ nhiệm vụ hoàn thành. Không xem quy mô dự kiến là số tham dự thực tế, không cộng lượt đơn vị với lượt người dân nếu có thể trùng, và nêu rõ khi mẫu khảo sát nhỏ.", messages: [] };
    }    if (/(?:bao cao vien|can bo|nhan su)/.test(normalizedQuestion) && /(?:khong du|thieu|da ban|lich.*ban|phuong an kha thi)/.test(normalizedQuestion)) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, method: "staffing_capacity_policy", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Mốc mục tiêu là 3 cán bộ chính thức + 1 dự bị và 1 báo cáo viên chính thức + 1 dự bị; không vượt hạn mức cá nhân 5 nhiệm vụ/tháng, 2/tuần với cán bộ, 3 lượt thuyết trình/tháng, 1/tuần với báo cáo viên. Nếu bạn nêu ngày cụ thể, hệ thống kiểm tra xung đột lịch trước. Ngày không xung đột được giữ làm phương án ưu tiên; nếu nhân sự chưa đủ, chatbot vẫn nêu người còn phù hợp, tải việc tháng/tuần và vị trí thiếu để admin quyết định. Có thể kèm ngày thay thế đủ cơ cấu; không tự vượt hạn mức, lưu phân công hay gửi thông báo.", messages: [] };
    }
    const asksConferenceDetails = /(?:thoi gian|ngay gio|ngay nao|khi nao|dien ra|o dau|dia diem|noi to chuc|dia chi|bao cao vien|ai trinh bay|nguoi thuyet trinh|trang thai|tinh trang|phe duyet)/.test(normalizedQuestion);
    const asksAssignmentRoster = /(?:phan cong|ai duoc giao|ai la nguoi|ai nhan|nguoi nhan nhiem vu|nhiem vu nao)/.test(normalizedQuestion);
    const assignmentOnly = asksAssignmentRoster && !/(?:thoi gian|ngay gio|ngay nao|khi nao|dien ra|o dau|dia diem|noi to chuc|dia chi|trang thai|tinh trang|phe duyet)/.test(normalizedQuestion);
    const conferenceCode = explicitCodeMatch
        ? `${explicitCodeMatch[1].toUpperCase()}-${explicitCodeMatch[2].padStart(4, "0")}`
        : inheritedConferenceCode;
    if (conferenceCode && asksConferenceDetails && !assignmentOnly) {
        const scope = `($2::text='ADMIN'
            OR ($2::text='COMMUNE' AND (
                ($3::uuid IS NOT NULL AND c.organization_id=$3::uuid)
                OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time>=NOW())
            ))
            OR ($2::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$4::uuid))
            OR ($2::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$4::uuid)))`;
        const fields = requestedConferenceFields(question);
        try {
            const result = await pool.query(`SELECT c.id,c.code,c.title,c.status,c.start_time,c.end_time,
                    c.proposed_start_time,c.proposed_end_time,c.location_name,c.location_address
                FROM conferences c WHERE UPPER(c.code)=$1 AND ${scope} LIMIT 1`,
            [conferenceCode,req.user.role,req.user.organization_id || null,req.user.id]);
            if (!result.rowCount) {
                return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_conference_code", semantic: false, complexity: "simple" }, sources: [],
                    directAnswer: `Không tìm thấy hội nghị mã ${conferenceCode} trong phạm vi dữ liệu tài khoản được phép xem.`, messages: [] };
            }
            let speakers = [];
            if (fields.has("speaker")) {
                if (req.user.role === "COMMUNE") speakers = null;
                else {
                    const speakerResult = await pool.query(`SELECT s.full_name,s.presentation_title,s.speaking_order
                        FROM conference_speakers s WHERE s.conference_id=$1
                          AND ($2::text='ADMIN' OR $2::text='TASK_ASSIGNEE' OR ($2::text='SPEAKER' AND s.speaker_user_id=$3::uuid))
                        ORDER BY s.speaking_order NULLS LAST,s.full_name`, [result.rows[0].id,req.user.role,req.user.id]);
                    speakers = speakerResult.rows;
                }
            }
            let assignees = [];
            if (fields.has("assignees")) {
                if (!['ADMIN', 'TASK_ASSIGNEE'].includes(req.user.role)) assignees = null;
                else {
                    const assignmentResult = await pool.query(`SELECT COALESCE(NULLIF(a.assignee_name,''),u.full_name) AS assignee_name
                        FROM conference_task_assignments a LEFT JOIN users u ON u.id=a.assignee_user_id
                        WHERE a.conference_id=$1 AND a.status<>'CANCELLED'
                          AND ($2::text='ADMIN' OR ($2::text='TASK_ASSIGNEE' AND a.assignee_user_id=$3::uuid))
                        ORDER BY a.created_at,a.title`, [result.rows[0].id,req.user.role,req.user.id]);
                    assignees = assignmentResult.rows;
                }
            }
            const row = result.rows[0];
            const directAnswer = formatConferenceDetails(row, speakers, fields, formatAiDate, assignees);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_conference_code", semantic: false, complexity: "simple" }, sources: [], directAnswer, messages: [] };
        } catch (error) {
            console.error("AI exact conference detail lookup failed:", error.message);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_conference_code", semantic: false, complexity: "simple" }, sources: [],
                directAnswer: "Hiện chưa tra cứu được hội nghị theo mã trong phạm vi tài khoản. Vui lòng thử lại sau.", messages: [] };
        }
    }
    const reportQuestion = isFollowUp ? retrievalQuestion : question;
    const normalizedReportQuestion = normalize(reportQuestion);
    const asksForContactReferral = !classification.isAssignedConsultationQuery && !classification.isConsultationNoteGuidance && !classification.isInsufficientBasisGuidance && (classification.isContactReferralQuestion ||
        ((/(?:lien he|trung tam|nho trung tam)/.test(normalizedQuestion)) && /(?:tu van|tro giup phap ly|tgpl)/.test(normalizedQuestion)) ||
        (/(?:khong quy dinh|khong tim thay can cu|khong co can cu)/.test(normalizedQuestion) && /(?:lien he|tu van)/.test(normalizedQuestion)) ||
        (/(?:can duoc tu van|tu van ve quyen loi|bat dau tu dau|goi lai|nguoi tu van goi|chua biet co thuoc dien|khong biet co thuoc dien|khong biet co duoc tro giup phap ly)/.test(normalizedQuestion)) ||
        (/trinh bay/.test(normalizedQuestion) && /(?:tinh huong|vu viec)/.test(normalizedQuestion) && /(?:tro giup phap ly|tgpl|tu van)/.test(normalizedQuestion)));
    const asksContactFollowupStatus = isContactRequestStatusQuestion(question);
    const currentQuestionAsksContactRequestSummary = isContactRequestSummaryIntent(question);
    const asksContactRequestSummary = currentQuestionAsksContactRequestSummary || isContactRequestSummaryIntent(reportQuestion);
    // An explicit date and scope in the current turn must win over stale chat context.
    const requestedContactRequestPeriod = parseReportPeriod(currentQuestionAsksContactRequestSummary ? question : reportQuestion);
    const normalizedTaskReportQuestion = normalizedReportQuestion;
    const asksTaskOverdueReport = /(?:qua han|tre han|cham han)/.test(normalizedTaskReportQuestion) &&
        /(?:chua hoan thanh|chua xong|chua lam xong|con mo|dang xu ly)/.test(normalizedTaskReportQuestion);
    const asksConferenceActionReview = classification.intent === "conference_action_review" ||
        (/(?:doi lich|doi ngay|doi thoi gian)/.test(normalizedTaskReportQuestion) &&
        /(?:phan cong lai|doi can bo|thay can bo|sap xep lai|can xu ly)/.test(normalizedTaskReportQuestion));
    const primaryIntent = asksForContactReferral ? "contact_referral" : classification.intent;
    const asksTaskUpcomingReport = /(?:sap den han|sap toi han|den han trong|han trong)/.test(normalizedTaskReportQuestion);
    const asksTaskTimeScopedReport = classification.isTaskQuery && !asksTaskOverdueReport && !asksTaskUpcomingReport &&
        !/(?:chua hoan thanh|chua xong|chua lam xong|con mo)/.test(normalizedTaskReportQuestion) &&
        !/(?:huong dan|cach|lam the nao|ghi y kien|cap nhat tien do)/.test(normalizedTaskReportQuestion) &&
        !/\b(?:hn|hcn|conf)[\s_-]*\d{2,}\b/i.test(normalizedTaskReportQuestion) &&
        /(?:tong hop|bao cao|thong ke|tien do|hoan thanh|den han|qua han)/.test(normalizedTaskReportQuestion);
    const asksAttendanceRateFormula = /(?:ty le tham du|ty le tham gia)/.test(normalizedQuestion) && /(?:cach tinh|tinh nhu the nao|cong thuc)/.test(normalizedQuestion);
    if (asksAttendanceRateFormula) {
        return {
            question,
            mode: "fast",
            rag: { used: false, topK: 0, database: false, method: "attendance_rate_formula", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer: "Tỷ lệ tham dự trên số đăng ký = số người đã điểm danh / tổng số người đăng ký × 100%. Tỷ lệ so với quy mô dự kiến = số người đã điểm danh / số người dự kiến × 100%. Dùng cùng đơn vị đếm và ghi “chưa đủ dữ liệu” nếu chưa có số đăng ký hoặc điểm danh; không thay số liệu thiếu bằng 0.",
            messages: []
        };
    }
    if (classification.isAiFeedbackSummaryQuestion && req.user?.role !== "ADMIN") {
        return {
            question,
            mode: "fast",
            rag: { used: false, topK: 0, database: false, complexity: "simple" },
            sources: [],
            directAnswer: "Dữ liệu phản hồi và câu trả lời AI cần hiệu chỉnh chỉ dành cho tài khoản admin. Tôi vẫn có thể tổng hợp hội nghị, khảo sát, nhiệm vụ hoặc yêu cầu tư vấn trong phạm vi quyền xem của tài khoản này.",
            messages: []
        };
    }
    const requiresTimeScope = asksContactRequestSummary || classification.isAiFeedbackSummaryQuestion ||
        (classification.isConferenceAnalysisQuestion && !classification.isConferenceOrganizationSummaryQuestion && !/\b(?:hn|hcn|conf)[\s_-]*\d{2,}\b/i.test(normalizedReportQuestion) && !(classification.isTaskQuery && /\b(?:hn|hcn|conf)[\s_-]*\d{2,}\b/i.test(normalizedReportQuestion))) ||
        classification.isSurveySummaryQuestion || classification.isConferenceAttendanceQuestion || asksTaskTimeScopedReport;
    const requestedReportPeriod = parseReportPeriod(reportQuestion);
    if (classification.isSurveyPlanningAdviceQuestion) {
        return {
            question,
            mode: "fast",
            rag: { used: false, topK: 0, database: false, method: "survey_topic_planning_guidance", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer: "Có thể cân nhắc chủ đề đó cho kế hoạch của đơn vị bạn như một tín hiệu khảo sát. Trước khi chốt, hãy đối chiếu số phiếu, kỳ khảo sát và mức độ phù hợp với đối tượng; nếu chỉ có ít ý kiến thì nên hỏi thêm hoặc tổ chức quy mô phù hợp, chưa xem đó là nhu cầu chung. Chatbot không tự thêm chủ đề vào kho RAG. Nếu bạn nêu chủ đề cụ thể và kỳ khảo sát, tôi có thể rà số liệu trong phạm vi tài khoản.",
            messages: []
        };
    }
    const hasConferenceCodeInTaskQuestion = /\b(?:hn|hcn|conf)[\s_-]*\d{2,}\b/i.test(normalizedReportQuestion);
    const asksForOneSpecificConference = /(?:hoi nghi nay|hoi nghi do|su kien nay|su kien do)/.test(normalizedReportQuestion);
    const asksPostConferenceFollowup = /(?:kien nghi sau hoi nghi|kien nghi sau su kien|chuyen thanh nhiem vu theo doi)/.test(normalizedReportQuestion);
    if (classification.isSurveyConferenceEvaluation && !hasConferenceCodeInTaskQuestion && /(?:giua hai hoi nghi|hai hoi nghi)/.test(normalizedReportQuestion)) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [], directAnswer: "Vui lòng cho biết mã của hai hội nghị đã hoàn thành cần so sánh (ví dụ HN-0004 và HN-0008). Tôi sẽ đối chiếu cùng các tiêu chí khảo sát và nêu số phiếu của từng hội nghị.", messages: [] };
    }
    if (classification.isSurveyConferenceEvaluation && asksForOneSpecificConference && !hasConferenceCodeInTaskQuestion) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [], directAnswer: "Vui lòng cho mã hội nghị cần đánh giá (ví dụ HN-0012). Tôi sẽ đối chiếu nội dung hội nghị với phiếu khảo sát liên quan; nếu chưa có phiếu sau hội nghị, tôi sẽ nêu rõ phần chưa đủ dữ liệu.", messages: [] };
    }
    const asksConferenceMonthWithoutYear = classification.isConferenceDataQuestion &&
        /\bthang\s+(?:0?[1-9]|1[0-2])\b(?!\s*(?:nam|[\/.\-])\s*\d{4})/.test(normalizedQuestion);
    if (asksConferenceMonthWithoutYear) {
        const month = normalizedQuestion.match(/\bthang\s+(0?[1-9]|1[0-2])\b/)?.[1];
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [], directAnswer: `Bạn muốn tra cứu tháng ${month} của năm nào?`, messages: [] };
    }
    if (isPendingConferenceOverlapCountQuestion(question)) {
        try {
            const directAnswer = await loadPendingConferenceOverlapCount(req.user);
            return { question, mode: "fast", rag: { used: false, topK: 0, database: true, method: "scoped_sql_pending_conference_time_overlaps", semantic: false, complexity: "simple" }, sources: [], directAnswer, messages: [] };
        } catch (error) {
            console.error("AI pending conference overlap count failed:", error.message);
            return { question, mode: "fast", rag: { used: false, topK: 0, database: true, method: "scoped_sql_pending_conference_time_overlaps", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Hiện chưa kiểm tra được trùng thời gian trong danh sách hội nghị chờ phê duyệt. Vui lòng thử lại sau.", messages: [] };
        }
    }    if (classification.isConferenceLargestExpectedQuestion) {
        let directAnswer;
        try {
            directAnswer = await loadLargestExpectedConferenceAnswer(req.user, question);
        } catch (error) {
            console.error("AI largest expected conference lookup failed:", error.message);
            directAnswer = "Hiện chưa truy xuất được quy mô dự kiến hội nghị trong phạm vi tài khoản. Vui lòng thử lại sau.";
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, method: "scoped_sql_largest_expected_conference", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (classification.isConferenceDataQuestion && isConferenceCountQuestion(retrievalQuestion)) {
        let directAnswer;
        try {
            // Parse the current turn only. Follow-up history is useful for intent,
            // but an older month must never replace the month the user just gave.
            directAnswer = await loadConferenceCountAnswer(req.user, question);
        } catch (error) {
            console.error("AI conference count lookup failed:", error.message);
            directAnswer = "Hiện chưa đếm được hội nghị trong kỳ yêu cầu. Vui lòng thử lại sau.";
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, method: "scoped_sql_conference_count", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    const exactCodeMatch = normalizedQuestion.match(/\b(hn|hcn|conf)[\s_-]*(\d{2,})\b/i);
    const asksPublicAccess = /(?:cong khai|don vi nao duoc dang ky|don vi duoc phep dang ky)/.test(normalizedQuestion);
    if (classification.isConferenceDataQuestion && exactCodeMatch && asksPublicAccess) {
        const code = classification.querySlots?.conferenceCode || (exactCodeMatch[1].toUpperCase() + "-" + exactCodeMatch[2].padStart(4, "0"));
        const visibilityScope = "($2::text='ADMIN' OR ($2::text='COMMUNE' AND (($3::uuid IS NOT NULL AND c.organization_id=$3::uuid) OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time>=NOW()))) OR ($2::text='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$4::uuid)) OR ($2::text='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$4::uuid)))";
        try {
            const result = await pool.query("SELECT c.id,c.code,c.is_public FROM conferences c WHERE c.code=$1 AND " + visibilityScope + " LIMIT 1",
                [code,req.user.role,req.user.organization_id || null,req.user.id]);
            if (!result.rowCount) {
                return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_public_access",semantic:false,complexity:"simple"}, sources:[],
                    directAnswer:"Không tìm thấy hội nghị mã " + code + " trong phạm vi dữ liệu tài khoản được phép xem.", messages:[] };
            }
            const row = result.rows[0];
            let directAnswer;
            if (row.is_public === true) {
                directAnswer = row.code + " đang công khai; mọi đơn vị có thể đăng ký tham gia.";
            } else if (req.user.role !== "ADMIN") {
                directAnswer = row.code + " không công khai. Danh sách đơn vị được phép đăng ký chỉ hiển thị cho quản trị viên.";
            } else {
                const allowed = await pool.query("SELECT o.name FROM conference_registration_organizations a JOIN organizations o ON o.id=a.organization_id WHERE a.conference_id=$1 ORDER BY LOWER(o.name),o.name", [row.id]);
                const names = [...new Set(allowed.rows.map(item => String(item.name || "").trim()).filter(Boolean))];
                directAnswer = names.length
                    ? row.code + " không công khai; đơn vị được phép đăng ký: " + names.join(", ") + "."
                    : row.code + " không công khai; chưa có đơn vị nào được cấp quyền đăng ký.";
            }
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_public_access",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
        } catch (error) {
            console.error("AI conference public access lookup failed:", error.message);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_public_access",semantic:false,complexity:"simple"}, sources:[],
                directAnswer:"Hiện chưa tra cứu được trạng thái công khai và đơn vị đăng ký theo mã hội nghị. Vui lòng thử lại sau.", messages:[] };
        }
    }
    if (classification.isConferenceDataQuestion && exactCodeMatch && !classification.isTaskQuery && !/(?:phan cong|bao cao vien|ai duoc giao|ai la nguoi)/.test(normalizedQuestion)) {
        const code = classification.querySlots?.conferenceCode || `${exactCodeMatch[1].toUpperCase()}-${exactCodeMatch[2].padStart(4, "0")}`;
        const scope = `($2::text='ADMIN'
            OR ($2::text='COMMUNE' AND (
                ($3::uuid IS NOT NULL AND c.organization_id=$3::uuid)
                OR (c.status='APPROVED' AND c.is_public=TRUE AND c.start_time>=NOW())
            ))
            OR ($2::text='TASK_ASSIGNEE' AND EXISTS (
                SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$4::uuid
            ))
            OR ($2::text='SPEAKER' AND EXISTS (
                SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$4::uuid
            )))`;
        let directAnswer;
        try {
            const result = await pool.query(`SELECT c.code,c.title,c.status,c.start_time,c.end_time,c.location_name,c.location_address,o.name AS organization_name FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id WHERE c.code=$1 AND ${scope} LIMIT 1`, [code,req.user.role,req.user.organization_id || null,req.user.id]);
            if (!result.rows.length) directAnswer = `Không tìm thấy hội nghị mã ${code} trong phạm vi dữ liệu tài khoản được phép xem.`;
            else {
                const row = result.rows[0];
                const status = ({ PENDING:"chờ phê duyệt",APPROVED:"đã phê duyệt",COMPLETED:"hoàn thành",REJECTED:"bị từ chối",CANCELLED:"đã hủy",RESCHEDULED:"đề xuất dời lịch" })[row.status] || row.status;
                const location = [row.location_name,row.location_address].filter(Boolean).join(" – ") || "chưa ghi địa điểm";
                directAnswer = `${row.code} – ${row.title}; đơn vị ${row.organization_name || "chưa ghi nhận"}; thời gian ${formatAiDate(row.start_time)}${row.end_time ? ` đến ${formatAiDate(row.end_time)}` : ""}; địa điểm ${location}; trạng thái ${status}.`;
            }
        } catch (error) {
            console.error("AI exact conference lookup failed:", error.message);
            directAnswer = "Hiện chưa tra cứu được hội nghị theo mã. Vui lòng thử lại sau.";
        }
        return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_code",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
    }
    if (requiresTimeScope && !requestedReportPeriod) {
        return {
            question,
            mode: "fast",
            rag: { used: false, topK: 0, database: false, complexity: "simple" },
            sources: [],
            directAnswer: "Bạn muốn tổng hợp trong khoảng thời gian nào? Hãy cho biết tháng/năm, quý/năm hoặc khoảng ngày cụ thể; bạn cũng có thể chọn “toàn bộ thời gian”.",
            messages: []
        };
    }
    const asksPlannedConferenceStatusList = /(?:ra soat|liet ke|danh sach|tim)/.test(normalizedQuestion) && /(?:hoi nghi|ho so)/.test(normalizedQuestion) && /(?:du kien|sap dien ra|se to chuc)/.test(normalizedQuestion) && /(?:ma|trang thai)/.test(normalizedQuestion);
    const plannedConferencePeriod = parseReportPeriod(question);
    if (asksPlannedConferenceStatusList && plannedConferencePeriod) {
        try {
            const directAnswer = await loadPlannedConferenceStatusList(req.user,plannedConferencePeriod,question);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_planned_conference_status_by_period",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
        } catch (error) {
            console.error("AI planned conference status-by-period lookup failed:", error.message);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_planned_conference_status_by_period",semantic:false,complexity:"simple"}, sources:[], directAnswer:"Hiện chưa rà soát được danh sách hội nghị theo kỳ yêu cầu. Vui lòng thử lại sau.", messages:[] };
        }
    }
    const asksConferenceAttendanceSummary = classification.isConferenceAttendanceQuestion || /(?:so luong.{0,50}nguoi tham du|nguoi tham du.{0,50}so luong|bao nhieu.{0,50}nguoi tham du)/.test(normalizedReportQuestion) && /hoi nghi/.test(normalizedReportQuestion);
    const attendancePeriod = parseReportPeriod(question) || requestedReportPeriod;
    if (asksConferenceAttendanceSummary && attendancePeriod) {
        try {
            const completedOnly = /hoan thanh/.test(normalizedReportQuestion);
            const directAnswer = await loadConferenceAttendanceSummary(req.user,attendancePeriod,completedOnly);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_attendance_summary",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
        } catch (error) {
            console.error("AI conference attendance summary failed:", error.message);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_attendance_summary",semantic:false,complexity:"simple"}, sources:[], directAnswer:"Hiện chưa tổng hợp được số đăng ký và điểm danh hội nghị trong kỳ yêu cầu. Vui lòng thử lại sau.", messages:[] };
        }
    }    if (classification.isConferenceAnalysisQuestion && requestedReportPeriod && /hoan thanh/.test(normalizedReportQuestion) && /(?:diem danh|tham du|dang ky|chat luong|phoi hop)/.test(normalizedReportQuestion)) {
        try {
            const directAnswer = await loadCompletedConferenceOutcomeSummary(req.user, requestedReportPeriod);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_completed_conference_outcomes", semantic: false, complexity: "simple" }, sources: [], directAnswer, messages: [] };
        } catch (error) {
            console.error("AI completed conference outcome summary failed:", error.message);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_completed_conference_outcomes", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Hiện chưa truy xuất được số đăng ký, điểm danh và phiếu đánh giá trong kỳ này. Vui lòng thử lại sau.", messages: [] };
        }
    }
    if (classification.isAiFeedbackSummaryQuestion) {
        try {
            const directAnswer = await loadAiAnswerFeedbackSummary(req.user, reportQuestion, requestedReportPeriod);
            return {
                question,
                mode: "fast",
                rag: { used: true, topK: 0, database: true, method: "scoped_sql_ai_answer_feedback", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer,
                messages: []
            };
        } catch (error) {
            console.error("AI answer feedback summary failed:", error.message);
            return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_ai_answer_feedback", semantic: false, complexity: "simple" }, sources: [], directAnswer: "Hiện chưa truy xuất được dữ liệu phản hồi câu trả lời AI. Vui lòng thử lại sau.", messages: [] };
        }
    }
    if (asksContactRequestSummary) {
        try {
            const contactRequestQuestion = currentQuestionAsksContactRequestSummary ? question : reportQuestion;
            const directAnswer = await loadLegalAidContactRequestSummary(req.user, contactRequestQuestion, requestedContactRequestPeriod);
            return {
                question,
                mode: "fast",
                rag: { used: true, topK: 0, database: true, method: "scoped_sql_legal_aid_contact_requests", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer,
                messages: []
            };
        } catch (error) {
            console.error("AI legal aid contact request summary failed:", error);
            return {
                question,
                mode: "fast",
                rag: { used: true, topK: 0, database: true, method: "scoped_sql_legal_aid_contact_requests", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer: "Hiện chưa truy xuất được yêu cầu tư vấn trong kỳ này. Vui lòng thử lại sau.",
                messages: []
            };
        }
    }
    if (!classification.isInScope && !asksForContactReferral && !asksContactFollowupStatus) {
        return {
            question,
            mode: "fast",
            rag: { used: false, topK: 0, database: false, complexity: "simple" },
            sources: [],
            outOfScopeAnswer: classification.isCriminalQuestion ? criminalScopeFallback : outOfScopeFallback,
            messages: []
        };
    }
    const asksAboutAge16To18 = /(?:tu du 16 tuoi den duoi 18|tu 16 tuoi den duoi 18|tu 16 den chua du 18|16 tuoi den duoi 18|16 den duoi 18 tuoi|duoi 18 tuoi)/.test(normalize(question));
    if (classification.isLegalAidQuestion && asksAboutAge16To18) {
        const ageSource = loadKnowledgeBase().find(source => source.id === "tgpl-law-11-2017-age-16-18-current-2026");
        if (ageSource && ["official_government_verified", "verified"].includes(ageSource.source_status) && ageSource.source_url) {
            return {
                question,
                mode: "legal_rag",
                rag: { used: true, topK: 1, database: false, method: "verified_exact_topic", semantic: false, complexity: "simple" },
                sources: sourcesForResponse([{ ...ageSource, score: 1 }]),
                directAnswer: ageSource.answer,
                messages: []
            };
        }
    }
    const asksAboutPoorHousehold = classification.isLegalAidQuestion &&
        /(?:nguoi ngheo|ho ngheo|thuoc ho ngheo)/.test(normalizedQuestion) &&
        /(?:co duoc|duoc huong|thuoc dien|doi tuong|tro giup phap ly)/.test(normalizedQuestion);
    if (asksAboutPoorHousehold) {
        const povertySource = loadKnowledgeBase().find(source => source.id === "tgpl-law-11-2017-article-7-current-2026");
        if (povertySource && ["official_government_verified", "verified"].includes(povertySource.source_status) && povertySource.source_url) {
            return {
                question,
                mode: "legal_rag",
                rag: { used: true, topK: 1, database: false, method: "verified_exact_topic", semantic: false, complexity: "simple" },
                sources: sourcesForResponse([{ ...povertySource, score: 1 }]),
                directAnswer: "Người thuộc hộ nghèo là nhóm được trợ giúp pháp lý theo điểm b khoản 1 Điều 7 Luật Trợ giúp pháp lý. Cần có giấy tờ chứng minh thuộc hộ nghèo; liên hệ Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để kiểm tra hồ sơ cụ thể.",
                messages: []
            };
        }
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [], directAnswer: legalFallback, messages: [] };
    }    if (classification.isLegalAidQuestion && asksAboutAge16To18) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [], directAnswer: legalFallback, messages: [] };
    }
    if (classification.isLegalAidQuestion && classification.isLegalArticleLookup) {
        const articleSource = findVerifiedLegalArticle(question, loadKnowledgeBase());
        const articleAnswer = answerFromExactLegalArticle(articleSource, question);
        if (articleSource && articleAnswer) {
            return {
                question,
                mode: "legal_rag",
                rag: { used: true, topK: 1, database: false, method: "verified_exact_article", semantic: false, complexity: "simple" },
                sources: sourcesForResponse([{ ...articleSource, score: 1 }]),
                directAnswer: articleAnswer,
                messages: []
            };
        }
        if (articleSource && /\bkhoan\s+\d+\b/.test(normalize(question))) {
            return {
                question,
                mode: "legal_rag",
                rag: { used: true, topK: 1, database: false, method: "verified_exact_article_clause_unavailable", semantic: false, complexity: "simple" },
                sources: sourcesForResponse([{ ...articleSource, score: 1 }]),
                directAnswer: "Kho hiện có căn cứ về điều luật nhưng chưa tách được chính xác khoản được hỏi. Vui lòng liên hệ Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để được kiểm tra nội dung cụ thể.",
                messages: []
            };
        }
    }
    const asksLegalAidForms = classification.isLegalAidQuestion &&
        /(?:hinh thuc tro giup phap ly|cac hinh thuc tro giup phap ly|hinh thuc nao.*tro giup phap ly|tro giup phap ly.*hinh thuc nao)/.test(normalizedQuestion);
    if (asksLegalAidForms) {
        const formsSource = loadKnowledgeBase().find(source => source.id === "tgpl-law-11-2017-article-27-original");
        if (formsSource && ["official_government_verified", "verified"].includes(formsSource.source_status) && formsSource.source_url) {
            return {
                question,
                mode: "legal_rag",
                rag: { used: true, topK: 1, database: false, method: "verified_exact_topic", semantic: false, complexity: "simple" },
                sources: sourcesForResponse([{ ...formsSource, score: 1 }]),
                directAnswer: "Theo khoản 2 Điều 27 Luật Trợ giúp pháp lý, có 3 hình thức: (1) tham gia tố tụng; (2) tư vấn pháp luật; (3) đại diện ngoài tố tụng.",
                messages: []
            };
        }
    }
    const asksLegalAidRequiredDocuments = classification.isLegalAidQuestion && isLegalAidRequiredDocumentsQuestion(normalizedReportQuestion);
    if (asksLegalAidRequiredDocuments) {
        const documentsSource = loadKnowledgeBase().find(source => source.id === "tgpl-law-11-2017-article-29-original");
        if (documentsSource && ["official_government_verified", "verified"].includes(documentsSource.source_status) && documentsSource.source_url) {
            return {
                question,
                mode: "legal_rag",
                rag: { used: true, topK: 1, database: false, method: "verified_exact_topic", semantic: false, complexity: "simple" },
                sources: sourcesForResponse([{ ...documentsSource, score: 1 }]),
                directAnswer: "Theo khoản 1 Điều 29 Luật Trợ giúp pháp lý, hồ sơ gồm: (1) đơn yêu cầu trợ giúp pháp lý; (2) giấy tờ chứng minh người yêu cầu thuộc diện được trợ giúp pháp lý; (3) giấy tờ, tài liệu liên quan đến vụ việc.",
                messages: []
            };
        }
    }
    if (classification.isAssignedConsultationQuery) {
        if (!["TASK_ASSIGNEE", "SPEAKER"].includes(req.user.role)) {
            return { question, mode:"fast", rag:{used:false,topK:0,database:false,complexity:"simple"}, sources:[], directAnswer:"Chỉ cán bộ hoặc báo cáo viên được phân công mới xem được yêu cầu tư vấn cụ thể.", messages:[] };
        }
        try {
            const result = await pool.query(`SELECT requester_name,organization_name,question,status,assigned_at,assignment_note
                FROM legal_aid_contact_requests
                WHERE assigned_staff_user_id=$1::uuid AND status IN ('ASSIGNED','CONTACTED','CLOSED')
                ORDER BY CASE status WHEN 'ASSIGNED' THEN 0 WHEN 'CONTACTED' THEN 1 ELSE 2 END,assigned_at DESC LIMIT 30`, [req.user.id]);
            if (!result.rowCount) return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"assigned_contact_requests_by_owner",semantic:false,complexity:"simple"}, sources:[], directAnswer:"Hiện không có yêu cầu tư vấn nào được phân công cho tài khoản này.", messages:[] };
            const statusLabel = {ASSIGNED:"đã phân công, chờ liên hệ",CONTACTED:"đã liên hệ",CLOSED:"đã kết thúc"};
            const directAnswer = `Yêu cầu tư vấn được giao cho bạn (${result.rowCount} mục):\n` + result.rows.map(row => `• ${row.requester_name || "chưa ghi tên"}${row.organization_name ? ` · ${row.organization_name}` : ""}; trạng thái ${statusLabel[row.status] || row.status}; giao lúc ${formatAiDate(row.assigned_at)}; nội dung: ${row.question}${row.assignment_note ? `; ghi chú phân công: ${row.assignment_note}` : ""}.`).join("\n");
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"assigned_contact_requests_by_owner",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
        } catch (error) {
            console.error("Assigned consultation request lookup failed:", error.message);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"assigned_contact_requests_by_owner",semantic:false,complexity:"simple"}, sources:[], directAnswer:"Hiện chưa tải được yêu cầu tư vấn được phân công cho tài khoản này. Vui lòng thử lại sau.", messages:[] };
        }
    }
    if (classification.isAssignedConsultationSummary) {
        if (!["TASK_ASSIGNEE", "SPEAKER"].includes(req.user.role)) return { question, mode:"fast", rag:{used:false,topK:0,database:false,complexity:"simple"}, sources:[], directAnswer:"Chỉ cán bộ hoặc báo cáo viên được phân công mới xem được tiến độ yêu cầu tư vấn của mình.", messages:[] };
        if (!requestedReportPeriod) return { question, mode:"fast", rag:{used:false,topK:0,database:false,complexity:"simple"}, sources:[], directAnswer:"Bạn muốn tổng hợp yêu cầu tư vấn trong kỳ nào? Hãy cho biết tháng/năm, quý/năm, khoảng ngày hoặc “toàn bộ thời gian”.", messages:[] };
        try {
            const result = await pool.query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status='ASSIGNED')::int AS assigned,
                    COUNT(*) FILTER (WHERE status='CONTACTED')::int AS contacted,
                    COUNT(*) FILTER (WHERE status='CLOSED')::int AS closed
                FROM legal_aid_contact_requests
                WHERE assigned_staff_user_id=$1::uuid AND status IN ('ASSIGNED','CONTACTED','CLOSED')
                  AND ($2::date IS NULL OR (assigned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date)
                  AND ($3::date IS NULL OR (assigned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $3::date)`, [req.user.id,requestedReportPeriod.from,requestedReportPeriod.to]);
            const stats = result.rows[0] || {total:0,assigned:0,contacted:0,closed:0};
            const answer = Number(stats.total) === 0
                ? `Không có yêu cầu tư vấn được phân công cho bạn trong ${requestedReportPeriod.label}.`
                : `Tiến độ yêu cầu tư vấn được giao trong ${requestedReportPeriod.label}: ${stats.total} yêu cầu — đang chờ liên hệ ${stats.assigned}, đã liên hệ ${stats.contacted}, đã kết thúc ${stats.closed}.`;
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"assigned_contact_request_progress_by_period",semantic:false,complexity:"simple"}, sources:[], directAnswer:answer, messages:[] };
        } catch (error) {
            console.error("Assigned consultation request progress lookup failed:", error.message);
            return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"assigned_contact_request_progress_by_period",semantic:false,complexity:"simple"}, sources:[], directAnswer:"Hiện chưa tổng hợp được tiến độ yêu cầu tư vấn theo kỳ. Vui lòng thử lại sau.", messages:[] };
        }
    }
    if (classification.isConsultationNoteGuidance) {
        return { question, mode:"fast", rag:{used:false,topK:0,database:false,complexity:"simple"}, sources:[], directAnswer:"Khi ghi ý kiến tư vấn, nên nêu ngắn gọn: (1) vấn đề người dân hỏi, đã lược thông tin định danh; (2) căn cứ pháp luật đã kiểm tra; (3) nội dung có thể hướng dẫn và phần chưa đủ dữ kiện/căn cứ; (4) giấy tờ hoặc bước tiếp theo cần xác minh. Không kết luận hành vi khi thiếu căn cứ. Với yêu cầu được giao, nhập ý kiến ở thẻ yêu cầu tư vấn và bấm “Gửi ý kiến”; nội dung sẽ chờ admin duyệt trước khi dùng làm dữ liệu cải thiện chatbot.", messages:[] };
    }
    if (classification.isInsufficientBasisGuidance) {
        return { question, mode:"fast", rag:{used:false,topK:0,database:false,complexity:"simple"}, sources:[], directAnswer:"Hãy nói rõ hiện chưa đủ căn cứ để kết luận, không suy đoán điều luật hoặc trách nhiệm. Ghi nhận câu hỏi và tài liệu còn thiếu; hướng dẫn người dân gửi yêu cầu tư vấn/trợ giúp pháp lý trên trang chủ để admin phân công, hoặc liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai.", messages:[] };
    }
    if (asksContactFollowupStatus) {
        const directAnswer = req.user.role === "ADMIN"
            ? "Chưa thể xác định thời điểm người dân sẽ được liên hệ vì câu hỏi chưa có mã yêu cầu và website không lưu hạn phản hồi cho từng yêu cầu. Admin có thể mở mục “Yêu cầu tư vấn TGPL” để tra trạng thái, người được phân công và xử lý tiếp."
            : "Tôi chưa tra được hạn liên hệ từ câu hỏi này; hệ thống không lưu thời gian phản hồi cam kết. Vui lòng kiểm tra thông báo/trạng thái yêu cầu trong tài khoản hoặc liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai."
        return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"contact_request_status_guidance",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
    }    if (asksForContactReferral) {
        let requestRecorded = false;
        let alreadyPending = false;
        if (req.user.role !== "ADMIN") {
            try {
                const existing = await pool.query(`SELECT id FROM legal_aid_contact_requests
                    WHERE user_id=$1 AND status IN ('PENDING','ASSIGNED') AND created_at > NOW() - INTERVAL '24 hours'
                    ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
                if (existing.rowCount) {
                    alreadyPending = true;
                } else {
                    await pool.query(`INSERT INTO legal_aid_contact_requests
                        (user_id,username,requester_name,user_role,organization_name,email,phone,question)
                        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
                        req.user.id, req.user.username || "", req.user.full_name || "", req.user.role,
                        req.user.organization_name || "", req.user.email || "", req.user.phone || "", question.slice(0, 1000)
                    ]);
                    requestRecorded = true;
                }
            } catch (error) {
                console.error("Legal aid contact referral notification failed:", error);
            }
        }
        const directAnswer = req.user.role === "ADMIN"
            ? "Mở Trang chủ, chọn mục Gửi yêu cầu tư vấn hoặc trợ giúp pháp lý, nhập họ tên, số điện thoại và nội dung cần tư vấn để gửi admin phân công; người dân cũng có thể liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai."
            : requestRecorded
                ? "Bạn hãy liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để được tư vấn. Tôi đã gửi thông báo đến admin kèm thông tin tài khoản của bạn để xem xét cử trợ giúp viên chủ động liên hệ."
                : alreadyPending
                    ? "Bạn hãy liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để được tư vấn. Admin đã nhận yêu cầu liên hệ của tài khoản bạn trong 24 giờ qua."
                    : "Bạn hãy liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để được tư vấn. Hiện hệ thống chưa gửi được thông báo cho admin; vui lòng liên hệ admin trực tiếp để được kết nối với trợ giúp viên.";
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, method: "contact_referral", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (asksConferenceActionReview) {
        let directAnswer;
        try {
            directAnswer = await loadConferenceActionReviewAnswer(req.user);
        } catch (error) {
            console.error("AI conference reschedule/reassignment review failed:", error.message);
            directAnswer = "Hiện chưa truy xuất được các đề xuất dời lịch và yêu cầu phân công lại. Vui lòng thử lại sau.";
        }
        return { question, mode: "fast", rag: { used: true, topK: 0, database: true, method: "scoped_sql_conference_action_review", semantic: false, complexity: "simple" }, sources: [], directAnswer, messages: [] };
    }
    const currentQuestionPeriod = parseReportPeriod(question);
    const asksConferencePeopleByDate = /(?:ai duoc phan cong|nguoi duoc phan cong|phan cong ai)/.test(normalizedQuestion) && /bao cao vien/.test(normalizedQuestion) && /hoi nghi/.test(normalizedQuestion);
    if (asksConferencePeopleByDate && currentQuestionPeriod && currentQuestionPeriod.from && currentQuestionPeriod.to === new Date(Date.parse(`${currentQuestionPeriod.from}T00:00:00Z`) + 86400000).toISOString().slice(0,10)) {
        let directAnswer;
        try { directAnswer = await loadConferenceStaffByDate(req.user,currentQuestionPeriod); }
        catch (error) {
            console.error("AI conference staff-by-date lookup failed:", error.message);
            directAnswer = "Hiện chưa truy xuất được người được phân công và báo cáo viên theo ngày tổ chức. Vui lòng thử lại sau.";
        }
        return { question, mode:"fast", rag:{used:true,topK:0,database:true,method:"scoped_sql_conference_staff_by_date",semantic:false,complexity:"simple"}, sources:[], directAnswer, messages:[] };
    }    if (classification.isTaskQuery && (asksForOneSpecificConference || asksPostConferenceFollowup) && !hasConferenceCodeInTaskQuestion) {
        return { question, mode: "fast", rag: { used: false, topK: 0, database: false, complexity: "simple" }, sources: [], directAnswer: "Bạn muốn rà soát nhiệm vụ của hội nghị nào? Vui lòng cho mã hội nghị (ví dụ HN-0012) để tôi chỉ lấy nhiệm vụ và kiến nghị gắn với đúng hội nghị.", messages: [] };
    }
    if (classification.isTaskQuery && !classification.isSurveySummaryQuestion) {
        let directAnswer;
        try {
            const explicitAccountTaskQuestion = /tai khoan\s+[a-z0-9._-]+.{0,100}(?:nhiem vu|cong viec)/.test(normalizedQuestion);
            directAnswer = await loadTaskAnswer(req.user, isFollowUp && !explicitAccountTaskQuestion ? retrievalQuestion : question);
        } catch (error) {
            console.error("AI task lookup failed:", error.message);
            directAnswer = "Hiện chưa truy xuất được dữ liệu nhiệm vụ. Vui lòng mở mục Nhắc việc hoặc Phân công tại website và thử lại sau.";
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, method: "scoped_sql_tasks", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (classification.isConferenceRegistrationHelp) {
        const directAnswer = req.user?.role === "COMMUNE"
            ? "Để đăng ký hội nghị cho phường/đơn vị của bạn, mở mục Tạo hội nghị bằng tài khoản người đăng ký. Điền chủ đề, đơn vị đăng ký, thời gian, địa điểm, số người dự kiến, nội dung và hồ sơ đính kèm; sau đó nhấn Lưu đăng ký để gửi admin phê duyệt. Kiểm tra đơn vị đã gắn với tài khoản; nếu tên đơn vị chưa đúng, liên hệ admin cập nhật trước khi gửi."
            : "Người đăng ký dùng tài khoản xã/phường/đơn vị, mở mục Tạo hội nghị, điền chủ đề, đơn vị, thời gian, địa điểm, số người dự kiến, nội dung và hồ sơ đính kèm rồi nhấn Lưu đăng ký để gửi admin phê duyệt. Nếu đơn vị chưa gắn đúng với tài khoản, admin cần cập nhật thông tin đơn vị.";
        return {
            question,
            mode: "fast",
            rag: { used: false, topK: 0, database: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (classification.isOrganizationCompletionRankingQuestion) {
        let directAnswer;
        try {
            directAnswer = await loadCompletedOrganizationRanking(req.user);
        } catch (error) {
            console.error("AI completed conference ranking failed:", error.message);
            directAnswer = "Hiện chưa truy xuất được số liệu hội nghị hoàn thành. Vui lòng thử lại sau.";
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (classification.isConferenceTopicFrequencyQuestion) {
        let directAnswer;
        try {
            directAnswer = await loadConferenceTopicFrequency(req.user, retrievalQuestion);
        } catch (error) {
            console.error("AI conference topic frequency lookup failed:", error.message);
            directAnswer = "Hiện chưa tổng hợp được tần suất nội dung hội nghị. Vui lòng thử lại sau.";
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, method: "scoped_sql_topic_frequency", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (classification.isConferenceOrganizationSummaryQuestion) {
        let directAnswer;
        try {
            directAnswer = await loadOrganizationConferenceSummary(req.user, retrievalQuestion);
        } catch (error) {
            console.error("AI organization conference summary failed:", error);
            directAnswer = "Hiện chưa tổng hợp được kết quả đăng ký của đơn vị. Vui lòng thử lại sau.";
        }
        if (classification.isConferenceAnalysisQuestion && !/(?:trang thai|tinh trang)/.test(normalize(question))) {
            return {
                question,
                mode: "deep_analysis",
                model: OLLAMA_ANALYSIS_MODEL,
                rag: { used: true, topK: 0, database: true, intent: primaryIntent, method: "organization_scoped_sql_then_analysis_model", semantic: false, complexity: "complex" },
                sources: [],
                errorFallback: directAnswer,
                validateAgainstEvidence: true,
                messages: [
                    { role: "system", content: "Bạn phân tích báo cáo hội nghị. Chỉ tổng hợp dữ liệu đã truy vấn cho đúng một đơn vị được nêu dưới đây. Không nêu thêm xã/phường/đơn vị nào khác, không tự thêm dữ liệu, không suy diễn nhân quả. Trả lời tiếng Việt, tối đa 4 gạch đầu dòng ngắn. Nếu dữ liệu nói không có, giữ nguyên kết luận đó.\n\nDỮ LIỆU ĐÃ LỌC THEO ĐƠN VỊ VÀ QUYỀN TÀI KHOẢN:\n" + directAnswer },
                    { role: "user", content: question }
                ]
            };
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, method: "scoped_sql_summary", semantic: false, complexity: "simple" },
            sources: [],
            directAnswer,
            messages: []
        };
    }
    if (classification.isSurveySummaryQuestion) {
        if (classification.isSurveyConferenceEvaluation) {
            let directAnswer;
            try { directAnswer = await loadSurveyConferenceComparison(req.user, retrievalQuestion); }
            catch (error) {
                console.error("AI survey/conference comparison failed:", error);
                directAnswer = "Hiện chưa đối chiếu được dữ liệu khảo sát và hội nghị trong kỳ. Vui lòng thử lại sau.";
            }
            return {
                question,
                mode: "fast",
                rag: { used: true, topK: 0, database: true, method: "scoped_sql_survey_conference_comparison", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer,
                messages: []
            };
        }
        if (classification.isSurveyConferenceEvaluation && !["ADMIN", "COMMUNE"].includes(req.user?.role)) {
            return {
                question,
                mode: "fast",
                rag: { used: false, topK: 0, database: false, method: "survey_role_denied", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer: "Tài khoản này không có quyền xem phiếu khảo sát để đối chiếu với hội nghị. Vui lòng liên hệ admin hoặc dùng tài khoản được cấp quyền.",
                messages: []
            };
        }
        if (classification.isSurveyConferenceEvaluation && !classification.mentionsReportPeriod) {
            return {
                question,
                mode: "fast",
                rag: { used: true, topK: 0, database: true, method: "clarify_survey_conference_period", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer: "Bạn muốn đối chiếu phiếu khảo sát với các hội nghị trong khoảng thời gian nào? Hãy cho biết tháng, quý, năm hoặc khoảng ngày.",
                messages: []
            };
        }
        let surveyEvidence;
        try {
            surveyEvidence = classification.isSurveyLookupQuestion
                ? await loadSurveyRows(req.user, retrievalQuestion)
                : await loadSurveySummary(req.user, retrievalQuestion);
        }
        catch (error) {
            console.error("AI survey summary failed:", error);
            surveyEvidence = "Hiện chưa đọc được dữ liệu khảo sát từ website. Vui lòng thử lại sau; chatbot không tự tạo số liệu khi chưa truy xuất được báo cáo.";
        }
        let conferenceEvidence = "";
        if (classification.isSurveyConferenceEvaluation && ["ADMIN", "COMMUNE"].includes(req.user?.role)) {
            try {
                const loaded = await loadConferenceContext(req.user, retrievalQuestion);
                conferenceEvidence = loaded.context || "Không có hội nghị khớp trong phạm vi tài khoản.";
            } catch (error) {
                console.error("AI survey/conference comparison failed:", error);
                conferenceEvidence = "Không tải được dữ liệu hội nghị trong kỳ; không thể kết luận mức độ đáp ứng nhu cầu khảo sát.";
            }
        }
        const isSimpleSurveySummary = /tong hop.*phieu khao sat/.test(normalizedQuestion) && !/(phan tich|danh gia|xu huong|so sanh|du bao|uu tien)/.test(normalizedQuestion);
        if (!classification.isSurveyConferenceEvaluation && (classification.isSurveyRankingQuestion || classification.isSurveyRatingQuestion || classification.isSurveyAudienceQuestion || classification.isSurveyIssueQuestion || isSimpleSurveySummary)) {
            return {
                question,
                mode: "fast",
                rag: { used: true, topK: 0, database: true, method: "scoped_sql_survey_ranking", semantic: false, complexity: "simple" },
                sources: [],
                directAnswer: surveyEvidence,
                messages: []
            };
        }
        if (classification.isSurveyAnalysisQuestion || classification.isSurveyConferenceEvaluation) {
            const analysisSystem = [
                "Bạn là mô hình phân tích báo cáo cho website điều phối hội nghị.",
                "Chỉ phân tích dữ liệu đã được backend truy vấn và giới hạn theo quyền tài khoản.",
                "Không thêm số liệu, địa bàn, nguyên nhân hoặc kiến thức pháp luật từ trí nhớ. Không suy diễn quan hệ nhân quả.",
                "Nếu dữ liệu thiếu hoặc bằng 0, nói rõ chưa đủ dữ liệu. Trả lời tiếng Việt, tối đa 3 gạch đầu dòng ngắn.",
                "Với đối chiếu khảo sát và hội nghị: nhu cầu trong khảo sát không chứng minh hội nghị đã đáp ứng nhu cầu. Chỉ ghi ‘đã có hội nghị tương ứng’ khi dữ liệu hội nghị hoàn thành trong đúng kỳ có chủ đề/nội dung hoặc địa bàn khớp rõ ràng. Nếu chỉ tên gần giống hoặc mô tả không đủ rõ, ghi ‘chưa xác minh được’; tuyệt đối không viết ‘có thể đã được đáp ứng’.",
                "Nếu người dùng yêu cầu đánh giá, nêu căn cứ định lượng có trong dữ liệu; phân biệt dữ kiện, nhận định và phần chưa đủ dữ liệu. Không liệt kê toàn bộ hội nghị khi chỉ cần kết luận tổng quát."
            ].join(" ");
            const evidence = classification.isSurveyConferenceEvaluation
                ? `DỮ LIỆU PHIẾU KHẢO SÁT ĐÃ LỌC THEO QUYỀN TÀI KHOẢN:\n${surveyEvidence}\n\nDỮ LIỆU HỘI NGHỊ ĐÃ LỌC CÙNG KỲ VÀ CÙNG QUYỀN:\n${conferenceEvidence}`
                : `DỮ LIỆU KHẢO SÁT ĐÃ TRUY VẤN THEO QUYỀN TÀI KHOẢN:\n${surveyEvidence}`;
            const analysisMessages = [
                { role: "system", content: analysisSystem + `\n\n${evidence}` },
                { role: "user", content: question }
            ];
            return {
                question,
                mode: "deep_analysis",
                model: OLLAMA_ANALYSIS_MODEL,
                rag: { used: true, topK: 0, database: true, intent: primaryIntent, method: classification.isSurveyConferenceEvaluation ? "scoped_sql_survey_and_conference_analysis" : "scoped_sql_then_analysis_model", semantic: false, complexity: "complex" },
                sources: [],
                errorFallback: surveyEvidence,
                validateAgainstEvidence: true,
                messages: analysisMessages
            };
        }
        return {
            question,
            mode: "fast",
            rag: { used: true, topK: 0, database: true, complexity: "simple" },
            sources: [],
            directAnswer: surveyEvidence,
            messages: []
        };
    }
    const requestedMode = String(req.body?.mode || "auto").toLowerCase();
    const mode = requestedMode === "auto" || !MODES[requestedMode] ? classification.mode : requestedMode;
    const shouldUseRag = classification.isLegalAidQuestion;
    const isLegalAidServiceQuestion = shouldUseRag && !classification.isLegalArticleLookup && !classification.isLegalAidEligibility &&
        /\b(lien he|lien lac|trung tam|dien thoai|hotline|gui yeu cau|nop ho so|dat lich|hen tu van|quy trinh tiep nhan|cach yeu cau|cach dang ky)\b/.test(normalize(retrievalQuestion));
    // Simple legal questions need one strong source. A small, relevant context
    // reduces unrelated articles and leaves room for the answer within num_ctx.
    const topK = shouldUseRag ? (classification.isComplex ? 3 : 1) : 0;
    let corrections = [];
    try {
        const access = feedbackCorrectionScope(req.user);
        const corrected = await pool.query(`SELECT id, question, correction_text, correction_source_title, correction_source_url
            FROM ai_answer_feedback WHERE ${access.sql} AND vote='INCORRECT' AND status='RESOLVED' AND correction_text<>'' ORDER BY reviewed_at DESC LIMIT 100`, access.values);
        const visible = filterPrivateRagRows({ corrections: corrected.rows }, req.user);
        corrections = visible.corrections
            .filter(row => !classification.isLegalAidQuestion ||
                (row.correction_source_title && row.correction_source_url))
            .map(row => ({ id: `admin-correction-${row.id}`, category: "Đính chính nội bộ do admin rà soát", question: row.question,
                answer: row.correction_text, legal_basis: [], source_status: row.correction_source_url ? "verified" : "admin_corrected",
                source_title: row.correction_source_title || "Đính chính nội bộ do quản trị viên rà soát", source_url: row.correction_source_url,
                search_terms: [row.question, row.correction_text] }));
    } catch (error) { console.error("AI correction sources unavailable:", error.message); }
    let staffTrainingRows = [];
    if (isLegalAidServiceQuestion) {
        const trainingRows = { consultationNotes: [], publicAttendeeTraining: [] };
        try {
            const access = consultationTrainingScope(req.user);
            const reviewedNotes = await pool.query(`SELECT id,author_user_id,training_text FROM legal_aid_contact_feedback
                WHERE ${access.sql} AND training_status='APPROVED' AND training_text<>'' ORDER BY reviewed_at DESC LIMIT 100`, access.values);
            trainingRows.consultationNotes = reviewedNotes.rows;
        } catch (error) { console.error("Approved consultation training unavailable:", error.message); }
        if (canReadPublicAttendeeTraining(req.user)) {
            try {
                const publicTraining = await pool.query(`SELECT id,question,training_text FROM public_attendee_ai_training
                    WHERE training_status='APPROVED' ORDER BY reviewed_at DESC LIMIT 100`);
                trainingRows.publicAttendeeTraining = publicTraining.rows;
            } catch (error) { console.error("Approved public attendee AI training unavailable:", error.message); }
        }
        const visibleTraining = filterPrivateRagRows(trainingRows, req.user);
        staffTrainingRows = visibleTraining.consultationNotes.map(row => ({
                id: `staff-consultation-note-${row.id}`,
                category: "Kinh nghiệm tiếp nhận, hướng dẫn yêu cầu TGPL đã được admin duyệt",
                question: "Kinh nghiệm thực tế về quy trình tiếp nhận và hướng dẫn yêu cầu trợ giúp pháp lý",
                answer: row.training_text,
                legal_basis: [],
                source_status: "staff_training_approved",
                source_title: "Ghi chú nghiệp vụ nội bộ đã được admin duyệt",
                search_terms: ["tiếp nhận yêu cầu tư vấn trợ giúp pháp lý hướng dẫn liên hệ", row.training_text]
            }));
        staffTrainingRows.push(...visibleTraining.publicAttendeeTraining.map(row => ({
                id: `public-attendee-training-${row.id}`,
                category: "Tình huống và hướng dẫn dịch vụ đã được admin rà soát",
                question: row.question,
                answer: row.training_text,
                legal_basis: [],
                source_status: "staff_training_approved",
                source_title: "Tổng hợp nội bộ từ tình huống người dân, đã được admin duyệt",
                search_terms: [row.question, row.training_text, "liên hệ tư vấn trợ giúp pháp lý"]
            })));
    }
    const knowledgeRows = shouldUseRag ? loadKnowledgeBase() : [];
    const retrieval = await retrieveHybrid(retrievalQuestion, topK ? topK + 4 : 3, [...corrections, ...staffTrainingRows], knowledgeRows);
    const exactAgeSource = asksAboutAge16To18
        ? knowledgeRows.find(source => source.id === "tgpl-law-11-2017-age-16-18-current-2026")
        : null;
    const correctionSources = retrieval.results.filter(source =>
        (source.source_status === "admin_corrected" || source.id?.startsWith("admin-correction-")) && source.score >= 0.2
    ).slice(0, 3);
    const staffTrainingSources = retrieval.results.filter(source =>
        source.source_status === "staff_training_approved" && source.score >= 0.2
    ).slice(0, 2);
    const knowledgeSources = topK ? [...new Map((exactAgeSource ? [{ ...exactAgeSource, score: 1 }] : [])
        .concat(retrieval.results.filter(source => (source.source_status === "official_government_verified" || source.source_status === "verified")))
        .map(source => [source.id, source])).values()].slice(0, topK) : [];
    const sources = [...new Map([...correctionSources, ...knowledgeSources].map(source => [source.id, source])).values()]
        .slice(0, topK || 2);
    const enoughContext = sources.length > 0 && sources[0].score >= 0.2;
    const testOnlySources = sources.length > 0 && sources.every(source => String(source.source_status || "").includes("test_dataset"));
    const needsVerifiedCitation = classification.isLegalAidQuestion;
    const verifiedEligibilitySource = sources.some(source =>
        (normalize(source.category).includes("doi tuong tgpl") || source.id?.startsWith("admin-correction-")) &&
        (source.source_status === "official_government_verified" || source.source_status === "verified") && Boolean(source.source_url)
    );
    const normalizedArticleQuestion = normalize(retrievalQuestion);
    const verifiedArticleSource = sources.some(source => {
        if (!(["official_government_verified", "verified"].includes(source.source_status) && source.source_url)) return false;
        const sourceText = normalize([source.category, source.question, source.source_title, ...(source.legal_basis || [])].join(" "));
        const article = normalizedArticleQuestion.match(/\bdieu\s+(\d+[a-z]?)\b/)?.[1];
        if (!article || !sourceText.includes(`dieu ${article}`)) return false;
        if (normalizedArticleQuestion.includes("tro giup phap ly") || normalizedArticleQuestion.includes("tgpl")) return sourceText.includes("luat tro giup phap ly");
        return source.score >= 0.65;
    });
    const legalFallbackRequired = (classification.isLegalAidEligibility && !verifiedEligibilitySource) ||
        (classification.isLegalArticleLookup && !verifiedArticleSource) ||
        (shouldUseRag && needsVerifiedCitation && (!enoughContext || (classification.isLegalAidQuestion && testOnlySources)));
    const legalAidArticle7Source = sources.find(source => source.id === "tgpl-law-11-2017-article-7-current-2026");
    const legalAidAgeSource = sources.find(source => source.id === "tgpl-law-11-2017-age-16-18-current-2026");
    let directAnswer = !legalFallbackRequired && legalAidAgeSource && asksAboutAge16To18
        ? "Có, nhưng không chỉ dựa vào độ tuổi. Theo nhóm đối tượng tại Điều 7 Luật Trợ giúp pháp lý (được cập nhật từ 01/01/2026), người từ đủ 16 đến dưới 18 tuổi được trợ giúp khi thuộc một trong các trường hợp luật liệt kê: bị tố giác, bị kiến nghị khởi tố, bị giữ trong trường hợp khẩn cấp, bị buộc tội, là bị hại hoặc người làm chứng, đang chấp hành biện pháp xử lý chuyển hướng, hoặc là phạm nhân. Nếu không thuộc các trường hợp này, chỉ riêng độ tuổi chưa đủ căn cứ xác định thuộc diện theo nhóm này."
        : !legalFallbackRequired && legalAidArticle7Source &&
            (classification.isLegalAidEligibility || /\bdieu\s+7\b/.test(normalize(retrievalQuestion)))
            ? legalAidArticle7Source.answer : "";
    let conferenceContext = "";
    let conferenceFallback = "";
    let analysisModel = "";
    const fallbackAnswer = legalFallback;
    const roleNames = { ADMIN: "quản trị viên", COMMUNE: "người đăng ký hội nghị", TASK_ASSIGNEE: "người nhận nhiệm vụ", SPEAKER: "báo cáo viên" };
    const roleName = roleNames[req.user?.role] || "người dùng";
    let taskContext = "";
    if (classification.isTaskQuery && !classification.isSurveySummaryQuestion) {
        try { taskContext = await loadTaskContext(req.user); }
        catch (error) {
            console.error("AI task context unavailable:", error.message);
            taskContext = "Không tải được danh sách nhiệm vụ từ website lúc này; không suy đoán nhiệm vụ hoặc hạn xử lý.";
        }
    }
    const systemGuide = {
        ADMIN: "Tài khoản admin quản lý hội nghị, phê duyệt yêu cầu và phân công nhiệm vụ trên các trang quản trị được cấp quyền.",
        COMMUNE: "Tài khoản người đăng ký tạo yêu cầu tại create-conference.html và theo dõi hội nghị của đơn vị tại conference-list.html; dữ liệu đơn vị khác chỉ xuất hiện nếu hội nghị đã phê duyệt được mở đăng ký tham dự.",
        TASK_ASSIGNEE: "Tài khoản người nhận nhiệm vụ xem phân công tại staff-portal.html; chỉ cập nhật trạng thái và tệp của nhiệm vụ được giao cho chính mình.",
        SPEAKER: "Tài khoản báo cáo viên xem lịch và nội dung được phân công tại staff-portal.html; chỉ thao tác với phần phân công của chính mình."
    }[req.user?.role] || "";
    let system = "Bạn là trợ lý giới hạn phạm vi trong website điều phối hội nghị và trợ giúp pháp lý. Người hỏi là " + roleName + ". Chỉ trả lời tra cứu hội nghị theo dữ liệu trong website đã được backend giới hạn cho tài khoản; hướng dẫn sử dụng chức năng website; nhiệm vụ trong phạm vi tài khoản; hoặc câu hỏi thuộc Luật Trợ giúp pháp lý có căn cứ trong kho. Với câu hỏi pháp luật, chỉ dùng nguồn Luật Trợ giúp pháp lý trong ngữ cảnh, dẫn chính xác Điều/Khoản khi có. Không trả lời luật hoặc chủ đề khác, không suy đoán, không dùng kiến thức mô hình. Nếu ngữ cảnh không đủ, nói rõ chưa có dữ liệu và hướng người dùng liên hệ trực tiếp Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai. Trả lời ngắn gọn, tối đa 3 câu.\n\nHƯỚNG DẪN THEO VAI TRÒ TỪ WEBSITE:\n" + systemGuide;
    if (shouldUseRag) system += "\n\nNGUỒN LUẬT TGPL DUY NHẤT:\n" + buildContext(sources);
    if (staffTrainingSources.length && isLegalAidServiceQuestion) {
        system += "\n\nGHI CHÚ QUY TRÌNH NỘI BỘ ĐÃ ĐƯỢC ADMIN DUYỆT (chỉ tham khảo cho tiếp nhận, hướng dẫn liên hệ; không phải căn cứ pháp luật và không được dùng để kết luận quyền hoặc điều kiện TGPL):\n" +
            buildContext(staffTrainingSources) + "\nChỉ dùng nếu liên quan trực tiếp câu hỏi. Nếu mâu thuẫn với luật hoặc nguồn chính thức, bỏ qua. Nội dung này đã được admin viết lại ở dạng khái quát, không chứa thông tin định danh.";
    }
    if (taskContext) system += "\n\n" + taskContext;

    if (classification.isConferenceDataQuestion) {
        try {
            const loaded = await loadConferenceContext(req.user, retrievalQuestion);
            conferenceContext = loaded.context;
            conferenceFallback = loaded.fallback;
        } catch (error) {
            console.error("AI conference lookup failed:", error.message);
            conferenceContext = "DỮ LIỆU HỘI NGHỊ HIỆN KHÔNG TẢI ĐƯỢC. Không trả lời bằng kiến thức nhớ sẵn; hãy nói rõ cần thử lại sau.";
            conferenceFallback = "Hiện chưa tải được dữ liệu hội nghị từ website. Vui lòng thử lại sau.";
        }
        if (classification.isConferenceAnalysisQuestion && !/(?:trang thai|tinh trang)/.test(normalize(question))) {
            if (classification.mentionsReportPeriod && ["ADMIN", "COMMUNE"].includes(req.user?.role)) {
                try {
                    const surveyEvidence = await loadSurveySummary(req.user, question);
                    conferenceContext += `\n\nPHIẾU KHẢO SÁT TRONG CÙNG KỲ, ĐÃ LỌC THEO QUYỀN TÀI KHOẢN:\n${surveyEvidence}`;
                    conferenceFallback = trimAtLineBoundary(`${conferenceFallback}\n\n${surveyEvidence}`, 2200);
                } catch (error) {
                    console.error("AI period survey lookup failed:", error.message);
                }
            }
            analysisModel = OLLAMA_ANALYSIS_MODEL;
            system += "\n\nPHÂN TÍCH BÁO CÁO: Dữ liệu đầu vào bên dưới đã được truy vấn từ website và giới hạn theo quyền tài khoản. Hãy tổng hợp, so sánh hoặc nhận xét đúng yêu cầu; chỉ dùng số liệu có trong dữ liệu. Không đưa ví dụ mẫu, địa bàn khác, nội dung pháp luật hoặc số liệu tự tạo. Nếu người dùng nêu xã/phường/đơn vị, chỉ kết luận trong phần dữ liệu khớp tên đó; nếu không có thì nói không tìm thấy. Không khẳng định nguyên nhân từ tương quan. Trả lời tối đa 4 gạch đầu dòng, câu ngắn. Nếu dữ liệu không đủ, ghi rõ giới hạn.\n\n" + conferenceContext;
        } else {
            system += "\n\nTRA CỨU HỘI NGHỊ: Trả lời trực tiếp theo dữ liệu website bên dưới. Lọc theo mã, tên, đơn vị, trạng thái, ngày, địa điểm hoặc quy mô. Phạm vi đã được backend giới hạn theo tài khoản. Không thêm dữ liệu ngoài kết quả truy vấn. Nêu mã hội nghị để người dùng tìm lại.\n\n" + conferenceContext;
            directAnswer = conferenceFallback;
        }
    }
    const sourcedFallback = answerFromSources(sources);
    const errorFallback = classification.isConferenceDataQuestion ? conferenceFallback : sourcedFallback;
    if (conversationMemory.promptText) system += "\n\n" + conversationMemory.promptText;
    system += "\n\nNHẬN DIỆN ĐÚNG Ý ĐỊNH: Không biến câu hỏi về quyền/điều kiện trợ giúp pháp lý thành đề xuất, đăng ký hoặc tham gia hội nghị. Chỉ đưa nội dung hội nghị khi câu hỏi hiện tại hỏi rõ về hội nghị; không dùng đoạn hội nghị cũ để trả lời câu hỏi mới độc lập.\n\nPHẠM VI CÂU TRẢ LỜI: Chỉ trả lời đúng trường thông tin, điều luật, kỳ thời gian và nhóm dữ liệu được hỏi. Không tự thêm điều luật khác, danh sách hội nghị không được yêu cầu, ví dụ mẫu hoặc lời khuyên ngoài câu hỏi. Với câu hỏi tổng hợp, nêu kết quả đếm/tính trực tiếp từ dữ liệu truy vấn; không để mô hình tự tính lại số liệu.";
    if (normalize(question).split(/\s+/).filter(Boolean).length <= 8) {
        system += "\n\nCÂU HỎI NGẮN: Trả lời trực tiếp, tối đa 2 câu hoặc 50 từ. Nếu câu hỏi chỉ nêu tên điều luật mà kho không có đúng nội dung đã xác minh, không đoán nội dung điều; hãy nói rõ chưa có căn cứ và hướng dẫn liên hệ Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai.";
    }
    const adminCorrections = sources.filter(source => source.id?.startsWith("admin-correction-"));
    if (adminCorrections.length) {
        system += "\n\nĐÍNH CHÍNH NỘI BỘ ĐÃ ĐƯỢC ADMIN RÀ SOÁT (chỉ áp dụng khi đúng chủ đề câu hỏi):\n" +
            adminCorrections.map(source => `- Câu hỏi đã sửa: ${source.question}\n  Nội dung đính chính: ${source.answer}`).join("\n");
        system += "\nDùng nội dung đính chính phù hợp để sửa câu trả lời trước đó. Đính chính không có liên kết nguồn chỉ được dùng cho nội dung phi pháp lý; không biến nội dung nội bộ thành căn cứ pháp luật hoặc mở rộng sang chủ đề khác.";
    }
    return {
        question,
        mode,
        rag: { used: shouldUseRag || Boolean(conferenceContext) || adminCorrections.length > 0 || staffTrainingSources.length > 0, topK, database: Boolean(conferenceContext), intent: primaryIntent, method: shouldUseRag ? retrieval.method : "keyword_fallback", semantic: shouldUseRag && retrieval.semanticAvailable, complexity: classification.isComplex ? "complex" : "simple" },
        sources: sourcesForResponse(sources),
        legalFallbackRequired,
        directAnswer,
        model: analysisModel || undefined,
        fallbackAnswer,
        errorFallback,
        validateAgainstEvidence: Boolean(conferenceContext && classification.isConferenceAnalysisQuestion),
        messages: [{ role: "system", content: system }, { role: "user", content: question }],
        resolvedClassification: currentClassification
    };
}

function sendNdjson(res, payload) {
    if (!res.destroyed && res.writable) res.write(JSON.stringify(payload) + "\n");
}

async function streamAnswer(res, chat, controller) {
    if (chat.outOfScopeAnswer) {
        sendNdjson(res, { type: "token", text: chat.outOfScopeAnswer });
        sendNdjson(res, { type: "done", sources: [] });
        return;
    }
    if (chat.directAnswer) {
        sendNdjson(res, { type: "token", text: chat.directAnswer });
        sendNdjson(res, { type: "done", sources: chat.sources });
        return;
    }
    if (chat.legalFallbackRequired) {
        sendNdjson(res, { type: "token", text: chat.fallbackAnswer || legalFallback });
        sendNdjson(res, { type: "done", sources: chat.sources });
        return;
    }

    const response = await streamChatWithOllama(chat.messages, { mode: chat.mode, model: chat.model, signal: controller.signal });
    if (!response.body) throw new Error("Ollama không trả về luồng dữ liệu.");
    const decoder = new TextDecoder();
    let buffer = "";
    let generatedAnswer = "";
    let replacedByEvidence = false;
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (!line.trim()) continue;
            const item = JSON.parse(line);
            if (item.error) throw new Error(item.error);
            if (item.message?.content) generatedAnswer += item.message.content;
        }
    }
    if (buffer.trim()) {
        const item = JSON.parse(buffer);
        if (item.error) throw new Error(item.error);
        if (item.message?.content) generatedAnswer += item.message.content;
    }
    if (!generatedAnswer.trim()) {
        if (!chat.errorFallback) throw new Error("Ollama hoàn tất nhưng không trả nội dung.");
        controller.hadOutput = true;
        sendNdjson(res, { type: "token", text: chat.errorFallback });
        sendNdjson(res, { type: "done", sources: chat.sources, degraded: true, outputValidation: chat.validateAgainstEvidence ? "fallback_evidence" : "not_applicable" });
        return;
    }
    if (classifyQuestion(chat.question).isLegalAidQuestion && !hasCompleteAnswerEnding(generatedAnswer)) {
        controller.hadOutput = true;
        sendNdjson(res, { type: "token", text: chat.fallbackAnswer || legalFallback });
        sendNdjson(res, { type: "done", sources: chat.sources, degraded: true, outputValidation: "incomplete_answer_fallback" });
        return;
    }
    if (chat.validateAgainstEvidence) {
        const validation = validateStructuredAnswer(generatedAnswer, chat.messages);
        if (!validation.ok) {
            console.warn("AI structured answer rejected:", validation.reason);
            generatedAnswer = chat.errorFallback || "Phần phân tích chưa khớp hoàn toàn với dữ liệu đã truy vấn; vui lòng thử lại với yêu cầu cụ thể hơn.";
            replacedByEvidence = true;
        }
    }
    controller.hadOutput = true;
    sendNdjson(res, { type: "token", text: generatedAnswer });
    sendNdjson(res, { type: "done", sources: chat.sources, outputValidation: chat.validateAgainstEvidence ? (replacedByEvidence ? "replaced_with_evidence" : "passed") : "not_applicable" });
}

router.post("/tgpl-chat", requireRole(...aiRoles), async (req, res) => {
    let chat;
    try { chat = await prepareChat(req); }
    catch (error) {
        console.error("TGPL AI context preparation failed:", error);
        return res.status(503).json({ ok: false, error: "Không tải được dữ liệu cần thiết. Vui lòng thử lại sau hoặc kiểm tra cấu hình database." });
    }
    if (chat.error) return res.status(400).json({ ok: false, error: chat.error });
    let answer = "";
    let degraded = false;
    let outputValidation = chat.validateAgainstEvidence ? "pending" : "not_applicable";
    try {
        answer = chat.outOfScopeAnswer || chat.directAnswer || (chat.legalFallbackRequired
            ? (chat.fallbackAnswer || legalFallback)
            : await chatWithOllama(chat.messages, { mode: chat.mode, model: chat.model }));
        if (!String(answer || "").trim()) throw new Error("Ollama hoàn tất nhưng không trả nội dung.");
        if (chat.validateAgainstEvidence) {
            const validation = validateStructuredAnswer(answer, chat.messages);
            if (!validation.ok) {
                console.warn("AI structured answer rejected:", validation.reason);
                answer = chat.errorFallback || "Phần phân tích chưa khớp hoàn toàn với dữ liệu đã truy vấn; vui lòng thử lại với yêu cầu cụ thể hơn.";
                degraded = true;
                outputValidation = "replaced_with_evidence";
            } else {
                outputValidation = "passed";
            }
        }
    } catch (error) {
        console.error("TGPL AI chat failed:", error);
        if (!chat.errorFallback) return res.status(502).json({ ok: false, error: "Ollama không phản hồi kịp thời. Vui lòng thử lại; hệ thống chưa có đủ căn cứ để tự trả lời an toàn." });
        answer = chat.errorFallback;
        degraded = true;
    }
    const finalClassification = chat.resolvedClassification || classifyQuestion(chat.question);
    if (finalClassification.isLegalAidQuestion && !chat.directAnswer && !hasCompleteAnswerEnding(answer)) {
        answer = chat.fallbackAnswer || legalFallback;
        degraded = true;
        outputValidation = "incomplete_answer_fallback";
    }
    res.json({ ok: true, answer, degraded, mode: chat.mode, outputValidation, intent: finalClassification.intent,
        intentConfidence: finalClassification.intentConfidence, querySlots: finalClassification.querySlots,
        rag: chat.rag, sources: chat.sources });
});

router.post("/tgpl-chat/stream", requireRole(...aiRoles), async (req, res) => {
    let chat;
    try { chat = await prepareChat(req); }
    catch (error) {
        console.error("TGPL AI context preparation failed:", error);
        return res.status(503).json({ ok: false, error: "Không tải được dữ liệu cần thiết. Vui lòng thử lại sau hoặc kiểm tra cấu hình database." });
    }
    if (chat.error) return res.status(400).json({ ok: false, error: chat.error });
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    res.status(200);
    res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
        const classification = chat.resolvedClassification || classifyQuestion(chat.question);
        sendNdjson(res, { type: "meta", mode: chat.mode, intent: classification.intent, intentConfidence: classification.intentConfidence, querySlots: classification.querySlots, outputValidation: chat.validateAgainstEvidence ? "pending" : "not_applicable", rag: chat.rag });
    try {
        await streamAnswer(res, chat, controller);
    } catch (error) {
        if (!controller.signal.aborted) {
            console.error("TGPL AI stream failed:", error);
            if (!controller.hadOutput && chat.errorFallback) {
                sendNdjson(res, { type: "token", text: chat.errorFallback });
                sendNdjson(res, { type: "done", sources: chat.sources, degraded: true });
            } else {
                sendNdjson(res, { type: "error", error: "Ollama không phản hồi kịp thời. Vui lòng thử lại; hệ thống chưa có đủ căn cứ để tự trả lời an toàn." });
            }
        }
    } finally {
        if (!res.destroyed && !res.writableEnded) res.end();
    }
});

router.post("/tgpl-chat/feedback", requireRole(...aiRoles), async (req, res) => {
    const vote = String(req.body?.vote || "").toUpperCase();
    const question = String(req.body?.question || "").trim().slice(0, 4000);
    const answer = String(req.body?.answer || "").trim().slice(0, 12000);
    if (!["CORRECT", "INCORRECT"].includes(vote) || question.length < 3 || answer.length < 1) {
        return res.status(400).json({ ok: false, error: "Thiếu nội dung hoặc lựa chọn bình chọn không hợp lệ." });
    }
    try {
        const validReasons = new Set(["WRONG_DATA", "WRONG_SCOPE", "IRRELEVANT", "INCOMPLETE", "TOO_LONG", "MISSING_SOURCE", "OTHER", "UNSPECIFIED"]);
        const reasonCode = vote === "INCORRECT" ? String(req.body?.reason_code || "UNSPECIFIED").toUpperCase() : "UNSPECIFIED";
        if (!validReasons.has(reasonCode) || (vote === "INCORRECT" && reasonCode === "UNSPECIFIED")) {
            return res.status(400).json({ ok: false, error: "Hãy chọn lý do phản hồi câu trả lời chưa chính xác." });
        }
        const result = await pool.query(`INSERT INTO ai_answer_feedback (user_id, username, user_role, question, answer, vote, reason_code, sources)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id, created_at`,
        [req.user.id, req.user.username || "", req.user.role, question, answer, vote, reasonCode, JSON.stringify(Array.isArray(req.body?.sources) ? req.body.sources.slice(0, 5) : [])]);
        res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
        console.error("AI feedback save failed:", error);
        res.status(500).json({ ok: false, error: "Không lưu được ý kiến. Hãy thử lại." });
    }
});

function redactContactDetails(value) {
    return String(value || "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[đã ẩn email]")
        .replace(/\b(?:\+?84|0)(?:[\s().-]*\d){8,10}\b/g, "[đã ẩn số điện thoại]");
}

function redactKnownIdentity(value, identityValues = []) {
    let text = redactContactDetails(value);
    for (const identity of identityValues) {
        const sensitive = String(identity || "").trim();
        if (sensitive.length < 3) continue;
        const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(escaped, "giu"), "[đã ẩn thông tin định danh]");
    }
    return text;
}

router.post("/public-attendee-consultations/summarize", requireRole("ADMIN"), async (req, res) => {
    try {
        const result = await pool.query(`SELECT r.consultation_situation,r.attendee_name,r.attendee_address,r.attendee_email,c.code,c.title,r.created_at
            FROM public_attendance_registrations r JOIN conferences c ON c.id=r.conference_id
            WHERE NULLIF(BTRIM(r.consultation_situation),'') IS NOT NULL
            ORDER BY r.created_at DESC LIMIT 150`);
        if (!result.rowCount) return res.status(404).json({ ok: false, error: "Chưa có nội dung tình huống tư vấn nào trong đăng ký tham dự công khai." });
        // Use identity fields only to redact matching text. Never include them in the Ollama prompt.
        const situations = result.rows.map((row, index) => {
            const identities = [row.attendee_name, row.attendee_address, row.attendee_email];
            const safeText = redactKnownIdentity(row.consultation_situation, identities).slice(0, 2000);
            return `${index + 1}. Hội nghị ${row.code} · ${String(row.title || "").slice(0, 120)} · ${new Date(row.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}: ${safeText}`;
        });
        const model = process.env.OLLAMA_ANALYSIS_MODEL || process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
        const prompt = `Tổng hợp các tình huống tư vấn người dân tự nguyện gửi khi đăng ký dự hội nghị. Chỉ dựa trên danh sách, không bịa luật hoặc kết luận quyền hưởng trợ giúp pháp lý. Tạo tối đa 5 chủ đề và tối đa 5 cặp FAQ ngắn. Câu trả lời phải hướng dẫn an toàn, nêu giới hạn nếu thiếu dữ kiện và khuyến nghị liên hệ Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai để được tư vấn vụ việc cụ thể. Không đưa thông tin định danh. Đây chỉ là bản nháp chờ admin duyệt, không xem là nguồn luật. Trả JSON thuần: {"summary":"...","themes":[{"theme":"...","count":1}],"drafts":[{"question":"...","answer":"...","source_count":1}]}. Dữ liệu:\n${situations.join("\n")}`;
        const response = await fetch("http://127.0.0.1:11434/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ model, stream: false, think: false, keep_alive: "30m", format: "json",
                options: { temperature: 0.1, num_ctx: 4096, num_predict: 1000 },
                messages: [{ role: "user", content: prompt }] })
        });
        const modelResult = await response.json().catch(() => ({}));
        if (!response.ok) return res.status(502).json({ ok: false, error: "Ollama chưa tạo được bản tổng hợp. Hãy kiểm tra mô hình rồi thử lại." });
        const raw = String(modelResult.message?.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        let generated;
        try { generated = JSON.parse(raw); } catch { return res.status(502).json({ ok: false, error: "AI trả dữ liệu không đúng định dạng; chưa lưu nội dung huấn luyện." }); }
        const drafts = (Array.isArray(generated.drafts) ? generated.drafts : []).map(item => ({
            question: redactContactDetails(String(item.question || "").trim()).slice(0, 1200),
            answer: redactContactDetails(String(item.answer || "").trim()).slice(0, 4000),
            source_count: Math.max(1, Math.min(result.rowCount, Number.parseInt(item.source_count, 10) || 1))
        })).filter(item => item.question.length >= 5 && item.answer.length >= 20).slice(0, 5);
        if (!drafts.length) return res.status(502).json({ ok: false, error: "AI chưa tạo được câu hỏi và trả lời đủ nội dung để admin rà soát." });
        const dates = result.rows.map(row => new Date(row.created_at)).filter(date => !Number.isNaN(date.getTime())).sort((a, b) => a - b);
        const periodStart = dates[0]?.toISOString().slice(0, 10) || null;
        const periodEnd = dates.at(-1)?.toISOString().slice(0, 10) || null;
        const saved = [];
        for (const draft of drafts) {
            const row = await pool.query(`INSERT INTO public_attendee_ai_training
                (question,training_text,source_count,period_start,period_end,created_by)
                VALUES($1,$2,$3,$4::date,$5::date,$6) RETURNING id,question,training_text,source_count,training_status,created_at`,
            [draft.question, draft.answer, draft.source_count, periodStart, periodEnd, req.user.id]);
            saved.push(row.rows[0]);
        }
        res.json({ ok: true, data: { summary: String(generated.summary || "").slice(0, 3000), themes: Array.isArray(generated.themes) ? generated.themes.slice(0, 8) : [], source_count: result.rowCount, drafts: saved } });
    } catch (error) {
        console.error("Public attendee consultation summary failed:", error.message);
        res.status(502).json({ ok: false, error: "Không tổng hợp được tình huống tư vấn. Kiểm tra database và Ollama rồi thử lại." });
    }
});

router.get("/public-attendee-consultations/training", requireRole("ADMIN"), async (_req, res) => {
    try {
        const result = await pool.query(`SELECT id,question,training_text,source_count,period_start,period_end,training_status,admin_note,created_at,reviewed_at
            FROM public_attendee_ai_training ORDER BY CASE training_status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,created_at DESC LIMIT 200`);
        res.json({ ok: true, data: result.rows });
    } catch (error) {
        console.error("Public attendee AI training list failed:", error.message);
        res.status(500).json({ ok: false, error: "Không tải được bản nháp huấn luyện từ tình huống người dân." });
    }
});

router.patch("/public-attendee-consultations/training/:id", requireRole("ADMIN"), async (req, res) => {
    const status = String(req.body?.training_status || "").toUpperCase();
    const question = redactContactDetails(String(req.body?.question || "").trim()).slice(0, 1200);
    const trainingText = redactContactDetails(String(req.body?.training_text || "").trim()).slice(0, 4000);
    const adminNote = String(req.body?.admin_note || "").trim().slice(0, 1000);
    if (!["APPROVED", "REJECTED"].includes(status)) return res.status(400).json({ ok: false, error: "Chọn duyệt hoặc từ chối bản nháp." });
    if (status === "APPROVED" && (question.length < 5 || trainingText.length < 20)) return res.status(400).json({ ok: false, error: "Câu hỏi cần ít nhất 5 ký tự và câu trả lời ít nhất 20 ký tự." });
    try {
        const result = await pool.query(`UPDATE public_attendee_ai_training
            SET question=CASE WHEN $1='APPROVED' THEN $2 ELSE question END,
                training_text=CASE WHEN $1='APPROVED' THEN $3 ELSE training_text END,
                training_status=$1,admin_note=$4,reviewed_by=$5,reviewed_at=NOW()
            WHERE id=$6::uuid RETURNING id,question,training_text,training_status,admin_note,reviewed_at`,
        [status, question, trainingText, adminNote, req.user.id, req.params.id]);
        if (!result.rowCount) return res.status(404).json({ ok: false, error: "Không tìm thấy bản nháp huấn luyện." });
        res.json({ ok: true, data: result.rows[0], message: status === "APPROVED" ? "Đã duyệt. Chatbot sẽ dùng nội dung này làm hướng dẫn nội bộ cho câu hỏi liên quan." : "Đã từ chối bản nháp." });
    } catch (error) {
        console.error("Public attendee AI training review failed:", error.message);
        res.status(500).json({ ok: false, error: "Không cập nhật được trạng thái bản nháp." });
    }
});

router.get("/feedback", requireRole("ADMIN"), async (_req, res) => {
    try {
        const result = await pool.query(`SELECT id, username, user_role, question, answer, vote, reason_code, sources, status, admin_note,
            correction_text, correction_source_title, correction_source_url, created_at, reviewed_at
            FROM ai_answer_feedback ORDER BY (vote='INCORRECT') DESC, created_at DESC LIMIT 200`);
        res.json({ ok: true, data: result.rows });
    } catch (error) {
        console.error("AI feedback list failed:", error);
        res.status(500).json({ ok: false, error: "Không tải được phản hồi chatbot." });
    }
});

router.get("/contact-requests", requireRole("ADMIN"), async (_req, res) => {
    const limit = Math.max(1, Math.min(1000, Number.parseInt(_req.query.limit, 10) || 200));
    const offset = Math.max(0, Number.parseInt(_req.query.offset, 10) || 0);
    try {
        const result = await pool.query(`SELECT r.id,r.username,r.requester_name,r.user_role,r.organization_name,r.email,r.phone,r.question,
                r.status,r.created_at,r.assigned_staff_user_id,r.assigned_staff_name,r.assignment_note,r.assigned_at,r.contact_completed_at,r.updated_at,
                u.full_name AS assigned_by_name, staff.full_name AS assigned_account_name,
                COALESCE((SELECT json_agg(json_build_object(
                    'id',f.id,'content',f.content,'training_status',f.training_status,'admin_note',f.admin_note,
                    'training_text',f.training_text,'created_at',f.created_at,'reviewed_at',f.reviewed_at,
                    'author_name',author.full_name,'reviewer_name',reviewer.full_name
                ) ORDER BY f.created_at DESC) FROM legal_aid_contact_feedback f
                    JOIN users author ON author.id=f.author_user_id
                    LEFT JOIN users reviewer ON reviewer.id=f.reviewed_by
                    WHERE f.contact_request_id=r.id), '[]'::json) AS feedback
            FROM legal_aid_contact_requests r
            LEFT JOIN users u ON u.id=r.assigned_by
            LEFT JOIN users staff ON staff.id=r.assigned_staff_user_id
            ORDER BY CASE r.status WHEN 'PENDING' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'CONTACTED' THEN 2 ELSE 3 END, r.created_at DESC, r.id DESC
            LIMIT $1 OFFSET $2`, [limit, offset]);
        res.json({ ok: true, data: result.rows });
    } catch (error) {
        console.error("Legal aid contact requests could not be listed:", error);
        res.status(500).json({ ok: false, error: "Không tải được yêu cầu liên hệ trợ giúp pháp lý." });
    }
});

router.get("/my-contact-requests", requireRole(...AI_ROLE_POLICIES.assignedContactRequests), async (req, res) => {
    try {
        const result = await pool.query(`SELECT r.id,r.requester_name,r.user_role,r.organization_name,r.email,r.phone,r.question,
                r.status,r.created_at,r.assigned_staff_name,r.assigned_at,r.assignment_note,r.contact_completed_at,r.updated_at,
                COALESCE((SELECT json_agg(json_build_object(
                    'id',f.id,'content',f.content,'training_status',f.training_status,
                    'created_at',f.created_at,'reviewed_at',f.reviewed_at,'author_name',author.full_name
                ) ORDER BY f.created_at DESC) FROM legal_aid_contact_feedback f
                    JOIN users author ON author.id=f.author_user_id WHERE f.contact_request_id=r.id), '[]'::json) AS feedback
            FROM legal_aid_contact_requests r
            WHERE r.assigned_staff_user_id=$1::uuid AND r.status IN ('ASSIGNED','CONTACTED','CLOSED')
            ORDER BY CASE r.status WHEN 'ASSIGNED' THEN 0 WHEN 'CONTACTED' THEN 1 ELSE 2 END,r.updated_at DESC
            LIMIT 200`, [req.user.id]);
        res.json({ ok: true, data: result.rows });
    } catch (error) {
        console.error("Assigned legal aid contact requests could not be listed:", error);
        res.status(500).json({ ok: false, error: "Không tải được yêu cầu tư vấn được giao." });
    }
});

router.post("/my-contact-requests/:id/feedback", requireRole("TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    const content = String(req.body?.content || "").trim().slice(0, 4000);
    if (content.length < 5) return res.status(400).json({ ok: false, error: "Ý kiến cần có ít nhất 5 ký tự." });
    try {
        const request = await pool.query(`SELECT id FROM legal_aid_contact_requests
            WHERE id=$1::uuid AND assigned_staff_user_id=$2::uuid AND status IN ('ASSIGNED','CONTACTED')`, [req.params.id, req.user.id]);
        if (!request.rowCount) return res.status(404).json({ ok: false, error: "Không tìm thấy yêu cầu tư vấn đang được giao cho tài khoản này." });
        const result = await pool.query(`INSERT INTO legal_aid_contact_feedback(contact_request_id,author_user_id,content)
            VALUES($1,$2,$3) RETURNING id,content,training_status,created_at`, [request.rows[0].id, req.user.id, content]);
        res.status(201).json({ ok: true, data: result.rows[0], message: "Đã lưu ý kiến và gửi admin duyệt làm nguồn cải thiện chatbot." });
    } catch (error) {
        console.error("Legal aid consultation feedback could not be saved:", error);
        res.status(500).json({ ok: false, error: "Không lưu được ý kiến tư vấn." });
    }
});

router.patch("/contact-feedback/:id", requireRole("ADMIN"), async (req, res) => {
    const status = String(req.body?.training_status || "").toUpperCase();
    const adminNote = String(req.body?.admin_note || "").trim().slice(0, 1000);
    const trainingText = String(req.body?.training_text || "").trim().slice(0, 2500);
    if (!["APPROVED", "REJECTED"].includes(status)) return res.status(400).json({ ok: false, error: "Trạng thái duyệt ý kiến không hợp lệ." });
    if (status === "APPROVED" && trainingText.length < 20) return res.status(400).json({ ok: false, error: "Hãy viết bản tóm tắt nghiệp vụ đã ẩn danh (ít nhất 20 ký tự) trước khi đưa vào kho chatbot." });
    if (status === "APPROVED" && (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(trainingText) || /(?:\+?\d[\s().-]*){9,}/.test(trainingText))) {
        return res.status(400).json({ ok: false, error: "Bản tóm tắt có thể chứa email hoặc số điện thoại. Hãy xóa thông tin định danh trước khi duyệt." });
    }
    try {
        const result = await pool.query(`UPDATE legal_aid_contact_feedback
            SET training_status=$1,admin_note=$2,training_text=CASE WHEN $1='APPROVED' THEN $5 ELSE '' END,reviewed_by=$3,reviewed_at=NOW()
            WHERE id=$4::uuid
            RETURNING id,training_status,admin_note,training_text,reviewed_at`, [status, adminNote, req.user.id, req.params.id, trainingText]);
        if (!result.rowCount) return res.status(404).json({ ok: false, error: "Không tìm thấy ý kiến." });
        res.json({ ok: true, data: result.rows[0] });
    } catch (error) {
        console.error("Legal aid consultation feedback review failed:", error);
        res.status(500).json({ ok: false, error: "Không cập nhật được trạng thái duyệt ý kiến." });
    }
});

router.patch("/contact-requests/:id", requireRole("ADMIN"), async (req, res) => {
    const status = String(req.body?.status || "").toUpperCase();
    let assignedStaffName = String(req.body?.assigned_staff_name || "").trim().slice(0, 160);
    const requestedStaffId = String(req.body?.assigned_staff_user_id || "").trim();
    const assignmentNote = String(req.body?.assignment_note || "").trim().slice(0, 2000);
    if (!["PENDING", "ASSIGNED", "CONTACTED", "CLOSED"].includes(status)) {
        return res.status(400).json({ ok: false, error: "Trạng thái xử lý yêu cầu không hợp lệ." });
    }
    if (["ASSIGNED", "CONTACTED", "CLOSED"].includes(status) && !assignedStaffName) {
        return res.status(400).json({ ok: false, error: "Hãy nhập tên cán bộ được phân công liên hệ." });
    }
    try {
        let assignedStaffUserId = null;
        if (["ASSIGNED", "CONTACTED", "CLOSED"].includes(status)) {
            let staffResult;
            if (requestedStaffId) {
                staffResult = await pool.query("SELECT id,full_name FROM users WHERE id=$1::uuid AND is_active=TRUE AND role IN ('TASK_ASSIGNEE','SPEAKER')", [requestedStaffId]);
            } else if (assignedStaffName) {
                staffResult = await pool.query("SELECT id,full_name FROM users WHERE is_active=TRUE AND role IN ('TASK_ASSIGNEE','SPEAKER') AND LOWER(BTRIM(full_name))=LOWER(BTRIM($1)) ORDER BY id LIMIT 2", [assignedStaffName]);
            }
            if (!staffResult?.rowCount || (!requestedStaffId && staffResult.rowCount !== 1)) {
                return res.status(400).json({ ok: false, error: "Không xác định duy nhất tài khoản cán bộ được giao. Hãy chọn tài khoản trong danh sách." });
            }
            assignedStaffUserId = staffResult.rows[0].id;
            assignedStaffName = staffResult.rows[0].full_name;
        }
        const result = await pool.query(`UPDATE legal_aid_contact_requests
            SET status=$1,
                assigned_staff_name=$2,
                assigned_staff_user_id=$5::uuid,
                assigned_by=CASE WHEN $1='PENDING' THEN NULL ELSE $3::uuid END,
                assigned_at=CASE WHEN $1='PENDING' THEN NULL WHEN assigned_at IS NULL OR assigned_staff_user_id IS DISTINCT FROM $5::uuid OR assigned_staff_name IS DISTINCT FROM $2 THEN NOW() ELSE assigned_at END,
                assignment_note=$4,
                contact_completed_at=CASE WHEN $1 IN ('CONTACTED','CLOSED') THEN COALESCE(contact_completed_at,NOW()) WHEN $1 IN ('PENDING','ASSIGNED') THEN NULL ELSE contact_completed_at END,
                updated_at=NOW()
            WHERE id=$6
            RETURNING id,status,assigned_staff_user_id,assigned_staff_name,assignment_note,assigned_at,contact_completed_at,updated_at`,
        [status, assignedStaffName, req.user.id, assignmentNote, assignedStaffUserId, req.params.id]);
        if (!result.rowCount) return res.status(404).json({ ok: false, error: "Không tìm thấy yêu cầu tư vấn." });
        res.json({ ok: true, data: result.rows[0] });
    } catch (error) {
        console.error("Legal aid contact request update failed:", error);
        res.status(500).json({ ok: false, error: "Không lưu được phân công hoặc trạng thái yêu cầu." });
    }
});
router.patch("/feedback/:id", requireRole("ADMIN"), async (req, res) => {
    const status = String(req.body?.status || "").toUpperCase();
    if (!["REVIEWED", "RESOLVED"].includes(status)) return res.status(400).json({ ok: false, error: "Trạng thái xử lý không hợp lệ." });
    const correctionText = String(req.body?.correction_text || "").trim().slice(0, 6000);
    const sourceTitle = String(req.body?.correction_source_title || "").trim().slice(0, 300);
    const sourceUrl = String(req.body?.correction_source_url || "").trim();
    if (status === "RESOLVED") {
        let classification;
        try {
            const feedback = await pool.query("SELECT question FROM ai_answer_feedback WHERE id=$1", [req.params.id]);
            if (!feedback.rowCount) return res.status(404).json({ ok: false, error: "Không tìm thấy phản hồi." });
            classification = classifyQuestion(feedback.rows[0].question);
        } catch (error) {
            console.error("AI feedback classification failed:", error.message);
            return res.status(500).json({ ok: false, error: "Không kiểm tra được loại phản hồi." });
        }
        const requiresLegalSource = classification.isLegalAidQuestion || classification.isCriminalQuestion;
        let host = "";
        try { const parsed = new URL(sourceUrl); if (parsed.protocol === "https:") host = parsed.hostname.toLowerCase(); } catch {}
        const official = ["gov.vn", "chinhphu.vn", "quochoi.vn"].some(domain => host === domain || host.endsWith(`.${domain}`));
        if (!correctionText) return res.status(400).json({ ok: false, error: "Hãy nhập nội dung đính chính." });
        if (requiresLegalSource && (!sourceTitle || !official)) return res.status(400).json({ ok: false, error: "Câu hỏi liên quan pháp luật cần tên và liên kết HTTPS từ nguồn cơ quan nhà nước để làm căn cứ." });
        if (!requiresLegalSource && sourceUrl && !official) return res.status(400).json({ ok: false, error: "Nếu nhập liên kết, hãy dùng HTTPS thuộc .gov.vn, chinhphu.vn hoặc quochoi.vn." });
    }
    try {
        const result = await pool.query(`UPDATE ai_answer_feedback SET status=$1, admin_note=$2, correction_text=$3,
            correction_source_title=$4, correction_source_url=$5, reviewed_at=NOW() WHERE id=$6
            RETURNING id, status, admin_note, correction_text, correction_source_title, correction_source_url, reviewed_at`,
        [status, String(req.body?.admin_note || "").slice(0, 2000), correctionText, sourceTitle, sourceUrl, req.params.id]);
        if (!result.rowCount) return res.status(404).json({ ok: false, error: "Không tìm thấy phản hồi." });
        res.json({ ok: true, data: result.rows[0] });
    } catch (error) {
        console.error("AI feedback update failed:", error);
        res.status(500).json({ ok: false, error: "Không cập nhật được phản hồi." });
    }
});

module.exports = router;



