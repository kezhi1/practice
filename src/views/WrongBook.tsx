import { useEffect, useMemo, useState } from 'react'
import { db } from '../db'
import { renderInline } from '../lib/markdown'
import { TYPE_LABEL, type Bank, type Question } from '../types'

interface Props {
  onBack: () => void
  onPractice: (bankId?: string) => void
  onOpenBank: (bankId: string) => void
}

type SortKey = 'count' | 'recent' | 'bank'

export default function WrongBook({ onBack, onPractice, onOpenBank }: Props) {
  const [rows, setRows] = useState<{ q: Question; bank?: Bank }[]>([])
  const [loading, setLoading] = useState(true)
  const [bankFilter, setBankFilter] = useState('all')
  const [sort, setSort] = useState<SortKey>('count')
  const [q, setQ] = useState('')

  async function load() {
    const [questions, banks] = await Promise.all([
      db.questions.toArray(),
      db.banks.toArray(),
    ])
    const bankMap = new Map(banks.map((b) => [b.id, b]))
    const wrong = questions
      .filter((item) => item.wrongCount > 0)
      .map((item) => ({ q: item, bank: bankMap.get(item.bankId) }))
    setRows(wrong)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let list = rows
    if (bankFilter !== 'all') list = list.filter((r) => r.q.bankId === bankFilter)
    if (kw) {
      list = list.filter(
        (r) =>
          r.q.stem.toLowerCase().includes(kw) ||
          r.q.options.some((o) => o.text.toLowerCase().includes(kw)),
      )
    }
    const sorted = [...list]
    if (sort === 'count') {
      sorted.sort((a, b) => b.q.wrongCount - a.q.wrongCount || (b.q.lastWrongAt ?? 0) - (a.q.lastWrongAt ?? 0))
    } else if (sort === 'recent') {
      sorted.sort((a, b) => (b.q.lastWrongAt ?? 0) - (a.q.lastWrongAt ?? 0))
    } else {
      sorted.sort(
        (a, b) =>
          (a.bank?.title ?? '').localeCompare(b.bank?.title ?? '', 'zh') ||
          b.q.wrongCount - a.q.wrongCount,
      )
    }
    return sorted
  }, [rows, bankFilter, q, sort])

  const totalWrong = rows.reduce((n, r) => n + r.q.wrongCount, 0)
  const bankCount = new Set(rows.map((r) => r.q.bankId)).size
  const bankOptions = useMemo(() => {
    const map = new Map<string, string>()
    rows.forEach((r) => map.set(r.q.bankId, r.bank?.title ?? '未知知识库'))
    return [...map.entries()]
  }, [rows])

  // 「开始错题练习」跟着知识库筛选走：选了某个库就只练这个库的错题
  const scopedCount =
    bankFilter === 'all' ? rows.length : rows.filter((r) => r.q.bankId === bankFilter).length

  async function master(id: string) {
    await db.questions.update(id, { wrongCount: 0 })
    setRows((prev) => prev.filter((r) => r.q.id !== id))
  }

  async function masterAll() {
    if (!window.confirm(`把当前 ${filtered.length} 道错题都标为已掌握？`)) return
    await db.transaction('rw', db.questions, async () => {
      for (const row of filtered) await db.questions.update(row.q.id, { wrongCount: 0 })
    })
    await load()
  }

  if (loading) return <div className="empty">加载中…</div>

  return (
    <section>
      <div className="row between wrap">
        <div>
          <button className="btn ghost sm" onClick={onBack}>
            ← 全部知识库
          </button>
          <h1 className="page-title">错题本</h1>
          <p className="muted">
            {rows.length > 0
              ? `${rows.length} 道错题 · 累计错 ${totalWrong} 次 · 来自 ${bankCount} 个知识库`
              : '答错的题会自动收进来，答对一次就少一次。'}
          </p>
        </div>
        <div className="row gap">
          {filtered.length > 0 && (
            <button className="btn ghost" onClick={() => void masterAll()}>
              全部标为已掌握
            </button>
          )}
          <button
            className="btn primary"
            disabled={scopedCount === 0}
            onClick={() => onPractice(bankFilter === 'all' ? undefined : bankFilter)}
          >
            开始错题练习{scopedCount ? `（${Math.min(50, scopedCount)} 题）` : ''}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state card">
          <h2>错题本还是空的</h2>
          <p className="muted">去刷几套题，答错的会自动进来；答对一次错题次数就 -1。</p>
        </div>
      ) : (
        <>
          <div className="card pad toolbar">
            <input
              className="input"
              placeholder="搜索错题题干或选项…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="select" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
              <option value="all">全部知识库</option>
              {bankOptions.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
            <div className="segmented">
              <button className={sort === 'count' ? 'active' : ''} onClick={() => setSort('count')}>
                错得最多
              </button>
              <button className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}>
                最近错
              </button>
              <button className={sort === 'bank' ? 'active' : ''} onClick={() => setSort('bank')}>
                按知识库
              </button>
            </div>
            <span className="muted small">{filtered.length} 道</span>
          </div>

          <div className="wrong-list">
            {filtered.map(({ q: item, bank }) => (
              <article className="card pad wrong-item" key={item.id}>
                <div className="q-head">
                  <span className={`badge type-${item.type}`}>{TYPE_LABEL[item.type]}</span>
                  <button className="chip" onClick={() => onOpenBank(item.bankId)}>
                    {bank?.title ?? '未知知识库'}
                  </button>
                  <span className="badge danger">错 {item.wrongCount} 次</span>
                  {item.lastWrongAt && (
                    <span className="muted tiny">最近 {new Date(item.lastWrongAt).toLocaleDateString()}</span>
                  )}
                  <span className="push" />
                  <button className="btn ghost sm" onClick={() => void master(item.id)}>
                    标为已掌握
                  </button>
                </div>
                <div className="stem sm" dangerouslySetInnerHTML={{ __html: renderInline(item.stem) }} />
                <div className="options compact">
                  {item.options.map((o) => (
                    <span key={o.key} className={`opt-chip ${item.answer.includes(o.key) ? 'right' : ''}`}>
                      {o.key}. {o.text}
                    </span>
                  ))}
                </div>
                <p className="muted small">
                  答案 {item.answer.slice().sort().join('')}
                  {item.explanation && ` · ${item.explanation}`}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
