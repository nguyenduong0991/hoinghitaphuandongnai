(() => {
  const list = document.getElementById("attendanceList");
  if (!list) return;
  const message = document.getElementById("attendanceMessage");
  const search = document.getElementById("attendanceSearch");
  const organization = document.getElementById("attendanceOrganization");
  let conferences = [];

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
  const dateText = value => value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "long", timeStyle: "short" }) : "Chưa cập nhật";

  function showMessage(text, type = "success") {
    message.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="status">${escapeHtml(text)}<button type="button" class="btn-close" data-dismiss-message aria-label="Đóng"></button></div>`;
    message.querySelector("[data-dismiss-message]")?.addEventListener("click", () => { message.innerHTML = ""; });
  }

  function render() {
    const term = String(search.value || "").trim().toLocaleLowerCase("vi");
    const filtered = conferences.filter(item => [item.title, item.description, item.location_name, item.location_address, item.organization_name]
      .some(value => String(value || "").toLocaleLowerCase("vi").includes(term)));
    if (!filtered.length) {
      list.innerHTML = `<div class="col-12"><div class="card"><div class="card-body text-center py-5"><i class="bi bi-calendar2-event fs-2 text-muted"></i><p class="mb-0 mt-2 text-muted">${term ? "Không tìm thấy hội nghị phù hợp." : "Hiện chưa có hội nghị sắp diễn ra đã được phê duyệt."}</p></div></div></div>`;
      return;
    }
    list.innerHTML = filtered.map(item => {
      const registered = Boolean(item.registration_id);
      return `<div class="col-12"><article class="card shadow-sm h-100">
        <div class="card-body p-4">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
            <div><span class="badge text-bg-light border mb-2">${escapeHtml(item.code || "Hội nghị")}</span><h2 class="h5 mb-1">${escapeHtml(item.title)}</h2><p class="text-muted mb-3">Đơn vị tổ chức: <strong>${escapeHtml(item.organization_name || "Chưa cập nhật")}</strong></p></div>
            <span class="badge ${registered ? "text-bg-success" : "text-bg-primary"}">${registered ? "Đơn vị đã đăng ký" : "Đang nhận đăng ký"}</span>
          </div>
          <div class="row g-2 small mb-3">
            <div class="col-md-4"><i class="bi bi-clock me-1 text-primary"></i>${escapeHtml(dateText(item.start_time))}${item.end_time ? ` – ${escapeHtml(dateText(item.end_time))}` : ""}</div>
            <div class="col-md-5"><i class="bi bi-geo-alt me-1 text-primary"></i>${escapeHtml([item.location_name, item.location_address].filter(Boolean).join(" · ") || "Chưa cập nhật địa điểm")}</div>
            <div class="col-md-3"><i class="bi bi-people me-1 text-primary"></i>Dự kiến ${Number(item.expected_participants || 0).toLocaleString("vi-VN")} người · ${Number(item.registration_count || 0).toLocaleString("vi-VN")} đơn vị đăng ký</div>
          </div>
          ${item.description ? `<p class="mb-3">${escapeHtml(item.description)}</p>` : ""}
          ${registered
            ? `<div class="alert alert-success mb-0 py-2"><i class="bi bi-check-circle me-1"></i>Đã đăng ký ${Number(item.registered_count || 0).toLocaleString("vi-VN")} người${item.registered_at ? ` · ${escapeHtml(dateText(item.registered_at))}` : ""}${item.registration_note ? `<div class="small mt-1">Ghi chú: ${escapeHtml(item.registration_note)}</div>` : ""}</div>`
            : `<form class="attendance-register-form border-top pt-3" data-conference-id="${escapeHtml(item.id)}"><div class="row g-2 align-items-end"><div class="col-sm-4 col-md-3"><label class="form-label" for="attendees-${escapeHtml(item.id)}">Số người dự kiến</label><input class="form-control" id="attendees-${escapeHtml(item.id)}" name="expected_count" type="number" min="1" max="100000" value="1" required></div><div class="col-sm-8 col-md-6"><label class="form-label" for="note-${escapeHtml(item.id)}">Ghi chú (không bắt buộc)</label><input class="form-control" id="note-${escapeHtml(item.id)}" name="note" maxlength="1000" placeholder="Ví dụ: nhu cầu hỗ trợ đi lại"></div><div class="col-md-3"><button class="btn btn-primary w-100" type="submit"><i class="bi bi-person-check me-1"></i>Đăng ký tham gia</button></div></div></form>`}
        </div></article></div>`;
    }).join("");

    list.querySelectorAll(".attendance-register-form").forEach(form => form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      const expectedCount = Number(form.elements.expected_count.value);
      if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 100000) {
        showMessage("Số người tham dự phải từ 1 đến 100.000.", "warning");
        return;
      }
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Đang gửi…';
      try {
        const result = await registerForConference({
          conference_id: form.dataset.conferenceId,
          expected_count: expectedCount,
          note: form.elements.note.value.trim()
        });
        showMessage(result.message || "Đã đăng ký tham gia hội nghị.");
        await loadConferences();
      } catch (error) {
        showMessage(error.message || "Chưa đăng ký được. Vui lòng thử lại.", "danger");
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-person-check me-1"></i>Đăng ký tham gia';
      }
    }));
  }

  async function loadConferences() {
    list.innerHTML = '<div class="col-12"><div class="card"><div class="card-body text-muted">Đang tải hội nghị…</div></div></div>';
    try {
      const result = await getParticipationConferences();
      conferences = result.data || [];
      render();
    } catch (error) {
      list.innerHTML = `<div class="col-12"><div class="alert alert-danger">${escapeHtml(error.message || "Không tải được danh sách hội nghị.")}</div></div>`;
    }
  }

  search.addEventListener("input", render);
  document.getElementById("attendanceRefresh").addEventListener("click", loadConferences);
  document.addEventListener("DOMContentLoaded", () => {
    const user = window.tgplCurrentUser || JSON.parse(localStorage.getItem("tgpl.user") || "null");
    if (organization && user?.organization_name) organization.textContent = user.organization_name;
    loadConferences();
  });
})();
