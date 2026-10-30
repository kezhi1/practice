export type QType = 'single' | 'multiple' | 'judge'

export const TYPE_LABEL: Record<QType, string> = {
  single: '单选',
  multiple: '多选',
  judge: '判断',
}

export interface Bank {
  id: string
  title: string
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface Option {
  key: string
  text: string
}

export interface Question {
  id: string
  bankId: string
  type: QType
  stem: string
  options: Option[]
  answer: string[]
  explanation: string
  difficulty: number
  tags: string[]
  wrongCount: number
  /** 最近一次答错的时间，用于错题本排序 */
  lastWrongAt?: number
  createdAt: number
  updatedAt: number
}

export type AnswerMap = Record<string, string[]>

export interface Session {
  id: string
  bankId: string
  bankTitle: string
  questionIds: string[]
  answers: AnswerMap
  startedAt: number
  finishedAt: number
  score: number
  total: number
}

export interface ParseIssue {
  line: number
  message: string
  level: 'error' | 'warn'
}

export interface ParsedQuestion {
  type: QType
  stem: string
  options: Option[]
  answer: string[]
  explanation: string
  difficulty: number
  tags: string[]
  line: number
}

export interface ParseResult {
  title: string
  tags: string[]
  questions: ParsedQuestion[]
  issues: ParseIssue[]
}
