const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyQuestion } = require("./rag.service");
const { formatRankedSurveyTopics, formatSurveyRatings, formatTopSurveyAreas, surveyOrganizationTerm, appendSurveyPeriodFilters } = require("./survey-aggregation");

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

test("commune survey dashboard questions use scoped aggregates instead of raw survey rows", () => {
    const questions = [
        "Những chủ đề pháp luật nào được người trả lời khảo sát của đơn vị tôi quan tâm? Nêu số lượt và đồng hạng.",
        "Các nhóm đối tượng tham dự được đề xuất trong phiếu khảo sát của đơn vị tôi là gì?",
        "Người dân nêu vướng mắc pháp lý nào trong khảo sát? Chỉ tổng hợp nội dung, không kết luận vụ việc.",
        "Địa bàn nào trong khảo sát của đơn vị tôi có số đề xuất cao nhất? Nếu các địa bàn bằng nhau, hãy liệt kê đồng hạng, không chọn một địa bàn thắng."
    ];
    for (const question of questions) {
        const result = classifyQuestion(question);
        assert.equal(result.intent, "survey", question);
        assert.equal(result.isSurveySummaryQuestion, true, question);
        assert.equal(result.isSurveyLookupQuestion, false, question);
    }
});

test("remaining commune survey prompts route to their intended deterministic branch", () => {
    const cases = [
        ["Những chủ đề pháp luật nào được người trả lời khảo sát của đơn vị tôi quan tâm? Nêu số lượt và đồng hạng.", "isSurveyRankingQuestion"],
        ["Các nhóm đối tượng tham dự được đề xuất trong phiếu khảo sát của đơn vị tôi là gì?", "isSurveyAudienceQuestion"],
        ["Người dân nêu vướng mắc pháp lý nào trong khảo sát? Chỉ tổng hợp nội dung, không kết luận vụ việc.", "isSurveyIssueQuestion"],
        ["Địa bàn nào trong khảo sát của đơn vị tôi có số đề xuất cao nhất? Nếu các địa bàn bằng nhau, hãy liệt kê đồng hạng, không chọn một địa bàn thắng.", "isSurveyRankingQuestion"],
        ["Đánh giá mức độ thống nhất giữa chủ đề hội nghị đã đề xuất và nhu cầu trong phiếu khảo sát; nêu rõ dữ liệu còn thiếu.", "isSurveyConferenceEvaluation"],
        ["Từ số liệu khảo sát trong kỳ, hãy gợi ý một chủ đề hội nghị phù hợp cho địa bàn; phân biệt số liệu với đề xuất.", "isSurveyPlanningAdviceQuestion"]
    ];
    for (const [question, expectedFlag] of cases) {
        const result = classifyQuestion(question);
        assert.equal(result.intent, "survey", question);
        assert.equal(result[expectedFlag], true, question);
        assert.equal(result.isSurveyLookupQuestion, false, question);
    }
});

test("first-person organization phrases stay in the authenticated commune scope", () => {
    for (const phrase of ["don vi toi quan tam", "don vi toi", "xa minh de xuat", "phuong chung toi"])
        assert.equal(surveyOrganizationTerm(phrase), "", phrase);
    assert.equal(surveyOrganizationTerm("ubnd xa loc tan trong nam 2026"), "loc tan");
});

test("all-time survey comparison omits date predicates instead of comparing against SQL NULL", () => {
    const filters = [];
    const params = [];
    appendSurveyPeriodFilters(filters, params, { from: null, to: null, label: "toàn bộ thời gian" }, "s.created_at");
    assert.deepEqual(filters, []);
    assert.deepEqual(params, []);
    assert.equal(filters.length ? filters.join(" AND ") : "TRUE", "TRUE");
});

test("bounded survey comparison adds only present date limits with matching placeholders", () => {
    const filters = [];
    const params = [];
    appendSurveyPeriodFilters(filters, params, { from: "2026-01-01", to: "2027-01-01" }, "s.created_at");
    assert.deepEqual(filters, ["s.created_at >= $1::date", "s.created_at < $2::date"]);
    assert.deepEqual(params, ["2026-01-01", "2027-01-01"]);
});

test("top survey areas report ties without choosing a false winner", () => {
    const answer = formatTopSurveyAreas([
        { label: "Khu vực biên giới", responses: 1 },
        { label: "phường Phước Tân", responses: 1 }
    ]);
    assert.match(answer, /đồng hạng cao nhất/);
    assert.match(answer, /Khu vực biên giới/);
    assert.match(answer, /phường Phước Tân/);
    assert.match(answer, /chưa có địa bàn nào được đề xuất nhiều hơn/i);
});

test("survey topic suggestion is not classified as ranking or raw-row lookup", () => {
    const result = classifyQuestion("Từ số liệu khảo sát trong kỳ, hãy gợi ý một chủ đề hội nghị phù hợp cho địa bàn; phân biệt số liệu với đề xuất.");
    assert.equal(result.intent, "survey");
    assert.equal(result.isSurveyPlanningAdviceQuestion, true);
    assert.equal(result.isSurveyRankingQuestion, false);
    assert.equal(result.isSurveyLookupQuestion, false);
});

test("survey-to-conference evaluation remains an analysis request and asks for a period", () => {
    const result = classifyQuestion("Đánh giá mức độ thống nhất giữa chủ đề hội nghị đã đề xuất và nhu cầu trong phiếu khảo sát; nêu rõ dữ liệu còn thiếu.");
    assert.equal(result.intent, "survey");
    assert.equal(result.isSurveyConferenceEvaluation, true);
    assert.equal(result.isSurveyAnalysisQuestion, true);
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
    assert.ok(route.includes("s.organization_id=$${params.length}::uuid"));
    assert.ok(route.includes("surveyOrganizationTerm(normalizedQuestion)"));
    assert.ok(route.includes("appendSurveyPeriodFilters(surveyFilters, surveyParams, period, \"s.created_at\")"));
    assert.ok(route.includes("formatTopSurveyAreas(areasResult.rows)"));
    assert.ok(route.includes("clarify_survey_recommendation_period"));
    assert.ok(route.includes("classification.isSurveyPlanningAdviceQuestion || isSimpleSurveySummary"));
});
