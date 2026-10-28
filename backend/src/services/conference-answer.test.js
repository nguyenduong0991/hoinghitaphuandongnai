const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { requestedConferenceFields, formatConferenceDetails, formatConferenceStatusList } = require("./conference-answer");
const { classifyQuestion } = require("./rag.service");

const formatDate = value => value ? `DATE(${value})` : "";

test("selects only the conference fields asked for", () => {
    const fields = requestedConferenceFields("Hội nghị đó diễn ra ở đâu và ngày giờ nào?");
    assert.deepEqual([...fields].sort(), ["location", "time"]);
    const full = requestedConferenceFields("Hội nghị HN-0011 thời gian, địa điểm, báo cáo viên, trạng thái và ai được phân công?");
    assert.deepEqual([...full].sort(), ["assignees", "location", "speaker", "status", "time"]);
    const scheduleWording = requestedConferenceFields("Mã HN-0012 có lịch tổ chức nào, địa điểm nào và trạng thái nào?");
    assert.deepEqual([...scheduleWording].sort(), ["location", "status", "time"]);
    const naturalLocationWording = requestedConferenceFields("Hội nghị HN-0012 diễn ra ngày giờ nào, tổ chức tại đâu và hồ sơ đang ở trạng thái gì?");
    assert.deepEqual([...naturalLocationWording].sort(), ["location", "status", "time"]);
    const standaloneAtDau = requestedConferenceFields("Hội nghị HN-0012 diễn ra ngày giờ nào, tại đâu và trạng thái hiện nay là gì?");
    assert.deepEqual([...standaloneAtDau].sort(), ["location", "status", "time"]);
});

test("formats requested time, location, speaker and status from database evidence", () => {
    const answer = formatConferenceDetails({
        code: "HN-0011", title: "Tập huấn", status: "APPROVED",
        start_time: "2026-10-26T02:00:00Z", end_time: "2026-10-27T02:00:00Z",
        location_name: "Hội trường xã", location_address: "Xã Lộc Tấn"
    }, [{ full_name: "Lê Minh T", presentation_title: "Nhận diện đối tượng TGPL" }],
    new Set(["time", "location", "speaker", "status", "assignees"]), formatDate,
    [{ assignee_name: "Nguyễn Thị B" }, { assignee_name: "Nguyễn Thị B" }]);

    assert.match(answer, /HN-0011/);
    assert.match(answer, /DATE\(2026-10-26T02:00:00Z\).*DATE\(2026-10-27T02:00:00Z\)/);
    assert.match(answer, /Hội trường xã – Xã Lộc Tấn/);
    assert.match(answer, /Lê Minh T \(Nhận diện đối tượng TGPL\)/);
    assert.match(answer, /đã phê duyệt/);
    assert.match(answer, /người được phân công Nguyễn Thị B/);
});

test("missing conference fields are reported without inventing values", () => {
    const answer = formatConferenceDetails({ code: "HN-0011", title: "Tập huấn" }, [],
        new Set(["time", "location", "speaker", "status", "assignees"]), formatDate, []);
    assert.match(answer, /chưa có dữ liệu thời gian/);
    assert.match(answer, /chưa có dữ liệu địa điểm/);
    assert.match(answer, /chưa có dữ liệu ghi nhận/);
    assert.match(answer, /chưa có dữ liệu trạng thái/);
    assert.match(answer, /người được phân công chưa có dữ liệu ghi nhận/);
});

test("reports inaccessible speaker field separately from an empty speaker list", () => {
    const answer = formatConferenceDetails({ code: "HN-0011", title: "Tập huấn" }, null,
        new Set(["speaker"]), formatDate);
    assert.match(answer, /không có quyền xem trường này/);
});

test("organization status question asking for each code is recognized as a conference data query", () => {
    const result = classifyQuestion("Hội nghị của UBND phường Trảng Dài đang ở trạng thái nào? Nếu có nhiều hội nghị, hãy nêu từng mã.");
    assert.equal(result.isConferenceOrganizationSummaryQuestion, true);
    assert.equal(result.isConferenceDataQuestion, true);
});

test("formats per-conference statuses with each code and no misleading aggregate-only answer", () => {
    const answer = formatConferenceStatusList([
        { code: "HN-0001", title: "Tuyên truyền", status: "PENDING" },
        { code: "HN-0002", title: "Tập huấn", status: "COMPLETED" }
    ], "UBND phường Trảng Dài", 2);
    assert.match(answer, /HN-0001: chờ phê duyệt/);
    assert.match(answer, /HN-0002: hoàn thành/);
    assert.doesNotMatch(answer, /tổng 2; chờ phê duyệt/);
});

test("public access question wording is recognized and guarded to admin allowlist", () => {
    const result = classifyQuestion("Hội nghị HN-0006 có được công khai hay không? Nếu không công khai hãy liệt kê đơn vị được đăng ký.");
    assert.equal(result.isConferenceDataQuestion, true);
    const source = fs.readFileSync(path.join(__dirname, "../routes/ai.routes.js"), "utf8");
    assert.match(source, /asksPublicAccess = \/\(\?:cong khai/);
    assert.match(source, /conference_registration_organizations/);
    assert.match(source, /req\.user\.role !== "ADMIN"/);
    assert.match(source, /scoped_sql_conference_public_access/);
});
test("exact conference route keeps every existing role scope and hides inaccessible records", () => {
    const source = fs.readFileSync(path.join(__dirname, "../routes/ai.routes.js"), "utf8");
    const start = source.indexOf('const scope = `($2::text=\'ADMIN\'');
    const end = source.indexOf('const fields = requestedConferenceFields(question);', start);
    assert.ok(start >= 0 && end > start);
    const scope = source.slice(start, end);
    assert.match(scope, /COMMUNE/);
    assert.match(scope, /organization_id/);
    assert.match(scope, /is_public=TRUE/);
    assert.match(scope, /TASK_ASSIGNEE/);
    assert.match(scope, /assignee_user_id/);
    assert.match(scope, /SPEAKER/);
    assert.match(scope, /speaker_user_id/);
    assert.match(source, /Không tìm thấy hội nghị mã \$\{conferenceCode\} trong phạm vi dữ liệu tài khoản được phép xem/);
    assert.match(source, /assignmentResult = await pool\.query/);
    assert.match(source, /assignee_user_id=\$3::uuid/);
    assert.match(source, /conversation\.clarify && !explicitCodeMatch/);
    assert.match(source, /conversation\.conferenceReferenceAmbiguous/);
    assert.match(source, /asksStatusPerConference/);
    assert.match(source, /formatConferenceStatusList\(conferences\.rows, organization\.name, totals\.total\)/);
    assert.match(source, /LIMIT CASE WHEN \$5::boolean THEN 500 ELSE 8 END/);
});
