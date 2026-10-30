import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parser'

const ok = (md: string, title = 'T') => {
  const r = parseMarkdown(md, title)
  const errors = r.issues.filter((i) => i.level === 'error')
  expect(errors.map((e) => `第${e.line}行 ${e.message}`)).toEqual([])
  return r
}

describe('解析：基本格式', () => {
  it('标准模板能解析出 3 题', () => {
    const md = `---
title: 计算机网络
tags: [网络, 面试]
---

## 1. TCP 三次握手第三次的作用？

- A. 确认双方序列号
- B. 建立连接
- C. 防止旧连接请求
- D. 协商窗口

> 答案：A
> 解析：让服务端确认客户端收到了 SYN+ACK。

## 2. 哪些是应用层协议？

- A. HTTP
- B. TCP
- C. DNS
- D. IP

> 答案：A,C

## 3. 交换机工作在数据链路层。

- A. 正确
- B. 错误

> 答案：对
`
    const r = ok(md)
    expect(r.title).toBe('计算机网络')
    expect(r.tags).toEqual(['网络', '面试'])
    expect(r.questions).toHaveLength(3)
    expect(r.questions.map((q) => q.type)).toEqual(['single', 'multiple', 'judge'])
    expect(r.questions[0].answer).toEqual(['A'])
    expect(r.questions[1].answer).toEqual(['A', 'C'])
    expect(r.questions[2].answer).toEqual(['A'])
  })

  it('### 级别标题也认', () => {
    const r = ok(`### 题干一\n- A. 甲\n- B. 乙\n> 答案：B\n\n### 题干二\n- A. 甲\n- B. 乙\n> 答案：A`)
    expect(r.questions).toHaveLength(2)
  })

  it('没有标题时按 1. 2. 编号分题', () => {
    const r = ok(`1. 第一题的题干？\nA. 甲\nB. 乙\n答案：A\n\n2. 第二题的题干？\nA. 甲\nB. 乙\n答案：B`)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].stem).toContain('第一题')
    expect(r.questions[1].answer).toEqual(['B'])
  })
})

describe('解析：各种宽容写法', () => {
  it('选项：(A) 内容 / A、内容 / - A、内容 都能认', () => {
    const r = ok(`## 题干\n(A) 甲\nB、乙\n- C、丙\n> 答案：B`)
    expect(r.questions[0].options.map((o) => `${o.key}${o.text}`)).toEqual(['A甲', 'B乙', 'C丙'])
  })

  it('答案：**答案：A** / 【答案】A,B / 正确答案是 B', () => {
    const one = ok(`## q1\n- A. 甲\n- B. 乙\n**答案：A**`)
    expect(one.questions[0].answer).toEqual(['A'])

    const two = ok(`## q2\n- A. 甲\n- B. 乙\n- C. 丙\n【答案】A,B`)
    expect(two.questions[0].type).toBe('multiple')

    const three = ok(`## q3\n- A. 甲\n- B. 乙\n正确答案是 B`)
    expect(three.questions[0].answer).toEqual(['B'])
  })

  it('多选连写 AB 会被拆成 A + B', () => {
    const r = ok(`## q\n- A. 甲\n- B. 乙\n- C. 丙\n> 答案：AB`)
    expect(r.questions[0].answer).toEqual(['A', 'B'])
    expect(r.questions[0].type).toBe('multiple')
  })

  it('判断题不写选项，答案 对/错 时自动补 A.正确 B.错误', () => {
    const r = ok(`## 交换机是二层设备。\n> 答案：对`)
    expect(r.questions[0].options.map((o) => o.text)).toEqual(['正确', '错误'])
    expect(r.questions[0].answer).toEqual(['A'])
    expect(r.questions[0].type).toBe('judge')
    expect(r.issues.some((i) => i.level === 'warn' && i.message.includes('自动补'))).toBe(true)
  })

  it('代码块里的 ## 和 - A. 不会被当成新题', () => {
    const md = `## 下面代码的输出是？\n\n\`\`\`python\n## 这不是标题\n- A. 也不是选项\nprint(1)\n\`\`\`\n\n- A. 1\n- B. 2\n> 答案：A`
    const r = ok(md)
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].stem).toContain('这不是标题')
    expect(r.questions[0].options).toHaveLength(2)
  })

  it('> 类型：多选 可以显式指定题型', () => {
    const r = ok(`## q\n- A. 甲\n- B. 乙\n- C. 丙\n> 答案：A\n> 类型：多选`)
    // 只有一个答案却声明多选：给出 warn，但仍然导入
    expect(r.questions[0].type).toBe('multiple')
    expect(r.issues.some((i) => i.level === 'warn')).toBe(true)
  })

  it('解析行可以写多行，也接受 分析：', () => {
    const r = ok(`## q\n- A. 甲\n- B. 乙\n> 答案：A\n> 解析：第一行\n> 第二行\n分析：补充`)
    expect(r.questions[0].explanation).toContain('第一行')
    expect(r.questions[0].explanation).toContain('补充')
  })
})

describe('解析：报错与边界', () => {
  it('缺答案会报错并指出行号', () => {
    const r = parseMarkdown(`## 题干\n- A. 甲\n- B. 乙`, 'T')
    const err = r.issues.find((i) => i.level === 'error')
    expect(err?.message).toContain('缺少答案')
    expect(err?.line).toBe(1)
    expect(r.questions).toHaveLength(0)
  })

  it('答案不在选项里会报错', () => {
    const r = parseMarkdown(`## 题干\n- A. 甲\n- B. 乙\n> 答案：D`, 'T')
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('不在选项里'))).toBe(true)
  })

  it('选项不足两个会报错', () => {
    const r = parseMarkdown(`## 题干\n- A. 甲\n> 答案：A`, 'T')
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('选项不足'))).toBe(true)
  })

  it('空文件给出明确错误', () => {
    const r = parseMarkdown('   \n\n', 'T')
    expect(r.issues[0].line).toBe(1)
    expect(r.questions).toHaveLength(0)
  })

  it('CRLF 与 BOM 不影响解析', () => {
    const md = '\uFEFF## 题干\r\n- A. 甲\r\n- B. 乙\r\n> 答案：B\r\n'
    const r = ok(md)
    expect(r.questions[0].answer).toEqual(['B'])
  })
})
