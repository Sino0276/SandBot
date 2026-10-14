import i18n from 'i18next'
import { create } from 'zustand'
import { showDialog } from '../editor/dialogStore'
import { LENGTH_UNITS, loadLengthUnit, saveLengthUnit, type LengthUnit } from './units'

// 고르기 전까지 쓰는 단위(FTC 필드·로봇 규격이 인치다)
const FALLBACK_UNIT: LengthUnit = 'in'

type UnitState = {
  lengthUnit: LengthUnit
  setLengthUnit: (unit: LengthUnit) => void
}

export const useUnitStore = create<UnitState>()((set) => ({
  lengthUnit: loadLengthUnit(localStorage) ?? FALLBACK_UNIT,
  setLengthUnit: (lengthUnit) => {
    saveLengthUnit(localStorage, lengthUnit)
    set({ lengthUnit })
  }
}))

// 첫 실행이면 표시 단위를 묻는다. Esc로 닫으면 저장하지 않고 다음 실행 때 다시 묻는다.
export async function askLengthUnitOnFirstRun(): Promise<void> {
  if (loadLengthUnit(localStorage)) return
  const answer = await showDialog({
    message: i18n.t('dialog.chooseLengthUnit'),
    buttons: LENGTH_UNITS.map((unit) => ({
      id: unit,
      label: i18n.t(`units.names.${unit}`),
      primary: unit === FALLBACK_UNIT
    })),
    cancelId: 'cancel'
  })
  const unit = LENGTH_UNITS.find((candidate) => candidate === answer)
  if (unit) useUnitStore.getState().setLengthUnit(unit)
}
