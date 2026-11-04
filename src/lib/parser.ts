import type { Option, ParseIssue, ParseResult, ParsedQuestion, QType } from '../types'

/* ------------------------------------------------------------------ *
 * 宽容解析：一行可能有多种写法，这里按「由严到宽」依次尝试。
 * 所有规则集中在本文件，配套测试在 parser.test.ts。
 * ------------------------------------------------------------------ */

const FENCE_RE = /^\s*(```|~~~)/
const HEADING_RE = /^\s*(#{1,4})\s+(.+?)\s*#*\s*$/
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
/** 1. / 1．/ 1、/ 1) / （1） 都能当题号；句点后允许没有空格 */
const NUMBERED_RE = /^\s*(?:\*\*)?(?:[（(]\s*\d+\s*[）)]|\d+\s*[.．、)）])\s*(?:\*\*)?(.+?)\s*$/
/** - (A) 内容 / (A) 内容 */
const BRACKET_OPT_RE = /^\s*(?:[-*+]\s+)?[（(【]\s*([A-Za-z])\s*[)）】]\s*[.．、:：]?\s*(.+?)\s*$/
/** - A. 内容 / - A、内容 / A. 内容 / A：内容 */
const SIMPLE_OPT_RE = /^\s*(?:[-*+]\s+)?([A-Za-z])\s*[.．、)）:：]\s*(.+?)\s*$/
/** - A 内容（只在选项区内部认，避免误伤普通列表） */
const LOOSE_OPT_RE = /^\s*[-*+]\s+([A-Za-z])[\s、]+(.+?)\s*$/

function matchOption(raw: string, allowLoose: boolean): { key: string; text: string } | null {
  const m = BRACKET_OPT_RE.exec(raw) ?? SIMPLE_OPT_RE.exec(raw) ?? (allowLoose ? LOOSE_OPT_RE.exec(raw) : null)
  if (!m) return null
  return { key: m[1].toUpperCase(), text: m[2].trim() }
}

const JUDGE_WORDS = /^(对|错|正确|错误|是|否|√|×|✓|✗|t|f|true|false)$/i
const LETTER_TOKEN = /^[A-Za-z]{1,6}$/

/** 「答案速查表」「附录」这类标题后面整段都不算题目 */
const NOISE_HEADING_RE =
  /^(?:参考)?答案(?:速查|汇总|表)?$|答案速查|解析汇总|附录|目录|前言|后记|版权/

/** 全角字母/数字、全角空格、不换行空格统一成半角，避免 `Ａ．` 这类写法认不出 */
function normalizeWidths(line: string): string {
  return line
    .replace(/[\u3000\u00a0]/g, ' ')
    // 只把全角字母/数字转半角；全角标点（（）：？等）必须保持原样
    .replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
}

/** 整篇被 ```markdown 包住时，把外层围栏拆掉再解析（AI 输出常见） */
function stripOuterFence(content: string): { text: string; stripped: boolean } {
  const lines = content.split('\n')
  let first = 0
  while (first < lines.length && !lines[first].trim()) first++
  let last = lines.length - 1
  while (last > first && !lines[last].trim()) last--
  if (first >= last) return { text: content, stripped: false }

  const open = /^\s*(`{3}|~{3})\s*[A-Za-z]*\s*$/.exec(lines[first])
  if (!open) return { text: content, stripped: false }
  const close = /^\s*(`{3}|~{3})\s*$/.exec(lines[last])
  if (!close || close[1] !== open[1]) return { text: content, stripped: false }

  const inner = lines.slice(first + 1, last)
  // 里面必须真的像题目，否则可能只是把一段代码包起来了
  const looksLikeQuestions = inner.some((l) => HEADING_RE.test(l) || NUMBERED_RE.test(l))
  if (!looksLikeQuestions) return { text: content, stripped: false }
  return { text: inner.join('\n'), stripped: true }
}

/** 一行塞了多个选项：`A. 甲  B. 乙  C. 丙`（Word/AI 输出常见） */
const INLINE_OPT_RE = /(?<=^|[\s\u4e00-\u9fa5])([A-H])\s*[.．、)）:：]\s*/g

function splitInlineOptions(raw: string): { key: string; text: string }[] | null {
  const line = raw.replace(/^\s*[-*+]\s+/, '')
  const matches: { key: string; start: number; end: number }[] = []
  const re = new RegExp(INLINE_OPT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    matches.push({ key: m[1], start: m.index, end: re.lastIndex })
  }
  if (matches.length < 2) return null

  // 必须是从某个字母开始的连续字母序列，排除普通句子里碰巧出现的「A.」
  const first = matches[0].key.charCodeAt(0)
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].key.charCodeAt(0) !== first + i) return null
  }

  const options: { key: string; text: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].start : line.length
    const text = line.slice(matches[i].end, end).trim()
    if (!text) return null
    options.push({ key: matches[i].key, text })
  }
  return options
}

function isPositiveJudge(token: string): boolean {
  return /^(对|正确|是|√|✓|t|true|y|yes)$/i.test(token)
}

/** 判断题答案按「正/负」语义落到选项上，而不是死认 A=对 */
function judgeKeyFor(options: Option[], token: string): string | undefined {
  const positive = isPositiveJudge(token)
  const hit = options.find((o) => isPositiveJudge(o.text) === positive)
  return hit?.key
}

/** 答案写成选项原文时回填成字母（只在唯一匹配时认，宁可报错也不乱猜） */
function matchAnswerByText(options: Option[], token: string): string | undefined {
  const norm = (v: string) => v.replace(/[\s，。,.;；、'"“”‘’()（）]/g, '').trim()
  const target = norm(token)
  if (!target) return undefined
  const exact = options.filter((o) => norm(o.text) === target)
  if (exact.length === 1) return exact[0].key
  const loose = options.filter((o) => norm(o.text).includes(target) || target.includes(norm(o.text)))
  return loose.length === 1 ? loose[0].key : undefined
}

/** 题目整体被包在一个 ``` 里（AI 常见）：拆出里面的内容，顺便把外面的 H1 当标题 */
function unwrapQuestionFence(text: string): { text: string; stripped: boolean; title?: string } {
  const lines = text.split('\n')
  const regions: { start: number; end: number }[] = []
  let open = -1
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_RE.test(lines[i])) continue
    if (open === -1) open = i
    else {
      regions.push({ start: open + 1, end: i })
      open = -1
    }
  }
  if (!regions.length) return { text, stripped: false }

  // 只认「## 及其以下」的标题或编号题；`# 总标题` 和「## 答案速查表」这类不算题目
  const looksLikeQuestions = (ls: string[]) =>
    ls.some((l) => {
      const h = HEADING_RE.exec(l)
      if (h) {
        if (NOISE_HEADING_RE.test(h[2].trim())) return false
        return h[1].length >= 2
      }
      return NUMBERED_RE.test(l)
    })

  const outside = lines.filter((_, i) => !regions.some((r) => i > r.start - 1 && i < r.end + 1))
  if (looksLikeQuestions(outside)) return { text, stripped: false }

  const candidate = regions.filter((r) => looksLikeQuestions(lines.slice(r.start, r.end)))
  if (candidate.length !== 1) return { text, stripped: false }

  const inner = lines.slice(candidate[0].start, candidate[0].end).join('\n')
  const h1 = lines.find((l) => /^#\s+\S/.test(l))
  return { text: inner, stripped: true, title: h1?.replace(/^#\s+/, '').trim() }
}

function joinLine(a: string, b: string): string {
  const cjk = /[\u4e00-\u9fa5，。；：、（）]/
  return cjk.test(a.slice(-1)) && cjk.test(b.slice(0, 1)) ? `${a}${b}` : `${a} ${b}`
}

interface Draft {
  line: number
  stem: string[]
  options: Option[]
  answerRaw: string
  explanation: string[]
  difficulty?: number
  tags: string[]
  typeHint?: QType
  /** 用户显式写了不认识的题型，按“有疑问就拒收”处理 */
  badType?: string
}

function stripInlineFormatting(line: string): string {
  return line
    .replace(/^[\s>|]+/, '')
    .replace(/\*\*/g, '')
    .replace(/^【([^】]*)】/, '$1 ')
    .trim()
}

interface Meta {
  key: 'answer' | 'explanation' | 'difficulty' | 'type' | 'tags'
  value: string
}

/** 识别 `> 答案：A`、`**答案** A,B`、`【解析】…`、`正确答案是 B`、`难度：3` 等 */
function readMeta(raw: string): Meta | null {
  const clean = stripInlineFormatting(raw)
  if (!clean) return null

  let m: RegExpExecArray | null

  m = /^(正确答案|参考答案|标准答案|答案)\s*(?:是|为)?\s*[：:]\s*(.*)$/.exec(clean)
  if (!m) m = /^(正确答案|参考答案|标准答案|答案)\s*(?:是|为)\s*(.*)$/.exec(clean)
  if (!m) m = /^(正确答案|参考答案|标准答案|答案)\s+([A-Za-z对错正误√×✓✗].*)$/.exec(clean)
  if (m) return { key: 'answer', value: m[2].trim() }

  m = /^(答案解析|解析|分析|说明)\s*[：:]\s*(.*)$/.exec(clean)
  if (!m) m = /^(答案解析|解析|分析)\s+(.+)$/.exec(clean)
  if (m) return { key: 'explanation', value: m[2].trim() }

  m = /^难度\s*[：:]?\s*([1-5一二三四五])\s*$/.exec(clean)
  if (m) return { key: 'difficulty', value: m[1] }

  m = /^(类型|题型)\s*[：:]?\s*(.+)$/.exec(clean)
  if (m) return { key: 'type', value: m[2].trim() }

  m = /^(标签|tag|tags)\s*[：:]\s*(.*)$/i.exec(clean)
  if (m) return { key: 'tags', value: m[2].trim() }

  return null
}

function normalizeType(raw: string): QType | undefined {
  const v = raw.trim().toLowerCase()
  if (/^(单选|单项选择题?|single|1)$/.test(v)) return 'single'
  if (/^(多选|多项选择题?|不定项|multiple|multi)$/.test(v)) return 'multiple'
  if (/^(判断|判断题|judge|bool|tf)$/.test(v)) return 'judge'
  return undefined
}

function normalizeDifficulty(raw: string): number {
  const table: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }
  if (table[raw]) return table[raw]
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 2
}

function splitTags(raw: string): string[] {
  return raw
    .replace(/^[[{]|[\]}]$/g, '')
    .split(/[,，、\s]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

/** 拆答案：A、B / AB / A,B / A 和 B / 对 / 错 */
function splitAnswerTokens(raw: string, optionCount: number): string[] {
  const cleaned = raw.replace(/[。.;；]$/g, '').trim()
  const parts = cleaned.split(/[,，、;；/\s]+|和|与/).filter(Boolean)
  const tokens: string[] = []
  for (const part of parts) {
    if (JUDGE_WORDS.test(part)) {
      tokens.push(part.toUpperCase() === 'T' ? '对' : part.toUpperCase() === 'F' ? '错' : part)
      continue
    }
    if (LETTER_TOKEN.test(part)) {
      // AB / ACD 这种连写，逐字母拆开（仅当选项存在且数量匹配）
      if (part.length > 1 && optionCount >= part.length) {
        tokens.push(...part.toUpperCase().split(''))
      } else {
        tokens.push(part.toUpperCase())
      }
      continue
    }
    tokens.push(part.toUpperCase())
  }
  return tokens
}

function isJudgeOptions(options: Option[]): boolean {
  return options.length === 2 && options.every((o) => JUDGE_WORDS.test(o.text.trim()))
}

function isJudgeWord(token: string): boolean {
  return JUDGE_WORDS.test(token)
}

function parseFrontMatter(lines: string[]): { title?: string; tags: string[]; bodyStart: number } {
  // 允许 BOM / 空行开头
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (lines[i]?.trim() !== '---') return { tags: [], bodyStart: 0 }
  const start = i
  let end = -1
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---') {
      end = j
      break
    }
  }
  if (end === -1) return { tags: [], bodyStart: 0 }

  let title: string | undefined
  let tags: string[] = []
  for (let j = start + 1; j < end; j++) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[j])
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'title' || key === 'name') title = value.replace(/^["']|["']$/g, '')
    if (key === 'tags' || key === 'tag') tags = splitTags(value)
  }
  return { title, tags, bodyStart: end + 1 }
}

/**
 * 分节标题（`## 一、单项选择题`、`# 第一章 概述`）不是题目，只是下面编号题的组名。
 * 判断方法：往后看第一段有效内容——先遇到选项/答案，说明这行是题干；先遇到下一个标题或
 * 编号题，说明它只是个分节标题。
 */
function looksLikeSectionTitle(lines: string[], headingLine: number): boolean {
  let fence = false
  for (let i = headingLine + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (FENCE_RE.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const t = raw.trim()
    if (!t || HR_RE.test(t)) continue
    if (HEADING_RE.test(t)) return true
    if (NUMBERED_RE.test(t)) return true
    if (matchOption(t, true) || readMeta(t)) return false
    // 普通正文（多行题干）给一点余量，太远就当题干
    if (i - headingLine > 6) return false
  }
  return false
}

/** 找出每道题的起始行 */
function findStarts(lines: string[], from: number): { line: number; text: string }[] {
  const inFence = (line: string, state: boolean) => (FENCE_RE.test(line) ? !state : state)

  const headingStarts: { line: number; text: string }[] = []
  const numberedStarts: { line: number; text: string }[] = []
  const numberedInSection: { line: number; text: string }[] = []
  let section = false
  let noise = false
  let fence = false

  for (let i = from; i < lines.length; i++) {
    const raw = lines[i]
    if (FENCE_RE.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) continue
    if (noise) continue

    const h = HEADING_RE.exec(raw)
    if (h) {
      // 「## 答案速查表」这类标题之后的内容都不是题目
      if (NOISE_HEADING_RE.test(h[2].trim())) {
        noise = true
        section = false
        continue
      }
      if (looksLikeSectionTitle(lines, i)) {
        section = true
        continue
      }
      section = false
      // 标题里的题号（`## 1. 题干`）和编号题一样，不算进题干
      const hm = NUMBERED_RE.exec(h[2].trim())
      headingStarts.push({ line: i, text: hm ? hm[1].trim() : h[2].trim() })
      continue
    }
    const n = NUMBERED_RE.exec(raw)
    if (n) {
      const start = { line: i, text: n[1].trim() }
      numberedStarts.push(start)
      if (section) numberedInSection.push(start)
    }
  }
  void inFence

  if (headingStarts.length) {
    // 有分节标题时，节内的编号题也要算题目
    if (numberedInSection.length) {
      return [...headingStarts, ...numberedInSection].sort((a, b) => a.line - b.line)
    }
    return headingStarts
  }
  if (numberedStarts.length) return numberedStarts
  // 既没有标题也没有编号：整篇当一道题
  const first = lines.findIndex((l, idx) => idx >= from && l.trim())
  return first === -1 ? [] : [{ line: first, text: '' }]
}

export function parseMarkdown(content: string, fallbackTitle = '未命名知识库'): ParseResult {
  const issues: ParseIssue[] = []
  const questions: ParsedQuestion[] = []

  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const fenced = stripOuterFence(normalized)
  const unwrapped = fenced.stripped
    ? { text: fenced.text, stripped: false, title: undefined as string | undefined }
    : unwrapQuestionFence(fenced.text)
  if (unwrapped.stripped) {
    issues.push({
      line: 1,
      message: '题目被包在代码块（```）里，已自动拆开再解析',
      level: 'warn',
    })
  } else if (fenced.stripped) {
    issues.push({ line: 1, message: '整篇被代码块包住了，已自动拆开再解析', level: 'warn' })
  }
  const lines = unwrapped.text.split('\n').map(normalizeWidths)
  const front = parseFrontMatter(lines)
  const docTitle = front.title?.trim() || unwrapped.title || fallbackTitle

  const starts = findStarts(lines, front.bodyStart)

  // 第一题之前的内容（「以下是整理后的题目：」这类开场白）直接丢掉，但告诉用户
  if (starts.length > 0 && starts[0].line > front.bodyStart) {
    const ignored = lines
      .slice(front.bodyStart, starts[0].line)
      .filter((l, offset) => {
        if (!l.trim() || FENCE_RE.test(l)) return false
        // 分节标题（`## 一、单项选择题`）和「答案速查表」本来就不是题，不算「被忽略的内容」
        const idx = front.bodyStart + offset
        if (HEADING_RE.test(l)) return !looksLikeSectionTitle(lines, idx)
        return true
      })
    if (ignored.length > 0) {
      issues.push({
        line: front.bodyStart + 1,
        message: `开头 ${ignored.length} 行不是题目，已忽略（第一题从第 ${starts[0].line + 1} 行开始）`,
        level: 'warn',
      })
    }
  }
  if (starts.length === 0) {
    return {
      title: docTitle,
      tags: front.tags,
      questions,
      issues: [{ line: 1, message: '文件是空的，没有可导入的题目', level: 'error' }],
    }
  }

  const segments = starts.map((s, i) => ({
    startLine: s.line,
    heading: s.text,
    body: lines.slice(s.line + (s.text ? 1 : 0), i + 1 < starts.length ? starts[i + 1].line : lines.length),
  }))

  for (const seg of segments) {
    const draft: Draft = {
      line: seg.startLine,
      stem: seg.heading ? [seg.heading] : [],
      options: [],
      answerRaw: '',
      explanation: [],
      tags: [],
    }
    let fence = false
    let sawOptions = false
    let lastBlank = true

    for (let k = 0; k < seg.body.length; k++) {
      const raw = seg.body[k]
      const lineNo = seg.startLine + 1 + k

      if (FENCE_RE.test(raw)) {
        fence = !fence
        if (sawOptions) draft.explanation.push(raw)
        else draft.stem.push(raw)
        continue
      }

      if (fence) {
        // 代码块原样保留（含 ## / - A. 这类“像题目”的行）
        if (sawOptions) draft.explanation.push(raw)
        else draft.stem.push(raw)
        continue
      }

      if (!raw.trim()) {
        lastBlank = true
        continue
      }

      // 分隔线：只当空行处理（front matter 已单独处理）
      if (HR_RE.test(raw)) continue

      const meta = readMeta(raw)
      if (meta) {
        if (meta.key === 'answer') draft.answerRaw = meta.value
        else if (meta.key === 'explanation') draft.explanation.push(meta.value)
        else if (meta.key === 'difficulty') draft.difficulty = normalizeDifficulty(meta.value)
        else if (meta.key === 'tags') draft.tags = splitTags(meta.value)
        else if (meta.key === 'type') {
          const t = normalizeType(meta.value)
          if (t) draft.typeHint = t
          else draft.badType = meta.value
        }
        continue
      }

      // 一行塞了多个选项：`A. 甲  B. 乙  C. 丙`
      const inline = splitInlineOptions(raw)
      if (inline && inline.length >= 2) {
        draft.options.push(...inline)
        sawOptions = true
        lastBlank = false
        continue
      }

      const opt = matchOption(raw, draft.options.length > 0)
      if (opt) {
        draft.options.push(opt)
        sawOptions = true
        lastBlank = false
        continue
      }

      // 折行：上一行是选项、中间没空行、这一行明显是它的续行，就接上去
      if (sawOptions && !lastBlank && draft.options.length > 0) {
        const prev = draft.options[draft.options.length - 1]
        const tail = prev.text.slice(-1)
        const continuesPunct = /[，,、（(：:]/.test(tail)
        const looksFragment = raw.trim().length <= 24 && !/[。．.！？!?；;]$/.test(raw.trim())
        if (continuesPunct || looksFragment) {
          prev.text = joinLine(prev.text, raw.trim())
          continue
        }
      }

      // 其余内容：选项前算题干，选项后算解析
      if (sawOptions) draft.explanation.push(raw.replace(/^[\s>]+/, '').trim())
      else draft.stem.push(raw.trim())
    }

    questions.push(...finalizeDraft(draft, issues))
  }

  if (!questions.length && !issues.some((x) => x.level === 'error')) {
    issues.push({ line: 1, message: '没有解析出任何题目', level: 'error' })
  }

  return {
    title: docTitle,
    tags: front.tags,
    questions,
    issues,
  }
}

function finalizeDraft(draft: Draft, issues: ParseIssue[]): ParsedQuestion[] {
  const line = draft.line + 1
  const stem = draft.stem
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!stem) {
    issues.push({ line, message: '题干为空，已跳过这一题', level: 'error' })
    return []
  }
  const short = stem.slice(0, 20).replace(/\n/g, ' ')

  // 「（单选）题干」「【多选】题干」这种题型前缀：剥掉，顺便当题型提示
  let typeHint = draft.typeHint
  let cleanStem = stem
  const typePrefix = /^\s*[\[（(【]\s*(单项选择|多项选择|单选|多选|不定项|判断|填空)\s*[\]）)】]\s*/.exec(stem)
  if (typePrefix) {
    const t = normalizeType(typePrefix[1])
    if (t && !typeHint) typeHint = t
    cleanStem = stem.slice(typePrefix[0].length).trim()
  }
  // 题尾的「（多选）」「【判断】」也一样：剥掉并当题型提示
  const typeSuffix = /[\s　]*[\[（(【]\s*(单项选择|多项选择|单选|多选|不定项|判断|填空)\s*[\]）)】]\s*$/.exec(cleanStem)
  if (typeSuffix) {
    const t = normalizeType(typeSuffix[1])
    if (t && !typeHint) typeHint = t
    cleanStem = cleanStem.slice(0, typeSuffix.index).trim()
  }

  let options = draft.options
  let answerRaw = draft.answerRaw.trim()

  // A1：答案直接写在题干末尾 —— `下列说法正确的是（B）` / `（AB）`
  if (!answerRaw) {
    const tail = /(?:[（(]\s*([A-Ha-h]{1,4})\s*[)）])[\s　]*$/.exec(cleanStem)
    if (tail) {
      const candidate = tail[1].toUpperCase()
      answerRaw = candidate
      cleanStem = cleanStem.slice(0, tail.index).trim()
    }
  }

  // 判断题允许不写选项：答案是对/错时自动补 A.正确 / B.错误
  if (!options.length) {
    if (answerRaw && isJudgeWord(splitAnswerTokens(answerRaw, 0)[0] ?? '')) {
      options = [
        { key: 'A', text: '正确' },
        { key: 'B', text: '错误' },
      ]
      issues.push({ line, message: `「${short}…」判断题未写选项，已自动补 A.正确 / B.错误`, level: 'warn' })
    } else {
      issues.push({ line, message: `「${short}…」缺少选项（用 - A. 内容 逐行书写）`, level: 'error' })
      return []
    }
  }
  if (options.length < 2) {
    issues.push({ line, message: `「${short}…」选项不足 2 个`, level: 'error' })
    return []
  }
  if (!answerRaw) {
    issues.push({ line, message: `「${short}…」缺少答案（> 答案：A）`, level: 'error' })
    return []
  }

  const keys = new Set(options.map((o) => o.key))
  const judge = isJudgeOptions(options)
  const tokens = splitAnswerTokens(answerRaw, options.length)

  const answer: string[] = []
  for (const token of tokens) {
    if (isJudgeWord(token) && judge) {
      // A2：按正/负语义落到选项上，不假设 A 就是「对」
      answer.push(judgeKeyFor(options, token) ?? (isPositiveJudge(token) ? 'A' : 'B'))
      continue
    }
    if (keys.has(token)) {
      answer.push(token)
      continue
    }
    // A5：答案写的是选项原文（「答案：风险分析」）→ 唯一匹配时回填字母
    const byText = matchAnswerByText(options, token)
    if (byText) {
      answer.push(byText)
      continue
    }
    // AB 连写但选项表里没有 B？先提示，再按单字母处理
    issues.push({
      line,
      message: `「${short}…」答案「${token}」不在选项里（可选 ${options.map((o) => o.key).join('/')}）`,
      level: 'error',
    })
    return []
  }

  const unique = Array.from(new Set(answer))
  if (!unique.length) {
    issues.push({ line, message: `「${short}…」答案为空`, level: 'error' })
    return []
  }
  if (unique.length !== answer.length) {
    issues.push({ line, message: `「${short}…」答案有重复项，已去重`, level: 'warn' })
  }

  if (draft.badType) {
    issues.push({
      line,
      message: `「${short}…」不认识的题型「${draft.badType}」（只支持 单选 / 多选 / 判断），这一题已跳过`,
      level: 'error',
    })
    return []
  }

  const type: QType = typeHint ?? (judge ? 'judge' : unique.length > 1 ? 'multiple' : 'single')

  // 宽容但不在“意思”上猜：题型和答案个数打架时，宁可拒收也不擅自改判
  if (type === 'judge' && unique.length > 1) {
    issues.push({ line, message: `「${short}…」判断题只能有一个答案`, level: 'error' })
    return []
  }
  if (type === 'single' && unique.length > 1) {
    issues.push({
      line,
      message: `「${short}…」标成单选却给了 ${unique.length} 个答案（${unique.join('')}），是单选还是多选？确认后补一行「> 类型：多选」再导入`,
      level: 'error',
    })
    return []
  }
  if (type === 'multiple' && unique.length < 2) {
    issues.push({
      line,
      message: `「${short}…」标成多选却只有一个答案，是在刷单选吗？确认后改类型再导入`,
      level: 'error',
    })
    return []
  }

  return [
    {
      type,
      stem: cleanStem,
      options,
      answer: unique,
      explanation: draft.explanation.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      difficulty: draft.difficulty ?? 2,
      tags: draft.tags,
      line,
    },
  ]
}

export const TEMPLATE_MARKDOWN = `---
title: 计算机网络基础
tags: [网络, 面试]
---

## 1. TCP 三次握手中，第三次握手的作用是？

- A. 确认双方序列号
- B. 建立连接
- C. 防止旧连接请求
- D. 协商窗口大小

> 答案：A
> 解析：第三次握手让服务端确认客户端收到了自己的 SYN+ACK。
> 难度：2

## 2. 下列哪些协议是应用层协议？

- A. HTTP
- B. TCP
- C. DNS
- D. IP

> 答案：A,C
> 类型：多选

## 3. 交换机工作在数据链路层。

- A. 正确
- B. 错误

> 答案：对
> 类型：判断
`
