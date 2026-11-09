// 센서 잡음 난수(spec-4c §1.6, 순수·결정적). Math.random·벽시계·Map 순서를 쓰지 않고 (시드, 장치 이름, 흐름 번호, 순번)의
// 해시로만 만든다. 같은 입력이면 어느 프로세스에서도 같은 값이다(정수 연산과 Math.log·sqrt·cos만).
//
// 해시: 32비트 FNV-1a(오프셋 2166136261, 소수 16777619 — FNV 공개 정의)에 시드(32비트 둘), 장치 이름 길이와 UTF-16 코드
// 단위(16비트씩), 흐름 번호, 순번(32비트 둘)을 바이트로 차례로 넣고, murmur3 fmix32(상수 0x85ebca6b·0xc2b2ae35, MurmurHash3
// 공개 정의)로 마무리한다. 이름 길이를 먼저 넣어 이름과 뒤 숫자의 경계가 섞이지 않게 한다.

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const TWO_32 = 2 ** 32

function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0
}

function fnvWord32(hash: number, word: number): number {
  let h = hash
  for (let shift = 0; shift < 32; shift += 8) h = fnvByte(h, word >>> shift)
  return h
}

function fnvWord16(hash: number, word: number): number {
  return fnvByte(fnvByte(hash, word), word >>> 8)
}

// 정수 n(|n| < 2⁵³)의 32비트 둘(2의 보수): 아래 lo = n >>> 0, 위 hi = floor(n / 2³²) >>> 0. 음수 시드 −42도 정의된다
function fnvInteger(hash: number, n: number): number {
  return fnvWord32(fnvWord32(hash, n >>> 0), Math.floor(n / TWO_32) >>> 0)
}

function fmix32(value: number): number {
  let h = value >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

// 32비트 해시 → (0, 1) 균등 값 (h + 0.5)/2³². 0이 나오지 않아 Box–Muller의 log(0) = −∞가 생기지 않는다(명세 비평 X3)
export function uniformFromHash(hash: number): number {
  return ((hash >>> 0) + 0.5) / TWO_32
}

// (시드, 장치, 흐름, 순번)의 32비트 해시(시험용으로 내보낸다)
export function noiseHash(seed: number, device: string, stream: number, index: number): number {
  let h = fnvInteger(FNV_OFFSET, seed)
  h = fnvWord32(h, device.length)
  for (let i = 0; i < device.length; i++) h = fnvWord16(h, device.charCodeAt(i))
  h = fnvInteger(h, stream)
  h = fnvInteger(h, index)
  return fmix32(h)
}

// 0 < u < 1
export function noiseUniform(seed: number, device: string, stream: number, index: number): number {
  return uniformFromHash(noiseHash(seed, device, stream, index))
}

// 표준 정규(Box–Muller): 같은 순번의 흐름 2k·2k + 1 균등 값 둘
export function noiseGaussian(seed: number, device: string, k: number, index: number): number {
  const u1 = noiseUniform(seed, device, 2 * k, index)
  const u2 = noiseUniform(seed, device, 2 * k + 1, index)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
