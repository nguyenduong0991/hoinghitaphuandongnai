function classifyTaskQuestion(normalized) {
    const asksProgress = /\b(?:tien do|tong hop|thong ke)\b/.test(normalized) || (/\bbao cao\b/.test(normalized) && !/\bbao cao vien\b/.test(normalized));
    // “tới hôm nay” is normalized like “tôi hôm nay”; rely on explicit range
    // markers that do not collide with the first-person pronoun “của tôi”.
    const asksToday = /hom nay|ngay hom nay/.test(normalized) && !/(?:den|tu)\s+(?:ngay\s+)?hom nay/.test(normalized);
    const asksInProgress = /dang thuc hien|dang tien hanh|dang xu ly/.test(normalized) && !/(?:tong hop|bao cao|thong ke|tien do)/.test(normalized);
    const asksUncompleted = !asksInProgress && /chua hoan thanh|chua xong|chua lam xong|con mo|dang mo|chua thuc hien/.test(normalized);
    // “Chưa hoàn thành” contains “hoàn thành”, so negative intent must win.
    // A status breakdown is a summary, not a completed-only query.
    const asksCompleted = !asksUncompleted && !asksProgress && /(?:da )?hoan thanh|hoan tat/.test(normalized);
    const asksOverdue = /qua han|tre han|cham han/.test(normalized) && /chua hoan thanh|chua xong|chua lam xong|dang xu ly|con mo/.test(normalized);
    return { asksToday, asksInProgress, asksUncompleted, asksCompleted, asksOverdue, asksProgress };
}

module.exports = { classifyTaskQuestion };
