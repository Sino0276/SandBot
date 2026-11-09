import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  angleInputValue,
  componentDef,
  deadWheelTicksPerMeter,
  isComponentType,
  isMotorModel,
  isPropertyVisible,
  MIN_GEARBOX,
  MOTOR_MODEL_TAGS,
  motorGearbox,
  motorOutput,
  PORT_RANGES,
  type ComponentType,
  type ObjectPick,
  type PropertyDef
} from '../../hardware/catalog'
import { componentCodePath } from '../../hardware/codeScopes'
import {
  robotHardwareSettings,
  sharesPortClass,
  type ComponentEntry
} from '../../hardware/components'
import {
  hasHint,
  looseT,
  optionLabelKey,
  propertyHintKey,
  propertyLabelKey
} from '../../hardware/labels'
import {
  cameraAim,
  cameraModelOf,
  MM_PER_METER,
  otosOffsetInchDeg,
  pinpointComponentOffsetsMm,
  robotFramePose,
  sdkCameraPose
} from '../../hardware/mounting'
import type { Issue } from '../../hardware/validation'
import {
  findRobotId,
  subtreeIds,
  type HardwareComponent,
  type HubId,
  type JointType,
  type SceneObjects
} from '../../scene/model'
import { DEG } from '../../scene/coordinates'
import { cadRootIdOf } from '../../cad/stepImport'
import { useProjectStore, type CadGeometryStatus } from '../../project/projectStore'
import { runningRobotId, usePlayStore } from '../../play/playStore'
import { sensorExclusions } from '../../play/worldSensors'
import { cameraExclusions, cameraMountInRobot } from '../../play/worldCameras'
import { objectLocalBounds } from '../../scene/localBounds'
import { documentSeasonId, hiveTippedOf } from '../field/fieldDisplay'
import { cameraReadingModel, cameraReadingText } from './cameraReading'
import { cameraSelfHitFor } from './cameraSelfHit'
import { useComponentGeometryRevision } from './geometryRevision'
import { sensorReadingModel, sensorReadingText } from './sensorReading'
import { selfHitFor, useSelfHitRefresh } from './sensorSelfHit'
import { motorComponentParams } from '../../play/worldJoints'
import { motorDrivesJoint } from '../../play/worldSpec'
import { jointEncoderTicksPerOutputRev } from '../../../../shared/sim/actuatorData'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import {
  ANGLE_DIGITS,
  formatNumber,
  fromDisplayLength,
  LENGTH_DIGITS,
  parseAngle,
  parseLength,
  toDisplayLength
} from '../../units/units'
import NumberField from '../NumberField'
import TextField from '../TextField'
import UsageSection from '../usages/UsageSection'
import IssueList from './IssueList'
import type { ObjectOption } from './objectOptions'

const HUBS: HubId[] = ['controlHub', 'expansionHub']

function FieldRow({
  label,
  title,
  children
}: {
  label: string
  title?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="hw-row" title={title}>
      <span className="hw-row-label">{label}</span>
      {children}
    </div>
  )
}

type ComponentCardProps = {
  objects: SceneObjects
  objectId: string
  component: HardwareComponent
  // 같은 로봇의 모든 컴포넌트(포트 사용 표시). 로봇 밖이면 이 오브젝트의 컴포넌트만.
  siblings: ComponentEntry[]
  // object 속성으로 고를 수 있는 오브젝트(고르기 종류마다, editor/hardware/objectOptions.ts). 없는 종류는 빈 목록이다.
  objectOptions: Partial<Record<ObjectPick, ObjectOption[]>>
  expansionHubEnabled: boolean
  issues: Issue[]
}

// 생성 코드에 들어갈 계산값(CAD 위치에서 구한 오프셋)
function derivedText(
  t: ReturnType<typeof looseT>,
  objects: SceneObjects,
  objectId: string,
  component: HardwareComponent
): string | null {
  const props = component.props
  switch (component.type) {
    case 'pinpoint': {
      const offsets = pinpointComponentOffsetsMm(objects, objectId, props)
      return offsets
        ? t('hardware.derived.pinpoint', { x: offsets.x.toFixed(1), y: offsets.y.toFixed(1) })
        : null
    }
    case 'otos': {
      const offset = otosOffsetInchDeg(objects, objectId, Number(props.mountingAngle))
      return offset
        ? t('hardware.derived.otos', {
            x: offset.x.toFixed(2),
            y: offset.y.toFixed(2),
            h: offset.h.toFixed(1)
          })
        : null
    }
    case 'deadWheel': {
      const pose = robotFramePose(objects, objectId)
      return pose
        ? t('hardware.derived.deadWheel', {
            x: (pose.x * MM_PER_METER).toFixed(1),
            y: (pose.y * MM_PER_METER).toFixed(1)
          })
        : null
    }
    case 'webcam': {
      // SDK setCameraPose 값(4d, spec-4d §1.3·§1.15): 렌즈 = 하우징 앞면(세계 설명과 같은 장착), in 소수 둘째·° 소수 첫째
      const mount = cameraMountInRobot(objects, objectId, props, (id) =>
        objectLocalBounds(objects, id)
      )
      if (!mount) return null
      const pose = sdkCameraPose(mount.position, cameraAim(props))
      // formatNumber: 행렬 곱의 반올림 찌꺼기(±1e-16)가 "-0.00"으로 보이지 않게(붙여 넣을 Java에 음의 0이 없게)
      return t('hardware.derived.webcam', {
        x: formatNumber(pose.x, 2),
        y: formatNumber(pose.y, 2),
        z: formatNumber(pose.z, 2),
        yaw: formatNumber(pose.yaw, 1),
        pitch: formatNumber(pose.pitch, 1),
        roll: formatNumber(pose.roll, 1)
      })
    }
    default:
      return null
  }
}

// 시뮬레이터 전용 속성에서 구한 값(모터 출력축 속도·틱, 데드휠 포드 해상도). 생성 코드와 관계없다. 무부하 속도는 모든
// 모터가 시뮬레이터에서 쓰는 데이터시트 기어모터 값(actuatorData.ts의 실제 감속비·무부하 속도와 덮어쓰기,
// motorComponentParams — 세계 설명의 SimMotorSpec.params와 같다)이다. 틱은 엔코더 규칙을 따른다:
// - 관절을 구동하는 모터: 출력축 틱 = 모터축 카운트 × 실제 감속비(world.ts와 같은 jointEncoderTicksPerOutputRev)
// - 바퀴·어디에도 붙지 않은 모터: SDK 규칙 ticksPerRev ÷ gearing × gearbox(motorOutput, spec-3c §1.2)
// 두 규칙이 다를 수 있어(UltraPlanetary 560 → 530, Core Hex 72:1은 288) 관절 줄은 늘, 그 밖은 토크·속도의 실제 감속비가
// 감속비 칸(SDK gearing)과 다를 때만 실제 감속비를 함께 보인다.
function simulationText(
  t: ReturnType<typeof looseT>,
  component: HardwareComponent,
  drivesJoint: boolean
): string | null {
  switch (component.type) {
    case 'motor': {
      if (drivesJoint) {
        const params = motorComponentParams(component.props)
        const model = isMotorModel(component.props.motorModel)
          ? component.props.motorModel
          : 'unspecified'
        return t('hardware.derived.jointMotorOutput', {
          rpm: formatNumber((params.freeSpeed * 60) / (2 * Math.PI), 0),
          ticks: formatNumber(
            jointEncoderTicksPerOutputRev(MOTOR_MODEL_TAGS[model], params.gearbox),
            1
          ),
          ratio: formatNumber(params.gearbox, 2)
        })
      }
      const params = motorComponentParams(component.props)
      const output = motorOutput(component.props)
      const values = {
        rpm: formatNumber((params.freeSpeed * 60) / (2 * Math.PI), 0),
        ticks: formatNumber(output.ticksPerRev, 1),
        ratio: formatNumber(params.gearbox, 2)
      }
      // 보이는 자릿수로 비교한다(goBILDA 19.2:1의 실제 19.203은 같은 감속비다)
      return values.ratio === formatNumber(output.gearbox, 2)
        ? t('hardware.derived.motorOutput', values)
        : t('hardware.derived.motorOutputRatio', values)
    }
    case 'deadWheel':
      return t('hardware.derived.deadWheelPod', {
        ticks: formatNumber(deadWheelTicksPerMeter(component.props) / 1000, 3)
      })
    default:
      return null
  }
}

// 하우징 형상을 읽는 중인가: 센서 오브젝트와 그 하위의 CAD 메시가 온 CAD 루트 중 읽는 중(cadStatus loading)인 것이 있음
function housingLoading(
  objects: SceneObjects,
  objectId: string,
  cadStatus: Record<string, CadGeometryStatus>
): boolean {
  for (const id of subtreeIds(objects, objectId)) {
    const visual = objects[id].visual
    const cadRootId = visual?.type === 'mesh' ? cadRootIdOf(visual.geometryId) : null
    if (cadRootId !== null && cadStatus[cadRootId] === 'loading') return true
  }
  return false
}

// 거리·컬러 센서 카드의 "편집 자세 값" 줄과 경고 꼬리(4c, spec-4c §1.9, 계산은 sensorReading.ts). 문서·시즌·형상
// revision마다 한 번 계산한다(61광선이라 핸들 드래그 중에도 한다). 자기 가림은 드래그가 끝날 때 한 번이다(sensorSelfHit.ts).
function SensorReadingLines({
  objects,
  objectId,
  component
}: {
  objects: SceneObjects
  objectId: string
  component: HardwareComponent
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const field = useSceneStore((state) => state.field)
  const revision = useSceneStore((state) => state.geometryRevision)
  const cadStatus = useProjectStore((state) => state.cadStatus)
  const refresh = useSelfHitRefresh()
  const model = useMemo(() => {
    void refresh
    const robotId = findRobotId(objects, objectId)
    const type = component.type
    if (type !== 'distanceSensor' && type !== 'colorSensor') return null
    return sensorReadingModel({
      objects,
      objectId,
      component,
      // 문서 시즌(실행 잠금과 관계없이: 실행 중 값은 장치 탭)
      season: documentSeasonId(field),
      bounds: (id) => objectLocalBounds(objects, id),
      exclusion: robotId
        ? (sensorExclusions(objects, robotId).get(component.id) ?? null)
        : 'outsideRobot',
      loading: housingLoading(objects, objectId, cadStatus),
      selfHit: robotId
        ? (mount, reach) =>
            selfHitFor(component.id, objects, revision, robotId, objectId, mount, type, reach)
        : undefined
    })
  }, [objects, objectId, component, field, revision, cadStatus, refresh])
  if (!model) return null
  const text = sensorReadingText(model, t, lengthUnit, objects)
  const hint = t('hardware.sensorReading.hint')
  return (
    <>
      {text.lines.map((line, index) => (
        <p key={`line${index}`} className="hw-derived hw-sensor-reading" title={hint}>
          {line}
        </p>
      ))}
      {text.tails.map((tail, index) => (
        <p key={`tail${index}`} className="hw-derived hw-sensor-tail" title={hint}>
          {`⚠ ${tail}`}
        </p>
      ))}
    </>
  )
}

// 웹캠 카드의 "편집 자세" 줄(4d, spec-4d §1.15, 계산은 cameraReading.ts): 렌즈 값, 보이는 태그(묶음별)와 놓친 태그 수,
// 경고 꼬리. 문서 시즌·HIVE 상태(개인 실행 설정)·형상 revision마다 한 번 계산하고, 자기 가림은 드래그가 끝날 때 한 번이다.
function CameraReadingLines({
  objects,
  objectId,
  component
}: {
  objects: SceneObjects
  objectId: string
  component: HardwareComponent
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const field = useSceneStore((state) => state.field)
  const revision = useSceneStore((state) => state.geometryRevision)
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  const refresh = useSelfHitRefresh()
  const model = useMemo(() => {
    void refresh
    void revision
    const robotId = findRobotId(objects, objectId)
    return cameraReadingModel({
      objects,
      objectId,
      component,
      // 문서 시즌(실행 잠금과 관계없이: 실행 중 값은 장치 탭)
      season: documentSeasonId(field),
      hiveTipped: hiveTippedOf(hiveState),
      bounds: (id) => objectLocalBounds(objects, id),
      exclusion: robotId
        ? (cameraExclusions(objects, robotId).get(component.id) ?? null)
        : 'outsideRobot',
      selfHit: robotId
        ? (mount) =>
            cameraSelfHitFor(
              component.id,
              objects,
              revision,
              robotId,
              objectId,
              mount,
              cameraModelOf(component.props)
            )
        : undefined
    })
  }, [objects, objectId, component, field, hiveState, revision, refresh])
  if (!model) return null
  const text = cameraReadingText(model, t, lengthUnit, objects)
  const hint = t('hardware.cameraReading.hint')
  return (
    <>
      {text.lines.map((line, index) => (
        <p key={`line${index}`} className="hw-derived hw-sensor-reading" title={hint}>
          {line}
        </p>
      ))}
      {text.tails.map((tail, index) => (
        <p key={`tail${index}`} className="hw-derived hw-sensor-tail" title={hint}>
          {`⚠ ${tail}`}
        </p>
      ))}
    </>
  )
}

function ComponentCard({
  objects,
  objectId,
  component,
  siblings,
  objectOptions,
  expansionHubEnabled,
  issues
}: ComponentCardProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const tl = looseT(t)
  const updateComponent = useSceneStore((state) => state.updateComponent)
  const removeComponent = useSceneStore((state) => state.removeComponent)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const runningRobot = usePlayStore(runningRobotId)
  // 웹캠 setCameraPose 줄(derivedText)은 형상 경계 상자를 쓰므로 형상 판이 바뀌면 다시 그린다
  useComponentGeometryRevision(component.type)
  if (!isComponentType(component.type)) return null
  const type: ComponentType = component.type
  const def = componentDef(type)

  const update = (patch: Partial<HardwareComponent>): void =>
    updateComponent(objectId, component.id, patch)
  const setProp = (key: string, value: string | number): void => update({ props: { [key]: value } })
  // 관절을 구동하는 모터의 감속비 "모델 기본"과 출력축 줄은 관절 시뮬레이션의 값(데이터시트 실제 감속비, 엔코더도 그
  // 감속비)이다. 정지 토크·무부하 속도 덮어쓰기는 모든 모터에 보인다(모든 모터가 데이터시트 기어모터로 돈다).
  const drivesJoint = type === 'motor' && motorDrivesJoint(objects, objectId, component.id)
  const simulated = simulationText(tl, component, drivesJoint)

  // 포트 번호 옆에 같은 자리를 쓰는 다른 장치 이름을 보여 준다
  const portLabel = (port: number): string => {
    const users = siblings
      .filter(
        (e) =>
          e.component.id !== component.id &&
          e.component.hub === component.hub &&
          e.component.port === port &&
          sharesPortClass(e.component.type, type)
      )
      .map((e) => e.component.name)
    return users.length ? t('hardware.portUsedBy', { port, names: users.join(', ') }) : String(port)
  }

  const propertyControl = (property: PropertyDef): ReactNode => {
    const label = tl(propertyLabelKey(property.key))
    const value = component.props[property.key]
    switch (property.kind) {
      case 'enum':
        return (
          <select
            className="field-select"
            aria-label={label}
            value={String(value)}
            onChange={(event) => setProp(property.key, event.target.value)}
          >
            {property.options.map((option) => (
              <option key={option} value={option}>
                {tl(optionLabelKey(property.key, option))}
              </option>
            ))}
          </select>
        )
      case 'number':
        // 감속비 0은 모델 기본: 실제로 쓰는 값을 보이고, 아주 작은 값을 넣으면 모델 기본으로 돌린다. 구동계 바퀴는 SDK
        // gearing(motorGearbox), 관절 구동은 데이터시트 표의 실제 감속비(UltraPlanetary 18.93, Core Hex 72)다. 그래서 보이는
        // 값을 그대로 다시 넣어도 관절 물리가 같다(SDK gearing 36.25를 넣으면 Core Hex 관절이 36.25:1이 되던 함정).
        // 관절이 아닌 모터는 엔코더가 SDK 규칙이라 SDK gearing을 보이고, 토크·속도는 실제 감속비라 두 값이 다른 모델(Core
        // Hex·TETRIX 등)은 그 값을 넣으면 토크가 바뀐다(spec-3c §1.2가 받아들인 두 출처). 출력축 줄이 실제 감속비를 보인다.
        if (property.key === 'gearbox') {
          const modelDefault = Number(value) < MIN_GEARBOX
          return (
            <div className="hw-inline">
              <NumberField
                ariaLabel={label}
                value={
                  modelDefault && drivesJoint
                    ? motorComponentParams(component.props).gearbox
                    : motorGearbox(component.props)
                }
                digits={property.digits}
                onCommit={(input) =>
                  setProp(
                    property.key,
                    input < MIN_GEARBOX ? 0 : Math.min(property.max ?? Infinity, input)
                  )
                }
              />
              {modelDefault ? (
                <span className="hw-static">{t('hardware.gearboxModelDefault')}</span>
              ) : (
                <button
                  type="button"
                  className="panel-button"
                  title={t(
                    drivesJoint ? 'hardware.gearboxResetHintJoint' : 'hardware.gearboxResetHint'
                  )}
                  onClick={() => setProp(property.key, 0)}
                >
                  {t('hardware.gearboxReset')}
                </button>
              )}
            </div>
          )
        }
        return (
          <NumberField
            ariaLabel={label}
            value={Number(value)}
            digits={property.digits}
            onCommit={(input) =>
              setProp(
                property.key,
                // 0이 기본값인 덮어쓰기 칸은 아주 작은 값을 기본으로 돌린다(zeroBelow)
                input < (property.zeroBelow ?? -Infinity)
                  ? 0
                  : Math.min(property.max ?? Infinity, Math.max(property.min ?? -Infinity, input))
              )
            }
          />
        )
      case 'length': {
        const unit = t(`units.symbols.${lengthUnit}`)
        return (
          <NumberField
            ariaLabel={label}
            value={toDisplayLength(Number(value), lengthUnit)}
            digits={LENGTH_DIGITS[lengthUnit]}
            title={t('units.lengthInputHint', { unit })}
            parse={(text) => {
              const meters = parseLength(text, lengthUnit)
              return meters === null ? null : toDisplayLength(meters, lengthUnit)
            }}
            onCommit={(input) =>
              setProp(
                property.key,
                Math.min(property.max, Math.max(property.min, fromDisplayLength(input, lengthUnit)))
              )
            }
          />
        )
      }
      case 'angle':
        return (
          <NumberField
            ariaLabel={label}
            value={Number(value) / DEG}
            digits={ANGLE_DIGITS}
            title={t('units.angleInputHint')}
            // 읽지 못한 글자는 남겨 틀렸다고 보인다(spec-4c E2E 1, 조준 방향·높이각과 리밋 각도)
            invalidTitle={t('units.angleRejected')}
            parse={(text) => {
              const radians = parseAngle(text)
              return radians === null ? null : radians / DEG
            }}
            onCommit={(input) => setProp(property.key, angleInputValue(property, input * DEG))}
          />
        )
      case 'text':
        return (
          <TextField
            label={label}
            value={String(value ?? '')}
            onCommit={(input) => setProp(property.key, input.trim())}
          />
        )
      case 'object': {
        const options = objectOptions[property.pick ?? 'any'] ?? []
        const current = String(value ?? '')
        return (
          <select
            className="field-select"
            aria-label={label}
            value={current}
            onChange={(event) => setProp(property.key, event.target.value)}
          >
            <option value="">{t('hardware.objectNone')}</option>
            {/* 지웠거나 고를 수 없게 된 오브젝트: 참조는 남기고(세계 설명이 경고한다) 그렇다고 보인다 */}
            {current !== '' && !options.some((object) => object.id === current) && (
              <option value={current}>{t('hardware.objectMissing')}</option>
            )}
            {options.map((object) => (
              <option key={object.id} value={object.id}>
                {object.label}
              </option>
            ))}
          </select>
        )
      }
    }
  }

  const derived = derivedText(tl, objects, objectId, component)
  const rowLabel = (property: PropertyDef): string =>
    property.kind === 'length'
      ? `${tl(propertyLabelKey(property.key))} (${t(`units.symbols.${lengthUnit}`)})`
      : property.kind === 'angle'
        ? `${tl(propertyLabelKey(property.key))} (°)`
        : tl(propertyLabelKey(property.key))
  // 리밋 스위치 칸은 연결한 관절의 형식을 따른다(visibleWhenJoint). 같은 로봇의 관절 오브젝트만 관절로 본다(세계 설명과 같다)
  const jointTypeOf = (id: string): JointType | null =>
    objectOptions.joint?.some((option) => option.id === id)
      ? (objects[id]?.joint?.type ?? null)
      : null
  const typeLabel = t(`hardware.types.${type}`)
  // 생성 코드에서 이 장치를 쓰는 식(robot.lift.liftLeft)과 상수의 형식 경로(MyBotHardware.Lift.PAR_X_MM).
  // 이름은 codeScopes가 정한 그대로다. 변수 이름 robot은 생성 Javadoc의 사용 예와 같다.
  const codePath = componentCodePath(objects, objectId, component.id)
  const robotId = codePath ? findRobotId(objects, objectId) : null
  const robotClassName = robotId ? robotHardwareSettings(objects, robotId).className : ''
  const isSensor = type === 'distanceSensor' || type === 'colorSensor'
  // 실행 중인 로봇의 시뮬레이터 전용 조준 칸(거리·컬러 센서 조준, 웹캠 모델·조준 4d)은 다음 INIT부터다
  const runningKeys: readonly string[] = isSensor
    ? ['aimYaw', 'aimPitch']
    : type === 'webcam'
      ? ['cameraModel', 'aimYaw', 'aimPitch', 'aimRoll']
      : []
  const aimRunning = (property: PropertyDef): boolean =>
    runningKeys.includes(property.key) &&
    runningRobot !== null &&
    findRobotId(objects, objectId) === runningRobot

  return (
    <li className="hw-card" data-component-type={type}>
      <header className="hw-card-header">
        <span className="hw-card-type">{typeLabel}</span>
        <button
          type="button"
          className="hw-card-remove"
          title={t('hardware.remove')}
          aria-label={t('hardware.removeLabel', { name: component.name || typeLabel })}
          onClick={() => removeComponent(objectId, component.id)}
        >
          ×
        </button>
      </header>
      <FieldRow label={t('hardware.deviceName')}>
        <TextField
          label={t('hardware.deviceName')}
          value={component.name}
          invalid={!component.name.trim()}
          onCommit={(name) => update({ name })}
        />
      </FieldRow>
      {codePath && (
        <div className="hw-row" title={t('hardware.javaPathHint', { className: robotClassName })}>
          <span className="hw-row-label">{t('hardware.javaPath')}</span>
          <code className="hw-path hw-code">{['robot', ...codePath.fieldPath].join('.')}</code>
        </div>
      )}
      {/* 이 장치를 TeamCode에서 쓰는 곳(생성 필드·상수, 구성 이름 문자열). 로봇 밖·카탈로그 밖 종류는 없다. */}
      {codePath && (
        <UsageSection target={{ kind: 'device', objectId, componentId: component.id }} />
      )}
      {def.portKind === 'usb' ? (
        <FieldRow label={t('hardware.portKinds.usb')}>
          <span className="hw-static">{t('hardware.usb')}</span>
        </FieldRow>
      ) : (
        <>
          <FieldRow label={t('hardware.hub')}>
            <select
              className="field-select"
              aria-label={t('hardware.hub')}
              value={component.hub}
              onChange={(event) => {
                const hub = event.target.value as HubId
                // Expansion Hub의 내장 IMU는 BNO055뿐이다
                if (type === 'imu' && hub === 'expansionHub')
                  update({ hub, props: { chip: 'bno055' } })
                else update({ hub })
              }}
            >
              {HUBS.map((hub) => (
                <option key={hub} value={hub}>
                  {hub === 'expansionHub' && !expansionHubEnabled
                    ? t('hardware.hubOff', { hub: t(`hardware.hubs.${hub}`) })
                    : t(`hardware.hubs.${hub}`)}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label={t(`hardware.portKinds.${def.portKind}`)}>
            <select
              className="field-select"
              aria-label={t(`hardware.portKinds.${def.portKind}`)}
              value={component.port}
              // 내장 IMU는 허브의 I2C 버스 0에 고정되어 있다
              disabled={type === 'imu'}
              onChange={(event) => update({ port: Number(event.target.value) })}
            >
              {Array.from({ length: PORT_RANGES[def.portKind] }, (_, port) => (
                <option key={port} value={port}>
                  {portLabel(port)}
                </option>
              ))}
            </select>
          </FieldRow>
        </>
      )}
      {def.properties
        .filter((property) => isPropertyVisible(property, component.props, jointTypeOf))
        .map((property) => (
          <FieldRow
            key={property.key}
            label={rowLabel(property)}
            // 시뮬레이터 전용 속성은 생성 코드에 쓰지 않는다
            title={
              [
                property.hint ? tl(propertyHintKey(property.key)) : '',
                property.simulation ? t('hardware.simulationOnly') : ''
              ]
                .filter((text) => text !== '')
                .join(' ') || undefined
            }
          >
            {aimRunning(property) ? (
              // 실행 중인 로봇의 조준 칸(편집은 막지 않는다): 시뮬레이터는 INIT 때의 조준을 쓴다(Transform 배지와 같음)
              <div className="hw-inline">
                {propertyControl(property)}
                <span className="frame-badge is-running" title={t('hardware.aimRunningHint')}>
                  {t('inspector.running')}
                </span>
              </div>
            ) : (
              propertyControl(property)
            )}
          </FieldRow>
        ))}
      {codePath && codePath.constants.length > 0 && (
        <div className="hw-row">
          <span className="hw-row-label">{t('hardware.javaConstants')}</span>
          <span className="hw-code-list">
            {codePath.constants.map((constant) => (
              <code key={constant} className="hw-path hw-code">
                {`${codePath.typeName}.${constant}`}
              </code>
            ))}
          </span>
        </div>
      )}
      {derived && (
        <p
          className="hw-derived"
          title={type === 'webcam' ? t('hardware.derivedHints.webcam') : undefined}
        >
          {derived}
        </p>
      )}
      {simulated && (
        <p className="hw-derived" title={t('hardware.simulationOnly')}>
          {simulated}
        </p>
      )}
      {isSensor && (
        <SensorReadingLines objects={objects} objectId={objectId} component={component} />
      )}
      {type === 'webcam' && (
        <CameraReadingLines objects={objects} objectId={objectId} component={component} />
      )}
      {hasHint(type) && <p className="inspector-note">{t(`hardware.hints.${type}`)}</p>}
      <IssueList issues={issues} />
    </li>
  )
}

export default ComponentCard
