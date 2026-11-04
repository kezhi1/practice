import { useEffect, useState } from 'react'
import { DRAW_MODE_LABEL, db, deleteBank, listBanks, loadDrawMode, saveDrawMode, type DrawMode } from '../db'
import type { Bank, Session } from '../types'

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
  const [drawMode, setDrawMode] = useState<DrawMode>(loadDrawMode)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')

  function changeDrawMode(mode: DrawMode) {
    setDrawMode(mode)
    saveDrawMode(mode)
  }

  async function load() {
    const [banks, questions, sessions] = await Promise.all([
      listBanks(),
      db.questions.toArray(),
      db.sessions.toArray(),
    ])
    // 一次遍历汇总，避免每个题库各扫一遍全表（题库多了就是 O(n×m)）
    const counts = new Map<string, number>()
    for (const q of questions) counts.set(q.bankId, (counts.get(q.bankId) ?? 0) + 1)

    const attempts = new Map<string, number>()
    const latest = new Map<string, Session>()
    for (const s of sessions) {
      attempts.set(s.bankId, (attempts.get(s.bankId) ?? 0) + 1)
      const prev = latest.get(s.bankId)
      if (!prev || s.finishedAt > prev.finishedAt) latest.set(s.bankId, s)
    }

    setRows(
      banks.map((bank) => {
        const last = latest.get(bank.id)
        return {
          bank,
          total: counts.get(bank.id) ?? 0,
          attempts: attempts.get(bank.id) ?? 0,
          last: last?.score,
          lastTotal: last?.total,
        }
      }),
    )
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  function startRename(row: Row) {
    setNameDraft(row.bank.title)
    setRenamingId(row.bank.id)
  }

  async function saveName(id: string) {
    const title = nameDraft.trim()
    if (!title) {
      window.alert('知识库名字不能为空。')
      return
    }
    await db.banks.update(id, { title, updatedAt: Date.now() })
    // 练习记录里存的是当时的名字，一并改掉
    await db.sessions.where('bankId').equals(id).modify({ bankTitle: title })
    setRenamingId(null)
    await load()
  }

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
          <p className="muted">导入 Markdown 建立题库，每次练习抽 50 题。</p>
        </div>
        {rows.length > 0 && (
          <div className="row gap">
            <span className="muted small">抽题</span>
            <div className="segmented small" role="group" aria-label="抽题策略">
              {(['random', 'unseen', 'weak'] as DrawMode[]).map((m) => (
                <button
                  key={m}
                  className={drawMode === m ? 'active' : ''}
                  onClick={() => changeDrawMode(m)}
                >
                  {DRAW_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        )}
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
              <header
                onClick={() => {
                  setRenamingId(null)
                  onOpen(row.bank.id)
                }}
              >
                {renamingId === row.bank.id ? (
                  <div className="rename-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="input rename-input-sm"
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveName(row.bank.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                    <button className="btn primary sm" onClick={() => void saveName(row.bank.id)}>
                      保存
                    </button>
                    <button className="btn ghost sm" onClick={() => setRenamingId(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <h3>{row.bank.title}</h3>
                )}
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
                <button className="btn ghost sm" onClick={() => onOpen(row.bank.id)}>
                  管理
                </button>
                <button className="btn ghost sm" onClick={() => startRename(row)}>
                  重命名
                </button>
                <button className="btn danger-ghost sm" onClick={() => void remove(row)}>
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
