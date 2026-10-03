// Store attachments in IndexedDB for the static GitHub Pages build, or use
// the shared backend when TGPL_API_BASE_URL points to a deployed API.
const ATTACHMENT_DB_NAME = "tgpl-attachments";
const ATTACHMENT_STORE_NAME = "files";

function isSharedAttachmentStorage() {
    return Boolean(window.TGPL_API_BASE_URL);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function openAttachmentDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(ATTACHMENT_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) {
                const store = database.createObjectStore(ATTACHMENT_STORE_NAME, { keyPath: "id" });
                store.createIndex("conferenceId", "conferenceId", { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Không mở được kho tệp đính kèm."));
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
            { method: "POST", body: formData }
        );
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
            `${window.TGPL_API_BASE_URL}/conferences/${encodeURIComponent(conferenceId)}/attachments`
        );
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.message || `Không tải được danh sách tệp (${response.status}).`);
        return result.data || [];
    }

    return withAttachmentStore("readonly", store =>
        store.index("conferenceId").getAll(String(conferenceId))
    );
}

async function openConferenceAttachment(attachment) {
    if (isSharedAttachmentStorage()) {
        const backendRoot = window.TGPL_API_BASE_URL.replace(/\/api\/?$/, "");
        const key = attachment.storage_key || attachment.filename;
        if (!key) throw new Error("Máy chủ chưa trả về đường dẫn tệp.");
        window.open(`${backendRoot}/uploads/${encodeURIComponent(key)}`, "_blank", "noopener");
        return;
    }

    const blob = attachment.blob;
    if (!blob) throw new Error("Không tìm thấy nội dung tệp trong trình duyệt này.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.name;
    link.click();
    URL.revokeObjectURL(url);
}
