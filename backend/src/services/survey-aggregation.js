function formatRankedSurveyTopics(rows, { periodLabel, total = 0 } = {}) {
    if (!rows?.length) return "Các phiếu khảo sát trong phạm vi dữ liệu được phép chưa ghi nhận chủ đề hoặc nội dung quan tâm.";
    const ranked = new Map();
    for (const row of rows) {
        const position = Number(row.position) || 1;
        if (!ranked.has(position)) ranked.set(position, []);
        ranked.get(position).push(`“${String(row.label || "").trim()}” (${Number(row.responses) || 0} phiếu)`);
    }
    const ranking = [...ranked.entries()].map(([position, labels]) => `Hạng ${position}: ${labels.join("; ")}`).join(". ");
    const topRankTied = (ranked.get(1) || []).length > 1;
    const allTiedAtTop = ranked.size === 1 && topRankTied;
    const leadIn = allTiedAtTop
        ? "Các chủ đề đồng hạng cao nhất"
        : topRankTied
            ? "Xếp hạng chủ đề/nội dung được quan tâm (hạng 1 đồng hạng)"
            : "Xếp hạng chủ đề/nội dung được quan tâm";
    const period = periodLabel || "toàn bộ thời gian";
    const sampleNote = total > 0 && total < 5
        ? ` Chỉ có ${total} phiếu trong phạm vi kỳ này; đây là tín hiệu mô tả, chưa đại diện cho toàn bộ nhu cầu.`
        : "";
    return `${leadIn} trong ${period}: ${ranking}.${sampleNote}`;
}

function formatSurveyRatings(stats = {}, periodLabel) {
    const quality = stats.quality_average == null
        ? "chưa có đánh giá"
        : `${stats.quality_average}/5 (${Number(stats.quality_count) || 0} phiếu)`;
    const coordination = stats.coordination_average == null
        ? "chưa có đánh giá"
        : `${stats.coordination_average}/5 (${Number(stats.coordination_count) || 0} phiếu)`;
    const ratingCount = Math.max(Number(stats.quality_count) || 0, Number(stats.coordination_count) || 0);
    const sampleNote = ratingCount > 0 && ratingCount < 5
        ? ` Cỡ mẫu nhỏ (${ratingCount} lượt đánh giá), nên xem đây là phản hồi mô tả.`
        : "";
    return `Kết quả đánh giá khảo sát${periodLabel ? ` trong ${periodLabel}` : ""}: chất lượng tổ chức ${quality}; phối hợp giữa cơ quan ${coordination}.${sampleNote}`;
}

module.exports = { formatRankedSurveyTopics, formatSurveyRatings };
