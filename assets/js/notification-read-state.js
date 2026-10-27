(function (global) {
    const MAX_STORED_IDS = 500;

    function key(namespace, user) {
        const identity = user?.id || user?.username || "unknown";
        return `tgpl.notification-read.${namespace}.${identity}`;
    }

    function read(namespace, user) {
        try {
            let stored = localStorage.getItem(key(namespace, user));
            if (stored === null && namespace === "staff") {
                stored = localStorage.getItem(`tgpl.staff-notifications.read.${user?.id || user?.username || "unknown"}`);
                if (stored !== null) localStorage.setItem(key(namespace, user), stored);
            }
            const value = JSON.parse(stored || "[]");
            return new Set(Array.isArray(value) ? value.map(String) : []);
        } catch {
            return new Set();
        }
    }

    function mark(namespace, user, noticeId) {
        if (!noticeId) return;
        const ids = read(namespace, user);
        ids.add(String(noticeId));
        try {
            localStorage.setItem(key(namespace, user), JSON.stringify([...ids].slice(-MAX_STORED_IDS)));
        } catch { /* Notification display should continue if storage is unavailable. */ }
    }

    global.TGPLNotificationReadState = Object.freeze({ read, mark });
})(window);
