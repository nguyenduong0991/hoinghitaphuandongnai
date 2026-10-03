// API client for the TGPL conference manager.
// Set window.TGPL_API_BASE_URL before this file to use a shared backend.
// Without a configured backend, records are saved in this browser's local storage.
const API_BASE_URL = window.TGPL_API_BASE_URL || "";
const STORAGE_KEYS = {
    conferences: "tgpl.conferences.v1",
    organizations: "tgpl.organizations.v1"
};

async function apiRequest(endpoint, options = {}) {
    if (API_BASE_URL) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.message || `API trả về lỗi HTTP ${response.status}`);
        }
        return data;
    }

    return localRequest(endpoint, options);
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
    if (conferenceMatch) {
        const id = decodeURIComponent(conferenceMatch[1]);
        const conferences = readStored(STORAGE_KEYS.conferences);
        const index = conferences.findIndex(item => String(item.id) === id);
        if (index < 0) throw new Error("Không tìm thấy hội nghị.");
        if (method === "GET") return { data: conferences[index] };
        if (method === "PUT") {
            conferences[index] = { ...conferences[index], ...data, updated_at: new Date().toISOString() };
            writeStored(STORAGE_KEYS.conferences, conferences);
            return { data: conferences[index] };
        }
        if (method === "DELETE") {
            conferences.splice(index, 1);
            writeStored(STORAGE_KEYS.conferences, conferences);
            return { success: true };
        }
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
async function updateConference(id, conferenceData) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(conferenceData) });
}
async function deleteConference(id) {
    return apiRequest(`/conferences/${encodeURIComponent(id)}`, { method: "DELETE" });
}
async function getConferenceStatistics() { return apiRequest("/conferences/statistics"); }
