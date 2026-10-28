const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b-instruct";
// Keep report generation configurable independently from short, conversational answers.
// The embedding/retrieval model is configured in rag.service.js and is never used to generate text.
const OLLAMA_ANALYSIS_MODEL = process.env.OLLAMA_ANALYSIS_MODEL || OLLAMA_MODEL;

const MODES = Object.freeze({
    fast: { temperature: 0.15, num_ctx: 3072, num_predict: 96, think: false, timeoutMs: 35000 },
    legal_rag: { temperature: 0.1, num_ctx: 3072, num_predict: 112, think: false, timeoutMs: 35000 },
    deep_analysis: { temperature: 0.1, num_ctx: 3072, num_predict: 192, think: false, timeoutMs: 40000 }
});

function buildRequest(messages, options = {}, stream = false) {
    const mode = MODES[options.mode] ? options.mode : "fast";
    const config = MODES[mode];
    const timeout = AbortSignal.timeout(options.timeoutMs || config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return {
        url: OLLAMA_URL + "/api/chat",
        signal,
        body: {
            model: options.model || OLLAMA_MODEL,
            messages,
            stream,
            think: config.think,
            keep_alive: options.keepAlive || "30m",
            options: {
                temperature: options.temperature ?? config.temperature,
                num_ctx: options.num_ctx || config.num_ctx,
                num_predict: options.num_predict || config.num_predict
            }
        }
    };
}

async function postChat(messages, options = {}, stream = false) {
    const request = buildRequest(messages, options, stream);
    const response = await fetch(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify(request.body)
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error("Ollama HTTP " + response.status + (detail ? ": " + detail : ""));
    }
    return response;
}

async function chatWithOllama(messages, options = {}) {
    const response = await postChat(messages, options, false);
    const data = await response.json();
    return data?.message?.content || "";
}

async function streamChatWithOllama(messages, options = {}) {
    return postChat(messages, options, true);
}

async function checkOllama() {
    const response = await fetch(OLLAMA_URL + "/api/tags", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Ollama HTTP " + response.status);
    return response.json();
}

module.exports = { MODES, OLLAMA_ANALYSIS_MODEL, chatWithOllama, streamChatWithOllama, checkOllama };
