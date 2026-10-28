const ADMIN_ROLE = "ADMIN";

function isAdmin(user) {
    return user?.role === ADMIN_ROLE;
}

function feedbackCorrectionScope(user) {
    return { sql: isAdmin(user) ? "TRUE" : "FALSE", values: [] };
}

function consultationTrainingScope(user) {
    return { sql: isAdmin(user) ? "TRUE" : "FALSE", values: [] };
}

function canReadFeedbackCorrection(row, user) {
    return isAdmin(user);
}

function canReadConsultationTraining(row, user) {
    return isAdmin(user);
}

function canReadPublicAttendeeTraining(user) {
    // Admin approval controls quality, not audience. No audience grant exists in the schema.
    return isAdmin(user);
}

function filterPromptHistory(history, user) {
    const entries = Array.isArray(history) ? history : [];
    // Prior assistant text may contain material produced before these access
    // controls existed. Non-admin prompts carry forward only the user's own questions.
    return isAdmin(user) ? entries : entries.filter(item => item?.role === "user");
}

function filterPrivateRagRows({ corrections = [], consultationNotes = [], publicAttendeeTraining = [] } = {}, user) {
    return {
        corrections: corrections.filter(row => canReadFeedbackCorrection(row, user)),
        consultationNotes: consultationNotes.filter(row => canReadConsultationTraining(row, user)),
        publicAttendeeTraining: canReadPublicAttendeeTraining(user) ? publicAttendeeTraining : []
    };
}

module.exports = {
    feedbackCorrectionScope,
    consultationTrainingScope,
    canReadFeedbackCorrection,
    canReadConsultationTraining,
    canReadPublicAttendeeTraining,
    filterPromptHistory,
    filterPrivateRagRows
};
