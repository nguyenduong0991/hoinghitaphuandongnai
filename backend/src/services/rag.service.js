const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const LEGAL_AID_KB_PATH = path.resolve(__dirname, "../../TGPL_Ollama_AI_V1/knowledge/legal_aid_act_11_2017.json");
let knowledgeCache;
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "bge-m3";
const EMBEDDING_INDEX_PATH = process.env.OLLAMA_RAG_CACHE_PATH ||
    path.join(os.tmpdir(), "tgpl-hybrid-rag", "index-bge-m3.json");
const embeddingCache = new Map();
let embeddingCacheLoaded = false;
let embeddingUnavailableUntil = 0;
let pendingEmbeddingIndex = null;

const STOP_WORDS = new Set((
    "va la cua cho tai duoc nhung cac nguoi mot co khong nhu nao gi khi trong voi ve den tu " +
    "toi ban minh nay do thi se can hay de theo hoac"
).split(/\s+/));

const CRIMINAL_SCOPE_MARKERS = [
    "bo luat hinh su", "luat hinh su", "phap luat hinh su", "blhs", "toi danh", "hanh vi pham toi",
    "toi gi", "pham toi khong", "co cau thanh toi", "dinh toi", "truy cuu trach nhiem hinh su",
    "muc phat", "khung hinh phat", "hinh phat", "xem xet hanh vi", "hanh vi nay", "gay roi trat tu cong cong",
    "trom cap", "cuop tai san", "lua dao chiem doat", "giet nguoi", "co y gay thuong tich", "tham o", "danh bac",
    "bi phat tu", "di tu khong", "co bi truy cuu", "xu ly hinh su", "vi pham hinh su"
];

const COMPLEX_MARKERS = [
    "phan tich", "so sanh", "danh gia", "nhieu truong hop", "quy trinh", "cac buoc",
    "ke hoach chi tiet", "tong hop", "lap luan", "anh huong", "vi du", "tinh huong", "nhieu van de"
];

const CONFERENCE_LOOKUP_MARKERS = ["hoi nghi nao", "su kien nao", "ma hoi nghi", "hoi nghi ma", "lich hoi nghi", "danh sach hoi nghi", "cac hoi nghi", "thong tin hoi nghi", "tra cuu hoi nghi", "tim hoi nghi", "bao nhieu hoi nghi", "co hoi nghi", "hoi nghi o dau", "dia diem hoi nghi", "hoi nghi cua don vi", "hoi nghi ve", "hoi nghi sap dien ra", "hoi nghi sap toi", "hoi nghi gan toi", "khi nao hoi nghi", "hoi nghi da duoc phe duyet", "hoi nghi da hoan thanh", "hoi nghi trong he thong", "hoi nghi tren trang", "don vi nao to chuc hoi nghi"];

function loadKnowledgeBase() {
    if (knowledgeCache) return knowledgeCache;
    const legalAid = JSON.parse(fs.readFileSync(LEGAL_AID_KB_PATH, "utf8"));
    if (!Array.isArray(legalAid)) throw new Error("Kho Luật Trợ giúp pháp lý phải là một mảng JSON.");
    knowledgeCache = legalAid;
    return knowledgeCache;
}

function normalize(value) {
    return String(value || "")
        .toLocaleLowerCase("vi-VN")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d");
}

function tokens(value) {
    return normalize(value)
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

function classifyQuestion(question) {
    const normalized = normalize(question);
    const terms = tokens(question);
    const explicitPlanVerbs = /(?:lap (?:vai )?(?:phuong an|ke hoach)|len (?:vai )?(?:phuong an|ke hoach)|ke hoach to chuc|de xuat (?:to chuc|hoi nghi|chu de|ke hoach)|goi y (?:phuong an|ke hoach|noi dung|nguoi nhan)|giup toi to chuc|to chuc giup toi|hay to chuc|to chuc hoi nghi|muon to chuc|muon mo buoi|mo buoi|pho bien luat|tuyen truyen phap luat|muon tap huan|tap huan.{0,35}(?:chuan bi|ho tro)|tim phuong an|chon bao cao vien|de xuat phan cong.{0,45}hoi nghi|giao nhiem vu.{0,30}giup toi|chia hoi nghi thanh.{0,50}nhiem vu|phan bo lai|ke hoach du phong|ra soat toan bo phuong an|phuong an can don vi phoi hop|don vi nao co the phoi hop|de xuat quy mo.{0,40}hoi nghi|phan bo lai.{0,50}(?:viec|nhiem vu|nhan su)|can chuan bi.{0,30}hoi nghi)/.test(normalized);
    const isConferencePlanningQuestion = explicitPlanVerbs && !/(?:khao sat|nhieu nhat|bao nhieu|duoc de xuat.{0,30}nhieu|danh gia ty le|danh gia hieu qua|danh gia muc do|phan tich|so sanh|xu huong|du bao nhu cau)/.test(normalized) && /(?:hoi nghi|tap huan|tuyen truyen|xa |phuong |don vi|buoi|phap luat|bao cao vien|nhiem vu|viec|nhan su)/.test(normalized);
    const isConferenceHistoryQuestion = /(?:hoi nghi|su kien|buoi nao|cuoc hop|cuoc hoi nghi)/.test(normalized) &&
        /(?:hoan thanh|da to chuc|du kien|se to chuc|thang\s+(?:0?[1-9]|1[0-2])|quy\s+(?:i{1,3}|iv|[1-4])|nam\s+\d{4}|dia diem|hoi truong|trang thai)/.test(normalized);
    const isAssignedConsultationQuery = /(?:toi duoc giao|yeu cau tu van.{0,35}duoc giao|phan cong cho toi)/.test(normalized) && /(?:lien he|tu van|nguoi dan|noi dung can xu ly)/.test(normalized);
    const isAssignedConsultationSummary = /(?:tong hop|bao cao|thong ke|tien do)/.test(normalized) && /(?:nhiem vu tu van|yeu cau tu van)/.test(normalized) && /(?:duoc giao cho toi|phan cong cho toi|cua toi)/.test(normalized);
    const isConsultationNoteGuidance = /(?:ghi y kien tu van|viet y kien tu van|y kien tu van the nao)/.test(normalized) && /(?:can cu|pham vi|xac minh)/.test(normalized);
    const isInsufficientBasisGuidance = /(?:chua du can cu|thieu can cu|khong du can cu)/.test(normalized) && /(?:huong dan nguoi dan|nen huong dan|noi voi nguoi dan)/.test(normalized);
    const isContactRequestStatusQuestion = /(?:da gui|gui roi|vua gui|nop(?: roi)?).{0,100}(?:tiep nhan|ghi nhan|nhan chua|da nhan|nhan duoc|lam sao biet|trang thai|kiem tra|xem yeu cau)/.test(normalized) || /(?:lam sao biet|kiem tra|xem).{0,60}(?:yeu cau|de nghi).{0,70}(?:da duoc )?(?:tiep nhan|ghi nhan|nhan chua|da nhan)/.test(normalized);
    const isContactRequestSummaryQuestion = (/(?:yeu cau|de nghi).{0,80}(?:tu van|tro giup phap ly|tgpl)|(?:tu van|tro giup phap ly|tgpl).{0,80}(?:yeu cau|gui den|cua nguoi dan)/.test(normalized)) && /(?:tong hop|thong ke|bao cao|ra soat|liet ke|bao nhieu|danh sach|thang\s+\d|quy\s+[1-4]|nam\s+20\d{2})/.test(normalized);
    const isContactReferralQuestion = !isAssignedConsultationQuery && !isConsultationNoteGuidance && !isInsufficientBasisGuidance && ((/(?:lien he|trung tam|nho trung tam)/.test(normalized) && /(?:tu van|tro giup phap ly|tgpl)/.test(normalized)) ||
        (/(?:khong quy dinh|khong tim thay can cu|khong co can cu)/.test(normalized) && /(?:lien he|tu van)/.test(normalized)) ||
        /(?:can duoc tu van|tu van ve quyen loi|bat dau tu dau|goi lai|nguoi tu van goi|chua biet co thuoc dien|khong biet co thuoc dien|khong biet co duoc tro giup phap ly)/.test(normalized) ||
        (/trinh bay/.test(normalized) && /(?:tinh huong|vu viec)/.test(normalized) && /(?:tro giup phap ly|tgpl|tu van)/.test(normalized)));
    const legalAidProcedureQuestion = /(?:nguoi yeu cau.{0,80}(?:giay to|ho so|chuan bi)|(?:giay to|ho so).{0,60}yeu cau tro giup)/.test(normalized);
    const mentionsConference = normalized.includes("hoi nghi") || normalized.includes("su kien") || normalized.includes("cuoc hop") || normalized.includes("cuoc hoi nghi") || normalized.includes("tap huan");
    const isConferenceLookupLanguage = mentionsConference && /(?:lich|danh sach|tra cuu|tim hoi nghi|liet ke|bao nhieu hoi nghi|trang thai|o dau|khi nao|ngay gio|dien ra|sap dien ra)/.test(normalized) && !/(?:luat tro giup phap ly quy dinh|dieu\s+\d+|ai duoc tro giup|thuoc doi tuong|giay to can nop)/.test(normalized);
    const isLegalAidQuestion = !isConferencePlanningQuestion && !isConferenceHistoryQuestion && !isContactReferralQuestion && !isConferenceLookupLanguage && (
        ["tro giup phap ly", "tgpl", "nguoi duoc tro giup", "luat tro giup"].some(marker => normalized.includes(marker)) || legalAidProcedureQuestion
    );
    const isExternalDataQuestion = !isLegalAidQuestion && !isContactReferralQuestion && !isConferencePlanningQuestion && /(?:du bao thoi tiet|thoi tiet|nhiet do|mua bao|bao so|ty gia|gia vang|gia xang|chung khoan|tin tuc|thoi su)/.test(normalized);
    const isLegal = isLegalAidQuestion;
    const isLegalArticleLookup = isLegalAidQuestion && /\bdieu\s+\d+[a-z]?\b/.test(normalized);
    const isLegalAidEligibility = isLegalAidQuestion &&
        ["doi tuong", "thuoc dien", "co duoc", "duoc huong", "nguoi ngheo", "ho ngheo", "ho can ngheo", "tre em", "nguoi co cong"].some(marker => normalized.includes(marker));
    const explicitlyAsksCrime = /tội|hình sự|khung hình phạt|phạm tội|bị phạt tù|đi tù|truy cứu|xử lý hình sự/i.test(String(question || "")) ||
        (String(question || "").includes("hành vi") && /vi phạm|phạm tội|bị xử lý|có bị/.test(normalized));
    const isCriminalQuestion = (explicitlyAsksCrime || CRIMINAL_SCOPE_MARKERS.some(marker => normalized.includes(marker))) &&
        !(isLegalAidQuestion && isLegalAidEligibility);
    const taskStatusOrPeriod = /\b(?:viec|dau viec)\b/.test(normalized) &&
        /(?:hoan thanh|hoan tat|chua xong|chua lam|dang thuc hien|dang xu ly|qua han|tre han|den han|sap den han|sap toi han|hom nay|ngay mai|tuan|thang|quy|nam|\b\d{1,3}\s+ngay\b)/.test(normalized);
    const genericTaskPhrase = /\bcong viec\b/.test(normalized) &&
        /(?:cua toi|duoc giao|phan cong|nhiem vu|trang thai|tien do|hoan thanh|hoan tat|chua xong|chua lam|dang thuc hien|dang xu ly|qua han|tre han|den han|sap den han|sap toi han|hom nay|ngay mai|tuan|thang|quy|nam|\b\d{1,3}\s+ngay\b)/.test(normalized);
    const isTaskQuery = taskStatusOrPeriod || genericTaskPhrase || ["nhiem vu", "phan cong", "dau viec", "viec nao", "bao cao vien", "han nop", "han hoan thanh", "den han", "qua han", "chua xong", "chua hoan thanh", "sap toi han", "sap den han", "tien do cong viec", "dinh kem tep", "tep nhiem vu"].some(marker => normalized.includes(marker));
    const hasSurveySignal = ["phieu khao sat", "khao sat", "nguoi tra loi", "nguoi tham gia", "survey"].some(marker => normalized.includes(marker)) ||
        (/(?:chat luong|phoi hop|danh gia diem|diem trung binh)/.test(normalized) && /(?:hoi nghi|nguoi tham du|nguoi tham gia)/.test(normalized));
    const isSurveyRatingQuestion = hasSurveySignal && /(?:chat luong|phoi hop|danh gia diem|diem trung binh)/.test(normalized);
    const isSurveyRankingQuestion = hasSurveySignal && (/(?:dia ban|chu de|noi dung).{0,70}(?:nhieu nhat|cao nhat|quan tam|duoc de xuat|duoc nhac nhieu)/.test(normalized) || /(?:nguoi tra loi|nguoi tham gia).{0,50}(?:quan tam|lua chon).{0,30}(?:chu de|noi dung)/.test(normalized) || /(?:chu de|noi dung).{0,80}(?:duoc )?(?:nguoi tra loi |nguoi tham gia )?(?:quan tam|lua chon|nhac nhieu|de xuat)/.test(normalized) || /(?:xep hang|top\s*\d*|so sanh so luot).{0,80}(?:chu de|noi dung|dia ban)/.test(normalized));
    const isSurveyAudienceQuestion = /(?:doi tuong|nhom doi tuong).{0,60}(?:tham du|tham gia|duoc de xuat|khao sat)|(?:tham du|tham gia).{0,50}(?:nhom doi tuong|doi tuong duoc de xuat)/.test(normalized);
    const isSurveyIssueQuestion = /(?:vuong mac|kho khan|cau hoi).{0,80}(?:phap ly|phap luat|duoc neu|khao sat|nhieu|pho bien)|(?:phap ly|phap luat).{0,70}(?:vuong mac|kho khan|duoc neu)/.test(normalized);
    const isSurveyPlanningAdviceQuestion = /khao sat.{0,100}(?:co nen|nen dua|dua vao|can dua).{0,50}(?:ke hoach|chu de)|(?:co nen|nen dua|dua vao|can dua).{0,50}(?:chu de|noi dung).{0,60}khao sat/.test(normalized);
    const isSurveyQuestion = ["phieu khao sat", "khao sat", "ket qua khao sat", "du lieu khao sat", "bao cao khao sat", "tong hop khao sat", "y kien sau hoi nghi", "danh gia sau hoi nghi", "survey", "nguoi tra loi quan tam"].some(marker => normalized.includes(marker)) || isSurveyRankingQuestion || isSurveyAudienceQuestion || isSurveyIssueQuestion || (hasSurveySignal && /hoi nghi|su kien/.test(normalized));
    const attendanceAggregate = /(?:(?:so luong|so luot|tong so|bao nhieu|tong hop|thong ke|dem|gop).{0,90}(?:nguoi|luot).{0,90}(?:dang ky|ghi ten|diem danh|tham du|co mat|thuc te)|(?:dang ky|ghi ten|diem danh|tham du|co mat|thuc te).{0,90}(?:nguoi|luot).{0,90}(?:so luong|so luot|tong so|bao nhieu|tong hop|thong ke|dem|gop)|(?:so luot|luot).{0,40}(?:dang ky|ghi ten).{0,50}(?:diem danh|co mat|tham du))/.test(normalized);
    const attendanceScope = mentionsConference || /\b(?:hn|hcn|conf)[-_ ]?\d{2,}\b/i.test(String(question || "")) || /\b(?:thang\s+(?:0?[1-9]|1[0-2])|nam\s+20\d{2}|quy\s+(?:[1-4]|i{1,3}|iv)|hom nay|tuan nay|tuan toi)\b/.test(normalized);
    const isConferenceAttendanceQuestion = attendanceAggregate && attendanceScope;
    const isConferenceAttendanceGuidanceQuestion = /phan biet/.test(normalized) && /(?:nguoi dang ky|dang ky tham du)/.test(normalized) && /(?:nguoi tham du|diem danh|thuc te)/.test(normalized);
    const isSurveyConferenceEvaluation = isSurveyQuestion && mentionsConference && /uu tien|danh gia|doi chieu|dap ung|chuyen doi|thuc hien/.test(normalized);
    // A negated verb (e.g. "không liệt kê hội nghị") is not a request for raw rows.
    const positiveLookupText = normalized.replace(/\b(?:khong|dung)\s+(?:can\s+)?(?:liet ke|tim|chon|xem|mo|doc|hien thi)\b/g, " ");
    const isSurveyLookupQuestion = isSurveyQuestion &&
        (["tim ", "chon ", "liet ke", "xem ", "mo ", "doc ", "hien thi", "cua phuong", "cua xa", "cua don vi"].some(marker => positiveLookupText.includes(marker)));
    // Survey data is a core feature: natural, short requests mentioning a survey
    // should use website data even when they do not say "summarize" explicitly.
    const isSurveySummaryQuestion = isSurveyQuestion;
    const isSystemSpecific = ["he thong", "website", "trang web", "tai khoan", "nhiem vu", "bao cao vien", "tep dinh kem", "tep hoi nghi", "dang ky hoi nghi", "tao hoi nghi", "trang danh sach", "man hinh", "nut bam", "chatbot"].some(marker => normalized.includes(marker));
    const asksHowTo = ["cach ", "huong dan", "lam the nao", "toi muon", "khong the", "khong duoc", "bi loi", "o dau", "bam nut"].some(marker => normalized.includes(marker));
    const isSystemHelp = isTaskQuery || (isSystemSpecific && asksHowTo) || ["dang nhap", "quen mat khau", "doi mat khau", "su dung he thong"].some(marker => normalized.includes(marker));
    const isAiFeedbackSummaryQuestion = ["cau tra loi ai can hieu chinh", "cau tra loi bi danh dau sai", "phan hoi sai chatbot", "phan hoi chatbot sai", "cau tra loi can sua", "tong hop phan hoi ai", "tong hop cau tra loi sai", "ai feedback"].some(marker => normalized.includes(marker)) ||
        /(?:tong hop|thong ke|liet ke|ra soat).{0,70}(?:cau tra loi|phan hoi).{0,70}(?:ai|chatbot|hieu chinh|danh dau sai)/.test(normalized);
    const isConferenceReviewQuestion = (mentionsConference || /buoi nao/.test(normalized)) &&
        /ra soat|kiem tra|xem tat ca|bao gom ca|ke ca/.test(normalized);
    const isOrganizationCompletionRankingQuestion = mentionsConference &&
        /(?:don vi|dia ban|xa phuong).{0,45}(?:hoan thanh|hoan tat).{0,45}(?:nhieu hoi nghi|hoi nghi nhieu).{0,20}(?:nhat|cao nhat)?/.test(normalized) ||
        /(?:don vi|dia ban|xa phuong).{0,45}(?:nhieu hoi nghi).{0,30}(?:hoan thanh|hoan tat).{0,20}(?:nhat|cao nhat)?/.test(normalized);
    const reportActions = ["tong hop", "bao cao", "thong ke", "so lieu", "bieu do", "phan tich", "ket qua", "xep hang", "so sanh", "du bao", "xu huong", "nhieu nhat", "it nhat", "cao nhat", "thap nhat", "noi bat", "tang giam", "thuong xuyen", "bao nhieu", "don vi nao", "dia ban nao", "chu de nao", "noi dung nao", "tien do nao"];
    const asksForReport = reportActions.some(marker => normalized.includes(marker));
    const isSurveyAnalysisQuestion = isSurveyQuestion && (asksForReport || isSurveyConferenceEvaluation) && !isSurveyLookupQuestion;
    const mentionsReportPeriod = /\bthang\s+(?:0?[1-9]|1[0-2])(?:\s*(?:nam|[/.-])\s*\d{4})?\b/.test(normalized) ||
        /\bnam\s+\d{4}\b/.test(normalized) ||
        /\btu\s+(?:nam|thang|ngay)\b.{0,45}\bden\b/.test(normalized) ||
        /\b(?:quy|ky|giai doan)\s+(?:i{1,3}|iv|[1-4]|\d{4})\b/.test(normalized);
    const mentionsWebsiteData = ["trang nay", "trang web", "website", "dashboard", "analytics", "du lieu he thong", "du lieu tren web", "du lieu da gui", "du lieu nguoi dung", "bao cao co san", "phieu", "khao sat", "hoi nghi", "don vi", "dia ban", "nhiem vu", "cong viec", "tham du", "tham du vien"].some(marker => normalized.includes(marker));
    // This application is a conference and survey reporting system. Natural requests
    // such as "đơn vị nào nổi bật" should be treated as data questions without
    // requiring the user to say "website" or "dashboard".
    const isWebsiteReportQuestion = !isLegalAidQuestion && asksForReport && (mentionsWebsiteData || mentionsReportPeriod);
    const mentionsConferenceCode = /\b(?:hn|hcn|conf)[-_ ]?\d{2,}\b/i.test(String(question || ""));
    const hasNamedOrganization = /\b(?:xa|phuong|don vi)\s+[a-z0-9]/.test(normalized);
    const isConferenceOrganizationStatusLookup = mentionsConference && hasNamedOrganization &&
        /(?:trang thai|tinh trang|phe duyet|dang o trang thai)/.test(normalized);
    const isConferenceOrganizationSummaryQuestion = mentionsConference && hasNamedOrganization &&
        (asksForReport || isConferenceOrganizationStatusLookup || /ket qua.{0,40}(?:dang ky|hoi nghi)|(?:dang ky|hoi nghi).{0,40}ket qua/.test(normalized));
    const isConferenceLargestExpectedQuestion = mentionsConference &&
        /(?:dong nhat|nhieu nhat|cao nhat|lon nhat)/.test(normalized) &&
        /(?:so nguoi|quy mo|tham du|du kien|nguoi du)/.test(normalized);
    const asksTopicFrequency = ["nhieu", "pho bien", "thuong xuyen", "de xuat", "tan suat", "noi bat", "nao duoc to chuc"].some(marker => normalized.includes(marker));
    const mentionsConferenceContent = ["noi dung hoi nghi", "chu de hoi nghi", "noi dung duoc de xuat", "chu de duoc de xuat", "noi dung nao", "chu de nao"].some(marker => normalized.includes(marker));
    const isConferenceTopicFrequencyQuestion = !isSurveyQuestion && asksTopicFrequency && mentionsConferenceContent &&
        (mentionsConference || isWebsiteReportQuestion);
    const isConferenceRegistrationHelp = mentionsConference && ["huong dan dang ky", "cach dang ky", "dang ky hoi nghi tai", "tao yeu cau dang ky"].some(marker => normalized.includes(marker));
    const conferenceAnalysisActions = ["phan tich", "so sanh", "danh gia hieu qua", "danh gia muc do", "xu huong", "du bao nhu cau", "nhieu nhat", "it nhat", "cao nhat", "thap nhat", "noi bat", "thuong xuyen", "tan suat"].some(marker => normalized.includes(marker));
    const isConferenceAnalysisQuestion = !isExternalDataQuestion && !isConferenceAttendanceQuestion && (isOrganizationCompletionRankingQuestion || (isConferenceOrganizationSummaryQuestion && !isConferenceOrganizationStatusLookup) || isConferenceLargestExpectedQuestion || isConferenceTopicFrequencyQuestion || (mentionsConference && conferenceAnalysisActions) || (isWebsiteReportQuestion && !isTaskQuery && !isSurveyQuestion && conferenceAnalysisActions));
    const isConferenceDataQuestion = !isExternalDataQuestion && !isConferenceRegistrationHelp && (isConferenceAttendanceQuestion || isConferenceHistoryQuestion || isConferenceReviewQuestion || isConferenceAnalysisQuestion || isConferenceOrganizationStatusLookup || (mentionsConference && (CONFERENCE_LOOKUP_MARKERS.some(marker => normalized.includes(marker)) ||
        /hoi nghi.{0,45}(tim|tra cuu|bao nhieu|ngay|thang|nam|dia diem|dia ban|trang thai|phe duyet|hoan thanh|don vi|chu de|ma so|to chuc|o dau)/.test(normalized))) || mentionsConferenceCode);
    // Resolve overlapping keyword matches into one primary intent before retrieval.
    // This keeps a question mentioning both "nhiệm vụ" and "hội nghị" on its actual task.
    const asksConferenceActionReview = /(?:doi lich|doi ngay|doi thoi gian)/.test(normalized) &&
        /(?:phan cong lai|doi can bo|thay can bo|sap xep lai|can xu ly)/.test(normalized);
    let intent = "out_of_scope";
    if (isExternalDataQuestion) intent = "out_of_scope";
    else if (isCriminalQuestion) intent = "criminal_scope";
    else if (asksConferenceActionReview) intent = "conference_action_review";
    else if (isAiFeedbackSummaryQuestion) intent = "ai_feedback_summary";
    else if (isConferencePlanningQuestion) intent = "conference_planning";
    else if (isContactRequestStatusQuestion) intent = "contact_request_status";
    else if (isContactRequestSummaryQuestion) intent = "contact_request_summary";
    else if (isContactReferralQuestion) intent = "contact_referral";
    else if (isLegalAidQuestion) intent = "legal_aid";
    else if (isSurveyQuestion) intent = "survey";
    else if (isTaskQuery) intent = "tasks";
    else if (isConferenceRegistrationHelp) intent = "conference_registration_help";
    else if (isConferenceAttendanceQuestion) intent = "conference_attendance";
    else if (isConferenceAttendanceGuidanceQuestion) intent = "conference_attendance_guidance";
    else if (isConferenceDataQuestion) intent = isConferenceAnalysisQuestion ? "conference_analysis" : "conference_lookup";
    else if (isSystemHelp) intent = "system_help";
    const isComplex = terms.length >= 28 || COMPLEX_MARKERS.some(marker => normalized.includes(marker));
    const isInScope = !isExternalDataQuestion && !isCriminalQuestion && (isConferenceAttendanceQuestion || isConferenceAttendanceGuidanceQuestion || isLegalAidQuestion || isSystemHelp || isConferenceDataQuestion || isConferenceRegistrationHelp || isConferencePlanningQuestion || isContactRequestStatusQuestion || isContactRequestSummaryQuestion || isContactReferralQuestion || isAssignedConsultationQuery || isAssignedConsultationSummary || isConsultationNoteGuidance || isInsufficientBasisGuidance || isSurveySummaryQuestion || isAiFeedbackSummaryQuestion);
    const needsRag = isLegalAidQuestion;
    const mode = needsRag ? (isComplex ? "deep_analysis" : "legal_rag") : (isComplex ? "deep_analysis" : "fast");
    const topK = !needsRag ? 0 : isComplex ? 5 : 3;
    const intentConfidence = intent === "out_of_scope" ? 0.25 : (asksConferenceActionReview || isLegalArticleLookup || mentionsConferenceCode || isSurveyRankingQuestion ? 0.98 : 0.85);
    const conferenceCode = String(question || "").match(/\b(?:hn|hcn|conf)[-_ ]?(\d{2,})\b/i);
    const includesUnapprovedAlongsideOthers = /(?:ke ca|bao gom ca|ca nhung).{0,60}(?:chua duoc phe duyet|chua phe duyet|cho phe duyet)/.test(normalized);
    const explicitStatusRequest = /(?:trang thai|tinh trang|o trang thai|dang o trang thai)/.test(normalized) ||
        /(?:hoi nghi|buoi|su kien).{0,45}hoan thanh/.test(normalized) ||
        /(?:hoi nghi|ho so|yeu cau).{0,35}(?:cho phe duyet|chua (?:duoc )?phe duyet|da phe duyet|hoan thanh|tu choi|da huy|de xuat doi lich)/.test(normalized);
    const statusFilter = !includesUnapprovedAlongsideOthers && explicitStatusRequest && /cho phe duyet|chua duoc phe duyet|chua phe duyet/.test(normalized) ? "PENDING"
        : explicitStatusRequest && /da phe duyet/.test(normalized) ? "APPROVED"
        : explicitStatusRequest && /hoan thanh/.test(normalized) ? "COMPLETED"
        : explicitStatusRequest && /de xuat doi lich|doi lich/.test(normalized) ? "RESCHEDULED"
        : explicitStatusRequest && /tu choi/.test(normalized) ? "REJECTED"
        : explicitStatusRequest && /da huy|huy hoi nghi/.test(normalized) ? "CANCELLED" : null;
    const querySlots = { conferenceCode: conferenceCode ? `HN-${conferenceCode[1].padStart(4, "0")}` : null, status: statusFilter, mentionsReportPeriod };
    return { intent, intentConfidence, querySlots, mode, isLegal, isLegalAidQuestion, isLegalArticleLookup, isLegalAidEligibility, isCriminalQuestion, isTaskQuery, isSystemHelp, isAiFeedbackSummaryQuestion, isConferencePlanningQuestion, isContactReferralQuestion, isContactRequestStatusQuestion, isContactRequestSummaryQuestion, isAssignedConsultationQuery, isAssignedConsultationSummary, isConsultationNoteGuidance, isInsufficientBasisGuidance, isConferenceDataQuestion, isConferenceAttendanceQuestion, isConferenceAttendanceGuidanceQuestion, isExternalDataQuestion, isConferenceAnalysisQuestion, isConferenceLargestExpectedQuestion, isConferenceReviewQuestion, isConferenceOrganizationSummaryQuestion, isConferenceTopicFrequencyQuestion, isOrganizationCompletionRankingQuestion, isConferenceRegistrationHelp, isSurveySummaryQuestion, isSurveyLookupQuestion, isSurveyAnalysisQuestion, isSurveyConferenceEvaluation, isSurveyRankingQuestion, isSurveyRatingQuestion, isSurveyAudienceQuestion, isSurveyIssueQuestion, isSurveyPlanningAdviceQuestion, isWebsiteReportQuestion, mentionsReportPeriod, isInScope, isComplex, topK };
}

function retrieve(question, topK = 3, additionalRows = [], knowledgeRows = null) {
    if (!Number.isInteger(topK) || topK < 1) return [];
    const queryTokens = new Set(tokens(question));
    if (!queryTokens.size) return [];
    let corpus = Array.isArray(knowledgeRows) ? knowledgeRows : loadKnowledgeBase();
    return [...corpus, ...(Array.isArray(additionalRows) ? additionalRows : [])]
        .map(row => {
            const documentTokens = tokens((row.category || "") + " " + (row.question || "") + " " + (row.answer || "") + " " + (row.legal_basis || []).join(" ") + " " + (row.search_terms || []).join(" "));
            const documentTokenSet = new Set(documentTokens);
            const matches = [...queryTokens].filter(token => documentTokenSet.has(token)).length;
            const documentScore = matches / queryTokens.size;
            const questionTokens = new Set(tokens(row.question || ""));
            const questionMatches = [...queryTokens].filter(token => questionTokens.has(token)).length;
            const questionScore = questionMatches / queryTokens.size;
            return { ...row, score: Math.min(1, documentScore * 0.65 + questionScore * 0.35) };
        })
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function rowText(row) {
    return [row.category, row.question, ...(row.search_terms || []), row.answer,
        ...(row.legal_basis || []), row.note].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
}

function cosineSimilarity(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
    let dot = 0, leftNorm = 0, rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] * left[index];
        rightNorm += right[index] * right[index];
    }
    return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function loadPersistedEmbeddingCache() {
    if (embeddingCacheLoaded) return;
    embeddingCacheLoaded = true;
    try {
        const saved = JSON.parse(fs.readFileSync(EMBEDDING_INDEX_PATH, "utf8"));
        if (saved.model !== OLLAMA_EMBED_MODEL || !saved.embeddings || typeof saved.embeddings !== "object") return;
        for (const [key, vector] of Object.entries(saved.embeddings)) {
            if (Array.isArray(vector) && vector.length && vector.every(Number.isFinite)) embeddingCache.set(key, vector);
        }
    } catch (error) {
        if (error.code !== "ENOENT") console.warn("Hybrid RAG index cache could not be loaded:", error.message);
    }
}

function savePersistedEmbeddingCache(rows) {
    const officialKeys = rows.filter(row => /^tgpl-law-/.test(String(row.source.id || "")))
        .map(row => row.cacheKey).filter(key => embeddingCache.has(key));
    if (!officialKeys.length) return;
    try {
        fs.mkdirSync(path.dirname(EMBEDDING_INDEX_PATH), { recursive: true });
        const embeddings = Object.fromEntries(officialKeys.map(key => [key, embeddingCache.get(key)]));
        const temporaryPath = `${EMBEDDING_INDEX_PATH}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify({ model: OLLAMA_EMBED_MODEL, updatedAt: new Date().toISOString(), embeddings }), "utf8");
        fs.renameSync(temporaryPath, EMBEDDING_INDEX_PATH);
    } catch (error) {
        console.warn("Hybrid RAG index cache could not be saved:", error.message);
    }
}

async function embedTexts(inputs) {
    const response = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || 90000),
        body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: inputs, keep_alive: "30m", truncate: true })
    });
    if (!response.ok) {
        const details = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`Ollama embedding HTTP ${response.status}${details ? `: ${details}` : ""}`);
    }
    const result = await response.json();
    if (!Array.isArray(result.embeddings) || result.embeddings.length !== inputs.length ||
        result.embeddings.some(vector => !Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value)))) {
        throw new Error("Ollama trả về vector embedding không hợp lệ.");
    }
    return result.embeddings;
}

async function indexEmbeddings(rows) {
    loadPersistedEmbeddingCache();
    const pending = rows.filter(row => !embeddingCache.has(row.cacheKey));
    if (!pending.length) return;
    // Keep batches modest for laptops and avoid one large request monopolizing Ollama.
    for (let offset = 0; offset < pending.length; offset += 12) {
        const batch = pending.slice(offset, offset + 12);
        const vectors = await embedTexts(batch.map(row => row.text));
        batch.forEach((row, index) => embeddingCache.set(row.cacheKey, vectors[index]));
    }
    savePersistedEmbeddingCache(rows);
}

function keywordRank(question, rows) {
    const queryTerms = [...new Set(tokens(question))];
    const querySet = new Set(queryTerms);
    const documentFrequency = new Map();
    const rowTerms = rows.map(row => tokens(row.text));
    for (const terms of rowTerms) {
        for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
    const scored = rows.map((row, index) => {
        const frequencies = new Map();
        for (const term of rowTerms[index]) frequencies.set(term, (frequencies.get(term) || 0) + 1);
        let score = 0;
        for (const term of queryTerms) {
            const frequency = frequencies.get(term) || 0;
            if (!frequency) continue;
            const idf = Math.log(1 + (rows.length - (documentFrequency.get(term) || 0) + 0.5) /
                ((documentFrequency.get(term) || 0) + 0.5));
            score += idf * (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * rowTerms[index].length / 180));
        }
        const normalizedQuestion = normalize(question);
        const normalizedDocQuestion = normalize(`${row.category || ""} ${row.question || ""} ${(row.legal_basis || []).join(" ")}`);
        const article = normalizedQuestion.match(/\bdieu\s+(\d+[a-z]?)\b/)?.[1];
        if (article && new RegExp(`\\bdieu\\s+${article}\\b`).test(normalizedDocQuestion)) score += 8;
        if (normalizedQuestion.length >= 8 && normalizedDocQuestion.includes(normalizedQuestion)) score += 4;
        const matched = queryTerms.filter(term => querySet.has(term) && frequencies.has(term)).length;
        return { ...row.source, _keywordScore: score, _keywordCoverage: queryTerms.length ? matched / queryTerms.length : 0 };
    });
    return scored.sort((a, b) => b._keywordScore - a._keywordScore);
}

/**
 * Hybrid retrieval: BM25-style keyword search + local Ollama semantic vectors,
 * fused by reciprocal rank, then reranked for article/phrase matches and source quality.
 * When Ollama's embedding endpoint/model is unavailable, it safely falls back to keywords.
 */
async function retrieveHybrid(question, topK = 3, additionalRows = [], knowledgeRows = null) {
    if (!Number.isInteger(topK) || topK < 1) return { results: [], method: "disabled", semanticAvailable: false };
    const corpus = Array.isArray(knowledgeRows) ? knowledgeRows : loadKnowledgeBase();
    const combined = [...corpus, ...(Array.isArray(additionalRows) ? additionalRows : [])];
    let rows = combined.map((source, index) => {
        const text = rowText(source);
        const fingerprint = crypto.createHash("sha256").update(`${source.id || index}\n${text}`).digest("hex");
        return { source, text, cacheKey: `${OLLAMA_EMBED_MODEL}:${fingerprint}` };
    }).filter(row => row.text);
    // Restrict article-number queries to documents explicitly headed with that article.
    const requestedArticle = normalize(question).match(/\bdieu\s+(\d+[a-z]?)\b/)?.[1];
    if (requestedArticle) {
        const articleLabel = "dieu " + requestedArticle;
        const articleRows = rows.filter(row => {
            const heading = normalize((row.source.category || "") + " " + (row.source.question || "") + " " + (row.source.legal_basis || []).join(" "));
            const headingTokens = heading.split(/[^a-z0-9]+/).filter(Boolean);
            return headingTokens.some((token, index) => token === "dieu" && headingTokens[index + 1] === requestedArticle);
        });
        if (articleRows.length) rows = articleRows;
        else return { results: [], method: "exact_article_not_indexed", semanticAvailable: false };
    }
    if (!rows.length) return { results: [], method: "hybrid", semanticAvailable: false };
    loadPersistedEmbeddingCache();
    const lexical = keywordRank(question, rows);
    const lexicalRanks = new Map(lexical.map((row, index) => [row.id, index + 1]));
    let semantic = [];
    let semanticAvailable = false;
    if (Date.now() >= embeddingUnavailableUntil) {
        try {
            if (!embeddingCache.has(`query:${OLLAMA_EMBED_MODEL}:${normalize(question)}`)) {
                const [queryVector] = await embedTexts([question]);
                embeddingCache.set(`query:${OLLAMA_EMBED_MODEL}:${normalize(question)}`, queryVector);
            }
            const queryVector = embeddingCache.get(`query:${OLLAMA_EMBED_MODEL}:${normalize(question)}`);
            if (!pendingEmbeddingIndex) {
                pendingEmbeddingIndex = indexEmbeddings(rows).finally(() => { pendingEmbeddingIndex = null; });
            }
            await pendingEmbeddingIndex;
            // A simultaneous request may have started the shared index with a
            // different set of admin corrections; make sure this request's rows exist too.
            await indexEmbeddings(rows);
            semantic = rows.map(row => ({
                ...row.source,
                _semanticScore: cosineSimilarity(queryVector, embeddingCache.get(row.cacheKey))
            })).sort((a, b) => b._semanticScore - a._semanticScore);
            semanticAvailable = true;
        } catch (error) {
            embeddingUnavailableUntil = Date.now() + 60000;
            console.warn(`Hybrid RAG semantic search unavailable (${OLLAMA_EMBED_MODEL}); using keyword retrieval: ${error.message}`);
        }
    }
    const semanticRanks = new Map(semantic.map((row, index) => [row.id, index + 1]));
    const semanticById = new Map(semantic.map(row => [row.id, row]));
    const lexicalById = new Map(lexical.map(row => [row.id, row]));
    const maxReciprocalScore = 1 / 61;
    const fused = rows.map(({ source }) => {
        const keyRank = lexicalRanks.get(source.id);
        const semanticRank = semanticRanks.get(source.id);
        const keyScore = keyRank ? 0.48 / (60 + keyRank) : 0;
        const semanticScore = semanticRank ? 0.52 / (60 + semanticRank) : 0;
        const rerank = semanticAvailable ? (keyScore + semanticScore) / maxReciprocalScore :
            ((lexicalById.get(source.id)?._keywordScore || 0) / Math.max(1, lexical[0]?._keywordScore || 1));
        const article = normalize(question).match(/\bdieu\s+(\d+[a-z]?)\b/)?.[1];
        const docHeading = normalize(`${source.category || ""} ${source.question || ""} ${(source.legal_basis || []).join(" ")}`);
        const exactArticleBonus = article && new RegExp(`\\bdieu\\s+${article}\\b`).test(docHeading) ? 0.35 : 0;
        const qualityBonus = ["official_government_verified", "verified"].includes(source.source_status) ? 0.02 : 0;
        const finalScore = Math.min(1, rerank + exactArticleBonus + qualityBonus);
        return {
            ...source,
            score: finalScore,
            keyword_score: Number((lexicalById.get(source.id)?._keywordScore || 0).toFixed(4)),
            semantic_score: semanticAvailable ? Number((semanticById.get(source.id)?._semanticScore || 0).toFixed(4)) : null
        };
    }).filter(row => {
        if (!semanticAvailable) return (lexicalById.get(row.id)?._keywordScore || 0) > 0;
        const semanticScore = semanticById.get(row.id)?._semanticScore || 0;
        const keywordScore = lexicalById.get(row.id)?._keywordScore || 0;
        return semanticScore >= 0.28 || keywordScore > 0;
    }).sort((a, b) => b.score - a.score);
    return { results: fused.slice(0, topK), method: semanticAvailable ? "hybrid" : "keyword_fallback", semanticAvailable };
}

function buildContext(results) {
    if (!results.length) return "KHÔNG TÌM THẤY NGUỒN PHÙ HỢP TRONG KHO TRI THỨC.";
    const maxTotalChars = 4200;
    const maxAnswerChars = 950;
    let remaining = maxTotalChars;
    const blocks = [];
    for (let index = 0; index < results.length && remaining > 300; index += 1) {
        const row = results[index];
        let answer = String(row.answer || "Chưa có nội dung").trim();
        if (answer.length > maxAnswerChars) {
            const excerpt = answer.slice(0, maxAnswerChars);
            const boundaries = [...excerpt.matchAll(/(?<!\d)[.!?](?=\s)/g)].map(match => match.index);
            const boundary = boundaries.length ? Math.max(...boundaries) : -1;
            answer = boundary > maxAnswerChars * 0.5
                ? excerpt.slice(0, boundary + 1) + " [đã lược phần nguồn còn lại]."
                : "Nguồn quá dài để trích đủ câu trong giới hạn hiện tại; không sử dụng đoạn bị cắt làm căn cứ.";
        }
        const block = [
            "--- NGUỒN " + (index + 1) + " ---",
            "Chủ đề: " + (row.category || "Chưa phân loại"),
            "Câu hỏi trong kho: " + (row.question || ""),
            "Căn cứ được ghi nhận: " + ((row.legal_basis || []).join("; ") || "Chưa ghi nhận"),
            "Trạng thái nguồn: " + (row.source_status || "chưa xác minh"),
            row.effective_date ? "Hiệu lực từ: " + row.effective_date : "",
            row.source_url ? "Đường dẫn nguồn chính thức: " + row.source_url : "",
            "Nội dung: " + answer,
            row.note ? "Ghi chú: " + row.note : ""
        ].filter(Boolean).join("\n");
        if (block.length > remaining) {
            const clipped = block.slice(0, Math.max(0, remaining - 50));
            const sentenceEnds = [...clipped.matchAll(/(?<!\d)[.!?](?=\s)/g)].map(match => match.index);
            const boundary = Math.max(clipped.lastIndexOf("\n"), sentenceEnds.length ? Math.max(...sentenceEnds) : -1);
            if (boundary > 300) blocks.push(clipped.slice(0, boundary) + "\n[ngữ cảnh được giới hạn để tránh quá tải]");
            break;
        }
        blocks.push(block);
        remaining -= block.length + 2;
    }
    return blocks.join("\n\n");
}
function sourcesForResponse(rows) {
    return rows.map(row => ({
        id: row.id,
        category: row.category,
        question: row.question,
        legal_basis: row.legal_basis || [],
        score: Number(row.score.toFixed(3)),
        source_status: row.source_status || "chưa xác minh",
        source_title: row.source_title || "",
        source_url: row.source_url || "",
        effective_date: row.effective_date || null
    }));
}

module.exports = { loadKnowledgeBase, normalize, tokens, classifyQuestion, retrieve, retrieveHybrid, buildContext, sourcesForResponse };






