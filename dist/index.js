"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const amqplib_1 = __importDefault(require("amqplib"));
require("dotenv/config");
const supabase_1 = require("./lib/supabase");
const dynamicAnalysis_1 = require("./functions/dynamicAnalysis");
// The Queue Name that Ana is pushing tasks into
const RABBITMQ_QUEUE = process.env.RABBITMQ_QUEUE || 'notebook-analysis';
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
        connection = await amqplib_1.default.connect(connectUrl);
        console.log("[Worker] Successfully connected to RabbitMQ!");
    }
    catch (error) {
        console.error("[Worker] Failed to connect to RabbitMQ. Exiting.", error);
        process.exit(1);
    }
    // Test Supabase Connection
    try {
        console.log(`[Worker] Testing Supabase Connection...`);
        const supabase = (0, supabase_1.getServiceRoleClient)();
        // A simple fast query just to verify the URL and KEY are valid
        const { error: sbError } = await supabase.from('note').select('id').limit(1);
        if (sbError)
            throw sbError;
        console.log("[Worker] Successfully connected to Supabase!");
    }
    catch (error) {
        console.error("[Worker] Failed to connect to Supabase. Please check your credentials.", error);
        process.exit(1);
    }
    const channel = await connection.createChannel();
    // Assert queue to ensure it exists
    await channel.assertQueue(RABBITMQ_QUEUE, {
        durable: true // We want persistent jobs
    });
    const concurrency = parseInt(process.env.CONCURRENCY || '1', 10);
    // Tell RabbitMQ not to give more than X messages at a time to this worker
    channel.prefetch(concurrency);
    console.log(`[Worker] Waiting for messages in queue: ${RABBITMQ_QUEUE}. Concurrency: ${concurrency}`);
    channel.consume(RABBITMQ_QUEUE, async (msg) => {
        if (msg !== null) {
            console.log(`\n[Worker] ---------------------------------------------`);
            console.log(`[Worker] Received new job from queue!`);
            const payload = JSON.parse(msg.content.toString());
            try {
                console.log(`[Worker] Job Data: NoteId=${payload.noteId}, UserId=${payload.userId}`);
                const supabase = (0, supabase_1.getServiceRoleClient)();
                // Ensure note status is 'processing'
                // If not, it means the job has been pulled before and failed perhaps? We update just in case.
                await supabase
                    .from('note')
                    .update({ status: 'processing', updated_at: new Date().toISOString() })
                    .eq('id', payload.noteId);
                console.log(`[Worker] Executing LLM Analysis... this may take a while.`);
                // Run AI Analysis - NOTE: This blocks the current async thread, meaning heartbeat must be native to the amqplib socket (which it is)
                const analysisResult = await (0, dynamicAnalysis_1.dynamicAnalysis)(payload.imageUrl, 'analisar', 'pt-BR', payload.userId);
                console.log(`[Worker] LLM Analysis Complete. Saving to Supabase...`);
                // Save Analysis to DB
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
                if (dbError) {
                    throw new Error(`DB Execution Error: ${dbError.message}`);
                }
                console.log(`[Worker] Job Fully Completed (Note: ${payload.noteId}). Acking message.`);
                channel.ack(msg); // Remove from queue
            }
            catch (error) {
                console.error(`[Worker] Job FAILED:`, error);
                // Wait, what to do if it fails?
                // We reject the message so it goes back to queue or dead-letter-exchange. 
                // We set second param (requeue) to false if we don't want infinite loops on poison messages.
                // For now, let's requeue so ana's internal logic handles retry counts if implemented.
                channel.nack(msg, false, true);
                // Also try to update status in DB to error so user knows
                try {
                    const supabase = (0, supabase_1.getServiceRoleClient)();
                    await supabase
                        .from('note')
                        .update({ status: 'error', updated_at: new Date().toISOString() })
                        .eq('id', payload?.noteId);
                }
                catch (e) { /* ignore secondary error */ }
            }
        }
    });
}
startWorker().catch(e => console.error("Fatal Worker Error:", e));
