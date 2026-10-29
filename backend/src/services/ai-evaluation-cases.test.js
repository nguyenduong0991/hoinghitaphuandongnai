const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("./ai-evaluation-cases.json");
const { classifyQuestion } = require("./rag.service");
const { shouldResolveIntent } = require("./intent-resolution.service");
const { resolveConversationContext } = require("./conversation-memory");

test("fixed AI evaluation set contains the required 10/5/5/5/5 category balance", () => {
    assert.equal(cases.length, 30);
    for (const [group, count] of [["natural",10],["multi_turn",5],["analysis",5],["planning",5],["legal",5]]) {
        assert.equal(cases.filter(item => item.group === group).length, count, group);
    }
});

test("fixed evaluation set routes explicit cases and marks genuinely ambiguous app requests for fallback", () => {
    for (const item of cases.filter(item => item.question)) {
        const result = classifyQuestion(item.question);
        if (item.expected === "model_fallback") {
            assert.equal(shouldResolveIntent(item.question, result), true, item.id);
        } else if (item.expected === "conference_lookup_or_attendance") {
            assert.ok(["conference_lookup", "conference_attendance"].includes(result.intent), item.id);
        } else {
            assert.equal(result.intent, item.expected, `${item.id}: got ${result.intent}`);
        }
    }
});

test("multi-turn evaluation cases preserve exact codes or request clarification when ambiguous", () => {
    const { normalizeConversationHistory } = require("./conversation-memory");
    for (const item of cases.filter(item => item.group === "multi_turn")) {
        const priorTurns = item.turns.slice(0, -1);
        const history = normalizeConversationHistory(priorTurns.flatMap(turn => [{ role: "user", content: turn }, { role: "assistant", content: "Đã ghi nhận." }]), 6);
        const question = item.turns.at(-1);
        const current = classifyQuestion(question);
        const context = resolveConversationContext(question, history, current, classifyQuestion);
        if (item.expected === "preserve_one_conference_code" || item.expected === "use_latest_explicit_code") {
            assert.equal(context.conferenceReferenceAmbiguous, false, item.id);
            assert.ok(context.conferenceReferenceCode, item.id);
        } else if (item.expected === "clarify_multiple_codes") {
            assert.equal(context.conferenceReferenceAmbiguous, true, item.id);
        } else if (item.expected === "keep_legal_topic") {
            assert.equal(context.topicShift, false, item.id);
        } else if (item.expected === "inherit_period") {
            assert.equal(context.usesContext, true, item.id);
        }
    }
});

test("dashboard question templates keep their intent when users replace key values", () => {
    const variants = [
        ["Hội nghị HN-0012 diễn ra khi nào, ở đâu và trạng thái hiện tại là gì?", "Hội nghị HN-0019 diễn ra khi nào, ở đâu và trạng thái hiện tại là gì?", "conference_lookup", "HN-0019"],
        ["Hội nghị của UBND xã Lộc Tấn đang ở trạng thái nào?", "Hội nghị của UBND phường Long Bình đang ở trạng thái nào?", "conference_lookup", null],
        ["Rà soát các hội nghị dự kiến diễn ra trong tháng 11/2026, gồm cả hồ sơ chưa phê duyệt.", "Rà soát các hội nghị dự kiến diễn ra trong tháng 12/2026, gồm cả hồ sơ chưa phê duyệt.", "conference_lookup", null],
        ["Tài khoản Lethic có bao nhiêu nhiệm vụ trong tháng 10/2026?", "Tài khoản Phanthivan có bao nhiêu nhiệm vụ trong tháng 11/2026?", "tasks", null],
        ["Hãy đề xuất phân công cán bộ và báo cáo viên cho hội nghị HN-0012.", "Hãy đề xuất phân công cán bộ và báo cáo viên cho hội nghị HN-0019.", "conference_planning", "HN-0019"],
        ["Tháng 11/2026 có bao nhiêu hội nghị dự kiến?", "Trong tháng 12/2026 dự kiến có mấy hội nghị?", "conference_lookup", null]
    ];

    for (const [original, replacement, expectedIntent, expectedCode] of variants) {
        const originalRoute = classifyQuestion(original);
        const replacementRoute = classifyQuestion(replacement);
        assert.equal(replacementRoute.intent, expectedIntent, replacement);
        assert.equal(replacementRoute.intent, originalRoute.intent, replacement);
        if (expectedCode) assert.equal(replacementRoute.querySlots.conferenceCode, expectedCode, replacement);
    }
});

test("an explicitly replaced conference code is not inherited from an older turn", () => {
    const { normalizeConversationHistory, resolveConversationContext } = require("./conversation-memory");
    const history = normalizeConversationHistory([
        { role: "user", content: "Hội nghị HN-0012 diễn ra khi nào?" },
        { role: "assistant", content: "Đã tra cứu." }
    ], 6);
    const question = "Còn HN-0019 thì tổ chức ở đâu?";
    const context = resolveConversationContext(question, history, classifyQuestion(question), classifyQuestion);
    assert.equal(context.conferenceReferenceCode, null);
    assert.equal(classifyQuestion(question).querySlots.conferenceCode, "HN-0019");
});
