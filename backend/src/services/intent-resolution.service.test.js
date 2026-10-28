const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyQuestion } = require("./rag.service");
const { shouldResolveIntent, sanitizeIntentResolution, enforceIntentFit, applyIntentResolution, resolveIntentWithOllama, clearIntentResolutionCache } = require("./intent-resolution.service");

function validResolution(overrides = {}) {
    return {
        intent: "conference_analysis",
        entities: { conference_code: null, organization: "phường Long Bình", account: null, topic: "trợ giúp pháp lý", status: null },
        time_range: { kind: "month", start: "2026-10-01", end_exclusive: "2026-11-01" },
        requested_metric: "topic_frequency", requires_clarification: false, clarification_question: null, ...overrides
    };
}

test("ambiguous app-domain wording is escalated but explicit external and criminal requests are not", () => {
    const ambiguous = classifyQuestion("Buổi tập huấn ở Long Bình đã được duyệt chưa?");
    assert.equal(shouldResolveIntent("Buổi tập huấn ở Long Bình đã được duyệt chưa?", ambiguous), true);
    assert.equal(shouldResolveIntent("Dự báo thời tiết ngày hội nghị", classifyQuestion("Dự báo thời tiết ngày hội nghị")), false);
    assert.equal(shouldResolveIntent("Tội danh này bị phạt bao nhiêu", classifyQuestion("Tội danh này bị phạt bao nhiêu")), false);
    assert.equal(shouldResolveIntent("Hội nghị đó ở đâu?", classifyQuestion("Hội nghị đó ở đâu?"), true), false);
    assert.equal(shouldResolveIntent("xã Lộc Ninh", classifyQuestion("xã Lộc Ninh"), true), false);
});

test("intent JSON rejects invalid labels, malformed entities, dates, statuses and oversized ranges", () => {
    assert.ok(sanitizeIntentResolution(validResolution()));
    assert.equal(sanitizeIntentResolution(validResolution({ intent: "run_sql" })), null);
    assert.equal(sanitizeIntentResolution(validResolution({ entities: { conference_code: "HN-0001; DROP TABLE users" } })), null);
    assert.equal(sanitizeIntentResolution(validResolution({ time_range: { kind: "month", start: "2026-02-30", end_exclusive: "2026-03-01" } })), null);
    assert.equal(sanitizeIntentResolution(validResolution({ entities: { status: "PRIVATE" } })), null);
    assert.equal(sanitizeIntentResolution(validResolution({ time_range: { kind: "range", start: "2000-01-01", end_exclusive: "2020-01-01" } })), null);
});

test("validated intent changes only the router flags and never creates a SQL statement", () => {
    const base = classifyQuestion("Thống kê giúp tôi nội dung được nhắc đến nhiều trong dữ liệu tháng 10/2026");
    const resolved = sanitizeIntentResolution(validResolution({ intent: "survey" }));
    const routed = applyIntentResolution(base, resolved);
    assert.equal(routed.intent, "survey");
    assert.equal(routed.isSurveySummaryQuestion, true);
    assert.equal(routed.isInScope, true);
    assert.equal(routed.querySlots.semanticTimeRange.start, "2026-10-01");
    assert.equal(Object.hasOwn(routed, "sql"), false);
});

test("strong conference wording overrides a contradictory Ollama intent", () => {
    const modelSaysAttendance = validResolution({ intent: "conference_attendance" });
    assert.equal(enforceIntentFit("Buổi tập huấn ở Long Bình đã được duyệt chưa?", modelSaysAttendance).intent, "conference_lookup");
    assert.equal(enforceIntentFit("Lập phương án phân công cho hội nghị HN-0017", modelSaysAttendance).intent, "conference_planning");
    assert.equal(enforceIntentFit("Có bao nhiêu người đã điểm danh hội nghị HN-0017?", validResolution({ intent: "conference_lookup" })).intent, "conference_attendance");
});

test("clarification and out-of-scope intents cannot widen deterministic access", () => {
    const base = classifyQuestion("Câu hỏi khó hiểu về nội dung");
    for (const intent of ["clarify", "out_of_scope"]) {
        const result = applyIntentResolution(base, sanitizeIntentResolution(validResolution({ intent })));
        assert.equal(result.isInScope, false);
        assert.equal(result.intent, "out_of_scope");
    }
});

test("Ollama intent resolution uses strict JSON, bounded generation, and a cache", async () => {
    clearIntentResolutionCache();
    let calls = 0;
    const fetchImpl = async (_url, options) => {
        calls += 1;
        const request = JSON.parse(options.body);
        assert.equal(request.format, "json");
        assert.equal(request.options.num_ctx, 1024);
        assert.equal(request.options.num_predict, 128);
        return { ok: true, json: async () => ({ message: { content: JSON.stringify(validResolution({ intent: "survey" })) } }) };
    };
    const first = await resolveIntentWithOllama("Nội dung được nhắc đến nhiều?", { fetchImpl });
    const second = await resolveIntentWithOllama("Nội dung được nhắc đến nhiều?", { fetchImpl });
    assert.equal(first.intent, "survey");
    assert.equal(second.intent, "survey");
    assert.equal(calls, 1);
    clearIntentResolutionCache();
});

test("malformed model output safely returns no inferred intent", async () => {
    clearIntentResolutionCache();
    const result = await resolveIntentWithOllama("Câu hỏi mơ hồ về hội nghị", { fetchImpl: async () => ({ ok: true, json: async () => ({ message: { content: "không phải JSON" } }) }) });
    assert.equal(result, null);
    clearIntentResolutionCache();
});

