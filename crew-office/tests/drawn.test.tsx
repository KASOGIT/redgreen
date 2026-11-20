import { expect, test } from 'claude-code/testing'

import { mountPane, spawn, world } from './kit'

// Claude Code can report the pane placed and shown and never call the pane's
// ui.render hook. The mod says so once 2000 ms have passed since it opened the
// pane (or since it loaded, when it did not open it) with no draw.

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const row = (isPlaced: boolean, isShown: boolean) => [
  {
    id: 'crew-office',
    title: 'Crew office',
    isShown,
    isFocused: false,
    isPlaced,
  },
]
const SHOWN = row(true, true)

const run = ($: any, args: string) =>
  $.command.run({
    command: 'crew-office',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

const ON = 'Crew office on: it opens whenever the crew works.'
const OFF = 'Crew office off: it stays closed until /crew-office on.'
const NOT_DRAWN_ON =
  'Crew office on, but this session is not drawing it: Claude Code reports the pane placed and shown and has never drawn it. Try a new session.'
const NOT_DRAWN_OFF =
  'Crew office off. Note: this session never drew the pane, although Claude Code reported it placed and shown. Try a new session.'

// The pane as the host lists it: there from an open to the next close.
const hostPanes = () => {
  const held: { w?: ReturnType<typeof world> } = {}
  const panes = () =>
    held.w !== undefined && held.w.opens.length > held.w.closes.length
      ? SHOWN
      : []

  return { held, panes }
}

const draw = async ($: any) => {
  const ui = await mountPane($, 'terminal', 54)
  await ui.unmount()
}

// /crew-office on

test('on, with the pane placed and shown and never drawn for 2000 ms, says so and keeps auto true', async ($, on) => {
  const { clock, store } = world(on, { panes: SHOWN })
  await $.session.start(SESSION)

  await clock.advance(2000)
  const out = await run($, 'on')

  expect(out).toEqual({ text: NOT_DRAWN_ON })
  expect(store().auto).toBe(true)
})

test('on, 1999 ms after the load with no draw, answers the normal text', async ($, on) => {
  const { clock } = world(on, { panes: SHOWN })
  await $.session.start(SESSION)

  await clock.advance(1999)

  expect(await run($, 'on')).toEqual({ text: ON })
})

test('on, with the pane drawn once, answers the normal text after 2000 ms', async ($, on) => {
  const { clock } = world(on, { panes: SHOWN })
  await $.session.start(SESSION)

  await draw($)
  await clock.advance(5000)

  expect(await run($, 'on')).toEqual({ text: ON })
})

for (const [name, panes] of [
  ['not shown', row(true, false)],
  ['not placed', row(false, true)],
  ['neither placed nor shown', row(false, false)],
] as const) {
  test(`on, with the pane listed ${name} and never drawn for 2000 ms, answers the normal text`, async ($, on) => {
    const { clock } = world(on, { panes })
    await $.session.start(SESSION)

    await clock.advance(2000)

    expect(await run($, 'on')).toEqual({ text: ON })
  })
}

test('on, with no pane listed, opens it and answers the normal text', async ($, on) => {
  const { clock, opens } = world(on)
  await $.session.start(SESSION)

  await clock.advance(5000)

  expect(await run($, 'on')).toEqual({ text: ON })
  expect(opens).toHaveLength(1)
})

// /crew-office off, and the bare command that turns the office off

for (const args of ['off', ''] as const) {
  const name = args === '' ? 'the bare command that turns it off' : 'off'

  test(`${name}, with the pane never drawn for 2000 ms, closes it, sets auto false and says so`, async ($, on) => {
    const { clock, closes, store } = world(on, { panes: SHOWN })
    await $.session.start(SESSION)

    await clock.advance(2000)
    const out = await run($, args)

    expect(out).toEqual({ text: NOT_DRAWN_OFF })
    expect(closes.map((one: any) => one.id)).toEqual(['crew-office'])
    expect(store().auto).toBe(false)
  })

  test(`${name}, 1999 ms after the load with no draw, answers the normal text`, async ($, on) => {
    const { clock, closes, store } = world(on, { panes: SHOWN })
    await $.session.start(SESSION)

    await clock.advance(1999)

    expect(await run($, args)).toEqual({ text: OFF })
    expect(closes.map((one: any) => one.id)).toEqual(['crew-office'])
    expect(store().auto).toBe(false)
  })

  test(`${name}, with the pane drawn once, answers the normal text`, async ($, on) => {
    const { clock } = world(on, { panes: SHOWN })
    await $.session.start(SESSION)

    await draw($)
    await clock.advance(5000)

    expect(await run($, args)).toEqual({ text: OFF })
  })
}

for (const [name, panes] of [
  ['not shown', row(true, false)],
  ['not placed', row(false, true)],
] as const) {
  test(`off, with the pane listed ${name} and never drawn for 2000 ms, answers the normal text`, async ($, on) => {
    const { clock } = world(on, { panes })
    await $.session.start(SESSION)

    await clock.advance(2000)

    expect(await run($, 'off')).toEqual({ text: OFF })
  })
}

test('off, with no pane listed, answers the normal text', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)

  await clock.advance(5000)

  expect(await run($, 'off')).toEqual({ text: OFF })
})

// The draw count belongs to one opening.

test('a draw before a close does not count for the next opening', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  expect(await run($, 'on')).toEqual({ text: ON })
  await draw($)
  await held.w.clock.advance(3000)
  expect(await run($, 'off')).toEqual({ text: OFF })
  expect(await run($, 'on')).toEqual({ text: ON })

  await held.w.clock.advance(2000)

  expect(await run($, 'on')).toEqual({ text: NOT_DRAWN_ON })
})

// An auto-open at a spawn is an opening.

test('a crew spawn that opens the pane starts the 2000 ms: on then warns', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  await spawn($, 'crew:test-runner')
  await held.w.clock.settle()
  await held.w.clock.advance(2000)

  expect(held.w.opens).toHaveLength(1)
  expect(await run($, 'on')).toEqual({ text: NOT_DRAWN_ON })
})

test('the 2000 ms count from the open, not from the load', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)
  await held.w.clock.advance(5000)

  await spawn($, 'crew:test-runner')
  await held.w.clock.settle()
  await held.w.clock.advance(1999)
  expect(await run($, 'on')).toEqual({ text: ON })

  await held.w.clock.advance(1)
  expect(await run($, 'on')).toEqual({ text: NOT_DRAWN_ON })
})

test('a crew spawn that opens the pane, then a draw, answers the normal text', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  await spawn($, 'crew:test-runner')
  await held.w.clock.settle()
  await draw($)
  await held.w.clock.advance(5000)

  expect(await run($, 'on')).toEqual({ text: ON })
})

// A draw made while the open is still pending counts for that opening.

test('on opens the pane and a draw inside the open counts: on answers the normal text after 2000 ms', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes, afterOpen: () => draw($) })
  await $.session.start(SESSION)

  expect(await run($, 'on')).toEqual({ text: ON })
  await held.w.clock.advance(2000)

  expect(held.w.opens).toHaveLength(1)
  expect(await run($, 'on')).toEqual({ text: ON })
})

test('on opens the pane and a draw inside the open counts: off answers the normal text after 2000 ms', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes, afterOpen: () => draw($) })
  await $.session.start(SESSION)

  expect(await run($, 'on')).toEqual({ text: ON })
  await held.w.clock.advance(2000)

  expect(await run($, 'off')).toEqual({ text: OFF })
})

test('a crew spawn opens the pane and a draw inside the open counts: on answers the normal text after 2000 ms', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes, afterOpen: () => draw($) })
  await $.session.start(SESSION)

  await spawn($, 'crew:test-runner')
  await held.w.clock.settle()
  await held.w.clock.advance(2000)

  expect(held.w.opens).toHaveLength(1)
  expect(await run($, 'on')).toEqual({ text: ON })
})

// A repeated session.start, the only reload the kit can raise: it keeps the
// module and its state, so it stands for a reload with the pane kept open.

test('after a repeated session.start, a pane opened by on and drawn answers the normal text', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  await run($, 'on')
  await draw($)
  await $.session.start(SESSION)
  await held.w.clock.advance(2000)

  expect(await run($, 'on')).toEqual({ text: ON })
})

test('after a repeated session.start, a pane opened by on and drawn answers the normal off text', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  await run($, 'on')
  await draw($)
  await $.session.start(SESSION)
  await held.w.clock.advance(2000)

  expect(await run($, 'off')).toEqual({ text: OFF })
})

test('after a repeated session.start, a pane opened and never drawn warns 2000 ms later', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  await run($, 'on')
  await $.session.start(SESSION)
  await held.w.clock.advance(2000)

  expect(await run($, 'on')).toEqual({ text: NOT_DRAWN_ON })
})

test('a pane opened before a repeated session.start and never drawn warns 2000 ms after the second start', async ($, on) => {
  const { held, panes } = hostPanes()
  held.w = world(on, { panes })
  await $.session.start(SESSION)

  await run($, 'on')
  await held.w.clock.advance(1500)
  await $.session.start(SESSION)
  await held.w.clock.advance(2000)

  expect(await run($, 'on')).toEqual({ text: NOT_DRAWN_ON })
})

// A session.start asks for a redraw, and a pane the engine redraws is drawn.

// The pane is mounted (drawn once), then the mod opens it unlisted: a new
// opening with nothing drawn, while the kit still holds the mounted pane.
const mountedThenReopened = async ($: any, on: any) => {
  let isListed = false
  const w = world(on, { panes: () => (isListed ? SHOWN : []) })
  await $.session.start(SESSION)
  const ui = await mountPane($, 'terminal', 54)

  expect(await run($, 'on')).toEqual({ text: ON })
  isListed = true

  return { w, ui }
}

test('a session.start after the open redraws the mounted pane: on answers the normal text 2000 ms later', async ($, on) => {
  const { w, ui } = await mountedThenReopened($, on)

  await $.session.start(SESSION)
  await w.clock.advance(2000)

  expect(await run($, 'on')).toEqual({ text: ON })
  await ui.unmount()
})

test('without a session.start after the open, the mounted pane is not redrawn: on warns 2000 ms later', async ($, on) => {
  const { w, ui } = await mountedThenReopened($, on)

  await w.clock.advance(2000)

  expect(await run($, 'on')).toEqual({ text: NOT_DRAWN_ON })
  await ui.unmount()
})
