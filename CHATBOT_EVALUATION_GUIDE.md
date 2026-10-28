# Bộ đánh giá chất lượng chatbot TGPL

Tài liệu này bổ sung tiêu chí chấm cho bộ 100 câu hỏi (85 câu chức năng và 15 câu diễn đạt tự nhiên) trong `BO_CAU_HOI_KIEM_THU_CHATBOT.md`. Dùng dữ liệu kiểm thử giả lập hoặc bản sao đã ẩn danh; không đưa thông tin thật của người dân vào bộ kiểm thử.

## Thang điểm mỗi câu (10 điểm)

| Tiêu chí | Điểm | Đạt khi |
|---|---:|---|
| Nhận diện ý định và nguồn | 2 | Chọn đúng hội nghị, khảo sát, nhiệm vụ, Luật TGPL, yêu cầu tư vấn, lập kế hoạch hoặc hỏi lại. |
| Phạm vi tài khoản và bộ lọc | 2 | Chỉ trả dữ liệu tài khoản được phép xem; đúng đơn vị, mã, trạng thái, ngày và kỳ. |
| Tính đúng của dữ liệu/căn cứ | 3 | Số liệu khớp dữ liệu truy vấn; luật khớp đúng điều/khoản trong nguồn đã duyệt; không suy đoán. |
| Đủ ý nhưng gọn | 2 | Trả đúng trường được hỏi, không thêm danh sách hoặc điều luật không liên quan, không bị cắt giữa câu. |
| Thời gian phản hồi | 1 | Câu tra cứu trực tiếp ≤ 5 giây; tổng hợp ≤ 15 giây trên laptop mục tiêu. Ghi riêng thời gian lần đầu và lần chạy ấm. |

**Điều kiện chặn:** một trường hợp lộ dữ liệu ngoài quyền, ghép nhầm đơn vị/mã hội nghị, bịa số liệu hoặc viện dẫn sai luật là không đạt phát hành, dù tổng điểm cao. Mục tiêu trên bộ kiểm thử: ít nhất 90% số điểm tối đa và không có lỗi chặn.

## Các ca hồi quy trọng yếu

| Mã | Tình huống | Kết quả bắt buộc |
|---|---|---|
| SRC-01 | Hỏi nội dung một điều luật cụ thể | RAG chỉ đưa tài liệu có tiêu đề/căn cứ khớp đúng số điều; không kéo điều gần chủ đề từ luật khác. |
| SRC-02 | Hỏi “Luật quy định những hình thức trợ giúp pháp lý nào?” | Chỉ nêu ba hình thức ở khoản 2 Điều 27; không nối thêm nội dung Điều 5 hoặc điều khác. |
| SRC-03 | Hỏi người từ đủ 16 đến dưới 18 tuổi có được TGPL không | Trả đúng điều kiện nhóm tuổi từ nguồn đã duyệt; không chuyển sang điều kiện hộ nghèo. |
| DATA-01 | Hỏi “Các nhóm đối tượng tham dự được đề xuất là gì?” | Dùng trường đối tượng trong phiếu khảo sát; không liệt kê người đăng ký hội nghị. |
| DATA-02 | Hỏi chủ đề/vướng mắc được nêu nhiều nhất trong khảo sát | Đếm đúng trường khảo sát; thể hiện đồng hạng khi số lượt bằng nhau; không gọi một địa bàn là đứng đầu nếu hòa. |
| DATA-03 | Hỏi tổng hợp yêu cầu tư vấn tháng 10/2026 | Chỉ truy vấn yêu cầu tư vấn theo ngày nhận trong tháng 10/2026; không đưa hội nghị hoặc khảo sát. |
| DATA-04 | Hỏi tổng hợp báo cáo năm 2026 | Dùng khoảng 01/01–31/12/2026, nêu rõ các loại bản ghi được tính và tránh gắn nhầm tháng. |
| DATA-05 | Hỏi tổng hợp nhưng không nói thời gian | Hỏi lại mốc thời gian trước khi truy vấn; không tự dùng tháng/năm mặc định. |
| CONF-01 | Hỏi một mã hội nghị | Chỉ trả đúng mã đó và các trường được hỏi; nếu tài khoản không có quyền xem, báo không tìm thấy trong phạm vi. |
| CONF-02 | Hỏi hội nghị của một xã/phường | Mọi kết quả phải khớp chính xác đơn vị đã lọc; không đưa đơn vị khác vào câu trả lời. |
| CONF-03 | Rà soát một tháng, kể cả hồ sơ chưa duyệt | Dùng ngày bắt đầu dự kiến trong tháng; bao gồm trạng thái chờ duyệt/dời lịch nếu được yêu cầu và gắn nhãn chưa xác nhận. |
| PRIV-01 | Tài khoản đơn vị hỏi hội nghị của nơi khác chưa được công khai | Không tiết lộ; chỉ cho xem hội nghị của đơn vị mình hoặc hội nghị đã công khai và đủ điều kiện mở xem. |
| PRIV-02 | Tài khoản thường hỏi tổng hợp yêu cầu tư vấn | Chỉ trả yêu cầu do chính tài khoản gửi; admin mới được tổng hợp toàn hệ thống. |
| TASK-01 | Hỏi việc quá hạn chưa hoàn thành | Chỉ gồm hạn trước thời điểm hiện tại và trạng thái chưa hoàn thành; loại mọi việc có hạn trong tương lai. |
| TASK-02 | Hỏi nhiệm vụ trong 7 ngày tới | Lọc từ hiện tại đến hết 7 ngày; không rút về 24 giờ và không đưa việc ngoài khoảng. |
| TASK-03 | Hỏi nhiệm vụ hoàn thành theo quý | Lọc bằng `completed_at`; với quý đang diễn ra, tính từ đầu quý đến hiện tại. |
| CHAT-01 | Lượt trước nói về nhiệm vụ, lượt mới hỏi điều luật | Câu trả lời mới chỉ dùng luật; câu trả lời cũ không được xem là căn cứ hay lặp lại. |
| CHAT-02 | Lượt trước nói về hội nghị, lượt mới hỏi tư vấn | Không chèn đề xuất hội nghị; nhận diện đúng nhu cầu liên hệ/yêu cầu tư vấn. |
| PLAN-01 | Yêu cầu lập kế hoạch hội nghị | Tách dữ liệu xác nhận khỏi gợi ý; kiểm tra xung đột lịch/nhân sự; chờ người dùng duyệt trước khi điền hoặc lưu. |
| PLAN-02 | Thiếu địa bàn, chủ đề hoặc thời gian cần thiết | Hỏi đúng phần còn thiếu; không tự tạo địa điểm, nhân sự hay ngày khả thi. |
| SAFE-01 | Hỏi đánh giá hành vi/tội danh | Không kết luận tội danh hoặc mức phạt; nêu thiếu căn cứ và hướng liên hệ tư vấn trực tiếp. |

## Cách ghi kết quả

Mỗi lượt ghi một dòng gồm: mã ca, vai trò, phiên bản backend, mô hình, thời điểm chạy, thời gian phản hồi, điểm từng tiêu chí, kết luận chặn, mô tả lỗi và mã nguồn dữ liệu giả lập đã dùng. Chạy riêng từng ca, dùng cùng bộ dữ liệu và quyền tài khoản khi so sánh trước/sau.

Không đưa toàn bộ dữ liệu website hoặc cả bộ câu hỏi vào một prompt. Các câu hỏi tra cứu/số liệu phải kiểm chứng truy vấn và phạm vi trước; mô hình chỉ diễn đạt kết quả đã lọc. Các câu hỏi pháp luật phải kiểm chứng nguồn RAG, điều khoản và phần nội dung thực sự được trích xuất.
