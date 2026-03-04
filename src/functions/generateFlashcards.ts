import { getPrompt } from "./prompts/index";

export interface Flashcard {
  question: string
  answer: string
}

const flashcardsSchema = {
  name: "Flashcards",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["flashcards"],
    properties: {
      flashcards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "answer"],
          properties: {
            question: { type: "string" },
            answer: { type: "string" }
          }
        }
      }
    }
  }
};

export async function generateFlashcards(
  topics: string[],
  count = 3,
  locale: 'pt-BR' | 'en-US' = 'pt-BR'
): Promise<Flashcard[]> {
  const systemPrompt = getPrompt('generateFlashcards.system', locale);
  
  // Build a more explicit prompt that requests count flashcards PER topic
  const topicsList = topics.map((topic, idx) => `${idx + 1}. ${topic}`).join('\n');
  const userPrompt = getPrompt('generateFlashcards.user', locale, {
    count: count.toString(),
    topics: topicsList
  });
  
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-5-nano",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    max_tokens: 2048,
    response_format: { type: "json_schema", json_schema: flashcardsSchema }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("Chave da API OpenAI não configurada")
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); 

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
      clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`OpenAI API error: ${res.status} ${res.statusText} — ${errorText.substring(0, 200)}`)
  }

  const data = await res.json() as any;
  
  // Log de uso de tokens para observabilidade
  const usage = data.usage;
  if (usage) {
    console.log(JSON.stringify({
      event: "openai_usage",
      function: "generateFlashcards",
      count,
      topicsCount: topics.length,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedCostUSD: (usage.prompt_tokens * 0.00015 + usage.completion_tokens * 0.0006) / 1000
    }));
  }
  
  const assistantContent = data.choices?.[0]?.message?.content
  if (typeof assistantContent !== "string") {
    throw new Error("Resposta inesperada da API: content não é string")
  }

  const cleanContent = assistantContent
    .replace(/```json\s*/g, "")
    .replace(/```/g, "")
    .trim()

  try {
    const parsed = JSON.parse(cleanContent);
    
    if (parsed.flashcards && Array.isArray(parsed.flashcards)) {
      return parsed.flashcards;
    }
    
    if (Array.isArray(parsed)) {
      return parsed; // Fallback caso ignore o schema (improvável com strict: true)
    }
    
    throw new Error("Formato de resposta inesperado");
  } catch (error) {
    console.error("Erro ao processar JSON no generateFlashcards:", error);
    console.error("Conteúdo gerado:", cleanContent.substring(0, 500));
    throw error;
  }
}
