import { useTranslation } from 'react-i18next'
import type { SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { estimateLine } from './massCardModel'
import { useMassModel } from './useMassModel'

// 질량 카드가 없는 오브젝트의 추정 질량 한 줄(읽기 전용). 누르면 질량 카드를 붙인다(Add Component의 "질량"과 같다).
// 로봇은 Rigidbody 카드가 보이므로 그리지 않는다.
function MassEstimateLine({ object }: { object: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setObjectMass = useSceneStore((state) => state.setObjectMass)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const model = useMassModel()
  const result = model.objects[object.id]
  if (object.kind === 'robot' || object.mass || !result) return null
  return (
    <button
      type="button"
      className="mass-estimate"
      title={t('mass.estimateHint')}
      onClick={() => setObjectMass(object.id, {})}
    >
      {estimateLine(t, objects, result, lengthUnit)}
    </button>
  )
}

export default MassEstimateLine
