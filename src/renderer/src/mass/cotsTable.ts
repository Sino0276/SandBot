import { isMotorModel, motorGearbox } from '../hardware/catalog'
import type { HardwareComponent, WheelSettings } from '../scene/model'

// 상용 부품(COTS) 질량 표. 모터·서보·배터리·카메라는 CAD 부피 × 재질로 풀면 크게 틀리므로 제조사가 공개한 질량을
// 쓴다(제조사 STEP을 occt-import-js로 읽어 잰 겉보기 밀도가 1.9–7.4 g/cm³로 4배 차이 났다. 단순화한 CAD라 모두
// 알루미늄으로 보면 goBILDA 5203은 161 g(실제 437 g), Limelight 3A는 48 g(실제 93 g)이 된다). 값은 kg이고 줄마다 출처가 있다
// (조사일 2026-11-02, goBILDA·REV 페이지는 "Specs › Weight"). 출처를 찾지 못한 것(OTOS, 컬러·거리 센서, 웹캠, 허브 IMU)은
// 넣지 않는다(재질 추정으로 간다). 질량 표는 SDK 값이 아니라 시뮬레이터 값이라 생성 코드와 관계없다.
//
// 키는 출처 표시(ObjectMass.detail)에 그대로 쓴다. 인스펙터는 cotsEntry(key)의 product(고유 제품명, 번역하지 않음)와
// ratio·cartridges로 문구를 만든다.

export type CotsEntry = {
  // kg
  mass: number
  // 제조사 제품명(고유 명사)
  product: string
  // 모터 감속비(N:1)
  ratio?: number
  // REV UltraPlanetary 감속 카트리지 수
  cartridges?: number
}

const G = 0.001
// 1 oz = 28.349523125 g, 1 lb = 0.45359237 kg(국제 야드·파운드 정의)
const OZ = 0.028349523125
const LB = 0.45359237

// goBILDA Yellow Jacket 감속비별 질량(g). 칸마다 goBILDA 상품 페이지의 "Specs › Weight"다. 주소는 계열별 틀에
// <비>(감속비의 점을 '-'로 바꾸고 '-1'을 붙인 것: 3-7-1, 19-2-1, 139-1)와 <rpm>(아래)을 넣은 것이다
// (goBILDA 상품 사이트맵 https://www.gobilda.com/xmlsitemap.php?type=products&page=1 …5 에 있다). SKU 끝 네 자리는
// 감속비 코드다(상품 페이지의 SKU와 감속비를 맞춰 확인함).
const GOBILDA_RATIOS = [1, 3.7, 5.2, 13.7, 19.2, 26.9, 50.9, 71.2, 99.5, 139, 188] as const
const GOBILDA_RATIO_CODES = [
  '0001',
  '0003',
  '0005',
  '0014',
  '0019',
  '0027',
  '0051',
  '0071',
  '0100',
  '0139',
  '0188'
] as const
// 주소의 <rpm>(출력축 무부하 RPM)은 위 감속비 순서로 6000·1620·1150·435·312·223·117·84·60·43·30이다
type GoBildaFamily = 'goBilda5203' | 'goBilda5204' | 'goBilda5202' | 'goBilda5202Plate'
const GOBILDA_MOTOR_GRAMS: Readonly<Record<GoBildaFamily, readonly (number | null)[]>> = {
  // 5203 24 mm 8 mm REX 축(SKU 5203-2402-*)
  // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-<비>-ratio-24mm-length-8mm-rex-shaft-<rpm>-rpm-3-3-5v-encoder/
  // 3.7:1만 https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-1620-rpm-3-3-5v-encoder/ ,
  // 1:1은 https://www.gobilda.com/5203-series-yellow-jacket-motor-1-1-ratio-24mm-length-8mm-rex-shaft-6000-rpm-3-3-5v-encoder/
  goBilda5203: [391, 396, 399, 438, 437, 437, 481, 486, 486, 485, 524],
  // 5204 80 mm 축(SKU 5204-8002-*). 1:1은 없다. 99.5:1 페이지는 "Weight 501"로 단위가 빠져 g로 읽었다(옆 감속비가 501 g)
  // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-<비>-ratio-80mm-length-8mm-rex-shaft-<rpm>-rpm-3-3-5v-encoder/
  goBilda5204: [null, 411, 412, 435, 458, 458, 465, 501, 501, 501, 543],
  // 5202 24 mm 6 mm D 축(SKU 5202-2402-*, 1:1은 5202-0002-0001)
  // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-<비>-ratio-24mm-length-6mm-d-shaft-<rpm>-rpm-36mm-gearbox-3-3-5v-encoder/
  // 1:1은 https://www.gobilda.com/5202-series-yellow-jacket-motor-1-1-ratio-24mm-length-6mm-d-shaft-6000-rpm-3-3-5v-encoder/
  goBilda5202: [383, 394, 398, 435, 435, 435, 479, 484, 486, 483, 522],
  // 5202 36 mm 기어박스 판(SKU 5202-0002-*). 1:1은 24 mm 축 하나뿐이다
  // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-<비>-ratio-<rpm>-rpm-3-3-5v-encoder/
  goBilda5202Plate: [null, 387, 387, 420, 420, 420, 450, 456, 456, 456, 495]
}
const GOBILDA_PRODUCTS: Readonly<Record<GoBildaFamily, string>> = {
  goBilda5203: 'goBILDA 5203',
  goBilda5204: 'goBILDA 5204',
  goBilda5202: 'goBILDA 5202',
  goBilda5202Plate: 'goBILDA 5202'
}

// REV HD Hex 계열(카탈로그 revHdHex20·revHdHex40). https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor
const REV_HD_HEX: readonly { ratio: number; mass: number }[] = [
  // 기어박스 없음(REV-41-1291) 234 g
  { ratio: 1, mass: 234 * G },
  // 20:1 스퍼(REV-41-1298) 350 g, 모터 포함
  { ratio: 20, mass: 350 * G },
  // 40:1 스퍼(REV-41-1301) 350 g, 모터 포함 https://www.revrobotics.com/rev-41-1301/
  { ratio: 40, mass: 350 * G }
]

// REV UltraPlanetary + HD Hex = 모터 234 g + 장착판 33.5 g + 출력 카트리지 66.5 g + 감속 카트리지마다 35 g
// (3:1 35.5 g, 4:1 34.0 g, 5:1 36.0 g의 가운데). https://www.revrobotics.com/rev-41-1600/ ,
// https://www.revrobotics.com/rev-41-1601/ , …/rev-41-1602/ , …/rev-41-1603/ . REV 문서의 조합 표(카트리지 1·2·3개:
// 371·405·441.5 g, https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor)와 2 g 안에서 맞는다.
const ULTRA_PLANETARY_BASE = (234 + 33.5 + 66.5) * G
const ULTRA_PLANETARY_CARTRIDGE = 35 * G
// 가장 큰 카트리지 5.23:1. 카트리지 수는 감속비가 5.23의 몇 제곱 안인지로 정한다(1개: ≤ 5.23, 2개: ≤ 27.4, 3개: 그 위,
// 한 기어박스에 3개까지). 경계는 반올림한 감속비(5.2·27)도 받게 1 % 넉넉하게 본다.
const ULTRA_PLANETARY_MAX_STAGE = 5.23 * 1.01
const ULTRA_PLANETARY_MAX_CARTRIDGES = 3

const entries: Record<string, CotsEntry> = {
  // REV Core Hex(REV-41-1300) 7 oz https://www.revrobotics.com/rev-41-1300/ ,
  // https://docs.revrobotics.com/duo-build/motion/motors/core-hex-motor
  'motor:revCoreHex': { mass: 7 * OZ, product: 'REV Core Hex' },
  // AndyMark NeveRest Classic 40 "Weight: 0.767 lbs." https://www.andymark.com/products/neverest-classic-40-gearmotor
  'motor:neverest40': { mass: 0.767 * LB, product: 'NeveRest Classic 40', ratio: 40 },
  // goBILDA 2000 Dual Mode 서보: Torque(25-2) 60 g, Speed(25-3)·Super Speed(25-4) 58 g
  // https://www.gobilda.com/2000-series-dual-mode-servo-25-2-torque/ , …-25-3-speed/ , …-25-4-super-speed/
  'servo:gobildaTorque': { mass: 60 * G, product: 'goBILDA 2000 Torque' },
  'servo:gobildaSpeed': { mass: 58 * G, product: 'goBILDA 2000 Speed' },
  'servo:gobildaSuperSpeed': { mass: 58 * G, product: 'goBILDA 2000 Super Speed' },
  // goBILDA 2000 5-Turn: Torque 64 g, Speed 60 g, Super Speed 58 g
  // https://www.gobilda.com/2000-series-5-turn-dual-mode-servo-25-2-torque/ , …-25-3-speed/ , …-25-4-super-speed/
  'servo:gobilda5TurnTorque': { mass: 64 * G, product: 'goBILDA 2000 5-Turn Torque' },
  'servo:gobilda5TurnSpeed': { mass: 60 * G, product: 'goBILDA 2000 5-Turn Speed' },
  'servo:gobilda5TurnSuperSpeed': { mass: 58 * G, product: 'goBILDA 2000 5-Turn Super Speed' },
  // Axon MAX MK2 78 g, MINI MK2 67 g(goBILDA 판매 페이지. Axon 문서는 MAX 85 g이라 엇갈린다)
  // https://www.gobilda.com/axon-max-servo-mk2/ , https://www.gobilda.com/axon-mini-servo-mk2/
  'servo:axonMaxMk2': { mass: 78 * G, product: 'Axon MAX MK2' },
  'servo:axonMiniMk2': { mass: 67 * G, product: 'Axon MINI MK2' },
  // REV Smart Robot Servo V2 Balanced 62 g, UltraSpeed 60 g https://www.revrobotics.com/Smart-servo-v2
  'servo:revSrsV2': { mass: 62 * G, product: 'REV Smart Robot Servo V2' },
  'servo:revSrsV2UltraSpeed': { mass: 60 * G, product: 'REV Smart Robot Servo V2 UltraSpeed' },
  // goBILDA Pinpoint(v1·v2) 40 g, 선·장착 나사 포함
  // https://www.gobilda.com/pinpoint-odometry-computer-imu-sensor-fusion-for-2-wheel-odometry/
  pinpoint: { mass: 40 * G, product: 'goBILDA Pinpoint' },
  // goBILDA 4-Bar 포드 32 mm 84 g, Swingarm 포드 48 mm 121 g(선·장착 나사 포함)
  // https://www.gobilda.com/4-bar-odometry-pod-32mm-wheel/ , https://www.gobilda.com/swingarm-odometry-pod-48mm-wheel/
  'pod:fourBar': { mass: 84 * G, product: 'goBILDA 4-Bar Odometry Pod' },
  'pod:swingarm': { mass: 121 * G, product: 'goBILDA Swingarm Odometry Pod' },
  // Limelight 3A 93 g(나사·케이블 포함) https://www.gobilda.com/limelight-3a-smart-camera/
  limelight3a: { mass: 93 * G, product: 'Limelight 3A' },
  // goBILDA 12V NiMH Nested Battery 3000 mAh 597 g
  // https://www.gobilda.com/12v-nimh-nested-battery-3000mah-mh-fc-xt30-connector/
  'battery:gobilda': { mass: 597 * G, product: 'goBILDA 12V NiMH 3000mAh' },
  // REV 12V Slim Battery 567 g https://www.revrobotics.com/rev-31-1302/
  'battery:rev': { mass: 567 * G, product: 'REV 12V Slim Battery' },
  // REV Control Hub·Expansion Hub 209 g(두 페이지가 크기까지 같아 복사일 수 있다, 저울 확인 권장)
  // https://docs.revrobotics.com/duo-control/control-system-overview/control-hub-basics ,
  // https://docs.revrobotics.com/duo-control/control-system-overview/expansion-hub-basics
  'hub:control': { mass: 209 * G, product: 'REV Control Hub' },
  'hub:expansion': { mass: 209 * G, product: 'REV Expansion Hub' },
  // goBILDA GripForce 메카넘 104 mm 40A(하나) 236 g
  // https://www.gobilda.com/gripforce-mecanum-wheel-set-o104mm-40a-durometer-rollers/
  'wheel:gripForce104': { mass: 236 * G, product: 'goBILDA GripForce Mecanum 104mm' },
  // goBILDA 메카넘 96 mm 70A(하나) 207 g
  // https://www.gobilda.com/96mm-mecanum-wheel-set-70a-durometer-bearing-supported-rollers/
  'wheel:mecanum96': { mass: 207 * G, product: 'goBILDA Mecanum 96mm' }
}

const ratioKey = (family: string, ratio: number): string => `motor:${family}:${ratio}`

for (const family of Object.keys(GOBILDA_MOTOR_GRAMS) as GoBildaFamily[]) {
  GOBILDA_MOTOR_GRAMS[family].forEach((grams, i) => {
    if (grams === null) return
    const ratio = GOBILDA_RATIOS[i]
    entries[ratioKey(family, ratio)] = { mass: grams * G, product: GOBILDA_PRODUCTS[family], ratio }
  })
}
for (const { ratio, mass } of REV_HD_HEX)
  entries[ratioKey('revHdHex', ratio)] = { mass, product: 'REV HD Hex', ratio }
for (let cartridges = 1; cartridges <= ULTRA_PLANETARY_MAX_CARTRIDGES; cartridges++)
  entries[`motor:revUltraPlanetary:${cartridges}`] = {
    mass: ULTRA_PLANETARY_BASE + cartridges * ULTRA_PLANETARY_CARTRIDGE,
    product: 'REV UltraPlanetary',
    cartridges
  }

export const COTS_ENTRIES: Readonly<Record<string, CotsEntry>> = entries

export function cotsEntry(key: string): CotsEntry | undefined {
  return Object.prototype.hasOwnProperty.call(COTS_ENTRIES, key) ? COTS_ENTRIES[key] : undefined
}

// 표의 감속비 중 가장 가까운 것(감속비는 곱으로 쌓이므로 로그 거리로 잰다. 같으면 앞의 것)
function nearestRatio(ratios: readonly number[], gearbox: number): number {
  let best = ratios[0]
  for (const ratio of ratios) {
    if (Math.abs(Math.log(ratio / gearbox)) < Math.abs(Math.log(best / gearbox))) best = ratio
  }
  return best
}

// 모터 컴포넌트(motorModel + gearbox)의 표 키. 표에 없는 모델(goBILDA 5201, NeveRest 20·60, TETRIX, Matrix, Studica,
// 모델 모름)은 null(재질 추정). 모르는 감속비는 그 계열의 가장 가까운 감속비다. goBILDA 5202 모델(5202/5203/5204가
// 같은 구성 태그)은 계열을 알 수 없어 지금 goBILDA가 FTC에 파는 기본 계열인 5203 열을 쓴다(같은 감속비에서 계열 차이는
// 위 표에서 최대 38 g).
function motorCotsKey(props: Record<string, string | number>): string | null {
  const model = isMotorModel(props.motorModel) ? props.motorModel : 'unspecified'
  const gearbox = motorGearbox(props)
  switch (model) {
    case 'goBilda5202': {
      const ratios = GOBILDA_RATIOS.filter((_, i) => GOBILDA_MOTOR_GRAMS.goBilda5203[i] !== null)
      return ratioKey('goBilda5203', nearestRatio(ratios, gearbox))
    }
    case 'revHdHex20':
    case 'revHdHex40':
      return ratioKey(
        'revHdHex',
        nearestRatio(
          REV_HD_HEX.map((row) => row.ratio),
          gearbox
        )
      )
    case 'revUltraPlanetary': {
      let cartridges = 1
      let reach = ULTRA_PLANETARY_MAX_STAGE
      while (cartridges < ULTRA_PLANETARY_MAX_CARTRIDGES && gearbox > reach) {
        cartridges++
        reach *= ULTRA_PLANETARY_MAX_STAGE
      }
      return `motor:revUltraPlanetary:${cartridges}`
    }
    case 'revCoreHex':
      return 'motor:revCoreHex'
    case 'neverest40':
      return 'motor:neverest40'
    default:
      return null
  }
}

// 하드웨어 컴포넌트의 표 키. 서보 모델 속성이 카탈로그에 아직 없으므로 servo·crServo는 goBILDA 2000 Torque 하나다
// (3b에서 모델 속성을 더한다). 표가 없는 종류는 null.
export function componentCotsKey(component: HardwareComponent): string | null {
  switch (component.type) {
    case 'motor':
      return motorCotsKey(component.props)
    case 'servo':
    case 'crServo':
      return 'servo:gobildaTorque'
    case 'pinpoint':
      return 'pinpoint'
    case 'limelight':
      return 'limelight3a'
    default:
      return null
  }
}

// Pinpoint 포드(Pinpoint 컴포넌트의 xPod·yPod가 가리키는 오브젝트)의 표 키(Pinpoint의 podType)
export function pinpointPodCotsKey(podType: unknown): string {
  return podType === 'swingarm' ? 'pod:swingarm' : 'pod:fourBar'
}

// 메카넘 바퀴 지름을 표의 제품으로 볼 허용 오차(m, ±1.5 mm)
const WHEEL_DIAMETER_TOLERANCE = 0.0015
const MECANUM_WHEELS: readonly { diameter: number; key: string }[] = [
  { diameter: 0.104, key: 'wheel:gripForce104' },
  { diameter: 0.096, key: 'wheel:mecanum96' }
]

// 바퀴 설정의 표 키(goBILDA 메카넘 104 mm·96 mm만)
export function wheelCotsKey(wheel: WheelSettings): string | null {
  if (wheel.kind !== 'mecanum') return null
  const match = MECANUM_WHEELS.find(
    (row) => Math.abs(row.diameter - wheel.diameter) <= WHEEL_DIAMETER_TOLERANCE + 1e-12
  )
  return match?.key ?? null
}

// SKU → 표 키. 상품 페이지에서 SKU를 확인한 것만 둔다.
const GOBILDA_SKUS: readonly { pattern: RegExp; key: string }[] = [
  // 배터리 3100-0012-0020
  { pattern: /^3100-0012-0020$/, key: 'battery:gobilda' },
  // GripForce 104 mm: 세트 3625-0202-0104, 키트 STEP의 낱개 3625-0100-0104·3625-0001-0104(좌우)
  { pattern: /^3625-[0-9]{4}-0104$/, key: 'wheel:gripForce104' },
  // 96 mm 메카넘: 세트 3213-3606-0002 STEP 안의 낱개 3606-0000-0096·3606-0100-0096(좌우)
  { pattern: /^3606-[0-9]{4}-0096$/, key: 'wheel:mecanum96' },
  // Pinpoint v1 3110-0002-0001, v2 3110-0002-0002. 포드: Swingarm 3110-0001-0001, 4-Bar 3110-0001-0002
  { pattern: /^3110-0002-000[12]$/, key: 'pinpoint' },
  { pattern: /^3110-0001-0001$/, key: 'pod:swingarm' },
  { pattern: /^3110-0001-0002$/, key: 'pod:fourBar' },
  // Limelight 3A(goBILDA SKU) 3122-0002-0001
  { pattern: /^3122-0002-0001$/, key: 'limelight3a' },
  // 2000 Dual Mode 2000-0025-0002·0003·0004, 5-Turn 2000-0025-0502·0503·0504
  { pattern: /^2000-0025-0002$/, key: 'servo:gobildaTorque' },
  { pattern: /^2000-0025-0003$/, key: 'servo:gobildaSpeed' },
  { pattern: /^2000-0025-0004$/, key: 'servo:gobildaSuperSpeed' },
  { pattern: /^2000-0025-0502$/, key: 'servo:gobilda5TurnTorque' },
  { pattern: /^2000-0025-0503$/, key: 'servo:gobilda5TurnSpeed' },
  { pattern: /^2000-0025-0504$/, key: 'servo:gobilda5TurnSuperSpeed' },
  // Axon MINI MK2 2004-0025-0001, MAX MK2 2004-0025-0002
  { pattern: /^2004-0025-0001$/, key: 'servo:axonMiniMk2' },
  { pattern: /^2004-0025-0002$/, key: 'servo:axonMaxMk2' }
]

// REV 부품 번호 REV-NN-NNNN(REV 상품 주소 https://www.revrobotics.com/rev-41-1300/ 의 그 번호). 질량은 위 표의 출처다.
const REV_SKUS: Readonly<Record<string, string>> = {
  'REV-41-1300': 'motor:revCoreHex',
  'REV-41-1291': ratioKey('revHdHex', 1),
  'REV-41-1298': ratioKey('revHdHex', 20),
  'REV-41-1301': ratioKey('revHdHex', 40),
  'REV-41-3334': 'servo:revSrsV2',
  'REV-41-3336': 'servo:revSrsV2UltraSpeed',
  'REV-31-1302': 'battery:rev',
  'REV-31-1595': 'hub:control',
  'REV-31-1153': 'hub:expansion'
}

const GOBILDA_SKU = /(?<![0-9])([0-9]{4})-([0-9]{4})-([0-9]{4})(?![0-9])/g
const REV_SKU = /(?<![0-9A-Za-z])REV-[0-9]{2}-[0-9]{4}(?![0-9])/gi

// goBILDA 모터 SKU: 5202·5203·5204 시리즈 + 축 코드 + 감속비 코드
function goBildaMotorKey(series: string, shaft: string, code: string): string | null {
  const index = (GOBILDA_RATIO_CODES as readonly string[]).indexOf(code)
  if (index < 0) return null
  let family: GoBildaFamily
  if (series === '5203') family = 'goBilda5203'
  else if (series === '5204') family = 'goBilda5204'
  else if (series === '5202')
    family = shaft === '0002' && code !== '0001' ? 'goBilda5202Plate' : 'goBilda5202'
  else return null
  return GOBILDA_MOTOR_GRAMS[family][index] === null
    ? null
    : ratioKey(family, GOBILDA_RATIOS[index])
}

// 이름에 든 상용 부품 SKU의 표 키(처음 맞는 것). 없으면 null.
export function skuCotsKey(name: string): string | null {
  for (const match of name.matchAll(GOBILDA_SKU)) {
    const [sku, series, shaft, code] = match
    const motor = goBildaMotorKey(series, shaft, code)
    if (motor) return motor
    const row = GOBILDA_SKUS.find((candidate) => candidate.pattern.test(sku))
    if (row) return row.key
  }
  for (const match of name.matchAll(REV_SKU)) {
    const key = REV_SKUS[match[0].toUpperCase()]
    if (key) return key
  }
  return null
}
