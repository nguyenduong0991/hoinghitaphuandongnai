(function () {
    const isLoginPage = location.pathname.endsWith("/login.html") || location.pathname.endsWith("login.html");
    const readUser = () => {
        try { return JSON.parse(localStorage.getItem("tgpl.user") || "null"); }
        catch { return null; }
    };

    function redirectToLogin() {
        const target = `${location.pathname}${location.search}`;
        location.replace(`login.html?return=${encodeURIComponent(target)}`);
    }

    function addAccountControls(user) {
        const sidebar = document.querySelector(".sidebar");
        const nav = document.querySelector(".navbar .container-fluid");
        const holder = sidebar || nav;
        if (!holder || document.getElementById("accountControls")) return;
        const controls = document.createElement(sidebar ? "div" : "span");
        controls.id = "accountControls";
        controls.className = sidebar ? "px-3 py-2 mt-3 border-top" : "ms-auto d-flex flex-wrap align-items-center gap-2";
        const name = document.createElement("span");
        name.className = sidebar ? "d-block small text-muted mb-2" : "small text-white";
        const roleLabels = { ADMIN: "Quản trị viên", COMMUNE: "Xã/phường", TASK_ASSIGNEE: "Người nhận nhiệm vụ", SPEAKER: "Báo cáo viên" };
        name.textContent = `${user.full_name || user.username} · ${user.organization_name || roleLabels[user.role] || user.role}`;
        controls.appendChild(name);
        const staffRole = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role);
        const portalHref = staffRole ? "staff-portal.html" : "conference-list.html";
        const onConferenceList = location.pathname.endsWith("conference-list.html");
        const hasPortalLink = Array.from(holder.querySelectorAll("a"))
            .some(link => link.getAttribute("href") === portalHref);
        if (!hasPortalLink && !(onConferenceList && portalHref === "conference-list.html")) {
            const portalLink = document.createElement("a");
            portalLink.href = portalHref;
            portalLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
            portalLink.textContent = staffRole ? "Phân công của tôi" : "Danh sách hội nghị";
            controls.appendChild(portalLink);
        }
        if (!staffRole) {
            const directoryLink = document.createElement("a");
            directoryLink.href = "directory.html";
            directoryLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
            directoryLink.textContent = "Danh bạ cán bộ";
            controls.appendChild(directoryLink);
            const hasAnalyticsLink = Array.from(holder.querySelectorAll("a"))
                .some(link => link.getAttribute("href") === "analytics.html");
            if (!hasAnalyticsLink && !onConferenceList) {
                const analyticsLink = document.createElement("a");
                analyticsLink.href = "analytics.html";
                analyticsLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
                analyticsLink.textContent = "Phân tích nhu cầu";
                controls.appendChild(analyticsLink);
            }
        }
        if (user.role === "ADMIN") {
            const usersLink = document.createElement("a");
            usersLink.href = "users.html";
            usersLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
            usersLink.textContent = "Quản lý tài khoản";
            controls.appendChild(usersLink);
            const surveyLink = document.createElement("a");
            surveyLink.href = "survey-results.html";
            surveyLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
            surveyLink.textContent = "Tổng hợp phiếu khảo sát";
            controls.appendChild(surveyLink);
            const aiFeedbackLink = document.createElement("a");
            aiFeedbackLink.href = "ai-feedback.html";
            aiFeedbackLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
            aiFeedbackLink.textContent = "Rà soát câu trả lời AI";
            controls.appendChild(aiFeedbackLink);
        } else if (user.role === "COMMUNE") {
            const attendanceLink = document.createElement("a");
            attendanceLink.href = "attendance.html";
            attendanceLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
            attendanceLink.innerHTML = '<i class="bi bi-person-check me-1" aria-hidden="true"></i>Đăng ký tham gia hội nghị';
            controls.appendChild(attendanceLink);
        }
        const changePassword = document.createElement("button");
        changePassword.type = "button";
        changePassword.className = sidebar ? "btn btn-sm btn-outline-primary me-1" : "btn btn-sm btn-outline-light";
        changePassword.textContent = "Đổi mật khẩu";
        changePassword.addEventListener("click", () => openPasswordDialog());
        controls.appendChild(changePassword);
        const logout = document.createElement("button");
        logout.type = "button";
        logout.className = sidebar ? "btn btn-sm btn-outline-secondary" : "btn btn-sm btn-light";
        logout.textContent = "Đăng xuất";
        const logOut = () => {
            const userKey = String(user.id || user.username || user.email || user.role).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
            localStorage.removeItem(`tgpl.ai.conversation.${userKey}`);
            localStorage.removeItem("tgpl.accessToken");
            localStorage.removeItem("tgpl.user");
            location.replace("login.html");
        };
        const dashboardLogout = document.getElementById("dashboardLogout");
        if (dashboardLogout) {
            dashboardLogout.hidden = false;
            dashboardLogout.addEventListener("click", logOut);
        } else {
            logout.addEventListener("click", logOut);
            controls.appendChild(logout);
        }
        holder.appendChild(controls);
    }

    function openPasswordDialog() {
        let dialog = document.getElementById("changePasswordDialog");
        if (!dialog) {
            dialog = document.createElement("dialog");
            dialog.id = "changePasswordDialog";
            dialog.className = "p-0 border-0 rounded-3 shadow";
            dialog.style.width = "min(460px, calc(100vw - 32px))";
            dialog.innerHTML = `
                <form id="changePasswordForm" class="p-4">
                    <h2 class="h5 mb-3">Đổi mật khẩu</h2>
                    <div class="mb-3"><label class="form-label" for="currentPassword">Mật khẩu hiện tại</label><input class="form-control" id="currentPassword" type="password" autocomplete="current-password" required></div>
                    <div class="mb-3"><label class="form-label" for="newPassword">Mật khẩu mới</label><input class="form-control" id="newPassword" type="password" minlength="12" autocomplete="new-password" required><div class="form-text">Ít nhất 12 ký tự.</div></div>
                    <div class="mb-3"><label class="form-label" for="confirmPassword">Nhập lại mật khẩu mới</label><input class="form-control" id="confirmPassword" type="password" minlength="12" autocomplete="new-password" required></div>
                    <div id="changePasswordMessage" class="small mb-3" role="status" aria-live="polite"></div>
                    <div class="d-flex justify-content-end gap-2"><button type="button" class="btn btn-outline-secondary" id="cancelPasswordChange">Hủy</button><button type="submit" class="btn btn-primary" id="savePasswordChange">Lưu mật khẩu</button></div>
                </form>`;
            document.body.appendChild(dialog);
            dialog.querySelector("#cancelPasswordChange").addEventListener("click", () => dialog.close());
            dialog.querySelector("#changePasswordForm").addEventListener("submit", async event => {
                event.preventDefault();
                const form = event.currentTarget;
                const message = dialog.querySelector("#changePasswordMessage");
                const save = dialog.querySelector("#savePasswordChange");
                const current = dialog.querySelector("#currentPassword").value;
                const next = dialog.querySelector("#newPassword").value;
                const confirm = dialog.querySelector("#confirmPassword").value;
                if (next !== confirm) {
                    message.className = "small mb-3 text-danger";
                    message.textContent = "Mật khẩu xác nhận không khớp.";
                    return;
                }
                save.disabled = true;
                message.className = "small mb-3 text-muted";
                message.textContent = "Đang cập nhật…";
                try {
                    await changeOwnPassword(current, next, confirm);
                    message.className = "small mb-3 text-success";
                    message.textContent = "Đã đổi mật khẩu thành công.";
                    form.reset();
                    window.setTimeout(() => dialog.close(), 900);
                } catch (error) {
                    message.className = "small mb-3 text-danger";
                    message.textContent = error.message || "Không thể đổi mật khẩu lúc này.";
                } finally {
                    save.disabled = false;
                }
            });
        }
        dialog.querySelector("#changePasswordMessage").textContent = "";
        dialog.querySelector("#changePasswordForm").reset();
        if (!dialog.open) dialog.showModal();
        dialog.querySelector("#currentPassword").focus();
    }

    async function loadDeadlineReminders(user) {
        if (!window.TGPL_AUTH_ENABLED || isLoginPage || !user) return;
        let section = document.getElementById("deadlineReminders");
        const reminderRoles = ["ADMIN", "TASK_ASSIGNEE", "SPEAKER"];
        if (!reminderRoles.includes(user.role)) {
            section?.remove();
            return;
        }
        if (!section) {
            section = document.createElement("section");
            section.id = "deadlineReminders";
            const dashboard = document.querySelector(".content");
            section.className = dashboard ? "deadline-reminders dashboard-deadline-reminders" : "deadline-reminders container-fluid pt-3";
            section.setAttribute("aria-live", "polite");
            const dashboardHeader = document.querySelector(".content > div.d-flex.justify-content-between.align-items-center");
            const navbar = document.querySelector("nav.navbar");
            if (dashboardHeader?.parentNode) dashboardHeader.parentNode.insertBefore(section, dashboardHeader.nextSibling);
            else if (navbar?.parentNode) navbar.parentNode.insertBefore(section, navbar.nextSibling);
            else document.body.prepend(section);
        }
        try {
            const result = await getMyReminders();
            const reminders = result.data || [];
            section.replaceChildren();
            if (!reminders.length) {
                section.hidden = true;
                return;
            }
            section.hidden = false;
            const panel = document.createElement("div");
            panel.className = "deadline-reminder-panel";
            const heading = document.createElement("div");
            heading.className = "deadline-reminder-heading";
            const icon = document.createElement("i");
            icon.className = "bi bi-alarm me-2";
            icon.setAttribute("aria-hidden", "true");
            heading.appendChild(icon);
            heading.appendChild(document.createTextNode(`Nhắc việc · ${reminders.length} mục đến hạn trong 24 giờ tới`));
            panel.appendChild(heading);
            const list = document.createElement("div");
            list.className = "deadline-reminder-list";
            reminders.forEach(reminder => {
                const row = document.createElement("div");
                row.className = "deadline-reminder-item";
                const details = document.createElement("div");
                details.className = "deadline-reminder-details";
                const title = document.createElement("div");
                title.className = "deadline-reminder-title";
                title.textContent = `${reminder.reminder_type === "SPEAKER" ? "Báo cáo viên" : "Nhiệm vụ"}: ${reminder.title || reminder.conference_title || "Hội nghị"}`;
                const due = new Date(reminder.due_at);
                const remainingMs = Math.max(0, due.getTime() - Date.now());
                const hours = Math.floor(remainingMs / 3600000);
                const minutes = Math.floor((remainingMs % 3600000) / 60000);
                const meta = document.createElement("div");
                meta.className = "deadline-reminder-meta";
                meta.textContent = `${reminder.conference_title || ""}${reminder.organization_name ? ` · ${reminder.organization_name}` : ""} · Hạn: ${due.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })} · Còn ${hours} giờ ${minutes} phút${reminder.location_name ? ` · ${reminder.location_name}` : ""}`;
                details.append(title, meta);
                const link = document.createElement("a");
                link.className = "btn btn-sm btn-outline-primary deadline-reminder-link";
                const staffRole = ["TASK_ASSIGNEE", "SPEAKER"].includes(user.role);
                link.href = staffRole ? "staff-portal.html" : `conference-list.html?id=${encodeURIComponent(reminder.conference_id)}`;
                link.textContent = staffRole ? "Mở phân công" : "Xem hội nghị";
                row.append(details, link);
                list.appendChild(row);
            });
            panel.appendChild(list);
            section.appendChild(panel);
        } catch (error) {
            console.warn("Không tải được nhắc việc sắp đến hạn:", error);
            if (section) section.hidden = true;
        }
    }

    document.addEventListener("DOMContentLoaded", async function () {
        if (!window.TGPL_AUTH_ENABLED || isLoginPage) return;
        const cachedUser = readUser();
        const staffRoles = ["TASK_ASSIGNEE", "SPEAKER"];
        if (cachedUser && staffRoles.includes(cachedUser.role)
            && !location.pathname.endsWith("staff-portal.html")) {
            location.replace("staff-portal.html");
            return;
        }
        if (cachedUser && cachedUser.role !== "ADMIN") {
            document.querySelectorAll(".admin-only").forEach(element => {
                element.hidden = true;
                element.style.display = "none";
            });
        }
        if (!localStorage.getItem("tgpl.accessToken")) {
            redirectToLogin();
            return;
        }
        try {
            const result = await getCurrentUser();
            const user = result.user;
            localStorage.setItem("tgpl.user", JSON.stringify(user));
            window.tgplCurrentUser = user;
            window.dispatchEvent(new CustomEvent("tgpl:authenticated", { detail: { user } }));
            if (!document.getElementById("tgplAssistantScript")) {
                const assistantScript = document.createElement("script");
                assistantScript.id = "tgplAssistantScript";
                assistantScript.src = "assets/js/topic-assistant.js?v=20261018-ai-optimization-1";
                assistantScript.async = true;
                document.body.appendChild(assistantScript);
            }
            addAccountControls(user);
            loadDeadlineReminders(user);
            window.setInterval(() => loadDeadlineReminders(window.tgplCurrentUser), 15 * 60 * 1000);
            if (staffRoles.includes(user.role) && !location.pathname.endsWith("staff-portal.html")) {
                location.replace("staff-portal.html");
                return;
            }
            const scopeNote = document.getElementById("conferenceScopeNote");
            if (scopeNote) scopeNote.textContent = user.role === "ADMIN"
                ? "Quản trị viên đang xem hồ sơ của toàn hệ thống."
                : `Danh sách và tiến độ chỉ hiển thị hội nghị của ${user.organization_name || "đơn vị được gán cho tài khoản"}.`;
            if (user.role !== "ADMIN") {
                document.querySelectorAll(".admin-only").forEach(element => {
                    element.hidden = true;
                    element.style.display = "none";
                });
                if (["users.html", "organizations.html", "assignment-reports.html", "survey-results.html", "ai-feedback.html", "legal-aid-requests.html"].some(page => location.pathname.endsWith(page))) location.replace("dashboard.html");
            }
            if (location.pathname.endsWith("survey.html") && user.role !== "COMMUNE") location.replace(user.role === "ADMIN" ? "survey-results.html" : "dashboard.html");
            if (location.pathname.endsWith("survey-results.html") && user.role !== "ADMIN") location.replace("dashboard.html");
            if (location.pathname.endsWith("attendance.html") && user.role !== "COMMUNE") location.replace("dashboard.html");
            document.querySelectorAll(".commune-only").forEach(element => {
                const visible = user.role === "COMMUNE";
                element.hidden = !visible;
                element.style.display = visible ? "" : "none";
            });
        } catch (error) {
            if (!location.pathname.endsWith("login.html")) redirectToLogin();
        }
    });
})();
