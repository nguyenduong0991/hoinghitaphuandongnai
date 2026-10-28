function normalizeQuestion(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN");
}

function isPendingConferenceOverlapCountQuestion(question) {
    const normalized = normalizeQuestion(question);
    const asksCount = /\b(?:bao nhieu|so luong|dem)\b/.test(normalized);
    const mentionsPending = /(?:cho.{0,15}phe duyet|chua.{0,20}(?:duoc )?phe duyet|cho duyet)/.test(normalized);
    const mentionsOverlap = /(?:trung.{0,18}(?:thoi gian|lich)|chong lap.{0,18}(?:thoi gian|lich)|trung moc thoi gian)/.test(normalized);
    const mentionsConference = /(?:hoi nghi|danh sach)/.test(normalized);
    return asksCount && mentionsPending && mentionsOverlap && mentionsConference;
}

module.exports = { isPendingConferenceOverlapCountQuestion };