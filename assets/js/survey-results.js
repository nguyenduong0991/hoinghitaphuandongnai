(() => {
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const ratingAverage = (items, key) => { const values = items.map(row => Number(row[key])).filter(value => value >= 1 && value <= 5); return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "—"; };
  function frequencies(rows, key, split = false) {
    const counts = new Map();
    rows.forEach(row => String(row[key] || "").split(split ? /[\n,;；]+/ : /\u0000/).map(value => value.trim()).filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }
  function renderFrequency(targetId, pairs, empty) {
    document.getElementById(targetId).innerHTML = pairs.length ? pairs.map(([label, count]) => `<tr><td>${escapeHtml(label)}</td><td><span class="badge text-bg-primary">${count}</span></td></tr>`).join("") : `<tr><td colspan="2" class="text-muted">${empty}</td></tr>`;
  }
  async function load() {
    const message = document.getElementById("reportMessage"); message.innerHTML = '<div class="text-muted">Đang tổng hợp…</div>';
    try {
      const result = await getNeedSurveyReport(); const rows = result.data || [];
      const after = rows.filter(row => row.survey_stage === "AFTER_EVENT");
      const conferenceNeed = rows.filter(row => row.conference_need).length;
      const trainingCount = rows.filter(row => row.training_need.trim()).length;
      const cards = [["Tổng phiếu", rows.length, "bi-clipboard2-data"], ["Đơn vị có nhu cầu hội nghị", conferenceNeed, "bi-megaphone"], ["Có đề xuất tập huấn", trainingCount, "bi-journal-text"], ["Điểm chất lượng / phối hợp", `${ratingAverage(after, "quality_rating")} / ${ratingAverage(after, "coordination_rating")}`, "bi-star"]];
      document.getElementById("surveySummary").innerHTML = cards.map(([label, value, icon]) => `<div class="col-6 col-xl-3"><div class="card h-100 border-0 shadow-sm"><div class="card-body"><div class="text-muted small">${label}</div><div class="d-flex justify-content-between align-items-center"><strong class="fs-3">${value}</strong><i class="bi ${icon} fs-3 text-primary"></i></div></div></div></div>`).join("");
      const audiences = frequencies(rows, "target_audience", true);
      renderFrequency("areaDemand", [...frequencies(rows, "suggested_area").slice(0, 5).map(([name, count]) => [`Địa bàn: ${name}`, count]), ...audiences.slice(0, 5).map(([name, count]) => [`Đối tượng: ${name}`, count])], "Chưa có dữ liệu.");
      renderFrequency("topicDemand", [...frequencies(rows, "topics", true).map(([name, count]) => [`Chủ đề: ${name}`, count]), ...frequencies(rows, "training_need", true).map(([name, count]) => [`Tập huấn: ${name}`, count])], "Chưa có chủ đề hoặc nhu cầu tập huấn.");
      document.getElementById("surveyRows").innerHTML = rows.length ? rows.slice(0, 250).map(row => `<tr><td>${new Date(row.created_at).toLocaleDateString("vi-VN")}</td><td>${escapeHtml(row.organization_name)}</td><td>${row.survey_stage === "AFTER_EVENT" ? "Sau hội nghị" : "Nhu cầu"}</td><td><div>${escapeHtml(row.legal_aid_need || row.training_need || "")}</div><div class="small text-muted">${escapeHtml(row.questions || row.topics || "")}</div>${row.conference_title ? `<div class="small">${escapeHtml(row.conference_title)}</div>` : ""}${row.coordination_agencies ? `<div class="small text-primary mt-1">Phối hợp: ${escapeHtml(row.coordination_agencies)}</div>` : ""}${row.comments ? `<div class="small text-secondary mt-1">Ý kiến: ${escapeHtml(row.comments)}</div>` : ""}</td><td>${row.quality_rating || "—"}/5</td><td>${row.coordination_rating || "—"}/5</td></tr>`).join("") : '<tr><td colspan="6" class="text-muted text-center py-4">Chưa có phiếu khảo sát.</td></tr>';
      message.innerHTML = `<div class="small text-muted mb-2">Đang hiển thị ${Math.min(rows.length, 250)} / ${rows.length} phiếu mới nhất.</div>`;
    } catch (error) { message.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message || "Không tải được báo cáo.")}</div>`; }
  }
  document.getElementById("refreshSurveyReport").addEventListener("click", load);
  load();
})();
