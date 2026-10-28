const test = require("node:test");
const assert = require("node:assert/strict");
const { buildContext, classifyQuestion } = require("./rag.service");

test("RAG context never forwards a long answer cut in the middle of its first sentence", () => {
    const context = buildContext([{ id: "long", category: "Luật TGPL", question: "câu hỏi", answer: "A".repeat(1400), legal_basis: ["Điều 1"] }]);
    assert.match(context, /không sử dụng đoạn bị cắt làm căn cứ/);
    assert.doesNotMatch(context, /A{500}/);
});

test("RAG context trims long source text at a complete sentence", () => {
    const context = buildContext([{ id: "long", category: "Luật TGPL", question: "câu hỏi", answer: `${"Câu đầy đủ. ".repeat(100)} phần đang dở`, legal_basis: ["Điều 1"] }]);
    assert.match(context, /Câu đầy đủ\./);
    assert.match(context, /đã lược phần nguồn còn lại/);
    assert.doesNotMatch(context, /phần đang dở/);
});

test("task ranking and delay-risk questions are not routed as conference analytics", () => {
    for (const question of [
        "Trong các nhiệm vụ được giao, nhóm công việc nào chiếm nhiều nhất? Nêu số lượng và cách tính.",
        "Chỉ ra nhiệm vụ có nguy cơ trễ hạn cao nhất dựa trên hạn và trạng thái hiện có."
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isTaskQuery, true);
        assert.equal(intent.isConferenceAnalysisQuestion, false);
    }
});

test("assigned-consultation lookup and guidance are distinct from creating a contact request", () => {
    const assigned = classifyQuestion("Tôi được giao liên hệ tư vấn cho người dân nào và nội dung cần xử lý là gì? Chỉ xem yêu cầu được phân công cho tôi.");
    assert.equal(assigned.isAssignedConsultationQuery, true);
    assert.equal(assigned.isContactReferralQuestion, false);
    assert.equal(assigned.isInScope, true);

    const note = classifyQuestion("Tôi nên ghi ý kiến tư vấn thế nào để rõ căn cứ, phạm vi hỗ trợ và phần cần xác minh?");
    assert.equal(note.isConsultationNoteGuidance, true);
    assert.equal(note.isContactReferralQuestion, false);

    const guidance = classifyQuestion("Nếu chưa đủ căn cứ trả lời tình huống pháp lý, tôi nên hướng dẫn người dân ra sao?");
    assert.equal(guidance.isInsufficientBasisGuidance, true);
    assert.equal(guidance.isContactReferralQuestion, false);
});
