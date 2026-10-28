# Báo cáo nghiệm thu vận hành Giai đoạn 2 — 24/10/2026

## Kết luận

**Chưa nghiệm thu hoàn tất Giai đoạn 2.** Dịch vụ hiện có phản hồi, nhưng không thể khởi động lại backend an toàn trong lượt này vì Windows từ chối cung cấp command line/tiến trình cha của PID đang giữ cổng 3001. Ngoài ra, tiến trình backend bắt đầu trước thời điểm sửa `conversation-memory.js`, nên chưa có bằng chứng nó đã nạp mã mới. Không chạy file BAT khởi động vì file này chạy migration v22/v23 trước `npm start`, trái giới hạn không thay đổi schema trong lần nghiệm thu.

## A. Trạng thái dịch vụ và khởi động

| Thành phần | Kết quả kiểm tra |
|---|---|
| Backend 3001 | `/api/health` trả HTTP 200, `success: true` |
| Frontend 8080 | `/` trả HTTP 200 |
| PostgreSQL | Dịch vụ Windows `postgresql-x64-18` đang Running; cổng 5432 đang LISTENING. `/api/db-test` trả 401 do endpoint yêu cầu phiên; chưa dùng được endpoint đó để xác nhận kết nối DB của ứng dụng |
| Ollama 11434 | `/api/tags` trả HTTP 200; có `qwen3:4b-instruct` |
| Backend PID | PID 22572, `node.exe`; API health nhận diện TGPL. Thời điểm tiến trình: 23/10/2026 23:24; file bộ nhớ được sửa 24/10/2026 11:04 |
| Cách khởi động đã cấu hình | `KhoiDongDuAnTGPL_Local_3001.bat` chạy migration v22/v23 rồi `npm start` trong `D:\DuAnTGPL\backend` |
| Khởi động lại trong lượt này | **Không thực hiện.** Không đọc được command line/tiến trình cha để xác minh chắc chắn phương thức chạy hiện tại; cũng không chạy BAT có migration |

## B. Phiên chatbot và model

- Đã dùng phiên đăng nhập hợp lệ của vai trò **Người nhận nhiệm vụ**; không gặp HTTP 401.
- Riêng phép gọi không phiên tới `/api/db-test` trả HTTP 401; đây là yêu cầu xác thực của endpoint, không phải lỗi chatbot. Không đánh đồng phản hồi này với lỗi Ollama hay kiểm thử hội thoại.
- Chatbot đã trả lời qua backend và Ollama; danh sách model xác nhận `qwen3:4b-instruct`.
- Mã mới `conversation-memory.js` có trên đĩa, nhưng backend đang chạy được khởi động trước thời điểm sửa. Do đó chưa thể xác nhận mã mới đã được nạp vào bộ nhớ tiến trình.
- Kiểm tra cú pháp các file frontend/backend liên quan: đạt. Kiểm thử tự động nguồn: **17/17 đạt**, gồm 6 lượt hỏi–đáp, nối tiếp dữ kiện, chuyển chủ đề, làm rõ mơ hồ và cô lập RAG theo vai trò. Đây là kiểm thử mã; không thay thế nghiệm thu trên tiến trình vừa khởi động lại.

## C. Kiểm thử hội thoại thực tế

Đã gửi **12 lượt hỏi** thuộc 6 luồng hội thoại. Chấm theo mức đáp ứng yêu cầu kiểm thử, không dùng dữ liệu pháp lý cá nhân thật.

| Luồng | Kết quả |
|---|---|
| Tình huống giả định 17 tuổi, câu hỏi nối tiếp về Điều 7 và giấy tờ TGPL | **Không đạt:** câu đầu trả lời lệch mục đích; câu Điều 7 liệt kê chung, không tập trung dữ kiện tuổi; câu hỏi giấy tờ bị nhầm thành hỏi tài liệu hội nghị |
| Tra cứu HN-0012 và HN-0003 ngoài phạm vi tài khoản | **Đạt 2/2:** chatbot báo không tìm thấy trong phạm vi được phép, không tiết lộ chi tiết hội nghị |
| Hướng dẫn người dân đăng ký tham dự hội nghị công khai và câu đính chính | **Không đạt 0/2:** hướng dẫn nhầm sang đăng ký tổ chức; khi người dùng đính chính, chatbot trả lời thông báo phạm vi chung |
| Nhiệm vụ đến hạn hôm nay và tuần sau | **Đạt 2/2:** phản hồi đúng phạm vi tài khoản; xác định tuần sau là 26/10–1/11/2026 |
| Tra cứu HN-0001 rồi hỏi tiếp ngày kết thúc | **Đạt 1/2:** câu đầu khớp ngày/địa điểm/trạng thái đang hiển thị; câu nối tiếp trả về một bản ghi HN-0001 khác với ngày 22–23/10 thay vì ngày 14–24/10 đã nêu trước đó |
| Hỏi các hình thức trợ giúp pháp lý theo Điều 27 | **Không đạt:** nêu đúng Điều 27 nhưng nối thêm nội dung Điều 5 không được hỏi và bị cắt ngang |

**Tổng:** 5/12 lượt đạt theo tiêu chí nội dung và phạm vi; 7/12 không đạt. Đây là kiểm tra trên backend đang chạy, chưa phải kiểm thử sau khi nạp mã Giai đoạn 2.

## D. Hiệu năng và an toàn

- **Trung bình/P95:** chưa có số đo hợp lệ. Các lượt được kiểm tra bằng giao diện, nhưng thao tác gửi theo lô làm sai lệch phép đo đầu-cuối. Một câu hỏi luật mất hơn một phút mới hoàn tất trong phiên này; cần đo lại sau khi backend nạp đúng mã.
- **Mất ngữ cảnh:** thấy ít nhất 2 biểu hiện: câu hỏi về giấy tờ bị hiểu thành hội nghị; hỏi tiếp ngày kết thúc trả về ngày của bản ghi khác.
- **Truy xuất sai/ngoài phạm vi:** một câu hỏi về người dân tham dự bị trả lời thành quy trình đăng ký tổ chức; câu hỏi Điều 27 có nội dung thừa từ Điều 5.
- **Trả lời thiếu căn cứ:** không ghi nhận câu kết luận quyền lợi pháp lý cá nhân; bài kiểm tra có dữ kiện giả định và câu trả lời sai phạm vi nêu trên.
- **Rò rỉ nội bộ:** 0/2 truy vấn mã hội nghị ngoài phạm vi tiết lộ dữ liệu. Chưa kiểm thử canary nội bộ hoặc các vai trò ADMIN, COMMUNE, SPEAKER qua phiên thật; không thể kết luận an toàn đa vai trò từ mẫu này.

## E. Lỗi và ưu tiên xử lý

1. **P0 — Nạp mã mới:** xác minh PID 22572 và cửa sổ cha trong Task Manager/chi tiết tiến trình, sau đó khởi động lại riêng backend bằng `npm start` tại `D:\DuAnTGPL\backend`; không chạy BAT hiện tại trong đợt nghiệm thu này vì BAT chạy migration.
2. **P1 — Ngữ cảnh và phân loại ý định:** sửa lỗi câu nối tiếp về giấy tờ TGPL bị phân loại thành tài liệu hội nghị; giữ dữ kiện tuổi/tình huống nhưng chỉ dùng làm dữ kiện người dùng cung cấp.
3. **P1 — Chọn bản ghi theo mã:** câu “còn mã đó” phải gắn với đúng hội nghị vừa nêu, không chạy tìm kiếm rộng rồi chọn một bản ghi khác cùng mã.
4. **P1 — Phản hồi pháp lý gọn, đúng câu hỏi:** giới hạn kết quả vào điều khoản được hỏi; loại nội dung Điều 5 không liên quan và tránh cắt câu.
5. **P2 — Hướng dẫn theo vai trò:** tách “đăng ký tham dự với tư cách người dân” khỏi “đăng ký tổ chức hội nghị”, và xử lý câu đính chính bằng ngữ cảnh hiện tại.
6. **P2 — Đo hiệu năng/bảo mật:** sau khi nạp mã mới, chạy tối thiểu 20 kịch bản tuần tự với thời gian đầu-cuối đo từ lúc gửi đến lúc hoàn tất; chạy lại canary kiểm soát quyền trên các vai trò thử nghiệm được phép.

## Giới hạn nghiệm thu

Không thay đổi dữ liệu/schema PostgreSQL, model, thư viện, cổng dịch vụ hay cấu hình xác thực. Chưa khởi động lại backend; chưa hoàn thành đủ 20 kịch bản; chưa có trung bình/P95 đáng tin cậy; kiểm thử phiên thật chỉ dùng vai trò Người nhận nhiệm vụ.
