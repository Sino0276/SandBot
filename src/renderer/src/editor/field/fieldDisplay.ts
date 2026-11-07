import type { TFunction } from 'i18next'
import type { SeasonId } from '../../../../shared/sim/seasons/fieldSpec'
import { isSeasonId } from '../../../../shared/sim/seasons/seasons'
import { seasonLabelKey } from '../../field/fieldLabels'
import { looseT } from '../../hardware/labels'
import type { HiveSide, HiveState } from '../../play/playSettings'
import { isRunActive, usePlayStore, type PlayRun } from '../../play/playStore'
import type { FieldDoc } from '../../scene/fieldDoc'

// 씬 뷰·Field 인스펙터·시작 표시·로봇 "시작 위치"가 보는 필드(spec-4ab §1.9). setHiveSide 말고는 순수 함수다.

// 실행이 필드를 잠그는가(한곳): 활성이고 새 씬과 떼어 놓지 않은 실행. 그동안 씬 뷰·Field 인스펙터는 실행의 시즌·HIVE
// 상태(run.field)를 보이고, 시즌·HIVE·시작 위치를 고칠 수 없다. 실행 중 실행 취소로 문서 시즌이 달라질 수 있다(한계).
export function runLocksField(run: PlayRun | null): run is PlayRun {
  return isRunActive(run) && !run.detached
}

export type DisplayedField = { season: SeasonId; hiveTipped: readonly [boolean, boolean] }

// 문서 시즌(모르는 문자열이면 'none'으로 그린다)
export function documentSeasonId(doc: FieldDoc): SeasonId {
  return isSeasonId(doc.season) ? doc.season : 'none'
}

export function hiveTippedOf(hiveState: HiveState): [boolean, boolean] {
  return [hiveState.red === 'tipped', hiveState.blue === 'tipped']
}

// 실행이 잠근 필드(run.field 그 객체, 잠그지 않으면 null). 텔레메트리·장치마다 run이 새 객체가 되어도 run.field는 그대로라
// 씬 뷰 필드가 이것만 구독하면 실행 중 다시 그리지 않는다
export function lockedRunField(run: PlayRun | null): DisplayedField | null {
  return runLocksField(run) ? run.field : null
}

// 잠기지 않았을 때 그리는 필드: 문서 시즌과 개인 실행 설정
export function documentField(doc: FieldDoc, hiveState: HiveState): DisplayedField {
  return { season: documentSeasonId(doc), hiveTipped: hiveTippedOf(hiveState) }
}

// 씬 뷰가 그리는 시즌과 HIVE 상태: 실행이 잠갔으면 실행의 것, 아니면 문서 시즌과 개인 실행 설정
export function displayedField(
  run: PlayRun | null,
  doc: FieldDoc,
  hiveState: HiveState
): DisplayedField {
  return lockedRunField(run) ?? documentField(doc, hiveState)
}

// 시즌 이름(알려진 시즌은 field.seasons.<id>, 모르는 문자열은 field.unknownSeason)
export function seasonName(season: string, t: TFunction): string {
  return isSeasonId(season)
    ? looseT(t)(seasonLabelKey(season))
    : t('field.unknownSeason', { season })
}

// 하이어라키 맨 위 Field 줄의 글자
export function fieldRowLabel(season: string, t: TFunction): string {
  return t('hierarchy.fieldRow', { season: seasonName(season, t) })
}

// Field 인스펙터의 HIVE 상태 칸: 개인 실행 설정(sandbot:playSettings)을 바꾼다. 문서·실행 취소·dirty와 무관하고, 실행 중이
// 아니면 씬 뷰가 바로 따르고 시뮬레이터는 다음 INIT부터다(환경 설정 › 시뮬레이션의 같은 칸과 같은 값)
export function setHiveSide(key: keyof HiveState, side: HiveSide): void {
  const play = usePlayStore.getState()
  if (play.settings.hiveState[key] === side) return
  play.updateSettings({ hiveState: { ...play.settings.hiveState, [key]: side } })
}
