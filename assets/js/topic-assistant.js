(() => {
    const allowedRoles = ["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"];
    const user = window.tgplCurrentUser;
    if (!window.TGPL_AUTH_ENABLED || !user || !allowedRoles.includes(user.role) || document.getElementById("tgplAiAssistant")) return;

    document.body.insertAdjacentHTML("beforeend", `
        <div id="tgplAiAssistant" class="tgpl-ai-assistant">
            <button id="tgplAiToggle" class="tgpl-ai-toggle" type="button" aria-expanded="false" aria-controls="tgplAiPanel" aria-label="Mở trợ lý AI">
                <span class="tgpl-ai-toggle-icon" aria-hidden="true">✦</span><span>Trợ lý AI</span>
            </button>
            <section id="tgplAiPanel" class="tgpl-ai-panel" role="dialog" aria-modal="false" aria-labelledby="tgplAiTitle" hidden>
                <header class="tgpl-ai-header">
                    <span class="tgpl-ai-header-icon" aria-hidden="true">✦</span>
                    <div><strong id="tgplAiTitle">Trợ lý AI TGPL</strong><small>Qwen 3 · xử lý trên laptop</small></div>
                    <button id="tgplAiClose" type="button" class="tgpl-ai-close" aria-label="Đóng trợ lý AI">×</button>
                </header>
                <p class="tgpl-ai-intro">Có thể tổng hợp phiếu khảo sát, báo cáo và số liệu hội nghị trong phạm vi quyền tài khoản; tra cứu theo mã, chủ đề, đơn vị, thời gian, địa điểm, trạng thái; hoặc hỏi cách dùng hệ thống, nhiệm vụ và Luật Trợ giúp pháp lý. Không nhập hồ sơ vụ việc.</p>
                <div id="tgplAiMessages" class="tgpl-ai-messages" aria-live="polite" aria-relevant="additions text">
                    <div class="assistant-message assistant-message-bot">Xin chào! Tôi có thể tổng hợp phiếu khảo sát, số liệu và báo cáo có sẵn trên website theo quyền tài khoản; tra cứu hội nghị, hướng dẫn sử dụng hệ thống và nhiệm vụ, hoặc tra cứu Luật Trợ giúp pháp lý.</div>
                </div>
                <form id="tgplAiForm" class="tgpl-ai-form">
                    <label class="visually-hidden" for="tgplAiInput">Câu hỏi cho trợ lý AI</label>
                    <textarea id="tgplAiInput" rows="2" maxlength="1200" required placeholder="Nhập câu hỏi (ít nhất 10 ký tự)…"></textarea>
                    <div class="tgpl-ai-form-footer"><small>AI chạy trên laptop, không gửi đến dịch vụ AI bên ngoài.</small><button type="submit" aria-label="Gửi câu hỏi">Gửi</button></div>
                </form>
            </section>
        </div>
    `);

    const panel = document.getElementById("tgplAiPanel");
    const toggle = document.getElementById("tgplAiToggle");
    const input = document.getElementById("tgplAiInput");
    const form = document.getElementById("tgplAiForm");
    const messages = document.getElementById("tgplAiMessages");
    const conversationHistory = [];
    const userKey = String(user.id || user.username || user.email || user.role).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const conversationStorageKey = `tgpl.ai.conversation.${userKey}`;
    const openStorageKey = `tgpl.ai.open.${userKey}`;
    let savedTurns = [];
    let isGenerating = false;
    try {
        const stored = JSON.parse(localStorage.getItem(conversationStorageKey) || "[]");
        if (Array.isArray(stored)) savedTurns = stored.filter(turn => turn && typeof turn.question === "string" && typeof turn.answer === "string").slice(-20);
    } catch {}
    function setOpen(open, persist = true) {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Đóng trợ lý AI" : "Mở trợ lý AI");
        if (persist) {
            try { localStorage.setItem(openStorageKey, String(open)); } catch {}
        }
        if (open) input.focus();
    }
    function addMessage(className, text) {
        const bubble = document.createElement("div");
        bubble.className = `assistant-message ${className}`;
        bubble.textContent = text;
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
        return bubble;
    }
    function addAnswerTools(answerBubble, question, answer, sources) {
        if (!answer || answerBubble.nextElementSibling?.classList.contains("tgpl-ai-answer-tools")) return;
        const tools = document.createElement("div");
        tools.className = "tgpl-ai-answer-tools small mt-2";
        const label = document.createElement("span");
        label.textContent = "Câu trả lời này có hữu ích và chính xác không? ";
        tools.appendChild(label);
        const correct = document.createElement("button");
        correct.type = "button"; correct.className = "btn btn-sm btn-outline-success me-1"; correct.textContent = "Đúng";
        const incorrect = document.createElement("button");
        incorrect.type = "button"; incorrect.className = "btn btn-sm btn-outline-danger"; incorrect.textContent = "Sai";
        const status = document.createElement("span"); status.className = "ms-2 text-muted";
        async function vote(value, buttons) {
            correct.disabled = incorrect.disabled = true;
            try {
                await submitAiAnswerFeedback({ question, answer, vote: value, sources: sources || [] });
                status.textContent = value === "INCORRECT" ? "Đã gửi cho quản trị viên rà soát." : "Cảm ơn bạn đã phản hồi.";
            } catch (error) {
                correct.disabled = incorrect.disabled = false;
                status.textContent = error.message || "Chưa gửi được phản hồi.";
            }
        }
        correct.addEventListener("click", () => vote("CORRECT"));
        incorrect.addEventListener("click", () => vote("INCORRECT"));
        tools.append(correct, incorrect, status);
        answerBubble.after(tools);
    }

    function renderSavedTurns() {
        conversationHistory.splice(0, conversationHistory.length);
        messages.replaceChildren();
        if (!savedTurns.length) {
            addMessage("assistant-message-bot", "Xin chào! Tôi có thể tổng hợp phiếu khảo sát, số liệu và báo cáo có sẵn trên website theo quyền tài khoản; tra cứu hội nghị, hướng dẫn sử dụng hệ thống và nhiệm vụ, hoặc tra cứu Luật Trợ giúp pháp lý.");
            return;
        }
        savedTurns.forEach(turn => {
            addMessage("assistant-message-user", turn.question);
            const answer = addMessage("assistant-message-bot", turn.answer);
            addAnswerTools(answer, turn.question, turn.answer, turn.sources || []);
            conversationHistory.push({ role: "user", content: turn.question }, { role: "assistant", content: turn.answer });
        });
        messages.scrollTop = messages.scrollHeight;
    }

    if (savedTurns.length) renderSavedTurns();
    window.addEventListener("storage", event => {
        if (event.key === conversationStorageKey && !isGenerating) {
            try {
                const stored = JSON.parse(event.newValue || "[]");
                savedTurns = Array.isArray(stored) ? stored.filter(turn => turn && typeof turn.question === "string" && typeof turn.answer === "string").slice(-20) : [];
                renderSavedTurns();
            } catch {}
        } else if (event.key === openStorageKey && event.newValue !== null) {
            setOpen(event.newValue === "true", false);
        }
    });
    try { if (localStorage.getItem(openStorageKey) === "true") setOpen(true, false); } catch {}

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    document.getElementById("tgplAiClose").addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) setOpen(false); });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const question = input.value.trim();
        if (question.length < 10) {
            input.setCustomValidity("Vui lòng nhập câu hỏi ít nhất 10 ký tự.");
            input.reportValidity();
            input.setCustomValidity("");
            return;
        }
        addMessage("assistant-message-user", question);
        input.value = "";
        input.disabled = true;
        isGenerating = true;
        const sendButton = form.querySelector('button[type="submit"]');
        sendButton.disabled = true;
        const waiting = addMessage("assistant-message-bot", "Qwen đang xử lý trên laptop…");
        let answerBubble = null;
        let answerText = "";
        const slowNotice = setTimeout(() => {
            if (!answerBubble) {
                waiting.textContent = "Mô hình đang soạn câu trả lời. Lần đầu có thể mất thêm thời gian, bạn vui lòng chờ…";
            }
        }, 15000);
        try {
            const result = await streamTgplChat(question, {
                mode: "auto",
                history: conversationHistory.slice(-6),
                onMeta(meta) {
                    const labels = { fast: "Trả lời nhanh", legal_rag: "Tra cứu kho TGPL", deep_analysis: "Phân tích chuyên sâu" };
                    waiting.title = labels[meta.mode] || "Trợ lý AI";
                },
                onToken(token) {
                    if (!token) return;
                    if (!answerBubble) {
                        waiting.remove();
                        answerBubble = addMessage("assistant-message-bot", "");
                        answerBubble.title = waiting.title || "Câu trả lời từ trợ lý AI";
                    }
                    answerText += token;
                    answerBubble.textContent = answerText;
                    messages.scrollTop = messages.scrollHeight;
                }
            });
            if (!answerBubble) {
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", "Mô hình chưa trả về câu trả lời. Vui lòng thử lại.");
            }
            addAnswerTools(answerBubble, question, answerText, result.sources || []);
            if (answerText.trim()) {
                savedTurns.push({ question, answer: answerText, sources: result.sources || [] });
                savedTurns = savedTurns.slice(-20);
                conversationHistory.push({ role: "user", content: question });
                conversationHistory.push({ role: "assistant", content: answerText });
                if (conversationHistory.length > 6) conversationHistory.splice(0, conversationHistory.length - 6);
                try { localStorage.setItem(conversationStorageKey, JSON.stringify(savedTurns)); } catch {}
            }
        } catch (error) {
            waiting.remove();
            const errorMessage = error.message || "Không kết nối được trợ lý AI. Hãy kiểm tra Ollama và thử lại.";
            if (answerBubble) {
                answerBubble.classList.add("assistant-message-error");
                answerBubble.textContent = "Câu trả lời chưa hoàn tất vì mô hình phản hồi chậm. Phần nội dung dở dang đã được ẩn để tránh gây hiểu nhầm. Vui lòng thử lại.";
            } else {
                addMessage("assistant-message-bot assistant-message-error", errorMessage);
            }
        } finally {
            clearTimeout(slowNotice);
            isGenerating = false;
            input.disabled = false;
            sendButton.disabled = false;
            input.focus();
            messages.scrollTop = messages.scrollHeight;
        }
    });
})();
