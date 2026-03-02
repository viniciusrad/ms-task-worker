import type { SupabaseClient } from '@supabase/supabase-js'

export const ACTION_POINTS = {
  analyze_image: 10,
  complete_quiz: 20,
  view_flashcards: 5,
} as const

export type RewardAction = keyof typeof ACTION_POINTS

/**
 * Update user points, streaks and award badges.
 */
export async function addReward(
  userId: string,
  action: RewardAction,
  client: SupabaseClient
) {
  const points = ACTION_POINTS[action]
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const { data: existing } = await client
    .from('daily_streaks')
    .select('id, streak, last_activity_date, points')
    .eq('user_id', userId)
    .single()

  let streak = 1
  let totalPoints = points

  if (existing) {
    totalPoints = (existing.points || 0) + points
    if (existing.last_activity_date === todayStr) {
      streak = existing.streak || 1
    } else if (existing.last_activity_date === yesterdayStr) {
      streak = (existing.streak || 0) + 1
    } else {
      streak = 1
    }

    await client
      .from('daily_streaks')
      .update({
        streak,
        last_activity_date: todayStr,
        points: totalPoints,
      })
      .eq('user_id', userId)
  } else {
    await client.from('daily_streaks').insert({
      user_id: userId,
      streak: 1,
      last_activity_date: todayStr,
      points: totalPoints,
    })
  }

  // Simple badge rules
  const badges: string[] = []
  if (streak >= 7) badges.push('7-day streak')
  if (totalPoints >= 100) badges.push('100 points')

  for (const badge of badges) {
    const { data: hasBadge } = await client
      .from('user_badges')
      .select('id')
      .eq('user_id', userId)
      .eq('badge', badge)
      .single()

    if (!hasBadge) {
      await client.from('user_badges').insert({ user_id: userId, badge })
    }
  }
}
