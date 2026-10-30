import { useEffect, useMemo, useState } from 'react'
import { db, WRONG_BANK_ID } from '../db'
import { formatDuration } from '../lib/util'
import type { Session } from '../types'

interface Props {
  onBack: () => void
  onOpen: (session: Session) => void
}

function fmtDate(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function History({ onBack, onOpen }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [bankFilter, setBankFilter] = useState('all')

  useEffect(() => {
    void db.sessions
      .orderBy('finishedAt')
      .reverse()
      .toArray()
      .then((list) => {
        setSessions(list)
        setLoading(false)
      })
  }, [])

  const bankOptions = useMemo(() => {
    const map = new Map<string, string>()
    sessions.forEach((s) => map.set(s.bankId, s.bankTitle || '未命名'))
    return [...map.entries()]
  }, [sessions])

  const rows = useMemo(
    () => (bankFilter === 'all' ? sessions : sessions.filter((s) => s.bankId === bankFilter)),
    [sessions, bankFilter],
  )

  const stats = useMemo(() => {
    if (!rows.length) return null
    const totalQ = rows.reduce((n, s) => n + s.total, 0)
    const totalRight = rows.reduce((n, s) => n + s.score, 0)
    const week = Date.now() - 7 * 24 * 3600 * 1000
    return {
      count: rows.length,
      accuracy: Math.round((totalRight / Math.max(1, totalQ)) * 100),
      questions: totalQ,
      weekCount: rows.filter((s) => s.finishedAt >= week).length,
      best: Math.max(...rows.map((s) => (s.total ? Math.round((s.score / s.total) * 100) : 0))),
    }
  }, [rows])

  if (loading) return <div className="empty">加载中…</div>

  return (
    <section>
      <div className="row between wrap">
        <div>
          <button className="btn ghost sm" onClick={onBack}>
            ← 全部知识库
          </button>
          <h1 className="page-title">练习历史</h1>
          <p className="muted">每次交卷都会留一条记录，点开可以回到那一次的逐题回顾。</p>
        </div>
        {bankOptions.length > 1 && (
          <select className="select auto" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
            <option value="all">全部</option>
            {bankOptions.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        )}
      </div>

      {stats && (
        <div className="stat-row">
          <div className="stat card">
            <span className="stat-num">{stats.count}</span>
            <span className="muted small">练习次数</span>
          </div>
          <div className="stat card">
            <span className="stat-num">{stats.accuracy}%</span>
            <span className="muted small">平均正确率</span>
          </div>
          <div className="stat card">
            <span className="stat-num">{stats.questions}</span>
            <span className="muted small">累计答题</span>
          </div>
          <div className="stat card">
            <span className="stat-num">{stats.weekCount}</span>
            <span className="muted small">近 7 天</span>
          </div>
          <div className="stat card">
            <span className="stat-num">{stats.best}%</span>
            <span className="muted small">最好一次</span>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state card">
          <h2>还没有练习记录</h2>
          <p className="muted">去刷一套题，交卷后这里就有历史了。</p>
        </div>
      ) : (
        <div className="history-list">
          {rows.map((s) => {
            const percent = s.total ? Math.round((s.score / s.total) * 100) : 0
            const isWrongDrill = s.bankId === WRONG_BANK_ID
            return (
              <article className="card pad history-row" key={s.id}>
                <div className="history-main">
                  <div className="row gap">
                    <strong>{s.bankTitle || '未命名知识库'}</strong>
                    {isWrongDrill && s.bankTitle !== '错题练习' && (
                      <span className="badge danger">错题练习</span>
                    )}
                  </div>
                  <span className="muted small">
                    {fmtDate(s.finishedAt)} · 用时 {formatDuration(s.finishedAt - s.startedAt)}
                  </span>
                </div>
                <div className="history-score">
                  <span className={`score ${percent >= 80 ? 'good' : percent >= 60 ? 'mid' : 'low'}`}>
                    {s.score}
                    <span className="muted">/{s.total}</span>
                  </span>
                  <span className="muted small">{percent}%</span>
                </div>
                <button className="btn ghost sm" onClick={() => onOpen(s)}>
                  看回顾
                </button>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
