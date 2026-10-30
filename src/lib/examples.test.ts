import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parser'

const sample = readFileSync(
  resolve(process.cwd(), 'examples/计算机网络.md'),
  'utf-8',
)

describe('examples/计算机网络.md', () => {
  const result = parseMarkdown(sample)

  it('没有错误级问题（判断题自动补选项的提醒是预期的）', () => {
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(result.issues.every((i) => /判断题未写选项/.test(i.message))).toBe(true)
  })

  it('题量、题型与答案都正确', () => {
    expect(result.questions).toHaveLength(15)
    expect(result.title).toBe('计算机网络基础')
    expect(result.questions.filter((q) => q.type === 'single')).toHaveLength(7)
    expect(result.questions.filter((q) => q.type === 'multiple')).toHaveLength(4)
    expect(result.questions.filter((q) => q.type === 'judge')).toHaveLength(4)
    expect(result.questions[0].answer).toEqual(['A'])
    expect(result.questions[1].answer).toEqual(['A', 'B'])
    expect(result.questions.every((q) => q.options.length >= 2)).toBe(true)
  })
})
