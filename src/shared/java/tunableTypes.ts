// 튜닝 값(3단계)의 공용 타입. 파서(src/shared/java/tunables.ts)가 만들고, 렌더러 인스펙터와 저장 흐름이 쓴다.
//
// 어떤 필드를 보이는지는 FTC Dashboard(0.6.0, FtcDashboard.addConfigClasses·ReflectionConfig)와 같다.
// - @Config(com.acmerobotics.dashboard.config.Config)가 붙고 @Disabled(com.qualcomm.robotcore.eventloop.opmode.Disabled)가
//   없는 클래스마다 한 묶음. 중첩 클래스도 따로 본다. 묶음 이름은 @Config("이름") 값, 없으면 단순 이름.
// - 필드는 public static이고 final이 아닌 것(getFields라 같은 파일의 상위 클래스 필드 포함). 값 형식은 boolean·int·long·
//   float·double(박싱 포함)·String·enum이고, 그 밖의 형식은 객체로 보고 그 형식의 public 인스턴스 필드(상위 클래스 것
//   포함)를 펼친다(같은 파일에 선언되고 `new T()`일 때).

// 값 칸의 Java 형식
export type TunableValueType = 'boolean' | 'int' | 'long' | 'float' | 'double' | 'String'

// 고칠 수 없는 이유(inspector.tunables.readOnly.* 번역 키)
export type TunableReadOnlyReason =
  // 초기값이 리터럴 하나가 아님(식, 다른 필드 참조 등)
  | 'expression'
  // 초기값이 없음(Dashboard는 기본값을 보이지만 SandBot은 아직 넣지 않는다)
  | 'noInitializer'
  // 텍스트 블록("""), 문자열 안의 \u 이스케이프
  | 'textBlock'
  // 줄바꿈(CR·LF)이 든 문자열(한 줄 입력칸이 줄바꿈을 지우므로, 고치면 줄바꿈이 빠진 값을 쓴다)
  | 'lineBreak'
  // 생성자·인스턴스 초기화 블록(그 형식이나 같은 파일의 상위 클래스, 바깥 객체의 형식)이나 선언한 형식의 static 블록이
  // 값을 정할 수 있음(초기값을 고쳐도 실행할 때의 값이 바뀌지 않는다). 객체는 펼치되 자식 값이 모두 이 이유다.
  | 'initializedInType'
  // 파일에 리터럴 밖의 \u 이스케이프가 있음(javac가 먼저 바꾸므로 위치를 믿을 수 없다)
  | 'unicodeEscape'
  // 박싱 형식의 null
  | 'null'
  // enum 값(목록을 아직 고르지 못함)
  | 'enum'
  // 같은 파일에 없는 형식, new T()가 아닌 객체, final 객체 필드, 깊이 한도·순환
  | 'object'
  // short·byte·char·배열·제네릭 등
  | 'unsupportedType'
  // 파일 자체를 쓸 수 없음(UTF-8로 그대로 되돌릴 수 없음, 생성 표식, 너무 큼)
  | 'file'

export type TunableSpan = { start: number; end: number }

// 필드 id는 선언한 형식의 경로 + '#' + 필드 이름이다(예: 'Lift#kP', 'MecanumDrive.Params#kS').
// 객체 필드의 자식은 그 형식의 선언 위치로 id를 짓는다(같은 형식의 static 필드 둘은 자식 id를 나눠 쓴다).
// 상위 클래스에서 물려받은 필드도 선언한 형식의 id다(Child 묶음의 'Base#GAIN'). 같은 id의 노드는 고칠 수 있는지도 같다.
export type TunableNode =
  | {
      kind: 'value'
      id: string
      name: string
      type: TunableValueType
      boxed: boolean
      // 초기값의 원래 글자(없으면 null). span은 파일 안의 위치(UTF-16 오프셋, BOM 포함)
      literal: string | null
      span: TunableSpan | null
      editable: boolean
      reason?: TunableReadOnlyReason
      // 1부터
      line: number
    }
  | {
      kind: 'object'
      id: string
      name: string
      typeName: string
      // 초기값 글자(예: 'new Params()')
      text: string | null
      children: TunableNode[]
      // 펼치지 못하면 children이 비고 이유가 있다
      reason?: TunableReadOnlyReason
      line: number
    }
  | {
      kind: 'other'
      id: string
      name: string
      // 선언한 형식 글자
      typeText: string
      text: string | null
      reason: TunableReadOnlyReason
      line: number
    }

export type TunableBlock = {
  // 선언 형식의 경로(예: 'Lift', 'MecanumDrive.Params')
  classPath: string
  // Dashboard에 보이는 묶음 이름(@Config 값 또는 단순 이름)
  name: string
  line: number
  fields: TunableNode[]
}

export type TunableFile = {
  blocks: TunableBlock[]
  // 리터럴 밖에 \u 이스케이프가 있다(모든 값을 읽기 전용으로 둔다)
  unicodeEscapes: boolean
  // @Config 없는 클래스에 public static 필드가 있다(인스펙터가 "@Config를 붙이면 여기서 고칠 수 있다"고 알린다)
  staticFieldsWithoutConfig: boolean
}
