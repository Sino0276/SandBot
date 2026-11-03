import { useTranslation } from 'react-i18next'
import type { SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import {
  DEFAULT_DESCRIBERS,
  estimateLine,
  loadingCad,
  noticeText,
  objectNotices
} from './massCardModel'
import { hasMassProps, useCadMassSummary, useMassModel } from './useMassModel'

// 질량 카드가 없는 오브젝트의 추정 질량 한 줄(읽기 전용). 누르면 질량 카드를 붙인다(Add Component의 "질량"과 같다).
// 로봇은 Rigidbody 카드가 보이므로 그리지 않는다.
function MassEstimateLine({ object }: { object: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setObjectMass = useSceneStore((state) => state.setObjectMass)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const model = useMassModel()
  const summaryOf = useCadMassSummary()
  const result = model.objects[object.id]
  if (object.kind === 'robot' || object.mass || !result) return null
  // 이 오브젝트를 가리키는 알림(데이터시트 질량을 쓰지 않음 등)도 카드 없이 보인다
  const notices = objectNotices(model, object.id)
  const text = estimateLine(
    t,
    objects,
    result,
    lengthUnit,
    DEFAULT_DESCRIBERS,
    loadingCad(objects, object.id, summaryOf, hasMassProps)
  )
  // 한 줄은 좁은 인스펙터에서 잘리므로(긴 CAD 이름의 출처) 도움말이 전체 글자와 누르면 하는 일을 보인다
  return (
    <>
      <button
        type="button"
        className="mass-estimate"
        title={`${text}\n${t('mass.estimateHint')}`}
        onClick={() => setObjectMass(object.id, {})}
      >
        {text}
      </button>
      {notices.length > 0 && (
        <ul className="hw-issues">
          {notices.map((notice, index) => (
            <li key={index} className="hw-issue is-info">
              {noticeText(t, objects, notice, lengthUnit)}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default MassEstimateLine
