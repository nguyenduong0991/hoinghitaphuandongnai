const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
process.env.JWT_SECRET = "test-only-secret-that-is-never-used-in-production-987654321";
const express = require("express");
const { authenticate, requireRole } = require("../auth");
const { AI_ROLE_POLICIES: P } = require("./ai-role-policy");
const { classifyQuestion } = require("./rag.service");
const secret = process.env.JWT_SECRET;
const roles = ["ADMIN", "COMMUNE", "TASK_ASSIGNEE", "SPEAKER"];
const ids = Object.fromEntries(roles.map((role, i) => [role, "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0")]));
function token(role) {
 const payload = Buffer.from(JSON.stringify({ sub: ids[role], iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60 })).toString("base64url");
 return payload + "." + crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}
async function withHttpApp(run) {
 const app = express();
 app.locals.authUserLookup = async id => ({ rows: [{ id, username: "synthetic", full_name: "Test", role: roles.find(r => ids[r] === id), is_active: true, organization_id: null }] });
 app.use("/api", authenticate);
 app.post("/api/ai/tgpl-chat", requireRole(...P.chat), (_q, r) => r.sendStatus(200));
 app.post("/api/ai/conference-plan-proposal", requireRole(...P.readOnlyPlanning), (_q, r) => r.sendStatus(200));
 app.post("/api/ai/conference-topic-advisor", requireRole(...P.readOnlyPlanning), (_q, r) => r.sendStatus(200));
 app.get("/api/ai/contact-requests", requireRole(...P.adminContactRequests), (_q, r) => r.sendStatus(200));
 app.get("/api/ai/my-contact-requests", requireRole(...P.assignedContactRequests), (_q, r) => r.sendStatus(200));
 const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
 try { await run(server.address().port); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function request(port, method, path, role) {
 return fetch("http://127.0.0.1:" + port + path, { method, headers: role ? { authorization: "Bearer " + token(role) } : {} });
}
test("contact-request status and report natural-language intents are explicit and in scope", () => {
 const status = ["Tôi đã gửi yêu cầu tư vấn, làm sao biết yêu cầu đã được tiếp nhận?", "Tôi gửi rồi, hệ thống đã ghi nhận chưa?", "Kiểm tra giúp yêu cầu tư vấn tôi vừa nộp đã nhận chưa"];
 for (const q of status) { const c = classifyQuestion(q); assert.equal(c.intent, "contact_request_status", q); assert.equal(c.isInScope, true, q); }
 const summary = ["Hãy tổng hợp các yêu cầu tư vấn trong tháng 10/2026", "Thống kê yêu cầu trợ giúp pháp lý chưa phân công quý III/2026", "Báo cáo số yêu cầu tư vấn đã gửi trong toàn bộ thời gian"];
 for (const q of summary) { const c = classifyQuestion(q); assert.equal(c.intent, "contact_request_summary", q); assert.equal(c.isInScope, true, q); }
 for (const q of ["Hội nghị HN-0012 diễn ra ở đâu?", "Điều 7 Luật Trợ giúp pháp lý quy định gì?", "Tổng hợp phiếu khảo sát tháng 10/2026"]) assert.notEqual(classifyQuestion(q).intent, "contact_request_summary", q);
});
test("HTTP role gates allow only authorized roles on chatbot routes", async () => withHttpApp(async port => {
 for (const role of roles) for (const path of ["/api/ai/tgpl-chat", "/api/ai/conference-plan-proposal", "/api/ai/conference-topic-advisor"]) assert.equal((await request(port, "POST", path, role)).status, 200, role + " " + path);
 assert.equal((await request(port, "GET", "/api/ai/contact-requests", "ADMIN")).status, 200);
 for (const role of roles.filter(x => x !== "ADMIN")) assert.equal((await request(port, "GET", "/api/ai/contact-requests", role)).status, 403, role);
 for (const role of ["TASK_ASSIGNEE", "SPEAKER"]) assert.equal((await request(port, "GET", "/api/ai/my-contact-requests", role)).status, 200, role);
 for (const role of ["ADMIN", "COMMUNE"]) assert.equal((await request(port, "GET", "/api/ai/my-contact-requests", role)).status, 403, role);
 assert.equal((await request(port, "POST", "/api/ai/tgpl-chat", null)).status, 401);
}));
