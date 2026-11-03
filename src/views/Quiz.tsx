import { useEffect, useRef, useState } from 'react'
import {
  db,
  drawQuestions,
  FAV_BANK_ID,
  loadDrawMode,
  loadDraft,
  REVIEW_BANK_ID,
  uid,
  WRONG_BANK_ID,
} from '../db'
import { renderInline } from '../lib/markdown'
import { isDue, needsFirstSchedule, nextReview } from '../lib/srs'
import { formatDuration, sameSet } from '../lib/util'
import {
  TYPE_LABEL,
  type AnswerMap,
  type Question,
  type QuizMode,
  type Session,
} from '../types'

export type QuizSource =
  | { kind: 'bank'; bankId: string }
  | { kind: 'wrong' }
  | { kind: 'fav' }
  | { kind: 'review' }

interface Props {
  source: QuizSource
  onFinish: (session: Session) => void
  onExit: () => void
}

const MODE_KEY = 'practice.quizMode'

function loadMode(): QuizMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'practice' ? 'practice' : 'exam'
  } catch {
    return 'exam'
  }
}

function saveMode(mode: QuizMode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 忽略：隐私模式下写不进去
  }
}

export default function Quiz({ source, onFinish, onExit }: Props) {
  const sourceKey =
    source.kind === 'bank'
      ? `bank:${source.bankId}`
      : source.kind === 'wrong'
        ? 'wrong'
        : source.kind === 'fav'
          ? 'fav'
          : 'review'

  const [bankTitle, setBankTitle] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<QuizMode>(loadMode)
  const [restored, setRestored] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const dotsRef = useRef<HTMLDivElement>(null)
  const poolRef = useRef<Question[]>([])

  // 抽题 / 恢复草稿
  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      let pool: Question[]
      let title: string
      if (source.kind === 'bank') {
        const [bank, list] = await Promise.all([
          db.banks.get(source.bankId),
          db.questions.where('bankId').equals(source.bankId).toArray(),
        ])
        pool = list
        title = bank?.title ?? ''
      } else {
        const list = await db.questions.toArray()
        if (source.kind === 'wrong') {
          pool = list.filter((q) => q.wrongCount > 0)
          title = '错题练习'
        } else if (source.kind === 'fav') {
          pool = list.filter((q) => q.fav)
          title = '收藏练习'
        } else {
          const now = Date.now()
          pool = list.filter((q) => isDue(q, now) || needsFirstSchedule(q))
          title = '今日复习'
        }
      }
      const draft = await loadDraft(sourceKey)
      if (!alive) return
      poolRef.current = pool
      setBankTitle(draft?.draft.bankTitle || title)

      if (draft) {
        setQuestions(draft.questions)
        setAnswers(draft.draft.answers ?? {})
        setFlags(new Set(draft.draft.flags ?? []))
        setIdx(Math.min(draft.draft.idx, draft.questions.length - 1))
        setMode(draft.draft.mode ?? loadMode())
        setStartedAt(draft.draft.startedAt || Date.now())
        setRestored(draft.draft.startedAt || Date.now())
      } else {
        setQuestions(drawQuestions(pool, loadDrawMode()))
        setMode(loadMode())
        setStartedAt(Date.now())
        setRestored(null)
      }
      setNow(Date.now())
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [sourceKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 计时
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // 题号条自动滚到当前题
  useEffect(() => {
    const box = dotsRef.current
    if (!box) return
    const cur = box.querySelector<HTMLElement>('.dot.current')
    if (cur) box.scrollLeft = cur.offsetLeft - box.clientWidth / 2 + cur.clientWidth / 2
  }, [idx])

  // 自动保存草稿（防抖），刷新/关页面后可以接着答
  useEffect(() => {
    if (loading || questions.length === 0) return
    const t = window.setTimeout(() => {
      void db.drafts.put({
        sourceKey,
        bankTitle,
        questionIds: questions.map((q) => q.id),
        answers,
        flags: [...flags],
        idx,
        startedAt,
        mode,
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [loading, questions, answers, flags, idx, startedAt, mode, sourceKey, bankTitle])

  // 键盘：1-9 / A-D 选选项，← → 切题，Enter 下一题，F 标记
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const cur = questions[idx]
      if (!cur) return

      const digit = Number.parseInt(e.key, 10)
      if (digit >= 1 && digit <= cur.options.length) {
        e.preventDefault()
        choose(cur, cur.options[digit - 1].key)
        return
      }
      const letter = e.key.toUpperCase()
      if (/^[A-Z]$/.test(letter) && cur.options.some((o) => o.key === letter)) {
        e.preventDefault()
        choose(cur, letter)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        if (idx < questions.length - 1) setIdx(idx + 1)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (idx > 0) setIdx(idx - 1)
        return
      }
      if (letter === 'F') {
        e.preventDefault()
        toggleFlag(cur.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function choose(q: Question, key: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? []
      if (q.type === 'multiple') {
        return { ...prev, [q.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] }
      }
      return { ...prev, [q.id]: [key] }
    })
    // 练习模式：单选/判断点完立刻揭晓；多选等用户点“对答案”
    if (mode === 'practice' && q.type !== 'multiple') {
      setRevealed((prev) => new Set(prev).add(q.id))
    }
  }

  function toggleFlag(id: string) {
    setFlags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function toggleFav(q: Question) {
    const fav = !q.fav
    setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, fav } : x)))
    await db.questions.update(q.id, { fav, updatedAt: Date.now() })
  }

  function changeMode(next: QuizMode) {
    setMode(next)
    saveMode(next)
    if (next === 'exam') setRevealed(new Set())
  }

  function restart() {
    void db.drafts.delete(sourceKey)
    setAnswers({})
    setFlags(new Set())
    setRevealed(new Set())
    setIdx(0)
    setStartedAt(Date.now())
    setRestored(null)
    setMode(loadMode())
    setQuestions(drawQuestions(poolRef.current, loadDrawMode()))
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
      bankId:
        source.kind === 'bank'
          ? source.bankId
          : source.kind === 'wrong'
            ? WRONG_BANK_ID
            : source.kind === 'fav'
              ? FAV_BANK_ID
              : REVIEW_BANK_ID,
      bankTitle,
      questionIds: questions.map((q) => q.id),
      answers,
      startedAt,
      finishedAt,
      score,
      total: questions.length,
    }
    await db.sessions.put(session)
    await db.drafts.delete(sourceKey)

    // 错题本记分：答错 +1；答对 -1（不低于 0），相当于熟悉度在回升
    // 没作答的题既不算错也不算做过
    for (const q of questions) {
      const ans = answers[q.id] ?? []
      const answeredThis = ans.length > 0
      const correct = sameSet(ans, q.answer)
      const patch: Partial<Question> = { updatedAt: finishedAt }
      if (answeredThis) patch.seenCount = (q.seenCount ?? 0) + 1
      if (correct) {
        if (q.wrongCount > 0) patch.wrongCount = q.wrongCount - 1
      } else if (answeredThis) {
        patch.wrongCount = (q.wrongCount ?? 0) + 1
        patch.lastWrongAt = finishedAt
      }
      if (answeredThis) Object.assign(patch, nextReview(q, correct, finishedAt))
      if (Object.keys(patch).length > 1) await db.questions.update(q.id, patch)
    }
    onFinish(session)
  }

  if (loading) return <div className="empty">正在抽题…</div>
  if (questions.length === 0) {
    const empty = {
      wrong: ['错题本还是空的', '先去刷题，答错的题会自动进来。', '返回错题本'],
      fav: ['收藏夹还是空的', '刷题时点右上角的 ☆ 收藏，之后在这里集中练。', '去刷题'],
      review: ['今天没有要复习的题', '做过题之后，系统会按 10 分钟→1 天→3 天→7 天 的节奏提醒你复习。', '去刷题'],
      bank: ['这个知识库还没有题目', '去添加几道题吧。', '去添加题目'],
    }[source.kind]
    return (
      <div className="empty-state">
        <h2>{empty[0]}</h2>
        <p className="muted">{empty[1]}</p>
        <button className="btn primary" onClick={onExit}>
          {empty[2]}
        </button>
      </div>
    )
  }

  const q = questions[idx]
  const selected = answers[q.id] ?? []
  const isRevealed = mode === 'practice' && revealed.has(q.id)
  const gotIt = sameSet(selected, q.answer)
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
          <div className="segmented small" role="group" aria-label="答题模式">
            <button className={mode === 'exam' ? 'active' : ''} onClick={() => changeMode('exam')}>
              考试模式
            </button>
            <button className={mode === 'practice' ? 'active' : ''} onClick={() => changeMode('practice')}>
              练习模式
            </button>
          </div>
          <span className="timer">{formatDuration(now - startedAt)}</span>
          <button className="btn primary" onClick={() => void submit()} disabled={submitting}>
            交卷
          </button>
        </div>
      </div>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {restored !== null && (
        <div className="restore-bar">
          <span>已恢复上次进度，从第 {idx + 1} 题继续。</span>
          <button className="btn ghost sm" onClick={restart}>
            重新抽题
          </button>
        </div>
      )}

      <article className="card pad question-card">
        <div className="q-head">
          <span className={`badge type-${q.type}`}>{TYPE_LABEL[q.type]}</span>
          <span className="muted small">
            第 {idx + 1} / {questions.length} 题
          </span>
          <span className="muted small">难度 {q.difficulty}</span>
          {q.wrongCount > 0 && <span className="badge warn">错过 {q.wrongCount} 次</span>}
          <button
            className={`btn ghost sm push ${q.fav ? 'fav-on' : ''}`}
            onClick={() => void toggleFav(q)}
            title="收藏到收藏夹，方便之后集中练"
          >
            {q.fav ? '★ 已收藏' : '☆ 收藏'}
          </button>
          <button
            className={`btn ghost sm ${flags.has(q.id) ? 'flagged' : ''}`}
            onClick={() => toggleFlag(q.id)}
          >
            {flags.has(q.id) ? '★ 已标记' : '☆ 标记'}
          </button>
        </div>

        <div className="stem" dangerouslySetInnerHTML={{ __html: renderInline(q.stem) }} />

        <div className="options">
          {q.options.map((o) => {
            const on = selected.includes(o.key)
            const cls = [
              'option',
              on ? 'selected' : '',
              isRevealed && q.answer.includes(o.key) ? 'correct' : '',
              isRevealed && on && !q.answer.includes(o.key) ? 'wrong' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button key={o.key} className={cls} onClick={() => choose(q, o.key)}>
                <span className="key">{o.key}</span>
                <span dangerouslySetInnerHTML={{ __html: renderInline(o.text) }} />
              </button>
            )
          })}
        </div>

        {mode === 'practice' && q.type === 'multiple' && selected.length > 0 && !isRevealed && (
          <button
            className="btn ghost sm"
            onClick={() => setRevealed((prev) => new Set(prev).add(q.id))}
          >
            对答案
          </button>
        )}

        {isRevealed && (
          <div className={`reveal ${gotIt ? 'ok' : 'bad'}`}>
            <strong>{gotIt ? '答对了' : '答错了'}</strong>
            <span className="muted small">
              正确答案 {q.answer.join('')}
              {q.explanation ? '' : ''}
            </span>
            {q.explanation && (
              <div className="explain" dangerouslySetInnerHTML={{ __html: renderInline(q.explanation) }} />
            )}
          </div>
        )}

        <p className="muted tiny">
          {q.type === 'multiple' ? '多选题：选全才得分，可多选。' : ''}
          <span className="kbd-hint">
            键盘：<kbd>1</kbd>-<kbd>4</kbd> 或 <kbd>A</kbd>-<kbd>D</kbd> 选，<kbd>←</kbd>
            <kbd>→</kbd> 切题，<kbd>F</kbd> 标记
          </span>
        </p>

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
