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
            const [conferenceResult, requestResult, aiFeedbackResult, legalAidRequestResult] = await Promise.all([
                getConferences(),
                getStaffChangeRequests(),
                getAiAnswerFeedback(),
                getLegalAidContactRequests()
            ]);
            const allConferences = conferenceResult.data || [];
            const readResponses = readResponseIds();
            const conferences = allConferences.filter(item => item.status === "PENDING" || item.status === "RESCHEDULED");
            const acceptedResponses = allConferences.filter(item => item.reschedule_response === "ACCEPTED" && item.reschedule_responded_at)
                .map(item => ({ ...item, responseId: `${item.id}:${item.reschedule_responded_at}` }))
                .filter(item => !readResponses.has(item.responseId));
            const changeRequests = (requestResult.data || []).filter(item => item.status === "PENDING");
            const wrongAiAnswers = (aiFeedbackResult.data || []).filter(item => item.vote === "INCORRECT" && item.status !== "RESOLVED");
            const legalAidContactRequests = legalAidRequestResult.data || [];
            const pendingLegalAidContactRequests = legalAidContactRequests.filter(item => item.status === "PENDING");
            const activeLegalAidContactRequests = legalAidContactRequests.filter(item => ["PENDING", "ASSIGNED"].includes(item.status));
            const notifications = [
                ...conferences.map(item => ({
                    kind: item.status === "RESCHEDULED" ? (item.reschedule_response === "DECLINED" ? "reschedule-declined" : "reschedule") : "conference",
                    data: item,
                    date: item.reschedule_response === "DECLINED" ? item.reschedule_responded_at : item.created_at
                })),
                ...acceptedResponses.map(item => ({ kind: "reschedule-accepted", data: item, date: item.reschedule_responded_at })),
                ...changeRequests.map(item => ({ kind: "staff", data: item, date: item.created_at }))
            ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            badge.textContent = String(notifications.length + wrongAiAnswers.length + pendingLegalAidContactRequests.length);
            badge.hidden = notifications.length + wrongAiAnswers.length + pendingLegalAidContactRequests.length === 0;
            list.replaceChildren();
            if (!notifications.length && !wrongAiAnswers.length && !activeLegalAidContactRequests.length) {
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
            if (activeLegalAidContactRequests.length) {
                const heading = document.createElement("div");
                heading.className = "list-group-item fw-semibold text-primary";
                heading.textContent = `Yêu cầu tư vấn TGPL (${pendingLegalAidContactRequests.length} mới · ${activeLegalAidContactRequests.length} đang xử lý)`;
                list.appendChild(heading);
                activeLegalAidContactRequests.forEach(item => {
                    const row = document.createElement("div");
                    row.className = "list-group-item";
                    const title = document.createElement("div");
                    title.className = "fw-semibold";
                    title.textContent = item.requester_name || item.username || "Tài khoản người dùng";
                    const detail = document.createElement("div");
                    detail.className = "small text-muted mt-1";
                    detail.textContent = [item.organization_name, item.email, item.phone, `Vai trò: ${item.user_role}`].filter(Boolean).join(" · ");
                    const question = document.createElement("div");
                    question.className = "small mt-1";
                    question.textContent = `Nội dung: ${item.question}`;
                    const time = document.createElement("div");
                    time.className = "small text-secondary mt-1";
                    time.textContent = dateTime(item.created_at);
                    const status = document.createElement("div");
                    status.className = "small mt-1";
                    status.textContent = ({ PENDING: "Chưa phân công", ASSIGNED: `Đã phân công: ${item.assigned_staff_name || "chưa rõ cán bộ"}`, CONTACTED: `Đã liên hệ: ${item.assigned_staff_name || "chưa rõ cán bộ"}`, CLOSED: "Đã đóng yêu cầu" })[item.status] || item.status;
                    const open = document.createElement("a");
                    open.className = "btn btn-sm btn-outline-primary mt-2";
                    open.href = `legal-aid-requests.html#${encodeURIComponent(item.id)}`;
                    open.textContent = item.status === "PENDING" ? "Mở để phân công" : "Mở theo dõi yêu cầu";
                    row.append(title, detail, question, time, status, open);
                    list.appendChild(row);
                });
            }
            if (wrongAiAnswers.length) {
                const heading = document.createElement("div");
                heading.className = "list-group-item fw-semibold text-danger";
                heading.textContent = `Chatbot có ${wrongAiAnswers.length} câu trả lời bị đánh dấu sai`;
                list.appendChild(heading);
                wrongAiAnswers.forEach(item => {
                    const row = document.createElement("div");
                    row.className = "list-group-item";
                    const question = document.createElement("div"); question.className = "fw-semibold"; question.textContent = item.question;
                    const answer = document.createElement("div"); answer.className = "small text-muted mt-1"; answer.textContent = item.answer;
                    const feedbackReasonLabels = { WRONG_DATA: "Sai dữ liệu", WRONG_SCOPE: "Sai phạm vi", IRRELEVANT: "Lạc đề", INCOMPLETE: "Thiếu ý", TOO_LONG: "Quá dài", MISSING_SOURCE: "Thiếu căn cứ", OTHER: "Lý do khác", UNSPECIFIED: "Chưa nêu lý do" };
                    const meta = document.createElement("div"); meta.className = "small text-secondary mt-1"; meta.textContent = `${item.username || "Tài khoản"} · ${item.user_role} · ${feedbackReasonLabels[item.reason_code] || "Chưa nêu lý do"} · ${dateTime(item.created_at)}`;
                    const correction = document.createElement("textarea"); correction.className = "form-control form-control-sm mt-2"; correction.rows = 2; correction.placeholder = "Nội dung đã kiểm chứng để thay thế/đính chính câu trả lời"; correction.value = item.correction_text || "";
                    const citedSource = (item.sources || []).find(source => source.source_url && source.source_title);
                    const sourceTitle = document.createElement("input"); sourceTitle.className = "form-control form-control-sm mt-2"; sourceTitle.placeholder = "Tên văn bản hoặc trang cơ quan nhà nước"; sourceTitle.value = item.correction_source_title || citedSource?.source_title || "";
                    const sourceUrl = document.createElement("input"); sourceUrl.className = "form-control form-control-sm mt-2"; sourceUrl.type = "url"; sourceUrl.placeholder = "Liên kết https://...gov.vn / chinhphu.vn / quochoi.vn"; sourceUrl.value = item.correction_source_url || citedSource?.source_url || "";
                    const actions = document.createElement("div"); actions.className = "d-flex gap-2 mt-2";
                    const resolve = document.createElement("button"); resolve.type = "button"; resolve.className = "btn btn-sm btn-primary"; resolve.textContent = "Lưu đính chính";
                    const reviewed = document.createElement("button"); reviewed.type = "button"; reviewed.className = "btn btn-sm btn-outline-secondary"; reviewed.textContent = "Đánh dấu đã xem";
                    resolve.addEventListener("click", async () => {
                        const officialDomains = ["gov.vn", "chinhphu.vn", "quochoi.vn"];
                        let host = ""; try { const parsed = new URL(sourceUrl.value.trim()); if (parsed.protocol === "https:") host = parsed.hostname.toLowerCase(); } catch {}
                        if (!correction.value.trim() || !sourceTitle.value.trim() || !officialDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) {
                            window.alert("Nhập nội dung đính chính, tên nguồn và liên kết HTTPS thuộc .gov.vn, chinhphu.vn hoặc quochoi.vn."); return;
                        }
                        resolve.disabled = true;
                        try { await updateAiAnswerFeedback(item.id, { status: "RESOLVED", correction_text: correction.value, correction_source_title: sourceTitle.value, correction_source_url: sourceUrl.value }); await refreshNotifications(); }
                        catch (error) { resolve.disabled = false; resolve.title = error.message; window.alert(error.message); }
                    });
                    reviewed.addEventListener("click", async () => {
                        reviewed.disabled = true;
                        try { await updateAiAnswerFeedback(item.id, { status: "REVIEWED" }); await refreshNotifications(); }
                        catch (error) { reviewed.disabled = false; reviewed.title = error.message; }
                    });
                    actions.append(resolve, reviewed);
                    row.append(question, answer, meta, correction, sourceTitle, sourceUrl, actions);
                    list.appendChild(row);
                });
            }
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
