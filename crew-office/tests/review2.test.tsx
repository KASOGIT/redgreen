import { expect, test } from 'claude-code/testing'

import {
  agentInfo,
  deferred,
  finishTurn,
  mountPane,
  seedOffice,
  sessionUsage,
  spawn,
  startTurn,
  taskOf,
  useToolWith,
  world,
} from './kit'
import type { WorldOptions } from './kit'

// Second review fixes Q1 to Q10 (Q10 is the tightened R5 test in
// fixes.test.tsx). Q4 and Q6 are not here: no test can make the engine's
// $.clock.after or $.ui.view throw synchronously, nor see a timer left running.
// Every expected value is the spec's literal or counted out by hand.

const EMPTY = { desks: {}, deskOf: {} }
const SUMMARY = 'crew: 1 working · 0 done'

const started = (on: any, options: WorldOptions = {}) => {
  const w = world(on, options)

  return { ...w, ...seedOffice(on, EMPTY) }
}

// Q1 ------------------------------------------------------------------

test('Q1 turn.complete of an agent whose turn.start is still looking up its desk waits for it: the desk ends idle with the mark and count 1', async ($, on) => {
  const gate = deferred<unknown[]>()
  let calls = 0
  const w = world(on, {
    list: () => {
      calls += 1

      return calls === 1
        ? gate.promise
        : [agentInfo('a1', 'crew:test-runner', 'running')]
    },
  })
  const { stored } = seedOffice(on, EMPTY)

  const turn = startTurn($, 'a1')
  await w.clock.settle()
  const complete = finishTurn($, 'answer', 'a1')
  await w.clock.settle()
  await w.clock.advance(500)
  gate.resolve([agentInfo('a1', 'crew:test-runner', 'running')])
  await w.clock.settle()
  await Promise.all([turn, complete])

  const desk = stored().desks['test-runner']
  expect(desk.agentIds).toEqual([])
  expect(desk.mark).toBe('done')
  expect(desk.count).toBe(1)
})

// Guard: passes today, and must keep passing when Q1 is fixed.
test('Q1 guard: a resumed agent (known, off its desk) that starts a new turn and ends done counts again', async ($, on) => {
  world(on)
  const { stored } = seedOffice(on, {
    desks: { 'test-runner': { agentIds: [], count: 1, mark: 'done', until: 6000 } },
    deskOf: { a1: 'test-runner' },
  })

  await startTurn($, 'a1')
  await finishTurn($, 'answer', 'a1')

  const desk = stored().desks['test-runner']
  expect(desk.agentIds).toEqual([])
  expect(desk.mark).toBe('done')
  expect(desk.count).toBe(2)
})

// Q2 ------------------------------------------------------------------

const bashTarget = async (on: any, $: any, command: string) => {
  const { stored } = started(on)
  await spawn($, 'crew:implementer')
  await useToolWith($, 'Bash', { command }, 'a1')

  return stored().desks.implementer.target
}

test('Q2 a quoted value after NAME= leaves the Bash target unset: TOKEN="Bearer sk-1" curl x', async ($, on) => {
  expect(await bashTarget(on, $, 'TOKEN="Bearer sk-1" curl x')).toBeUndefined()
})

test("Q2 a quoted value after NAME= leaves the Bash target unset: A='x y' B=2 make", async ($, on) => {
  expect(await bashTarget(on, $, "A='x y' B=2 make")).toBeUndefined()
})

test('Q2 a quote opened on a later NAME= word leaves the target unset: B=2 A="x y" make', async ($, on) => {
  expect(await bashTarget(on, $, 'B=2 A="x y" make')).toBeUndefined()
})

// Guard: passes today.
test('Q2 guard: plain NAME=value words are still skipped: A=1 make -> make', async ($, on) => {
  expect(await bashTarget(on, $, 'A=1 make')).toBe('make')
})

// Q3 ------------------------------------------------------------------

test('Q3 no new session.usage call while one is in flight', async ($, on) => {
  const { clock, usageCalls } = world(on, {
    usageHangs: true,
    agents: [agentInfo('a1', 'crew:test-runner', 'running')],
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)
  expect(usageCalls()).toBe(1)
  await clock.advance(2000)
  await clock.advance(2000)

  expect(usageCalls()).toBe(1)
})

// Guard: passes today.
test('Q3 guard: a usage answer frees the next poll to ask again', async ($, on) => {
  const { clock, usageCalls } = world(on, {
    usage: sessionUsage(41, 0.4),
    agents: [agentInfo('a1', 'crew:test-runner', 'running')],
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)
  await clock.settle()
  await clock.advance(2000)
  await clock.settle()

  expect(usageCalls()).toBe(2)
})

for (const source of ['startup', 'clear'] as const) {
  test(`Q3 a usage answer that lands after a ${source} reset is dropped: usage stays reset`, async ($, on) => {
    const later = deferred<ReturnType<typeof sessionUsage>>()
    const w = world(on, {
      usageLater: later.promise,
      agents: [agentInfo('a1', 'crew:test-runner', 'running')],
    })
    on('classic.SessionStart', () => ({}))
    const { stored } = seedOffice(on, EMPTY)
    await spawn($, 'crew:test-runner')
    await w.clock.advance(2000)
    expect(w.usageCalls()).toBe(1)

    await $.classic.SessionStart({ source })
    later.resolve(sessionUsage(41, 0.4))
    await w.clock.settle()

    expect(stored().usage).toBeUndefined()
  })
}

// Q5 ------------------------------------------------------------------

// A stored `office` whose next state read, or next state write, waits for the
// test to let it go.
const gatedOffice = (on: any, seed: unknown) => {
  let value: any = seed
  let version = 1
  const hold: { get?: Promise<void>; set?: Promise<void> } = {}

  on('state.get', async () => {
    const gate = hold.get
    hold.get = undefined
    if (gate !== undefined) await gate

    return { value: { value, version } }
  })
  on('state.set', async (_: any, e: any) => {
    const gate = hold.set
    hold.set = undefined
    if (gate !== undefined) await gate
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false, version } }
    }
    value = e.value
    version += 1

    return { value: { isSet: true, version } }
  })

  return { stored: () => value, hold }
}

for (const step of ['get', 'set'] as const) {
  test(`Q5 a poll abandoned after 10 s finishes nothing and settles nothing when its state ${step} comes back late`, async ($, on) => {
    const release = deferred<void>()
    let calls = 0
    const office: { hold?: { get?: Promise<void>; set?: Promise<void> } } = {}
    const w = world(on, {
      usageHangs: true,
      list: () => {
        calls += 1
        if (calls > 1) return [agentInfo('a1', 'crew:test-runner', 'running')]
        office.hold![step] = release.promise

        return [agentInfo('a1', 'crew:test-runner', 'completed', { label: 'L' })]
      },
    })
    const gated = gatedOffice(on, EMPTY)
    office.hold = gated.hold
    await spawn($, 'crew:test-runner')

    await w.clock.advance(2000)
    expect(w.listCalls()).toBe(1)
    await w.clock.advance(10000)
    release.resolve()
    await w.clock.settle()

    const desk = gated.stored().desks['test-runner']
    expect(desk.agentIds).toEqual(['a1'])
    expect(desk.mark).toBeUndefined()
    expect(desk.count).toBeUndefined()
    expect(w.statuses).toEqual([SUMMARY])
    if (step === 'get') expect(gated.stored().agents.a1.label).not.toBe('L')
  })
}

// Q7 ------------------------------------------------------------------

test('Q7 a new busy period with the same undrawn desks gets its one invalidate', async ($, on) => {
  const { invalidations, clock } = world(on, { captureInvalidate: true })
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')
  await spawn($, 'crew:debugger-analyst')
  await spawn($, 'crew:architecture-planner')
  const ui = await mountPane($, 'terminal', 54, 'dock', 16)
  await clock.advance(500)
  expect(invalidations).toHaveLength(1)

  for (const id of ['a1', 'a2', 'a3', 'a4']) await finishTurn($, 'answer', id)
  await clock.settle()
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')
  await spawn($, 'crew:debugger-analyst')
  await spawn($, 'crew:architecture-planner')
  await clock.settle()
  const before = invalidations.length
  await clock.advance(500)
  await ui.unmount()

  expect(invalidations).toHaveLength(before + 1)
})

// Q8 ------------------------------------------------------------------

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

// Seven wide characters take 14 of the 16 columns and the ellipsis the 15th;
// nine of them are 18 columns, so a character counted as one column is not cut.
// U+A960 and U+A97F already sit inside an older range: guards that pass today.
for (const code of [
  0x2329, 0x232a, 0xfe10, 0xfe19, 0xa960, 0xa97f, 0x1f200, 0x1f210, 0x1f2ff,
  0x17000, 0x1b2ff,
]) {
  const char = String.fromCodePoint(code)
  test(`Q8 U+${code.toString(16).toUpperCase()} counts two columns: nine are cut to seven and an ellipsis in 16`, async ($, on) => {
    world(on)

    expect(await taskLine(on, $, { label: char.repeat(9) })).toBe(`${char.repeat(7)}…`)
  })
}

// Q9 ------------------------------------------------------------------

for (const [name, separator] of [
  ['U+2028', ' '],
  ['U+2029', ' '],
  ['U+0085', '\u0085'],
  ['CR LF', '\r\n'],
  ['LF', '\n'],
] as const) {
  test(`Q9 a ${name} ends the label's first line: "a${name}b" draws as the task "a"`, async ($, on) => {
    world(on)

    expect(await taskLine(on, $, { label: `a${separator}b` })).toBe('a')
  })
}

test('Q9 a poll stores the first line of a label that has a U+2028 in it', async ($, on) => {
  const { clock, stored } = started(on, {
    agents: [agentInfo('a1', 'crew:test-runner', 'running', { label: 'a b' })],
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)

  expect(stored().agents.a1.label).toBe('a')
})
