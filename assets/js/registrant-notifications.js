(function () {
    const wrap = document.getElementById("registrantNotificationWrap");
    const button = document.getElementById("registrantNotificationButton");
    const panel = document.getElementById("registrantNotificationPanel");
    const badge = document.getElementById("registrantNotificationBadge");
    const list = document.getElementById("registrantNotificationList");
    const refreshButton = document.getElementById("refreshRegistrantNotifications");
    if (!wrap || !button || !panel || !badge || !list || !refreshButton) return;

    const statusLabels = {
        PENDING: "Đang chờ phê duyệt",
        APPROVED: "Đã phê duyệt",
        COMPLETED: "Đã hoàn thành",
        REJECTED: "Bị từ chối",
        CANCELLED: "Đã hủy",
        RESCHEDULED: "Đề nghị dời lịch"
    };
    const rescheduleResponseLabels = { PENDING: "Chờ đơn vị phản hồi", ACCEPTED: "Đơn vị đã chấp thuận dời lịch", DECLINED: "Đơn vị đã từ chối dời lịch" };
    const dateTime = value => value
        ? new Date(value).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })
        : "Chưa xác định";

    function addLine(parent, label, value) {
        const line = document.createElement("div");
        line.className = "small mt-1";
        const strong = document.createElement("strong");
        strong.textContent = `${label}: `;
        line.append(strong, document.createTextNode(value));
        parent.appendChild(line);
    }

    async function refreshNotifications() {
        list.replaceChildren();
        const loading = document.createElement("div");
        loading.className = "list-group-item text-muted";
        loading.textContent = "Đang cập nhật trạng thái hội nghị...";
        list.appendChild(loading);
        try {
            const result = await getMyConferenceNotifications();
            const conferences = result.data || [];
            badge.textContent = String(conferences.length);
            badge.hidden = conferences.length === 0;
            list.replaceChildren();
            if (!conferences.length) {
                const empty = document.createElement("div");
                empty.className = "list-group-item text-muted";
                empty.textContent = "Đơn vị chưa có yêu cầu đăng ký hội nghị.";
                list.appendChild(empty);
                return;
            }

            conferences.forEach(conference => {
                const item = document.createElement("div");
                item.className = "list-group-item py-3";
                const title = document.createElement("a");
                title.className = "fw-semibold text-decoration-none";
                title.href = `conference-list.html?id=${encodeURIComponent(conference.id)}`;
                title.textContent = `${conference.code ? `${conference.code} · ` : ""}${conference.title || "Hội nghị chưa có tiêu đề"}`;
                const details = document.createElement("div");
                details.className = "mt-2";
                addLine(details, "Trạng thái đăng ký", statusLabels[conference.status] || conference.status || "Chưa xác định");
                addLine(details, "Người nhận nhiệm vụ", conference.task_assignees || "Chưa được phân công");
                addLine(details, "Báo cáo viên", conference.speakers || "Chưa được phân công");
                if (conference.status === "RESCHEDULED") {
                    addLine(details, "Ngày/buổi đề xuất", `${dateTime(conference.proposed_start_time)}${conference.proposed_end_time ? ` – ${dateTime(conference.proposed_end_time)}` : ""}`);
                    if (conference.reschedule_note) addLine(details, "Lý do/ghi chú", conference.reschedule_note);
                }
                if (conference.reschedule_response) {
                    addLine(details, "Phản hồi dời lịch", rescheduleResponseLabels[conference.reschedule_response] || conference.reschedule_response);
                    if (conference.reschedule_response === "ACCEPTED") addLine(details, "Lịch hội nghị hiện tại", `${dateTime(conference.start_time)}${conference.end_time ? ` – ${dateTime(conference.end_time)}` : ""}`);
                }
                const attachments = Array.isArray(conference.attachments) ? conference.attachments : [];
                addLine(details, "Tài liệu hội nghị", attachments.length
                    ? `${attachments.length} tệp: ${attachments.map(file => file.name).filter(Boolean).join(", ")}`
                    : "Chưa có tài liệu đính kèm");
                const updated = document.createElement("div");
                updated.className = "small text-secondary mt-2";
                updated.textContent = `Cập nhật: ${dateTime(conference.updated_at || conference.created_at)}`;
                item.append(title, details, updated);
                if (conference.status === "RESCHEDULED" && (!conference.reschedule_response || conference.reschedule_response === "PENDING")) {
                    const actions = document.createElement("div");
                    actions.className = "d-flex flex-wrap gap-2 mt-3";
                    const accept = document.createElement("button");
                    accept.type = "button"; accept.className = "btn btn-sm btn-success"; accept.textContent = "Chấp thuận dời";
                    const decline = document.createElement("button");
                    decline.type = "button"; decline.className = "btn btn-sm btn-outline-danger"; decline.textContent = "Từ chối dời lịch";
                    const decide = async response => {
                        const promptText = response === "ACCEPTED" ? "Xác nhận chấp thuận thời gian dời lịch được đề xuất?" : "Xác nhận từ chối thời gian dời lịch được đề xuất?";
                        if (!window.confirm(promptText)) return;
                        accept.disabled = true; decline.disabled = true;
                        try { await respondToConferenceReschedule(conference.id, response); await refreshNotifications(); }
                        catch (error) { window.alert(error.message || "Không lưu được phản hồi dời lịch."); accept.disabled = false; decline.disabled = false; }
                    };
                    accept.addEventListener("click", () => decide("ACCEPTED"));
                    decline.addEventListener("click", () => decide("DECLINED"));
                    actions.append(accept, decline); item.appendChild(actions);
                }
                item.addEventListener("click", () => {
                    panel.hidden = true;
                    button.setAttribute("aria-expanded", "false");
                });
                list.appendChild(item);
            });
        } catch (error) {
            badge.hidden = true;
            list.replaceChildren();
            const failure = document.createElement("div");
            failure.className = "list-group-item text-danger";
            failure.textContent = error.message || "Không tải được thông báo.";
            list.appendChild(failure);
        }
    }

    function enableForUser(user) {
        const isRegistrant = user?.role === "COMMUNE";
        wrap.hidden = !isRegistrant;
        wrap.style.display = isRegistrant ? "" : "none";
        if (isRegistrant) refreshNotifications();
    }

    button.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", String(!panel.hidden));
        if (!panel.hidden) refreshNotifications();
    });
    refreshButton.addEventListener("click", event => { event.stopPropagation(); refreshNotifications(); });
    document.addEventListener("click", event => {
        if (!wrap.contains(event.target)) {
            panel.hidden = true;
            button.setAttribute("aria-expanded", "false");
        }
    });
    window.addEventListener("tgpl:authenticated", event => enableForUser(event.detail?.user));
    window.setInterval(() => {
        if (!wrap.hidden && window.tgplCurrentUser?.role === "COMMUNE") refreshNotifications();
    }, 60 * 1000);
})();
