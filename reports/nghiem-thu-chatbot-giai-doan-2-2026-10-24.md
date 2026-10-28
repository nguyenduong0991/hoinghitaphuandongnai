# Báo cáo nghiệm thu Giai đoạn 2 — 24/10/2026

## Kết luận

**Chưa đạt nghiệm thu.** Backend đã được khởi động lại an toàn và 33/33 kiểm thử tự động đạt. Kiểm thử live xác nhận một số truy vấn hội nghị/pháp luật và câu nối tiếp, đồng thời phát hiện phản hồi lạc đề khi hỏi về dữ liệu `STAFF_TRAINING`. Chưa hoàn tất 20 kịch bản live đa lượt và chưa có phiên đăng nhập hợp lệ cho ba vai trò còn lại.

## Dịch vụ và khởi động

- Backend `127.0.0.1:3001`: health thành công sau khởi động lại; listener ban đầu là PID 1316, tiến trình Node duy nhất giữ cổng 3001. PID được dừng riêng; backend được khởi động bằng `npm start` tại `D:\DuAnTGPL\backend`; listener sau khởi động là PID 27964.
- Log khởi động: `node src/server.js`, nạp 9 biến từ `.env.demo`, chọn DB host `localhost`; không gọi migration.
- Frontend `localhost:8080`: HTTP 200.
- PostgreSQL `127.0.0.1:5432`: TCP mở. Trạng thái truy vấn DB tầng ứng dụng chưa xác minh được: `/api/db-test` trả HTTP 401 do gọi không có phiên đăng nhập hợp lệ; 401 này không chứng minh PostgreSQL lỗi.
- Ollama `127.0.0.1:11434`: sẵn sàng; model `qwen3:4b-instruct` được health endpoint nhận diện.
- Phiên đăng nhập live: `TASK_ASSIGNEE` (người nhận nhiệm vụ). Không có phiên xác thực live cho `ADMIN`, `COMMUNE`, `SPEAKER` trong các tab hiện có.

## Kiểm thử tự động

Chạy `node --test` sau khi backend được khởi động lại: **33 đạt, 0 lỗi, 0 bỏ qua**, thời lượng khoảng 0,38 giây. Bao gồm các kiểm tra cấu trúc về phân quyền RAG, cách ly vai trò, tham chiếu hội nghị gần nhất, chuyển chủ đề, trích xuất điều/khoản và phát hiện câu trả lời bị cắt. Đây là kiểm thử tự động, không thay thế kiểm thử HTTP theo từng vai trò.

## Kiểm thử live qua giao diện và HTTP backend

Đã gửi 18 câu hỏi qua giao diện chatbot đang đăng nhập; luồng giao diện gọi API backend dạng stream. Có 6 chuỗi hỏi nối tiếp được quan sát. Nội dung hội thoại là dữ liệu kiểm thử tổng hợp, không dùng hồ sơ pháp lý cá nhân thật.

| Phạm vi | Kết quả live |
|---|---|
| HN-0011: thời gian, địa điểm, báo cáo viên, trạng thái, cán bộ | Đạt; trả đủ trường được hỏi. 1,21 giây |
| HN-0013: thời gian, địa điểm, trạng thái; câu nối tiếp hỏi báo cáo viên/người được phân công | Đạt; các trường có dữ liệu được nêu, báo cáo viên được ghi rõ là chưa được ghi nhận. Thời gian lượt nối tiếp không được lưu do lô chạy bị timeout |
| HN-0006: địa điểm/trạng thái, câu nối tiếp về thời gian, rồi báo cáo viên/người được phân công | Đạt; dữ liệu bám HN-0006. Lượt nối tiếp cuối 0,79 giây |
| HN-0009: lịch hiện tại, lịch đề xuất dời, địa điểm, báo cáo viên, cán bộ, trạng thái; câu nối tiếp hỏi ngày dời | Đạt về nội dung và tham chiếu; lượt đầy đủ 72,29 giây, lượt nối tiếp 0,65 giây |
| Điều 27 khoản 2 rồi hỏi tiếp hồ sơ yêu cầu TGPL | Đạt; nêu đúng 3 hình thức theo khoản 2 Điều 27, sau chuyển sang Điều 29 khoản 1 cho giấy tờ. 72,97 và 73,05 giây |
| HN-0004: thời gian, địa điểm, trạng thái | Đạt. 0,65 giây |
| HN-0012 ngoài phạm vi tài khoản rồi hỏi tiếp địa điểm | Đạt về cách ly; cả hai lượt báo không tìm thấy trong phạm vi được phép, không tiết lộ trường dữ liệu. 72,97 và 72,92 giây |
| HN-0002: thời gian, địa điểm, trạng thái rồi hỏi ngày kết thúc | Đạt. 0,63 và 72,92 giây |
| HN-0008: ngày giờ, địa điểm, trạng thái | Nội dung trả về đúng dữ liệu quan sát được trên trang, nhưng thao tác đo bị timeout; thời gian không hợp lệ để tính thống kê |
| Hỏi nội dung `STAFF_TRAINING` từ vai trò TASK_ASSIGNEE | **Không đạt về định tuyến/nội dung:** chatbot không trả lời câu hỏi mà đưa thống kê và một hội nghị thông thường được phép xem. Không thấy nội dung `STAFF_TRAINING` bị lộ. 98,59 giây |
| Hỏi dữ liệu `INTERNAL` từ vai trò TASK_ASSIGNEE | Không có nội dung nội bộ bị lộ; chatbot trả câu giới thiệu phạm vi chung, chưa trả lời trực tiếp vì sao không thể cung cấp. 109,46 giây |

## Hiệu năng live

Tính trên **13 phép đo có thời gian hợp lệ** (thời gian từ gửi câu hỏi ở UI đến khi ô nhập hoạt động lại):

- Trung bình: **49,93 giây**.
- P95 theo nearest-rank: **109,46 giây**.
- Hai phép đo vượt 90 giây; một yêu cầu HN-0008 không có thời gian hợp lệ do bộ điều khiển kiểm thử timeout.
- Đây là thời gian đầu-cuối quan sát qua giao diện, không phải benchmark riêng cho Ollama. Không tính các lượt trả lời đã hiển thị nhưng bị mất phép đo.

## Đạt / không đạt / chưa kiểm tra

### Đạt

- Backend mới đã nạp sau restart; không chạy migration.
- Health backend, frontend, PostgreSQL TCP, Ollama và model Qwen3 đều được xác nhận ở mức tương ứng nêu trên.
- 33/33 kiểm thử tự động đạt sau restart.
- Một số truy vấn nhiều trường, tham chiếu hội nghị trong chuỗi, chuyển từ chủ đề hội nghị sang pháp luật, và từ chối tra cứu hội nghị ngoài phạm vi đều hoạt động đúng.
- Không quan sát thấy dữ liệu `STAFF_TRAINING` hoặc `INTERNAL` trong câu trả lời của phiên TASK_ASSIGNEE.

### Không đạt

- Yêu cầu 20 kịch bản hội thoại live chưa hoàn thành: quan sát được 18 câu hỏi live và 6 chuỗi nối tiếp; một lượt bị timeout. Không thể coi phần còn thiếu là đạt.
- Hiệu năng không ổn định: trung bình 49,93 giây, P95 109,46 giây.
- Truy vấn nhắc `STAFF_TRAINING` trả nội dung hội nghị không liên quan thay vì từ chối có giải thích; đây là lỗi định tuyến live cần sửa trước nghiệm thu.

### Chưa kiểm tra

- Kiểm thử HTTP đầu-cuối bằng tài khoản hợp lệ cho `ADMIN`, `COMMUNE`, `SPEAKER`; hiện chỉ có phiên `TASK_ASSIGNEE`.
- Truy vấn có nhiều mã hội nghị rồi câu tiếp “hội nghị đó” trong cùng phiên; lượt so sánh nhiều mã bị gián đoạn bởi timeout của công cụ kiểm thử.
- Các biến thể câu hỏi pháp luật về Điều 7, điều kiện 16–18 tuổi, dữ liệu pháp luật không có căn cứ và cắt câu trả lời dài bằng HTTP live.
- Phân quyền chéo `STAFF_TRAINING`/`INTERNAL` cho từng vai trò bằng tài khoản thực. Kiểm thử tự động về lớp lọc RAG theo vai trò đã đạt, nhưng không được xem là kiểm thử HTTP theo vai trò.
- Truy vấn DB ở tầng ứng dụng bằng endpoint xác thực; chỉ xác nhận được TCP cổng 5432.

## Sự cố và ưu tiên

1. **P1 — định tuyến `STAFF_TRAINING`:** câu hỏi về nguồn nội bộ bị biến thành thống kê/hội nghị. Rà soát phân loại intent và đảm bảo nguồn nội bộ bị loại trước truy xuất/prompt; bổ sung ca kiểm thử HTTP negative cho mọi vai trò.
2. **P1 — hiệu năng:** điều tra các lượt mất 73–109 giây và lượt timeout; ưu tiên đường trả lời truy vấn cấu trúc/RAG có giới hạn sinh, đồng thời đo lại từ API sau khi sửa.
3. **P2 — bao phủ nghiệm thu:** cần phiên hợp lệ cho ADMIN, COMMUNE, SPEAKER để chạy ma trận truy cập live; tiếp tục các ca nhiều mã, Điều 7 và phản hồi dài.

## Thay đổi và khôi phục

Trong lượt nghiệm thu này không sửa mã, schema, dữ liệu, file môi trường hay cấu hình dịch vụ. Chỉ khởi động lại PID backend đã xác minh. Nếu cần quay lại phiên chạy trước, khởi động lại bằng đúng script `npm start` từ `D:\DuAnTGPL\backend` sau khi dừng riêng PID backend hiện tại; không chạy BAT có migration.
