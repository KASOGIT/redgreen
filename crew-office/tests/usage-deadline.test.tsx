import { expect, test } from 'claude-code/testing'

import { agentInfo, deferred, seedOffice, sessionUsage, spawn, world } from './kit'

// A $.session.usage() call that never settles must not block the meter for the
// rest of the session: after the poll wait (10 s, as the agent-list poll) the
// next poll asks again. Polls run every 2000 ms (4 ticks of 500 ms), the first
// at 2000 ms. Expected values are the requirement's literals.

const EMPTY = { desks: {}, deskOf: {} }

// Every session.usage call gets its own gate, so a test settles each one by hand.
const setup = async ($: any, on: any) => {
  const gates: Array<ReturnType<typeof deferred<ReturnType<typeof sessionUsage>>>> = []
  const w = world(on, {
    agents: [agentInfo('a1', 'crew:test-runner', 'running')],
    usageByCall: () => {
      const gate = deferred<ReturnType<typeof sessionUsage>>()
      gates.push(gate)

      return gate.promise
    },
  })
  const { stored } = seedOffice(on, EMPTY)
  await spawn($, 'crew:test-runner')

  return { ...w, gates, stored }
}

test('usage deadline: a call unsettled after the 10 s wait lets the next poll make a new call', async ($, on) => {
  const { clock, gates } = await setup($, on)

  await clock.advance(2000)
  expect(gates.length).toBe(1)
  await clock.advance(8000)
  expect(gates.length).toBe(1)

  await clock.advance(4000)
  await clock.settle()

  expect(gates.length).toBe(2)
})

test("usage deadline: the new call's answer reaches the office state", async ($, on) => {
  const { clock, gates, stored } = await setup($, on)

  await clock.advance(14000)
  await clock.settle()
  gates[gates.length - 1]?.resolve(sessionUsage(41, 0.4))
  await clock.settle()

  expect(gates.length).toBe(2)
  expect(stored().usage).toEqual({ percent: 41, usd: 0.4 })
})

test('usage deadline: the abandoned call answering after the newer one is ignored', async ($, on) => {
  const { clock, gates, stored } = await setup($, on)

  await clock.advance(14000)
  await clock.settle()
  gates[1]?.resolve(sessionUsage(41, 0.4))
  await clock.settle()
  gates[0]?.resolve(sessionUsage(10, 0.1))
  await clock.settle()

  expect(gates.length).toBe(2)
  expect(stored().usage).toEqual({ percent: 41, usd: 0.4 })
})

test('usage deadline guard: the new call is itself in flight, so no third call before its own wait passes', async ($, on) => {
  const { clock, gates } = await setup($, on)

  await clock.advance(14000)
  await clock.settle()
  expect(gates.length).toBe(2)

  await clock.advance(4000)
  await clock.settle()

  expect(gates.length).toBe(2)
})

test("usage deadline guard: the abandoned call's late answer leaves the newer call's guard alone", async ($, on) => {
  const { clock, gates } = await setup($, on)

  await clock.advance(14000)
  await clock.settle()
  expect(gates.length).toBe(2)

  gates[0]?.resolve(sessionUsage(10, 0.1))
  await clock.settle()
  await clock.advance(4000)
  await clock.settle()

  expect(gates.length).toBe(2)
})
