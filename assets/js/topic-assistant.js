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
    const assistant = document.getElementById("tgplAiAssistant");
    const resizeButton = document.getElementById("tgplAiResize");
    const header = panel.querySelector(".tgpl-ai-header");
    const conversationHistory = [];
    const userKey = String(user.id || user.username || user.email || user.role).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const conversationStorageKey = `tgpl.ai.conversation.${userKey}`;
    const openStorageKey = `tgpl.ai.open.${userKey}`;
    const positionStorageKey = `tgpl.ai.position.${userKey}`;
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
        const asksForExistingData = /(?:phieu khao sat|khao sat|tong hop|thong ke|bao cao|bao nhieu|nhieu nhat|it nhat|danh sach|ra soat|tra cuu|tim hoi nghi|hoi nghi nao|noi dung hoi nghi nao|nhiem vu nao|cong viec nao|trang thai|ma hoi nghi|o dau|khi nao|ngay nao|thang\s*\d|quy\s*(?:i{1,3}|iv|[1-4]))/.test(normalized);
        if (asksForExistingData) return false;

        const asksForPlan = /(?:de xuat\s+(?:hoi nghi|tap huan|to chuc|lap|phuong an|ke hoach)|goi y\s+(?:to chuc|hoi nghi|tap huan|chu de)|lap ke hoach|len ke hoach|lap phuong an|xay dung phuong an|chuan bi to chuc|can to chuc|muon to chuc|giup toi to chuc|to chuc giup toi)/.test(normalized);
        const namesAUnit = /(?:xa|phuong|don vi)\s+[a-z0-9]/.test(normalized);
        const explicitPlan = /(?:lap|xay dung|len)\s+(?:ke hoach|phuong an)/.test(normalized);
        const mentionsEvent = /hoi nghi|tap huan|su kien|to chuc/.test(normalized);
        const trainingForLocalAudience = /tap huan/.test(normalized) && /can bo|nguoi dan|cong chuc/.test(normalized) && (namesAUnit || /xa toi|phuong toi|don vi toi/.test(normalized));
        // Natural requests often start with the action (“Tổ chức hội nghị…”),
        // rather than “Đề xuất/Lập kế hoạch…”. Route those to the planner only
        // when both an event and a target audience/place are named.
        const organizeForAudience = /^\s*to chuc\s+/.test(normalized)
            && /hoi nghi|tap huan|su kien/.test(normalized)
            && (namesAUnit || /can bo|nguoi dan|cong chuc/.test(normalized));
        return explicitPlan || trainingForLocalAudience || organizeForAudience || (asksForPlan && (mentionsEvent || namesAUnit));
    }
    function buildConferencePlanningPrompt(question) {
        // Keep the original user query as the API's request field. The backend
        // owns planner instructions; wrapping instructions into the user query
        // caused the model to mistake guidance text for the event title.
        return String(question || "").trim();
    }
    function isClearFollowUpQuestion(text) {
        const normalized = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
        return /^(?:con\b|vay\b|the\b|neu vay\b|cu the\b|noi ro hon\b|giai thich them\b|y toi la\b|truong hop do\b|cau tra loi do\b|van de nay\b|hoi nghi do\b|muc do\b|con ve\b)/.test(normalized)
            || /\b(?:van de nay|cau tren|cau tra loi vua roi|noi dung vua neu|hoi nghi do|don vi do|muc do|theo y tren)\b/.test(normalized);
    }
    function planningAnswer(data) {
        const plan = data.proposal || {};
        const slot = data.selected_time_slot?.label ? `\nKhung giờ gợi ý: ${data.selected_time_slot.label}.` : "";
        const units = (plan.suggested_units || []).map(item => item.name).filter(Boolean).join(", ");
        const documents = (plan.documents || []).slice(0, 5).join("; ");
        return `Bản gợi ý kế hoạch (chưa lưu, chưa gửi thông báo):\n• Đơn vị/địa bàn: ${plan.organization_name || "cần xác nhận"}\n• Địa điểm: ${plan.location || "cần xác nhận"}${slot}\n• Quy mô dự kiến: ${plan.expected_attendees || "cần xác nhận"} người\n• Chủ đề: ${plan.legal_topic || "cần xác nhận"}\n• Tài liệu: ${documents || "cần xác định theo chủ đề"}\n• Căn cứ gợi ý: ${plan.rationale || "cần rà soát nhu cầu thực tế"}\n• Đơn vị có thể phối hợp: ${units || "cần admin chọn"}\n• Nhiệm vụ gợi ý: ${(plan.tasks || []).length}. Xác nhận từng mục bên dưới để điền biểu mẫu; thông báo chỉ gửi sau khi admin xác nhận từng đơn vị.`;
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
        const timeSlot = data.selected_time_slot;
        const conferenceDraft = { title: plan.title || "", organization_id: plan.organization_id || "", organization_name: plan.organization_name || "",
            start_time: timeSlot?.start_time || "", end_time: timeSlot?.end_time || "", location: plan.location || "",
            expected_participants: plan.expected_attendees || "", description: [`Chủ đề đề xuất: ${plan.legal_topic || ""}`, plan.rationale || "",
                "Tài liệu cần chuẩn bị:", ...(plan.documents || []).map((item, index) => `${index + 1}. ${item}`)].filter(Boolean).join("\n") };
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

    toggle.addEventListener("click", () => { const opening = panel.hidden; setOpen(opening); if (opening) loadPlanNotifications(); });
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
            let result;
            if (isAdminDailyIntakeQuestion(question)) {
                result = await reviewAdminDailyIntake();
                answerText = dailyIntakeAnswer(result.data || {});
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
                addDailyIntakeReviewCard(answerBubble, result.data || {});
            } else if (isConferencePlanningQuestion(question)) {
                result = await createConferencePlanProposal(buildConferencePlanningPrompt(question));
                answerText = planningAnswer(result.data || {});
                waiting.remove();
                answerBubble = addMessage("assistant-message-bot", answerText);
                addProposalCard(answerBubble, result.data || {});
            } else {
                result = await streamTgplChat(question, {
                    mode: "auto",
                    history: isClearFollowUpQuestion(question) ? conversationHistory.slice(-6) : [],
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
            }
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
