(function () {
    const wrap = document.getElementById("adminNotificationWrap");
    const button = document.getElementById("adminNotificationButton");
    const panel = document.getElementById("adminNotificationPanel");
    const badge = document.getElementById("adminNotificationBadge");
    const list = document.getElementById("adminNotificationList");
    if (!wrap || !button || !panel || !badge || !list) return;
    const readKey = "tgpl.admin-reschedule-responses.read.v1";

    function readResponseIds() {
        try {
            const value = JSON.parse(localStorage.getItem(readKey) || "[]");
            return new Set(Array.isArray(value) ? value : []);
        } catch { return new Set(); }
    }

    function markResponseRead(responseId) {
        if (!responseId) return;
        const read = readResponseIds();
        read.add(responseId);
        localStorage.setItem(readKey, JSON.stringify([...read].slice(-300)));
    }

    const dateTime = value => value
        ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
        : "";

    function addNotification(container, title, detail, href, date, responseId = null) {
        const link = document.createElement("a");
        link.className = "list-group-item list-group-item-action";
        link.href = href;
        const heading = document.createElement("div");
        heading.className = "fw-semibold";
        heading.textContent = title;
        const description = document.createElement("div");
        description.className = "small text-muted";
        description.textContent = detail;
        link.append(heading, description);
        if (date) {
            const time = document.createElement("div");
            time.className = "small text-secondary mt-1";
            time.textContent = dateTime(date);
            link.appendChild(time);
        }
        link.addEventListener("click", () => {
            markResponseRead(responseId);
            panel.hidden = true;
            button.setAttribute("aria-expanded", "false");
        });
        container.appendChild(link);
    }

    async function refreshNotifications() {
        list.replaceChildren();
        const loading = document.createElement("div");
        loading.className = "list-group-item text-muted";
        loading.textContent = "Đang cập nhật yêu cầu...";
        list.appendChild(loading);
        try {
            const [conferenceResult, requestResult] = await Promise.all([
                getConferences(),
                getStaffChangeRequests()
            ]);
            const allConferences = conferenceResult.data || [];
            const readResponses = readResponseIds();
            const conferences = allConferences.filter(item => item.status === "PENDING" || item.status === "RESCHEDULED");
            const acceptedResponses = allConferences.filter(item => item.reschedule_response === "ACCEPTED" && item.reschedule_responded_at)
                .map(item => ({ ...item, responseId: `${item.id}:${item.reschedule_responded_at}` }))
                .filter(item => !readResponses.has(item.responseId));
            const changeRequests = (requestResult.data || []).filter(item => item.status === "PENDING");
            const notifications = [
                ...conferences.map(item => ({
                    kind: item.status === "RESCHEDULED" ? (item.reschedule_response === "DECLINED" ? "reschedule-declined" : "reschedule") : "conference",
                    data: item,
                    date: item.reschedule_response === "DECLINED" ? item.reschedule_responded_at : item.created_at
                })),
                ...acceptedResponses.map(item => ({ kind: "reschedule-accepted", data: item, date: item.reschedule_responded_at })),
                ...changeRequests.map(item => ({ kind: "staff", data: item, date: item.created_at }))
            ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            badge.textContent = String(notifications.length);
            badge.hidden = notifications.length === 0;
            list.replaceChildren();
            if (!notifications.length) {
                const empty = document.createElement("div");
                empty.className = "list-group-item text-muted";
                empty.textContent = "Không có yêu cầu đang chờ xử lý.";
                list.appendChild(empty);
                return;
            }
            notifications.forEach(item => {
                const data = item.data;
                if (item.kind === "staff") {
                    const category = data.request_type === "TASK" ? "người nhận nhiệm vụ" : "báo cáo viên";
                    addNotification(list, "Đề nghị đổi cán bộ", `${data.requester_name} (${category}) · ${data.conference_title || "Hội nghị"} · ${data.assignment_title || "Phân công"}`, "assignment-reports.html#staff-change-requests", item.date);
                } else {
                    let title = "Yêu cầu tổ chức hội nghị mới";
                    let detail = `${data.organization_name || "Đơn vị chưa rõ"} · ${data.title || "Chưa có chủ đề"}`;
                    let responseId = null;
                    if (item.kind === "reschedule") title = "Đơn vị cần phản hồi đề xuất dời lịch";
                    if (item.kind === "reschedule-declined") {
                        title = "Đơn vị từ chối lịch dời — cần đề xuất lại";
                        detail += ` · Lịch đề xuất: ${dateTime(data.proposed_start_time)}${data.location_name ? ` · ${data.location_name}` : ""}`;
                    }
                    if (item.kind === "reschedule-accepted") {
                        title = "Đơn vị đã chấp thuận dời lịch";
                        detail += ` · Lịch mới: ${dateTime(data.start_time)}${data.location_name ? ` · ${data.location_name}` : ""}`;
                        responseId = data.responseId;
                    }
                    addNotification(list, title, detail, `conference-list.html?id=${encodeURIComponent(data.id)}`, item.date, responseId);
                }
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
        const isAdmin = user?.role === "ADMIN";
        wrap.hidden = !isAdmin;
        wrap.style.display = isAdmin ? "" : "none";
        if (isAdmin) refreshNotifications();
    }

    button.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", String(!panel.hidden));
        if (!panel.hidden) refreshNotifications();
    });
    document.getElementById("refreshAdminNotifications").addEventListener("click", refreshNotifications);
    document.addEventListener("click", event => {
        if (!wrap.contains(event.target)) {
            panel.hidden = true;
            button.setAttribute("aria-expanded", "false");
        }
    });
    window.addEventListener("tgpl:authenticated", event => enableForUser(event.detail?.user));
    window.setInterval(() => {
        if (!wrap.hidden && window.tgplCurrentUser?.role === "ADMIN") refreshNotifications();
    }, 60 * 1000);
})();
