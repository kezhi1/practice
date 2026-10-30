import { useEffect, useState } from 'react'
import { db, WRONG_BANK_ID } from './db'
import type { Session } from './types'
import Banks from './views/Banks'
import ImportView from './views/ImportView'
import BankDetail from './views/BankDetail'
import Quiz, { type QuizSource } from './views/Quiz'
import Result from './views/Result'
import WrongBook from './views/WrongBook'

export type View =
  | { name: 'banks' }
  | { name: 'import' }
  | { name: 'wrong' }
  | { name: 'detail'; bankId: string }
  | { name: 'quiz'; source: QuizSource }
  | { name: 'result'; session: Session }

export default function App() {
  const [view, setView] = useState<View>({ name: 'banks' })
  const [wrongCount, setWrongCount] = useState(0)

  useEffect(() => {
    let alive = true
    void db.questions.toArray().then((list) => {
      if (alive) setWrongCount(list.filter((q) => q.wrongCount > 0).length)
    })
    return () => {
      alive = false
    }
  }, [view])

  const toBanks = () => setView({ name: 'banks' })
  const toWrong = () => setView({ name: 'wrong' })

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
            onExit={() =>
              view.source.kind === 'bank'
                ? setView({ name: 'detail', bankId: view.source.bankId })
                : toWrong()
            }
            onFinish={(session) => setView({ name: 'result', session })}
          />
        )}
        {view.name === 'result' && (
          <Result
            session={view.session}
            onRetry={() =>
              setView({
                name: 'quiz',
                source:
                  view.session.bankId === WRONG_BANK_ID
                    ? { kind: 'wrong' }
                    : { kind: 'bank', bankId: view.session.bankId },
              })
            }
            onBack={() => (view.session.bankId === WRONG_BANK_ID ? toWrong() : toBanks())}
            backLabel={view.session.bankId === WRONG_BANK_ID ? '返回错题本' : '返回知识库'}
          />
        )}
      </main>
    </div>
  )
}
