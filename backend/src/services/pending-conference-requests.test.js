const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isPendingConferenceRequestCountQuestion, formatPendingConferenceRequestCount } = require("./pending-conference-requests");

test("recognizes natural pending conference request counts across common phrasings", () => {
    for (const question of [
        "Hôm nay có bao nhiêu yêu cầu tổ chức hội nghị chưa phê duyệt?",
        "Tuần này có bao nhiêu yêu cầu hội nghị đang chờ duyệt?",
        "Tháng này đếm số hồ sơ hội nghị chờ phê duyệt giúp tôi",
        "Trong tháng này đã nhận bao nhiêu đề nghị tổ chức hội nghị chưa được phê duyệt?",
        "Hôm nay có bao nhiêu hội nghị chưa được duyệt?"
    ]) assert.equal(isPendingConferenceRequestCountQuestion(question), true, question);
    assert.equal(isPendingConferenceRequestCountQuestion("Tháng này có bao nhiêu hội nghị đã phê duyệt?"), false);
    assert.equal(isPendingConferenceRequestCountQuestion("Rà soát danh sách hội nghị chờ duyệt tháng này"), false);
    assert.equal(isPendingConferenceRequestCountQuestion("Có bao nhiêu yêu cầu tổ chức hội nghị chưa phê duyệt?"), true);
});

test("pending request summary states the period basis and scopes the result", () => {
    assert.equal(formatPendingConferenceRequestCount(4, "tuần này", "toàn hệ thống"), "Đã tiếp nhận 4 yêu cầu tổ chức hội nghị còn chờ phê duyệt trong tuần này (toàn hệ thống; tính theo ngày hồ sơ được tạo)." );
});

test("production route counts only pending submissions by created_at and preserves role scope", () => {
    const route = fs.readFileSync(path.resolve(__dirname, "../routes/ai.routes.js"), "utf8");
    assert.match(route, /isPendingConferenceRequestCountQuestion\(question\)/);
    assert.match(route, /c\.status='PENDING'/);
    assert.match(route, /c\.created_at AT TIME ZONE 'Asia\/Ho_Chi_Minh'/);
    assert.match(route, /scoped_sql_pending_conference_requests_by_received_period/);
    assert.match(route, /\$1::text='ADMIN'/);
});