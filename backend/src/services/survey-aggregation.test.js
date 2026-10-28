const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyQuestion } = require("./rag.service");
const { formatRankedSurveyTopics, formatSurveyRatings } = require("./survey-aggregation");

test("negative list instruction keeps a survey ranking question on the aggregation path", () => {
    const result = classifyQuestion("Trong phiếu khảo sát năm 2026, hãy xếp hạng các chủ đề được quan tâm theo số lượt; nêu số lượt và các trường hợp đồng hạng. Chỉ tổng hợp khảo sát, không liệt kê hội nghị.");
    assert.equal(result.intent, "survey");
    assert.equal(result.isSurveyRankingQuestion, true);
    assert.equal(result.isSurveyLookupQuestion, false);
    assert.equal(result.isSurveyAnalysisQuestion, true);
});

test("a positive request to list survey rows remains a lookup", () => {
    const result = classifyQuestion("Liệt kê các phiếu khảo sát của đơn vị tôi trong tháng 10/2026.");
    assert.equal(result.isSurveyLookupQuestion, true);
});

test("natural question about most-mentioned survey topics selects ranking", () => {
    const result = classifyQuestion("Những chủ đề nào được người trả lời quan tâm nhiều nhất?");
    assert.equal(result.isSurveyRankingQuestion, true);
    assert.equal(result.isSurveyLookupQuestion, false);
});

test("survey quality and coordination rating requests are marked for deterministic summary", () => {
    const result = classifyQuestion("Đánh giá chất lượng tổ chức hội nghị và phối hợp giữa các cơ quan trong khảo sát năm 2026.");
    assert.equal(result.intent, "survey");
    assert.equal(result.isSurveyRatingQuestion, true);
    assert.equal(result.isSurveyLookupQuestion, false);
});

test("ranked topic formatter keeps equal topics tied and reports counts and sample size", () => {
    const answer = formatRankedSurveyTopics([
        { label: "Luật Trợ giúp pháp lý", responses: 3, position: 1 },
        { label: "Quyền của người dân", responses: 3, position: 1 },
        { label: "Thủ tục yêu cầu TGPL", responses: 1, position: 3 }
    ], { periodLabel: "năm 2026", total: 4 });
    assert.match(answer, /hạng 1 đồng hạng/);
    assert.match(answer, /Luật Trợ giúp pháp lý.*3 phiếu/);
    assert.match(answer, /Quyền của người dân.*3 phiếu/);
    assert.match(answer, /Hạng 3/);
    assert.match(answer, /Chỉ có 4 phiếu/);
});

test("rating summary exposes averages, response counts and small-sample caution", () => {
    const answer = formatSurveyRatings({ quality_average: "3.0", quality_count: 2, coordination_average: "4.0", coordination_count: 1 }, "tháng 10/2026");
    assert.match(answer, /chất lượng tổ chức 3.0\/5 \(2 phiếu\)/);
    assert.match(answer, /phối hợp giữa cơ quan 4.0\/5 \(1 phiếu\)/);
    assert.match(answer, /Cỡ mẫu nhỏ/);
});

test("survey topic query counts each survey once for a normalized topic and retains tied ranks", () => {
    const route = fs.readFileSync(path.resolve(__dirname, "../routes/ai.routes.js"), "utf8");
    assert.match(route, /COUNT\(DISTINCT s\.id\)::int AS responses/);
    assert.match(route, /RANK\(\) OVER \(ORDER BY responses DESC\)/);
    assert.match(route, /classification\.isSurveyRatingQuestion/);
});
