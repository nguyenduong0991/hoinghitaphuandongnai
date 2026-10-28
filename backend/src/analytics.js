const express = require("express");
const pool = require("./config/database");
const router = express.Router();

function count(value) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function forecast(points) {
    const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
    if (sorted.length < 3) return { value: null, trend_percent: null, basis_months: sorted.length, confidence: "insufficient_data" };
    const xs = sorted.map(point => {
        const [year, month] = point.month.split("-").map(Number);
        return year * 12 + month;
    });
    const ys = sorted.map(point => Number(point.contacts));
    const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
    const slope = denominator ? xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / denominator : 0;
    const value = Math.max(0, Math.round(yMean + slope * (xs[xs.length - 1] + 1 - xMean)));
    const previous = ys.slice(-6, -3);
    const recent = ys.slice(-3);
    const previousMean = previous.length ? previous.reduce((sum, item) => sum + item, 0) / previous.length : 0;
    const recentMean = recent.reduce((sum, item) => sum + item, 0) / recent.length;
    const trend = previousMean > 0 ? Math.round(((recentMean - previousMean) / previousMean) * 1000) / 10 : null;
    return { value, trend_percent: trend, basis_months: sorted.length, confidence: sorted.length >= 6 ? "indicative" : "limited" };
}

router.get("/needs", async (req, res) => {
    const from = req.query.from || "2000-01-01";
    const to = req.query.to || "2999-12-31";
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) < Date.parse(from)) {
        return res.status(400).json({ success: false, message: "Khoảng thời gian không hợp lệ." });
    }
    const [organizations, conferenceRows, participantRows, metricsRows, monthlyRows, topics, populationGroups, statusRows, contentRows] = await Promise.all([
        pool.query("SELECT id, code, name, organization_type FROM organizations WHERE is_active = TRUE ORDER BY name"),
        pool.query(`SELECT organization_id, COUNT(*)::int AS conference_count,
                    COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_count,
                    COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
                    COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_count,
                    COUNT(*) FILTER (WHERE status = 'RESCHEDULED')::int AS rescheduled_count,
                    COALESCE(SUM(expected_participants), 0)::int AS expected_participants
                    FROM conferences WHERE start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                      AND start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                    GROUP BY organization_id`, [from, to]),
        pool.query(`SELECT c.organization_id, COALESCE(SUM(p.actual_count), 0)::int AS actual_participants,
                    COUNT(DISTINCT p.conference_id)::int AS attendance_reported_conferences
                    FROM conference_participant_groups p
                    JOIN conferences c ON c.id = p.conference_id
                    WHERE c.start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                      AND c.start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                    GROUP BY c.organization_id`, [from, to]),
        pool.query(`SELECT organization_id, COUNT(DISTINCT date_trunc('month', period_start))::int AS reporting_periods,
                    COALESCE(SUM(contacts_count), 0)::int AS contacts_count,
                    COALESCE(SUM(referrals_count), 0)::int AS referrals_count,
                    COALESCE(SUM(cases_count), 0)::int AS cases_count
                    FROM legal_aid_access_metrics
                    WHERE period_start <= $2::date AND period_end >= $1::date AND topic='ALL' AND population_group='ALL'
                    GROUP BY organization_id`, [from, to]),
        pool.query(`SELECT to_char(date_trunc('month', period_start), 'YYYY-MM') AS month,
                    SUM(contacts_count)::int AS contacts, SUM(referrals_count)::int AS referrals,
                    SUM(cases_count)::int AS cases, COUNT(DISTINCT organization_id)::int AS reporting_areas
                    FROM legal_aid_access_metrics WHERE period_start <= $2::date AND period_end >= $1::date AND topic='ALL' AND population_group='ALL'
                    GROUP BY date_trunc('month', period_start) ORDER BY date_trunc('month', period_start) DESC LIMIT 120`, [from, to]),
        pool.query(`SELECT topic, population_group, SUM(contacts_count)::int AS contacts_count,
                    SUM(cases_count)::int AS cases_count
                    FROM legal_aid_access_metrics WHERE period_start <= $2::date AND period_end >= $1::date AND population_group='ALL' AND topic<>'ALL'
                    GROUP BY topic, population_group ORDER BY SUM(contacts_count) DESC LIMIT 20`, [from, to]),
        pool.query(`SELECT population_group, SUM(contacts_count)::int AS contacts_count, SUM(cases_count)::int AS cases_count
                    FROM legal_aid_access_metrics WHERE period_start <= $2::date AND period_end >= $1::date AND topic='ALL' AND population_group<>'ALL'
                    GROUP BY population_group ORDER BY SUM(contacts_count) DESC LIMIT 20`, [from, to]),
        pool.query(`SELECT COUNT(*)::int AS registered_count,
                    COUNT(*) FILTER (WHERE status='PENDING')::int AS pending_count,
                    COUNT(*) FILTER (WHERE status='APPROVED')::int AS approved_count,
                    COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed_count,
                    COUNT(*) FILTER (WHERE status='RESCHEDULED')::int AS rescheduled_count,
                    COUNT(*) FILTER (WHERE status='REJECTED')::int AS rejected_count,
                    COUNT(*) FILTER (WHERE status='CANCELLED')::int AS cancelled_count
                    FROM conferences WHERE start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                      AND start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`, [from, to]),
        pool.query(`SELECT MIN(BTRIM(title)) AS content_title,COUNT(*)::int AS conference_count,
                    COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed_count,
                    COALESCE(SUM(expected_participants),0)::int AS expected_participants
                    FROM conferences
                    WHERE start_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                      AND start_time < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                    GROUP BY LOWER(REGEXP_REPLACE(BTRIM(title),'\\s+',' ','g'))`, [from, to])
    ]);
    const conferenceMap = new Map(conferenceRows.rows.map(row => [row.organization_id, row]));
    const metricMap = new Map(metricsRows.rows.map(row => [row.organization_id, row]));
    const participantMap = new Map(participantRows.rows.map(row => [row.organization_id, row]));
    const monthly = monthlyRows.rows.reverse().map(row => ({ ...row, contacts: Number(row.contacts), referrals: Number(row.referrals), cases: Number(row.cases) }));
    const areas = organizations.rows.map(organization => {
        const conference = conferenceMap.get(organization.id) || {};
        const metric = metricMap.get(organization.id) || {};
        const participation = participantMap.get(organization.id) || {};
        const contacts = Number(metric.contacts_count || 0);
        const caseCount = Number(metric.cases_count || 0);
        return {
            ...organization,
            conference_count: Number(conference.conference_count || 0),
            completed_count: Number(conference.completed_count || 0),
            pending_count: Number(conference.pending_count || 0),
            approved_count: Number(conference.approved_count || 0),
            rescheduled_count: Number(conference.rescheduled_count || 0),
            expected_participants: Number(conference.expected_participants || 0),
            actual_participants: Number(participation.actual_participants || 0),
            attendance_reported_conferences: Number(participation.attendance_reported_conferences || 0),
            reporting_periods: Number(metric.reporting_periods || 0),
            contacts_count: contacts,
            referrals_count: Number(metric.referrals_count || 0),
            cases_count: caseCount,
            demand_level: Number(metric.reporting_periods || 0) === 0 ? "NO_DATA" : contacts >= 20 || caseCount >= 10 ? "HIGH" : contacts <= 3 ? "LOW_REPORTED" : "MODERATE"
        };
    });
    const reportedAreas = areas.filter(area => area.reporting_periods > 0);
    const highDemand = reportedAreas.filter(area => area.demand_level === "HIGH").sort((a, b) => b.contacts_count - a.contacts_count).slice(0, 5);
    const lowDemand = reportedAreas.filter(area => area.demand_level === "LOW_REPORTED").sort((a, b) => a.contacts_count - b.contacts_count).slice(0, 5);
    const highAttendance = areas.filter(area => area.attendance_reported_conferences > 0).sort((a, b) => b.actual_participants - a.actual_participants).slice(0, 5);
    const lowAttendance = areas.filter(area => area.attendance_reported_conferences > 0).sort((a, b) => a.actual_participants - b.actual_participants).slice(0, 5);
    const frequentOrganizations = [...areas].sort((a, b) => b.completed_count - a.completed_count || b.conference_count - a.conference_count || a.name.localeCompare(b.name, "vi")).slice(0, 5);
    const infrequentOrganizations = [...areas].sort((a, b) => a.completed_count - b.completed_count || a.conference_count - b.conference_count || a.name.localeCompare(b.name, "vi")).slice(0, 5);
    const conferenceContents = contentRows.rows.map(row => ({ ...row,
        conference_count: Number(row.conference_count), completed_count: Number(row.completed_count),
        expected_participants: Number(row.expected_participants)
    }));
    const overallForecast = forecast(monthly);
    const recommendations = areas.map(area => {
        if (!area.reporting_periods) return { organization_id: area.id, organization_name: area.name, priority: "COLLECT_DATA", reason: "Chưa có số liệu lượt tiếp cận theo kỳ; chưa đủ căn cứ đánh giá mức nhu cầu." };
        if (area.contacts_count >= 20 && area.completed_count < 2) return { organization_id: area.id, organization_name: area.name, priority: "HIGH", reason: "Số lượt tiếp cận được ghi nhận cao trong khi số hội nghị hoàn thành còn ít." };
        if (area.contacts_count > 0 && area.expected_participants === 0) return { organization_id: area.id, organization_name: area.name, priority: "REVIEW", reason: "Có phát sinh lượt tiếp cận; cần rà soát kế hoạch hội nghị và cập nhật số người dự kiến." };
        return { organization_id: area.id, organization_name: area.name, priority: "MONITOR", reason: "Tiếp tục cập nhật số liệu định kỳ để theo dõi xu hướng." };
    }).sort((a, b) => { const rank = { HIGH: 0, REVIEW: 1, COLLECT_DATA: 2, MONITOR: 3 }; return rank[a.priority] - rank[b.priority]; }).slice(0, 10);
    res.json({ success: true, data: {
        period: { from, to }, areas,
        status_counts: Object.fromEntries(Object.entries(statusRows.rows[0] || {}).map(([key, value]) => [key, Number(value)])),
        frequent_organizations: frequentOrganizations,
        infrequent_organizations: infrequentOrganizations,
        high_attendance_areas: highAttendance,
        low_attendance_areas: lowAttendance,
        most_frequent_conference_contents: [...conferenceContents].sort((a, b) => b.conference_count - a.conference_count || a.content_title.localeCompare(b.content_title, "vi")).slice(0, 5),
        least_frequent_conference_contents: [...conferenceContents].sort((a, b) => a.conference_count - b.conference_count || a.content_title.localeCompare(b.content_title, "vi")).slice(0, 5),
        high_demand_areas: highDemand,
        low_reported_demand_areas: lowDemand,
        monthly_trend: monthly,
        forecast_next_month: { ...overallForecast, month: (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); })() },
        topic_demand: topics.rows,
        population_group_demand: populationGroups.rows,
        recommendations,
        note: "Số hội nghị tính theo ngày bắt đầu trong khoảng lọc; xếp hạng đơn vị dựa trên số hội nghị hoàn thành. Người tham dự thực tế được cộng từ các nhóm thành phần đã nhập; nội dung được nhóm theo tiêu đề hội nghị đã chuẩn hóa. Chỉ phản ánh số liệu được báo cáo và biến động quan sát được; chưa thể kết luận hội nghị là nguyên nhân duy nhất làm thay đổi khả năng tiếp cận TGPL. Khu vực thiếu dữ liệu không được xem là khu vực ít nhu cầu."
    } });
});

router.get("/conference-impact", async (req, res) => {
    const months = Math.max(1, Math.min(12, Number.parseInt(req.query.months, 10) || 3));
    const from = req.query.from || "2000-01-01";
    const to = req.query.to || "2999-12-31";
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) < Date.parse(from)) {
        return res.status(400).json({ success: false, message: "Khoảng thời gian không hợp lệ." });
    }
    const result = await pool.query(`SELECT c.id AS conference_id, c.code, c.title, c.start_time,
        o.name AS organization_name,
        COALESCE((SELECT SUM(m.contacts_count) FROM legal_aid_access_metrics m
            WHERE m.organization_id = c.organization_id
            AND m.period_start >= date_trunc('month', c.start_time) - ($1 * INTERVAL '1 month')
            AND m.period_start < date_trunc('month', c.start_time) AND m.topic='ALL' AND m.population_group='ALL'), 0)::int AS before_contacts,
        COALESCE((SELECT COUNT(*) FROM legal_aid_access_metrics m
            WHERE m.organization_id = c.organization_id
            AND m.period_start >= date_trunc('month', c.start_time) - ($1 * INTERVAL '1 month')
            AND m.period_start < date_trunc('month', c.start_time) AND m.topic='ALL' AND m.population_group='ALL'), 0)::int AS before_periods,
        COALESCE((SELECT SUM(m.contacts_count) FROM legal_aid_access_metrics m
            WHERE m.organization_id = c.organization_id
            AND m.period_start >= date_trunc('month', c.start_time) + INTERVAL '1 month'
            AND m.period_start < date_trunc('month', c.start_time) + (($1 + 1) * INTERVAL '1 month')), 0)::int AS after_contacts,
        COALESCE((SELECT COUNT(*) FROM legal_aid_access_metrics m
            WHERE m.organization_id = c.organization_id
            AND m.period_start >= date_trunc('month', c.start_time) + INTERVAL '1 month'
            AND m.period_start < date_trunc('month', c.start_time) + (($1 + 1) * INTERVAL '1 month')), 0)::int AS after_periods
        FROM conferences c JOIN organizations o ON o.id = c.organization_id
        WHERE c.status = 'COMPLETED'
          AND c.start_time >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND c.start_time < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND c.start_time < date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
        ORDER BY c.start_time DESC`, [months, from, to]);
    const data = result.rows.map(row => {
        const before = Number(row.before_contacts);
        const after = Number(row.after_contacts);
        return {
            ...row,
            observed_change_percent: before > 0 && Number(row.before_periods) > 0 && Number(row.after_periods) > 0
                ? Math.round(((after / Number(row.after_periods) - before / Number(row.before_periods)) / (before / Number(row.before_periods))) * 1000) / 10
                : null,
            evidence_status: Number(row.before_periods) >= months && Number(row.after_periods) >= months ? "COMPARABLE" : "INCOMPLETE",
            window_months: months
        };
    });
    res.json({ success: true, data, note: "So sánh mô tả thay đổi lượt tiếp cận được ghi nhận trước và sau hội nghị; không chứng minh quan hệ nhân quả." });
});

router.post("/metrics", async (req, res) => {
    const { organization_id, period_start, period_end, topic = "ALL", population_group = "ALL", source = null, notes = null } = req.body || {};
    const contacts = count(req.body?.contacts_count);
    const referrals = count(req.body?.referrals_count);
    const cases = count(req.body?.cases_count);
    if (!organization_id || !period_start || !period_end || contacts === null || referrals === null || cases === null || Date.parse(period_end) < Date.parse(period_start)) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập đơn vị, kỳ báo cáo và các số liệu không âm hợp lệ." });
    }
    const result = await pool.query(`INSERT INTO legal_aid_access_metrics
        (organization_id, period_start, period_end, topic, population_group, contacts_count, referrals_count, cases_count, source, notes, recorded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (organization_id,period_start,period_end,topic,population_group) DO UPDATE SET
            contacts_count=EXCLUDED.contacts_count,referrals_count=EXCLUDED.referrals_count,cases_count=EXCLUDED.cases_count,source=EXCLUDED.source,notes=EXCLUDED.notes,recorded_by=EXCLUDED.recorded_by,updated_at=NOW()
        RETURNING *`,
    [organization_id, period_start, period_end, String(topic).slice(0, 160), String(population_group).slice(0, 160), contacts, referrals, cases, source, notes, req.user.id]);
    res.status(201).json({ success: true, data: result.rows[0] });
});

router.get("/metrics", async (req, res) => {
    const result = await pool.query(`SELECT m.*, o.name AS organization_name
        FROM legal_aid_access_metrics m JOIN organizations o ON o.id = m.organization_id
        ORDER BY period_start DESC, o.name LIMIT 500`);
    res.json({ success: true, data: result.rows });
});

module.exports = router;








