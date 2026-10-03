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
        name.textContent = `${user.full_name || user.username} · ${user.role}`;
        controls.appendChild(name);
        const analyticsLink = document.createElement("a");
        analyticsLink.href = "analytics.html";
        analyticsLink.className = sidebar ? "d-block mb-2" : "btn btn-sm btn-outline-light";
        analyticsLink.textContent = "Phân tích nhu cầu";
        controls.appendChild(analyticsLink);
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
        logout.addEventListener("click", () => {
            localStorage.removeItem("tgpl.accessToken");
            localStorage.removeItem("tgpl.user");
            location.replace("login.html");
        });
        controls.appendChild(logout);
        holder.appendChild(controls);
    }

    document.addEventListener("DOMContentLoaded", async function () {
        if (!window.TGPL_AUTH_ENABLED || isLoginPage) return;
        const cachedUser = readUser();
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
            addAccountControls(user);
            if (user.role !== "ADMIN") {
                document.querySelectorAll(".admin-only").forEach(element => {
                    element.hidden = true;
                    element.style.display = "none";
                });
                if (location.pathname.endsWith("users.html")) location.replace("index.html");
            }
        } catch (error) {
            if (!location.pathname.endsWith("login.html")) redirectToLogin();
        }
    });
})();
