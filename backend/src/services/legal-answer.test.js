const test = require("node:test");
const assert = require("node:assert/strict");
const { findVerifiedLegalArticle, answerFromExactLegalArticle, isLegalAidRequiredDocumentsQuestion, hasCompleteAnswerEnding } = require("./legal-answer");

const articles = [
    { id: "article-27", category: "Luật Trợ giúp pháp lý", question: "Điều 27 Luật Trợ giúp pháp lý", legal_basis: ["Điều 27"], answer: "Điều 27. Lĩnh vực, hình thức trợ giúp pháp lý\n1. Trợ giúp pháp lý được thực hiện trong các lĩnh vực pháp luật, trừ kinh doanh, thương mại.\n2. Các hình thức gồm tham gia tố tụng; tư vấn pháp luật; đại diện ngoài tố tụng.", source_status: "official_government_verified", source_url: "https://example.invalid/act" },
    { id: "article-5", category: "Luật Trợ giúp pháp lý", question: "Điều 5 Luật Trợ giúp pháp lý", legal_basis: ["Điều 5"], answer: "Điều 5. Nguồn tài chính.", source_status: "official_government_verified", source_url: "https://example.invalid/act" },
    { id: "unverified-27", category: "Luật Trợ giúp pháp lý", question: "Điều 27", legal_basis: ["Điều 27"], answer: "Không xác minh", source_status: "draft", source_url: "" }
];

test("exact article search matches the requested article number only", () => {
    assert.equal(findVerifiedLegalArticle("Điều 27 Luật Trợ giúp pháp lý quy định gì?", articles)?.id, "article-27");
    assert.equal(findVerifiedLegalArticle("Điều 2 Luật Trợ giúp pháp lý", articles), null);
});

test("exact clause extraction returns only the requested clause", () => {
    const source = findVerifiedLegalArticle("Điều 27 Luật Trợ giúp pháp lý", articles);
    const answer = answerFromExactLegalArticle(source, "Khoản 2 Điều 27 Luật Trợ giúp pháp lý");
    assert.match(answer, /^Khoản 2 Điều 27:/);
    assert.match(answer, /tham gia tố tụng; tư vấn pháp luật; đại diện ngoài tố tụng/);
    assert.doesNotMatch(answer, /Nguồn tài chính|Điều 5/);
});

test("natural required-documents questions, including follow-up phrasing, are recognized", () => {
    assert.equal(isLegalAidRequiredDocumentsQuestion("Người yêu cầu trợ giúp pháp lý cần cung cấp giấy tờ gì?"), true);
    assert.equal(isLegalAidRequiredDocumentsQuestion("Cần giấy tờ gì?"), true);
    assert.equal(isLegalAidRequiredDocumentsQuestion("Giấy tờ cần nộp để yêu cầu trợ giúp pháp lý"), true);
});

test("required-documents answer is concise and limited to Article 29", () => {
    const answer = "Theo khoản 1 Điều 29 Luật Trợ giúp pháp lý, hồ sơ gồm: (1) đơn yêu cầu trợ giúp pháp lý; (2) giấy tờ chứng minh người yêu cầu thuộc diện được trợ giúp pháp lý; (3) giấy tờ, tài liệu liên quan đến vụ việc.";
    assert.match(answer, /Điều 29/);
    assert.doesNotMatch(answer, /Điều 30|Điều 38/);
    assert.ok(answer.length < 300);
});

test("an unfinished generated legal answer is detected and can be replaced with a safe fallback", () => {
    assert.equal(hasCompleteAnswerEnding("Hồ sơ gồm đơn yêu cầu và giấy tờ liên quan"), false);
    assert.equal(hasCompleteAnswerEnding("Hồ sơ gồm đơn yêu cầu và giấy tờ liên quan."), true);
});
