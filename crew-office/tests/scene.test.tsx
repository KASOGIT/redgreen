import { expect, test } from 'claude-code/testing'

import { composeDesk, dim, encodeCells, layout } from '../hooks/scene'
import { PALETTE, SPRITES, STAMPS } from '../hooks/sprites'
import { DESKS, expectedCells, firstDifference } from './kit'

const SLOTS = DESKS.map(([slot]) => slot)
const DEFAULT = 0x01000000

test('layout gives the scale and the desks per row from the pane width and rows', () => {
  // [bodyColumns, bodyRows, scale, columns], from the spec table. Scale 2 needs
  // 1 + ceil(9 / perRow2) * 20 rows (S3), the per-row cap being ten: rows changed from S2 are [100, 54],
  // [66, 90], [32, 162] and [304, 18], now scale 1.
  const table: Array<[number, number, number, number]> = [
    [18, 20, 1, 1],
    [34, 20, 1, 2],
    [54, 20, 1, 3],
    [70, 20, 1, 4],
    [88, 20, 1, 5],
    [160, 12, 1, 9],
    [178, 12, 1, 10],
    [500, 12, 1, 10],
    [100, 54, 1, 5],
    [100, 61, 2, 3],
    [100, 60, 1, 5],
    [100, 53, 1, 5],
    [99, 54, 1, 5],
    [54, 60, 1, 3],
    [66, 90, 1, 3],
    [66, 101, 2, 2],
    [66, 100, 1, 3],
    [32, 162, 1, 1],
    [32, 181, 2, 1],
    [32, 180, 1, 1],
    [304, 18, 1, 10],
    [304, 21, 2, 9],
    [304, 20, 1, 10],
    [338, 21, 2, 10],
    [338, 20, 1, 10],
    [66, 89, 1, 3],
    [66, 72, 1, 3],
    [33, 20, 1, 1],
    [51, 20, 1, 2],
    [69, 20, 1, 3],
    [87, 20, 1, 4],
    [159, 12, 1, 8],
  ]

  for (const [bodyColumns, bodyRows, scale, columns] of table) {
    expect({ at: [bodyColumns, bodyRows], ...layout(bodyColumns, bodyRows) }).toEqual({
      at: [bodyColumns, bodyRows],
      columns,
      scale,
    })
  }
})

test('dim lifts each channel halfway to mid grey', () => {
  expect(dim(0xff0000)).toBe(0xbf4040)
  expect(dim(0x000000)).toBe(0x404040)
  expect(dim(0xffffff)).toBe(0xbfbfbf)
  expect(dim(0x123456)).toBe(0x495a6b)
})

test('encodeCells packs little-endian u32 words as padded base64', () => {
  expect(encodeCells([0x2588, 0xff8800, 0x01000000])).toBe('iCUAAACI/wAAAAAB')
  expect(encodeCells([0x20])).toBe('IAAAAA==')
  expect(encodeCells([])).toBe('')
})

test('the palette has at most 32 one-character colours, none of them a dot', () => {
  const keys = Object.keys(PALETTE)

  expect(keys.length).toBeGreaterThan(0)
  expect(keys.length).toBeLessThanOrEqual(32)
  for (const key of keys) {
    expect(key).toHaveLength(1)
    expect(key).not.toBe('.')
    expect(Number.isInteger(PALETTE[key])).toBe(true)
    expect(PALETTE[key]).toBeGreaterThanOrEqual(0)
    expect(PALETTE[key]).toBeLessThanOrEqual(0xffffff)
  }
})

const frameOf = (slot: string, name: 'idle' | 'work0' | 'work1' | 'work2' | 'work3'): string[] => {
  expect(Object.keys(SPRITES)).toEqual(expect.arrayContaining(SLOTS))

  return SPRITES[slot]![name]
}

const opaque = (frame: string[]) =>
  frame.join('').split('').filter(one => one !== '.').length

test('every desk has five 16 by 16 frames (idle and four working) of palette colours and dots', () => {
  expect(Object.keys(SPRITES).sort()).toEqual([...SLOTS].sort())

  for (const slot of SLOTS) {
    expect(SPRITES[slot]).toBeDefined()
    for (const name of ['idle', 'work0', 'work1', 'work2', 'work3'] as const) {
      const frame = frameOf(slot, name)
      expect(frame).toHaveLength(16)
      for (const line of frame) {
        expect(line).toHaveLength(16)
        for (const one of line) {
          expect(one === '.' || one in PALETTE).toBe(true)
        }
      }
      expect(opaque(frame)).toBeGreaterThanOrEqual(60)
    }
  }
})

test('the four working frames of each desk differ pairwise and from the idle frame', () => {
  const names = ['idle', 'work0', 'work1', 'work2', 'work3'] as const
  for (const slot of SLOTS) {
    for (let a = 0; a < names.length; a += 1) {
      for (let b = a + 1; b < names.length; b += 1) {
        expect({ slot, pair: [names[a], names[b]], same: frameOf(slot, names[a]!).join('/') === frameOf(slot, names[b]!).join('/') })
          .toEqual({ slot, pair: [names[a], names[b]], same: false })
      }
    }
  }
})

test('no two desks share the same idle frame', () => {
  const seen = SLOTS.map(slot => frameOf(slot, 'idle').join('/'))

  expect(new Set(seen).size).toBe(SLOTS.length)
})

test('the stamps are 5 by 5, in the palette alphabet, and differ', () => {
  for (const stamp of [STAMPS.done, STAMPS.failed]) {
    expect(stamp).toHaveLength(5)
    for (const line of stamp) {
      expect(line).toHaveLength(5)
      for (const one of line) {
        expect(one === '.' || one in PALETTE).toBe(true)
      }
    }
    expect(opaque(stamp)).toBeGreaterThan(0)
  }
  expect(STAMPS.done).not.toEqual(STAMPS.failed)
})

const LOOKS = ['idle', 'working', 'done', 'failed'] as const

test('composeDesk packs 16 by 8 cells of three numbers, as the cell rule says', () => {
  for (const slot of SLOTS) {
    expect(SPRITES[slot]).toBeDefined()
    for (const look of LOOKS) {
      for (const frame of [0, 1, 2, 3] as const) {
        const cells = composeDesk(slot, look, frame)
        expect(cells).toHaveLength(384)
        expect(cells).toEqual(expectedCells(slot, look, frame))
      }
    }
  }
})

test('a working desk animates through four frames and an idle one stands still, the consulting advisor included', () => {
  for (const slot of SLOTS) {
    for (const [a, b] of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const) {
      expect(composeDesk(slot, 'working', a)).not.toEqual(
        composeDesk(slot, 'working', b),
      )
    }
    expect(composeDesk(slot, 'idle', 0)).toEqual(composeDesk(slot, 'idle', 1))
    expect(composeDesk(slot, 'done', 0)).toEqual(composeDesk(slot, 'done', 1))
    expect(composeDesk(slot, 'idle', 0)).not.toEqual(
      composeDesk(slot, 'done', 0),
    )
    expect(composeDesk(slot, 'done', 0)).not.toEqual(
      composeDesk(slot, 'failed', 0),
    )
  }
})

test('the reviewer holds the red pen in the hand on the paper: no pen red in columns 0..2 of work frames 1 and 3', () => {
  const art = SPRITES['code-reviewer']!

  for (const frame of ['work1', 'work3'] as const) {
    for (const [y, line] of art[frame].entries()) {
      expect({ frame, y, left: line.slice(0, 3).includes('r') }).toEqual({
        frame,
        y,
        left: false,
      })
    }
    expect(art[frame].join('')).toContain('r')
  }

  const frames = (['work0', 'work1', 'work2', 'work3'] as const).map(name =>
    art[name].join('/'),
  )
  expect(new Set(frames).size).toBe(4)
})

test('the scenes use at most 1024 distinct colour pairs', () => {
  const pairs = new Set<string>()

  for (const slot of SLOTS) {
    expect(SPRITES[slot]).toBeDefined()
    for (const look of LOOKS) {
      for (const frame of [0, 1, 2, 3] as const) {
        const cells = composeDesk(slot, look, frame)
        expect(cells).toHaveLength(384)
        for (let i = 0; i < cells.length; i += 3) {
          pairs.add(`${cells[i + 1]}/${cells[i + 2]}`)
        }
      }
    }
  }

  expect(pairs.size).toBeGreaterThan(1)
  expect(pairs.size).toBeLessThanOrEqual(1024)
})

// Scale 2: each sprite pixel is two cells wide, and a cell shows one pixel
// twice (both halves), so a desk is 32 by 16 cells.
test('composeDesk at scale 2 packs 32 by 16 cells, each sprite pixel twice as wide', () => {
  for (const slot of SLOTS) {
    expect(SPRITES[slot]).toBeDefined()
    for (const look of LOOKS) {
      for (const frame of [0, 1, 2, 3] as const) {
        const cells = composeDesk(slot, look, frame, 2)
        expect(cells).toHaveLength(1536)
        expect(firstDifference(cells, expectedCells(slot, look, frame, 2))).toBe(-1)
      }
    }
  }
})

test('composeDesk at scale 2 draws a transparent pixel and a coloured one as the spec says', () => {
  // Pixels found from the sprite data: working, frame 0 has no dimming and no stamp.
  const art = SPRITES.manager!.work0
  const find = (wantColoured: boolean) => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if ((art[y]![x] !== '.') === wantColoured) return { x, y, key: art[y]![x]! }
      }
    }
    throw new Error('sprite has no such pixel')
  }
  const cells = composeDesk('manager', 'working', 0, 2)
  const at = (x: number, y: number) =>
    cells.slice((y * 32 + x) * 3, (y * 32 + x) * 3 + 3)

  const clear = find(false)
  expect(at(2 * clear.x, clear.y)).toEqual([0x20, DEFAULT, DEFAULT])
  expect(at(2 * clear.x + 1, clear.y)).toEqual([0x20, DEFAULT, DEFAULT])

  const solid = find(true)
  const colour = PALETTE[solid.key]!
  expect(at(2 * solid.x, solid.y)).toEqual([0x2580, colour, colour])
  expect(at(2 * solid.x + 1, solid.y)).toEqual([0x2580, colour, colour])
})

test('composeDesk at scale 1, or with no scale, stays 384 words as before', () => {
  for (const slot of SLOTS) {
    expect(SPRITES[slot]).toBeDefined()
    for (const look of LOOKS) {
      const reference = expectedCells(slot, look, 0)
      expect(composeDesk(slot, look, 0)).toEqual(reference)
      expect(composeDesk(slot, look, 0, 1)).toEqual(reference)
      expect(composeDesk(slot, look, 0, 1)).toHaveLength(384)
    }
  }
})
