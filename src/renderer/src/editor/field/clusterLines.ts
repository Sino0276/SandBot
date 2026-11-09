import type { FieldSpec } from '../../../../shared/sim/seasons/fieldSpec'
import { clusterFieldPoses } from '../../../../shared/sim/seasons/tagPoses'

// Field 인스펙터의 "AprilTag 묶음(SDK 라이브러리용)" 줄(4d, spec-4d §1.6·§1.15). 묶음마다 필드 자세(seasons/tagPoses.ts
// clusterFieldPoses, 지금 HIVE 상태)를 팀이 AprilTagClusterMetadata에 넣을 글자로 만든다. 위치는 SDK가 묶음 fieldPosition을
// 늘 인치로 쓰므로(AprilTagProcessorImpl.java:498–500) in이고, 사원수는 [w, x, y, z](new Quaternion(w, x, y, z, 0))다.

const METERS_PER_INCH = 0.0254
// 표시 자릿수: in 소수 넷째(0.1 mm 아래), 사원수 소수 일곱째(Java float 유효 자릿수 7자리와 같은 정밀도) [spec-4d §1.15]
const INCH_DIGITS = 4
const QUATERNION_DIGITS = 7

// toFixed가 "-0.0000"을 내면 "0.0000"으로(인스펙터 글자와 붙여 넣을 Java에 음의 0이 보이지 않게)
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits)
  return /^-0\.0*$/.test(text) ? text.slice(1) : text
}

export type ClusterLine = {
  name: string
  // i18n field.inspector.clusters.line의 값(글자 그대로, Java float 리터럴의 앞부분)
  params: {
    name: string
    x: string
    y: string
    z: string
    w: string
    qx: string
    qy: string
    qz: string
  }
  // [복사]가 클립보드에 넣는 글자: AprilTagClusterMetadata 생성자의 마지막 세 인수(fieldPosition, distanceUnit,
  // fieldOrientation)로 그대로 붙여 넣으면 컴파일된다(Vision 12.0 AprilTagClusterMetadata.java:69–70)
  copyText: string
}

// 그 시즌의 묶음 줄(SDK 라이브러리 순서). 묶음이 없는 시즌('none')은 빈 목록
export function clusterLines(
  spec: FieldSpec,
  hiveTipped: readonly [boolean, boolean]
): ClusterLine[] {
  return clusterFieldPoses(spec, hiveTipped).map((cluster) => {
    const [w, qx, qy, qz] = cluster.quaternion.map((v) => fixed(v, QUATERNION_DIGITS))
    const [x, y, z] = [cluster.position.x, cluster.position.y, cluster.position.z].map((v) =>
      fixed(v / METERS_PER_INCH, INCH_DIGITS)
    )
    return {
      name: cluster.name,
      params: { name: cluster.name, x, y, z, w, qx, qy, qz },
      copyText:
        `new VectorF(${x}f, ${y}f, ${z}f), DistanceUnit.INCH, ` +
        `new Quaternion(${w}f, ${qx}f, ${qy}f, ${qz}f, 0)`
    }
  })
}
