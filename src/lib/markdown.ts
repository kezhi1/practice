import MarkdownIt from 'markdown-it'

export const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

/** 题干 / 解析支持行内 Markdown（加粗、代码、链接） */
export function renderInline(text: string): string {
  return md.renderInline(text)
}
