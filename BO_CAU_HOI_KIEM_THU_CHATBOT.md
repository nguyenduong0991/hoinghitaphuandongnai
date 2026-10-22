# Bộ câu hỏi kiểm thử chatbot TGPL

Bộ câu hỏi này dùng để **kiểm tra** định tuyến và độ chính xác; không phải dữ liệu huấn luyện và không cần nạp toàn bộ vào Ollama. Mỗi lần thử chỉ gửi một câu hỏi cùng dữ liệu website mà tài khoản đó được phép xem.

## Cách dùng gọn, tránh quá tải Ollama

- Bộ gồm 24 câu cốt lõi, 10 câu hồi quy và 29 câu mở rộng; một số câu cố ý lặp để kiểm tra lỗi cũ. Chạy từng câu riêng, không dán cả bộ vào một cuộc chat.
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
| HN09 | Có bao nhiêu hội nghị dự kiến tổ chức vào tháng 11/2026? | Chỉ trả lời số lượng theo ngày bắt đầu trong tháng và phạm vi quyền tài khoản; nêu số đã duyệt/chờ duyệt/dời lịch, không đổ danh sách hoặc báo cáo tháng khác. Nếu kỳ hay đơn vị cần thiết chưa rõ, hỏi lại. |

### Ngưỡng phát hành đề xuất

- Không chấp nhận lỗi lẫn địa bàn, tài khoản, mã hội nghị, trạng thái hoặc kỳ báo cáo.
- Câu hỏi tra cứu phải khớp đúng dữ liệu đã lọc; nếu không có kết quả thì nêu rõ điều kiện đã tìm và phạm vi quyền.
- Câu hỏi pháp luật phải có căn cứ đúng điều/khoản; thiếu căn cứ thì không cho mô hình tự điền kiến thức nhớ sẵn.
- Câu trả lời không được bị cắt giữa câu; ưu tiên bỏ bớt chi tiết phụ thay vì cắt cụt nội dung.
- Theo dõi riêng câu trả lời đúng, câu từ chối sai, lạc đề, thiếu căn cứ và thời gian phản hồi.

Chỉ đưa câu trả lời đã được người có chuyên môn kiểm tra vào bộ ví dụ tham khảo. Không tự động dùng phản hồi sai/đúng của người dùng để thay đổi căn cứ pháp luật hoặc quyền truy cập.

## E. Nhiệm vụ theo khoảng thời gian

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| NV10 | Việc nào của tôi đến hạn từ hôm nay đến hết 7 ngày tới? | Tính từ thời điểm hiện tại đến hết ngày thứ 7; chỉ việc chưa hoàn thành và đúng tài khoản/quyền xem. |
| NV11 | Trong tháng 10/2026 tôi đã hoàn thành những nhiệm vụ nào? | Giới hạn đúng 01–31/10/2026; lọc theo thời điểm hoàn thành, không lấy việc tháng khác. |
| NV12 | Liệt kê nhiệm vụ tôi đã hoàn thành từ đầu quý III/2026 đến hôm nay. | Dùng 01/07/2026 đến hiện tại, kể cả quý chưa kết thúc; chỉ trạng thái hoàn thành. |
| NV13 | Có việc nào đang quá hạn và vẫn chưa xong? | Hạn trước thời điểm hiện tại AND trạng thái chưa hoàn thành; không đưa nhiệm vụ tương lai vào. |
| NV14 | Tổng hợp tiến độ công việc của tôi trong tháng này theo trạng thái. | “Tháng này” theo ngày hiện tại; đếm từng trạng thái, chỉ lấy nhiệm vụ của người hỏi. |
| NV15 | Nhiệm vụ nào chưa hoàn thành trong tháng này? | Chỉ lấy nhiệm vụ có hạn trong tháng hiện tại và trạng thái chưa hoàn thành; không liệt kê lịch báo cáo viên hoặc nhiệm vụ đã hoàn thành. |

## F. Yêu cầu tư vấn/trợ giúp pháp lý

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| TV01 | Tôi cần được tư vấn về quyền lợi của mình, tôi phải bắt đầu từ đâu? | Hướng dẫn gửi yêu cầu tư vấn trên website hoặc liên hệ Trung tâm TGPL Nhà nước thành phố Đồng Nai; nếu có chức năng tiếp nhận thì mời người dùng gửi yêu cầu. |
| TV02 | Tôi cần người tư vấn gọi lại, tôi để lại thông tin ở đâu? | Chỉ dẫn đúng biểu mẫu yêu cầu tư vấn; nêu dữ liệu bắt buộc theo biểu mẫu, không yêu cầu cung cấp hồ sơ nhạy cảm trong chat. |
| TV03 | Tôi muốn trình bày một tình huống để được trợ giúp pháp lý. | Giải thích cách gửi yêu cầu; không kết luận vụ việc trong chatbot; nhắc không đăng công khai thông tin nhạy cảm. |
| TV04 | Tôi đã gửi yêu cầu tư vấn rồi, bao giờ có người liên hệ? | Chỉ nêu trạng thái/hạn xử lý nếu website có dữ liệu; nếu không có, nói rõ chưa tra được và hướng kiểm tra mục yêu cầu/thông báo. |
| TV05 | Nhờ Trung tâm liên hệ tư vấn giúp tôi. | Nhận diện ý định liên hệ; hướng tới biểu mẫu gửi yêu cầu và tạo thông báo/admin-workflow theo chức năng đã triển khai; không tuyên bố đã gửi nếu chưa có thao tác xác nhận. |
| TV06 | Tôi muốn hỏi về một vấn đề nhưng chưa biết có thuộc diện TGPL không. | Hỏi/giải thích thông tin cần thiết ở mức khái quát hoặc hướng dẫn gửi yêu cầu; không khẳng định đủ điều kiện khi thiếu căn cứ. |

## G. Lập phương án hội nghị/tập huấn

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| KH01 | Giúp tôi tổ chức tập huấn cho cán bộ xã Bù Gia Mập. | Nhận diện yêu cầu lập phương án dù diễn đạt ngắn; đề xuất có địa bàn, đối tượng, chủ đề, quy mô, khung giờ, tài liệu và phân công nếu có dữ liệu phù hợp. |
| KH02 | Đề xuất hội nghị tuyên truyền Luật Trợ giúp pháp lý cho người dân tại đơn vị tôi. | Tạo gợi ý theo ngữ cảnh đơn vị của tài khoản; không tự lưu, gửi thông báo hay phân công trước khi người dùng xác nhận. |
| KH03 | Tổ chức hội nghị phối hợp liên ngành cho cán bộ phường Trảng Dài. | Nhận diện câu mở đầu bằng hành động “Tổ chức”; đưa ra phương án khả thi theo đơn vị/nhân sự/địa điểm thực tế. |
| KH04 | Lập vài phương án ngày và khung giờ cho buổi tập huấn ở xã Lộc Tấn. | Mỗi phương án phải kiểm tra lịch hội nghị đã duyệt và xung đột nhân sự/địa điểm; không đưa ngày đã bận như phương án chọn được. |
| KH05 | Đề xuất chủ đề tập huấn cho 40 cán bộ về nhận diện người thuộc diện trợ giúp pháp lý. | Chủ đề và quy mô bám yêu cầu; phân biệt đề xuất với dữ liệu đã xác nhận; không tự viện dẫn điều luật ngoài kho. |
| KH06 | Cần chuẩn bị những tài liệu gì cho hội nghị này? | Nếu có ngữ cảnh hội nghị thì dùng ngữ cảnh đó; nếu không, hỏi chủ đề/loại hội nghị trước khi gợi ý cụ thể. |
| KH07 | Chọn báo cáo viên và giao nhiệm vụ cho cán bộ giúp tôi. | Chỉ gợi ý người đang có tài khoản/năng lực/lịch phù hợp; nêu rõ nội dung cần admin xác nhận; không tự thực hiện phân công. |
| KH08 | Lên phương án cho phường Tân Phú. | Nhận diện yêu cầu nhưng thiếu chủ đề, đối tượng hoặc thời gian; hỏi ngắn gọn các thông tin cần thiết, không bịa dữ liệu hay tự chọn thay người dùng. |
| KH09 | Đơn vị tôi muốn tuyên truyền pháp luật cho người dân nhưng chưa chọn chủ đề. Hãy gợi ý nội dung phù hợp và cho biết căn cứ chọn. | Chọn tối đa 1–2 chủ đề phù hợp từ danh mục đã duyệt: đất đai/bồi thường; thừa kế/tranh chấp dân sự; quyền TGPL/cách gửi yêu cầu; giấy tờ nhân thân/hộ tịch/cư trú; quyền người cao tuổi/người khuyết tật; tiếp cận TGPL trong tố tụng. Ưu tiên nhu cầu người dùng và dữ liệu website được phép xem; không khẳng định xếp hạng nếu thiếu số liệu. |
| KH10 | Khảo sát của đơn vị tôi có một chủ đề pháp luật mới chưa nằm trong danh mục gợi ý. Có nên đưa vào kế hoạch không? | Được nêu như tín hiệu khảo sát trong phạm vi tài khoản, kèm số phiếu/kỳ nếu có; không tự đưa thành chủ đề gợi ý dùng chung hoặc nạp RAG. Chủ đề dùng chung chỉ cập nhật kho khi quản trị viên yêu cầu. |

## H. Cách nói tự nhiên, thiếu thông tin và ngoài phạm vi

| Mã | Câu hỏi mẫu | Điều kiện trả lời đạt |
|---|---|---|
| TN01 | Bên tôi muốn mở buổi phổ biến luật cho bà con, bắt đầu sao? | Hiểu “mở buổi phổ biến” là đề nghị lập kế hoạch; hỏi thông tin còn thiếu và đưa gợi ý phù hợp. |
| TN02 | Sắp tới xã tôi muốn tập huấn, chatbot hỗ trợ chuẩn bị được không? | Trả lời tự nhiên rằng có thể gợi ý; hỏi địa bàn cụ thể, chủ đề/đối tượng và thời gian mong muốn. |
| TN03 | Có hội nghị nào vào tháng 11 không? | Nếu tài khoản/phạm vi đã xác định thì rà soát cả trạng thái theo đúng yêu cầu; nếu thiếu năm, hỏi lại năm thay vì tự đoán. |
| TN04 | Tổng hợp các yêu cầu tư vấn đã nhận. | Vì chưa có mốc thời gian, hỏi người dùng muốn xem khoảng nào; không lấy nhầm dữ liệu hội nghị/khảo sát. |
| TN05 | Tôi muốn tìm hội nghị ở phường đó. | Hỏi tên phường và/hoặc thời gian cần tra cứu; không tự chọn một địa bàn. |
| TN06 | Tổ chức giúp tôi một hội nghị. | Nhận diện nhu cầu lập kế hoạch nhưng thiếu thông tin; hỏi tối thiểu địa bàn, chủ đề/đối tượng và khoảng thời gian; chưa tạo hay lưu hội nghị. |
| TN07 | Dựa trên phiếu khảo sát và các hội nghị đã hoàn thành trong năm 2026, địa bàn/chủ đề nào nên được ưu tiên cho đợt tập huấn tiếp theo? Nêu căn cứ và điều chưa thể kết luận. | Đối chiếu đúng dữ liệu khảo sát và hội nghị hoàn thành cùng kỳ; phân biệt tần suất khảo sát với thực tế đã tổ chức, nêu đồng hạng và không khẳng định nhân quả. |
| TN08 | Đánh giá mức độ chuyển các nhu cầu nêu trong khảo sát thành hội nghị đã hoàn thành trong năm 2026. Nội dung nào đã được đáp ứng, nội dung nào chưa đủ dữ liệu để kết luận? | So khớp chủ đề/địa bàn khảo sát với hội nghị hoàn thành cùng kỳ; chỉ nêu các kết nối có căn cứ, tách rõ phần chưa khớp hoặc thiếu dữ liệu; không liệt kê tràn lan. |
| TN09 | Tôi có phạm tội không nếu đã làm việc này? | Không kết luận tội danh; giải thích không đủ căn cứ và chỉ dẫn kênh tư vấn phù hợp. |

### Quy tắc xử lý câu hỏi thiếu thông tin

- Hỏi lại khi thiếu **mốc thời gian** cho yêu cầu tổng hợp/tra cứu theo kỳ, **đơn vị/địa bàn** khi cần lọc địa bàn, hoặc **chủ đề/đối tượng** khi cần lập kế hoạch cụ thể.
- Chỉ hỏi những dữ kiện thực sự cần để tiếp tục; không hỏi lại thông tin đã có trong hội thoại hoặc hồ sơ website được phép xem.
- Với yêu cầu tạo kế hoạch, AI chỉ đề xuất. Chỉ điền biểu mẫu hoặc thực hiện bước tiếp theo sau khi người dùng xác nhận đúng phương án đó.
- Với yêu cầu tư vấn, không được nói “đã gửi” hay “đã phân công” nếu hệ thống chưa xác nhận lưu thành công.

## Phiếu chấm nhanh cho từng lượt

| Tiêu chí | Đạt khi |
|---|---|
| Nhận diện ý định | Chọn đúng một nguồn chính: hội nghị, khảo sát, nhiệm vụ, luật TGPL, yêu cầu tư vấn, lập kế hoạch hoặc ngoài phạm vi. |
| Đúng phạm vi | Chỉ đọc dữ liệu mà tài khoản được phép xem; không lẫn đơn vị, người dùng hay nguồn dữ liệu khác. |
| Đúng kỳ và điều kiện | Lọc đúng ngày, tháng/quý, trạng thái, chủ đề và các điều kiện được hỏi. |
| Có căn cứ | Số liệu lấy từ website; nội dung luật lấy đúng văn bản/điều đã duyệt; không tự điền bằng kiến thức mô hình khi thiếu nguồn. |
| Hoàn chỉnh, gọn | Trả đúng phần được hỏi, không cắt giữa câu và không đổ danh sách dài khi chỉ cần tổng hợp. |
| Tôn trọng xác nhận | Gợi ý không tự biến thành thao tác lưu, gửi hay phân công. |
