// ======================================================
// API CLIENT - PHẦN MỀM QUẢN LÝ HỘI NGHỊ TGPL
// ======================================================

// Backend chạy trên máy tính hiện tại
const API_BASE_URL = "http://localhost:3000/api";


// ======================================================
// HÀM GỌI API DÙNG CHUNG
// ======================================================

async function apiRequest(endpoint, options = {}) {

    const url = `${API_BASE_URL}${endpoint}`;

    const defaultOptions = {
        headers: {
            "Content-Type": "application/json"
        }
    };

    const finalOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };

    try {

        const response = await fetch(url, finalOptions);

        let data = null;

        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }

        if (!response.ok) {

            const message =
                data?.message ||
                `API trả về lỗi HTTP ${response.status}`;

            throw new Error(message);
        }

        return data;

    } catch (error) {

        console.error("API Error:", error);

        throw error;
    }
}


// ======================================================
// KIỂM TRA BACKEND
// ======================================================

async function checkBackend() {

    return await apiRequest("/health");
}


// ======================================================
// LẤY DANH SÁCH HỘI NGHỊ
// ======================================================

async function getConferences() {

    return await apiRequest("/conferences");
}


// ======================================================
// LẤY CHI TIẾT HỘI NGHỊ
// ======================================================

async function getConference(id) {

    return await apiRequest(`/conferences/${id}`);
}


// ======================================================
// TẠO HỘI NGHỊ
// ======================================================

async function createConference(conferenceData) {

    return await apiRequest("/conferences", {

        method: "POST",

        body: JSON.stringify(conferenceData)

    });
}


// ======================================================
// CẬP NHẬT HỘI NGHỊ
// ======================================================

async function updateConference(id, conferenceData) {

    return await apiRequest(`/conferences/${id}`, {

        method: "PUT",

        body: JSON.stringify(conferenceData)

    });
}


// ======================================================
// XÓA HỘI NGHỊ
// ======================================================

async function deleteConference(id) {

    return await apiRequest(`/conferences/${id}`, {

        method: "DELETE"

    });
}


// ======================================================
// LẤY THỐNG KÊ
// ======================================================

async function getConferenceStatistics() {

    return await apiRequest("/conferences/statistics");
}
