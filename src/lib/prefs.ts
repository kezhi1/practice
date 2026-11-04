/** 本地偏好：字号档位。0 = 标准，1 = 大，2 = 更大 */
export type FontScale = 0 | 1 | 2

const KEY = 'practice.fontScale'

export const FONT_LABEL: Record<FontScale, string> = { 0: '标准', 1: '大', 2: '更大' }

export function loadFontScale(): FontScale {
  try {
    const raw = Number.parseInt(localStorage.getItem(KEY) ?? '0', 10)
    return raw === 1 || raw === 2 ? raw : 0
  } catch {
    return 0
  }
}

export function applyFontScale(scale: FontScale) {
  document.documentElement.dataset.fs = String(scale)
}

export function saveFontScale(scale: FontScale) {
  try {
    localStorage.setItem(KEY, String(scale))
  } catch {
    // 隐私模式下写不进去，忽略
  }
  applyFontScale(scale)
}
