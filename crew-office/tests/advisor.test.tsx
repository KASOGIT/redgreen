import { expect, test } from 'claude-code/testing'

import { sceneOf } from '../hooks/model'
import { composeDesk, encodeCells } from '../hooks/scene'
import { PALETTE, SPRITES } from '../hooks/sprites'
import { dim } from '../hooks/scene'
import {
  failWrites,
  finishTurn,
  meterOf,
  mountPane,
  seedOffice,
  startTurn,
  statusOf,
  world,
} from './kit'

// When the main session's turn.step result lists a server tool use named
// advisor with an endedAt, the manager desk shows the look "advised" for 5000
// ms from the end of that step (shown while until > now), with the status
// "advised by <model>" from the advisorModel setting. The clock stands at 1000.

const MANAGER = 'manager'
const RUNNER = 'test-runner'
const CHUNKS = [
  { kind: 'text', index: 0, text: 'first ' },
  { kind: 'text', index: 0, text: 'second' },
]

let uses: unknown[] | undefined

const used = (over: Record<string, unknown> = {}) => ({
  id: 'srv1',
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

type Setup = {
  advisorModel?: string
  refusedSettings?: boolean
  failingWrites?: boolean
  seed?: Record<string, unknown>
  // The settings read answers after this many clock ms, or never.
  readDelay?: number | 'never'
  // clock.after is refused for the 5000 ms expiry wait: that callback never runs.
  deadTimers?: boolean
  // A state that counts its reads and can be made to reject writes.
  ledger?: boolean
}

// A stored office that counts reads and rejects every write while failing.
const ledgerOf = (on: any, seed: Record<string, unknown>) => {
  const box = { stored: seed as any, version: 1, reads: 0, isFailing: false }
  on('state.get', () => {
    box.reads += 1

    return { value: { value: box.stored, version: box.version } }
  })
  on('state.set', (_: any, e: any) => {
    if (box.isFailing || (e.ifVersion !== undefined && e.ifVersion !== box.version)) {
      return { value: { isSet: false, version: box.version } }
    }
    box.stored = e.value
    box.version += 1

    return { value: { isSet: true, version: box.version } }
  })

  return {
    stored: () => box.stored,
    reads: () => box.reads,
    fail: (isFailing: boolean) => {
      box.isFailing = isFailing
    },
  }
}

const EMPTY = { desks: {}, deskOf: {}, agents: {} }

const setup = (
  on: any,
  { advisorModel, refusedSettings, failingWrites, seed = EMPTY, readDelay, deadTimers, ledger }: Setup = {},
) => {
  uses = undefined
  const { clock, blits, listCalls } = world(
    deadTimers
      ? ((name: string, ...rest: unknown[]) =>
          name === 'clock.after'
            ? on('clock.after', (...args: any[]) =>
                // only the expiry's own wait (5000 ms) is refused
                args[1]?.ms === 5000 ? Promise.reject(new Error('refused')) : (rest[0] as any)(...args),
              )
            : (on as any)(name, ...rest)) as any
      : on,
  )
  on('turn.step', async function* (_: any, e: any) {
    yield CHUNKS[0]
    yield CHUNKS[1]

    return resultOf(e.index)
  })
  const answer = { value: advisorModel === undefined ? {} : { advisorModel } }
  on('settings.read', () =>
    refusedSettings
      ? Promise.reject(new Error('refused'))
      : readDelay === 'never'
        ? new Promise(() => {})
        : readDelay === undefined
          ? answer
          : clock.sleep(readDelay).then(() => answer),
  )
  on('classic.SessionStart', () => ({}))
  if (failingWrites) {
    on('state.get', () => ({ value: { value: seed, version: 1 } }))
    failWrites(on)

    return { clock, blits, listCalls, office: undefined }
  }

  return { clock, blits, listCalls, office: ledger ? ledgerOf(on, seed) : seedOffice(on, seed) }
}

// Waits in real time until the hooks have stored the advised pose, polling up to 2 s.
// On a timeout it returns and the assertion that follows fails on its own.
const posedBy = async (office: any, now = 1000) => {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (sceneOf(office.stored(), MANAGER, now) === 'advised') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const textRow = async (ui: any): Promise<string> =>
  (await ui.findAll({ type: 'Text' }))[0]?.text

const step = async ($: any, over: Record<string, unknown> = {}) => {
  const stream = $.turn.step({
    turnId: 'u1',
    index: 0,
    model: 'claude-fable-5',
    messageCount: 1,
    ...over,
  })
  const chunks: unknown[] = []
  let next = await stream.next()
  while (!next.done) {
    chunks.push(next.value)
    next = await stream.next()
  }

  return { chunks, result: next.value }
}

const advise = async ($: any, list: unknown[] = [used()], over: Record<string, unknown> = {}) => {
  uses = list

  return step($, over)
}

const sceneAt = (office: any, now: number, slot = MANAGER): string =>
  sceneOf(office.stored(), slot, now)

const raster = async (ui: any, slot = MANAGER): Promise<string | undefined> =>
  (await ui.findAll({ type: 'Raster' })).find((one: any) => one.key === `desk-${slot}`)?.props
    .cells

// composeDesk with the new look, so an unknown look still reports as a failed
// assertion, never as a throw.
const posed = (frame: 0 | 1 | 2 | 3, scale: 1 | 2 = 1): number[] => {
  try {
    return composeDesk(MANAGER, 'advised' as any, frame, scale)
  } catch {
    return []
  }
}

const robePixels = (words: number[]): number => {
  const robe = new Set([PALETTE.u, PALETTE.U])
  let count = 0
  for (let at = 0; at < words.length; at += 3) {
    const [char, top, bottom] = [words[at], words[at + 1]!, words[at + 2]!]
    if (char === 0x2580) count += Number(robe.has(top)) + Number(robe.has(bottom))
    else if (char === 0x2584) count += Number(robe.has(top))
  }

  return count
}

const ownFrames = (scale: 1 | 2): number[][] => [
  composeDesk(MANAGER, 'idle', 0, scale),
  ...([0, 1, 2, 3] as const).map(frame => composeDesk(MANAGER, 'working', frame, scale)),
]

// 1. The scene

test('after an advisor step the manager scene is advised for 5000 ms, not at exactly 5000', async ($, on) => {
  const { office } = setup(on, { advisorModel: 'fable' })
  await advise($)

  expect([999, 1000, 5999, 6000, 7000].map(now => sceneAt(office!, now))).toEqual([
    'advised',
    'advised',
    'advised',
    'idle',
    'idle',
  ])
})

for (const scale of [1, 2] as const) {
  test(`the pane draws the advised art at scale ${scale}`, async ($, on) => {
    setup(on, { advisorModel: 'fable' })
    await advise($)

    const ui = await (scale === 1
      ? mountPane($, 'terminal', 54, 'dock', 40)
      : mountPane($, 'terminal', 200, 'dock', 60))
    const cells = await raster(ui)
    await ui.unmount()

    const poses = ([0, 1] as const).map(frame => encodeCells(posed(frame, scale)))
    expect(poses.includes(cells as string)).toBe(true)
  })
}

// 2. The art

for (const scale of [1, 2] as const) {
  test(`advised art at scale ${scale}: full size, two poses, none of the manager's own frames`, () => {
    const frames = ([0, 1, 2, 3] as const).map(frame => posed(frame, scale))
    const size = scale * 16 * ((scale * 16) / 2) * 3

    expect(frames.map(one => one.length)).toEqual([size, size, size, size])
    expect(frames[0]).not.toEqual(frames[1])
    expect(frames[0]).toEqual(frames[2])
    expect(frames[1]).toEqual(frames[3])
    for (const own of ownFrames(scale)) {
      expect(frames[0]).not.toEqual(own)
      expect(frames[1]).not.toEqual(own)
    }
  })
}

test('each advised pose holds at least 8 robe pixels, the manager frames hold none', () => {
  expect(robePixels(posed(0))).toBeGreaterThanOrEqual(8)
  expect(robePixels(posed(1))).toBeGreaterThanOrEqual(8)
  for (const own of ownFrames(1)) expect(robePixels(own)).toBe(0)
  expect(dim(PALETTE.u!)).not.toBe(PALETTE.u)
})

test('the manager sprite itself uses no robe colour', () => {
  const art = [SPRITES[MANAGER]!.idle, ...([0, 1, 2, 3] as const).map(f => SPRITES[MANAGER]![`work${f}`])]

  expect(art.flat().join('')).not.toMatch(/[uU]/)
})

// 3. The status line

for (const [setting, text] of [
  ['fable', 'advised by fable'],
  ['claude-fable-5-2', 'advised by fable'],
  ['opus', 'advised by opus'],
  [undefined, 'advised'],
  ['sonnet', 'advised by sonn…'],
] as const) {
  test(`with advisorModel ${setting} the status reads ${text}`, async ($, on) => {
    setup(on, { advisorModel: setting })
    await advise($)

    const ui = await mountPane($, 'terminal', 54, 'dock', 40)
    const status = await statusOf(ui, MANAGER)
    await ui.unmount()

    expect(status).toBe(text)
  })
}

test('with a refused settings read the status reads advised', async ($, on) => {
  setup(on, { refusedSettings: true })
  await advise($)

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const status = await statusOf(ui, MANAGER)
  await ui.unmount()

  expect(status).toBe('advised')
})

// 4. The end of the pose

test('after 5 s the desk draws the idle art and status with no new event, the manager turn over (its done mark ends at the same time)', async ($, on) => {
  const { clock } = setup(on, { advisorModel: 'fable' })
  await startTurn($)
  await advise($)
  await finishTurn($, 'answer')
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const during = await statusOf(ui, MANAGER)

  await clock.advance(3000)
  const midway = await statusOf(ui, MANAGER)
  await clock.advance(3000)
  const after = await statusOf(ui, MANAGER)
  const cells = await raster(ui)
  await ui.unmount()

  expect([during, midway]).toEqual(['advised by fable', 'advised by fable'])
  expect(after).toBe('idle')
  expect(cells).toBe(encodeCells(composeDesk(MANAGER, 'idle', 0)))
})

test('after 5 s an idle manager draws the idle art and the idle status with no new event', async ($, on) => {
  const { clock } = setup(on, { advisorModel: 'fable' })
  await advise($)
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const during = await statusOf(ui, MANAGER)

  await clock.advance(6000)
  const after = await statusOf(ui, MANAGER)
  const cells = await raster(ui)
  await ui.unmount()

  expect([during, after]).toEqual(['advised by fable', 'idle'])
  expect(cells).toBe(encodeCells(composeDesk(MANAGER, 'idle', 0)))
})

// 5. No pose

const NONE: Array<[string, unknown[] | undefined, Record<string, unknown>]> = [
  ['a server tool with another name', [used({ name: 'web_search' })], {}],
  ['an advisor entry without endedAt', [used({ endedAt: undefined })], {}],
  ['no serverToolUses', undefined, {}],
  ['an empty serverToolUses', [], {}],
  ['a subagent step listing advisor', [used()], { agentId: 'a1' }],
]

for (const [name, list, over] of NONE) {
  test(`no pose for ${name}`, async ($, on) => {
    const { office } = setup(on, {
      advisorModel: 'fable',
      seed: { desks: { [RUNNER]: { agentIds: ['a1'] } }, deskOf: { a1: RUNNER }, agents: { a1: {} } },
    })
    uses = list
    await step($, over)

    expect(sceneAt(office!, 1000)).not.toBe('advised')
    expect(sceneAt(office!, 1000, RUNNER)).not.toBe('advised')
    const ui = await mountPane($, 'terminal', 54, 'dock', 40)
    const status = await statusOf(ui, MANAGER)
    await ui.unmount()

    expect(status).toBe('idle')
  })
}

// 6. A second call restarts the 5 s from the end of its step

test('a second advisor call during the pose restarts the 5 s from the end of its step', async ($, on) => {
  const { office, clock } = setup(on, { advisorModel: 'fable' })
  await advise($)
  await clock.advance(3000)
  await advise($, [used({ id: 'srv2', startedAt: 3500, endedAt: 4000 })], { index: 1 })

  expect([5999, 8999, 9000].map(now => sceneAt(office!, now))).toEqual([
    'advised',
    'advised',
    'idle',
  ])
})

// 7. Whatever the look under it

const MAIN_NOTE = { model: 'claude-fable-5', started: -2000 }
const LOOKS: Array<[string, Record<string, unknown>]> = [
  ['working', { desks: { [MANAGER]: { agentIds: ['main'] } }, deskOf: { main: MANAGER }, agents: { main: MAIN_NOTE } }],
  [
    'waiting',
    {
      desks: { [MANAGER]: { agentIds: ['main'] } },
      deskOf: { main: MANAGER },
      agents: { main: { ...MAIN_NOTE, status: 'waiting' } },
    },
  ],
  ['done', { desks: { [MANAGER]: { agentIds: [], mark: 'done', until: 9000 } }, deskOf: {}, agents: {} }],
  ['idle', EMPTY],
]

for (const [look, seed] of LOOKS) {
  test(`the pose shows over a ${look} manager`, async ($, on) => {
    const { office } = setup(on, { advisorModel: 'fable', seed })
    await advise($)

    expect(sceneAt(office!, 1000)).toBe('advised')
    const ui = await mountPane($, 'terminal', 54, 'dock', 40)
    const status = await statusOf(ui, MANAGER)
    await ui.unmount()

    expect(status).toBe('advised by fable')
  })
}

// 8. The meter is unchanged

test('the meter line under the desk is the same with and without the pose', async ($, on) => {
  setup(on, {
    advisorModel: 'fable',
    seed: { desks: { [MANAGER]: { agentIds: ['main'] } }, deskOf: { main: MANAGER }, agents: { main: MAIN_NOTE } },
  })
  await step($)
  const before = mountPane($, 'terminal', 200, 'dock', 60)
  const ui1 = await before
  const plain = await meterOf(ui1, MANAGER)
  await ui1.unmount()

  await advise($, [used()], { index: 1 })
  const ui2 = await mountPane($, 'terminal', 200, 'dock', 60)
  const status = await statusOf(ui2, MANAGER)
  const posedMeter = await meterOf(ui2, MANAGER)
  await ui2.unmount()

  expect(plain).toBe('fable · 3s')
  expect(status).toBe('advised by fable')
  expect(posedMeter).toBe('fable · 3s')
})

// 9. /clear

test('a clear session removes a running pose', async ($, on) => {
  const { office } = setup(on, { advisorModel: 'fable' })
  await advise($)
  expect(sceneAt(office!, 1000)).toBe('advised')

  await $.classic.SessionStart({ source: 'clear' })

  expect(sceneAt(office!, 1000)).toBe('idle')
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const status = await statusOf(ui, MANAGER)
  await ui.unmount()

  expect(status).toBe('idle')
})

// 10. Pass-through

test('the step passes both chunks in order and its result unchanged, with a pose', async ($, on) => {
  setup(on, { advisorModel: 'fable' })

  const { chunks, result } = await advise($)

  expect(chunks).toEqual(CHUNKS)
  expect(result).toEqual(resultOf(0))
  expect(result.serverToolUses).toEqual([used()])
})

test('a rejected state write leaves the chunks and the result unchanged', async ($, on) => {
  setup(on, { advisorModel: 'fable', failingWrites: true })

  const { chunks, result } = await advise($)

  expect(chunks).toEqual(CHUNKS)
  expect(result).toEqual(resultOf(0))
})

test('a rejected settings read leaves the chunks and the result unchanged', async ($, on) => {
  setup(on, { refusedSettings: true })

  const { chunks, result } = await advise($)

  expect(chunks).toEqual(CHUNKS)
  expect(result).toEqual(resultOf(0))
})

// A. The pose ends even when its expiry fails

for (const [name, options] of [
  ['the expiry state write rejects', { ledger: true }],
  ['clock.after is refused for the expiry', { ledger: true, deadTimers: true }],
] as const) {
  test(`${name}: the status and art are normal from 6 s and the ticker stops`, async ($, on) => {
    const { office, clock, listCalls } = setup(on, { advisorModel: 'fable', ...options })
    await advise($)
    await posedBy(office)
    const ui = await mountPane($, 'terminal', 54, 'dock', 40)
    const during = await statusOf(ui, MANAGER)

    if (!options.deadTimers) office!.fail(true)
    await clock.advance(6000)
    const after = await statusOf(ui, MANAGER)
    const cells = await raster(ui)
    await clock.advance(2000)
    await ui.unmount()
    const calls = listCalls()
    await clock.advance(30000)

    expect([during, after]).toEqual(['advised by fable', 'idle'])
    expect(cells).toBe(encodeCells(composeDesk(MANAGER, 'idle', 0)))
    expect(listCalls()).toBe(calls)
  })
}

// B. The 5 s count from the end of the step, whatever settings.read does

test('a settings read answering after 2 s: advised at once, 5 s from the step end, the model joins during the pose', async ($, on) => {
  const { office, clock } = setup(on, { advisorModel: 'fable', readDelay: 2000 })
  const stepping = advise($)
  await posedBy(office)
  const early = sceneAt(office!, 1000)
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const first = await statusOf(ui, MANAGER)

  await clock.advance(2000)
  const second = await statusOf(ui, MANAGER)
  await clock.advance(3000)
  const last = await statusOf(ui, MANAGER)
  await ui.unmount()
  await stepping

  expect(early).toBe('advised')
  expect([first, second, last]).toEqual(['advised', 'advised by fable', 'idle'])
  expect([5999, 6000].map(now => sceneAt(office!, now))).toEqual(['advised', 'idle'])
})

test('a settings read that never answers: the pose shows as advised and ends on time', async ($, on) => {
  const { office, clock } = setup(on, { advisorModel: 'fable', readDelay: 'never' })
  const stepping = advise($)
  await posedBy(office)
  const early = sceneAt(office!, 1000)
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const first = await statusOf(ui, MANAGER)

  await clock.advance(6000)
  const last = await statusOf(ui, MANAGER)
  await ui.unmount()
  await stepping

  expect(early).toBe('advised')
  expect([first, last]).toEqual(['advised', 'idle'])
})

test('a settings read answering after the pose ended brings no pose back', async ($, on) => {
  const { office, clock } = setup(on, { advisorModel: 'fable', readDelay: 7000 })
  const stepping = advise($)
  await posedBy(office)
  const early = sceneAt(office!, 1000)
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)

  await clock.advance(7500)
  await stepping
  await clock.advance(1000)
  const status = await statusOf(ui, MANAGER)
  await ui.unmount()

  expect(early).toBe('advised')
  expect(sceneAt(office!, 8500)).toBe('idle')
  expect(status).toBe('idle')
})

// C. The text layout

for (const [columns, rows] of [
  [17, 40],
  [54, 11],
] as const) {
  test(`the text layout (${columns} columns, ${rows} rows) reads the manager row advised, then normal`, async ($, on) => {
    const { clock } = setup(on, { advisorModel: 'fable' })
    await advise($)
    const ui = await mountPane($, 'terminal', columns, 'dock', rows)
    const during = await textRow(ui)

    await clock.advance(6000)
    const after = await textRow(ui)
    await ui.unmount()

    expect([during, after]).toEqual(['manager: advised by fable', 'manager: idle'])
  })
}

// D. A restart holds past the first timer

test('a second consultation at +4000 keeps the pose on past the first timer, until +9000', async ($, on) => {
  const { office, clock } = setup(on, { advisorModel: 'fable' })
  await advise($)
  await clock.advance(3000)
  await advise($, [used({ id: 'srv2', startedAt: 3500, endedAt: 4000 })], { index: 1 })
  await clock.advance(2500)

  const ui = await mountPane($, 'terminal', 54, 'dock', 40)
  const status = await statusOf(ui, MANAGER)
  await ui.unmount()

  expect(status).toBe('advised by fable')
  expect([8999, 9000].map(now => sceneAt(office!, now))).toEqual(['advised', 'idle'])
})

// E. The ticker stops once the pose is over

test('after the pose ends with nothing working the ticker stops: no agent list poll at 7000', async ($, on) => {
  const { clock, listCalls } = setup(on, { advisorModel: 'fable' })
  await advise($)
  // The expiry runs at 6000. The agent list is polled every 2 s of ticks, at 5000
  // and 7000: a ticker that stopped with the expiry makes no poll at 7000.
  await clock.advance(5000)
  const calls = listCalls()

  await clock.advance(1500)

  expect(listCalls()).toBe(calls)
})

// F. A resumed session re-arms the expiry

test('a resumed session with a pose in state ends it on time and stops the ticker', async ($, on) => {
  const { office, clock, listCalls } = setup(on, {
    ledger: true,
    seed: { ...EMPTY, advisor: { until: 6000, model: 'fable' } },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  const gone = (office!.stored() as any).advisor
  const calls = listCalls()
  await clock.advance(1500)

  expect(gone).toBeUndefined()
  expect(listCalls()).toBe(calls)
})

// G. The tick blits the advised art of an idle manager

test('an idle manager in the advised pose is blitted by the tick, the two poses alternating', async ($, on) => {
  const { blits, clock } = setup(on, { advisorModel: 'fable' })
  await advise($)
  const ui = await mountPane($, 'terminal', 54, 'dock', 40)

  await clock.advance(1000)
  await ui.unmount()

  const mine = blits.filter((one: any) => one.key === 'desk-manager').map((one: any) => one.cells)
  expect(mine).toEqual([encodeCells(posed(1)), encodeCells(posed(2))])
  expect(mine[0]).not.toBe(mine[1])
})
