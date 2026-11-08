import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { db, listBanks, stemKey, uid } from '../db'
import { parseMarkdown, TEMPLATE_MARKDOWN } from '../lib/parser'
import { AI_IMPORT_PROMPT } from '../lib/importPrompt'
import { renderInline } from '../lib/markdown'
import type { Bank, Question } from '../types'

interface Props {
  onDone: (bankId: string) => void
  onCancel: () => void
}

export default function ImportView({ onDone, onCancel }: Props) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [banks, setBanks] = useState<Bank[]>([])
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void listBanks().then(setBanks)
  }, [])

  const parsed = useMemo(() => {
    if (!text.trim()) return null
    const fallback = fileName.replace(/\.md$/i, '') || '未命名知识库'
    return parseMarkdown(text, fallback)
  }, [text, fileName])

  const errors = parsed?.issues.filter((i) => i.level === 'error') ?? []
  const warns = parsed?.issues.filter((i) => i.level === 'warn') ?? []

  async function readFile(file: File) {
    // 拖拽不走 accept 过滤：非 .md 直接说清楚，别让它读进来变成一堆解析错误
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setFileError(
        `「${file.name}」不是 .md 文件。Word、PDF 请先让 AI 整理成 .md，或者把题目文字直接粘贴到下面的输入框。`,
      )
      return
    }
    setFileError('')
    const content = await file.text()
    setText(content)
    setFileName(file.name)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void readFile(file)
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_MARKDOWN], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'template.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  const [copied, setCopied] = useState(false)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(AI_IMPORT_PROMPT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // 没剪贴板权限（http 下的某些浏览器）就退化成选中文本，让用户自己复制
      const ta = document.createElement('textarea')
      ta.value = AI_IMPORT_PROMPT
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  async function doImport() {
    if (!parsed || parsed.questions.length === 0) return
    setBusy(true)
    try {
      const now = Date.now()
      let bankId = targetId

      if (mode === 'new' || !bankId) {
        const bank: Bank = {
          id: uid(),
          title: parsed.title || '未命名知识库',
          tags: parsed.tags,
          createdAt: now,
          updatedAt: now,
        }
        await db.banks.put(bank)
        bankId = bank.id
      } else {
        await db.banks.update(bankId, { updatedAt: now })
      }

      const existing = await db.questions.where('bankId').equals(bankId).toArray()
      const seen = new Set(existing.map((q) => stemKey(q.stem)))

      const rows: Question[] = []
      for (const pq of parsed.questions) {
        const key = stemKey(pq.stem)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({
          id: uid(),
          bankId,
          type: pq.type,
          stem: pq.stem,
          options: pq.options,
          answer: pq.answer,
          explanation: pq.explanation,
          difficulty: pq.difficulty,
          tags: pq.tags,
          wrongCount: 0,
          createdAt: now + rows.length,
          updatedAt: now,
        })
      }
      if (rows.length) await db.questions.bulkPut(rows)
      onDone(bankId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <div className="page-title">
            <h1>导入文件</h1>
            <span className="format-badge">只支持 .md 文件</span>
          </div>
          <p className="muted">
            Word、PDF、图片请先整理成 .md；也可以直接粘贴题目文字，先预览再入库。
          </p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={downloadTemplate}>
            下载模板
          </button>
          <button className="btn ghost" onClick={() => void copyPrompt()} title="粘贴到 AI 对话框里，让它按格式整理">
            {copied ? '已复制 ✓' : '复制 AI 提示词'}
          </button>
          <button className="btn ghost" onClick={onCancel}>
            返回
          </button>
        </div>
      </div>

      {/* 没有现成题目文件的人，最需要的是「接下来该做什么」而不是格式说明 */}
      <p className="import-hint">
        <span className="import-hint-icon">i</span>
        <span>
          题目在 Word、PDF 或网页里？点
          <code className="import-hint-key">复制 AI 提示词</code>
          发给 AI，让它按格式整理，再把结果粘到左边。
        </span>
      </p>

      <details className="tips">
        <summary>
          <span className="tips-icon">?</span>
          写法小抄：题目在文件里大概长什么样（点开）
        </summary>
        <div className="tips-body">
          <table className="tips-table">
            <tbody>
              <tr>
                <th>分题</th>
                <td>
                  <code>#</code> ~ <code>####</code> 标题；没有标题时按 <code>1.</code> <code>1．</code>{' '}
                  <code>（1）</code> 编号分题；<code>## 一、单项选择题</code> 这种分节标题不算题
                </td>
              </tr>
              <tr>
                <th>选项</th>
                <td>
                  <code>- A. 内容</code> · <code>- A、内容</code> · <code>A. 内容</code> · <code>(A) 内容</code> · <code>- A 内容</code>
                </td>
              </tr>
              <tr>
                <th>答案</th>
                <td>
                  <code>&gt; 答案：A</code> · <code>答案 A</code> · <code>**答案：A**</code> · <code>【答案】A</code> ·
                  <code>正确答案是 B</code>；也认直接写在题干末尾的 <code>（B）</code> <code>（AB）</code>
                </td>
              </tr>
              <tr>
                <th>多选</th>
                <td>
                  <code>A,C</code> · <code>A、C</code> · <code>A C</code> · 连写 <code>AC</code> 也会自动拆开
                </td>
              </tr>
              <tr>
                <th>判断</th>
                <td>
                  <code>对</code> <code>错</code> <code>√</code> <code>×</code> <code>T</code> <code>F</code> 都认；只写
                  <code>&gt; 答案：对</code> 时选项自动补成 <code>A. 正确</code> / <code>B. 错误</code>
                </td>
              </tr>
              <tr>
                <th>解析 / 难度</th>
                <td>
                  <code>解析：…</code>、<code>分析：…</code>、<code>【解析】…</code> 都认，可以写多行；<code>难度：1-5</code>
                </td>
              </tr>
              <tr>
                <th>代码块</th>
                <td>
                  整篇被 <code>```</code> 包住（AI 常这么输出）会自动拆开；解题代码里的 <code>##</code>、
                  <code>- A.</code> 仍不会被当成新题
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            底线是不猜：写法有歧义（单选却给了多个答案、题型写错、答案不在选项里）就报错并指出第几行，绝不悄悄改掉；
            能确定的地方才补全（比如判断题的选项），并且一定在右侧预览里告诉你。
            <br />
            如果题目是 AI 整理的，右上角「复制 AI 提示词」能让它按这个格式输出，比事后修格式省事。
          </p>
        </div>
      </details>

      <div className="import-grid">
        <div className="card pad">
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <strong>把 .md 文件拖到这里</strong>
            <span className="muted">或点击选择文件（仅 .md）</span>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFile(f)
                e.target.value = ''
              }}
            />
          </div>
          {fileError && (
            <p className="file-error" role="alert">
              {fileError}
            </p>
          )}
          <div className="row between mt">
            <span className="muted small">{fileName || '未选择文件'}</span>
            <span className="muted small">{text.length} 字符</span>
          </div>
          <textarea
            className="editor mt"
            placeholder="也可以直接粘贴题目文字…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setFileName('')
              setFileError('')
            }}
            spellCheck={false}
          />
        </div>

        <aside className="card pad preview">
          <h3>解析预览</h3>
          {!parsed ? (
            <p className="muted small">粘贴或拖入文件后，这里显示解析结果。</p>
          ) : (
            <>
              <div className="preview-title">{parsed.title}</div>
              <div className="meta">
                <span className="badge ok">{parsed.questions.length} 题可导入</span>
                {errors.length > 0 && <span className="badge bad">{errors.length} 个错误</span>}
                {warns.length > 0 && <span className="badge warn">{warns.length} 个提醒</span>}
              </div>

              {parsed.issues.length > 0 && (
                <ul className="issues">
                  {parsed.issues.map((issue, i) => (
                    <li key={i} className={issue.level}>
                      <span className="line">第 {issue.line} 行</span> {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <div className="preview-list">
                {parsed.questions.slice(0, 3).map((q, i) => (
                  <div className="preview-item" key={i}>
                    <div className="preview-q" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />
                    <div className="muted small">
                      {q.options.length} 选项 · 答案 {q.answer.join('')} · 第 {q.line} 行
                    </div>
                  </div>
                ))}
                {parsed.questions.length > 3 && (
                  <div className="muted small">… 其余 {parsed.questions.length - 3} 题</div>
                )}
              </div>

              <div className="import-target">
                <label className="radio">
                  <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
                  新建知识库
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    checked={mode === 'existing'}
                    onChange={() => setMode('existing')}
                    disabled={banks.length === 0}
                  />
                  追加到已有
                </label>
                {mode === 'existing' && (
                  <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">选择知识库…</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                className="btn primary block"
                disabled={busy || parsed.questions.length === 0 || (mode === 'existing' && !targetId)}
                onClick={() => void doImport()}
              >
                {busy ? '导入中…' : `导入 ${parsed.questions.length} 题`}
              </button>
              <p className="muted tiny mt-sm">同一知识库内，题干相同的题会自动跳过。</p>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
