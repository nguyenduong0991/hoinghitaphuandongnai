(function () {
    "use strict";
    if (window.__tgplServiceStatusStarted) return;
    window.__tgplServiceStatusStarted = true;

    const apiBase = String(window.TGPL_API_BASE_URL || "").replace(/\/+$/, "");
    const panel = document.createElement("section");
    panel.id = "tgplServiceStatus";
    panel.className = "tgpl-service-status";
    panel.hidden = true;
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = '<div class="tgpl-service-status-heading"><span class="tgpl-service-status-icon" aria-hidden="true">!</span><strong>Dịch vụ chưa sẵn sàng</strong><button type="button" class="tgpl-service-status-retry">Thử lại</button></div><div class="tgpl-service-status-list"></div>';
    const style = document.createElement("style");
    style.textContent = `
      .tgpl-service-status{position:fixed;z-index:1200;left:16px;bottom:16px;width:min(440px,calc(100vw - 32px));padding:14px 16px;border:1px solid #f0c36d;border-radius:14px;background:#fff9e9;color:#563d0a;box-shadow:0 12px 32px rgba(20,35,55,.18);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
      .tgpl-service-status[hidden]{display:none}.tgpl-service-status-heading{display:flex;align-items:center;gap:9px;margin-bottom:6px}.tgpl-service-status-heading strong{flex:1;font-size:15px}.tgpl-service-status-icon{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#f3bd4e;color:#352300;font-weight:800}.tgpl-service-status-retry{border:1px solid #b58a30;border-radius:8px;background:#fff;padding:5px 10px;color:#563d0a;cursor:pointer}.tgpl-service-status-row{margin-top:4px}.tgpl-service-status-row b{font-weight:700}.tgpl-service-status-ok{color:#176b45}.tgpl-service-status-bad{color:#a22d25}.tgpl-service-status-hint{margin:5px 0 0;color:#6a5a38;font-size:12px}
      @media(max-width:600px){.tgpl-service-status{left:10px;bottom:10px;width:calc(100vw - 20px)}}
    `;
    (document.head || document.documentElement).appendChild(style);
    (document.body || document.documentElement).appendChild(panel);
    const list = panel.querySelector(".tgpl-service-status-list");
    const retry = panel.querySelector(".tgpl-service-status-retry");
    let checking = false;

    function render(rows, hint) {
        list.replaceChildren();
        for (const row of rows) {
            const line = document.createElement("div");
            line.className = `tgpl-service-status-row ${row.ready ? "tgpl-service-status-ok" : "tgpl-service-status-bad"}`;
            const name = document.createElement("b");
            name.textContent = `${row.name}: `;
            line.append(name, document.createTextNode(row.message));
            list.appendChild(line);
        }
        if (hint) {
            const note = document.createElement("p");
            note.className = "tgpl-service-status-hint";
            note.textContent = hint;
            list.appendChild(note);
        }
        panel.hidden = rows.every(row => row.ready) && !hint;
    }

    async function checkServices() {
        if (checking || !apiBase) return;
        checking = true;
        retry.disabled = true;
        try {
            const response = await fetch(`${apiBase}/health/services`, {
                method: "GET",
                cache: "no-store",
                signal: AbortSignal.timeout(6000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            const backend = result.services?.backend;
            const ollama = result.services?.ollama;
            const rows = [
                { name: "Backend", ready: backend?.ready === true, message: backend?.ready ? "Đang hoạt động." : "Chưa sẵn sàng." },
                { name: "Ollama", ready: ollama?.ready === true, message: ollama?.message || (ollama?.ready ? "Đang hoạt động." : "Chưa sẵn sàng.") }
            ];
            let hint = "";
            if (!rows[0].ready) {
                rows[1] = { name: "Ollama", ready: false, message: "Chưa kiểm tra được khi backend chưa kết nối." };
                hint = "Hãy khởi động backend bằng tệp KhoiDongDuAnTGPL_Local_3001.bat; hệ thống sẽ tự kiểm tra lại.";
            } else if (!rows[1].ready) {
                hint = ollama?.api_ready && ollama?.model
                    ? `Ollama đang chạy nhưng thiếu mô hình trả lời. Mở CMD/PowerShell và chạy: ollama pull ${ollama.model}`
                    : "Hãy mở ứng dụng Ollama trên máy đang chạy backend; hệ thống sẽ tự kiểm tra lại.";
            } else if (ollama?.embedding_ready === false) {
                hint = `Ollama đang chạy nhưng thiếu mô hình nhúng ${ollama.embedding_model || "bge-m3"}; chức năng RAG có thể dùng tìm kiếm dự phòng.`;
            }
            render(rows, hint);
        } catch (_) {
            render([
                { name: "Backend", ready: false, message: "Không kết nối được API backend." },
                { name: "Ollama", ready: false, message: "Chưa kiểm tra được do backend chưa phản hồi." }
            ], "Hãy khởi động backend bằng tệp KhoiDongDuAnTGPL_Local_3001.bat. Sau khi backend hoạt động, hệ thống sẽ kiểm tra Ollama và báo riêng nếu cần mở ứng dụng này.");
        } finally {
            checking = false;
            retry.disabled = false;
        }
    }

    retry.addEventListener("click", checkServices);
    checkServices();
    window.setInterval(() => {
        if (document.visibilityState === "visible") checkServices();
    }, 30000);
})();
