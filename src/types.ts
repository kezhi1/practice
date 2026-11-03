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
  /** 一共在练习里作答过几次，用于「优先没做过」的抽题策略 */
  seenCount?: number
  /** 收藏夹 */
  fav?: boolean
  /** 间隔重复：连续答对的次数，0 表示刚答错、重新开始 */
  stage?: number
  /** 间隔重复：下次该复习的时间戳，到点后进入「今日待复习」 */
  dueAt?: number
  /** 间隔重复：最近一次复习时间 */
  lastReviewAt?: number
  createdAt: number
  updatedAt: number
}

export type AnswerMap = Record<string, string[]>

/** 答题模式：考试（交卷后统一看结果） / 练习（答完立刻看对错） */
export type QuizMode = 'exam' | 'practice'

/** 未交卷的作答草稿，用于刷新后恢复进度 */
export interface Draft {
  sourceKey: string
  bankTitle: string
  questionIds: string[]
  answers: AnswerMap
  flags: string[]
  idx: number
  startedAt: number
  mode: QuizMode
}

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
