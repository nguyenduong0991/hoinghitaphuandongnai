const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    normalizeConversationHistory,
    resolveConversationContext,
    buildConversationMemory
} = require("./conversation-memory");

function classifyQuestion(question) {
    const text = String(question || "").toLowerCase();
    if (/trợ giúp pháp lý|tgpl|luật/.test(text)) return { intent: "legal_aid", isInScope: true };
    if (/nhiệm vụ|đến hạn|phân công/.test(text)) return { intent: "tasks", isInScope: true };
    if (/hội nghị|tập huấn|hn-\d+/.test(text)) return { intent: "conference_lookup", isInScope: true };
    return { intent: "out_of_scope", isInScope: false };
}

test("history retains six full exchanges without character clipping", () => {
    const history = [];
    for (let i = 0; i < 8; i += 1) {
        history.push({ role: "user", content: `Câu hỏi ${i}: ${"thông tin quan trọng ".repeat(30)}` });
        history.push({ role: "assistant", content: `Trả lời ${i}` });
    }
    const kept = normalizeConversationHistory(history);
    assert.equal(kept.filter(item => item.role === "user").length, 6);
    assert.equal(kept.at(-1).content, "Trả lời 7");
    assert.ok(kept[0].content.length > 300);
});

test("short follow-up carries structured user facts and exact identifiers", () => {
    const history = [
        { role: "user", content: "Người từ 16 tuổi đến dưới 18 tuổi bị tố giác có được trợ giúp pháp lý không? Mã HN-0020, tháng 11/2026." },
        { role: "assistant", content: "Cần xem quy định phù hợp. Bạn muốn hỏi giấy tờ gì?" }
    ];
    const context = resolveConversationContext("cần giấy tờ gì?", history, classifyQuestion("cần giấy tờ gì?"), classifyQuestion);
    const memory = buildConversationMemory(history, context, classifyQuestion, "cần giấy tờ gì?");
    assert.equal(context.usesContext, true);
    assert.match(memory.promptText, /Tuổi được người dùng nêu/);
    assert.match(memory.promptText, /HN-0020/);
    assert.match(memory.promptText, /11\/2026/);
    assert.match(memory.promptText, /chưa được xác minh/);
});

test("a bare locality inherits a plan only when the assistant is explicitly waiting for the locality", () => {
    const question = "xã Lộc Ninh";
    const classification = classifyQuestion(question);
    const pending = [
        { role: "user", content: "Lập kế hoạch tập huấn cho cán bộ." },
        { role: "assistant", content: "Bạn vui lòng cho biết xã/phường hoặc đơn vị tổ chức?" }
    ];
    const pendingContext = resolveConversationContext(question, pending, classification, classifyQuestion);
    assert.equal(pendingContext.usesContext, true);
    assert.equal(pendingContext.unresolvedSlots.includes("địa bàn/đơn vị"), false);

    const noPendingQuestion = [
        { role: "user", content: "Lập kế hoạch tập huấn cho cán bộ." },
        { role: "assistant", content: "Đề xuất chung: nên xác định địa điểm trước khi tổ chức." }
    ];
    const unrelatedContext = resolveConversationContext(question, noPendingQuestion, classification, classifyQuestion);
    assert.equal(unrelatedContext.usesContext, false);
});

test("multi-step clarification keeps original plan context and marks answered slots", () => {
    const history = [
        { role: "user", content: "Giúp tôi lập kế hoạch tập huấn cho cán bộ xã về Luật Trợ giúp pháp lý." },
        { role: "assistant", content: "Bạn muốn tổ chức ở đơn vị nào và vào thời gian nào?" },
        { role: "user", content: "Xã Bù Gia Mập" },
        { role: "assistant", content: "Cảm ơn. Bạn dự kiến tháng nào?" }
    ];
    const context = resolveConversationContext("Tháng 11/2026", history, classifyQuestion("Tháng 11/2026"), classifyQuestion);
    const memory = buildConversationMemory(history, context, classifyQuestion, "Tháng 11/2026");
    assert.equal(context.usesContext, true);
    assert.deepEqual(context.unresolvedSlots, []);
    assert.match(memory.promptText, /Chủ đề trước: Luật Trợ giúp pháp lý/);
    assert.match(memory.promptText, /Bù Gia Mập/);
    assert.match(memory.promptText, /11\/2026/);
});

test("an explicit new task question starts a separate topic", () => {
    const history = [{ role: "user", content: "Người nghèo có được trợ giúp pháp lý không?" }];
    const context = resolveConversationContext("Nhiệm vụ nào của tôi sắp đến hạn?", history, classifyQuestion("Nhiệm vụ nào của tôi sắp đến hạn?"), classifyQuestion);
    assert.equal(context.usesContext, false);
    assert.equal(context.topicShift, true);
});

test("ambiguous reference without history requests clarification", () => {
    const context = resolveConversationContext("Trường hợp đó thì sao?", [], classifyQuestion("Trường hợp đó thì sao?"), classifyQuestion);
    assert.equal(context.usesContext, false);
    assert.equal(context.clarify, true);
});

test("old assistant answer is never copied into structured memory", () => {
    const history = [
        { role: "user", content: "Hội nghị mã HN-0020 ở đâu?" },
        { role: "assistant", content: "INTERNAL_SECRET unrelated answer" }
    ];
    const context = resolveConversationContext("ở đâu vậy?", history, classifyQuestion("ở đâu vậy?"), classifyQuestion);
    const memory = buildConversationMemory(history, context, classifyQuestion, "ở đâu vậy?");
    assert.doesNotMatch(memory.promptText, /INTERNAL_SECRET/);
    assert.match(memory.promptText, /HN-0020/);
});

test("conference follow-up resolves one recent confirmed code without asking the model to guess", () => {
    const history = [
        { role: "user", content: "Tra cứu hội nghị HN-0011." },
        { role: "assistant", content: "Tôi đã tìm thấy hội nghị." }
    ];
    const question = "Hội nghị đó diễn ra ở đâu và ngày giờ nào?";
    const context = resolveConversationContext(question, history, classifyQuestion(question), classifyQuestion);
    const memory = buildConversationMemory(history.filter(item => item.role === "user"), context, classifyQuestion, question);
    assert.equal(context.conferenceReferenceCode, "HN-0011");
    assert.equal(context.conferenceReferenceAmbiguous, false);
    assert.match(memory.retrievalText, /HN-0011/);
});

test("a follow-up after a topic change does not inherit a conference code", () => {
    const history = [{ role: "user", content: "Tra cứu hội nghị HN-0011." }];
    const question = "Vậy Luật Trợ giúp pháp lý quy định những hình thức nào?";
    const context = resolveConversationContext(question, history, classifyQuestion(question), classifyQuestion);
    assert.equal(context.usesContext, false);
    assert.equal(context.conferenceReferenceCode, null);
});

test("a follow-up referring to a turn with multiple conference codes asks for clarification", () => {
    const history = [{ role: "user", content: "So sánh hội nghị HN-0011 và HN-0012." }];
    const question = "Hội nghị đó diễn ra ở đâu?";
    const context = resolveConversationContext(question, history, classifyQuestion(question), classifyQuestion);
    assert.equal(context.conferenceReferenceCode, null);
    assert.equal(context.conferenceReferenceAmbiguous, true);
});

test("a legal question cannot inherit the previously mentioned conference after switching topic", () => {
    const history = [{ role: "user", content: "Hội nghị HN-0011 diễn ra ở đâu?" }];
    const question = "Điều 27 Luật Trợ giúp pháp lý quy định gì?";
    const context = resolveConversationContext(question, history, classifyQuestion(question), classifyQuestion);
    assert.equal(context.topicShift, true);
    assert.equal(context.conferenceReferenceCode, null);
});

test("production chat and planning routes use structured bounded history", () => {
    const backendRoot = path.resolve(__dirname, "..");
    const aiRoutes = fs.readFileSync(path.join(backendRoot, "routes", "ai.routes.js"), "utf8");
    const management = fs.readFileSync(path.join(backendRoot, "management.js"), "utf8");
    assert.match(aiRoutes, /normalizeConversationHistory\(req\.body\?\.history/);
    assert.match(aiRoutes, /resolveConversationContext\(/);
    assert.match(aiRoutes, /buildConversationMemory\(/);
    assert.match(aiRoutes, /filterPrivateRagRows\(trainingRows, req\.user\)/);
    assert.match(management, /normalizeConversationHistory\(req\.body\?\.history/);
    assert.match(management, /buildConversationMemory\(/);
    assert.match(management, /visible_conference_history: selectedHistory/);
    assert.match(management, /aggregated_survey_signals: selectedSurveySignals/);
    assert.match(management, /task_assignees: rankPeople\(staffResult\.rows\)/);
    assert.match(management, /speakers: rankPeople\(speakerResult\.rows\)/);
});
