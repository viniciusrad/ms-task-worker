import { OpenAI } from 'openai';
import { Groq } from 'groq-sdk';
import 'dotenv/config';

// Baseado na arquitetura da ana, mas usando variáveis do .env 
export const LLM_PROVIDER: 'openai' | 'groq' = (process.env.LLM_PROVIDER as 'openai' | 'groq') || 'openai';

interface LLMConfig {
  apiKey: string;
  provider: 'openai' | 'groq';
}

export function getLLMConfig(): LLMConfig {
  if (LLM_PROVIDER === 'groq') {
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

export function getLLMClient(): OpenAI | Groq {
  const config = getLLMConfig();
  if (!config.apiKey) {
    throw new Error(`${config.provider.toUpperCase()}_API_KEY não está configurada`);
  }
  if (config.provider === 'groq') {
    return new Groq({ apiKey: config.apiKey });
  }
  return new OpenAI({ apiKey: config.apiKey });
}

export function getModelName(openAIModel: string): string {
  if (LLM_PROVIDER === 'groq') {
    const modelMap: Record<string, string> = {
      'gpt-5-mini': 'meta-llama/llama-4-scout-17b-16e-instruct',
      'gpt-4o-mini': 'meta-llama/llama-4-scout-17b-16e-instruct',
      'gpt-4o': 'meta-llama/llama-4-scout-17b-16e-instruct',
      'gpt-5': 'meta-llama/llama-4-scout-17b-16e-instruct',
    };
    return modelMap[openAIModel] || 'meta-llama/llama-4-scout-17b-16e-instruct';
  }
  return process.env.OPENAI_MODEL || openAIModel;
}

export function getResponseFormat(schema?: any): any {
  if (LLM_PROVIDER === 'groq') return { type: 'json_object' };
  if (schema) return { type: 'json_schema', json_schema: schema };
  return { type: 'json_object' };
}
