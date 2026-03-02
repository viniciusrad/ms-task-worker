import { getServiceRoleClient } from './supabase'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type JobStatusValue = 'pending' | 'processing' | 'completed' | 'failed'

export interface JobStatusData {
  status: JobStatusValue
  result?: Record<string, unknown>
  error?: string
  updatedAt?: number
}

// ─── Functions ─────────────────────────────────────────────────────────────────

/**
 * Set (upsert) a job status in the Supabase `job_status` table.
 * Replaces the old Redis `job-status:*` key-value pattern.
 */
export async function setJobStatus(
  jobId: string,
  data: JobStatusData
): Promise<void> {
  const supabase = getServiceRoleClient()

  const { error } = await supabase
    .from('job_status')
    .upsert(
      {
        job_id: jobId,
        status: data.status,
        result: data.result ?? null,
        error: data.error ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'job_id' }
    )

  if (error) {
    console.error('[JobStatus] Failed to set job status:', error.message)
    // Non-fatal: don't throw to avoid breaking the main flow
  }
}

/**
 * Get a job status from the Supabase `job_status` table.
 * Returns null if not found.
 */
export async function getJobStatus(
  jobId: string
): Promise<JobStatusData | null> {
  const supabase = getServiceRoleClient()

  const { data, error } = await supabase
    .from('job_status')
    .select('status, result, error, updated_at')
    .eq('job_id', jobId)
    .maybeSingle()

  if (error) {
    console.error('[JobStatus] Failed to get job status:', error.message)
    return null
  }

  if (!data) return null

  return {
    status: data.status as JobStatusValue,
    result: data.result as Record<string, unknown> | undefined,
    error: data.error as string | undefined,
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : undefined,
  }
}
