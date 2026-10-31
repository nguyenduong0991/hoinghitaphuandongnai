const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./config/database");
const { requireRole, hashPassword, verifyPassword, checkConferenceAccess } = require("./auth");
const { classifyQuestion } = require("./services/rag.service");
const { normalizeConversationHistory, resolveConversationContext, buildConversationMemory } = require("./services/conversation-memory");
const { LIMITS: PLANNING_LIMITS, SHORTAGE_POLICY: PLANNING_SHORTAGE_POLICY, rankAvailable: rankWithinLimits, personCapacity: getPersonCapacity, localDateParts: planningDateParts, matchExplicitPlanningDate, isFullyStaffed: isPlanningFullyStaffed, staffingShortages: getPlanningShortages, overlapsTimeInterval, hasConferenceScheduleConflict, isConferenceMonthAvailable, canKeepRequestedSchedule, findApprovedScheduleConflicts, findNearestFeasibleOptions, prioritizeRequestedDateOption, selectNearestDateOptions } = require("./services/planning-capacity");
const upload = require("./upload");
const router = express.Router();
const { AI_ROLE_POLICIES } = require("./services/ai-role-policy");
const statuses = new Set(["PENDING", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED", "RESCHEDULED"]);
let aiSuggestionInProgress = false;
router.post("/account/change-password", async (req, res) => {
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    const confirmation = String(req.body?.confirm_password || "");
    if (newPassword.length < 12) return res.status(400).json({ success: false, message: "Mật khẩu mới cần ít nhất 12 ký tự." });
    if (newPassword.length > 256 || currentPassword.length > 256) return res.status(400).json({ success: false, message: "Mật khẩu không được vượt quá 256 ký tự." });
    if (newPassword !== confirmation) return res.status(400).json({ success: false, message: "Mật khẩu xác nhận không khớp." });
    if (newPassword === currentPassword) return res.status(400).json({ success: false, message: "Mật khẩu mới phải khác mật khẩu hiện tại." });
    const result = await pool.query("SELECT password_hash FROM users WHERE id=$1 AND is_active=TRUE", [req.user.id]);
    if (!result.rowCount || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
        return res.status(400).json({ success: false, message: "Mật khẩu hiện tại không đúng." });
    }
    const passwordHash = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2", [passwordHash, req.user.id]);
    res.json({ success: true, message: "Đã đổi mật khẩu thành công." });
});
router.post("/ai/conference-topic-advisor", requireRole(...AI_ROLE_POLICIES.readOnlyPlanning), async (req, res) => {
    const description = String(req.body?.description || "").trim();
    if (description.length < 10 || description.length > 1200) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập nhu cầu từ 10 đến 1.200 ký tự." });
    }
    // This advisor is intentionally local-only: the backend and Ollama run on
    // the same laptop, so ignore inherited OLLAMA_URL values from Windows.
    const ollamaUrl = "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
    if (aiSuggestionInProgress) return res.status(429).json({ success: false, message: "Mô hình đang xử lý yêu cầu khác trên laptop. Vui lòng đợi một lát rồi thử lại." });
    aiSuggestionInProgress = true;
    const roleNames = { ADMIN: "quản trị viên", COMMUNE: "người đăng ký hội nghị", TASK_ASSIGNEE: "người nhận nhiệm vụ", SPEAKER: "báo cáo viên" };
    const roleName = roleNames[req.user?.role] || "người dùng";
    const systemPrompt = `Bạn là trợ lý AI nội bộ cho hệ thống điều phối hội nghị và trợ giúp pháp lý tại Việt Nam. Người đang hỏi có vai trò ${roleName}. Trả lời bằng tiếng Việt, rõ ràng, ngắn gọn và tối đa 220 từ. Hỗ trợ các câu hỏi chung về cách dùng hệ thống; gợi ý đăng ký, tổ chức, phê duyệt hội nghị; lập kế hoạch công việc; chuẩn bị nội dung báo cáo viên và báo cáo kết quả. Điều chỉnh hướng dẫn theo vai trò, nhưng không hướng dẫn vượt quyền. Bạn không truy cập được cơ sở dữ liệu, trạng thái tài khoản, danh sách nhiệm vụ hay hồ sơ thực tế; nếu được hỏi các thông tin đó, hãy nói rõ và chỉ dẫn người dùng xem trong giao diện hệ thống. Với nội dung pháp luật, chỉ cung cấp thông tin khái quát, không thay thế tư vấn pháp luật, không bịa điều luật và nhắc kiểm chứng văn bản hiện hành. Không lặp lại thông tin nhận dạng cá nhân hoặc chi tiết hồ sơ vụ việc. Nếu người dùng cần gợi ý hội nghị, hãy đề xuất tối đa 3 chủ đề phù hợp trong các nhóm: Chuyển đổi số trong hoạt động tố tụng; Phối hợp liên ngành trong giải quyết án hình sự; Công tác xử lý vụ án có người dưới 18 tuổi; Nâng cao chất lượng xét xử, kiểm sát và điều tra; Phòng, chống tội phạm trên không gian mạng; Tiếp nhận và giải quyết tin báo, tố giác về tội phạm; Công tác thi hành án hình sự tại cộng đồng; Trợ giúp pháp lý trong hoạt động tố tụng.`;
    try {
        const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(240000),
            body: JSON.stringify({
                model,
                stream: false,
                think: false,
                keep_alive: "30m",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: description }
                ],
                options: { temperature: 0.25, num_ctx: 4096, num_predict: 320 }
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const modelMissing = response.status === 404 || /not found|pull/i.test(String(result.error || ""));
            return res.status(modelMissing ? 503 : 502).json({ success: false, message: modelMissing ? `Ollama chưa có mô hình ${model}. Hãy tải mô hình bằng lệnh: ollama pull ${model}` : "Ollama không xử lý được yêu cầu lúc này." });
        }
        const answer = String(result.message?.content || "").trim();
        if (!answer) return res.status(502).json({ success: false, message: "Mô hình chưa trả về nội dung. Vui lòng thử lại." });
        res.json({ success: true, data: { answer, model } });
    } catch (error) {
        console.error("Ollama conference advisor request failed:", {
            url: `${ollamaUrl}/api/chat`,
            model,
            name: error.name,
            message: error.message,
            cause: error.cause?.code || error.cause?.message || null
        });
        const unavailable = error.name === "TimeoutError" || error.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(error.message || "");
        res.status(unavailable ? 503 : 502).json({ success: false, message: unavailable ? "Chưa kết nối được Ollama trên laptop. Hãy mở ứng dụng Ollama rồi thử lại." : "Không thể tạo gợi ý lúc này. Vui lòng thử lại." });
    } finally {
        aiSuggestionInProgress = false;
    }
});

// Chatbot planning draft for every signed-in role. This endpoint is read-only:
// it never creates a conference, assignment, or notification.
router.post("/ai/conference-plan-proposal", requireRole("ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    const request = String(req.body?.question || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 1200);
    if (request.length < 3) return res.status(400).json({ success: false, message: "Hãy mô tả ngắn nhu cầu hội nghị hoặc tập huấn." });
    const user = req.user;
    const submittedHistory = normalizeConversationHistory(req.body?.history, 6);
    const normalizePlannerContext = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN");
    const normalizedCurrent = normalizePlannerContext(request);
    const priorPlanEntries = submittedHistory.map((item, index) => ({ item, index }))
        .filter(({ item }) => item.role === "user" && /(?:lap phuong an|lap ke hoach|de xuat to chuc|goi y to chuc|to chuc hoi nghi|tap huan tai|tuyen truyen phap luat|(?:giup toi|hay|muon|de xuat|goi y).{0,60}(?:hoi nghi|tap huan|tuyen truyen)|(?:to chuc|lap).{0,60}(?:hoi nghi|tap huan))/.test(normalizePlannerContext(item.content)))
        .map(({ item, index }) => ({ item, index }));
    const planAnchor = priorPlanEntries.at(-1) || null;
    const contextDecision = resolveConversationContext(request, submittedHistory, classifyQuestion(request), classifyQuestion);
    const contextCarry = Boolean(planAnchor && contextDecision.usesContext &&
        !/(?:dieu\s*\d+|luat .* quy dinh|hoi nghi nao|tra cuu|liet ke|bao nhieu hoi nghi)/.test(normalizedCurrent));
    const planningContextTurns = contextCarry ? contextDecision.relevantUserTurns.map(content => ({ role: "user", content })) : [];
    const planningMemory = contextCarry
        ? buildConversationMemory(planningContextTurns, { usesContext: true, relevantUserTurns: planningContextTurns.map(item => item.content), unresolvedSlots: contextDecision.unresolvedSlots }, classifyQuestion, request)
        : { promptText: "" };
    const planningContext = contextCarry ? `${planningMemory.promptText}\nThông tin mới người dùng vừa bổ sung: ${request}` : request;
    const basePlanningRequest = planAnchor?.item.content || request;
    const visibleConferenceCondition = user.role === "ADMIN" ? "TRUE" : user.role === "COMMUNE"
        ? "c.organization_id=$1"
        : user.role === "TASK_ASSIGNEE"
            ? "EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$1)"
            : "EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$1)";
    const visibleSurveyCondition = user.role === "ADMIN" ? "TRUE" : user.role === "COMMUNE"
        ? "s.organization_id=$1"
        : user.role === "TASK_ASSIGNEE"
            ? "EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=s.conference_id AND a.assignee_user_id=$1)"
            : "EXISTS (SELECT 1 FROM conference_speakers sp WHERE sp.conference_id=s.conference_id AND sp.speaker_user_id=$1)";
    const scopeParams = user.role === "COMMUNE" ? [user.organization_id || null] : user.role === "ADMIN" ? [] : [user.id];
    try {
        const [organizationResult, historyResult, surveyResult, staffResult, speakerResult, blockedResult, taskQuotaResult, speakerQuotaResult, nearTaskDatesResult, nearSpeakerDatesResult] = await Promise.all([
            pool.query("SELECT id,name FROM organizations ORDER BY name LIMIT 100"),
            pool.query(`SELECT c.code,c.title,c.description,c.status,c.start_time,
                    COALESCE(c.location_name,c.location_address,'') AS location,
                    COALESCE(c.expected_participants,0)::int AS expected_participants,o.name AS organization_name
                FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
                WHERE ${visibleConferenceCondition}
                ORDER BY c.start_time DESC NULLS LAST LIMIT 20`, scopeParams),
            pool.query(`SELECT category,value,COUNT(*)::int AS count FROM (
                    SELECT 'địa bàn' AS category,BTRIM(suggested_area) AS value,organization_id,conference_id FROM conference_need_surveys WHERE NULLIF(BTRIM(suggested_area),'') IS NOT NULL
                    UNION ALL SELECT 'chủ đề',BTRIM(topics),organization_id,conference_id FROM conference_need_surveys WHERE NULLIF(BTRIM(topics),'') IS NOT NULL
                    UNION ALL SELECT 'đối tượng tham gia',BTRIM(target_audience),organization_id,conference_id FROM conference_need_surveys WHERE NULLIF(BTRIM(target_audience),'') IS NOT NULL
                    UNION ALL SELECT 'nhu cầu tập huấn',BTRIM(training_need),organization_id,conference_id FROM conference_need_surveys WHERE NULLIF(BTRIM(training_need),'') IS NOT NULL
                ) s WHERE ${visibleSurveyCondition}
                GROUP BY category,value ORDER BY count DESC,value LIMIT 60`, scopeParams),
            user.role === "ADMIN" ? pool.query(`SELECT u.id,u.full_name,o.name AS organization_name,
                    (SELECT COUNT(*)::int FROM conference_task_assignments a WHERE a.assignee_user_id=u.id AND a.status IN ('ASSIGNED','IN_PROGRESS')) AS active_tasks
                FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
                WHERE u.role='TASK_ASSIGNEE' AND u.is_active=TRUE ORDER BY active_tasks,u.full_name LIMIT 40`) : Promise.resolve({ rows: [] }),
            user.role === "ADMIN" ? pool.query(`SELECT u.id,u.full_name,o.name AS organization_name
                FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
                WHERE u.role='SPEAKER' AND u.is_active=TRUE ORDER BY u.full_name LIMIT 30`) : Promise.resolve({ rows: [] }),
            pool.query(`SELECT organization_id::text AS organization_id,status,
                    COALESCE(proposed_start_time,start_time) AS start_time,
                    COALESCE(proposed_end_time,end_time,proposed_start_time,start_time) AS end_time,
                    (COALESCE(proposed_start_time,start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS start_date,
                    (COALESCE(proposed_end_time,end_time,proposed_start_time,start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS end_date
                FROM conferences WHERE status IN ('PENDING','APPROVED','RESCHEDULED')
                  AND COALESCE(proposed_end_time,end_time,proposed_start_time,start_time)>=NOW()`),
            user.role === "ADMIN" ? pool.query(`SELECT a.assignee_user_id::text AS user_id,
                    to_char(COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') AS month_key,
                    to_char(date_trunc('week',COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') AS week_key,COUNT(*)::int AS count
                FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
                WHERE a.assignee_user_id IS NOT NULL AND a.status<>'CANCELLED' AND COALESCE(c.proposed_start_time,c.start_time) IS NOT NULL
                  AND c.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                GROUP BY a.assignee_user_id,month_key,week_key`) : Promise.resolve({ rows: [] }),
            user.role === "ADMIN" ? pool.query(`SELECT s.speaker_user_id::text AS user_id,
                    to_char(COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') AS month_key,
                    to_char(date_trunc('week',COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') AS week_key,COUNT(*)::int AS count
                FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
                WHERE s.speaker_user_id IS NOT NULL AND COALESCE(c.proposed_start_time,c.start_time) IS NOT NULL
                  AND c.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                GROUP BY s.speaker_user_id,month_key,week_key`) : Promise.resolve({ rows: [] }),
            user.role === "ADMIN" ? pool.query(`SELECT DISTINCT a.assignee_user_id::text AS user_id,
                    (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date_key
                FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
                WHERE a.assignee_user_id IS NOT NULL AND a.status<>'CANCELLED' AND COALESCE(c.proposed_start_time,c.start_time) IS NOT NULL
                  AND c.status IN ('PENDING','APPROVED','RESCHEDULED')
                  AND (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                  AND (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 3`) : Promise.resolve({ rows: [] }),
            user.role === "ADMIN" ? pool.query(`SELECT DISTINCT s.speaker_user_id::text AS user_id,
                    (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date_key
                FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
                WHERE s.speaker_user_id IS NOT NULL AND COALESCE(c.proposed_start_time,c.start_time) IS NOT NULL
                  AND c.status IN ('PENDING','APPROVED','RESCHEDULED')
                  AND (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                  AND (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 3`) : Promise.resolve({ rows: [] })
        ]);
        const organizations = organizationResult.rows.map(row => ({ id: String(row.id), name: row.name }));
        const normalizePlannerText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN").replace(/[^a-z0-9]+/g, " ").trim();
        const normalizedRequest = normalizePlannerText(planningContext);
        const requestedOrganization = organizations
            .map(item => ({ ...item, alias: normalizePlannerText(item.name).replace(/^(?:ubnd|uy ban nhan dan)\s+/, "") }))
            .filter(item => item.alias.length >= 5 && normalizedRequest.includes(item.alias))
            .sort((left, right) => right.alias.length - left.alias.length)[0] || null;
        const requestedPlaceMention = planningContext.match(/\b(?:xã|phường)\s+(?!(?:tôi|mình|bạn|đó|này|chúng tôi)\b)[^,.;\r\n]{2,60}/iu)?.[0]?.trim() || "";
        const areaSurveySignals = surveyResult.rows
            .filter(row => normalizePlannerText(row.category).includes("dia ban") && String(row.value || "").trim())
            .sort((left, right) => Number(right.count || 0) - Number(left.count || 0));
        const areaAlias = value => normalizePlannerText(value).replace(/^(?:ubnd|uy ban nhan dan)\s+/, "");
        const organizationAreaScores = new Map();
        for (const signal of areaSurveySignals) {
            const area = areaAlias(signal.value);
            if (area.length < 5) continue;
            const match = organizations.find(item => {
                const alias = areaAlias(item.name);
                return area === alias || area.endsWith(` ${alias}`) || alias.endsWith(` ${area}`);
            });
            if (match) organizationAreaScores.set(match.id, (organizationAreaScores.get(match.id) || 0) + Number(signal.count || 0));
        }
        const historyOrganizationCounts = new Map();
        for (const row of historyResult.rows) {
            const match = organizations.find(item => normalizePlannerText(item.name) === normalizePlannerText(row.organization_name));
            if (match) historyOrganizationCounts.set(match.id, (historyOrganizationCounts.get(match.id) || 0) + 1);
        }
        const organizationsByCount = scores => organizations
            .map(item => ({ item, count: Number(scores.get(item.id) || 0) }))
            .filter(entry => entry.count > 0)
            .sort((left, right) => right.count - left.count || left.item.name.localeCompare(right.item.name, "vi"));
        const areaOrganizationRanking = organizationsByCount(organizationAreaScores);
        const historyOrganizationRanking = organizationsByCount(historyOrganizationCounts);
        const areaRecommendedOrganization = areaOrganizationRanking[0]?.item || null;
        const historyRecommendedOrganization = historyOrganizationRanking[0]?.item || null;
        const tiedSurveyAreas = areaOrganizationRanking.length
            ? areaOrganizationRanking.filter(entry => entry.count === areaOrganizationRanking[0].count).map(entry => entry.item.name)
            : areaSurveySignals.filter(item => Number(item.count || 0) === Number(areaSurveySignals[0]?.count || 0))
                .map(item => String(item.value || "").trim()).filter(Boolean);
        const ownOrganization = user.role === "COMMUNE"
            ? organizations.find(item => item.id === String(user.organization_id || "")) || null : null;
        const asksAreaRecommendation = /(?:de xuat|goi y|chon|uu tien).{0,60}(?:dia ban|khu vuc|xa|phuong)/.test(normalizedRequest);
        const planningOrganization = requestedOrganization || ownOrganization
            || (asksAreaRecommendation ? areaRecommendedOrganization || (!areaSurveySignals.length ? historyRecommendedOrganization : null) : null);
        const recommendedAreaLabel = requestedOrganization?.name || ownOrganization?.name
            || (asksAreaRecommendation && tiedSurveyAreas.length
                ? tiedSurveyAreas.slice(0, 3).join(", ")
                : asksAreaRecommendation && historyRecommendedOrganization?.name) || "";
        const asksAttendeeScaleOnly = /(?:quy mo|so luong dai bieu|bao nhieu nguoi)/iu.test(normalizedRequest) && !/(?:phan cong|nhiem vu|bao cao vien|lap ke hoach|ke hoach)/iu.test(normalizedRequest);
        const asksPartnerCheck = /(?:don vi phoi hop|phoi hop o dia ban khac)/iu.test(normalizedRequest) && /(?:kiem tra|soan|de nghi|phoi hop)/iu.test(normalizedRequest);
        const asksScheduleOnly = /(?:ngay|buoi|khung gio|lich)/iu.test(normalizedRequest)
            && /(?:lua chon|phuong an|de xuat|goi y|tim|kín lich|kin lich)/iu.test(normalizedRequest)
            && !/(?:chu de|noi dung|quy mo|so luong|nhiem vu|cong viec|bao cao vien|nguoi phoi hop|ke hoach to chuc)/iu.test(normalizedRequest);
        const asksSpeakerOnly = /(?:bao cao vien|nguoi trinh bay)/iu.test(normalizedRequest)
            && /(?:chon|goi y|phu hop|du phong|thay the|lich trong)/iu.test(normalizedRequest)
            && !/(?:ke hoach to chuc|phan cong nhiem vu)/iu.test(normalizedRequest);
        const asksPartnerRecommendationOnly = /(?:don vi|co quan).{0,70}phoi hop|phoi hop.{0,70}(?:don vi|co quan)/iu.test(normalizedRequest)
            && /(?:goi y|de xuat|co the|nao)/iu.test(normalizedRequest)
            && !asksPartnerCheck;
        const asksTaskRedistributionOnly = /(?:phan bo lai|sap xep lai|phan cong lai|tai phan cong)/iu.test(normalizedRequest)
            && /(?:nhiem vu|cong viec|nhan su|tai cong viec)/iu.test(normalizedRequest);
        const asksFullConferencePlan = /(?:lap|xay dung|len|de xuat|goi y).{0,80}(?:phuong an|ke hoach).{0,100}(?:hoi nghi|tap huan|to chuc)/iu.test(normalizedRequest);
        const asksAssignmentStaffOnly = /(?:goi y|chon|phan cong).{0,55}(?:nguoi nhan|can bo).{0,40}(?:nhiem vu|cong viec)|(?:nhiem vu|cong viec).{0,50}(?:nguoi nhan|can bo)/iu.test(normalizedRequest)
            && !asksFullConferencePlan
            && !/(?:lap ke hoach|ke hoach to chuc|hoi nghi nao nen to chuc)/iu.test(normalizedRequest);
        if ((asksSpeakerOnly || asksTaskRedistributionOnly || asksAssignmentStaffOnly) && !requestedOrganization && !requestedPlaceMention) {
            const asksSpeaker = asksSpeakerOnly;
            return res.json({ success: true, data: { clarification: asksSpeaker
                ? "Vui lòng cho mã hội nghị hoặc chủ đề kèm ngày dự kiến để tôi rà báo cáo viên và lịch đã ghi nhận. Hệ thống không lưu đủ dữ liệu chuyên môn để tự kết luận năng lực; admin cần xác nhận trước khi phân công."
                : asksTaskRedistributionOnly
                    ? "Vui lòng cho mã hội nghị hoặc dán danh sách nhiệm vụ kèm hạn cần phân bổ lại. Tôi sẽ chỉ lập phương án nháp theo tải hiện có, chưa sửa phân công."
                    : "Vui lòng cho mã hội nghị hoặc danh sách nhiệm vụ cần giao. Tôi sẽ rà nhân sự đang hoạt động, số việc còn mở và đơn vị công tác; dữ liệu chuyên môn không có thì sẽ đánh dấu cần admin xác nhận. Chưa giao nhiệm vụ." } });
        }
        if (asksPartnerRecommendationOnly && !requestedOrganization && !requestedPlaceMention) {
            return res.json({ success: true, data: { clarification: "Vui lòng cho biết chủ đề buổi phối hợp và địa bàn mục tiêu (hoặc đơn vị tổ chức). Tôi sẽ gợi ý tối đa ba đơn vị có trong danh bạ; chưa gửi lời mời hay thông báo." } });
        }
        if (asksPartnerCheck && !requestedOrganization && !requestedPlaceMention) {
            return res.json({ success: true, data: { clarification: "Vui lòng nêu tên xã/phường/đơn vị dự kiến phối hợp và mã hội nghị hoặc chủ đề. Tôi sẽ kiểm tra danh bạ hệ thống và chỉ soạn bản nháp để bạn duyệt; chưa gửi thông báo." } });
        }
        const asksForPlanWithoutUnit = user.role !== "COMMUNE" && !requestedOrganization && !requestedPlaceMention && !asksAreaRecommendation;
        if ((requestedPlaceMention && !requestedOrganization && !asksAreaRecommendation) || asksForPlanWithoutUnit) {
            const placeText = requestedPlaceMention
                ? `Tôi chưa tìm thấy “${requestedPlaceMention}” trong danh sách đơn vị của hệ thống.`
                : "Đây là yêu cầu lập kế hoạch mới nên chưa cần mã hội nghị; vui lòng nêu xã/phường/đơn vị tổ chức.";
            const missingDetails = [];
            const hasTopic = /(?:luat tro giup phap ly|tro giup phap ly|\btgpl\b|quyen.{0,30}tro giup|dat dai|thua ke|boi thuong|tranh chap dan su|ho tich|cu tru|nguoi cao tuoi|nguoi khuyet tat|tiep can tro giup|nhan dien.{0,50}(?:tro giup|doi tuong)|phoi hop lien nganh)/iu.test(normalizedRequest);
            const asksTopicRecommendation = /(?:chua chon chu de|goi y.{0,35}(?:chu de|noi dung)|de xuat.{0,35}(?:chu de|noi dung)|noi dung phu hop|pho bien phap luat)/iu.test(normalizedRequest);
            const hasAudience = /(?:nguoi dan|ba con|nguoi cao tuoi|nguoi khuyet tat|doi tuong tham du|doi tuong tham gia|can bo.{0,24}(?:tham du|duoc tap huan)|tap huan.{0,30}can bo)/iu.test(normalizedRequest);
            if (!asksAttendeeScaleOnly && !asksScheduleOnly) {
                if (!hasTopic && !asksTopicRecommendation) missingDetails.push("chủ đề");
                if (!hasAudience) missingDetails.push("đối tượng tham dự");
            }
            if ((!asksAttendeeScaleOnly || asksScheduleOnly) && !/(?:thang\s*(?:\d|toi|sau|nay|tiep theo)|quy\s*(?:(?:i{1,3}|iv|[1-4])|toi|sau)|nam\s*(?:\d{4}|toi|sau)|ngay\s*\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|tuan toi|thoi gian)/i.test(normalizedRequest)) missingDetails.push("ngày hoặc tháng mong muốn");
            const missingDetailsText = missingDetails.length < 2 ? (missingDetails[0] || "") : `${missingDetails.slice(0, -1).join(", ")} và ${missingDetails[missingDetails.length - 1]}`;
            const detailsText = missingDetails.length ? ` Để hoàn thiện phương án, vui lòng cho biết thêm ${missingDetailsText}.` : "";
            const requestedDate = normalizedRequest.match(/\bngay\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/i);
            const retainedDate = requestedDate ? ` Tôi đã ghi nhận ngày dự kiến ${requestedDate[1]}/${requestedDate[2]}/${requestedDate[3]}.` : "";
            return res.json({ success: true, data: { clarification: `${placeText} Hãy chọn đúng tên đơn vị đã đăng ký trên hệ thống.${retainedDate}${detailsText} Tôi sẽ tiếp tục sau khi xác định đủ thông tin; chưa tạo hội nghị, phân công hay gửi thông báo.` } });
        }
        if (user.role === "COMMUNE" && requestedOrganization && requestedOrganization.id !== String(user.organization_id || "")) {
            return res.status(403).json({ success: false, message: `Tài khoản của bạn chỉ lập phương án cho ${organizations.find(item => item.id === String(user.organization_id || ""))?.name || "đơn vị được gán"}. Vui lòng đăng nhập tài khoản có quyền phù hợp để lập phương án cho ${requestedOrganization.name}.` });
        }
        const history = historyResult.rows.map(row => ({ code: row.code, title: row.title, status: row.status,
            start_time: row.start_time, location: row.location, expected_participants: row.expected_participants,
            organization: row.organization_name, description: String(row.description || "").slice(0, 250) }));
        const relevantHistory = planningOrganization
            ? history.filter(row => normalizePlannerText(row.organization) === normalizePlannerText(planningOrganization.name)) : [];
        const explicitlyRequestedCount = Number(planningContext.match(/\b(\d{1,4})\s*(?:người|cán bộ|đại biểu)(?=\s|$|[,.;])/i)?.[1]) || 0;
        const surveySignals = surveyResult.rows.map(row => ({ category: row.category, value: String(row.value || "").slice(0, 180), count: Number(row.count || 0) }));
        const activeMonthlyCounts = new Map();
        const MONTHLY_CONFERENCE_CAP = 15;
        for (const row of blockedResult.rows) {
            const startMonth = String(row.start_date || '').slice(0, 7);
            if (startMonth) activeMonthlyCounts.set(startMonth, (activeMonthlyCounts.get(startMonth) || 0) + 1);
        }
        const dayKeyFor = date => new Date(date).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
        const todayKey = dayKeyFor(new Date());
        const tomorrow = new Date(`${todayKey}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const minimumDateKey = tomorrow.toISOString().slice(0, 10);
        // Keep proposed dates inside an explicitly requested month/quarter/year/day.
        let requestedWindow = null;
        const exactDateMatch = matchExplicitPlanningDate(request);
        const monthMatch = normalizedRequest.match(/\bthang\s*(0?[1-9]|1[0-2])(?:(?:\s*(?:nam\s*)?|[/-])(\d{4}))?\b/);
        const quarterMatch = normalizedRequest.match(/\bquy\s*(i{1,3}|iv|[1-4])(?:(?:\s*(?:nam\s*)?|[/-])(\d{4}))\b/);
        const yearMatch = normalizedRequest.match(/\bnam\s*(20\d{2})\b/);
        if (exactDateMatch) {
            const day = Number(exactDateMatch[1]), month = Number(exactDateMatch[2]);
            let year = Number(exactDateMatch[3] || new Date().getFullYear());
            if (!exactDateMatch[3] && `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` < todayKey) year++;
            const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            requestedWindow = { start: key, end: key, label: `ngày ${day}/${month}/${year}` };
        } else if (monthMatch) {
            const month = Number(monthMatch[1]);
            let year = Number(monthMatch[2] || new Date().getFullYear());
            if (!monthMatch[2] && month < Number(todayKey.slice(5, 7))) year++;
            const start = `${year}-${String(month).padStart(2, "0")}-01`;
            requestedWindow = { start, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), label: `${String(month).padStart(2, "0")}/${year}` };
        } else if (quarterMatch) {
            const value = quarterMatch[1];
            const quarter = /^\d$/.test(value) ? Number(value) : ({ i: 1, ii: 2, iii: 3, iv: 4 })[value];
            const year = Number(quarterMatch[2]), startMonth = (quarter - 1) * 3;
            requestedWindow = { start: `${year}-${String(startMonth + 1).padStart(2, "0")}-01`, end: new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10), label: `quý ${quarter}/${year}` };
        } else if (yearMatch) {
            const year = Number(yearMatch[1]);
            requestedWindow = { start: `${year}-01-01`, end: `${year}-12-31`, label: `năm ${year}` };
        }
        const requestedDateKey = exactDateMatch && requestedWindow?.start === requestedWindow?.end && requestedWindow.start >= minimumDateKey
            ? requestedWindow.start : null;
        const windowStart = requestedWindow && requestedWindow.start > minimumDateKey ? requestedWindow.start : minimumDateKey;
        const windowEnd = requestedWindow?.end || null;
        const slots = [];
        const collectSlots = (startKey, endKey = null) => {
            const scanStart = new Date(`${startKey}T00:00:00Z`);
            for (let offset = 0; offset < 180 && slots.length < 360; offset++) {
                const date = new Date(scanStart); date.setUTCDate(date.getUTCDate() + offset);
                const key = date.toISOString().slice(0, 10);
                if (endKey && key > endKey) break;
                const weekday = new Date(`${key}T12:00:00+07:00`).getDay();
                if ([0, 6].includes(weekday) || !isConferenceMonthAvailable(`${key}T12:00:00+07:00`, activeMonthlyCounts, MONTHLY_CONFERENCE_CAP)) continue;
                for (const hour of [8, 13]) {
                    const start = new Date(`${key}T${String(hour).padStart(2, "0")}:30:00+07:00`), end = new Date(start.getTime() + 3 * 3600000);
                    if (hasConferenceScheduleConflict(start, end, blockedResult.rows)) continue;
                    slots.push({ id: `S${slots.length + 1}`, start_time: start.toISOString(), end_time: end.toISOString(), label: `${start.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} ${start.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}` });
                    if (slots.length >= 360) break;
                }
            }
        };
        collectSlots(windowStart, windowEnd);
        let movedBeyondRequestedWindow = false;
        if (!slots.length && requestedWindow) {
            const nextWindowStart = new Date(`${windowEnd}T00:00:00Z`);
            nextWindowStart.setUTCDate(nextWindowStart.getUTCDate() + 1);
            const nextWindowKey = nextWindowStart.toISOString().slice(0, 10);
            collectSlots(nextWindowKey > minimumDateKey ? nextWindowKey : minimumDateKey);
            movedBeyondRequestedWindow = slots.length > 0;
        }
        if (!slots.length) {
            const period = requestedWindow ? ` trong ${requestedWindow.label}` : " trong khoảng thời gian sắp tới";
            return res.json({ success: true, data: { clarification: `Không tìm thấy khung giờ ngày làm việc còn trống${period}. Vui lòng chọn tháng/khoảng thời gian khác hoặc cung cấp ngày cụ thể. Chưa tạo hội nghị hay phân công.` } });
        }
        const genericTaskWorkload = taskQuotaResult.rows.map(row => ({ ...row, count: Number(row.count || 0) }));
        const genericSpeakerWorkload = speakerQuotaResult.rows.map(row => ({ ...row, count: Number(row.count || 0) }));
        const genericBusyTasks = new Map();
        for (const row of nearTaskDatesResult.rows) { const dates = genericBusyTasks.get(String(row.user_id)) || new Set(); dates.add(String(row.date_key)); genericBusyTasks.set(String(row.user_id), dates); }
        const genericBusySpeakers = new Map();
        for (const row of nearSpeakerDatesResult.rows) { const dates = genericBusySpeakers.get(String(row.user_id)) || new Set(); dates.add(String(row.date_key)); genericBusySpeakers.set(String(row.user_id), dates); }
        const genericDateKeyFor = date => planningDateParts(date)?.dayKey || "";
        const genericStaffAt = (date, preferred = []) => rankWithinLimits(staffResult.rows, date, genericTaskWorkload, PLANNING_LIMITS.taskAssignee, preferred)
            .filter(person => !(genericBusyTasks.get(String(person.id)) || new Set()).has(genericDateKeyFor(date)));
        const genericSpeakersAt = (date, preferred = []) => rankWithinLimits(speakerResult.rows, date, genericSpeakerWorkload, PLANNING_LIMITS.speaker, preferred)
            .filter(person => !(genericBusySpeakers.get(String(person.id)) || new Set()).has(genericDateKeyFor(date)));
        const genericToday = planningDateParts(new Date());
        const genericNextThreeDays = genericToday ? Array.from({ length: 3 }, (_, index) => new Date(Date.UTC(genericToday.year, genericToday.month - 1, genericToday.day + index)).toISOString().slice(0, 10)) : [];
        const genericAvailability = {
            dates: genericNextThreeDays,
            task_assignees: staffResult.rows.map(person => ({ person, dates: genericNextThreeDays.filter(date => !(genericBusyTasks.get(String(person.id)) || new Set()).has(date) && genericStaffAt(`${date}T12:00:00+07:00`).some(candidate => String(candidate.id) === String(person.id))) })).filter(item => item.dates.length).map(({ person, dates }) => ({ id: String(person.id), full_name: person.full_name, free_dates: dates })),
            speakers: speakerResult.rows.map(person => ({ person, dates: genericNextThreeDays.filter(date => !(genericBusySpeakers.get(String(person.id)) || new Set()).has(date) && genericSpeakersAt(`${date}T12:00:00+07:00`).some(candidate => String(candidate.id) === String(person.id))) })).filter(item => item.dates.length).map(({ person, dates }) => ({ id: String(person.id), full_name: person.full_name, free_dates: dates }))
        };
        const genericStaffingPlanAt = (date, preferredStaff = [], preferredSpeakers = []) => {
            const staffCandidates = genericStaffAt(date, preferredStaff);
            const speakerCandidates = genericSpeakersAt(date, preferredSpeakers);
            const personSummary = person => person ? { id: String(person.id), full_name: person.full_name, organization_name: person.organization_name || "", monthly_count: person.capacity.monthly_count, weekly_count: person.capacity.weekly_count } : null;
            const primaryStaff = staffCandidates.slice(0, PLANNING_LIMITS.staffPrimary).map(personSummary);
            const staffBackup = personSummary(staffCandidates[PLANNING_LIMITS.staffPrimary]);
            const primarySpeaker = personSummary(speakerCandidates[0]);
            const speakerBackup = personSummary(speakerCandidates[PLANNING_LIMITS.speakerPrimary]);
            return {
                staff: { primary: primaryStaff, backup: staffBackup, primary_shortfall: Math.max(0, PLANNING_LIMITS.staffPrimary - primaryStaff.length), backup_available: Boolean(staffBackup), monthly_limit: PLANNING_LIMITS.taskAssignee.monthly, weekly_limit: PLANNING_LIMITS.taskAssignee.weekly },
                speakers: { primary: primarySpeaker, backup: speakerBackup, primary_shortfall: primarySpeaker ? 0 : 1, backup_available: Boolean(speakerBackup), monthly_limit: PLANNING_LIMITS.speaker.monthly, weekly_limit: PLANNING_LIMITS.speaker.weekly }
            };
        };
        let genericStaffingShifted = false;
        let nearestRequestedDateAlternative = null;
        if (user.role === "ADMIN") {
            const earliestCandidateSlotId = slots[0]?.id || "";
            let search = findNearestFeasibleOptions(slots, genericStaffingPlanAt, PLANNING_LIMITS, 10);
            let checkedSlots = search.checked.map(({ option, staffing }) => ({ slot: option, staffing }));
            let feasibleSlots = search.feasible.map(({ option, staffing }) => ({ slot: option, staffing }));
            const requestedDateCandidate = requestedDateKey
                ? feasibleSlots.find(item => planningDateParts(item.slot.start_time)?.dayKey === requestedDateKey)
                    || checkedSlots.find(item => planningDateParts(item.slot.start_time)?.dayKey === requestedDateKey)
                    || null
                : null;
            if (!feasibleSlots.length && requestedWindow) {
                // Free dates inside a requested period can still lack qualified staff.
                // Search the next period before reporting a shortage.
                const nextWindowStart = new Date(`${requestedWindow.end}T00:00:00Z`);
                nextWindowStart.setUTCDate(nextWindowStart.getUTCDate() + 1);
                const nextKey = nextWindowStart.toISOString().slice(0, 10);
                slots.length = 0;
                collectSlots(nextKey > minimumDateKey ? nextKey : minimumDateKey);
                const nextSearch = findNearestFeasibleOptions(slots, genericStaffingPlanAt, PLANNING_LIMITS, 10);
                const nextCheckedSlots = nextSearch.checked.map(({ option, staffing }) => ({ slot: option, staffing }));
                checkedSlots = [...checkedSlots, ...nextCheckedSlots];
                feasibleSlots = nextSearch.feasible.map(({ option, staffing }) => ({ slot: option, staffing }));
                movedBeyondRequestedWindow = feasibleSlots.length > 0;
            }
            if (requestedDateCandidate) {
                feasibleSlots = prioritizeRequestedDateOption(feasibleSlots, requestedDateKey, requestedDateCandidate);
                nearestRequestedDateAlternative = feasibleSlots.find(item =>
                    planningDateParts(item.slot.start_time)?.dayKey !== requestedDateKey
                    && isPlanningFullyStaffed(item.staffing, PLANNING_LIMITS)) || null;
            }
            if (!feasibleSlots.length) {
                const best = checkedSlots.map(item => ({ ...item, shortage: getPlanningShortages(item.staffing, PLANNING_LIMITS) }))
                    .sort((a, b) => a.shortage.staff + a.shortage.speakers - b.shortage.staff - b.shortage.speakers)[0];
                const shortage = best?.shortage || null;
                const freePeople = group => (group || []).slice(0, 5).map(person => `${person.full_name} (${person.free_dates.join(", ")})`).join("; ") || "chưa có người phù hợp";
                const shortageText = shortage
                    ? `Trong ${checkedSlots.length ? "các khung giờ đã rà soát" : "kỳ đã rà soát"}, phương án gần nhất còn thiếu ${shortage.staff} vị trí cán bộ và ${shortage.speakers} vị trí báo cáo viên.`
                    : "Không tìm được khung giờ khả dụng để kiểm tra nhân sự.";
                return res.json({ success: true, data: { clarification: `${shortageText} Cán bộ đủ hạn mức, rảnh trong 3 ngày tới: ${freePeople(genericAvailability.task_assignees)}. Báo cáo viên: ${freePeople(genericAvailability.speakers)}. Admin có thể dời lịch, bổ sung nhân sự hoặc đề nghị thay đổi cơ cấu để xem xét; hệ thống không tự vượt hạn mức, lập phân công thiếu, lưu hay gửi thông báo.`,
                    staffing_resolution: { status: "STAFFING_SHORTAGE", shortage, checked_days: 180, best_candidate_slot: best?.slot?.label || null, available_staff_next_three_days: genericAvailability, admin_options: ["Dời lịch sang khung giờ khác", "Bổ sung/cử thêm nhân sự đủ điều kiện", "Chỉ đổi cơ cấu sau khi admin xác nhận nghiệp vụ"], requires_admin_choice: true, saved: false },
                    available_staff_next_three_days: genericAvailability, no_changes_saved: true, no_notifications_sent: true } });
            }
            const selectedDateKey = planningDateParts(feasibleSlots[0].slot.start_time)?.dayKey || "";
            genericStaffingShifted = selectedDateKey === requestedDateKey
                ? false
                : Boolean(movedBeyondRequestedWindow || feasibleSlots[0].slot.id !== earliestCandidateSlotId);
            slots.splice(0, slots.length, ...feasibleSlots.map((item, index) => ({ ...item.slot, id: `S${index + 1}` })));
        }
        const orgHistoryLocations = [...new Set(relevantHistory.map(row => row.location).filter(Boolean))].slice(0, 15);
        const historyLocations = orgHistoryLocations;
        const mentionsInRequest = value => {
            const key = normalizePlannerText(value);
            return key.length >= 4 && normalizePlannerText(planningContext).includes(key);
        };
        const selectedOrganizations = [...organizations.filter(item => item.id === String(user.organization_id || "") || mentionsInRequest(item.name)),
            ...organizations.filter(item => item.id !== String(user.organization_id || "") && !mentionsInRequest(item.name)).slice(0, 10)]
            .filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index).slice(0, 12);
        const selectedHistory = [...relevantHistory, ...history.filter(row => !relevantHistory.includes(row))].slice(0, 5);
        const selectedSurveySignals = [...surveySignals.filter(row => mentionsInRequest(row.value)),
            ...surveySignals.filter(row => !mentionsInRequest(row.value))].slice(0, 12);
        const rankPeople = rows => [...rows.filter(row => mentionsInRequest(row.full_name)), ...rows.filter(row => !mentionsInRequest(row.full_name))].slice(0, 12);
        const initialGenericStaff = genericStaffAt(slots[0].start_time).map(person => ({ ...person, monthly_count: person.capacity.monthly_count, weekly_count: person.capacity.weekly_count }));
        const initialGenericSpeakers = genericSpeakersAt(slots[0].start_time).map(person => ({ ...person, monthly_count: person.capacity.monthly_count, weekly_count: person.capacity.weekly_count }));
        const evidence = {
            planning_rules: PLANNING_SHORTAGE_POLICY,
            role: user.role,
            own_organization: user.role === "COMMUNE" ? organizations.find(item => item.id === String(user.organization_id))?.name || user.organization_name || "" : "",
            organizations: selectedOrganizations.map(({ id, name }) => ({ id, name })),
            visible_conference_history: selectedHistory,
            aggregated_survey_signals: selectedSurveySignals,
            monthly_conference_cap: MONTHLY_CONFERENCE_CAP,
            active_conferences_by_month: Object.fromEntries(activeMonthlyCounts),
            available_time_slots: slots.slice(0, 4),
            known_venues_in_visible_history: historyLocations,
            task_assignees: rankPeople(staffResult.rows),
            speakers: rankPeople(speakerResult.rows),
            staffing_limits: PLANNING_LIMITS,
            available_staff_next_three_days: genericAvailability
        };
        const model = process.env.OLLAMA_ANALYSIS_MODEL || process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
        const fallback = {
            title: String(basePlanningRequest || request).slice(0, 100),
            organization_id: planningOrganization?.id || (user.role === "COMMUNE" ? String(user.organization_id || "") : ""),
            organization_name: planningOrganization?.name || (user.role === "COMMUNE" ? evidence.own_organization : ""),
            location: orgHistoryLocations[0] || "Cần đơn vị xác nhận địa điểm phù hợp",
            time_slot_id: slots[0]?.id || "",
            expected_attendees: explicitlyRequestedCount || (relevantHistory.length ? Math.round(relevantHistory.reduce((sum, row) => sum + Number(row.expected_participants || 0), 0) / relevantHistory.length) : 0),
            legal_topic: "Quyền được trợ giúp pháp lý và cách gửi yêu cầu",
            rationale: relevantHistory.length ? "Tham khảo các hội nghị trong phạm vi tài khoản; xác nhận lại nhu cầu và quy mô thực tế." : "Chưa có đủ lịch sử trong phạm vi tài khoản; đây là gợi ý khởi đầu cần rà soát.",
            documents: ["Chương trình/kế hoạch hội nghị", "Tài liệu pháp luật chính thức còn hiệu lực", "Tài liệu hỏi đáp và tình huống thực hành", "Danh sách đại biểu, phiếu điểm danh và phiếu đánh giá"],
            tasks: ["Xác nhận nhu cầu, đối tượng và số lượng đại biểu", "Chuẩn bị hội trường, thiết bị và tài liệu", "Chuẩn bị chuyên đề và câu hỏi tình huống", "Điểm danh, tổng hợp đánh giá và báo cáo kết quả"].map(title => ({ title, description: "Bản nháp để người dùng rà soát; chưa giao nhiệm vụ." })),
            speakers: [],
            suggested_units: planningOrganization ? [planningOrganization] : [],
            notification_drafts: [],
            requires_admin_review: user.role !== "ADMIN"
        };
        const curatedThemes = [
            "Vướng mắc đất đai và bồi thường",
            "Thừa kế và tranh chấp dân sự",
            "Quyền được trợ giúp pháp lý và cách gửi yêu cầu",
            "Giấy tờ nhân thân, hộ tịch và cư trú",
            "Quyền của người cao tuổi và người khuyết tật",
            "Tiếp cận trợ giúp pháp lý trong hoạt động tố tụng"
        ];
        // The backend has already picked a feasible (nearest-first) time and staff pool.
        // Do not ask Ollama to choose dates, staff, or construct the operational plan.
        let proposal = { ...fallback, documents: [...fallback.documents], tasks: fallback.tasks.map(task => ({ ...task })) };
        let ollamaPlanningSummary = "";
        let ollamaSummaryUsed = false;
        if (!aiSuggestionInProgress) {
            aiSuggestionInProgress = true;
            try {
                const prompt = `Tóm tắt gợi ý chủ đề/kế hoạch bằng tiếng Việt, tối đa 40 từ; chỉ dựa trên các tín hiệu tổng hợp. Không quyết định ngày, nhân sự, đơn vị, quy mô, nhiệm vụ; không nêu căn cứ pháp luật. Trả về JSON {"summary":"..."}. Yêu cầu khái quát: ${String(request).slice(0, 250)}. Chủ đề đã chọn theo dữ liệu/ràng buộc: ${curatedThemes.find(theme => normalizePlannerText(request).includes(normalizePlannerText(theme))) || "chưa chốt"}. Tín hiệu tổng hợp: ${JSON.stringify(selectedSurveySignals.slice(0, 5))}`;
                const response = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
                    body: JSON.stringify({ model, stream: false, think: false, keep_alive: "30m", format: "json", messages: [{ role: "user", content: prompt }], options: { temperature: 0.2, num_ctx: 1024, num_predict: 100 } }) });
                if (response.ok) {
                    const result = await response.json().catch(() => ({}));
                    const summary = JSON.parse(String(result.message?.content || "{}")).summary;
                    if (typeof summary === "string" && summary.trim()) { ollamaPlanningSummary = summary.trim().slice(0, 400); ollamaSummaryUsed = true; }
                }
            } catch (error) { console.warn("Planning summary skipped; backend rules remain authoritative:", error.name); }
            finally { aiSuggestionInProgress = false; }
        }
        const organizationById = new Map(organizations.map(item => [item.id, item]));
        const allowedOrganizationIds = new Set((user.role === "COMMUNE"
            ? organizations.filter(item => item.id === String(user.organization_id || ""))
            : organizations).map(item => item.id));
        proposal.organization_id = planningOrganization && allowedOrganizationIds.has(planningOrganization.id)
            ? planningOrganization.id
            : allowedOrganizationIds.has(String(proposal.organization_id)) ? String(proposal.organization_id) : fallback.organization_id;
        proposal.organization_name = proposal.organization_id
            ? organizationById.get(proposal.organization_id)?.name || fallback.organization_name
            : fallback.organization_name || "";
        proposal.time_slot_id = slots.some(item => item.id === proposal.time_slot_id) ? proposal.time_slot_id : fallback.time_slot_id;
        proposal.expected_attendees = Math.max(0, Math.min(5000, explicitlyRequestedCount || fallback.expected_attendees));
        proposal.title = String(proposal.title || fallback.title).trim().slice(0, 180);
        if (/hướng dẫn gợi ý|yêu cầu gốc|dữ liệu có quyền truy cập|danh mục gợi ý/i.test(proposal.title)) {
            proposal.title = proposal.legal_topic ? `Hội nghị/tập huấn: ${String(proposal.legal_topic).slice(0, 140)}` : fallback.title;
        }
        proposal.location = String(proposal.location || fallback.location).trim().slice(0, 250);
        const requestedLocation = planningContext.match(/(?:tại|ở|địa điểm)\s+([^,.;\r\n]{4,100})/i)?.[1]?.trim();
        const locationWasExplicit = requestedLocation && normalizePlannerText(planningContext).includes(normalizePlannerText(proposal.location));
        const locationMatchesOrgHistory = orgHistoryLocations.some(location => normalizePlannerText(location) === normalizePlannerText(proposal.location));
        if (!locationWasExplicit && !locationMatchesOrgHistory) {
            proposal.location = orgHistoryLocations[0] || "Cần đơn vị xác nhận địa điểm phù hợp";
        }
        proposal.legal_topic = String(proposal.legal_topic || fallback.legal_topic).trim().slice(0, 500);
        proposal.rationale = String(proposal.rationale || fallback.rationale).trim().slice(0, 800);
        const selectedMonthSlot = slots.find(item => item.id === proposal.time_slot_id) || null;
        const selectedMonthKey = selectedMonthSlot?.start_time ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date(selectedMonthSlot.start_time)) : '';
        if (movedBeyondRequestedWindow && selectedMonthKey) {
            proposal.rationale = `Tháng/kỳ yêu cầu đã đủ ${MONTHLY_CONFERENCE_CAP} hội nghị hoặc không còn khung phù hợp; phương án được chuyển sang tháng khả thi ${selectedMonthKey} theo giới hạn lịch. ` + proposal.rationale;
        }
        const topicMatchers = [
            [/dat dai|boi thuong|thu hoi dat|giai phong mat bang/, curatedThemes[0]],
            [/thua ke|tranh chap dan su|dan su/, curatedThemes[1]],
            [/tro giup phap ly|quyen duoc tgpl|quyen duoc tro giup|gui yeu cau/, curatedThemes[2]],
            [/nhan than|ho tich|cu tru|giay to tuy than/, curatedThemes[3]],
            [/nguoi cao tuoi|nguoi khuyet tat|khuyet tat/, curatedThemes[4]],
            [/to tung|dieu tra|truy to|xet xu|co quan tien hanh/, curatedThemes[5]]
        ];
        const topicRequest = normalizePlannerText(request);
        const explicitTopic = topicMatchers.find(([pattern]) => pattern.test(topicRequest));
        const topicWasLeftOpen = /chua chot chu de|chua xac dinh chu de|goi y chu de|goi y noi dung phu hop/.test(topicRequest);
        if (explicitTopic && !topicWasLeftOpen) proposal.legal_topic = explicitTopic[1];
        else if (topicWasLeftOpen) {
            const modelTheme = curatedThemes.find(theme => normalizePlannerText(proposal.legal_topic).includes(normalizePlannerText(theme)));
            proposal.legal_topic = modelTheme || curatedThemes[2];
        }
        if (/(?:de xuat|hay lap|lap phuong an|lap ke hoach|goi y|chua chot chu de)/.test(normalizePlannerText(proposal.title))) {
            proposal.title = `${/tap huan/.test(topicRequest) ? "Tập huấn" : "Hội nghị"}: ${proposal.legal_topic.slice(0, 145)}`;
        }
        if (!explicitlyRequestedCount && relevantHistory.length) {
            proposal.rationale = `Tham khảo ${relevantHistory.length} hội nghị đã ghi nhận tại ${proposal.organization_name || "đơn vị được nêu"}; quy mô gợi ý là trung bình số người dự kiến trong các hồ sơ này. Cần đơn vị xác nhận nhu cầu thực tế.`;
        } else if (!explicitlyRequestedCount && !relevantHistory.length) {
            proposal.rationale = "Chưa có dữ liệu lịch sử phù hợp để ước lượng quy mô; cần đơn vị xác nhận số người dự kiến.";
        }
        if (asksAreaRecommendation) {
            const areaEvidenceNote = recommendedAreaLabel
                ? ` Địa bàn gợi ý: ${recommendedAreaLabel}, dựa trên tần suất phiếu khảo sát/hồ sơ trong phạm vi được phép; đây chỉ là tín hiệu tham khảo, admin cần xác nhận đơn vị và nhu cầu thực tế.`
                : " Chưa có dữ liệu khảo sát/hồ sơ đủ căn cứ để xếp hạng địa bàn; cần admin chọn địa bàn trước khi chốt.";
            proposal.rationale = `${proposal.rationale}${areaEvidenceNote}`.slice(0, 1000);
        }
        if (ollamaPlanningSummary) proposal.rationale = `${proposal.rationale} Tóm lược: ${ollamaPlanningSummary}`.slice(0, 1000);
        proposal.documents = Array.isArray(proposal.documents) ? proposal.documents.map(item => String(item).trim().slice(0, 250)).filter(Boolean).slice(0, 8) : fallback.documents;
        const staffIds = new Set(staffResult.rows.map(row => String(row.id)));
        const speakerIds = new Set(speakerResult.rows.map(row => String(row.id)));
        const chosenSlot = slots.find(item => item.id === proposal.time_slot_id) || null;
        const genericPreferredStaff = Array.isArray(proposal.tasks) ? proposal.tasks.map(item => item.assignee_user_id).filter(Boolean) : [];
        const genericPreferredSpeakers = Array.isArray(proposal.speakers) ? proposal.speakers.map(item => item.speaker_user_id).filter(Boolean) : [];
        const genericStaffCandidates = chosenSlot ? genericStaffAt(chosenSlot.start_time, genericPreferredStaff) : [];
        const genericSpeakerCandidates = chosenSlot ? genericSpeakersAt(chosenSlot.start_time, genericPreferredSpeakers) : [];
        const genericPrimaryStaff = genericStaffCandidates.slice(0, PLANNING_LIMITS.staffPrimary);
        const genericStaffBackup = genericStaffCandidates[PLANNING_LIMITS.staffPrimary] || null;
        const genericSpeakerPrimary = genericSpeakerCandidates[0] || null;
        const genericSpeakerBackup = genericSpeakerCandidates[PLANNING_LIMITS.speakerPrimary] || null;
        proposal.staffing_plan = chosenSlot ? genericStaffingPlanAt(chosenSlot.start_time, genericPreferredStaff, genericPreferredSpeakers) : {
            staff: { primary: [], backup: null, primary_shortfall: PLANNING_LIMITS.staffPrimary, backup_available: false, monthly_limit: PLANNING_LIMITS.taskAssignee.monthly, weekly_limit: PLANNING_LIMITS.taskAssignee.weekly },
            speakers: { primary: null, backup: null, primary_shortfall: 1, backup_available: false, monthly_limit: PLANNING_LIMITS.speaker.monthly, weekly_limit: PLANNING_LIMITS.speaker.weekly }
        };
        const genericStaffingComplete = user.role !== "ADMIN" || isPlanningFullyStaffed(proposal.staffing_plan, PLANNING_LIMITS);
        const requestedDatePrioritized = user.role === "ADMIN" && Boolean(requestedDateKey)
            && planningDateParts(chosenSlot?.start_time)?.dayKey === requestedDateKey;
        const requestedDateNeedsStaffingReview = requestedDatePrioritized && !genericStaffingComplete;
        const requestedDateAlternativeText = nearestRequestedDateAlternative
            ? ` Ngày đủ cơ cấu gần nhất tiếp theo: ${nearestRequestedDateAlternative.slot.label}.`
            : " Chưa tìm thấy ngày đủ cơ cấu gần nhất trong khoảng rà soát.";
        const genericStaffingResolution = user.role !== "ADMIN"
            ? { status: "ADMIN_ASSIGNMENT_REQUIRED", saved: false }
            : genericStaffingComplete
            ? { status: genericStaffingShifted ? "ALTERNATIVE_DATE_REQUIRED" : "REQUESTED_DATE_FEASIBLE", shortage: { staff: 0, speakers: 0 }, saved: false,
                note: genericStaffingShifted ? "Khung thời gian sớm hơn không đủ người theo hạn mức; các khung hiển thị đã được kiểm tra đủ cơ cấu." : "Khung hiển thị đã được kiểm tra đủ cơ cấu nhân sự." }
            : { status: requestedDateNeedsStaffingReview ? "REQUESTED_DATE_STAFFING_REVIEW" : "STAFFING_SHORTAGE",
                shortage: getPlanningShortages(proposal.staffing_plan, PLANNING_LIMITS), requires_admin_choice: true, saved: false,
                note: requestedDateNeedsStaffingReview
                    ? `Ngày yêu cầu không bị trùng khung giờ với hội nghị đang ghi nhận nên được giữ làm phương án ưu tiên. Danh sách dưới đây chỉ là gợi ý theo tải công việc hiện có; admin quyết định có phân công hay chọn phương án khác.${requestedDateAlternativeText}`
                    : "Chưa đủ cơ cấu để xác nhận phân công; xem tải công việc và lựa chọn phương án phù hợp.",
                nearest_feasible_alternative: requestedDateNeedsStaffingReview && nearestRequestedDateAlternative
                    ? { start_time: nearestRequestedDateAlternative.slot.start_time, end_time: nearestRequestedDateAlternative.slot.end_time, label: nearestRequestedDateAlternative.slot.label }
                    : null,
                admin_options: requestedDateNeedsStaffingReview
                    ? ["Giữ ngày yêu cầu và admin quyết định nhân sự theo tải công việc hiển thị", "Chọn một ngày thay thế đủ cơ cấu", "Bổ sung nhân sự đủ điều kiện"]
                    : ["Chọn khung thời gian khác sau khi rà soát lịch", "Bổ sung/cử thêm cán bộ hoặc báo cáo viên đủ điều kiện", "Chỉ thay đổi cơ cấu khi admin xác nhận nghiệp vụ cho phép"] };
        if (requestedDateNeedsStaffingReview) {
            proposal.rationale = `Ưu tiên ngày dự kiến ${requestedDateKey}; khung giờ này không chồng lấn hội nghị đang ghi nhận. Nhân sự được gợi ý theo tải hiện tại, còn thiếu ${genericStaffingResolution.shortage.staff} vị trí cán bộ và ${genericStaffingResolution.shortage.speakers} vị trí báo cáo viên; admin quyết định trước khi phân công. ${proposal.rationale}`.slice(0, 1000);
        }
        const planCreatedAt = Date.now();
        const suggestedDueAt = (index, count) => chosenSlot
            ? new Date(planCreatedAt + (new Date(chosenSlot.start_time).getTime() - planCreatedAt) * (index + 1) / (count + 1)).toISOString()
            : null;
        const genericTaskRoster = genericPrimaryStaff.slice(0, PLANNING_LIMITS.staffPrimary);
        proposal.tasks = Array.isArray(proposal.tasks) ? proposal.tasks.slice(0, PLANNING_LIMITS.staffPrimary).map((item, index) => ({
            title: String(item.title || "Nhiệm vụ chuẩn bị").trim().slice(0, 180),
            description: String(item.description || "").trim().slice(0, 500),
            assignee_user_id: user.role === "ADMIN" ? String(genericTaskRoster[index]?.id || "") : "",
            staffing_role: "PRIMARY",
            due_at: Number.isFinite(new Date(item.due_at).getTime()) && chosenSlot && new Date(item.due_at) > new Date() && new Date(item.due_at) < new Date(chosenSlot.start_time)
                ? new Date(item.due_at).toISOString() : suggestedDueAt(index, Math.min(Array.isArray(proposal.tasks) ? proposal.tasks.length : 0, PLANNING_LIMITS.staffPrimary))
        })) : fallback.tasks;
        const genericSpeakerModelItems = user.role === "ADMIN" && Array.isArray(proposal.speakers)
            ? proposal.speakers.filter(item => speakerIds.has(String(item.speaker_user_id))).slice(0, 2) : [];
        const genericSpeakerById = new Map(genericSpeakerModelItems.map(item => [String(item.speaker_user_id), item]));
        proposal.speakers = user.role === "ADMIN" ? [genericSpeakerPrimary, genericSpeakerBackup].filter(Boolean).map((person, index) => {
            const prior = genericSpeakerById.get(String(person.id)) || genericSpeakerModelItems[index] || {};
            return { speaker_user_id: String(person.id), topic: String(prior.topic || proposal.legal_topic).slice(0, 250), notes: [String(prior.notes || "").slice(0, 400), index ? "Vai trò: dự bị; chỉ thay thế khi cần." : "Vai trò: chính thức."].filter(Boolean).join(" "), staffing_role: index ? "BACKUP" : "PRIMARY" };
        }) : [];
        if (user.role === "ADMIN" && !genericStaffingComplete) proposal.speakers = [];
        const validatedUnits = Array.isArray(proposal.suggested_units) ? proposal.suggested_units.filter(item => allowedOrganizationIds.has(String(item.id))).slice(0, 10).map(item => organizationById.get(String(item.id))) : [];
        proposal.suggested_units = planningOrganization && allowedOrganizationIds.has(planningOrganization.id)
            ? [organizationById.get(planningOrganization.id)] : [];
        const validatedNotices = Array.isArray(proposal.notification_drafts) ? proposal.notification_drafts.filter(item => allowedOrganizationIds.has(String(item.organization_id))).slice(0, 10).map(item => ({ organization_id: String(item.organization_id), message: String(item.message || "").trim().slice(0, 700) })).filter(item => item.message.length >= 10) : [];
        proposal.notification_drafts = validatedNotices;
        proposal.requires_admin_review = user.role !== "ADMIN";
        const selectedSlot = chosenSlot;
        res.json({ success: true, data: { proposal, available_time_slots: slots, generated_by: ollamaSummaryUsed ? `backend-rules+${model}-summary` : "backend-rules",
            no_changes_saved: true, no_notifications_sent: true, role: user.role,
            schedule_capacity: { monthly_limit: MONTHLY_CONFERENCE_CAP, active_counts_by_month: Object.fromEntries(activeMonthlyCounts), shifted_to_next_feasible_month: movedBeyondRequestedWindow, selected_month: selectedMonthKey },
            eligible_task_assignees: genericStaffCandidates.map(({ id, full_name, organization_name, capacity }) => ({ id: String(id), full_name, organization_name, monthly_count: capacity.monthly_count, weekly_count: capacity.weekly_count })),
            eligible_speakers: genericSpeakerCandidates.map(({ id, full_name, organization_name, capacity }) => ({ id: String(id), full_name, organization_name, monthly_count: capacity.monthly_count, weekly_count: capacity.weekly_count })),
            available_staff_next_three_days: genericAvailability,
            staffing_resolution: genericStaffingResolution,
            staffing_limits: PLANNING_LIMITS,
            note: "Đây chỉ là bản nháp. Mỗi mục cần được xác nhận riêng; hệ thống chưa lưu phân công hoặc gửi thông báo.", selected_time_slot: selectedSlot } });
    } catch (error) {
        console.error("Conference plan proposal failed:", error);
        res.status(500).json({ success: false, message: "Không tạo được gợi ý kế hoạch. Vui lòng thử lại." });
    }
});

// Admin-only daily intake review. It produces a read-only batch draft for
// today's new conference and legal-aid contact requests; it never assigns,
// changes statuses, or sends notifications.
router.post("/ai/admin/daily-intake-review", requireRole("ADMIN"), async (_req, res) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    try {
        const [conferenceResult, consultationResult, staffResult, speakerResult, approvedResult] = await Promise.all([
            pool.query(`SELECT c.id,c.code,c.title,c.description,c.organization_id,o.name AS organization_name,
                    c.start_time,c.end_time,COALESCE(c.location_name,c.location_address,'') AS location,
                    COALESCE(c.expected_participants,0)::int AS expected_participants,c.created_at
                FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
                WHERE c.status='PENDING'
                  AND c.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                  AND c.created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                ORDER BY c.created_at,c.id`, [today]),
            pool.query(`SELECT r.id,r.user_role,r.organization_name,r.status,r.created_at,r.question
                FROM legal_aid_contact_requests r
                WHERE r.status='PENDING'
                  AND r.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                  AND r.created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                ORDER BY r.created_at,r.id`, [today]),
            pool.query(`SELECT u.id,u.full_name,o.name AS organization_name,
                    (SELECT COUNT(*)::int FROM conference_task_assignments a WHERE a.assignee_user_id=u.id AND a.status IN ('ASSIGNED','IN_PROGRESS')) AS active_tasks,
                    (SELECT COUNT(*)::int FROM legal_aid_contact_requests r WHERE r.assigned_staff_user_id=u.id AND r.status IN ('ASSIGNED','CONTACTED')) AS active_consultations
                FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.role='TASK_ASSIGNEE' AND u.is_active=TRUE ORDER BY u.full_name LIMIT 200`),
            pool.query(`SELECT u.id,u.full_name,o.name AS organization_name,
                    (SELECT COUNT(*)::int FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
                        WHERE s.speaker_user_id=u.id AND c.status IN ('APPROVED','PENDING')) AS active_sessions
                FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.role='SPEAKER' AND u.is_active=TRUE ORDER BY u.full_name LIMIT 200`),
            pool.query(`SELECT id,code,title,start_time,end_time,COALESCE(location_name,location_address,'') AS location
                FROM conferences WHERE status='APPROVED' AND COALESCE(end_time,start_time)>=NOW()`)
        ]);

        // Balance only against known active load. Proposed allocations stay in
        // memory for this response and are not persisted.
        const staffLoad = new Map(staffResult.rows.map(person => [String(person.id), Number(person.active_tasks || 0) + Number(person.active_consultations || 0)]));
        const consultationRequests = consultationResult.rows.map(row => {
            const eligible = [...staffResult.rows].sort((a, b) => (staffLoad.get(String(a.id)) - staffLoad.get(String(b.id))) || String(a.full_name).localeCompare(String(b.full_name), "vi"));
            const suggested = eligible[0] || null;
            if (suggested) staffLoad.set(String(suggested.id), staffLoad.get(String(suggested.id)) + 1);
            const q = String(row.question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");
            const topic = /dat dai|boi thuong|thu hoi/.test(q) ? "Đất đai, bồi thường"
                : /thua ke|tranh chap dan su/.test(q) ? "Thừa kế, tranh chấp dân sự"
                : /tre em|nguoi duoi 18/.test(q) ? "Trẻ em, người chưa thành niên"
                : /nguoi cao tuoi|khuyet tat/.test(q) ? "Người cao tuổi, người khuyết tật"
                : /ho ngheo|doi tuong tro giup|tro giup phap ly|tgpl/.test(q) ? "Điều kiện, quyền được trợ giúp pháp lý"
                : "Cần cán bộ rà soát nội dung trực tiếp";
            return { id: String(row.id), received_at: row.created_at, organization_name: row.organization_name || "Người dân/đơn vị gửi yêu cầu",
                requester_role: row.user_role || "PUBLIC", topic_summary: topic,
                suggested_assignee: suggested ? { id: String(suggested.id), full_name: suggested.full_name, organization_name: suggested.organization_name || "", known_load: staffLoad.get(String(suggested.id)) - 1 } : null,
                needs_staff: !suggested, review_url: "legal-aid-requests.html" };
        });

        const speakerLoad = new Map(speakerResult.rows.map(person => [String(person.id), Number(person.active_sessions || 0)]));
        const venueDrafts = [];
        const conferenceRequests = conferenceResult.rows.map(row => {
            const start = row.start_time ? new Date(row.start_time) : null;
            const end = row.end_time ? new Date(row.end_time) : start;
            const overlapping = start && end && approvedResult.rows.find(existing => {
                const busyStart = new Date(existing.start_time), busyEnd = new Date(existing.end_time || existing.start_time);
                return start < busyEnd && end > busyStart && row.location && existing.location && row.location.trim().toLocaleLowerCase("vi") === existing.location.trim().toLocaleLowerCase("vi");
            });
            const batchConflict = start && end && venueDrafts.find(item => item.start && item.end && start < item.end && end > item.start && row.location && item.location && row.location.trim().toLocaleLowerCase("vi") === item.location.trim().toLocaleLowerCase("vi"));
            const isPast = Boolean(start && start.getTime() < Date.now());
            const conflicted = overlapping || batchConflict || isPast;
            // Keep the requested time if clear. If it clashes, find the next
            // weekday slot at the same clock time that avoids approved events
            // and earlier draft suggestions at this venue.
            let proposedStart = start, proposedEnd = end;
            if (conflicted && start && end) {
                const duration = Math.max(30 * 60 * 1000, end.getTime() - start.getTime());
                const baseStart = isPast ? new Date(Date.now() + 86400000) : start;
                for (let offset = 1; offset <= 60; offset++) {
                    const candidateStart = new Date(baseStart.getTime() + offset * 86400000);
                    const weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short" }).format(candidateStart) === "Sun" ? 0
                        : new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short" }).format(candidateStart) === "Sat" ? 6 : 1);
                    if (weekday === 0 || weekday === 6) continue;
                    const candidateEnd = new Date(candidateStart.getTime() + duration);
                    const approvedConflict = approvedResult.rows.some(existing => {
                        const busyStart = new Date(existing.start_time), busyEnd = new Date(existing.end_time || existing.start_time);
                        return candidateStart < busyEnd && candidateEnd > busyStart && row.location && existing.location && row.location.trim().toLocaleLowerCase("vi") === existing.location.trim().toLocaleLowerCase("vi");
                    });
                    const draftConflict = venueDrafts.some(item => item.start && item.end && candidateStart < item.end && candidateEnd > item.start && row.location && item.location && row.location.trim().toLocaleLowerCase("vi") === item.location.trim().toLocaleLowerCase("vi"));
                    if (!approvedConflict && !draftConflict) { proposedStart = candidateStart; proposedEnd = candidateEnd; break; }
                }
            }
            const staff = [...staffResult.rows].sort((a, b) => (staffLoad.get(String(a.id)) - staffLoad.get(String(b.id))) || String(a.full_name).localeCompare(String(b.full_name), "vi"))[0] || null;
            const speaker = [...speakerResult.rows].sort((a, b) => (speakerLoad.get(String(a.id)) - speakerLoad.get(String(b.id))) || String(a.full_name).localeCompare(String(b.full_name), "vi"))[0] || null;
            if (staff) staffLoad.set(String(staff.id), staffLoad.get(String(staff.id)) + 1);
            if (speaker && start) speakerLoad.set(String(speaker.id), speakerLoad.get(String(speaker.id)) + 1);
            const draft = { id: String(row.id), code: row.code || "", title: row.title || "Chưa có tiêu đề", organization_id: String(row.organization_id || ""),
                organization_name: row.organization_name || "Chưa xác định đơn vị", requested_start: row.start_time, requested_end: row.end_time,
                proposed_start: proposedStart?.toISOString() || null, proposed_end: proposedEnd?.toISOString() || null,
                schedule_changed: Boolean(conflicted && proposedStart && start && proposedStart.getTime() !== start.getTime()),
                location: row.location || "Chưa xác định địa điểm", expected_participants: Number(row.expected_participants || 0), received_at: row.created_at,
                conflict: conflicted ? { type: isPast ? "PAST_REQUEST" : overlapping ? "APPROVED_EVENT" : "BATCH_EVENT", code: conflicted.code || "", title: conflicted.title || "Hội nghị khác", location: conflicted.location || row.location || "" } : null,
                proposed_assignee: staff ? { id: String(staff.id), full_name: staff.full_name, organization_name: staff.organization_name || "" } : null,
                proposed_speaker: speaker ? { id: String(speaker.id), full_name: speaker.full_name, organization_name: speaker.organization_name || "" } : null,
                needs_staff: !staff, needs_speaker: !speaker, review_url: `conference-list.html?id=${encodeURIComponent(row.id)}` };
            conferenceRequests.push(draft);
            if (proposedStart && proposedEnd) venueDrafts.push({ start: proposedStart, end: proposedEnd, location: row.location });
            return draft;
        });
        const noRequests = conferenceRequests.length === 0 && consultationRequests.length === 0;
        res.json({ success: true, data: { date: today, conference_count: conferenceRequests.length, consultation_count: consultationRequests.length,
            total_count: conferenceRequests.length + consultationRequests.length, conferences: conferenceRequests, consultations: consultationRequests,
            available_task_assignees: staffResult.rows.length, available_speakers: speakerResult.rows.length,
            no_requests: noRequests, no_changes_saved: true, no_notifications_sent: true,
            note: "Bản rà soát và đề xuất theo tải công việc đã biết; chưa lưu phân công, chưa đổi trạng thái và chưa gửi thông báo. Admin cần kiểm tra chuyên môn, thời gian thực tế và xác nhận từng hồ sơ." } });
    } catch (error) {
        console.error("Admin daily intake review failed:", error);
        res.status(500).json({ success: false, message: "Chưa rà soát được yêu cầu mới trong ngày. Vui lòng thử lại." });
    }
});

router.get("/ai/conference-plan-notifications/mine", requireRole("ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    try {
        const result = req.user.role === "ADMIN"
            ? await pool.query(`SELECT n.id,n.subject,n.message,n.created_at,n.read_at,o.name AS organization_name,
                    u.full_name AS sender_name,c.code AS conference_code
                FROM conference_plan_notifications n JOIN organizations o ON o.id=n.organization_id
                JOIN users u ON u.id=n.sender_user_id LEFT JOIN conferences c ON c.id=n.conference_id
                ORDER BY n.created_at DESC LIMIT 50`)
            : await pool.query(`SELECT n.id,n.subject,n.message,n.created_at,n.read_at,o.name AS organization_name,
                    u.full_name AS sender_name,c.code AS conference_code
                FROM conference_plan_notifications n JOIN organizations o ON o.id=n.organization_id
                JOIN users u ON u.id=n.sender_user_id LEFT JOIN conferences c ON c.id=n.conference_id
                WHERE n.organization_id=$1 ORDER BY n.created_at DESC LIMIT 30`, [req.user.organization_id || null]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Conference plan notification list failed:", error);
        res.status(500).json({ success: false, message: "Chưa tải được thông báo hội nghị." });
    }
});

router.post("/ai/conference-plan-notifications", requireRole("ADMIN"), async (req, res) => {
    const organizationId = String(req.body?.organization_id || "").trim();
    const subject = String(req.body?.subject || "").trim().slice(0, 240);
    const message = String(req.body?.message || "").trim().slice(0, 3000);
    const conferenceId = req.body?.conference_id ? String(req.body.conference_id).trim() : null;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(organizationId) || (conferenceId && !uuidPattern.test(conferenceId)) || subject.length < 3 || message.length < 10) {
        return res.status(400).json({ success: false, message: "Thiếu đơn vị nhận hoặc nội dung thông báo chưa hợp lệ." });
    }
    try {
        const result = await pool.query(`INSERT INTO conference_plan_notifications
            (organization_id,conference_id,sender_user_id,subject,message)
            SELECT o.id,$2,$3,$4,$5 FROM organizations o WHERE o.id=$1
            RETURNING id,organization_id,conference_id,created_at`, [organizationId, conferenceId, req.user.id, subject, message]);
        if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy đơn vị nhận thông báo." });
        res.status(201).json({ success: true, data: result.rows[0], message: "Đã gửi thông báo đến đơn vị." });
    } catch (error) {
        console.error("Conference plan notification send failed:", error);
        res.status(500).json({ success: false, message: "Chưa gửi được thông báo. Vui lòng thử lại." });
    }
});

router.post("/ai/conference-plan-notifications/:id/read", requireRole("ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    try {
        const result = req.user.role === "ADMIN"
            ? await pool.query(`UPDATE conference_plan_notifications SET read_at=COALESCE(read_at,NOW()),read_by=COALESCE(read_by,$2)
                WHERE id=$1 RETURNING id,read_at`, [req.params.id, req.user.id])
            : await pool.query(`UPDATE conference_plan_notifications SET read_at=COALESCE(read_at,NOW()),read_by=COALESCE(read_by,$3)
                WHERE id=$1 AND organization_id=$2 RETURNING id,read_at`, [req.params.id, req.user.organization_id || null, req.user.id]);
        if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy thông báo trong phạm vi tài khoản." });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error("Conference plan notification read failed:", error);
        res.status(500).json({ success: false, message: "Chưa cập nhật được trạng thái thông báo." });
    }
});

// AI creates a reviewable draft from the conference request and current system
// data. It never writes assignments or changes the conference schedule.
router.post("/ai/conferences/:id/plan", requireRole("ADMIN"), async (req, res) => {
    let conferenceId = String(req.params.id || "");
    const forceReschedule = String(req.body?.intent || "").toUpperCase() === "RESCHEDULE";
    try {
        const conferenceResult = await pool.query(`SELECT c.id,c.code,c.title,c.description,c.organization_id,
                CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END AS start_time,
                CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_end_time ELSE c.end_time END AS end_time,
                c.location_name,c.location_address,c.expected_participants,c.status,o.name AS organization_name
            FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE c.id::text=$1 OR UPPER(c.code)=UPPER($1) LIMIT 1`, [conferenceId]);
        if (!conferenceResult.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy đề nghị hội nghị." });
        const conference = conferenceResult.rows[0];
        // Resolve a UUID or human-readable conference code once; use the canonical UUID below.
        conferenceId = String(conference.id);
        if (["COMPLETED", "CANCELLED", "REJECTED"].includes(conference.status)) {
            return res.status(409).json({ success: false, message: "Hội nghị đã đóng hoặc bị từ chối, không thể lập kế hoạch." });
        }
        const now = new Date();
        const requestedStart = new Date(conference.start_time);
        const requestedStartForSearch = Number.isFinite(requestedStart.getTime())
            ? new Date(requestedStart.getTime() + (forceReschedule ? 86400000 : 0)) : null;
        const fallbackSearchStart = new Date(now.getTime() + 7 * 86400000);
        const preferredStart = requestedStartForSearch && requestedStartForSearch > now ? requestedStartForSearch : null;
        const preferredKey = planningDateParts(preferredStart || fallbackSearchStart)?.dayKey;
        if (!preferredKey) return res.status(400).json({ success: false, message: "Không xác định được ngày bắt đầu rà soát lịch." });
        const searchStartUtc = new Date(`${preferredKey}T00:00:00.000Z`);
        const nominalSearchLastDay = new Date(searchStartUtc);
        nominalSearchLastDay.setUTCDate(nominalSearchLastDay.getUTCDate() + 179);
        const searchEndExclusive = new Date(Date.UTC(nominalSearchLastDay.getUTCFullYear(), nominalSearchLastDay.getUTCMonth() + 1, 1));
        const candidateScanDays = Math.ceil((searchEndExclusive.getTime() - searchStartUtc.getTime()) / 86400000);
        const searchWindowEnd = new Date(searchEndExclusive.getTime() - 86400000).toISOString().slice(0, 10);

        const [staffResult, speakerResult, registrationResult, publicResult, publicSituationResult, approvedResult, taskLoadResult, taskQuotaResult, speakerQuotaResult, nearTaskDatesResult, nearSpeakerDatesResult] = await Promise.all([
            pool.query(`SELECT u.id,u.username,u.full_name,o.name AS organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
                WHERE u.role='TASK_ASSIGNEE' AND u.is_active=TRUE ORDER BY u.full_name`),
            pool.query(`SELECT u.id,u.username,u.full_name,o.name AS organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
                WHERE u.role='SPEAKER' AND u.is_active=TRUE ORDER BY u.full_name`),
            pool.query(`SELECT COALESCE(SUM(expected_count),0)::int AS count,COUNT(*)::int AS organizations
                FROM conference_attendance_registrations WHERE conference_id=$1`, [conferenceId]),
            pool.query(`SELECT COUNT(*)::int AS count FROM public_attendance_registrations WHERE conference_id=$1`, [conferenceId]),
            pool.query(`SELECT consultation_situation,attendee_name,attendee_address,attendee_email
                FROM public_attendance_registrations WHERE conference_id=$1
                  AND NULLIF(BTRIM(consultation_situation),'') IS NOT NULL
                ORDER BY created_at DESC LIMIT 30`, [conferenceId]),
            pool.query(`SELECT c.code,c.title,c.organization_id,c.status,c.reschedule_response,o.name AS organization_name,
                    CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END AS occupied_start,
                    CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN COALESCE(c.proposed_end_time,c.end_time,c.proposed_start_time,c.start_time) ELSE COALESCE(c.end_time,c.start_time) END AS occupied_end,
                    ((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS start_date
                FROM conferences c LEFT JOIN organizations o ON o.id=c.organization_id
                WHERE c.status IN ('PENDING','APPROVED','RESCHEDULED') AND c.id<>$1
                  AND COALESCE(proposed_start_time,start_time) IS NOT NULL
                  AND COALESCE(proposed_start_time,start_time)>=NOW()`, [conferenceId]),
            pool.query(`SELECT assignee_user_id,COUNT(*)::int AS active_tasks FROM conference_task_assignments
                WHERE status IN ('ASSIGNED','IN_PROGRESS') GROUP BY assignee_user_id`),
            pool.query(`SELECT a.assignee_user_id::text AS user_id,
                    to_char((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') AS month_key,
                    to_char(date_trunc('week',(CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') AS week_key,
                    COUNT(*)::int AS count
                FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
                WHERE a.assignee_user_id IS NOT NULL AND a.status<>'CANCELLED'
                  AND (CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) IS NOT NULL
                  AND c.status NOT IN ('CANCELLED','REJECTED')
                  AND c.id<>$1
                GROUP BY a.assignee_user_id,month_key,week_key`, [conferenceId]),
            pool.query(`SELECT s.speaker_user_id::text AS user_id,
                    to_char((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') AS month_key,
                    to_char(date_trunc('week',(CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh'),'YYYY-MM-DD') AS week_key,
                    COUNT(*)::int AS count
                FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
                WHERE s.speaker_user_id IS NOT NULL
                  AND (CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) IS NOT NULL
                  AND c.status NOT IN ('CANCELLED','REJECTED')
                  AND c.id<>$1
                GROUP BY s.speaker_user_id,month_key,week_key`, [conferenceId]),
            pool.query(`SELECT DISTINCT a.assignee_user_id::text AS user_id,
                    (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date_key
                FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
                WHERE a.assignee_user_id IS NOT NULL AND a.status<>'CANCELLED' AND c.id<>$1
                  AND c.status IN ('PENDING','APPROVED','RESCHEDULED')
                  AND (CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) IS NOT NULL
                  AND ((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                   AND ((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $2::date + 1`, [conferenceId, searchWindowEnd]),
            pool.query(`SELECT DISTINCT s.speaker_user_id::text AS user_id,
                    (COALESCE(c.proposed_start_time,c.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date_key
                FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
                WHERE s.speaker_user_id IS NOT NULL AND c.id<>$1
                  AND c.status IN ('PENDING','APPROVED','RESCHEDULED')
                  AND (CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) IS NOT NULL
                  AND ((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                   AND ((CASE WHEN c.status='RESCHEDULED' AND c.reschedule_response IN ('PENDING','ACCEPTED') THEN c.proposed_start_time ELSE c.start_time END) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $2::date + 1`, [conferenceId, searchWindowEnd])
        ]);

        // Suggestions are not commitments. Do not let other unsaved AI drafts
        // consume dates, monthly slots, or staff/speaker quotas for this plan.
        const draftConstraints = { intervals: [], monthlyConferenceCounts: new Map(), taskWorkload: [], speakerWorkload: [], busyTaskDates: new Map(), busySpeakerDates: new Map() };
        const requestedEnd = conference.end_time ? new Date(conference.end_time) : requestedStart;
        const dayKeyFor = date => new Date(date).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
        const requestedDurationMs = requestedEnd - requestedStart;
        const sameRequestedDay = Number.isFinite(requestedStart.getTime()) && Number.isFinite(requestedEnd.getTime()) &&
            dayKeyFor(requestedStart) === dayKeyFor(requestedEnd);
        // Keep a realistic same-day duration; malformed or overnight requests
        // use a standard 3-hour session so a suggestion cannot spill into a blocked day.
        const durationMs = sameRequestedDay && requestedDurationMs >= 60 * 60 * 1000 && requestedDurationMs <= 4 * 60 * 60 * 1000
            ? requestedDurationMs : 3 * 60 * 60 * 1000;
        const requestedConflictEnd = requestedEnd > requestedStart ? requestedEnd : new Date(requestedStart.getTime() + durationMs);
        const approvedSameLocalityConflicts = findApprovedScheduleConflicts(requestedStart, requestedConflictEnd, conference.organization_id,
            approvedResult.rows.map(row => ({ code: row.code, title: row.title, organization_id: row.organization_id, organization_name: row.organization_name,
                status: row.status, start: row.occupied_start, end: row.occupied_end })));
        const occupiedIntervals = [];
        const reservedScheduleRows = approvedResult.rows.filter(row => row.status === "APPROVED" ||
            (row.status === "RESCHEDULED" && ["PENDING", "ACCEPTED"].includes(row.reschedule_response)));
        const activeMonthlyCounts = new Map();
        for (const row of approvedResult.rows) {
            const from = new Date(row.occupied_start);
            const to = new Date(row.occupied_end || row.occupied_start);
            if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) continue;
            const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(from);
            activeMonthlyCounts.set(monthKey, (activeMonthlyCounts.get(monthKey) || 0) + 1);
            // Any approved schedule or proposed reschedule reserves the whole
            // local calendar day; a morning meeting also blocks the afternoon.
            const scheduleReserved = row.status === "APPROVED" ||
                (row.status === "RESCHEDULED" && ["PENDING", "ACCEPTED"].includes(row.reschedule_response));
            if (scheduleReserved) {
                const firstDay = new Date(`${dayKeyFor(from)}T00:00:00Z`);
                const lastDay = new Date(`${dayKeyFor(to < from ? from : to)}T00:00:00Z`);
                for (const day = new Date(firstDay); day <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
                    const localDay = day.toISOString().slice(0, 10);
                    const dayStart = new Date(`${localDay}T00:00:00+07:00`);
                    occupiedIntervals.push({ start: dayStart, end: new Date(dayStart.getTime() + 86400000) });
                }
            }
        }
        occupiedIntervals.push(...draftConstraints.intervals);
        for (const [monthKey, count] of draftConstraints.monthlyConferenceCounts) activeMonthlyCounts.set(monthKey, (activeMonthlyCounts.get(monthKey) || 0) + count);
        const candidateDateOptions = [];
        const monthlyCapRejections = new Map();
        const candidateSlotsByMonth = new Map();
        const overlapRejections = new Map();
        const timeSlots = [{ startHour: 8, startMinute: 30 }, { startHour: 13, startMinute: 30 }];
        // Keep the nominal 180-day horizon, then finish the final calendar month
        // so monthly diagnostics never report an artificially tiny partial month.
        for (let offset = 0; offset < candidateScanDays; offset++) {
            const date = new Date(`${preferredKey}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset);
            const dayKey = date.toISOString().slice(0, 10);
            const weekday = new Date(`${dayKey}T12:00:00+07:00`).getDay();
            if ([0, 6].includes(weekday)) continue;
            const monthKey = dayKey.slice(0, 7);
            if (!isConferenceMonthAvailable(`${dayKey}T12:00:00+07:00`, activeMonthlyCounts, 15)) {
                monthlyCapRejections.set(monthKey, (monthlyCapRejections.get(monthKey) || 0) + 1);
                continue;
            }
            for (const slot of timeSlots) {
                const start = new Date(`${dayKey}T${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")}:00+07:00`);
                const end = new Date(start.getTime() + durationMs);
                // Ignore past time windows and ensure both ends stay on the free day.
                if (start <= now || (dayKey === preferredKey && start <= preferredStart) || dayKeyFor(end) !== dayKey) continue;
                if (overlapsTimeInterval(start, end, occupiedIntervals)) {
                    overlapRejections.set(monthKey, (overlapRejections.get(monthKey) || 0) + 1);
                    continue;
                }
                candidateDateOptions.push({ id: `C${candidateDateOptions.length + 1}`, start_time: start.toISOString(), end_time: end.toISOString(),
                    label: `${start.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · ${start.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}` });
                candidateSlotsByMonth.set(monthKey, (candidateSlotsByMonth.get(monthKey) || 0) + 1);
            }
        }

        const taskLoads = new Map(taskLoadResult.rows.map(row => [String(row.assignee_user_id), Number(row.active_tasks || 0)]));
        const staff = staffResult.rows.map(row => ({ ...row, active_tasks: taskLoads.get(String(row.id)) || 0 }))
            .sort((a, b) => a.active_tasks - b.active_tasks || a.full_name.localeCompare(b.full_name, "vi"));
        const taskWorkload = [...taskQuotaResult.rows.map(row => ({ ...row, count: Number(row.count || 0) })), ...draftConstraints.taskWorkload];
        const speakerWorkload = [...speakerQuotaResult.rows.map(row => ({ ...row, count: Number(row.count || 0) })), ...draftConstraints.speakerWorkload];
        const busyTaskDates = new Map([...draftConstraints.busyTaskDates].map(([id, dates]) => [id, new Set(dates)]));
        for (const row of nearTaskDatesResult.rows) {
            const dates = busyTaskDates.get(String(row.user_id)) || new Set(); dates.add(String(row.date_key)); busyTaskDates.set(String(row.user_id), dates);
        }
        const busySpeakerDates = new Map([...draftConstraints.busySpeakerDates].map(([id, dates]) => [id, new Set(dates)]));
        for (const row of nearSpeakerDatesResult.rows) {
            const dates = busySpeakerDates.get(String(row.user_id)) || new Set(); dates.add(String(row.date_key)); busySpeakerDates.set(String(row.user_id), dates);
        }
        const dateKeyFor = value => planningDateParts(value)?.dayKey || "";
        const getStaffCapacity = (date, preferred = []) => rankWithinLimits(staff, date, taskWorkload, PLANNING_LIMITS.taskAssignee, preferred)
            .filter(person => !(busyTaskDates.get(String(person.id)) || new Set()).has(dateKeyFor(date)));
        const getSpeakerCapacity = (date, preferred = []) => rankWithinLimits(speakerResult.rows, date, speakerWorkload, PLANNING_LIMITS.speaker, preferred)
            .filter(person => !(busySpeakerDates.get(String(person.id)) || new Set()).has(dateKeyFor(date)));
        const reviewWorkload = (people, date, workload, limits, busyDates) => people.map(person => {
            const capacity = getPersonCapacity(person, date, workload, limits);
            const isBusy = (busyDates.get(String(person.id)) || new Set()).has(dateKeyFor(date));
            return { id: String(person.id), full_name: person.full_name, organization_name: person.organization_name || "",
                monthly_count: capacity.monthly_count, monthly_limit: capacity.monthly_limit,
                weekly_count: capacity.weekly_count, weekly_limit: capacity.weekly_limit,
                eligible: capacity.eligible && !isBusy,
                reason: !capacity.eligible ? capacity.reason : isBusy ? "Đã có nhiệm vụ/lịch cùng ngày" : "Còn hạn mức và trống ngày" };
        });
        const buildStaffingPlan = (date, preferredStaff = [], preferredSpeakers = []) => {
            const staffCandidates = getStaffCapacity(date, preferredStaff);
            const speakerCandidates = getSpeakerCapacity(date, preferredSpeakers);
            return {
                staff: {
                    primary: staffCandidates.slice(0, PLANNING_LIMITS.staffPrimary).map(person => ({ id: String(person.id), full_name: person.full_name, organization_name: person.organization_name || "", monthly_count: person.capacity.monthly_count, weekly_count: person.capacity.weekly_count })),
                    backup: staffCandidates[PLANNING_LIMITS.staffPrimary] ? { id: String(staffCandidates[PLANNING_LIMITS.staffPrimary].id), full_name: staffCandidates[PLANNING_LIMITS.staffPrimary].full_name, organization_name: staffCandidates[PLANNING_LIMITS.staffPrimary].organization_name || "", monthly_count: staffCandidates[PLANNING_LIMITS.staffPrimary].capacity.monthly_count, weekly_count: staffCandidates[PLANNING_LIMITS.staffPrimary].capacity.weekly_count } : null,
                    requested_primary: PLANNING_LIMITS.staffPrimary,
                    primary_shortfall: Math.max(0, PLANNING_LIMITS.staffPrimary - staffCandidates.slice(0, PLANNING_LIMITS.staffPrimary).length),
                    backup_available: Boolean(staffCandidates[PLANNING_LIMITS.staffPrimary]),
                    monthly_limit: PLANNING_LIMITS.taskAssignee.monthly, weekly_limit: PLANNING_LIMITS.taskAssignee.weekly
                },
                speakers: {
                    primary: speakerCandidates[0] ? { id: String(speakerCandidates[0].id), full_name: speakerCandidates[0].full_name, organization_name: speakerCandidates[0].organization_name || "", monthly_count: speakerCandidates[0].capacity.monthly_count, weekly_count: speakerCandidates[0].capacity.weekly_count } : null,
                    backup: speakerCandidates[PLANNING_LIMITS.speakerPrimary] ? { id: String(speakerCandidates[PLANNING_LIMITS.speakerPrimary].id), full_name: speakerCandidates[PLANNING_LIMITS.speakerPrimary].full_name, organization_name: speakerCandidates[PLANNING_LIMITS.speakerPrimary].organization_name || "", monthly_count: speakerCandidates[PLANNING_LIMITS.speakerPrimary].capacity.monthly_count, weekly_count: speakerCandidates[PLANNING_LIMITS.speakerPrimary].capacity.weekly_count } : null,
                    primary_shortfall: speakerCandidates.length ? 0 : 1,
                    backup_available: Boolean(speakerCandidates[PLANNING_LIMITS.speakerPrimary]),
                    monthly_limit: PLANNING_LIMITS.speaker.monthly, weekly_limit: PLANNING_LIMITS.speaker.weekly
                },
                workload_review: {
                    task_assignees: reviewWorkload(staff, date, taskWorkload, PLANNING_LIMITS.taskAssignee, busyTaskDates),
                    speakers: reviewWorkload(speakerResult.rows, date, speakerWorkload, PLANNING_LIMITS.speaker, busySpeakerDates)
                }
            };
        };
        // A date already submitted by a commune is a fixed preference. Do not
        // silently move it because of the weekday filter, monthly planning cap,
        // or a staffing shortfall. Only an approved same-organization conflict
        // or a same-day approved/proposed schedule can displace that requested date.
        const requestedScheduleEnd = new Date(requestedStart.getTime() + durationMs);
        const requestedDateCollision = overlapsTimeInterval(requestedStart, requestedScheduleEnd, occupiedIntervals);
        const requestedDayKey = Number.isFinite(requestedStart.getTime()) ? dayKeyFor(requestedStart) : "";
        const requestedDayScheduleConflicts = requestedDayKey ? reservedScheduleRows.filter(row => {
            const from = new Date(row.occupied_start);
            const to = new Date(row.occupied_end || row.occupied_start);
            return Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) &&
                dayKeyFor(from) <= requestedDayKey && dayKeyFor(to < from ? from : to) >= requestedDayKey;
        }).map(row => ({ code: row.code, title: row.title, organization_name: row.organization_name,
            status: row.status, start: row.occupied_start, end: row.occupied_end })) : [];
        const requestedScheduleCanStay = !forceReschedule && canKeepRequestedSchedule({
            start: requestedStart,
            end: requestedScheduleEnd,
            now,
            approvedConflicts: approvedSameLocalityConflicts,
            draftIntervals: draftConstraints.intervals
        }) && !requestedDateCollision;
        const requestedDateCandidate = requestedScheduleCanStay ? (() => {
            const staffing = buildStaffingPlan(requestedStart);
            return {
                option: {
                    id: "REQUESTED",
                    start_time: requestedStart.toISOString(),
                    end_time: requestedScheduleEnd.toISOString(),
                    label: `${requestedStart.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · ${requestedStart.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}–${requestedScheduleEnd.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}`
                },
                staffing
            };
        })() : null;
        const dateSearch = findNearestFeasibleOptions(candidateDateOptions, buildStaffingPlan, PLANNING_LIMITS, 3);
        const requestedDateKey = requestedDateCandidate ? dayKeyFor(requestedDateCandidate.option.start_time) : "";
        const alternativeDateOptions = selectNearestDateOptions(dateSearch.checked, {
            requestedDate: requestedDateCandidate ? requestedDateKey : "",
            maxOptions: requestedDateCandidate ? 2 : 3,
            limits: PLANNING_LIMITS
        });
        const prioritizedDateSearch = requestedDateCandidate
            ? prioritizeRequestedDateOption(alternativeDateOptions, requestedDateKey, requestedDateCandidate)
            : alternativeDateOptions;
        const dateOptions = prioritizedDateSearch.map(({ option, staffing }, index) => {
            const shortage = getPlanningShortages(staffing, PLANNING_LIMITS);
            return { ...option, staffing_plan: staffing, staffing_complete: isPlanningFullyStaffed(staffing, PLANNING_LIMITS), staffing_shortage: shortage, id: `D${index + 1}` };
        });
        const diagnosticMonthKeys = [...new Set([
            ...activeMonthlyCounts.keys(), ...candidateSlotsByMonth.keys(), ...monthlyCapRejections.keys(), ...overlapRejections.keys()
        ])].filter(key => key >= preferredKey.slice(0, 7) && key <= searchWindowEnd.slice(0, 7)).sort();
        const scheduleDiagnostics = {
            monthly_limit: 15,
            nominal_search_days: 180,
            search_window_end: searchWindowEnd,
            months: diagnosticMonthKeys.map(month => ({ month,
                active_conferences: Number(activeMonthlyCounts.get(month) || 0),
                remaining_capacity: Math.max(0, 15 - Number(activeMonthlyCounts.get(month) || 0)),
                free_candidate_slots: Number(candidateSlotsByMonth.get(month) || 0),
                weekdays_rejected_by_month_cap: Number(monthlyCapRejections.get(month) || 0),
                slots_rejected_by_reserved_schedule_day: Number(overlapRejections.get(month) || 0)
            })),
            returned_options: dateOptions.map(option => ({ date: dayKeyFor(option.start_time), complete_staffing: option.staffing_complete, shortage: option.staffing_shortage }))
        };
        const bestCandidate = dateSearch.bestCandidate;
        const checkedDays = candidateScanDays;
        const todayParts = planningDateParts(new Date());
        const nextThreeDays = todayParts ? Array.from({ length: 3 }, (_, index) => {
            const date = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + index));
            return date.toISOString().slice(0, 10);
        }) : [];
        const nextThreeDayAvailability = {
            dates: nextThreeDays,
            task_assignees: staff.map(person => ({ person, dates: nextThreeDays.filter(date =>
                !(busyTaskDates.get(String(person.id)) || new Set()).has(date) && getStaffCapacity(`${date}T12:00:00+07:00`).some(candidate => String(candidate.id) === String(person.id))) }))
                .filter(item => item.dates.length).map(({ person, dates }) => ({ id: String(person.id), full_name: person.full_name, organization_name: person.organization_name || "", free_dates: dates })),
            speakers: speakerResult.rows.map(person => ({ person, dates: nextThreeDays.filter(date =>
                !(busySpeakerDates.get(String(person.id)) || new Set()).has(date) && getSpeakerCapacity(`${date}T12:00:00+07:00`).some(candidate => String(candidate.id) === String(person.id))) }))
                .filter(item => item.dates.length).map(({ person, dates }) => ({ id: String(person.id), full_name: person.full_name, organization_name: person.organization_name || "", free_dates: dates }))
        };
        if (!dateOptions.length) {
            const staffingResolution = {
                status: candidateDateOptions.length ? "NO_FEASIBLE_STAFFING" : "NO_AVAILABLE_TIME_SLOT",
                checked_days: checkedDays,
                requested_date: preferredKey,
                best_candidate_date: bestCandidate?.option?.label || null,
                shortage: bestCandidate?.shortages || null,
                available_staff_next_three_days: nextThreeDayAvailability,
                schedule_diagnostics: scheduleDiagnostics,
                admin_options: ["Giữ ngày gần nhất và admin quyết định vị trí còn thiếu", "Chọn ngày gần nhất có cơ cấu đủ người", "Bổ sung/cử thêm cán bộ hoặc báo cáo viên đủ điều kiện"],
                requires_admin_choice: true,
                requested_reschedule: forceReschedule,
                requires_reschedule: forceReschedule || approvedSameLocalityConflicts.length > 0 || requestedDateCollision,
                saved: false
            };
            return res.json({ success: true, data: { plan: null, alternatives: [], evidence: { conference: { code: conference.code, title: conference.title, organization: conference.organization_name, requested_start: conference.start_time, requested_end: conference.end_time, status: conference.status }, available_dates: [], approved_same_locality_conflicts: approvedSameLocalityConflicts, approved_same_day_schedule_conflicts: requestedDayScheduleConflicts, available_staff_next_three_days: nextThreeDayAvailability, staffing_limits: PLANNING_LIMITS, schedule_diagnostics: scheduleDiagnostics }, staffing_resolution: staffingResolution, requires_admin_review: true, saved: false } });
        }
        // Keep a short list in the response/prompt. Every listed option has already
        // passed the backend's full primary/backup and quota checks.
        // Keep citizens' identity and contact details out of the Ollama prompt.
        // Free-text is evidence only; any instructions inside it are untrusted.
        const consultationSituations = [...new Set(publicSituationResult.rows.map(row => {
            let text = String(row.consultation_situation || "").normalize("NFKC").trim();
            const identities = [row.attendee_name, row.attendee_address, row.attendee_email]
                .map(value => String(value || "").trim()).filter(value => value.length >= 3)
                .sort((a, b) => b.length - a.length);
            for (const identity of identities) text = text.split(identity).join("[đã ẩn thông tin cá nhân]");
            return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[đã ẩn email]")
                .replace(/\b(?:\+?84|0)(?:[\s().-]*\d){8,10}\b/g, "[đã ẩn số điện thoại]")
                .replace(/\s+/g, " ").slice(0, 500);
        }).filter(Boolean))].slice(0, 8);
        const evidence = {
            planning_rules: PLANNING_SHORTAGE_POLICY,
            conference: {
                code: conference.code, title: conference.title, description: conference.description,
                organization: conference.organization_name, requested_start: conference.start_time,
                requested_end: conference.end_time, location: conference.location_name || conference.location_address,
                requested_attendees: Number(conference.expected_participants || 0), status: conference.status
            },
            available_dates: dateOptions.map(({ staffing_plan, ...option }) => option),
            approved_same_locality_conflicts: approvedSameLocalityConflicts,
            approved_same_day_schedule_conflicts: requestedDayScheduleConflicts,
            eligible_task_assignees: staff,
            eligible_speakers: speakerResult.rows,
            staffing_limits: PLANNING_LIMITS,
            assignment_workload_by_month_week: { task_assignees: taskWorkload, speakers: speakerWorkload },
            available_staff_next_three_days: nextThreeDayAvailability,
            attendance: { registered_organizations: Number(registrationResult.rows[0]?.organizations || 0),
                estimated_people_from_units: Number(registrationResult.rows[0]?.count || 0), public_residents_registered: Number(publicResult.rows[0]?.count || 0) },
            public_attendee_consultation_situations: consultationSituations
        };

        const topicLabel = String(conference.title || conference.description || "nội dung hội nghị").trim().slice(0, 180);
        const planCreatedAt = Date.now();
        const taskDueAt = (meetingStart, count, index) => new Date(planCreatedAt + (new Date(meetingStart).getTime() - planCreatedAt) * (index + 1) / (count + 1)).toISOString();
        const fallbackSpeakerQuestions = [
            `Những nội dung trọng tâm nào về “${topicLabel}” người tham dự cần nắm?`,
            `Quy định hoặc hướng dẫn nào liên quan trực tiếp đến chủ đề cần được làm rõ?`,
            `Những tình huống thực tế hoặc vướng mắc phổ biến nào nên trao đổi tại hội nghị?`,
            `Người tham dự cần thực hiện bước nào sau hội nghị để áp dụng nội dung đã trao đổi?`
        ];
        // Backend decisions are authoritative: dateOptions is nearest-first and each
        // entry passed calendar and monthly-cap checks; staffing gaps are returned
        // explicitly so a shortage never pushes the plan months farther away silently.
        const schedulesForAlternatives = dateOptions.slice(0, 3);
        const schedule = schedulesForAlternatives[0];
        const firstStaffingPlan = schedule.staffing_plan;
        const firstPrimaryStaff = firstStaffingPlan.staff.primary.slice(0, PLANNING_LIMITS.staffPrimary);
        const plan = {
            id: "P1", schedule_option_id: schedule.id,
            schedule_reason: requestedDateCollision ? `Ngày yêu cầu đã có lịch hội nghị được giữ chỗ${requestedDayScheduleConflicts.length ? ` (${requestedDayScheduleConflicts.map(item => `${item.code}${item.organization_name ? ` · ${item.organization_name}` : ""}`).join(", ")})` : ""}; cả buổi sáng và buổi chiều đều bị loại, nên đề xuất ngày gần nhất còn lịch.` : approvedSameLocalityConflicts.length ? `Yêu cầu bị trùng lịch với ${approvedSameLocalityConflicts.map(item => item.code).join(", ")} đã được phê duyệt tại cùng đơn vị; đề xuất chuyển sang ngày gần nhất còn lịch.` : requestedDateCandidate ? "Ưu tiên ngày giờ đơn vị đã đăng ký vì ngày đó không có lịch hội nghị được giữ chỗ. Tải nhân sự được rà riêng; vị trí thiếu cần admin quyết định." : forceReschedule ? `Theo yêu cầu dời lịch, đề xuất ngày gần nhất còn lịch sau lịch hiện tại: ${schedule.label}.` : `Ngày gần nhất còn lịch: ${schedule.label}. Lịch ngày và trần tháng đã được kiểm tra; cơ cấu nhân sự ${isPlanningFullyStaffed(firstStaffingPlan, PLANNING_LIMITS) ? "đủ theo hạn mức" : "còn thiếu, xem tải toàn bộ nhân sự bên dưới"}.`,
            expected_attendees: Math.max(Number(conference.expected_participants || 0), Number(registrationResult.rows[0]?.count || 0) + Number(publicResult.rows[0]?.count || 0)),
            attendee_basis: "Quy mô đăng ký và dự kiến hiện có; admin xác nhận trước khi chốt.",
            staffing_plan: firstStaffingPlan,
            speakers: [firstStaffingPlan.speakers.primary, firstStaffingPlan.speakers.backup].filter(Boolean).map((person, index) => ({
                speaker_user_id: String(person.id), presentation_title: topicLabel, speaking_order: index + 1,
                duration_minutes: 30, staffing_role: index === 0 ? "PRIMARY" : "BACKUP",
                notes: index === 0 ? "Báo cáo viên chính thức theo hạn mức và lịch khả dụng." : "Báo cáo viên dự bị; chỉ thay thế khi cần."
            })),
            tasks: firstPrimaryStaff.map((person, index) => ({
                title: ["Chuẩn bị hội trường và thiết bị", "Gửi giấy mời, xác nhận đại biểu", "Chuẩn bị tài liệu và hậu cần"][index],
                description: ["Kiểm tra địa điểm, âm thanh và trình chiếu.", "Theo dõi số người tham dự và xác nhận đại biểu.", "Chuẩn bị tài liệu theo chủ đề; rà soát với báo cáo viên."][index],
                assignee_user_id: String(person.id), staffing_role: "PRIMARY",
                due_at: taskDueAt(schedule.start_time, firstPrimaryStaff.length, index)
            })),
            speaker_questions: fallbackSpeakerQuestions,
            planning_notes: ["Ngày được chọn là ngày gần nhất còn khung giờ trong phạm vi rà soát. Tải cán bộ và báo cáo viên đã được đối chiếu trên toàn bộ tài khoản đang hoạt động; admin xác nhận trước khi lưu hoặc gửi thông báo."]
        };
        const firstOptionShortage = getPlanningShortages(firstStaffingPlan, PLANNING_LIMITS);
        if (firstOptionShortage.staff || firstOptionShortage.speakers) {
            plan.planning_notes.unshift(`${requestedDateCandidate ? "Giữ ngày giờ đơn vị đăng ký" : "Ngày khả thi gần nhất"}; cơ cấu còn thiếu ${firstOptionShortage.staff} vị trí cán bộ và ${firstOptionShortage.speakers} vị trí báo cáo viên. Tải từng nhân sự được liệt kê; không tự vượt hạn mức, admin quyết định.`);
        }
        const alternatives = schedulesForAlternatives.map((slot, alternativeIndex) => {
            const staffingPlan = slot.staffing_plan;
            const primaryStaff = staffingPlan.staff.primary.slice(0, PLANNING_LIMITS.staffPrimary);
            const speakers = [staffingPlan.speakers.primary, staffingPlan.speakers.backup].filter(Boolean).map((person, index) => ({
                speaker_user_id: String(person.id), presentation_title: topicLabel, speaking_order: index + 1,
                duration_minutes: 30, staffing_role: index === 0 ? "PRIMARY" : "BACKUP",
                notes: index === 0 ? "Báo cáo viên chính thức theo hạn mức và lịch khả dụng." : "Báo cáo viên dự bị; chỉ thay thế khi cần."
            }));
            const tasks = primaryStaff.map((person, index) => ({
                ...plan.tasks[index], assignee_user_id: String(person.id), staffing_role: "PRIMARY",
                due_at: taskDueAt(slot.start_time, primaryStaff.length, index)
            }));
            const shortage = getPlanningShortages(staffingPlan, PLANNING_LIMITS);
            const fullyStaffed = isPlanningFullyStaffed(staffingPlan, PLANNING_LIMITS);
            const optionNotes = ["Tải của toàn bộ cán bộ và báo cáo viên được đối chiếu theo hạn mức tháng/tuần; admin duyệt trước khi lưu hoặc thông báo."];
            if (!fullyStaffed) optionNotes.unshift(`Còn thiếu ${shortage.staff} vị trí cán bộ và ${shortage.speakers} vị trí báo cáo viên theo cơ cấu mục tiêu; không tự vượt hạn mức.`);
            return { id: `P${alternativeIndex + 1}`, label: `Phương án ${alternativeIndex + 1} · ${slot.label}`,
                ...plan, staffing_plan: staffingPlan, schedule_option_id: slot.id,
                schedule_reason: requestedDateCandidate && slot.id === dateOptions[0]?.id
                    ? plan.schedule_reason
                    : fullyStaffed ? `Ngày gần nhất còn lịch và đủ cơ cấu nhân lực theo hạn mức: ${slot.label}.`
                        : `Ngày gần nhất còn lịch; thiếu ${shortage.staff} vị trí cán bộ và ${shortage.speakers} vị trí báo cáo viên. Admin xem tải toàn bộ nhân sự trước khi quyết định.`,
                planning_notes: optionNotes, speakers, tasks };
        });
        // Ollama is limited to optional wording/questions; timeout or contention never
        // delays/blocks the deterministic feasible plan returned above.
        let modelNote = "";
        let ollamaSummaryUsed = false;
        const model = process.env.OLLAMA_ANALYSIS_MODEL || process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
        if (!aiSuggestionInProgress) {
            aiSuggestionInProgress = true;
            try {
                const prompt = `Viết tóm tắt kế hoạch bằng tiếng Việt tối đa 45 từ và tối đa 3 câu hỏi chuẩn bị cho báo cáo viên. Không thay đổi ngày, nhân sự, phân công hoặc hạn mức; không kết luận pháp lý. Chỉ JSON {"summary":"...","questions":["..."]}. Chủ đề: ${topicLabel}. Mô tả: ${String(conference.description || "").slice(0, 300)}. Tình huống đã ẩn danh: ${JSON.stringify(consultationSituations.slice(0, 2))}`;
                const response = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(2000),
                    body: JSON.stringify({ model, stream: false, think: false, keep_alive: "30m", messages: [{ role: "user", content: prompt }], format: "json", options: { temperature: 0.2, num_ctx: 1024, num_predict: 120 } }) });
                if (response.ok) {
                    const result = await response.json().catch(() => ({}));
                    const generated = JSON.parse(String(result.message?.content || "{}"));
                    ollamaSummaryUsed = true;
                    if (typeof generated.summary === "string") plan.planning_notes.unshift(generated.summary.trim().slice(0, 500));
                    if (Array.isArray(generated.questions) && generated.questions.length) plan.speaker_questions = generated.questions.map(item => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 3);
                }
            } catch { modelNote = "Phần diễn giải AI quá thời hạn; phương án khả thi được tạo bằng các quy tắc hệ thống."; }
            finally { aiSuggestionInProgress = false; }
        } else modelNote = "Ollama đang bận; phương án khả thi được tạo bằng các quy tắc hệ thống.";
        if (modelNote) plan.planning_notes.push(modelNote);
        if (modelNote) plan.planning_notes.push(modelNote);
        for (const alternative of alternatives) {
            if (modelNote) alternative.planning_notes.push(modelNote);
            alternative.speaker_questions = [...plan.speaker_questions];
        }
        if (alternatives.length) Object.assign(plan, alternatives[0], { alternatives });
        res.json({ success: true, data: { plan, alternatives, evidence, staffing_resolution: {
            status: requestedDateCandidate
                ? (firstOptionShortage.staff + firstOptionShortage.speakers > 0 ? "REQUESTED_DATE_STAFFING_REVIEW" : "REQUESTED_DATE_FEASIBLE")
                : firstOptionShortage.staff + firstOptionShortage.speakers > 0 ? "ALTERNATIVE_DATE_STAFFING_REVIEW"
                : forceReschedule ? "RESCHEDULE_PROPOSAL" : (approvedSameLocalityConflicts.length || requestedDateCollision) ? "APPROVED_CONFERENCE_CONFLICT" : "ALTERNATIVE_DATE_REQUIRED",
            requested_date: preferredKey, requested_reschedule: forceReschedule, approved_same_locality_conflicts: approvedSameLocalityConflicts, approved_same_day_schedule_conflicts: requestedDayScheduleConflicts, requires_reschedule: forceReschedule || approvedSameLocalityConflicts.length > 0 || requestedDateCollision, alternatives_require_admin_choice: true, saved: false,
            shortage: firstOptionShortage,
            schedule_diagnostics: scheduleDiagnostics,
            note: requestedDateCandidate ? "Ngày đăng ký được giữ làm phương án đầu nếu không trùng lịch đã duyệt cùng đơn vị; tải của toàn bộ nhân sự được hiển thị để admin quyết định, hệ thống không tự vượt hạn mức." : "Các phương án là những ngày gần nhất còn khung lịch; phương án thiếu người vẫn được hiển thị cùng tải nhân sự để admin quyết định.",
            admin_options: ["Giữ ngày gần nhất và admin quyết định vị trí còn thiếu", "Chọn phương án gần nhất đủ cơ cấu nhân lực", "Bổ sung/cử thêm cán bộ hoặc báo cáo viên đủ điều kiện"]
        }, draft_reservation: null, generated_by: ollamaSummaryUsed ? `system-rules+${model}-summary` : "system-rules", requires_admin_review: true, saved: false } });
    } catch (error) {
        console.error("AI conference planning failed:", error);
        res.status(500).json({ success: false, message: "Không tạo được phương án lúc này. Vui lòng kiểm tra backend và dữ liệu hội nghị." });
    }
});
const integer = value => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

async function findApprovedDateConflicts(db, conferenceId, start, end) {
    return db.query(`SELECT other.id,other.code,other.title,other.start_time,other.end_time,
            COALESCE(other.location_name,other.location_address,'Chưa cập nhật') AS location,
            organization.name AS organization_name
        FROM conferences other LEFT JOIN organizations organization ON organization.id=other.organization_id
        WHERE other.id<>$1 AND other.status='APPROVED'
          AND daterange((other.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                        (COALESCE(other.end_time,other.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'[]')
              && daterange(($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                           ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'[]')
        ORDER BY other.start_time,other.code`, [conferenceId, start, end]);
}

async function canAccessConferenceFiles(req, conferenceId) {
    if (req.user.role === "ADMIN") return true;
    const result = await pool.query(`SELECT 1 FROM conferences c WHERE c.id=$1 AND (
        ( $2='COMMUNE' AND c.organization_id=$3 ) OR
        ( $2='TASK_ASSIGNEE' AND EXISTS (SELECT 1 FROM conference_task_assignments a WHERE a.conference_id=c.id AND a.assignee_user_id=$4) ) OR
        ( $2='SPEAKER' AND EXISTS (SELECT 1 FROM conference_speakers s WHERE s.conference_id=c.id AND s.speaker_user_id=$4) )
    )`, [conferenceId, req.user.role, req.user.organization_id || null, req.user.id]);
    return result.rowCount > 0;
}

async function removeStoredFile(storageKey) {
    if (!storageKey || path.basename(storageKey) !== storageKey) return;
    try { await fs.unlink(path.join(upload.uploadDir, storageKey)); }
    catch (error) { if (error.code !== "ENOENT") console.warn("Could not remove replaced attachment file:", error.message); }
}

async function loadConferenceAttachment(req, res, next) {
    try {
        const result = await pool.query(`SELECT id,conference_id,file_name,storage_key,uploaded_by FROM conference_attachments
            WHERE id=$1 AND is_deleted=FALSE`, [req.params.attachmentId]);
        const attachment = result.rows[0];
        const isOwner = attachment && String(attachment.uploaded_by) === String(req.user.id);
        if (!result.rowCount || !(await canAccessConferenceFiles(req, attachment.conference_id)) || (req.user.role !== "ADMIN" && !isOwner)) {
            return res.status(404).json({ success: false, message: "Không tìm thấy tệp trong phạm vi tài khoản." });
        }
        req.currentAttachment = attachment;
        next();
    } catch (error) { next(error); }
}

async function loadTaskAttachment(req, res, next) {
    try {
        const result = await pool.query(`SELECT f.id,f.task_assignment_id,f.file_name,f.storage_key,t.assignee_user_id
            FROM conference_task_attachments f JOIN conference_task_assignments t ON t.id=f.task_assignment_id WHERE f.id=$1`, [req.params.attachmentId]);
        if (!result.rowCount || (req.user.role !== "ADMIN" && String(result.rows[0].assignee_user_id) !== String(req.user.id))) {
            return res.status(404).json({ success: false, message: "Không tìm thấy tệp trong phạm vi tài khoản." });
        }
        req.currentAttachment = result.rows[0];
        next();
    } catch (error) { next(error); }
}

router.get("/conferences/:id/attachments", requireRole("ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    if (!(await canAccessConferenceFiles(req, req.params.id))) return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị trong phạm vi tài khoản." });
    const result = await pool.query(`SELECT id,conference_id,file_name,storage_key,file_size,mime_type,attachment_type,uploaded_by,uploaded_at
        FROM conference_attachments WHERE conference_id=$1 AND is_deleted=FALSE ORDER BY uploaded_at DESC`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});

router.post("/conferences/:id/attachments", requireRole("ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"), async (req, res, next) => {
    if (!(await canAccessConferenceFiles(req, req.params.id))) return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị trong phạm vi tài khoản." });
    next();
}, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "Chưa chọn file." });
    try {
        const result = await pool.query(`INSERT INTO conference_attachments(conference_id,file_name,storage_key,file_size,mime_type,attachment_type,uploaded_by)
            VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.params.id,req.file.originalname,req.file.filename,req.file.size,req.file.mimetype || "application/octet-stream",req.body?.attachment_type || null,req.user.id]);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { await removeStoredFile(req.file.filename); throw error; }
});

router.put("/conference-attachments/:attachmentId/file", requireRole("ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"), loadConferenceAttachment, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "Hãy chọn tệp thay thế." });
    try {
        const result = await pool.query(`UPDATE conference_attachments SET file_name=$1,storage_key=$2,file_size=$3,mime_type=$4,uploaded_by=$5,uploaded_at=NOW()
            WHERE id=$6 AND is_deleted=FALSE RETURNING id,conference_id,file_name,storage_key,file_size,mime_type,attachment_type,uploaded_by,uploaded_at`,
        [req.file.originalname,req.file.filename,req.file.size,req.file.mimetype || "application/octet-stream",req.user.id,req.currentAttachment.id]);
        if (!result.rowCount) { await removeStoredFile(req.file.filename); return res.status(404).json({ success: false, message: "Tệp không còn tồn tại." }); }
        await removeStoredFile(req.currentAttachment.storage_key);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) { await removeStoredFile(req.file.filename); throw error; }
});

router.delete("/conference-attachments/:attachmentId", requireRole("ADMIN"), loadConferenceAttachment, async (req, res) => {
    await pool.query("UPDATE conference_attachments SET is_deleted=TRUE WHERE id=$1", [req.currentAttachment.id]);
    await removeStoredFile(req.currentAttachment.storage_key);
    res.json({ success: true });
});

router.put("/task-attachments/:attachmentId/file", requireRole("ADMIN", "TASK_ASSIGNEE"), loadTaskAttachment, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "Hãy chọn tệp thay thế." });
    try {
        const result = await pool.query(`UPDATE conference_task_attachments SET file_name=$1,storage_key=$2,file_size=$3,mime_type=$4,uploaded_by=$5,uploaded_at=NOW()
            WHERE id=$6 RETURNING id,task_assignment_id,file_name,storage_key,file_size,mime_type,uploaded_at`,
        [req.file.originalname,req.file.filename,req.file.size,req.file.mimetype || "application/octet-stream",req.user.id,req.currentAttachment.id]);
        await removeStoredFile(req.currentAttachment.storage_key);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) { await removeStoredFile(req.file.filename); throw error; }
});

router.delete("/task-attachments/:attachmentId", requireRole("ADMIN"), loadTaskAttachment, async (req, res) => {
    await pool.query("DELETE FROM conference_task_attachments WHERE id=$1", [req.currentAttachment.id]);
    await removeStoredFile(req.currentAttachment.storage_key);
    res.json({ success: true });
});

router.post("/organizations", requireRole("ADMIN"), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Vui lòng nhập tên đơn vị." });
    const code = String(req.body?.code || `ORG_${crypto.randomBytes(4).toString("hex").toUpperCase()}`).trim().toUpperCase();
    const type = String(req.body?.organization_type || "COMMUNE").trim().toUpperCase();
    const result = await pool.query(`INSERT INTO organizations(code,name,organization_type,address,phone,email)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,code,name,organization_type,address,phone,email,is_active`,
    [code, name, type, req.body?.address || null, req.body?.phone || null, req.body?.email || null]);
    res.status(201).json({ success: true, data: result.rows[0] });
});

router.put("/organizations/:id", requireRole("ADMIN"), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Vui lòng nhập tên đơn vị." });
    const duplicate = await pool.query("SELECT 1 FROM organizations WHERE LOWER(name)=LOWER($1) AND id<>$2 AND is_active=TRUE LIMIT 1", [name, req.params.id]);
    if (duplicate.rowCount) return res.status(409).json({ success: false, message: "Tên đơn vị đã tồn tại. Hãy chọn tên khác để phân biệt." });
    const result = await pool.query(`UPDATE organizations SET name=$1,address=COALESCE($2,address),phone=COALESCE($3,phone),email=COALESCE($4,email),updated_at=NOW()
        WHERE id=$5 AND is_active=TRUE RETURNING id,code,name,organization_type,address,phone,email,is_active`,
    [name, req.body?.address ?? null, req.body?.phone ?? null, req.body?.email ?? null, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy đơn vị." });
    res.json({ success: true, data: result.rows[0] });
});

router.delete("/organizations/:id", requireRole("ADMIN"), async (req, res) => {
    const result = await pool.query("UPDATE organizations SET is_active=FALSE,updated_at=NOW() WHERE id=$1 AND is_active=TRUE RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy đơn vị." });
    res.json({ success: true });
});

router.get("/my-conference-notifications", requireRole("COMMUNE"), async (req, res) => {
    if (!req.user.organization_id) return res.status(403).json({ success: false, message: "Tài khoản chưa được gán đơn vị." });
    const result = await pool.query(`SELECT c.id,c.code,c.title,c.status,c.start_time,c.proposed_start_time,c.proposed_end_time,c.reschedule_note,c.reschedule_response,c.reschedule_responded_at,c.created_at,c.updated_at,
        (SELECT string_agg(people.name, ', ' ORDER BY people.name) FROM (
            SELECT DISTINCT COALESCE(NULLIF(a.assignee_name,''),u.full_name) AS name
            FROM conference_task_assignments a LEFT JOIN users u ON u.id=a.assignee_user_id
            WHERE a.conference_id=c.id AND a.status<>'CANCELLED'
        ) people WHERE people.name IS NOT NULL) AS task_assignees,
        (SELECT string_agg(speakers.name, ', ' ORDER BY speakers.name) FROM (
            SELECT DISTINCT NULLIF(s.full_name,'') AS name FROM conference_speakers s WHERE s.conference_id=c.id
        ) speakers WHERE speakers.name IS NOT NULL) AS speakers,
        COALESCE((SELECT json_agg(json_build_object('name',a.file_name,'uploaded_at',a.uploaded_at) ORDER BY a.uploaded_at DESC)
            FROM conference_attachments a WHERE a.conference_id=c.id AND a.is_deleted=FALSE),'[]'::json) AS attachments
        FROM conferences c WHERE c.organization_id=$1 ORDER BY c.updated_at DESC NULLS LAST,c.created_at DESC LIMIT 100`, [req.user.organization_id]);
    res.json({ success: true, data: result.rows });
});

router.patch("/my/conferences/:id/reschedule-response", requireRole("COMMUNE"), async (req, res) => {
    if (!req.user.organization_id) return res.status(403).json({ success: false, message: "Tài khoản chưa được gán đơn vị." });
    const response = String(req.body?.response || "").toUpperCase();
    if (!["ACCEPTED", "DECLINED"].includes(response)) return res.status(400).json({ success: false, message: "Phản hồi dời lịch không hợp lệ." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conference = await client.query(`SELECT id,status,proposed_start_time,proposed_end_time,reschedule_response
            FROM conferences WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [req.params.id, req.user.organization_id]);
        if (!conference.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị thuộc đơn vị của bạn." });
        }
        const current = conference.rows[0];
        if (current.status !== "RESCHEDULED" || !current.proposed_start_time || !current.proposed_end_time) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hội nghị hiện không có đề xuất dời lịch cần phản hồi." });
        }
        if (current.reschedule_response && current.reschedule_response !== "PENDING") {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Đề xuất dời lịch này đã được phản hồi." });
        }
        const nextStatus = response === "ACCEPTED" ? "APPROVED" : "RESCHEDULED";
        const reason = response === "ACCEPTED" ? "Đơn vị đăng ký đã chấp thuận lịch dời." : "Đơn vị đăng ký đã từ chối lịch dời.";
        const result = await client.query(`UPDATE conferences SET
                status=$1,
                start_time=CASE WHEN $2='ACCEPTED' THEN proposed_start_time ELSE start_time END,
                end_time=CASE WHEN $2='ACCEPTED' THEN proposed_end_time ELSE end_time END,
                reschedule_response=$2,reschedule_responded_at=NOW(),reschedule_responded_by=$3,updated_at=NOW()
            WHERE id=$4 RETURNING id,status,start_time,end_time,proposed_start_time,proposed_end_time,reschedule_note,reschedule_response,reschedule_responded_at`,
        [nextStatus, response, req.user.id, req.params.id]);
        await client.query(`INSERT INTO conference_status_history(conference_id,previous_status,new_status,reason,changed_by)
            VALUES($1,$2,$3,$4,$5)`, [req.params.id, current.status, nextStatus, reason, req.user.id]);
        await client.query("COMMIT");
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
});

router.get("/conferences/statistics", async (req, res) => {
    const [totals, byOrganization, byMonth, comparison] = await Promise.all([
        pool.query("SELECT status,COUNT(*)::int AS count FROM conferences GROUP BY status"),
        pool.query(`SELECT o.id AS organization_id,o.name AS organization_name,COUNT(c.id)::int AS count
                    FROM organizations o LEFT JOIN conferences c ON c.organization_id=o.id
                    WHERE o.is_active=TRUE GROUP BY o.id,o.name ORDER BY count DESC,o.name`),
        pool.query(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') AS month,COUNT(*)::int AS count,
                    COUNT(*) FILTER (WHERE status='APPROVED')::int AS approved_count,
                    COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed_count,
                    COALESCE(SUM(expected_participants),0)::int AS expected_participants
                    FROM conferences GROUP BY date_trunc('month',created_at) ORDER BY date_trunc('month',created_at)`),
        pool.query(`WITH local_day AS (SELECT (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today)
                    SELECT
                    COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-29 AND d.today)::int AS current_registered,
                    COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-29 AND d.today AND c.status='APPROVED')::int AS current_approved,
                    COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-29 AND d.today AND c.status='COMPLETED')::int AS current_completed,
                    COALESCE(SUM(c.expected_participants) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-29 AND d.today),0)::int AS current_participants,
                    COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-59 AND d.today-30)::int AS previous_registered,
                    COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-59 AND d.today-30 AND c.status='APPROVED')::int AS previous_approved,
                    COUNT(*) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-59 AND d.today-30 AND c.status='COMPLETED')::int AS previous_completed,
                    COALESCE(SUM(c.expected_participants) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN d.today-59 AND d.today-30),0)::int AS previous_participants
                    FROM conferences c CROSS JOIN local_day d`)
    ]);
    const statusCounts = Object.fromEntries([...statuses].map(status => [status, 0]));
    totals.rows.forEach(row => { statusCounts[row.status] = Number(row.count); });
    const period = comparison.rows[0] || {};
    res.json({ success: true, data: {
        total: Object.values(statusCounts).reduce((a,b)=>a+b,0),
        by_status: statusCounts,
        by_organization: req.user.role === "ADMIN" ? byOrganization.rows : [],
        by_month: byMonth.rows,
        period_comparison: {
            current: { registered: Number(period.current_registered || 0), approved: Number(period.current_approved || 0), completed: Number(period.current_completed || 0), participants: Number(period.current_participants || 0) },
            previous: { registered: Number(period.previous_registered || 0), approved: Number(period.previous_approved || 0), completed: Number(period.previous_completed || 0), participants: Number(period.previous_participants || 0) }
        }
    } });
});
router.patch("/conferences/:id/status", requireRole("ADMIN"), async (req, res) => {
    const status = String(req.body?.status || "").toUpperCase();
    const reason = String(req.body?.reason || "").trim();
    const proposedStart = req.body?.proposed_start_time ? new Date(req.body.proposed_start_time) : null;
    const proposedEnd = req.body?.proposed_end_time ? new Date(req.body.proposed_end_time) : null;
    const rescheduleNote = String(req.body?.reschedule_note || "").trim();
    if (!statuses.has(status)) return res.status(400).json({ success: false, message: "Trạng thái không hợp lệ." });
    if (["REJECTED", "CANCELLED"].includes(status) && !reason) return res.status(400).json({ success: false, message: "Vui lòng nhập lý do từ chối hoặc hủy." });
    if (status === "RESCHEDULED" && (!proposedStart || !proposedEnd || Number.isNaN(proposedStart.getTime()) || Number.isNaN(proposedEnd.getTime()) || proposedEnd <= proposedStart)) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập ngày giờ đề xuất hợp lệ; thời điểm kết thúc phải sau thời điểm bắt đầu." });
    }
    const historyReason = status === "RESCHEDULED"
        ? `Đề xuất lịch mới: ${proposedStart.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} – ${proposedEnd.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}${rescheduleNote ? ` · ${rescheduleNote}` : ""}`
        : reason || null;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(349534, 1)");
        const previous = await client.query("SELECT status,proposed_start_time,reschedule_response FROM conferences WHERE id=$1 FOR UPDATE", [req.params.id]);
        if (!previous.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
        }
        if (status === "RESCHEDULED") {
            const conflicts = await findApprovedDateConflicts(client, req.params.id, proposedStart.toISOString(), proposedEnd.toISOString());
            if (conflicts.rowCount) {
                await client.query("ROLLBACK");
                const locations = conflicts.rows.map(item => `${item.title || item.code || "Hội nghị"} (${new Date(item.start_time).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · ${item.location})`).join("; ");
                return res.status(409).json({ success: false, message: `Không thể đề xuất dời lịch vì ngày này trùng hội nghị đã phê duyệt: ${locations}` });
            }
        }
        if (status === "APPROVED" && previous.rows[0].status === "RESCHEDULED" && previous.rows[0].proposed_start_time && previous.rows[0].reschedule_response !== "ACCEPTED") {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Chỉ có thể xác nhận lịch dời sau khi đơn vị đăng ký chấp thuận." });
        }
        const actorId = req.user.id;
        const result = await client.query(`UPDATE conferences SET status=$1::varchar,
            start_time=CASE WHEN $1::varchar='APPROVED' AND proposed_start_time IS NOT NULL THEN proposed_start_time ELSE start_time END,
            end_time=CASE WHEN $1::varchar='APPROVED' AND proposed_start_time IS NOT NULL AND proposed_end_time IS NOT NULL THEN proposed_end_time ELSE end_time END,
            approved_by=CASE WHEN $1::varchar='APPROVED' THEN $2 ELSE approved_by END,
            approved_at=CASE WHEN $1::varchar='APPROVED' THEN NOW() ELSE approved_at END,
            rejection_reason=CASE WHEN $1::varchar='REJECTED' THEN $3 ELSE rejection_reason END,
            cancel_reason=CASE WHEN $1::varchar='CANCELLED' THEN $3 ELSE cancel_reason END,
            cancelled_at=CASE WHEN $1::varchar='CANCELLED' THEN NOW() ELSE cancelled_at END,
            cancelled_by=CASE WHEN $1::varchar='CANCELLED' THEN $2 ELSE cancelled_by END,
            proposed_start_time=CASE WHEN $1::varchar='RESCHEDULED' THEN $5 WHEN $1::varchar='APPROVED' AND proposed_start_time IS NOT NULL THEN NULL ELSE proposed_start_time END,
            proposed_end_time=CASE WHEN $1::varchar='RESCHEDULED' THEN $6 WHEN $1::varchar='APPROVED' AND proposed_start_time IS NOT NULL THEN NULL ELSE proposed_end_time END,
            reschedule_note=CASE WHEN $1::varchar='RESCHEDULED' THEN $7 WHEN $1::varchar='APPROVED' AND proposed_start_time IS NOT NULL THEN NULL ELSE reschedule_note END,
            reschedule_response=CASE WHEN $1::varchar='RESCHEDULED' THEN 'PENDING' WHEN $1::varchar='APPROVED' AND proposed_start_time IS NOT NULL THEN 'ACCEPTED' ELSE reschedule_response END,
            reschedule_responded_at=CASE WHEN $1::varchar='RESCHEDULED' THEN NULL ELSE reschedule_responded_at END,
            reschedule_responded_by=CASE WHEN $1::varchar='RESCHEDULED' THEN NULL ELSE reschedule_responded_by END,
            is_public=CASE WHEN $1::varchar='APPROVED' THEN is_public ELSE FALSE END,
            updated_at=NOW() WHERE id=$4 RETURNING *`,
        [status, actorId, reason || null, req.params.id, status === "RESCHEDULED" ? proposedStart.toISOString() : null,
            status === "RESCHEDULED" ? proposedEnd.toISOString() : null, status === "RESCHEDULED" ? rescheduleNote || null : null]);
        await client.query(`INSERT INTO conference_status_history(conference_id,previous_status,new_status,reason,changed_by)
            VALUES($1,$2,$3,$4,$5)`, [req.params.id, previous.rows[0].status, status, historyReason, actorId]);
        await client.query("COMMIT");
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
});

router.patch("/conferences/:id/public", requireRole("ADMIN"), async (req, res) => {
    if (typeof req.body?.is_public !== "boolean") {
        return res.status(400).json({ success: false, message: "Giá trị công khai không hợp lệ." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query("SELECT status,COALESCE(end_time,start_time)>=NOW() AS upcoming FROM conferences WHERE id=$1 FOR UPDATE", [req.params.id]);
        if (!current.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
        }
        if (req.body.is_public && (current.rows[0].status !== "APPROVED" || !current.rows[0].upcoming)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Chỉ có thể công khai hội nghị đã phê duyệt và chưa kết thúc." });
        }
        const result = await client.query("UPDATE conferences SET is_public=$1,updated_at=NOW() WHERE id=$2 RETURNING id,is_public,status", [req.body.is_public, req.params.id]);
        await client.query("COMMIT");
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
});

router.patch("/conferences/:id/description", requireRole("ADMIN"), async (req, res) => {
    const description = String(req.body?.description || "").trim();
    if (description.length > 4000) return res.status(400).json({ success: false, message: "Nội dung tối đa 4.000 ký tự." });
    try {
        const result = await pool.query(
            "UPDATE conferences SET description=$1,updated_at=NOW() WHERE id::text=$2 OR UPPER(code)=UPPER($2) RETURNING id,code,description,is_public",
            [description || null, String(req.params.id || "")]
        );
        if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
        return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error("Conference description update failed:", error?.message || error);
        return res.status(500).json({ success: false, message: "Không thể cập nhật nội dung hội nghị." });
    }
});

router.get("/conferences/:id/status-history", async (req, res) => {
    if (!(await checkConferenceAccess(req, res))) return;
    const result = await pool.query(`SELECT h.*,u.full_name AS changed_by_name FROM conference_status_history h
        LEFT JOIN users u ON u.id=h.changed_by WHERE h.conference_id=$1 ORDER BY h.changed_at DESC`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});

router.get("/conferences/:id/participants", async (req, res) => {
    if (!(await checkConferenceAccess(req, res))) return;
    const result = await pool.query("SELECT * FROM conference_participant_groups WHERE conference_id=$1 ORDER BY group_name", [req.params.id]);
    res.json({ success: true, data: result.rows });
});
router.post("/conferences/:id/participants", async (req, res) => {
    if (!(await checkConferenceAccess(req, res))) return;
    const name = String(req.body?.group_name || "").trim();
    const expected = integer(req.body?.expected_count ?? 0);
    const actual = integer(req.body?.actual_count ?? 0);
    if (!name || expected === null || actual === null) return res.status(400).json({ success: false, message: "Tên nhóm và số lượng phải hợp lệ." });
    const result = await pool.query(`INSERT INTO conference_participant_groups
        (conference_id,group_name,participant_type,organization_name,expected_count,actual_count,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id,name,req.body?.participant_type || "GENERAL",req.body?.organization_name || null,expected,actual,req.body?.notes || null]);
    res.status(201).json({ success: true, data: result.rows[0] });
});
router.delete("/participants/:id", async (req, res) => {
    const owner = await pool.query("SELECT conference_id FROM conference_participant_groups WHERE id=$1", [req.params.id]);
    if (!owner.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy thành phần tham dự." });
    if (!(await checkConferenceAccess(req, res, owner.rows[0].conference_id))) return;
    const result = await pool.query("DELETE FROM conference_participant_groups WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy thành phần tham dự." });
    res.json({ success: true });
});

router.get("/conferences/:id/registration-organizations", requireRole("ADMIN"), async (req, res) => {
    const conference = await pool.query("SELECT id FROM conferences WHERE id=$1", [req.params.id]);
    if (!conference.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
    const result = await pool.query(`SELECT allowed.organization_id,o.name AS organization_name
        FROM conference_registration_organizations allowed
        JOIN organizations o ON o.id=allowed.organization_id
        WHERE allowed.conference_id=$1 ORDER BY o.name`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});

router.put("/conferences/:id/registration-organizations", requireRole("ADMIN"), async (req, res) => {
    const rawIds = req.body?.organization_ids;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!Array.isArray(rawIds) || rawIds.length > 500 || rawIds.some(id => !uuidPattern.test(String(id)))) {
        return res.status(400).json({ success: false, message: "Danh sách đơn vị không hợp lệ." });
    }
    const organizationIds = [...new Set(rawIds.map(String))];
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conference = await client.query("SELECT is_public FROM conferences WHERE id=$1 FOR UPDATE", [req.params.id]);
        if (!conference.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
        }
        if (conference.rows[0].is_public) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hãy tắt công khai hội nghị trước khi giới hạn đơn vị đăng ký." });
        }
        if (organizationIds.length) {
            const active = await client.query("SELECT id FROM organizations WHERE is_active=TRUE AND id=ANY($1::uuid[])", [organizationIds]);
            if (active.rowCount !== organizationIds.length) {
                await client.query("ROLLBACK");
                return res.status(400).json({ success: false, message: "Có đơn vị không tồn tại hoặc đã ngừng hoạt động." });
            }
        }
        await client.query("DELETE FROM conference_registration_organizations WHERE conference_id=$1", [req.params.id]);
        if (organizationIds.length) {
            await client.query(`INSERT INTO conference_registration_organizations(conference_id,organization_id,invited_by)
                SELECT $1,chosen.id,$3 FROM organizations chosen WHERE chosen.id=ANY($2::uuid[]) AND chosen.is_active=TRUE`, [req.params.id, organizationIds, req.user.id]);
        }
        await client.query("COMMIT");
        res.json({ success: true, data: organizationIds.map(organization_id => ({ organization_id })), message: "Đã cập nhật đơn vị được phép đăng ký." });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
});
// Cross-unit event registration is intentionally separate from conference
// ownership: a commune may discover approved events hosted by any unit, but
// can only register its own organization once per event.
router.get("/participation-conferences", requireRole("COMMUNE"), async (req, res) => {
    if (!req.user.organization_id) return res.status(403).json({ success: false, message: "Tài khoản chưa được gán đơn vị." });
    const result = await pool.query(`SELECT c.id,c.code,c.title,c.description,c.start_time,c.end_time,
            c.location_name,c.location_address,c.expected_participants,o.name AS organization_name,
            mine.id AS registration_id,mine.expected_count AS registered_count,mine.note AS registration_note,mine.created_at AS registered_at,
            totals.registration_count
        FROM conferences c
        JOIN organizations o ON o.id=c.organization_id
        LEFT JOIN conference_attendance_registrations mine ON mine.conference_id=c.id AND mine.organization_id=$1
        LEFT JOIN LATERAL (SELECT COUNT(*)::int AS registration_count FROM conference_attendance_registrations r WHERE r.conference_id=c.id) totals ON TRUE
        WHERE c.status='APPROVED' AND c.start_time >= NOW() AND (c.is_public=TRUE OR EXISTS (SELECT 1 FROM conference_registration_organizations allowed WHERE allowed.conference_id=c.id AND allowed.organization_id=$1))
        ORDER BY c.start_time,c.title`, [req.user.organization_id]);
    res.json({ success: true, data: result.rows });
});

router.post("/attendance-registrations", requireRole("COMMUNE"), async (req, res) => {
    const conferenceId = String(req.body?.conference_id || "").trim();
    const expectedCount = integer(req.body?.expected_count);
    const note = String(req.body?.note || "").trim().slice(0, 1000);
    if (!req.user.organization_id) return res.status(403).json({ success: false, message: "Tài khoản chưa được gán đơn vị." });
    if (!conferenceId || expectedCount === null || expectedCount < 1 || expectedCount > 100000) {
        return res.status(400).json({ success: false, message: "Vui lòng chọn hội nghị và nhập số người đăng ký hợp lệ (1–100.000)." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const event = await client.query("SELECT c.status,c.is_public,c.start_time >= NOW() AS upcoming,(c.is_public OR EXISTS (SELECT 1 FROM conference_registration_organizations allowed WHERE allowed.conference_id=c.id AND allowed.organization_id=$2)) AS can_register FROM conferences c WHERE c.id=$1 FOR UPDATE OF c", [conferenceId, req.user.organization_id]);
        if (!event.rowCount || event.rows[0].can_register !== true) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
        }
        if (event.rows[0].status === "COMPLETED") {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hội nghị đã hoàn thành, hệ thống không nhận đăng ký tham gia thêm." });
        }
        if (event.rows[0].status !== "APPROVED" || !event.rows[0].upcoming) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hội nghị không còn mở đăng ký hoặc chưa được phê duyệt." });
        }
        const result = await client.query(`INSERT INTO conference_attendance_registrations
            (conference_id,organization_id,registered_by,expected_count,note)
            VALUES($1,$2,$3,$4,$5) RETURNING id,conference_id,organization_id,expected_count,note,created_at`,
        [conferenceId, req.user.organization_id, req.user.id, expectedCount, note]);
        await client.query("COMMIT");
        res.status(201).json({ success: true, data: result.rows[0], message: "Đã đăng ký tham gia hội nghị." });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") return res.status(409).json({ success: false, message: "Đơn vị của bạn đã đăng ký tham gia hội nghị này." });
        throw error;
    } finally { client.release(); }
});
router.get("/conferences/:id/attendance-registrations", requireRole("ADMIN", "COMMUNE"), async (req, res) => {
    if (!(await checkConferenceAccess(req, res))) return;
    const result = await pool.query(`SELECT r.id,r.expected_count,r.note,r.created_at,o.name AS organization_name,u.full_name AS registered_by_name
        FROM conference_attendance_registrations r JOIN organizations o ON o.id=r.organization_id
        LEFT JOIN users u ON u.id=r.registered_by WHERE r.conference_id=$1 ORDER BY r.created_at`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});

router.get("/conferences/:id/public-attendance", requireRole("ADMIN", "TASK_ASSIGNEE"), async (req, res) => {
    if (req.user.role === "TASK_ASSIGNEE") {
        const assigned = await pool.query("SELECT 1 FROM conference_task_assignments WHERE conference_id=$1 AND assignee_user_id=$2 LIMIT 1", [req.params.id, req.user.id]);
        if (!assigned.rowCount) return res.status(403).json({ success: false, message: "Bạn chỉ được xem danh sách người tham dự của hội nghị được giao nhiệm vụ cho mình." });
    }
    const result = await pool.query(`SELECT r.id,r.attendee_name,r.attendee_address,r.attendee_email,r.created_at,r.attended_at,
            u.full_name AS checked_in_by_name
        FROM public_attendance_registrations r LEFT JOIN users u ON u.id=r.attended_by
        WHERE r.conference_id=$1 ORDER BY r.attendee_name,r.created_at`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});

router.post("/conferences/:id/public-attendance/manual", requireRole("ADMIN", "TASK_ASSIGNEE"), async (req, res) => {
    const fullName = String(req.body?.attendee_name || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    const address = String(req.body?.attendee_address || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    const email = String(req.body?.attendee_email || "").trim();
    if (!fullName || fullName.length > 160 || !address || address.length > 500 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return res.status(400).json({ success: false, message: "Họ tên, địa chỉ bắt buộc; email nếu nhập phải hợp lệ." });
    }
    if (req.user.role === "TASK_ASSIGNEE") {
        const assigned = await pool.query("SELECT 1 FROM conference_task_assignments WHERE conference_id=$1 AND assignee_user_id=$2 LIMIT 1", [req.params.id, req.user.id]);
        if (!assigned.rowCount) return res.status(403).json({ success: false, message: "Bạn chỉ được thêm người dự vào hội nghị được giao nhiệm vụ cho mình." });
    }
    const attendeeKey = crypto.createHash("sha256").update(`${fullName.toLocaleLowerCase("vi-VN")}
${address.toLocaleLowerCase("vi-VN")}`).digest("hex");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const event = await client.query("SELECT status,(start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS conference_date FROM conferences WHERE id=$1 FOR UPDATE", [req.params.id]);
        if (!event.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
        }
        if (event.rows[0].status === "COMPLETED") {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Hội nghị đã hoàn thành, không thể thêm người tham dự." });
        }
        const result = await client.query(`INSERT INTO public_attendance_registrations
            (conference_id,attendee_name,attendee_address,attendee_email,attendee_key,conference_date,attended_at,attended_by)
            VALUES($1,$2,$3,$4,$5,$6,NOW(),$7::uuid)
            RETURNING id,conference_id,attendee_name,attendee_address,attendee_email,created_at,attended_at`,
        [req.params.id, fullName, address, email || null, attendeeKey, event.rows[0].conference_date, req.user.id]);
        await client.query("COMMIT");
        res.status(201).json({ success: true, data: result.rows[0], message: "Đã thêm và ghi nhận người này đã dự hội nghị." });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") return res.status(409).json({ success: false, message: "Người này đã có tên trong danh sách hội nghị cùng ngày; hãy tìm trong danh sách để tránh ghi trùng." });
        throw error;
    } finally { client.release(); }
});router.patch("/public-attendance/:id/check-in", requireRole("ADMIN", "TASK_ASSIGNEE"), async (req, res) => {
    if (typeof req.body?.attended !== "boolean") return res.status(400).json({ success: false, message: "Trạng thái điểm danh không hợp lệ." });
    const registration = await pool.query("SELECT conference_id FROM public_attendance_registrations WHERE id=$1", [req.params.id]);
    if (!registration.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy đăng ký tham dự." });
    if (req.user.role === "TASK_ASSIGNEE") {
        const assigned = await pool.query("SELECT 1 FROM conference_task_assignments WHERE conference_id=$1 AND assignee_user_id=$2 LIMIT 1", [registration.rows[0].conference_id, req.user.id]);
        if (!assigned.rowCount) return res.status(403).json({ success: false, message: "Bạn chỉ được điểm danh hội nghị được giao nhiệm vụ cho mình." });
    }
    const result = await pool.query(`UPDATE public_attendance_registrations
        SET attended_at=CASE WHEN $1 THEN COALESCE(attended_at,NOW()) ELSE NULL END,
            attended_by=CASE WHEN $1 THEN $2::uuid ELSE NULL::uuid END
        WHERE id=$3 RETURNING id,attended_at`, [req.body.attended, req.user.id, req.params.id]);
    res.json({ success: true, data: result.rows[0], message: req.body.attended ? "Đã ghi nhận người tham dự." : "Đã bỏ đánh dấu điểm danh." });
});

router.get("/venues", async (req, res) => {
    const result = await pool.query(`SELECT v.*,o.name AS organization_name FROM venues v
        LEFT JOIN organizations o ON o.id=v.organization_id WHERE v.is_active=TRUE ORDER BY v.name`);
    res.json({ success: true, data: req.user.role === "ADMIN" ? result.rows : result.rows.filter(item => !item.organization_id || String(item.organization_id) === String(req.user.organization_id)) });
});
router.post("/venues", requireRole("ADMIN"), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const address = String(req.body?.address || "").trim();
    const capacity = integer(req.body?.capacity ?? 0);
    if (!name || !address || capacity === null) return res.status(400).json({ success: false, message: "Tên, địa chỉ địa điểm và sức chứa phải hợp lệ." });
    const result = await pool.query(`INSERT INTO venues(name,address,capacity,organization_id,notes)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [name,address,capacity,req.body?.organization_id || null,req.body?.notes || null]);
    res.status(201).json({ success: true, data: result.rows[0] });
});
router.put("/venues/:id", requireRole("ADMIN"), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const address = String(req.body?.address || "").trim();
    const capacity = integer(req.body?.capacity ?? 0);
    if (!name || !address || capacity === null) return res.status(400).json({ success: false, message: "Tên, địa chỉ địa điểm và sức chứa phải hợp lệ." });
    const result = await pool.query(`UPDATE venues SET name=$1,address=$2,capacity=$3,organization_id=$4,notes=$5,updated_at=NOW()
        WHERE id=$6 AND is_active=TRUE RETURNING *`, [name,address,capacity,req.body?.organization_id || null,req.body?.notes || null,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy địa điểm." });
    res.json({ success: true, data: result.rows[0] });
});
router.delete("/venues/:id", requireRole("ADMIN"), async (req, res) => {
    const result = await pool.query("UPDATE venues SET is_active=FALSE,updated_at=NOW() WHERE id=$1 AND is_active=TRUE RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy địa điểm." });
    res.json({ success: true });
});

const assignmentStatuses = new Set(["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const positiveInteger = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

router.get("/assignment-reports", requireRole("ADMIN"), async (req, res) => {
    const from = String(req.query.from || "2000-01-01");
    const to = String(req.query.to || "2999-12-31");
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
    if (!validDate(from) || !validDate(to) || to < from) return res.status(400).json({ success: false, message: "Khoảng ngày báo cáo không hợp lệ." });
    const range = [from, to];
    const [summary, taskPeople, speakerPeople, taskDetails] = await Promise.all([
        pool.query(`WITH conference_scope AS (
                SELECT id FROM conferences
                WHERE start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                  AND start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            ) SELECT
            (SELECT COUNT(*)::int FROM conference_task_assignments a JOIN conference_scope c ON c.id=a.conference_id) AS task_count,
            (SELECT COUNT(*)::int FROM conference_task_assignments a JOIN conference_scope c ON c.id=a.conference_id WHERE a.status='ASSIGNED') AS assigned_count,
            (SELECT COUNT(*)::int FROM conference_task_assignments a JOIN conference_scope c ON c.id=a.conference_id WHERE a.status='IN_PROGRESS') AS in_progress_count,
            (SELECT COUNT(*)::int FROM conference_task_assignments a JOIN conference_scope c ON c.id=a.conference_id WHERE a.status='COMPLETED') AS completed_count,
            (SELECT COUNT(*)::int FROM conference_task_assignments a JOIN conference_scope c ON c.id=a.conference_id WHERE a.status='CANCELLED') AS cancelled_count,
            (SELECT COUNT(DISTINCT a.assignee_user_id)::int FROM conference_task_assignments a JOIN conference_scope c ON c.id=a.conference_id) AS assigned_people,
            (SELECT COUNT(*)::int FROM conference_speakers s JOIN conference_scope c ON c.id=s.conference_id) AS speaker_sessions,
            (SELECT COUNT(DISTINCT s.speaker_user_id)::int FROM conference_speakers s JOIN conference_scope c ON c.id=s.conference_id) AS speakers`, range),
        pool.query(`SELECT a.assignee_user_id,COALESCE(u.full_name,a.assignee_name) AS person_name,
                COALESCE(org.name,a.assignee_organization,'') AS organization_name,
                COUNT(*)::int AS task_count,
                COUNT(*) FILTER (WHERE a.status='ASSIGNED')::int AS assigned_count,
                COUNT(*) FILTER (WHERE a.status='IN_PROGRESS')::int AS in_progress_count,
                COUNT(*) FILTER (WHERE a.status='COMPLETED')::int AS completed_count,
                COUNT(*) FILTER (WHERE a.status='CANCELLED')::int AS cancelled_count,
                COUNT(a.evaluation_rating)::int AS evaluated_count,
                ROUND(AVG(a.evaluation_rating)::numeric,2) AS average_rating
            FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
            LEFT JOIN users u ON u.id=a.assignee_user_id
            LEFT JOIN organizations org ON org.id=u.organization_id
            WHERE c.start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
              AND c.start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            GROUP BY a.assignee_user_id,person_name,organization_name
            ORDER BY task_count DESC,person_name`, range),
        pool.query(`SELECT s.speaker_user_id,COALESCE(u.full_name,s.full_name) AS person_name,
                COALESCE(org.name,s.organization,'') AS organization_name,
                COUNT(*)::int AS session_count,COUNT(DISTINCT s.conference_id)::int AS conference_count,
                COALESCE(STRING_AGG(DISTINCT s.presentation_title,'; ' ORDER BY s.presentation_title),'') AS topics
            FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
            LEFT JOIN users u ON u.id=s.speaker_user_id
            LEFT JOIN organizations org ON org.id=u.organization_id
            WHERE c.start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
              AND c.start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            GROUP BY s.speaker_user_id,person_name,organization_name
            ORDER BY session_count DESC,person_name`, range),
        pool.query(`SELECT a.id,a.assignee_user_id,COALESCE(u.full_name,a.assignee_name) AS person_name,
                COALESCE(org.name,a.assignee_organization,'') AS organization_name,
                a.title,a.description,a.status,a.due_at,a.completed_at,a.evaluation_rating,a.evaluation_note,a.evaluated_at,
                evaluator.full_name AS evaluator_name,c.id AS conference_id,c.code AS conference_code,
                c.title AS conference_title,c.start_time
            FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
            LEFT JOIN users u ON u.id=a.assignee_user_id
            LEFT JOIN organizations org ON org.id=u.organization_id
            LEFT JOIN users evaluator ON evaluator.id=a.evaluated_by
            WHERE c.start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
              AND c.start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            ORDER BY person_name,a.due_at NULLS LAST,a.created_at`, range)
    ]);
    res.json({ success: true, data: { from, to, summary: summary.rows[0], tasks_by_person: taskPeople.rows, task_details: taskDetails.rows, speakers_by_person: speakerPeople.rows } });
});

router.patch("/assignment-reports/tasks/:id/evaluation", requireRole("ADMIN"), async (req, res) => {
    const rating = Number(req.body?.rating);
    const note = String(req.body?.note || "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || note.length > 2000) {
        return res.status(400).json({ success: false, message: "Chọn mức đánh giá từ 1 đến 5; nhận xét tối đa 2.000 ký tự." });
    }
    const task = await pool.query(`UPDATE conference_task_assignments SET evaluation_rating=$1,evaluation_note=$2,
            evaluated_by=$3,evaluated_at=NOW(),updated_at=NOW()
        WHERE id=$4 AND status='COMPLETED'
        RETURNING id,evaluation_rating,evaluation_note,evaluated_by,evaluated_at`, [rating,note || null,req.user.id,req.params.id]);
    if (!task.rowCount) {
        const exists = await pool.query("SELECT status FROM conference_task_assignments WHERE id=$1", [req.params.id]);
        if (!exists.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy nhiệm vụ." });
        return res.status(409).json({ success: false, message: "Chỉ có thể đánh giá nhiệm vụ đã hoàn thành." });
    }
    res.json({ success: true, data: task.rows[0] });
});

router.get("/my-reminders", async (req, res) => {
    if (!["ADMIN", "TASK_ASSIGNEE", "SPEAKER"].includes(req.user.role)) return res.status(403).json({ success: false, message: "Nhắc việc chỉ dành cho quản trị viên, người nhận nhiệm vụ và báo cáo viên." });
    const user = req.user;
    const [tasks, speakerSessions] = await Promise.all([
        pool.query(`SELECT a.id,'TASK' AS reminder_type,a.title,a.due_at,a.status,
                c.id AS conference_id,c.code AS conference_code,c.title AS conference_title,
                c.start_time,c.location_name,c.location_address,o.name AS organization_name,
                a.assignee_name
            FROM conference_task_assignments a
            JOIN conferences c ON c.id=a.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE a.status IN ('ASSIGNED','IN_PROGRESS')
              AND a.due_at > NOW() AND a.due_at <= NOW() + INTERVAL '1 day'
              AND ($1='ADMIN' OR ($1='TASK_ASSIGNEE' AND a.assignee_user_id=$2::uuid))
            ORDER BY a.due_at`, [user.role,user.id]),
        pool.query(`SELECT s.id,'SPEAKER' AS reminder_type,
                s.presentation_title AS title,c.start_time AS due_at,'SCHEDULED' AS status,
                c.id AS conference_id,c.code AS conference_code,c.title AS conference_title,
                c.start_time,c.location_name,c.location_address,o.name AS organization_name,
                s.full_name AS assignee_name
            FROM conference_speakers s
            JOIN conferences c ON c.id=s.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE c.status='APPROVED' AND c.start_time > NOW()
              AND c.start_time <= NOW() + INTERVAL '1 day'
              AND ($1='ADMIN' OR ($1='SPEAKER' AND s.speaker_user_id=$2::uuid))
            ORDER BY c.start_time`, [user.role,user.id])
    ]);
    res.json({ success: true, data: [...tasks.rows, ...speakerSessions.rows].sort((a,b) => new Date(a.due_at)-new Date(b.due_at)) });
});
router.post("/my-assignments/change-requests", requireRole("TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    const requestType = String(req.body?.request_type || "").toUpperCase();
    const assignmentId = String(req.body?.assignment_id || "");
    const reason = String(req.body?.reason || "").trim();
    if (!["TASK","SPEAKER"].includes(requestType) || !assignmentId || reason.length < 5 || reason.length > 2000) {
        return res.status(400).json({ success: false, message: "Vui lòng chọn phân công và nhập lý do từ 5 đến 2.000 ký tự." });
    }
    if ((requestType === "TASK" && req.user.role !== "TASK_ASSIGNEE") || (requestType === "SPEAKER" && req.user.role !== "SPEAKER")) {
        return res.status(403).json({ success: false, message: "Tài khoản không có quyền đề nghị đổi phân công này." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const assignment = requestType === "TASK"
            ? await client.query("SELECT id FROM conference_task_assignments WHERE id=$1 AND assignee_user_id=$2 AND status IN ('ASSIGNED','IN_PROGRESS') FOR UPDATE", [assignmentId,req.user.id])
            : await client.query("SELECT id FROM conference_speakers WHERE id=$1 AND speaker_user_id=$2 FOR UPDATE", [assignmentId,req.user.id]);
        if (!assignment.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy phân công đang hoạt động thuộc tài khoản của bạn." });
        }
        const existing = await client.query("SELECT id FROM conference_staff_change_requests WHERE status='PENDING' AND ((request_type='TASK' AND task_assignment_id=$1::uuid) OR (request_type='SPEAKER' AND speaker_assignment_id=$1::uuid))", [assignmentId]);
        if (existing.rowCount) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Phân công này đã có đề nghị đang chờ admin xem xét." });
        }
        const result = await client.query("INSERT INTO conference_staff_change_requests (request_type,task_assignment_id,speaker_assignment_id,requester_user_id,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,request_type,reason,status,created_at",
            [requestType,requestType === "TASK" ? assignmentId : null,requestType === "SPEAKER" ? assignmentId : null,req.user.id,reason]);
        await client.query("COMMIT");
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
});

router.get("/my-assignments/change-requests", requireRole("TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    const result = await pool.query("SELECT r.id,r.request_type,r.task_assignment_id,r.speaker_assignment_id,r.reason,r.status,r.admin_note,r.created_at,r.reviewed_at,COALESCE(a.title,s.presentation_title) AS assignment_title,c.title AS conference_title,c.code AS conference_code FROM conference_staff_change_requests r LEFT JOIN conference_task_assignments a ON a.id=r.task_assignment_id LEFT JOIN conference_speakers s ON s.id=r.speaker_assignment_id LEFT JOIN conferences c ON c.id=COALESCE(a.conference_id,s.conference_id) WHERE r.requester_user_id=$1 ORDER BY r.created_at DESC", [req.user.id]);
    res.json({ success: true, data: result.rows });
});

router.get("/staff-change-requests", requireRole("ADMIN"), async (req, res) => {
    const result = await pool.query("SELECT r.id,r.request_type,r.task_assignment_id,r.speaker_assignment_id,r.reason,r.status,r.admin_note,r.created_at,r.reviewed_at,requester.full_name AS requester_name,requester.username AS requester_username,COALESCE(a.title,s.presentation_title) AS assignment_title,COALESCE(a.assignee_user_id,s.speaker_user_id) AS current_user_id,COALESCE(a.assignee_name,s.full_name) AS current_user_name,c.id AS conference_id,c.title AS conference_title,c.code AS conference_code,o.name AS organization_name FROM conference_staff_change_requests r JOIN users requester ON requester.id=r.requester_user_id LEFT JOIN conference_task_assignments a ON a.id=r.task_assignment_id LEFT JOIN conference_speakers s ON s.id=r.speaker_assignment_id LEFT JOIN conferences c ON c.id=COALESCE(a.conference_id,s.conference_id) LEFT JOIN organizations o ON o.id=c.organization_id ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200");
    res.json({ success: true, data: result.rows });
});

router.patch("/staff-change-requests/:id", requireRole("ADMIN"), async (req, res) => {
    const decision = String(req.body?.status || "").toUpperCase();
    const note = String(req.body?.admin_note || "").trim().slice(0,2000);
    const replacementId = String(req.body?.replacement_user_id || "");
    if (!["APPROVED","REJECTED"].includes(decision)) return res.status(400).json({ success: false, message: "Chọn duyệt hoặc từ chối đề nghị." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const requestResult = await client.query("SELECT * FROM conference_staff_change_requests WHERE id=$1 AND status='PENDING' FOR UPDATE", [req.params.id]);
        if (!requestResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Đề nghị không tồn tại hoặc đã được xử lý." });
        }
        const request = requestResult.rows[0];
        if (decision === "APPROVED") {
            if (!replacementId) {
                await client.query("ROLLBACK");
                return res.status(400).json({ success: false, message: "Hãy chọn cán bộ thay thế trước khi duyệt." });
            }
            const expectedRole = request.request_type === "TASK" ? "TASK_ASSIGNEE" : "SPEAKER";
            const replacementResult = await client.query("SELECT u.id,u.username,u.full_name,o.name AS organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1 AND u.role=$2 AND u.is_active=TRUE", [replacementId,expectedRole]);
            if (!replacementResult.rowCount) {
                await client.query("ROLLBACK");
                return res.status(400).json({ success: false, message: "Tài khoản cán bộ thay thế không hợp lệ hoặc đã bị khóa." });
            }
            const replacement = replacementResult.rows[0];
            if (request.request_type === "TASK") {
                await client.query("UPDATE conference_task_assignments SET assignee_user_id=$1,assignee_name=$2,assignee_organization=$3,updated_at=NOW() WHERE id=$4", [replacement.id,replacement.full_name,replacement.organization_name,request.task_assignment_id]);
            } else {
                await client.query("UPDATE conference_speakers SET speaker_user_id=$1,full_name=$2,organization=$3,updated_at=NOW() WHERE id=$4", [replacement.id,replacement.full_name,replacement.organization_name,request.speaker_assignment_id]);
            }
        }
        const updated = await client.query("UPDATE conference_staff_change_requests SET status=$1,admin_note=$2,reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW() WHERE id=$4 RETURNING id,status,admin_note,reviewed_at", [decision,note || null,req.user.id,req.params.id]);
        await client.query("COMMIT");
        res.json({ success: true, data: updated.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
});
router.get("/my-assignments", requireRole("TASK_ASSIGNEE", "SPEAKER"), async (req, res) => {
    const [tasks, speakers] = await Promise.all([
        pool.query(`SELECT a.id,a.conference_id,a.title,a.description,a.assignee_user_id,a.assignee_name,a.assignee_organization,a.due_at,a.status,a.completed_at,
                c.code AS conference_code,c.title AS conference_title,c.start_time,c.end_time,c.status AS conference_status,c.location_name,c.location_address,
                o.name AS organization_name
            FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            WHERE a.status<>'CANCELLED' ORDER BY c.start_time,a.due_at NULLS LAST,a.created_at`),
        pool.query(`SELECT s.id,s.conference_id,s.speaker_user_id,s.full_name,s.organization,s.role_title,s.presentation_title,s.speaking_order,s.duration_minutes,s.notes,
                c.code AS conference_code,c.title AS conference_title,c.start_time,c.end_time,c.status AS conference_status,c.location_name,c.location_address,
                o.name AS organization_name
            FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id
            LEFT JOIN organizations o ON o.id=c.organization_id
            ORDER BY c.start_time,s.speaking_order,s.created_at`)
    ]);
    res.json({ success: true, data: { tasks: tasks.rows, speakers: speakers.rows } });
});

router.get("/my-assignments/tasks/:id/attachments", requireRole("ADMIN", "TASK_ASSIGNEE"), async (req, res) => {
    const owned = req.user.role === "ADMIN"
        ? await pool.query("SELECT id FROM conference_task_assignments WHERE id=$1", [req.params.id])
        : await pool.query("SELECT id FROM conference_task_assignments WHERE id=$1 AND assignee_user_id=$2", [req.params.id, req.user.id]);
    if (!owned.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy nhiệm vụ được giao cho tài khoản này." });
    const result = await pool.query(`SELECT id,task_assignment_id,file_name,storage_key,file_size,mime_type,uploaded_at
        FROM conference_task_attachments WHERE task_assignment_id=$1 ORDER BY uploaded_at DESC`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});

router.post("/my-assignments/tasks/:id/attachments", requireRole("TASK_ASSIGNEE"), upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "Hãy chọn tệp cần đính kèm." });
    const owned = await pool.query("SELECT id FROM conference_task_assignments WHERE id=$1 AND assignee_user_id=$2 AND status IN ('ASSIGNED','IN_PROGRESS')", [req.params.id, req.user.id]);
    if (!owned.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy nhiệm vụ đang thực hiện được giao cho tài khoản này." });
    const result = await pool.query(`INSERT INTO conference_task_attachments(task_assignment_id,file_name,storage_key,file_size,mime_type,uploaded_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,task_assignment_id,file_name,storage_key,file_size,mime_type,uploaded_at`,
    [req.params.id, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype || "application/octet-stream", req.user.id]);
    res.status(201).json({ success: true, data: result.rows[0] });
});

router.patch("/my-assignments/tasks/:id/status", requireRole("TASK_ASSIGNEE"), async (req, res) => {
    const status = String(req.body?.status || "").toUpperCase();
    if (!["IN_PROGRESS", "COMPLETED"].includes(status)) return res.status(400).json({ success: false, message: "Chỉ được cập nhật tiến độ sang đang thực hiện hoặc hoàn thành." });
    const suppliedCompletion = req.body?.completed_at ? new Date(req.body.completed_at) : null;
    if (req.body?.completed_at && (!Number.isFinite(suppliedCompletion.getTime()) || suppliedCompletion > new Date())) {
        return res.status(400).json({ success: false, message: "Thời điểm hoàn thành phải là ngày giờ hợp lệ và không ở tương lai." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const task = await client.query("SELECT id,status,completed_at,created_at FROM conference_task_assignments WHERE id=$1 AND assignee_user_id=$2 AND status IN ('ASSIGNED','IN_PROGRESS','COMPLETED') FOR UPDATE", [req.params.id,req.user.id]);
        if (!task.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Không tìm thấy nhiệm vụ được giao cho tài khoản này hoặc nhiệm vụ đã kết thúc." });
        }
        const isBackfill = task.rows[0].status === "COMPLETED";
        if (isBackfill && (status !== "COMPLETED" || task.rows[0].completed_at || !suppliedCompletion)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "Chỉ được bổ sung thời điểm còn thiếu cho nhiệm vụ đã hoàn thành." });
        }
        if (suppliedCompletion && suppliedCompletion < new Date(task.rows[0].created_at)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: "Thời điểm hoàn thành không thể trước ngày giao nhiệm vụ." });
        }
        if (status === "COMPLETED") {
            const pendingChange = await client.query("SELECT id FROM conference_staff_change_requests WHERE request_type='TASK' AND task_assignment_id=$1 AND status='PENDING' LIMIT 1", [req.params.id]);
            if (pendingChange.rowCount) {
                await client.query("ROLLBACK");
                return res.status(409).json({ success: false, message: "Chưa thể hoàn thành nhiệm vụ khi đề nghị đổi cán bộ đang chờ admin xử lý." });
            }
        }
        const result = await client.query(`UPDATE conference_task_assignments SET status=$1,
                completed_at=CASE WHEN $1='COMPLETED' THEN COALESCE(completed_at,$4,NOW()) ELSE NULL END,
                updated_at=NOW()
            WHERE id=$2 AND assignee_user_id=$3 AND (status IN ('ASSIGNED','IN_PROGRESS') OR (status='COMPLETED' AND completed_at IS NULL AND $4 IS NOT NULL)) RETURNING id,status,completed_at,updated_at`, [status,req.params.id,req.user.id,suppliedCompletion?.toISOString() || null]);
        await client.query("COMMIT");
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
});

router.get("/conferences/:id/assignments", requireRole("ADMIN"), async (req, res) => {
    if (!(await checkConferenceAccess(req, res))) return;
    const result = await pool.query(`SELECT * FROM conference_task_assignments WHERE conference_id=$1 ORDER BY due_at NULLS LAST, created_at`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});
router.post("/conferences/:id/assignments", requireRole("ADMIN"), async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const assigneeId = String(req.body?.assignee_user_id || "");
    const dueAt = req.body?.due_at ? new Date(req.body.due_at) : null;
    if (!title || !assigneeId || (dueAt && Number.isNaN(dueAt.getTime()))) return res.status(400).json({ success: false, message: "Vui lòng chọn tài khoản nhận nhiệm vụ và hạn hoàn thành hợp lệ." });
    const client = await pool.connect();
    try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`conference-staffing:${req.params.id}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`staff-monthly-cap:${assigneeId}`]);
    const conferenceResult = await client.query("SELECT start_time FROM conferences WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!conferenceResult.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." }); }
    const targetStart = conferenceResult.rows[0].start_time;
    if (!targetStart) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Hội nghị chưa có ngày tổ chức nên chưa thể kiểm tra hạn mức phân công." }); }
    const conferenceStaffResult = await client.query(`SELECT COUNT(DISTINCT assignee_user_id)::int AS people FROM conference_task_assignments
        WHERE conference_id=$1 AND status<>'CANCELLED' AND assignee_user_id IS NOT NULL`, [req.params.id]);
    const alreadyInConference = await client.query(`SELECT 1 FROM conference_task_assignments WHERE conference_id=$1 AND assignee_user_id=$2 AND status<>'CANCELLED' LIMIT 1`, [req.params.id,assigneeId]);
    if (!alreadyInConference.rowCount && Number(conferenceStaffResult.rows[0]?.people || 0) >= PLANNING_LIMITS.staffPrimary + PLANNING_LIMITS.staffBackup) {
        await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Mỗi hội nghị chỉ được phân công tối đa 4 cán bộ (3 chính thức và 1 dự bị)." });
    }
    const taskQuota = await client.query(`SELECT COUNT(*) FILTER (WHERE to_char(c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=to_char($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM'))::int AS monthly,
            COUNT(*) FILTER (WHERE date_trunc('week',c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')=date_trunc('week',$2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS weekly
        FROM conference_task_assignments a JOIN conferences c ON c.id=a.conference_id
        WHERE a.assignee_user_id=$1 AND a.status<>'CANCELLED'`, [assigneeId,targetStart]);
    if (Number(taskQuota.rows[0]?.monthly || 0) >= PLANNING_LIMITS.taskAssignee.monthly || Number(taskQuota.rows[0]?.weekly || 0) >= PLANNING_LIMITS.taskAssignee.weekly) {
        await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: `Cán bộ đã chạm hạn mức ${PLANNING_LIMITS.taskAssignee.monthly} nhiệm vụ/tháng hoặc ${PLANNING_LIMITS.taskAssignee.weekly} nhiệm vụ/tuần.` });
    }
    const assigneeResult = await client.query(`SELECT u.full_name,o.name AS organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
        WHERE u.id=$1 AND u.role='TASK_ASSIGNEE' AND u.is_active=TRUE`, [assigneeId]);
    if (!assigneeResult.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: "Tài khoản người nhận nhiệm vụ không hợp lệ hoặc đã bị khóa." }); }
    const assignee = assigneeResult.rows[0];
    const result = await client.query(`INSERT INTO conference_task_assignments
        (conference_id,title,description,assignee_user_id,assignee_name,assignee_organization,due_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id,title,req.body?.description || null,assigneeId,assignee.full_name,req.body?.assignee_organization || assignee.organization_name,dueAt,req.user.id]);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
});
router.patch("/conferences/:id/assignments/:assignmentId", requireRole("ADMIN"), async (req, res) => {
    const status = String(req.body?.status || "").toUpperCase();
    if (!assignmentStatuses.has(status)) return res.status(400).json({ success: false, message: "Trạng thái nhiệm vụ không hợp lệ." });
    const result = await pool.query(`UPDATE conference_task_assignments SET status=$1,
            completed_at=CASE WHEN $1='COMPLETED' THEN CASE WHEN status='COMPLETED' THEN completed_at ELSE NOW() END ELSE NULL END,
            updated_at=NOW()
        WHERE id=$2 AND conference_id=$3 RETURNING *`, [status,req.params.assignmentId,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy nhiệm vụ." });
    res.json({ success: true, data: result.rows[0] });
});
router.delete("/conferences/:id/assignments/:assignmentId", requireRole("ADMIN"), async (req, res) => {
    const result = await pool.query("DELETE FROM conference_task_assignments WHERE id=$1 AND conference_id=$2 RETURNING id", [req.params.assignmentId,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy nhiệm vụ." });
    res.json({ success: true });
});

router.get("/conferences/:id/speakers", requireRole("ADMIN"), async (req, res) => {
    if (!(await checkConferenceAccess(req, res))) return;
    const result = await pool.query(`SELECT * FROM conference_speakers WHERE conference_id=$1 ORDER BY speaking_order, created_at`, [req.params.id]);
    res.json({ success: true, data: result.rows });
});
router.post("/conferences/:id/speakers", requireRole("ADMIN"), async (req, res) => {
    const speakerId = String(req.body?.speaker_user_id || "");
    const presentation = String(req.body?.presentation_title || "").trim();
    const order = positiveInteger(req.body?.speaking_order ?? 1);
    const duration = positiveInteger(req.body?.duration_minutes ?? 30);
    if (!speakerId || !presentation || order === null || duration === null || duration > 600) return res.status(400).json({ success: false, message: "Vui lòng chọn tài khoản báo cáo viên, nội dung trình bày và thời lượng hợp lệ (1–600 phút)." });
    const client = await pool.connect();
    try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`conference-speakers:${req.params.id}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`speaker-monthly-cap:${speakerId}`]);
    const conferenceResult = await client.query("SELECT start_time FROM conferences WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!conferenceResult.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." }); }
    const targetStart = conferenceResult.rows[0].start_time;
    if (!targetStart) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Hội nghị chưa có ngày tổ chức nên chưa thể kiểm tra hạn mức báo cáo viên." }); }
    const conferenceSpeakerCount = await client.query("SELECT COUNT(DISTINCT speaker_user_id)::int AS people FROM conference_speakers WHERE conference_id=$1 AND speaker_user_id IS NOT NULL", [req.params.id]);
    const alreadyInConference = await client.query("SELECT 1 FROM conference_speakers WHERE conference_id=$1 AND speaker_user_id=$2 LIMIT 1", [req.params.id,speakerId]);
    if (!alreadyInConference.rowCount && Number(conferenceSpeakerCount.rows[0]?.people || 0) >= PLANNING_LIMITS.speakerPrimary + PLANNING_LIMITS.speakerBackup) {
        await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Mỗi hội nghị chỉ được phân công tối đa 2 báo cáo viên (1 chính thức và 1 dự bị)." });
    }
    if (alreadyInConference.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Báo cáo viên này đã được phân công cho hội nghị; mỗi người chỉ nhận một lượt thuyết trình tại cùng hội nghị." }); }
    const speakerQuota = await client.query(`SELECT COUNT(*) FILTER (WHERE to_char(c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=to_char($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM'))::int AS monthly,
            COUNT(*) FILTER (WHERE date_trunc('week',c.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')=date_trunc('week',$2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS weekly
        FROM conference_speakers s JOIN conferences c ON c.id=s.conference_id WHERE s.speaker_user_id=$1`, [speakerId,targetStart]);
    if (Number(speakerQuota.rows[0]?.monthly || 0) >= PLANNING_LIMITS.speaker.monthly || Number(speakerQuota.rows[0]?.weekly || 0) >= PLANNING_LIMITS.speaker.weekly) {
        await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: `Báo cáo viên đã chạm hạn mức ${PLANNING_LIMITS.speaker.monthly} lượt thuyết trình/tháng hoặc ${PLANNING_LIMITS.speaker.weekly} lượt/tuần.` });
    }
    const speakerResult = await client.query(`SELECT u.full_name,o.name AS organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
        WHERE u.id=$1 AND u.role='SPEAKER' AND u.is_active=TRUE`, [speakerId]);
    if (!speakerResult.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: "Tài khoản báo cáo viên không hợp lệ hoặc đã bị khóa." }); }
    const speaker = speakerResult.rows[0];
    const result = await client.query(`INSERT INTO conference_speakers
        (conference_id,speaker_user_id,full_name,organization,role_title,presentation_title,speaking_order,duration_minutes,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.params.id,speakerId,speaker.full_name,req.body?.organization || speaker.organization_name,req.body?.role_title || null,presentation,order,duration,req.body?.notes || null,req.user.id]);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
});
router.put("/conferences/:id/speakers/:speakerId", requireRole("ADMIN"), async (req, res) => {
    const fullName = String(req.body?.full_name || "").trim();
    const presentation = String(req.body?.presentation_title || "").trim();
    const order = positiveInteger(req.body?.speaking_order ?? 1);
    const duration = positiveInteger(req.body?.duration_minutes ?? 30);
    if (!fullName || !presentation || order === null || duration === null || duration > 600) return res.status(400).json({ success: false, message: "Vui lòng nhập báo cáo viên, nội dung trình bày và thời lượng hợp lệ." });
    const result = await pool.query(`UPDATE conference_speakers SET full_name=$1,organization=$2,role_title=$3,
        presentation_title=$4,speaking_order=$5,duration_minutes=$6,notes=$7,updated_at=NOW()
        WHERE id=$8 AND conference_id=$9 RETURNING *`,
    [fullName,req.body?.organization || null,req.body?.role_title || null,presentation,order,duration,req.body?.notes || null,req.params.speakerId,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy báo cáo viên." });
    res.json({ success: true, data: result.rows[0] });
});
router.delete("/conferences/:id/speakers/:speakerId", requireRole("ADMIN"), async (req, res) => {
    const result = await pool.query("DELETE FROM conference_speakers WHERE id=$1 AND conference_id=$2 RETURNING id", [req.params.speakerId,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy báo cáo viên." });
    res.json({ success: true });
});
router.get("/conferences/:id/schedule-conflicts", requireRole("ADMIN"), async (req, res) => {
    const current = await pool.query("SELECT COALESCE(proposed_start_time,start_time) AS start_time,COALESCE(proposed_end_time,end_time) AS end_time,location_name,location_address FROM conferences WHERE id=$1", [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy hội nghị." });
    const base = current.rows[0];
    const overlaps = await pool.query(`SELECT other.id,other.code,other.title,other.start_time,other.end_time,
            other.location_name,other.location_address,other.status,organization.name AS organization_name,
            (daterange((other.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                       (COALESCE(other.end_time,other.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'[]')
             && daterange((COALESCE(base_conference.proposed_start_time,base_conference.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                          (COALESCE(base_conference.proposed_end_time,base_conference.end_time,base_conference.proposed_start_time,base_conference.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'[]'))
             AS same_calendar_day
        FROM conferences base_conference
        JOIN conferences other ON other.id<>base_conference.id
            AND other.status='APPROVED'
        LEFT JOIN organizations organization ON organization.id=other.organization_id
        WHERE base_conference.id=$1
          AND ((other.start_time<COALESCE(base_conference.proposed_end_time,base_conference.end_time) AND other.end_time>COALESCE(base_conference.proposed_start_time,base_conference.start_time))
            OR daterange((other.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                         (COALESCE(other.end_time,other.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'[]')
               && daterange((COALESCE(base_conference.proposed_start_time,base_conference.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                            (COALESCE(base_conference.proposed_end_time,base_conference.end_time,base_conference.proposed_start_time,base_conference.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'[]'))
        ORDER BY other.start_time,other.code`, [req.params.id]);
    const candidates = overlaps.rows;
    if (!candidates.length) return res.json({ success: true, has_conflicts: false, data: [],
        note: "Chỉ kiểm tra hội nghị đã được phê duyệt; hồ sơ chờ phê duyệt được bỏ qua." });

    const ids = candidates.map(item => item.id);
    const [currentPeople, otherPeople] = await Promise.all([
        pool.query(`SELECT 'SPEAKER'::text AS assignment_type,full_name AS person_name
                    FROM conference_speakers WHERE conference_id=$1
                    UNION ALL
                    SELECT 'OFFICIAL'::text,assignee_name FROM conference_task_assignments
                    WHERE conference_id=$1 AND status<>'CANCELLED'`, [req.params.id]),
        pool.query(`SELECT conference_id,assignment_type,person_name FROM (
                        SELECT conference_id,'SPEAKER'::text AS assignment_type,full_name AS person_name
                        FROM conference_speakers WHERE conference_id=ANY($1::uuid[])
                        UNION ALL
                        SELECT conference_id,'OFFICIAL'::text,assignee_name FROM conference_task_assignments
                        WHERE conference_id=ANY($1::uuid[]) AND status<>'CANCELLED'
                    ) assigned_people`, [ids])
    ]);
    const normalize = value => String(value || "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
    const sameLocation = (left, right, key) => normalize(left[key]) !== "" && normalize(left[key]) === normalize(right[key]);
    const results = candidates.flatMap(candidate => {
        const conflictTypes = [];
        const matchedPeople = [];
        if (candidate.same_calendar_day) conflictTypes.push("DAY");
        if (sameLocation(base, candidate, "location_name") || sameLocation(base, candidate, "location_address")) conflictTypes.push("VENUE");
        const people = otherPeople.rows.filter(person => String(person.conference_id) === String(candidate.id));
        for (const assigned of currentPeople.rows) {
            const matched = people.find(person => normalize(person.person_name) === normalize(assigned.person_name));
            if (matched && !matchedPeople.some(person => normalize(person.name) === normalize(assigned.person_name))) {
                matchedPeople.push({ name: assigned.person_name, type: assigned.assignment_type === "SPEAKER" || matched.assignment_type === "SPEAKER" ? "SPEAKER" : "OFFICIAL" });
            }
        }
        if (matchedPeople.length) conflictTypes.push("PERSONNEL");
        return conflictTypes.length ? [{ ...candidate, conflict_types: conflictTypes, matched_people: matchedPeople }] : [];
    });
    res.json({ success: true, has_conflicts: results.some(item => item.conflict_types.length), data: results,
        note: "Cảnh báo chỉ dành cho admin, chỉ xét hội nghị đã phê duyệt; hiển thị các lịch trùng ngày cùng địa điểm. Hồ sơ chờ phê duyệt được bỏ qua." });
});
router.get("/conferences/:id/approved-date-conflicts", requireRole("ADMIN"), async (req, res) => {
    const start = req.query.start_time ? new Date(req.query.start_time) : null;
    const end = req.query.end_time ? new Date(req.query.end_time) : start;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        return res.status(400).json({ success: false, message: "Ngày bắt đầu và kết thúc chưa hợp lệ." });
    }
    const result = await findApprovedDateConflicts(pool, req.params.id, start.toISOString(), end.toISOString());
    res.json({ success: true, has_conflicts: result.rowCount > 0, data: result.rows });
});
router.get("/directory", async (req, res) => {
    if (req.user.role !== "ADMIN" && !req.user.organization_id) return res.status(403).json({ success: false, message: "Tài khoản chưa được gán đơn vị. Vui lòng liên hệ quản trị viên." });
    const result = await pool.query(`SELECT u.full_name,u.email,u.phone,o.name AS organization_name
        FROM users u JOIN organizations o ON o.id=u.organization_id
        WHERE u.is_active=TRUE AND u.role='COMMUNE' AND o.is_active=TRUE
          AND ($1::uuid IS NULL OR u.organization_id<>$1)
        ORDER BY o.name,u.full_name`, [req.user.role === "ADMIN" ? null : req.user.organization_id]);
    res.json({ success: true, data: result.rows });
});
router.get("/users", requireRole("ADMIN"), async (req, res) => {
    const result = await pool.query(`SELECT u.id,u.username,u.full_name,u.email,u.phone,u.role,u.organization_id,o.name AS organization_name,u.is_active,u.last_login_at
        FROM users u LEFT JOIN organizations o ON o.id=u.organization_id ORDER BY u.full_name`);
    res.json({ success: true, data: result.rows });
});
router.post("/users", requireRole("ADMIN"), async (req, res) => {
    const { username, full_name, password, role, organization_id, email, phone } = req.body || {};
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(String(username || ""))) return res.status(400).json({ success: false, message: "Tên đăng nhập cần dài 3–64 ký tự và chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang." });
    const duplicateUsername = await pool.query("SELECT 1 FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1", [username]);
    if (duplicateUsername.rowCount) return res.status(409).json({ success: false, message: "Tên đăng nhập đã tồn tại (không phân biệt chữ hoa/thường)." });
    if (String(password || "").length < 12) return res.status(400).json({ success: false, message: "Mật khẩu cần ít nhất 12 ký tự." });
    if (!String(full_name || "").trim() || !["ADMIN","COMMUNE","TASK_ASSIGNEE","SPEAKER"].includes(role)) return res.status(400).json({ success: false, message: "Vui lòng nhập họ tên và vai trò hợp lệ." });
    if (role === "COMMUNE" && !organization_id) return res.status(400).json({ success: false, message: "Tài khoản xã/phường phải được gắn với một đơn vị." });
    const passwordHash = await hashPassword(password);
    const result = await pool.query(`INSERT INTO users(username,password_hash,full_name,email,phone,role,organization_id,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING id,username,full_name,email,phone,role,organization_id,is_active`,
    [username, passwordHash, String(full_name).trim(), email || null, phone || null, role, organization_id || null]);
    if (role === "TASK_ASSIGNEE") {
        await pool.query(`UPDATE conference_task_assignments SET assignee_user_id=$1
            WHERE assignee_user_id IS NULL AND LOWER(BTRIM(assignee_name))=LOWER(BTRIM($2))
              AND (SELECT COUNT(*) FROM users WHERE role='TASK_ASSIGNEE' AND LOWER(BTRIM(full_name))=LOWER(BTRIM($2)))=1`, [result.rows[0].id, String(full_name).trim()]);
    } else if (role === "SPEAKER") {
        await pool.query(`UPDATE conference_speakers SET speaker_user_id=$1
            WHERE speaker_user_id IS NULL AND LOWER(BTRIM(full_name))=LOWER(BTRIM($2))
              AND (SELECT COUNT(*) FROM users WHERE role='SPEAKER' AND LOWER(BTRIM(full_name))=LOWER(BTRIM($2)))=1`, [result.rows[0].id, String(full_name).trim()]);
    }
    res.status(201).json({ success: true, data: result.rows[0] });
});
router.put("/users/:id", requireRole("ADMIN"), async (req, res) => {
    const { role, is_active, organization_id } = req.body || {};
    if (!["ADMIN","COMMUNE","TASK_ASSIGNEE","SPEAKER"].includes(role) || typeof is_active !== "boolean") return res.status(400).json({ success: false, message: "Vai trò hoặc trạng thái tài khoản không hợp lệ." });
    if (role === "COMMUNE" && !organization_id) return res.status(400).json({ success: false, message: "Tài khoản xã/phường phải được gắn với một đơn vị." });
    if (String(req.user.id) === String(req.params.id) && (role !== "ADMIN" || !is_active)) return res.status(400).json({ success: false, message: "Không thể tự hạ quyền hoặc khóa chính tài khoản đang đăng nhập." });
    const existing = await pool.query("SELECT id,role,is_active FROM users WHERE id=$1", [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy tài khoản." });
    if (existing.rows[0].role === "ADMIN" && (role !== "ADMIN" || !is_active)) {
        const otherAdmins = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role='ADMIN' AND is_active=TRUE AND id<>$1", [req.params.id]);
        if (Number(otherAdmins.rows[0].count) === 0) return res.status(409).json({ success: false, message: "Hệ thống cần ít nhất một quản trị viên đang hoạt động." });
    }
    let result;
    if (req.body.password) {
        if (String(req.body.password).length < 12) return res.status(400).json({ success: false, message: "Mật khẩu cần ít nhất 12 ký tự." });
        result = await pool.query(`UPDATE users SET role=$1,is_active=$2,organization_id=$3,password_hash=$4,updated_at=NOW() WHERE id=$5
            RETURNING id,username,full_name,email,phone,role,organization_id,is_active`, [role,is_active,organization_id || null,await hashPassword(req.body.password),req.params.id]);
    } else {
        result = await pool.query(`UPDATE users SET role=$1,is_active=$2,organization_id=$3,updated_at=NOW() WHERE id=$4
            RETURNING id,username,full_name,email,phone,role,organization_id,is_active`, [role,is_active,organization_id || null,req.params.id]);
    }
    res.json({ success: true, data: result.rows[0] });
});
router.post("/users/:id/reset-password", requireRole("ADMIN"), async (req, res) => {
    if (String(req.user.id) === String(req.params.id)) {
        return res.status(400).json({ success: false, message: "Admin hãy dùng chức năng Đổi mật khẩu để cập nhật tài khoản đang đăng nhập." });
    }
    const account = await pool.query("SELECT id,username,full_name FROM users WHERE id=$1", [req.params.id]);
    if (!account.rowCount) return res.status(404).json({ success: false, message: "Không tìm thấy tài khoản cần cấp lại mật khẩu." });
    const temporaryPassword = crypto.randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    await pool.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2", [passwordHash, req.params.id]);
    res.json({ success: true, message: "Đã cấp mật khẩu tạm.", data: {
        username: account.rows[0].username,
        full_name: account.rows[0].full_name,
        temporary_password: temporaryPassword
    } });
});
module.exports = router;

























