import { COLOR_BACKGROUND_READING, readColorSensor } from './colorSensor'
import { raycasterFor, type FieldRaycaster } from './fieldRaycast'
import { readRangeSensor } from './rangeSensor'
import type { FieldSpec } from './seasons/fieldSpec'
import { sensorPose, type Frame3 } from './sensorFrame'
import type { SimColorSensorSpec, SimDistanceSensorSpec, WorldSpec } from './worldSpec'

// 세계의 거리·컬러 센서 전부(spec-4c §1.7, 순수·결정적). 세계(world.ts)가 틱 경계마다 한 번 read를 부른다: 센서마다
// 몸체 틀 × 장착 → 필드 자세 → 모델(rangeSensor.ts·colorSensor.ts) → put. 순서는 거리 목록, 컬러 목록이다(세계 설명 순서,
// 입력 키 순서가 바이트에 들어간다).
//
// 입력 키: 거리 distance(m, 1 mm 반올림, 범위 밖이면 null을 명시해 보낸다. 입력은 합쳐지므로 키를 빼면 이전 값이 남는다),
// 컬러 red·green·blue(정수 0..65535, SDK 기본 3×·25 ms 기준 칩 원래 값)·proximity(정수 0..2047). 컬러 ir·distance는 보내지
// 않는다(드라이버가 IR을 읽지 않고, 칩은 distance 입력을 proximity보다 먼저 쓴다).
//
// 비유한 값 방어(명세 비평 X2): 거리가 유한하지 않으면 null, 컬러 값이 유한하지 않으면 배경 값(79, 85, 55, 27)을 넣고
// 'sensor <장치>'로 알린다(세계가 worldError로, 같은 detail은 실행마다 한 번). 세계의 changed()는 유한하지 않은 수를 버리므로
// 방어가 없으면 이전 값이 조용히 남는다.

// 시험 전용: 모델 바꿔 끼우기(비유한 값 방어 시험 이중). 제품 코드는 넘기지 않는다
export type SensorModels = {
  range: typeof readRangeSensor
  color: typeof readColorSensor
}

export type SensorPut = (device: string, key: string, value: number | null) => void

const DEFAULT_MODELS: SensorModels = { range: readRangeSensor, color: readColorSensor }

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export class FieldSensors {
  private readonly caster: FieldRaycaster
  private readonly distance: readonly SimDistanceSensorSpec[]
  private readonly color: readonly SimColorSensorSpec[]
  private readonly noise: WorldSpec['noise']
  private readonly models: SensorModels

  constructor(
    field: FieldSpec,
    distanceSensors: readonly SimDistanceSensorSpec[],
    colorSensors: readonly SimColorSensorSpec[],
    noise: WorldSpec['noise'],
    models: SensorModels = DEFAULT_MODELS
  ) {
    this.caster = raycasterFor(field)
    this.distance = distanceSensors
    this.color = colorSensors
    this.noise = noise
    this.models = models
  }

  // frames(body): 그 몸체의 필드 틀(−1 섀시, ≥ 0 관절 몸체). tNanos: 이 틱 경계 시각(잡음의 측정 번호).
  // notify(detail): 비유한 값을 막았을 때
  read(
    frames: (body: number) => Frame3,
    tNanos: number,
    put: SensorPut,
    notify: (detail: string) => void = () => {}
  ): void {
    for (const sensor of this.distance) {
      const pose = sensorPose(frames(sensor.mount.body), sensor.mount)
      // 잡음은 켰을 때만 계산한다(꺼져 있으면 잡음 경로를 부르지 않아 값이 바이트 그대로다)
      const reading = this.models.range(
        this.caster,
        pose,
        this.noise.enabled ? { seed: this.noise.seed, device: sensor.device, tNanos } : undefined
      )
      let distance = reading.distance
      if (distance !== null && !isFiniteNumber(distance)) {
        distance = null
        notify(`sensor ${sensor.device}`)
      }
      put(sensor.device, 'distance', distance)
    }
    for (const sensor of this.color) {
      const pose = sensorPose(frames(sensor.mount.body), sensor.mount)
      let reading = this.models.color(this.caster, pose)
      if (
        !isFiniteNumber(reading.red) ||
        !isFiniteNumber(reading.green) ||
        !isFiniteNumber(reading.blue) ||
        !isFiniteNumber(reading.proximity)
      ) {
        reading = COLOR_BACKGROUND_READING
        notify(`sensor ${sensor.device}`)
      }
      put(sensor.device, 'red', reading.red)
      put(sensor.device, 'green', reading.green)
      put(sensor.device, 'blue', reading.blue)
      put(sensor.device, 'proximity', reading.proximity)
    }
  }
}
