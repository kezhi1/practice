/**
 * 极简 hash 路由：`#/bank/xxx`、`#/quiz/bank:xxx`、`#/result/<sessionId>`…
 * 之所以不用 react-router：页面只有 8 个，加一个依赖不值当。
 */
export type Route =
  | { name: 'banks' }
  | { name: 'import' }
  | { name: 'wrong' }
  | { name: 'review' }
  | { name: 'history' }
  | { name: 'bank'; bankId: string }
  | { name: 'quiz'; sourceKey: string }
  | { name: 'result'; sessionId: string; fromHistory?: boolean }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').replace(/\/+$/, '')
  if (!raw) return { name: 'banks' }
  const [head, ...rest] = raw.split('/')
  switch (head) {
    case 'import':
      return { name: 'import' }
    case 'wrong':
      return { name: 'wrong' }
    case 'review':
      return { name: 'review' }
    case 'history':
      return { name: 'history' }
    case 'bank':
      return rest[0] ? { name: 'bank', bankId: decodeURIComponent(rest[0]) } : { name: 'banks' }
    case 'quiz':
      return rest[0] ? { name: 'quiz', sourceKey: decodeURIComponent(rest[0]) } : { name: 'banks' }
    case 'result':
      return rest[0]
        ? {
            name: 'result',
            sessionId: decodeURIComponent(rest[0]),
            fromHistory: rest[1] === 'from-history',
          }
        : { name: 'banks' }
    default:
      return { name: 'banks' }
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'banks':
      return '#/banks'
    case 'import':
      return '#/import'
    case 'wrong':
      return '#/wrong'
    case 'review':
      return '#/review'
    case 'history':
      return '#/history'
    case 'bank':
      return `#/bank/${encodeURIComponent(route.bankId)}`
    case 'quiz':
      // 保留 `bank:` 里的冒号可读性，其余字符照常转义
      return `#/quiz/${encodeURIComponent(route.sourceKey).replace(/%3A/g, ':')}`
    case 'result':
      return `#/result/${encodeURIComponent(route.sessionId)}${route.fromHistory ? '/from-history' : ''}`
  }
}

/** 刷题源 → sourceKey（`bank:<id>` / `wrong` / `fav` / `review`） */
export function sourceKeyOf(source: import('../views/Quiz').QuizSource): string {
  return source.kind === 'bank' ? `bank:${source.bankId}` : source.kind
}

export function sourceOfKey(key: string): import('../views/Quiz').QuizSource {
  if (key.startsWith('bank:')) return { kind: 'bank', bankId: key.slice('bank:'.length) }
  if (key === 'wrong') return { kind: 'wrong' }
  if (key === 'fav') return { kind: 'fav' }
  return { kind: 'review' }
}
