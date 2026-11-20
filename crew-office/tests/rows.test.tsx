import { expect, test } from 'claude-code/testing'

import {
  DESKS,
  expectRows,
  expectedRows,
  rowsOn,
  SURFACES,
  spawn,
  startTurn,
  useTool,
  world,
} from './kit'

test('with nothing happened, ten rows, all idle, in desk order', async ($, on) => {
  world(on)

  for (const surface of SURFACES) {
    const rows = await rowsOn($, surface)
    expect(rows).toHaveLength(10)
    expect(rows).toEqual([
      'manager: idle',
      'test-runner: idle',
      'researcher: idle',
      'debugger: idle',
      'architect: idle',
      'test-engineer: idle',
      'implementer: idle',
      'reviewer: idle',
      'guest: idle',
      'advisor: idle',
    ])
  }
})

test('a spawned crew:test-runner works, on every surface', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')

  await expectRows($, { 'test-runner': 'working' })
})

// Each crew name reaches its own desk, with the prefix or without it. The
// manager, guest and advisor desks have no agent type of their own.
for (const [slot, label] of DESKS.filter(
  ([slot]) => slot !== 'manager' && slot !== 'guest' && slot !== 'advisor',
)) {
  for (const type of [`crew:${slot}`, slot]) {
    test(`${type} takes the ${label} desk`, async ($, on) => {
      world(on)

      await spawn($, type)

      expect(await rowsOn($, 'terminal')).toEqual(
        expectedRows({ [label]: 'working' }),
      )
    })
  }
}

test('a tool call on the desk adds the tool name', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'Bash', 'a1')

  await expectRows($, { 'test-runner': 'working Bash' })
})

test('an mcp tool shows the part after the last double underscore', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'mcp__linear__list_issues', 'a1')

  await expectRows($, { 'test-runner': 'working list_issues' })
})

test('the most recent tool of the desk wins', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'Bash', 'a1')
  await useTool($, 'Read', 'a1')

  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working Read' }),
  )
})

test('a tool name of exactly 14 characters is kept whole', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'abcdefghijklmn', 'a1')

  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working abcdefghijklmn' }),
  )
})

test('a tool name of 15 characters is cut to 14', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'abcdefghijklmno', 'a1')

  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working abcdefghijklmn' }),
  )
})

test('an mcp tool name is cut to 14 after the prefix is removed', async ($, on) => {
  world(on)

  await spawn($, 'crew:test-runner')
  await useTool($, 'mcp__srv__abcdefghijklmnopqrst', 'a1')

  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working abcdefghijklmn' }),
  )
})

test('a tool call with no agentId is the manager at work', async ($, on) => {
  world(on)

  await useTool($, 'Read')

  await expectRows($, { manager: 'working Read' })
})

test('a turn start with no agentId is the manager at work, no tool', async ($, on) => {
  world(on)

  await startTurn($)

  await expectRows($, { manager: 'working' })
})

test('Explore and general-purpose agents take the guest desk', async ($, on) => {
  world(on)

  await spawn($, 'Explore')
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ guest: 'working' }),
  )

  await spawn($, 'general-purpose')
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ guest: 'working x2' }),
  )
})

test('a tool call from an unknown agent is placed by the agent list type', async ($, on) => {
  world(on, {
    agents: [
      {
        id: 'zz',
        type: 'crew:code-reviewer',
        description: 'd',
        status: 'running',
      },
    ],
  })

  await useTool($, 'Grep', 'zz')

  await expectRows($, { reviewer: 'working Grep' })
})

test('a tool call from an unknown agent absent from the list goes to guest', async ($, on) => {
  world(on, { agents: [] })

  await useTool($, 'Grep', 'zz')

  await expectRows($, { guest: 'working Grep' })
})

test('a spawn of crew:architecture-planner gives the row architect: working', async ($, on) => {
  world(on)

  await spawn($, 'crew:architecture-planner')

  expect(await rowsOn($, 'terminal')).toEqual([
    'manager: idle',
    'test-runner: idle',
    'researcher: idle',
    'debugger: idle',
    'architect: working',
    'test-engineer: idle',
    'implementer: idle',
    'reviewer: idle',
    'guest: idle',
    'advisor: idle',
  ])
})
