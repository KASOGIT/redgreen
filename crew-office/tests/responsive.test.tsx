import { expect, test } from 'claude-code/testing'

import { DESKS, expectedCells, firstDifference, mountPane, spawn, world } from './kit'

const KEYS = DESKS.map(([slot]) => `desk-${slot}`)

// `keys`: the desks drawn, in order, when it is not the first of the nine.
type Shape = { rows: number[]; scale: 1 | 2; keys?: string[] }

// The nine desks with the idle advisor in the guest's seat, or all ten.
const SEAT = [...KEYS.slice(0, 8), 'desk-advisor']
const TEN = KEYS

// The pane as drawn: the desks of each row, read from the render tree, with
// the gap of each row, the width of each desk box and its raster's size.
const drawn = async (ui: any) => {
  const boxes = await ui.findAll({ type: 'Box' })
  const lines = boxes.filter(
    (one: any) =>
      one.props.flexDirection === 'row' &&
      one.children.some((desk: any) =>
        desk.children.some((child: any) => child.type === 'Raster'),
      ),
  )

  return lines.map((line: any) => ({
    gap: line.props.columnGap,
    widths: line.children.map((desk: any) => desk.props.width),
    rasters: line.children.map((desk: any) =>
      desk.children.find((child: any) => child.type === 'Raster'),
    ),
  }))
}

// All nine desks are drawn in tall mode; a short pane (idle office) draws only
// the first desks in slot order, as many as its rows hold.
const expectDrawn = (lines: any[], { rows, scale, keys }: Shape) => {
  expect(lines.map(line => line.rasters.length)).toEqual(rows)
  expect(lines.flatMap(line => line.rasters.map((one: any) => one.props.key))).toEqual(
    keys ?? KEYS.slice(0, rows.reduce((sum, one) => sum + one, 0)),
  )
  for (const line of lines) {
    expect(line.gap).toBe(2)
    for (const width of line.widths) expect(width).toBe(16 * scale)
    for (const raster of line.rasters) {
      expect(raster.props.columns).toBe(16 * scale)
      expect(raster.props.rows).toBe(8 * scale)
    }
  }
}

// Spec S3: tall mode (1 + ceil(9 / perRow) * 12 <= rows) draws the nine desks,
// short mode (12 rows or more) draws idle rows of 10 while they fit in rows - 2,
// scale 2 needs 1 + ceil(9 / perRow2) * 20 <= rows. Changed from the S2 table:
// the 20 row panes are short now (one row of desks), and scale 2 needs 61, 101,
// 181 and 21 rows where it needed 54, 90, 162 and 18.
const TABLE: Array<[bodyColumns: number, bodyRows: number, Shape]> = [
  [18, 20, { scale: 1, rows: [1] }],
  [54, 20, { scale: 1, rows: [3] }],
  [70, 20, { scale: 1, rows: [4] }],
  [88, 20, { scale: 1, rows: [5] }],
  [160, 12, { scale: 1, rows: [9], keys: SEAT }],
  [178, 12, { scale: 1, rows: [10], keys: TEN }],
  [100, 54, { scale: 1, rows: [5, 5], keys: TEN }],
  [100, 53, { scale: 1, rows: [5, 5], keys: TEN }],
  [100, 61, { scale: 2, rows: [3, 3, 3], keys: SEAT }],
  [100, 60, { scale: 1, rows: [5, 5], keys: TEN }],
  [66, 89, { scale: 1, rows: [3, 3, 3, 1], keys: TEN }],
  [66, 90, { scale: 1, rows: [3, 3, 3, 1], keys: TEN }],
  [66, 101, { scale: 2, rows: [2, 2, 2, 2, 2], keys: TEN }],
  [66, 100, { scale: 1, rows: [3, 3, 3, 1], keys: TEN }],
  [32, 162, { scale: 1, rows: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], keys: TEN }],
  [32, 181, { scale: 2, rows: [1, 1, 1, 1, 1, 1, 1, 1, 1], keys: SEAT }],
  [32, 180, { scale: 1, rows: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], keys: TEN }],
  [304, 18, { scale: 1, rows: [10], keys: TEN }],
  [304, 21, { scale: 2, rows: [9], keys: SEAT }],
  [304, 20, { scale: 1, rows: [10], keys: TEN }],
  [338, 21, { scale: 2, rows: [10], keys: TEN }],
  [338, 20, { scale: 1, rows: [10], keys: TEN }],
]

for (const [bodyColumns, bodyRows, shape] of TABLE) {
  test(`${bodyColumns} columns by ${bodyRows} rows draw the desks in rows of ${shape.rows.join(',')} at scale ${shape.scale}${shape.keys === SEAT ? ', the advisor in the idle guest seat' : shape.keys === TEN ? ', the advisor in the free cell or on its own line' : ''}`, async ($, on) => {
    world(on)

    const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
    const lines = await drawn(ui)
    await ui.unmount()

    expectDrawn(lines, shape)
  })
}

test('a scale 2 desk raster carries the 32 by 16 cells of its look', async ($, on) => {
  world(on)
  await spawn($, 'crew:test-runner')

  const ui = await mountPane($, 'terminal', 100, 'dock', 61)
  const found = await ui.findAll({ type: 'Raster' })
  await ui.unmount()
  const cells = Object.fromEntries(
    found.map((one: any) => [one.key, one.props.cells]),
  )
  const words = (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), one => one.charCodeAt(0))
    const view = new DataView(bytes.buffer)

    return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true))
  }

  expect(words(cells['desk-manager'])).toHaveLength(1536)
  expect(
    firstDifference(words(cells['desk-manager']), expectedCells('manager', 'idle', 0, 2)),
  ).toBe(-1)
  expect(words(cells['desk-test-runner'])).toHaveLength(1536)
  expect(
    firstDifference(
      words(cells['desk-test-runner']),
      expectedCells('test-runner', 'working', 1, 2),
    ),
  ).toBe(-1)
})

// Animation: the blit follows the scale of the last render.

const blitWords = (cells: string): number[] => {
  const bytes = Uint8Array.from(atob(cells), one => one.charCodeAt(0))
  const view = new DataView(bytes.buffer)

  return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true))
}

test('after a scale 2 render, a working desk blits cells of 1536 words', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 100, 'dock', 61)

  await clock.advance(500)
  await ui.unmount()

  expect(blits).toHaveLength(1)
  expect(blits[0].key).toBe('desk-test-runner')
  const words = blitWords(blits[0].cells)
  expect(words).toHaveLength(1536)
  expect(firstDifference(words, expectedCells('test-runner', 'working', 2, 2))).toBe(-1)
})

test('after a scale 1 render, a working desk blits cells of 384 words', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 100, 'dock', 53)

  await clock.advance(500)
  await ui.unmount()

  expect(blits).toHaveLength(1)
  const words = blitWords(blits[0].cells)
  expect(words).toHaveLength(384)
  expect(firstDifference(words, expectedCells('test-runner', 'working', 2, 1))).toBe(-1)
})

// Resize: one mount, redrawn with the component's next props.

const props = (bodyColumns: number, bodyRows: number) => ({
  title: 'Crew office',
  isFocused: false,
  bodyColumns,
  placement: 'dock',
  scroll: { offset: 0, bodyRows },
  view: {},
})

test('one mount follows the pane size: 54 by 20, then 100 by 61, then 54 by 20 again', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54, 'dock', 20)
  expectDrawn(await drawn(ui), { scale: 1, rows: [3] })

  await ui.redraw(props(100, 61))
  expectDrawn(await drawn(ui), { scale: 2, rows: [3, 3, 3], keys: SEAT })

  await ui.redraw(props(54, 20))
  expectDrawn(await drawn(ui), { scale: 1, rows: [3] })
  await ui.unmount()
})

test('a redraw to a wider, shorter pane puts the nine desks in one row, the advisor in the idle guest seat', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54, 'dock', 20)
  await ui.redraw(props(160, 12))
  const lines = await drawn(ui)
  await ui.unmount()

  expectDrawn(lines, { scale: 1, rows: [9], keys: SEAT })
})

test('the blit follows a resize on one mount', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54, 'dock', 20)

  await ui.redraw(props(100, 61))
  await clock.advance(500)
  expect(blitWords(blits.at(-1).cells)).toHaveLength(1536)

  await ui.redraw(props(54, 20))
  await clock.advance(500)
  await ui.unmount()

  expect(blitWords(blits.at(-1).cells)).toHaveLength(384)
})
