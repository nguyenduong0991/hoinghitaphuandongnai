const DEFAULT_INTENTS = Object.freeze([
    "conference_lookup", "conference_analysis", "conference_planning", "conference_action_review",
    "conference_attendance", "conference_attendance_guidance", "conference_registration_help",
    "survey", "tasks", "legal_aid", "contact_referral", "contact_request_status", "contact_request_summary", "system_help", "ai_feedback_summary",
    "out_of_scope", "clarify"
]);
const ENTITY_KEYS = Object.freeze(["conference_code", "organization", "account", "topic", "status"]);
const TIME_KINDS = new Set(["unspecified", "day", "week", "month", "quarter", "year", "range", "all"]);
const CACHE_LIMIT = 96;
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9000;
const cache = new Map();
const pending = new Map();

function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN").replace(/\s+/g, " ").trim();
}

function shouldResolveIntent(question, classification, hasHistory = false) {
    if (!question || classification?.intent !== "out_of_scope" || classification.isExternalDataQuestion || classification.isCriminalQuestion) return false;
    const text = normalize(question);
    if (text.length < 4 || text.length > 1200) return false;
    // Very short replies such as a locality name are handled only by the
    // deterministic pending-clarification logic; Qwen must not invent a task.
    if (text.split(/\s+/).filter(Boolean).length <= 3) return false;
    if (hasHistory && /\b(vay|con|the|truong hop do|van de nay|hoi nghi do|hoi nghi nay|dia diem do|ngay do|thang toi|thang nay)\b/.test(text)) return false;
    // Only ambiguous requests that plausibly concern this application's features are escalated.
    // Clearly unrelated queries stay on the deterministic out-of-scope path.
    return /\b(hoi nghi|tap huan|phuong|xa|don vi|bao cao vien|nhiem vu|viec|xu ly|buoi|phan cong|khao sat|phieu|tham du|diem danh|dang ky|du lieu|bao cao|thong ke|tong hop|danh gia|phan tich|xep hang|chu de|noi dung|tai khoan|tro giup phap ly|tgpl|tu van|ho so|han|thang|quy|thoi gian|dia diem|trang thai)\b/.test(text);
}

function validDate(value) {
    if (value === null) return true;
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function sanitizeIntentResolution(value, allowedIntents = DEFAULT_INTENTS) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!allowedIntents.includes(value.intent) || typeof value.requires_clarification !== "boolean") return null;
    if (!value.entities || typeof value.entities !== "object" || Array.isArray(value.entities)) return null;
    const entities = {};
    for (const key of ENTITY_KEYS) {
        const raw = value.entities[key] ?? null;
        if (raw !== null && typeof raw !== "string") return null;
        const text = raw === null ? null : raw.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 120);
        if (key === "conference_code" && text && !/^(?:HN|HCN|CONF)[\s_-]*\d{2,}$/i.test(text)) return null;
        if (key === "status" && text && !["PENDING", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED", "RESCHEDULED"].includes(text.toUpperCase())) return null;
        entities[key] = key === "conference_code" && text
            ? `HN-${text.match(/\d{2,}/)[0].padStart(4, "0")}`
            : key === "status" && text ? text.toUpperCase() : text;
    }
    if (value.time_range !== null && (typeof value.time_range !== "object" || Array.isArray(value.time_range))) return null;
    let timeRange = null;
    if (value.time_range) {
        const { kind, start = null, end_exclusive = null } = value.time_range;
        if (!TIME_KINDS.has(kind) || !validDate(start) || !validDate(end_exclusive)) return null;
        if ((start === null) !== (end_exclusive === null)) return null;
        if (start && start >= end_exclusive) return null;
        if (start && (Date.parse(end_exclusive) - Date.parse(start)) > 3660 * 86400000) return null;
        timeRange = { kind, start, end_exclusive };
    }
    if (value.requested_metric !== null && typeof value.requested_metric !== "string") return null;
    if (value.clarification_question !== undefined && value.clarification_question !== null && typeof value.clarification_question !== "string") return null;
    return {
        intent: value.intent,
        entities,
        time_range: timeRange,
        requested_metric: value.requested_metric === null ? null : value.requested_metric.trim().slice(0, 120),
        requires_clarification: value.requires_clarification,
        clarification_question: typeof value.clarification_question === "string" ? value.clarification_question.trim().slice(0, 240) : null
    };
}

function enforceIntentFit(question, resolution) {
    if (!resolution) return resolution;
    const text = normalize(question);
    const hasConference = /\b(hoi nghi|tap huan|buoi tap huan|ma hn)\b/.test(text);
    const asksPlanning = /\b(de xuat|lap ke hoach|lap phuong an|sap xep|phan cong)\b/.test(text);
    const asksStatusOrDetails = /\b(duoc duyet|phe duyet|trang thai|tinh trang|o dau|dia diem|khi nao|ngay gio|dien ra|bao cao vien)\b/.test(text);
    const asksAttendance = /\b(dang ky|tham du|diem danh|so nguoi|bao nhieu nguoi|nguoi tham du)\b/.test(text);
    const forceIntent = intent => ({ ...resolution, intent, requires_clarification: false, clarification_question: null });
    if (hasConference && asksPlanning) return forceIntent("conference_planning");
    if (hasConference && asksStatusOrDetails) return forceIntent("conference_lookup");
    if (hasConference && asksAttendance) return forceIntent("conference_attendance");
    if (/\b(phieu khao sat|khao sat)\b/.test(text)) return forceIntent("survey");
    if (/\b(luat tro giup phap ly|tro giup phap ly|tgpl|dieu \d+)\b/.test(text) && !hasConference) return forceIntent("legal_aid");
    return resolution;
}

function applyIntentResolution(base, resolution) {
    if (!resolution || resolution.requires_clarification || ["out_of_scope", "clarify"].includes(resolution.intent)) return base;
    const result = { ...base, intent: resolution.intent, intentConfidence: 0.72,
        querySlots: { ...base.querySlots, semanticEntities: resolution.entities, semanticTimeRange: resolution.time_range,
            requestedMetric: resolution.requested_metric } };
    const markInScope = () => { result.isInScope = true; };
    switch (resolution.intent) {
        case "conference_lookup": result.isConferenceDataQuestion = true; result.isConferenceAnalysisQuestion = false; markInScope(); break;
        case "conference_analysis": result.isConferenceDataQuestion = true; result.isConferenceAnalysisQuestion = true; result.mode = "deep_analysis"; markInScope(); break;
        case "conference_planning": result.isConferencePlanningQuestion = true; markInScope(); break;
        case "conference_action_review": result.intent = "conference_action_review"; result.isConferenceDataQuestion = true; markInScope(); break;
        case "conference_attendance": result.isConferenceAttendanceQuestion = true; result.isConferenceDataQuestion = true; markInScope(); break;
        case "conference_attendance_guidance": result.isConferenceAttendanceGuidanceQuestion = true; markInScope(); break;
        case "conference_registration_help": result.isConferenceRegistrationHelp = true; markInScope(); break;
        case "survey": result.isSurveySummaryQuestion = true; result.isSurveyAnalysisQuestion = true; result.mode = "deep_analysis"; markInScope(); break;
        case "tasks": result.isTaskQuery = true; markInScope(); break;
        case "legal_aid": result.isLegal = true; result.isLegalAidQuestion = true; result.needsRag = true; result.mode = "legal_rag"; result.topK = 3; markInScope(); break;
        case "contact_referral": result.isContactReferralQuestion = true; markInScope(); break;
        case "contact_request_status": result.isContactRequestStatusQuestion = true; markInScope(); break;
        case "contact_request_summary": result.isContactRequestSummaryQuestion = true; markInScope(); break;
        case "system_help": result.isSystemHelp = true; markInScope(); break;
        case "ai_feedback_summary": result.isAiFeedbackSummaryQuestion = true; markInScope(); break;
    }
    return result;
}

function remember(key, value) {
    cache.delete(key);
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function resolveIntentWithOllama(question, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const model = options.model || process.env.OLLAMA_ANALYSIS_MODEL || process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
    const baseUrl = (options.url || process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const timeoutMs = Math.max(250, Math.min(REQUEST_TIMEOUT_MS, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS));
    const normalizedQuestion = normalize(question);
    const key = `${model}:${normalizedQuestion}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
        try {
            const response = await fetchImpl(`${baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(timeoutMs),
                body: JSON.stringify({
                    model, stream: false, think: false, keep_alive: "30m", format: "json",
                    options: { temperature: 0, num_ctx: 1024, num_predict: 128 },
                    messages: [
                        { role: "system", content: `Bạn chỉ phân loại ý định; không trả lời, không tạo SQL và không thực hiện hành động. Chỉ chọn intent trong danh sách: ${DEFAULT_INTENTS.join(", ")}. Trả đúng JSON theo cấu trúc: {"intent":"...","entities":{"conference_code":null,"organization":null,"account":null,"topic":null,"status":null},"time_range":{"kind":"unspecified|day|week|month|quarter|year|range|all","start":null,"end_exclusive":null},"requested_metric":null,"requires_clarification":false,"clarification_question":null}. Ngày phải là YYYY-MM-DD, khoảng thời gian dùng end_exclusive. Chỉ nêu thông tin hiện rõ trong câu hỏi; không suy ra mã/tài khoản/địa bàn từ dữ liệu ngoài câu hỏi. Nếu không rõ mục đích, dùng clarify và hỏi ngắn gọn.` },
                        { role: "user", content: String(question).slice(0, 1200) }
                    ]
                })
            });
            if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
            const body = await response.json();
            const parsed = JSON.parse(String(body?.message?.content || ""));
            const safe = sanitizeIntentResolution(parsed);
            if (!safe) throw new Error("Invalid intent JSON");
            remember(key, safe);
            return safe;
        } catch (error) {
            // Keep logs free of user text, identifiers, credentials, and model output.
            console.warn("Ambiguous intent fallback unavailable:", error?.name || "Error");
            remember(key, null);
            return null;
        } finally {
            pending.delete(key);
        }
    })();
    pending.set(key, task);
    return task;
}

function clearIntentResolutionCache() {
    cache.clear();
    pending.clear();
}

module.exports = { DEFAULT_INTENTS, shouldResolveIntent, sanitizeIntentResolution, enforceIntentFit, applyIntentResolution, resolveIntentWithOllama, clearIntentResolutionCache };



