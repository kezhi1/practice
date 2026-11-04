import { useEffect, useState } from 'react'
import { db, FAV_BANK_ID, REVIEW_BANK_ID, WRONG_BANK_ID } from './db'
import { isDue } from './lib/srs'
import { applyFontScale, loadFontScale } from './lib/prefs'
import { parseHash, sourceOfKey, sourceKeyOf, toHash, type Route } from './lib/router'
import type { Session } from './types'
import Banks from './views/Banks'
import ImportView from './views/ImportView'
import BankDetail from './views/BankDetail'
import Quiz, { type QuizSource } from './views/Quiz'
import Result from './views/Result'
import History from './views/History'
import WrongBook from './views/WrongBook'
import Review from './views/Review'

/** 伪知识库 id → 回到哪个页面 / 那里叫什么 */
const PSEUDO = {
  [WRONG_BANK_ID]: { view: 'wrong', label: '返回错题本' },
  [FAV_BANK_ID]: { view: 'review', label: '返回复习' },
  [REVIEW_BANK_ID]: { view: 'review', label: '返回复习' },
} as const

type PseudoKey = keyof typeof PSEUDO

function pseudoOf(bankId: string): (typeof PSEUDO)[PseudoKey] | undefined {
  return (PSEUDO as Record<string, (typeof PSEUDO)[PseudoKey]>)[bankId]
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const [wrongCount, setWrongCount] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  const [session, setSession] = useState<Session | null>(null)

  // 字号偏好：写进 <html data-fs>，题库/刷题/结果页共用
  useEffect(() => {
    applyFontScale(loadFontScale())
  }, [])

  // hash ↔ 页面：刷新、前进后退、直接粘链接都能落到同一页
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', toHash(parseHash('')))
    }
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function go(next: Route) {
    const hash = toHash(next)
    if (window.location.hash === hash) setRoute(next)
    else window.location.hash = hash
  }

  /** 替换当前历史记录：交卷后不希望「后退」又回到那套题 */
  function replace(next: Route) {
    window.history.replaceState(null, '', toHash(next))
    setRoute(next)
  }

  useEffect(() => {
    let alive = true
    void db.questions.toArray().then((list) => {
      if (!alive) return
      const now = Date.now()
      setWrongCount(list.filter((q) => q.wrongCount > 0).length)
      setDueCount(list.filter((q) => isDue(q, now)).length)
    })
    return () => {
      alive = false
    }
  }, [route])

  // 结果页可能来自刷新/直接打开链接，按 id 从库里取那一次记录
  useEffect(() => {
    if (route.name !== 'result') return
    let alive = true
    void db.sessions.get(route.sessionId).then((s) => {
      if (alive) setSession(s ?? null)
    })
    return () => {
      alive = false
    }
  }, [route])

  const toBanks = () => go({ name: 'banks' })
  const toWrong = () => go({ name: 'wrong' })
  const toReview = () => go({ name: 'review' })

  function exitQuiz(source: QuizSource) {
    go(routeOfSource(source))
  }

  function routeOfSource(source: QuizSource): Route {
    if (source.kind === 'bank') return { name: 'bank', bankId: source.bankId }
    if (source.kind === 'wrong') return { name: 'wrong' }
    return { name: 'review' }
  }

  function retrySource(bankId: string): QuizSource {
    if (bankId === WRONG_BANK_ID) return { kind: 'wrong' }
    if (bankId === FAV_BANK_ID) return { kind: 'fav' }
    if (bankId === REVIEW_BANK_ID) return { kind: 'review' }
    return { kind: 'bank', bankId }
  }

  const quizSource = route.name === 'quiz' ? sourceOfKey(route.sourceKey) : null

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={toBanks}>
          刷题<span>Practice</span>
        </button>
        <div className="topbar-actions">
          <button className={`btn ghost ${route.name === 'wrong' ? 'is-active' : ''}`} onClick={toWrong}>
            错题本
            {wrongCount > 0 && <span className="nav-count">{wrongCount}</span>}
          </button>
          <button className={`btn ghost ${route.name === 'review' ? 'is-active' : ''}`} onClick={toReview}>
            复习
            {dueCount > 0 && <span className="nav-count">{dueCount}</span>}
          </button>
          <button
            className={`btn ghost ${route.name === 'history' ? 'is-active' : ''}`}
            onClick={() => go({ name: 'history' })}
          >
            练习历史
          </button>
          <button className="btn ghost" onClick={toBanks}>
            知识库
          </button>
          <button className="btn primary" onClick={() => go({ name: 'import' })}>
            + 导入<span className="wide-only"> Markdown</span>
          </button>
        </div>
      </header>

      <main className="container">
        {route.name === 'banks' && (
          <Banks
            onOpen={(bankId) => go({ name: 'bank', bankId })}
            onQuiz={(bankId) => go({ name: 'quiz', sourceKey: `bank:${bankId}` })}
            onImport={() => go({ name: 'import' })}
          />
        )}
        {route.name === 'import' && (
          <ImportView
            onDone={(bankId) => go({ name: 'bank', bankId })}
            onCancel={toBanks}
          />
        )}
        {route.name === 'wrong' && (
          <WrongBook
            onBack={toBanks}
            onPractice={() => go({ name: 'quiz', sourceKey: 'wrong' })}
            onOpenBank={(bankId) => go({ name: 'bank', bankId })}
          />
        )}
        {route.name === 'review' && (
          <Review
            onBack={toBanks}
            onQuizReview={() => go({ name: 'quiz', sourceKey: 'review' })}
            onQuizFav={() => go({ name: 'quiz', sourceKey: 'fav' })}
          />
        )}
        {route.name === 'history' && (
          <History
            onBack={toBanks}
            onOpen={(s) => go({ name: 'result', sessionId: s.id, fromHistory: true })}
          />
        )}
        {route.name === 'bank' && (
          <BankDetail
            bankId={route.bankId}
            onBack={toBanks}
            onQuiz={() => go({ name: 'quiz', sourceKey: `bank:${route.bankId}` })}
          />
        )}
        {route.name === 'quiz' && quizSource && (
          <Quiz
            source={quizSource}
            onExit={() => exitQuiz(quizSource)}
            onFinish={(s) => replace({ name: 'result', sessionId: s.id })}
          />
        )}
        {route.name === 'result' && (
          session && session.id === route.sessionId ? (
            <Result
              session={session}
              onRetry={() => go({ name: 'quiz', sourceKey: sourceKeyOf(retrySource(session.bankId)) })}
              onBack={() => {
                if (route.fromHistory) return go({ name: 'history' })
                const pseudo = pseudoOf(session.bankId)
                if (pseudo) return go({ name: pseudo.view })
                toBanks()
              }}
              backLabel={
                route.fromHistory
                  ? '返回练习历史'
                  : pseudoOf(session.bankId)?.label ?? '返回知识库'
              }
            />
          ) : (
            <div className="empty">{session ? '这次记录不存在' : '正在读取记录…'}</div>
          )
        )}
      </main>
    </div>
  )
}
