import { describe, expect, it } from 'vitest'
import { bankToMarkdown, markdownFileName } from './exportMd'
import { parseMarkdown } from './parser'
import type { Bank, Question } from '../types'

const bank: Bank = {
  id: 'b1',
  title: '计算机网络',
  tags: ['网络', '面试'],
  createdAt: 1,
  updatedAt: 2,
}

function q(over: Partial<Question>): Question {
  return {
    id: 'q',
    bankId: 'b1',
    type: 'single',
    stem: '题干',
    options: [
      { key: 'A', text: '甲' },
      { key: 'B', text: '乙' },
    ],
    answer: ['A'],
    explanation: '',
    difficulty: 2,
    tags: [],
    wrongCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('导出 Markdown', () => {
  it('导出的文件能原样再导入（题干 / 选项 / 答案 / 解析都在）', () => {
    const questions = [
      q({ id: '1', stem: 'TCP 是面向连接的可靠传输协议。', type: 'judge', answer: ['A'], explanation: '三次握手。' }),
      q({ id: '2', stem: '下列哪些属于传输层协议？', type: 'multiple', answer: ['A', 'B'], options: [
        { key: 'A', text: 'TCP' },
        { key: 'B', text: 'UDP' },
        { key: 'C', text: 'HTTP' },
      ] }),
      q({ id: '3', stem: '路由器工作在哪一层？', options: [
        { key: 'A', text: '物理层' },
        { key: 'B', text: '网络层' },
      ], answer: ['B'] }),
    ]

    const md = bankToMarkdown(bank, questions)
    const parsed = parseMarkdown(md)

    expect(parsed.issues.filter((i) => i.level === 'error')).toHaveLength(0)
    expect(parsed.questions).toHaveLength(3)
    expect(parsed.questions.map((x) => x.stem)).toEqual(questions.map((x) => x.stem))
    expect(parsed.questions.map((x) => x.answer)).toEqual(questions.map((x) => x.answer))
    expect(parsed.questions[0].explanation).toContain('三次握手')
    expect(parsed.questions[1].type).toBe('multiple')
  })

  it('题库标题和标签写进 front matter，难度非默认值也保留', () => {
    const md = bankToMarkdown(bank, [q({ difficulty: 4, tags: ['路由'] })])
    expect(md.startsWith('---')).toBe(true)
    expect(md).toContain('title: 计算机网络')
    expect(md).toContain('tags: [网络, 面试]')
    expect(md).toContain('> 难度：4')
    expect(md).toContain('> 标签：路由')
  })

  it('默认难度不写出来，避免噪音', () => {
    const md = bankToMarkdown(bank, [q({ difficulty: 2 })])
    expect(md).not.toContain('难度')
  })

  it('文件名去掉非法字符，空标题有兜底', () => {
    expect(markdownFileName('网络/安全: 第一章?')).toBe('网络_安全_ 第一章_.md')
    expect(markdownFileName('   ')).toBe('题库.md')
  })
})
