import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdown } from './parser'
import { AI_IMPORT_PROMPT } from './importPrompt'

const errorsOf = (md: string) =>
  parseMarkdown(md).issues
    .filter((i) => i.level === 'error')
    .map((e) => `第${e.line}行 ${e.message}`)

describe('AI 提示词', () => {
  it('提示词里自带的示例本身能被解析器吃下去', () => {
    const start = AI_IMPORT_PROMPT.indexOf('## 1.')
    const sample = AI_IMPORT_PROMPT.slice(start).trim()
    const r = parseMarkdown(sample)
    expect(errorsOf(sample)).toEqual([])
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].answer).toEqual(['B'])
    expect(r.questions[1].answer).toEqual(['A', 'B'])
  })
})

describe('AI 风格的真实文件', () => {
  const dir = 'examples'
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    it(`${file} 没有解析错误`, () => {
      const md = readFileSync(join(dir, file), 'utf-8')
      expect(errorsOf(md)).toEqual([])
    })
  }

  it('AI 风格题库.md：代码块外壳、答案速查表、开场白都能处理', () => {
    const md = readFileSync(join(dir, 'AI 风格题库.md'), 'utf-8')
    const r = parseMarkdown(md)
    expect(errorsOf(md)).toEqual([])
    expect(r.questions).toHaveLength(3)
    expect(r.questions[0].stem).toBe('下列关于缓冲区的说法，正确的是（）')
    expect(r.questions[1].answer).toEqual(['A', 'B', 'D'])
    expect(r.questions[2].answer).toEqual(['A'])
    // 「## 答案速查表」后面的表格没有被当成第 4 题
    expect(r.questions.some((q) => q.stem.includes('答案速查表'))).toBe(false)
  })
})
