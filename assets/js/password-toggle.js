(function () {
    "use strict";

    const eyeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const hiddenIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.5 10.5 0 0 0 4-.8"/></svg>';

    function enhance(input) {
        if (!(input instanceof HTMLInputElement) || input.type !== "password" || input.dataset.passwordToggleReady) return;
        input.dataset.passwordToggleReady = "true";

        const group = document.createElement("div");
        group.className = "input-group password-toggle-group";
        input.parentNode.insertBefore(group, input);
        group.appendChild(input);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-outline-secondary password-toggle-button";
        button.innerHTML = eyeIcon;
        button.setAttribute("aria-label", "Hiển thị mật khẩu");
        button.title = "Hiển thị mật khẩu";
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("mousedown", event => event.preventDefault());
        button.addEventListener("click", () => {
            const reveal = input.type === "password";
            input.type = reveal ? "text" : "password";
            button.innerHTML = reveal ? hiddenIcon : eyeIcon;
            button.setAttribute("aria-label", reveal ? "Ẩn mật khẩu" : "Hiển thị mật khẩu");
            button.title = reveal ? "Ẩn mật khẩu" : "Hiển thị mật khẩu";
            button.setAttribute("aria-pressed", String(reveal));
            input.focus({ preventScroll: true });
        });
        group.appendChild(button);
    }

    function scan(root) {
        if (root instanceof HTMLInputElement) enhance(root);
        root.querySelectorAll?.('input[type="password"]').forEach(enhance);
    }

    scan(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }))).observe(document.documentElement, { childList: true, subtree: true });
})();
