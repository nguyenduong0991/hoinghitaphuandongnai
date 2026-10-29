(() => {
    if (window.__TGPLChatTestLibraryInitialized) return;
    window.__TGPLChatTestLibraryInitialized = true;
    const adminGroups = [
        {
            title: "Tra cứu hội nghị",
            hint: "Đây là mẫu ý định, không phải câu cố định: có thể thay mã hội nghị, đơn vị, tài khoản hoặc kỳ thời gian rồi gửi câu đã sửa. Chatbot phải tra theo dữ kiện mới nhất và quyền tài khoản, không lấy giá trị cũ trong câu mẫu thay thế.",
            items: [
                ["HN-01", "Hội nghị HN-0012 diễn ra khi nào, ở đâu và trạng thái hiện tại là gì?"],
                ["HN-02", "Hội nghị HN-0006 có được công khai hay không? Nếu không công khai, hãy liệt kê các đơn vị được đăng ký tham dự."],
                ["HN-03", "Ai được phân công và ai là báo cáo viên của hội nghị HN-0012?"],
                ["HN-04", "Hội nghị của UBND phường Trảng Dài đang ở trạng thái nào? Nếu có nhiều hội nghị, hãy nêu mã và trạng thái từng hội nghị."],
                ["HN-05", "Rà soát các hội nghị dự kiến diễn ra trong tháng 11/2026, gồm cả hồ sơ chưa phê duyệt; nêu mã, đơn vị, ngày tổ chức và trạng thái."],
                ["HN-06", "Tìm các hội nghị tổ chức tại Hội trường xã; cho biết mã, ngày giờ và trạng thái của từng hội nghị."],
                ["HN-07", "Với hội nghị HN-0011, cho biết thời gian, địa điểm, báo cáo viên và người được phân công; ghi rõ trường nào chưa có dữ liệu."]
            ]
        },
        {
            title: "Khảo sát, báo cáo và số liệu website",
            hint: "Câu hỏi khảo sát và báo cáo có thể chỉ xem được với một số vai trò; chatbot cần nêu rõ phạm vi dữ liệu.",
            items: [
                ["BC-01", "Tổng hợp phiếu khảo sát đã gửi trong tháng 10/2026."],
                ["BC-02", "Những chủ đề nào được người trả lời quan tâm nhiều nhất? Nêu cả số lượt và trường hợp đồng hạng."],
                ["BC-03", "Các nhóm đối tượng tham dự được đề xuất trong phiếu khảo sát là gì?"],
                ["BC-04", "Những vướng mắc pháp lý nào được nêu trong khảo sát? Chỉ tổng hợp nội dung và số lượt, không kết luận vụ việc."],
                ["BC-05", "Tổng hợp cho tôi số lượng người tham dự hội nghị trong tháng 10/2026."]
            ]
        },
        {
            title: "Nhiệm vụ và phân công",
            hint: "Có thể lọc theo tài khoản và thời gian; câu hỏi đánh giá cần nêu rõ điểm trung bình và số nhiệm vụ đạt ngưỡng.",
            items: [
                ["NV-01", "Nhiệm vụ nào của tôi sắp đến hạn trong 7 ngày tới?"],
                ["NV-02", "Nhiệm vụ nào đang quá hạn nhưng chưa hoàn thành? Chỉ liệt kê việc đã quá hạn."],
                ["NV-03", "Tổng hợp tiến độ nhiệm vụ của tôi trong tháng 10/2026; tách việc đã giao, đang thực hiện và hoàn thành."],
                ["NV-04", "Những nhiệm vụ nào của tôi đã hoàn thành từ đầu quý III/2026 đến hôm nay?"],
                ["NV-05", "Hôm nay tôi có nhiệm vụ nào đến hạn? Nếu không có, hãy trả lời rõ là không có."],
                ["NV-06", "Tài khoản Lethic có bao nhiêu nhiệm vụ trong tháng 10/2026?"],
                ["NV-07", "Điểm trung bình đánh giá của tài khoản Lethic là bao nhiêu trong tháng 10/2026? Có tổng cộng bao nhiêu nhiệm vụ được đánh giá trên 3 điểm?"]
            ]
        },
        {
            title: "Yêu cầu tư vấn và liên hệ",
            hint: "Chỉ gửi câu hỏi tạo yêu cầu tư vấn khi thật sự muốn gửi yêu cầu đến admin.",
            items: [
                ["TV-01", "Tổng hợp các yêu cầu tư vấn nhận được trong tháng 10/2026."],
                ["TV-02", "Tổng hợp các yêu cầu tư vấn chưa phân công ngày 25/10/2026?"],
                ["TV-03", "Hãy tổng hợp các yêu cầu tư vấn trong tháng 10/2026, gồm số lượng, trạng thái và nội dung chung; không hiển thị số điện thoại."]
            ]
        },
        {
            title: "Đề xuất kế hoạch hội nghị, tập huấn",
            hint: "Kiểm tra khả năng gợi ý khả thi và chờ người dùng xác nhận trước khi điền biểu mẫu hoặc phân công.",
            items: [
                ["KH-01", "Hãy giúp tôi lập kế hoạch cho xã Lộc Ninh, vào ngày 07/12/2026, nếu không đủ nhân sự, hãy đề xuất ngày gần nhất sau đó."],
                ["KH-02", "Đề xuất địa bàn, nhân sự, quy mô người tham dự, để tổ chức hội nghị vào ngày 03/12/2026."],
                ["KH-03", "Lập phương án tổ chức hội nghị với ngày, khung giờ, báo cáo viên, nhiệm vụ cán bộ và đơn vị phối hợp; chỉ đề xuất, chưa lưu hay phân công."],
                ["KH-04", "Nếu lịch báo cáo viên đã bận hoặc không đủ cán bộ, hãy nêu phương án khả thi và phần cần admin xác nhận."],
                ["KH-05", "Sau hội nghị, nên đánh giá kết quả bằng những số liệu nào từ đăng ký, điểm danh và phiếu khảo sát?"],
                ["KH-06", "Với hội nghị mã HN-0012, rà soát hồ sơ và đề xuất danh sách nhiệm vụ cần giao, cán bộ phù hợp theo tài khoản, thời hạn và căn cứ phân công. Chỉ lập phương án chờ admin phê duyệt; sau khi được duyệt mới lưu phân công và thông báo cho người đăng ký tham dự."],
                ["KH-07", "Hãy đề xuất phân công cán bộ và báo cáo viên cho hội nghị HN-0001?"],
                ["KH-08", "Lập kế hoạch dời lịch đối với Hội nghị HN-0001."]
            ]
        },
    ];

    const roleCatalogs = {
        COMMUNE: {
            label: "Cán bộ xã/phường",
            description: "Mẫu tập trung vào đề xuất, đăng ký, theo dõi hội nghị và khảo sát của đơn vị; dữ liệu hiển thị vẫn theo quyền tài khoản.",
            groups: [
                { title: "Đăng ký và theo dõi hội nghị của đơn vị", hint: "Hỏi theo mã, chủ đề hoặc thời gian; chỉ xem hồ sơ trong phạm vi tài khoản.", items: [
                    ["XP-01", "Các hội nghị nào đơn vị tôi đã gửi đăng ký trong tháng này?"],
                    ["XP-02", "Hồ sơ hội nghị của đơn vị tôi đang chờ duyệt gồm những mã nào?"],
                    ["XP-03", "Hội nghị HN-0012 diễn ra ngày nào, ở đâu và hiện có trạng thái gì?"],
                    ["XP-04", "Hội nghị nào đơn vị tôi được mời tham dự trong tháng tới? Nêu ngày và địa điểm."],
                    ["XP-05", "Tôi cần làm gì để đăng ký đơn vị tham dự hội nghị đã được công khai hoặc được mời?"],
                    ["XP-06", "Đơn vị tôi có thể đăng ký tham dự hội nghị này không? Nếu thiếu thông tin, hãy hỏi lại mã hội nghị."]
                ]},
                { title: "Khảo sát và nhu cầu của địa bàn", hint: "Tổng hợp theo kỳ được yêu cầu; khi chưa có mốc thời gian, hãy hỏi lại.", items: [
                    ["XP-07", "Tổng hợp các phiếu khảo sát đơn vị tôi đã gửi trong năm 2026."],
                    ["XP-08", "Những chủ đề pháp luật nào được người trả lời khảo sát của đơn vị tôi quan tâm? Nêu số lượt và đồng hạng."],
                    ["XP-09", "Các nhóm đối tượng tham dự được đề xuất trong phiếu khảo sát của đơn vị tôi là gì?"],
                    ["XP-10", "Người dân nêu vướng mắc pháp lý nào trong khảo sát? Chỉ tổng hợp nội dung, không kết luận vụ việc."],
                    ["XP-11", "Xếp hạng các chủ đề được quan tâm trong phiếu khảo sát của đơn vị tôi theo số lượt; nêu số liệu và các trường hợp đồng hạng."],
                    ["XP-12", "Địa bàn nào trong khảo sát của đơn vị tôi có số đề xuất cao nhất? Nếu các địa bàn bằng nhau, hãy liệt kê đồng hạng, không chọn một địa bàn thắng."],
                    ["XP-13", "Đánh giá mức độ thống nhất giữa chủ đề hội nghị đã đề xuất và nhu cầu trong phiếu khảo sát; nêu rõ dữ liệu còn thiếu."],
                    ["XP-14", "Từ số liệu khảo sát trong kỳ, hãy gợi ý một chủ đề hội nghị phù hợp cho địa bàn; phân biệt số liệu với đề xuất."]
                ]},
                { title: "Đề xuất tổ chức và thủ tục TGPL", hint: "AI chỉ lập gợi ý; chưa lưu hồ sơ hoặc gửi phân công nếu chưa được người dùng xác nhận.", items: [
                    ["XP-15", "Gợi ý kế hoạch tuyên truyền Luật Trợ giúp pháp lý tại đơn vị tôi: đối tượng, quy mô, nội dung và tài liệu."],
                    ["XP-16", "Cần cung cấp thông tin gì khi đề xuất tổ chức hội nghị trên hệ thống?"],
                    ["XP-17", "Người yêu cầu trợ giúp pháp lý cần chuẩn bị giấy tờ gì theo Luật Trợ giúp pháp lý?"],
                    ["XP-18", "Nếu câu hỏi của người dân vượt ngoài căn cứ trong Luật Trợ giúp pháp lý, tôi hướng dẫn liên hệ thế nào?"],
                    ["XP-19", "Hãy tổng hợp các yêu cầu tư vấn do người dân gửi đến đơn vị tôi trong tháng này; nếu chưa xác định được tháng, hãy hỏi lại."]
                ]}
            ],

        },
        TASK_ASSIGNEE: {
            label: "Người nhận nhiệm vụ",
            description: "Mẫu ưu tiên nhiệm vụ cá nhân, thời hạn, hội nghị được giao và cập nhật tiến độ; không đưa dữ liệu ngoài phạm vi được phân công.",
            groups: [
                { title: "Nhiệm vụ và thời hạn của tôi", hint: "Câu hỏi thời gian phải lọc đúng kỳ và chỉ liệt kê nhiệm vụ khớp điều kiện.", items: [
                    ["NV-01", "Nhiệm vụ nào của tôi đến hạn hôm nay?"],
                    ["NV-02", "Nhiệm vụ nào của tôi sắp đến hạn trong 7 ngày tới?"],
                    ["NV-03", "Chỉ liệt kê nhiệm vụ của tôi đã quá hạn và chưa hoàn thành."],
                    ["NV-04", "Tổng hợp tiến độ nhiệm vụ của tôi trong tháng này, tách đã giao, đang thực hiện và hoàn thành."],
                    ["NV-05", "Những nhiệm vụ nào của tôi đã hoàn thành từ đầu quý này đến hôm nay?"],
                    ["NV-06", "Nhiệm vụ nào đang chờ tôi cập nhật hoặc gửi ý kiến? Nếu không có, hãy nói rõ."],
                    ["NV-07", "Xếp các nhiệm vụ chưa hoàn thành của tôi theo hạn gần nhất; nêu hạn và trạng thái, không xếp việc đã hoàn tất."],
                    ["NV-08", "Đánh giá tiến độ nhiệm vụ của tôi trong tháng này: tổng số, số hoàn thành, số còn mở và tỷ lệ hoàn thành nếu đủ dữ liệu."],
                    ["NV-09", "Trong các nhiệm vụ được giao, nhóm công việc nào chiếm nhiều nhất? Nêu số lượng và cách tính."],
                    ["NV-10", "Chỉ ra nhiệm vụ có nguy cơ trễ hạn cao nhất dựa trên hạn và trạng thái hiện có; không tự đổi hoặc phân công lại."]
                ]},
                { title: "Hội nghị và nhiệm vụ được phân công", hint: "Chỉ tra cứu hội nghị gắn với nhiệm vụ/lịch được giao cho tài khoản.", items: [
                    ["NV-11", "Hội nghị gắn với nhiệm vụ gần nhất của tôi diễn ra khi nào và ở đâu?"],
                    ["NV-12", "Tôi được phân công chuẩn bị những việc gì cho hội nghị HN-0011?"],
                    ["NV-13", "Ai là người phối hợp với tôi trong nhiệm vụ của hội nghị HN-0011? Chỉ nêu nếu dữ liệu cho phép."],
                    ["NV-14", "Danh sách người dân đăng ký tham dự hội nghị tôi phụ trách có bao nhiêu người và đã điểm danh bao nhiêu?"],
                    ["NV-15", "Hướng dẫn tôi cập nhật trạng thái hoàn thành và ghi ý kiến cho nhiệm vụ được giao." ]
                ]},
                { title: "Ý kiến tư vấn và căn cứ TGPL", hint: "Không yêu cầu AI kết luận hành vi; trường hợp thiếu căn cứ cần hướng dẫn liên hệ Trung tâm.", items: [
                    ["NV-16", "Tôi được giao liên hệ tư vấn cho người dân nào và nội dung cần xử lý là gì? Chỉ xem yêu cầu được phân công cho tôi."],
                    ["NV-17", "Tôi nên ghi ý kiến tư vấn thế nào để rõ căn cứ, phạm vi hỗ trợ và phần cần xác minh?"],
                    ["NV-18", "Người yêu cầu trợ giúp pháp lý cần nộp những giấy tờ gì theo Điều 29?"],
                    ["NV-19", "Nếu chưa đủ căn cứ trả lời tình huống pháp lý, tôi nên hướng dẫn người dân ra sao?"],
                    ["NV-20", "Tổng hợp tiến độ các nhiệm vụ tư vấn đã được giao cho tôi trong tháng này."]
                ]}
            ],

        },
        SPEAKER: {
            label: "Báo cáo viên",
            description: "Mẫu tập trung vào lịch được mời, chủ đề và yêu cầu chuẩn bị; chỉ hiển thị lịch trong phạm vi tài khoản.",
            groups: [
                { title: "Lịch báo cáo viên của tôi", hint: "Hỏi theo hôm nay, tuần/tháng hoặc mã hội nghị; không suy đoán lịch còn thiếu.", items: [
                    ["BCV-01", "Hôm nay tôi có lịch báo cáo viên nào không?"],
                    ["BCV-02", "Lịch báo cáo viên nào của tôi diễn ra trong 7 ngày tới?"],
                    ["BCV-03", "Liệt kê lịch báo cáo viên của tôi trong tháng này, gồm ngày, giờ, địa điểm và trạng thái nếu có."],
                    ["BCV-04", "Tôi được mời báo cáo tại hội nghị HN-0011 không? Nếu có, cho biết chủ đề và thời gian."],
                    ["BCV-05", "Hội nghị gần nhất trong lịch của tôi tổ chức ở đâu và đơn vị nào phối hợp?"],
                    ["BCV-06", "Có lịch nào của tôi bị trùng ngày hoặc giờ không? Chỉ kết luận khi dữ liệu đủ."],
                    ["BCV-07", "Xếp lịch báo cáo viên của tôi trong tháng này theo thời gian sắp diễn ra; nêu ngày, giờ và chủ đề."],
                    ["BCV-08", "Đánh giá mức độ sẵn sàng cho các buổi báo cáo sắp tới dựa trên thông tin lịch và tài liệu được phép xem; nêu phần còn thiếu."],
                    ["BCV-09", "Trong các lịch được giao, chủ đề nào xuất hiện nhiều lần? Nêu số buổi và đồng hạng nếu có."],
                    ["BCV-10", "Xếp các buổi cần tôi xác nhận sớm theo thời gian gần nhất và thông tin còn thiếu; không tự thay đổi lịch."]
                ]},
                { title: "Chuẩn bị nội dung báo cáo", hint: "Đề xuất tài liệu và câu hỏi gợi mở theo chủ đề; căn cứ pháp luật phải đúng nguồn và điều khoản.", items: [
                    ["BCV-11", "Tôi cần chuẩn bị những nội dung gì cho buổi báo cáo về Luật Trợ giúp pháp lý?"],
                    ["BCV-12", "Gợi ý 5 câu hỏi dự phòng để trao đổi với người dân về quyền được trợ giúp pháp lý."],
                    ["BCV-13", "Gợi ý câu hỏi thảo luận về giấy tờ chứng minh người thuộc diện được trợ giúp pháp lý."],
                    ["BCV-14", "Tóm tắt đúng các hình thức trợ giúp pháp lý theo luật, không thêm điều luật khác."],
                    ["BCV-15", "Nếu người tham dự nêu tình huống không đủ dữ kiện, nên hỏi lại những thông tin nào và giới hạn kết luận ra sao?"],
                    ["BCV-16", "Tạo dàn ý ngắn cho bài trình bày 20 phút về quy trình yêu cầu trợ giúp pháp lý." ]
                ]},
                { title: "Phối hợp và phản hồi lịch", hint: "Mẫu chỉ hướng dẫn tra cứu/chuẩn bị; thao tác thay đổi lịch cần thực hiện qua chức năng được cấp quyền.", items: [
                    ["BCV-17", "Thông tin nào cần xác nhận với đơn vị tổ chức trước ngày báo cáo?"],
                    ["BCV-18", "Tôi muốn gửi ý kiến về nội dung hoặc thời gian lịch được phân công thì làm thế nào?"],
                    ["BCV-19", "Hãy giúp tôi lập danh sách tài liệu cần mang theo theo chủ đề của lịch được giao."],
                    ["BCV-20", "Tôi không thấy lịch báo cáo viên trong tài khoản; cần kiểm tra những thông tin nào trước khi báo admin?"]
                ]}
            ],

        }
    };

    function readRole() {
        try {
            const user = window.tgplCurrentUser || JSON.parse(localStorage.getItem("tgpl.user") || "null");
            return String(user?.role || "").trim().toUpperCase();
        } catch {
            return "";
        }
    }

    const activeRole = readRole();
    const roleCatalog = roleCatalogs[activeRole];
    const groups = activeRole === "ADMIN" ? adminGroups : (roleCatalog?.groups || [{
        title: "Tra cứu phù hợp với tài khoản",
        hint: "Câu hỏi được xử lý theo quyền hiện tại; chatbot không mở rộng phạm vi dữ liệu.",
        items: [["HT-01", "Tôi có thể tra cứu những thông tin nào trong phạm vi tài khoản của mình?"], ["HT-02", "Hướng dẫn tôi sử dụng chức năng hiện tại trên trang này."]]
    }]);

    function create(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    let floatingPanel = null;
    let floatingToggle = null;
    let renderCount = 0;

    async function waitForChat() {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            const input = document.getElementById("tgplAiInput");
            const toggle = document.getElementById("tgplAiToggle");
            if (input && toggle) return { input, toggle };
            await new Promise(resolve => window.setTimeout(resolve, 100));
        }
        return null;
    }

    async function putInChat(prompt, status) {
        status.textContent = "Đang mở trợ lý AI…";
        const chat = await waitForChat();
        if (!chat) {
            status.textContent = "Chưa mở được khung chat. Hãy tải lại trang hoặc mở Trợ lý AI rồi thử lại.";
            return false;
        }
        const panel = document.getElementById("tgplAiPanel");
        if (panel?.hidden) chat.toggle.click();
        if (chat.input.disabled) {
            status.textContent = "Chatbot đang xử lý câu trước. Chờ xong rồi chọn câu mẫu.";
            return false;
        }
        if (chat.input.value.trim()) {
            status.textContent = "Ô chat đang có nội dung chưa gửi. Hãy gửi hoặc xóa nội dung đó trước khi nạp câu mẫu để tránh mất câu hỏi.";
            chat.input.focus();
            return false;
        }
        chat.input.value = prompt;
        chat.input.dispatchEvent(new Event("input", { bubbles: true }));
        chat.input.focus();
        status.textContent = "Đã đưa câu hỏi vào ô chat. Kiểm tra nội dung rồi bấm Gửi; câu hỏi chưa được gửi tự động.";
        return true;
    }

    function addPromptRow(parent, id, prompt, status) {
        const row = create("article", "chat-test-item");
        const text = create("p");
        const code = create("span", "chat-test-id", id);
        text.append(code, document.createTextNode(prompt));
        const button = create("button", "btn btn-sm btn-outline-primary", "Dùng câu hỏi");
        button.type = "button";
        button.addEventListener("click", async () => {
            const inserted = await putInChat(prompt, status);
            if (inserted && floatingPanel) {
                floatingPanel.hidden = true;
                floatingToggle?.setAttribute("aria-expanded", "false");
            }
        });
        row.append(text, button);
        parent.appendChild(row);
    }

    function render(mount) {
        renderCount += 1;
        const instanceId = renderCount;
        const card = create("section", "chat-test-library");
        card.setAttribute("aria-labelledby", "chatTestLibraryTitle");
        const heading = create("header", "chat-test-library-heading");
        const headingText = create("div");
        const roleTitle = roleCatalog?.label ? ` · ${roleCatalog.label}` : (activeRole === "ADMIN" ? " · Quản trị viên" : "");
        const roleDescription = roleCatalog?.description || "Chọn câu hỏi phù hợp với vai trò; kết quả chatbot vẫn tuân theo quyền tài khoản.";
        headingText.append(create("h2", "", `Câu hỏi mẫu kiểm thử${roleTitle}`), create("p", "", roleDescription));
        headingText.querySelector("h2").id = `chatTestLibraryTitle-${instanceId}`;
        card.setAttribute("aria-labelledby", `chatTestLibraryTitle-${instanceId}`);
        const badge = create("span", "badge text-bg-primary", `${groups.reduce((sum, group) => sum + group.items.length, 0)} câu hỏi`);
        heading.append(headingText, badge);

        const body = create("div", "chat-test-library-body");
        const searchLabel = create("label", "form-label fw-semibold", "Tìm nhanh câu hỏi");
        const search = create("input", "form-control chat-test-library-search");
        search.id = `chatTestLibrarySearch-${instanceId}`;
        searchLabel.htmlFor = search.id;
        search.type = "search";
        search.placeholder = "Ví dụ: HN-0012, khảo sát, nhiệm vụ 7 ngày…";
        search.setAttribute("aria-label", "Tìm trong câu hỏi mẫu");
        body.append(searchLabel, search);

        const status = create("p", "chat-test-status");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        body.appendChild(status);

        groups.forEach((group, groupIndex) => {
            const details = create("details", "chat-test-group");
            details.open = groupIndex === 0;
            const summary = create("summary");
            summary.append(create("span", "", group.title), create("span", "badge text-bg-light", `${group.items.length} câu`));
            const content = create("div", "chat-test-group-content");
            content.appendChild(create("p", "chat-test-note", group.hint));
            group.items.forEach(([id, prompt]) => addPromptRow(content, id, prompt, status));
            details.append(summary, content);
            body.appendChild(details);
        });

        const safetyNote = activeRole === "ADMIN"
            ? "Bạn có thể sửa một phần câu mẫu (mã hội nghị, tên đơn vị/tài khoản, tháng/quý/năm hoặc cách hỏi) trước khi gửi để kiểm tra khả năng nhận diện. Chatbot phải dùng giá trị bạn vừa nhập; câu mẫu chỉ điền vào ô chat, không tự gửi hay thay đổi dữ liệu. Yêu cầu tư vấn chỉ gửi khi bạn thật sự muốn tạo yêu cầu."
            : "Bạn có thể sửa mã hội nghị, đơn vị, kỳ thời gian hoặc cách diễn đạt trong câu mẫu trước khi gửi. Chatbot phải rà soát theo nội dung mới và quyền tài khoản hiện tại. Câu mẫu chỉ điền vào ô chat; hãy kiểm tra rồi tự bấm Gửi.";
        const caution = create("p", "chat-test-note mt-3 mb-0", safetyNote);
        body.appendChild(caution);
        card.append(heading, body);
        mount.replaceChildren(card);

        const searchableRows = [...card.querySelectorAll(".chat-test-item")];
        search.addEventListener("input", () => {
            const term = search.value.trim().toLocaleLowerCase("vi-VN");
            searchableRows.forEach(row => { row.hidden = Boolean(term) && !row.textContent.toLocaleLowerCase("vi-VN").includes(term); });
            card.querySelectorAll(".chat-test-group").forEach(group => {
                const hasVisible = [...group.querySelectorAll(".chat-test-item")].some(row => !row.hidden);
                group.hidden = Boolean(term) && !hasVisible;
                if (term && hasVisible) group.open = true;
            });
        });
    }

    function addFloatingLibrary() {
        const assistant = document.getElementById("tgplAiAssistant");
        if (!assistant || assistant.querySelector(".tgpl-chat-prompts-toggle")) return;

        const styles = document.createElement("style");
        styles.textContent = `
            .tgpl-chat-prompts-toggle{position:absolute;right:calc(100% + 9px);bottom:0;display:inline-flex;align-items:center;gap:7px;min-height:46px;padding:0 14px;border:1px solid #cbddec;border-radius:999px;background:#fff;color:#175d8e;box-shadow:0 7px 20px rgba(17,65,104,.18);font:inherit;font-weight:700;white-space:nowrap}
            .tgpl-chat-prompts-toggle:hover{background:#eff7fc;transform:translateY(-1px)}
            .tgpl-chat-prompts-toggle:focus-visible{outline:3px solid #f0bd4d;outline-offset:2px}
            .tgpl-chat-prompts-panel{position:absolute;right:calc(100% + 9px);bottom:0;width:min(390px,calc(100vw - 32px));max-height:min(72vh,680px);overflow:auto;z-index:2;border-radius:14px;background:#fff;box-shadow:0 18px 55px rgba(20,44,72,.24)}
            .tgpl-chat-prompts-panel[hidden]{display:none!important}
            .tgpl-chat-prompts-panel .chat-test-library{max-height:none;border-radius:14px}
            .tgpl-chat-prompts-panel .chat-test-library-heading{padding:13px 15px}
            .tgpl-chat-prompts-panel .chat-test-library-heading h2{font-size:1rem}
            .tgpl-chat-prompts-panel .chat-test-library-heading p{font-size:.78rem}
            .tgpl-chat-prompts-panel .chat-test-library-body{padding:12px 14px}
            .tgpl-chat-prompts-panel .chat-test-group-content{max-height:230px;overflow:auto}
            .tgpl-chat-prompts-panel .chat-test-note{font-size:.76rem}
            @media(max-width:650px){
                .tgpl-chat-prompts-toggle{right:0;bottom:calc(100% + 8px);min-height:40px;padding:0 12px;font-size:.85rem}
                .tgpl-chat-prompts-panel{right:0;bottom:calc(100% + 54px);width:min(390px,calc(100vw - 28px));max-height:62vh}
            }
        `;
        document.head.appendChild(styles);

        floatingToggle = create("button", "tgpl-chat-prompts-toggle", "☷ Câu hỏi mẫu");
        floatingToggle.type = "button";
        floatingToggle.setAttribute("aria-expanded", "false");
        floatingToggle.setAttribute("aria-controls", "tgplChatPromptsPanel");
        floatingToggle.setAttribute("aria-label", "Mở bộ câu hỏi mẫu theo vai trò");
        floatingPanel = create("aside", "tgpl-chat-prompts-panel");
        floatingPanel.id = "tgplChatPromptsPanel";
        floatingPanel.hidden = true;
        floatingPanel.setAttribute("aria-label", "Bộ câu hỏi mẫu");
        const mount = create("div");
        floatingPanel.appendChild(mount);
        render(mount);
        assistant.append(floatingToggle, floatingPanel);

        floatingToggle.addEventListener("click", () => {
            const opening = floatingPanel.hidden;
            if (opening && !document.getElementById("tgplAiPanel")?.hidden) {
                document.getElementById("tgplAiClose")?.click();
            }
            floatingPanel.hidden = !opening;
            floatingToggle.setAttribute("aria-expanded", String(opening));
            if (opening) floatingPanel.querySelector('input[type="search"]')?.focus();
        });
        document.addEventListener("pointerdown", event => {
            if (floatingPanel.hidden || floatingPanel.contains(event.target) || floatingToggle.contains(event.target)) return;
            floatingPanel.hidden = true;
            floatingToggle.setAttribute("aria-expanded", "false");
        });
        document.getElementById("tgplAiToggle")?.addEventListener("click", () => {
            floatingPanel.hidden = true;
            floatingToggle.setAttribute("aria-expanded", "false");
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !floatingPanel.hidden) {
                floatingPanel.hidden = true;
                floatingToggle.setAttribute("aria-expanded", "false");
                floatingToggle.focus();
            }
        });
    }

    function initialize() {
        const mount = document.getElementById("chatTestLibraryMount");
        if (mount) render(mount);
        addFloatingLibrary();
        if (!document.getElementById("tgplAiAssistant") && document.body) {
            const observer = new MutationObserver(() => {
                addFloatingLibrary();
                if (document.getElementById("tgplAiAssistant")) observer.disconnect();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
