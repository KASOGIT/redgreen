import { expect, test } from 'claude-code/testing'

import {
  expectRows,
  finishTurn,
  mountPane,
  rowsOn,
  expectedRows,
  seedOffice,
  spawn,
  startTurn,
  useTool,
  world,
} from './kit'

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const agent = (id: string, type: string, status: string) => ({
  id,
  type,
  description: 'd',
  status,
})

test('the ticker stops when polling ends the last agent', async ($, on) => {
  const { clock, listCalls } = world(on, {
    agents: [agent('a1', 'crew:test-runner', 'completed')],
  })
  await spawn($, 'crew:test-runner')

  await clock.advance(2000)
  await clock.settle()

  await expectRows($, { 'test-runner': '1 · done' })
  const asked = listCalls()
  await clock.advance(20000)
  await clock.settle()

  expect(listCalls() - asked).toBe(0)
})

test('an agent is never on two desks', async ($, on) => {
  world(on)

  await useTool($, 'Bash', 'a1')
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ guest: 'working Bash' }),
  )

  await spawn($, 'crew:test-runner')
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working' }),
  )

  await finishTurn($, 'answer', 'a1')
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': '1 · done' }),
  )
})

test('an old mark expiry does not clear a newer mark', async ($, on) => {
  const { clock } = world(on)

  await spawn($, 'crew:test-runner')
  await finishTurn($, 'answer', 'a1')
  await expectRows($, { 'test-runner': '1 · done' })

  await clock.advance(3000)
  await spawn($, 'crew:test-runner')
  await finishTurn($, 'answer', 'a2')

  await clock.advance(2000)
  await clock.settle()
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': '2 · done' }),
  )

  await clock.advance(3000)
  await clock.settle()
  await expectRows($, { 'test-runner': '2 · idle' })
})

test('a spawn recorded after its agent already finished leaves the desk done', async ($, on) => {
  world(on, {
    agents: [agent('a1', 'crew:test-runner', 'running')],
    beforeSpawn: async () => {
      await startTurn($, 'a1')
      await finishTurn($, 'answer', 'a1')
    },
  })

  await spawn($, 'crew:test-runner')

  await expectRows($, { 'test-runner': '1 · done' })
})

test('a mark survives a reload and still expires', async ($, on) => {
  const { clock } = world(on)
  const { stored } = seedOffice(on, {
    desks: { 'test-runner': { agentIds: [], mark: 'done', until: 4000 } },
    deskOf: {},
  })

  await $.session.start(SESSION)
  await expectRows($, { 'test-runner': 'done' })

  await clock.advance(3000)
  await clock.settle()

  await expectRows($)
  expect(stored().desks['test-runner']).toEqual({ agentIds: [] })
})

test('a failing agent list does not stop the animation', async ($, on) => {
  const { blits, clock } = world(on, { listThrows: true })
  await spawn($, 'crew:test-runner')
  const ui = await mountPane($, 'terminal', 54)

  await clock.advance(4000)
  await ui.unmount()

  expect(blits).toHaveLength(8)
})

test('a spawn does not wait for the pane to open', async ($, on) => {
  const { clock, opens } = world(on, { openHangs: true })
  let out: unknown
  let isDone = false

  void spawn($, 'crew:test-runner').then((answer: unknown) => {
    out = answer
    isDone = true
  })
  await clock.advance(1000)

  expect(opens).toHaveLength(1)
  expect(isDone).toBe(true)
  expect(out).toEqual({ model: 'm', agentId: 'a1' })
  await expectRows($, { 'test-runner': 'working' })
})

for (const [name, options] of [
  ['the auto setting to be read', { storeGetHangs: true }],
  ['the pane list to be read', { panesHang: true }],
] as const) {
  test(`a spawn does not wait for ${name}`, async ($, on) => {
    const { clock } = world(on, options)
    let out: unknown
    let isDone = false

    void spawn($, 'crew:test-runner').then((answer: unknown) => {
      out = answer
      isDone = true
    })
    await clock.advance(1000)

    expect(isDone).toBe(true)
    expect(out).toEqual({ model: 'm', agentId: 'a1' })
    await expectRows($, { 'test-runner': 'working' })
  })
}
