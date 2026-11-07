/*! @license tag36h11 code table and bit layout from AprilRobotics apriltag v3.4.2 (tag36h11.c, BSD-2-Clause).
 * Copyright (C) 2013-2016, The Regents of The University of Michigan.
 * All rights reserved.
 * This software was developed in the APRIL Robotics Lab under the
 * direction of Edwin Olson, ebolson@umich.edu. This software may be
 * available under alternative licensing terms; contact the address above.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * The views and conclusions contained in the software and documentation are those
 * of the authors and should not be interpreted as representing official policies,
 * either expressed or implied, of the Regents of The University of Michigan.
 */

// AprilTag 36h11 패밀리의 표시용 코드 표와 그림(spec-4ab §1.6, synthesis §9.7). 씬 뷰가 필드 태그를 그릴 때 쓴다(검출은 4d).
// 원천: AprilRobotics/apriltag v3.4.2 `tag36h11.c`(sha256 38ff6e308067eb32ccf624e9cc5e7a75b45ad82b3cf9f80980cb86ebaa88512b).
// FTC SDK(OpenFTC apriltag-2.1.0 `libapriltag.so`)의 587개 코드 표와 바이트까지 같다. 위 저작권 문구는 BSD-2-Clause 2항
// (바이너리 배포에도 고지)을 지키려고 minify 뒤에도 남는 법적 주석(`/*!`·`@license`)으로 둔다.
// 표는 시즌이 쓰는 id만 둔다(BIOBUZZ 30–45).

// 36비트 코드(2^53 안이라 number로 정확하다). tag36h11.c codedata[id]
const CODES: Readonly<Record<number, number>> = {
  30: 0xe2cfda160,
  31: 0x2ff497c63,
  32: 0x47240671b,
  33: 0x5047a2e55,
  34: 0x635ca87c7,
  35: 0x691254166,
  36: 0x68f43d94a,
  37: 0x6ef24bdb6,
  38: 0x8cdd8f886,
  39: 0x9de96b718,
  40: 0xaff6e5a8a,
  41: 0xbae46f029,
  42: 0xd225b6d59,
  43: 0xdf8ba8c01,
  44: 0xe3744a22f,
  45: 0xfbb59375d
}

// 비트 i(0…35)의 칸(바깥 흰 고리를 뺀 8 × 8 격자 기준). tag36h11.c 630–701행 bit_x·bit_y 그대로
const BIT_X: readonly number[] = [
  1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4, 1, 1, 1, 1, 1, 2,
  2, 2, 3
]
const BIT_Y: readonly number[] = [
  1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5,
  4, 3, 4
]

const NBITS = 36
// 흰 고리를 포함한 전체 칸 수(tag36h11.c total_width)
export const TAG36H11_TOTAL_WIDTH = 10

export function tag36h11Code(id: number): number | null {
  return Object.prototype.hasOwnProperty.call(CODES, id) ? CODES[id] : null
}

// 10 × 10 그림, 위 행부터, true = 흰색(apriltag.c apriltag_to_image 1472–1497행). 바깥 한 칸 고리는 흰색, 안 한 칸 고리는
// 검정이다. 비트 i가 1이면 칸 (행 bit_y[i] + 1, 열 bit_x[i] + 1)이 흰색이다. 행은 태그 틀 +y(아래), 열은 +x(오른쪽)이고,
// 칸 (r, c)의 중심은 태그 틀 x = (c − 4.5)·s/8, y = (r − 4.5)·s/8이다(quad_decode의 tagx01 = (bit_x + 0.5)/8과 같다).
export function tag36h11Image(id: number): boolean[][] | null {
  const code = tag36h11Code(id)
  if (code === null) return null
  const n = TAG36H11_TOTAL_WIDTH
  const image = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => r === 0 || c === 0 || r === n - 1 || c === n - 1)
  )
  for (let i = 0; i < NBITS; i++)
    if (Math.floor(code / 2 ** (NBITS - 1 - i)) % 2 === 1) image[BIT_Y[i] + 1][BIT_X[i] + 1] = true
  return image
}
