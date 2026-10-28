function formatAccountTaskCount(stats = {}, username, periodLabel) {
    const total = Number(stats.total) || 0;
    const period = periodLabel ? `trong ${periodLabel}` : "trong toàn bộ dữ liệu";
    if (!total) return `Tài khoản ${username} không có nhiệm vụ có hạn ${period} trong phạm vi dữ liệu được phép xem.`;
    return `Tài khoản ${username} có ${total} nhiệm vụ có hạn ${period} (đã giao ${Number(stats.assigned) || 0}, đang thực hiện ${Number(stats.in_progress) || 0}, hoàn thành ${Number(stats.completed) || 0}; không tính nhiệm vụ đã hủy).`;
}

function formatAccountTaskStatusCount(stats = {}, username, periodLabel, status = "completed") {
    const count = status === "completed"
        ? Number(stats.completed_in_period ?? stats.completed) || 0
        : Number(stats[status]) || 0;
    const missingCompletionTime = status === "completed" ? Number(stats.completed_without_timestamp) || 0 : 0;
    const period = periodLabel ? `trong ${periodLabel}` : "trong toàn bộ dữ liệu";
    const labels = { completed: "đã hoàn thành", in_progress: "đang thực hiện", uncompleted: "chưa hoàn thành" };
    const label = labels[status] || "có trạng thái yêu cầu";
    const basis = status === "completed" ? "theo thời điểm hoàn thành" : "theo hạn nhiệm vụ";
    if (status === "completed" && missingCompletionTime) {
        const recorded = count ? `Có ${count} nhiệm vụ được ghi nhận hoàn thành ${period}` : `Chưa xác định được số nhiệm vụ hoàn thành ${period}`;
        return `Tài khoản ${username}: ${recorded} theo thời điểm hoàn thành; ngoài ra có ${missingCompletionTime} nhiệm vụ đã ở trạng thái hoàn thành nhưng chưa lưu thời điểm hoàn thành nên không thể xác định có thuộc kỳ này hay không.`;
    }
    return count
        ? `Tài khoản ${username} có ${count} nhiệm vụ ${label} ${period} (${basis}).`
        : `Tài khoản ${username} không có nhiệm vụ ${label} ${period} (${basis}) được ghi nhận trong phạm vi dữ liệu được phép xem.`;
}

function formatAccountTaskRatings(stats = {}, username, periodLabel) {
    const average = stats.average_rating == null ? "chưa có đánh giá" : `${Number(stats.average_rating).toFixed(2)}/5`;
    const period = periodLabel ? `trong ${periodLabel}` : "trong toàn bộ thời gian";
    return `Đánh giá nhiệm vụ của tài khoản ${username} ${period}: điểm trung bình ${average} trên ${Number(stats.evaluated_count) || 0} nhiệm vụ có đánh giá; ${Number(stats.above_three) || 0} nhiệm vụ được chấm trên 3 điểm.`;
}

module.exports = { formatAccountTaskCount, formatAccountTaskStatusCount, formatAccountTaskRatings };


