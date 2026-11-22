import { expect, test } from 'claude-code/testing'

import { sceneOf } from '../hooks/model'
import { composeDesk, encodeCells } from '../hooks/scene'
import { deferred, mountPane, rosterOf, rowsOn, seedOffice, statusOf, world } from './kit'

// While the advisor is consulting, its own desk is working. The mod learns it
// from the main session's turn.step: on each opaque { kind: 'engine' } chunk,
// the newest api message (session.messages, last 1) is the in-flight assistant
// message. A server_tool_use named advisor with no block carrying its id as
// tool_use_id is a call in progress. The clock stands at 1000.

const ADVISOR = 'advisor'
const MANAGER = 'manager'
const RUNNER = 'test-runner'
const EMPTY = { desks: {}, deskOf: {}, agents: {} }
const TALL = 53

const CALL_2 = { type: 'server_tool_use', id: 'srvtoolu_Y', name: 'advisor', input: {} }
const RESULT_2 = { type: 'advisor_tool_result', tool_use_id: 'srvtoolu_Y', content: {} }
const CALL = { type: 'server_tool_use', id: 'srvtoolu_X', name: 'advisor', input: {} }
const RESULT = { type: 'advisor_tool_result', tool_use_id: 'srvtoolu_X', content: {} }
const assistant = (...content: unknown[]) => [{ role: 'assistant', content }]

const USER = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
const RUNNING = assistant(CALL)
const DONE = assistant(CALL, RESULT)

// The harness refuses a fabricated engine chunk ("yielded a chunk with kind engine but no ref", and a
// ref the link never pulled is refused too), and nothing beneath the mod pulls real ones. So a test
// feeds the mod a 'tool' chunk, a non-delta kind: the mod reads session.messages on every chunk
// whose kind is not text, thinking or input, as it does on the live engine chunks.
const beat = (ref: number) => ({ kind: 'tool', index: ref, id: `toolu_${ref}`, name: 'Beat' })
const text = (word: string) => ({ kind: 'text', index: 0, text: word })

let script: unknown[] = []
let uses: unknown[] | undefined
// What session.messages answers now: the test moves it before each pull.
let latest: unknown = USER
let asked: unknown[] = []
let denial: string | undefined
let gate: { promise: Promise<unknown> } | undefined
let crash = false
let isClosed = false

const finished = (over: Record<string, unknown> = {}) => ({
  id: 'srvtoolu_X',
  name: 'advisor',
  input: {},
  startedAt: 500,
  endedAt: 1000,
  ...over,
})

const resultOf = (index: number) => ({
  turnId: 'u1',
  index,
  answer: '',
  toolUses: [],
  ...(uses === undefined ? {} : { serverToolUses: uses }),
})

const setup = (on: any, seed: Record<string, unknown> = EMPTY) => {
  script = []
  uses = undefined
  latest = USER
  asked = []
  denial = undefined
  gate = undefined
  crash = false
  isClosed = false
  const w = world(on)
  on('turn.step', async function* (_: any, e: any) {
    try {
      for (const chunk of script) yield chunk
      if (crash) throw new Error('stream cut')

      return resultOf(e.index)
    } finally {
      isClosed = true
    }
  })
  on('session.messages', async (_: any, e: any) => {
    asked.push(e)
    const value = denial === undefined ? latest : { deny: denial }
    const held = gate
    gate = undefined
    if (held !== undefined) await held.promise

    return { value }
  })
  on('settings.read', () => ({ value: { advisorModel: 'fable' } }))
  on('classic.SessionStart', () => ({}))

  return { ...w, office: seedOffice(on, seed) }
}

// A step read chunk by chunk: the stream stays open between pulls, so the
// stored office can be read while the step is still streaming.
const open = ($: any, over: Record<string, unknown> = {}) => {
  const stream = $.turn.step({
    turnId: 'u1',
    index: 0,
    model: 'claude-fable-5',
    messageCount: 1,
    ...over,
  })
  const chunks: unknown[] = []
  const pull = async (messages: unknown = latest) => {
    latest = messages
    const next = await stream.next()
    if (!next.done) chunks.push(next.value)

    return next
  }
  const drain = async () => {
    let next = await pull()
    while (!next.done) next = await pull()

    return next.value
  }

  return { chunks, pull, drain, stream }
}

const sceneAt = (office: any, slot = ADVISOR, now = 1000): string =>
  sceneOf(office.stored(), slot, now)

// Waits in real time until the advisor scene is the wanted one, polling every
// 5 ms up to 2 s. On a timeout it returns and the assertion that follows fails.
const settled = async (office: any, want: string, slot = ADVISOR) => {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (sceneAt(office, slot) === want) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

// Watches 100 ms in 5 ms steps for the advisor desk to ever work.
const everWorked = async (office: any): Promise<boolean> => {
  for (let waited = 0; waited < 100; waited += 5) {
    if (sceneAt(office) === 'working') return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  return false
}

// Waits until a condition holds, polling every 5 ms up to 2 s.
const until = async (isMet: () => boolean) => {
  for (let waited = 0; waited < 2000 && !isMet(); waited += 5) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const SUBAGENT_SEED = {
  desks: { [RUNNER]: { agentIds: ['a1'] } },
  deskOf: { a1: RUNNER },
  agents: { a1: {} },
}

// S1. A call in progress works the advisor desk

test('S1 the advisor desk works while a server_tool_use advisor has no result, the step still streaming', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  const step = open($)

  await step.pull(USER)
  const before = sceneAt(office)
  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.drain()

  expect([before, during]).toEqual(['idle', 'working'])
})

test('S1 session.messages is asked for the last api message', async ($, on) => {
  setup(on)
  script = [beat(1)]
  const step = open($)

  await step.drain()

  expect(asked.length).toBeGreaterThan(0)
  expect(asked[0]).toMatchObject({ last: 1, as: 'api' })
})

test('S1 an advisor call in progress after text blocks in the same message still works the desk', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1)]
  const step = open($)

  await step.pull(assistant({ type: 'text', text: 'let me ask' }, CALL))
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.drain()

  expect(during).toBe('working')
})

// S2. The result block ends the work, mid-step

test('S2 a later engine chunk with the matching advisor_tool_result sets the desk idle, mid-step', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2), text('after')]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.pull(DONE)
  await settled(office, 'idle')
  const after = sceneAt(office)
  await step.drain()

  expect([during, after]).toEqual(['working', 'idle'])
})

test('S2 any block with the same tool_use_id ends the call, not only advisor_tool_result', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.pull(assistant(CALL, { type: 'other_result', tool_use_id: 'srvtoolu_X' }))
  await settled(office, 'idle')
  const after = sceneAt(office)
  await step.drain()

  expect([during, after]).toEqual(['working', 'idle'])
})

test('S2 a result block for another id does not end the call', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  await step.pull(assistant(CALL, { type: 'advisor_tool_result', tool_use_id: 'srvtoolu_OTHER' }))
  await until(() => asked.length >= 2)
  const stopped = await everWorked(office)
  const after = sceneAt(office)
  await step.drain()

  expect(asked).toHaveLength(2)
  expect([stopped, after]).toEqual([true, 'working'])
})

// S3. The stream is cut short

test('S3 the step ending while the call has no result leaves the advisor desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1)]
  uses = [finished({ endedAt: undefined })]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.drain()
  await settled(office, 'idle')

  expect([during, sceneAt(office)]).toEqual(['working', 'idle'])
})

test('S3 a step that ends with no serverToolUses at all leaves the advisor desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1)]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.drain()
  await settled(office, 'idle')

  expect([during, sceneAt(office)]).toEqual(['working', 'idle'])
})

// S4. A subagent never works the advisor desk

test('S4 a subagent step with the same chunks and messages never works the advisor desk', async ($, on) => {
  const { office } = setup(on, SUBAGENT_SEED)
  script = [beat(1), beat(2)]
  const step = open($, { agentId: 'a1' })

  await step.pull(RUNNING)
  const working = await everWorked(office)
  await step.pull(DONE)
  await step.drain()

  expect(working).toBe(false)
  expect(asked.length).toBe(0)
  expect(sceneAt(office)).toBe('idle')
})

// S5. The step is passed on unchanged

test('S5 every chunk comes out unchanged and in order, and the result is returned unchanged', async ($, on) => {
  const { office } = setup(on)
  script = [text('a'), beat(1), beat(2), text('b'), beat(3), text('c')]
  uses = [finished()]
  const step = open($)

  await step.pull(USER)
  await step.pull(USER)
  await step.pull(RUNNING)
  await step.pull(RUNNING)
  await step.pull(DONE)
  await step.pull(DONE)
  const result = await step.drain()

  expect(step.chunks).toEqual([text('a'), beat(1), beat(2), text('b'), beat(3), text('c')])
  expect(result).toEqual(resultOf(0))
})

// S6. Nothing to show

test('S6 session.messages resolving { deny } leaves the advisor desk idle and the step completes', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  denial = 'not now'
  const step = open($)

  await step.pull()
  await step.pull()
  const working = await everWorked(office)
  const result = await step.drain()

  expect(working).toBe(false)
  expect(step.chunks).toEqual([beat(1), beat(2)])
  expect(result).toEqual(resultOf(0))
})

test('S6 a last message with no advisor call leaves the advisor desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2), beat(3)]
  const step = open($)

  await step.pull(USER)
  await step.pull(assistant({ type: 'text', text: 'just text' }))
  await step.pull(assistant({ type: 'server_tool_use', id: 'srvtoolu_W', name: 'web_search', input: {} }))
  const working = await everWorked(office)
  const result = await step.drain()

  expect(working).toBe(false)
  expect(step.chunks).toEqual([beat(1), beat(2), beat(3)])
  expect(result).toEqual(resultOf(0))
})

test('S6 an empty message list leaves the advisor desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1)]
  const step = open($)

  await step.pull([])
  const working = await everWorked(office)
  await step.drain()

  expect(working).toBe(false)
})

// S7. The end-of-step advice keeps working beside the live look

test('S7 a consultation seen live and finished in the result counts once and poses the manager, the advisor desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  uses = [finished()]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.pull(DONE)
  await step.drain()
  await settled(office, 'idle')
  const idle = sceneAt(office)
  for (let waited = 0; waited < 2000 && sceneAt(office, MANAGER) !== 'advised'; waited += 5) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  expect(office.stored().desks.advisor.count).toBe(1)
  expect(sceneAt(office, MANAGER)).toBe('advised')
  expect(sceneAt(office, MANAGER, 5999)).toBe('advised')
  expect(sceneAt(office, MANAGER, 6000)).toBe('idle')
  expect([during, idle]).toEqual(['working', 'idle'])
})

// S8. The tick draws the working advisor desk

test('S8 while consulting, the tick blits the advisor desk with the working look', async ($, on) => {
  const { office, blits, clock } = setup(on)
  script = [beat(1)]
  const ui = await mountPane($, 'terminal', 54, 'dock', TALL)
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  await clock.advance(1000)
  const mine = blits.filter((one: any) => one.key === 'desk-advisor').map((one: any) => one.cells)
  await step.drain()
  await ui.unmount()

  const working = ([0, 1, 2, 3] as const).map(frame =>
    encodeCells(composeDesk(ADVISOR, 'working', frame)),
  )
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.every((cells: string) => working.includes(cells))).toBe(true)
  expect(sceneAt(office, MANAGER)).not.toBe('working')
})

// D2. Delta chunks never read the messages

test('D2 50 text chunks, 50 thinking chunks and 50 input chunks in a main step trigger no session.messages read', async ($, on) => {
  setup(on)
  script = [
    ...Array.from({ length: 50 }, (_, n) => text(`w${n}`)),
    ...Array.from({ length: 50 }, (_, n) => ({ kind: 'thinking', index: 0, text: `t${n}` })),
    ...Array.from({ length: 50 }, (_, n) => ({ kind: 'input', index: 0, json: `{${n}` })),
  ]
  latest = RUNNING
  const step = open($)

  await step.drain()
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(step.chunks).toHaveLength(150)
  expect(asked.length).toBe(0)
})

// A. The stream ends while consulting

test('A1 the stream beneath throwing while the call runs leaves the advisor desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1)]
  crash = true
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.pull().catch(() => 'threw')
  await settled(office, 'idle')

  expect([during, sceneAt(office)]).toEqual(['working', 'idle'])
})

test('A2 stream.return() at a yield while consulting leaves the desk idle and closes the stream beneath', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  const during = sceneAt(office)
  const before = isClosed
  await step.stream.return(undefined)
  await settled(office, 'idle')
  await until(() => isClosed)

  expect([during, before]).toEqual(['working', false])
  expect(sceneAt(office)).toBe('idle')
  expect(isClosed).toBe(true)
})

for (const how of ['the stream throwing', 'stream.return()'] as const) {
  test(`A3 a read that resolves after ${how} does not set the desk back to working`, async ($, on) => {
    const { office } = setup(on)
    script = [beat(1), beat(2)]
    crash = how === 'the stream throwing'
    const step = open($)

    await step.pull(USER)
    const release = deferred<void>()
    gate = release
    await step.pull(RUNNING)
    await until(() => asked.length >= 2)
    if (crash) {
      await step.pull().catch(() => 'threw')
    } else {
      await step.stream.return(undefined)
    }
    await until(() => isClosed)
    release.resolve()
    const working = await everWorked(office)

    expect(asked).toHaveLength(2)
    expect(working).toBe(false)
    expect(sceneAt(office)).toBe('idle')
  })
}

// B. Several advisor calls in one message

test('B1 a second advisor call with no result works the desk after a finished first one', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1)]
  const step = open($)

  await step.pull(assistant(CALL, RESULT, CALL_2))
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.drain()

  expect(during).toBe('working')
})

test('B1 both calls finished sets the desk idle', async ($, on) => {
  const { office } = setup(on)
  script = [beat(1), beat(2)]
  const step = open($)

  await step.pull(assistant(CALL, RESULT, CALL_2))
  await settled(office, 'working')
  const during = sceneAt(office)
  await step.pull(assistant(CALL, RESULT, CALL_2, RESULT_2))
  await settled(office, 'idle')
  const after = sceneAt(office)
  await step.drain()

  expect([during, after]).toEqual(['working', 'idle'])
})

// C. The status says consulting

for (const count of [0, 1]) {
  const seed = { desks: count === 0 ? {} : { advisor: { agentIds: [], count } }, deskOf: {}, agents: {} }
  const word = count === 0 ? 'consulting' : `${count} · consulting`

  test(`C1 while consulting the pixel status under the advisor desk reads ${word}`, async ($, on) => {
    const { office } = setup(on, seed)
    script = [beat(1)]
    const step = open($)

    await step.pull(RUNNING)
    await settled(office, 'working')
    const ui = await mountPane($, 'terminal', 54, 'dock', TALL)
    const status = await statusOf(ui, ADVISOR)
    await ui.unmount()
    await step.drain()

    expect(status).toBe(word)
  })

  test(`C1 while consulting the text layout line reads advisor: ${word}`, async ($, on) => {
    const { office } = setup(on, seed)
    script = [beat(1)]
    const step = open($)

    await step.pull(RUNNING)
    await settled(office, 'working')
    const rows = await rowsOn($, 'terminal')
    await step.drain()

    expect(rows.at(-1)).toBe(`advisor: ${word}`)
  })
}

// F. Real pane sizes. At 54x40 the nine desks fill three lines of three and the idle guest's seat is
// given to the advisor (drawn, so the tick blits it). At 54x30 and 54x16 the advisor is in the
// roster, listed before the idle desks; a working desk shows as its name, so the entry is
// `advisor consulting` (`advisor 1 consulting` with a count), and plain `advisor` / `advisor 1` after.

test('F1 at 54x40 the advisor sits in the idle guest seat, and while consulting the tick blits it with the working look', async ($, on) => {
  const { office, blits, clock } = setup(on)
  script = [beat(1)]
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const step = open($)

  await step.pull(RUNNING)
  await settled(office, 'working')
  await clock.advance(1000)
  const mine = blits.filter((one: any) => one.key === 'desk-advisor').map((one: any) => one.cells)
  await step.drain()
  await ui.unmount()

  const working = ([0, 1, 2, 3] as const).map(frame =>
    encodeCells(composeDesk(ADVISOR, 'working', frame)),
  )
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.every((cells: string) => working.includes(cells))).toBe(true)
})

for (const rows of [30, 16]) {
  for (const count of [0, 1]) {
    const seed = { desks: count === 0 ? {} : { advisor: { agentIds: [], count } }, deskOf: {}, agents: {} }
    const idle = count === 0 ? 'advisor' : `advisor ${count}`
    const busy = count === 0 ? 'advisor consulting' : `advisor ${count} consulting`

    test(`F2 at 54x${rows} with count ${count} the roster entry reads ${busy} while consulting, then ${idle}`, async ($, on) => {
      const { office } = setup(on, seed)
      script = [beat(1)]
      const step = open($)

      await step.pull(RUNNING)
      await settled(office, 'working')
      const live = await mountPane($, 'terminal', 54, 'dock', rows)
      const during = (await rosterOf(live))?.split('  ')[0]
      await live.unmount()
      await step.drain()
      await settled(office, 'idle')
      const ended = await mountPane($, 'terminal', 54, 'dock', rows)
      const after = (await rosterOf(ended))?.split('  ')[0]
      await ended.unmount()

      expect([during, after]).toEqual([busy, idle])
    })
  }
}
