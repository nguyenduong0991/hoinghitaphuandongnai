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
        controls.className = sidebar ? "px-3 py-2 mt-3 border-top" : "ms-auto d-flex align-items-center gap-2";
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
        }
        const logout = document.createElement("button");
        logout.type = "button";
        logout.className = sidebar ? "btn btn-sm btn-outline-secondary" : "btn btn-sm btn-light";
        logout.textContent = "Đăng xuất";
        const logOut = () => {
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

    async function loadDeadlineReminders(user) {
        if (!window.TGPL_AUTH_ENABLED || isLoginPage || !user) return;
        let section = document.getElementById("deadlineReminders");
        if (!section) {
            section = document.createElement("section");
            section.id = "deadlineReminders";
            section.className = "container-fluid pt-3";
            section.setAttribute("aria-live", "polite");
            const navbar = document.querySelector("nav.navbar");
            if (navbar?.parentNode) navbar.parentNode.insertBefore(section, navbar.nextSibling);
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
            panel.className = "alert alert-warning border-warning-subtle mb-0";
            const heading = document.createElement("div");
            heading.className = "fw-bold mb-2";
            heading.textContent = `Nhắc việc: ${reminders.length} mục đến hạn trong 24 giờ tới`;
            panel.appendChild(heading);
            const list = document.createElement("div");
            list.className = "d-grid gap-2";
            reminders.forEach(reminder => {
                const row = document.createElement("div");
                row.className = "d-flex flex-wrap justify-content-between align-items-center gap-2 border-top border-warning-subtle pt-2";
                const details = document.createElement("div");
                const title = document.createElement("div");
                title.className = "fw-semibold";
                title.textContent = `${reminder.reminder_type === "SPEAKER" ? "Báo cáo viên" : "Nhiệm vụ"}: ${reminder.title || reminder.conference_title || "Hội nghị"}`;
                const due = new Date(reminder.due_at);
                const remainingMs = Math.max(0, due.getTime() - Date.now());
                const hours = Math.floor(remainingMs / 3600000);
                const minutes = Math.floor((remainingMs % 3600000) / 60000);
                const meta = document.createElement("div");
                meta.className = "small";
                meta.textContent = `${reminder.conference_title || ""}${reminder.organization_name ? ` · ${reminder.organization_name}` : ""} · Hạn: ${due.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })} · Còn ${hours} giờ ${minutes} phút${reminder.location_name ? ` · ${reminder.location_name}` : ""}`;
                details.append(title, meta);
                const link = document.createElement("a");
                link.className = "btn btn-sm btn-outline-dark";
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
                if (["users.html", "organizations.html", "assignment-reports.html"].some(page => location.pathname.endsWith(page))) location.replace("index.html");
            }
        } catch (error) {
            if (!location.pathname.endsWith("login.html")) redirectToLogin();
        }
    });
})();
