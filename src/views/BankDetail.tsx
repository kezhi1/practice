import { useEffect, useMemo, useState } from 'react'
import { db, deleteBank, stemKey, uid } from '../db'
import { renderInline } from '../lib/markdown'
import { TYPE_LABEL, type Bank, type QType, type Question } from '../types'

interface Props {
  bankId: string
  onBack: () => void
  onQuiz: () => void
}

export default function BankDetail({ bankId, onBack, onQuiz }: Props) {
  const [bank, setBank] = useState<Bank | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<'all' | QType>('all')
  const [editing, setEditing] = useState<Question | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  async function load() {
    const [b, list] = await Promise.all([
      db.banks.get(bankId),
      db.questions.where('bankId').equals(bankId).toArray(),
    ])
    setBank(b ?? null)
    setQuestions(list.sort((x, y) => x.createdAt - y.createdAt))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [bankId])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return questions.filter((q) => {
      if (type !== 'all' && q.type !== type) return false
      if (!kw) return true
      return q.stem.toLowerCase().includes(kw) || q.options.some((o) => o.text.toLowerCase().includes(kw))
    })
  }, [questions, keyword, type])

  async function toggleFav(q: Question) {
    const fav = !q.fav
    setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, fav } : x)))
    await db.questions.update(q.id, { fav, updatedAt: Date.now() })
  }

  async function saveQuestion(id: string | null, data: {
    stem: string
    type: QType
    options: { key: string; text: string }[]
    answer: string[]
    explanation: string
    difficulty: number
  }) {
    const now = Date.now()
    if (id) {
      await db.questions.update(id, { ...data, updatedAt: now })
    } else {
      const key = stemKey(data.stem)
      const dup = questions.find((q) => stemKey(q.stem) === key)
      if (dup) {
        window.alert('这个题干已经存在（同一知识库内不允许重复题）。')
        return
      }
      await db.questions.put({
        id: uid(),
        bankId,
        ...data,
        tags: [],
        wrongCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
    await db.banks.update(bankId, { updatedAt: now })
    setEditing(null)
    await load()
  }

  async function removeQuestion(q: Question) {
    if (!window.confirm('删除这道题？')) return
    await db.questions.delete(q.id)
    await load()
  }

  function startRename() {
    setNameDraft(bank?.title ?? '')
    setRenaming(true)
  }

  async function saveName() {
    if (!bank) return
    const title = nameDraft.trim()
    if (!title) {
      window.alert('知识库名字不能为空。')
      return
    }
    if (title !== bank.title) {
      await db.banks.update(bank.id, { title, updatedAt: Date.now() })
      // 练习记录里存的是当时的知识库名字，一并改掉，历史列表才不会显示旧名
      await db.sessions.where('bankId').equals(bank.id).modify({ bankTitle: title })
      setBank({ ...bank, title })
    }
    setRenaming(false)
  }

  async function removeBank() {
    if (!bank) return
    if (!window.confirm(`删除知识库「${bank.title}」及全部 ${questions.length} 道题？`)) return
    await deleteBank(bank.id)
    onBack()
  }

  if (loading) return <div className="empty">加载中…</div>
  if (!bank) return <div className="empty">知识库不存在</div>

  return (
    <section>
      <div className="page-head">
        <div>
          <button className="link-back" onClick={onBack}>
            ← 全部知识库
          </button>
          {renaming ? (
            <div className="rename-row">
              <input
                className="input rename-input"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveName()
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
              <button className="btn primary sm" onClick={() => void saveName()}>
                保存
              </button>
              <button className="btn ghost sm" onClick={() => setRenaming(false)}>
                取消
              </button>
            </div>
          ) : (
            <h1 className="bank-title">
              {bank.title}
              <button className="btn ghost sm rename-btn" onClick={startRename}>
                重命名
              </button>
            </h1>
          )}
          <p className="muted">
            {questions.length} 题 · 每次练习随机抽 {Math.min(50, questions.length)} 题
            {questions.length < 50 && questions.length > 0 ? '（不足 50，全部出题）' : ''}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={onQuiz} disabled={questions.length === 0}>
            开始刷题
          </button>
          <button className="btn ghost" onClick={() => setEditing('new')}>
            新增题目
          </button>
          <button className="btn danger-ghost" onClick={() => void removeBank()}>
            删除知识库
          </button>
        </div>
      </div>

      <div className="toolbar card pad">
        <input
          className="input"
          placeholder="搜索题干或选项…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="segmented">
          {(['all', 'single', 'multiple', 'judge'] as const).map((t) => (
            <button
              key={t}
              className={type === t ? 'active' : ''}
              onClick={() => setType(t)}
            >
              {t === 'all' ? '全部' : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <span className="muted small">{filtered.length} / {questions.length}</span>
      </div>

      <div className="question-list">
        {filtered.map((q, i) => (
          <article className="card pad question-row" key={q.id}>
            <div className="q-head">
              <span className={`badge type-${q.type}`}>{TYPE_LABEL[q.type]}</span>
              <span className="muted small">难度 {q.difficulty}</span>
              {q.wrongCount > 0 && <span className="muted small">错 {q.wrongCount} 次</span>}
              <span className="muted small">#{i + 1}</span>
            </div>
            <div className="stem" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />
            <div className="options-preview">
              {q.options.map((o) => (
                <span key={o.key} className={`opt ${q.answer.includes(o.key) ? 'answer' : ''}`}>
                  {o.key}. {o.text}
                </span>
              ))}
            </div>
            <div className="row between">
              <span className="muted small">答案 {q.answer.join('')}</span>
              <div className="row gap">
                <button
                  className={`btn ghost sm ${q.fav ? 'fav-on' : ''}`}
                  onClick={() => void toggleFav(q)}
                  title="收藏"
                >
                  {q.fav ? '★ 已收藏' : '☆ 收藏'}
                </button>
                <button className="btn ghost sm" onClick={() => setEditing(q)}>
                  编辑
                </button>
                <button className="btn danger-ghost sm" onClick={() => void removeQuestion(q)}>
                  删除
                </button>
              </div>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="empty">没有匹配的题目。换个关键词，或新增一道。</div>
        )}
      </div>

      {editing && (
        <QuestionEditor
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSave={(data) => saveQuestion(editing === 'new' ? null : editing.id, data)}
        />
      )}
    </section>
  )
}

interface EditorData {
  stem: string
  type: QType
  options: { key: string; text: string }[]
  answer: string[]
  explanation: string
  difficulty: number
}

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

function QuestionEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Question
  onSave: (data: EditorData) => Promise<void> | void
  onCancel: () => void
}) {
  const [stem, setStem] = useState(initial?.stem ?? '')
  const [type, setType] = useState<QType>(initial?.type ?? 'single')
  const [options, setOptions] = useState(
    initial?.options.map((o) => ({ ...o })) ?? [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
    ],
  )
  const [answer, setAnswer] = useState<string[]>(initial?.answer ?? [])
  const [explanation, setExplanation] = useState(initial?.explanation ?? '')
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 2)
  const [error, setError] = useState<string | null>(null)

  function setOption(index: number, text: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, text } : o)))
  }

  function addOption() {
    if (options.length >= KEYS.length) return
    setOptions((prev) => [...prev, { key: KEYS[prev.length], text: '' }])
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index).map((o, i) => ({ ...o, key: KEYS[i] })))
    setAnswer([])
  }

  function toggleAnswer(key: string) {
    if (type === 'multiple') {
      setAnswer((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    } else {
      setAnswer([key])
    }
  }

  async function submit() {
    const text = stem.trim()
    if (!text) return setError('题干不能为空')
    const filled = options.filter((o) => o.text.trim())
    if (filled.length < 2) return setError('至少需要 2 个有内容的选项')
    if (!answer.length) return setError('请选择正确答案')
    const keys = new Set(filled.map((_, i) => KEYS[i]))
    if (answer.some((a) => !keys.has(a))) return setError('答案指向了空选项')
    setError(null)
    await onSave({
      stem: text,
      type,
      options: filled.map((o, i) => ({ key: KEYS[i], text: o.text.trim() })),
      answer: [...answer].sort(),
      explanation: explanation.trim(),
      difficulty,
    })
  }

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? '编辑题目' : '新增题目'}</h3>
        <label className="field">
          <span>题干（支持行内 Markdown）</span>
          <textarea
            className="editor sm"
            rows={4}
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            placeholder="TCP 三次握手中，第三次握手的作用是？"
          />
        </label>

        <label className="field">
          <span>题型</span>
          <select value={type} onChange={(e) => setType(e.target.value as QType)}>
            <option value="single">单选</option>
            <option value="multiple">多选（全对才得分）</option>
            <option value="judge">判断</option>
          </select>
        </label>

        <div className="field">
          <span>选项与答案（点击左侧字母设为正确答案）</span>
          {options.map((o, i) => (
            <div className="option-edit" key={i}>
              <button
                className={`key-toggle ${answer.includes(o.key) ? 'on' : ''}`}
                onClick={() => toggleAnswer(o.key)}
                title="设为正确答案"
              >
                {o.key}
              </button>
              <input
                className="input"
                value={o.text}
                placeholder={`选项 ${o.key}`}
                onChange={(e) => setOption(i, e.target.value)}
              />
              <button className="btn ghost sm" onClick={() => removeOption(i)} disabled={options.length <= 2}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn ghost sm write" onClick={addOption} disabled={options.length >= 6}>
            + 添加选项
          </button>
        </div>

        <label className="field">
          <span>解析（可选）</span>
          <textarea
            className="editor sm"
            rows={2}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </label>

        <label className="field">
          <span>难度 1–5</span>
          <input
            type="range"
            min={1}
            max={5}
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="row between">
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" onClick={() => void submit()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
