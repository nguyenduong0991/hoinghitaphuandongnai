(() => {
    const xmlEscape = value => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    const normalizeSearch = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi-VN").trim();

    window.filterAttendanceRowsByName = (tbody, query) => {
        const term = normalizeSearch(query);
        let visible = 0;
        Array.from(tbody.rows).forEach(row => {
            const name = normalizeSearch(row.dataset.attendeeName || "");
            row.hidden = Boolean(term) && !name.includes(term);
            if (!row.hidden) visible++;
        });
        return visible;
    };

    window.paginateAttendanceRows = (tbody, query, requestedPage = 1, pageSize = 5) => {
        const term = normalizeSearch(query);
        const rows = Array.from(tbody.rows);
        const matches = rows.filter(row => normalizeSearch(row.dataset.attendeeName || "").includes(term));
        const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
        const page = Math.min(Math.max(1, Number(requestedPage) || 1), pageCount);
        const firstIndex = (page - 1) * pageSize;
        const visible = new Set(matches.slice(firstIndex, firstIndex + pageSize));
        rows.forEach(row => { row.hidden = !visible.has(row); });
        return { page, pageCount, total: matches.length, start: matches.length ? firstIndex + 1 : 0, end: Math.min(firstIndex + pageSize, matches.length) };
    };

    window.downloadConferenceAttendanceExcel = (conferenceCode, conferenceTitle, attendees) => {
        const headers = ["Mã hội nghị", "Hội nghị", "Họ và tên", "Địa chỉ", "Email", "Trạng thái điểm danh", "Thời điểm đăng ký", "Thời điểm điểm danh"];
        const rows = [headers, ...attendees.map(person => [
            conferenceCode,
            conferenceTitle,
            person.attendee_name,
            person.attendee_address,
            person.attendee_email || "",
            person.attended_at ? "Đã dự" : "Chưa điểm danh",
            person.created_at ? new Date(person.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "",
            person.attended_at ? new Date(person.attended_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : ""
        ])];
        const xmlRows = rows.map((row, rowIndex) => `<Row>${row.map(value => `<Cell${rowIndex === 0 ? ' ss:StyleID="Header"' : ""}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`).join("")}</Row>`).join("");
        const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>` +
            `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
            `<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style></Styles>` +
            `<Worksheet ss:Name="Danh sach diem danh"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
        const blob = new Blob(["\uFEFF", workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
        const link = document.createElement("a");
        const safeCode = String(conferenceCode || "hoi-nghi").replace(/[^\p{L}\p{N}_-]+/gu, "-");
        link.href = URL.createObjectURL(blob);
        link.download = `Danh-sach-diem-danh-${safeCode}.xls`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
})();
