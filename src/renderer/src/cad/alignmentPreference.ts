import {
  DEFAULT_ALIGNMENT,
  isValidAlignment,
  AXIS_DIRECTIONS,
  type CadAlignment
} from './alignment'
import type { AxisDirection } from '../scene/model'

// 마지막으로 고른 CAD 방향을 다음 임포트의 기본값으로 쓴다(개인 설정).
const STORAGE_KEY = 'sandbot:cadAlignment'

function isAxis(value: unknown): value is AxisDirection {
  return typeof value === 'string' && (AXIS_DIRECTIONS as string[]).includes(value)
}

export function loadAlignmentPreference(storage: Pick<Storage, 'getItem'>): CadAlignment {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (saved && isAxis(saved.upAxis) && isAxis(saved.forwardAxis)) {
      const alignment = { upAxis: saved.upAxis, forwardAxis: saved.forwardAxis }
      if (isValidAlignment(alignment)) return alignment
    }
  } catch {
    // 깨진 값은 무시하고 기본값을 쓴다
  }
  return DEFAULT_ALIGNMENT
}

export function saveAlignmentPreference(
  storage: Pick<Storage, 'setItem'>,
  alignment: CadAlignment
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(alignment))
}
