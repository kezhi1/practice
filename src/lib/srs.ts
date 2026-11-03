import type { Question } from '../types'

/**
 * 间隔重复的复习节奏（分钟）。
 * 连续答对第 n 次后，隔多久再来一次：
 * 10 分钟 → 1 天 → 3 天 → 7 天 → 15 天 → 30 天。
 */
export const REVIEW_MINUTES = [10, 60 * 24, 60 * 24 * 3, 60 * 24 * 7, 60 * 24 * 15, 60 * 24 * 30]

export const MAX_STAGE = REVIEW_MINUTES.length - 1

export function stageIntervalMs(stage: number): number {
  const i = Math.max(0, Math.min(stage, MAX_STAGE))
  return REVIEW_MINUTES[i] * 60 * 1000
}

/**
 * 根据这次答对/答错，算出新的复习计划。
 * 答错就退回第 0 档（10 分钟后再来），答对则往前走一档。
 */
export function nextReview(
  q: Pick<Question, 'stage'>,
  correct: boolean,
  now = Date.now(),
): Pick<Question, 'stage' | 'dueAt' | 'lastReviewAt'> {
  const prev = q.stage ?? 0
  const stage = correct ? Math.min(prev + 1, MAX_STAGE) : 0
  return {
    stage,
    dueAt: now + stageIntervalMs(stage),
    lastReviewAt: now,
  }
}

/** 是否到了该复习的时间（还没排过复习的题不算） */
export function isDue(q: Pick<Question, 'dueAt'>, now = Date.now()): boolean {
  if (q.dueAt === undefined) return false
  return q.dueAt <= now
}

/** 还没排过复习、但有作答记录的题（新加的题） */
export function needsFirstSchedule(q: Pick<Question, 'dueAt' | 'seenCount'>): boolean {
  return q.dueAt === undefined && (q.seenCount ?? 0) > 0
}

/** 给界面用的剩余时间描述 */
export function describeDue(q: Pick<Question, 'dueAt'>, now = Date.now()): string {
  if (q.dueAt === undefined) return '还没排复习'
  const diff = q.dueAt - now
  if (diff <= 0) return '现在该复习'
  const min = Math.round(diff / 60000)
  if (min < 60) return `${min} 分钟后`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时后`
  return `${Math.round(hour / 24)} 天后`
}
