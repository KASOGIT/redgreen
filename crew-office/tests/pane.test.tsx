import { expect, test } from 'claude-code/testing'

import {
  expectRows,
  failWrites,
  expectedRows,
  rowsOn,
  spawn,
  useTool,
  world,
} from './kit'

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('a refused spawn changes no desk, opens no pane and returns the same deny', async ($, on) => {
  const { opens } = world(on, { deny: 'no' })

  const out = await spawn($, 'crew:test-runner')

  expect(out).toEqual({ deny: 'no' })
  expect(opens).toHaveLength(0)
  await expectRows($)
})

test('session start registers a command named crew-office', async ($, on) => {
  const { registered } = world(on)

  await $.session.start(SESSION)

  expect(registered.map(one => one.name)).toEqual(['crew-office'])
})

// The mod relays what the engine answered, whatever fails around its own work.
// isReadOnly is left out: core sets it, a hook's own answer never carries it.
const ANSWER = { result: {}, text: 'relayed', context: ['kept'] }
const TOOL_INPUT = {
  tool: 'Bash',
  command: 'ls',
  file_path: '/x',
  pattern: 'x',
  old_string: 'a',
  new_string: 'b',
  agentId: 'a1',
}
const SPAWN_INPUT = {
  tool_use_id: 't1',
  prompt: 'p',
  description: 'd',
  subagentType: 'crew:test-runner',
  provider: { plugin: 'test', tier: 'user' },
  parentModel: 'm',
  background: false,
  fork: false,
}

test('tool.call returns the engine answer and passes the input on, with the write failing', async ($, on) => {
  const { toolSeen } = world(on, { toolAnswer: ANSWER })
  failWrites(on)

  const out = await useTool($, 'Bash', 'a1')

  await expectRows($)
  expect(out).toEqual(ANSWER)
  expect(toolSeen).toEqual([{ ...TOOL_INPUT, tool_use_id: expect.any(String) }])
})

test('tool.call returns the engine answer and passes the input on, with ui.open rejecting', async ($, on) => {
  const { toolSeen } = world(on, { toolAnswer: ANSWER, openThrows: true })

  await spawn($, 'crew:test-runner')
  const out = await useTool($, 'Bash', 'a1')

  expect(out).toEqual(ANSWER)
  expect(toolSeen).toEqual([{ ...TOOL_INPUT, tool_use_id: expect.any(String) }])
  expect(await rowsOn($, 'terminal')).toEqual(
    expectedRows({ 'test-runner': 'working Bash' }),
  )
})

test('agent.spawn returns the engine answer and passes the input on, with the write failing', async ($, on) => {
  const { spawnSeen } = world(on)
  failWrites(on)

  const out = await spawn($, 'crew:test-runner')

  await expectRows($)
  expect(out).toEqual({ model: 'm', agentId: 'a1' })
  expect(spawnSeen).toEqual([SPAWN_INPUT])
})

test('agent.spawn returns the engine answer and passes the input on, with ui.open rejecting', async ($, on) => {
  const { spawnSeen } = world(on, { openThrows: true })

  const out = await spawn($, 'crew:test-runner')

  expect(out).toEqual({ model: 'm', agentId: 'a1' })
  expect(spawnSeen).toEqual([SPAWN_INPUT])
  await expectRows($, { 'test-runner': 'working' })
})
