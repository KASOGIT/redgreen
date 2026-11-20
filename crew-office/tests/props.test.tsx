import { expect, test } from 'claude-code/testing'

import { frameOf } from '../hooks/model'
import {
  agentInfo,
  expectedCells,
  firstDifference,
  mountPane,
  seedOffice,
  spawn,
  startTurn,
  statusOf,
  useTool,
  world,
} from './kit'

// Spec, S4 animation with T2 (no corner stamps): a working desk draws its plain
// working frame whatever the tool; a waiting desk draws the undimmed idle art
// and is not blitted; desk i of the nine shows frame (tick + i) % 4. Slot indexes:
// manager 0, test-runner 1, domain-researcher 2, debugger-analyst 3, ...

const words = (cells: string): number[] => {
  const bytes = Uint8Array.from(atob(cells), one => one.charCodeAt(0))
  const view = new DataView(bytes.buffer)

  return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true))
}

const sameCells = (cells: string, want: number[]) =>
  firstDifference(words(cells), want)

const rasterOf = async (ui: any, slot: string) =>
  (await ui.findAll({ type: 'Raster' })).find((one: any) => one.key === `desk-${slot}`)

// A tool at work leaves the working frame plain

const TOOLS = [
  'Read', 'Grep', 'Glob', 'NotebookRead', 'Edit', 'Write', 'NotebookEdit', 'Bash',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'SomethingElse',
]

for (const tool of TOOLS) {
  test(`${tool} at work: the blit of the desk is the plain working frame`, async ($, on) => {
    const { blits, clock } = world(on)
    await spawn($, 'crew:test-runner')
    await useTool($, tool, 'a1')
    const ui = await mountPane($, 'terminal', 54)

    await clock.advance(500)
    await ui.unmount()

    expect(blits).toHaveLength(1)
    // test-runner is slot 1: frame (1 + 1) % 4 = 2 at the first tick.
    expect(sameCells(blits[0].cells, expectedCells('test-runner', 'working', 2, 1))).toBe(-1)
  })
}

test('with no tool called yet, the working desk blits the plain working frame', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(500)
  await ui.unmount()

  expect(sameCells(blits[0].cells, expectedCells('test-runner', 'working', 2))).toBe(-1)
})

test('the tool changing from Edit to Bash changes nothing in the frames: both blits are plain', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  await useTool($, 'Edit', 'a1')
  const ui = await mountPane($, 'terminal', 54)
  await clock.advance(500)

  await useTool($, 'Bash', 'a1')
  await clock.advance(500)
  await ui.unmount()

  expect(blits).toHaveLength(2)
  expect(sameCells(blits[0].cells, expectedCells('test-runner', 'working', 2, 1))).toBe(-1)
  expect(sameCells(blits[1].cells, expectedCells('test-runner', 'working', 3, 1))).toBe(-1)
})

// A tool at work on the render

test('a render draws the plain working frame whatever the tool, at scale 1 and at scale 2', async ($, on) => {
  world(on)
  await spawn($, 'crew:test-runner')
  await useTool($, 'WebFetch', 'a1')

  const small = await mountPane($, 'terminal', 54, 'dock', 40)
  const one = await rasterOf(small, 'test-runner')
  await small.unmount()
  const big = await mountPane($, 'terminal', 100, 'dock', 61)
  const two = await rasterOf(big, 'test-runner')
  await big.unmount()

  // No tick yet: test-runner (slot 1) draws frame 1.
  expect(sameCells(one.props.cells, expectedCells('test-runner', 'working', 1, 1))).toBe(-1)
  expect(sameCells(two.props.cells, expectedCells('test-runner', 'working', 1, 2))).toBe(-1)
})

test('the manager at work with a tool draws its plain working frame, at its own phase', async ($, on) => {
  world(on)
  await startTurn($)
  await useTool($, 'Bash')

  const ui = await mountPane($, 'terminal', 54)
  const raster = await rasterOf(ui, 'manager')
  await ui.unmount()

  expect(sameCells(raster.props.cells, expectedCells('manager', 'working', 0, 1))).toBe(-1)
})

test('a desk that is not working draws no tool art: idle desks are as before', async ($, on) => {
  world(on)
  await spawn($, 'crew:test-runner')

  const ui = await mountPane($, 'terminal', 54)
  const raster = await rasterOf(ui, 'implementer')
  await ui.unmount()

  expect(sameCells(raster.props.cells, expectedCells('implementer', 'idle', 0))).toBe(-1)
})

// Waiting

const waiting = (on: any) =>
  seedOffice(on, {
    desks: { 'test-runner': { agentIds: ['a1'] } },
    deskOf: { a1: 'test-runner' },
    agents: { a1: { status: 'waiting' } },
  })

test('a desk whose agent is waiting is drawn as the undimmed idle art with no stamp, and says waiting', async ($, on) => {
  world(on)
  waiting(on)

  const ui = await mountPane($, 'terminal', 54)
  const raster = await rasterOf(ui, 'test-runner')
  const text = await statusOf(ui, 'test-runner')
  await ui.unmount()

  expect(text).toBe('waiting')
  expect(sameCells(raster.props.cells, expectedCells('test-runner', 'waiting', 0, 1))).toBe(-1)
  expect(sameCells(raster.props.cells, expectedCells('test-runner', 'idle', 0))).not.toBe(-1)
})

test('the waiting desk is drawn the same at scale 2', async ($, on) => {
  world(on)
  waiting(on)

  const ui = await mountPane($, 'terminal', 100, 'dock', 61)
  const raster = await rasterOf(ui, 'test-runner')
  await ui.unmount()

  expect(sameCells(raster.props.cells, expectedCells('test-runner', 'waiting', 0, 2))).toBe(-1)
})

test('the waiting desk is not blitted while the others keep their ticks', async ($, on) => {
  const { blits, clock } = world(on, {
    agents: [
      agentInfo('a1', 'crew:test-runner', 'waiting'),
      agentInfo('a2', 'crew:implementer', 'running'),
    ],
  })
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:implementer')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(2000)
  await clock.settle()
  const settled = blits.length
  await clock.advance(2000)
  await clock.settle()
  await ui.unmount()

  const later = blits.slice(settled)
  expect(later.map(one => one.key)).toEqual([
    'desk-implementer',
    'desk-implementer',
    'desk-implementer',
    'desk-implementer',
  ])
})

test('a desk whose poll says waiting stops blitting, then blits again when the poll says running', async ($, on) => {
  const feed = { agents: [agentInfo('a1', 'crew:test-runner', 'waiting')] }
  const { blits, clock } = world(on, feed)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(2000)
  await clock.settle()
  const settled = blits.length
  await clock.advance(1500)
  await clock.settle()
  expect(blits).toHaveLength(settled)

  feed.agents = [agentInfo('a1', 'crew:test-runner', 'running')]
  await clock.advance(1000)
  await clock.settle()
  await ui.unmount()

  expect(blits.length).toBeGreaterThan(settled)
})

test('the render of a polled waiting desk is the undimmed idle art', async ($, on) => {
  const { clock } = world(on, { agents: [agentInfo('a1', 'crew:test-runner', 'waiting')] })
  await spawn($, 'crew:test-runner')
  await clock.advance(2000)
  await clock.settle()

  const ui = await mountPane($, 'terminal', 54)
  const raster = await rasterOf(ui, 'test-runner')
  await ui.unmount()

  expect(raster.props.cells).toBeDefined()
  expect(sameCells(raster.props.cells, expectedCells('test-runner', 'waiting', 0, 1))).toBe(-1)
})

test('a pending agent counts as working: its desk keeps blitting and shows no waiting text', async ($, on) => {
  const { blits, clock } = world(on, { agents: [agentInfo('a1', 'crew:test-runner', 'pending')] })
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(2000)
  await clock.settle()
  const settled = blits.length
  await clock.advance(2000)
  await clock.settle()
  await ui.unmount()
  const again = await mountPane($, 'terminal', 54)
  const text = await statusOf(again, 'test-runner')
  await again.unmount()

  expect(blits.length - settled).toBe(4)
  expect(text).toBe('working')
})

// Phase offset

// Frame index per tick, written out by hand: desk i shows (tick + i) % 4. The
// working art of frames 2 and 3 is checked by the blit tests below; this one
// pins the index itself, whatever the art.
test('frameOf walks 0..3 and wraps: desk i at tick t is frame (t + i) % 4', () => {
  const table: Array<[string, number[]]> = [
    ['manager', [0, 1, 2, 3, 0, 1, 2, 3]],
    ['test-runner', [1, 2, 3, 0, 1, 2, 3, 0]],
    ['domain-researcher', [2, 3, 0, 1, 2, 3, 0, 1]],
    ['test-engineer', [1, 2, 3, 0, 1, 2, 3, 0]],
    ['implementer', [2, 3, 0, 1, 2, 3, 0, 1]],
    ['guest', [0, 1, 2, 3, 0, 1, 2, 3]],
  ]
  for (const [slot, frames] of table) {
    expect({ slot, frames: frames.map((_, tick) => frameOf(tick, slot)) }).toEqual({ slot, frames })
  }
})

test('two working desks blit frames one apart: slot 1 and slot 2 differ by one tick', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(1000)
  await ui.unmount()

  expect(blits.map(one => one.key)).toEqual([
    'desk-test-runner',
    'desk-domain-researcher',
    'desk-test-runner',
    'desk-domain-researcher',
  ])
  // Tick 1: (1 + 1) % 4 = 2 and (1 + 2) % 4 = 3; tick 2: 3 and 0.
  const frames = [2, 3, 3, 0] as const
  const slots = ['test-runner', 'domain-researcher', 'test-runner', 'domain-researcher']
  blits.forEach((one, i) => {
    expect(sameCells(one.cells, expectedCells(slots[i]!, 'working', frames[i]!))).toBe(-1)
  })
})

test('the manager is slot 0: it blits frame 1 at the first tick, with the first crew desk at frame 2', async ($, on) => {
  const { blits, clock } = world(on)
  await startTurn($)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(500)
  await ui.unmount()

  expect(blits.map(one => one.key)).toEqual(['desk-manager', 'desk-test-runner'])
  expect(sameCells(blits[0].cells, expectedCells('manager', 'working', 1))).toBe(-1)
  expect(sameCells(blits[1].cells, expectedCells('test-runner', 'working', 2))).toBe(-1)
})

test('a render draws each working desk at its own phase, before and after ticks', async ($, on) => {
  const { clock } = world(on)
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')

  const frames = async () => {
    const ui = await mountPane($, 'terminal', 54)
    const a = await rasterOf(ui, 'test-runner')
    const b = await rasterOf(ui, 'domain-researcher')
    await ui.unmount()

    return [a.props.cells, b.props.cells] as const
  }

  // Tick t: slot 1 -> (t + 1) % 4, slot 2 -> (t + 2) % 4.
  const want = [[1, 2], [2, 3], [3, 0], [0, 1], [1, 2]] as const
  for (const [t, [first, second]] of want.entries()) {
    if (t > 0) await clock.advance(500)
    const got = await frames()
    expect(sameCells(got[0], expectedCells('test-runner', 'working', first))).toBe(-1)
    expect(sameCells(got[1], expectedCells('domain-researcher', 'working', second))).toBe(-1)
  }
})

// A full cycle: the four frames in order, two seconds, then round again.

test('one working desk (slot 1) blits frames 2, 3, 0, 1, 2 over five ticks: a cycle of four, two seconds', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(2500)
  await ui.unmount()

  const frames = [2, 3, 0, 1, 2] as const
  expect(blits).toHaveLength(5)
  blits.forEach((one, i) => {
    expect(sameCells(one.cells, expectedCells('test-runner', 'working', frames[i]!))).toBe(-1)
  })
})

test('the desk at slot 5 (test-engineer) blits frames 2 then 3: (tick + 5) % 4', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-engineer')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(1000)
  await ui.unmount()

  expect(blits.map(one => one.key)).toEqual(['desk-test-engineer', 'desk-test-engineer'])
  expect(sameCells(blits[0].cells, expectedCells('test-engineer', 'working', 2))).toBe(-1)
  expect(sameCells(blits[1].cells, expectedCells('test-engineer', 'working', 3))).toBe(-1)
})
