import type { MaterialKey } from './types'

// CAD 이름으로 재질을 고르는 규칙. 이름은 메시의 원래 이름 경로(불러올 때의 CAD 노드 이름, 파트부터 CAD 루트 쪽으로)이고
// 가까운 이름부터 본다(massModel.ts). 한 이름 안에서는 재질 이름 낱말 → 부품 종류 낱말(가장 오른쪽) → goBILDA SKU 시리즈
// 순이다. 맞은 낱말(규칙의 낱말열 그대로, 'tire'·'servo shaft')이나 'gobilda-<시리즈>'가 출처 표시(ObjectMass.detail)가
// 된다.
// STEP 안의 재질 정보는 쓰지 않는다(Fusion 기본값 "Steel, Mild"가 바퀴 고무에도 남아 있어 믿을 수 없다).

export type NameRule = {
  // 출처 표시에 보이는 규칙 이름(낱말 규칙은 맞은 낱말열, SKU 시리즈는 'gobilda-<시리즈>')
  name: string
  // null이면 질량 0(라벨·표시용 판처럼 실제로는 없는 솔리드)
  material: MaterialKey | null
}

type WordRule = {
  // null이면 질량 0
  material: MaterialKey | null
  // 맞출 낱말열(공백으로 나눈 낱말들이 이름 안에 이어서 나오면 맞음). 낱말은 소문자이고 복수형(s, es)도 맞는다.
  // 규칙 사이에 겹치지 않는다(출처 표시의 낱말열로 재질을 다시 찾으므로).
  phrases: readonly string[]
}

const rule = (material: MaterialKey | null, ...phrases: string[]): WordRule => ({
  material,
  phrases
})

// 낱말 규칙(대소문자 무시, 낱말 경계). 두 무리다.
// - MATERIAL_RULES(재질 이름과 질량 0인 장식): 이름의 어디에 있든 먼저이고, 여럿이면 위에서 첫 맞는 것이다.
// - PART_RULES(부품 종류): 영어 부품 이름은 중심 명사가 마지막이라('Bearing Plate'는 판, 'Shaft Collar'는 칼라, 'Belt
//   Pulley'는 풀리) 가장 오른쪽에서 끝나는 낱말열의 규칙이다. 같은 자리에서 끝나면 긴 낱말열('set screw collar'가
//   'collar'보다), 그다음 위의 것이다. 부품 종류의 재질은 줄마다 단 goBILDA 시리즈(위 GOBILDA_SERIES의 상품 페이지)에서
//   왔고, 확인하지 못한 것은 "가정"이라고 적었다.
// 키트 이름에 OR·IR·OD·ID 같은 치수 약어가 나오므로 오인하기 쉬운 3글자 이하 낱말(ss, pc, or, id, cf, ply, alu, pom,
// eva)은 넣지 않는다. 재질 키와 같은 pla·abs·tpu와 하드웨어 이름 pin·nut·hub만 짧은 낱말로 둔다(낱말 경계로만 맞으므로
// Spinner의 pin은 잡지 않는다).
const MATERIAL_RULES: readonly WordRule[] = [
  // 이름에 재질이 직접 있으면 그것이 먼저다
  rule('stainless', 'stainless'),
  rule('brass', 'brass'),
  // goBILDA 2303·2320·2920 이름에 "Steel". carbon steel이 탄소섬유가 되지 않게 carbon보다 먼저
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
  // goBILDA 예제 STEP의 Top Label·Side Label·Labels는 장식 솔리드(실제로는 스티커). 자리와 관계없이 질량 0이다
  rule(null, 'label', 'sticker', 'decal')
]

const PART_RULES: readonly WordRule[] = [
  // goBILDA 2920 세트 스크루 칼라(아연 도금 강철, 6 mm 7.1 g). collar(알루미늄)·screw보다 긴 낱말열
  // https://core-electronics.com.au/2920-series-steel-set-screw-collar-6mm-bore-2-pack.html
  rule('steel', 'set screw collar', 'set screw clamp'),
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
  // https://ca.robotshop.com/products/8mm-rex-servo-shaft-25-tooth-spline-36mm-length
  rule('aluminum6061', 'servo shaft'),
  rule('steel', 'shaft', 'axle'),
  // goBILDA 2910 클램핑 칼라(세트 스크루 칼라 2920은 위 set screw collar)
  // https://core-electronics.com.au/2910-series-aluminum-clamping-collar-12mm-id-x-26mm-od-9mm-length.html
  rule('aluminum6061', 'collar'),
  // goBILDA 2303 피니언, 2320 마이터 기어. 'Pinion Gear'처럼 gear가 뒤에 와도 강철이게 낱말열을 둔다(worm gear는
  // 강철로 가정)
  rule('steel', 'pinion', 'miter', 'worm', 'pinion gear', 'miter gear', 'worm gear'),
  // goBILDA 2302 허브 마운트 기어, 3310 스프로킷
  rule('aluminum6061', 'gear', 'sprocket'),
  // goBILDA 8 mm 피치 강철 체인 https://uk.robotshop.com/products/gobilda-1m-8mm-pitch-steel-chain
  rule('steel', 'chain', 'master link'),
  // goBILDA 3412 HTD 벨트(네오프렌 1.23 + 유리섬유 심, 고무 1.15로 근사), 바퀴 트레드·롤러
  rule('rubber', 'belt', 'tire', 'tyre', 'tread', 'roller', 'o ring'),
  // goBILDA 3413 아세탈 아이들러
  rule('acetal', 'idler'),
  // goBILDA 3401 풀리(알루미늄으로 가정, 플라스틱 3402는 이름의 Plastic이 정한다)
  // https://core-electronics.com.au/3402-series-3mm-htd-pitch-plastic-hub-mount-timing-belt-pulley-14mm-bore-36-tooth.html
  rule('aluminum6061', 'pulley'),
  // goBILDA 1501 스탠드오프, 1502·1505·1514 스페이서
  rule('aluminum6061', 'spacer', 'standoff'),
  // REV Control Hub·Expansion Hub(플라스틱 케이스로 가정. 데이터시트 질량 209 g은 REV SKU가 정한다, cotsTable.ts).
  // hub(알루미늄)보다 긴 낱말열
  rule('polycarbonate', 'control hub', 'expansion hub'),
  // goBILDA 1309 Sonic Hub·1310 Hyper Hub(알루미늄으로 가정)
  // https://core-electronics.com.au/1310-series-hyper-hub-12mm-bore.html
  rule('aluminum6061', 'hub'),
  // goBILDA 1120 U-channel, REV 15 mm 압출재, Studica 채널, 1201–1222 패턴 판·브래킷·마운트(알루미늄으로 가정,
  // materials.md §4.4), 베어링 블록·모터 마운트 같은 팀 가공 구조재(알루미늄으로 가정)
  rule('aluminum6061', 'channel', 'extrusion', 'tube', 'bracket', 'plate', 'mount', 'block'),
  // goBILDA 2909 케이블 타이(나일론 PA66)
  rule('nylon', 'zip tie', 'cable tie')
]

// 모든 낱말 규칙(재질 이름 무리 다음 부품 종류 무리, 출처 표시의 낱말열로 재질을 다시 찾는 데 쓴다)
export const WORD_RULES: readonly WordRule[] = [...MATERIAL_RULES, ...PART_RULES]

// goBILDA 부품 번호(SKU) NNNN-NNNN-NNNN. 앞 네 자리가 시리즈다(goBILDA 예제 STEP의 PRODUCT 이름 374개 중 221개가
// SKU뿐이고 낱말이 없다).
const GOBILDA_SKU = /(?<![0-9])([0-9]{4})-[0-9]{4}-[0-9]{4}(?![0-9])/g

// goBILDA 시리즈 → 재질. 줄마다 그 시리즈 상품 페이지(재질이 이름이나 사양 표에 있음)를 단다. 확인하지 못한 시리즈는
// "가정"이라고 적었다. 3625(GripForce 메카넘)·3606(메카넘)·3100(배터리)·2000·2004(서보)·3110(Pinpoint·포드)·
// 3122(Limelight)·5202–5204(모터)는 재질이 아니라 COTS 질량이다(cotsTable.ts). 맞는 SKU가 그 표에 없으면 여기에도
// 없으므로 기본 재질이다.
const GOBILDA_SERIES: Readonly<Record<string, MaterialKey>> = {
  // U-Channel(알루미늄 clear anodized, 사양 표)
  // https://core-electronics.com.au/1120-series-u-channel-21-hole-528mm-length.html
  '1120': 'aluminum6061',
  // Low-Side U-Channel(1120과 같은 목록) https://www.gobilda.com/1120-series-u-channel
  '1121': 'aluminum6061',
  // 패턴 판·브래킷·마운트(알루미늄으로 가정, 시리즈별 재질은 확인 못 함. 상품 예:
  // https://core-electronics.com.au/1208-series-surface-mount-1-1.html)
  '1143': 'aluminum6061',
  '1201': 'aluminum6061',
  '1205': 'aluminum6061',
  '1208': 'aluminum6061',
  '1209': 'aluminum6061',
  '1222': 'aluminum6061',
  // Sonic Hub·Hyper Hub(알루미늄으로 가정) https://core-electronics.com.au/1310-series-hyper-hub-12mm-bore.html
  '1309': 'aluminum6061',
  '1310': 'aluminum6061',
  // Plastic Spacer(일반 플라스틱 1.20)
  // https://core-electronics.com.au/1500-series-plastic-spacer-25mm-id-x-27mm-od-1mm-thickness-12-pack.html
  '1500': 'polycarbonate',
  // M4 알루미늄 스탠드오프
  // https://robotshop.com/products/gobilda-1501-series-m4-x-07mm-aluminum-standoff-16mm-length-6mm-od-4x
  '1501': 'aluminum6061',
  // 스페이서(알루미늄) https://core-electronics.com.au/1502-series-4mm-id-spacer-5mm-od-10mm-length-4-pack.html ,
  // https://www.gobilda.com/1505-series-32mm-od-counterbored-pattern-spacer-16mm-length/ ,
  // https://core-electronics.com.au/1514-series-8mm-id-spacer-10mm-od-12mm-length-4-pack.html
  '1502': 'aluminum6061',
  '1505': 'aluminum6061',
  '1512': 'aluminum6061',
  '1514': 'aluminum6061',
  // REX 스페이서(1514를 잇는 시리즈라 알루미늄으로 가정)
  // https://core-electronics.com.au/1514-series-8mm-id-spacer-10mm-od-8mm-length-4-pack.html
  '1516': 'aluminum6061',
  '1522': 'aluminum6061',
  // 6 mm ID 스페이서(사양 표는 강철, 판매처 본문과 엇갈림)
  // https://core-electronics.com.au/1521-series-6mm-id-spacer-8mm-od-2mm-length-4-pack.html
  '1521': 'steel',
  // 플랜지 볼 베어링(고탄소강)
  // https://core-electronics.com.au/1611-series-flanged-ball-bearing-8mm-id-x-14mm-od-5mm-thickness-2-pack.html ,
  // https://core-electronics.com.au/gobilda-6mm-id-flanged-ball-bearing-12mm-od-4mm-thickness-pack-of-2.html
  '1600': 'steel',
  '1601': 'steel',
  '1611': 'steel',
  // 스테인리스 REX 축 https://core-electronics.com.au/2106-series-stainless-steel-rex-shaft-8mm-diameter-48mm-length.html
  '2100': 'stainless',
  '2106': 'stainless',
  // 허브 마운트 기어(알루미늄)
  // https://core-electronics.com.au/2302-series-aluminum-mod-08-hub-mount-gear-14mm-bore-60-tooth.html
  '2302': 'aluminum6061',
  // 피니언(강철) https://www.gobilda.com/2303-series-steel-mod-0-8-pinion-gear-8mm-rex-bore-36-tooth
  '2303': 'steel',
  // 클램핑 마이터 기어(강철) https://core-electronics.com.au/clamping-steel-miter-gear-6mm-d-bore-24-tooth-mod-1-gobilda.html
  '2320': 'steel',
  // 28xx 체결 부품(아연 도금 강철). 2800·2804 나사
  // https://core-electronics.com.au/2800-series-zinc-plated-steel-socket-head-screw-m4-x-07mm-10mm-length-25-pack.html ,
  // 2801 와셔 https://core-electronics.com.au/2801-series-zinc-plated-steel-washer-4mm-id-x-8mm-od-25-pack.html ,
  // 2816 hook-nut https://core-electronics.com.au/hook-nut-m4-x-07mm-thread-25-pack.html . 2806·2807·2809·2810·
  // 2812·2822·2824는 같은 시리즈라 강철로 가정
  '2800': 'steel',
  '2801': 'steel',
  '2804': 'steel',
  '2806': 'steel',
  '2807': 'steel',
  '2809': 'steel',
  '2810': 'steel',
  '2812': 'steel',
  '2816': 'steel',
  '2822': 'steel',
  '2824': 'steel',
  // 나사산 판(스테인리스) https://core-electronics.com.au/2803-series-stainless-steel-threaded-plate-7-7-24-pack.html
  '2803': 'stainless',
  // 케이블 타이(시리즈는 키트 목록 https://core-electronics.com.au/ftc-starter-kit-2023-2024-season.html , 재질은 일반
  // 케이블 타이의 나일론 PA66으로 가정)
  '2909': 'nylon',
  // 클램핑 칼라(알루미늄)
  // https://core-electronics.com.au/2910-series-aluminum-clamping-collar-12mm-id-x-26mm-od-9mm-length.html
  '2910': 'aluminum6061',
  // 세트 스크루 칼라(아연 도금 강철) https://core-electronics.com.au/2920-series-steel-set-screw-collar-6mm-bore-2-pack.html
  '2920': 'steel',
  // ServoBlock(알루미늄으로 가정) https://gobilda.com/gobilda-servo-starter-pack
  '3217': 'aluminum6061',
  // 8 mm 플라스틱 체인 링크(재질 미확인, 아세탈로 가정) https://www.gobilda.com/sitemap/categories
  '3309': 'acetal',
  // 8 mm 피치 스프로킷(알루미늄)
  // https://core-electronics.com.au/3310-series-8mm-pitch-aluminum-hub-mount-sprocket-14mm-bore-42-tooth.html
  '3310': 'aluminum6061',
  // 플라스틱 벨트 풀리
  // https://core-electronics.com.au/3402-series-3mm-htd-pitch-plastic-hub-mount-timing-belt-pulley-14mm-bore-36-tooth.html
  '3402': 'polycarbonate',
  // HTD 타이밍 벨트(네오프렌 + 유리섬유 심, 고무로 근사)
  // https://core-electronics.com.au/3412-series-5mm-htd-pitch-timing-belt-9mm-width-840mm-pitch-length-168-tooth.html
  '3403': 'rubber',
  '3412': 'rubber',
  // 아세탈 벨트 아이들러 https://core-electronics.com.au/acetal-timing-belt-idler-6mm-id-x-12mm-od-12mm-width-1-1-2-pack.html
  '3413': 'acetal',
  // 3613(Gecko·48 mm 바퀴)·3626(96 mm 50A 바퀴)·3618(16 mm 롤러): goBILDA 검색
  // https://www.gobilda.com/search.php?search_query=<SKU>로 종류를 확인했다. COTS 질량을 찾지 못해 고무로 근사한다
  // (알루미늄으로 보면 2.70 / 1.15 ≈ 2.3배 무겁다)
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

// 이름 하나의 낱말(자리마다 그 낱말과 복수형을 뗀 꼴)과, 낱말 하나짜리 규칙을 바로 찾는 집합
type NameWords = { list: string[][]; set: Set<string> }

function wordsOf(name: string): NameWords {
  const list = nameWords(name).map(baseForms)
  return { list, set: new Set(list.flat()) }
}

// 낱말열 하나(규칙 순번은 WORD_RULES의 순번)
type Phrase = { index: number; phrase: string; targets: string[] }

const phrasesOf = (rules: readonly WordRule[], offset: number): Phrase[] =>
  rules.flatMap((wordRule, i) =>
    wordRule.phrases.map((phrase) => ({ index: offset + i, phrase, targets: phrase.split(' ') }))
  )

const MATERIAL_PHRASES = phrasesOf(MATERIAL_RULES, 0)
const PART_PHRASES = phrasesOf(PART_RULES, MATERIAL_RULES.length)

// 낱말열이 이름의 start 자리부터 이어서 나오는지
function phraseAt(words: NameWords, targets: readonly string[], start: number): boolean {
  const { list } = words
  return (
    start + targets.length <= list.length &&
    targets.every((target, i) => list[start + i].includes(target))
  )
}

function hasPhrase(words: NameWords, targets: readonly string[]): boolean {
  if (targets.length === 1) return words.set.has(targets[0])
  for (let start = 0; start + targets.length <= words.list.length; start++) {
    if (phraseAt(words, targets, start)) return true
  }
  return false
}

// 재질 이름 무리: 이름들 어디에든 맞는 가장 위 규칙과, 그 규칙에서 맞은 낱말열(규칙에 적은 순서로 첫 것)
function materialRule(names: readonly NameWords[]): NameRule | null {
  for (const { index, phrase, targets } of MATERIAL_PHRASES) {
    if (!names.some((words) => hasPhrase(words, targets))) continue
    const { material, phrases } = WORD_RULES[index]
    const first = phrases.find((candidate) =>
      names.some((words) => hasPhrase(words, candidate.split(' ')))
    )
    return { name: first ?? phrase, material }
  }
  return null
}

// 부품 종류 무리: 이름 하나에서 가장 오른쪽에서 끝나는 낱말열(같은 자리면 긴 것, 그다음 위의 규칙)
function partRule(words: NameWords): NameRule | null {
  let best: { end: number; length: number; phrase: Phrase } | null = null
  for (const phrase of PART_PHRASES) {
    const { targets } = phrase
    if (!words.set.has(targets[targets.length - 1])) continue
    for (let start = words.list.length - targets.length; start >= 0; start--) {
      if (!phraseAt(words, targets, start)) continue
      const end = start + targets.length - 1
      const better =
        !best ||
        end > best.end ||
        (end === best.end && targets.length > best.length) ||
        (end === best.end && targets.length === best.length && phrase.index < best.phrase.index)
      if (better) best = { end, length: targets.length, phrase }
      break
    }
  }
  if (!best) return null
  return { name: best.phrase.phrase, material: WORD_RULES[best.phrase.index].material }
}

// 이름 안의 goBILDA SKU들(나온 순서)
export function goBildaSkus(name: string): string[] {
  return [...name.matchAll(GOBILDA_SKU)].map((match) => match[0])
}

// 이름들(한 묶음)에 맞는 규칙: 재질 이름 낱말(어느 이름이든) → 부품 종류 낱말(이름 순서로 첫 맞는 이름의 가장 오른쪽
// 낱말) → 이름에 나온 goBILDA SKU의 시리즈. 맞는 것이 없으면 null. 질량 모델은 이름 하나씩 부른다.
export function matchNameRule(names: readonly string[]): NameRule | null {
  const words = names.map(wordsOf)
  const material = materialRule(words)
  if (material) return material
  for (const name of words) {
    const part = partRule(name)
    if (part) return part
  }
  for (const name of names) {
    for (const sku of goBildaSkus(name)) {
      const series = sku.slice(0, 4)
      const material = GOBILDA_SERIES[series]
      if (material) return { name: `gobilda-${series}`, material }
    }
  }
  return null
}

// 규칙 이름(맞은 낱말열 또는 'gobilda-<시리즈>') → 재질(출처 표시용). 모르는 이름이면 undefined, 질량 0 규칙이면 null.
export function nameRuleMaterial(ruleName: string): MaterialKey | null | undefined {
  if (ruleName.startsWith('gobilda-')) return GOBILDA_SERIES[ruleName.slice('gobilda-'.length)]
  return WORD_RULES.find((wordRule) => wordRule.phrases.includes(ruleName))?.material
}
