const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    feedbackCorrectionScope,
    consultationTrainingScope,
    filterPromptHistory,
    filterPrivateRagRows
} = require("./ai-rag-access");

const users = {
    ADMIN: { id: "admin-1", role: "ADMIN" },
    COMMUNE: { id: "commune-1", role: "COMMUNE" },
    TASK_ASSIGNEE: { id: "assignee-1", role: "TASK_ASSIGNEE" },
    SPEAKER: { id: "speaker-1", role: "SPEAKER" }
};

const fixtureRows = {
    corrections: [
        { id: "correction-commune", user_id: users.COMMUNE.id, user_role: "COMMUNE", correction_text: "PRIVATE_CORRECTION_COMMUNE" },
        { id: "correction-assignee", user_id: users.TASK_ASSIGNEE.id, user_role: "TASK_ASSIGNEE", correction_text: "PRIVATE_CORRECTION_ASSIGNEE" },
        { id: "correction-speaker", user_id: users.SPEAKER.id, user_role: "SPEAKER", correction_text: "PRIVATE_CORRECTION_SPEAKER" },
        { id: "correction-wrong-role", user_id: users.COMMUNE.id, user_role: "TASK_ASSIGNEE", correction_text: "PRIVATE_CORRECTION_WRONG_ROLE" }
    ],
    consultationNotes: [
        { id: "note-assignee", author_user_id: users.TASK_ASSIGNEE.id, training_text: "STAFF_TRAINING_ASSIGNEE_SECRET" },
        { id: "note-speaker", author_user_id: users.SPEAKER.id, training_text: "STAFF_TRAINING_SPEAKER_SECRET" }
    ],
    publicAttendeeTraining: [
        { id: "public-training", question: "INTERNAL_RESIDENT_QUESTION", training_text: "INTERNAL_RESIDENT_TRAINING_SECRET" }
    ]
};

test("feedback correction SQL scope excludes every non-admin role", () => {
    assert.deepEqual(feedbackCorrectionScope(users.COMMUNE), {
        sql: "FALSE",
        values: []
    });
    assert.deepEqual(feedbackCorrectionScope(users.ADMIN), { sql: "TRUE", values: [] });
});

test("consultation training SQL scope excludes every non-admin role", () => {
    assert.deepEqual(consultationTrainingScope(users.SPEAKER), {
        sql: "FALSE",
        values: []
    });
    assert.deepEqual(consultationTrainingScope(users.ADMIN), { sql: "TRUE", values: [] });
});

for (const role of ["COMMUNE", "TASK_ASSIGNEE", "SPEAKER"]) {
    test(`${role} cannot retrieve another user's internal RAG rows or leak them into answer context`, () => {
        const visible = filterPrivateRagRows(fixtureRows, users[role]);
        const promptEvidence = JSON.stringify(visible);
        const simulatedAnswer = [
            ...visible.corrections.map(row => row.correction_text),
            ...visible.consultationNotes.map(row => row.training_text),
            ...visible.publicAttendeeTraining.map(row => row.training_text)
        ].join(" ");

        assert.ok(!promptEvidence.includes("INTERNAL_RESIDENT_TRAINING_SECRET"));
        assert.ok(!promptEvidence.includes("INTERNAL_RESIDENT_QUESTION"));
        assert.ok(!promptEvidence.includes("PRIVATE_CORRECTION_"));
        assert.ok(!promptEvidence.includes("STAFF_TRAINING_"));
        assert.ok(!simulatedAnswer.includes("STAFF_TRAINING_"));
        assert.ok(!simulatedAnswer.includes("PRIVATE_CORRECTION_"));
        assert.ok(!simulatedAnswer.includes("INTERNAL_RESIDENT_"));
        assert.deepEqual(visible.corrections, []);
        assert.deepEqual(visible.consultationNotes, []);
        assert.equal(visible.publicAttendeeTraining.length, 0);
    });
}

test("ADMIN can retrieve reviewed rows for centralized review and approved RAG use", () => {
    const visible = filterPrivateRagRows(fixtureRows, users.ADMIN);
    assert.equal(visible.corrections.length, fixtureRows.corrections.length);
    assert.equal(visible.consultationNotes.length, fixtureRows.consultationNotes.length);
    assert.equal(visible.publicAttendeeTraining.length, fixtureRows.publicAttendeeTraining.length);
});

test("missing identity cannot read private correction or consultation data", () => {
    const anonymous = { role: "COMMUNE" };
    const visible = filterPrivateRagRows(fixtureRows, anonymous);
    assert.deepEqual(visible.corrections, []);
    assert.deepEqual(visible.consultationNotes, []);
    assert.deepEqual(visible.publicAttendeeTraining, []);
});

test("non-admin prompt history drops prior assistant text while preserving user turns", () => {
    const history = [
        { role: "user", content: "Câu hỏi trước của người dùng" },
        { role: "assistant", content: "STAFF_TRAINING_OLD_RESPONSE_SECRET" },
        { role: "user", content: "Cần giấy tờ gì?" }
    ];
    const scoped = filterPromptHistory(history, users.COMMUNE);
    assert.deepEqual(scoped, [history[0], history[2]]);
    assert.ok(!JSON.stringify(scoped).includes("STAFF_TRAINING_OLD_RESPONSE_SECRET"));
    assert.deepEqual(filterPromptHistory(history, users.ADMIN), history);
});

test("production chat route applies access filters before retrieval and Ollama prompt construction", () => {
    const source = fs.readFileSync(path.join(__dirname, "../routes/ai.routes.js"), "utf8");
    const correctionFilter = source.indexOf("const visible = filterPrivateRagRows({ corrections: corrected.rows }, req.user)");
    const trainingFilter = source.indexOf("const visibleTraining = filterPrivateRagRows(trainingRows, req.user)");
    const retrievalCall = source.indexOf("await retrieveHybrid(retrievalQuestion");
    const historyFilter = source.indexOf("filterPromptHistory(history, req.user)");
    const memoryAssembly = source.indexOf("conversationMemory.promptText");
    const promptAssembly = source.indexOf("messages: [{ role: \"system\", content: system }, { role: \"user\", content: question }]");

    assert.ok(correctionFilter >= 0 && correctionFilter < retrievalCall);
    assert.ok(trainingFilter >= 0 && trainingFilter < retrievalCall);
    assert.ok(historyFilter >= 0 && memoryAssembly > historyFilter && promptAssembly > memoryAssembly);
    assert.doesNotMatch(source, /\.\.\.promptHistory/);
    assert.match(source, /router\.post\("\/tgpl-chat", requireRole\(\.\.\.aiRoles\)/);
    assert.match(source, /router\.post\("\/tgpl-chat\/stream", requireRole\(\.\.\.aiRoles\)/);
});

test("assigned-staff API response does not expose admin notes or approved training text", () => {
    const source = fs.readFileSync(path.join(__dirname, "../routes/ai.routes.js"), "utf8");
    const start = source.indexOf('router.get("/my-contact-requests"');
    const end = source.indexOf('router.post("/my-contact-requests/:id/feedback"', start);
    assert.ok(start >= 0 && end > start);
    const assignedStaffRoute = source.slice(start, end);
    assert.doesNotMatch(assignedStaffRoute, /'admin_note'\s*,\s*f\.admin_note/);
    assert.doesNotMatch(assignedStaffRoute, /'training_text'\s*,\s*f\.training_text/);
});
