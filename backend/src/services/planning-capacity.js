const LIMITS = Object.freeze({
    taskAssignee: { monthly: 5, weekly: 2 },
    speaker: { monthly: 3, weekly: 1 },
    staffPrimary: 3,
    staffBackup: 1,
    speakerPrimary: 1,
    speakerBackup: 1
});

// Trusted planning policy is included in Ollama prompts, while eligibility is
// enforced independently by backend code. This is policy context, not training.
const SHORTAGE_POLICY = "Cơ cấu mục tiêu: 3 cán bộ chính thức + 1 dự bị, 1 báo cáo viên chính thức + 1 dự bị. Không vượt hạn mức cá nhân 5 nhiệm vụ/tháng, 2/tuần với cán bộ và 3 lượt thuyết trình/tháng, 1/tuần với báo cáo viên. Nếu người dùng nêu ngày cụ thể, trước hết kiểm tra xung đột thời gian với lịch hội nghị đang ghi nhận; nếu không xung đột, giữ ngày đó làm phương án ưu tiên kể cả khi nhân sự chưa đủ cơ cấu. Nêu người phù hợp và tải tháng/tuần, chỉ rõ vị trí thiếu để admin quyết định; không tự vượt hạn mức, xác nhận phân công thiếu, lưu hoặc gửi thông báo. Có thể nêu thêm các ngày đủ cơ cấu làm phương án thay thế. Chỉ chuyển ngày khi ngày yêu cầu xung đột lịch, bị giới hạn công suất tháng hoặc người dùng đồng ý chọn phương án khác.";

function localDateParts(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((result, part) => (result[part.type] = part.value, result), {});
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), monthKey: `${parts.year}-${parts.month}`, dayKey: `${parts.year}-${parts.month}-${parts.day}` };
}

function matchExplicitPlanningDate(value) {
    const raw = String(value || "").normalize("NFKC");
    const direct = raw.match(/\bngày\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{4}))?\b/iu);
    if (direct) return direct;
    // Normalization can turn 07/12/2026 into "ngay 07 12 2026".
    const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d");
    return normalized.match(/\bngay\s*(\d{1,2})\s+(\d{1,2})(?:\s+(\d{4}))?\b/iu);
}

function weekStartKey(value) {
    const parts = localDateParts(value);
    if (!parts) return "";
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const weekday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekday);
    return date.toISOString().slice(0, 10);
}

function personCapacity(person, date, workload, limits) {
    const parts = localDateParts(date);
    if (!parts) return { eligible: false, monthly_count: 0, weekly_count: 0, reason: "Ngày dự kiến không hợp lệ" };
    const rows = workload.filter(item => String(item.user_id) === String(person.id));
    const weekKey = weekStartKey(date);
    const monthly = rows.filter(item => item.month_key === parts.monthKey).reduce((sum, item) => sum + Number(item.count || 0), 0);
    const weekly = rows.find(item => item.week_key === weekKey)?.count || 0;
    const eligible = monthly < limits.monthly && weekly < limits.weekly;
    return {
        eligible,
        monthly_count: Number(monthly),
        monthly_limit: limits.monthly,
        weekly_count: Number(weekly),
        weekly_limit: limits.weekly,
        reason: eligible ? "Còn hạn mức tháng và tuần" : monthly >= limits.monthly ? "Đã đủ hạn mức tháng" : "Đã đủ hạn mức tuần"
    };
}

function rankAvailable(people, date, workload, limits, preferredIds = []) {
    const preferred = new Set(preferredIds.map(String));
    return people.map(person => ({
        ...person,
        capacity: personCapacity(person, date, workload, limits),
        preferred: preferred.has(String(person.id))
    })).filter(person => person.capacity.eligible)
        .sort((a, b) => Number(b.preferred) - Number(a.preferred)
            || a.capacity.monthly_count - b.capacity.monthly_count
            || a.capacity.weekly_count - b.capacity.weekly_count
            || String(a.full_name).localeCompare(String(b.full_name), "vi"));
}

function isFullyStaffed(staffingPlan, limits = LIMITS) {
    const staff = staffingPlan?.staff || {};
    const speakers = staffingPlan?.speakers || {};
    return Array.isArray(staff.primary) && staff.primary.length >= limits.staffPrimary
        && Boolean(staff.backup)
        && Boolean(speakers.primary)
        && Boolean(speakers.backup);
}

function staffingShortages(staffingPlan, limits = LIMITS) {
    const staff = staffingPlan?.staff || {};
    const speakers = staffingPlan?.speakers || {};
    const missingStaff = Math.max(0, limits.staffPrimary - (staff.primary?.length || 0)) + (staff.backup ? 0 : limits.staffBackup);
    const missingSpeakers = Math.max(0, limits.speakerPrimary - (speakers.primary ? 1 : 0)) + (speakers.backup ? 0 : limits.speakerBackup);
    return { staff: missingStaff, speakers: missingSpeakers };
}

function overlapsTimeInterval(start, end, intervals = []) {
    const startMs = new Date(start).getTime(), endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return true;
    return intervals.some(interval => startMs < new Date(interval.end).getTime() && endMs > new Date(interval.start).getTime());
}

function hasConferenceScheduleConflict(start, end, conferences = []) {
    return conferences.some(item => overlapsTimeInterval(start, end, [{
        start: item.start_time ?? item.start,
        end: item.end_time ?? item.end
    }]));
}

function findApprovedScheduleConflicts(requestedStart, requestedEnd, requestedOrganizationId, conferences = []) {
    if (!requestedOrganizationId) return [];
    return conferences.filter(item => {
        const status = String(item.status || "").toUpperCase();
        const confirmed = status === "APPROVED" || (status === "RESCHEDULED" && String(item.reschedule_response || "").toUpperCase() === "ACCEPTED");
        return confirmed
        && String(item.organization_id || "") === String(requestedOrganizationId)
        && overlapsTimeInterval(requestedStart, requestedEnd, [{ start: item.start, end: item.end }]);
    })
        .map(item => ({ code: item.code, title: item.title, organization_name: item.organization_name, start: item.start, end: item.end }));
}
function isConferenceMonthAvailable(date, countsByMonth, monthlyCap = 15) {
    const parts = localDateParts(date);
    return Boolean(parts && Number(countsByMonth?.get(parts.monthKey) || 0) < monthlyCap);
}

function canKeepRequestedSchedule({ start, end, now = new Date(), approvedConflicts = [], draftIntervals = [] } = {}) {
    const startDate = new Date(start), endDate = new Date(end), nowDate = new Date(now);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate
        || !Number.isFinite(nowDate.getTime()) || startDate <= nowDate) return false;
    if (approvedConflicts.length) return false;
    return !overlapsTimeInterval(startDate, endDate, draftIntervals);
}

function findNearestFeasibleOptions(options, buildPlan, limits = LIMITS, maxOptions = 3) {
    const feasible = [], checked = [];
    let bestCandidate = null;
    for (const option of options) {
        const staffing = buildPlan(option.start_time);
        const item = { option, staffing };
        checked.push(item);
        if (isFullyStaffed(staffing, limits)) {
            feasible.push(item);
            if (feasible.length >= maxOptions) break;
            continue;
        }
        const shortages = staffingShortages(staffing, limits);
        if (!bestCandidate || shortages.staff + shortages.speakers < bestCandidate.shortages.staff + bestCandidate.shortages.speakers) {
            bestCandidate = { option, staffing, shortages };
        }
    }
    return { feasible, checked, bestCandidate };
}

function prioritizeRequestedDateOption(options, requestedDate, requestedDateCandidate) {
    if (!requestedDate || !requestedDateCandidate
        || localDateParts(requestedDateCandidate.option?.start_time)?.dayKey !== requestedDate) return options;
    const candidateId = String(requestedDateCandidate.option?.id || "");
    return [requestedDateCandidate, ...options.filter(item => String(item.option?.id || "") !== candidateId)];
}

function selectNearestDateOptions(checked, { requestedDate = "", maxOptions = 3, limits = LIMITS } = {}) {
    const byDay = new Map();
    for (const item of checked || []) {
        const dayKey = localDateParts(item?.option?.start_time)?.dayKey;
        if (!dayKey || dayKey === requestedDate) continue;
        const current = byDay.get(dayKey);
        const score = candidate => [
            isFullyStaffed(candidate.staffing, limits) ? 0 : 1,
            staffingShortages(candidate.staffing, limits).staff + staffingShortages(candidate.staffing, limits).speakers,
            new Date(candidate.option.start_time).getTime()
        ];
        if (!current || score(item).some((value, index) => value < score(current)[index]
            && score(item).slice(0, index).every((prior, priorIndex) => prior === score(current)[priorIndex]))) byDay.set(dayKey, item);
    }
    return [...byDay.entries()].sort((left, right) => left[0].localeCompare(right[0]))
        .slice(0, Math.max(0, maxOptions)).map(([, item]) => item);
}

module.exports = { LIMITS, SHORTAGE_POLICY, localDateParts, matchExplicitPlanningDate, weekStartKey, personCapacity, rankAvailable, isFullyStaffed, staffingShortages, overlapsTimeInterval, hasConferenceScheduleConflict, findApprovedScheduleConflicts, isConferenceMonthAvailable, canKeepRequestedSchedule, findNearestFeasibleOptions, prioritizeRequestedDateOption, selectNearestDateOptions };
