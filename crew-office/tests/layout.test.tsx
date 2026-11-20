import { expect, test } from 'claude-code/testing'

import {
  DESKS,
  expectedRows,
  feedBoxes,
  gridOf,
  meterOf,
  mountPane,
  rosterOf,
  seedOffice,
  taskOf,
  useToolWith,
  world,
} from './kit'

// Spec, S3 layout (T1: no feed in any layout): tall mode, short mode, the info
// lines under a desk, the roster. Every expected value is the spec's literal or counted out by hand
// from its rules: a desk is 8 raster rows + label + status, plus a task and a
// meter line (12 rows) and a second task line when there is room (13); an
// all-idle row of the short mode has no info lines (10 rows).

const SLOTS = DESKS.map(([slot]) => slot)
const [MANAGER, RUNNER, RESEARCHER, DEBUGGER, ARCHITECT, ENGINEER, IMPLEMENTER, REVIEWER, GUEST, ADVISOR] =
  SLOTS as [string, string, string, string, string, string, string, string, string, string]
// The nine desks that have info lines in a tall pane where the advisor takes the guest's seat.
const EIGHT = SLOTS.slice(0, 8)

type Seat = { working?: string[]; waiting?: string[]; marked?: string[] }

// An office read from storage: desks working, waiting (the agent list says so)
// or marked done. The clock stands at 1000, so a mark until 9000 is live.
const seat = (on: any, { working = [], waiting = [], marked = [] }: Seat) => {
  const desks: Record<string, unknown> = {}
  const deskOf: Record<string, string> = {}
  const agents: Record<string, unknown> = {}
  for (const slot of [...working, ...waiting]) {
    desks[slot] = { agentIds: [`s-${slot}`] }
    deskOf[`s-${slot}`] = slot
    agents[`s-${slot}`] = waiting.includes(slot) ? { status: 'waiting' } : {}
  }
  for (const slot of marked) desks[slot] = { agentIds: [], mark: 'done', until: 9000 }
  seedOffice(on, { desks, deskOf, agents })
}

// `count` tool calls of the manager.
const fill = async ($: any, count: number) => {
  for (let i = 0; i < count; i += 1) {
    await useToolWith($, 'Edit', { file_path: `/a/f${i}.ts` })
  }
}

const laid = async ($: any, bodyColumns: number, bodyRows: number) => {
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
  const grid = await gridOf(ui)
  const roster = await rosterOf(ui)
  const feed = await feedBoxes(ui)
  const info = Object.fromEntries(
    await Promise.all(
      SLOTS.map(async slot => [
        slot,
        {
          task: await taskOf(ui, slot),
          meter: await meterOf(ui, slot),
        },
      ]),
    ),
  )
  await ui.unmount()

  return {
    grid,
    roster,
    feed,
    info,
    // header + grid lines + roster, as the spec counts rows (no feed rows).
    total:
      1 +
      grid.reduce((sum, line) => sum + line.height, 0) +
      (roster === undefined || roster === '' ? 0 : 1),
  }
}

const hasInfo = (found: Awaited<ReturnType<typeof laid>>, slot: string) =>
  found.info[slot]!.task !== undefined && found.info[slot]!.meter !== undefined

// The layout table

test('54 by 16, 2 active: one row of 12 with the 2 active desks and the first idle, a roster of 7 with the advisor first, 14 rows', async ($, on) => {
  world(on)
  seat(on, { working: [RUNNER, IMPLEMENTER] })

  const found = await laid($, 54, 16)

  expect(found.grid).toEqual([{ slots: [RUNNER, IMPLEMENTER, MANAGER], height: 12 }])
  expect(found.roster).toBe('advisor  researcher  debugger  architect  test-engine…')
  expect(found.total).toBe(14)
  expect(hasInfo(found, RUNNER)).toBe(true)
  expect(hasInfo(found, IMPLEMENTER)).toBe(true)
})

test('54 by 24, 2 active: a row of 12, an idle row of 10 without info lines, a roster of 4 with the advisor first, 24 rows', async ($, on) => {
  world(on)
  seat(on, { working: [RUNNER, IMPLEMENTER] })

  const found = await laid($, 54, 24)

  expect(found.grid).toEqual([
    { slots: [RUNNER, IMPLEMENTER, MANAGER], height: 12 },
    { slots: [RESEARCHER, DEBUGGER, ARCHITECT], height: 10 },
  ])
  expect(found.roster).toBe('advisor  test-engineer  reviewer  guest')
  expect(found.total).toBe(24)
  expect(hasInfo(found, RUNNER)).toBe(true)
  for (const slot of [RESEARCHER, DEBUGGER, ARCHITECT]) {
    expect(found.info[slot]).toEqual({ task: undefined, meter: undefined })
  }
})

test('54 by 24, none active: two idle rows of 10 without info lines, a roster of 4 with the advisor first, 22 rows', async ($, on) => {
  world(on)
  seat(on, {})

  const found = await laid($, 54, 24)

  expect(found.grid).toEqual([
    { slots: [MANAGER, RUNNER, RESEARCHER], height: 10 },
    { slots: [DEBUGGER, ARCHITECT, ENGINEER], height: 10 },
  ])
  expect(found.roster).toBe('advisor  implementer  reviewer  guest')
  expect(found.total).toBe(22)
  for (const slot of SLOTS) {
    expect(found.info[slot]).toEqual({ task: undefined, meter: undefined })
  }
})

test('54 by 40: tall, three rows of 13 with a second task line, the advisor in the idle guest seat, 40 rows, no feed and no roster', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 40)

  expect(found.grid).toEqual([
    { slots: SLOTS.slice(0, 3), height: 13 },
    { slots: SLOTS.slice(3, 6), height: 13 },
    { slots: [IMPLEMENTER, REVIEWER, ADVISOR], height: 13 },
  ])
  expect(found.feed).toBe(0)
  expect(found.roster === undefined || found.roster === '').toBe(true)
  expect(found.total).toBe(40)
  for (const slot of EIGHT) expect(hasInfo(found, slot)).toBe(true)
  expect(hasInfo(found, ADVISOR)).toBe(false)
  expect(hasInfo(found, GUEST)).toBe(false)
})

test('54 by 60: tall, three rows of 13 and the advisor alone on a fourth line of 10, no feed, 50 rows', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 60)

  expect(found.grid.map(line => line.height)).toEqual([13, 13, 13, 10])
  expect(found.grid[3]!.slots).toEqual([ADVISOR])
  expect(found.grid[2]!.slots).toEqual([IMPLEMENTER, REVIEWER, GUEST])
  expect(hasInfo(found, ADVISOR)).toBe(false)
  expect(found.feed).toBe(0)
  expect(found.total).toBe(50)
})

test('72 by 40: four desks per row, rows of 4, 4 and 2 with the advisor in the free cell, each 13 rows, 40 rows, no feed', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 72, 40)

  expect(found.grid).toEqual([
    { slots: SLOTS.slice(0, 4), height: 13 },
    { slots: SLOTS.slice(4, 8), height: 13 },
    { slots: SLOTS.slice(8), height: 13 },
  ])
  expect(found.feed).toBe(0)
  expect(found.total).toBe(40)
})

test('90 by 24: tall needs 25 rows, so the short mode draws two idle rows of 5 and 4 and the advisor in the free cell of the second, and no roster', async ($, on) => {
  world(on)
  seat(on, {})

  const found = await laid($, 90, 24)

  expect(found.grid).toEqual([
    { slots: SLOTS.slice(0, 5), height: 10 },
    { slots: SLOTS.slice(5), height: 10 },
  ])
  expect(found.roster === undefined || found.roster === '').toBe(true)
  for (const slot of SLOTS) {
    expect(found.info[slot]).toEqual({ task: undefined, meter: undefined })
  }
})

test('90 by 24 with a working desk: short, a row of 12 holding it and an idle row of 10 with the advisor in its free cell', async ($, on) => {
  world(on)
  seat(on, { working: [GUEST] })

  const found = await laid($, 90, 24)

  expect(found.grid).toEqual([
    { slots: [GUEST, MANAGER, RUNNER, RESEARCHER, DEBUGGER], height: 12 },
    { slots: [ARCHITECT, ENGINEER, IMPLEMENTER, REVIEWER, ADVISOR], height: 10 },
  ])
})

test('90 by 40: tall, two rows of 13 (27 rows) with the advisor in the free cell, no feed', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 90, 40)

  expect(found.grid).toEqual([
    { slots: SLOTS.slice(0, 5), height: 13 },
    { slots: SLOTS.slice(5), height: 13 },
  ])
  expect(found.feed).toBe(0)
  expect(found.total).toBe(27)
})

// The edges of the rules: tall at 1 + lines * 12 rows, the second task line at
// spare >= lines, no feed whatever the spare rows.

test('54 by 37 is the least tall mode: rows of 12 with one task line, no feed', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 37)

  expect(found.grid.map(line => line.slots.length)).toEqual([3, 3, 3])
  expect(found.grid.map(line => line.height)).toEqual([12, 12, 12])
  expect(found.info[RUNNER]!.task).toHaveLength(1)
  expect(found.info[RUNNER]!.meter).toBeDefined()
  expect(found.feed).toBe(0)
  expect(found.total).toBe(37)
})

test('54 by 36 is short: a working desk and eight idle fit in rows of 12, 10 and 10, the advisor in the idle guest seat and the guest in the roster', async ($, on) => {
  world(on)
  seat(on, { working: [MANAGER] })

  const found = await laid($, 54, 36)

  expect(found.grid.map(line => line.height)).toEqual([12, 10, 10])
  expect(found.grid.flatMap(line => line.slots)).toEqual([...EIGHT, ADVISOR])
  expect(found.roster).toBe('guest')
  expect(hasInfo(found, MANAGER)).toBe(true)
  expect(found.info[RUNNER]).toEqual({ task: undefined, meter: undefined })
})

test('54 by 39 has 2 spare rows, fewer than the 3 desk lines: still no second task line, and the guest roster takes one', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 39)

  expect(found.grid.map(line => line.height)).toEqual([12, 12, 12])
  expect(found.info[RUNNER]!.task).toHaveLength(1)
  expect(found.roster).toBe('guest')
  expect(found.total).toBe(38)
})

test('54 by 40 has 3 spare rows: the second task line, so two task lines per desk of the eight with info lines', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 40)

  for (const slot of EIGHT) expect(found.info[slot]!.task).toHaveLength(2)
  expect(found.info[ADVISOR]).toEqual({ task: undefined, meter: undefined })
})

test('54 by 42 has 2 rows left: the roster of the guest takes one, no feed', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 42)

  expect(found.grid.map(line => line.height)).toEqual([13, 13, 13])
  expect(found.roster).toBe('guest')
  expect(found.feed).toBe(0)
  expect(found.total).toBe(41)
})

test('54 by 43 has 3 rows left: still no feed, 41 rows drawn with the guest roster', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 43)

  expect(found.grid.map(line => line.height)).toEqual([13, 13, 13])
  expect(found.roster).toBe('guest')
  expect(found.feed).toBe(0)
  expect(found.total).toBe(41)
})

test('the short mode draws no feed, whatever the events', async ($, on) => {
  world(on)
  await fill($, 25)

  const found = await laid($, 54, 24)

  expect(found.grid.map(line => line.height)).toEqual([12, 10])
  expect(found.feed).toBe(0)
})

test('scale 2 at 100 by 61 is tall: three rows of 20, no spare row, the advisor in the guest seat', async ($, on) => {
  world(on)

  const found = await laid($, 100, 61)

  expect(found.grid.map(line => line.height)).toEqual([20, 20, 20])
  expect(found.total).toBe(61)
  for (const slot of EIGHT) expect(hasInfo(found, slot)).toBe(true)
  expect(hasInfo(found, ADVISOR)).toBe(false)
})

test('scale 2 with 3 spare rows gets the second task line: rows of 21', async ($, on) => {
  world(on)

  const found = await laid($, 100, 64)

  expect(found.grid.map(line => line.height)).toEqual([21, 21, 21])
  expect(found.info[RUNNER]!.task).toHaveLength(2)
})

// Below 12 rows or under 18 columns: today's text list.

for (const [bodyColumns, bodyRows] of [
  [54, 11],
  [160, 11],
  [54, 1],
] as const) {
  test(`${bodyColumns} by ${bodyRows} keeps the text list and draws no raster`, async ($, on) => {
    world(on)
    seat(on, { working: [RUNNER] })

    const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
    const texts = (await ui.findAll({ type: 'Text' })).map((one: any) => one.text)
    const rasters = await ui.findAll({ type: 'Raster' })
    await ui.unmount()

    expect(rasters).toHaveLength(0)
    expect(texts).toEqual(expectedRows({ 'test-runner': 'working' }))
  })
}

test('54 by 12 is the least short pane: one idle row of 3 desks and a roster of 7 with the advisor first', async ($, on) => {
  world(on)
  seat(on, {})

  const found = await laid($, 54, 12)

  expect(found.grid).toEqual([{ slots: [MANAGER, RUNNER, RESEARCHER], height: 10 }])
  expect(found.roster).toBe('advisor  debugger  architect  test-engineer  implemen…')
})

// Short mode: active first, roster of the folded desks without hotkeys (R10), cut.

test('the short mode draws working, then waiting, then marked desks, then idle in slot order', async ($, on) => {
  world(on)
  seat(on, { working: [GUEST], waiting: [ARCHITECT], marked: [RUNNER] })

  const found = await laid($, 54, 24)

  expect(found.grid.map(line => line.slots)).toEqual([
    [GUEST, ARCHITECT, RUNNER],
    [MANAGER, RESEARCHER, DEBUGGER],
  ])
  expect(found.roster).toBe('advisor  test-engineer  implementer  reviewer')
  expect(found.total).toBe(24)
})

test('working desks keep slot order among themselves, whatever order the office stores them', async ($, on) => {
  world(on)
  seat(on, { working: [REVIEWER, DEBUGGER, RESEARCHER] })

  const found = await laid($, 54, 16)

  expect(found.grid.map(line => line.slots)).toEqual([[RESEARCHER, DEBUGGER, REVIEWER]])
})

test('the roster is cut to the pane width with an ellipsis', async ($, on) => {
  world(on)
  seat(on, {})

  const found = await laid($, 18, 40)

  expect(found.grid.map(line => line.slots)).toEqual([[MANAGER], [RUNNER], [RESEARCHER]])
  expect(found.roster).toBe('advisor  debugger…')
})

// F2: the roster lists every undrawn desk, active ones first, marked with a star.

test('F2 54 by 16 with four working desks: manager, test-runner and researcher are drawn, the roster starts with "debugger*  " and the idle desks follow', async ($, on) => {
  world(on)
  seat(on, { working: [MANAGER, RUNNER, RESEARCHER, DEBUGGER] })

  const found = await laid($, 54, 16)

  expect(found.grid).toEqual([{ slots: [MANAGER, RUNNER, RESEARCHER], height: 12 }])
  expect(found.roster!.startsWith('debugger*  ')).toBe(true)
  expect(found.roster).toBe('debugger*  advisor  architect  test-engineer  impleme…')
  expect(found.total).toBe(14)
})

test('F2 undrawn working desks come before undrawn waiting desks, then the idle ones, all cut to the width', async ($, on) => {
  world(on)
  seat(on, { working: [MANAGER, RUNNER, RESEARCHER, DEBUGGER], waiting: [GUEST] })

  const found = await laid($, 54, 16)

  expect(found.grid).toEqual([{ slots: [MANAGER, RUNNER, RESEARCHER], height: 12 }])
  expect(found.roster!.slice(0, 52)).toBe('debugger*  guest*  advisor  architect  test-engineer')
  expect(found.roster!.endsWith('…')).toBe(true)
})

// The task line

const taskLine = async (note: Record<string, unknown>, on: any, $: any) => {
  seedOffice(on, {
    desks: { [RUNNER]: { agentIds: ['a1'] } },
    deskOf: { a1: RUNNER },
    agents: { a1: note },
  })
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const lines = await taskOf(ui, RUNNER)
  await ui.unmount()

  return lines?.[0]
}

test('the task line shows the first line of the label', async ($, on) => {
  world(on)

  expect(await taskLine({ label: 'line one\nline two', desc: 'the desc' }, on, $)).toBe('line one')
})

test('the task line falls back to the description when there is no label', async ($, on) => {
  world(on)

  expect(await taskLine({ desc: 'fix flaky test' }, on, $)).toBe('fix flaky test')
})

test('a task line longer than the 16 character desk is cut with an ellipsis', async ($, on) => {
  world(on)

  expect(await taskLine({ label: 'abcdefghijklmnopqrst' }, on, $)).toBe('abcdefghijklmno…')
})

test('a task line of exactly 16 characters is not cut', async ($, on) => {
  world(on)

  expect(await taskLine({ label: 'abcdefghijklmnop' }, on, $)).toBe('abcdefghijklmnop')
})

for (const [name, note, want] of [
  ['label', { label: 'x\u001b[31my' }, 'x [31my'],
  ['description', { desc: 'p\u001b[31mq' }, 'p [31mq'],
] as const) {
  test(`a task line has the control characters of an untrusted ${name} replaced by spaces`, async ($, on) => {
    world(on)

    expect(await taskLine(note, on, $)).toBe(want)
  })
}

test('a desk with no label and no description has a blank task line, and so has an idle desk', async ($, on) => {
  world(on)
  seat(on, { working: [RUNNER] })

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const working = await taskOf(ui, RUNNER)
  const idle = await taskOf(ui, MANAGER)
  await ui.unmount()

  expect(working?.join('').trim()).toBe('')
  expect(idle?.join('').trim()).toBe('')
})

// The meter line

const meter = async (note: Record<string, unknown>, on: any, $: any, slot = RUNNER) => {
  seedOffice(on, {
    desks: { [slot]: { agentIds: ['a1'] } },
    deskOf: { a1: slot },
    agents: { a1: note },
  })
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const line = await meterOf(ui, slot)
  await ui.unmount()

  return line
}

// The clock stands at 1000: started -90000 is 91 s ago. T3: the meter line is
// "<model name> · <elapsed>", with no sparkline glyph and no percent, even when
// the agent carries samples, a window and tokens.
const FULL = {
  started: -90000,
  model: 'claude-sonnet-5-5',
  samples: [10000, 20000, 50000, 100000, 150000, 200000],
  window: 200000,
  tokens: 82000,
}

test('the meter line is the model name, a dot and the elapsed time', async ($, on) => {
  world(on)

  expect(await meter(FULL, on, $)).toBe('sonnet · 1m31s')
})

for (const [id, name] of [
  ['claude-opus-4-6', 'opus'],
  ['claude-fable-5', 'fable'],
  ['claude-haiku-4-5', 'haiku'],
] as const) {
  test(`the model name of ${id} is ${name}`, async ($, on) => {
    world(on)

    expect(await meter({ ...FULL, model: id }, on, $)).toBe(`${name} · 1m31s`)
  })
}

test('a missing model leaves the elapsed time alone', async ($, on) => {
  world(on)

  expect(await meter({ ...FULL, model: undefined }, on, $)).toBe('1m31s')
})

test('a missing start time leaves the model name alone', async ($, on) => {
  world(on)

  expect(await meter({ ...FULL, started: undefined }, on, $)).toBe('sonnet')
})

test('a model id that is none of the four is cut to fit the 16 character desk, with no glyph or percent', async ($, on) => {
  world(on)

  const line = await meter({ ...FULL, model: 'claude-mystery-experimental-9' }, on, $)

  expect(line!.length).toBeLessThanOrEqual(16)
  expect(line).not.toMatch(/[▁▂▃▄▅▆▇█%]/)
})

for (const [name, note] of [
  ['full', FULL],
  ['without a model', { ...FULL, model: undefined }],
  ['without a start', { ...FULL, started: undefined }],
] as const) {
  test(`the meter line of an agent ${name} never shows a sparkline glyph or a percent`, async ($, on) => {
    world(on)

    expect(await meter(note, on, $)).not.toMatch(/[▁▂▃▄▅▆▇█%]/)
  })
}

test('a long run reads in hours and minutes after the model name', async ($, on) => {
  world(on)

  expect(await meter({ ...FULL, started: 1000 - 3900000 }, on, $)).toBe('sonnet · 1h05m')
})

test('a desk with no agent has a blank meter line', async ($, on) => {
  world(on)
  seat(on, {})

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const line = await meterOf(ui, MANAGER)
  await ui.unmount()

  expect(line?.trim()).toBe('')
})

test('the meter line sits right under the status line, above the task lines', async ($, on) => {
  world(on)
  seedOffice(on, {
    desks: { [MANAGER]: { agentIds: ['m1'] } },
    deskOf: { m1: MANAGER },
    agents: { m1: { started: -17000, model: 'claude-opus-5-5', effort: 'high' } },
  })

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const keyOf = (node: any) => String(node.key ?? node.props?.key)
  const boxKeys = (box: any): string[] =>
    (box.children ?? []).filter((child: any) => child.type === 'Box').map(keyOf)
  const column = (await ui.findAll({ type: 'Box' })).find((box: any) =>
    boxKeys(box).includes(`status-${MANAGER}`),
  )
  const keys = column === undefined ? [] : boxKeys(column)
  await ui.unmount()

  expect(keys).toEqual([`status-${MANAGER}`, `meter-${MANAGER}`, `task-${MANAGER}`])
})
