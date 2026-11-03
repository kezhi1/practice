import { useEffect, useMemo, useState } from 'react'
import { db } from '../db'
import { renderInline } from '../lib/markdown'
import { describeDue, isDue, needsFirstSchedule, REVIEW_MINUTES } from '../lib/srs'
import { TYPE_LABEL, type Bank, type Question } from '../types'

interface Props {
  onBack: () => void
  onQuizReview: () => void
  onQuizFav: () => void
}

const STAGE_TEXT = REVIEW_MINUTES.map((m) =>
  m < 60 ? `${m} 分钟` : m < 60 * 24 ? `${Math.round(m / 60)} 小时` : `${Math.round(m / 1440)} 天`,
)

export default function Review({ onBack, onQuizReview, onQuizFav }: Props) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void (async () => {
      const [list, bankList] = await Promise.all([db.questions.toArray(), db.banks.toArray()])
      setQuestions(list)
      setBanks(bankList)
      setNow(Date.now())
      setLoading(false)
    })()
  }, [])

  const bankName = useMemo(() => {
    const map = new Map(banks.map((b) => [b.id, b.title]))
    return (id: string) => map.get(id) ?? '未知知识库'
  }, [banks])

  const due = questions
    .filter((q) => isDue(q, now) || needsFirstSchedule(q))
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  const favs = questions.filter((q) => q.fav)
  const scheduled = questions.filter((q) => q.dueAt !== undefined && q.dueAt > now).length

  async function unfav(q: Question) {
    setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, fav: false } : x)))
    await db.questions.update(q.id, { fav: false, updatedAt: Date.now() })
  }

  if (loading) return <div className="empty">正在读取复习计划…</div>

  return (
    <section className="bank-detail">
      <div className="page-head">
        <div>
          <button className="btn ghost sm back" onClick={onBack}>
            ← 全部知识库
          </button>
          <h1 className="page-title">复习</h1>
          <p className="muted">
            答过就会排队复习：{STAGE_TEXT.join(' → ')}，答错退回 10 分钟。
          </p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={onQuizFav} disabled={favs.length === 0}>
            收藏练习（{favs.length}）
          </button>
          <button className="btn primary" onClick={onQuizReview} disabled={due.length === 0}>
            开始复习（{due.length}）
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat card pad">
          <strong>{due.length}</strong>
          <span className="muted small">现在该复习</span>
        </div>
        <div className="stat card pad">
          <strong>{scheduled}</strong>
          <span className="muted small">已排进日程</span>
        </div>
        <div className="stat card pad">
          <strong>{favs.length}</strong>
          <span className="muted small">收藏</span>
        </div>
      </div>

      <h2 className="section-title">现在该复习的题</h2>
      {due.length === 0 ? (
        <div className="card pad empty-line muted">
          暂时没有到点的题。做几道题之后这里会自动排上日程。
        </div>
      ) : (
        <div className="question-list">
          {due.slice(0, 30).map((q) => (
            <article className="card pad question-row" key={q.id}>
              <div className="q-head">
                <span className={`badge type-${q.type}`}>{TYPE_LABEL[q.type]}</span>
                <span className="muted small">{bankName(q.bankId)}</span>
                <span className="badge warn">
                  {q.dueAt === undefined ? '待排复习' : describeDue(q, now)}
                </span>
                {q.wrongCount > 0 && <span className="muted small">错 {q.wrongCount} 次</span>}
              </div>
              <div className="stem" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />
              <div className="options-preview">
                {q.options.map((o) => (
                  <span key={o.key} className={`opt ${q.answer.includes(o.key) ? 'answer' : ''}`}>
                    {o.key}. {o.text}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {due.length > 30 && <p className="muted small">还有 {due.length - 30} 题没有显示，开始复习后会一起抽。</p>}
        </div>
      )}

      <h2 className="section-title">收藏夹</h2>
      {favs.length === 0 ? (
        <div className="card pad empty-line muted">
          还没有收藏。刷题时点右上角的 ☆ 收藏，题目就会出现在这里。
        </div>
      ) : (
        <div className="question-list">
          {favs.map((q) => (
            <article className="card pad question-row" key={q.id}>
              <div className="q-head">
                <span className={`badge type-${q.type}`}>{TYPE_LABEL[q.type]}</span>
                <span className="muted small">{bankName(q.bankId)}</span>
                <span className="muted small">难度 {q.difficulty}</span>
                <button
                  className="btn ghost sm push fav-on"
                  onClick={() => void unfav(q)}
                  title="取消收藏"
                >
                  ★ 已收藏
                </button>
              </div>
              <div className="stem" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />
              <div className="options-preview">
                {q.options.map((o) => (
                  <span key={o.key} className={`opt ${q.answer.includes(o.key) ? 'answer' : ''}`}>
                    {o.key}. {o.text}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
