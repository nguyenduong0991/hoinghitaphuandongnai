# Kết quả kiểm thử chatbot — 23/10/2026

## Phạm vi chạy

- Đã gửi đủ 85 câu chức năng hiện có qua giao diện chatbot trên localhost bằng phiên đăng nhập admin.
- Đã chạy thêm 15 câu paraphrase NL01–NL15 để thử cách diễn đạt tự nhiên. Các câu này dùng cùng ý định/chức năng, không nạp dữ liệu mới.
- Không chạy fine-tuning trọng số Ollama. Đây là kiểm thử luồng nhận diện, truy vấn website/RAG và hiệu chỉnh mã nguồn.
- Bộ kiểm thử chạy bằng quyền admin; chưa xác nhận phân quyền riêng cho COMMUNE, TASK_ASSIGNEE và SPEAKER trong lượt này.

## Kết quả

| Nhóm đánh giá | Kết quả quan sát |
|---|---|
| Nhận diện ý định | 85 câu chức năng đã được gửi. Trong lượt paraphrase ban đầu phát hiện 8 trường hợp lệch ý định/slot; các trường hợp có lỗi đã được sửa và gửi lại. |
| Bộ lọc và dữ liệu | Tra cứu mã HN-0012, trạng thái đơn vị Lộc Tấn, địa điểm Hội trường xã, hội nghị hoàn thành theo quý, nhiệm vụ quá hạn và người được phân công theo mã đã trả đúng phạm vi sau sửa. |
| Hỏi lại khi thiếu dữ kiện | Các câu khảo sát/tổng hợp thiếu kỳ tiếp tục hỏi mốc thời gian; yêu cầu lập kế hoạch thiếu đơn vị/chủ đề/ngày hỏi phần còn thiếu và không lưu hồ sơ. |
| Căn cứ pháp luật | Điều 27 chỉ trả ba hình thức; câu về nhóm tuổi 16–18 được nhận diện cả khi diễn đạt “chưa đủ 18” và trả nội dung từ nguồn đã xác minh. |
| Thời gian | Phần lớn truy vấn trực tiếp chạy khoảng 0,65–0,8 giây. Một câu rà soát tháng 11 mất khoảng 16,8 giây lần đầu; trước sửa, hai paraphrase bị định tuyến sang RAG pháp luật mất khoảng 36 giây. Sau sửa, chúng trả lời khoảng 0,67 giây. Một câu liệt kê tháng 11 sau sửa mất khoảng 12 giây. |

Không quy đổi thành tỷ lệ chính xác/điểm trung bình cho cả 85 câu: lượt chạy này không ghi lại phiếu điểm riêng từng câu và đầy đủ siêu dữ liệu thời gian/nguồn. Vì vậy không gán một tỷ lệ đạt không có căn cứ.

## Lỗi tìm thấy và cách sửa

1. “Hồ sơ hội nghị tháng 11” bị hiểu thành hỏi tài liệu hội nghị. Thu hẹp nhận diện câu hỏi tài liệu; câu rà soát hồ sơ hiện đi vào truy vấn hội nghị.
2. Câu hỏi có tên đơn vị theo sau bởi “hiện có bao nhiêu” làm phần sau bị nuốt vào tên xã. Tra đơn vị bằng tên chính thức trong danh mục trước, rồi mới dùng bộ tách dự phòng.
3. Câu có “buổi đã hoàn thành”, “quý 3” và tên luật bị định tuyến sang RAG pháp luật. Thêm nhận diện câu hỏi lịch sử hội nghị, lọc trạng thái hoàn thành và kỳ.
4. “Cuộc họp diễn ra ở Hội trường xã” bị coi là ngoài phạm vi. Bổ sung biến thể “cuộc họp” và cách hỏi địa điểm “diễn ra ở”.
5. “Đầu việc quá hạn nhưng chưa làm xong” bị hỏi lại thời gian. Bổ sung cách diễn đạt này vào nhận diện nhiệm vụ quá hạn.
6. Câu hỏi “ai nhận nhiệm vụ/ai thuyết trình cho HN-0012” trả toàn bộ danh sách nhiệm vụ. Mở rộng nhận diện các vai trò hỏi theo mã, giờ chỉ truy vấn đúng hội nghị đó.
7. Câu tuổi “16 đến chưa đủ 18” bỏ qua đường dẫn căn cứ đã xác minh và chậm. Bổ sung biến thể này vào nhận diện nhóm tuổi.
8. Câu “mời người dân dự hội nghị” bị xem như tra cứu hội nghị có sẵn. Đưa vào luồng lập kế hoạch; với admin chưa có đơn vị mặc định, chatbot hỏi rõ đơn vị trước khi lập phương án.

Các ca paraphrase có lỗi đã được chạy lại sau chỉnh sửa và cho đúng luồng/kết quả mong đợi. Câu NL03 chạy lại khoảng 12 giây; cần theo dõi thêm nếu nhiều hội nghị khớp kỳ.

### Chấm vòng paraphrase NL01–NL15

| Mã | Kết quả sau rà soát | Ghi chú |
|---|---|---|
| NL01 | Đạt | Tra đúng mã HN-0012 và đủ ngày, địa điểm, trạng thái. |
| NL02 | Đạt về nội dung | Trả danh sách tháng 11; lần chạy đầu khoảng 16,8 giây, cần tối ưu thêm thời gian. |
| NL03 | Đạt sau sửa | Không còn nhầm câu rà soát hồ sơ thành hỏi tài liệu; bao gồm cả trạng thái dời lịch. |
| NL04 | Đạt sau sửa | Nhận đúng UBND xã Lộc Tấn, không nuốt phần “hiện có bao nhiêu” vào tên. |
| NL05 | Đạt sau sửa | Nhận đúng truy vấn hội nghị hoàn thành trong Quý III, không gọi RAG pháp luật. |
| NL06 | Đạt sau sửa | Nhận “cuộc họp” và lọc đúng địa điểm Hội trường xã. |
| NL07 | Đạt | Hỏi lại kỳ tổng hợp còn thiếu. |
| NL08 | Đạt | Hỏi lại kỳ khảo sát còn thiếu. |
| NL09 | Đạt | Lọc nhiệm vụ/lịch trong 7 ngày tới. |
| NL10 | Đạt sau sửa | Nhận “đầu việc chưa làm xong” là truy vấn việc quá hạn; trả 10 việc đang quá hạn, không hỏi kỳ. |
| NL11 | Đạt sau sửa | Chỉ trả phân công và báo cáo viên của HN-0012, không trả 16 nhiệm vụ toàn hệ thống. |
| NL12 | Đạt | Chỉ trả ba hình thức tại Điều 27. |
| NL13 | Đạt sau sửa | Nhận biến thể “16 đến chưa đủ 18”, lấy câu trả lời từ căn cứ đã xác minh. |
| NL14 | Đạt | Hướng dẫn đúng biểu mẫu yêu cầu tư vấn, không nói đã gửi. |
| NL15 | Đạt sau sửa | Đi vào lập kế hoạch và hỏi đơn vị còn thiếu; chưa tạo hồ sơ hoặc phân công. |

## Thay đổi đã lưu

- Nhận diện ý định, tên đơn vị, từ đồng nghĩa hội nghị/nhiệm vụ, trạng thái và vị trí: `backend/src/services/rag.service.js`, `backend/src/routes/ai.routes.js`.
- Sửa phân luồng giao diện giữa câu hỏi tài liệu, tra cứu và lập kế hoạch: `assets/js/topic-assistant.js`, cập nhật phiên bản tải script trong `assets/js/auth.js`.
- Bổ sung 15 cách hỏi NL01–NL15 vào `BO_CAU_HOI_KIEM_THU_CHATBOT.md` và cập nhật thang đánh giá trong `CHATBOT_EVALUATION_GUIDE.md`.

## Giới hạn còn lại

- Một số câu cần kiểm thử thêm bằng tài khoản từng vai trò để xác nhận quyền xem và phạm vi dữ liệu, không chỉ chạy bằng admin.
- Câu tổng hợp tháng 11 có thể chậm hơn truy vấn đơn giản; lần chạy thử cao nhất khoảng 16,8 giây, sát/vượt mục tiêu 15 giây.
- Đây là sửa nhận diện và truy xuất, không phải huấn luyện trọng số. Cần đánh giá chuyên môn trước khi phát hành các trả lời pháp luật.

## Chạy lại toàn bộ 100 câu — 23/10/2026

- Đã gửi tuần tự 100/100 câu qua chatbot trên localhost, phiên admin mới, mỗi câu là một lượt gửi riêng. Không tạo hồ sơ hội nghị, gửi thông báo, phân công nhân sự hoặc gửi yêu cầu tư vấn.
- Lượt đầu: 99/100 đạt theo điều kiện trong bộ câu hỏi; 1 lỗi ở KH25. Câu hỏi yêu cầu nêu cách tính tỷ lệ tham dự bị hiểu nhầm thành yêu cầu tổng hợp theo kỳ và chatbot hỏi lại tháng/năm.
- Đã sửa bộ định tuyến backend để câu hỏi công thức tỷ lệ tham dự được trả lời trực tiếp. Đã gửi lại KH25 và xác nhận chatbot nêu cả công thức trên số đăng ký và so với quy mô dự kiến; nhắc dùng cùng đơn vị đếm và không thay dữ liệu thiếu bằng 0.
- Sau sửa: KH25 đạt; không phát hiện lỗi định tuyến hoặc trả lời sai phạm vi ở các ca còn lại trong lượt này.
- Thời gian: đa số tra cứu trực tiếp khoảng 0,9–1,0 giây; một lượt liệt kê hội nghị tháng 11 khoảng 10,9 giây; lập kế hoạch KH03 khoảng 9,8 giây. Không thấy timeout trong lượt kiểm thử.
- Trong lúc kiểm tra phiên sạch, phát hiện chatbot còn lưu lịch sử 20 lượt vào localStorage. Đã bỏ lưu lịch sử bền vững; lịch sử chỉ còn trong phiên đang mở để hỗ trợ câu hỏi tiếp nối. Sau tải lại dashboard, cả hai tab đăng nhập chỉ hiện lời chào, không nạp lại câu hỏi cũ.
- Tất cả 100 câu được chạy bằng vai trò ADMIN. Các trường hợp cần kiểm chứng quyền riêng của COMMUNE, TASK_ASSIGNEE và SPEAKER vẫn cần lượt kiểm tra theo từng vai trò.

## Chạy 100 câu bằng vai trò người đăng ký — 23/10/2026

- Đăng nhập thực tế: Nguyễn Văn A, UBND xã Lộc Tấn; đã gửi đủ 100 câu riêng lẻ qua giao diện chat và nhận đủ 100 phản hồi.
- Dữ liệu hội nghị được giới hạn vào UBND xã Lộc Tấn. Câu về HN-0012 thuộc đơn vị khác bị ẩn; truy vấn theo trạng thái, địa điểm và tháng trả kết quả trong phạm vi tài khoản.
- Các câu hỏi khảo sát thiếu kỳ hỏi lại mốc thời gian. Câu hỏi nhiệm vụ không lộ danh sách toàn hệ thống và báo tài khoản này chưa được giao nhiệm vụ. Các câu luật Điều 27, Điều 7 và nhóm tuổi được trả từ kho; câu hỏi phạm tội từ chối kết luận.
- Phương án hội nghị ở dạng nháp; không có hồ sơ hội nghị hoặc nhiệm vụ nào được lưu/giao trong lượt thử.

### Lỗi tìm thấy cần sửa

1. Câu “Ai nhận nhiệm vụ và ai là báo cáo viên của HN-0012?” bị định tuyến sang truy vấn nhiệm vụ của tài khoản hiện tại và trả “không được phân công nhiệm vụ”; cần trả lời rõ mã hội nghị ngoài phạm vi xem.
2. Câu “Tổ chức giúp tôi một hội nghị” tự dựng phương án với đơn vị, chủ đề, quy mô và ngày mặc định; tiêu chí bộ thử yêu cầu hỏi thông tin tối thiểu trước khi dựng kế hoạch.
3. “Trong tháng tới” ở ngày 23/10/2026 được gợi ý ngày 28–29/10/2026, tức tháng hiện tại; đây là lỗi hiểu kỳ tương đối.
4. Nhóm câu hỏi xin hướng dẫn liên hệ tư vấn bị xử lý như yêu cầu liên hệ thật. Một câu hỏi hướng dẫn trong lượt thử đã tạo một yêu cầu tư vấn chờ admin xử lý cho tài khoản thử nghiệm. Cần tách câu hỏi “ở đâu/cách gửi” khỏi yêu cầu trực tiếp “hãy liên hệ tôi”; chưa xóa bản ghi để tránh làm mất yêu cầu có thể là thật.
5. Các câu lập kế hoạch mô hình hóa mất khoảng 90 giây mỗi câu trong nhiều lượt, lâu hơn truy vấn có cấu trúc (khoảng 0,8–1,1 giây).

Không gán điểm đạt tổng thể vì chưa chấm từng tiêu chí trong một phiếu riêng; 100/100 ở đây chỉ xác nhận đã gửi và nhận phản hồi. Cần kiểm tra các lỗi trên bằng tài khoản và dữ liệu tương ứng trước khi kết luận chất lượng.

## Chạy 100 câu bằng vai trò người nhận nhiệm vụ — 23/10/2026

- Phiên đăng nhập thực tế: Nguyễn Thị B · Người nhận nhiệm vụ. Đã gửi tuần tự đủ 100 câu trong bộ qua giao diện chatbot localhost; mỗi câu tạo một lượt riêng và có phản hồi. Không tạo hội nghị hoặc giao nhiệm vụ.
- Tra cứu hội nghị và nhiệm vụ được lọc theo phạm vi tài khoản. HN-0012 được báo không tìm thấy; câu hỏi Hội trường xã trả đúng HN-0010; câu hỏi quá hạn trả 8 nhiệm vụ chưa hoàn thành; tổng hợp tháng 10 trả 10 nhiệm vụ theo hạn/thời điểm hoàn thành, trong đó 8 đã giao và 2 hoàn thành.
- Phiếu khảo sát bị chặn do vai trò không có quyền xem. Hỏi thiếu năm cho tháng 11 và thiếu địa bàn đều được hỏi lại. Các câu pháp luật cơ bản được trả lời đúng điều khoản; câu hỏi tội danh từ chối kết luận.

### Lỗi cần sửa

1. NV05 “Nhiệm vụ nào đang chờ admin xử lý đề nghị đổi cán bộ?” trả danh sách 8 nhiệm vụ chung, không lọc yêu cầu đổi cán bộ.
2. KH01–KH04, KH07–KH08, TN01–TN02, TN06, KH11–KH14, KH16, KH18–KH23 và NL15 thường trả “Tài khoản này chỉ được quản lý tệp trong phạm vi hội nghị hoặc nhiệm vụ được phân công.” Lỗi quyền/định tuyến: các yêu cầu chỉ xin gợi ý kế hoạch hoặc chuẩn bị nội dung bị hiểu thành thao tác quản lý tệp. Một số yêu cầu lập danh sách nhiệm vụ chung (KH17) và một vài gợi ý nội dung (KH05, KH10) trả được; hành vi không nhất quán giữa các câu lập kế hoạch.
3. TV01–TV03, TV05–TV06 và NL14 bị hiểu như yêu cầu liên hệ thật. Một lượt yêu cầu tư vấn thử nghiệm được tạo cho tài khoản này; các lượt sau thông báo admin đã nhận trong 24 giờ. Cần tách rõ câu xin hướng dẫn khỏi lệnh yêu cầu liên hệ.
4. NV11/NV12 trả không có thời điểm hoàn thành trong kỳ và nêu 2 việc hoàn thành cũ thiếu mốc thời gian. Câu này phản ánh hạn chế dữ liệu cũ, không phải bằng chứng AI lọc sai; cần tiếp tục lưu timestamp cho lần chuyển trạng thái tiếp theo.
5. Một số truy vấn khảo sát thiếu kỳ hỏi lại đúng, nhưng truy vấn khảo sát kèm đề xuất kế hoạch (KH15) chỉ hỏi kỳ và bỏ qua việc nêu rõ giới hạn quyền xem khảo sát của vai trò này.

- Tổng hợp điểm bằng một tỷ lệ đạt sẽ gây hiểu sai vì một số điều kiện phụ thuộc quyền dữ liệu mà bộ câu hỏi gốc không tách riêng cho vai trò người nhận nhiệm vụ. Kết quả trên được chấm theo đúng phạm vi quyền hiển thị trong phiên.
- Trong các lượt TV, đã tạo một yêu cầu tư vấn kiểm thử cho tài khoản người nhận nhiệm vụ; theo ủy quyền của người dùng, giữ nguyên bản ghi để admin nhận biết và phân biệt khi rà soát. Cùng với lượt người đăng ký trước đó, có ít nhất hai yêu cầu kiểm thử phát sinh từ các vai trò đã chạy.

## Rà soát nhận diện và liên kết hội thoại — 23/10/2026

- Chạy bộ phân loại trên 100 câu trong bộ câu hỏi hiện có: 100/100 được định tuyến đúng theo nhóm mong đợi của từng ca (hội nghị, khảo sát, nhiệm vụ, luật, tư vấn, lập kế hoạch hoặc ca lai). Đây là kết quả nhận diện/định tuyến; không phải điểm chất lượng toàn bộ câu trả lời của mô hình.
- Phát hiện và sửa ba lỗi: một số cách nói lập kế hoạch như “lập vài phương án”, “lên phương án”, “mở buổi phổ biến luật” bị bỏ ngoài phạm vi; câu hỏi nối tiếp “tháng tới thì sao?” vẫn giữ bộ lọc 7 ngày; câu “còn Điều 7?” có thể lấy số điều từ lượt trước.
- Kiểm thử lại trên giao diện localhost bằng tài khoản người nhận nhiệm vụ:
  - “Nhiệm vụ nào của tôi đến hạn trong 7 ngày tới?” chỉ trả nhiệm vụ trong khoảng này.
  - Hỏi tiếp “tháng tới thì sao?” chuyển sang kỳ tháng 11/2026; câu trả lời không còn nhắc bộ lọc 7 ngày.
  - Sau câu hỏi nhiệm vụ, hỏi Điều 27: trả đúng ba hình thức tại Điều 27, không lẫn danh sách nhiệm vụ.
  - Hỏi tiếp “Còn Điều 7 thì sao?”: trả nội dung Điều 7, không lặp Điều 27.
- Backend đã được khởi động lại tại `http://127.0.0.1:3001`. Thời gian suy luận cho câu pháp luật nối tiếp chưa được chấm thành số liệu ổn định; Ollama có một lượt chậm và hết thời gian chờ trước khi hoàn tất, sau khi sửa truy vấn lượt Điều 7 trả nội dung đúng.
- Giới hạn: 100/100 ở trên chỉ xác nhận nhận diện/định tuyến tự động; không gửi toàn bộ 100 câu qua mô hình trong lượt này và không gán điểm chính xác tổng thể. Cần kiểm tra riêng quyền dữ liệu của các vai trò khác khi có phiên tương ứng.
