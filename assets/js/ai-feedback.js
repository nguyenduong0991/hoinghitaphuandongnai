(() => {
  const list = document.getElementById("aiFeedbackList");
  const message = document.getElementById("aiFeedbackMessage");
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  async function load() {
    list.innerHTML = '<div class="card"><div class="card-body text-muted">Đang tải phản hồi…</div></div>';
    message.replaceChildren();
    try {
      const result = await getAiAnswerFeedback();
      const rows = (result.data || []).filter(item => item.vote === "INCORRECT" && item.status !== "RESOLVED");
      if (!rows.length) { list.innerHTML = '<div class="card"><div class="card-body text-muted">Không có câu trả lời nào đang chờ rà soát.</div></div>'; return; }
      list.replaceChildren();
      rows.forEach(item => {
        const card = document.createElement("article"); card.className = "card shadow-sm";
        const body = document.createElement("div"); body.className = "card-body";
        const heading = document.createElement("div"); heading.className = "d-flex flex-wrap justify-content-between gap-2 mb-3";
        const title = document.createElement("h2"); title.className = "h5 mb-0"; title.textContent = item.question;
        const reasons = { WRONG_DATA: "Sai dữ liệu", WRONG_SCOPE: "Sai phạm vi", IRRELEVANT: "Lạc đề", INCOMPLETE: "Thiếu ý", TOO_LONG: "Quá dài", MISSING_SOURCE: "Thiếu căn cứ", OTHER: "Lý do khác", UNSPECIFIED: "Chưa nêu lý do" };
        const meta = document.createElement("span"); meta.className = "small text-muted"; meta.textContent = `${item.username || "Tài khoản"} · ${item.user_role || ""} · ${reasons[item.reason_code] || "Chưa nêu lý do"} · ${new Date(item.created_at).toLocaleString("vi-VN")}`;
        heading.append(title, meta);
        const oldAnswer = document.createElement("div"); oldAnswer.className = "rounded bg-light p-3 mb-3";
        const oldLabel = document.createElement("div"); oldLabel.className = "small fw-semibold text-danger mb-1"; oldLabel.textContent = "Câu trả lời bị đánh dấu sai";
        const oldText = document.createElement("div"); oldText.style.whiteSpace = "pre-wrap"; oldText.textContent = item.answer;
        oldAnswer.append(oldLabel, oldText);
        const form = document.createElement("div"); form.className = "row g-3";
        const correctionField = document.createElement("div"); correctionField.className = "col-12";
        const correctionLabel = document.createElement("label"); correctionLabel.className = "form-label fw-semibold"; correctionLabel.textContent = "Nội dung đính chính";
        const correction = document.createElement("textarea"); correction.className = "form-control"; correction.rows = 4; correction.value = item.correction_text || ""; correction.placeholder = "Nhập câu trả lời đúng, rõ ràng và có mốc hiệu lực nếu cần";
        correctionField.append(correctionLabel, correction);
        const sourceField = document.createElement("div"); sourceField.className = "col-md-5";
        const sourceLabel = document.createElement("label"); sourceLabel.className = "form-label fw-semibold"; sourceLabel.textContent = "Tên nguồn chính thức (chỉ bắt buộc với câu hỏi pháp luật)";
        const citedSource = (item.sources || []).find(source => source.source_url && source.source_title);
        const sourceTitle = document.createElement("input"); sourceTitle.className = "form-control"; sourceTitle.value = item.correction_source_title || citedSource?.source_title || ""; sourceTitle.placeholder = "Tên văn bản / trang cơ quan";
        sourceField.append(sourceLabel, sourceTitle);
        const urlField = document.createElement("div"); urlField.className = "col-md-7";
        const urlLabel = document.createElement("label"); urlLabel.className = "form-label fw-semibold"; urlLabel.textContent = "Liên kết nguồn HTTPS (chỉ bắt buộc với câu hỏi pháp luật)";
        const sourceUrl = document.createElement("input"); sourceUrl.className = "form-control"; sourceUrl.type = "url"; sourceUrl.value = item.correction_source_url || citedSource?.source_url || ""; sourceUrl.placeholder = "https://...gov.vn/...";
        urlField.append(urlLabel, sourceUrl);
        form.append(correctionField, sourceField, urlField);
        const footer = document.createElement("div"); footer.className = "d-flex flex-wrap align-items-center gap-2 mt-3";
        const save = document.createElement("button"); save.type = "button"; save.className = "btn btn-primary"; save.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Lưu đính chính vào RAG';
        const reviewed = document.createElement("button"); reviewed.type = "button"; reviewed.className = "btn btn-outline-secondary"; reviewed.textContent = "Đánh dấu đã xem";
        const status = document.createElement("span"); status.className = "small text-muted";
        save.addEventListener("click", async () => {
          if (!correction.value.trim()) { status.textContent = "Hãy nhập nội dung đính chính."; correction.focus(); return; }
          save.disabled = true; status.textContent = "Đang lưu…";
          try { await updateAiAnswerFeedback(item.id, { status: "RESOLVED", correction_text: correction.value, correction_source_title: sourceTitle.value, correction_source_url: sourceUrl.value }); status.textContent = "Đã lưu. RAG sẽ dùng đính chính này ở lượt hỏi tiếp theo."; card.classList.add("border-success"); window.setTimeout(load, 1000); }
          catch (error) { status.textContent = error.message || "Không lưu được đính chính."; save.disabled = false; }
        });
        reviewed.addEventListener("click", async () => {
          reviewed.disabled = true;
          try { await updateAiAnswerFeedback(item.id, { status: "REVIEWED" }); await load(); }
          catch (error) { status.textContent = error.message || "Không cập nhật được."; reviewed.disabled = false; }
        });
        footer.append(save, reviewed, status);
        body.append(heading, oldAnswer, form, footer); card.appendChild(body); list.appendChild(card);
      });
    } catch (error) { list.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message || "Không tải được phản hồi. Vui lòng đăng nhập tài khoản admin.")}</div>`; }
  }
  document.getElementById("refreshAiFeedback").addEventListener("click", load);
  load();
})();
