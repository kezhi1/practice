import { useEffect, useRef, useState } from 'react'
import { db, uid, WRONG_BANK_ID } from '../db'
import { renderInline } from '../lib/markdown'
import { formatDuration, sameSet, shuffle } from '../lib/util'
import { TYPE_LABEL, type AnswerMap, type Question, type Session } from '../types'

export type QuizSource = { kind: 'bank'; bankId: string } | { kind: 'wrong' }

interface Props {
  source: QuizSource
  onFinish: (session: Session) => void
  onExit: () => void
}

export default function Quiz({ source, onFinish, onExit }: Props) {
  const [bankTitle, setBankTitle] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const dotsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      let pool: Question[]
      if (source.kind === 'bank') {
        const [bank, list] = await Promise.all([
          db.banks.get(source.bankId),
          db.questions.where('bankId').equals(source.bankId).toArray(),
        ])
        if (!alive) return
        setBankTitle(bank?.title ?? '')
        pool = list
      } else {
        const list = await db.questions.toArray()
        if (!alive) return
        setBankTitle('错题练习')
        pool = list.filter((q) => q.wrongCount > 0)
      }
      setQuestions(shuffle(pool).slice(0, 50))
      setStartedAt(Date.now())
      setNow(Date.now())
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [source])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const box = dotsRef.current
    if (!box) return
    const cur = box.querySelector<HTMLElement>('.dot.current')
    if (cur) box.scrollLeft = cur.offsetLeft - box.clientWidth / 2 + cur.clientWidth / 2
  }, [idx])

  function choose(q: Question, key: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? []
      if (q.type === 'multiple') {
        return { ...prev, [q.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] }
      }
      return { ...prev, [q.id]: [key] }
    })
  }

  function toggleFlag(id: string) {
    setFlags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (submitting) return
    const answered = Object.values(answers).filter((a) => a.length > 0).length
    if (answered < questions.length) {
      const ok = window.confirm(`还有 ${questions.length - answered} 题没作答，确定交卷？`)
      if (!ok) return
    }
    setSubmitting(true)
    const finishedAt = Date.now()
    const score = questions.reduce((n, q) => n + (sameSet(answers[q.id] ?? [], q.answer) ? 1 : 0), 0)
    const session: Session = {
      id: uid(),
      bankId: source.kind === 'bank' ? source.bankId : WRONG_BANK_ID,
      bankTitle,
      questionIds: questions.map((q) => q.id),
      answers,
      startedAt,
      finishedAt,
      score,
      total: questions.length,
    }
    await db.sessions.put(session)

    // 错题本记分：答错 +1；答对 -1（不低于 0），相当于熟悉度在回升
    for (const q of questions) {
      const correct = sameSet(answers[q.id] ?? [], q.answer)
      if (correct) {
        if (q.wrongCount > 0) {
          await db.questions.update(q.id, { wrongCount: q.wrongCount - 1, updatedAt: finishedAt })
        }
      } else {
        await db.questions.update(q.id, {
          wrongCount: (q.wrongCount ?? 0) + 1,
          lastWrongAt: finishedAt,
          updatedAt: finishedAt,
        })
      }
    }
    onFinish(session)
  }

  if (loading) return <div className="empty">正在抽题…</div>
  if (questions.length === 0) {
    return (
      <div className="empty-state">
        <h2>{source.kind === 'wrong' ? '错题本还是空的' : '这个知识库还没有题目'}</h2>
        <p className="muted">
          {source.kind === 'wrong' ? '先去刷题，答错的题会自动进来。' : '去添加几道题吧。'}
        </p>
        <button className="btn primary" onClick={onExit}>
          {source.kind === 'wrong' ? '返回错题本' : '去添加题目'}
        </button>
      </div>
    )
  }

  const q = questions[idx]
  const selected = answers[q.id] ?? []
  const answeredCount = questions.filter((x) => (answers[x.id] ?? []).length > 0).length
  const progress = ((idx + 1) / questions.length) * 100

  return (
    <section className="quiz">
      <div className="quiz-top card">
        <div className="row gap">
          <button className="btn ghost sm" onClick={onExit}>
            ← 退出
          </button>
          <strong>{bankTitle}</strong>
          <span className="muted small">
            已答 {answeredCount}/{questions.length}
          </span>
        </div>
        <div className="row gap">
          <span className="timer">{formatDuration(now - startedAt)}</span>
          <button className="btn primary" onClick={() => void submit()} disabled={submitting}>
            交卷
          </button>
        </div>
      </div>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <article className="card pad question-card">
        <div className="q-head">
          <span className={`badge type-${q.type}`}>{TYPE_LABEL[q.type]}</span>
          <span className="muted small">
            第 {idx + 1} / {questions.length} 题
          </span>
          <span className="muted small">难度 {q.difficulty}</span>
          {q.wrongCount > 0 && <span className="badge warn">错过 {q.wrongCount} 次</span>}
          <button
            className={`btn ghost sm push ${flags.has(q.id) ? 'flagged' : ''}`}
            onClick={() => toggleFlag(q.id)}
          >
            {flags.has(q.id) ? '★ 已标记' : '☆ 标记'}
          </button>
        </div>

        <div className="stem" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />

        <div className="options">
          {q.options.map((o) => {
            const on = selected.includes(o.key)
            return (
              <button key={o.key} className={`option ${on ? 'selected' : ''}`} onClick={() => choose(q, o.key)}>
                <span className="key">{o.key}</span>
                <span dangerouslySetInnerHTML={{ __html: renderInline(o.text) }} />
              </button>
            )
          })}
        </div>

        {q.type === 'multiple' && <p className="muted tiny">多选题：选全才得分，可多选。</p>}

        <div className="dots-wrap">
          <div className="dots" ref={dotsRef}>
            {questions.map((item, i) => {
              const done = (answers[item.id] ?? []).length > 0
              return (
                <button
                  key={item.id}
                  className={`dot ${i === idx ? 'current' : ''} ${done ? 'done' : ''} ${flags.has(item.id) ? 'flag' : ''}`}
                  onClick={() => setIdx(i)}
                  title={`第 ${i + 1} 题`}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
        </div>

        <div className="row between mt">
          <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
            上一题
          </button>
          {idx === questions.length - 1 ? (
            <button className="btn primary" onClick={() => void submit()} disabled={submitting}>
              交卷
            </button>
          ) : (
            <button className="btn primary" onClick={() => setIdx((i) => i + 1)}>
              下一题
            </button>
          )}
        </div>
      </article>
    </section>
  )
}
