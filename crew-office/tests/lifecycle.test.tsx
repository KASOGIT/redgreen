import { expect, test } from 'claude-code/testing'

import {
  expectRows,
  expectedRows,
  finishTurn,
  rowsOn,
  spawn,
  startTurn,
  useTool,
  world,
} from './kit'

test('a finished turn marks the desk done, then idle after 5000 ms', async ($, on) => {
  const { clock } = world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'Bash', 'a1')
  await finishTurn($, 'answer', 'a1')

  await expectRows($, { 'test-runner': '1 · done' })

  await clock.advance(4999)
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': '1 · done' }),
  )

  await clock.advance(1)
  await expectRows($, { 'test-runner': '1 · idle' })
})

test('an errored turn marks the desk failed, then idle after 5000 ms', async ($, on) => {
  const { clock } = world(on)

  await spawn($, 'crew:test-runner')
  await finishTurn($, 'error', 'a1')

  await expectRows($, { 'test-runner': 'failed' })

  await clock.advance(4999)
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'failed' }),
  )

  await clock.advance(1)
  await expectRows($)
})

test('a refused turn marks the desk failed', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await finishTurn($, 'refusal', 'a1')

  await expectRows($, { 'test-runner': 'failed' })
})

test('an aborted turn leaves the desk idle at once, with no mark', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await finishTurn($, 'aborted', 'a1')

  await expectRows($)
})

test('the manager is done after its own turn completes', async ($, on) => {
  world(on)

  await startTurn($)
  await finishTurn($, 'answer')

  await expectRows($, { manager: 'done' })
})

test('two implementers show x2, and no mark while one still runs', async ($, on) => {
  const { clock } = world(on)

  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')

  await expectRows($, { implementer: 'working x2' })

  await useTool($, 'Edit', 'a1')
  await expectRows($, { implementer: 'working x2 Edit' })

  await finishTurn($, 'answer', 'a1')
  await expectRows($, { implementer: '1 · working Edit' })

  await clock.advance(5000)
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ implementer: '1 · working Edit' }),
  )

  await finishTurn($, 'answer', 'a2')
  await expectRows($, { implementer: '2 · done' })
})

test('one finished implementer of two leaves working, with a count of 1', async ($, on) => {
  world(on)

  await spawn($, 'crew:implementer')
  await spawn($, 'crew:implementer')
  await finishTurn($, 'answer', 'a1')

  await expectRows($, { implementer: '1 · working' })
})

for (const reason of ['answer', 'error'] as const) {
  test(`a new spawn on a desk showing ${reason === 'answer' ? 'done' : 'failed'} works at once, and the old mark expiry does not undo it`, async ($, on) => {
    const { clock } = world(on)

    await spawn($, 'crew:test-runner')
    await finishTurn($, reason, 'a1')
    await spawn($, 'crew:test-runner')

    const shown = reason === 'answer' ? '1 · working' : 'working'
    await expectRows($, { 'test-runner': shown })

    await clock.advance(5000)
    expect(await rowsOn($, 'terminal')).toEqual(
      expectedRows({ 'test-runner': shown }),
    )
  })
}

test('a later turn start of a finished agent brings its desk back to work', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await finishTurn($, 'answer', 'a1')
  await startTurn($, 'a1')

  await expectRows($, { 'test-runner': '1 · working' })
})

test('a later turn start of a finished agent works after the mark has expired too', async ($, on) => {
  const { clock } = world(on)

  await spawn($, 'crew:test-runner')
  await finishTurn($, 'answer', 'a1')
  await clock.advance(5000)
  await startTurn($, 'a1')

  await expectRows($, { 'test-runner': '1 · working' })
})
