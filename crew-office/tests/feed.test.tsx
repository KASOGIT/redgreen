import { expect, test } from 'claude-code/testing'

import {
  feedBoxes,
  finishTurn,
  mountPane,
  seedOffice,
  spawn,
  useToolWith,
  world,
} from './kit'

// Spec, T1: the pane draws no activity feed in any layout, and the office no
// longer stores one.

test('with agents started, tools used and turns finished, the tall pane draws no feed Box', async ($, on) => {
  const { clock } = world(on, { ids: ['a1', 'a2'] })
  await spawn($, 'crew:test-runner', 'fix flaky test')
  await clock.advance(4000)
  await useToolWith($, 'Edit', { file_path: '/a/b/model.ts' }, 'a1')
  await finishTurn($, 'answer', 'a1', 134000)
  await spawn($, 'crew:implementer', 'write docs')
  await finishTurn($, 'error', 'a2')

  const ui = await mountPane($, 'terminal', 54, 'dock', 60)
  const count = await feedBoxes(ui)
  await ui.unmount()

  expect(count).toBe(0)
})

test('the stored office keeps no feed after many events', async ($, on) => {
  world(on)
  const { stored } = seedOffice(on, { desks: {}, deskOf: {} })
  for (let i = 0; i < 60; i += 1) {
    await useToolWith($, 'Edit', { file_path: `/a/f${i}.ts` })
  }

  expect(stored().feed).toBeUndefined()
})

test('a feed stored by an older version is ignored: it is not drawn', async ($, on) => {
  world(on)
  seedOffice(on, {
    desks: {},
    deskOf: {},
    feed: [{ at: 500, label: 'implementer', text: 'done 5s' }],
  })

  const ui = await mountPane($, 'terminal', 54, 'dock', 60)
  const count = await feedBoxes(ui)
  await ui.unmount()

  expect(count).toBe(0)
})
