import { useEffect, useState } from 'react'
import { db, FAV_BANK_ID, REVIEW_BANK_ID, WRONG_BANK_ID } from './db'
import { isDue } from './lib/srs'
import type { Session } from './types'
import Banks from './views/Banks'
import ImportView from './views/ImportView'
import BankDetail from './views/BankDetail'
import Quiz, { type QuizSource } from './views/Quiz'
import Result from './views/Result'
import History from './views/History'
import WrongBook from './views/WrongBook'
import Review from './views/Review'

export type View =
  | { name: 'banks' }
  | { name: 'import' }
  | { name: 'wrong' }
  | { name: 'review' }
  | { name: 'history' }
  | { name: 'detail'; bankId: string }
  | { name: 'quiz'; source: QuizSource }
  | { name: 'result'; session: Session; fromHistory?: boolean }

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
  const [view, setView] = useState<View>({ name: 'banks' })
  const [wrongCount, setWrongCount] = useState(0)
  const [dueCount, setDueCount] = useState(0)

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
  }, [view])

  const toBanks = () => setView({ name: 'banks' })
  const toWrong = () => setView({ name: 'wrong' })
  const toReview = () => setView({ name: 'review' })

  function exitQuiz(source: QuizSource) {
    if (source.kind === 'bank') setView({ name: 'detail', bankId: source.bankId })
    else if (source.kind === 'wrong') toWrong()
    else toReview()
  }

  function retrySource(bankId: string): QuizSource {
    if (bankId === WRONG_BANK_ID) return { kind: 'wrong' }
    if (bankId === FAV_BANK_ID) return { kind: 'fav' }
    if (bankId === REVIEW_BANK_ID) return { kind: 'review' }
    return { kind: 'bank', bankId }
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={toBanks}>
          刷题<span>Practice</span>
        </button>
        <div className="topbar-actions">
          <button
            className={`btn ghost ${view.name === 'wrong' ? 'is-active' : ''}`}
            onClick={toWrong}
          >
            错题本
            {wrongCount > 0 && <span className="nav-count">{wrongCount}</span>}
          </button>
          <button
            className={`btn ghost ${view.name === 'review' ? 'is-active' : ''}`}
            onClick={toReview}
          >
            复习
            {dueCount > 0 && <span className="nav-count">{dueCount}</span>}
          </button>
          <button
            className={`btn ghost ${view.name === 'history' ? 'is-active' : ''}`}
            onClick={() => setView({ name: 'history' })}
          >
            练习历史
          </button>
          <button className="btn ghost" onClick={toBanks}>
            知识库
          </button>
          <button className="btn primary" onClick={() => setView({ name: 'import' })}>
            + 导入 Markdown
          </button>
        </div>
      </header>

      <main className="container">
        {view.name === 'banks' && (
          <Banks
            onOpen={(bankId) => setView({ name: 'detail', bankId })}
            onQuiz={(bankId) => setView({ name: 'quiz', source: { kind: 'bank', bankId } })}
            onImport={() => setView({ name: 'import' })}
          />
        )}
        {view.name === 'import' && (
          <ImportView
            onDone={(bankId) => setView({ name: 'detail', bankId })}
            onCancel={toBanks}
          />
        )}
        {view.name === 'wrong' && (
          <WrongBook
            onBack={toBanks}
            onPractice={() => setView({ name: 'quiz', source: { kind: 'wrong' } })}
            onOpenBank={(bankId) => setView({ name: 'detail', bankId })}
          />
        )}
        {view.name === 'review' && (
          <Review
            onBack={toBanks}
            onQuizReview={() => setView({ name: 'quiz', source: { kind: 'review' } })}
            onQuizFav={() => setView({ name: 'quiz', source: { kind: 'fav' } })}
          />
        )}
        {view.name === 'history' && (
          <History
            onBack={toBanks}
            onOpen={(session) => setView({ name: 'result', session, fromHistory: true })}
          />
        )}
        {view.name === 'detail' && (
          <BankDetail
            bankId={view.bankId}
            onBack={toBanks}
            onQuiz={() => setView({ name: 'quiz', source: { kind: 'bank', bankId: view.bankId } })}
          />
        )}
        {view.name === 'quiz' && (
          <Quiz
            source={view.source}
            onExit={() => exitQuiz(view.source)}
            onFinish={(session) => setView({ name: 'result', session })}
          />
        )}
        {view.name === 'result' && (
          <Result
            session={view.session}
            onRetry={() =>
              setView({ name: 'quiz', source: retrySource(view.session.bankId) })
            }
            onBack={() => {
              if (view.fromHistory) return setView({ name: 'history' })
              const pseudo = pseudoOf(view.session.bankId)
              if (pseudo) return setView({ name: pseudo.view } as View)
              toBanks()
            }}
            backLabel={
              view.fromHistory
                ? '返回练习历史'
                : pseudoOf(view.session.bankId)?.label ?? '返回知识库'
            }
          />
        )}
      </main>
    </div>
  )
}
