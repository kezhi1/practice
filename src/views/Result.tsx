import { useEffect, useState } from 'react'
import { db } from '../db'
import { renderInline } from '../lib/markdown'
import { formatDuration, sameSet } from '../lib/util'
import { TYPE_LABEL, type Question, type Session } from '../types'

interface Props {
  session: Session
  onRetry: () => void
  onBack: () => void
  /** 返回按钮文案，例如「返回错题本」 */
  backLabel?: string
}

export default function Result({ session, onRetry, onBack, backLabel = '返回知识库' }: Props) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [onlyWrong, setOnlyWrong] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void db.questions.bulkGet(session.questionIds).then((list) => {
      setQuestions(list.filter((q): q is Question => Boolean(q)))
      setLoading(false)
    })
  }, [session])

  const percent = session.total ? Math.round((session.score / session.total) * 100) : 0
  const wrong = questions.filter((q) => !sameSet(session.answers[q.id] ?? [], q.answer))
  const shown = onlyWrong ? wrong : questions

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>练习结果</h1>
          <p className="muted">{session.bankTitle}</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={onRetry}>
            再来一套
          </button>
          <button className="btn ghost" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      </div>

      <div className="score-card card pad">
        <div className="score">
          <span className="score-num">{session.score}</span>
          <span className="score-total">/ {session.total}</span>
        </div>
        <div className="score-meta">
          <div>
            <span className="muted small">正确率</span>
            <strong className={percent >= 60 ? 'good' : 'bad'}>{percent}%</strong>
          </div>
          <div>
            <span className="muted small">用时</span>
            <strong>{formatDuration(session.finishedAt - session.startedAt)}</strong>
          </div>
          <div>
            <span className="muted small">错题</span>
            <strong>{wrong.length}</strong>
          </div>
        </div>
      </div>

      <div className="row between mt">
        <h2>逐题回顾</h2>
        <label className="radio small">
          <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
          只看错题
        </label>
      </div>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : (
        <div className="review-list">
          {shown.length === 0 && <div className="empty">全部正确，没有错题 🎉</div>}
          {shown.map((q) => {
            const mine = session.answers[q.id] ?? []
            const ok = sameSet(mine, q.answer)
            return (
              <article className={`card pad review ${ok ? 'ok' : 'bad'}`} key={q.id}>
                <div className="q-head">
                  <span className={`badge ${ok ? 'ok' : 'bad'}`}>{ok ? '正确' : '错误'}</span>
                  <span className={`badge type-${q.type}`}>{TYPE_LABEL[q.type]}</span>
                  <span className="muted small">难度 {q.difficulty}</span>
                </div>
                <div className="stem" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />
                <div className="options-preview">
                  {q.options.map((o) => {
                    const isAnswer = q.answer.includes(o.key)
                    const isMine = mine.includes(o.key)
                    return (
                      <span key={o.key} className={`opt ${isAnswer ? 'answer' : ''} ${isMine && !isAnswer ? 'wrong' : ''}`}>
                        {o.key}. {o.text}
                      </span>
                    )
                  })}
                </div>
                <div className="answer-line">
                  <span>
                    你的答案 <b className={ok ? 'good' : 'bad'}>{mine.length ? [...mine].sort().join('') : '未作答'}</b>
                  </span>
                  <span>
                    正确答案 <b className="good">{[...q.answer].sort().join('')}</b>
                  </span>
                </div>
                {q.explanation && (
                  <div className="explanation" dangerouslySetInnerHTML={{ __html: renderInline(q.explanation) }} />
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
