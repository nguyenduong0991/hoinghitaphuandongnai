const { localDateParts, weekStartKey } = require("./planning-capacity");

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function getActivePlanReservations(store, { now = Date.now(), excludeKey = "" } = {}) {
    const active = [];
    for (const [key, reservation] of store) {
        if (!reservation || reservation.expiresAt <= now) {
            store.delete(key);
            continue;
        }
        if (key !== String(excludeKey)) active.push(reservation);
    }
    return active;
}

function reservePlanOptions(store, key, options, { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
    const normalizedKey = String(key || "");
    if (!normalizedKey) throw new TypeError("A conference key is required for a plan reservation.");
    const validOptions = (Array.isArray(options) ? options : []).filter(option =>
        Number.isFinite(new Date(option?.start_time).getTime()) && Number.isFinite(new Date(option?.end_time).getTime()));
    if (!validOptions.length) {
        store.delete(normalizedKey);
        return null;
    }
    const reservation = { key: normalizedKey, createdAt: now, expiresAt: now + ttlMs, options: validOptions };
    store.set(normalizedKey, reservation);
    return reservation;
}

function buildPlanReservationConstraints(reservations = []) {
    const intervals = [];
    const monthlyConferenceCounts = new Map();
    const taskWorkload = [];
    const speakerWorkload = [];
    const busyTaskDates = new Map();
    const busySpeakerDates = new Map();

    const addBusyDate = (map, userId, dayKey) => {
        if (!userId || !dayKey) return;
        const dates = map.get(String(userId)) || new Set();
        dates.add(dayKey);
        map.set(String(userId), dates);
    };
    const appendWorkload = (target, seen, userId, monthKey, weekKey) => {
        if (!userId || !monthKey || !weekKey) return;
        const id = String(userId);
        const monthId = `${id}|${monthKey}`;
        const weekId = `${id}|${weekKey}`;
        if (!seen.month.has(monthId)) {
            seen.month.add(monthId);
            target.push({ user_id: id, month_key: monthKey, week_key: "", count: 1 });
        }
        if (!seen.week.has(weekId)) {
            seen.week.add(weekId);
            target.push({ user_id: id, month_key: "", week_key: weekKey, count: 1 });
        }
    };

    for (const reservation of reservations) {
        const conferenceMonths = new Set();
        const taskSeen = { month: new Set(), week: new Set() };
        const speakerSeen = { month: new Set(), week: new Set() };
        for (const option of reservation.options || []) {
            const start = new Date(option.start_time);
            const end = new Date(option.end_time);
            const parts = localDateParts(start);
            const weekKey = weekStartKey(start);
            if (!parts || !weekKey || !Number.isFinite(end.getTime())) continue;
            intervals.push({ start, end });
            conferenceMonths.add(parts.monthKey);
            const staffing = option.staffing_plan || {};
            const taskPeople = [
                ...(Array.isArray(staffing.staff?.primary) ? staffing.staff.primary : []),
                staffing.staff?.backup
            ].filter(Boolean);
            const speakerPeople = [staffing.speakers?.primary, staffing.speakers?.backup].filter(Boolean);
            for (const person of taskPeople) {
                const userId = person.id || person.user_id;
                appendWorkload(taskWorkload, taskSeen, userId, parts.monthKey, weekKey);
                addBusyDate(busyTaskDates, userId, parts.dayKey);
            }
            for (const person of speakerPeople) {
                const userId = person.id || person.user_id;
                appendWorkload(speakerWorkload, speakerSeen, userId, parts.monthKey, weekKey);
                addBusyDate(busySpeakerDates, userId, parts.dayKey);
            }
        }
        for (const monthKey of conferenceMonths) monthlyConferenceCounts.set(monthKey, (monthlyConferenceCounts.get(monthKey) || 0) + 1);
    }
    return { intervals, monthlyConferenceCounts, taskWorkload, speakerWorkload, busyTaskDates, busySpeakerDates };
}

module.exports = { DEFAULT_TTL_MS, getActivePlanReservations, reservePlanOptions, buildPlanReservationConstraints };
