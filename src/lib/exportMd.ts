import type { Bank, Question } from '../types'

/**
 * 把题库导回 Markdown —— 和导入规则同构，导出的文件可以直接再导入。
 * 用于备份、换设备、发给同学。
 */
export function bankToMarkdown(bank: Bank, questions: Question[]): string {
  const lines: string[] = []

  lines.push('---')
  lines.push(`title: ${bank.title}`)
  if (bank.tags.length > 0) lines.push(`tags: [${bank.tags.join(', ')}]`)
  lines.push('---')
  lines.push('')

  questions.forEach((q, i) => {
    lines.push(`## ${i + 1}. ${q.stem}`)
    for (const o of q.options) lines.push(`- ${o.key}. ${o.text}`)
    lines.push('')
    lines.push(`> 答案：${[...q.answer].sort().join('')}`)
    if (q.explanation) lines.push(`> 解析：${q.explanation.replace(/\s*\n\s*/g, ' ')}`)
    if (q.difficulty !== 2) lines.push(`> 难度：${q.difficulty}`)
    if (q.tags.length > 0) lines.push(`> 标签：${q.tags.join(', ')}`)
    lines.push('')
  })

  return lines.join('\n')
}

/** 题库标题 → 安全的文件名 */
export function markdownFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '题库'
  return `${base}.md`
}

/** 触发浏览器下载（纯前端，不经过服务器） */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 给下载一点时间再回收，Safari 上立即 revoke 会失败
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
