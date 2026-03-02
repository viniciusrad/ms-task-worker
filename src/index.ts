import amqp from 'amqplib';
import 'dotenv/config';
import { getServiceRoleClient } from './lib/supabase';
import { dynamicAnalysis } from './functions/dynamicAnalysis';
import { getQuestionsFromTopics } from './functions/getQuestionsFromTopics';
import { generateFlashcards } from './functions/generateFlashcards';
import { saveQuizQuestions } from './functions/saveQuizQuestions';
import { setJobStatus } from './lib/job-status';
import { addReward } from './lib/rewards';

// The Queue Name that Ana is pushing tasks into
const RABBITMQ_QUEUE = process.env.RABBITMQ_QUEUE || 'notebook-analysis';
const QUIZ_QUEUE_NAME = process.env.QUIZ_QUEUE_NAME || 'ana.quiz-worker';

async function startWorker() {
  const rabbitUrl = process.env.RABBITMQ_URL;
  if (!rabbitUrl) {
    console.error("RABBITMQ_URL must be provided in .env");
    process.exit(1);
  }

  // To avoid timeouts on long inferences, we append heartbeat parameters if not present
  const connectUrl = rabbitUrl.includes('heartbeat') 
    ? rabbitUrl 
    : `${rabbitUrl}${rabbitUrl.includes('?') ? '&' : '?'}heartbeat=120`;

  let connection;
  try {
    console.log(`[Worker] Connecting to RabbitMQ at ${connectUrl}...`);
    connection = await amqp.connect(connectUrl);
    console.log("[Worker] Successfully connected to RabbitMQ!");
  } catch (error) {
    console.error("[Worker] Failed to connect to RabbitMQ. Exiting.", error);
    process.exit(1);
  }

  // Test Supabase Connection
  try {
    console.log(`[Worker] Testing Supabase Connection...`);
    const supabase = getServiceRoleClient();
    // A simple fast query just to verify the URL and KEY are valid
    const { error: sbError } = await supabase.from('note').select('id').limit(1);
    if (sbError) throw sbError;
    console.log("[Worker] Successfully connected to Supabase!");
  } catch (error) {
    console.error("[Worker] Failed to connect to Supabase. Please check your credentials.", error);
    process.exit(1);
  }

  // CHANNEL 1: Notebook Analysis
  const analysisChannel = await connection.createChannel();
  await analysisChannel.assertQueue(RABBITMQ_QUEUE, { durable: true });
  
  const analysisConcurrency = parseInt(process.env.CONCURRENCY || '1', 10);
  analysisChannel.prefetch(analysisConcurrency);

  console.log(`[Worker] Waiting for messages in queue: ${RABBITMQ_QUEUE}. Concurrency: ${analysisConcurrency}`);

  analysisChannel.consume(RABBITMQ_QUEUE, async (msg) => {
    if (msg !== null) {
      console.log(`\n[Worker] ---------------------------------------------`);
      console.log(`[Analysis Queue] Received new job!`);
      const payload = JSON.parse(msg.content.toString());

      if (payload.type === 'generate-quiz' || payload.type === 'generate-flashcards') {
        console.log(`[Analysis Queue] Ignorando task do tipo '${payload.type}' pois ela será processada pela fila dedicada ana.quiz-worker.`);
        analysisChannel.ack(msg); // Remove da fila principal sem processar duplo
        return;
      }

      try {
        console.log(`[Analysis Queue] Job Data: NoteId=${payload.noteId}, UserId=${payload.userId}`);
        const supabase = getServiceRoleClient();
        
        await supabase
          .from('note')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', payload.noteId);

        console.log(`[Analysis Queue] Executing LLM Analysis... this may take a while.`);
        const analysisResult = await dynamicAnalysis(
          payload.imageUrl, 
          'analisar', 
          'pt-BR', 
          payload.userId
        );

        console.log(`[Analysis Queue] LLM Analysis Complete. Saving to Supabase...`);

        const { error: dbError } = await supabase
          .from('note')
          .update({
            assunto: analysisResult.assunto || 'Sem Título',
            descricao_curta: analysisResult.descricao || null,
            data_json: analysisResult,
            status: 'ok',
            updated_at: new Date().toISOString()
          })
          .eq('id', payload.noteId);

        if (dbError) throw new Error(`DB Execution Error: ${dbError.message}`);

        console.log(`[Analysis Queue] Job Fully Completed (Note: ${payload.noteId}). Acking message.`);
        analysisChannel.ack(msg); 

      } catch (error) {
        console.error(`[Analysis Queue] Job FAILED:`, error);
        analysisChannel.nack(msg, false, true); 
        
        try {
           const supabase = getServiceRoleClient();
           await supabase
            .from('note')
            .update({ status: 'error', updated_at: new Date().toISOString() })
            .eq('id', payload?.noteId);
        } catch(e) { /* ignore secondary error */ }
      }
    }
  });


  // CHANNEL 2: Quiz worker
  const quizChannel = await connection.createChannel();
  await quizChannel.assertQueue(QUIZ_QUEUE_NAME, { 
    durable: true,
    deadLetterExchange: 'ana.dlx'
  });
  
  const quizConcurrency = parseInt(process.env.QUIZ_PREFETCH || '3', 10);
  quizChannel.prefetch(quizConcurrency);

  console.log(`[Worker] Waiting for messages in queue: ${QUIZ_QUEUE_NAME}. Concurrency: ${quizConcurrency}`);

  quizChannel.consume(QUIZ_QUEUE_NAME, async (msg) => {
    if (msg !== null) {
      console.log(`\n[Worker] ---------------------------------------------`);
      console.log(`[Quiz Queue] Received new job!`);
      const payload = JSON.parse(msg.content.toString());

      try {
        await processQuizTask(payload);
        console.log(`[Quiz Queue] Job Fully Completed (Type: ${payload.type}, ID: ${payload.jobId}). Acking message.`);
        quizChannel.ack(msg); 
      } catch (error) {
        console.error(`[Quiz Queue] Job FAILED:`, error);
        quizChannel.nack(msg, false, false); // No requeue on critical failure, let DLQ or Ana's retry mechanism handle it by reading job-status
      }
    }
  });
}

// -------------------------------------------------------------
// Helper to process quiz payloads
// -------------------------------------------------------------
async function processQuizTask(task: Record<string, unknown>) {
    let jobId = task.jobId as string || 'unknown';
    const { type, payload, userId } = task as { type: string; payload: Record<string, unknown>; userId: string };

    // Update status to processing (Supabase)
    if (jobId && jobId !== 'unknown') {
        await setJobStatus(jobId, { status: 'processing' });
    }

    try {
        if (type === 'generate-quiz') {
            const { topics, locale, analyzedImageId, quizId: existingQuizId } = payload as Record<string, unknown>;
            
            // 1. Gerar Questões (GPT)
            const questions = await getQuestionsFromTopics(topics as any[], locale as 'pt-BR' | 'en-US');

            // 2. Client Supabase Service Role
            const supabaseService = getServiceRoleClient()

            // 3. Preparar dados para salvar
            const quizData = {
                title: `Quiz - ${(topics as Array<{title: string}>).map((t) => t.title).join(', ')}`,
                description: `Quiz gerado automaticamente sobre ${(topics as Array<{category: string}>).map((t) => t.category).join(', ')}`,
                userId: userId,
                analyzedImageId: analyzedImageId as string | null,
                questions: (questions as Array<Record<string, unknown>>).map((q, index: number) => ({
                    id: `${index + 1}`,
                    topic: q.topic as string,
                    subtopic: q.category as string,
                    question: q.question as string,
                    options: q.options as string[],
                    correctAnswer: q.correctAnswer as number,
                    explanation: q.explanation as string
                }))
            };

            // 4. Salvar no Banco
            const saveResult = await saveQuizQuestions(quizData as Parameters<typeof saveQuizQuestions>[0], supabaseService, existingQuizId as string | undefined);

            // 5. Recompensas
            await addReward(userId, 'analyze_image', supabaseService);

            // 6. Update Status (Supabase)
            const resultData = {
                success: true,
                questions,
                quizId: saveResult.quizId,
                message: 'Quiz criado e salvo com sucesso'
            };

            await setJobStatus(jobId, { 
                status: 'completed', 
                result: resultData
            });

        } else if (type === 'generate-flashcards') {
            const { topics, count, locale, flashcardId } = payload as Record<string, unknown>;

            // 1. Gerar Flashcards (GPT)
            const flashcards = await generateFlashcards(topics as string[], count as number, locale as 'pt-BR' | 'en-US');

            // 2. Atualizar registro no Banco
            const supabaseService = getServiceRoleClient()

            if (flashcardId) {
                const { error: updateError } = await supabaseService
                    .from('flashcards')
                    .update({
                        flashcard_body: flashcards, 
                    })
                    .eq('id', flashcardId);
                
                if (updateError) {
                    throw new Error(`Failed to update flashcards record: ${updateError.message}`);
                }
            } else {
                console.warn("[Quiz Queue] ⚠️ No flashcardId provided, skipping DB update.");
            }

            // 3. Update Status (Supabase)
            await setJobStatus(jobId, { 
                status: 'completed', 
                result: { flashcards }
            });
            
            // 4. Recompensas
            await addReward(userId, 'view_flashcards', supabaseService);

        } else {
            console.warn(`[Quiz Queue] ⚠️ Unknown task type: ${type}`);
            throw new Error(`Unknown task type: ${type}`);
        }

    } catch (err) {
        console.error("             ❌ Erro Task:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        // Update status to failed (Supabase)
        if (jobId && jobId !== 'unknown') {
            await setJobStatus(jobId, { 
                status: 'failed', 
                error: errorMessage
            });
        }
        
        throw err; // bubble up so channel can nack
    }
}

startWorker().catch(e => console.error("Fatal Worker Error:", e));
