(function () {
    const list = document.getElementById("legalAidRequestList");
    const message = document.getElementById("legalAidRequestMessage");
    const refresh = document.getElementById("refreshLegalAidRequests");
    if (!list || !message || !refresh) return;

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

        const form = document.createElement("form");
        form.className = "row g-3 align-items-end";
        const staffCol = document.createElement("div"); staffCol.className = "col-md-4";
        const staffLabel = document.createElement("label"); staffLabel.className = "form-label"; staffLabel.textContent = "Cán bộ được phân công liên hệ";
        const staffInput = document.createElement("input"); staffInput.className = "form-control"; staffInput.maxLength = 160; staffInput.required = ["ASSIGNED", "CONTACTED", "CLOSED"].includes(item.status); staffInput.placeholder = "Nhập họ tên cán bộ"; staffInput.value = item.assigned_staff_name || "";
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
            const assigned_staff_name = staffInput.value.trim();
            if (["ASSIGNED", "CONTACTED", "CLOSED"].includes(status) && !assigned_staff_name) {
                staffInput.focus(); showMessage("Nhập tên cán bộ được giao trước khi lưu tiến độ này.", "warning"); return;
            }
            save.disabled = true;
            try {
                await updateLegalAidContactRequest(item.id, { status, assigned_staff_name, assignment_note: noteInput.value.trim() });
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
            const result = await getLegalAidContactRequests();
            const requests = result.data || [];
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
    function guardAdmin(user) {
        if (user?.role !== "ADMIN") { location.replace("dashboard.html"); return; }
        loadRequests();
    }
    window.addEventListener("tgpl:authenticated", event => guardAdmin(event.detail?.user));
    if (window.tgplCurrentUser) guardAdmin(window.tgplCurrentUser);
})();
