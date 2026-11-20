import type {
  AgentInfo,
  AgentStatus,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'
import { expect, mock } from 'claude-code/testing'

import { dim } from '../hooks/scene'
import { PALETTE, SPRITES, STAMPS } from '../hooks/sprites'

export const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// Spec: the ten desks in display order, as slot id and label.
export const DESKS: ReadonlyArray<readonly [slot: string, label: string]> = [
  ['manager', 'manager'],
  ['test-runner', 'test-runner'],
  ['domain-researcher', 'researcher'],
  ['debugger-analyst', 'debugger'],
  ['architecture-planner', 'architect'],
  ['test-engineer', 'test-engineer'],
  ['implementer', 'implementer'],
  ['code-reviewer', 'reviewer'],
  ['guest', 'guest'],
  ['advisor', 'advisor'],
]

// The ten rows the pane must draw: every desk idle unless `status` says else,
// keyed by label.
export const expectedRows = (status: Record<string, string> = {}): string[] =>
  DESKS.map(([, label]) => `${label}: ${status[label] ?? 'idle'}`)

export type WorldOptions = {
  ids?: string[]
  agents?: unknown[]
  panes?: unknown[] | (() => unknown[] | Promise<unknown[]>)
  open?: unknown
  deny?: string
  toolAnswer?: unknown
  openThrows?: boolean
  closeThrows?: boolean
  afterOpen?: (stored: Record<string, unknown>) => void | Promise<void>
  auto?: boolean
  openHangs?: boolean
  panesHang?: boolean
  storeGetHangs?: boolean
  listThrows?: boolean
  beforeSpawn?: ($: any) => Promise<void>
  blitDeny?: string
  captureInvalidate?: boolean
  model?: string
  usage?: SessionUsage
  usageThrows?: boolean
  statusThrows?: boolean
  statusHangs?: boolean
  viewDeny?: string
  viewThrows?: boolean
  viewHangs?: boolean
  toastThrows?: boolean
  // The agent list, read at each call: its answer, or a promise the test
  // settles later.
  list?: () => unknown[] | Promise<unknown[]>
  listHangs?: boolean
  usageHangs?: boolean
  // session.usage answers this promise's value once the test settles it.
  usageLater?: Promise<SessionUsage>
  // session.usage answers what this returns for the call number (1 for the first).
  usageByCall?: (call: number) => Promise<SessionUsage>
}

// A promise the test settles itself.
export const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

// An agent as `$.agent.list()` answers it, every field the API types name.
export const agentInfo = (
  id: string,
  type: string,
  status: AgentStatus,
  more: Partial<AgentInfo> = {},
): AgentInfo => ({
  id,
  description: 'd',
  type,
  status,
  kind: 'local_agent',
  taskStatus:
    status === 'completed' || status === 'failed' || status === 'killed'
      ? status
      : status === 'pending'
        ? 'pending'
        : 'running',
  label: 'd',
  startTime: 1000,
  cwd: '/',
  tokenCount: 0,
  tokenSamples: [],
  hasRow: false,
  ...more,
})

// What `$.session.usage()` answers: the context window at `percent` and the
// session's cost in dollars, and the subscription rate limits when given.
export const sessionUsage = (
  percent: number,
  usd: number,
  rateLimits: SessionRateLimit[] = [],
): SessionUsage => ({
  startedAt: 0,
  context: { tokens: percent * 2000, window: 200000, percent },
  rateLimits,
  cost: { usd },
})

const NO_USAGE: SessionUsage = {
  startedAt: 0,
  context: { window: 200000 },
  rateLimits: [],
}

// Everything beneath the plugin: each hook stands for the engine and records
// what the plugin asked of it.
export const world = (on: any, options: WorldOptions = {}) => {
  const opens: any[] = []
  const closes: any[] = []
  const registered: any[] = []
  const toolSeen: any[] = []
  const spawnSeen: any[] = []
  const ids = [...(options.ids ?? ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'])]
  const clock = mock.clock(on, { now: 1000 })
  // The plugin's own store, as the host keeps it: JSON values by key.
  const stored: Record<string, unknown> =
    options.auto === undefined ? {} : { auto: options.auto }

  on('store.get', (_: any, e: any) =>
    options.storeGetHangs
      ? new Promise(() => {})
      : { value: stored[e.key] },
  )
  on('store.set', (_: any, e: any) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: any, e: any) => {
    delete stored[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(stored) }))

  on('command.register', (_: any, e: any) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', async (_: any, e: any) => {
    opens.push(e)
    if (options.openThrows) throw new Error('no pane')
    await options.afterOpen?.(stored)
    if (options.openHangs) return new Promise(() => {})

    return { value: options.open ?? { isPlaced: true } }
  })
  on('ui.close', (_: any, e: any) => {
    if (options.closeThrows) throw new Error('no close')
    closes.push(e)
    return { value: undefined }
  })
  on('ui.panes', async () =>
    options.panesHang
      ? new Promise(() => {})
      : {
          value:
            typeof options.panes === 'function'
              ? await options.panes()
              : (options.panes ?? []),
        },
  )
  // What `$.ui.status` was asked to show, in order; undefined clears the line.
  const statuses: Array<string | undefined> = []

  on('ui.status', (_: any, e: any) => {
    statuses.push(e.text)
    if (options.statusThrows) throw new Error('no status line')
    if (options.statusHangs) return new Promise(() => {})

    return { value: undefined }
  })
  // What `$.ui.view` and `$.ui.toast` were asked, in order. The view answers
  // {} (shown), or { deny }, or throws, or never answers.
  const views: any[] = []
  const toasts: any[] = []

  on('ui.view', (_: any, e: any) => {
    views.push(e)
    if (options.viewThrows) throw new Error('no view')
    if (options.viewHangs) return new Promise(() => {})

    return { value: options.viewDeny === undefined ? {} : { deny: options.viewDeny } }
  })
  on('ui.toast', (_: any, e: any) => {
    toasts.push(e)
    if (options.toastThrows) throw new Error('no toast')

    return { value: undefined }
  })
  const blits: any[] = []
  const invalidations: any[] = []
  let listCalls = 0
  let usageCalls = 0

  on('agent.list', async () => {
    listCalls += 1
    if (options.listThrows) throw new Error('list is down')
    if (options.listHangs) return new Promise(() => {})

    return { value: options.list ? await options.list() : (options.agents ?? []) }
  })
  on('session.usage', () => {
    usageCalls += 1
    if (options.usageThrows) throw new Error('usage is down')
    if (options.usageHangs) return new Promise(() => {})
    if (options.usageLater) return options.usageLater.then(value => ({ value }))
    if (options.usageByCall) {
      return options.usageByCall(usageCalls).then(value => ({ value }))
    }

    return { value: options.usage ?? NO_USAGE }
  })
  on('ui.blit', (_: any, e: any) => {
    blits.push(e)

    return { value: options.blitDeny === undefined ? {} : { deny: options.blitDeny } }
  })
  if (options.captureInvalidate) {
    // Not passed on: the kit would redraw the mounted pane, which the tests
    // that watch the invalidation must do themselves.
    on('ui.invalidate', (_: any, e: any) => {
      invalidations.push(e)

      return { value: undefined }
    })
  }
  const answer = () =>
    options.deny === undefined
      ? { model: options.model ?? 'm', agentId: ids.shift() }
      : { deny: options.deny }

  on('agent.spawn', ($: any, e: any) => {
    spawnSeen.push(e)

    return options.beforeSpawn === undefined
      ? answer()
      : options.beforeSpawn($).then(answer)
  })
  on('tool.call', (_: any, e: any) => {
    toolSeen.push(e)

    return options.toolAnswer ?? { result: {} }
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: 'engine' }))

  return {
    opens,
    closes,
    registered,
    toolSeen,
    spawnSeen,
    blits,
    invalidations,
    statuses,
    views,
    toasts,
    store: () => ({ ...stored }),
    listCalls: () => listCalls,
    usageCalls: () => usageCalls,
    clock,
  }
}

// A stored `office` value that behaves like the host's: reads return it with
// its version, a write succeeds when its ifVersion matches and moves the version.
export const seedOffice = (on: any, seed: unknown) => {
  let stored = seed
  let version = 1
  let writes = 0

  on('state.get', () => ({ value: { value: stored, version } }))
  on('state.set', (_: any, e: any) => {
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false, version } }
    }
    stored = e.value
    version += 1
    writes += 1

    return { value: { isSet: true, version } }
  })

  return { stored: () => stored as any, writes: () => writes }
}

// A bookkeeping write that really fails: the host answers every conditional
// write with a miss, so the mod's own retries run out and its update throws.
// A stub that throws instead is skipped by the engine, which then runs the
// host's real write.
export const failWrites = (on: any) => {
  on('state.set', () => ({ value: { isSet: false, version: 1 } }))
}

// The host's state reads and writes that never answer: the hooks must still
// answer the engine.
export const hangState = (
  on: any,
  { get = false, set = false }: { get?: boolean; set?: boolean },
) => {
  if (get) on('state.get', () => new Promise(() => {}))
  if (set) on('state.set', () => new Promise(() => {}))
}

export const spawn = (
  $: any,
  subagentType: string,
  description = 'd',
) =>
  $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'p',
    description,
    subagentType,
    provider: { plugin: 'test', tier: 'user' },
    parentModel: 'm',
    background: false,
    fork: false,
  })

export const useTool = ($: any, tool: string, agentId?: string) =>
  $.tool.call({
    tool,
    command: 'ls',
    file_path: '/x',
    pattern: 'x',
    old_string: 'a',
    new_string: 'b',
    ...(agentId === undefined ? {} : { agentId }),
  })

// A tool call with exactly the arguments given, as the model wrote them.
export const useToolWith = (
  $: any,
  tool: string,
  input: Record<string, unknown>,
  agentId?: string,
) =>
  $.tool.call({
    tool,
    ...input,
    ...(agentId === undefined ? {} : { agentId }),
  })

export const startTurn = ($: any, agentId?: string) =>
  $.turn.start({
    text: 'go',
    turnId: 'u1',
    ...(agentId === undefined ? {} : { agentId }),
  })

export const finishTurn = (
  $: any,
  reason: 'answer' | 'error' | 'refusal' | 'aborted',
  agentId?: string,
  durationMs = 1,
) =>
  $.turn.complete({
    answer: '',
    durationMs,
    isAborted: reason === 'aborted',
    turnId: 'u1',
    reason,
    ...(reason === 'refusal'
      ? { refusal: { category: null, explanation: null } }
      : {}),
    ...(agentId === undefined ? {} : { agentId }),
  })

const PANE = {
  plugin: 'crew-office',
  component: 'Pane',
  requestId: 'crew-office',
  props: {
    title: 'Crew office',
    isFocused: false,
    bodyColumns: 54,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// Spec: the pixel layout needs a terminal, 18 columns or more, and no widget.
export const mountPane = (
  $: any,
  surface: (typeof SURFACES)[number] = 'terminal',
  bodyColumns = 54,
  placement: 'dock' | 'inline' | 'widget' = 'dock',
  bodyRows = 40,
) =>
  $.ui.mount({
    ...PANE,
    surface,
    props: {
      ...PANE.props,
      bodyColumns,
      placement,
      scroll: { offset: 0, bodyRows },
    },
  })

// What the pixel layout draws as text: the header line in a Box keyed
// "header", per desk its status line in a Box keyed "status-<slot>" and, in
// the info rows, "task-<slot>" (one Text per task line) and "meter-<slot>";
// and the idle desks left out of the grid in a Box keyed "roster". A Text
// cannot carry a key.
export const shown = (node: any): string => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(shown).join('')
  if (node === null || typeof node !== 'object') return ''
  if (node.type === 'Text' || node.type === undefined) {
    return shown(node.props?.children ?? node.children)
  }

  return shown(node.children)
}

const textsIn = (node: any): string[] => {
  if (Array.isArray(node)) return node.flatMap(textsIn)
  if (node === null || typeof node !== 'object') return []
  if (node.type === 'Text') return [shown(node)]

  return textsIn(node.children ?? [])
}

// The Text lines of the Box with this key; undefined when no such Box is drawn.
const linesOfBox = async (ui: any, key: string): Promise<string[] | undefined> => {
  const box = (await ui.findAll({ type: 'Box', key }))[0]
  if (box === undefined) return undefined
  const found = textsIn(box.children ?? [])

  return found.length === 0 && typeof box.text === 'string' && box.text !== ''
    ? [box.text]
    : found
}

const textOfBox = async (ui: any, key: string): Promise<string | undefined> =>
  (await linesOfBox(ui, key))?.[0]

export const headerOf = (ui: any): Promise<string | undefined> =>
  textOfBox(ui, 'header')

export const statusOf = (ui: any, slot: string): Promise<string | undefined> =>
  textOfBox(ui, `status-${slot}`)

export const taskOf = (ui: any, slot: string): Promise<string[] | undefined> =>
  linesOfBox(ui, `task-${slot}`)

export const meterOf = (ui: any, slot: string): Promise<string | undefined> =>
  textOfBox(ui, `meter-${slot}`)

export const rosterOf = (ui: any): Promise<string | undefined> =>
  textOfBox(ui, 'roster')

// How many Boxes keyed "feed" the pane draws: none in any layout (T1).
export const feedBoxes = async (ui: any): Promise<number> =>
  (await ui.findAll({ type: 'Box', key: 'feed' })).length

// The pane as laid out: per grid line the slots of its rasters in drawn order
// and its height in rows (the tallest desk: raster rows, one row per Text, and
// at least one row per Box).
export type Line = { slots: string[]; height: number }

const rasterIn = (node: any): any =>
  node?.type === 'Raster'
    ? node
    : (node?.children ?? []).map(rasterIn).find((one: any) => one !== undefined)

const deskHeight = (desk: any): number =>
  (desk.children ?? []).reduce((sum: number, child: any) => {
    if (child.type === 'Raster') return sum + child.props.rows
    if (child.type === 'Text') return sum + 1

    return sum + Math.max(1, textsIn(child).length)
  }, 0)

export const gridOf = async (ui: any): Promise<Line[]> => {
  const lines = (await ui.findAll({ type: 'Box' })).filter(
    (one: any) =>
      one.props.flexDirection === 'row' &&
      (one.children ?? []).some((desk: any) => rasterIn(desk) !== undefined),
  )

  return lines.map((line: any) => ({
    slots: line.children.map((desk: any) => {
      const raster = rasterIn(desk)

      return String(raster.key ?? raster.props.key).replace(/^desk-/, '')
    }),
    height: Math.max(...line.children.map(deskHeight)),
  }))
}

// Every Text and Button of the desks, in drawn order: the label Button (its
// text is the label) and the status Text of each, nothing else (no
// header, task, meter or roster line).
export const deskTexts = async (ui: any): Promise<string[]> => {
  const out: string[] = []
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== 'object') return
    const key = String(node.key ?? node.props?.key)
    if (node.type === 'Box' && /^(header|roster|task-.*|meter-.*)$/.test(key)) return
    if (node.type === 'Button') return void out.push(buttonText(node))
    if (node.type === 'Text') return void out.push(shown(node))
    walk(node.children ?? [])
  }
  walk(await ui.find({}))

  return out
}

// The label Buttons of the pixel layout, in drawn order.
export const buttonsOf = async (ui: any): Promise<any[]> =>
  await ui.findAll({ type: 'Button' })

export const buttonKey = (one: any): string => String(one.key ?? one.props?.key)

export const buttonText = (one: any): string => one.text || one.props?.label || shown(one)

// The label a desk's Button carries: the desk label alone (the terminal draws
// "<hotkey>: <label>" itself, the Button being plain).
export const buttonLabel = (slot: string): string =>
  DESKS.find(([name]) => name === slot)![1]

// The text list shows on every surface but a wide terminal: a terminal narrower
// than 18 columns stands for it here.
export const rowsOn = async ($: any, surface: (typeof SURFACES)[number]) => {
  const ui = await mountPane($, surface, surface === 'terminal' ? 17 : 54)
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return found.map((one: any) => one.text as string)
}

// The pane draws the same ten rows on every surface.
export const expectRows = async (
  $: any,
  status: Record<string, string> = {},
) => {
  for (const surface of SURFACES) {
    expect(await rowsOn($, surface)).toEqual(expectedRows(status))
  }
}

// The spec's cell rule, written out on its own: the sprite as a 16 by 16 grid
// of colours or undefined, then cells from it. Scale 1 packs two pixel rows
// per terminal row (16 by 8 cells); scale 2 shows pixel (floor(X / 2), Y) in
// both halves of cell (X, Y) (32 by 16 cells).
type Look = 'idle' | 'working' | 'done' | 'failed' | 'waiting'

// T2: a working desk is its plain working frame whatever the tool. A waiting
// desk is the undimmed idle art with no stamp, as the done and failed desks
// are (those two carry their corner stamp at x 11..15, y 0..4).
const spritePixels = (
  slot: string,
  look: Look,
  frame: 0 | 1 | 2 | 3,
): Array<Array<number | undefined>> => {
  const name = look === 'working' ? (`work${frame}` as const) : 'idle'
  const art = SPRITES[slot]![name]

  return art.map((line, y) =>
    line.split('').map((one, x) => {
      if (look === 'done' || look === 'failed') {
        const stamp = STAMPS[look]
        const mark = x >= 11 && y <= 4 ? stamp[y]?.[x - 11] : undefined
        if (mark !== undefined && mark !== '.') return PALETTE[mark]
      }
      if (one === '.') return undefined
      const colour = PALETTE[one]!

      return look === 'idle' ? dim(colour) : colour
    }),
  )
}

export const expectedCells = (
  slot: string,
  look: Look,
  frame: 0 | 1 | 2 | 3,
  scale: 1 | 2 = 1,
): number[] => {
  const grid = spritePixels(slot, look, frame)
  const words: number[] = []

  if (scale === 2) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const colour = grid[y]![Math.floor(x / 2)]
        if (colour === undefined) words.push(0x20, 0x01000000, 0x01000000)
        else words.push(0x2580, colour, colour)
      }
    }

    return words
  }

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 16; c += 1) {
      const top = grid[2 * r]![c]
      const bottom = grid[2 * r + 1]![c]
      if (top === undefined && bottom === undefined) {
        words.push(0x20, 0x01000000, 0x01000000)
      } else if (bottom === undefined) {
        words.push(0x2580, top!, 0x01000000)
      } else if (top === undefined) {
        words.push(0x2584, bottom, 0x01000000)
      } else {
        words.push(0x2580, top, bottom)
      }
    }
  }

  return words
}

// Index of the first word where two cell lists differ, or -1 when they match:
// keeps a failure readable where toEqual would print 1536 words.
export const firstDifference = (got: number[], want: number[]): number => {
  const length = Math.max(got.length, want.length)
  for (let i = 0; i < length; i += 1) if (got[i] !== want[i]) return i

  return -1
}
