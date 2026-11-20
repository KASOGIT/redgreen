import { expect, test } from 'claude-code/testing'

import { gridOf, mountPane, spawn, world } from './kit'

// Spec, S3 tick: it blits only the desks the last render drew; a working desk
// that was not drawn causes one invalidate and never the text-list fallback.

test('four working desks in a pane that holds three: the tick blits the three drawn and asks for one redraw', async ($, on) => {
  const { blits, invalidations, clock } = world(on, { captureInvalidate: true })
  await spawn($, 'crew:test-runner')
  await spawn($, 'crew:domain-researcher')
  await spawn($, 'crew:debugger-analyst')
  await spawn($, 'crew:architecture-planner')
  const ui = await mountPane($, 'terminal', 54, 'dock', 16)
  expect((await gridOf(ui)).map(line => line.slots)).toEqual([
    ['test-runner', 'domain-researcher', 'debugger-analyst'],
  ])

  await clock.advance(500)

  expect(blits.map(one => one.key)).toEqual([
    'desk-test-runner',
    'desk-domain-researcher',
    'desk-debugger-analyst',
  ])
  expect(invalidations).toEqual([{ event: 'ui.render' }])

  await clock.advance(500)
  await ui.unmount()

  expect(blits.map(one => one.key)).toEqual([
    'desk-test-runner',
    'desk-domain-researcher',
    'desk-debugger-analyst',
    'desk-test-runner',
    'desk-domain-researcher',
    'desk-debugger-analyst',
  ])
  // R2: the undrawn set has not changed, so the second tick asks for nothing.
  expect(invalidations).toEqual([{ event: 'ui.render' }])
})

test('a desk that starts working is drawn by the engine redraw and blitted on the next tick, and nothing outside the drawn set is', async ($, on) => {
  const { blits, clock } = world(on)
  const ui = await mountPane($, 'terminal', 54, 'dock', 24)
  expect((await gridOf(ui)).flatMap(line => line.slots)).not.toContain('guest')

  await spawn($, 'other:custom')
  const drawn = (await gridOf(ui)).flatMap(line => line.slots)
  await clock.advance(500)
  await ui.unmount()

  expect(drawn).toContain('guest')
  expect(blits.map(one => one.key)).toEqual(['desk-guest'])
})
