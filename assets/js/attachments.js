// Store attachments in IndexedDB for the static GitHub Pages build, or use
// the shared backend when TGPL_API_BASE_URL points to a deployed API.
const ATTACHMENT_DB_NAME = "tgpl-attachments";
const ATTACHMENT_STORE_NAME = "files";

function isSharedAttachmentStorage() {
    return Boolean(window.TGPL_API_BASE_URL);
}

function attachmentAuthHeaders() {
    const token = localStorage.getItem("tgpl.accessToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function requireAttachmentSession(response) {
    if (response.status !== 401) return;
    localStorage.removeItem("tgpl.accessToken");
    localStorage.removeItem("tgpl.user");
    const target = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`login.html?return=${encodeURIComponent(target)}`);
    throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục.");
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function openAttachmentDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(ATTACHMENT_DB_NAME, 2);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) {
                const store = database.createObjectStore(ATTACHMENT_STORE_NAME, { keyPath: "id" });
                store.createIndex("conferenceId", "conferenceId", { unique: false });
            }
            if (!database.transaction.objectStore(ATTACHMENT_STORE_NAME).indexNames.contains("taskAssignmentId")) {
                database.transaction.objectStore(ATTACHMENT_STORE_NAME).createIndex("taskAssignmentId", "taskAssignmentId", { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Không mở được kho tệp đính kèm."));
    });
}

async function uploadTaskAttachment(taskId, file) {
    if (!taskId || !file) throw new Error("Chọn nhiệm vụ và tệp cần đính kèm.");
    if (isSharedAttachmentStorage()) {
        const formData = new FormData(); formData.append("file", file);
        const response = await fetch(`${window.TGPL_API_BASE_URL}/my-assignments/tasks/${encodeURIComponent(taskId)}/attachments`, {
            method: "POST", headers: attachmentAuthHeaders(), body: formData
        });
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không tải được tệp (${response.status}).`);
        return result.data;
    }
    const attachment = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        taskAssignmentId: String(taskId), name: file.name, type: file.type || "application/octet-stream", size: file.size, blob: file, createdAt: new Date().toISOString() };
    await withAttachmentStore("readwrite", store => store.add(attachment));
    return attachment;
}

async function replaceTaskAttachment(taskId, attachmentId, file) {
    if (isSharedAttachmentStorage()) {
        const formData = new FormData(); formData.append("file", file);
        const response = await fetch(`${window.TGPL_API_BASE_URL}/task-attachments/${encodeURIComponent(attachmentId)}/file`, {
            method: "PUT", headers: attachmentAuthHeaders(), body: formData
        });
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không thay thế được tệp (${response.status}).`);
        return result.data;
    }
    return replaceLocalAttachment(attachmentId, file);
}

async function deleteTaskAttachment(attachmentId) {
    if (isSharedAttachmentStorage()) {
        const response = await fetch(`${window.TGPL_API_BASE_URL}/task-attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE", headers: attachmentAuthHeaders() });
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không xóa được tệp (${response.status}).`);
        return result;
    }
    return deleteLocalAttachment(attachmentId);
}

async function replaceConferenceAttachment(conferenceId, attachmentId, file) {
    if (isSharedAttachmentStorage()) {
        const formData = new FormData(); formData.append("file", file);
        const response = await fetch(`${window.TGPL_API_BASE_URL}/conference-attachments/${encodeURIComponent(attachmentId)}/file`, {
            method: "PUT", headers: attachmentAuthHeaders(), body: formData
        });
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không thay thế được tệp (${response.status}).`);
        return result.data;
    }
    return replaceLocalAttachment(attachmentId, file);
}

async function deleteConferenceAttachment(attachmentId) {
    if (isSharedAttachmentStorage()) {
        const response = await fetch(`${window.TGPL_API_BASE_URL}/conference-attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE", headers: attachmentAuthHeaders() });
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không xóa được tệp (${response.status}).`);
        return result;
    }
    return deleteLocalAttachment(attachmentId);
}

async function replaceLocalAttachment(attachmentId, file) {
    const database = await openAttachmentDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(ATTACHMENT_STORE_NAME, "readwrite");
        const store = transaction.objectStore(ATTACHMENT_STORE_NAME);
        const getRequest = store.get(String(attachmentId));
        getRequest.onsuccess = () => {
            if (!getRequest.result) { reject(new Error("Không tìm thấy tệp đính kèm trong trình duyệt.")); return; }
            const updated = { ...getRequest.result, name: file.name, type: file.type || "application/octet-stream", size: file.size, blob: file, createdAt: new Date().toISOString() };
            const putRequest = store.put(updated);
            putRequest.onsuccess = () => resolve(updated);
            putRequest.onerror = () => reject(putRequest.error || new Error("Không thay thế được tệp."));
        };
        getRequest.onerror = () => reject(getRequest.error || new Error("Không đọc được tệp đính kèm."));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Không lưu được tệp thay thế.")); };
    });
}

async function deleteLocalAttachment(attachmentId) {
    return withAttachmentStore("readwrite", store => store.delete(String(attachmentId)));
}

async function getTaskAttachments(taskId) {
    if (isSharedAttachmentStorage()) {
        const response = await fetch(`${window.TGPL_API_BASE_URL}/my-assignments/tasks/${encodeURIComponent(taskId)}/attachments`, { headers: attachmentAuthHeaders() });
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không tải được danh sách tệp (${response.status}).`);
        return (result.data || []).map(item => ({ ...item, name: item.name || item.file_name, size: item.size || item.file_size, type: item.type || item.mime_type }));
    }
    const database = await openAttachmentDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(ATTACHMENT_STORE_NAME, "readonly");
        const request = transaction.objectStore(ATTACHMENT_STORE_NAME).index("taskAssignmentId").getAll(String(taskId));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Không đọc được tệp của nhiệm vụ."));
        transaction.oncomplete = () => database.close();
    });
}

async function withAttachmentStore(mode, action) {
    const database = await openAttachmentDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(ATTACHMENT_STORE_NAME, mode);
        const request = action(transaction.objectStore(ATTACHMENT_STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Không xử lý được tệp đính kèm."));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
            database.close();
            reject(transaction.error || new Error("Không lưu được tệp đính kèm."));
        };
    });
}

async function uploadConferenceAttachment(conferenceId, file) {
    if (!conferenceId) throw new Error("Hồ sơ hội nghị chưa có mã để gắn tệp.");

    if (isSharedAttachmentStorage()) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(
            `${window.TGPL_API_BASE_URL}/conferences/${encodeURIComponent(conferenceId)}/attachments`,
            { method: "POST", headers: attachmentAuthHeaders(), body: formData }
        );
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không tải được tệp (${response.status}).`);
        return result.data;
    }

    const attachment = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        conferenceId: String(conferenceId),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        blob: file,
        createdAt: new Date().toISOString()
    };
    await withAttachmentStore("readwrite", store => store.add(attachment));
    return attachment;
}

async function getConferenceAttachments(conferenceId) {
    if (isSharedAttachmentStorage()) {
        const response = await fetch(
            `${window.TGPL_API_BASE_URL}/conferences/${encodeURIComponent(conferenceId)}/attachments`,
            { headers: attachmentAuthHeaders() }
        );
        requireAttachmentSession(response);
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không tải được danh sách tệp (${response.status}).`);
        return (result.data || []).map(attachment => ({
            ...attachment,
            conference_id: String(conferenceId),
            name: attachment.name || attachment.file_name,
            size: attachment.size || attachment.file_size,
            type: attachment.type || attachment.mime_type
        }));
    }

    return withAttachmentStore("readonly", store =>
        store.index("conferenceId").getAll(String(conferenceId))
    );
}

async function openConferenceAttachment(attachment) {
    if (isSharedAttachmentStorage()) {
        const storageKey = attachment.storage_key || attachment.filename;
        if (!storageKey) throw new Error("Máy chủ chưa trả về đường dẫn tệp.");
        const backendRoot = window.TGPL_API_BASE_URL.replace(/\/api\/?$/, "");
        const response = await fetch(`${backendRoot}/uploads/${encodeURIComponent(storageKey)}`, {
            headers: attachmentAuthHeaders()
        });
        requireAttachmentSession(response);
        if (!response.ok) {
            const result = await response.json().catch(() => null);
            throw new Error(result?.message || `Máy chủ không trả được tệp (HTTP ${response.status}). Hãy tải lại trang và thử lại.`);
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.name || attachment.file_name || "tai-lieu";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        return;
    }

    const blob = attachment.blob;
    if (!blob) throw new Error("Không tìm thấy nội dung tệp trong trình duyệt này.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.name;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
