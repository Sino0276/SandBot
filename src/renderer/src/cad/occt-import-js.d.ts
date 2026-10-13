// occt-import-js(OpenCascade WASM)는 타입을 제공하지 않아 쓰는 부분만 선언한다.
declare module 'occt-import-js' {
  export type OcctColor = [number, number, number]

  export type OcctMesh = {
    name: string
    color?: OcctColor
    brep_faces: { first: number; last: number; color: OcctColor | null }[]
    attributes: {
      position: { array: number[] }
      normal?: { array: number[] }
    }
    index: { array: number[] }
  }

  export type OcctNode = {
    name: string
    meshes: number[]
    children: OcctNode[]
  }

  export type OcctResult = {
    success: boolean
    root: OcctNode
    meshes: OcctMesh[]
  }

  export type OcctParams = {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
    linearDeflection?: number
    angularDeflection?: number
  }

  export type Occt = {
    ReadStepFile: (content: Uint8Array, params: OcctParams | null) => OcctResult
  }

  export default function occtimportjs(overrides?: {
    locateFile?: (path: string) => string
  }): Promise<Occt>
}
