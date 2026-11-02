import type { MaterialKey } from './types'

// 재질 밀도(kg/m³). 줄마다 단 제조사·공급사 데이터시트 값이다(범위가 있으면 함께 적는다).
// 로봇 전체는 저울 무게로 맞추므로(massModel.ts) 결과를 좌우하는 것은 재질 사이의 비율이고, 2–3 % 차이는 남지 않는다.
// printed는 3D 프린터 필라멘트다: 출력물은 껍질 + 채움이라 유효 밀도가 낮다(printedFillFraction).

export type MaterialDef = {
  // kg/m³
  density: number
  printed: boolean
}

export const MATERIALS: Readonly<Record<MaterialKey, MaterialDef>> = {
  // Protolabs 6061-T651 데이터시트 2.70 g/cm³
  // https://www.protolabs.com/media/h54d0gnp/2026-026-cnc-material-data-sheet_aluminum-6061-t651_t6.pdf
  // goBILDA 예제 STEP의 U-channel 5종(1120-0001-0048 … 1120-0015-0384)의 CAD 부피 × 2.70이 goBILDA 공시 무게와
  // 0–1.4 % 안이다(예: https://www.gobilda.com/1120-series-u-channel-1-hole-48mm-length/ 35 g, massModel.test.ts)
  aluminum6061: { density: 2700, printed: false },
  // nTop 재료 문서(MatWeb 인용) 2.81 g/cc, MakeItFrom 2.80(범위 2.80–2.81)
  // https://docs.ntop.com/Product-Documentation/ntop/block-documentation/blocks/design-analysis/sample-materials/al-7075-t6.md
  aluminum7075: { density: 2810, printed: false },
  // 탄소강·합금강(축, 나사, 핀). Elgin 4140 7.85 g/cc(범위 7.83–7.87, 1018은 7.87)
  // https://www.mwcomponents.com/uploads/Resource-Center/Elgin-Material-Sheets/Alloy-Steel-Grade-4140-Fact-Sheet_Elgin-Website.pdf
  steel: { density: 7850, printed: false },
  // 304/304L 오스테나이트 일반값 7.90(범위 7.90–8.00, 8.0으로 적는 곳도 있다)
  // https://www.mechanics-industry.org/articles/meca/full_html/2020/06/mi200126/T1.html
  stainless: { density: 7900, printed: false },
  // 황동 C360. Fictiv 0.307 lb/in³ = 8.50, Xometry 8.49(범위 8.47–8.53)
  // https://www.xometry.com/capabilities/cnc-machining-service/brass/
  brass: { density: 8500, printed: false },
  // SABIC LEXAN EXELL-D ISO 1183 1.20(범위 1.20–1.23)
  // https://amariplastics.com/media/import/AMARI_LEXAN-EXELL_D.pdf
  polycarbonate: { density: 1200, printed: false },
  // Delrin(POM-H). Sterling Plastics D792 1.41, Delrin 150 TDS 1.42(범위 1.41–1.42)
  // https://sterlingplasticsinc.com/product/delrin-150-homo-polymer/
  acetal: { density: 1410, printed: false },
  // HDPE 판 ASTM D792: A&C Plastics 0.955(https://www.acplasticsinc.com/media/HDPE%20Typical Properties.pdf, 주소에 공백이
  // 있고 2026-11에 404), Spartech 0.96(https://www.spartech.com/media/tds/HDPE.pdf). 범위 0.947–0.96
  hdpe: { density: 955, printed: false },
  // 나일론 PA6(케이블 타이 PA66 포함). Xometry Nylon 6 데이터시트 1.14(범위 1.10–1.14)
  // https://xometry.pro/wp-content/uploads/2023/12/Nylon-6.pdf
  nylon: { density: 1140, printed: false },
  // 탄소섬유 판(3K 능직, 에폭시). Rock West Composites 판 1.45 g/cm³, 섬유 비율에 따라 1.45–1.6(± 출처끼리 엇갈림)
  // https://www.rockwestcomposites.com/400-2mm-22.html
  carbonFiber: { density: 1480, printed: false },
  // 자작 합판. Metsä Wood 성능 선언서 680 kg/m³(RH 65 %, 범위 0.64–0.74)
  // https://www.metsagroup.com/globalassets/metsa-wood/dop-documents/dop_metsa_wood_birch_plywood_muf_2019-12-2_en.pdf
  plywood: { density: 680, printed: false },
  // 고무 배합물(바퀴 트레드, 롤러, 벨트 근사). 배합물 1.1–1.3, 순수 천연고무 0.93, 우레탄 1.02–1.14(± 엇갈림)
  // https://www.induflex.dk/media/5luly3w1/rubber-table.pdf
  rubber: { density: 1150, printed: false },
  // EVA 폼. Gumex EVA 판 85–90 kg/m³, 등급에 따라 30–200+ kg/m³
  // https://racklify.com/encyclopedia/what-is-eva-foam-uses-grades-and-properties/
  foam: { density: 100, printed: false },
  // Prusament PLA TDS v1.1 ISO 1183 1.24 https://www.matterhackers.com/r/xFvGl8
  pla: { density: 1240, printed: true },
  // Prusament PETG TDS v1.1 ISO 1183 1.27 https://www.3dprintergear.com.au/assets/files/technical-data-sheet%20(1).pdf ,
  // 판매처 사양 1.27 https://botland.store/petg-filaments/26760-filament-prusa-refill-petg-175mm-1kg-signal-white.html
  petg: { density: 1270, printed: true },
  // Tiertime ABS ISO 1183 1.04(범위 1.03–1.07)
  // https://cdn.robotshop.com/rbm/45fee604-4605-428c-a971-be4a96a14b16/2/24ee28b9-1431-4ffa-b7a4-0ae382ac9555/c8fcd696_technical-data-tiertime-abs-material.pdf
  abs: { density: 1040, printed: true },
  // TPU 95A. Bambu 1.20, Polymaker 1.20–1.24, Ultimaker 1.22(범위 1.20–1.25)
  // https://um-support-files.ultimaker.com/materials/2.85mm/tds/TPU-95A/TDS-TPU95A-V2.01-250915.pdf
  tpu: { density: 1210, printed: true }
}

// 로봇에 기본 재질이 없을 때(RigidbodySettings.defaultMaterial). 팀 로봇 대부분이 알루미늄 구조라 고른 판단값이다.
export const DEFAULT_MATERIAL: MaterialKey = 'aluminum6061'

// 출력물 껍질 두께 t(m): 벽 3개 × 선 폭 0.45 mm = 1.35 mm와 위·아래 단단한 층 0.8 mm(0.2 mm × 4)의 평균.
// 출력 방향을 모르므로 평균한다. 벽 3은 FTC 문서의 일반 파트 "3 alternating 4 Walls"
// (https://ftc-docs.firstinspires.org/manufacturing/3d_printing/designing_and_slicing/slicing_settings/slicing_settings.html),
// 선 폭은 PrusaSlicer 0.4 노즐 기본 0.45 mm(https://forum.prusa3d.com/forum/prusaslicer/prusaslicer-problem-wall-perimeters/),
// 위·아래 0.8 mm는 흔한 슬라이서 값이라 출처를 확인하지 못한 가정이다.
export const PRINTED_SHELL_THICKNESS = 0.0011

// 출력물에서 재료가 찬 부피 비율 f = f_shell + (1 − f_shell)·infill, f_shell = min(1, A·t/V).
// 껍질이 100 %이고 안이 채움 비율로 차 있다는 근사다. 직육면체의 정확한 안쪽 상자 (a − 2t_벽)(b − 2t_벽)(c − 2t_위아래)와
// 견주면 덩어리 파트(20–80 mm)에서 ±0.02 안이고, 눕혀 출력한 얇은 판(5 mm 이하)은 0.1–0.15 무겁게 본다
// (100×50×5 판, 벽 3·채움 25 %: 정확 0.53, 근사 0.63). 부피나 면적이 0이면 채움만.
export function printedFillFraction(volume: number, area: number, infill: number): number {
  const shell = volume > 0 && area > 0 ? Math.min(1, (area * PRINTED_SHELL_THICKNESS) / volume) : 0
  return shell + (1 - shell) * infill
}

// 유효 밀도(kg/m³). 출력 재질이 아니면 infill을 쓰지 않는다.
export function effectiveDensity(
  material: MaterialKey,
  volume: number,
  area: number,
  infill: number
): number {
  const def = MATERIALS[material]
  return def.printed ? def.density * printedFillFraction(volume, area, infill) : def.density
}
