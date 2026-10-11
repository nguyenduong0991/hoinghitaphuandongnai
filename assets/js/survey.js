(() => {
  const form = document.getElementById("needSurveyForm");
  if (!form) return;
  const stage = document.getElementById("surveyStage");
  const afterEventFields = document.getElementById("afterEventFields");
  const conferenceSelect = document.getElementById("conferenceId");
  const message = document.getElementById("surveyMessage");
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  stage.addEventListener("change", () => { afterEventFields.hidden = stage.value !== "AFTER_EVENT"; });
  async function load() {
    try {
      const [confResult, surveyResult] = await Promise.all([getConferences(), getMyNeedSurveys()]);
      const user = window.tgplCurrentUser || JSON.parse(localStorage.getItem("tgpl.user") || "{}");
      document.getElementById("organizationName").textContent = user.organization_name || "Đơn vị";
      (confResult.data || []).forEach(conf => {
        const option = document.createElement("option"); option.value = conf.id; option.textContent = `${conf.title || "Hội nghị"} · ${conf.status || ""}`; conferenceSelect.appendChild(option);
      });
      const rows = surveyResult.data || [];
      document.getElementById("mySurveyList").innerHTML = rows.length ? rows.map(item => `<div class="list-group-item"><div class="d-flex justify-content-between gap-2"><strong>${escapeHtml(item.survey_stage === "AFTER_EVENT" ? "Đánh giá sau hội nghị" : "Khảo sát nhu cầu")}</strong><small>${new Date(item.created_at).toLocaleString("vi-VN")}</small></div><div class="small text-muted">${escapeHtml(item.conference_title || item.suggested_area || "Chưa gắn hội nghị")}${item.topics ? ` · ${escapeHtml(item.topics)}` : ""}</div></div>`).join("") : '<div class="list-group-item text-muted">Bạn chưa gửi phiếu khảo sát nào.</div>';
    } catch (error) { document.getElementById("mySurveyList").innerHTML = `<div class="list-group-item text-danger">${escapeHtml(error.message)}</div>`; }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.conference_need = payload.conference_need === "true";
    payload.expected_participants = payload.expected_participants === "" ? null : Number(payload.expected_participants);
    payload.quality_rating = payload.quality_rating || null;
    payload.coordination_rating = payload.coordination_rating || null;
    const button = document.getElementById("submitSurvey"); button.disabled = true;
    message.innerHTML = "";
    try {
      await submitNeedSurvey(payload);
      message.innerHTML = '<div class="alert alert-success">Đã gửi phiếu khảo sát. Cảm ơn đơn vị đã chia sẻ nhu cầu.</div>';
      form.reset(); afterEventFields.hidden = true; await load();
    } catch (error) { message.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message || "Không gửi được phiếu.")}</div>`; }
    finally { button.disabled = false; }
  });
  load();
})();
