// ======================================================
// APP.JS - DASHBOARD QUẢN LÝ HỘI NGHỊ TGPL
// ======================================================

function setDashboardRoleVisibility(user) {
    const isAdmin = user?.role === "ADMIN";
    const isCommune = user?.role === "COMMUNE";
    document.querySelectorAll(".admin-dashboard-only").forEach(section => { section.hidden = !isAdmin; });
    document.querySelectorAll(".commune-dashboard-only").forEach(section => { section.hidden = !isCommune; });
}

window.addEventListener("tgpl:authenticated", event => setDashboardRoleVisibility(event.detail?.user));

document.addEventListener("DOMContentLoaded", async function () {
    console.log("Đang khởi tạo Dashboard...");
    try { setDashboardRoleVisibility(JSON.parse(localStorage.getItem("tgpl.user") || "null")); } catch { setDashboardRoleVisibility(null); }

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
        const [result, statsResult] = await Promise.all([getConferences(), getConferenceStatistics()]);
        const conferences = result.data || [];
        const statistics = statsResult.data || {};

        updateStatistics(statistics);
        updateRecentConferences(conferences);
        updateStatusChart(statistics.by_status || {});
        updateDashboardReport(statistics);
        updateTrendChart(statistics.by_month || [], new Date());

    } catch (error) {
        console.error("Lỗi tải dữ liệu Dashboard:", error);
        showConnectionError(error);
    }
}


// ======================================================
// THỐNG KÊ
// ======================================================

function updateStatistics(statistics) {
    const counts = statistics.by_status || {};
    const total = Number(statistics.total || 0);
    const pending = Number(counts.PENDING || 0);
    const approved = Number(counts.APPROVED || 0);
    const completed = Number(counts.COMPLETED || 0);
    const rejected = Number(counts.REJECTED || 0);
    const cancelled = Number(counts.CANCELLED || 0);

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

function updateDashboardReport(statistics) {
    const now = new Date();
    const comparison = statistics.period_comparison || { current: {}, previous: {} };
    const current = comparison.current || {};
    const previous = comparison.previous || {};
    const counts = statistics.by_status || {};
    const expectedTotal = (statistics.by_month || []).reduce((sum, row) => sum + Number(row.expected_participants || 0), 0);
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    setElementText("reportPeriod", `${formatDateOnly(rangeStart)} – ${formatDateOnly(now)} · so với 30 ngày liền trước`);
    setElementText("reportUpdated", `Cập nhật lúc ${now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`);
    setElementText("periodRegistered", Number(current.registered || 0).toLocaleString("vi-VN"));
    setElementText("periodApproved", Number(current.approved || 0).toLocaleString("vi-VN"));
    setElementText("periodCompleted", Number(current.completed || 0).toLocaleString("vi-VN"));
    setElementText("periodParticipants", Number(current.participants || 0).toLocaleString("vi-VN"));
    setElementText("registeredTotal", `Toàn hệ thống: ${Number(statistics.total || 0).toLocaleString("vi-VN")} hội nghị`);
    setElementText("approvedTotal", `Toàn hệ thống: ${Number(counts.APPROVED || 0).toLocaleString("vi-VN")} hội nghị`);
    setElementText("completedTotal", `Toàn hệ thống: ${Number(counts.COMPLETED || 0).toLocaleString("vi-VN")} hội nghị`);
    setElementText("participantsTotal", `Toàn hệ thống: ${expectedTotal.toLocaleString("vi-VN")} lượt dự kiến`);
    renderPeriodChange("registeredChange", Number(current.registered || 0), Number(previous.registered || 0));
    renderPeriodChange("approvedChange", Number(current.approved || 0), Number(previous.approved || 0));
    renderPeriodChange("completedChange", Number(current.completed || 0), Number(previous.completed || 0));
    renderPeriodChange("participantsChange", Number(current.participants || 0), Number(previous.participants || 0));
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

function updateTrendChart(monthRows, now) {
    const canvas = document.getElementById("trendChart");
    if (!canvas || typeof Chart === "undefined") return;
    if (window.conferenceTrendChart) window.conferenceTrendChart.destroy();
    const months = monthRows.slice(-6);
    const labels = months.map(row => {
        const [year, month] = String(row.month).split("-").map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString("vi-VN", { month: "short", year: "2-digit" });
    });
    const registered = months.map(row => Number(row.count || 0));
    const completed = months.map(row => Number(row.completed_count || 0));
    window.conferenceTrendChart = new Chart(canvas, {
        type: "line",
        data: { labels, datasets: [
            { label: "Hội nghị đăng ký", data: registered, borderColor: "#1769aa", backgroundColor: "rgba(23,105,170,.12)", fill: true, tension: .35, pointRadius: 3 },
            { label: "Đã hoàn thành", data: completed, borderColor: "#198754", backgroundColor: "transparent", tension: .35, pointRadius: 3 }
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

function updateStatusChart(statusCounts) {
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
                data: statuses.map(status => Number(statusCounts[status] || 0)),
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
