(() => {
    const list = document.getElementById("publicEventList");
    const status = document.getElementById("publicEventStatus");
    const refresh = document.getElementById("refreshPublicEvents");
    const apiBase = window.TGPL_API_BASE_URL;
    const dialog = document.getElementById("registrationDialog");
    const registrationForm = document.getElementById("publicRegistrationForm");
    const registrationMessage = document.getElementById("registrationMessage");
    const submitRegistration = document.getElementById("submitRegistration");
    const legalAidRequestForm = document.getElementById("publicLegalAidRequestForm");
    const legalAidRequestMessage = document.getElementById("publicLegalAidRequestMessage");
    const submitLegalAidRequestButton = document.getElementById("submitPublicLegalAidRequest");

    const addText = (parent, tag, className, value) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        element.textContent = value || "";
        parent.appendChild(element);
        return element;
    };
    const dateTime = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Thời gian chưa cập nhật" : date.toLocaleString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh", dateStyle: "long", timeStyle: "short"
        });
    };
    const addMeta = (parent, iconName, value) => {
        if (!value) return;
        const row = document.createElement("div");
        row.className = "event-meta d-flex align-items-start gap-2 mb-2";
        const icon = document.createElement("i");
        icon.className = `bi ${iconName}`;
        icon.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = value;
        row.append(icon, text);
        parent.appendChild(row);
    };

    function renderEvents(events) {
        list.replaceChildren();
        if (!events.length) {
            const state = document.createElement("div");
            state.className = "empty-state p-4 p-md-5 text-center col-12";
            const icon = document.createElement("div");
            icon.className = "fs-2 text-secondary mb-2";
            icon.innerHTML = '<i class="bi bi-calendar2-week"></i>';
            state.append(icon);
            addText(state, "h3", "h5", "Chưa có hội nghị công khai sắp diễn ra");
            addText(state, "p", "text-secondary mb-0", "Khi có hội nghị được phê duyệt và công khai, thông tin sẽ xuất hiện tại đây.");
            list.appendChild(state);
            status.textContent = "Danh sách đã được cập nhật.";
            return;
        }
        events.forEach(event => {
            const column = document.createElement("div");
            column.className = "col-12 col-md-6 col-xl-4";
            const card = document.createElement("article");
            card.className = "event-card card";
            const body = document.createElement("div");
            body.className = "card-body p-4 d-flex flex-column";
            const head = document.createElement("div");
            head.className = "d-flex justify-content-between align-items-start gap-3 mb-3";
            const icon = document.createElement("span");
            icon.className = "event-icon flex-shrink-0";
            icon.innerHTML = '<i class="bi bi-megaphone"></i>';
            const badge = addText(head, "span", "badge text-bg-success rounded-pill", "Mời tham dự");
            head.prepend(icon);
            body.appendChild(head);
            if (event.code) addText(body, "div", "small text-secondary mb-1", event.code);
            addText(body, "h3", "h5 fw-bold mb-3", event.title || "Hội nghị trợ giúp pháp lý");
            addMeta(body, "bi-calendar-event", dateTime(event.start_time));
            if (event.end_time) addMeta(body, "bi-clock", `Kết thúc: ${dateTime(event.end_time)}`);
            addMeta(body, "bi-geo-alt", [event.location_name, event.location_address].filter(Boolean).join(" · ") || "Địa điểm đang cập nhật");
            addMeta(body, "bi-building", event.organization_name);
            if (event.description) addText(body, "p", "text-secondary mt-2 mb-0", event.description);
            const register = document.createElement("button");
            register.type = "button";
            register.className = "btn btn-primary rounded-pill mt-4 w-100";
            register.innerHTML = '<i class="bi bi-person-plus me-2" aria-hidden="true"></i>Đăng ký tham dự';
            register.addEventListener("click", () => {
                registrationForm.reset();
                registrationMessage.textContent = "";
                registrationMessage.className = "small mb-3";
                document.getElementById("registrationConferenceId").value = event.id;
                document.getElementById("registrationConference").textContent = `${event.title || "Hội nghị"} · ${dateTime(event.start_time)}`;
                dialog.showModal();
            });
            body.appendChild(register);
            card.appendChild(body);
            column.appendChild(card);
            list.appendChild(column);
        });
        status.textContent = `${events.length} hội nghị công khai sắp diễn ra.`;
    }

    async function submitPublicRegistration(event) {
        event.preventDefault();
        const conferenceId = document.getElementById("registrationConferenceId").value;
        const start = (window.publicConferenceEvents || []).find(item => item.id === conferenceId)?.start_time;
        const payload = {
            conference_id: conferenceId,
            full_name: document.getElementById("attendeeName").value.trim(),
            address: document.getElementById("attendeeAddress").value.trim(),
            email: document.getElementById("attendeeEmail").value.trim(),
            consultation_situation: document.getElementById("attendeeConsultationSituation").value.trim()
        };
        if (!payload.full_name || !payload.address) {
            registrationMessage.textContent = "Vui lòng nhập họ tên và địa chỉ.";
            registrationMessage.className = "small mb-3 text-danger";
            return;
        }
        submitRegistration.disabled = true;
        registrationMessage.textContent = "Đang gửi đăng ký...";
        registrationMessage.className = "small mb-3 text-secondary";
        try {
            const response = await fetch(`${apiBase}/public/attendance-registrations`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.message || `Máy chủ phản hồi lỗi HTTP ${response.status}.`);
            registrationMessage.textContent = "Đã ghi nhận đăng ký tham dự của bạn.";
            registrationMessage.className = "small mb-3 text-success fw-semibold";
            status.textContent = "Đăng ký tham dự đã được ghi nhận.";
            window.setTimeout(() => dialog.close(), 1200);
        } catch (error) {
            registrationMessage.textContent = error.message || "Chưa gửi được đăng ký. Vui lòng thử lại.";
            registrationMessage.className = "small mb-3 text-danger";
        } finally { submitRegistration.disabled = false; }
    }

    async function submitPublicLegalAidRequest(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const payload = {
            requester_name: document.getElementById("publicRequesterName").value.trim(),
            phone: document.getElementById("publicRequesterPhone").value.trim(),
            question: document.getElementById("publicRequesterQuestion").value.trim(),
            website: document.getElementById("publicContactWebsite").value.trim()
        };
        if (!payload.requester_name || !payload.phone || payload.question.length < 10) {
            legalAidRequestMessage.textContent = "Vui lòng nhập họ tên, số điện thoại và nội dung cần hỗ trợ (ít nhất 10 ký tự).";
            legalAidRequestMessage.className = "small text-danger";
            return;
        }
        submitLegalAidRequestButton.disabled = true;
        legalAidRequestMessage.textContent = "Đang gửi yêu cầu…";
        legalAidRequestMessage.className = "small text-secondary";
        try {
            if (!apiBase) throw new Error("Chưa kết nối được máy chủ. Vui lòng thử lại sau.");
            const response = await fetch(`${apiBase}/public/legal-aid-requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.message || `Máy chủ phản hồi lỗi HTTP ${response.status}.`);
            form.reset();
            legalAidRequestMessage.textContent = "Đã gửi yêu cầu. Quản trị viên sẽ tiếp nhận và phân công cán bộ liên hệ với bạn.";
            legalAidRequestMessage.className = "small text-success fw-semibold";
        } catch (error) {
            legalAidRequestMessage.textContent = error.message || "Chưa gửi được yêu cầu. Vui lòng thử lại.";
            legalAidRequestMessage.className = "small text-danger";
        } finally {
            submitLegalAidRequestButton.disabled = false;
        }
    }

    async function loadEvents() {
        refresh.disabled = true;
        status.textContent = "Đang tải lịch hội nghị...";
        try {
            if (!apiBase) throw new Error("Chưa cấu hình kết nối đến máy chủ dữ liệu.");
            const response = await fetch(`${apiBase}/public/conferences`, { headers: { Accept: "application/json" }, cache: "no-store" });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.message || `Máy chủ phản hồi lỗi HTTP ${response.status}.`);
            window.publicConferenceEvents = Array.isArray(result?.data) ? result.data : [];
            renderEvents(window.publicConferenceEvents);
        } catch (error) {
            list.replaceChildren();
            status.textContent = error.message || "Chưa tải được hội nghị công khai. Vui lòng thử lại.";
        } finally { refresh.disabled = false; }
    }
    refresh.addEventListener("click", loadEvents);
    registrationForm.addEventListener("submit", submitPublicRegistration);
    legalAidRequestForm?.addEventListener("submit", submitPublicLegalAidRequest);
    ["closeRegistration", "cancelRegistration"].forEach(id => document.getElementById(id).addEventListener("click", () => dialog.close()));
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    loadEvents();
})();
