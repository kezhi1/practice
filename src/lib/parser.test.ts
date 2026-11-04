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

  it('> 类型：多选 可以显式指定题型（答案个数要匹配）', () => {
    const r = ok(`## q\n- A. 甲\n- B. 乙\n- C. 丙\n> 答案：A,B\n> 类型：多选`)
    expect(r.questions[0].type).toBe('multiple')
    expect(r.questions[0].answer).toEqual(['A', 'B'])
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

describe('解析：有疑问就拒收（严格模式）', () => {
  it('标成单选却给多个答案 → 报错，不擅自改成多选', () => {
    const r = parseMarkdown(`## q\n- A. 甲\n- B. 乙\n- C. 丙\n> 答案：A,B\n> 类型：单选`, 'T')
    expect(r.questions).toHaveLength(0)
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('单选还是多选'))).toBe(true)
  })

  it('标成多选却只有一个答案 → 报错', () => {
    const r = parseMarkdown(`## q\n- A. 甲\n- B. 乙\n> 答案：A\n> 类型：多选`, 'T')
    expect(r.questions).toHaveLength(0)
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('只有一个答案'))).toBe(true)
  })

  it('不认识的题型 → 报错', () => {
    const r = parseMarkdown(`## q\n- A. 甲\n- B. 乙\n> 答案：A\n> 类型：填空`, 'T')
    expect(r.questions).toHaveLength(0)
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('不认识的题型'))).toBe(true)
  })

  it('一题报错不影响其它题导入', () => {
    const r = parseMarkdown(`## 好题\n- A. 甲\n- B. 乙\n> 答案：A\n\n## 坏题\n- A. 甲\n- B. 乙\n> 答案：C`, 'T')
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].stem).toContain('好题')
    expect(r.issues.some((i) => i.level === 'error')).toBe(true)
  })
})

describe('解析：编号式（题库导出最常见的那种）', () => {
  it('1. 题干 + - A. 选项 + > 答案：A', () => {
    const md = `1. 下列说法正确的是（）
- A. 公安网是独立的大型城域网，与其他网络是物理隔离的
- B. 公安网与党政网是相通的
- C. 公安网内没有计算机病毒
- D. 公安网上可以建游戏网站

> 答案：A

2. 以下哪一项用作计算机开机密码相对最安全（）
- A. 0.123456
- B. a3zx0.31
- C. 88888778.0
- D. mmm12345

> 答案：A`

    const r = ok(md)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].stem).toBe('下列说法正确的是（）')
    expect(r.questions[0].options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D'])
    expect(r.questions[0].type).toBe('single')
    expect(r.questions[0].answer).toEqual(['A'])
    expect(r.questions[1].stem).toContain('开机密码')
  })

  it('全角句点、句点后没空格、括号编号都算题号', () => {
    const md = `1．第一题（）
A．甲
B．乙
答案：B

（2）第二题？
A、甲
B、乙
答案：A`
    const r = ok(md)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].stem).toBe('第一题（）')
    expect(r.questions[0].answer).toEqual(['B'])
    expect(r.questions[1].stem).toBe('第二题？')
    expect(r.questions[1].answer).toEqual(['A'])
  })

  it('题干前的（单选）/【多选】当作题型提示并剥掉', () => {
    const single = ok(`1. （单选）三加二等于几？
A. 4
B. 5
答案：B`)
    expect(single.questions[0].stem).toBe('三加二等于几？')
    expect(single.questions[0].type).toBe('single')

    const multi = ok(`1. 【多选】哪些是水果？
A. 苹果
B. 白菜
C. 香蕉
答案：A,C`)
    expect(multi.questions[0].stem).toBe('哪些是水果？')
    expect(multi.questions[0].type).toBe('multiple')
  })

  it('题尾的（多选）也剥掉，但空括号（）保留', () => {
    const r = ok(`1. 下列哪些是水果？（多选）
A. 苹果
B. 白菜
答案：A,B

2. 下列说法正确的是（）
A. 甲
B. 乙
答案：A`)
    expect(r.questions[0].stem).toBe('下列哪些是水果？')
    expect(r.questions[0].type).toBe('multiple')
    // 空括号是题干的一部分，不能当成题型标记吃掉
    expect(r.questions[1].stem).toBe('下列说法正确的是（）')
    expect(r.questions[1].type).toBe('single')
  })
})

describe('解析：分节标题 + 编号题', () => {
  it('「## 一、单项选择题」是分节标题，不当成题干', () => {
    const md = `## 一、单项选择题

1. Chinese Wall 模型的设计宗旨是：
- A. 用户只能访问哪些与已经拥有的信息不冲突的信息
- B. 用户可以访问所有信息
- C. 用户可以访问所有已经选择的信息
- D. 用户不可以访问哪些没有选择的信息

> 答案：A

2. 安全责任分配的基本原则是：
- A. “三分靠技术，七分靠管理”
- B. “七分靠技术，三分靠管理”
- C. “谁主管，谁负责”
- D. 防火墙技术

> 答案：C

3. 保证计算机信息运行的安全……以下（）不属于信息运行安全技术的范畴
- A. 风险分析
- B. 审计跟踪技术
- C. 应急技术
- D. 防火墙技术

> 答案：B
`
    const r = ok(md)
    expect(r.questions).toHaveLength(3)
    expect(r.questions[0].stem).toBe('Chinese Wall 模型的设计宗旨是：')
    expect(r.questions[0].answer).toEqual(['A'])
    expect(r.questions[1].stem).toBe('安全责任分配的基本原则是：')
    expect(r.questions[1].answer).toEqual(['C'])
    expect(r.questions[2].stem).toContain('以下（）不属于信息运行安全技术的范畴')
    expect(r.questions[2].type).toBe('single')
    // 分节标题不能出现在任何题干的里
    expect(r.questions.some((q) => q.stem.includes('单项选择题'))).toBe(false)
  })

  it('多行章节标题（# 第一章 概述）也不会吞掉后面的编号题', () => {
    const md = `# 第一章 概述

这一章讲基础概念。

1. 第一题
A. 甲
B. 乙
答案：A

2. 第二题
A. 甲
B. 乙
答案：B
`
    const r = ok(md)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].stem).toBe('第一题')
  })

  it('标题就是题干时照旧（标题后直接跟选项）', () => {
    const md = `## 1. 题干在标题里

- A. 甲
- B. 乙

> 答案：A`
    const r = ok(md)
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].stem).toBe('题干在标题里')
  })
})
