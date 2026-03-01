"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicAnalysis = dynamicAnalysis;
const prompts_1 = require("./prompts");
const supabase_1 = require("../lib/supabase");
const llm_config_1 = require("../lib/llm-config");
const client = (0, llm_config_1.getLLMClient)();
const schema = {
    name: "CadernoDeEstudos",
    strict: true,
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["transcricao_preliminar", "inference_porcentage", "error_margin", "materia", "assunto", "descricao", "conteudo", "exercicios", "explicacao"],
        properties: {
            transcricao_preliminar: { type: "string" },
            inference_porcentage: { type: "number" },
            error_margin: { type: "number" },
            materia: { type: "string" },
            assunto: { type: "string" },
            descricao: { type: "string" },
            conteudo: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["subtopico", "descricao", "icone"],
                    properties: {
                        subtopico: { type: "string" },
                        descricao: { type: "string" },
                        icone: { type: ["string", "null"] },
                    }
                }
            },
            explicacao: { type: "string" },
            exercicios: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["descricao", "exercicio", "questao", "pontos", "resposta"],
                    properties: {
                        exercicio: { type: "string" },
                        descricao: { type: "string" },
                        questao: { type: "number" },
                        pontos: { type: "number" },
                        resposta: { type: "string" }
                    }
                }
            }
        }
    }
};
const promptMap = {
    analisar: 'dynamicAnalysis.analisar',
};
// Simplified version for the worker. Doesn't need to rebuild all context, 
// just needs to execute what was scheduled in the queue.
async function dynamicAnalysis(imageUrlOrBase64, mode, locale = 'pt-BR', userId) {
    try {
        console.log(`[Worker - DynamicAnalysis] Starting analysis. Mode: ${mode}, Locale: ${locale}`);
        let userProfile = null;
        if (userId) {
            try {
                const supabase = (0, supabase_1.getServiceRoleClient)();
                const { data: profileData } = await supabase
                    .from('user_profile')
                    .select('neurodivergence_types, neurodivergence_notes, learning_style, content_preferences, attention_preferences, accessibility_needs, birth_date, grade')
                    .eq('id', userId)
                    .limit(1);
                if (profileData && profileData.length > 0) {
                    userProfile = profileData[0];
                }
            }
            catch (err) {
                console.warn('Could not fetch user profile details in worker.');
            }
        }
        const promptKey = promptMap[mode] || 'dynamicAnalysis.analisar';
        const instruction = (0, prompts_1.getPrompt)(promptKey, locale);
        let systemMessage = (0, prompts_1.getPrompt)('dynamicAnalysis.system', locale);
        const restrictionsPT = `
## ÍCONES - REGRAS OBRIGATÓRIAS
Cada item de "conteudo" DEVE ter um campo "icone" com o nome de um ícone Lucide React RELEVANTE ao subtópico.
NÃO repita o mesmo ícone para todos os subtópicos. Escolha um ícone que represente visualmente o tema.

## REGRAS FINAIS
1. Texto normal → SEM cifrões
2. Variáveis/expressões → COM cifrões
3. Comandos LaTeX → SEMPRE \\\\comando (dupla barra no JSON)
4. Verifique: todos os \\\\log, \\\\frac, \\\\cdot, \\\\sqrt têm barras duplas?
5. IMPORTANTE: O schema JSON é strict. Coloque TODA a explicação teórica e exemplos de cada tópico ÚNICA E EXCLUSIVAMENTE dentro do campo "descricao" do "conteudo".
6. TRANSCRIÇÃO PRELIMINAR: É estritamente obrigatório preencher \`transcricao_preliminar\` com tudo o que você pode ler na imagem, ANTES de estruturar o conteúdo.
7. MÉTRICAS: Avalie \`inference_porcentage\` (0-100) sobre o quanto da imagem você interpretou, e \`error_margin\` (0-100) estimado.
    `;
        const restrictionsEN = `
ICONS - MANDATORY RULES:
Each "conteudo" item MUST have an "icone" field with a Lucide React icon name RELEVANT to that specific subtopic.
DO NOT repeat the same icon for all subtopics.
    `;
        const restrictions = locale === 'en-US' ? restrictionsEN : restrictionsPT;
        const languageEnforcement = locale === 'en-US'
            ? `\n\n⚠️ CRITICAL - RESPONSE LANGUAGE: Your ENTIRE JSON response MUST be in US ENGLISH.`
            : `\n\n⚠️ CRÍTICO - IDIOMA DA RESPOSTA: TODA a sua resposta JSON DEVE estar em PORTUGUÊS BRASILEIRO.`;
        // No worker testaremos com gpt-5-mini
        const baseModel = "gpt-5-mini";
        const selectedModel = (0, llm_config_1.getModelName)(baseModel);
        const systemPrompt = systemMessage + languageEnforcement;
        const userText = `${instruction}\n${restrictions}${languageEnforcement}`;
        console.log(`[Worker] Preparing to call OpenAI with model ${selectedModel} (from ${baseModel})...`);
        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: [
                    { type: "text", text: userText },
                    { type: "image_url", image_url: { url: imageUrlOrBase64, detail: "low" } }
                ]
            }
        ];
        let res;
        if (llm_config_1.LLM_PROVIDER === 'groq') {
            const groqClient = client;
            res = await groqClient.chat.completions.create({
                model: selectedModel,
                temperature: 1,
                max_completion_tokens: 8192,
                messages,
                response_format: (0, llm_config_1.getResponseFormat)()
            });
        }
        else {
            const openaiClient = client;
            res = await openaiClient.chat.completions.create({
                model: selectedModel,
                temperature: 1,
                max_completion_tokens: 16384,
                messages,
                response_format: (0, llm_config_1.getResponseFormat)(schema)
            });
        }
        const usage = res.usage;
        if (usage) {
            console.log(`[Worker] Token Usage: Prompt=${usage.prompt_tokens}, Completion=${usage.completion_tokens}, Total=${usage.total_tokens}`);
        }
        const jsonText = res.choices[0]?.message?.content || "";
        const cleanContent = jsonText.replace(/```json\s*/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleanContent);
    }
    catch (error) {
        console.error(`[Worker] Error in dynamic analysis:`, error);
        throw error;
    }
}
