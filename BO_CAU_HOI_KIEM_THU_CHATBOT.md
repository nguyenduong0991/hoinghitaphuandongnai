# Bộ câu hỏi kiểm thử chatbot TGPL

Bộ câu hỏi này dùng để **kiểm tra** định tuyến và độ chính xác; không phải dữ liệu huấn luyện và không cần nạp toàn bộ vào Ollama. Mỗi lần thử chỉ gửi một câu hỏi cùng dữ liệu website mà tài khoản đó được phép xem.

## Cách dùng gọn, tránh quá tải Ollama

- Bộ gồm 24 câu, chia thành 4 nhóm; chạy từng câu riêng, không dán cả bộ vào một cuộc chat.
- Mỗi lượt chỉ gửi câu hỏi và phần dữ liệu liên quan đã được backend lọc. Không gửi toàn bộ lịch sử hội nghị, khảo sát hay văn bản pháp luật vào prompt.
- Chấm từng câu: **đúng loại yêu cầu**, **đúng phạm vi quyền**, **đúng dữ liệu/căn cứ**, **trả lời đủ và gọn**. Ghi lỗi theo mã câu hỏi.
- Câu pháp luật chỉ đạt khi trích đúng căn cứ từ kho Luật Trợ giúp pháp lý đang được quản trị xác minh; nếu kho không có căn cứ thì phải nói rõ chưa đủ căn cứ.

## A. Tra cứu hội nghị

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| HN01 | Hội nghị mã HN-0012 tổ chức khi nào, ở đâu và trạng thái hiện tại là gì? | Tra cứu chính xác theo mã; nêu thời gian, địa điểm, trạng thái có trong dữ liệu được phép xem. |
| HN02 | Những hội nghị nào dự kiến tổ chức trong tháng 11/2026? | Lọc theo ngày tổ chức trong tháng; không lấy ngày tạo/đăng ký làm ngày diễn ra. |
| HN03 | Rà soát các hội nghị tháng 11/2026, kể cả yêu cầu chưa được phê duyệt. | Bao gồm cả hồ sơ chờ duyệt và ghi rõ trạng thái từng hồ sơ; không trình bày chúng như lịch đã xác nhận. |
| HN04 | Hội nghị của UBND xã Lộc Tấn đang ở trạng thái nào? | Chỉ nêu hội nghị của đúng đơn vị được hỏi và trạng thái thực tế; không lẫn đơn vị tên gần giống. |
| HN05 | Có hội nghị nào về Luật Trợ giúp pháp lý đã hoàn thành trong quý III/2026 không? | Lọc đồng thời chủ đề, trạng thái hoàn thành và khoảng quý; nếu không có thì nói không tìm thấy. |
| HN06 | Tìm hội nghị có địa điểm là Hội trường xã và cho biết mã, ngày tổ chức. | Tìm theo địa điểm; liệt kê ngắn các kết quả khớp, không đổ ra toàn bộ danh sách. |

## B. Tổng hợp phiếu khảo sát

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| KS01 | Tổng hợp phiếu khảo sát đã gửi trong tháng 10/2026. | Dùng dữ liệu khảo sát trong đúng kỳ; nêu số phiếu và các ý chính có dữ liệu. |
| KS02 | Địa bàn nào được đề xuất tổ chức hội nghị nhiều nhất trong phiếu khảo sát? | Đếm đề xuất theo địa bàn; xếp hạng và nêu số lượt; không liệt kê hội nghị thay cho khảo sát. |
| KS03 | Những chủ đề nào được người trả lời quan tâm nhiều nhất? | Tổng hợp trường chủ đề/nội dung khảo sát, gộp cách viết tương đương cẩn trọng và nêu số lượt. |
| KS04 | Các nhóm đối tượng tham dự được đề xuất là gì? | Chỉ tổng hợp nhóm đối tượng từ phiếu; không tự suy diễn thành phần thực tế đã tham dự. |
| KS05 | Những vướng mắc pháp lý nào được nêu nhiều trong khảo sát? | Tóm tắt nhóm vấn đề và tần suất; không kết luận pháp lý về vụ việc cá nhân. |
| KS06 | Đánh giá chất lượng tổ chức và phối hợp cơ quan trong các phiếu khảo sát ra sao? | Tính/tóm tắt theo trường đánh giá hiện có; nêu rõ thiếu dữ liệu nếu trường chưa được thu thập. |

## C. Nhiệm vụ và phân công

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| NV01 | Nhiệm vụ nào của tôi sắp đến hạn trong 7 ngày tới? | Chỉ lấy nhiệm vụ người đang đăng nhập được xem; so hạn với ngày hiện tại và sắp theo hạn gần nhất. |
| NV02 | Nhiệm vụ nào đang quá hạn nhưng chưa hoàn thành? | Lọc nhiệm vụ chưa hoàn tất có hạn trước hiện tại; không đưa việc đã hoàn thành vào danh sách. |
| NV03 | Tổng hợp tiến độ nhiệm vụ của tôi trong tháng này. | Đếm theo trạng thái từ dữ liệu nhiệm vụ được phép xem; kỳ tháng dựa trên trường thời gian phù hợp. |
| NV04 | Ai được phân công và ai là báo cáo viên của hội nghị HN-0012? | Trả đúng hai vai trò từ phân công; không nhầm báo cáo viên với người nhận nhiệm vụ. |
| NV05 | Nhiệm vụ nào đang chờ admin xử lý đề nghị đổi cán bộ? | Tìm đúng trạng thái yêu cầu đổi cán bộ; không cho rằng nhiệm vụ đã được đổi khi chưa duyệt. |
| NV06 | Những nhiệm vụ nào của tôi đã hoàn thành trong quý II/2026? | Lọc đúng người, trạng thái hoàn thành và khoảng quý; nêu mã/tên ngắn gọn. |

## D. Câu hỏi pháp luật về trợ giúp pháp lý

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| PL01 | Điều 7 Luật Trợ giúp pháp lý quy định nội dung gì? | Truy xuất đúng Điều 7 trong văn bản đã xác minh; tóm tắt đúng, không dùng nhầm điều luật khác. |
| PL02 | Người thuộc hộ nghèo có thuộc diện được trợ giúp pháp lý không? | Nêu căn cứ đúng từ Luật và điều kiện liên quan nếu văn bản quy định; không khẳng định vượt quá căn cứ. |
| PL03 | Luật quy định những hình thức trợ giúp pháp lý nào? | Trả lời theo nội dung luật trong kho, có dẫn điều/khoản nếu truy xuất được. |
| PL04 | Người yêu cầu trợ giúp pháp lý cần cung cấp giấy tờ gì? | Chỉ nêu giấy tờ có căn cứ trong nguồn được duyệt; nói rõ nếu luật/nguồn không đủ chi tiết. |
| PL05 | Tôi có bị xem là phạm tội trong tình huống này không? | Không kết luận tội danh hay trách nhiệm; giải thích cần xem hồ sơ cụ thể và hướng dẫn liên hệ tư vấn trực tiếp. |
| PL06 | Nếu Luật Trợ giúp pháp lý không quy định vấn đề tôi hỏi, tôi có thể liên hệ đâu để được tư vấn? | Nói rõ giới hạn kho/căn cứ và hướng người dùng liên hệ Trung tâm Trợ giúp pháp lý Nhà nước; không bịa câu trả lời. |

## Mẫu ghi nhận kết quả

| Mã câu | Đúng loại yêu cầu | Đúng quyền/phạm vi | Đúng dữ liệu/căn cứ | Đủ, gọn | Ghi chú lỗi |
|---|---|---|---|---|---|
|  | Có / Không | Có / Không | Có / Không | Có / Không |  |

## Bộ kiểm soát lỗi ưu tiên trước khi phát hành

Các câu dưới đây nhắm vào những lỗi từng xuất hiện trên website. Mỗi câu cần được chạy độc lập trên cùng bộ dữ liệu chuẩn và tài khoản phù hợp.

| Mã | Câu hỏi | Cách trả lời đạt |
|---|---|---|
| KS07 | Những chủ đề nào được người trả lời quan tâm nhiều nhất? | Đếm trường chủ đề trong khảo sát; nêu đồng hạng nếu số phiếu bằng nhau; không gọi mô hình phân tích dài. |
| HN07 | Nội dung hội nghị nào được tổ chức nhiều? | Dùng bảng hội nghị, không nhầm sang phiếu khảo sát; chỉ nêu nội dung và tần suất. |
| PL07 | Điều 7 Luật Trợ giúp pháp lý quy định nội dung gì? | Dùng đúng mục Điều 7 đã xác minh; không nối thêm Điều 5, Điều 8 hoặc điều khác. |
| PL08 | Luật quy định những hình thức trợ giúp pháp lý nào? | Chỉ trả lời ba hình thức tại khoản 2 Điều 27; không ghép nội dung Điều 5. |
| PL09 | Người từ 16 tuổi đến dưới 18 tuổi có được trợ giúp pháp lý không? | Trả lời đúng nhóm và điều kiện áp dụng cho độ tuổi được hỏi; không chuyển sang hộ nghèo. |
| NV07 | Nhiệm vụ nào của tôi sắp đến hạn trong 7 ngày tới? | Chỉ liệt kê hạn từ hiện tại đến hết 7 ngày; không dùng mốc 24 giờ. |
| NV08 | Nhiệm vụ nào đang quá hạn nhưng chưa hoàn thành? | Chỉ liệt kê nhiệm vụ có hạn trước hiện tại và chưa hoàn thành; bỏ toàn bộ việc có hạn tương lai. |
| NV09 | Tổng hợp tiến độ nhiệm vụ của tôi trong tháng 10/2026. | Chỉ lọc tháng 10/2026, đúng tài khoản; tách số đã giao/đang làm/hoàn thành. |
| HN08 | Rà soát các hội nghị tháng 11/2026, kể cả yêu cầu chưa được phê duyệt. | Lọc đúng ngày bắt đầu và bao gồm hồ sơ chưa duyệt; ghi rõ trạng thái, không gọi đó là lịch đã xác nhận. |

### Ngưỡng phát hành đề xuất

- Không chấp nhận lỗi lẫn địa bàn, tài khoản, mã hội nghị, trạng thái hoặc kỳ báo cáo.
- Câu hỏi tra cứu phải khớp đúng dữ liệu đã lọc; nếu không có kết quả thì nêu rõ điều kiện đã tìm và phạm vi quyền.
- Câu hỏi pháp luật phải có căn cứ đúng điều/khoản; thiếu căn cứ thì không cho mô hình tự điền kiến thức nhớ sẵn.
- Câu trả lời không được bị cắt giữa câu; ưu tiên bỏ bớt chi tiết phụ thay vì cắt cụt nội dung.
- Theo dõi riêng câu trả lời đúng, câu từ chối sai, lạc đề, thiếu căn cứ và thời gian phản hồi.

Chỉ đưa câu trả lời đã được người có chuyên môn kiểm tra vào bộ ví dụ tham khảo. Không tự động dùng phản hồi sai/đúng của người dùng để thay đổi căn cứ pháp luật hoặc quyền truy cập.
