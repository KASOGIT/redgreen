import { expect, test } from 'claude-code/testing'

import { DESKS, crewSummary, deskOfType, headerText } from '../hooks/model'
import { composeDesk, encodeCells, layout, tallPlan } from '../hooks/scene'
import { PALETTE, SPRITES } from '../hooks/sprites'
import {
  buttonsOf,
  expectedCells,
  firstDifference,
  gridOf,
  meterOf,
  mountPane,
  rosterOf,
  rowsOn,
  seedOffice,
  statusOf,
  taskOf,
  world,
} from './kit'

// The advisor desk: the tenth desk, always drawn idle, never worked by an
// agent. Its count grows by one for each finished advisor use that a main
// session turn.step reports in serverToolUses. The clock stands at 1000.

const ADVISOR = 'advisor'
const MANAGER = 'manager'
const TALL = 53 // 54 columns hold 3 desks a line: 4 lines of 13 rows and a header.
const EMPTY = { desks: {}, deskOf: {}, agents: {} }

let uses: unknown[] | undefined

const used = (over: Record<string, unknown> = {}) => ({
  id: 'srv1',
  name: 'advisor',
  input: {},
  startedAt: 500,
  endedAt: 1000,
  ...over,
})

const setup = (on: any, seed: Record<string, unknown> = EMPTY, advisorModel = 'fable') => {
  uses = undefined
  const w = world(on)
  on('turn.step', async function* (_: any, e: any) {
    yield { kind: 'text', index: 0, text: 'x' }

    return {
      turnId: 'u1',
      index: e.index,
      answer: '',
      toolUses: [],
      ...(uses === undefined ? {} : { serverToolUses: uses }),
    }
  })
  on('settings.read', () => ({ value: { advisorModel } }))
  on('classic.SessionStart', () => ({}))

  return { ...w, office: seedOffice(on, seed) }
}

const step = async ($: any, list: unknown[] | undefined, agentId?: string) => {
  uses = list
  const stream = $.turn.step({
    turnId: 'u1',
    index: 0,
    model: 'claude-fable-5',
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })
  let next = await stream.next()
  while (!next.done) next = await stream.next()
}

const advise = ($: any, list: unknown[] = [used()]) => step($, list)

const pane = async ($: any, bodyColumns = 54, bodyRows = TALL) => {
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)

  return ui
}

const statusAfter = async ($: any, slot = ADVISOR): Promise<string | undefined> => {
  const ui = await pane($)
  const text = await statusOf(ui, slot)
  await ui.unmount()

  return text
}

const rasterCells = async (ui: any, slot: string): Promise<string | undefined> =>
  (await ui.findAll({ type: 'Raster' })).find((one: any) => one.key === `desk-${slot}`)?.props
    .cells

const countOf = (office: any): number | undefined => office.stored().desks?.advisor?.count

// S1. The desk list

test('S1 the desk list has ten entries, the advisor last, as slot and label', () => {
  expect(DESKS.map(([slot, label]) => `${slot}/${label}`)).toEqual([
    'manager/manager',
    'test-runner/test-runner',
    'domain-researcher/researcher',
    'debugger-analyst/debugger',
    'architecture-planner/architect',
    'test-engineer/test-engineer',
    'implementer/implementer',
    'code-reviewer/reviewer',
    'guest/guest',
    'advisor/advisor',
  ])
})

test('S1 the ten Buttons keep hotkeys 0 to 8 for the nine desks and give the advisor 9', async ($, on) => {
  world(on)

  const ui = await pane($)
  const found = await buttonsOf(ui)
  await ui.unmount()

  expect(found.map((one: any) => one.props.hotkey)).toEqual([
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ])
  expect(found.map((one: any) => one.key)[9]).toBe('view-advisor')
})

// S2. No agent sits at the advisor desk

for (const type of ['advisor', 'crew:advisor']) {
  test(`S2 an agent of type ${type} lands on the guest desk`, () => {
    expect(deskOfType(type)).toBe('guest')
  })
}

test('S2 the seven crew types and unknown types map as before, the advisor desk apart', () => {
  const crew = [
    'test-runner',
    'domain-researcher',
    'debugger-analyst',
    'architecture-planner',
    'test-engineer',
    'implementer',
    'code-reviewer',
  ]
  expect(crew.map(name => deskOfType(name))).toEqual(crew)
  expect(crew.map(name => deskOfType(`crew:${name}`))).toEqual(crew)
  expect(['guest', 'Explore', 'general-purpose', 'whatever'].map(deskOfType)).toEqual([
    'guest',
    'guest',
    'guest',
    'guest',
  ])
  expect(deskOfType('advisor')).toBe('guest')
})

// S3. The count

test('S3 one finished advisor use makes the stored desk { agentIds: [], count: 1 }', async ($, on) => {
  const { office } = setup(on)

  await advise($)

  expect(office.stored().desks.advisor).toEqual({ agentIds: [], count: 1 })
})

test('S3 a later step with one more finished use makes it 2', async ($, on) => {
  const { office } = setup(on)

  await advise($)
  await advise($, [used({ id: 'srv2' })])

  expect(countOf(office)).toBe(2)
})

test('S3 two finished uses in one step add 2', async ($, on) => {
  const { office } = setup(on)

  await advise($, [used(), used({ id: 'srv2' })])

  expect(countOf(office)).toBe(2)
})

test('S3 an unfinished use, another tool, an empty list and no list add nothing: only the one finished advisor use counts', async ($, on) => {
  const { office } = setup(on)

  await advise($, [used({ name: 'web_search' }), used({ id: 's2', endedAt: undefined }), used({ id: 's3' })])
  await advise($, [])
  await step($, undefined)

  expect(countOf(office)).toBe(1)
})

test('S3 a subagent step with finished advisor uses adds nothing: only the following main step counts', async ($, on) => {
  const { office } = setup(on)

  await step($, [used(), used({ id: 'srv2' })], 'a1')
  await advise($)

  expect(office.stored().desks.advisor).toEqual({ agentIds: [], count: 1 })
})

test('S3 the count survives the end of the 5 second pose and shows 1 · idle', async ($, on) => {
  const { office, clock } = setup(on)
  await advise($)

  await clock.advance(6000)

  expect(countOf(office)).toBe(1)
  expect(await statusAfter($)).toBe('1 · idle')
})

test('S3 office state written before the feature (no desks.advisor) reads as idle, then counts from zero', async ($, on) => {
  const { office } = setup(on, {
    desks: { implementer: { agentIds: [], count: 4 } },
    deskOf: {},
  })

  expect(await statusAfter($)).toBe('idle')
  await advise($)

  expect(countOf(office)).toBe(1)
  expect(office.stored().desks.implementer).toEqual({ agentIds: [], count: 4 })
})

// S4. Display

test('S4 the pixel status under the desk reads idle, then 1 · idle, then 2 · idle', async ($, on) => {
  setup(on)

  const first = await statusAfter($)
  await advise($)
  const second = await statusAfter($)
  await advise($)
  const third = await statusAfter($)

  expect([first, second, third]).toEqual(['idle', '1 · idle', '2 · idle'])
})

test('S4 the text layout line reads advisor: idle, then advisor: 1 · idle', async ($, on) => {
  setup(on)

  const first = await rowsOn($, 'terminal')
  await advise($)
  const second = await rowsOn($, 'terminal')

  expect(first.at(-1)).toBe('advisor: idle')
  expect(second.at(-1)).toBe('advisor: 1 · idle')
  expect(second).toHaveLength(10)
})

test('S4 the advisor desk is drawn with the idle look at count 0, with a count and during the pose', async ($, on) => {
  const { clock } = setup(on)
  expect(SPRITES.advisor).toBeDefined()
  const idle = encodeCells(composeDesk(ADVISOR, 'idle', 0))

  const cellsNow = async () => {
    const ui = await pane($)
    const cells = await rasterCells(ui, ADVISOR)
    await ui.unmount()

    return cells
  }
  const atZero = await cellsNow()
  await advise($)
  await clock.advance(10)
  const inPose = await cellsNow()
  await clock.advance(6000)
  const counted = await cellsNow()

  expect([atZero, inPose, counted]).toEqual([idle, idle, idle])
})

// S5. The pose is unchanged

test('S5 during the pose the manager is advised by fable and the advisor desk reads 1 · idle', async ($, on) => {
  const { clock } = setup(on)
  await advise($)
  await clock.advance(100)

  const ui = await pane($)
  const manager = await statusOf(ui, MANAGER)
  const advisor = await statusOf(ui, ADVISOR)
  const manager2 = encodeCells(composeDesk(MANAGER, 'advised', 0))
  const manager3 = encodeCells(composeDesk(MANAGER, 'advised', 1))
  const cells = await rasterCells(ui, MANAGER)
  await ui.unmount()

  expect([manager, advisor]).toEqual(['advised by fable', '1 · idle'])
  expect([manager2, manager3]).toContain(cells)
})

test('S5 during the pose the text layout shows the manager advised and the advisor line 1 · idle', async ($, on) => {
  const { clock } = setup(on)
  await advise($)
  await clock.advance(100)

  const rows = await rowsOn($, 'terminal')

  expect(rows[0]).toBe('manager: advised by fable')
  expect(rows.at(-1)).toBe('advisor: 1 · idle')
})

// S6. The header

test('S6 a consultation count of 3 and nothing else is not crew work', () => {
  const office = { desks: { advisor: { agentIds: [], count: 3 } }, deskOf: {} }

  expect(headerText(office, 60)).toBe('0 working · 0 done')
  expect(crewSummary(office)).toBe('crew: 0 working · 0 done')
})

// S7. Reset

for (const source of ['startup', 'clear'] as const) {
  test(`S7 a ${source} session clears the count back to idle`, async ($, on) => {
    setup(on)
    await advise($)
    expect(await statusAfter($)).toBe('1 · idle')

    await $.classic.SessionStart({ source })

    expect(await statusAfter($)).toBe('idle')
  })
}

for (const source of ['resume', 'compact'] as const) {
  test(`S7 a ${source} session keeps the count`, async ($, on) => {
    setup(on)
    await advise($)

    await $.classic.SessionStart({ source })

    expect(await statusAfter($)).toBe('1 · idle')
  })
}

// S8. The sprite

test('S8 the advisor sprite: 16 rows of 16, palette keys only, the robe colour, an idle art of its own', () => {
  const art = SPRITES.advisor?.idle
  expect(art).toBeDefined()
  expect(art).toHaveLength(16)
  for (const line of art!) {
    expect(line).toHaveLength(16)
    for (const one of line) expect(one === '.' || one in PALETTE).toBe(true)
  }
  expect(art!.join('')).toMatch(/u/)
  for (const [slot] of DESKS.slice(0, 9)) {
    expect({ slot, same: SPRITES[slot]!.idle.join('/') === art!.join('/') }).toEqual({
      slot,
      same: false,
    })
  }
})

for (const scale of [1, 2] as const) {
  test(`S8 composeDesk of the advisor at scale ${scale} returns full-size cells of its idle art`, () => {
    expect(SPRITES.advisor).toBeDefined()
    const words = composeDesk(ADVISOR, 'idle', 0, scale)

    expect(words).toHaveLength(scale * 16 * ((scale * 16) / 2) * 3)
    expect(firstDifference(words, expectedCells(ADVISOR, 'idle', 0, scale))).toBe(-1)
  })
}

// S9. Press

test('S9 pressing the advisor label shows the main conversation, like an idle desk with no last agent', async ($, on) => {
  const { views, toasts } = world(on)

  const ui = await pane($)
  expect(await ui.findAll({ type: 'Button', key: 'view-advisor' })).toHaveLength(1)
  const result = await ui.press({ key: 'view-advisor' })
  await ui.unmount()

  expect(result).toEqual({ element: 'view-advisor' })
  expect(views).toEqual([{}])
  expect(toasts).toEqual([])
})

// S10. Layout with the advisor. The rows maths stay those of nine desks; the
// advisor is added after the nine are placed: in a free cell, on its own last
// line, in the idle guest's seat, or in the roster.

const NINE = [
  'manager',
  'test-runner',
  'domain-researcher',
  'debugger-analyst',
  'architecture-planner',
  'test-engineer',
  'implementer',
  'code-reviewer',
  'guest',
]
const [M, RUN, RES, DEB, ARC, ENG, IMP, REV, GST] = NINE as [
  string, string, string, string, string, string, string, string, string,
]
const WORKING: Record<string, string[]> = {
  none: [],
  two: [RUN, IMP],
  seven: [RUN, RES, DEB, ARC, ENG, IMP, REV],
  guest: [GST],
}

// An office read from storage: these desks working, or marked done or waiting,
// and the advisor's count. The clock stands at 1000, so a mark until 9000 is live.
const seat = (
  on: any,
  { working = [] as string[], done = [] as string[], waiting = [] as string[], count = 3 } = {},
) => {
  const desks: Record<string, unknown> = {}
  const deskOf: Record<string, string> = {}
  const agents: Record<string, unknown> = {}
  for (const slot of [...working, ...waiting]) {
    desks[slot] = { agentIds: [`s-${slot}`] }
    deskOf[`s-${slot}`] = slot
    agents[`s-${slot}`] = waiting.includes(slot) ? { status: 'waiting' } : {}
  }
  for (const slot of done) desks[slot] = { agentIds: [], mark: 'done', until: 9000 }
  if (count > 0) desks.advisor = { agentIds: [], count }
  seedOffice(on, { desks, deskOf, agents })
}

const laid = async ($: any, bodyColumns: number, bodyRows: number) => {
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
  const grid = await gridOf(ui)
  const roster = await rosterOf(ui)
  const scale = (await ui.findAll({ type: 'Raster' }))[0]?.props.columns / 16
  const info: Record<string, { task?: string[]; meter?: string }> = {}
  for (const [slot] of DESKS) {
    info[slot] = { task: await taskOf(ui, slot), meter: await meterOf(ui, slot) }
  }
  await ui.unmount()

  return {
    grid,
    roster,
    scale,
    info,
    slots: grid.map(line => line.slots),
    heights: grid.map(line => line.height),
    hasInfo: (slot: string) => info[slot]!.task !== undefined || info[slot]!.meter !== undefined,
    total:
      1 +
      grid.reduce((sum, line) => sum + line.height, 0) +
      (roster === undefined || roster === '' ? 0 : 1),
  }
}

// Row maths, for nine desks and a cap of ten per row.

test('S10 tall mode needs 1 + ceil(9 / columns) * (8 * scale + 4) rows, a second task line once the spare rows reach the lines', () => {
  expect(tallPlan(3, 1, 36)).toBeUndefined()
  expect(tallPlan(3, 1, 37)).toEqual({ tasks: 1 })
  expect(tallPlan(3, 1, 39)).toEqual({ tasks: 1 })
  expect(tallPlan(3, 1, 40)).toEqual({ tasks: 2 })
  expect(tallPlan(3, 2, 60)).toBeUndefined()
  expect(tallPlan(3, 2, 61)).toEqual({ tasks: 1 })
  expect(tallPlan(3, 2, 64)).toEqual({ tasks: 2 })
  expect(tallPlan(1, 1, 108)).toBeUndefined()
  expect(tallPlan(1, 1, 109)).toEqual({ tasks: 1 })
  expect(tallPlan(9, 1, 12)).toBeUndefined()
  expect(tallPlan(9, 1, 13)).toEqual({ tasks: 1 })
})

test('S10 scale 2 needs 1 + ceil(9 / perRow2) * 20 rows and the per-row cap is ten', () => {
  const table: Array<[number, number, { columns: number; scale: number }]> = [
    [100, 60, { columns: 5, scale: 1 }],
    [100, 61, { columns: 3, scale: 2 }],
    [66, 100, { columns: 3, scale: 1 }],
    [66, 101, { columns: 2, scale: 2 }],
    [32, 180, { columns: 1, scale: 1 }],
    [32, 181, { columns: 1, scale: 2 }],
    [304, 20, { columns: 10, scale: 1 }],
    [304, 21, { columns: 9, scale: 2 }],
    [160, 12, { columns: 9, scale: 1 }],
    [178, 12, { columns: 10, scale: 1 }],
    [500, 12, { columns: 10, scale: 1 }],
    [338, 20, { columns: 10, scale: 1 }],
    [338, 21, { columns: 10, scale: 2 }],
  ]
  for (const [bodyColumns, bodyRows, want] of table) {
    expect({ at: [bodyColumns, bodyRows], ...layout(bodyColumns, bodyRows) }).toEqual({
      at: [bodyColumns, bodyRows],
      ...want,
    })
  }
})

// A. Parity: the nine desks are laid out as before the advisor existed. Each
// row is [bodyColumns, bodyRows, working set, scale, task lines, lines of the
// nine as indexes into NINE, desks with info lines, the complete roster names,
// whether the roster text was cut], read off the layout at d3344b7.
type Before = [
  number, number, string, number, number, number[][], number[], string[], boolean,
]
const BEFORE: Before[] = [
  [18, 40, 'none', 1, 0, [[0],[1],[2]], [], ['debugger'], true],
  [18, 40, 'two', 1, 1, [[1],[6],[0]], [1,6], ['researcher'], true],
  [18, 40, 'seven', 1, 1, [[1],[2],[3]], [1,2,3], ['architect*'], true],
  [34, 30, 'none', 1, 0, [[0,1],[2,3]], [], ['architect', 'test-engineer'], true],
  [34, 30, 'two', 1, 1, [[1,6],[0,2]], [1,6], ['debugger', 'architect'], true],
  [34, 30, 'seven', 1, 1, [[1,2],[3,4]], [1,2,3,4], ['test-engineer*', 'implementer*'], true],
  [54, 12, 'none', 1, 0, [[0,1,2]], [], ['debugger', 'architect', 'test-engineer', 'implementer'], true],
  [54, 12, 'two', 1, 0, [[1,6,0]], [], ['researcher', 'debugger', 'architect', 'test-engineer'], true],
  [54, 12, 'seven', 1, 0, [[1,2,3]], [], ['architect*', 'test-engineer*', 'implementer*', 'reviewer*'], true],
  [54, 16, 'none', 1, 0, [[0,1,2]], [], ['debugger', 'architect', 'test-engineer', 'implementer'], true],
  [54, 16, 'two', 1, 1, [[1,6,0]], [1,6], ['researcher', 'debugger', 'architect', 'test-engineer'], true],
  [54, 16, 'seven', 1, 1, [[1,2,3]], [1,2,3], ['architect*', 'test-engineer*', 'implementer*', 'reviewer*'], true],
  [54, 24, 'none', 1, 0, [[0,1,2],[3,4,5]], [], ['implementer', 'reviewer', 'guest'], false],
  [54, 24, 'two', 1, 1, [[1,6,0],[2,3,4]], [1,6], ['test-engineer', 'reviewer', 'guest'], false],
  [54, 24, 'seven', 1, 1, [[1,2,3]], [1,2,3], ['architect*', 'test-engineer*', 'implementer*', 'reviewer*'], true],
  [54, 36, 'none', 1, 0, [[0,1,2],[3,4,5],[6,7,8]], [], [], false],
  [54, 36, 'two', 1, 1, [[1,6,0],[2,3,4],[5,7,8]], [1,6], [], false],
  [54, 36, 'seven', 1, 1, [[1,2,3],[4,5,6]], [1,2,3,4,5,6], ['reviewer*', 'manager', 'guest'], false],
  [54, 37, 'none', 1, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 37, 'two', 1, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 37, 'seven', 1, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 40, 'none', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 40, 'two', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 40, 'seven', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 40, 'guest', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 44, 'none', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 44, 'two', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 44, 'seven', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 60, 'none', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 60, 'two', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 60, 'seven', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [54, 60, 'guest', 1, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [72, 40, 'none', 1, 2, [[0,1,2,3],[4,5,6,7],[8]], [0,1,2,3,4,5,6,7,8], [], false],
  [72, 40, 'two', 1, 2, [[0,1,2,3],[4,5,6,7],[8]], [0,1,2,3,4,5,6,7,8], [], false],
  [72, 40, 'seven', 1, 2, [[0,1,2,3],[4,5,6,7],[8]], [0,1,2,3,4,5,6,7,8], [], false],
  [90, 24, 'none', 1, 0, [[0,1,2,3,4],[5,6,7,8]], [], [], false],
  [90, 24, 'two', 1, 1, [[1,6,0,2,3],[4,5,7,8]], [1,6], [], false],
  [90, 24, 'seven', 1, 1, [[1,2,3,4,5]], [1,2,3,4,5], ['implementer*', 'reviewer*', 'manager', 'guest'], false],
  [90, 40, 'none', 1, 2, [[0,1,2,3,4],[5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [90, 40, 'two', 1, 2, [[0,1,2,3,4],[5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [90, 40, 'seven', 1, 2, [[0,1,2,3,4],[5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 61, 'none', 2, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 61, 'two', 2, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 61, 'seven', 2, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 61, 'guest', 2, 1, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 70, 'none', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 70, 'two', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [100, 70, 'seven', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 40, 'none', 1, 2, [[0,1,2,3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 40, 'two', 1, 2, [[0,1,2,3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 40, 'seven', 1, 2, [[0,1,2,3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 65, 'none', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 65, 'two', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 65, 'seven', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [112, 65, 'guest', 2, 2, [[0,1,2],[3,4,5],[6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [160, 13, 'none', 1, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [160, 13, 'two', 1, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [160, 13, 'seven', 1, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [178, 12, 'none', 1, 0, [[0,1,2,3,4,5,6,7,8]], [], [], false],
  [178, 12, 'two', 1, 0, [[1,6,0,2,3,4,5,7,8]], [], [], false],
  [178, 12, 'seven', 1, 0, [[1,2,3,4,5,6,7,0,8]], [], [], false],
  [178, 13, 'none', 1, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [178, 13, 'two', 1, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [178, 13, 'seven', 1, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [304, 21, 'none', 2, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [304, 21, 'two', 2, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [304, 21, 'seven', 2, 1, [[0,1,2,3,4,5,6,7,8]], [0,1,2,3,4,5,6,7,8], [], false],
  [66, 101, 'none', 2, 1, [[0,1],[2,3],[4,5],[6,7],[8]], [0,1,2,3,4,5,6,7,8], [], false],
  [66, 101, 'two', 2, 1, [[0,1],[2,3],[4,5],[6,7],[8]], [0,1,2,3,4,5,6,7,8], [], false],
  [66, 101, 'seven', 2, 1, [[0,1],[2,3],[4,5],[6,7],[8]], [0,1,2,3,4,5,6,7,8], [], false],
]

for (const [cols, rows, set, scale, tasks, lines, info, roster, cut] of BEFORE) {
  test(`S10 A parity at ${cols} by ${rows} with ${set} working: scale, task lines, lines, info and roster of the nine are as before`, async ($, on) => {
    world(on)
    seat(on, { working: WORKING[set]! })

    const found = await laid($, cols, rows)

    const swapped = !found.slots.flat().includes(GST) && found.slots.flat().includes('advisor')
    const seen = found.slots
      .map(line =>
        line
          .map(slot => (slot === 'advisor' ? (swapped ? GST : undefined) : slot))
          .filter((slot): slot is string => slot !== undefined)
          .map(slot => NINE.indexOf(slot)),
      )
      .filter(line => line.length > 0)
    expect(seen).toEqual(lines)
    expect(found.scale).toBe(scale)
    const withInfo = NINE.map((slot, at) => [slot, at] as const)
      .filter(([slot]) => found.info[slot]!.task !== undefined)
    expect(withInfo.map(([, at]) => at)).toEqual(swapped ? info.filter(at => at !== 8) : info)
    if (withInfo.length > 0) expect(found.info[withInfo[0]![0]]!.task).toHaveLength(tasks)
    expect(found.hasInfo('advisor')).toBe(false)
    const names = (found.roster ?? '')
      .split('  ')
      .filter(Boolean)
      .filter(name => !/^advisor/.test(name) && !(swapped && name === 'guest') && !name.endsWith('…'))
      .map(name => name)
    const expected = roster
    expect(names).toEqual(
      found.roster?.endsWith('…') || cut ? expected.slice(0, names.length) : expected,
    )
  })
}

// C. Where the advisor goes.

test('S10 C1 all nine drawn and a free cell on the last line: the advisor sits in it, 112 by 40 draws lines of 6 and 4', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 112, 40)

  expect(found.slots).toEqual([[M, RUN, RES, DEB, ARC, ENG], [IMP, REV, GST, 'advisor']])
  expect(found.heights).toEqual([13, 13])
  for (const slot of NINE) expect(found.hasInfo(slot)).toBe(true)
  expect(found.hasInfo('advisor')).toBe(false)
  expect(found.roster === undefined || found.roster === '').toBe(true)
})

test('S10 C1 in a short pane with all nine drawn the advisor takes the free cell too: 90 by 24 draws lines of 5 and 5', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 90, 24)

  expect(found.slots).toEqual([[M, RUN, RES, DEB, ARC], [ENG, IMP, REV, GST, 'advisor']])
  expect(found.roster === undefined || found.roster === '').toBe(true)
})

test('S10 C1 178 columns draw one line of ten, the nine in their line and the advisor after them', async ($, on) => {
  world(on)
  seat(on)

  const tall = await laid($, 178, 13)
  const short = await laid($, 178, 12)

  expect(tall.slots).toEqual([[...NINE, 'advisor']])
  expect(short.slots).toEqual([[...NINE, 'advisor']])
  expect(tall.hasInfo('advisor')).toBe(false)
})

test('S10 C2 all nine drawn and no free cell: with 10 rows left the advisor gets its own last line of 10, at 54 by 50', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 54, 50)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, GST], ['advisor']])
  expect(found.heights).toEqual([13, 13, 13, 10])
  expect(found.total).toBe(50)
  expect(found.hasInfo('advisor')).toBe(false)
  expect(found.roster === undefined || found.roster === '').toBe(true)
})

test('S10 C2 54 by 53 and 54 by 60 give the advisor its own fourth line and the guest keeps its seat', async ($, on) => {
  world(on)
  seat(on)

  for (const rows of [53, 60]) {
    const found = await laid($, 54, rows)

    expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, GST], ['advisor']])
  }
})

test('S10 C2 at 54 by 49 only 9 rows are left, not the 10 an extra line needs: the advisor takes the guest seat', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 54, 49)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.roster).toBe('guest')
})

test('S10 C2 at scale 2 an own line needs 18 rows left: 100 by 82 gets one of 18 rows, 100 by 81 leaves 17 and the advisor takes the guest seat', async ($, on) => {
  world(on)
  seat(on)

  const own = await laid($, 100, 82)
  const seated = await laid($, 100, 81)

  expect(own.scale).toBe(2)
  expect(own.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, GST], ['advisor']])
  expect(own.heights).toEqual([21, 21, 21, 18])
  expect(seated.scale).toBe(2)
  expect(seated.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(seated.roster).toBe('guest')
})

test('S10 C3 54 by 40 with nobody working: the advisor takes the idle guest seat, no roster, info for the eight others', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 54, 40)

  expect(found.scale).toBe(1)
  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.heights).toEqual([13, 13, 13])
  expect(found.roster === undefined || found.roster === '').toBe(true)
  for (const slot of [M, RUN, RES, DEB, ARC, ENG, IMP, REV]) {
    expect(found.info[slot]!.task).toHaveLength(2)
    expect(found.info[slot]!.meter).toBeDefined()
  }
  expect(found.hasInfo('advisor')).toBe(false)
  expect(found.hasInfo(GST)).toBe(false)
})

test('S10 C3 54 by 41 keeps the same seats and lists the guest in the roster', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 54, 41)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.roster).toBe('guest')
  expect(found.total).toBe(41)
})

test('S10 C3 54 by 37 with seven crew desks working: all nine as before, the advisor in the guest seat, nothing active on a roster', async ($, on) => {
  world(on)
  seat(on, { working: WORKING.seven })

  const found = await laid($, 54, 37)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.roster === undefined || found.roster === '').toBe(true)
  expect(found.info[IMP]!.task).toHaveLength(1)
})

test('S10 C3 112 by 65 is scale 2 with 3 desks a line and the advisor in the guest seat', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 112, 65)

  expect(found.scale).toBe(2)
  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.heights).toEqual([21, 21, 21])
  expect(found.roster).toBe('guest')
})

test('S10 C3 100 by 70 is scale 2 and the advisor takes the guest seat, 6 rows left being fewer than an own line needs', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 100, 70)

  expect(found.scale).toBe(2)
  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.roster).toBe('guest')
})

test('S10 C3 160 by 13 with two desks working: the nine on one line with their info, the advisor in the idle guest seat and no row left for a roster', async ($, on) => {
  world(on)
  seat(on, { working: [RUN, IMP] })

  const found = await laid($, 160, 13)

  expect(found.slots).toEqual([[M, RUN, RES, DEB, ARC, ENG, IMP, REV, 'advisor']])
  for (const slot of [M, RUN, RES, DEB, ARC, ENG, IMP, REV]) expect(found.hasInfo(slot)).toBe(true)
  expect(found.hasInfo('advisor')).toBe(false)
  expect(found.roster === undefined || found.roster === '').toBe(true)
})

test('S10 C3 in a short pane the idle guest seat goes to the advisor and the guest is listed: 54 by 36 with the manager working', async ($, on) => {
  world(on)
  seat(on, { working: [M] })

  const found = await laid($, 54, 36)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, 'advisor']])
  expect(found.heights).toEqual([12, 10, 10])
  expect(found.roster).toBe('guest')
})

for (const [name, options] of [
  ['working', { working: [GST] }],
  ['done', { done: [GST] }],
  ['waiting', { waiting: [GST] }],
] as const) {
  test(`S10 C4 a guest ${name} keeps its seat and the advisor is not drawn: 54 by 40 draws the nine, no roster`, async ($, on) => {
    world(on)
    seat(on, options)

    const found = await laid($, 54, 40)

    expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, GST]])
    expect(found.slots.flat()).not.toContain('advisor')
    expect(found.roster === undefined || found.roster === '').toBe(true)
  })
}

test('S10 C4 with the guest working and a row left, the advisor shows in the roster with its count, 54 by 41', async ($, on) => {
  world(on)
  seat(on, { working: [GST] })

  const found = await laid($, 54, 41)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG], [IMP, REV, GST]])
  expect(found.roster).toBe('advisor 3')
})

test('S10 C4 at count 0 the roster entry reads advisor', async ($, on) => {
  world(on)
  seat(on, { working: [GST], count: 0 })

  const found = await laid($, 54, 41)

  expect(found.roster).toBe('advisor')
})

test('S10 C4 a short pane with some of the nine folded lists the advisor in the roster: 54 by 24, nobody working', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 54, 24)

  expect(found.slots).toEqual([[M, RUN, RES], [DEB, ARC, ENG]])
  expect(found.roster).toBe('advisor 3  implementer  reviewer  guest')
  expect(found.hasInfo('advisor')).toBe(false)
})

// E. The roster text.

test('S10 E the advisor entry comes after the starred entries and before the idle names', async ($, on) => {
  world(on)
  seat(on, { working: [RUN, RES, DEB, REV] })

  const found = await laid($, 54, 16)

  expect(found.slots).toEqual([[RUN, RES, DEB]])
  expect(found.roster).toBe('reviewer*  advisor 3  manager  architect  test-engine…')
})

test('S10 E a narrow pane cuts the idle names, never the advisor entry', async ($, on) => {
  world(on)
  seat(on)

  const found = await laid($, 18, 40)

  expect(found.slots).toEqual([[M], [RUN], [RES]])
  expect(found.roster).toBe('advisor 3  debugg…')
})

// F. The roster row in tall mode.

test('S10 F a tall pane shows the roster only when a row is left after everything drawn', async ($, on) => {
  world(on)
  seat(on)

  const none = await laid($, 54, 40)
  const one = await laid($, 54, 41)

  expect(none.roster === undefined || none.roster === '').toBe(true)
  expect(none.total).toBe(40)
  expect(one.roster).toBe('guest')
  expect(one.total).toBe(41)
})
