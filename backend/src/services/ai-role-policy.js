const AI_ROLE_POLICIES = Object.freeze({
 chat: Object.freeze(["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"]),
 readOnlyPlanning: Object.freeze(["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"]),
 adminContactRequests: Object.freeze(["ADMIN"]),
 assignedContactRequests: Object.freeze(["TASK_ASSIGNEE", "SPEAKER"])
});
module.exports = { AI_ROLE_POLICIES };
