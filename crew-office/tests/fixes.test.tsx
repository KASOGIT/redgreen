import { expect, test } from 'claude-code/testing'

import {
  DESKS,
  agentInfo,
  buttonText,
  buttonsOf,
  deferred,
  finishTurn,
  hangState,
  mountPane,
  seedOffice,
  spawn,
  startTurn,
  statusOf,
  taskOf,
  useTool,
  useToolWith,
  world,
} from './kit'
import type { WorldOptions } from './kit'

// Review fixes R1 to R14 (R13 is not part of this round). Every expected value
// is the spec's literal or counted out by hand; hangs are checked by the answer
// reaching the caller after a bounded clock advance.

const EMPTY = { desks: {}, deskOf: {} }
const SUMMARY = 'crew: 1 working · 0 done'

const started = (on: any, options: WorldOptions = {}) => {
  const w = world(on, options)

  return { ...w, ...seedOffice(on, EMPTY) }
}

// R1 ------------------------------------------------------------------

for (const [name, bodyRows] of [
  ['tall', 40],
  ['short', 24],
] as const) {
  test(`R1 ${name} pane: every desk label is a plain Button with the desk hotkey and the label alone, and "<hotkey>: <label>" fits 16 columns`, async ($, on) => {
    world(on)

    const ui = await mountPane($, 'terminal', 54, 'dock', bodyRows)
    const all = await buttonsOf(ui)
    await ui.unmount()

    expect(all.map((one: any) => one.props.plain)).toEqual(all.map(() => true))
    expect(all.length).toBeGreaterThan(0)
    for (const one of all) {
      const label = buttonText(one)
      const slot = String(one.key ?? one.props.key).replace(/^view-/, '')
      const at = DESKS.findIndex(([name]) => name === slot)
      expect(one.props.hotkey).toBe(String(at))
      expect(label).toBe(DESKS[at]![1])
      expect(`${one.props.hotkey}: ${label}`.length).toBeLessThanOrEqual(16)
    }
  })
}

test('R1 the longest label draws as "5: test-engineer", 16 columns', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const engineer = (await buttonsOf(ui)).find(
    (one: any) => (one.key ?? one.props.key) === 'view-test-engineer',
  )
  await ui.unmount()

  expect(`${engineer.props.hotkey}: ${buttonText(engineer)}`).toBe('5: test-engineer')
  expect('5: test-engineer'.length).toBe(16)
})

// R2: tick.test.tsx also asserts the first test after the second tick. ---

test('R2 four working desks in 54 by 16: one invalidate after the first tick and none after the second, third and fourth', async ($, on) => {
  const { invalidations, clock } = world(on, { captureInvalidate: true })
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')
  await spawn($, 'crew:debugger-analyst')
  await spawn($, 'crew:architecture-planner')
  const ui = await mountPane($, 'terminal', 54, 'dock', 16)

  await clock.advance(500)
  expect(invalidations).toHaveLength(1)
  await clock.advance(500)
  expect(invalidations).toHaveLength(1)
  await clock.advance(500)
  expect(invalidations).toHaveLength(1)
  await clock.advance(500)
  expect(invalidations).toHaveLength(1)
  await ui.unmount()
})

test('R2 a change of the undrawn set causes one more invalidate, and then no more', async ($, on) => {
  const { invalidations, clock } = world(on, { captureInvalidate: true })
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')
  await spawn($, 'crew:debugger-analyst')
  await spawn($, 'crew:architecture-planner')
  const ui = await mountPane($, 'terminal', 54, 'dock', 16)
  await clock.advance(1000)
  expect(invalidations).toHaveLength(1)

  await spawn($, 'other:custom')
  await clock.settle()
  const before = invalidations.length
  await clock.advance(500)
  expect(invalidations).toHaveLength(before + 1)

  await clock.advance(1000)
  await ui.unmount()
  expect(invalidations).toHaveLength(before + 1)
})

// R3 ------------------------------------------------------------------

// A poll left in flight on its second round: the list answers when the test
// says so. The first poll (at 2000 ms) answers at once and merges the notes,
// so the raced poll changes nothing in the state it read.
const racedPoll = async (
  $: any,
  on: any,
  type: string,
  raced: (id: string) => unknown[],
  options: WorldOptions = {},
) => {
  const gate = deferred<unknown[]>()
  let isHeld = false
  const w = world(on, {
    ...options,
    list: () => (isHeld ? gate.promise : [agentInfo('a1', type, 'running')]),
  })
  const office = seedOffice(on, EMPTY)
  await spawn($, type)
  await w.clock.advance(2000)
  await w.clock.settle()
  isHeld = true
  await w.clock.advance(2000)
  expect(w.listCalls()).toBe(2)

  return {
    ...w,
    ...office,
    land: async () => {
      gate.resolve(raced('a1'))
      await w.clock.settle()
    },
  }
}

test('R3a the last agent finishes while the poll is in flight and the list still says running: no ticker restarts, no further list call, the status line is not set again', async ($, on) => {
  const w = await racedPoll($, on, 'crew:test-runner', () => [
    agentInfo('a1', 'crew:test-runner', 'running'),
  ])
  expect(w.statuses).toEqual([SUMMARY])
  await finishTurn($, 'answer', 'a1')
  await w.clock.settle()
  expect(w.statuses).toEqual([SUMMARY, undefined])

  await w.land()
  const asked = w.listCalls()
  await w.clock.advance(10000)
  await w.clock.settle()

  expect(w.listCalls()).toBe(asked)
  expect(w.statuses).toEqual([SUMMARY, undefined])
})

test('R3b a desk marked failed refused by the turn keeps mark failed and outcome refused when the late poll lists that agent completed', async ($, on) => {
  const w = await racedPoll($, on, 'crew:test-runner', () => [
    agentInfo('a1', 'crew:test-runner', 'completed'),
  ])
  await finishTurn($, 'refusal', 'a1')

  await w.land()

  const desk = w.stored().desks['test-runner']
  expect(desk.mark).toBe('failed')
  expect(desk.outcome).toBe('refused')
  expect(desk.count ?? 0).toBe(0)
  const ui = await mountPane($, 'terminal', 54)
  expect(await statusOf(ui, 'test-runner')).toBe('refused')
  await ui.unmount()
})

// R4 ------------------------------------------------------------------

test('R4 a session.usage that never answers does not hold back the agent list: notes merge and a completed agent is finished on that poll', async ($, on) => {
  const { clock, stored } = started(on, {
    usageHangs: true,
    agents: [agentInfo('a1', 'crew:test-runner', 'completed', { label: 'L' })],
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)

  expect(stored().agents.a1.label).toBe('L')
  expect(stored().desks['test-runner'].mark).toBe('done')
  expect(stored().desks['test-runner'].count).toBe(1)
})

test('R4 a poll still in flight when the next one is due skips it: list calls do not pile up, and polling resumes once it answers', async ($, on) => {
  const gate = deferred<unknown[]>()
  let isHeld = true
  const { clock, listCalls } = world(on, {
    list: () => (isHeld ? gate.promise : [agentInfo('a1', 'crew:test-runner', 'running')]),
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)
  expect(listCalls()).toBe(1)
  await clock.advance(6000)
  expect(listCalls()).toBe(1)

  isHeld = false
  gate.resolve([agentInfo('a1', 'crew:test-runner', 'running')])
  await clock.settle()
  await clock.advance(2000)
  await clock.settle()

  expect(listCalls()).toBe(2)
})

// F1 ------------------------------------------------------------------

test('F1 a poll that never answers keeps later polls from overlapping for 10000 ms, then a new agent.list call is made', async ($, on) => {
  const { clock, listCalls } = world(on, { listHangs: true })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)
  expect(listCalls()).toBe(1)

  await clock.advance(9000)
  expect(listCalls()).toBe(1)

  await clock.advance(5000)
  expect(listCalls()).toBe(2)
})

// R5 ------------------------------------------------------------------

test('R5 an older in-flight status sync never re-pins a line a newer settle cleared', async ($, on) => {
  const gate = deferred<unknown[]>()
  let isSlow = false
  const { clock, statuses } = world(on, {
    panes: () => (isSlow ? gate.promise : []),
  })

  await spawn($, 'crew:test-runner')
  await clock.settle()
  expect(statuses).toEqual([SUMMARY])

  isSlow = true
  await useTool($, 'Bash', 'a1')
  await clock.settle()
  isSlow = false
  await finishTurn($, 'answer', 'a1')
  await clock.settle()
  gate.resolve([])
  await clock.settle()

  expect(statuses).toEqual([SUMMARY, undefined])
})

// R6 ------------------------------------------------------------------

const taskLine = async (on: any, $: any, note: Record<string, unknown>) => {
  seedOffice(on, {
    desks: { 'test-runner': { agentIds: ['a1'] } },
    deskOf: { a1: 'test-runner' },
    agents: { a1: note },
  })
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const lines = await taskOf(ui, 'test-runner')
  await ui.unmount()

  return lines?.[0]
}

test('R6 format characters in a label become spaces', async ($, on) => {
  world(on)

  expect(await taskLine(on, $, { label: 'a\u202eb\u200bc\ufeffd' })).toBe('a b c d')
})

test('R6 line and paragraph separators in a tool target become spaces', async ($, on) => {
  const { stored } = started(on)
  await spawn($, 'crew:implementer')

  await useToolWith($, 'Grep', { pattern: 'x\u2028y\u2029z' }, 'a1')

  expect(stored().desks.implementer.target).toBe('x y z')
})

test('R6 format and separator characters in a description, and in a target, become spaces when stored', async ($, on) => {
  const { stored } = started(on)

  await spawn($, 'crew:implementer', 'x‮y z​w')
  await useToolWith($, 'Edit', { file_path: '/a/b‮c d.ts' }, 'a1')

  expect(stored().agents.a1.desc).toBe('x y z w')
  expect(stored().desks.implementer.target).toBe('b c d.ts')
})

test('R6 wide characters count two columns: 9 Japanese characters (18 columns) are cut to 7 and an ellipsis in 16', async ($, on) => {
  world(on)

  expect(await taskLine(on, $, { label: '日本語テキストです。' })).toBe('日本語テキスト…')
})

test('R6 8 Japanese characters fill the 16 columns exactly and are not cut', async ($, on) => {
  world(on)

  expect(await taskLine(on, $, { label: '日本語テキストで' })).toBe('日本語テキストで')
})

test('R6 a surrogate pair is never split: 9 emoji are cut to 7 and an ellipsis', async ($, on) => {
  world(on)

  expect(await taskLine(on, $, { label: '🙂'.repeat(9) })).toBe(`${'🙂'.repeat(7)}…`)
})

test('R6 a cut that falls inside an emoji leaves the whole emoji out', async ($, on) => {
  world(on)

  expect(await taskLine(on, $, { label: `ab${'🙂'.repeat(8)}` })).toBe(`ab${'🙂'.repeat(6)}…`)
})

test('R6 the desk status counts columns too: "Edit " and 12 Japanese characters are cut to "Edit " and 5 and an ellipsis', async ($, on) => {
  world(on)
  seedOffice(on, EMPTY)
  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/x/日本語日本語日本語日本語' }, 'a1')

  const ui = await mountPane($, 'terminal', 54)
  const status = await statusOf(ui, 'implementer')
  await ui.unmount()

  expect(status).toBe('Edit 日本語日本…')
})

test('R6 a stored target cut to its limit never ends on half an emoji', async ($, on) => {
  const { stored } = started(on)
  await spawn($, 'crew:implementer')

  await useToolWith($, 'Grep', { pattern: `a${'🙂'.repeat(12)}` }, 'a1')

  const { target } = stored().desks.implementer
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(target)).toBe(false)
  expect([...target].length).toBeLessThanOrEqual(24)
  expect(target.startsWith('a🙂🙂')).toBe(true)
})

// R7 ------------------------------------------------------------------

const HOOKS: Array<[name: string, call: ($: any) => Promise<unknown>, answer: unknown]> = [
  ['tool.call', $ => useTool($, 'Bash', 'a9'), { result: {} }],
  ['turn.start', $ => startTurn($, 'a9'), { turnId: 'u1' }],
  ['turn.complete', $ => finishTurn($, 'answer', 'a9'), { text: '' }],
  ['agent.spawn', $ => spawn($, 'crew:test-runner'), { model: 'm', agentId: 'a1' }],
]

const HANGS: Array<[name: string, options: WorldOptions, state: { get?: boolean; set?: boolean }]> = [
  ['a state read that never answers', {}, { get: true }],
  ['a state write that never answers', {}, { set: true }],
  ['an agent list that never answers', { listHangs: true }, {}],
]

for (const [hook, call, answer] of HOOKS) {
  for (const [hang, options, state] of HANGS) {
    test(`R7 ${hook} returns the engine answer with ${hang}`, async ($, on) => {
      const { clock } = world(on, options)
      hangState(on, state)
      let out: unknown
      let isDone = false

      void call($).then((got: unknown) => {
        out = got
        isDone = true
      })
      await clock.advance(1000)

      expect(isDone).toBe(true)
      expect(out).toEqual(answer)
    })
  }
}

// R8 ------------------------------------------------------------------

test('R8 a mark expiry keeps the note of the agent that is another desk\'s last while that desk\'s mark is live, and drops it once that mark is gone', async ($, on) => {
  const { clock, stored } = started(on)
  await spawn($, 'crew:test-runner') // a1, mark until 6000
  await finishTurn($, 'answer', 'a1')
  await clock.advance(3000)
  await spawn($, 'crew:implementer') // a2, mark until 9000
  await finishTurn($, 'answer', 'a2')

  await clock.advance(2000)
  await clock.settle()
  expect(stored().desks['test-runner'].mark).toBeUndefined()
  expect(Object.keys(stored().agents)).toEqual(['a2'])

  await clock.advance(3000)
  await clock.settle()
  expect(stored().desks.implementer.mark).toBeUndefined()
  expect(Object.keys(stored().agents ?? {})).toEqual([])
})

test('R8 a mark expiry keeps the note of another desk\'s last agent while that desk still has agents', async ($, on) => {
  const { clock, stored } = started(on)
  await spawn($, 'crew:test-runner') // a1, mark until 6000
  await finishTurn($, 'answer', 'a1')
  await clock.advance(3000)
  await spawn($, 'crew:implementer') // a2
  await spawn($, 'crew:implementer') // a3
  await useToolWith($, 'Edit', { file_path: '/a/b.ts' }, 'a3')
  await finishTurn($, 'answer', 'a3')
  expect(stored().desks.implementer.agentIds).toEqual(['a2'])
  expect(stored().desks.implementer.last).toBe('a3')

  await clock.advance(2000)
  await clock.settle()

  expect(stored().desks['test-runner'].mark).toBeUndefined()
  expect(Object.keys(stored().agents).sort()).toEqual(['a2', 'a3'])
})

// R9 ------------------------------------------------------------------

test('R9 a label of several lines reaches the task line as its first line, through the poll', async ($, on) => {
  const { clock } = started(on, {
    agents: [
      agentInfo('a1', 'crew:implementer', 'running', {
        label: 'running tests\nsecond line',
      }),
    ],
  })
  await spawn($, 'crew:implementer')
  await clock.advance(2000)
  await clock.settle()

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const lines = await taskOf(ui, 'implementer')
  await ui.unmount()

  expect(lines?.[0]).toBe('running tests')
  expect(lines?.join('|')).not.toContain('second')
})

// R11 -----------------------------------------------------------------

test('R11 a view that does not answer within 2000 ms is one toast, and the press resolves', async ($, on) => {
  const { clock, toasts, views } = world(on, { viewHangs: true })
  await spawn($, 'crew:implementer')
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  let isDone = false

  const pressed = ui.press({ key: 'view-implementer' }).then((got: unknown) => {
    isDone = true

    return got
  })
  await clock.advance(1999)
  expect(views).toEqual([{ agentId: 'a1' }])
  expect(toasts).toHaveLength(0)
  expect(isDone).toBe(false)

  await clock.advance(1)
  expect(toasts).toHaveLength(1)
  expect(toasts[0].text).not.toBe('')
  expect(isDone).toBe(true)
  expect(await pressed).toEqual({ element: 'view-implementer' })

  await clock.advance(10000)
  await ui.unmount()
  expect(toasts).toHaveLength(1)
})

// R12 -----------------------------------------------------------------

const classicBottom = (on: any) => on('classic.SessionStart', () => ({}))

const FULL_OFFICE = {
  desks: {
    implementer: { agentIds: [], count: 3, last: 'a1', target: 'x.ts', tool: 'Edit' },
    'test-runner': { agentIds: [], count: 2, last: 'a2', mark: 'done', until: 6000, outcome: '5s' },
  },
  deskOf: {},
  agents: { a1: { desc: 'one' }, a2: { desc: 'two' } },
  usage: { percent: 41, usd: 0.4 },
  feed: [{ at: 500, label: 'implementer', text: 'done 5s' }],
}

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) ? value.length === 0 : Object.keys(value as object).length === 0)

for (const source of ['startup', 'clear'] as const) {
  test(`R12 a ${source} session resets usage, feed, agent notes and each desk's last along with the counts, and keeps the rest`, async ($, on) => {
    world(on)
    classicBottom(on)
    const { stored } = seedOffice(on, FULL_OFFICE)

    await $.classic.SessionStart({ source })

    const office = stored()
    expect(office.usage).toBeUndefined()
    expect(isEmpty(office.feed)).toBe(true)
    expect(isEmpty(office.agents)).toBe(true)
    expect(office.desks.implementer.last).toBeUndefined()
    expect(office.desks['test-runner'].last).toBeUndefined()
    expect(office.desks.implementer.count ?? 0).toBe(0)
    expect(office.desks['test-runner'].count ?? 0).toBe(0)
    expect(office.desks['test-runner'].mark).toBe('done')
    expect(office.desks['test-runner'].until).toBe(6000)
    expect(office.desks.implementer.tool).toBe('Edit')
  })
}

for (const source of ['resume', 'compact', 'fork'] as const) {
  test(`R12 a ${source} session keeps usage, feed, agent notes and last`, async ($, on) => {
    world(on)
    classicBottom(on)
    const { stored } = seedOffice(on, FULL_OFFICE)

    await $.classic.SessionStart({ source })

    expect(stored()).toEqual(FULL_OFFICE)
  })
}

// R14 -----------------------------------------------------------------

for (const [command, target] of [
  ['API_KEY=sk-123 curl -s x', 'curl'],
  ['A=1 B=2 make test', 'make'],
  ['  _X9=a   ls -l', 'ls'],
  ['echo a=b', 'echo'],
  ['FOO=1', undefined],
  ['FOO=1 BAR=2', undefined],
] as const) {
  test(`R14 the Bash command "${command}" sets the desk target ${target === undefined ? 'unset' : target}`, async ($, on) => {
    const { stored } = started(on)
    await spawn($, 'crew:implementer')

    await useToolWith($, 'Bash', { command }, 'a1')

    expect(stored().desks.implementer.tool).toBe('Bash')
    expect(stored().desks.implementer.target).toBe(target)
  })
}
