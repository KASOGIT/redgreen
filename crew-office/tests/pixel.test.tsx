import { expect, test } from 'claude-code/testing'

import { composeDesk, encodeCells } from '../hooks/scene'
import {
  DESKS,
  deskTexts,
  expectRows,
  finishTurn,
  mountPane,
  rowsOn,
  seedOffice,
  spawn,
  startTurn,
  statusOf,
  useTool,
  useToolWith,
  world,
} from './kit'

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const KEYS = DESKS.map(([slot]) => `desk-${slot}`)
// A 54 by 40 pane has no room for ten desks: the idle advisor takes the guest's seat.
const SEATED = [...KEYS.slice(0, 8), 'desk-advisor']

const cellsOf = (slot: string, look: 'idle' | 'working' | 'done' | 'failed', frame: 0 | 1 | 2 | 3) =>
  encodeCells(composeDesk(slot, look, frame))

const rasters = async (ui: any) => await ui.findAll({ type: 'Raster' })

const agent = (id: string, type: string, status: string) => ({
  id,
  type,
  description: 'd',
  status,
})

test('a wide terminal draws nine rasters, in desk order with the advisor in the idle guest seat, 16 by 8', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54)
  const found = await rasters(ui)
  await ui.unmount()

  expect(found.map((one: any) => one.key)).toEqual(SEATED)
  for (const one of found) {
    expect(one.props.columns).toBe(16)
    expect(one.props.rows).toBe(8)
  }
})

// S3: nine desks need 109 rows at one per line, so a 40 row pane is short: idle
// rows of 10 while they fit in 38 rows, perRow desks each.
test('a narrower wide terminal still draws rasters, as many desks as its 40 rows hold', async ($, on) => {
  world(on)

  for (const [bodyColumns, drawn] of [[51, 6], [34, 6], [33, 3], [18, 3]] as const) {
    const ui = await mountPane($, 'terminal', bodyColumns)
    const found = await rasters(ui)
    await ui.unmount()

    expect(found.map((one: any) => one.key)).toEqual(KEYS.slice(0, drawn))
  }
})

test('each drawn desk shows its label, then its short status, under its raster, the advisor in the guest seat', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54)
  const texts = await deskTexts(ui)
  await ui.unmount()

  expect(texts).toEqual(
    [...DESKS.slice(0, 8), DESKS[9]!].flatMap(([, label]) => [label, 'idle']),
  )
})

test('the short status is working, a tool, x<N>, x<N> and a tool, done or failed', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner') // a1
  await spawn($, 'crew:implementer') // a2
  await spawn($, 'crew:implementer') // a3
  await useToolWith($, 'Edit', {}, 'a2')
  await spawn($, 'crew:test-engineer') // a4
  await spawn($, 'crew:debugger-analyst') // a5
  await useToolWith($, 'Bash', {}, 'a5')
  await spawn($, 'crew:code-reviewer') // a6
  await finishTurn($, 'answer', 'a6')
  await spawn($, 'crew:architecture-planner') // a7
  await finishTurn($, 'error', 'a7')
  await spawn($, 'crew:domain-researcher') // a8
  await spawn($, 'crew:domain-researcher') // a9

  const ui = await mountPane($, 'terminal', 54)
  const texts = await deskTexts(ui)
  await ui.unmount()

  expect(texts).toEqual([
    'manager', 'idle',
    'test-runner', 'working',
    'researcher', 'x2',
    'debugger', 'Bash',
    'architect', 'error',
    'test-engineer', 'working',
    'implementer', 'x2 Edit',
    'reviewer', '1 · done 0s',
    'advisor', 'idle',
  ])
})

test('the short status is cut to the 16 character desk width, with an ellipsis', async ($, on) => {
  world(on)

  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await useTool($, 'abcdefghijklmn', 'a1')

  const ui = await mountPane($, 'terminal', 54)
  const status = await statusOf(ui, 'implementer')
  await ui.unmount()

  expect(status).toBe('x2 abcdefghijkl…')
})

for (const [name, surface, bodyColumns, placement] of [
  ['a desktop pane', 'desktop', 54, 'dock'],
  ['a vscode pane', 'vscode', 54, 'dock'],
  ['a mobile pane', 'mobile', 54, 'dock'],
  ['a terminal narrower than 18 columns', 'terminal', 17, 'dock'],
  ['a terminal widget', 'terminal', 54, 'widget'],
] as const) {
  test(`${name} keeps the text list and draws no raster`, async ($, on) => {
    world(on)
    await spawn($, 'crew:test-runner')

    const ui = await mountPane($, surface, bodyColumns, placement)
    const found = await rasters(ui)
    const texts = (await ui.findAll({ type: 'Text' })).map((one: any) => one.text)
    await ui.unmount()

    expect(texts).toEqual([
      'manager: idle',
      'test-runner: working',
      'researcher: idle',
      'debugger: idle',
      'architect: idle',
      'test-engineer: idle',
      'implementer: idle',
      'reviewer: idle',
      'guest: idle',
      'advisor: idle',
    ])
    expect(found).toHaveLength(0)
  })
}

test('each raster carries the cells of the look its desk is in', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:implementer')
  await finishTurn($, 'answer', 'a2')
  await spawn($, 'crew:code-reviewer')
  await finishTurn($, 'error', 'a3')

  const ui = await mountPane($, 'terminal', 54)
  const found = await rasters(ui)
  await ui.unmount()
  const cells = Object.fromEntries(
    found.map((one: any) => [one.key, one.props.cells]),
  )

  expect(cells['desk-manager']).toBe(cellsOf('manager', 'idle', 0))
  // Phase rule (S4): test-runner is slot 1, so before any tick it draws frame (0 + 1) % 4 = 1.
  expect(cells['desk-test-runner']).toBe(cellsOf('test-runner', 'working', 1))
  expect(cells['desk-implementer']).toBe(cellsOf('implementer', 'done', 0))
  expect(cells['desk-code-reviewer']).toBe(cellsOf('code-reviewer', 'failed', 0))
  expect(cells['desk-advisor']).toBe(cellsOf('advisor', 'idle', 0))
  expect(cells['desk-advisor']).toHaveLength(2048)
})

// Animation, driven by the clock (500 ms period) and ui.blit.

test('with nothing working, ten seconds draw no blit and ask no agent list', async ($, on) => {
  const { blits, clock, listCalls } = world(on)

  const ui = await mountPane($, 'terminal', 54)
  await clock.advance(10000)
  await ui.unmount()

  expect(blits).toHaveLength(0)
  expect(listCalls()).toBe(0)
})

test('one working desk (slot 1) blits two frames in a second, frame 2 then 3 by the phase rule, only its own raster', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(1000)
  await ui.unmount()

  expect(blits).toHaveLength(2)
  expect(blits[0]).toEqual({
    requestId: 'crew-office',
    key: 'desk-test-runner',
    cells: cellsOf('test-runner', 'working', 2),
  })
  expect(blits[1]).toEqual({
    requestId: 'crew-office',
    key: 'desk-test-runner',
    cells: cellsOf('test-runner', 'working', 3),
  })
})

test('two working desks blit one raster each per tick', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:implementer')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(500)
  await ui.unmount()

  expect(blits.map(one => one.key).sort()).toEqual([
    'desk-implementer',
    'desk-test-runner',
  ])
})

for (const [name, surface, bodyColumns] of [
  ['never rendered', undefined, 0],
  ['rendered as the text list on a narrow terminal', 'terminal', 17],
  ['rendered on the desktop', 'desktop', 54],
] as const) {
  test(`a working desk draws no blit when the pane is ${name}`, async ($, on) => {
    const { blits, clock } = world(on)
    await spawn($, 'crew:test-runner')
    const ui =
      surface === undefined ? undefined : await mountPane($, surface, bodyColumns)

    await clock.advance(2000)
    await ui?.unmount()

    expect(blits).toHaveLength(0)
  })
}

test('a refused blit asks for one redraw and stops blitting until the pane renders again', async ($, on) => {
  const { blits, invalidations, clock } = world(on, {
    blitDeny: 'gone',
    captureInvalidate: true,
  })
  await spawn($, 'crew:test-runner')
  const first = await mountPane($, 'terminal', 54)

  await clock.advance(500)
  expect(blits).toHaveLength(1)
  expect(invalidations).toEqual([{ event: 'ui.render' }])

  await clock.advance(5000)
  expect(blits).toHaveLength(1)
  expect(invalidations).toHaveLength(1)
  await first.unmount()

  const second = await mountPane($, 'terminal', 54)
  await clock.advance(500)
  await second.unmount()

  expect(blits).toHaveLength(2)
})

test('the last working desk finishing stops the blits', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)
  await clock.advance(1000)
  expect(blits).toHaveLength(2)

  await finishTurn($, 'answer', 'a1')
  const settled = blits.length
  await clock.advance(3000)
  await ui.unmount()

  expect(blits).toHaveLength(settled)
})

test('a desk still working after one of two finishes keeps blitting', async ($, on) => {
  const { blits, clock } = world(on)
  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  const ui = await mountPane($, 'terminal', 54)

  await finishTurn($, 'answer', 'a1')
  const settled = blits.length
  await clock.advance(500)
  await ui.unmount()

  expect(blits).toHaveLength(settled + 1)
})

test('after a reload, a stored working desk blits again from the first tick', async ($, on) => {
  const { blits, clock } = world(on)
  seedOffice(on, {
    desks: { 'test-runner': { agentIds: ['a1'] } },
    deskOf: { a1: 'test-runner' },
  })

  await $.session.start(SESSION)
  const ui = await mountPane($, 'terminal', 54)
  await clock.advance(500)
  await ui.unmount()

  expect(blits).toEqual([
    {
      requestId: 'crew-office',
      key: 'desk-test-runner',
      cells: cellsOf('test-runner', 'working', 2),
    },
  ])
})

// The agent list is asked every 2000 ms while something works.

test('while a desk works the agent list is asked once per 2000 ms', async ($, on) => {
  const { clock, listCalls } = world(on, {
    agents: [agent('a1', 'crew:test-runner', 'running')],
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(1999)
  expect(listCalls()).toBe(0)

  await clock.advance(1)
  expect(listCalls()).toBe(1)

  await clock.advance(2000)
  expect(listCalls()).toBe(2)
})

for (const [status, shown] of [
  ['completed', 'done'],
  ['failed', 'failed'],
  ['killed', 'failed'],
  ['running', 'working'],
  ['idle', 'working'],
  ['pending', 'working'],
  ['waiting', 'working'],
] as const) {
  test(`an agent the list reports ${status} puts its desk in ${shown}`, async ($, on) => {
    const { clock } = world(on, {
      agents: [agent('a1', 'crew:test-runner', status)],
    })
    await spawn($, 'crew:test-runner')

    await clock.advance(2000)
    await clock.settle()

    await expectRows($, {
      'test-runner': status === 'completed' ? '1 · done' : shown,
    })
  })
}

test('an agent absent from the list leaves its desk working', async ($, on) => {
  const { clock } = world(on, { agents: [] })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)
  await clock.settle()

  await expectRows($, { 'test-runner': 'working' })
})

test('a listed finished agent does not end its desk while another agent of it runs', async ($, on) => {
  const { clock } = world(on, {
    agents: [
      agent('a1', 'crew:implementer', 'completed'),
      agent('a2', 'crew:implementer', 'running'),
    ],
  })
  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')

  await clock.advance(2000)
  await clock.settle()

  expect(await rowsOn($, 'terminal')).toEqual([
    'manager: idle',
    'test-runner: idle',
    'researcher: idle',
    'debugger: idle',
    'architect: idle',
    'test-engineer: idle',
    'implementer: 1 · working',
    'reviewer: idle',
    'guest: idle',
    'advisor: idle',
  ])
})

test('the manager desk shows the working look during its own turn',async ($, on) => {
  world(on)

  await startTurn($)

  const ui = await mountPane($, 'terminal', 54)
  const found = await rasters(ui)
  await ui.unmount()

  expect(found).toHaveLength(9)
  expect(found[0].props.cells).toBe(cellsOf('manager', 'working', 0))
})
