import { expect, test } from 'claude-code/testing'

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

// Spec: a desk counts the subagent runs that ended done, and shows the count as
// `N · ` before its status once it is 1 or more. The persisted field is `count`.

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const MANY = Array.from({ length: 14 }, (_, i) => `a${i + 1}`)

const agent = (id: string, type: string, status: string) => ({
  id,
  type,
  description: 'd',
  status,
})

// Spawns one agent on the desk of `type` and ends it with `reason`.
const run = async (
  $: any,
  type: string,
  reason: 'answer' | 'error' | 'refusal' | 'aborted' = 'answer',
) => {
  const { agentId } = await spawn($, type)
  await finishTurn($, reason, agentId)

  return agentId as string
}

// The short status line the pixel layout draws under a desk label.
const pixelStatus = async ($: any, label: string) => {
  const slot = DESKS.find(([, name]) => name === label)![0]
  const ui = await mountPane($, 'terminal', 54)
  const status = await statusOf(ui, slot)
  await ui.unmount()

  return status as string
}

const pixelTexts = async ($: any) => {
  const ui = await mountPane($, 'terminal', 54)
  const texts = await deskTexts(ui)
  await ui.unmount()

  return texts
}

// A success counts, and the count prefixes the status.

test('a successful run shows 1 · done, then 1 · idle after 5000 ms', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer')
  await expectRows($, { implementer: '1 · done' })

  await clock.advance(4999)
  expect(await rowsOn($, 'terminal')).toContain('implementer: 1 · done')

  await clock.advance(1)
  await expectRows($, { implementer: '1 · idle' })
})

test('three successful runs show 3 · done, then 3 · idle', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await expectRows($, { implementer: '3 · done' })

  await clock.advance(5000)
  await expectRows($, { implementer: '3 · idle' })
})

test('the count prefixes the text of a working desk, with its tool', async ($, on) => {
  world(on)

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await expectRows($, { implementer: '2 · working' })

  await useTool($, 'Bash', 'a3')
  await expectRows($, { implementer: '2 · working Bash' })
})

test('the count prefixes the text of a crowded desk', async ($, on) => {
  world(on)

  await run($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')

  await expectRows($, { implementer: '1 · working x2' })
})

test('a run that fails after a success shows 1 · failed, then 1 · idle', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer')
  await run($, 'crew:implementer', 'error')
  await expectRows($, { implementer: '1 · failed' })

  await clock.advance(5000)
  await expectRows($, { implementer: '1 · idle' })
})

test('a desk that never succeeded keeps its text without a prefix', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer', 'error')
  await expectRows($, { implementer: 'failed' })

  await clock.advance(5000)
  await expectRows($)
})

test('each desk counts on its own', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer')
  await run($, 'crew:test-runner')
  await run($, 'crew:test-runner')
  await run($, 'crew:test-runner')
  await run($, 'some:unknown-type')
  await clock.advance(5000)

  await expectRows($, {
    implementer: '1 · idle',
    'test-runner': '3 · idle',
    guest: '1 · idle',
  })
})

test('a run the agent list reports completed counts once', async ($, on) => {
  const { clock } = world(on, {
    agents: [agent('a1', 'crew:implementer', 'completed')],
  })
  await spawn($, 'crew:implementer')

  await clock.advance(2000)
  await clock.settle()

  await expectRows($, { implementer: '1 · done' })
})

// Failures and aborts do not count.

for (const reason of ['error', 'refusal'] as const) {
  test(`a ${reason} after a success leaves the count at 1`, async ($, on) => {
    const { clock } = world(on)

    await run($, 'crew:test-runner')
    await run($, 'crew:test-runner', reason)
    await clock.advance(5000)

    await expectRows($, { 'test-runner': '1 · idle' })
  })
}

test('an aborted run after a success leaves the count at 1 and the desk idle', async ($, on) => {
  world(on)

  await run($, 'crew:test-runner')
  await run($, 'crew:test-runner', 'aborted')

  await expectRows($, { 'test-runner': '1 · idle' })
})

test('a refusal on a fresh desk shows failed with no count', async ($, on) => {
  world(on)

  await run($, 'crew:test-runner', 'refusal')

  await expectRows($, { 'test-runner': 'failed' })
})

for (const status of ['failed', 'killed'] as const) {
  test(`a run the agent list reports ${status} after a success leaves the count at 1`, async ($, on) => {
    const { clock } = world(on, {
      agents: [agent('a2', 'crew:test-runner', status)],
    })
    await run($, 'crew:test-runner')
    await spawn($, 'crew:test-runner')

    await clock.advance(2000)
    await clock.settle()

    await expectRows($, { 'test-runner': `1 · failed` })
  })
}

// The manager never counts.

test('the manager desk never counts: it stays done, then idle', async ($, on) => {
  const { clock } = world(on)

  for (let turn = 0; turn < 3; turn += 1) {
    await startTurn($)
    await finishTurn($, 'answer')
  }
  await expectRows($, { manager: 'done' })
  expect(await pixelStatus($, 'manager')).toBe('done 0s')

  await clock.advance(5000)
  await expectRows($)
  expect(await pixelStatus($, 'manager')).toBe('idle')
})

// Shared desks, and one completion seen twice.

test('a desk counts a run at once while another agent of it still works', async ($, on) => {
  world(on)

  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await finishTurn($, 'answer', 'a1')

  await expectRows($, { implementer: '1 · working' })

  await finishTurn($, 'answer', 'a2')
  await expectRows($, { implementer: '2 · done' })
})

test('a completion reported by the turn and then seen by the poll counts once', async ($, on) => {
  const { clock } = world(on, {
    agents: [
      agent('a1', 'crew:implementer', 'completed'),
      agent('a2', 'crew:implementer', 'running'),
    ],
  })
  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await finishTurn($, 'answer', 'a1')

  await clock.advance(2000)
  await clock.settle()
  await expectRows($, { implementer: '1 · working' })

  await finishTurn($, 'answer', 'a2')
  await expectRows($, { implementer: '2 · done' })
})

test('a completion seen by the poll and then reported by the turn counts once', async ($, on) => {
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
  await expectRows($, { implementer: '1 · working' })

  await finishTurn($, 'answer', 'a1')
  await expectRows($, { implementer: '1 · working' })

  await finishTurn($, 'answer', 'a2')
  await expectRows($, { implementer: '2 · done' })
})

test('a resumed agent that ends done counts again', async ($, on) => {
  const { clock } = world(on)

  await spawn($, 'crew:implementer')
  await finishTurn($, 'answer', 'a1')
  await expectRows($, { implementer: '1 · done' })

  await startTurn($, 'a1')
  await expectRows($, { implementer: '1 · working' })

  await finishTurn($, 'answer', 'a1')
  await expectRows($, { implementer: '2 · done' })

  await clock.advance(5000)
  await expectRows($, { implementer: '2 · idle' })
})

// The pixel layout.

test('the short status carries the count in every state', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer')
  expect(await pixelStatus($, 'implementer')).toBe('1 · done 0s')

  await clock.advance(5000)
  expect(await pixelStatus($, 'implementer')).toBe('1 · idle')

  await spawn($, 'crew:implementer')
  expect(await pixelStatus($, 'implementer')).toBe('1 · working')

  await useToolWith($, 'Bash', {}, 'a2')
  expect(await pixelStatus($, 'implementer')).toBe('1 · Bash')

  await spawn($, 'crew:implementer')
  expect(await pixelStatus($, 'implementer')).toBe('1 · x2 Bash')

  await finishTurn($, 'answer', 'a2')
  await finishTurn($, 'error', 'a3')
  expect(await pixelStatus($, 'implementer')).toBe('2 · error')
})

test('a count of 2 shows 2 · Bash while the desk works with Bash', async ($, on) => {
  world(on)

  await run($, 'crew:code-reviewer')
  await run($, 'crew:code-reviewer')
  await spawn($, 'crew:code-reviewer')
  await useTool($, 'Bash', 'a3')

  expect(await pixelStatus($, 'reviewer')).toBe('2 · Bash ls')
})

test('a desk with no success keeps the short status it had', async ($, on) => {
  world(on)

  await spawn($, 'crew:implementer')
  await useTool($, 'Bash', 'a1')

  expect(await pixelStatus($, 'implementer')).toBe('Bash ls')
})

test('the short status is cut to 16 characters with an ellipsis, with a count of 12 and a long tool', async ($, on) => {
  world(on, { ids: MANY })

  for (let i = 0; i < 12; i += 1) await run($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await useTool($, 'abcdefghijklmnopqrstuvwxyz', 'a13')

  const status = await pixelStatus($, 'implementer')
  expect(status).toBe('12 · abcdefghij…')
})

// The text rows.

test('the text rows read <label>: <count> · <status> on every surface', async ($, on) => {
  const { clock } = world(on)

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await clock.advance(5000)

  await expectRows($, { implementer: '3 · idle' })
})

// The count is persisted.

test('the count is written to the stored office and survives the mark expiry', async ($, on) => {
  const { clock } = world(on)
  const { stored } = seedOffice(on, { desks: {}, deskOf: {} })

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  expect(stored().desks.implementer.count).toBe(2)

  await clock.advance(5000)
  await clock.settle()

  expect(stored().desks.implementer.count).toBe(2)
  await expectRows($, { implementer: '2 · idle' })
})

test('a stored count shows after a reload, with its mark and its expiry', async ($, on) => {
  const { clock } = world(on)
  seedOffice(on, {
    desks: {
      implementer: { agentIds: [], count: 3 },
      'test-runner': { agentIds: [], count: 2, mark: 'done', until: 4000 },
    },
    deskOf: {},
  })

  await $.session.start(SESSION)
  await expectRows($, { implementer: '3 · idle', 'test-runner': '2 · done' })

  await clock.advance(3000)
  await clock.settle()

  await expectRows($, { implementer: '3 · idle', 'test-runner': '2 · idle' })
})

test('a stored count keeps counting after a reload', async ($, on) => {
  world(on)
  const { stored } = seedOffice(on, {
    desks: { implementer: { agentIds: [], count: 3 } },
    deskOf: {},
  })

  await $.session.start(SESSION)
  await run($, 'crew:implementer')

  await expectRows($, { implementer: '4 · done' })
  expect(stored().desks.implementer.count).toBe(4)
})

// State written before the count existed.

test('a stored desk with no count shows its status with no prefix and no undefined', async ($, on) => {
  world(on)
  seedOffice(on, {
    desks: {
      manager: { agentIds: [], mark: 'done', until: 99999 },
      implementer: { agentIds: [] },
      'test-runner': { agentIds: ['a1'], tool: 'Bash' },
      'code-reviewer': { agentIds: [], mark: 'done', until: 1 },
    },
    deskOf: { a1: 'test-runner' },
  })

  await expectRows($, {
    manager: 'done',
    'test-runner': 'working Bash',
  })
  const texts = await pixelTexts($)
  expect(texts).toEqual([
    'manager', 'done',
    'test-runner', 'Bash',
    'researcher', 'idle',
    'debugger', 'idle',
    'architect', 'idle',
    'test-engineer', 'idle',
    'implementer', 'idle',
    'reviewer', 'idle',
    'advisor', 'idle',
  ])
})

test('a run that ends on a desk stored with no count counts from zero', async ($, on) => {
  world(on)
  seedOffice(on, {
    desks: { implementer: { agentIds: ['a1'] } },
    deskOf: { a1: 'implementer' },
  })

  await finishTurn($, 'answer', 'a1')

  await expectRows($, { implementer: '1 · done' })
})

// A new or cleared session starts the counts over. The source rides the
// classic SessionStart hook; the native session.start event carries none.

// The bottom of the classic hook, registered before the test first calls `$`.
const classicBottom = (on: any) => on('classic.SessionStart', () => ({}))

const sessionStart = async ($: any, source: string) => {
  await $.classic.SessionStart({ source })
}

const idleAtThree = (on: any) =>
  seedOffice(on, {
    desks: { implementer: { agentIds: [], count: 3 } },
    deskOf: {},
  })

for (const source of ['startup', 'clear'] as const) {
  test(`a ${source} session sets every count to zero`, async ($, on) => {
    world(on)
    classicBottom(on)
    const { stored } = idleAtThree(on)
    await expectRows($, { implementer: '3 · idle' })

    await sessionStart($, source)

    await expectRows($)
    expect(
      Object.values(stored().desks).every(
        (desk: any) => (desk.count ?? 0) === 0,
      ),
    ).toBe(true)
  })
}

for (const source of ['resume', 'compact', 'fork'] as const) {
  test(`a ${source} session keeps the counts`, async ($, on) => {
    world(on)
    classicBottom(on)
    idleAtThree(on)

    await sessionStart($, source)

    await expectRows($, { implementer: '3 · idle' })
  })
}

test('the native session.start event, with no source, keeps the counts', async ($, on) => {
  world(on)
  classicBottom(on)
  idleAtThree(on)

  await $.session.start(SESSION)

  await expectRows($, { implementer: '3 · idle' })
})

test('a reset touches only the counts', async ($, on) => {
  const { clock } = world(on)
  classicBottom(on)
  const { stored } = seedOffice(on, {
    desks: {
      implementer: { agentIds: ['a1'], tool: 'Bash', count: 2 },
      'test-runner': { agentIds: [], count: 4, mark: 'done', until: 6000 },
    },
    deskOf: { a1: 'implementer' },
  })
  await expectRows($, {
    implementer: '2 · working Bash',
    'test-runner': '4 · done',
  })

  await sessionStart($, 'clear')

  await expectRows($, { implementer: 'working Bash', 'test-runner': 'done' })
  expect(stored()).toEqual({
    desks: {
      implementer: { agentIds: ['a1'], tool: 'Bash' },
      'test-runner': { agentIds: [], mark: 'done', until: 6000 },
    },
    deskOf: { a1: 'implementer' },
  })

  await clock.advance(5000)
  await clock.settle()
  await expectRows($, { implementer: 'working Bash' })
})

test('after a reset, counting starts again from zero', async ($, on) => {
  world(on)
  classicBottom(on)
  idleAtThree(on)

  await sessionStart($, 'startup')
  await run($, 'crew:implementer')

  await expectRows($, { implementer: '1 · done' })
})
