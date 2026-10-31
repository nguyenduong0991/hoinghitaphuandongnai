// API client for the TGPL conference manager.
// Set window.TGPL_API_BASE_URL before this file to use a shared backend.
// Without a configured backend, records are saved in this browser's local storage.
const API_BASE_URL = window.TGPL_API_BASE_URL || "";
window.TGPL_AUTH_ENABLED = Boolean(API_BASE_URL);
const STORAGE_KEYS = {
    conferences: "tgpl.conferences.v1",
    organizations: "tgpl.organizations.v1"
};

function clearSessionChatContext() {
    try {
        const user = JSON.parse(localStorage.getItem("tgpl.user") || "null");
        const userKey = String(user?.id || user?.username || user?.email || user?.role || "").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        if (userKey) sessionStorage.removeItem(`tgpl.ai.context.${userKey}`);
    } catch {}
}

async function apiRequest(endpoint, options = {}) {
    if (API_BASE_URL) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(localStorage.getItem("tgpl.accessToken")
                    ? { Authorization: `Bearer ${localStorage.getItem("tgpl.accessToken")}` }
                    : {}),
                ...(options.headers || {})
            }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            if (response.status === 401 && !endpoint.startsWith("/auth/")) {
                clearSessionChatContext();
                localStorage.removeItem("tgpl.accessToken");
                localStorage.removeItem("tgpl.user");
                const target = `${window.location.pathname}${window.location.search}`;
                window.location.replace(`login.html?return=${encodeURIComponent(target)}`);
            }
            throw new Error(data?.message || data?.error || `API trả về lỗi HTTP ${response.status}`);
        }
        return data;
    }

    return localRequest(endpoint, options);
}

async function chatWithTgpl(question, mode = "auto") {
    return apiRequest("/ai/tgpl-chat", {
        method: "POST",
        body: JSON.stringify({ question, mode })
    });
}

async function streamTgplChat(question, { mode = "auto", history = [], onMeta, onToken, onDone, signal } = {}) {
    if (!API_BASE_URL) throw new Error("Chatbot cần kết nối backend của hệ thống.");
    const response = await fetch(API_BASE_URL + "/ai/tgpl-chat/stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(localStorage.getItem("tgpl.accessToken")
                ? { Authorization: "Bearer " + localStorage.getItem("tgpl.accessToken") }
                : {})
        },
        body: JSON.stringify({ question, mode, history }),
        signal
    });
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 401) {
            clearSessionChatContext();
            localStorage.removeItem("tgpl.accessToken");
            localStorage.removeItem("tgpl.user");
            const target = `${window.location.pathname}${window.location.search}`;
            window.location.replace(`login.html?return=${encodeURIComponent(target)}`);
        }
        throw new Error(data?.message || data?.error || ("API trả về lỗi HTTP " + response.status));
    }
    if (!response.body) throw new Error("Trình duyệt không hỗ trợ nhận câu trả lời dạng luồng.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = { mode, sources: [] };
    function consumeLine(line) {
        if (!line.trim()) return;
        const item = JSON.parse(line);
        if (item.type === "meta") {
            result = { ...result, ...item };
            if (onMeta) onMeta(item);
        } else if (item.type === "token") {
            if (onToken) onToken(item.text || "");
        } else if (item.type === "done") {
            result = { ...result, ...item };
            if (onDone) onDone(item);
        } else if (item.type === "error") {
            throw new Error(item.error || "Không thể xử lý câu hỏi.");
        }
    }
    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            lines.forEach(consumeLine);
            if (done) break;
        }
        if (buffer.trim()) consumeLine(buffer);
    } finally {
        reader.releaseLock();
    }
    return result;
}

async function submitAiAnswerFeedback(feedback) {
    return apiRequest("/ai/tgpl-chat/feedback", { method: "POST", body: JSON.stringify(feedback) });
}
async function createConferencePlanProposal(question, history = [], signal) {
    return apiRequest("/ai/conference-plan-proposal", { method: "POST", body: JSON.stringify({ question, history }), signal });
}
async function reviewAdminDailyIntake(signal) {
    return apiRequest("/ai/admin/daily-intake-review", { method: "POST", body: "{}", signal });
}
async function getConferencePlanNotifications() {
    return apiRequest("/ai/conference-plan-notifications/mine");
}
async function sendConferencePlanNotification(payload) {
    return apiRequest("/ai/conference-plan-notifications", { method: "POST", body: JSON.stringify(payload) });
}
async function markConferencePlanNotificationRead(id) {
    return apiRequest(`/ai/conference-plan-notifications/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" });
}
async function getAiAnswerFeedback() { return apiRequest("/ai/feedback"); }
async function updateAiAnswerFeedback(id, update) {
    return apiRequest(`/ai/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(update) });
}
async function summarizePublicAttendeeConsultations() {
    return apiRequest("/ai/public-attendee-consultations/summarize", { method: "POST", body: "{}" });
}
async function getPublicAttendeeAiTraining() { return apiRequest("/ai/public-attendee-consultations/training"); }
async function reviewPublicAttendeeAiTraining(id, review) {
    return apiRequest(`/ai/public-attendee-consultations/training/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(review) });
}
async function getLegalAidContactRequests({ limit, offset } = {}) {
    const params = new URLSearchParams();
    if (Number.isFinite(Number(limit))) params.set("limit", String(limit));
    if (Number.isFinite(Number(offset))) params.set("offset", String(offset));
    const query = params.toString();
    return apiRequest(`/ai/contact-requests${query ? `?${query}` : ""}`);
}
async function getMyLegalAidContactRequests() { return apiRequest("/ai/my-contact-requests"); }
async function submitLegalAidTaskFeedback(requestId, content) {
    return apiRequest(`/ai/my-contact-requests/${encodeURIComponent(requestId)}/feedback`, {
        method: "POST",
        body: JSON.stringify({ content })
    });
}
async function reviewLegalAidTaskFeedback(id, review) {
    return apiRequest(`/ai/contact-feedback/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(review)
    });
}
async function updateLegalAidContactRequest(id, update) {
    return apiRequest(`/ai/contact-requests/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(update)
    });
}
async function submitNeedSurvey(survey) {
    return apiRequest("/surveys", { method: "POST", body: JSON.stringify(survey) });
}
async function getMyNeedSurveys() { return apiRequest("/surveys/mine"); }
async function getNeedSurveyReport() { return apiRequest("/surveys"); }
async function getParticipationConferences() { return apiRequest("/participation-conferences"); }
async function getConferenceRegistrationOrganizations(id) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/registration-organizations`);
}
async function setConferenceRegistrationOrganizations(id, organizationIds) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/registration-organizations`, {
        method: "PUT",
        body: JSON.stringify({ organization_ids: organizationIds })
    });
}
async function registerForConference(registration) {
    return apiRequest("/attendance-registrations", { method: "POST", body: JSON.stringify(registration) });
}
async function getConferenceAttendanceRegistrations(id) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/attendance-registrations`);
}
async function getPublicConferenceAttendees(id) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/public-attendance`);
}
async function createManualConferenceAttendee(id, attendee) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/public-attendance/manual`, { method: "POST", body: JSON.stringify(attendee) });
}
async function updatePublicAttendanceCheckIn(id, attended) {
    return apiRequest(`/public-attendance/${encodeURIComponent(id)}/check-in`, { method: "PATCH", body: JSON.stringify({ attended }) });
}

function readStored(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(value) ? value : [];
    } catch (error) {
        console.error("Không đọc được dữ liệu đã lưu:", error);
        return [];
    }
}

function writeStored(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        throw new Error("Không thể lưu dữ liệu trên trình duyệt này. Hãy kiểm tra dung lượng lưu trữ.");
    }
}

function localRequest(endpoint, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const data = options.body ? JSON.parse(options.body) : {};
    const conferenceMatch = endpoint.match(/^\/conferences\/([^/]+)$/);

    if (endpoint === "/health") return { success: true, mode: "local" };
    if (endpoint === "/organizations" && method === "GET") {
        return { data: readStored(STORAGE_KEYS.organizations) };
    }
    if (endpoint === "/organizations" && method === "POST") {
        const organizations = readStored(STORAGE_KEYS.organizations);
        const name = String(data.name || "").trim();
        if (!name) throw new Error("Vui lòng nhập tên đơn vị.");
        if (organizations.some(item => item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
            throw new Error("Tên đơn vị đã tồn tại.");
        }
        const organization = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, name };
        organizations.push(organization);
        writeStored(STORAGE_KEYS.organizations, organizations);
        return { data: organization };
    }
    const organizationMatch = endpoint.match(/^\/organizations\/([^/]+)$/);
    if (organizationMatch && method === "PUT") {
        const id = decodeURIComponent(organizationMatch[1]);
        const organizations = readStored(STORAGE_KEYS.organizations);
        const organization = organizations.find(item => String(item.id) === id);
        if (!organization) throw new Error("Không tìm thấy đơn vị.");
        const name = String(data.name || "").trim();
        if (!name) throw new Error("Vui lòng nhập tên đơn vị.");
        if (organizations.some(item => String(item.id) !== id && item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
            throw new Error("Tên đơn vị đã tồn tại.");
        }
        organization.name = name;
        writeStored(STORAGE_KEYS.organizations, organizations);
        return { data: organization };
    }
    if (endpoint === "/conferences" && method === "GET") {
        return { data: readStored(STORAGE_KEYS.conferences) };
    }
    if (endpoint === "/conferences" && method === "POST") {
        const conferences = readStored(STORAGE_KEYS.conferences);
        const organizations = readStored(STORAGE_KEYS.organizations);
        const organizationId = String(data.organization_id || "").trim();
        let organization = organizations.find(item => String(item.id) === organizationId);
        if (!organization && organizationId) {
            organization = { id: organizationId, name: organizationId };
            organizations.push(organization);
            writeStored(STORAGE_KEYS.organizations, organizations);
        }
        const conference = {
            ...data,
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            code: `TGPL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
            organization_name: organization?.name || "",
            status: "PENDING",
            created_at: new Date().toISOString()
        };
        conferences.unshift(conference);
        writeStored(STORAGE_KEYS.conferences, conferences);
        return { data: conference };
    }
    const statusMatch = endpoint.match(/^\/conferences\/([^/]+)\/status$/);
    if (statusMatch && method === "PATCH") {
        const id = decodeURIComponent(statusMatch[1]);
        const conferences = readStored(STORAGE_KEYS.conferences);
        const conference = conferences.find(item => String(item.id) === id);
        if (!conference) throw new Error("Không tìm thấy hội nghị.");
        if (!["PENDING", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED", "RESCHEDULED"].includes(data.status)) {
            throw new Error("Trạng thái hội nghị không hợp lệ.");
        }
        if (data.status === "RESCHEDULED") {
            conference.proposed_start_time = data.proposed_start_time;
            conference.proposed_end_time = data.proposed_end_time;
            conference.reschedule_note = data.reschedule_note || null;
        } else if (data.status === "APPROVED" && conference.status === "RESCHEDULED" && conference.proposed_start_time) {
            conference.start_time = conference.proposed_start_time;
            conference.end_time = conference.proposed_end_time;
            delete conference.proposed_start_time;
            delete conference.proposed_end_time;
            delete conference.reschedule_note;
        }
        conference.status = data.status;
        conference.updated_at = new Date().toISOString();
        writeStored(STORAGE_KEYS.conferences, conferences);
        return { data: conference };
    }
    if (conferenceMatch) {
        const id = decodeURIComponent(conferenceMatch[1]);
        const conferences = readStored(STORAGE_KEYS.conferences);
        const index = conferences.findIndex(item => String(item.id) === id);
        if (index < 0) throw new Error("Không tìm thấy hội nghị.");
        if (method === "GET") return { data: conferences[index] };
    }
    if (endpoint === "/conferences/statistics" && method === "GET") {
        return { data: readStored(STORAGE_KEYS.conferences) };
    }
    throw new Error("Chức năng hoặc đường dẫn API không được hỗ trợ.");
}

async function checkBackend() { return apiRequest("/health"); }
async function getConferences() { return apiRequest("/conferences"); }
async function getOrganizations() { return apiRequest("/organizations"); }
async function getConference(id) { return apiRequest(`/conferences/${encodeURIComponent(id)}`); }
async function createConference(conferenceData) {
    return apiRequest("/conferences", { method: "POST", body: JSON.stringify(conferenceData) });
}

async function createOrganization(name) {
    return apiRequest("/organizations", { method: "POST", body: JSON.stringify({ name }) });
}

async function updateOrganization(id, organization) {
    return apiRequest(`/organizations/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(organization)
    });
}

async function updateConferenceStatus(id, status, reason = "", scheduleProposal = {}) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason, ...scheduleProposal })
    });
}

async function updateConferencePublicVisibility(id, isPublic) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/public`, {
        method: "PATCH",
        body: JSON.stringify({ is_public: Boolean(isPublic) })
    });
}

async function updateConferenceDescription(id, description) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/description`, {
        method: "PATCH",
        body: JSON.stringify({ description })
    });
}

async function getConferenceStatusHistory(id) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/status-history`);
}

async function getAuthStatus() { return apiRequest("/auth/status"); }
async function loginUser(username, password) {
    return apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}
async function setupAdminUser(username, full_name, password, bootstrapToken = "") {
    return apiRequest("/auth/setup-admin", {
        method: "POST",
        headers: bootstrapToken ? { "X-Admin-Bootstrap-Token": bootstrapToken } : {},
        body: JSON.stringify({ username, full_name, password })
    });
}
async function getCurrentUser() { return apiRequest("/auth/me"); }
async function changeOwnPassword(current_password, new_password, confirm_password) {
    return apiRequest("/account/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password, confirm_password })
    });
}
async function getUsers() { return apiRequest("/users"); }
async function getDirectory() { return apiRequest("/directory"); }
async function createUser(user) { return apiRequest("/users", { method: "POST", body: JSON.stringify(user) }); }
async function updateUser(id, user) {
    return apiRequest(`/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(user) });
}
async function resetUserPassword(id) {
    return apiRequest(`/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: "{}" });
}
async function getDemandAnalysis(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return apiRequest(`/analytics/needs${query ? `?${query}` : ""}`);
}
async function getConferenceImpact(months = 3, filters = {}) {
    const query = new URLSearchParams({ months: String(months), ...filters }).toString();
    return apiRequest(`/analytics/conference-impact?${query}`);
}
async function recordAccessMetric(metric) {
    return apiRequest("/analytics/metrics", { method: "POST", body: JSON.stringify(metric) });
}
async function getAccessMetrics() { return apiRequest("/analytics/metrics"); }
async function getConferenceStatistics() { return apiRequest("/conferences/statistics"); }
async function getMyConferenceNotifications() { return apiRequest("/my-conference-notifications"); }
async function respondToConferenceReschedule(id, response) {
    return apiRequest(`/my/conferences/${encodeURIComponent(id)}/reschedule-response`, {
        method: "PATCH", body: JSON.stringify({ response })
    });
}
async function getConferenceAssignments(id) { return apiRequest(`/conferences/${encodeURIComponent(id)}/assignments`); }
async function createConferenceAssignment(id, assignment) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/assignments`, { method: "POST", body: JSON.stringify(assignment) });
}
async function updateConferenceAssignmentStatus(id, assignmentId, status) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}`, {
        method: "PATCH", body: JSON.stringify({ status })
    });
}
async function deleteConferenceAssignment(id, assignmentId) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}`, { method: "DELETE" });
}
async function getConferenceSpeakers(id) { return apiRequest(`/conferences/${encodeURIComponent(id)}/speakers`); }
async function createConferenceSpeaker(id, speaker) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/speakers`, { method: "POST", body: JSON.stringify(speaker) });
}
async function updateConferenceSpeaker(id, speakerId, speaker) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/speakers/${encodeURIComponent(speakerId)}`, {
        method: "PUT", body: JSON.stringify(speaker)
    });
}
async function deleteConferenceSpeaker(id, speakerId) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/speakers/${encodeURIComponent(speakerId)}`, { method: "DELETE" });
}
async function getConferenceScheduleConflicts(id) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}/schedule-conflicts`);
}
async function getApprovedDateConflicts(id, startTime, endTime) {
    const query = new URLSearchParams({ start_time: startTime, end_time: endTime });
    return apiRequest(`/conferences/${encodeURIComponent(id)}/approved-date-conflicts?${query}`);
}
async function getMyAssignments() { return apiRequest("/my-assignments"); }
async function getMyReminders() { return apiRequest("/my-reminders"); }
async function suggestConferenceTopics(description) { return apiRequest("/ai/conference-topic-advisor", { method: "POST", body: JSON.stringify({ description }) }); }
async function generateConferencePlan(id, options = {}) { return apiRequest(`/ai/conferences/${encodeURIComponent(id)}/plan`, { method: "POST", body: JSON.stringify(options) }); }
async function getMyStaffChangeRequests() { return apiRequest("/my-assignments/change-requests"); }
async function createStaffChangeRequest(request) {
    return apiRequest("/my-assignments/change-requests", { method: "POST", body: JSON.stringify(request) });
}
async function getStaffChangeRequests() { return apiRequest("/staff-change-requests"); }
async function reviewStaffChangeRequest(id, decision) {
    return apiRequest(`/staff-change-requests/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(decision) });
}
async function updateMyTaskStatus(id, status, completedAt = null) {
    return apiRequest(`/my-assignments/tasks/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(completedAt ? { completed_at: completedAt } : {}) }) });
}
async function getAssignmentReports(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return apiRequest(`/assignment-reports${query ? `?${query}` : ""}`);
}
async function saveTaskEvaluation(taskId, rating, note) {
    return apiRequest(`/assignment-reports/tasks/${encodeURIComponent(taskId)}/evaluation`, {
        method: "PATCH", body: JSON.stringify({ rating: Number(rating), note })
    });
}
