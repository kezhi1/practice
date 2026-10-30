import Dexie, { type Table } from 'dexie'
import type { Bank, Question, Session } from './types'

class PracticeDB extends Dexie {
  banks!: Table<Bank, string>
  questions!: Table<Question, string>
  sessions!: Table<Session, string>

  constructor() {
    super('practice-quiz')
    this.version(1).stores({
      banks: 'id, title, updatedAt',
      questions: 'id, bankId, type, createdAt',
      sessions: 'id, bankId, finishedAt',
    })
  }
}

export const db = new PracticeDB()

/** 错题练习用一个伪知识库 id 存练习记录，不干扰真实知识库统计 */
export const WRONG_BANK_ID = '__wrong__'

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
