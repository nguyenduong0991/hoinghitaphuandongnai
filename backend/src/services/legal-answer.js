function normalize(value) {
    return String(value || "").toLocaleLowerCase("vi-VN").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function findVerifiedLegalArticle(question, knowledgeRows) {
    const articleMatch = normalize(question).match(/\bdieu\s+(\d+[a-z]?)\b/);
    if (!articleMatch) return null;
    const article = articleMatch[1];
    const articlePattern = new RegExp(`\\bdieu\\s+${article}\\b`);
    return (knowledgeRows || [])
        .filter(row => ["official_government_verified", "verified"].includes(row.source_status) && row.source_url)
        .filter(row => articlePattern.test(normalize([row.category, row.question, ...(row.legal_basis || [])].join(" ")))
            && normalize([row.category, row.question].join(" ")).includes("luat tro giup phap ly"))
        .sort((left, right) => String(right.effective_date || "").localeCompare(String(left.effective_date || "")))[0] || null;
}

function answerFromExactLegalArticle(source, question) {
    if (!source?.answer) return "";
    const clauseMatch = normalize(question).match(/\bkhoan\s+(\d+)\b/);
    if (!clauseMatch) return String(source.answer).trim();
    const clauseNumber = clauseMatch[1];
    const clauses = String(source.answer).split(/(?=^\s*\d+\.\s)/m);
    const clause = clauses.find(item => new RegExp(`^\\s*${clauseNumber}\\.\\s`).test(item));
    return clause ? `Khoản ${clauseNumber} Điều ${normalize(question).match(/\bdieu\s+(\d+[a-z]?)\b/)?.[1] || ""}: ${clause.trim()}` : "";
}

function isLegalAidRequiredDocumentsQuestion(question) {
    const text = normalize(question);
    return /(?:giay to.{0,50}(?:yeu cau|can cung cap|nop)|can.{0,50}giay to|ho so.{0,60}yeu cau|nguoi yeu cau.{0,80}giay to)/.test(text);
}

function hasCompleteAnswerEnding(answer) {
    const text = String(answer || "").trim();
    return /[.!?…][”’"')\]]?$/.test(text);
}

module.exports = { findVerifiedLegalArticle, answerFromExactLegalArticle, isLegalAidRequiredDocumentsQuestion, hasCompleteAnswerEnding };
