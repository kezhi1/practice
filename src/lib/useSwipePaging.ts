import { useEffect, useRef } from 'react'

export interface SwipePagingOptions {
  onNext: () => void
  onPrev: () => void
  canNext: boolean
  canPrev: boolean
  /** 当前题号：外部换题（点答题卡 / 键盘 / 按钮）时清掉可能残留的位移 */
  resetKey: number
  /** 是否接管手势；交卷中、确认弹窗打开时关掉 */
  enabled: boolean
  /** 成功翻页后回调（用来收起首次提示） */
  onPaged?: (dir: -1 | 1) => void
}

const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
/** 判定成「滑动」而不是「点按」的最小位移 */
const DRAG_START = 8
/** 屏幕左右边缘留给系统返回手势，不接管 */
const EDGE = 24
const EXIT_MS = 120
const ENTER_MS = 170
const SNAP_MS = 160

/**
 * 手机端左右滑动翻题。
 *
 * 只认 pointerType=touch，桌面鼠标完全不受影响；
 * 逐帧直接改 el.style.transform，不 setState，避免整页重渲染。
 */
export function useSwipePaging<T extends HTMLElement>(opts: SwipePagingOptions) {
  const ref = useRef<T | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const animatingRef = useRef(false)
  /** 拖动松手后浏览器还会补发一次 click，用它拦掉，避免误选选项 */
  const suppressRef = useRef(false)
  const lastResetRef = useRef(opts.resetKey)

  // 外部换题：清掉可能残留的位移（自身翻页动画期间不动，交给动画收尾）
  useEffect(() => {
    if (lastResetRef.current === opts.resetKey) return
    lastResetRef.current = opts.resetKey
    const el = ref.current
    if (!el || animatingRef.current) return
    el.style.transition = ''
    el.style.transform = ''
    el.style.opacity = ''
  }, [opts.resetKey])

  useEffect(() => {
    if (!ref.current || !opts.enabled) return
    const el = ref.current as T

    let pid: number | null = null
    let startX = 0
    let startY = 0
    let startT = 0
    let lastT = 0
    let axis: 'none' | 'x' | 'y' = 'none'
    let moved = 0
    const timers: number[] = []

    const reduceMotion = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const width = () => el.clientWidth || window.innerWidth || 320

    function clearStyles() {
      el.style.transition = ''
      el.style.transform = ''
      el.style.opacity = ''
    }

    function later(fn: () => void, ms: number) {
      timers.push(window.setTimeout(fn, ms))
    }

    function blockNextClick() {
      // 只拦「这次滑动手势自己带出来的那一下点击」：
      // 下一次 pointerdown（真正的新点按）会把它清掉，
      // 所以滑完紧接着点选项不会被吞掉。
      suppressRef.current = true
    }

    function onClickCapture(e: MouseEvent) {
      if (!suppressRef.current) return
      suppressRef.current = false
      e.preventDefault()
      e.stopPropagation()
    }

    /** 没滑够 / 到头了：弹回原位 */
    function snapBack() {
      animatingRef.current = true
      el.classList.remove('is-swiping')
      el.style.transition = `transform ${SNAP_MS}ms ${EASE}, opacity ${SNAP_MS}ms ${EASE}`
      el.style.transform = 'translate3d(0, 0, 0)'
      el.style.opacity = '1'
      later(() => {
        animatingRef.current = false
        clearStyles()
      }, SNAP_MS + 20)
    }

    /** 滑出 → 换题 → 从另一侧滑入 */
    function page(dir: -1 | 1) {
      animatingRef.current = true
      const reduce = reduceMotion()
      const out = dir * width() * 1.12
      const exit = reduce ? 0 : EXIT_MS

      el.classList.remove('is-swiping')
      if (!reduce) {
        el.style.transition = `transform ${EXIT_MS}ms ${EASE}, opacity ${EXIT_MS}ms ${EASE}`
        el.style.transform = `translate3d(${out}px, 0, 0)`
        el.style.opacity = '0'
      }

      later(() => {
        if (dir === 1) optsRef.current.onNext()
        else optsRef.current.onPrev()
        optsRef.current.onPaged?.(dir)

        if (reduce) {
          clearStyles()
          animatingRef.current = false
          return
        }

        // 新题从另一侧就位，再滑进来
        el.style.transition = 'none'
        el.style.transform = `translate3d(${-out}px, 0, 0)`
        el.style.opacity = '0'
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = `transform ${ENTER_MS}ms ${EASE}, opacity ${ENTER_MS}ms ${EASE}`
            el.style.transform = 'translate3d(0, 0, 0)'
            el.style.opacity = '1'
            later(() => {
              animatingRef.current = false
              clearStyles()
            }, ENTER_MS + 20)
          })
        })
      }, exit)
    }

    function onPointerDown(e: PointerEvent) {
      // 新的点按开始：上一次滑动残留的点击拦截到此为止
      suppressRef.current = false
      // 鼠标 / 触控笔走原来的点击逻辑；只接管手指
      if (e.pointerType !== 'touch') return
      if (!e.isPrimary) return
      if (animatingRef.current) return
      if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return
      const target = e.target as Element | null
      // 题号条自己横向滚动，别抢它的手势
      if (target?.closest('.dots')) return
      pid = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startT = lastT = e.timeStamp
      axis = 'none'
      moved = 0
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // 指针已经抬起（极快的点按），忽略
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (pid === null || e.pointerId !== pid) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (axis === 'none') {
        if (Math.abs(dx) < DRAG_START && Math.abs(dy) < DRAG_START) return
        // 上下为主：交还给浏览器滚动，整段手势都不再介入
        if (Math.abs(dy) > Math.abs(dx)) {
          axis = 'y'
          return
        }
        axis = 'x'
        el.classList.add('is-swiping')
        el.style.transition = 'none'
      }
      if (axis !== 'x') return
      moved = Math.max(moved, Math.abs(dx))
      lastT = e.timeStamp
      const { canNext, canPrev } = optsRef.current
      // 第一题再往右 / 最后一题再往左：阻尼，拉得动但拉不走
      const blocked = (dx < 0 && !canNext) || (dx > 0 && !canPrev)
      const x = blocked ? dx * 0.26 : dx
      el.style.transform = `translate3d(${x}px, 0, 0)`
      el.style.opacity = String(Math.max(0.55, 1 - (Math.abs(x) / width()) * 0.5))
    }

    function onPointerUp(e: PointerEvent) {
      if (pid === null || e.pointerId !== pid) return
      pid = null
      const horizontal = axis === 'x'
      axis = 'none'
      el.classList.remove('is-swiping')
      if (el.hasPointerCapture(e.pointerId)) {
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {
          // 已经释放
        }
      }
      if (!horizontal) return

      const dx = e.clientX - startX
      const speed = Math.abs(dx) / Math.max(1, lastT - startT)
      const threshold = Math.min(120, Math.max(56, width() * 0.2))
      const { canNext, canPrev } = optsRef.current
      const far = Math.abs(dx) >= threshold
      const flung = Math.abs(dx) > 36 && speed > 0.45
      if (moved > DRAG_START) blockNextClick()

      if (dx < 0 && (far || flung) && canNext) return page(1)
      if (dx > 0 && (far || flung) && canPrev) return page(-1)
      snapBack()
    }

    function onPointerCancel(e: PointerEvent) {
      if (pid === null || e.pointerId !== pid) return
      pid = null
      const horizontal = axis === 'x'
      axis = 'none'
      if (horizontal) snapBack()
      else el.classList.remove('is-swiping')
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('click', onClickCapture, true)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      el.removeEventListener('click', onClickCapture, true)
      for (const t of timers) window.clearTimeout(t)
      timers.length = 0
      animatingRef.current = false
      suppressRef.current = false
      el.classList.remove('is-swiping')
      clearStyles()
    }
  }, [opts.enabled])

  return { ref }
}