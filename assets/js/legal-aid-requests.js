(function () {
    const list = document.getElementById("legalAidRequestList");
    const message = document.getElementById("legalAidRequestMessage");
    const refresh = document.getElementById("refreshLegalAidRequests");
    const exportButton = document.getElementById("exportLegalAidRequests");
    if (!list || !message || !refresh || !exportButton) return;
    let staffAccounts = [];
    let currentRequests = [];

    const statusLabels = {
        PENDING: "Chưa phân công",
        ASSIGNED: "Đã phân công liên hệ",
        CONTACTED: "Đã liên hệ người yêu cầu",
        CLOSED: "Đã hoàn tất"
    };
    const dateTime = value => value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

    function showMessage(text, kind = "success") {
        message.replaceChildren();
        const alert = document.createElement("div");
        alert.className = `alert alert-${kind}`;
        alert.textContent = text;
        message.appendChild(alert);
    }

    function addText(parent, className, value) {
        const element = document.createElement("div");
        if (className) element.className = className;
        element.textContent = value || "—";
        parent.appendChild(element);
        return element;
    }

    function xmlEscape(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    }

    function exportRequestsToExcel(requests) {
        const headers = ["Ngày nhận", "Họ và tên", "Số điện thoại", "Nội dung yêu cầu tư vấn", "Ý kiến của người tư vấn"];
        const rows = [headers, ...requests.map(item => {
            const opinions = (Array.isArray(item.feedback) ? item.feedback : []).map(entry => {
                const author = entry.author_name || "Cán bộ tư vấn";
                const review = { PENDING: "chờ duyệt", APPROVED: "đã duyệt", REJECTED: "không dùng cho chatbot" }[entry.training_status] || "";
                return `${author} · ${dateTime(entry.created_at)}${review ? ` · ${review}` : ""}: ${entry.content || ""}`;
            }).filter(Boolean).join("\n\n") || "Chưa có ý kiến";
            return [dateTime(item.created_at), item.requester_name, item.phone, item.question, opinions];
        })];
        const xmlRows = rows.map((row, index) => `<Row>${row.map(value => `<Cell${index === 0 ? ' ss:StyleID="Header"' : ""}><Data ss:Type="String" xml:space="preserve">${xmlEscape(value)}</Data></Cell>`).join("")}</Row>`).join("");
        const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>` +
            `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:xml="http://www.w3.org/XML/1998/namespace">` +
            `<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style></Styles>` +
            `<Worksheet ss:Name="Yeu cau tu van"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
        const blob = new Blob(["\uFEFF", workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Tong-hop-yeu-cau-tu-van-${new Date().toISOString().slice(0, 10)}.xls`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    async function exportAllRequests() {
        exportButton.disabled = true;
        exportButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Đang tổng hợp…';
        try {
            const pageSize = 500;
            let offset = 0;
            const allRequests = [];
            while (true) {
                const result = await getLegalAidContactRequests({ limit: pageSize, offset });
                const page = Array.isArray(result.data) ? result.data : [];
                allRequests.push(...page);
                if (page.length < pageSize) break;
                offset += page.length;
            }
            if (!allRequests.length) throw new Error("Chưa có yêu cầu tư vấn để xuất.");
            exportRequestsToExcel(allRequests);
            showMessage(`Đã xuất ${allRequests.length} yêu cầu tư vấn và ý kiến cán bộ kèm theo.`);
        } catch (error) {
            showMessage(error.message || "Không xuất được danh sách yêu cầu tư vấn.", "danger");
        } finally {
            exportButton.disabled = !currentRequests.length;
            exportButton.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Xuất Excel';
        }
    }

    function renderRequest(item) {
        const card = document.createElement("article");
        card.className = "card shadow-sm";
        card.id = String(item.id);
        const body = document.createElement("div");
        body.className = "card-body";

        const header = document.createElement("div");
        header.className = "d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3";
        const titleBlock = document.createElement("div");
        const title = document.createElement("h2");
        title.className = "h5 mb-1";
        title.textContent = item.requester_name || item.username || "Người yêu cầu";
        titleBlock.appendChild(title);
        addText(titleBlock, "small text-muted", [item.organization_name, item.user_role, item.username ? `Tài khoản: ${item.username}` : ""].filter(Boolean).join(" · "));
        const badge = document.createElement("span");
        badge.className = `badge ${item.status === "PENDING" ? "text-bg-warning" : item.status === "CLOSED" ? "text-bg-success" : "text-bg-primary"}`;
        badge.textContent = statusLabels[item.status] || item.status || "Chưa rõ";
        header.append(titleBlock, badge);
        body.appendChild(header);

        const contact = document.createElement("div");
        contact.className = "row g-2 small mb-3";
        [["Email", item.email], ["Điện thoại", item.phone], ["Gửi lúc", dateTime(item.created_at)], ["Cập nhật", dateTime(item.updated_at || item.created_at)]].forEach(([label, value]) => {
            const col = document.createElement("div"); col.className = "col-sm-6 col-lg-3";
            const strong = document.createElement("strong"); strong.textContent = `${label}: `;
            col.append(strong, document.createTextNode(value || "—")); contact.appendChild(col);
        });
        body.appendChild(contact);
        const question = document.createElement("div");
        question.className = "p-3 bg-light rounded mb-3";
        const questionLabel = document.createElement("strong"); questionLabel.textContent = "Nội dung cần tư vấn";
        const questionText = document.createElement("div"); questionText.className = "mt-1 text-break"; questionText.style.whiteSpace = "pre-wrap"; questionText.textContent = item.question || "Không có nội dung";
        question.append(questionLabel, questionText); body.appendChild(question);

        const feedbackSection = document.createElement("section"); feedbackSection.className = "border rounded p-3 mb-3";
        const feedbackHeading = document.createElement("h3"); feedbackHeading.className = "h6 mb-2"; feedbackHeading.textContent = "Ý kiến cán bộ · dữ liệu cải thiện chatbot"; feedbackSection.appendChild(feedbackHeading);
        const feedbackLabels = { PENDING: "Chờ admin duyệt", APPROVED: "Đã duyệt · chatbot dùng bản tóm tắt ẩn danh", REJECTED: "Không đưa vào chatbot" };
        const feedbackItems = Array.isArray(item.feedback) ? item.feedback : [];
        if (!feedbackItems.length) addText(feedbackSection, "small text-muted", "Chưa có ý kiến từ cán bộ được phân công.");
        feedbackItems.forEach(entry => {
            const note = document.createElement("div"); note.className = "border-top pt-2 mt-2";
            addText(note, "small fw-semibold", `${entry.author_name || "Cán bộ"} · ${dateTime(entry.created_at)} · ${feedbackLabels[entry.training_status] || entry.training_status}`);
            addText(note, "small mt-1", entry.content);
            if (entry.training_status === "APPROVED" && entry.training_text) addText(note, "small bg-light rounded p-2 mt-2", `Bản đã duyệt cho chatbot: ${entry.training_text}`);
            if (entry.admin_note) addText(note, "small text-muted mt-1", `Ghi chú admin: ${entry.admin_note}`);
            if (entry.training_status === "PENDING") {
                const reviewForm = document.createElement("form"); reviewForm.className = "mt-2";
                const summaryLabel = document.createElement("label"); summaryLabel.className = "form-label small fw-semibold"; summaryLabel.textContent = "Tóm tắt nghiệp vụ đã ẩn danh (chỉ bản này được đưa vào chatbot)";
                const summary = document.createElement("textarea"); summary.className = "form-control form-control-sm"; summary.rows = 3; summary.minLength = 20; summary.maxLength = 2500; summary.placeholder = "Viết lại bài học ở dạng khái quát; xóa tên, địa chỉ, email, số điện thoại và chi tiết nhận dạng.";
                const adminNote = document.createElement("input"); adminNote.className = "form-control form-control-sm mt-2"; adminNote.maxLength = 1000; adminNote.placeholder = "Ghi chú phản hồi cho cán bộ (nếu có)";
                const actions = document.createElement("div"); actions.className = "d-flex flex-wrap gap-2 mt-2";
                const approve = document.createElement("button"); approve.type = "button"; approve.className = "btn btn-sm btn-success"; approve.textContent = "Duyệt bản tóm tắt";
                const reject = document.createElement("button"); reject.type = "button"; reject.className = "btn btn-sm btn-outline-secondary"; reject.textContent = "Không dùng cho chatbot";
                const reviewStatus = document.createElement("span"); reviewStatus.className = "small align-self-center"; reviewStatus.setAttribute("role", "status");
                const saveReview = async (training_status, training_text = "") => {
                    approve.disabled = true; reject.disabled = true; reviewStatus.className = "small text-muted align-self-center"; reviewStatus.textContent = "Đang lưu…";
                    try {
                        await reviewLegalAidTaskFeedback(entry.id, { training_status, training_text, admin_note: adminNote.value.trim() });
                        await loadRequests(false); document.getElementById(String(item.id))?.scrollIntoView({ behavior: "smooth", block: "center" });
                    } catch (error) {
                        reviewStatus.className = "small text-danger align-self-center"; reviewStatus.textContent = error.message || "Không lưu được quyết định."; approve.disabled = false; reject.disabled = false;
                    }
                };
                approve.addEventListener("click", () => {
                    if (summary.value.trim().length < 20) { summary.focus(); reviewStatus.className = "small text-danger align-self-center"; reviewStatus.textContent = "Bản tóm tắt cần ít nhất 20 ký tự."; return; }
                    saveReview("APPROVED", summary.value.trim());
                });
                reject.addEventListener("click", () => saveReview("REJECTED"));
                actions.append(approve, reject, reviewStatus); reviewForm.append(summaryLabel, summary, adminNote, actions); note.appendChild(reviewForm);
            }
            feedbackSection.appendChild(note);
        });
        body.appendChild(feedbackSection);

        const form = document.createElement("form");
        form.className = "row g-3 align-items-end";
        const staffCol = document.createElement("div"); staffCol.className = "col-md-4";
        const staffLabel = document.createElement("label"); staffLabel.className = "form-label"; staffLabel.textContent = "Cán bộ được phân công liên hệ";
        const staffInput = document.createElement("select"); staffInput.className = "form-select"; staffInput.required = ["ASSIGNED", "CONTACTED", "CLOSED"].includes(item.status);
        const noStaff = document.createElement("option"); noStaff.value = ""; noStaff.textContent = "Chọn tài khoản cán bộ"; staffInput.appendChild(noStaff);
        staffAccounts.forEach(account => {
            const option = document.createElement("option"); option.value = String(account.id);
            option.textContent = `${account.full_name || account.username} · ${account.username}`;
            staffInput.appendChild(option);
        });
        const legacyMatch = staffAccounts.find(account => String(account.full_name || "").trim().toLocaleLowerCase("vi") === String(item.assigned_staff_name || "").trim().toLocaleLowerCase("vi"));
        staffInput.value = String(item.assigned_staff_user_id || legacyMatch?.id || "");
        staffCol.append(staffLabel, staffInput);
        const statusCol = document.createElement("div"); statusCol.className = "col-md-3";
        const statusLabel = document.createElement("label"); statusLabel.className = "form-label"; statusLabel.textContent = "Tiến độ xử lý";
        const statusSelect = document.createElement("select"); statusSelect.className = "form-select";
        Object.entries(statusLabels).forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; statusSelect.appendChild(option); });
        statusSelect.value = statusLabels[item.status] ? item.status : "PENDING";
        statusCol.append(statusLabel, statusSelect);
        const noteCol = document.createElement("div"); noteCol.className = "col-md-5";
        const noteLabel = document.createElement("label"); noteLabel.className = "form-label"; noteLabel.textContent = "Ghi chú tiến độ / kết quả liên hệ";
        const noteInput = document.createElement("textarea"); noteInput.className = "form-control"; noteInput.rows = 2; noteInput.maxLength = 2000; noteInput.placeholder = "Nhập lịch hẹn, kết quả liên hệ hoặc nội dung cần theo dõi"; noteInput.value = item.assignment_note || "";
        noteCol.append(noteLabel, noteInput);
        const actions = document.createElement("div"); actions.className = "col-12 d-flex flex-wrap justify-content-between align-items-center gap-2";
        const assignmentMeta = document.createElement("span"); assignmentMeta.className = "small text-muted";
        assignmentMeta.textContent = item.assigned_at ? `Phân công lúc ${dateTime(item.assigned_at)}${item.assigned_by_name ? ` · bởi ${item.assigned_by_name}` : ""}` : "Chưa lưu thông tin phân công.";
        const save = document.createElement("button"); save.type = "submit"; save.className = "btn btn-primary"; save.innerHTML = '<i class="bi bi-save me-1" aria-hidden="true"></i>Lưu cập nhật';
        actions.append(assignmentMeta, save);
        form.append(staffCol, statusCol, noteCol, actions);
        statusSelect.addEventListener("change", () => { staffInput.required = ["ASSIGNED", "CONTACTED", "CLOSED"].includes(statusSelect.value); });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            const status = statusSelect.value;
            const assignedAccount = staffAccounts.find(account => String(account.id) === staffInput.value);
            if (["ASSIGNED", "CONTACTED", "CLOSED"].includes(status) && !assignedAccount) {
                staffInput.focus(); showMessage("Chọn đúng tài khoản cán bộ được giao trước khi lưu tiến độ này.", "warning"); return;
            }
            const assigned_staff_name = assignedAccount?.full_name || "";
            save.disabled = true;
            try {
                await updateLegalAidContactRequest(item.id, { status, assigned_staff_name, assigned_staff_user_id: assignedAccount?.id || null, assignment_note: noteInput.value.trim() });
                showMessage("Đã lưu phân công và tiến độ vào hệ thống.");
                await loadRequests(false);
                document.getElementById(String(item.id))?.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch (error) {
                save.disabled = false;
                showMessage(error.message || "Không lưu được cập nhật. Hãy thử lại.", "danger");
            }
        });
        body.appendChild(form);
        card.appendChild(body);
        return card;
    }

    async function loadRequests(clearMessage = true) {
        refresh.disabled = true;
        list.replaceChildren();
        const loading = document.createElement("div"); loading.className = "card";
        const loadingBody = document.createElement("div"); loadingBody.className = "card-body text-muted"; loadingBody.textContent = "Đang tải yêu cầu…"; loading.appendChild(loadingBody); list.appendChild(loading);
        if (clearMessage) message.replaceChildren();
        try {
            const [result, usersResult] = await Promise.all([getLegalAidContactRequests(), getUsers()]);
            staffAccounts = (usersResult.data || []).filter(account => account.is_active && ["TASK_ASSIGNEE", "SPEAKER"].includes(account.role));
            const requests = result.data || [];
            currentRequests = requests;
            exportButton.disabled = !requests.length;
            list.replaceChildren();
            if (!requests.length) {
                const empty = document.createElement("div"); empty.className = "alert alert-secondary"; empty.textContent = "Chưa có yêu cầu tư vấn nào được ghi nhận."; list.appendChild(empty); return;
            }
            requests.forEach(item => list.appendChild(renderRequest(item)));
            const targetId = decodeURIComponent(location.hash.slice(1));
            if (targetId) requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" }));
        } catch (error) {
            list.replaceChildren();
            const failed = document.createElement("div"); failed.className = "alert alert-danger"; failed.textContent = error.message || "Không tải được yêu cầu tư vấn."; list.appendChild(failed);
        } finally { refresh.disabled = false; }
    }

    refresh.addEventListener("click", () => loadRequests());
    exportButton.addEventListener("click", exportAllRequests);
    function guardAdmin(user) {
        if (user?.role !== "ADMIN") { location.replace("dashboard.html"); return; }
        loadRequests();
    }
    window.addEventListener("tgpl:authenticated", event => guardAdmin(event.detail?.user));
    if (window.tgplCurrentUser) guardAdmin(window.tgplCurrentUser);
})();
