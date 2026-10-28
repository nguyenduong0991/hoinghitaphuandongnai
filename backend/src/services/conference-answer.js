const FIELD_PATTERNS = Object.freeze({
    time: /\b(?:khi nao|ngay nao|ngay gio|thoi gian|lich|dien ra|to chuc luc|vao luc)\b/,
    location: /\b(?:o dau|tai dau|dia diem|noi to chuc|dia chi|to chuc tai dau|to chuc o dau|dien ra tai dau|noi dien ra|tai dia diem nao)\b/,
    speaker: /\b(?:bao cao vien|ai trinh bay|nguoi thuyet trinh|ai thuyet trinh)\b/,
    status: /\b(?:trang thai|tinh trang|phe duyet)\b/,
    assignees: /\b(?:phan cong|ai duoc giao|ai la nguoi.{0,20}(?:duoc giao|nhan nhiem vu)|nguoi nhan nhiem vu|ai nhan)\b/
});

function normalize(value) {
    return String(value || "").toLocaleLowerCase("vi-VN").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function requestedConferenceFields(question) {
    const text = normalize(question);
    const fields = Object.entries(FIELD_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
    return new Set(fields.length ? fields : Object.keys(FIELD_PATTERNS));
}

function formatConferenceDetails(row, speakers, requestedFields, formatDate, assignees = []) {
    const fields = requestedFields instanceof Set ? requestedFields : new Set(requestedFields || []);
    const statusLabels = {
        PENDING: "chờ phê duyệt", APPROVED: "đã phê duyệt", COMPLETED: "hoàn thành",
        REJECTED: "bị từ chối", CANCELLED: "đã hủy", RESCHEDULED: "đề xuất dời lịch"
    };
    const details = [`${row.code} – ${row.title || "chưa có tiêu đề"}`];
    if (fields.has("time")) {
        const start = row.proposed_start_time || row.start_time;
        const end = row.proposed_end_time || row.end_time;
        let time = start ? `${formatDate(start)}${end ? ` đến ${formatDate(end)}` : ""}` : "chưa có dữ liệu thời gian";
        if (row.status === "RESCHEDULED" && row.proposed_start_time && row.start_time) {
            time = `lịch hiện tại ${formatDate(row.start_time)}${row.end_time ? ` đến ${formatDate(row.end_time)}` : ""}; lịch đề xuất ${formatDate(row.proposed_start_time)}${row.proposed_end_time ? ` đến ${formatDate(row.proposed_end_time)}` : ""}`;
        }
        details.push(`thời gian ${time}`);
    }
    if (fields.has("location")) {
        details.push(`địa điểm ${[row.location_name, row.location_address].filter(Boolean).join(" – ") || "chưa có dữ liệu địa điểm"}`);
    }
    if (fields.has("speaker")) {
        if (speakers === null) {
            details.push("báo cáo viên không có quyền xem trường này trong tài khoản hiện tại");
        } else {
            const names = (Array.isArray(speakers) ? speakers : []).map(item => {
                const name = String(item.full_name || "").trim();
                const title = String(item.presentation_title || "").trim();
                return name ? `${name}${title ? ` (${title})` : ""}` : "";
            }).filter(Boolean);
            details.push(`báo cáo viên ${names.length ? names.join("; ") : "chưa có dữ liệu ghi nhận"}`);
        }
    }
    if (fields.has("assignees")) {
        if (assignees === null) {
            details.push("người được phân công không có quyền xem trường này trong tài khoản hiện tại");
        } else {
            const names = (Array.isArray(assignees) ? assignees : []).map(item => String(item.assignee_name || "").trim()).filter(Boolean);
            details.push(`người được phân công ${names.length ? [...new Set(names)].join(", ") : "chưa có dữ liệu ghi nhận"}`);
        }
    }
    if (fields.has("status")) details.push(`trạng thái ${statusLabels[row.status] || row.status || "chưa có dữ liệu trạng thái"}`);
    return details.join("; ") + ".";
}

function formatConferenceStatusList(rows, organizationName, total) {
    const statusLabels = {
        PENDING: "chờ phê duyệt", APPROVED: "đã phê duyệt", COMPLETED: "hoàn thành",
        REJECTED: "bị từ chối", CANCELLED: "đã hủy", RESCHEDULED: "đề xuất dời lịch"
    };
    const items = (rows || []).map(row =>
        `• ${row.code || "Chưa có mã"}: ${statusLabels[row.status] || row.status || "chưa có dữ liệu trạng thái"}${row.title ? ` — ${String(row.title).replace(/\s+/g, " ").slice(0, 100)}` : ""}.`
    );
    const omitted = Math.max(0, Number(total || 0) - items.length);
    return `Trạng thái từng hội nghị của ${organizationName} (${total}):\n${items.length ? items.join("\n") : "Không có hội nghị trong phạm vi dữ liệu được phép xem."}${omitted ? `\nCòn ${omitted} hội nghị chưa hiển thị do giới hạn danh sách.` : ""}`;
}

module.exports = { normalize, requestedConferenceFields, formatConferenceDetails, formatConferenceStatusList };
