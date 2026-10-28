const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { formatAccountTaskCount, formatAccountTaskStatusCount, formatAccountTaskRatings } = require("./task-account-summary");

test("account task count reports the month and status breakdown", () => {
    const answer = formatAccountTaskCount({ total: 4, assigned: 2, in_progress: 1, completed: 1 }, "Phanthivan", "tháng 10/2026 theo hạn nhiệm vụ");
    assert.match(answer, /Phanthivan có 4 nhiệm vụ/);
    assert.match(answer, /tháng 10\/2026/);
    assert.match(answer, /đã giao 2, đang thực hiện 1, hoàn thành 1/);
    assert.match(answer, /không tính nhiệm vụ đã hủy/);
});

test("account rating report shows average, rated sample size and count above three", () => {
    const answer = formatAccountTaskRatings({ average_rating: "4.25", evaluated_count: 4, above_three: 3 }, "Lethic", "tháng 10/2026");
    assert.match(answer, /trong tháng 10\/2026/);
    assert.match(answer, /4\.25\/5 trên 4 nhiệm vụ có đánh giá/);
    assert.match(answer, /3 nhiệm vụ được chấm trên 3 điểm/);
});

test("status-specific account count answers only the requested task status", () => {
    const answer = formatAccountTaskStatusCount({ completed: 2 }, "Lethic", "tháng 10/2026", "completed");
    assert.match(answer, /2 nhiệm vụ đã hoàn thành trong tháng 10\/2026/);
    assert.match(answer, /theo thời điểm hoàn thành/);
    assert.doesNotMatch(answer, /đã giao|đang thực hiện/);
});

test("missing completion timestamps are reported as unknown, not zero", () => {
    const answer = formatAccountTaskStatusCount({ completed_in_period: 0, completed_without_timestamp: 2 }, "Lethic", "tháng 10/2026", "completed");
    assert.match(answer, /Chưa xác định được số nhiệm vụ hoàn thành/);
    assert.match(answer, /2 nhiệm vụ đã ở trạng thái hoàn thành nhưng chưa lưu thời điểm hoàn thành/);
});

test("account analytics query is admin-only and scoped to the resolved account id", () => {
    const route = fs.readFileSync(path.resolve(__dirname, "../routes/ai.routes.js"), "utf8");
    assert.match(route, /user\.role === "ADMIN" && requestedAssigneeId/);
    assert.match(route, /a\.assignee_user_id=\$1::uuid/);
    assert.match(route, /a\.evaluation_rating/);
    assert.match(route, /AT TIME ZONE 'Asia\/Ho_Chi_Minh'/);
    assert.ok(route.includes("((a.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $2::date)"));
    assert.match(route, /asksNamedAccountTaskCount && asksCompleted/);
    assert.match(route, /completed_without_timestamp/);
    assert.match(route, /a\.completed_at IS NULL AND \(a\.due_at AT TIME ZONE 'Asia\/Ho_Chi_Minh'\)/);
    assert.match(route, /formatAccountTaskCount/);
    assert.match(route, /formatAccountTaskStatusCount/);
    assert.match(route, /formatAccountTaskRatings/);
});


