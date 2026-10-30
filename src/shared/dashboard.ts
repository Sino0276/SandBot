// FTC Dashboard 대체(라이브러리 L2)의 와이어 형식. 사이드카의 SandBot FtcDashboard가 보내는 패킷·설정 트리를 메인과
// 렌더러가 같이 쓴다. op 모양은 실제 Dashboard(0.6.0 core)의 Gson 직렬화와 같다(필드 이름 그대로, 단위 인치·라디안).
// 렌더러는 이것을 Dashboard 웹 클라이언트(Field.js)처럼 씬 뷰에 그린다(play/dashOverlay.ts).

// 캔버스 op 하나(com.acmerobotics.dashboard.canvas.*). type은 Gson이 쓰는 이름 그대로다.
export type DashOp =
  | { type: 'circle'; x: number; y: number; radius: number; stroke: boolean }
  | { type: 'polygon'; xPoints: number[]; yPoints: number[]; stroke: boolean }
  | { type: 'polyline'; xPoints: number[]; yPoints: number[] }
  | {
      type: 'spline'
      ax: number
      bx: number
      cx: number
      dx: number
      ex: number
      fx: number
      ay: number
      by: number
      cy: number
      dy: number
      ey: number
      fy: number
    }
  | {
      type: 'text'
      text: string
      x: number
      y: number
      font: string
      theta: number
      stroke: boolean
      usePageFrame: boolean
    }
  | {
      type: 'image'
      path: string
      x: number
      y: number
      width: number
      height: number
      theta: number
      pivotX: number
      pivotY: number
      usePageFrame: boolean
    }
  | {
      type: 'grid'
      x: number
      y: number
      width: number
      height: number
      numTicksX: number
      numTicksY: number
      theta: number
      pivotX: number
      pivotY: number
      usePageFrame: boolean
    }
  | { type: 'translate'; x: number; y: number }
  | { type: 'rotation'; rotation: number }
  | { type: 'scale'; scaleX: number; scaleY: number }
  | { type: 'fill'; color: string }
  | { type: 'stroke'; color: string }
  | { type: 'strokeWidth'; width: number }
  | { type: 'alpha'; alpha: number }

export type DashOpType = DashOp['type']

// 패킷 한도(사이드카가 자르고 메인이 다시 확인한다)
export const MAX_DASH_OPS = 2000
// 한 패킷의 모든 다각형·선의 점 수 합
export const MAX_DASH_POINTS = 20_000
export const MAX_DASH_DATA = 500
// 키·값·로그 줄·글자 op 하나의 글자 수
export const MAX_DASH_TEXT = 8192
export const MAX_DASH_LOG_LINES = 200

// 설정 변수 형식(com.acmerobotics.dashboard.config.variable.VariableType, CUSTOM은 트리 노드)
export type DashVariableType =
  'boolean' | 'int' | 'long' | 'float' | 'double' | 'string' | 'readonlyString' | 'enum'

// FieldProvider로 읽는 변수의 필드(Field.getDeclaringClass()의 바이너리 이름과 필드 이름). 렌더러가 TeamCode 튜닝 값과
// 맞춘다(선언 클래스 → 소스 파일, 중첩 경로#필드 → 튜닝 값 id).
export type DashFieldSource = { declaringClass: string; field: string }

// Dashboard 설정 트리(CustomVariable). 자식은 이름순(실제 CustomVariable은 HashMap이라 정렬해 결정적으로 보낸다).
export type DashConfigNode =
  | { kind: 'custom'; children: DashConfigChild[] }
  | {
      kind: 'value'
      type: DashVariableType
      // ValueProvider.get()을 글자로(Double·Float.toString, enum name(), null은 'null')
      value: string
      // enum이면 상수 이름들(선언 순서), 아니면 []
      enumValues: string[]
      source: DashFieldSource | null
    }

export type DashConfigChild = { name: string; node: DashConfigNode }

// Config 탭에서 바꾼 값 하나. path는 루트부터의 이름들(묶음 이름, 필드 …). value는 그 형식의 글자.
export type DashConfigSet = { path: string[]; value: string }

export const MAX_DASH_CONFIG_NODES = 5000
export const MAX_DASH_CONFIG_DEPTH = 16
