const INTENT_LABELS = Object.freeze({
    conference: "hội nghị",
    tasks: "nhiệm vụ và lịch được giao",
    survey: "phiếu khảo sát",
    legal: "Luật Trợ giúp pháp lý",
    contact: "yêu cầu tư vấn/liên hệ",
    system: "hướng dẫn sử dụng hệ thống",
    conference_planning: "lập kế hoạch hội nghị/tập huấn",
    out_of_scope: "chưa phân loại"
});

function normalizeText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d").toLocaleLowerCase("vi-VN");
}

function intentFamily(intent) {
    if (["conference_lookup", "conference_analysis", "conference_action_review"].includes(intent)) return "conference";
    if (intent === "legal_aid" || intent === "criminal_scope") return "legal";
    if (["contact_referral", "contact_request_status", "contact_request_summary"].includes(intent)) return "contact";
    if (intent === "system_help" || intent === "tasks") return intent;
    return intent || "out_of_scope";
}

function normalizeConversationHistory(history, maxTurns = 6) {
    const valid = (Array.isArray(history) ? history : []).map(item => {
        if (!["user", "assistant"].includes(item?.role) || typeof item.content !== "string") return null;
        const content = item.content.trim();
        return content ? { role: item.role, content } : null;
    }).filter(Boolean).slice(-Math.max(2, maxTurns * 2));
    const userIndexes = valid.map((item, index) => item.role === "user" ? index : -1).filter(index => index >= 0);
    const firstKeptUser = userIndexes[Math.max(0, userIndexes.length - Math.max(1, maxTurns))] ?? Math.max(0, valid.length - maxTurns * 2);
    return valid.slice(firstKeptUser);
}

function clarificationSlots(history) {
    const items = Array.isArray(history) ? history : [];
    let lastUser = -1;
    items.forEach((item, index) => { if (item.role === "user") lastUser = index; });
    const assistant = items.slice(lastUser + 1).reverse().find(item => item.role === "assistant");
    if (!assistant || !/[?？]/.test(assistant.content)) return [];
    const text = normalizeText(assistant.content);
    const slots = [];
    const patterns = [
        ["địa bàn/đơn vị", /dia ban|don vi|xa |phuong /],
        ["mã hội nghị", /ma hoi nghi|hoi nghi nao|ma nao/],
        ["thời gian", /thoi gian|ngay nao|thang nao|quy nao|nam nao/],
        ["đối tượng", /doi tuong|ai tham du|thanh phan/],
        ["chủ đề/nội dung", /chu de|noi dung/],
        ["quy mô", /quy mo|so luong|bao nhieu nguoi|so nguoi/],
        ["tuổi", /bao nhieu tuoi|tuoi nao/],
        ["hoàn cảnh/tình tiết", /hoan canh|tinh tiet|vu viec|truong hop/]
    ];
    for (const [label, pattern] of patterns) if (pattern.test(text)) slots.push(label);
    return [...new Set(slots)];
}

function hasExplicitReference(question) {
    const text = normalizeText(question);
    return /\b(vay|con|the|truong hop do|van de nay|cau tra loi do|noi dung vua neu|hoi nghi do|hoi nghi nay|phuong an do|dia diem do|ngay do|theo y tren|theo phuong an|toi thi sao|can giay to gi|quy dinh nao ap dung|liet ke ma|ma va trang thai|danh sach do|chi tiet do)\b/.test(text);
}

function wordCount(value) {
    return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean).length;
}

function resolveConversationContext(question, history, currentClassification, classifyQuestion) {
    const users = history.map((item, index) => ({ ...item, index }))
        .filter(item => item.role === "user")
        .map(item => ({ ...item, classification: classifyQuestion(item.content) }));
    const previous = users.filter(item => item.classification.isInScope || intentFamily(item.classification.intent) !== "out_of_scope").at(-1) || users.at(-1) || null;
    const previousFamily = previous ? intentFamily(previous.classification.intent) : "";
    const currentFamily = intentFamily(currentClassification.intent);
    const explicitReference = hasExplicitReference(question);
    const relatedConferenceFamilies = new Set(["conference", "tasks"]);
    const previousMentionsConference = Boolean(previous && /\b(?:hoi nghi|su kien|hn[-_ ]?\d{2,}|hcn[-_ ]?\d{2,}|conf[-_ ]?\d{2,})\b/.test(normalizeText(previous.content)));
    const currentMentionsConference = /\b(?:hoi nghi|su kien|hn[-_ ]?\d{2,}|hcn[-_ ]?\d{2,}|conf[-_ ]?\d{2,})\b/.test(normalizeText(question));
    const familiesMatch = previousFamily === currentFamily ||
        (previousFamily === "tasks" && currentFamily === "conference" && previousMentionsConference) ||
        (previousFamily === "conference" && currentFamily === "tasks" && currentMentionsConference);
    const unresolvedSlots = clarificationSlots(history);
    const shortAnswer = wordCount(question) <= 10 && !currentClassification.isInScope;
    const answersClarification = shortAnswer && unresolvedSlots.length > 0;
    const currentText = normalizeText(question);
    const unsureReply = /\b(khong biet|chua ro|chua xac dinh|chua co thong tin)\b/.test(currentText);
    const answeredSlot = slot => {
        if (unsureReply) return false;
        if (slot === "địa bàn/đơn vị") return /\b(xa|phuong|ubnd|don vi)\b/.test(currentText) || (shortAnswer && wordCount(question) >= 2 && !/\d/.test(question));
        if (slot === "mã hội nghị") return /\b(?:hn|hcn|conf)[-_ ]?\d{2,}\b/i.test(question);
        if (slot === "thời gian") return /\b(?:thang|quy|nam|ngay|tuan|\d{1,2}[/-]\d{1,2})\b/.test(currentText);
        if (slot === "đối tượng") return /\b(nguoi dan|can bo|tre em|nguoi ngheo|ho ngheo|nguoi cao tuoi|nguoi khuyet tat|doi tuong)\b/.test(currentText);
        if (slot === "chủ đề/nội dung") return /\b(luat|chu de|noi dung|dat dai|thua ke|boi thuong|tro giup phap ly|tap huan)\b/.test(currentText);
        if (slot === "quy mô") return /\b\d{1,4}\s*(?:nguoi|dai bieu|can bo)\b/.test(currentText);
        if (slot === "tuổi") return /\b\d{1,3}\s*tuoi\b/.test(currentText);
        if (slot === "hoàn cảnh/tình tiết") return wordCount(question) > 10;
        return false;
    };
    const remainingSlots = answersClarification ? (unsureReply ? unresolvedSlots : unresolvedSlots.filter(slot => !answeredSlot(slot))) : [];
    const topicShift = Boolean(currentClassification.isInScope && !answersClarification &&
        (!explicitReference || (previous && !familiesMatch)));
    // A bare short phrase is context only when it answers an explicit pending
    // clarification, or is itself a known in-scope follow-up in the same topic.
    // Previously every short out-of-scope phrase inherited the last topic, so a
    // place name could accidentally revive an old legal/criminal or plan request.
    const usesContext = Boolean(previous && !topicShift && (explicitReference || answersClarification ||
        (shortAnswer && currentClassification.isInScope && currentFamily === previousFamily)));
    const previousRelevant = usesContext && previous
        ? users.filter(item => item.index >= previous.index && (
            item.classification.intent === previous.classification.intent ||
            intentFamily(item.classification.intent) === previousFamily ||
            (intentFamily(item.classification.intent) === "out_of_scope" && wordCount(item.content) <= 10)
        )).slice(-6)
        : [];
    const explicitConferenceReference = /\b(?:hoi nghi do|hoi nghi nay|su kien do|su kien nay)\b/.test(currentText) ||
        (explicitReference && /\b(?:o dau|dia diem|dien ra|ngay gio|thoi gian|bao cao vien|trang thai)\b/.test(currentText));
    let conferenceReferenceCode = null;
    let conferenceReferenceAmbiguous = false;
    if (usesContext && explicitConferenceReference && previous && relatedConferenceFamilies.has(previousFamily)) {
        const codeAnchor = [...users].reverse().find(item => {
            if (item.index >= history.length) return false;
            const codes = conferenceCodeFromText(item.content);
            if (codes.length) return true;
            const family = intentFamily(item.classification.intent);
            if (family === "conference") return false;
            if (family === "tasks" && /\b(?:hoi nghi|su kien)\b/.test(normalizeText(item.content))) return false;
            return !(family === "out_of_scope" && wordCount(item.content) <= 10);
        });
        if (codeAnchor) {
            const codes = conferenceCodeFromText(codeAnchor.content);
            conferenceReferenceAmbiguous = codes.length > 1;
            if (codes.length === 1) conferenceReferenceCode = codes[0];
        }
    }
    const unresolvedReference = explicitReference && !previous;
    return {
        usesContext,
        topicShift,
        previous,
        unresolvedSlots: remainingSlots,
        relevantUserTurns: previousRelevant.map(item => item.content),
        conferenceReferenceCode,
        conferenceReferenceAmbiguous,
        clarify: unresolvedReference,
        reason: explicitReference ? "explicit_reference" : answersClarification ? "answer_to_clarification" : shortAnswer ? "short_contextual_turn" : topicShift ? "independent_topic" : "independent_question"
    };
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function conferenceCodeFromText(value) {
    const matches = [...String(value || "").matchAll(/\b(HN|HCN|CONF)[\s_-]*(\d{2,})\b/gi)]
        .map(match => `${match[1].toUpperCase()}-${match[2].padStart(4, "0")}`);
    return unique(matches);
}

function buildConversationMemory(history, context, classifyQuestion, currentQuestion = "") {
    if (!context?.usesContext || !context.relevantUserTurns?.length) return { fields: {}, promptText: "", retrievalText: currentQuestion };
    const userTurns = context.relevantUserTurns;
    const sourceText = [...userTurns, currentQuestion].filter(Boolean).join("\n");
    const normalized = normalizeText(sourceText);
    const lastTurn = userTurns.at(-1) || "";
    const meaningfulPrior = [...userTurns].reverse().find(text => {
        const classification = classifyQuestion(text);
        return classification.isInScope || intentFamily(classification.intent) !== "out_of_scope";
    }) || lastTurn;
    const topic = INTENT_LABELS[intentFamily(classifyQuestion(meaningfulPrior).intent)] || "cuộc trao đổi trước";
    const ageFacts = unique([...normalized.matchAll(/(?:tu\s+)?\d{1,3}\s*(?:tuoi|nam tuoi)|tu\s+\d{1,3}\s+den\s+duoi\s+\d{1,3}\s+tuoi/gu)].map(match => match[0]));
    const conferenceCodes = unique([
        ...conferenceCodeFromText(sourceText),
        context.conferenceReferenceCode
    ]);
    const timeFacts = unique([...normalized.matchAll(/\b(?:thang\s+(?:0?[1-9]|1[0-2])(?:\s*\/\s*20\d{2})?|(?:0?[1-9]|1[0-2])\s*\/\s*20\d{2}|quy\s+(?:[1-4]|i{1,3}|iv)(?:\s*\/\s*20\d{2})?|nam\s+20\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]20\d{2})?|\d{1,3}\s+ngay\s+(?:toi|sap toi|qua)|tuan sau|thang nay|thang toi)\b/gu)].map(match => match[0]));
    const locations = unique([...sourceText.matchAll(/(?:xã|phường|UBND\s+xã|UBND\s+phường)\s+([^,.;!?\n]+)/giu)]
        .map(match => match[1].trim().replace(/^(?:về|tại|trong|để|của|cho|với|nếu|và)\s+/iu, "").replace(/\s+(?:về|tại|trong|để|của|cho|với|nếu|và)\b.*$/iu, "").trim())
        .filter(value => value.length >= 3));
    const audiences = unique(["cán bộ", "người dân", "trẻ em", "người cao tuổi", "người khuyết tật", "người nghèo", "cán bộ làm công tác xã hội", "trợ giúp viên pháp lý"]
        .filter(term => normalized.includes(normalizeText(term))));
    const topicTerms = ["Luật Trợ giúp pháp lý", "đất đai và bồi thường", "thừa kế và tranh chấp dân sự", "hộ tịch và cư trú", "tiếp cận trợ giúp pháp lý trong tố tụng"];
    const subjectFacts = unique([
        ...["người nghèo", "hộ nghèo", "trẻ em", "người cao tuổi", "người khuyết tật", "người dân tộc thiểu số", "bị hại", "người bị buộc tội"].filter(term => normalized.includes(normalizeText(term))),
        ...topicTerms.filter(term => normalized.includes(normalizeText(term))),
        ...conferenceCodes
    ]);
    const sentenceCandidates = sourceText.split(/(?<=[.!?。])\s+|\n+/).map(text => text.trim()).filter(Boolean)
        .map(text => ({ text, score: (/(tuoi|ngheo|doi tuong|hoan canh|tinh tiet|bi |quyen loi|vu viec|dieu |luat |thoi gian|ngay |thang |hoi nghi)/.test(normalizeText(text)) ? 2 : 0) + (/[0-9]/.test(text) ? 1 : 0) }))
        .filter(item => item.score > 0 && item.text.length <= 600)
        .sort((a, b) => b.score - a.score);
    const circumstances = [];
    let sentenceBudget = 0;
    for (const item of sentenceCandidates) {
        if (circumstances.length >= 3 || sentenceBudget + item.text.length > 900) continue;
        if (circumstances.includes(item.text)) continue;
        circumstances.push(item.text);
        sentenceBudget += item.text.length;
    }
    const fields = {
        topic,
        subjects: subjectFacts,
        audience: audiences,
        locations,
        age: ageFacts,
        circumstances,
        time: timeFacts,
        conferenceCodes,
        unresolvedQuestion: context.unresolvedSlots
    };
    const entries = [
        `Chủ đề trước: ${topic}`,
        fields.subjects.length ? `Chủ đề/đối tượng/mã được người dùng nêu: ${fields.subjects.join(", ")}` : "",
        fields.audience.length ? `Nhóm tham dự người dùng nêu: ${fields.audience.join(", ")}` : "",
        fields.locations.length ? `Địa bàn/đơn vị người dùng nêu: ${fields.locations.join(", ")}` : "",
        fields.age.length ? `Tuổi được người dùng nêu: ${fields.age.join(", ")}` : "",
        fields.time.length ? `Mốc thời gian người dùng nêu: ${fields.time.join(", ")}` : "",
        fields.conferenceCodes.length ? `Mã hội nghị người dùng nêu: ${fields.conferenceCodes.join(", ")}` : "",
        fields.circumstances.length ? `Tình tiết người dùng cung cấp: ${fields.circumstances.join(" | ")}` : "",
        fields.unresolvedQuestion.length ? `Thông tin còn cần làm rõ: ${fields.unresolvedQuestion.join(", ")}` : ""
    ].filter(Boolean);
    const promptText = `BỘ NHỚ HỘI THOẠI — dữ kiện dưới đây do người dùng cung cấp, chưa được xác minh:\n${entries.map(entry => `- ${entry}`).join("\n")}\nChỉ dùng để hiểu câu hỏi nối tiếp; không dùng làm căn cứ pháp luật hoặc số liệu đã xác minh. Căn cứ xác minh phải lấy từ dữ liệu DB/RAG của yêu cầu hiện tại. Câu trả lời cũ của trợ lý không phải nguồn dữ liệu.`;
    const retrievalText = [...fields.subjects, ...fields.audience, ...fields.locations, ...fields.age, ...fields.time, ...fields.circumstances, ...userTurns.slice(-2), currentQuestion].filter(Boolean).join(" ");
    return { fields, promptText, retrievalText };
}

module.exports = { normalizeText, normalizeConversationHistory, intentFamily, clarificationSlots, hasExplicitReference, conferenceCodeFromText, resolveConversationContext, buildConversationMemory };
