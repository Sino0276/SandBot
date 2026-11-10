import { dismissNotice, showNotice, type NoticeActionKey } from '../editor/noticeStore'

// 열린 프로젝트에 딸린 알림(TeamCode 없음, CAD 못 찾음, 버린 스크립트 연결, 필드 CAD 못 찾음·버림). 키마다 하나만 띄우고
// 다른 프로젝트를 열면 지운다. projectActions와 field/fieldVisualActions가 같이 쓴다(spec-4e §3.3: 둘 사이의 순환을 피해
// 여기에 둔다. showNotice로 바로 띄우면 추적되지 않아 겹치거나 다른 프로젝트에 남는다).
const projectNotices = {
  noTeamCode: 0,
  cadMissing: 0,
  scriptLinksDropped: 0,
  fieldCadMissing: 0,
  fieldCadDropped: 0
}

export type ProjectNoticeKey = keyof typeof projectNotices

// 그 키의 알림을 바꾼다(params가 null이면 지우기만). 경고 알림이다.
export function replaceProjectNotice(
  key: ProjectNoticeKey,
  params: Record<string, string | number> | null,
  action?: { label: NoticeActionKey; run: () => void }
): void {
  dismissNotice(projectNotices[key])
  projectNotices[key] = params ? showNotice('warning', key, params, action ? { action } : {}) : 0
}

// 모든 프로젝트 알림을 지운다(다른 프로젝트 열기)
export function clearProjectNotices(): void {
  for (const key of Object.keys(projectNotices) as ProjectNoticeKey[])
    replaceProjectNotice(key, null)
}
