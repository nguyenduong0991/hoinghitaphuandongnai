const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyTaskQuestion } = require("./task-question-intent");

test("overdue and not-completed wording does not select the completed-task branch", () => {
    const intent = classifyTaskQuestion("chi liet ke nhiem vu cua toi da qua han va chua hoan thanh");
    assert.equal(intent.asksOverdue, true);
    assert.equal(intent.asksUncompleted, true);
    assert.equal(intent.asksCompleted, false);
});

test("completed, in-progress and progress-summary questions keep distinct intent", () => {
    assert.equal(classifyTaskQuestion("nhiem vu da hoan thanh").asksCompleted, true);
    assert.equal(classifyTaskQuestion("nhiem vu dang thuc hien").asksInProgress, true);
    assert.equal(classifyTaskQuestion("tong hop tien do nhiem vu").asksProgress, true);
    const breakdown = classifyTaskQuestion("tong hop tien do nhiem vu trong thang nay tach da giao dang thuc hien va hoan thanh");
    assert.equal(breakdown.asksProgress, true);
    assert.equal(breakdown.asksCompleted, false);
    assert.equal(breakdown.asksInProgress, false);
});
test("today deadline intent does not match a reporting range ending today", () => {
    assert.equal(classifyTaskQuestion("nhiem vu nao cua toi hom nay").asksToday, true);
    assert.equal(classifyTaskQuestion("nhiem vu da hoan thanh tu dau quy nay den hom nay").asksToday, false);
});
test("quarter-through-today parsing takes precedence over the today-only period", () => {
    const routePath = require("node:path").resolve(__dirname, "../routes/ai.routes.js");
    const route = require("node:fs").readFileSync(routePath, "utf8");
    const quarterMatcher = route.match(/const quarterThroughToday = normalized\.match\((\/.*?\/)\);/);
    assert.ok(quarterMatcher);
    assert.match(quarterMatcher[1], /nay\|hien tai/);
    assert.ok(route.indexOf("const quarterThroughToday") < route.indexOf("if (/(?:hom nay|ngay hom nay)/.test(normalized))"));
});
test("completed-task report does not claim zero when legacy completion dates are unknown", () => {
    const routePath = require("node:path").resolve(__dirname, "../routes/ai.routes.js");
    const route = require("node:fs").readFileSync(routePath, "utf8");
    assert.match(route, /Chưa thể xác định đầy đủ nhiệm vụ nào hoàn thành trong \$\{requestedPeriod\.label\}/);
    assert.match(route, /thiếu mốc hoàn thành; không thể xác nhận chúng thuộc kỳ này chỉ dựa vào hạn công việc/);
    assert.match(route, /Ngoài danh sách trên, còn \$\{legacy\.rows\[0\]\.count\} nhiệm vụ đã hoàn thành nhưng thiếu thời điểm hoàn thành/);
    assert.match(route, /displayDate\(requestedPeriod\.from\).*displayDate\(localToday\)/s);
});
test("personal conference-task questions select only the signed-in assignee's task rows", () => {
    const routePath = require("node:path").resolve(__dirname, "../routes/ai.routes.js");
    const route = require("node:fs").readFileSync(routePath, "utf8");
    const taskSpecificLookup = route.indexOf("if (asksMyTaskTitles)");
    const ownAssignmentFilter = route.indexOf("a.assignee_user_id=$2::uuid", taskSpecificLookup);
    assert.ok(taskSpecificLookup >= 0 && ownAssignmentFilter > taskSpecificLookup);
});
test("empty overdue result is prioritized over the generic uncompleted answer", () => {
    const routePath = require("node:path").resolve(__dirname, "../routes/ai.routes.js");
    const route = require("node:fs").readFileSync(routePath, "utf8");
    const emptyStart = route.indexOf("if (!lines.length) {");
    const emptyEnd = route.indexOf("if (asksToday) return `Nhiệm vụ đến hạn hôm nay", emptyStart);
    const emptyResult = route.slice(emptyStart, emptyEnd);
    assert.ok(emptyResult.indexOf("if (asksOverdue)") < emptyResult.indexOf("if (asksUncompleted"));
});
