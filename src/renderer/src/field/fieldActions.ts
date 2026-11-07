import i18n from 'i18next'
import type { FieldSpec } from '../../../shared/sim/seasons/fieldSpec'
import { fieldOverlaps, type FieldOverlap } from '../../../shared/sim/seasons/fieldGeometry'
import { resolveSeason } from '../../../shared/sim/seasons/seasons'
import { useEditorStore } from '../editor/editorStore'
import { isChangeOpen, onChangeClosed } from '../editor/history'
import {
  dismissNotice,
  showNotice,
  updateNotice,
  useNoticeStore,
  type NoticeActionKey
} from '../editor/noticeStore'
import { robotOutline } from '../play/worldSpec'
import { fieldSeasonId } from '../scene/fieldDoc'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { wrapAngle } from '../scene/wheel'
import { overlapTargetLabel } from './fieldLabels'

// 필드 시즌 고르기와 필드 알림(spec-4ab §2.4).
// - 열기·시즌 고르기(notifyFieldState): v9 이하 파일의 기본 시즌, 모르는 시즌, 최상위 로봇의 시작 자세 겹침을 알린다.
// - 다시 계산(refreshFieldNotices, 프로젝트 세션의 sceneStore 구독): 떠 있는 알림만 다시 계산해 풀렸으면 지우고 남았으면 글자만
//   바꾼다. 새로 띄우지는 않는다(실행 취소·편집 중에 알림이 생기지 않게). 핸들을 끄는 동안은 미루고 놓을 때 한 번 한다.
// 알림은 키마다 하나다(projectActions의 replaceProjectNotice와 같은 방식, 행동 버튼을 붙일 수 있다).

type SceneDocState = ReturnType<typeof useSceneStore.getState>

type FieldNoticeKey = 'fieldStartOverlap' | 'fieldUnknownSeason' | 'fieldAssumedSeason'

const fieldNotices: Record<FieldNoticeKey, number> = {
  fieldStartOverlap: 0,
  fieldUnknownSeason: 0,
  fieldAssumedSeason: 0
}

// 겹침 알림의 [로봇 고르기]가 고를 로봇(다시 계산할 때마다 첫 겹친 로봇으로 바꾼다)
let overlapRobotId: string | null = null

function replaceFieldNotice(
  key: FieldNoticeKey,
  params: Record<string, string | number> | null,
  action?: { label: NoticeActionKey; run: () => void }
): void {
  dismissNotice(fieldNotices[key])
  fieldNotices[key] = params ? showNotice('warning', key, params, action ? { action } : {}) : 0
}

// 그 알림이 지금 보이는지(사용자가 닫았거나 행동 버튼으로 닫힌 알림은 아니다)
function isShowing(key: FieldNoticeKey): boolean {
  const id = fieldNotices[key]
  return id !== 0 && useNoticeStore.getState().notices.some((notice) => notice.id === id)
}

export type RobotFieldOverlap = { robotId: string; name: string; overlaps: FieldOverlap[] }

// 모든 최상위 로봇(하드웨어·바퀴와 관계없이, 문서 순서)의 시작 자세가 벽·solid 구조물과 겹치는지(spec-4ab §1.8). 외곽·높이는
// 세계 설명과 같은 robotOutline, 자세는 로봇 transform(요는 세계 설명 시작 자세처럼 감는다).
export function robotFieldOverlaps(objects: SceneObjects, spec: FieldSpec): RobotFieldOverlap[] {
  const result: RobotFieldOverlap[] = []
  for (const object of Object.values(objects)) {
    if (object.kind !== 'robot' || object.parentId !== null) continue
    const { footprint, height } = robotOutline(objects, object.id)
    const [x, y] = object.transform.position
    const pose = { x, y, yaw: wrapAngle(object.transform.rotation[2]) }
    const overlaps = fieldOverlaps(spec, footprint, pose, height)
    if (overlaps.length > 0) result.push({ robotId: object.id, name: object.name, overlaps })
  }
  return result
}

// 알림의 robots: 로봇마다 "이름 (대상)"(field.overlapItem)을 ", "로 잇는다
function overlapText(spec: FieldSpec, robots: readonly RobotFieldOverlap[]): string {
  return robots
    .map(({ name, overlaps }) =>
      i18n.t('field.overlapItem', { name, targets: overlapTargetLabel(spec, overlaps, i18n.t) })
    )
    .join(', ')
}

function selectOverlapRobot(): void {
  const id = overlapRobotId
  if (id !== null && useSceneStore.getState().objects[id]) useEditorStore.getState().select(id)
}

// [Field 보기]: 하이어라키 Field 줄을 고른다(인스펙터가 Field 인스펙터가 된다)
function showFieldRow(): void {
  useEditorStore.getState().selectField()
}

// 겹침 알림을 지금 문서로 띄우거나(show) 다시 계산한다(update: 떠 있을 때만 글자를 바꾸거나 지운다)
function applyOverlapNotice(mode: 'show' | 'update'): void {
  if (mode === 'update' && !isShowing('fieldStartOverlap')) return
  const { objects, field } = useSceneStore.getState()
  const season = fieldSeasonId(field)
  const spec = season === null ? null : resolveSeason(season)
  const robots = spec ? robotFieldOverlaps(objects, spec) : []
  if (!spec || robots.length === 0) {
    overlapRobotId = null
    replaceFieldNotice('fieldStartOverlap', null)
    return
  }
  overlapRobotId = robots[0].robotId
  const params = { robots: overlapText(spec, robots) }
  if (mode === 'update') updateNotice(fieldNotices.fieldStartOverlap, 'fieldStartOverlap', params)
  else
    replaceFieldNotice('fieldStartOverlap', params, {
      label: 'selectRobot',
      run: selectOverlapRobot
    })
}

// Field 인스펙터의 시즌 선택. 바뀌었으면 고른 시즌으로 알림을 다시 띄운다(같은 값·틀린 문자열은 아무것도 하지 않는다).
export function chooseFieldSeason(season: string): void {
  const before = useSceneStore.getState().field
  useSceneStore.getState().setFieldSeason(season)
  if (useSceneStore.getState().field !== before) notifyFieldState('choose')
}

// 열기·시즌 고르기 때 스토어의 objects·field로 필드 알림을 띄운다(실행 취소·앱 시작에는 부르지 않는다).
// - assumed(열기만): v9 이하 파일이라 BIOBUZZ로 열었다(fieldAssumedSeason, [Field 보기]). 시즌을 직접 고르면 지운다.
// - 모르는 시즌: fieldUnknownSeason을 띄우고 겹침 알림은 지운다.
// - 아니면 최상위 로봇의 시작 자세 겹침(fieldStartOverlap 하나, [로봇 고르기]는 겹친 첫 로봇). 없으면 이전 알림을 지운다.
export function notifyFieldState(reason: 'open' | 'choose', options?: { assumed: boolean }): void {
  replaceFieldNotice('fieldAssumedSeason', reason === 'open' && options?.assumed ? {} : null, {
    label: 'showField',
    run: showFieldRow
  })
  const { field } = useSceneStore.getState()
  const known = fieldSeasonId(field) !== null
  replaceFieldNotice('fieldUnknownSeason', known ? null : { season: field.season })
  applyOverlapNotice('show')
}

// 핸들을 끄는 동안 미룬 다시 계산(놓을 때 한 번)
const pending = { any: false, field: false }
let listeningForClose = false

function refreshNow(fieldChanged: boolean): void {
  if (fieldChanged && fieldSeasonId(useSceneStore.getState().field) !== null)
    replaceFieldNotice('fieldUnknownSeason', null)
  applyOverlapNotice('update')
}

// sceneStore 구독에서 낡은 필드 알림을 다시 계산한다(새로 띄우지는 않는다).
// - field가 바뀌면(실행 취소 포함): 알려진 시즌이면 모르는 시즌 알림을 지운다. 겹침 알림이 떠 있으면 새 시즌으로 다시 계산한다
//   (모르는 시즌이면 지운다).
// - objects가 바뀌고 겹침 알림이 떠 있으면 다시 계산해 풀렸으면 지우고 남았으면 글자만 바꾼다(프리셋으로 스냅하면 사라진다).
export function refreshFieldNotices(state: SceneDocState, previous: SceneDocState): void {
  const fieldChanged = state.field !== previous.field
  if (!fieldChanged && state.objects === previous.objects) return
  if (isChangeOpen()) {
    pending.any = true
    pending.field ||= fieldChanged
    if (!listeningForClose) {
      listeningForClose = true
      onChangeClosed(() => {
        if (!pending.any) return
        const changed = pending.field
        pending.any = false
        pending.field = false
        refreshNow(changed)
      })
    }
    return
  }
  refreshNow(fieldChanged)
}
