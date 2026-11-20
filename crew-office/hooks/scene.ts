import { ADVISED, PALETTE, SPRITES, STAMPS } from './sprites'

export type Look = 'idle' | 'working' | 'done' | 'failed' | 'waiting' | 'advised'

const DEFAULT = 0x01000000
const SIZE = 16

const DESK_COUNT = 9
const ROW_CAP = 10
const RASTER_ROWS = 8
const LABEL_ROWS = 2
const INFO_ROWS = 2

const perRow = (bodyColumns: number, scale: 1 | 2) =>
  Math.min(ROW_CAP, Math.floor((bodyColumns + 2) / (SIZE * scale + 2)))

export const layout = (
  bodyColumns: number,
  bodyRows: number,
): { columns: number; scale: 1 | 2 } => {
  const big = perRow(bodyColumns, 2)
  if (big >= 1 && 1 + Math.ceil(DESK_COUNT / big) * (RASTER_ROWS * 2 + 4) <= bodyRows) {
    return { columns: big, scale: 2 }
  }

  return { columns: Math.max(1, perRow(bodyColumns, 1)), scale: 1 }
}

export const tallPlan = (
  columns: number,
  scale: 1 | 2,
  bodyRows: number,
): { tasks: 1 | 2 } | undefined => {
  const lines = Math.ceil(DESK_COUNT / columns)
  const spare = bodyRows - 1 - lines * (RASTER_ROWS * scale + LABEL_ROWS + INFO_ROWS)
  if (spare < 0) return undefined

  return { tasks: spare >= lines ? 2 : 1 }
}

export const shortRows = (
  isActive: boolean[],
  columns: number,
  bodyRows: number,
): Array<{ count: number; isInfo: boolean }> => {
  const rows: Array<{ count: number; isInfo: boolean }> = []
  let left = bodyRows - 2

  for (let from = 0; from < isActive.length; from += columns) {
    const count = Math.min(columns, isActive.length - from)
    const hasActive = isActive.slice(from, from + columns).some(Boolean)
    const full = RASTER_ROWS + LABEL_ROWS + (hasActive ? INFO_ROWS : 0)
    const plain = RASTER_ROWS + LABEL_ROWS
    if (full <= left) {
      rows.push({ count, isInfo: hasActive })
      left -= full
    } else if (hasActive && rows.length === 0 && plain <= left) {
      rows.push({ count, isInfo: false })
      left -= plain
    } else {
      break
    }
  }

  return rows
}

export const dim = (colour: number): number => {
  const half = (shift: number) =>
    ((((colour >> shift) & 0xff) + 0x80) >> 1) << shift

  return half(16) | half(8) | half(0)
}

const pixel = (
  slot: string,
  look: Look,
  frame: 0 | 1 | 2 | 3,
  x: number,
  y: number,
): number | undefined => {
  const sprite = SPRITES[slot]!
  const art =
    look === 'advised'
      ? ADVISED[frame % 2]!
      : look === 'working'
        ? sprite[`work${frame}`]
        : sprite.idle
  if (look === 'done' || look === 'failed') {
    const mark = x >= 11 && y <= 4 ? STAMPS[look][y]?.[x - 11] : undefined
    if (mark !== undefined && mark !== '.') return PALETTE[mark]
  }
  const key = art[y]![x]!
  if (key === '.') return undefined

  return look === 'idle' ? dim(PALETTE[key]!) : PALETTE[key]
}

export const composeDesk = (
  slot: string,
  look: Look,
  frame: 0 | 1 | 2 | 3,
  scale: 1 | 2 = 1,
): number[] => {
  const words: number[] = []

  for (let row = 0; row < (SIZE * scale) / 2; row += 1) {
    for (let x = 0; x < SIZE * scale; x += 1) {
      const column = Math.floor(x / scale)
      const top = pixel(slot, look, frame, column, Math.floor((2 * row) / scale))
      const bottom = pixel(slot, look, frame, column, Math.floor((2 * row + 1) / scale))
      if (top === undefined && bottom === undefined) {
        words.push(0x20, DEFAULT, DEFAULT)
      } else if (bottom === undefined) {
        words.push(0x2580, top!, DEFAULT)
      } else if (top === undefined) {
        words.push(0x2584, bottom, DEFAULT)
      } else {
        words.push(0x2580, top, bottom)
      }
    }
  }

  return words
}

export const encodeCells = (words: number[]): string => {
  const view = new DataView(new ArrayBuffer(words.length * 4))
  words.forEach((word, index) => view.setUint32(index * 4, word, true))

  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
}
