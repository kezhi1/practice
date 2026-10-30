import { useEffect, useState } from 'react'
import { db, deleteBank, listBanks } from '../db'
import type { Bank } from '../types'

interface Props {
  onOpen: (bankId: string) => void
  onQuiz: (bankId: string) => void
  onImport: () => void
}

interface Row {
  bank: Bank
  total: number
  attempts: number
  last?: number
  lastTotal?: number
}

export default function Banks({ onOpen, onQuiz, onImport }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const [banks, questions, sessions] = await Promise.all([
      listBanks(),
      db.questions.toArray(),
      db.sessions.toArray(),
    ])
    setRows(
      banks.map((bank) => {
        const list = sessions
          .filter((s) => s.bankId === bank.id)
          .sort((a, b) => b.finishedAt - a.finishedAt)
        return {
          bank,
          total: questions.filter((q) => q.bankId === bank.id).length,
          attempts: list.length,
          last: list[0]?.score,
          lastTotal: list[0]?.total,
        }
      }),
    )
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function remove(row: Row) {
    if (!window.confirm(`删除「${row.bank.title}」及其 ${row.total} 道题？此操作不可撤销。`)) return
    await deleteBank(row.bank.id)
    await load()
  }

  if (loading) return <div className="empty">加载中…</div>

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>知识库</h1>
          <p className="muted">导入 Markdown 建立题库，每次练习随机抽 50 题。</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📥</div>
          <h2>还没有题库</h2>
          <p className="muted">一个 Markdown 文件就是一个知识库，`##` 开头即一道题。</p>
          <button className="btn primary lg" onClick={onImport}>
            导入第一个 Markdown
          </button>
        </div>
      ) : (
        <div className="grid">
          {rows.map((row) => (
            <article className="card bank-card" key={row.bank.id}>
              <header onClick={() => onOpen(row.bank.id)}>
                <h3>{row.bank.title}</h3>
                <div className="meta">
                  <span>{row.total} 题</span>
                  <span>练过 {row.attempts} 次</span>
                  {row.last !== undefined && (
                    <span className="accent">上次 {row.last}/{row.lastTotal ?? row.total}</span>
                  )}
                </div>
              </header>
              {row.bank.tags.length > 0 && (
                <div className="tags">
                  {row.bank.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <footer className="bank-actions">
                <button className="btn primary" disabled={row.total === 0} onClick={() => onQuiz(row.bank.id)}>
                  开始刷题
                </button>
                <button className="btn ghost" onClick={() => onOpen(row.bank.id)}>
                  管理
                </button>
                <button className="btn danger-ghost" onClick={() => void remove(row)}>
                  删除
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
