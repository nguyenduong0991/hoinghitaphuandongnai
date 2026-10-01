// ======================================================
// LẤY DỮ LIỆU HỘI NGHỊ
// ======================================================

// Lấy dữ liệu từ LocalStorage
const data = JSON.parse(
    localStorage.getItem("conferenceList") || "[]"
);


// ======================================================
// ĐẾM TRẠNG THÁI
// ======================================================

// Tổng số hồ sơ
const total = data.length;


// Chờ phê duyệt
const pending = data.filter(
    item => item.status === "Chờ phê duyệt"
).length;


// Đã phê duyệt
const approved = data.filter(
    item => item.status === "Đã phê duyệt"
).length;


// Hoàn thành
const completed = data.filter(
    item => item.status === "Hoàn thành"
).length;


// ======================================================
// HIỂN THỊ KPI
// ======================================================

document.getElementById("totalConference").innerText = total;

document.getElementById("pendingConference").innerText = pending;

document.getElementById("approvedConference").innerText = approved;

document.getElementById("completedConference").innerText = completed;


// ======================================================
// BIỂU ĐỒ
// ======================================================

const chartElement = document.getElementById("statusChart");

if (chartElement) {

    new Chart(chartElement, {

        type: "pie",

        data: {

            labels: [
                "Chờ phê duyệt",
                "Đã phê duyệt",
                "Hoàn thành"
            ],

            datasets: [
                {
                    data: [
                        pending,
                        approved,
                        completed
                    ]
                }
            ]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {
                    position: "bottom"
                }

            }

        }

    });

}


// ======================================================
// DANH SÁCH HỒ SƠ GẦN ĐÂY
// ======================================================

const recentTable =
    document.getElementById("recentTable");


if (recentTable) {

    let html = "";


    // Lấy 10 hồ sơ mới nhất
    const recentData = data
        .slice()
        .reverse()
        .slice(0, 10);


    // Nếu chưa có dữ liệu
    if (recentData.length === 0) {

        html = `
            <tr>
                <td colspan="4" class="text-center text-muted">
                    Chưa có hồ sơ
                </td>
            </tr>
        `;

    }


    // Nếu có dữ liệu
    else {

        recentData.forEach(item => {

            html += `
                <tr>

                    <td>
                        ${escapeHtml(item.code || "")}
                    </td>

                    <td>
                        ${escapeHtml(item.topic || "")}
                    </td>

                    <td>
                        ${escapeHtml(item.organization || "")}
                    </td>

                    <td>
                        ${escapeHtml(item.status || "")}
                    </td>

                </tr>
            `;

        });

    }


    recentTable.innerHTML = html;

}


// ======================================================
// HÀM BẢO VỆ HTML
// ======================================================

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}
