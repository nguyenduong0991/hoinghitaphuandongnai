const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyQuestion } = require("./rag.service");

test("external weather, currency and news requests are rejected before conference routing", () => {
    for (const question of ["Dự báo thời tiết ngày hội nghị tuần sau.", "Tỷ giá hôm nay là bao nhiêu?", "Tin tức thời sự mới nhất về hội nghị."]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isExternalDataQuestion, true, question);
        assert.equal(intent.isConferenceAnalysisQuestion, false, question);
        assert.equal(intent.isConferenceDataQuestion, false, question);
        assert.equal(intent.isInScope, false, question);
    }
});

test("conference attendance counts use a structured SQL intent", () => {
    for (const question of [
        "Tổng hợp số lượng người tham dự hội nghị trong tháng 10/2026.",
        "Tổng số người đã điểm danh trong tháng 10/2026 là bao nhiêu?",
        "Có bao nhiêu người đăng ký tham dự hội nghị HN-0011?"
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isConferenceAttendanceQuestion, true, question);
        assert.equal(intent.isConferenceAnalysisQuestion, false, question);
        assert.equal(intent.intent, "conference_attendance", question);
    }
});

test("registration versus actual attendance wording receives deterministic guidance", () => {
    const intent = classifyQuestion("Phân biệt người đăng ký và người tham dự thực tế.");
    assert.equal(intent.isConferenceAttendanceGuidanceQuestion, true);
    assert.equal(intent.isInScope, true);
});

test("valid conference lookup, reporting, planning, task and legal questions retain their routes", () => {
    assert.equal(classifyQuestion("Hội nghị HN-0011 diễn ra ở đâu?").intent, "conference_lookup");
    assert.equal(classifyQuestion("Đánh giá hiệu quả tổ chức hội nghị trong quý III/2026.").intent, "conference_analysis");
    assert.equal(classifyQuestion("Đề xuất kế hoạch hội nghị tại phường Long Bình.").intent, "conference_planning");
    assert.equal(classifyQuestion("Nhiệm vụ nào của tôi sắp đến hạn trong 7 ngày tới?").intent, "tasks");
    assert.equal(classifyQuestion("Luật Trợ giúp pháp lý quy định những hình thức trợ giúp nào?").intent, "legal_aid");
    assert.equal(classifyQuestion("Hôm nay có bao nhiêu yêu cầu tổ chức hội nghị chưa được phê duyệt?").isExternalDataQuestion, false);
});

test("natural structured conference counts stay on the direct-data route", () => {
    for (const question of [
        "Tháng 11/2026 có mấy hội nghị dự kiến?",
        "Cho tôi biết tổng số hội nghị trong quý III/2026.",
        "Hôm nay có bao nhiêu yêu cầu tổ chức hội nghị chưa được phê duyệt?"
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isConferenceDataQuestion, true, question);
        assert.equal(intent.isConferenceAnalysisQuestion, false, question);
    }
});

test("plain attendee metrics are classified separately from conference planning", () => {
    for (const question of [
        "Tổng số người dân đăng ký dự hội nghị tháng 10/2026 là bao nhiêu?",
        "Tháng 10/2026 có bao nhiêu người được tick điểm danh ở hội nghị?",
        "Tổng hợp số lượt đăng ký và điểm danh trong tháng 10/2026."
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isConferenceAttendanceQuestion, true, question);
        assert.equal(intent.isConferencePlanningQuestion, false, question);
        assert.equal(intent.intent, "conference_attendance", question);
    }
});

test("conference effectiveness analysis is not mistaken for a planning request", () => {
    for (const question of [
        "Đánh giá hiệu quả tổ chức hội nghị trong quý III/2026.",
        "So sánh kết quả tổ chức hội nghị giữa tháng 9 và tháng 10/2026.",
        "Xu hướng số hội nghị được tổ chức trong năm 2026 là gì?"
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isConferenceAnalysisQuestion, true, question);
        assert.equal(intent.isConferencePlanningQuestion, false, question);
    }
});

test("plan requests remain explicit and distinct from lookups and reports", () => {
    for (const question of [
        "Giúp tôi tổ chức tập huấn Luật Trợ giúp pháp lý tại phường Long Bình.",
        "Đề xuất kế hoạch hội nghị tuyên truyền cho đơn vị tôi.",
        "Lập phương án dời lịch Hội nghị HN-0001."
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isConferencePlanningQuestion, true, question);
        assert.equal(intent.isExternalDataQuestion, false, question);
    }
});

test("legal topic shift does not get routed into conference analytics", () => {
    const intent = classifyQuestion("Người yêu cầu trợ giúp pháp lý cần chuẩn bị giấy tờ gì?");
    assert.equal(intent.intent, "legal_aid");
    assert.equal(intent.isConferenceAnalysisQuestion, false);
    assert.equal(intent.isExternalDataQuestion, false);
});

test("specific conference lookup and explicit follow-up phrasing keep lookup intent", () => {
    assert.equal(classifyQuestion("Hội nghị HN-0011 diễn ra ở đâu?").intent, "conference_lookup");
    const followup = classifyQuestion("Hội nghị đó diễn ra ở đâu và ngày giờ nào?");
    assert.equal(followup.isConferenceDataQuestion, true);
    assert.equal(followup.isConferenceAnalysisQuestion, false);
});

test("generic conference wording alone does not trigger analytics or planning", () => {
    for (const question of [
        "Tôi có câu hỏi về hội nghị.",
        "Tổng hợp giúp tôi.",
        "Tôi muốn đánh giá công việc của mình."
    ]) {
        const intent = classifyQuestion(question);
        assert.equal(intent.isConferenceAnalysisQuestion, false, question);
        assert.equal(intent.isConferencePlanningQuestion, false, question);
    }
});
