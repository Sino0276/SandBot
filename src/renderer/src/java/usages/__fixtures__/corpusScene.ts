// 사용처 말뭉치(__fixtures__/corpus)의 생성 클래스를 만드는 씬. 말뭉치의 생성 파일은 이 씬의 generateHardwareJava
// 출력과 같아야 한다(usageCorpus.test.ts가 확인하고 vitest -u로 다시 쓴다). javac 정답표(golden*.txt)는
// scripts/usage-oracle이 이 파일들로 만든다.
//
// - corpusScene: 로봇 둘. Comp Bot(RobotHardware): leftFront 모터, par 데드휠(같은 포트 모터가 있어 찾기 이름은
//   leftFront), Lift 그룹(liftLeft 모터, enc 데드휠, Claw 그룹(grip 서보)). Practice Bot(PracticeBotHardware):
//   liftLeft 모터(Comp Bot과 같은 구성 이름), wrist 서보.
// - renamedCorpusScene: 장치 하나(Lift의 liftLeft → liftMain), 그룹 하나(Claw → Gripper), 로봇 클래스 하나
//   (PracticeBotHardware → TestBotHardware)의 이름을 바꾼 씬. javac의 cannot find symbol과 맞춘다.
import { propertyDefaults, type ComponentType } from '../../../hardware/catalog'
import type { HardwareComponent, SceneObject, SceneObjects } from '../../../scene/model'

export const COMP_ROBOT_ID = 'comp'
export const PRACTICE_ROBOT_ID = 'practice'

function component(id: string, type: ComponentType, name: string, port: number): HardwareComponent {
  return { id, type, name, hub: 'controlHub', port, props: propertyDefaults(type) }
}

function object(
  id: string,
  name: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name,
    kind,
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...extra
  }
}

function robot(id: string, name: string, className: string): SceneObject {
  return object(id, name, 'robot', null, {
    hardware: { className, configName: name, expansionHub: { enabled: false, address: 2 } }
  })
}

const part = (id: string, parentId: string, ...components: HardwareComponent[]): SceneObject =>
  object(id, id, 'part', parentId, { components })

type Names = { liftLeft: string; claw: string; practiceClass: string }

function build(names: Names): SceneObjects {
  const objects: SceneObject[] = [
    robot(COMP_ROBOT_ID, 'Comp Bot', 'RobotHardware'),
    part('drive', COMP_ROBOT_ID, component('lf', 'motor', 'leftFront', 0)),
    part('odometry', COMP_ROBOT_ID, component('par', 'deadWheel', 'par', 0)),
    object('lift', 'Lift', 'group', COMP_ROBOT_ID),
    part('liftMotor', 'lift', component('ll', 'motor', names.liftLeft, 1)),
    part('liftEncoder', 'lift', component('enc', 'deadWheel', 'enc', 2)),
    object('claw', names.claw, 'group', 'lift'),
    part('clawServo', 'claw', component('grip', 'servo', 'grip', 0)),
    robot(PRACTICE_ROBOT_ID, 'Practice Bot', names.practiceClass),
    part('practiceLift', PRACTICE_ROBOT_ID, component('pll', 'motor', 'liftLeft', 0)),
    part('practiceWrist', PRACTICE_ROBOT_ID, component('pw', 'servo', 'wrist', 0))
  ]
  return Object.fromEntries(objects.map((o) => [o.id, o]))
}

export function corpusScene(): SceneObjects {
  return build({ liftLeft: 'liftLeft', claw: 'Claw', practiceClass: 'PracticeBotHardware' })
}

export function renamedCorpusScene(): SceneObjects {
  return build({ liftLeft: 'liftMain', claw: 'Gripper', practiceClass: 'TestBotHardware' })
}
