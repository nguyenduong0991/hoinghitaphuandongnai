# Phân tích nguyên nhân nghiệm thu Giai đoạn 2 — 24/10/2026

Phạm vi: chỉ đọc mã, kiểm tra trạng thái dịch vụ và tái hiện phân loại/bộ nhớ bằng hàm thuần. Không sửa mã, cấu hình, schema hay dữ liệu; không khởi động lại dịch vụ; không gửi câu hỏi mới vào chatbot.

## Kết luận tóm tắt

- 33/33 kiểm thử tự động đạt không phát hiện lỗi luồng tự nhiên bị nối nhầm chủ đề; bộ kiểm thử hiện tại chủ yếu xác minh quy tắc đã viết, không chứng minh route thực tế không kế thừa dữ liệu cũ.
- Đã tái hiện được lỗi định tuyến `STAFF_TRAINING`: câu hỏi ngắn ngoài phạm vi được ghép với lượt người dùng trước có HN-0008. Câu hỏi ghép sau đó được phân loại là tra cứu hội nghị và lấy hội nghị đó làm kết quả. Đây là lỗi liên kết ngữ cảnh/định tuyến trước khi truy vấn; không phải RAG trả STAFF_TRAINING cho TASK_ASSIGNEE.
- Câu SQL tải hội nghị có điều kiện phạm vi cho TASK_ASSIGNEE dựa trên nhiệm vụ được giao. Điều kiện này giới hạn đúng dữ liệu truy vấn, nhưng không thể sửa việc chọn sai câu hỏi/ngữ cảnh.
- Không thấy STAFF_TRAINING, ghi chú tư vấn đã duyệt, phản hồi đã sửa hoặc lịch sử câu trả lời nội bộ được thêm vào nguồn RAG/prompt của TASK_ASSIGNEE. Các nguồn này hiện chỉ đọc được cho ADMIN theo `ai-rag-access.js`; việc duyệt không biến chúng thành dữ liệu công khai.
- Thời gian hiện có: trung bình 49,93 giây, P95 109,46 giây; có một lượt HN-0008 hết thời gian ở bộ chạy kiểm thử. Mã không có telemetry phân đoạn nên không thể quy các mốc này thành thời gian xác thực, SQL, embedding hoặc sinh riêng lẻ.
- Ollama đang được health endpoint nhận diện với `qwen3:4b-instruct`; embedding `bge-m3` cũng được báo sẵn sàng. Frontend 8080 và backend health trả HTTP 200 trong lần kiểm tra này. Kiểm tra trạng thái không chứng minh chất lượng hoặc thời gian từng truy vấn.

## A. Nguyên nhân xác định được

### 1. Truy vấn STAFF_TRAINING bị biến thành tra cứu hội nghị

Tái hiện bằng các hàm thuần với lịch sử người dùng `HN-0008 tổ chức khi nào, ở đâu?` và câu hiện tại `Tài liệu nội bộ STAFF_TRAINING có nội dung gì?`:

- Phân loại câu hiện tại một mình: `out_of_scope`, không phải hội nghị, không phải nhiệm vụ.
- `resolveConversationContext()` đặt `usesContext=true`, lý do `short_contextual_turn`, vì câu có không quá 10 từ và bộ phân loại chưa xem nó là yêu cầu độc lập.
- Bộ nhớ đưa lượt HN-0008 cũ vào `relevantUserTurns`.
- `prepareChat()` dùng `conversationMemory.retrievalText` để phân loại lại câu hỏi ngoài phạm vi khi `isFollowUp=true`. Câu đã ghép chứa mã HN-0008 nên có thể đi vào `loadConferenceContext()`.
- `loadConferenceContext()` truy vấn theo văn bản/mã trong câu đã ghép và dựng kết quả từ bản ghi hội nghị có quyền xem. Vì vậy câu trả lời có thể là dữ liệu HN-0008 dù người dùng đang hỏi về nguồn nội bộ.

Vị trí: `src/services/conversation-memory.js` (`resolveConversationContext`, điều kiện `shortAnswer`/`usesContext`, `buildConversationMemory`); `src/routes/ai.routes.js` (`prepareChat`, khối 1328–1357 và tải hội nghị khoảng 2093–2117); `src/services/rag.service.js` (`classifyQuestion`).

Phân loại nguyên nhân theo các lớp yêu cầu:

| Lớp | Kết quả |
|---|---|
| Phân loại ý định | Câu hiện tại được phân loại đúng là ngoài phạm vi. Lỗi xuất hiện khi phân loại lại chuỗi đã ghép với lịch sử. |
| Bộ nhớ hội thoại | **Nguyên nhân gốc xác nhận được**: câu độc lập ngắn có thể kế thừa lượt trước chỉ do độ dài, dù không có tham chiếu rõ như “hội nghị đó”. |
| Truy vấn PostgreSQL | Điều kiện truy vấn hội nghị của TASK_ASSIGNEE chỉ nhận hội nghị có nhiệm vụ giao cho chính tài khoản. Nó truy vấn đúng đối tượng đã bị chọn nhầm từ bộ nhớ. |
| Lọc theo quyền | Không thấy bỏ qua điều kiện quyền trong đường truy vấn hội nghị này. Quyền đúng nhưng ngữ cảnh sai. |
| RAG | TASK_ASSIGNEE không nhận các ghi chú/đính chính nội bộ theo `ai-rag-access.js`. Với nội dung STAFF_TRAINING không mang câu hỏi dịch vụ TGPL, nhánh nạp ghi chú nội bộ cũng không chạy. Lỗi không phải truy xuất STAFF_TRAINING rồi đưa cho người dùng. |
| Tạo câu trả lời | Khi bị định tuyến sang tra cứu hội nghị, câu trả lời được dựng từ dữ liệu truy vấn đã lọc; mô hình không cần tự bịa ra HN-0008. Đây là kết quả thay thế không phù hợp với ý định hiện tại. |

### 2. Cơ chế không trả kết quả thay thế

Tra cứu chính xác theo mã ở `prepareChat()` có câu trả lời “không tìm thấy trong phạm vi dữ liệu tài khoản được phép xem” khi SQL không có hàng. Tuy vậy, tuyến tra cứu tổng quát `loadConferenceContext()` vẫn tạo phần thống kê và câu trả lời dự phòng từ truy vấn tổng hợp. Khi bộ nhớ đã đổi sai câu hỏi thành truy vấn hội nghị, một bản ghi cũ có thể được coi là kết quả phù hợp.

Nên áp dụng “không có kết quả thì không có kết quả” ở tầng định tuyến/SQL: nếu yêu cầu hiện tại không có bộ lọc khớp hoặc truy vấn theo mã trả 0 hàng, trả kết quả rỗng/không tìm thấy trong phạm vi tài khoản. Không lấy thống kê chung, hội nghị gần nhất, kết quả RAG hoặc hội nghị ở lượt trước làm đáp án thay thế. Không nêu liệu mã nội bộ có tồn tại hay không.

### 3. Các công đoạn và hiệu năng hiện tại

| Công đoạn | Hành vi thấy trong mã | Đo riêng được từ telemetry hiện có? |
|---|---|---|
| Xác thực | Middleware xác minh JWT rồi truy vấn user theo ID trong PostgreSQL. | Không; không có timer theo request. |
| Bộ nhớ | Chuẩn hóa tối đa 6 lượt và phân loại lại các lượt người dùng; thao tác đồng bộ, không gọi mô hình. | Không; không log thời gian. |
| Phân loại ý định | Quy tắc từ khóa/regex trong `classifyQuestion()`, có thể chạy lại trên câu đã ghép. | Không; không có timer. |
| PostgreSQL | Tra cứu mã chính xác: 1 truy vấn cơ bản, cộng tối đa 1 truy vấn báo cáo viên và 1 truy vấn người được giao nếu hỏi các trường đó. Tra cứu tổng quát: 2 truy vấn song song; phân tích không kỳ có thể chạy thêm 3 truy vấn tổng hợp, và một truy vấn khảo sát tùy điều kiện. | Không; chưa có `statement_timeout`, `query_timeout` hoặc đo từng truy vấn trong route. |
| Embedding | Hybrid RAG chỉ gọi embedding khi corpus có hàng. Endpoint `/api/embed` có timeout mặc định 90 giây; chỉ mục chia batch tối đa 12 hàng và có thể cần nhiều batch khi cache lạnh. | Không có log định lượng theo request; chỉ log cảnh báo khi lỗi. |
| Xếp hạng RAG | Xếp hạng từ khóa và hợp nhất với cosine similarity; nằm sau embedding. | Không. |
| Ollama chat | `fast`/`legal_rag` có timeout 35 giây; `deep_analysis` 40 giây; `num_ctx=3072`, dự đoán 96/112/192 token. | Có thể lấy duration/token từ response Ollama nếu ghi lại, nhưng route hiện không ghi các trường này. |
| Xử lý phản hồi | Tuyến stream tích lũy toàn văn bản trước khi gửi payload cuối; frontend nhận token để vẽ dần. | Không có thời gian parse/hoàn tất riêng. |

`src/services/ollama.service.js` chỉ gửi một yêu cầu `/api/chat` cho một lần sinh; `streamChatWithOllama()` không có vòng retry. Tuyến hỏi đáp thường gọi embedding riêng tại `/api/embed` khi có corpus cần xếp hạng, nên tổng số request tới Ollama có thể là 0 chat + 0 embedding, hoặc 1 chat + 1 hay nhiều embedding. Không có trường `load_duration`, `prompt_eval_count`, `eval_count` được lưu trong log chatbot hiện tại; không thể đếm số token hoặc tách thời gian nạp model/sinh cho các mẫu cũ.

### 4. Timeout HN-0008

- Frontend dùng `AbortController` để hủy thao tác khi giao diện chủ động hủy/xóa ngữ cảnh; `fetch` stream không đặt deadline riêng. Thông báo “mô hình đang soạn” sau 15 giây chỉ đổi nhãn, không hủy yêu cầu.
- Backend Ollama chat có deadline 35–40 giây theo mode. Embedding có deadline mặc định 90 giây.
- PostgreSQL pool và truy vấn trong `ai.routes.js` không thiết lập deadline truy vấn trong mã được xem.
- Phép đo trước ghi “một lượt HN-0008 bị timeout” ở bộ chạy kiểm thử nhưng không có mã lỗi/trace/timestamp từng tầng. Do đó **chưa thể xác định** là timeout frontend/harness, Ollama hay truy vấn DB. Nếu HN-0008 là truy vấn chính xác theo mã, mã hiện tại đi vào tuyến SQL trực tiếp và không gọi Ollama; nếu là câu nối tiếp, có thể rẽ sang đường tra cứu tổng quát. Cần trace ID cùng thời gian từng tầng để phân biệt.
- Thời gian 109,46 giây vượt quá deadline chat 35–40 giây. Điều này phù hợp với thời gian embedding có thể lên đến 90 giây cộng xử lý tiếp theo, hoặc cho thấy mẫu được đo qua tuyến/phiên bản khác; hiện không đủ trace để kết luận. Không nên tăng timeout.

## B. Nguyên nhân còn nghi vấn

1. Vì sao một số phản hồi đạt 72–109 giây: có thể do embedding cache lạnh/model embedding tải chậm, Ollama Qwen cạnh tranh tài nguyên, truy vấn phân tích nhiều SQL, hoặc timer của bộ chạy phía ngoài. Không có span logs để phân rã.
2. Lượt HN-0008 có thể đã là câu hỏi nối tiếp và đi qua hai lượt truy vấn tổng quát thay vì nhánh exact-code. Cần request log chỉ chứa request ID, intent/mode, method RAG và duration; không cần lưu nội dung hỏi, JWT hay dữ liệu cá nhân.
3. Chưa có phép đo query plan/độ trễ PostgreSQL hoặc tải CPU/RAM tại thời điểm timeout. Không truy vấn DB thật trong lần phân tích này để tránh tải và không dùng dữ liệu cá nhân.

## C. Thay đổi tối thiểu nên thực hiện sau khi được yêu cầu sửa

1. **Ưu tiên cao — ngắt kế thừa theo độ dài:** chỉ nối ngữ cảnh nếu có tham chiếu rõ hoặc câu trả lời ngắn đang đáp lại câu hỏi làm rõ còn mở. Từ khóa nguồn/nội bộ như `STAFF_TRAINING`/`INTERNAL` phải được xử lý như câu độc lập ngoài phạm vi; không kế thừa HN/mã từ lượt trước.
2. Phân loại ý định từ câu hiện tại trước; chỉ bổ sung mã hội nghị đã được xác minh từ bộ nhớ khi câu hiện tại có tham chiếu rõ (“hội nghị đó”, “còn địa điểm?”). Không phân loại một câu ngoài phạm vi thành hội nghị chỉ vì văn bản lịch sử có mã.
3. Tra cứu mã chính xác phải đi vào một hàm truy vấn dùng chung với điều kiện quyền ở SQL. Trả kết quả trực tiếp; không embedding, không chat generation. Khi không có hàng, trả một thông báo trung lập, không hỏi DB phụ để xác nhận liệu hồ sơ nội bộ tồn tại.
4. Với câu hỏi chỉ lấy trường cấu trúc (ngày/giờ, địa điểm, trạng thái, báo cáo viên, người được giao), dùng SQL có trường được yêu cầu và câu trả lời mẫu xác định. Không gọi Ollama.
5. RAG pháp luật chỉ nạp điều khoản gần với câu hỏi; với truy vấn pháp luật chính xác hoặc câu hỏi cấu trúc, bỏ nhánh embedding. Giữ các nguồn nội bộ phía sau quyền ADMIN như hiện nay.
6. Bổ sung telemetry nhẹ, không lưu nội dung: `request_id`, role, intent, code đã chuẩn hóa (chỉ khi được phép log), thời gian auth/memory/classifier/SQL/embed/rank/chat/response, số lần gọi Ollama, mode, `load_duration`, `prompt_eval_count`, `eval_count`, trạng thái timeout. Không ghi prompt, câu hỏi, câu trả lời, thông tin định danh, token hay bí mật.
7. Timeout được ghi theo lớp và hủy truy vấn đang chạy khi có deadline; chỉ cân nhắc đổi deadline sau khi biết tầng nào chiếm thời gian. Không tăng timeout hiện tại để làm lượt chậm có vẻ thành công.

## D. Ước tính tác động tốc độ

- Tra cứu mã và trường cấu trúc hiện có bằng chứng trong các mẫu trước là khoảng 0,6–1,2 giây ở một số lượt trả lời nhanh, nhưng không phải benchmark ổn định. Tối ưu các câu này để bỏ embedding/generation có thể đưa phần lớn xuống mức vài trăm ms đến khoảng 1–2 giây tùy DB/laptop.
- Câu hỏi pháp lý RAG cache nóng có thể bỏ thời gian embedding index; cache lạnh hiện có thể phát sinh một hoặc nhiều lần gọi embedding. Mức tiết kiệm cần đo sau khi thêm timing; không cam kết số cụ thể trước benchmark.
- Câu hỏi phân tích cần diễn giải vẫn cần Ollama; bỏ các lượt gọi lặp và thu hẹp context có thể giảm thời gian, nhưng không loại bỏ giới hạn tốc độ CPU của Qwen 4B.

## E. Rủi ro ảnh hưởng website hiện tại

- Sửa chính sách nối ngữ cảnh có thể khiến một số câu ngắn thật sự nối tiếp phải hỏi làm rõ. Đây là hành vi an toàn hơn việc trả dữ liệu hội nghị cũ.
- Tách đường SQL trực tiếp có nguy cơ thiếu trường nếu không dùng chung kiểm soát quyền. Cần kiểm thử từng role ADMIN, COMMUNE, TASK_ASSIGNEE, SPEAKER, đặc biệt trường người được giao/báo cáo viên.
- Cache embedding và các nguồn dữ liệu nội bộ không được mở rộng quyền. Không thay đổi schema cần thiết cho các đề xuất ưu tiên.
- Chưa xác định nguyên nhân timeout HN-0008 đến mức có thể sửa timeout/config an toàn; chưa đề xuất thay đổi deadline.

## Trạng thái dịch vụ quan sát được lần này

- Backend `/api/health/services`: HTTP 200; backend và Ollama báo sẵn sàng.
- Ollama `/api/ps`: đang nạp `qwen3:4b-instruct` và `bge-m3:latest`.
- Frontend `http://127.0.0.1:8080/`: HTTP 200.
- Không gọi API chatbot mới, không dùng token hoặc nội dung tài khoản. Kiểm tra cổng PostgreSQL trực tiếp không hoàn tất được trong lượt quan sát này; health endpoint hiện tại cũng không báo trạng thái PostgreSQL.

## Nguồn mã đã xem

- `backend/src/services/conversation-memory.js`
- `backend/src/services/rag.service.js`
- `backend/src/services/ollama.service.js`
- `backend/src/services/ai-rag-access.js`
- `backend/src/routes/ai.routes.js`
- `backend/src/auth.js`
- `frontend/assets/js/api.js`
- `frontend/assets/js/topic-assistant.js`

Không có mã, schema, cấu hình hoặc dữ liệu nào được sửa trong lần phân tích này.
