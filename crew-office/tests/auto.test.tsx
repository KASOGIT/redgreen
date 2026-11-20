import { expect, test } from 'claude-code/testing'

import {
  expectRows,
  expectedRows,
  rowsOn,
  spawn,
  world,
} from './kit'

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const OPEN = { id: 'crew-office', title: 'Crew office', columns: 200 }
const listed = (isPlaced: boolean) => [
  {
    id: 'crew-office',
    title: 'Crew office',
    isShown: isPlaced,
    isFocused: false,
    isPlaced,
  },
]
const LISTED = listed(true)
const LISTED_UNPLACED = listed(false)

const run = ($: any, args: string) =>
  $.command.run({
    command: 'crew-office',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

const ON = { text: 'Crew office on: it opens whenever the crew works.' }
const OFF = {
  text: 'Crew office off: it stays closed until /crew-office on.',
}

// Auto-open: every successful crew spawn, whenever the pane is not listed.

test('two crew spawns in one session open the pane twice when it is never listed', async ($, on) => {
  const { opens, clock } = world(on)

  await spawn($, 'crew:test-runner')
  await clock.settle()
  await spawn($, 'crew:implementer')
  await clock.settle()

  expect(opens).toEqual([OPEN, OPEN])
})

test('a crew spawn opens nothing when the pane is listed', async ($, on) => {
  const { opens, clock } = world(on, { panes: LISTED })

  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([])
  await expectRows($, { 'test-runner': 'working' })
})

test('a crew spawn opens nothing when the pane is listed but not placed', async ($, on) => {
  const { opens, clock } = world(on, { panes: LISTED_UNPLACED })

  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([])
  await expectRows($, { 'test-runner': 'working' })
})

for (const type of ['Explore', 'general-purpose']) {
  test(`a spawn of ${type} opens nothing and the guest works`, async ($, on) => {
    const { opens, clock } = world(on)

    await spawn($, type)
    await clock.settle()

    expect(opens).toEqual([])
    await expectRows($, { guest: 'working' })
  })
}

test('with auto stored false a crew spawn opens nothing and the desk still works', async ($, on) => {
  const { opens, clock } = world(on, { auto: false })

  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([])
  await expectRows($, { 'test-runner': 'working' })
})

test('a denied spawn opens nothing', async ($, on) => {
  const { opens, clock } = world(on, { deny: 'no' })

  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([])
})

test('the setting survives a reload: a stored false still opens nothing', async ($, on) => {
  const { opens, clock } = world(on, { auto: false })

  await $.session.start(SESSION)
  await $.session.start(SESSION)
  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([])
})

test('after off a crew spawn opens nothing, after on again it opens', async ($, on) => {
  const { opens, clock } = world(on)
  await $.session.start(SESSION)

  await run($, 'off')
  const before = opens.length
  await spawn($, 'crew:test-runner')
  await clock.settle()
  expect(opens.length - before).toBe(0)

  await run($, 'on')
  const afterOn = opens.length
  await spawn($, 'crew:implementer')
  await clock.settle()
  expect(opens.slice(afterOn)).toEqual([OPEN])
})

// The command: argument, stored setting, pane calls, answer.

type Case = {
  name: string
  args: string
  seed?: boolean
  listed: boolean
  isUnplaced?: boolean
  open?: unknown
  stored: Record<string, unknown>
  opened: boolean
  closed: boolean
  text: string
}

const CASES: Case[] = [
  { name: 'on from absent, pane not listed', args: 'on', listed: false, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'on from false, pane not listed', args: 'on', seed: false, listed: false, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'on with the pane listed and placed opens nothing', args: 'on', listed: true, stored: { auto: true }, opened: false, closed: false, text: ON.text },
  { name: 'on with the pane listed but not placed opens it', args: 'on', listed: true, isUnplaced: true, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'empty from false with the pane listed but not placed opens it', args: '', seed: false, listed: true, isUnplaced: true, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'empty from false with the pane listed and placed opens nothing', args: '', seed: false, listed: true, stored: { auto: true }, opened: false, closed: false, text: ON.text },
  { name: 'on says why when the pane is not shown yet', args: 'on', listed: false, open: { isPlaced: false, reason: 'narrow' }, stored: { auto: true }, opened: true, closed: false, text: 'Crew office on, not shown yet: narrow' },
  { name: 'on with surrounding spaces and capitals', args: ' ON ', listed: false, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'off closes the listed pane', args: 'off', listed: true, stored: { auto: false }, opened: false, closed: true, text: OFF.text },
  { name: 'off with no pane listed closes nothing', args: 'off', listed: false, stored: { auto: false }, opened: false, closed: false, text: OFF.text },
  { name: 'off with surrounding spaces and capitals', args: '  Off ', listed: true, stored: { auto: false }, opened: false, closed: true, text: OFF.text },
  { name: 'empty from absent behaves as off', args: '', listed: true, stored: { auto: false }, opened: false, closed: true, text: OFF.text },
  { name: 'empty from true behaves as off', args: '', seed: true, listed: true, stored: { auto: false }, opened: false, closed: true, text: OFF.text },
  { name: 'empty from false behaves as on', args: '', seed: false, listed: false, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'spaces alone count as empty', args: '   ', seed: false, listed: false, stored: { auto: true }, opened: true, closed: false, text: ON.text },
  { name: 'an unknown argument changes nothing from absent', args: 'maybe', listed: true, stored: {}, opened: false, closed: false, text: 'Usage: /crew-office [on|off]' },
  { name: 'an unknown argument changes nothing from false', args: 'maybe', seed: false, listed: false, stored: { auto: false }, opened: false, closed: false, text: 'Usage: /crew-office [on|off]' },
]

for (const one of CASES) {
  test(`command: ${one.name}`, async ($, on) => {
    const { opens, closes, store } = world(on, {
      auto: one.seed,
      panes: one.listed ? listed(one.isUnplaced !== true) : [],
      open: one.open,
    })
    await $.session.start(SESSION)
    const before = opens.length

    const out = await run($, one.args)

    expect(out).toEqual({ text: one.text })
    expect(store()).toEqual(one.stored)
    expect(opens.slice(before)).toEqual(one.opened ? [OPEN] : [])
    expect(closes).toEqual(one.closed ? [{ id: 'crew-office', origin: { kind: 'plugin' } }] : [])
  })
}

test('a spawn still returns the stub answer and the row works, whatever the pane does', async ($, on) => {
  const { clock } = world(on, { openThrows: true })

  const out = await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(out).toEqual({ model: 'm', agentId: 'a1' })
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working' }),
  )
})

// A pane call that rejects leaves the command answering and the setting kept.

for (const [name, args, seed] of [
  ['on', 'on', undefined],
  ['empty from false', '', false],
] as const) {
  test(`command: ${name} with ui.open rejecting still answers and keeps auto true`, async ($, on) => {
    const { store } = world(on, { auto: seed, openThrows: true })
    await $.session.start(SESSION)

    const out = await run($, args)

    expect(out.text).toMatch(/^Crew office on, not shown yet: ./)
    expect(store()).toEqual({ auto: true })
  })
}

for (const [name, args, seed] of [
  ['off', 'off', undefined],
  ['empty from true', '', true],
  ['empty from absent', '', undefined],
] as const) {
  test(`command: ${name} with ui.close rejecting still answers and keeps auto false`, async ($, on) => {
    const { store } = world(on, { auto: seed, panes: LISTED, closeThrows: true })
    await $.session.start(SESSION)

    const out = await run($, args)

    expect(out.text).toMatch(/^Crew office off, but the pane is still open: ./)
    expect(store()).toEqual({ auto: false })
  })
}

// An off that lands while an auto-open is in flight must not leave the pane open.

test('a crew spawn whose auto-open lands after off closes the pane it opened', async ($, on) => {
  const { opens, closes, clock } = world(on, {
    afterOpen: stored => {
      stored.auto = false
    },
  })

  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([OPEN])
  expect(closes).toEqual([{ id: 'crew-office', origin: { kind: 'plugin' } }])
})

test('a crew spawn whose auto-open lands with auto still true leaves the pane open', async ($, on) => {
  const { opens, closes, clock } = world(on)

  await spawn($, 'crew:test-runner')
  await clock.settle()

  expect(opens).toEqual([OPEN])
  expect(closes).toEqual([])
})
