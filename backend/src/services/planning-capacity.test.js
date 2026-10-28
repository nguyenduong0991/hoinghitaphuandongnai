const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LIMITS, weekStartKey, personCapacity, rankAvailable, overlapsTimeInterval, findApprovedScheduleConflicts, isConferenceMonthAvailable, findNearestFeasibleOptions } = require("./planning-capacity");

test("quota windows use Asia/Ho_Chi_Minh month and ISO week", () => {
    assert.equal(weekStartKey("2026-10-25T18:00:00.000Z"), "2026-10-26");
    const result = personCapacity({ id: "a" }, "2026-10-26T02:00:00.000Z", [
        { user_id: "a", month_key: "2026-10", week_key: "2026-10-26", count: 1 }
    ], LIMITS.taskAssignee);
    assert.equal(result.monthly_count, 1);
    assert.equal(result.weekly_count, 1);
    assert.equal(result.eligible, true);
});

test("staff and speaker hard limits disqualify at cap", () => {
    const staff = personCapacity({ id: "a" }, "2026-10-26T12:00:00+07:00", [
        { user_id: "a", month_key: "2026-10", week_key: "2026-10-26", count: 5 }
    ], LIMITS.taskAssignee);
    const speaker = personCapacity({ id: "b" }, "2026-10-26T12:00:00+07:00", [
        { user_id: "b", month_key: "2026-10", week_key: "2026-10-26", count: 1 }
    ], LIMITS.speaker);
    assert.equal(staff.eligible, false);
    assert.equal(speaker.eligible, false);
});

test("available candidates are ranked by quota remaining, with no over-limit IDs", () => {
    const people = [{ id: "a", full_name: "A" }, { id: "b", full_name: "B" }];
    const ranked = rankAvailable(people, "2026-10-26T12:00:00+07:00", [
        { user_id: "a", month_key: "2026-10", week_key: "2026-10-05", count: 1 },
        { user_id: "a", month_key: "2026-10", week_key: "2026-10-12", count: 1 },
        { user_id: "a", month_key: "2026-10", week_key: "2026-10-19", count: 1 },
        { user_id: "a", month_key: "2026-10", week_key: "2026-10-26", count: 1 },
        { user_id: "b", month_key: "2026-10", week_key: "2026-10-26", count: 1 }
    ], LIMITS.taskAssignee);
    assert.deepEqual(ranked.map(item => item.id), ["b", "a"]);
    assert.ok(ranked.every(item => item.capacity.monthly_count < LIMITS.taskAssignee.monthly && item.capacity.weekly_count < LIMITS.taskAssignee.weekly));
});

test("scheduler rejects overlapping times but allows adjacent slots", () => {
    const occupied = [{ start: "2026-11-02T08:30:00+07:00", end: "2026-11-02T11:30:00+07:00" }];
    assert.equal(overlapsTimeInterval("2026-11-02T10:00:00+07:00", "2026-11-02T12:00:00+07:00", occupied), true);
    assert.equal(overlapsTimeInterval("2026-11-02T11:30:00+07:00", "2026-11-02T13:30:00+07:00", occupied), false);
});

test("only overlapping already-approved events in the same organization trigger a reschedule warning", () => {
    const events = [
        { code: "HN-APPROVED", title: "Đã duyệt", organization_id: "org-a", organization_name: "UBND phường A", status: "APPROVED", start: "2026-11-02T09:00:00+07:00", end: "2026-11-02T11:00:00+07:00" },
        { code: "HN-OTHER-UNIT", title: "Đơn vị khác", organization_id: "org-b", status: "APPROVED", start: "2026-11-02T09:00:00+07:00", end: "2026-11-02T11:00:00+07:00" },
        { code: "HN-PENDING", title: "Chưa duyệt", organization_id: "org-a", status: "PENDING", start: "2026-11-02T09:00:00+07:00", end: "2026-11-02T11:00:00+07:00" },
        { code: "HN-NO-OVERLAP", title: "Không trùng giờ", organization_id: "org-a", status: "APPROVED", start: "2026-11-02T12:00:00+07:00", end: "2026-11-02T13:00:00+07:00" }
    ];
    const conflicts = findApprovedScheduleConflicts("2026-11-02T10:00:00+07:00", "2026-11-02T12:00:00+07:00", "org-a", events);
    assert.deepEqual(conflicts.map(item => item.code), ["HN-APPROVED"]);
});
test("monthly conference limit rejects a full month and leaves the next month available", () => {
    const counts = new Map([["2026-11", 15], ["2026-12", 14]]);
    assert.equal(isConferenceMonthAvailable("2026-11-15T08:30:00+07:00", counts, 15), false);
    assert.equal(isConferenceMonthAvailable("2026-12-01T08:30:00+07:00", counts, 15), true);
});

test("scheduler returns only the nearest three fully staffed dates", () => {
    const options = [1, 2, 3, 4, 5].map(day => ({ id: `D${day}`, start_time: `2026-11-0${day}T08:30:00+07:00` }));
    let buildCount = 0;
    const staffingFor = date => {
        buildCount++;
        const staffed = Number(date.slice(8, 10)) >= 2;
        const staff = Array.from({ length: staffed ? 4 : 2 }, (_, index) => ({ id: `s${index}` }));
        return { staff: { primary: staff.slice(0, 3), backup: staff[3] || null },
            speakers: { primary: staffed ? { id: "p1" } : null, backup: staffed ? { id: "p2" } : null } };
    };
    const result = findNearestFeasibleOptions(options, staffingFor, LIMITS, 3);
    assert.deepEqual(result.feasible.map(item => item.option.id), ["D2", "D3", "D4"]);
    assert.equal(buildCount, 4);
    assert.equal(result.bestCandidate.option.id, "D1");
});


test("admin plan exposes a same-locality approved conflict and requires rescheduling review", () => {
    const management = fs.readFileSync(path.resolve(__dirname, "../management.js"), "utf8");
    assert.match(management, /WHERE c\.id::text=\$1 OR UPPER\(c\.code\)=UPPER\(\$1\)/);
    assert.match(management, /findApprovedScheduleConflicts\(requestedStart, requestedConflictEnd, conference\.organization_id/);
    assert.match(management, /approvedSameLocalityConflicts\.length \? "APPROVED_CONFERENCE_CONFLICT"/);
    assert.match(management, /requires_reschedule: forceReschedule \|\| approvedSameLocalityConflicts\.length > 0/);
    assert.match(management, /đã được phê duyệt tại cùng đơn vị/);
});

test("replanning excludes the target conference from monthly and weekly staff quotas", () => {
    const management = fs.readFileSync(path.resolve(__dirname, "../management.js"), "utf8");
    const taskQuota = management.match(/SELECT a\.assignee_user_id[\s\S]*?GROUP BY a\.assignee_user_id,month_key,week_key`, \[conferenceId\]\)/);
    const speakerQuota = management.match(/SELECT s\.speaker_user_id[\s\S]*?GROUP BY s\.speaker_user_id,month_key,week_key`, \[conferenceId\]\)/);
    assert.ok(taskQuota, "task quota query must exclude the conference being replanned and bind its UUID");
    assert.ok(speakerQuota, "speaker quota query must exclude the conference being replanned and bind its UUID");
    assert.match(taskQuota[0], /AND c\.id<>\$1/);
    assert.match(speakerQuota[0], /AND c\.id<>\$1/);
});

test("Ollama wording is optional and has a bounded short timeout after a deterministic plan is built", () => {
    const management = fs.readFileSync(path.resolve(__dirname, "../management.js"), "utf8");
    const deterministicPlanIndex = management.indexOf("const plan = {");
    const optionalModelIndex = management.indexOf("// Ollama is limited to optional wording/questions", deterministicPlanIndex);
    assert.ok(deterministicPlanIndex >= 0 && optionalModelIndex > deterministicPlanIndex);
    assert.match(management.slice(optionalModelIndex, optionalModelIndex + 1800), /AbortSignal\.timeout\(2000\)/);
    assert.match(management, /Phần diễn giải AI quá thời hạn; phương án khả thi được tạo bằng các quy tắc hệ thống/);
});

const { getActivePlanReservations, reservePlanOptions, buildPlanReservationConstraints } = require("./plan-reservations");

test("pending conference plans reserve schedule intervals and monthly capacity", () => {
    const store = new Map();
    reservePlanOptions(store, "conference-a", [{
        start_time: "2026-11-02T01:30:00.000Z", end_time: "2026-11-02T04:30:00.000Z",
        staffing_plan: { staff: { primary: [{ id: "staff-a" }], backup: { id: "staff-b" } }, speakers: { primary: { id: "speaker-a" }, backup: { id: "speaker-b" } } }
    }], { now: 1000, ttlMs: 60_000 });
    const active = getActivePlanReservations(store, { now: 2000, excludeKey: "conference-b" });
    const constraints = buildPlanReservationConstraints(active);
    assert.equal(constraints.intervals.length, 1);
    assert.equal(constraints.monthlyConferenceCounts.get("2026-11"), 1);
    assert.equal(overlapsTimeInterval("2026-11-02T02:00:00.000Z", "2026-11-02T03:00:00.000Z", constraints.intervals), true);
    assert.equal(constraints.taskWorkload.find(row => row.user_id === "staff-a" && row.month_key === "2026-11").count, 1);
    assert.equal(constraints.speakerWorkload.find(row => row.user_id === "speaker-a" && row.week_key).count, 1);
    assert.equal(constraints.busyTaskDates.get("staff-a").has("2026-11-02"), true);
});

test("a conference can replace its own temporary plan and expired plans are removed", () => {
    const store = new Map();
    reservePlanOptions(store, "conference-a", [{ start_time: "2026-11-02T08:30:00+07:00", end_time: "2026-11-02T11:30:00+07:00" }], { now: 1000, ttlMs: 100 });
    assert.equal(getActivePlanReservations(store, { now: 1050, excludeKey: "conference-a" }).length, 0);
    reservePlanOptions(store, "conference-a", [{ start_time: "2026-11-03T08:30:00+07:00", end_time: "2026-11-03T11:30:00+07:00" }], { now: 2000, ttlMs: 100 });
    assert.equal(getActivePlanReservations(store, { now: 2001 }).length, 1);
    assert.equal(getActivePlanReservations(store, { now: 2100 }).length, 0);
    assert.equal(store.has("conference-a"), false);
});

test("admin plan route consumes and refreshes short-lived draft reservations", () => {
    const management = fs.readFileSync(path.resolve(__dirname, "../management.js"), "utf8");
    const routeStart = management.indexOf('router.post("/ai/conferences/:id/plan"');
    const routeEnd = management.indexOf('router.', routeStart + 10);
    const route = management.slice(routeStart, routeEnd > 0 ? routeEnd : undefined);
    assert.match(route, /getActivePlanReservations\(activeConferencePlanReservations, \{ now: now\.getTime\(\), excludeKey: conferenceId \}\)/);
    assert.match(route, /occupiedIntervals\.push\(\.\.\.draftConstraints\.intervals\)/);
    assert.match(route, /draftConstraints\.taskWorkload/);
    assert.match(route, /draftConstraints\.speakerWorkload/);
    assert.match(route, /reservePlanOptions\(activeConferencePlanReservations, conferenceId, dateOptions/);
    assert.match(route, /draft_reservation: planReservation \?/);
});
