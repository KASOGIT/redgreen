import { expect, test } from 'claude-code/testing'

import {
  agentInfo,
  expectedRows,
  finishTurn,
  headerOf,
  mountPane,
  seedOffice,
  sessionUsage,
  spawn,
  startTurn,
  statusOf,
  useToolWith,
  world,
} from './kit'

// Spec, S2 texts: the status line under each desk, the header above the
// desks, and the status line fallback while the pane is not placed. Every
// expected string below is the spec's literal or counted out by hand.

const ALL = Array.from({ length: 14 }, (_, i) => `a${i + 1}`)
const listed = (isPlaced: boolean) => [
  { id: 'crew-office', title: 'Crew office', isShown: isPlaced, isFocused: false, isPlaced },
]

// The status line of one desk, as a 54 by 40 pane draws it (scale 1).
const status = async ($: any, slot: string, bodyColumns = 54, bodyRows = 40) => {
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
  const text = await statusOf(ui, slot)
  await ui.unmount()

  return text
}

const header = async ($: any, bodyColumns = 54, bodyRows = 40) => {
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
  const text = await headerOf(ui)
  await ui.unmount()

  return text
}

const run = async ($: any, type: string, reason: 'answer' | 'error' = 'answer') => {
  const { agentId } = await spawn($, type)
  await finishTurn($, reason, agentId)

  return agentId as string
}

// The desk status line

test('a working desk shows its tool and the target of the call', async ($, on) => {
  world(on)

  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a1')

  expect(await status($, 'implementer')).toBe('Edit model.ts')
})

test('a count of 2 and a long target cut the status line to the desk width with an ellipsis', async ($, on) => {
  world(on, { ids: ALL })

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a3')

  expect(await status($, 'implementer')).toBe('2 · Edit model.…')
})

test('a status line of exactly 16 characters is not cut at scale 1', async ($, on) => {
  world(on)

  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/a/abcdefghijk' }, 'a1')

  expect(await status($, 'implementer')).toBe('Edit abcdefghijk')
})

test('the status line is cut at 16 at scale 1 and at 32 at scale 2', async ($, on) => {
  world(on, { ids: ALL })

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await useToolWith(
    $,
    'Edit',
    { file_path: '/a/abcdefghijklmnopqrstuvwx' },
    'a3',
  )

  expect(await status($, 'implementer')).toBe('2 · Edit abcdef…')
  expect(await status($, 'implementer', 100, 80)).toBe(
    '2 · Edit abcdefghijklmnopqrstuv…',
  )
})

test('a status line that fits is not cut at scale 2', async ($, on) => {
  world(on, { ids: ALL })

  await run($, 'crew:implementer')
  await run($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a3')

  expect(await status($, 'implementer', 100, 80)).toBe('2 · Edit model.ts')
})

test('a desk whose agent waits shows waiting, whatever its tool', async ($, on) => {
  const { clock } = world(on, {
    agents: [agentInfo('a1', 'crew:test-runner', 'waiting')],
  })

  await spawn($, 'crew:test-runner')
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a1')
  expect(await status($, 'test-runner')).toBe('Edit model.ts')

  await clock.advance(2000)
  await clock.settle()

  expect(await status($, 'test-runner')).toBe('waiting')
})

test('a done mark shows done and the time the turn took', async ($, on) => {
  world(on)

  await startTurn($)
  await finishTurn($, 'answer', undefined, 134000)

  expect(await status($, 'manager')).toBe('done 2m14s')
})

test('a counted desk puts its count before the done outcome', async ($, on) => {
  world(on)

  const { agentId } = await spawn($, 'crew:code-reviewer')
  await finishTurn($, 'answer', agentId, 45000)

  expect(await status($, 'code-reviewer')).toBe('1 · done 45s')
})

test('a done mark that ends reads idle again, with no outcome left', async ($, on) => {
  const { clock } = world(on)

  await startTurn($)
  await finishTurn($, 'answer', undefined, 134000)
  await clock.advance(5000)

  expect(await status($, 'manager')).toBe('idle')
})

test('a refused turn shows refused', async ($, on) => {
  world(on)

  const { agentId } = await spawn($, 'crew:test-runner')
  await finishTurn($, 'refusal', agentId)

  expect(await status($, 'test-runner')).toBe('refused')
})

test('a turn that errors shows error', async ($, on) => {
  world(on)

  await run($, 'crew:test-runner', 'error')

  expect(await status($, 'test-runner')).toBe('error')
})

for (const ended of ['failed', 'killed'] as const) {
  test(`an agent the poll finds ${ended} leaves a failed mark with the text failed`, async ($, on) => {
    const { clock } = world(on, {
      agents: [agentInfo('a1', 'crew:test-runner', ended)],
    })

    await spawn($, 'crew:test-runner')
    await clock.advance(2000)
    await clock.settle()

    expect(await status($, 'test-runner')).toBe('failed')
  })
}

test('a desk with nothing to show reads idle', async ($, on) => {
  world(on)

  expect(await status($, 'guest', 54, 53)).toBe('idle')
})

// The header

// Two agents working on crew desks, the manager working too, one run done.
const OFFICE = {
  desks: {
    manager: { agentIds: ['main'] },
    'test-runner': { agentIds: ['a1'] },
    implementer: { agentIds: ['a2'] },
    'code-reviewer': { agentIds: [], count: 1 },
  },
  deskOf: { main: 'manager', a1: 'test-runner', a2: 'implementer' },
}

for (const [name, usage, bodyColumns, want] of [
  ['54 columns', { percent: 41, usd: 0.4 }, 54, '2 working · 1 done · ctx 41% · ~$0.40'],
  ['30 columns drops the cost', { percent: 41, usd: 0.4 }, 30, '2 working · 1 done · ctx 41%'],
  ['25 columns drops the context too', { percent: 41, usd: 0.4 }, 25, '2 working · 1 done'],
  ['the cost to two decimals', { percent: 41, usd: 12.3 }, 54, '2 working · 1 done · ctx 41% · ~$12.30'],
  ['a cost of 0', { percent: 41, usd: 0 }, 54, '2 working · 1 done · ctx 41%'],
  ['no cost', { percent: 41 }, 54, '2 working · 1 done · ctx 41%'],
  ['no usage', undefined, 54, '2 working · 1 done'],
] as const) {
  test(`the header at scale 1, ${name}, reads ${want}`, async ($, on) => {
    world(on)
    seedOffice(on, { ...OFFICE, ...(usage === undefined ? {} : { usage }) })

    expect(await header($, bodyColumns)).toBe(want)
  })
}

test('the header at scale 2 reads the same', async ($, on) => {
  world(on)
  seedOffice(on, { ...OFFICE, usage: { percent: 41, usd: 0.4 } })

  expect(await header($, 100, 80)).toBe('2 working · 1 done · ctx 41% · ~$0.40')
})

test('the header is the first text of the pane, at both scales', async ($, on) => {
  world(on)
  seedOffice(on, { ...OFFICE, usage: { percent: 41, usd: 0.4 } })

  for (const [bodyColumns, bodyRows] of [[54, 40], [100, 80]]) {
    const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
    const first = (await ui.findAll({ type: 'Text' }))[0]
    const head = await headerOf(ui)
    await ui.unmount()

    expect(head).toBeDefined()
    expect(first.text).toBe(head)
  }
})

test('the manager alone is not counted as working', async ($, on) => {
  world(on)
  seedOffice(on, {
    desks: { manager: { agentIds: ['main'] } },
    deskOf: { main: 'manager' },
  })

  expect(await header($)).toBe('0 working · 0 done')
})

test('the header follows the poll: agents on crew desks, finished runs, usage and cost', async ($, on) => {
  const { clock } = world(on, {
    agents: [
      agentInfo('a1', 'crew:test-runner', 'running'),
      agentInfo('a2', 'crew:implementer', 'running'),
    ],
    usage: sessionUsage(41, 0.4),
  })

  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:implementer')
  await run($, 'crew:code-reviewer')
  await startTurn($)
  await clock.advance(2000)
  await clock.settle()

  expect(await header($)).toBe('2 working · 1 done · ctx 41% · ~$0.40')
})

// The text list keeps today's rows, with no header and no status keys.

for (const [name, surface, bodyColumns, placement] of [
  ['a desktop pane', 'desktop', 54, 'dock'],
  ['a mobile pane', 'mobile', 54, 'dock'],
  ['a terminal narrower than 18 columns', 'terminal', 17, 'dock'],
  ['a terminal widget', 'terminal', 54, 'widget'],
] as const) {
  test(`${name} keeps the text list: no header, no outcome, no target`, async ($, on) => {
    world(on)
    seedOffice(on, {
      desks: {
        manager: { agentIds: [], mark: 'done', until: 99999, outcome: '2m14s' },
        implementer: { agentIds: ['a2'], tool: 'Edit', target: 'model.ts', count: 2 },
        'code-reviewer': { agentIds: [], mark: 'failed', until: 99999, outcome: 'error' },
      },
      deskOf: { a2: 'implementer' },
      usage: { percent: 41, usd: 0.4 },
    })

    const ui = await mountPane($, surface, bodyColumns, placement)
    const texts = (await ui.findAll({ type: 'Text' })).map((one: any) => one.text)
    const keyed = await ui.findAll({ type: 'Box', key: 'header' })
    await ui.unmount()

    expect(texts).toEqual(
      expectedRows({
        manager: 'done',
        implementer: '2 · working Edit',
        reviewer: 'failed',
      }),
    )
    expect(keyed).toHaveLength(0)
  })
}

// The status line fallback

for (const [name, panes] of [
  ['no pane is listed', []],
  ['the pane is listed and not placed', listed(false)],
] as const) {
  test(`while ${name}, a working crew says so on the status line`, async ($, on) => {
    const { clock, statuses } = world(on, { panes: [...panes] })

    await spawn($, 'crew:test-runner')
    await spawn($, 'crew:implementer')
    const { agentId } = await spawn($, 'crew:code-reviewer')
    await finishTurn($, 'answer', agentId)
    await clock.settle()

    expect(statuses.at(-1)).toBe('crew: 2 working · 1 done')
  })
}

test('a placed pane never sets the status line', async ($, on) => {
  const { clock, statuses } = world(on, { panes: listed(true) })

  await spawn($, 'crew:test-runner')
  await useToolWith($, 'Edit', {}, 'a1')
  await clock.advance(2000)
  await clock.settle()

  expect(statuses.filter(one => one !== undefined)).toEqual([])
})

test('the status line is cleared once the pane is placed', async ($, on) => {
  let isPlaced = false
  const { clock, statuses } = world(on, { panes: () => listed(isPlaced) })

  await spawn($, 'crew:test-runner')
  await clock.settle()
  expect(statuses.at(-1)).toBe('crew: 1 working · 0 done')

  isPlaced = true
  await useToolWith($, 'Edit', {}, 'a1')
  await clock.advance(2000)
  await clock.settle()

  expect(statuses.at(-1)).toBeUndefined()
  expect(statuses.length).toBeGreaterThan(1)
})

test('the status line is cleared when no agent is alive', async ($, on) => {
  const { clock, statuses } = world(on)

  const { agentId } = await spawn($, 'crew:test-runner')
  await clock.settle()
  expect(statuses.at(-1)).toBe('crew: 1 working · 0 done')

  await finishTurn($, 'answer', agentId)
  await clock.settle()

  expect(statuses.at(-1)).toBeUndefined()
})

test('with the office off the status line is never set', async ($, on) => {
  const { clock, statuses } = world(on, { auto: false })

  await spawn($, 'crew:test-runner')
  await useToolWith($, 'Edit', {}, 'a1')
  await clock.advance(2000)
  await clock.settle()

  expect(statuses.filter(one => one !== undefined)).toEqual([])
})

test('a status line that throws changes no hook answer and loses no state', async ($, on) => {
  const ANSWER = { result: { ok: true } }
  const { clock, statuses } = world(on, { statusThrows: true, toolAnswer: ANSWER })

  const spawned = await spawn($, 'crew:test-runner')
  const tool = await useToolWith($, 'Edit', {}, 'a1')
  const done = await finishTurn($, 'answer', 'a1')
  await clock.settle()

  expect(statuses.length).toBeGreaterThan(0)
  expect(spawned).toEqual({ model: 'm', agentId: 'a1' })
  expect(tool).toEqual(ANSWER)
  expect(done).toEqual({ text: '' })
  expect(await status($, 'test-runner')).toBe('1 · done 0s')
})

test('a status line that hangs does not hold up a hook', async ($, on) => {
  const { clock, statuses } = world(on, { statusHangs: true })
  let out: unknown

  void spawn($, 'crew:test-runner').then((answer: unknown) => {
    out = answer
  })
  await clock.advance(1000)

  expect(statuses.length).toBeGreaterThan(0)
  expect(out).toEqual({ model: 'm', agentId: 'a1' })
})

test('a pane list that throws changes no hook answer', async ($, on) => {
  const { clock } = world(on, {
    panes: () => {
      throw new Error('no panes')
    },
  })

  const spawned = await spawn($, 'crew:test-runner')
  const done = await finishTurn($, 'answer', 'a1')
  await clock.settle()

  expect(spawned).toEqual({ model: 'm', agentId: 'a1' })
  expect(done).toEqual({ text: '' })
  expect(await status($, 'test-runner')).toBe('1 · done 0s')
})
