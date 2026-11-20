import type { SessionRateLimit } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { headerText } from '../hooks/model'
import { agentInfo, headerOf, mountPane, seedOffice, sessionUsage, spawn, world } from './kit'

// Spec: the header reads `N working · N done · ctx N% · 5h N% · 7d N% · ~$X.XX`.
// 5h is the five_hour rate limit, 7d the seven_day one, percent rounded like
// ctx; a window the session does not report shows no segment; spend_limit is
// never shown. A narrow pane drops segments from the end: `~$`, then 7d, 5h, ctx.
// Expected strings are the requirement's literals or counted out by hand.

const EMPTY = { desks: {}, deskOf: {} }

const FIVE = { kind: 'five_hour', percentUsed: 42.4 }
const SEVEN = { kind: 'seven_day', percentUsed: 17.6 }
const SPEND = { kind: 'spend_limit', percentUsed: 63 }

// A session with one running implementer and the poll that has run once: the
// header the pane draws at this width, read back from the mounted pane.
const headerAfterPoll = async (
  $: any,
  on: any,
  rateLimits: SessionRateLimit[],
  bodyColumns = 100,
  bodyRows = 80,
) => {
  const { clock } = world(on, {
    agents: [agentInfo('a1', 'crew:implementer', 'running')],
    usage: sessionUsage(40, 1.5, rateLimits),
  })
  seedOffice(on, EMPTY)
  await spawn($, 'crew:implementer')
  await clock.advance(2000)
  await clock.settle()
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
  const text = await headerOf(ui)
  await ui.unmount()

  return text
}

test('the polled five_hour and seven_day limits sit between ctx and the cost, rounded', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SEVEN])).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · 7d 18% · ~$1.50',
  )
})

test('limits listed in the other order still read 5h then 7d', async ($, on) => {
  expect(await headerAfterPoll($, on, [SEVEN, FIVE])).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · 7d 18% · ~$1.50',
  )
})

test('a resetsAt on a limit changes nothing in the header', async ($, on) => {
  const five = { ...FIVE, resetsAt: '2026-11-20T18:00:00Z' }

  expect(await headerAfterPoll($, on, [five, SEVEN])).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · 7d 18% · ~$1.50',
  )
})

test('no rate limits leaves the header as it was', async ($, on) => {
  expect(await headerAfterPoll($, on, [])).toBe('1 working · 0 done · ctx 40% · ~$1.50')
})

test('only the five_hour window shows 5h and no 7d', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE])).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · ~$1.50',
  )
})

test('only the seven_day window shows 7d and no 5h', async ($, on) => {
  expect(await headerAfterPoll($, on, [SEVEN])).toBe(
    '1 working · 0 done · ctx 40% · 7d 18% · ~$1.50',
  )
})

test('the spend_limit between the two windows is never shown', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SPEND, SEVEN])).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · 7d 18% · ~$1.50',
  )
})

test('a spend_limit alone adds no segment', async ($, on) => {
  expect(await headerAfterPoll($, on, [SPEND])).toBe('1 working · 0 done · ctx 40% · ~$1.50')
})

test('a limit at exactly 0 percent still shows its segment', async ($, on) => {
  expect(await headerAfterPoll($, on, [{ kind: 'five_hour', percentUsed: 0 }, SEVEN])).toBe(
    '1 working · 0 done · ctx 40% · 5h 0% · 7d 18% · ~$1.50',
  )
})

// The full line is 55 columns, without the cost 46, without 7d 37, without 5h
// 28 and without ctx 18, counted by hand.

test('at 54 columns the cost goes first', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SEVEN], 54, 40)).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · 7d 18%',
  )
})

test('at 45 columns 7d goes next', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SEVEN], 45, 40)).toBe(
    '1 working · 0 done · ctx 40% · 5h 42%',
  )
})

test('at 36 columns 5h goes next', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SEVEN], 36, 40)).toBe(
    '1 working · 0 done · ctx 40%',
  )
})

test('at 27 columns ctx goes last of the optional segments', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SEVEN], 27, 40)).toBe('1 working · 0 done')
})

test('the full line fits at exactly 55 columns', async ($, on) => {
  expect(await headerAfterPoll($, on, [FIVE, SEVEN], 55, 40)).toBe(
    '1 working · 0 done · ctx 40% · 5h 42% · 7d 18% · ~$1.50',
  )
})

test('state saved by the previous version renders with no 5h or 7d segment', async ($, on) => {
  world(on)
  seedOffice(on, { ...EMPTY, usage: { percent: 40, usd: 1.5 } })
  const ui = await mountPane($, 'terminal', 100, 'dock', 80)
  const text = await headerOf(ui)
  await ui.unmount()

  expect(text).toBe('0 working · 0 done · ctx 40% · ~$1.50')
})

test('headerText on a previous-version usage draws no 5h or 7d segment', () => {
  const office = { ...EMPTY, usage: { percent: 40, usd: 1.5 } }

  expect(headerText(office, 100)).toBe('0 working · 0 done · ctx 40% · ~$1.50')
})

test('a later poll without the five_hour window drops 5h from the header and from the saved usage', async ($, on) => {
  const answers = [[FIVE, SEVEN], [SEVEN]]
  const { clock } = world(on, {
    agents: [agentInfo('a1', 'crew:implementer', 'running')],
    usageByCall: async call => sessionUsage(40, 1.5, answers[call - 1] ?? [SEVEN]),
  })
  const { stored } = seedOffice(on, EMPTY)
  await spawn($, 'crew:implementer')
  const drawn = async () => {
    const ui = await mountPane($, 'terminal', 100, 'dock', 80)
    const text = await headerOf(ui)
    await ui.unmount()

    return text
  }

  await clock.advance(2000)
  await clock.settle()
  expect(await drawn()).toBe('1 working · 0 done · ctx 40% · 5h 42% · 7d 18% · ~$1.50')

  await clock.advance(2000)
  await clock.settle()

  expect(await drawn()).toBe('1 working · 0 done · ctx 40% · 7d 18% · ~$1.50')
  expect(stored().usage).not.toHaveProperty('fiveHour')
})
