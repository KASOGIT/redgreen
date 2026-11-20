import { expect, test } from 'claude-code/testing'

import {
  DESKS,
  buttonKey,
  buttonLabel,
  buttonText,
  buttonsOf,
  finishTurn,
  mountPane,
  seedOffice,
  spawn,
  useToolWith,
  world,
} from './kit'

// Spec, S5 buttons: each drawn desk's label is a Button keyed "view-<slot>",
// hotkey "0" for the manager and "1" to "9" for the other desks in slot order,
// children the label alone (R1: the plain Button draws "<hotkey>: <label>"). A press shows the desk's last agent in the main
// view, the main conversation for the manager or a desk with no last agent; a
// refusal or a throw is one toast and never a thrown hook.

const SLOTS = DESKS.map(([slot]) => slot)
const HOTKEYS = SLOTS.map((_, at) => String(at))

// The agent type that lands on each slot: the crew types, and Explore for the
// guest desk. Spawned in slot order, the engine ids run a1, a2, ...
const TYPES = [
  undefined,
  'crew:test-runner',
  'crew:domain-researcher',
  'crew:debugger-analyst',
  'crew:architecture-planner',
  'crew:test-engineer',
  'crew:implementer',
  'crew:code-reviewer',
  'Explore',
]

// 54 by 53 draws all ten desks: the advisor on its own line, the guest in its seat.
const press = async ($: any, key: string, bodyColumns = 54, bodyRows = 53) => {
  const ui = await mountPane($, 'terminal', bodyColumns, 'dock', bodyRows)
  expect(await ui.find({ type: 'Button', key })).toBeDefined()
  const result = await ui.press({ key })
  await ui.unmount()

  return result
}

test('a 54 by 40 pane draws a Button for the manager to the reviewer and the advisor in the idle guest seat: key view-<slot>, hotkeys 0 to 7 then 9, text the label alone', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54)
  const found = await buttonsOf(ui)
  await ui.unmount()

  expect(found.map(buttonKey)).toEqual([...SLOTS.slice(0, 8), 'advisor'].map(slot => `view-${slot}`))
  expect(found.map((one: any) => one.props.hotkey)).toEqual([...HOTKEYS.slice(0, 8), '9'])
  expect(found.map(buttonText)).toEqual([
    'manager',
    'test-runner',
    'researcher',
    'debugger',
    'architect',
    'test-engineer',
    'implementer',
    'reviewer',
    'advisor',
  ])
})

test('a 54 by 53 pane draws one Button per desk: key view-<slot>, hotkey 0 to 9 in slot order, text the label alone', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54, 'dock', 53)
  const found = await buttonsOf(ui)
  await ui.unmount()

  expect(found.map(buttonKey)).toEqual(SLOTS.map(slot => `view-${slot}`))
  expect(found.map((one: any) => one.props.hotkey)).toEqual(HOTKEYS)
  expect(found.map(buttonText)).toEqual(SLOTS.map(buttonLabel))
  expect(found.map(buttonText).slice(8)).toEqual(['guest', 'advisor'])
})

test('the label is no longer a plain Text of the desk', async ($, on) => {
  world(on)

  const ui = await mountPane($, 'terminal', 54)
  const texts = (await ui.findAll({ type: 'Text' })).map((one: any) => one.text)
  await ui.unmount()

  for (const [, label] of DESKS) expect(texts).not.toContain(label)
})

test('a desk keeps its hotkey when the short mode draws the active desks first', async ($, on) => {
  world(on)
  seedOffice(on, {
    desks: {
      'test-runner': { agentIds: ['a1'], last: 'a1' },
      implementer: { agentIds: ['a2'], last: 'a2' },
    },
    deskOf: { a1: 'test-runner', a2: 'implementer' },
  })

  // 54 by 24: two active desks first, then the idle ones in slot order, six
  // drawn (spec S3 layout table).
  const ui = await mountPane($, 'terminal', 54, 'dock', 24)
  const found = (await buttonsOf(ui)).slice(0, 6)
  await ui.unmount()

  expect(found.map(buttonKey)).toEqual([
    'view-test-runner',
    'view-implementer',
    'view-manager',
    'view-domain-researcher',
    'view-debugger-analyst',
    'view-architecture-planner',
  ])
  expect(found.map((one: any) => one.props.hotkey)).toEqual(['1', '6', '0', '2', '3', '4'])
  expect(found.map(buttonText)).toEqual([
    'test-runner',
    'implementer',
    'manager',
    'researcher',
    'debugger',
    'architect',
  ])
})

for (const [at, slot] of SLOTS.entries()) {
  if (at === 0 || slot === 'advisor') continue
  test(`pressing view-${slot} puts the last agent of that desk in the main view`, async ($, on) => {
    const { views, toasts } = world(on)
    for (const type of TYPES.slice(1)) await spawn($, type!)

    const result = await press($, `view-${slot}`)

    expect(result).toEqual({ element: `view-${slot}` })
    expect(views).toEqual([{ agentId: `a${at}` }])
    expect(toasts).toEqual([])
  })
}

test('the desk shows the agent most recently active on it, not the first or the latest spawned', async ($, on) => {
  const { views } = world(on)
  await spawn($, 'crew:implementer') // a1
  await spawn($, 'crew:implementer') // a2
  await useToolWith($, 'Edit', { file_path: '/a/b.ts' }, 'a1')

  await press($, 'view-implementer')

  expect(views).toEqual([{ agentId: 'a1' }])
})

test('a desk whose run is over still shows its last agent', async ($, on) => {
  const { views } = world(on)
  const { agentId } = await spawn($, 'crew:code-reviewer')
  await finishTurn($, 'answer', agentId)

  await press($, 'view-code-reviewer')

  expect(views).toEqual([{ agentId }])
})

test('a desk with no last agent goes back to the main conversation', async ($, on) => {
  const { views, toasts } = world(on)

  const result = await press($, 'view-test-runner')

  expect(result).toEqual({ element: 'view-test-runner' })
  expect(views).toEqual([{}])
  expect(toasts).toEqual([])
})

test('a desk stored by an older version, with no last agent, goes back to the main conversation', async ($, on) => {
  const { views } = world(on)
  seedOffice(on, {
    desks: { 'test-runner': { agentIds: ['a1'] } },
    deskOf: { a1: 'test-runner' },
  })

  await press($, 'view-test-runner')

  expect(views).toEqual([{}])
})

test('the manager goes back to the main conversation, whatever its desk holds', async ($, on) => {
  const { views } = world(on)
  seedOffice(on, { desks: { manager: { agentIds: [], last: 'a9' } }, deskOf: {} })

  await press($, 'view-manager')

  expect(views).toEqual([{}])
})

test('a refused view is one toast, and the press does not throw', async ($, on) => {
  const { views, toasts } = world(on, { viewDeny: 'the agent is gone' })
  await spawn($, 'crew:implementer')

  const result = await press($, 'view-implementer')

  expect(result).toEqual({ element: 'view-implementer' })
  expect(views).toEqual([{ agentId: 'a1' }])
  expect(toasts).toHaveLength(1)
  expect(typeof toasts[0].text).toBe('string')
  expect(toasts[0].text).not.toBe('')
})

test('a refused return to the main conversation is one toast too', async ($, on) => {
  const { toasts } = world(on, { viewDeny: 'not now' })

  await press($, 'view-manager')

  expect(toasts).toHaveLength(1)
})

test('a view that throws is one toast, and the press does not throw', async ($, on) => {
  const { views, toasts } = world(on, { viewThrows: true })
  await spawn($, 'crew:implementer')

  const result = await press($, 'view-implementer')

  expect(result).toEqual({ element: 'view-implementer' })
  expect(views.length).toBeGreaterThan(0)
  expect(toasts).toHaveLength(1)
  expect(toasts[0].text).not.toBe('')
})

test('a toast that throws does not throw the press either', async ($, on) => {
  const { toasts } = world(on, { viewDeny: 'no', toastThrows: true })
  await spawn($, 'crew:implementer')

  const result = await press($, 'view-implementer')

  expect(result).toEqual({ element: 'view-implementer' })
  expect(toasts).toHaveLength(1)
})

// The text list stays as it is: no Button on a surface that is not a wide
// terminal pane, under 18 columns or under 12 rows.
for (const [name, surface, bodyColumns, placement, bodyRows] of [
  ['a desktop pane', 'desktop', 54, 'dock', 40],
  ['a vscode pane', 'vscode', 54, 'dock', 40],
  ['a mobile pane', 'mobile', 54, 'dock', 40],
  ['a terminal narrower than 18 columns', 'terminal', 17, 'dock', 40],
  ['a terminal widget', 'terminal', 54, 'widget', 40],
  ['a terminal of 11 rows', 'terminal', 54, 'dock', 11],
] as const) {
  test(`${name} draws the text list and no Button`, async ($, on) => {
    world(on)

    const ui = await mountPane($, surface, bodyColumns, placement, bodyRows)
    const found = await buttonsOf(ui)
    const texts = (await ui.findAll({ type: 'Text' })).map((one: any) => one.text)
    await ui.unmount()

    expect(found).toHaveLength(0)
    expect(texts).toEqual(DESKS.map(([, label]) => `${label}: idle`))
  })
}
