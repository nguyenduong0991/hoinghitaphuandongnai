function normalizeQuestion(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN");
}

function isPendingConferenceRequestCountQuestion(question) {
    const normalized = normalizeQuestion(question);
    const asksCount = /\b(?:bao nhieu|so luong|dem)\b/.test(normalized);
    const mentionsPending = /(?:chua.{0,20}(?:phe )?duyet|cho.{0,15}phe duyet|cho duyet)/.test(normalized);
    const mentionsConferenceRequest = /(?:yeu cau|de nghi|ho so).{0,60}(?:hoi nghi|to chuc)|(?:hoi nghi|to chuc).{0,60}(?:yeu cau|de nghi|ho so|chua.{0,20}(?:phe )?duyet|cho.{0,15}phe duyet|cho duyet)/.test(normalized);
    return asksCount && mentionsPending && mentionsConferenceRequest;
}

function formatPendingConferenceRequestCount(count, periodLabel, scopeLabel) {
    return `Đã tiếp nhận ${Math.max(0, Number(count) || 0)} yêu cầu tổ chức hội nghị còn chờ phê duyệt trong ${periodLabel} (${scopeLabel}; tính theo ngày hồ sơ được tạo).`;
}

module.exports = { isPendingConferenceRequestCountQuestion, formatPendingConferenceRequestCount };