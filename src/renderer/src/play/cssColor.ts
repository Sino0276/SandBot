// CSS 색 글자 → RGBA(FTC Dashboard 캔버스의 setFill·setStroke, 라이브러리 L2). 브라우저 캔버스가 받는 모양 가운데
// 이름(CSS Color 4의 148개와 transparent), #rgb·#rgba·#rrggbb·#rrggbbaa, rgb()·rgba()(쉼표·공백 문법, 백분율),
// hsl()·hsla()를 받는다. 받지 못하면 null이다(캔버스처럼 이전 색을 그대로 둔다).

// r·g·b는 sRGB 0–255, a는 0–1
export type Rgba = { r: number; g: number; b: number; a: number }

// CSS 이름 색(소문자 이름 → #rrggbb)
const NAMED: Readonly<Record<string, string>> = {
  aliceblue: 'f0f8ff',
  antiquewhite: 'faebd7',
  aqua: '00ffff',
  aquamarine: '7fffd4',
  azure: 'f0ffff',
  beige: 'f5f5dc',
  bisque: 'ffe4c4',
  black: '000000',
  blanchedalmond: 'ffebcd',
  blue: '0000ff',
  blueviolet: '8a2be2',
  brown: 'a52a2a',
  burlywood: 'deb887',
  cadetblue: '5f9ea0',
  chartreuse: '7fff00',
  chocolate: 'd2691e',
  coral: 'ff7f50',
  cornflowerblue: '6495ed',
  cornsilk: 'fff8dc',
  crimson: 'dc143c',
  cyan: '00ffff',
  darkblue: '00008b',
  darkcyan: '008b8b',
  darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9',
  darkgreen: '006400',
  darkgrey: 'a9a9a9',
  darkkhaki: 'bdb76b',
  darkmagenta: '8b008b',
  darkolivegreen: '556b2f',
  darkorange: 'ff8c00',
  darkorchid: '9932cc',
  darkred: '8b0000',
  darksalmon: 'e9967a',
  darkseagreen: '8fbc8f',
  darkslateblue: '483d8b',
  darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f',
  darkturquoise: '00ced1',
  darkviolet: '9400d3',
  deeppink: 'ff1493',
  deepskyblue: '00bfff',
  dimgray: '696969',
  dimgrey: '696969',
  dodgerblue: '1e90ff',
  firebrick: 'b22222',
  floralwhite: 'fffaf0',
  forestgreen: '228b22',
  fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff',
  gold: 'ffd700',
  goldenrod: 'daa520',
  gray: '808080',
  green: '008000',
  greenyellow: 'adff2f',
  grey: '808080',
  honeydew: 'f0fff0',
  hotpink: 'ff69b4',
  indianred: 'cd5c5c',
  indigo: '4b0082',
  ivory: 'fffff0',
  khaki: 'f0e68c',
  lavender: 'e6e6fa',
  lavenderblush: 'fff0f5',
  lawngreen: '7cfc00',
  lemonchiffon: 'fffacd',
  lightblue: 'add8e6',
  lightcoral: 'f08080',
  lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3',
  lightgreen: '90ee90',
  lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa',
  lightskyblue: '87cefa',
  lightslategray: '778899',
  lightslategrey: '778899',
  lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0',
  lime: '00ff00',
  limegreen: '32cd32',
  linen: 'faf0e6',
  magenta: 'ff00ff',
  maroon: '800000',
  mediumaquamarine: '66cdaa',
  mediumblue: '0000cd',
  mediumorchid: 'ba55d3',
  mediumpurple: '9370db',
  mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585',
  midnightblue: '191970',
  mintcream: 'f5fffa',
  mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5',
  navajowhite: 'ffdead',
  navy: '000080',
  oldlace: 'fdf5e6',
  olive: '808000',
  olivedrab: '6b8e23',
  orange: 'ffa500',
  orangered: 'ff4500',
  orchid: 'da70d6',
  palegoldenrod: 'eee8aa',
  palegreen: '98fb98',
  paleturquoise: 'afeeee',
  palevioletred: 'db7093',
  papayawhip: 'ffefd5',
  peachpuff: 'ffdab9',
  peru: 'cd853f',
  pink: 'ffc0cb',
  plum: 'dda0dd',
  powderblue: 'b0e0e6',
  purple: '800080',
  rebeccapurple: '663399',
  red: 'ff0000',
  rosybrown: 'bc8f8f',
  royalblue: '4169e1',
  saddlebrown: '8b4513',
  salmon: 'fa8072',
  sandybrown: 'f4a460',
  seagreen: '2e8b57',
  seashell: 'fff5ee',
  sienna: 'a0522d',
  silver: 'c0c0c0',
  skyblue: '87ceeb',
  slateblue: '6a5acd',
  slategray: '708090',
  slategrey: '708090',
  snow: 'fffafa',
  springgreen: '00ff7f',
  steelblue: '4682b4',
  tan: 'd2b48c',
  teal: '008080',
  thistle: 'd8bfd8',
  tomato: 'ff6347',
  turquoise: '40e0d0',
  violet: 'ee82ee',
  wheat: 'f5deb3',
  white: 'ffffff',
  whitesmoke: 'f5f5f5',
  yellow: 'ffff00',
  yellowgreen: '9acd32'
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

function fromHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null
  const digit = (i: number): number => parseInt(hex[i], 16) * 17
  const pair = (i: number): number => parseInt(hex.slice(i, i + 2), 16)
  switch (hex.length) {
    case 3:
      return { r: digit(0), g: digit(1), b: digit(2), a: 1 }
    case 4:
      return { r: digit(0), g: digit(1), b: digit(2), a: digit(3) / 255 }
    case 6:
      return { r: pair(0), g: pair(2), b: pair(4), a: 1 }
    case 8:
      return { r: pair(0), g: pair(2), b: pair(4), a: pair(6) / 255 }
    default:
      return null
  }
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/

// 함수 인자: 쉼표로 나눈 옛 문법(rgb(1, 2, 3), rgba(1, 2, 3, 0.5))이나 공백과 '/'의 새 문법(rgb(1 2 3 / 50%))
function functionArgs(body: string): string[] | null {
  const trimmed = body.trim()
  if (trimmed.includes(',')) {
    if (trimmed.includes('/')) return null
    const parts = trimmed.split(',').map((part) => part.trim())
    return parts.every((part) => part !== '') ? parts : null
  }
  const [main, alpha, extra] = trimmed.split('/')
  if (extra !== undefined) return null
  const parts = main.trim().split(/\s+/)
  if (alpha !== undefined) {
    if (alpha.trim() === '') return null
    parts.push(alpha.trim())
  }
  return parts
}

function parseAlpha(text: string): number | null {
  if (text.endsWith('%')) {
    const value = text.slice(0, -1)
    return NUMBER.test(value) ? clamp(Number(value) / 100, 0, 1) : null
  }
  return NUMBER.test(text) ? clamp(Number(text), 0, 1) : null
}

// 0–255 성분(수 또는 백분율)
function parseChannel(text: string): number | null {
  if (text.endsWith('%')) {
    const value = text.slice(0, -1)
    return NUMBER.test(value) ? clamp((Number(value) / 100) * 255, 0, 255) : null
  }
  return NUMBER.test(text) ? clamp(Number(text), 0, 255) : null
}

function parseRgb(args: string[]): Rgba | null {
  if (args.length !== 3 && args.length !== 4) return null
  const [r, g, b] = args.slice(0, 3).map(parseChannel)
  const a = args.length === 4 ? parseAlpha(args[3]) : 1
  if (r === null || g === null || b === null || a === null) return null
  return { r, g, b, a }
}

// 각도(deg 기본, rad·grad·turn)
function parseHue(text: string): number | null {
  const match = /^(.*?)(deg|rad|grad|turn)?$/.exec(text)
  if (!match || !NUMBER.test(match[1])) return null
  const value = Number(match[1])
  switch (match[2]) {
    case 'rad':
      return (value * 180) / Math.PI
    case 'grad':
      return value * 0.9
    case 'turn':
      return value * 360
    default:
      return value
  }
}

// 백분율(CSS Color 4는 % 없는 수도 받는다)
function parsePercent(text: string): number | null {
  const value = text.endsWith('%') ? text.slice(0, -1) : text
  return NUMBER.test(value) ? clamp(Number(value) / 100, 0, 1) : null
}

function parseHsl(args: string[]): Rgba | null {
  if (args.length !== 3 && args.length !== 4) return null
  const hue = parseHue(args[0])
  const s = parsePercent(args[1])
  const l = parsePercent(args[2])
  const a = args.length === 4 ? parseAlpha(args[3]) : 1
  if (hue === null || s === null || l === null || a === null) return null
  const h = (((hue % 360) + 360) % 360) / 360
  // CSS Color 4의 hslToRgb
  const channel = (n: number): number => {
    const k = (n + h * 12) % 12
    const amount = s * Math.min(l, 1 - l)
    return (l - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
  }
  return { r: channel(0), g: channel(8), b: channel(4), a }
}

export function parseCssColor(text: string): Rgba | null {
  if (typeof text !== 'string' || text.length > 256) return null
  const value = text.trim().toLowerCase()
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (value.startsWith('#')) return fromHex(value.slice(1))
  const named = NAMED[value]
  if (named !== undefined && Object.prototype.hasOwnProperty.call(NAMED, value))
    return fromHex(named)
  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(value)
  if (!call) return null
  const args = functionArgs(call[2])
  if (!args) return null
  return call[1].startsWith('rgb') ? parseRgb(args) : parseHsl(args)
}
