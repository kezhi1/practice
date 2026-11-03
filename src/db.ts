import Dexie, { type Table } from 'dexie'
import { shuffle } from './lib/util'
import type { Bank, Draft, Question, Session } from './types'

class PracticeDB extends Dexie {
  banks!: Table<Bank, string>
  questions!: Table<Question, string>
  sessions!: Table<Session, string>
  drafts!: Table<Draft, string>

  constructor() {
    super('practice-quiz')
    this.version(1).stores({
      banks: 'id, title, updatedAt',
      questions: 'id, bankId, type, createdAt',
      sessions: 'id, bankId, finishedAt',
    })
    // v2：加了作答草稿表，刷新/关页面后能恢复进度
    this.version(2).stores({
      banks: 'id, title, updatedAt',
      questions: 'id, bankId, type, createdAt',
      sessions: 'id, bankId, finishedAt',
      drafts: 'sourceKey',
    })
  }
}

export const db = new PracticeDB()

/** 错题练习用一个伪知识库 id 存练习记录，不干扰真实知识库统计 */
export const WRONG_BANK_ID = '__wrong__'
/** 收藏夹练习 */
export const FAV_BANK_ID = '__fav__'
/** 今日复习 */
export const REVIEW_BANK_ID = '__review__'

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** 归一化题干，用于同库去重 */
export function stemKey(stem: string): string {
  return stem.replace(/\s+/g, '').replace(/[，。；、,.;:：!！?？]/g, '').toLowerCase()
}

export async function listBanks(): Promise<Bank[]> {
  return db.banks.orderBy('updatedAt').reverse().toArray()
}

export async function bankStats(bankId: string): Promise<{ total: number; lastScore?: number; attempts: number }> {
  const total = await db.questions.where('bankId').equals(bankId).count()
  const sessions = await db.sessions.where('bankId').equals(bankId).toArray()
  sessions.sort((a, b) => b.finishedAt - a.finishedAt)
  return {
    total,
    attempts: sessions.length,
    lastScore: sessions[0] ? sessions[0].score : undefined,
  }
}

export async function deleteBank(bankId: string): Promise<void> {
  await db.transaction('rw', db.banks, db.questions, db.sessions, async () => {
    await db.banks.delete(bankId)
    await db.questions.where('bankId').equals(bankId).delete()
    await db.sessions.where('bankId').equals(bankId).delete()
  })
}

/** 抽题策略 */
export type DrawMode = 'random' | 'unseen' | 'weak'

export const DRAW_MODE_LABEL: Record<DrawMode, string> = {
  random: '随机',
  unseen: '优先没做过',
  weak: '优先错题',
}

const DRAW_MODE_KEY = 'practice.drawMode'

export function loadDrawMode(): DrawMode {
  const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(DRAW_MODE_KEY)
  return v === 'unseen' || v === 'weak' ? v : 'random'
}

export function saveDrawMode(mode: DrawMode): void {
  try {
    localStorage.setItem(DRAW_MODE_KEY, mode)
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略
  }
}

/**
 * 从题目池里抽题。
 * random：纯随机；unseen：没做过的排前面；weak：错过的排前面。
 * 没有足够的“优先题”时，用其余题目打乱补足。
 */
export function drawQuestions(pool: Question[], mode: DrawMode, limit = 50): Question[] {
  if (mode === 'random') return shuffle(pool).slice(0, limit)

  const shuffled = shuffle(pool)
  const priority =
    mode === 'unseen'
      ? shuffled.filter((q) => !q.seenCount)
      : shuffled.filter((q) => (q.wrongCount ?? 0) > 0).sort((a, b) => b.wrongCount - a.wrongCount)

  const picked = [...priority]
  for (const q of shuffled) {
    if (picked.length >= limit) break
    if (!picked.includes(q)) picked.push(q)
  }
  return picked.slice(0, limit)
}

/** 刷新后用来恢复进度；题目被删光就当作没有草稿 */
export async function loadDraft(sourceKey: string): Promise<{ draft: Draft; questions: Question[] } | null> {
  const draft = await db.drafts.get(sourceKey)
  if (!draft || draft.questionIds.length === 0) return null
  const found = await db.questions.bulkGet(draft.questionIds)
  const questions = found.filter((q): q is Question => Boolean(q))
  if (questions.length === 0) {
    await db.drafts.delete(sourceKey)
    return null
  }
  return { draft, questions }
}
