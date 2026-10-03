// ======================================================
// APP.JS - DASHBOARD QUẢN LÝ HỘI NGHỊ TGPL
// ======================================================

document.addEventListener("DOMContentLoaded", async function () {
    console.log("Đang khởi tạo Dashboard...");

    try {
        const health = await checkBackend();
        console.log("Backend:", health);

        await loadDashboard();
        window.setInterval(loadDashboard, 60_000);
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
        updateDashboardReport(conferences);

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

function updateDashboardReport(conferences) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentStart = new Date(today);
    currentStart.setDate(currentStart.getDate() - 29);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 30);
    const periodRecords = (start, end) => conferences.filter(item => {
        const createdAt = new Date(item.created_at || item.createdAt || item.start_time || 0);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= start && createdAt < end;
    });
    const currentEnd = new Date(today);
    currentEnd.setDate(currentEnd.getDate() + 1);
    const current = periodRecords(currentStart, currentEnd);
    const previous = periodRecords(previousStart, currentStart);
    const countStatus = (records, status) => records.filter(item => item.status === status).length;
    const sumParticipants = records => records.reduce((sum, item) => sum + (Number(item.expected_participants) || 0), 0);

    setElementText("reportPeriod", `${formatDateOnly(currentStart)} – ${formatDateOnly(now)} · so với 30 ngày liền trước`);
    setElementText("reportUpdated", `Cập nhật lúc ${now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`);
    setElementText("periodRegistered", current.length.toLocaleString("vi-VN"));
    setElementText("periodApproved", countStatus(current, "APPROVED").toLocaleString("vi-VN"));
    setElementText("periodCompleted", countStatus(current, "COMPLETED").toLocaleString("vi-VN"));
    setElementText("periodParticipants", sumParticipants(current).toLocaleString("vi-VN"));
    setElementText("registeredTotal", `Toàn hệ thống: ${conferences.length.toLocaleString("vi-VN")} hội nghị`);
    setElementText("approvedTotal", `Toàn hệ thống: ${countStatus(conferences, "APPROVED").toLocaleString("vi-VN")} hội nghị`);
    setElementText("completedTotal", `Toàn hệ thống: ${countStatus(conferences, "COMPLETED").toLocaleString("vi-VN")} hội nghị`);
    setElementText("participantsTotal", `Toàn hệ thống: ${sumParticipants(conferences).toLocaleString("vi-VN")} lượt dự kiến`);

    renderPeriodChange("registeredChange", current.length, previous.length);
    renderPeriodChange("approvedChange", countStatus(current, "APPROVED"), countStatus(previous, "APPROVED"));
    renderPeriodChange("completedChange", countStatus(current, "COMPLETED"), countStatus(previous, "COMPLETED"));
    renderPeriodChange("participantsChange", sumParticipants(current), sumParticipants(previous));
    updateTrendChart(conferences, now);
}

function formatDateOnly(value) {
    return value.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function renderPeriodChange(id, current, previous) {
    const element = document.getElementById(id);
    if (!element) return;
    element.classList.remove("is-up", "is-down", "is-neutral");
    if (previous === 0) {
        element.classList.add(current > 0 ? "is-up" : "is-neutral");
        element.innerHTML = current > 0
            ? `<i class="bi bi-arrow-up-right"></i> Mới phát sinh · ${current.toLocaleString("vi-VN")}`
            : `<i class="bi bi-dash"></i> Chưa phát sinh ở cả hai kỳ`;
        return;
    }
    const change = ((current - previous) / previous) * 100;
    const direction = change > 0 ? "up" : change < 0 ? "down" : "neutral";
    const icon = change > 0 ? "bi-arrow-up-right" : change < 0 ? "bi-arrow-down-right" : "bi-dash";
    element.classList.add(`is-${direction}`);
    element.innerHTML = `<i class="bi ${icon}"></i> ${change > 0 ? "+" : ""}${change.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% · kỳ trước ${previous.toLocaleString("vi-VN")}`;
}

function updateTrendChart(conferences, now) {
    const canvas = document.getElementById("trendChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (window.conferenceTrendChart) window.conferenceTrendChart.destroy();
    const months = [];
    for (let offset = 5; offset >= 0; offset--) {
        months.push(new Date(now.getFullYear(), now.getMonth() - offset, 1));
    }
    const labels = months.map(month => month.toLocaleDateString("vi-VN", { month: "short", year: "2-digit" }));
    const registered = months.map(month => conferences.filter(item => {
        const date = new Date(item.created_at || item.createdAt || item.start_time || 0);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
    }).length);
    const completed = months.map(month => conferences.filter(item => {
        const date = new Date(item.created_at || item.createdAt || item.start_time || 0);
        return item.status === "COMPLETED" && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
    }).length);
    window.conferenceTrendChart = new Chart(canvas, {
        type: "line",
        data: { labels, datasets: [
            { label: "Hội nghị đăng ký", data: registered, borderColor: "#1769aa", backgroundColor: "rgba(23,105,170,.12)", fill: true, tension: .35, pointRadius: 3 },
            { label: "Đã hoàn thành", data: completed, borderColor: "#198754", backgroundColor: "transparent", tension: .35, pointRadius: 3 }
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
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
