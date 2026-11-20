import { expect, test } from 'claude-code/testing'

import { DESKS, failWrites, meterOf, mountPane, seedOffice, spawn, startTurn, world } from './kit'

// The meter line under a working desk is "<model> <effort> <elapsed>" (lo, me, hi, xh, ma or the digits of a number): the
// effort is the one the agent's latest turn.step carried. The clock stands at
// 1000, so started -61000 is 62 s ago (1m02s) and started -2000 is 3 s ago.
// A desk is 16 columns wide at scale 1 (54 body columns, 40 rows) and 32 at
// scale 2 (200 columns, 60 rows). The cases that show a whole meter line mount
// at scale 2; the two narrow cases mount at scale 1.

const SLOTS = DESKS.map(([slot]) => slot)
const [MANAGER, RUNNER, RESEARCHER] = SLOTS as [string, string, string]
const IMPLEMENTER = 'implementer'

const ANSWER = 'the step answer'
const answerOf = (index: number) => ({ turnId: 'u1', index, answer: ANSWER, toolUses: [] })

const seedAgents = (on: any, seats: Record<string, { id: string; model: string; started: number }>) => {
  const desks: Record<string, unknown> = {}
  const deskOf: Record<string, string> = {}
  const agents: Record<string, unknown> = {}
  for (const [slot, { id, model, started }] of Object.entries(seats)) {
    desks[slot] = { agentIds: [id] }
    deskOf[id] = slot
    agents[id] = { model, started }
  }
  seedOffice(on, { desks, deskOf, agents })
}

const chunksOf = async ($: any, over: Record<string, unknown>) => {
  const stream = $.turn.step({
    turnId: 'u1',
    index: 0,
    model: 'claude-opus-4-6',
    messageCount: 1,
    ...over,
  })
  const chunks: unknown[] = []
  let step = await stream.next()
  while (!step.done) {
    chunks.push(step.value)
    step = await stream.next()
  }

  return { chunks, result: step.value }
}

const stepOf = async ($: any, over: Record<string, unknown>) =>
  (await chunksOf($, over)).result

const meters = async ($: any, slots: string[], narrow = false) => {
  const ui = narrow
    ? await mountPane($, 'terminal', 54, 'dock', 40)
    : await mountPane($, 'terminal', 200, 'dock', 60)
  const lines = await Promise.all(slots.map(slot => meterOf(ui, slot)))
  await ui.unmount()

  return lines
}

const OPUS = { id: 'a1', model: 'claude-opus-4-6', started: -61000 }

const setup = (on: any, seats = { [RUNNER]: OPUS }) => {
  world(on)
  on('turn.step', async function* (_: any, e: any) {
    return answerOf(e.index)
  })
  seedAgents(on, seats)
}

test('a step with effort high puts the effort between model and elapsed time', async ($, on) => {
  setup(on)
  await stepOf($, { agentId: 'a1', effort: 'high' })

  expect(await meters($, [RUNNER])).toEqual(['opus hi 1m02s'])
})

test('the effort shown is the one of the most recent step', async ($, on) => {
  setup(on)
  await stepOf($, { agentId: 'a1', effort: 'high', index: 0 })
  await stepOf($, { agentId: 'a1', effort: 'medium', index: 1 })

  expect(await meters($, [RUNNER])).toEqual(['opus me 1m02s'])
})

test('the manager desk shows the effort of a step with no agentId', async ($, on) => {
  setup(on, { [MANAGER]: { id: 'main', model: 'claude-fable-5', started: -2000 } })
  await stepOf($, { model: 'claude-fable-5', effort: 'xhigh' })

  expect(await meters($, [MANAGER])).toEqual(['fable xh 3s'])
})

test('a step of one agent never changes the meter of another desk', async ($, on) => {
  setup(on, {
    [RUNNER]: OPUS,
    [RESEARCHER]: { id: 'a2', model: 'claude-haiku-4-5', started: -61000 },
  })
  await stepOf($, { agentId: 'a1', effort: 'high' })
  await stepOf($, { agentId: 'a2', model: 'claude-haiku-4-5', effort: 'low' })
  await stepOf($, { agentId: 'a1', effort: 'max', index: 1 })

  expect(await meters($, [RUNNER, RESEARCHER])).toEqual([
    'opus ma 1m02s',
    'haiku lo 1m02s',
  ])
})

test('a step of an agent leaves the manager desk without effort', async ($, on) => {
  setup(on, {
    [MANAGER]: { id: 'main', model: 'claude-fable-5', started: -2000 },
    [RUNNER]: OPUS,
  })
  await stepOf($, { agentId: 'a1', effort: 'high' })

  expect(await meters($, [MANAGER, RUNNER])).toEqual(['fable · 3s', 'opus hi 1m02s'])
})

test('with no step yet the meter is the model and the elapsed time only', async ($, on) => {
  setup(on)

  expect(await meters($, [RUNNER])).toEqual(['opus · 1m02s'])
})

test('a step with no effort leaves the meter as it was, with no empty segment', async ($, on) => {
  setup(on)
  await stepOf($, { agentId: 'a1' })

  expect(await meters($, [RUNNER])).toEqual(['opus · 1m02s'])
})

test('a later step with no effort drops the effort of the earlier one', async ($, on) => {
  setup(on)
  await stepOf($, { agentId: 'a1', effort: 'high', index: 0 })
  await stepOf($, { agentId: 'a1', index: 1 })

  expect(await meters($, [RUNNER])).toEqual(['opus · 1m02s'])
})

test('a numeric effort shows as its digits', async ($, on) => {
  setup(on, { [RUNNER]: { id: 'a1', model: 'claude-sonnet-5-5', started: -11000 } })
  await stepOf($, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 8000 })

  expect(await meters($, [RUNNER])).toEqual(['sonnet 8000 12s'])
})

// 16 columns. The model name is cut first, the elapsed time never.
test('on a narrow desk a short line keeps the model name whole', async ($, on) => {
  setup(on, { [MANAGER]: { id: 'main', model: 'claude-fable-5', started: -2000 } })
  await stepOf($, { model: 'claude-fable-5', effort: 'xhigh' })

  expect(await meters($, [MANAGER], true)).toEqual(['fable xh 3s'])
})

for (const [effort, line] of [
  ['medium', 'opus me 1m02s'],
  ['high', 'opus hi 1m02s'],
] as const) {
  test(`on a narrow desk opus with effort ${effort} reads ${line}`, async ($, on) => {
    setup(on, { [RUNNER]: { id: 'a1', model: 'claude-opus-5', started: -61000 } })
    await stepOf($, { agentId: 'a1', model: 'claude-opus-5', effort })

    expect(await meters($, [RUNNER], true)).toEqual([line])
  })
}

test('on a narrow desk the model name is cut first and the elapsed time never', async ($, on) => {
  setup(on, { [RUNNER]: { id: 'a1', model: 'claude-sonnet-5-5', started: -759000 } })
  await stepOf($, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 8000 })

  // " 8000 12m40s" takes 12 of the 16 columns, so "sonnet" is cut to 4: "son…".
  expect(await meters($, [RUNNER], true)).toEqual(['son… 8000 12m40s'])
})

test('on a narrow desk a two-letter label that fits keeps the model name whole', async ($, on) => {
  setup(on, { [RUNNER]: { id: 'a1', model: 'claude-sonnet-5-5', started: -759000 } })
  await stepOf($, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'medium' })

  // "sonnet me 12m40s" is 6 + 1 + 2 + 1 + 6 = 16 columns: no cut.
  expect(await meters($, [RUNNER], true)).toEqual(['sonnet me 12m40s'])
})

test('on a narrow desk an effort that would leave the model under 3 columns is dropped', async ($, on) => {
  setup(on, { [RUNNER]: { id: 'a1', model: 'claude-sonnet-5-5', started: -11000 } })
  await stepOf($, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 100000000 })

  // " 100000000 12s" takes 14 of the 16 columns, leaving 2 for the model.
  expect(await meters($, [RUNNER], true)).toEqual(['sonnet · 12s'])
})

test('the turn.step hook returns the answer of the step unchanged', async ($, on) => {
  setup(on)

  expect(await stepOf($, { agentId: 'a1', effort: 'high' })).toEqual(answerOf(0))
})

test('two steps of one agent with the same effort write the office state once', async ($, on) => {
  world(on)
  on('turn.step', async function* (_: any, e: any) {
    return answerOf(e.index)
  })
  const office = seedOffice(on, {
    desks: { [RUNNER]: { agentIds: ['a1'] } },
    deskOf: { a1: RUNNER },
    agents: { a1: { model: 'claude-opus-4-6', started: -61000 } },
  })

  await stepOf($, { agentId: 'a1', effort: 'high', index: 0 })
  const afterFirst = office.writes()
  await stepOf($, { agentId: 'a1', effort: 'high', index: 1 })

  expect(afterFirst).toBeGreaterThan(0)
  expect(office.writes()).toBe(afterFirst)
})

test('a step recorded before the spawn note is written keeps its effort in the meter', async ($, on) => {
  world(on, { model: 'claude-opus-4-6' })
  on('turn.step', async function* (_: any, e: any) {
    return answerOf(e.index)
  })
  seedOffice(on, { desks: {}, deskOf: {}, agents: {} })

  await stepOf($, { agentId: 'a1', effort: 'high' })
  await spawn($, 'crew:implementer')

  expect(await meters($, [IMPLEMENTER])).toEqual(['opus hi 0s'])
})

const CHUNKS = [
  { kind: 'text', index: 0, text: 'first ' },
  { kind: 'text', index: 0, text: 'second' },
]

const chunkedSetup = (on: any, isWriteFailing = false) => {
  world(on)
  on('turn.step', async function* (_: any, e: any) {
    yield CHUNKS[0]
    yield CHUNKS[1]

    return answerOf(e.index)
  })
  if (isWriteFailing) {
    on('state.get', () => ({
      value: {
        value: {
          desks: { [RUNNER]: { agentIds: ['a1'] } },
          deskOf: { a1: RUNNER },
          agents: { a1: { model: 'claude-opus-4-6', started: -61000 } },
        },
        version: 1,
      },
    }))
    failWrites(on)
  } else {
    seedAgents(on, { [RUNNER]: OPUS })
  }
}

test('the turn.step hook passes both chunks, in order, and the result unchanged', async ($, on) => {
  chunkedSetup(on)

  const { chunks, result } = await chunksOf($, { agentId: 'a1', effort: 'high' })

  expect(chunks).toEqual(CHUNKS)
  expect(result).toEqual(answerOf(0))
})

test('a state write that fails leaves the chunks and the result of the step unchanged', async ($, on) => {
  chunkedSetup(on, true)

  const { chunks, result } = await chunksOf($, { agentId: 'a1', effort: 'high' })

  expect(chunks).toEqual(CHUNKS)
  expect(result).toEqual(answerOf(0))
})

// The manager desk through the production path: no seeded agent note, the
// session's turn.start and turn.step make it. The clock stands at 1000.
const mainSetup = (on: any) => {
  const { clock } = world(on)
  on('turn.step', async function* (_: any, e: any) {
    return answerOf(e.index)
  })
  seedOffice(on, { desks: {}, deskOf: {}, agents: {} })

  return clock
}

test('the manager meter of a started main turn and a step reads the model, the effort and the elapsed time', async ($, on) => {
  const clock = mainSetup(on)

  await startTurn($)
  await stepOf($, { model: 'claude-fable-5-2', effort: 'xhigh' })
  await clock.advance(3000)

  expect(await meters($, [MANAGER])).toEqual(['fable xh 3s'])
})

test('a later main step with another model changes the manager meter model and keeps the effort', async ($, on) => {
  const clock = mainSetup(on)

  await startTurn($)
  await stepOf($, { model: 'claude-fable-5-2', effort: 'xhigh', index: 0 })
  await stepOf($, { model: 'claude-opus-5-5', effort: 'xhigh', index: 1 })
  await clock.advance(3000)

  expect(await meters($, [MANAGER])).toEqual(['opus xh 3s'])
})

// A refused clock: $.clock.now() rejects. The kit's world registers the clock
// through the `on` it is handed, so a wrapper swaps only clock.now for a
// refusal. The render hook reads the clock too, so the desk is read from the
// stored office, not from the drawing.
const worldWithRefusedClock = (on: any) =>
  world((name: string, ...rest: unknown[]) =>
    name === 'clock.now'
      ? on('clock.now', () => Promise.reject(new Error('refused')))
      : (on as any)(name, ...rest),
  )

test('control: with a working clock a subagent turn.start puts its agent on the desk', async ($, on) => {
  world(on)
  const office = seedOffice(on, { desks: {}, deskOf: { a1: RUNNER }, agents: {} })

  await startTurn($, 'a1')

  expect(office.stored().desks[RUNNER]?.agentIds).toEqual(['a1'])
})

test('with a refused clock a subagent turn.start still puts its agent on the desk', async ($, on) => {
  worldWithRefusedClock(on)
  const office = seedOffice(on, { desks: {}, deskOf: { a1: RUNNER }, agents: {} })

  await startTurn($, 'a1')

  expect(office.stored().desks[RUNNER]?.agentIds).toEqual(['a1'])
})

test('with a refused clock the main turn.start still puts the main session on the manager desk', async ($, on) => {
  worldWithRefusedClock(on)
  const office = seedOffice(on, { desks: {}, deskOf: {}, agents: {} })

  await startTurn($)

  expect(office.stored().desks[MANAGER]?.agentIds).toEqual(['main'])
})

// The main path: the model and the effort of consecutive steps, and a second turn.
test('two main steps with the same model and effort write the office state once', async ($, on) => {
  world(on)
  on('turn.step', async function* (_: any, e: any) {
    return answerOf(e.index)
  })
  const office = seedOffice(on, {
    desks: { [MANAGER]: { agentIds: ['main'] } },
    deskOf: { main: MANAGER },
    agents: { main: { model: 'claude-fable-5-2', started: -2000 } },
  })

  await stepOf($, { model: 'claude-fable-5-2', effort: 'xhigh', index: 0 })
  const afterFirst = office.writes()
  await stepOf($, { model: 'claude-fable-5-2', effort: 'xhigh', index: 1 })

  expect(afterFirst).toBeGreaterThan(0)
  expect(office.writes()).toBe(afterFirst)
})

test('a second main turn.start restarts the manager elapsed time', async ($, on) => {
  const clock = mainSetup(on)

  await startTurn($)
  await stepOf($, { model: 'claude-fable-5-2', effort: 'xhigh' })
  await clock.advance(5000)
  await startTurn($)
  await clock.advance(2000)

  expect(await meters($, [MANAGER])).toEqual(['fable xh 2s'])
})
