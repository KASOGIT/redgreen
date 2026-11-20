import { expect, test } from 'claude-code/testing'

import {
  agentInfo,
  expectedCells,
  finishTurn,
  firstDifference,
  mountPane,
  rowsOn,
  seedOffice,
  sessionUsage,
  spawn,
  taskOf,
  useToolWith,
  world,
} from './kit'
import type { WorldOptions } from './kit'

// Spec, S1 data: the office keeps what each agent is doing and what each desk
// last did, from the spawn, tool and turn hooks and from a poll every 2000 ms
// while an agent is alive. All values below are the spec's literals.

const EMPTY = { desks: {}, deskOf: {} }
const words = (cells: string): number[] => {
  const bytes = Uint8Array.from(atob(cells), one => one.charCodeAt(0))
  const view = new DataView(bytes.buffer)

  return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true))
}

// The poll's agent list and session usage are read at each call, so a test
// changes them between polls by changing its options.
type Feed = WorldOptions

// The world, over a seeded, empty office.
const started = async (on: any, options: Feed = {}) => {
  const w = world(on, options)
  const office = seedOffice(on, EMPTY)

  return { ...w, ...office }
}

// Spawn

test('a spawn notes its description, the model that answered and the time it started', async ($, on) => {
  const { stored } = await started(on, { model: 'claude-sonnet-5-5' })

  await spawn($, 'crew:implementer', 'fix flaky test')

  expect(stored().agents).toEqual({
    a1: { desc: 'fix flaky test', model: 'claude-sonnet-5-5', started: 1000 },
  })
})

test('a spawn makes its agent the last one of its desk', async ($, on) => {
  const { stored } = await started(on)

  await spawn($, 'crew:implementer')
  expect(stored().desks.implementer.last).toBe('a1')

  await spawn($, 'crew:implementer')
  expect(stored().desks.implementer.last).toBe('a2')
})

// Tool calls

const TARGETS: Array<[tool: string, input: Record<string, unknown>, target: string]> = [
  ['Edit', { file_path: '/a/b/model.ts', old_string: 'a', new_string: 'b' }, 'model.ts'],
  ['Write', { file_path: '/a/b/notes.md', content: 'x' }, 'notes.md'],
  ['Read', { file_path: '/a/b/README.md' }, 'README.md'],
  ['Bash', { command: 'bin/check --fast' }, 'bin/check'],
  ['Grep', { pattern: 'foo' }, 'foo'],
  ['Glob', { pattern: '**/*.ts' }, '**/*.ts'],
  ['WebFetch', { url: 'https://example.com/docs/page?q=1', prompt: 'p' }, 'example.com'],
  ['WebSearch', { query: 'claude code hooks', mode: 'standard' }, 'claude code hooks'],
]

for (const [tool, input, target] of TARGETS) {
  test(`a ${tool} call sets the desk target to ${target}`, async ($, on) => {
    const { stored } = await started(on)
    await spawn($, 'crew:implementer')

    await useToolWith($, tool, input, 'a1')

    expect(stored().desks.implementer.target).toBe(target)
  })
}

test('a tool call makes its agent the last one of its desk', async ($, on) => {
  const { stored } = await started(on)
  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')

  await useToolWith($, 'Read', { file_path: '/a/b/x.ts' }, 'a1')

  expect(stored().desks.implementer.last).toBe('a1')
})

test('a tool the mod does not read a target from leaves the target unset', async ($, on) => {
  const { stored } = await started(on)
  await spawn($, 'crew:implementer')

  await useToolWith($, 'TodoWrite', { todos: [] }, 'a1')
  expect(stored().desks.implementer.tool).toBe('TodoWrite')
  expect(stored().desks.implementer.target).toBeUndefined()

  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a1')
  expect(stored().desks.implementer.target).toBe('model.ts')

  await useToolWith($, 'TodoWrite', { todos: [] }, 'a1')
  expect(stored().desks.implementer.target).toBeUndefined()
})

test('a target is cut to 24 characters', async ($, on) => {
  const { stored } = await started(on)
  await spawn($, 'crew:implementer')

  await useToolWith($, 'Grep', { pattern: 'abcdefghijklmnopqrstuvwxyz0123456789' }, 'a1')

  const { target } = stored().desks.implementer
  expect(target.length).toBeLessThanOrEqual(24)
  expect(target.startsWith('abcdefghijklmnopqrstuv')).toBe(true)
})

// Outcomes on the mark

const OUTCOMES: Array<
  [reason: 'answer' | 'refusal' | 'error', durationMs: number, mark: string, outcome: string]
> = [
  ['answer', 134000, 'done', '2m14s'],
  ['answer', 45000, 'done', '45s'],
  ['answer', 3900000, 'done', '1h05m'],
  ['refusal', 1000, 'failed', 'refused'],
  ['error', 1000, 'failed', 'error'],
]

for (const [reason, durationMs, mark, outcome] of OUTCOMES) {
  test(`reason ${reason} after ${durationMs} ms marks the desk ${mark} with outcome ${outcome}`, async ($, on) => {
    const { stored } = await started(on)
    await spawn($, 'crew:implementer')

    await finishTurn($, reason, 'a1', durationMs)

    expect(stored().desks.implementer.mark).toBe(mark)
    expect(stored().desks.implementer.outcome).toBe(outcome)
  })
}

test('the mark expiry clears the outcome and keeps the target and the last agent', async ($, on) => {
  const { clock, stored } = await started(on)
  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a1')
  await finishTurn($, 'answer', 'a1', 134000)
  expect(stored().desks.implementer.outcome).toBe('2m14s')

  await clock.advance(5000)
  await clock.settle()

  const desk = stored().desks.implementer
  expect(desk.mark).toBeUndefined()
  expect(desk.outcome).toBeUndefined()
  expect(desk.target).toBe('model.ts')
  expect(desk.last).toBe('a1')
})

test('a desk keeps its target and last agent while another agent starts and one ends', async ($, on) => {
  const { stored } = await started(on)
  await spawn($, 'crew:implementer')
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a1')

  await spawn($, 'crew:implementer')
  expect(stored().desks.implementer.target).toBe('model.ts')
  expect(stored().desks.implementer.last).toBe('a2')

  await finishTurn($, 'answer', 'a1')
  expect(stored().desks.implementer.agentIds).toEqual(['a2'])
  expect(stored().desks.implementer.target).toBe('model.ts')
  expect(stored().desks.implementer.last).toBe('a2')
  expect(stored().desks.implementer.outcome).toBeUndefined()
})

test('a poll that sees the agent completed marks the desk with the time since its start', async ($, on) => {
  const { clock, stored } = await started(on, {
    agents: [agentInfo('a1', 'crew:implementer', 'completed', { startTime: 1000 })],
  })
  await spawn($, 'crew:implementer')

  await clock.advance(2000)
  await clock.settle()

  expect(stored().desks.implementer.mark).toBe('done')
  expect(stored().desks.implementer.outcome).toBe('2s')
})

// Notes of agents that left every desk

test('the mark expiry drops the notes of agents on no desk and keeps the others', async ($, on) => {
  const { clock, stored } = await started(on)
  await spawn($, 'crew:implementer')
  await spawn($, 'crew:test-runner')
  await finishTurn($, 'answer', 'a1')

  await clock.advance(4999)
  expect(Object.keys(stored().agents).sort()).toEqual(['a1', 'a2'])

  await clock.advance(1)
  await clock.settle()
  expect(Object.keys(stored().agents)).toEqual(['a2'])
})

// The poll

const FULL = agentInfo('a1', 'crew:implementer', 'running', {
  label: 'Fix the flaky test',
  model: 'claude-sonnet-5-5',
  startTime: 500,
  tokenCount: 82000,
  contextWindowSize: 200000,
  tokenSamples: [50000, 100000, 150000, 200000],
})

test('a poll merges label, model, start time, tokens, window, samples and status into the note', async ($, on) => {
  const { clock, stored } = await started(on, { agents: [FULL] })
  await spawn($, 'crew:implementer', 'fix flaky test')

  await clock.advance(2000)
  await clock.settle()

  expect(stored().agents.a1).toEqual({
    desc: 'fix flaky test',
    label: 'Fix the flaky test',
    model: 'claude-sonnet-5-5',
    started: 500,
    tokens: 82000,
    window: 200000,
    samples: [50000, 100000, 150000, 200000],
    status: 'running',
  })
})

test('a poll writes the context percent and the cost of the session', async ($, on) => {
  const { clock, stored } = await started(on, {
    agents: [FULL],
    usage: sessionUsage(41, 0.4),
  })
  await spawn($, 'crew:implementer')

  await clock.advance(2000)
  await clock.settle()

  expect(stored().usage).toEqual({ percent: 41, usd: 0.4 })
})

test('a poll asks for one agent list and one session usage', async ($, on) => {
  const { clock, listCalls, usageCalls } = await started(on, {
    agents: [FULL],
    usage: sessionUsage(41, 0.4),
  })
  await spawn($, 'crew:implementer')
  const before = listCalls()

  await clock.advance(2000)
  await clock.settle()

  expect(listCalls() - before).toBe(1)
  expect(usageCalls()).toBe(1)
})

test('a poll that finds nothing new makes no state write', async ($, on) => {
  const { clock, stored, writes } = await started(on, {
    agents: [FULL],
    usage: sessionUsage(41, 0.4),
  })
  await spawn($, 'crew:implementer')

  await clock.advance(2000)
  await clock.settle()
  expect(stored().usage).toEqual({ percent: 41, usd: 0.4 })
  const written = writes()

  await clock.advance(2000)
  await clock.settle()
  await clock.advance(2000)
  await clock.settle()

  expect(writes()).toBe(written)
})

test('a failing session usage leaves the usage as it was and does not stop the poll', async ($, on) => {
  const feed: Feed = { agents: [FULL], usage: sessionUsage(41, 0.4) }
  const { clock, stored, usageCalls } = await started(on, feed)
  await spawn($, 'crew:implementer')
  await clock.advance(2000)
  await clock.settle()
  expect(stored().usage).toEqual({ percent: 41, usd: 0.4 })

  feed.usageThrows = true
  feed.agents = [{ ...FULL, status: 'waiting' }]
  await clock.advance(2000)
  await clock.settle()

  expect(usageCalls()).toBe(2)
  expect(stored().usage).toEqual({ percent: 41, usd: 0.4 })
  expect(stored().agents.a1.status).toBe('waiting')
})

test('the poll goes on while the agent waits, and sees it run again', async ($, on) => {
  const feed: Feed = { agents: [{ ...FULL, status: 'waiting' }] }
  const { clock, listCalls, stored } = await started(on, feed)
  await spawn($, 'crew:implementer')
  const before = listCalls()

  await clock.advance(2000)
  await clock.settle()
  expect(stored().agents.a1.status).toBe('waiting')

  feed.agents = [FULL]
  await clock.advance(2000)
  await clock.settle()

  expect(listCalls() - before).toBe(2)
  expect(stored().agents.a1.status).toBe('running')
})

// Untrusted text

test('control characters and ESC in a label, a description and a target become spaces', async ($, on) => {
  const { clock, stored } = await started(on, {
    agents: [{ ...FULL, label: 'a\u001b[31mb\nc' }],
  })
  await spawn($, 'crew:implementer', 'fix\u001b[31m\ttest')
  await useToolWith($, 'Edit', { file_path: '/a/b\u001b[31mc.ts' }, 'a1')

  await clock.advance(2000)
  await clock.settle()

  // R9 (after S1): a label draws as its first line, so the newline no longer
  // flattens into the text: "a\u001b[31mb\nc" draws "a [31mb".
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  expect((await taskOf(ui, 'implementer'))?.[0]).toBe('a [31mb')
  await ui.unmount()
  expect(stored().agents.a1.desc).toBe('fix [31m test')
  expect(stored().desks.implementer.target).toBe('b [31mc.ts')
})

// An office stored before the new fields

test('an office stored before the new fields still draws, and never says undefined', async ($, on) => {
  const { clock } = world(on, { agents: [FULL] })
  seedOffice(on, {
    desks: { 'test-runner': { agentIds: ['a1'] } },
    deskOf: { a1: 'test-runner' },
  })

  expect(await rowsOn($, 'terminal')).toContain('test-runner: working')
  const ui = await mountPane($, 'terminal', 54)
  const texts = (await ui.findAll({ type: 'Text' })).map((one: any) => one.text)
  await ui.unmount()
  expect(texts).toContain('working')
  expect(texts.filter((one: string) => one.includes('undefined'))).toEqual([])

  await clock.advance(2000)
  await clock.settle()
  const after = await mountPane($, 'terminal', 54)
  const again = (await after.findAll({ type: 'Text' })).map((one: any) => one.text)
  await after.unmount()
  expect(again.filter((one: string) => one.includes('undefined'))).toEqual([])
})

// Render at the current frame

for (const [bodyColumns, bodyRows, scale] of [
  [54, 40, 1],
  [100, 61, 2],
] as const) {
  test(`a render after 500 ms draws a working desk (slot 1) at frame 2 by the phase rule at scale ${scale}`, async ($, on) => {
    const { clock } = await started(on)
    await spawn($, 'crew:test-runner')
    await clock.advance(500)

    const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
    const found = await ui.findAll({ type: 'Raster' })
    await ui.unmount()
    const raster = found.find((one: any) => one.key === 'desk-test-runner')

    expect(
      firstDifference(words(raster.props.cells), expectedCells('test-runner', 'working', 2, scale)),
    ).toBe(-1)
  })
}

test('a render after 1000 ms draws a working desk (slot 1) at frame 3 by the phase rule', async ($, on) => {
  const { clock } = await started(on)
  await spawn($, 'crew:test-runner')
  await clock.advance(1000)

  const ui = await mountPane($, 'terminal', 54)
  const found = await ui.findAll({ type: 'Raster' })
  await ui.unmount()
  const raster = found.find((one: any) => one.key === 'desk-test-runner')

  expect(
    firstDifference(words(raster.props.cells), expectedCells('test-runner', 'working', 3, 1)),
  ).toBe(-1)
})
