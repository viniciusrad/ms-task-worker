"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setJobStatus = setJobStatus;
exports.getJobStatus = getJobStatus;
const supabase_1 = require("./supabase");
// ─── Functions ─────────────────────────────────────────────────────────────────
/**
 * Set (upsert) a job status in the Supabase `job_status` table.
 * Replaces the old Redis `job-status:*` key-value pattern.
 */
async function setJobStatus(jobId, data) {
    const supabase = (0, supabase_1.getServiceRoleClient)();
    const { error } = await supabase
        .from('job_status')
        .upsert({
        job_id: jobId,
        status: data.status,
        result: data.result ?? null,
        error: data.error ?? null,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'job_id' });
    if (error) {
        console.error('[JobStatus] Failed to set job status:', error.message);
        // Non-fatal: don't throw to avoid breaking the main flow
    }
}
/**
 * Get a job status from the Supabase `job_status` table.
 * Returns null if not found.
 */
async function getJobStatus(jobId) {
    const supabase = (0, supabase_1.getServiceRoleClient)();
    const { data, error } = await supabase
        .from('job_status')
        .select('status, result, error, updated_at')
        .eq('job_id', jobId)
        .maybeSingle();
    if (error) {
        console.error('[JobStatus] Failed to get job status:', error.message);
        return null;
    }
    if (!data)
        return null;
    return {
        status: data.status,
        result: data.result,
        error: data.error,
        updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : undefined,
    };
}
