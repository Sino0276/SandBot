import type { MaterialKey } from './types'

// CAD 이름으로 재질을 고르는 규칙(spec-3a §4.2, research/materials.md §4). 이름은 원래 CAD 메시 이름과 상위 오브젝트
// 이름(CAD 루트까지)이고, 가까운 이름부터 본다(massModel.ts). 한 이름 묶음 안에서는 낱말 규칙(위에서 첫 맞는 것)을
// 먼저, 그다음 goBILDA SKU 시리즈 표를 본다. 맞은 규칙의 이름이 출처 표시(ObjectMass.detail)가 된다.
// STEP 안의 재질 정보는 쓰지 않는다(Fusion 기본값 "Steel, Mild"가 바퀴 고무에도 남아 있어 믿을 수 없다).

export type NameRule = {
  // 출처 표시에 보이는 규칙 이름(낱말 규칙은 첫 낱말, SKU 시리즈는 'gobilda-<시리즈>')
  name: string
  // null이면 질량 0(라벨·표시용 판처럼 실제로는 없는 솔리드)
  material: MaterialKey | null
}

type WordRule = NameRule & {
  // 맞출 낱말열(공백으로 나눈 낱말들이 이름 안에 이어서 나오면 맞음). 낱말은 소문자이고 복수형(s, es)도 맞는다.
  phrases: readonly string[]
}

const rule = (material: MaterialKey | null, ...phrases: string[]): WordRule => ({
  name: phrases[0].replace(/ /g, '-'),
  material,
  phrases
})

// 낱말 규칙(대소문자 무시, 낱말 경계, 위에서 첫 맞는 것). 근거는 research/materials.md §4.4이고, 비평(research/critique.md
// E12)에 따라 오인하기 쉬운 3글자 이하 낱말(ss, pc, or, id, cf, ply, alu, pom, eva)은 뺐다. 재질 키와 같은 pla·abs·tpu와
// 하드웨어 이름 pin·nut만 짧은 낱말로 둔다(낱말 경계로만 맞으므로 Spinner의 pin은 잡지 않는다).
export const WORD_RULES: readonly WordRule[] = [
  // 이름에 재질이 직접 있으면 그것이 먼저다(research/materials.md §4.4 순위 2)
  rule('stainless', 'stainless'),
  rule('brass', 'brass'),
  // goBILDA 2303·2320·2920 이름에 "Steel"(research/materials.md §4.2). carbon steel이 탄소섬유가 되지 않게 carbon보다 먼저
  rule('steel', 'steel'),
  rule('aluminum7075', '7075'),
  // goBILDA 2302·2910·3310 이름에 "Aluminum". 6063(REV 압출재 2.69)은 6061과 0.4 % 차이라 묶는다
  rule('aluminum6061', 'aluminum', 'aluminium', '6061', '6063'),
  // goBILDA 3413, ServoCity #25 스프로킷
  rule('acetal', 'acetal', 'delrin'),
  rule('polycarbonate', 'polycarbonate', 'polycarb', 'lexan'),
  // UHMW(0.93)는 HDPE(0.955)와 3 % 차이라 묶는다
  rule('hdpe', 'hdpe', 'uhmw'),
  rule('nylon', 'nylon'),
  rule('carbonFiber', 'carbon fiber', 'carbon fibre', 'carbonfiber', 'carbon'),
  rule('plywood', 'plywood', 'birch'),
  rule('foam', 'foam'),
  rule('rubber', 'rubber', 'neoprene', 'urethane'),
  rule('pla', 'pla'),
  rule('petg', 'petg'),
  rule('abs', 'abs'),
  rule('tpu', 'tpu'),
  // 플라스틱 체인 링크(goBILDA 3309, 아세탈로 가정)는 plastic보다 먼저
  rule('acetal', 'plastic chain'),
  // 일반 플라스틱 1.20(PC·나일론·아세탈 1.14–1.42의 가운데). goBILDA 1500 Plastic Spacer, 3402 Plastic Pulley
  rule('polycarbonate', 'plastic'),
  // 예제 파일의 Top Label·Side Label·Labels는 장식 솔리드(research/materials.md §4.4 순위 1)
  rule(null, 'label', 'sticker', 'decal'),
  // goBILDA 2800 아연 도금 강철 나사, 2801·2809·2810 와셔, 2816 hook-nut
  rule('steel', 'screw', 'bolt', 'shcs', 'bhcs', 'fhcs', 'rivet'),
  rule('steel', 'pin', 'dowel', 'e clip', 'circlip', 'snap ring'),
  rule('steel', 'nut', 'nylock'),
  rule('steel', 'washer'),
  // goBILDA 2803 스테인리스 나사산 판
  rule('stainless', 'threaded plate'),
  // goBILDA 1611·1601 고탄소강 플랜지 볼 베어링
  rule('steel', 'bearing'),
  // goBILDA 8 mm REX Servo Shaft는 알루미늄이라 shaft보다 먼저
  rule('aluminum6061', 'servo shaft'),
  rule('steel', 'shaft', 'axle'),
  // goBILDA 2910 클램핑 칼라(세트 스크루 칼라 2920은 위 screw가 강철로 잡는다)
  rule('aluminum6061', 'collar'),
  // goBILDA 2303 피니언, 2320 마이터 기어
  rule('steel', 'pinion', 'miter', 'worm'),
  // goBILDA 2302 허브 마운트 기어, 3310 스프로킷
  rule('aluminum6061', 'gear', 'sprocket'),
  // goBILDA 8 mm 피치 강철 체인
  rule('steel', 'chain', 'master link'),
  // goBILDA 3412 HTD 벨트(네오프렌 1.23 + 유리섬유 심, 고무 1.15로 근사), 바퀴 트레드·롤러
  rule('rubber', 'belt', 'tire', 'tyre', 'tread', 'roller', 'o ring'),
  // goBILDA 3413 아세탈 아이들러
  rule('acetal', 'idler'),
  rule('aluminum6061', 'pulley'),
  // goBILDA 1501 스탠드오프, 1502·1505·1514 스페이서
  rule('aluminum6061', 'spacer', 'standoff'),
  // goBILDA 1120 U-channel, REV 15 mm 압출재, Studica 채널
  rule('aluminum6061', 'channel', 'extrusion', 'tube', 'bracket', 'plate'),
  // goBILDA 2909 케이블 타이(나일론 PA66)
  rule('nylon', 'zip tie', 'cable tie')
]

// goBILDA 부품 번호(SKU) NNNN-NNNN-NNNN. 앞 네 자리가 시리즈다(research/cots.md §3.2, 키트 이름의 59 %가 SKU다).
const GOBILDA_SKU = /(?<![0-9])([0-9]{4})-[0-9]{4}-[0-9]{4}(?![0-9])/g

// goBILDA 시리즈 → 재질(research/materials.md §4.2, 비평 research/critique.md E1로 고침). 근거 URL은 그 표에 있다.
// 3625(GripForce 메카넘)·3606(메카넘)·3100(배터리)·2000·2004(서보)·3110(Pinpoint·포드)·3122(Limelight)·
// 5202–5204(모터)는 재질이 아니라 COTS 질량이다(cotsTable.ts). 맞는 SKU가 그 표에 없으면 여기에도 없으므로 기본 재질이다.
const GOBILDA_SERIES: Readonly<Record<string, MaterialKey>> = {
  // U-Channel·Low-Side U-Channel(알루미늄 clear anodized, Core Electronics 사양 표)
  '1120': 'aluminum6061',
  '1121': 'aluminum6061',
  // 패턴 판·브래킷·마운트(알루미늄으로 가정, 시리즈별 재질은 확인 못 함)
  '1143': 'aluminum6061',
  '1201': 'aluminum6061',
  '1205': 'aluminum6061',
  '1208': 'aluminum6061',
  '1209': 'aluminum6061',
  '1222': 'aluminum6061',
  // Sonic Hub·Hyper Hub(알루미늄으로 가정)
  '1309': 'aluminum6061',
  '1310': 'aluminum6061',
  // Plastic Spacer(일반 플라스틱 1.20)
  '1500': 'polycarbonate',
  // 스탠드오프·스페이서(알루미늄, 1516·1522는 1514 후속이라 알루미늄으로 가정)
  '1501': 'aluminum6061',
  '1502': 'aluminum6061',
  '1505': 'aluminum6061',
  '1512': 'aluminum6061',
  '1514': 'aluminum6061',
  '1516': 'aluminum6061',
  '1522': 'aluminum6061',
  // 6 mm ID 스페이서(사양 표는 강철, 판매처 본문과 엇갈림)
  '1521': 'steel',
  // 플랜지 볼 베어링(고탄소강)
  '1600': 'steel',
  '1601': 'steel',
  '1611': 'steel',
  // 스테인리스 REX 축
  '2100': 'stainless',
  '2106': 'stainless',
  // 허브 마운트 기어(알루미늄), 피니언(강철), 클램핑 마이터 기어(강철)
  '2302': 'aluminum6061',
  '2303': 'steel',
  '2320': 'steel',
  // 28xx 체결 부품: 2800·2804 나사, 2801·2809·2810 와셔, 2816 hook-nut은 아연 도금 강철로 확인했고 나머지는 같은
  // 시리즈라 강철로 가정. 2803 나사산 판만 스테인리스
  '2800': 'steel',
  '2801': 'steel',
  '2803': 'stainless',
  '2804': 'steel',
  '2806': 'steel',
  '2807': 'steel',
  '2809': 'steel',
  '2810': 'steel',
  '2812': 'steel',
  '2816': 'steel',
  '2822': 'steel',
  '2824': 'steel',
  // 케이블 타이(나일론 PA66으로 가정)
  '2909': 'nylon',
  // 클램핑 칼라(알루미늄), 세트 스크루 칼라(아연 도금 강철)
  '2910': 'aluminum6061',
  '2920': 'steel',
  // ServoBlock(알루미늄으로 가정)
  '3217': 'aluminum6061',
  // 8 mm 플라스틱 체인 링크(재질 미확인, 아세탈로 가정)
  '3309': 'acetal',
  // 8 mm 피치 스프로킷(알루미늄)
  '3310': 'aluminum6061',
  // 플라스틱 벨트 풀리
  '3402': 'polycarbonate',
  // HTD 타이밍 벨트(네오프렌 + 유리섬유 심, 고무로 근사)
  '3403': 'rubber',
  '3412': 'rubber',
  // 아세탈 벨트 아이들러
  '3413': 'acetal',
  // 3613(Gecko·48 mm 바퀴)·3626(96 mm 50A 바퀴)·3618(16 mm 롤러): COTS 질량을 찾지 못해 고무로 근사한다
  // (비평 E1: 알루미늄으로 보면 약 2.3배 무겁다)
  '3613': 'rubber',
  '3618': 'rubber',
  '3626': 'rubber'
}

// 이름을 낱말로 나눈다: camelCase(RollerTire → roller tire)와 글자·숫자가 아닌 것으로 끊고 소문자로. SKU는 낱말
// 규칙에서 빼므로(SKU 자리의 6061·7075가 재질로 읽히지 않게) 먼저 지운다.
export function nameWords(name: string): string[] {
  return name
    .replace(GOBILDA_SKU, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
}

// 낱말 하나가 맞을 수 있는 규칙 낱말(그 자신과 복수형 s·es를 뗀 것)
function baseForms(word: string): string[] {
  const forms = [word]
  if (word.endsWith('s')) forms.push(word.slice(0, -1))
  if (word.endsWith('es')) forms.push(word.slice(0, -2))
  return forms
}

// 이름 하나의 낱말과, 낱말 하나짜리 규칙을 바로 찾는 집합
type NameWords = { list: string[][]; set: Set<string> }

function wordsOf(name: string): NameWords {
  const list = nameWords(name).map(baseForms)
  return { list, set: new Set(list.flat()) }
}

// 낱말 하나짜리 규칙 낱말 → 처음 나오는 규칙 순번, 여러 낱말 규칙(순번, 낱말열)
const SINGLE_WORD_RULES = new Map<string, number>()
const PHRASE_RULES: { index: number; targets: string[] }[] = []
WORD_RULES.forEach((wordRule, index) => {
  for (const phrase of wordRule.phrases) {
    const targets = phrase.split(' ')
    if (targets.length > 1) PHRASE_RULES.push({ index, targets })
    else if (!SINGLE_WORD_RULES.has(phrase)) SINGLE_WORD_RULES.set(phrase, index)
  }
})

function hasPhrase(words: NameWords, targets: readonly string[]): boolean {
  const { list } = words
  for (let start = 0; start + targets.length <= list.length; start++) {
    if (targets.every((target, i) => list[start + i].includes(target))) return true
  }
  return false
}

// 이름들에 맞는 가장 앞 규칙의 순번(없으면 -1)
function firstWordRule(words: readonly NameWords[]): number {
  let best = Infinity
  for (const name of words) {
    for (const word of name.set) {
      const index = SINGLE_WORD_RULES.get(word)
      if (index !== undefined && index < best) best = index
    }
    for (const { index, targets } of PHRASE_RULES) {
      if (index < best && hasPhrase(name, targets)) best = index
    }
  }
  return best === Infinity ? -1 : best
}

// 이름 안의 goBILDA SKU들(나온 순서)
export function goBildaSkus(name: string): string[] {
  return [...name.matchAll(GOBILDA_SKU)].map((match) => match[0])
}

// 한 이름 묶음(같은 오브젝트의 원래 이름과 지금 이름)에 맞는 규칙. 모든 이름에 낱말 규칙을 위에서부터 본 뒤,
// 없으면 이름에 나온 goBILDA SKU의 시리즈를 본다. 맞는 것이 없으면 null.
export function matchNameRule(names: readonly string[]): NameRule | null {
  const index = firstWordRule(names.map(wordsOf))
  if (index >= 0) return { name: WORD_RULES[index].name, material: WORD_RULES[index].material }
  for (const name of names) {
    for (const sku of goBildaSkus(name)) {
      const series = sku.slice(0, 4)
      const material = GOBILDA_SERIES[series]
      if (material) return { name: `gobilda-${series}`, material }
    }
  }
  return null
}

// 규칙 이름 → 재질(출처 표시용). 모르는 이름이면 undefined, 질량 0 규칙이면 null.
export function nameRuleMaterial(ruleName: string): MaterialKey | null | undefined {
  if (ruleName.startsWith('gobilda-')) return GOBILDA_SERIES[ruleName.slice('gobilda-'.length)]
  return WORD_RULES.find((wordRule) => wordRule.name === ruleName)?.material
}
