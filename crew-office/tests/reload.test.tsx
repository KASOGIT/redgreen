import { test } from 'claude-code/testing'

import { expectRows, world } from './kit'

test('a fresh mount shows a desk the stored state says is running', async ($, on) => {
  world(on)
  on('state.get', () => ({
    value: {
      value: {
        desks: { 'test-runner': { agentIds: ['a1'] } },
        deskOf: { a1: 'test-runner' },
      },
      version: 1,
    },
  }))

  await expectRows($, { 'test-runner': 'working' })
})
