import type { DeviceValues } from '../sidecarProtocol'
import type { FieldSpec } from './seasons/fieldSpec'
import { sensorPose, type Frame3 } from './sensorFrame'
import { FieldVision, frameDue, readCameraOutputs, tagsInput } from './vision'
import type { SimCameraSpec, WorldSpec } from './worldSpec'

// 세계의 웹캠 전부(spec-4d §1.8, 순수·결정적). 세계(world.ts)가 틱 경계마다 한 번 read를 부른다: 웹캠마다(세계 설명 순서)
// model을 넣고, 그 틱이 30 fps 격자의 프레임 틱이고 그 틱의 사이드카 출력이 스트리밍 중이면 그 틱 자세로 태그를 판정해
// frameNanos·frameWidth·frameHeight·tags를 이 순서로 넣는다(입력 키 순서가 바이트에 들어간다).
//
// 입력 키(sidecar org.sandbot.sdk.devices package-info의 webcam 행): model(string, CameraModelId), frameNanos(정수, 그
// 틱 tNanos), frameWidth·frameHeight(정수, 그 프레임 해상도 = 출력 width·height), tags(number[], 태그마다 [id, x0, y0, …,
// x3, y3], apriltag 3 픽셀 좌표, id 오름차순). 처리 시간·프레임 대기·FPS·결과가 보이는 때는 사이드카가 정한다.
//
// 비유한 값 방어(4c fieldSensors.ts와 같은 원칙): tags에 유한하지 않은 원소가 생기면 빈 배열(검출 없음)을 넣고
// 'camera <장치>'로 알린다(세계가 worldError로, 같은 detail은 실행마다 한 번). 그 배열을 보내지 않으면 사이드카에 이전
// 프레임의 tags가 새 frameNanos와 함께 남는다.

export type CameraPut = (
  device: string,
  key: string,
  value: number | string | readonly number[]
) => void

// AprilTag 처리기의 패밀리 중 시뮬레이터가 검출하는 것(SDK AprilTagProcessor.TagFamily 이름, BIOBUZZ 태그는 36h11)
export const SIMULATED_TAG_FAMILY = 'TAG_36h11'

const allFinite = (values: readonly number[]): boolean => values.every((v) => Number.isFinite(v))

// 장치 이름으로 출력을 찾는다(자기 속성만: 이름이 '__proto__'여도 프로토타입을 읽지 않게)
function own(outputs: Record<string, DeviceValues>, device: string): DeviceValues | undefined {
  return Object.prototype.hasOwnProperty.call(outputs, device) ? outputs[device] : undefined
}

export class FieldCameras {
  private readonly vision: FieldVision
  private readonly cameras: readonly SimCameraSpec[]
  private readonly noise: WorldSpec['noise']

  constructor(
    field: FieldSpec,
    hiveTipped: readonly [boolean, boolean],
    cameras: readonly SimCameraSpec[],
    noise: WorldSpec['noise']
  ) {
    // 태그 필드 자세는 HIVE 상태로 한 번 푼다(실행 동안 고정, 4ab)
    this.vision = new FieldVision(field, hiveTipped)
    this.cameras = cameras
    this.noise = noise
  }

  // frames(body): 그 몸체의 필드 틀(−1 섀시, ≥ 0 관절 몸체). 몸체 틀을 쓰는 것은 프레임이 있는 틱의 스트리밍 중인 웹캠뿐이다
  // (관절 몸체 자세는 부르는 쪽이 처음 쓸 때 한 번 푼다). tPrev: 앞 틱 경계 시각(첫 step이면 null), tNanos: 이 틱 경계.
  // outputs: 이 틱의 사이드카 출력. notify(detail): 비유한 값을 막았을 때
  read(
    frames: (body: number) => Frame3,
    tPrev: number | null,
    tNanos: number,
    outputs: Record<string, DeviceValues>,
    put: CameraPut,
    notify: (detail: string) => void = () => {}
  ): void {
    // 격자는 모든 웹캠에 하나다(카메라마다 같다)
    const due = frameDue(tPrev, tNanos)
    for (const camera of this.cameras) {
      // 모델은 늘 넣는다(값이 같아 세계의 changed()가 첫 틱에만 보낸다)
      put(camera.device, 'model', camera.model)
      if (!due) continue
      const out = readCameraOutputs(own(outputs, camera.device))
      if (out === null) continue
      let tags: number[] = []
      // 처리기가 꺼져 있거나 다른 패밀리면 검출이 없다(오검출은 만들지 않는다). 판정도 하지 않는다(값이 같다)
      if (out.aprilTag && out.family === SIMULATED_TAG_FAMILY) {
        const pose = sensorPose(frames(camera.mount.body), camera.mount)
        const observed = this.vision.observe(
          pose,
          camera.model,
          out.width,
          out.height,
          out.decimation
        )
        tags = tagsInput(observed, camera.device, tNanos, this.noise)
        if (!allFinite(tags)) {
          tags = []
          notify(`camera ${camera.device}`)
        }
      }
      put(camera.device, 'frameNanos', tNanos)
      put(camera.device, 'frameWidth', out.width)
      put(camera.device, 'frameHeight', out.height)
      put(camera.device, 'tags', tags)
    }
  }
}
