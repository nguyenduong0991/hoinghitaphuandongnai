(() => {
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const text = value => String(value ?? "").trim();
  const ratingAverage = (items, key) => { const values = items.map(row => Number(row[key])).filter(value => value >= 1 && value <= 5); return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "—"; };
  let reportRows = null;
  let summaryCards = [];

  function frequencies(rows, key, split = false) {
    const counts = new Map();
    rows.forEach(row => String(row[key] || "").split(split ? /[\n,;；]+/ : /\u0000/).map(value => value.trim()).filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"));
  }
  function renderFrequency(targetId, pairs, empty) {
    document.getElementById(targetId).innerHTML = pairs.length ? pairs.map(([label, count]) => `<tr><td>${escapeHtml(label)}</td><td><span class="badge text-bg-primary">${count}</span></td></tr>`).join("") : `<tr><td colspan="2" class="text-muted">${empty}</td></tr>`;
  }
  function reportData() {
    const rows = reportRows || [];
    const after = rows.filter(row => row.survey_stage === "AFTER_EVENT");
    return {
      rows,
      cards: summaryCards,
      areaAudience: [...frequencies(rows, "suggested_area", true).map(([label, count]) => [`Địa bàn: ${label}`, count]), ...frequencies(rows, "target_audience", true).map(([label, count]) => [`Đối tượng: ${label}`, count])],
      topicsTraining: [...frequencies(rows, "topics", true).map(([label, count]) => [`Chủ đề: ${label}`, count]), ...frequencies(rows, "training_need", true).map(([label, count]) => [`Tập huấn: ${label}`, count])],
      afterCount: after.length
    };
  }
  function safeFileText(value) {
    const result = text(value);
    return /^[=+@\-]/.test(result) ? `'${result}` : result;
  }
  function dateLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString("vi-VN");
  }
  function detailRows(rows) {
    return rows.map(row => [
      dateLabel(row.created_at), safeFileText(row.organization_name), row.survey_stage === "AFTER_EVENT" ? "Sau hội nghị" : "Nhu cầu trước hội nghị",
      safeFileText(row.legal_aid_need), row.conference_need ? "Có" : "Không", safeFileText(row.training_need), safeFileText(row.suggested_area),
      safeFileText(row.topics), safeFileText(row.target_audience), safeFileText(row.questions), safeFileText(row.coordination_agencies),
      safeFileText(row.comments), row.quality_rating ?? "", row.coordination_rating ?? "", safeFileText(row.conference_title)
    ]);
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadExcel() {
    if (!reportRows || !window.XLSX) throw new Error("Chưa tải được công cụ xuất Excel. Hãy tải lại trang và thử lại.");
    const report = reportData();
    const workbook = XLSX.utils.book_new();
    const addSheet = (name, data, widths) => { const sheet = XLSX.utils.aoa_to_sheet(data); sheet["!cols"] = widths.map(wch => ({ wch })); XLSX.utils.book_append_sheet(workbook, sheet, name); };
    addSheet("Tong hop", [["Chỉ tiêu", "Giá trị"], ...report.cards.map(([label, value]) => [label, value]), ["Số phiếu sau hội nghị", report.afterCount], ["Ngày xuất báo cáo", new Date().toLocaleString("vi-VN")]], [34, 32]);
    addSheet("Dia ban doi tuong", [["Địa bàn / nhóm đối tượng", "Số lượt"], ...report.areaAudience.map(([label, count]) => [safeFileText(label), count])], [48, 14]);
    addSheet("Chu de tap huan", [["Chủ đề / nhu cầu tập huấn", "Số lượt"], ...report.topicsTraining.map(([label, count]) => [safeFileText(label), count])], [60, 14]);
    addSheet("Chi tiet phieu", [["Ngày gửi", "Đơn vị", "Giai đoạn", "Nhu cầu TGPL", "Nhu cầu hội nghị", "Nhu cầu tập huấn", "Địa bàn đề xuất", "Chủ đề / nội dung", "Đối tượng tham gia", "Câu hỏi / vướng mắc", "Đơn vị phối hợp", "Ý kiến", "Điểm chất lượng", "Điểm phối hợp", "Hội nghị"], ...detailRows(report.rows)], [22, 30, 24, 36, 18, 36, 28, 36, 32, 44, 36, 44, 18, 18, 36]);
    XLSX.writeFile(workbook, `Bao-cao-khao-sat-TGPL-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  async function downloadWord() {
    if (!reportRows || !window.docx) throw new Error("Chưa tải được công cụ xuất Word. Hãy tải lại trang và thử lại.");
    const { Document, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, PageOrientation, Packer } = window.docx;
    const report = reportData();
    const paragraph = (value, options = {}) => new Paragraph({ children: [new TextRun(String(value ?? ""))], ...options });
    const makeTable = (headers, rows) => {
      const content = rows.length ? rows : [["Chưa có dữ liệu.", ...Array(Math.max(headers.length - 1, 0)).fill("")]];
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headers, ...content].map((row, index) => new TableRow({ children: row.map(value => new TableCell({ children: [paragraph(value)], shading: index === 0 ? { fill: "DCEEFF" } : undefined })) })) });
    };
    const children = [
      new Paragraph({ text: "BÁO CÁO TỔNG HỢP PHIẾU KHẢO SÁT", heading: HeadingLevel.TITLE }),
      paragraph(`Ngày xuất: ${new Date().toLocaleString("vi-VN")}`),
      paragraph(`Tổng số phiếu: ${report.rows.length}. Trong đó ${report.afterCount} phiếu đánh giá sau hội nghị.`),
      new Paragraph({ text: "1. Chỉ số tổng hợp", heading: HeadingLevel.HEADING_1 }), makeTable(["Chỉ tiêu", "Giá trị"], report.cards.map(([label, value]) => [label, String(value)])),
      new Paragraph({ text: "2. Địa bàn và nhóm đối tượng", heading: HeadingLevel.HEADING_1 }), makeTable(["Địa bàn / nhóm đối tượng", "Số lượt"], report.areaAudience.map(([label, count]) => [label, String(count)])),
      new Paragraph({ text: "3. Chủ đề và nhu cầu tập huấn", heading: HeadingLevel.HEADING_1 }), makeTable(["Chủ đề / nhu cầu tập huấn", "Số lượt"], report.topicsTraining.map(([label, count]) => [label, String(count)])),
      new Paragraph({ text: "4. Chi tiết phiếu khảo sát", heading: HeadingLevel.HEADING_1 }),
      makeTable(["Ngày gửi", "Đơn vị", "Giai đoạn", "Nhu cầu / câu hỏi", "Địa bàn", "Chủ đề", "Đối tượng", "Điểm chất lượng", "Điểm phối hợp"], report.rows.map(row => [dateLabel(row.created_at), text(row.organization_name), row.survey_stage === "AFTER_EVENT" ? "Sau hội nghị" : "Nhu cầu trước hội nghị", [row.legal_aid_need, row.training_need, row.questions, row.comments].map(text).filter(Boolean).join("; "), text(row.suggested_area), text(row.topics), text(row.target_audience), row.quality_rating ?? "—", row.coordination_rating ?? "—"]))
    ];
    const document = new Document({ sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 700, right: 700, bottom: 700, left: 700 } } }, children }] });
    downloadBlob(await Packer.toBlob(document), `Bao-cao-khao-sat-TGPL-${new Date().toISOString().slice(0, 10)}.docx`);
  }
  async function load() {
    const message = document.getElementById("reportMessage"); message.innerHTML = '<div class="text-muted">Đang tổng hợp…</div>';
    document.getElementById("downloadSurveyWord").disabled = true;
    document.getElementById("downloadSurveyExcel").disabled = true;
    try {
      const result = await getNeedSurveyReport(); const rows = Array.isArray(result.data) ? result.data : [];
      reportRows = rows;
      const after = rows.filter(row => row.survey_stage === "AFTER_EVENT");
      const conferenceNeed = rows.filter(row => row.conference_need).length;
      const trainingCount = rows.filter(row => text(row.training_need)).length;
      summaryCards = [["Tổng phiếu", rows.length], ["Đơn vị có nhu cầu hội nghị", conferenceNeed], ["Có đề xuất tập huấn", trainingCount], ["Điểm chất lượng / phối hợp", `${ratingAverage(after, "quality_rating")} / ${ratingAverage(after, "coordination_rating")}`]];
      document.getElementById("surveySummary").innerHTML = summaryCards.map(([label, value, icon], index) => `<div class="col-6 col-xl-3"><div class="card h-100 border-0 shadow-sm"><div class="card-body"><div class="text-muted small">${escapeHtml(label)}</div><div class="d-flex justify-content-between align-items-center"><strong class="fs-3">${escapeHtml(value)}</strong><i class="bi ${["bi-clipboard2-data", "bi-megaphone", "bi-journal-text", "bi-star"][index]} fs-3 text-primary"></i></div></div></div></div>`).join("");
      const report = reportData();
      renderFrequency("areaDemand", [...frequencies(rows, "suggested_area", true).slice(0, 5).map(([name, count]) => [`Địa bàn: ${name}`, count]), ...frequencies(rows, "target_audience", true).slice(0, 5).map(([name, count]) => [`Đối tượng: ${name}`, count])], "Chưa có dữ liệu.");
      renderFrequency("topicDemand", [...frequencies(rows, "topics", true).slice(0, 10).map(([name, count]) => [`Chủ đề: ${name}`, count]), ...frequencies(rows, "training_need", true).slice(0, 10).map(([name, count]) => [`Tập huấn: ${name}`, count])], "Chưa có chủ đề hoặc nhu cầu tập huấn.");
      document.getElementById("surveyRows").innerHTML = rows.length ? rows.slice(0, 250).map(row => `<tr><td>${escapeHtml(new Date(row.created_at).toLocaleDateString("vi-VN"))}</td><td>${escapeHtml(row.organization_name)}</td><td>${row.survey_stage === "AFTER_EVENT" ? "Sau hội nghị" : "Nhu cầu"}</td><td><div>${escapeHtml(row.legal_aid_need || row.training_need || "")}</div><div class="small text-muted">${escapeHtml(row.questions || row.topics || "")}</div>${row.conference_title ? `<div class="small">${escapeHtml(row.conference_title)}</div>` : ""}${row.coordination_agencies ? `<div class="small text-primary mt-1">Phối hợp: ${escapeHtml(row.coordination_agencies)}</div>` : ""}${row.comments ? `<div class="small text-secondary mt-1">Ý kiến: ${escapeHtml(row.comments)}</div>` : ""}</td><td>${escapeHtml(row.quality_rating || "—")}/5</td><td>${escapeHtml(row.coordination_rating || "—")}/5</td></tr>`).join("") : '<tr><td colspan="6" class="text-muted text-center py-4">Chưa có phiếu khảo sát.</td></tr>';
      document.getElementById("downloadSurveyWord").disabled = false;
      document.getElementById("downloadSurveyExcel").disabled = false;
      message.innerHTML = `<div class="small text-muted mb-2">Đang hiển thị ${Math.min(rows.length, 250)} / ${rows.length} phiếu mới nhất. Báo cáo tải xuống gồm toàn bộ ${rows.length} phiếu trong phạm vi tài khoản.</div>`;
    } catch (error) { reportRows = null; message.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message || "Không tải được báo cáo.")}</div>`; }
  }
  document.getElementById("refreshSurveyReport").addEventListener("click", load);
  document.getElementById("downloadSurveyExcel").addEventListener("click", () => { try { downloadExcel(); } catch (error) { document.getElementById("reportMessage").innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`; } });
  document.getElementById("downloadSurveyWord").addEventListener("click", async event => { const button = event.currentTarget; button.disabled = true; try { await downloadWord(); } catch (error) { document.getElementById("reportMessage").innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message || "Không tạo được báo cáo Word.")}</div>`; } finally { button.disabled = !reportRows; } });
  load();
})();
