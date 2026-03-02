import { getPrompt } from "./prompts/index";

export interface StudyTopic {
  title: string;
  category: string;
  subcategory?: string;
  keyPoints?: string[];
  [key: string]: any;
}

// Schema para estruturar a resposta de questões (root deve ser objeto)
const questionsSchema = {
  name: "Questions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "topic", "category", "question", "options", "correctAnswer", "explanation"],
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            category: { type: "string" },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
            correctAnswer: { type: "number" },
            explanation: { type: "string" }
          }
        }
      }
    }
  }
};

export async function getQuestionsFromTopics(
  topics: StudyTopic[],
  locale: 'pt-BR' | 'en-US' = 'pt-BR'
) {
    // Validar e processar topics
    if (!topics || topics.length === 0) {
        throw new Error("Nenhum tópico fornecido para gerar questões");
    }

    // Corrigir o problema com subcategory undefined
    const topicsString = topics.map((topic) => topic.subcategory || topic.title || "Geral").join(", ")
    const categoryString = topics.map((topic) => topic.category || "Geral").join(", ")

    // Truncar keyPoints para evitar prompts muito grandes
    const keyPointsString = topics
        .map(topic => topic.keyPoints || [])
        .flat()
        .filter(kp => kp && kp.trim().length > 0)
        .slice(0, 10) // Limitar a 10 key points para reduzir tokens
        .join(", ") || topicsString

    const systemPrompt = getPrompt('getQuestionsFromTopics.system', locale, {
      keyPointsString,
      categoryString,
      topicsString
    });
    
    const body = {
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_completion_tokens: 1200,
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: locale === 'en-US' 
                  ? "Return only the requested JSON, without additional text or explanations."
                  : "Retorne apenas o JSON solicitado, sem texto adicional ou explicações."
            },
        ],
        response_format: { type: "json_schema", json_schema: questionsSchema }
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

    // Verificar se a resposta da API foi bem-sucedida
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
            `OpenAI API error: ${res.status} ${res.statusText} — ${JSON.stringify(errorData)}`
        );
    }

    // Parseia a resposta e extrai o conteúdo JSON do assistant
    const data = (await res.json()) as any;
    
    // Log de uso de tokens para observabilidade
    const usage = data.usage;
    if (usage) {
      console.log(JSON.stringify({
        event: "openai_usage",
        function: "getQuestionsFromTopics",
        topicsCount: topics.length,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUSD: (usage.prompt_tokens * 0.00015 + usage.completion_tokens * 0.0006) / 1000
      }));
    }
    
    const assistantContent = data.choices?.[0]?.message?.content;
    if (typeof assistantContent !== "string") {
        console.error("Resposta inesperada da API:", assistantContent);
        throw new Error("Resposta inesperada da API: content não é string");
    }

    // Remove blocos de crase e prefixos tipo ```json
    const cleanContent = assistantContent
      .replace(/```json\s*/g, "")
      .replace(/```/g, "")
      .trim();

    try {
      let parsed = JSON.parse(cleanContent);
      console.log(`[getQuestionsFromTopics] Successfully parsed JSON string. Type: ${typeof parsed}, IsArray: ${Array.isArray(parsed)}`);
      
      // Extract array of questions depending on how OpenAI formatted the response
      let result = parsed;
      if (parsed.questions && Array.isArray(parsed.questions)) {
          console.log(`[getQuestionsFromTopics] Extracted questions from parsed.questions wrapper.`);
          result = parsed.questions;
      }
      
      if (!Array.isArray(result)) {
        console.error(`[getQuestionsFromTopics] Final result is NOT an array. Result structure:`, JSON.stringify(result).substring(0, 200));
        throw new Error("Resposta da API não é um array de questões");
      }
      
      if (result.length === 0) {
        throw new Error("Nenhuma questão foi gerada");
      }
      
      console.log(`[getQuestionsFromTopics] Returning ${result.length} questions from LLM.`);
      return result;
    } catch (finalError) {
      console.error("Erro ao processar JSON:", finalError);
      console.error("Conteúdo original:", cleanContent.substring(0, 500));
      throw new Error(`Falha ao processar resposta da API. Por favor, tente novamente.`);
    }
}
