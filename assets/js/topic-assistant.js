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
                    <button id="tgplAiClear" type="button" class="tgpl-ai-clear" aria-label="Xóa hội thoại" title="Xóa hội thoại">Xóa hội thoại</button>
                    <button id="tgplAiResize" type="button" class="tgpl-ai-size" aria-label="Mở rộng khung chat" title="Mở rộng khung chat">↗</button>
                    <button id="tgplAiClose" type="button" class="tgpl-ai-close" aria-label="Đóng trợ lý AI">×</button>
                </header>
                <p class="tgpl-ai-intro">Có thể tổng hợp phiếu khảo sát, báo cáo và số liệu hội nghị trong phạm vi quyền tài khoản; tra cứu theo mã, chủ đề, đơn vị, thời gian, địa điểm, trạng thái; hoặc hỏi cách dùng hệ thống, nhiệm vụ và Luật Trợ giúp pháp lý. Không nhập hồ sơ vụ việc.</p>
                <div id="tgplAiMessages" class="tgpl-ai-messages" aria-live="polite" aria-relevant="additions text">
                    <div class="assistant-message assistant-message-bot">Xin chào! Tôi có thể tổng hợp phiếu khảo sát, số liệu và báo cáo có sẵn trên website theo quyền tài khoản; tra cứu hội nghị, hướng dẫn sử dụng hệ thống và nhiệm vụ, hoặc tra cứu Luật Trợ giúp pháp lý.</div>
                </div>
                <form id="tgplAiForm" class="tgpl-ai-form">
                    <label class="visually-hidden" for="tgplAiInput">Câu hỏi cho trợ lý AI</label>
                    <textarea id="tgplAiInput" rows="2" maxlength="1200" required placeholder="Nhập câu hỏi (ít nhất 10 ký tự)…"></textarea>
                    <div class="tgpl-ai-form-footer"><small>AI chạy trên laptop. Ngữ cảnh giữ tối đa 6 lượt hỏi–đáp gần nhất; bấm “Xóa hội thoại” để xóa ngay.</small><button type="submit" aria-label="Gửi câu hỏi">Gửi</button></div>
                </form>
            </section>
        </div>
    `);

    const panel = document.getElementById("tgplAiPanel");
    const toggle = document.getElementById("tgplAiToggle");
    const input = document.getElementById("tgplAiInput");
    const form = document.getElementById("tgplAiForm");
    const messages = document.getElementById("tgplAiMessages");
    const assistant = document.getElementById("tgplAiAssistant");
    const resizeButton = document.getElementById("tgplAiResize");
    const clearButton = document.getElementById("tgplAiClear");
    const header = panel.querySelector(".tgpl-ai-header");
    const conversationHistory = [];
    const userKey = String(user.id || user.username || user.email || user.role).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const conversationStorageKey = `tgpl.ai.context.${userKey}`;
    const conversationChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(`tgpl.ai.context.${userKey}`) : null;
    const openStorageKey = `tgpl.ai.open.${userKey}`;
    const positionStorageKey = `tgpl.ai.position.${userKey}`;
    let isGenerating = false;
    let conversationVersion = 0;
    let activeRequestController = null;
    const maxContextMessages = 12;
    function trimContextMessage(item) {
        if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;
        const content = item.content.trim();
        return content ? { role: item.role, content } : null;
    }
    function limitConversationHistory(items) {
        const valid = (Array.isArray(items) ? items : []).map(trimContextMessage).filter(Boolean);
        const userIndexes = valid.map((item, index) => item.role === "user" ? index : -1).filter(index => index >= 0);
        const firstKeptUser = userIndexes[Math.max(0, userIndexes.length - 6)] ?? Math.max(0, valid.length - maxContextMessages);
        return valid.slice(firstKeptUser);
    }
    // Keep only a short working context in this browser tab. It survives page
    // navigation, but is cleared on logout/expired login and never goes to localStorage.
    try { localStorage.removeItem(`tgpl.ai.conversation.${userKey}`); } catch {}
    function setOpen(open, persist = true) {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Đóng trợ lý AI" : "Mở trợ lý AI");
        if (persist) {
            try { localStorage.setItem(openStorageKey, String(open)); } catch {}
        }
        if (open) input.focus();
    }
    function clampAssistantPosition(left, top) {
        const rect = assistant.getBoundingClientRect();
        const panelRect = panel.hidden ? null : panel.getBoundingClientRect();
        const minX = panelRect ? Math.min(rect.left, panelRect.left) : rect.left;
        const maxX = panelRect ? Math.max(rect.right, panelRect.right) : rect.right;
        const minY = panelRect ? Math.min(rect.top, panelRect.top) : rect.top;
        const maxY = panelRect ? Math.max(rect.bottom, panelRect.bottom) : rect.bottom;
        const leftOverflow = rect.left - minX;
        const rightOverflow = maxX - rect.right;
        const topOverflow = rect.top - minY;
        const bottomOverflow = maxY - rect.bottom;
        return {
            left: Math.max(8 + leftOverflow, Math.min(left, window.innerWidth - rect.width - rightOverflow - 8)),
            top: Math.max(8 + topOverflow, Math.min(top, window.innerHeight - rect.height - bottomOverflow - 8))
        };
    }
    try {
        const savedPosition = JSON.parse(localStorage.getItem(positionStorageKey) || "null");
        if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
            assistant.style.left = `${savedPosition.left}px`;
            assistant.style.top = `${savedPosition.top}px`;
            assistant.style.right = "auto";
            assistant.style.bottom = "auto";
        }
    } catch {}
    resizeButton.addEventListener("click", () => {
        const expanded = panel.classList.toggle("tgpl-ai-panel-expanded");
        resizeButton.textContent = expanded ? "↙" : "↗";
        resizeButton.setAttribute("aria-label", expanded ? "Thu gọn khung chat" : "Mở rộng khung chat");
        resizeButton.title = expanded ? "Thu gọn khung chat" : "Mở rộng khung chat";
        if (assistant.style.left) {
            const pos = clampAssistantPosition(parseFloat(assistant.style.left), parseFloat(assistant.style.top));
            assistant.style.left = `${pos.left}px`;
            assistant.style.top = `${pos.top}px`;
            try { localStorage.setItem(positionStorageKey, JSON.stringify(pos)); } catch {}
        }
    });
    let dragState = null;
    header.addEventListener("pointerdown", event => {
        if (event.target.closest("button") || event.button !== 0) return;
        const rect = assistant.getBoundingClientRect();
        dragState = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        header.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    header.addEventListener("pointermove", event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const pos = clampAssistantPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
        assistant.style.left = `${pos.left}px`;
        assistant.style.top = `${pos.top}px`;
        assistant.style.right = "auto";
        assistant.style.bottom = "auto";
    });
    const stopDragging = event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        dragState = null;
        try { localStorage.setItem(positionStorageKey, JSON.stringify({ left: parseFloat(assistant.style.left), top: parseFloat(assistant.style.top) })); } catch {}
    };
    header.addEventListener("pointerup", stopDragging);
    header.addEventListener("pointercancel", stopDragging);
    window.addEventListener("resize", () => {
        if (!assistant.style.left) return;
        const pos = clampAssistantPosition(parseFloat(assistant.style.left), parseFloat(assistant.style.top));
        assistant.style.left = `${pos.left}px`;
        assistant.style.top = `${pos.top}px`;
        try { localStorage.setItem(positionStorageKey, JSON.stringify(pos)); } catch {}
    });
    function addMessage(className, text) {
        const bubble = document.createElement("div");
        bubble.className = `assistant-message ${className}`;
        bubble.textContent = text;
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
        return bubble;
    }
    function renderConversationHistory() {
        const greeting = messages.firstElementChild;
        messages.replaceChildren(greeting);
        conversationHistory.forEach(item => addMessage(item.role === "user" ? "assistant-message-user" : "assistant-message-bot", item.content));
    }
    function clearConversation(broadcast = true) {
        activeRequestController?.abort();
        activeRequestController = null;
        conversationVersion++;
        conversationHistory.length = 0;
        try { sessionStorage.removeItem(conversationStorageKey); } catch {}
        renderConversationHistory();
        addMessage("assistant-message-bot", "Đã xóa hội thoại và ngữ cảnh chat trong các tab đang mở của tài khoản này.");
        if (broadcast) conversationChannel?.postMessage({ type: "clear" });
    }
    try {
        const storedContext = JSON.parse(sessionStorage.getItem(conversationStorageKey) || "[]");
        if (Array.isArray(storedContext)) {
            conversationHistory.push(...limitConversationHistory(storedContext));
            if (conversationHistory.length) {
                renderConversationHistory();
                sessionStorage.setItem(conversationStorageKey, JSON.stringify(conversationHistory));
            }
        }
    } catch { try { sessionStorage.removeItem(conversationStorageKey); } catch {} }
    if (conversationChannel) {
        conversationChannel.addEventListener("message", event => {
            if (event.data?.type === "clear") {
                clearConversation(false);
                return;
            }
            if (event.data?.type !== "history" || !Array.isArray(event.data.history) || isGenerating) return;
            const shared = limitConversationHistory(event.data.history);
            if (JSON.stringify(shared) === JSON.stringify(conversationHistory)) return;
            conversationHistory.splice(0, conversationHistory.length, ...shared);
            try { sessionStorage.setItem(conversationStorageKey, JSON.stringify(conversationHistory)); } catch {}
            renderConversationHistory();
        });
    }
    window.addEventListener("storage", event => {
        if (event.key !== "tgpl.accessToken" || event.newValue !== null) return;
        clearConversation(false);
        conversationChannel?.close();
    });
    function normalizedIntentText(text) {
        return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN");
    }
    function isAdminDailyIntakeQuestion(text) {
        if (user.role !== "ADMIN") return false;
        const normalized = normalizedIntentText(text);
        const asksReview = /(?:ra soat|tong hop|thong ke|lap phuong an|sap xep|xu ly theo lo)/.test(normalized);
        const asksToday = /(?:yeu cau moi|ho so moi|hom nay|trong ngay|ngay nay)/.test(normalized);
        const bothQueues = /hoi nghi/.test(normalized) && /(?:tu van|tro giup phap ly|tgpl)/.test(normalized);
        const allQueues = /(?:tat ca|toan bo|ca hai)/.test(normalized) && /(?:yeu cau|ho so)/.test(normalized);
        return asksReview && asksToday && (bothQueues || allQueues);
    }
    function dailyIntakeAnswer(data) {
        const date = data.date || "hôm nay";
        const conferences = data.conference_count || 0;
        const consultations = data.consultation_count || 0;
        if (data.no_requests) return `Rà soát ngày ${date}: chưa có yêu cầu hội nghị chờ duyệt hoặc yêu cầu tư vấn mới đang chờ phân công.`;
        const conflictCount = (data.conferences || []).filter(item => item.conflict).length;
        const unstaffed = (data.consultations || []).filter(item => !item.suggested_assignee).length;
        return `Rà soát yêu cầu mới ngày ${date}: ${conferences} yêu cầu hội nghị chờ duyệt và ${consultations} yêu cầu tư vấn chờ phân công (${data.total_count || 0} tổng). Bản nháp đề xuất phân tải theo số việc đang mở: ${conflictCount} hội nghị cần xử lý xung đột lịch; ${unstaffed} yêu cầu tư vấn chưa có cán bộ gợi ý. Mở từng hồ sơ bên dưới để admin kiểm tra và quyết định.`;
    }
    function addDailyIntakeReviewCard(answerBubble, data) {
        const card = document.createElement("section");
        card.className = "tgpl-ai-plan-card border rounded p-3 mt-2 bg-white";
        const heading = document.createElement("strong"); heading.textContent = `Bản rà soát theo lô · ${data.date || "hôm nay"}`; card.appendChild(heading);
        const note = document.createElement("p"); note.className = "small text-muted mb-2";
        note.textContent = data.note || "Bản nháp; chưa lưu phân công hay gửi thông báo."; card.appendChild(note);
        const addGroup = (title, rows, kind) => {
            const groupTitle = document.createElement("h6"); groupTitle.className = "mt-3 mb-2"; groupTitle.textContent = `${title} (${rows.length})`; card.appendChild(groupTitle);
            if (!rows.length) { const empty = document.createElement("p"); empty.className = "small text-muted"; empty.textContent = "Không có yêu cầu trong hàng đợi hôm nay."; card.appendChild(empty); return; }
            rows.forEach((row, index) => {
                const item = document.createElement("article"); item.className = "border rounded p-2 mb-2";
                const titleLine = document.createElement("div"); titleLine.className = "fw-semibold";
                titleLine.textContent = kind === "conference"
                    ? `${row.code || "Hội nghị"} · ${row.title} · ${row.organization_name}`
                    : `Yêu cầu tư vấn ${index + 1} · ${row.topic_summary} · ${row.organization_name}`;
                item.appendChild(titleLine);
                const details = document.createElement("div"); details.className = "small text-muted mt-1";
                if (kind === "conference") {
                    const start = row.requested_start ? new Date(row.requested_start).toLocaleString("vi-VN") : "chưa xác định";
                    const end = row.requested_end ? new Date(row.requested_end).toLocaleString("vi-VN") : "chưa xác định";
                    const proposed = row.schedule_changed && row.proposed_start
                        ? ` Đề xuất khung thay thế: ${new Date(row.proposed_start).toLocaleString("vi-VN")}${row.proposed_end ? ` – ${new Date(row.proposed_end).toLocaleString("vi-VN")}` : ""}.`
                        : "";
                    const conflictMessage = !row.conflict
                        ? "Không thấy trùng địa điểm/thời gian với lịch hội nghị đã duyệt hoặc hồ sơ trước trong lô."
                        : row.conflict.type === "PAST_REQUEST"
                            ? "⚠ Thời gian đăng ký đã qua; cần thống nhất lịch mới."
                            : `⚠ Trùng lịch với ${row.conflict.code || row.conflict.title} tại ${row.conflict.location}; cần rà soát.`;
                    details.textContent = `Thời gian đăng ký: ${start}${row.requested_end ? ` – ${end}` : ""} · Địa điểm: ${row.location} · Dự kiến ${row.expected_participants} người. ` +
                        conflictMessage + proposed +
                        ` Cán bộ gợi ý: ${row.proposed_assignee?.full_name || "chưa có cán bộ khả dụng"}; báo cáo viên gợi ý: ${row.proposed_speaker?.full_name || "chưa có báo cáo viên khả dụng"}.`;
                } else {
                    details.textContent = `Nhận lúc ${row.received_at ? new Date(row.received_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "hôm nay"} · Cán bộ gợi ý theo tải hiện tại: ${row.suggested_assignee?.full_name || "chưa có cán bộ khả dụng"}. Nội dung chi tiết chỉ xem trong hồ sơ.`;
                }
                item.appendChild(details);
                const link = document.createElement("a"); link.className = "btn btn-sm btn-outline-primary mt-2";
                link.href = row.review_url; link.textContent = kind === "conference" ? "Mở hồ sơ hội nghị để duyệt" : "Mở yêu cầu tư vấn để phân công";
                item.appendChild(link); card.appendChild(item);
            });
        };
        addGroup("Hội nghị chờ phê duyệt", data.conferences || [], "conference");
        addGroup("Yêu cầu tư vấn chờ phân công", data.consultations || [], "consultation");
        answerBubble.after(card);
    }
    function isConferencePlanningQuestion(text) {
        const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
        // A question that retrieves or summarizes existing records must stay on
        // the data-chat route, even when it contains words such as “đề xuất”,
        // “dự kiến tổ chức”, or “hội nghị”.
        const asksSurveySynthesis = /(?:tu|dua vao|can cu).{0,50}(?:phieu khao sat|khao sat).{0,100}(?:chon|uu tien|de xuat|goi y|chu de|noi dung)/.test(normalized);
        if (asksSurveySynthesis) return false;
        const asksForTaskPlan = /(?:de xuat|lap|goi y).{0,80}(?:danh sach )?(?:cac )?nhiem vu.{0,40}(?:can giao|phan cong)|(?:nhiem vu|cong viec).{0,50}(?:chia|phan bo|sap xep|nguoi nhan|can giao)/.test(normalized);
        // A planning request may also say “rà soát” and include a conference
        // code. Route it to the planner before the broad lookup detector sees
        // those retrieval terms; the planner still returns an uncommitted draft.
        if (asksForTaskPlan && /hoi nghi|tap huan|hn[-\s]?\d{2,}/.test(normalized)) return true;
        const asksForExistingData = /(?:phieu khao sat|khao sat|tong hop|thong ke|bao cao(?! vien)|bao nhieu|nhieu nhat|it nhat|danh sach|ra soat|tra cuu|tim hoi nghi|hoi nghi nao|noi dung hoi nghi nao|nhiem vu nao|cong viec nao|nhiem vu theo doi|kien nghi sau hoi nghi|chuyen thanh nhiem vu|trang thai|ma hoi nghi|o dau|khi nao|ngay nao|ai duoc phan cong|ai la bao cao vien)/.test(normalized);
        if (asksForExistingData) return false;
        const asksForScheduleOptions = /(?:lua chon|phuong an|de xuat|goi y|tim phuong an).{0,60}(?:ngay|buoi|khung gio)|(?:ngay|buoi|khung gio).{0,60}(?:lua chon|phuong an|de xuat|goi y)/.test(normalized)
            && /hoi nghi|tap huan|to chuc|hoi truong|lich/.test(normalized);
        const asksForPlanningRecommendation = /(?:chon|uu tien|de xuat|goi y).{0,60}(?:chu de|noi dung|quy mo|so luong dai bieu|thoi luong|nhiem vu).{0,60}(?:hoi nghi|tap huan|to chuc)|(?:hoi nghi|tap huan).{0,60}(?:chu de|noi dung|quy mo|so luong dai bieu).{0,60}(?:uu tien|phu hop|de xuat|goi y)/.test(normalized);
        const asksForPartnerPlan = /don vi.{0,60}phoi hop|phoi hop voi (?:don vi|co quan)|(?:goi y|de xuat|chon|tim).{0,50}(?:don vi|co quan).{0,40}phoi hop/.test(normalized);
        const asksToReviewPlan = /(?:ra soat|danh gia|kiem tra).{0,60}(?:phuong an|ke hoach).{0,80}(?:lich|dia diem|nhan su|quy mo|rủi ro|rui ro)?/.test(normalized);
        if (asksForScheduleOptions || asksForPlanningRecommendation || asksForTaskPlan || asksForPartnerPlan || asksToReviewPlan) return true;
        const asksForPlan = /(?:de xuat\s+(?:hoi nghi|tap huan|chu de|noi dung|to chuc|lap|phuong an|ke hoach)|goi y\s+(?:to chuc|hoi nghi|tap huan|chu de|ke hoach)|lap ke hoach|len ke hoach|lap phuong an|xay dung phuong an|chuan bi to chuc|can to chuc|muon to chuc|giup toi to chuc|to chuc giup toi|moi nguoi dan du|muon tuyen truyen|tuyen truyen phap luat|mo buoi pho bien|pho bien phap luat)/.test(normalized);
        const namesAUnit = /(?:xa|phuong|don vi)\s+[a-z0-9]/.test(normalized);
        const explicitPlan = /(?:lap|xay dung|len).{0,20}(?:ke hoach|phuong an)/.test(normalized);
        const mentionsEvent = /hoi nghi|tap huan|su kien|to chuc/.test(normalized);
        const trainingForLocalAudience = /tap huan/.test(normalized) && (namesAUnit || /xa toi|phuong toi|don vi toi/.test(normalized));
        const legalOutreachRequest = /(?:tuyen truyen|pho bien|mo buoi pho bien)/.test(normalized) && /(?:phap luat|luat|tro giup phap ly)/.test(normalized) && /(?:ba con|nguoi dan|don vi toi|ben toi|xa toi|phuong toi)/.test(normalized);
        // Natural requests often start with the action (“Tổ chức hội nghị…”),
        // rather than “Đề xuất/Lập kế hoạch…”. Route those to the planner only
        // when both an event and a target audience/place are named.
        const organizeForAudience = /^\s*to chuc\s+/.test(normalized)
            && /hoi nghi|tap huan|su kien/.test(normalized)
            && (namesAUnit || /can bo|nguoi dan|cong chuc/.test(normalized));
        const asksAssignmentPlan = /(?:chon|goi y|phan cong|giao).{0,50}(?:bao cao vien|can bo|nhiem vu)/.test(normalized) && !asksForExistingData;
        return explicitPlan || trainingForLocalAudience || legalOutreachRequest || organizeForAudience || asksAssignmentPlan || (asksForPlan && (mentionsEvent || namesAUnit));
    }
    function isPlanningFollowUp(text) {
        const priorPlan = [...conversationHistory].reverse().find(item => item.role === "user" && isConferencePlanningQuestion(item.content));
        if (!priorPlan) return false;
        const normalized = normalizedIntentText(text);
        // Named-account task counts/ratings are database lookups. They must
        // start a fresh data query even when a conference plan is earlier in
        // this chat, rather than inheriting the planner's missing fields.
        if (/(?:tai khoan\s+[a-z0-9._-]+).{0,100}(?:nhiem vu|cong viec)/.test(normalized) &&
            /(?:bao nhieu|diem trung binh|danh gia|tren\s*3\s*diem|cao hon\s*3)/.test(normalized)) return false;
        // A lookup for a concrete conference or an existing record is a new
        // data request, even if a previous planning turn mentioned dates,
        // venues, staffing, or options. Without this guard those terms cause
        // an unrelated lookup (e.g. “HN-0019 diễn ra ngày nào?”) to be sent
        // to the planner and answered with a request for planning details.
        const asksForExistingData = /(?:\bhn\s*[-–—]?\s*\d{2,}\b|hoi nghi nao|nhiem vu nao|tra cuu|liet ke|bao nhieu hoi nghi|thang\s+\d{1,2}|quy\s+(?:i{1,3}|iv|[1-4])|nam\s+\d{4}|trang thai|tinh trang|o dau|dia diem|khi nao|ngay nao|bao cao vien|ai duoc phan cong)/.test(normalized);
        if (asksForExistingData) return false;
        const planIndex = conversationHistory.lastIndexOf(priorPlan);
        const lastAssistant = conversationHistory.slice(planIndex + 1).reverse().find(item => item.role === "assistant");
        const assistantAskedForPlanSlot = Boolean(lastAssistant && /[?？]/.test(lastAssistant.content)
            && /(?:vui long cho biet|can lam ro|xin cho biet|cho biet them)/.test(normalizedIntentText(lastAssistant.content))
            && /(?:dia ban|don vi|thoi gian|thang nao|chu de|quy mo|doi tuong|dia diem)/.test(normalizedIntentText(lastAssistant.content)));
        const shortClarificationAnswer = normalized.split(/\s+/).filter(Boolean).length <= 12
            && /(?:\bxa\b|\bphuong\b|ubnd|thang\s+\d|quy\s+[1-4]|\b20\d{2}\b|can bo|nguoi dan|\d{1,4}\s*nguoi)/.test(normalized);
        if (assistantAskedForPlanSlot && shortClarificationAnswer) return true;
        // A new legal lookup or a request to retrieve existing records starts a
        // new topic. Short references to schedule, venue, staffing, or options
        // stay attached to the recent planning request.
        if (/(?:dieu\s*\d+|luat .* quy dinh|hoi nghi nao|nhiem vu nao|tra cuu|liet ke|bao nhieu hoi nghi)/.test(normalized)) return false;
        return normalized.split(/\s+/).filter(Boolean).length <= 14 &&
            /(?:\bcon\b|\bvay\b|\bthem\b|\bdoi\b|\bchon\b|phuong an|ke hoach|ngay|khung gio|dia diem|quy mo|so luong|nhiem vu|bao cao vien|don vi phoi hop)/.test(normalized);
    }
    function isConferencePlanReviewQuestion(text) {
        const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
        return /(?:ra soat|danh gia|kiem tra).{0,70}(?:toan bo phuong an|phuong an nay|ke hoach nay|phuong an)/.test(normalized);
    }
    function explicitConferenceTaskPlanCode(text) {
        const normalized = normalizedIntentText(text);
        // “Ai đã được phân công/báo cáo viên?” asks for existing records; it
        // must never create a draft plan merely because the wording contains
        // “phân công” and “báo cáo viên”.
        const asksForExistingAssignment = /(?:ai duoc phan cong|nguoi nao duoc phan cong|nguoi duoc phan cong|can bo nao duoc phan cong|ai la bao cao vien|bao cao vien nao|ai la nguoi thuyet trinh|da phan cong cho ai|ai dang nhan nhiem vu|nguoi nhan nhiem vu nao)/.test(normalized);
        if (asksForExistingAssignment) return "";
        const asksForTasks = /(?:de xuat|lap|goi y|ra soat).{0,90}(?:danh sach )?(?:cac )?nhiem vu|(?:nhiem vu|cong viec).{0,70}(?:can giao|phan cong)|(?:de xuat|lap|goi y|ra soat).{0,80}(?:phan cong|giao).{0,60}(?:can bo|bao cao vien|nhiem vu)|(?:phan cong|giao).{0,60}(?:can bo|bao cao vien|nhiem vu)|(?:de xuat|lap|goi y|ra soat).{0,60}(?:phuong an|ke hoach).{0,60}(?:to chuc|nhan su|can bo|bao cao vien)/.test(normalized);
        const asksForReschedulePlan = /(?:lap|xay dung|de xuat|goi y).{0,55}(?:ke hoach|phuong an).{0,45}(?:doi lich|chuyen lich)|(?:doi lich|chuyen lich).{0,55}(?:hoi nghi|hn\s*[-–—]?\s*\d{2,})/.test(normalized);
        if (!asksForTasks && !asksForReschedulePlan) return "";
        return String(text || "").match(/\bHN\s*[-–—]?\s*\d{3,}\b/i)?.[0]?.toUpperCase().replace(/\s+/g, "").replace(/^(HN)(\d)/, "$1-$2") || "";
    }
    function isExplicitConferenceReschedulePlan(text) {
        const normalized = normalizedIntentText(text);
        return /(?:lap|xay dung|de xuat|goi y).{0,55}(?:ke hoach|phuong an).{0,45}(?:doi lich|chuyen lich)|(?:doi lich|chuyen lich).{0,55}(?:hoi nghi|hn\s*[-–—]?\s*\d{2,})/.test(normalized);
    }
    function conferenceTaskPlanAnswer(data, code) {
        const plan = data.plan || data.alternatives?.[0] || null;
        const conference = data.evidence?.conference || {};
        if (!plan) {
            const shortage = data.staffing_resolution?.shortage;
            if (shortage) {
                const availability = data.evidence?.available_staff_next_three_days || {};
                const summarize = items => (items || []).slice(0, 5).map(person => `${person.full_name}${person.username ? ` (${person.username})` : ""}: ${(person.free_dates || []).join(", ")}`).join("; ") || "chưa có người phù hợp";
                return `${code}: chưa có phương án nhân sự khả thi trong các khung đã rà soát (thiếu ${Number(shortage.staff || 0)} vị trí cán bộ, ${Number(shortage.speakers || 0)} vị trí báo cáo viên). Cán bộ rảnh 3 ngày tới: ${summarize(availability.task_assignees)}. Báo cáo viên: ${summarize(availability.speakers)}. Admin cần chọn hướng xử lý; chưa lưu phân công, chưa gửi thông báo.`;
            }
            return `${code}: hệ thống chưa tạo được bản nháp. Hãy kiểm tra hồ sơ hội nghị và thử lại. Chưa lưu phân công, chưa gửi thông báo.`;
        }
        const chosen = (data.alternatives || []).find(option => option.id === plan.id) || plan;
        const staffing = chosen.staffing_plan || plan.staffing_plan || {};
        const roster = [
            ...(data.eligible_task_assignees || data.evidence?.eligible_task_assignees || []),
            ...(data.eligible_speakers || data.evidence?.eligible_speakers || []),
            ...(staffing.staff?.primary || []), staffing.staff?.backup,
            staffing.speakers?.primary, staffing.speakers?.backup
        ].filter(Boolean);
                const people = new Map();
        for (const person of roster) {
            const key = String(person.id);
            people.set(key, { ...(people.get(key) || {}), ...person });
        }
        const tasks = (chosen.tasks || []).map((task, index) => {
            const person = people.get(String(task.assignee_user_id));
            const assignee = person ? `${person.full_name}${person.username ? ` (${person.username})` : ""}` : "cần admin chọn";
            const basis = person ? `; ${person.organization_name || "đơn vị chưa ghi nhận"}; tải ${person.monthly_count ?? "?"}/5 nhiệm vụ tháng, ${person.weekly_count ?? "?"}/2 nhiệm vụ tuần` : "";
            const deadline = task.due_at ? new Date(task.due_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "chưa xác định";
            return `• ${task.title} — ${assignee}${task.staffing_role === "BACKUP_SUPPORT" ? " (dự bị)" : " (chính thức)"}${basis}; hạn ${deadline}`;
        });
        const staffBackup = staffing.staff?.backup;
        const staffBackupAlreadyListed = (chosen.tasks || []).some(task => task.staffing_role === "BACKUP_SUPPORT" && String(task.assignee_user_id) === String(staffBackup?.id));
        const staffBackupLine = staffBackupAlreadyListed
            ? ""
            : staffBackup
                ? `\n• Cán bộ dự bị — ${staffBackup.full_name || "chưa rõ tên"}${staffBackup.username ? ` (${staffBackup.username})` : ""}; tải ${staffBackup.monthly_count ?? "?"}/5 nhiệm vụ tháng, ${staffBackup.weekly_count ?? "?"}/2 nhiệm vụ tuần.`
                : "\n• Cán bộ dự bị — chưa có dữ liệu xác nhận trong phương án; admin cần bổ sung trước khi duyệt.";
        const speakers = (chosen.speakers || []).map(speaker => {
            const person = people.get(String(speaker.speaker_user_id));
            const account = person ? `${person.full_name}${person.username ? ` (${person.username})` : ""}` : "cần admin xác nhận";
            const load = person ? `; tải ${person.monthly_count ?? "?"}/3 nhiệm vụ tháng, ${person.weekly_count ?? "?"}/1 nhiệm vụ tuần` : "";
            return `• ${account} — ${speaker.staffing_role === "BACKUP" ? "dự bị" : "chính thức"}${load}; ${speaker.presentation_title || speaker.topic || conference.title || "chuyên đề hội nghị"}`;
        });
        const chosenDate = (data.evidence?.available_dates || []).find(option => option.id === chosen.schedule_option_id);
        const date = chosenDate?.start_time ? new Date(chosenDate.start_time).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "chưa có ngày khả thi";
        const formatDateRange = (start, end) => start ? `${new Date(start).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}${end ? ` đến ${new Date(end).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}` : "chưa ghi nhận";
        const dateKey = value => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "";
        const requestedDateChanged = Boolean(conference.requested_start && chosenDate?.start_time && dateKey(conference.requested_start) !== dateKey(chosenDate.start_time));
        const explicitReschedule = Boolean(data.staffing_resolution?.requested_reschedule);
        const scheduleLine = requestedDateChanged || explicitReschedule
            ? `• Lịch hồ sơ hiện tại: ${formatDateRange(conference.requested_start, conference.requested_end)}. Phương án nhân sự đề xuất ngày ${date} sau khi kiểm tra lịch và hạn mức; đây là đề xuất đổi lịch, lịch hiện tại chưa thay đổi và cần admin phê duyệt.\n`
            : `• Thời gian đề xuất: ${date}.\n`;
        const location = conference.location || "chưa cập nhật";
        return `Phương án nháp ${code} — ${conference.title || "hội nghị"} (${conference.status || "chưa rõ trạng thái"})\n${scheduleLine}• Địa điểm hồ sơ: ${location}.\n• Nhiệm vụ:\n${tasks.join("\n") || "• Chưa có nhiệm vụ khả thi được xác nhận."}${staffBackupLine}\n• Báo cáo viên:\n${speakers.join("\n") || "• Chưa có báo cáo viên phù hợp được xác nhận."}\n• Căn cứ: hạn mức, tải phân công và lịch đã lưu; các nội dung chuyên môn chưa có dữ liệu được đánh dấu để admin rà soát.\nĐây chỉ là phương án chờ admin phê duyệt. Chưa lưu phân công và chưa gửi thông báo cho người đăng ký.`;
    }
    function buildConferencePlanningPrompt(question) {
        // Keep the original user query as the API's request field. The backend
        // owns planner instructions; wrapping instructions into the user query
        // caused the model to mistake guidance text for the event title.
        return String(question || "").trim();
    }
    function isConferenceMaterialsQuestion(text) {
        const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
        return /(?:tai lieu|giay to|ho so tai lieu|ho so can chuan bi).{0,45}(?:hoi nghi|tap huan|buoi nay)|(?:can chuan bi|chuan bi).{0,45}(?:tai lieu|giay to)/.test(normalized);
    }
    function isLegalAidDocumentsFollowUp(text) {
        const normalizeText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
        const normalized = normalizeText(text);
        const asksForDocuments = /giay to|ho so|nguoi yeu cau.{0,60}chuan bi/.test(normalized);
        if (!asksForDocuments) return false;
        if (/tro giup phap ly|\btgpl\b|luat tro giup|yeu cau tro giup|dieu\s*29/.test(normalized)) return true;
        // “Người yêu cầu cần chuẩn bị giấy tờ gì?” is a legal-procedure
        // follow-up even when the current sentence omits the law's name.
        if (/nguoi yeu cau/.test(normalized)) return true;
        const recentTopics = conversationHistory.filter(item => item.role === "user").slice(-6);
        for (const item of recentTopics.reverse()) {
            const prior = normalizeText(item.content);
            if (/tro giup phap ly|\btgpl\b|luat tro giup|yeu cau tro giup|doi tuong duoc tro giup/.test(prior)) return true;
            if (/hoi nghi|tap huan|buoi tap huan/.test(prior)) return false;
        }
        return false;
    }
    function isGenericTaskFrameworkQuestion(text) {
        const normalized = normalizedIntentText(text);
        return /(?:chia|phan nhom|gom).{0,45}(?:nhiem vu|cong viec).{0,45}(?:truoc|trong|sau)|(?:nhiem vu|cong viec).{0,40}(?:truoc|trong).{0,30}sau/.test(normalized)
            && !/(?:phan cong lai|chon nguoi|ai lam|ma hoi nghi|hn-\d+)/.test(normalized);
    }
    function genericTaskFrameworkAnswer() {
        return "Khung nhiệm vụ tham khảo (chưa tạo hoặc giao việc):\n• Trước hội nghị: trước 7 ngày xác nhận địa điểm, chương trình và đại biểu; trước 3 ngày hoàn tất giấy mời, tài liệu; trước 1 ngày kiểm tra hội trường và thiết bị. Đầu ra: danh sách xác nhận, bộ tài liệu và biên bản kiểm tra.\n• Trong hội nghị: đón tiếp, điểm danh, hỗ trợ kỹ thuật và ghi biên bản; hoàn thành trong ngày. Đầu ra: danh sách tham dự và biên bản.\n• Sau hội nghị: trong 1–3 ngày làm việc thu phiếu đánh giá, tổng hợp kết quả và kiến nghị. Đầu ra: báo cáo kết quả, số liệu tham dự và danh sách việc cần theo dõi.\nMuốn đặt hạn theo lịch thực tế hoặc gợi ý người nhận, hãy cung cấp mã/ngày hội nghị; mọi phân công vẫn cần admin xác nhận.";
    }
    function isTrainingTopicSuggestion(text) {
        const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
        return /(?:de xuat|goi y).{0,20}chu de/.test(normalized) && /tap huan/.test(normalized);
    }
    function trainingTopicSuggestionAnswer() {
        return "Gợi ý chủ đề: “Quyền được trợ giúp pháp lý, nhận diện nhóm người được trợ giúp và cách gửi yêu cầu”. Với 40 cán bộ, có thể tổ chức theo hướng thực hành tình huống và quy trình hướng dẫn người dân. Đây là gợi ý chủ đề; khi lập kế hoạch đầy đủ, cần xác định đơn vị và thời gian, đồng thời rà soát tài liệu pháp luật hiện hành.";
    }
    function conferenceMaterialsAnswer() {
        const recent = conversationHistory.slice(-6);
        const normalizeText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
        const eventQuestion = [...recent].reverse().find(item => item.role === "user" && /hoi nghi|tap huan|to chuc/.test(normalizeText(item.content)));
        if (!eventQuestion) return "Bạn đang hỏi về hội nghị/tập huấn nào? Hãy cho biết chủ đề hoặc mã hội nghị để tôi gợi ý tài liệu đúng nội dung.";
        const normalized = normalizeText(eventQuestion.content);
        const topicDocs = /tro giup phap ly|tgpl/.test(normalized)
            ? "văn bản Luật Trợ giúp pháp lý đã được kiểm tra hiệu lực; tài liệu nhận diện đối tượng và cách gửi yêu cầu; tình huống hỏi đáp đã ẩn thông tin cá nhân"
            : "văn bản pháp luật chính thức còn hiệu lực liên quan chủ đề; đề cương/bài trình chiếu; tình huống hỏi đáp đã rà soát";
        return `Với hội nghị/tập huấn vừa trao đổi, nên chuẩn bị: ${topicDocs}; chương trình và mục tiêu buổi tập huấn; danh sách đại biểu, giấy mời và phiếu điểm danh; phiếu đánh giá sau hội nghị; máy chiếu, âm thanh và bản tài liệu phát tay.`;
    }
    function isClearFollowUpQuestion(text) {
        const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
        return /^(?:con\b|vay\b|the\b|neu vay\b|cu the\b|noi ro hon\b|giai thich them\b|y toi la\b|truong hop do\b|cau tra loi do\b|van de nay\b|hoi nghi do\b|hoi nghi nay\b|muc do\b|con ve\b)/.test(normalized)
            || /\b(?:van de nay|cau tren|cau tra loi vua roi|noi dung vua neu|hoi nghi do|hoi nghi nay|don vi do|muc do|theo y tren)\b/.test(normalized);
    }
    function planningAnswer(data) {
        const plan = data.proposal || {};
        const resolution = data.staffing_resolution || {};
        if (resolution.status === "STAFFING_SHORTAGE") {
            const shortage = resolution.shortage || {};
            const options = (resolution.admin_options || []).map((item, index) => `${index + 1}. ${item}`).join("\n");
            const available = data.available_staff_next_three_days || {};
            const summarize = people => (people || []).slice(0, 5).map(person => `${person.full_name} (${(person.free_dates || []).join(", ")})`).join("; ") || "chưa có người phù hợp";
            return `Chưa thể đề xuất phân công hoàn chỉnh: đang thiếu ${Number(shortage.staff || 0)} vị trí cán bộ và ${Number(shortage.speakers || 0)} vị trí báo cáo viên theo cơ cấu yêu cầu. Tôi không tạo danh sách phân công thiếu hoặc vượt hạn mức.\nNgười đủ hạn mức, trống lịch trong 3 ngày tới — cán bộ: ${summarize(available.task_assignees)}; báo cáo viên: ${summarize(available.speakers)}.\nAdmin có thể chọn một hướng xử lý:\n${options}\nChưa lưu phân công và chưa gửi thông báo.`;
        }
        const availableSlots = Array.isArray(data.available_time_slots) ? data.available_time_slots.slice(0, 3) : [];
        const slotList = availableSlots.map((item, index) => `${index + 1}) ${item.label}`).join("; ");
        const slot = data.selected_time_slot?.label
            ? `\n${resolution.status === "ALTERNATIVE_DATE_REQUIRED" ? "Khung sớm hơn không đủ người theo hạn mức; đây là ngày thay thế đã được kiểm tra đủ nhân sự. " : ""}Khung giờ khả dụng (chưa lưu): ${slotList || data.selected_time_slot.label}. Mặc định chọn ${data.selected_time_slot.label}; có thể đổi trong thẻ xác nhận.`
            : "";
        const units = (plan.suggested_units || []).map(item => item.name).filter(Boolean).join(", ");
        const documents = (plan.documents || []).slice(0, 5).join("; ");
        const staffing = plan.staffing_plan || {};
        const staff = staffing.staff || {};
        const speakers = staffing.speakers || {};
        const staffNames = [...(staff.primary || []).map(person => `chính thức ${person.full_name}`), ...(staff.backup ? [`dự bị ${staff.backup.full_name}`] : [])].join(", ");
        const speakerNames = [speakers.primary ? `chính thức ${speakers.primary.full_name}` : "", speakers.backup ? `dự bị ${speakers.backup.full_name}` : ""].filter(Boolean).join(", ");
        const shortages = [];
        const available = data.available_staff_next_three_days || {};
        if (staff.primary_shortfall || !staff.backup_available) shortages.push(`Cán bộ còn thiếu; trống lịch 3 ngày tới: ${(available.task_assignees || []).slice(0, 5).map(person => `${person.full_name} (${person.free_dates.join(", ")})`).join("; ") || "chưa có người phù hợp"}`);
        if (speakers.primary_shortfall || !speakers.backup_available) shortages.push(`Báo cáo viên còn thiếu; trống lịch 3 ngày tới: ${(available.speakers || []).slice(0, 5).map(person => `${person.full_name} (${person.free_dates.join(", ")})`).join("; ") || "chưa có người phù hợp"}`);
        const staffingText = resolution.status === "ADMIN_ASSIGNMENT_REQUIRED"
            ? "\n• Nhân sự chưa được gán trong bản gợi ý; admin sẽ kiểm tra hạn mức và lập phương án phân công phù hợp trước khi duyệt."
            : `\n• Cán bộ: ${staffNames || "chưa đủ người phù hợp"} (tối đa 5 nhiệm vụ/tháng, 2/tuần mỗi người; 3 chính thức + 1 dự bị).\n• Báo cáo viên: ${speakerNames || "chưa đủ người phù hợp"} (tối đa 3 lượt/tháng, 1/tuần mỗi người; 1 chính thức + 1 dự bị).${shortages.length ? `\n• ${shortages.join("\n• ")}` : ""}`;
        return `Bản gợi ý kế hoạch (chưa lưu, chưa gửi thông báo):\n• Đơn vị/địa bàn: ${plan.organization_name || "cần xác nhận"}\n• Địa điểm: ${plan.location || "cần xác nhận"}${slot}\n• Quy mô dự kiến: ${plan.expected_attendees || "cần xác nhận"} người\n• Chủ đề: ${plan.legal_topic || "cần xác nhận"}\n• Tài liệu: ${documents || "cần xác định theo chủ đề"}\n• Căn cứ gợi ý: ${plan.rationale || "cần rà soát nhu cầu thực tế"}${staffingText}\n• Đơn vị có thể phối hợp: ${units || "cần admin chọn"}\n• Nhiệm vụ gợi ý: ${(plan.tasks || []).length}. Xác nhận từng mục bên dưới để điền biểu mẫu; thông báo chỉ gửi sau khi admin xác nhận từng đơn vị.`;
    }
    function addProposalCard(answerBubble, data) {
        const plan = data.proposal || {};
        const card = document.createElement("section");
        card.className = "tgpl-ai-plan-card border rounded p-3 mt-2 bg-white";
        const heading = document.createElement("strong"); heading.textContent = "Rà soát và xác nhận từng đề xuất"; card.appendChild(heading);
        const note = document.createElement("p"); note.className = "small text-muted mb-2";
        note.textContent = "Chỉ mục bạn xác nhận mới được điền biểu mẫu. Không có nhiệm vụ nào được giao và không có thông báo nào tự gửi."; card.appendChild(note);
        const status = document.createElement("div"); status.className = "small text-muted mt-2"; card.appendChild(status);
        const taskAssignees = data.eligible_task_assignees || [];
        const speakers = data.eligible_speakers || [];
        function addConfirmRow(title, description, actionLabel, action, canAct = true) {
            const row = document.createElement("div"); row.className = "border rounded p-2 mb-2";
            const strong = document.createElement("div"); strong.className = "fw-semibold"; strong.textContent = title; row.appendChild(strong);
            const detail = document.createElement("div"); detail.className = "small text-muted mb-2"; detail.textContent = description || ""; row.appendChild(detail);
            const confirmLabel = document.createElement("label"); confirmLabel.className = "form-check small mb-2";
            const check = document.createElement("input"); check.type = "checkbox"; check.className = "form-check-input me-2";
            const checkText = document.createElement("span"); checkText.textContent = "Tôi xác nhận dùng gợi ý này"; confirmLabel.append(check, checkText); row.appendChild(confirmLabel);
            const button = document.createElement("button"); button.type = "button"; button.className = "btn btn-sm btn-outline-primary"; button.textContent = actionLabel; button.disabled = true;
            if (!canAct) { check.disabled = true; button.title = "Thao tác này không thuộc quyền tài khoản."; }
            check.addEventListener("change", () => { button.disabled = !check.checked; });
            button.addEventListener("click", async () => {
                if (!check.checked) return;
                button.disabled = true;
                try {
                    const completed = await action();
                    if (completed !== false) { check.disabled = true; button.disabled = true; }
                    else button.disabled = !check.checked;
                } catch (error) { status.textContent = error.message || "Chưa thực hiện được thao tác."; button.disabled = !check.checked; }
            });
            row.appendChild(button); card.insertBefore(row, status);
        }
        const availableSlots = Array.isArray(data.available_time_slots) ? data.available_time_slots : [];
        let timeSlot = data.selected_time_slot || availableSlots[0] || null;
        const conferenceDraft = { title: plan.title || "", organization_id: plan.organization_id || "", organization_name: plan.organization_name || "",
            start_time: timeSlot?.start_time || "", end_time: timeSlot?.end_time || "", location: plan.location || "",
            expected_participants: plan.expected_attendees || "", description: [`Chủ đề đề xuất: ${plan.legal_topic || ""}`, plan.rationale || "",
                "Tài liệu cần chuẩn bị:", ...(plan.documents || []).map((item, index) => `${index + 1}. ${item}`)].filter(Boolean).join("\n") };
        if (availableSlots.length > 1) {
            const slotLabel = document.createElement("label"); slotLabel.className = "form-label small fw-semibold"; slotLabel.textContent = "Chọn khung giờ khả dụng";
            const slotSelect = document.createElement("select"); slotSelect.className = "form-select form-select-sm mb-2";
            availableSlots.forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; slotSelect.appendChild(option); });
            slotSelect.value = timeSlot?.id || availableSlots[0].id;
            slotSelect.addEventListener("change", () => {
                timeSlot = availableSlots.find(item => item.id === slotSelect.value) || availableSlots[0];
                conferenceDraft.start_time = timeSlot.start_time; conferenceDraft.end_time = timeSlot.end_time;
            });
            card.insertBefore(slotLabel, status); card.insertBefore(slotSelect, status);
        }
        addConfirmRow("Thông tin hội nghị", `${conferenceDraft.title} · ${conferenceDraft.location} · ${conferenceDraft.expected_participants} người`, "Xác nhận & điền biểu mẫu", async () => {
            if (!['ADMIN', 'COMMUNE'].includes(user.role)) throw new Error("Tài khoản này có thể xem phương án; chỉ admin hoặc người đăng ký mới được mở biểu mẫu hội nghị.");
            const form = document.getElementById("conferenceForm");
            if (form) { window.dispatchEvent(new CustomEvent("tgpl:apply-conference-plan", { detail: conferenceDraft })); status.textContent = "Đã điền thông tin vào biểu mẫu. Rà soát rồi tự bấm Lưu đăng ký khi sẵn sàng."; return; }
            sessionStorage.setItem("tgpl.ai.pending-conference-plan", JSON.stringify(conferenceDraft));
            location.assign(new URL("create-conference.html", location.href).href);
        }, ["ADMIN", "COMMUNE"].includes(user.role));
        (plan.tasks || []).forEach((task, index) => {
            const assignee = taskAssignees.find(person => String(person.id) === String(task.assignee_user_id));
            const label = assignee ? ` · ${assignee.full_name}${assignee.organization_name ? ` (${assignee.organization_name})` : ""}` : " · admin chọn cán bộ";
            addConfirmRow(`Nhiệm vụ ${index + 1}: ${task.title || "Chuẩn bị hội nghị"}`, `${task.description || ""}${label}`, "Xác nhận & điền biểu mẫu nhiệm vụ", async () => {
                if (user.role !== "ADMIN") throw new Error("Bạn có thể xem gợi ý; chỉ admin mới được điền biểu mẫu phân công.");
                const title = document.getElementById("assignmentTitle");
                if (!title) throw new Error("Mở chi tiết một hội nghị trong Danh sách hội nghị để điền biểu mẫu nhiệm vụ. Chưa có nhiệm vụ nào được giao.");
                title.value = task.title || "";
                const descriptionInput = document.getElementById("assignmentDescription"); if (descriptionInput) descriptionInput.value = task.description || "";
                const assigneeInput = document.getElementById("assignmentAssignee"); if (assigneeInput && assignee) { assigneeInput.value = assignee.id; assigneeInput.dispatchEvent(new Event("change", { bubbles: true })); }
                const organizationInput = document.getElementById("assignmentOrganization"); if (organizationInput) organizationInput.value = assignee?.organization_name || "";
                const dueInput = document.getElementById("assignmentDueAt"); if (dueInput && task.due_at) { const due = new Date(task.due_at); dueInput.value = Number.isNaN(due.getTime()) ? "" : new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
                title.scrollIntoView({ behavior: "smooth", block: "center" }); status.textContent = "Đã điền biểu mẫu nhiệm vụ; admin rà soát rồi tự bấm Giao nhiệm vụ để lưu.";
            }, user.role === "ADMIN");
        });
        (plan.speakers || []).forEach((speaker, index) => {
            const person = speakers.find(item => String(item.id) === String(speaker.speaker_user_id));
            addConfirmRow(`Báo cáo viên ${index + 1}: ${person?.full_name || "chưa chọn"}`, `${speaker.topic || ""}${person?.organization_name ? ` · ${person.organization_name}` : ""}`, "Xác nhận & điền biểu mẫu báo cáo viên", async () => {
                if (user.role !== "ADMIN") throw new Error("Chỉ admin mới được điền biểu mẫu phân công báo cáo viên.");
                const nameInput = document.getElementById("speakerName");
                if (!nameInput) throw new Error("Mở chi tiết hội nghị để điền biểu mẫu báo cáo viên. Chưa có phân công nào được lưu.");
                nameInput.value = speaker.speaker_user_id || "";
                const topicInput = document.getElementById("speakerTopic"); if (topicInput) topicInput.value = speaker.topic || plan.legal_topic || "";
                const notes = document.getElementById("speakerNotes"); if (notes) notes.value = speaker.notes || "";
                nameInput.scrollIntoView({ behavior: "smooth", block: "center" }); status.textContent = "Đã điền biểu mẫu báo cáo viên; admin rà soát rồi tự bấm Thêm báo cáo viên để lưu.";
            }, user.role === "ADMIN");
        });
        (plan.notification_drafts || []).forEach(draft => {
            const organization = (plan.suggested_units || []).find(item => String(item.id) === String(draft.organization_id));
            if (user.role !== "ADMIN") {
                const item = document.createElement("p"); item.className = "small text-muted";
                item.textContent = `Bản nháp thông báo cho ${organization?.name || "đơn vị"}: ${draft.message} (Chỉ admin có quyền gửi.)`; card.insertBefore(item, status);
            } else addConfirmRow(`Thông báo đến ${organization?.name || "đơn vị"}`, draft.message, "Admin xác nhận & gửi thông báo", async () => {
                if (!window.confirm(`Gửi thông báo này đến ${organization?.name || "đơn vị"}?\n\n${draft.message}`)) return false;
                await sendConferencePlanNotification({ organization_id: draft.organization_id, subject: plan.title || "Đề xuất hội nghị, tập huấn", message: draft.message });
                status.textContent = `Đã gửi thông báo đến ${organization?.name || "đơn vị"}.`;
            });
        });
        answerBubble.after(card);
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
        const reason = document.createElement("select");
        reason.className = "form-select form-select-sm d-inline-block ms-2";
        reason.style.maxWidth = "190px";
        reason.hidden = true;
        reason.setAttribute("aria-label", "Lý do câu trả lời chưa chính xác");
        [["", "Chọn lý do"], ["WRONG_DATA", "Sai dữ liệu"], ["WRONG_SCOPE", "Sai phạm vi"], ["IRRELEVANT", "Lạc đề"], ["INCOMPLETE", "Thiếu ý"], ["TOO_LONG", "Quá dài"], ["MISSING_SOURCE", "Thiếu căn cứ"], ["OTHER", "Lý do khác"]].forEach(([value, labelText]) => {
            const option = document.createElement("option"); option.value = value; option.textContent = labelText; reason.appendChild(option);
        });
        const submitIncorrect = document.createElement("button");
        submitIncorrect.type = "button"; submitIncorrect.className = "btn btn-sm btn-danger ms-2"; submitIncorrect.textContent = "Gửi góp ý"; submitIncorrect.hidden = true;
        const status = document.createElement("span"); status.className = "ms-2 text-muted";
        async function vote(value, reasonCode = "UNSPECIFIED") {
            correct.disabled = incorrect.disabled = true;
            submitIncorrect.disabled = true;
            try {
                await submitAiAnswerFeedback({ question, answer, vote: value, reason_code: reasonCode, sources: sources || [] });
                status.textContent = value === "INCORRECT" ? "Đã gửi cho quản trị viên rà soát." : "Cảm ơn bạn đã phản hồi.";
            } catch (error) {
                correct.disabled = incorrect.disabled = false;
                submitIncorrect.disabled = false;
                status.textContent = error.message || "Chưa gửi được phản hồi.";
            }
        }
        correct.addEventListener("click", () => vote("CORRECT"));
        incorrect.addEventListener("click", () => { incorrect.hidden = true; reason.hidden = false; submitIncorrect.hidden = false; reason.focus(); });
        submitIncorrect.addEventListener("click", () => {
            if (!reason.value) { reason.focus(); status.textContent = "Chọn lý do để admin biết cần rà soát điều gì."; return; }
            vote("INCORRECT", reason.value);
        });
        tools.append(correct, incorrect, reason, submitIncorrect, status);
        answerBubble.after(tools);
    }

    let inboxLoaded = false;
    const shownNoticeIds = new Set();
    async function loadPlanNotifications() {
        if (inboxLoaded || typeof getConferencePlanNotifications !== "function") return;
        inboxLoaded = true;
        try {
            const result = await getConferencePlanNotifications();
            const rows = (result.data || []).filter(item => item && !shownNoticeIds.has(String(item.id))).slice(0, 20);
            if (!rows.length) return;
            const heading = addMessage("assistant-message-bot", "Thông báo kế hoạch hội nghị gửi đến tài khoản/đơn vị của bạn:");
            rows.reverse().forEach(item => {
                shownNoticeIds.add(String(item.id));
                const block = document.createElement("div"); block.className = "assistant-message assistant-message-bot";
                const title = document.createElement("strong"); title.textContent = item.subject || "Thông báo hội nghị";
                const detail = document.createElement("p"); detail.className = "mb-1"; detail.textContent = `${item.conference_code ? `${item.conference_code} · ` : ""}${item.message || ""}`;
                const meta = document.createElement("small"); meta.className = "text-muted"; meta.textContent = `${item.organization_name || "Đơn vị"} · ${item.sender_name || "Admin"} · ${new Date(item.created_at).toLocaleString("vi-VN")}`;
                block.append(title, detail, meta);
                if (!item.read_at) {
                    const readButton = document.createElement("button"); readButton.type = "button"; readButton.className = "btn btn-sm btn-outline-secondary d-block mt-2"; readButton.textContent = "Đánh dấu đã đọc";
                    readButton.addEventListener("click", async () => { try { await markConferencePlanNotificationRead(item.id); readButton.disabled = true; readButton.textContent = "Đã đọc"; } catch (error) { readButton.title = error.message || "Chưa cập nhật được."; } });
                    block.appendChild(readButton);
                } else { const read = document.createElement("small"); read.className = "text-success d-block mt-1"; read.textContent = "Đã đọc"; block.appendChild(read); }
                messages.appendChild(block);
            });
            heading.scrollIntoView({ block: "nearest" });
        } catch (error) {
            inboxLoaded = false;
            console.info("Chưa tải được thông báo kế hoạch:", error.message);
        }
    }

    window.addEventListener("storage", event => {
        if (event.key === openStorageKey && event.newValue !== null) {
            setOpen(event.newValue === "true", false);
        }
    });
    try { if (localStorage.getItem(openStorageKey) === "true") setOpen(true, false); } catch {}

    toggle.addEventListener("click", () => { const opening = panel.hidden; setOpen(opening); if (opening) loadPlanNotifications(); });
    document.getElementById("tgplAiClose").addEventListener("click", () => setOpen(false));
    clearButton.addEventListener("click", () => clearConversation());
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
        const requestVersion = conversationVersion;
        const requestController = new AbortController();
        activeRequestController = requestController;
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
            let result;
            const taskPlanCode = explicitConferenceTaskPlanCode(question);
            let signedInUser = null;
            try { signedInUser = JSON.parse(localStorage.getItem("tgpl.user") || "null"); } catch {}
            if (taskPlanCode) {
                if (signedInUser?.role !== "ADMIN") {
                    answerText = `Yêu cầu lập phương án phân công cho ${taskPlanCode} cần tài khoản admin để rà soát hồ sơ và lịch nhân sự. Tài khoản hiện tại chưa được phép xem dữ liệu phân công của hội nghị này.`;
                } else {
                    result = await generateConferencePlan(taskPlanCode, isExplicitConferenceReschedulePlan(question) ? { intent: "RESCHEDULE" } : {});
                    if (requestVersion !== conversationVersion) return;
                    answerText = conferenceTaskPlanAnswer(result.data || {}, taskPlanCode);
                }
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
            } else if (isConferencePlanReviewQuestion(question) && !isPlanningFollowUp(question)) {
                answerText = "Vui lòng cho mã hội nghị hoặc gửi nội dung phương án cần rà soát. Tôi sẽ kiểm tra lịch, địa điểm, nhân sự, quy mô và các điểm chưa xác minh; chưa thay đổi dữ liệu hay phân công.";
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
            } else if (isAdminDailyIntakeQuestion(question)) {
                result = await reviewAdminDailyIntake(requestController.signal);
                if (requestVersion !== conversationVersion) return;
                answerText = dailyIntakeAnswer(result.data || {});
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
                addDailyIntakeReviewCard(answerBubble, result.data || {});
            } else if (isTrainingTopicSuggestion(question)) {
                answerText = trainingTopicSuggestionAnswer();
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
            } else if (isConferenceMaterialsQuestion(question) && !isLegalAidDocumentsFollowUp(question)) {
                answerText = conferenceMaterialsAnswer();
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
            } else if (isGenericTaskFrameworkQuestion(question)) {
                answerText = genericTaskFrameworkAnswer();
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
            } else if (isConferencePlanningQuestion(question) || isPlanningFollowUp(question)) {
                result = await createConferencePlanProposal(buildConferencePlanningPrompt(question), limitConversationHistory(conversationHistory), requestController.signal);
                if (requestVersion !== conversationVersion) return;
                answerText = result.data?.clarification || planningAnswer(result.data || {});
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
                if (!result.data?.clarification) addProposalCard(answerBubble, result.data || {});
            } else {
                result = await streamTgplChat(question, {
                    mode: "auto",
                    // Keep a short, bounded conversation window on every turn.
                    // The backend decides whether the current message is a follow-up;
                    // sending no context for ordinary wording makes natural follow-ups
                    // such as “còn địa điểm?” impossible to resolve consistently.
                    history: limitConversationHistory(conversationHistory),
                    signal: requestController.signal,
                    onMeta(meta) {
                        const labels = { fast: "Trả lời nhanh", legal_rag: "Tra cứu kho TGPL", deep_analysis: "Phân tích chuyên sâu" };
                        waiting.title = labels[meta.mode] || "Trợ lý AI";
                    },
                    onToken(token) {
                        if (requestVersion !== conversationVersion) return;
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
            }
            if (requestVersion !== conversationVersion) return;
            if (!answerBubble) {
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", "Mô hình chưa trả về câu trả lời. Vui lòng thử lại.");
            }
            const answerSources = result?.sources || [];
            addAnswerTools(answerBubble, question, answerText, answerSources);
            if (answerText.trim()) {
                conversationHistory.push({ role: "user", content: question });
                conversationHistory.push({ role: "assistant", content: answerText });
                conversationHistory.splice(0, conversationHistory.length, ...limitConversationHistory(conversationHistory));
                try { sessionStorage.setItem(conversationStorageKey, JSON.stringify(conversationHistory)); } catch {}
                conversationChannel?.postMessage({ type: "history", history: conversationHistory });
            }
        } catch (error) {
            if (requestVersion !== conversationVersion) return;
            console.error("TGPL chatbot UI handling failed:", error);
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
            if (activeRequestController === requestController) activeRequestController = null;
            input.disabled = false;
            sendButton.disabled = false;
            input.focus();
            messages.scrollTop = messages.scrollHeight;
        }
    });
})();
