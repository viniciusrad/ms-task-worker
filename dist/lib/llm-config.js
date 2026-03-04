"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLM_PROVIDER = void 0;
exports.getLLMConfig = getLLMConfig;
exports.getLLMClient = getLLMClient;
exports.getModelName = getModelName;
exports.getResponseFormat = getResponseFormat;
const openai_1 = require("openai");
const groq_sdk_1 = require("groq-sdk");
require("dotenv/config");
// Baseado na arquitetura da ana, mas usando variáveis do .env 
exports.LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
function getLLMConfig() {
    if (exports.LLM_PROVIDER === 'groq') {
        return {
            apiKey: process.env.GROQ_API_KEY || '',
            provider: 'groq',
        };
    }
    return {
        apiKey: process.env.OPENAI_API_KEY || '',
        provider: 'openai',
    };
}
function getLLMClient() {
    const config = getLLMConfig();
    if (!config.apiKey) {
        throw new Error(`${config.provider.toUpperCase()}_API_KEY não está configurada`);
    }
    if (config.provider === 'groq') {
        return new groq_sdk_1.Groq({ apiKey: config.apiKey });
    }
    return new openai_1.OpenAI({ apiKey: config.apiKey });
}
function getModelName(openAIModel) {
    if (exports.LLM_PROVIDER === 'groq') {
        const modelMap = {
            'gpt-5-mini': 'meta-llama/llama-4-scout-17b-16e-instruct',
            'gpt-5-nano': 'meta-llama/llama-4-scout-17b-16e-instruct',
            'gpt-5': 'meta-llama/llama-4-scout-17b-16e-instruct',
            'gpt-4o': 'meta-llama/llama-4-scout-17b-16e-instruct',
        };
        return modelMap[openAIModel] || 'meta-llama/llama-4-scout-17b-16e-instruct';
    }
    return process.env.OPENAI_MODEL || openAIModel;
}
function getResponseFormat(schema) {
    if (exports.LLM_PROVIDER === 'groq')
        return { type: 'json_object' };
    if (schema)
        return { type: 'json_schema', json_schema: schema };
    return { type: 'json_object' };
}
