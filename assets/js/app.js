// ======================================================
// APP.JS - DASHBOARD QUẢN LÝ HỘI NGHỊ TGPL
// ======================================================

document.addEventListener("DOMContentLoaded", async function () {
    console.log("Đang khởi tạo Dashboard...");

    try {
        const health = await checkBackend();
        console.log("Backend:", health);

        await loadDashboard();
    } catch (error) {
        console.error("Không thể kết nối Backend:", error);
        showConnectionError(error);
    }
});

async function loadDashboard() {
    try {
        const result = await getConferences();

        console.log("Dữ liệu hội nghị:", result);

        const conferences = result.data || [];

        updateStatistics(conferences);
        updateRecentConferences(conferences);
        updateStatusChart(conferences);

    } catch (error) {
        console.error("Lỗi tải dữ liệu Dashboard:", error);
        showConnectionError(error);
    }
}


// ======================================================
// THỐNG KÊ
// ======================================================

function updateStatistics(conferences) {

    const total = conferences.length;

    const pending =
        conferences.filter(item => item.status === "PENDING").length;

    const approved =
        conferences.filter(item => item.status === "APPROVED").length;

    const completed =
        conferences.filter(item => item.status === "COMPLETED").length;

    const rejected =
        conferences.filter(item => item.status === "REJECTED").length;

    const cancelled =
        conferences.filter(item => item.status === "CANCELLED").length;


    setElementText("totalConferences", total);
    setElementText("pendingConferences", pending);
    setElementText("approvedConferences", approved);
    setElementText("completedConferences", completed);
    setElementText("rejectedConferences", rejected);
    setElementText("cancelledConferences", cancelled);


    // Hỗ trợ các ID cũ nếu Dashboard đang sử dụng
    setElementText("total", total);
    setElementText("pending", pending);
    setElementText("approved", approved);
    setElementText("completed", completed);


    console.log("Thống kê:", {
        total,
        pending,
        approved,
        completed,
        rejected,
        cancelled
    });
}

function updateStatusChart(conferences) {
    const canvas = document.getElementById("statusChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (window.conferenceStatusChart) window.conferenceStatusChart.destroy();

    const statuses = ["PENDING", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED", "RESCHEDULED"];
    const labels = ["Chờ phê duyệt", "Đã phê duyệt", "Hoàn thành", "Từ chối", "Đã hủy", "Đề xuất dời lịch"];
    const colors = ["#f6c344", "#198754", "#0d6efd", "#dc3545", "#6c757d", "#0dcaf0"];
    window.conferenceStatusChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: statuses.map(status => conferences.filter(item => item.status === status).length),
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
}


// ======================================================
// HỒ SƠ GẦN ĐÂY
// ======================================================

function updateRecentConferences(conferences) {

    const sorted = [...conferences].sort(function (a, b) {

        const dateA = new Date(a.start_time || 0);
        const dateB = new Date(b.start_time || 0);

        return dateB - dateA;
    });


    const recent = sorted.slice(0, 5);


    // ID ĐÚNG TRONG index.html
    const tableBody =
        document.getElementById("recentTable") ||
        document.getElementById("recentConferences") ||
        document.getElementById("conferenceTableBody");


    if (!tableBody) {

        console.log(
            "Không tìm thấy bảng recentTable/recentConferences/conferenceTableBody."
        );

        return;
    }


    tableBody.innerHTML = "";


    if (recent.length === 0) {

        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    Chưa có dữ liệu hội nghị
                </td>
            </tr>
        `;

        return;
    }


    recent.forEach(function (conference) {

        const row = document.createElement("tr");


        row.innerHTML = `
            <td>
                ${escapeHtml(conference.code || "")}
            </td>

            <td>
                ${escapeHtml(conference.title || "")}
            </td>

            <td>
                ${escapeHtml(
                    conference.organization_name ||
                    conference.organization_id ||
                    ""
                )}
            </td>

            <td>${getStatusBadge(conference.status)}</td>
            <td><a class="btn btn-sm btn-outline-primary" href="conference-list.html?id=${encodeURIComponent(conference.id)}">Xem</a></td>
        `;


        tableBody.appendChild(row);
    });
}


// ======================================================
// TRẠNG THÁI
// ======================================================

function getStatusBadge(status) {

    const statusMap = {

        PENDING: {
            text: "Chờ phê duyệt",
            className: "bg-warning text-dark"
        },

        APPROVED: {
            text: "Đã phê duyệt",
            className: "bg-success"
        },

        COMPLETED: {
            text: "Hoàn thành",
            className: "bg-primary"
        },

        REJECTED: {
            text: "Từ chối",
            className: "bg-danger"
        },

        CANCELLED: {
            text: "Đã hủy",
            className: "bg-secondary"
        },

        RESCHEDULED: {
            text: "Đề xuất dời lịch",
            className: "bg-info text-dark"
        }
    };


    const item = statusMap[status] || {

        text: status || "Không xác định",

        className: "bg-secondary"
    };


    return `
        <span class="badge ${item.className}">
            ${item.text}
        </span>
    `;
}


// ======================================================
// ĐỊNH DẠNG NGÀY GIỜ
// ======================================================

function formatDateTime(value) {

    if (!value) {
        return "";
    }


    const date = new Date(value);


    if (Number.isNaN(date.getTime())) {
        return value;
    }


    return date.toLocaleString("vi-VN", {

        day: "2-digit",
        month: "2-digit",
        year: "numeric",

        hour: "2-digit",
        minute: "2-digit"
    });
}


// ======================================================
// GÁN TEXT CHO PHẦN TỬ HTML
// ======================================================

function setElementText(id, value) {

    const element = document.getElementById(id);


    if (element) {

        element.textContent = value;
    }
}


// ======================================================
// THÔNG BÁO LỖI BACKEND
// ======================================================

function showConnectionError(error) {

    console.error(error);


    const errorElement =
        document.getElementById("connectionError");


    if (errorElement) {

        errorElement.innerHTML = `

            <div class="alert alert-danger">

                <strong>
                    Không kết nối được Backend.
                </strong>

                <br>

                ${escapeHtml(error?.message || "Vui lòng tải lại trang và thử lại.")}

            </div>
        `;


        errorElement.style.display = "block";

        return;
    }


    console.warn(
        "Backend chưa kết nối. Hãy kiểm tra http://localhost:3000"
    );
}


// ======================================================
// CHỐNG HTML INJECTION
// ======================================================

function escapeHtml(value) {

    if (value === null || value === undefined) {

        return "";
    }


    return String(value)

        .replace(/&/g, "&amp;")

        .replace(/</g, "&lt;")

        .replace(/>/g, "&gt;")

        .replace(/"/g, "&quot;")

        .replace(/'/g, "&#039;");
}
