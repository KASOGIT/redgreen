import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Office } from '../types'

import {
  ADVISE_MS,
  DESKS,
  MAIN,
  MARK_MS,
  arrange,
  begin,
  deskOfType,
  elapsed,
  emptyOffice,
  expire,
  finish,
  hasEnded,
  frameOf,
  isWaiting,
  isWorking,
  mergePoll,
  expireAdvice,
  countAdvice,
  noteAdvice,
  noteConsulting,
  noteEffort,
  sceneOf,
  noteStart,
  noteSpawn,
  crewSummary,
  resetCounts,
  targetOf,
  useTool,
} from './model'
import type { Reason } from './model'
import { composeDesk, encodeCells } from './scene'
import { pixels, rows } from './view'

const PANE = 'crew-office'
const OPEN = { id: PANE, title: 'Crew office', columns: 200 } as const
const ON = 'Crew office on: it opens whenever the crew works.'
const OFF = 'Crew office off: it stays closed until /crew-office on.'
const NOT_DRAWN_ON =
  'Crew office on, but this session is not drawing it: Claude Code reports the pane placed and shown and has never drawn it. Try a new session.'
const NOT_DRAWN_OFF =
  'Crew office off. Note: this session never drew the pane, although Claude Code reported it placed and shown. Try a new session.'
const USAGE = 'Usage: /crew-office [on|off]'
const DRAW_WAIT_MS = 2000
const TICK_MS = 500
const POLL_EVERY = 4
const POLL_WAIT_MS = 10000
const office = atom({ plugin: 'crew-office', key: 'office' } as const, emptyOffice)

const VIEW_KEY = 'view-'
const VIEW_WAIT_MS = 2000
const RECORD_WAIT_MS = 500
const VIEW_FAILED = 'Could not open that agent'

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })

  return { promise, resolve, reject }
}

const showDesk = async ($: EngineInterface, slot: string) => {
  let reason: string | undefined
  try {
    const last = slot === 'manager' ? undefined : (await read($, office)).desks[slot]?.last
    const answer = deferred<{ deny?: string }>()
    const timer = $.clock.after(VIEW_WAIT_MS, () => answer.resolve({ deny: 'no answer' }))
    $.ui.view(last === undefined ? {} : { agentId: last }).then(answer.resolve, answer.reject)
    try {
      reason = (await answer.promise).deny
    } finally {
      timer.cancel()
    }
  } catch (error) {
    reason = reasonOf(error)
  }
  if (reason === undefined) return
  try {
    await $.ui.toast(`${VIEW_FAILED}: ${reason}`)
  } catch {}
}

const within = async ($: EngineInterface, recording: Promise<void>) => {
  const late = deferred()
  const timer = $.clock.after(RECORD_WAIT_MS, late.resolve)
  await Promise.race([recording, late.promise])
  timer.cancel()
}

const slotOf = async ($: EngineInterface, agentId: string | undefined) => {
  if (agentId === undefined) return 'manager'

  const known = (await read($, office)).deskOf[agentId]
  if (known !== undefined) return known

  const found = (await $.agent.list()).find(one => one.id === agentId)

  return deskOfType(found?.type ?? '')
}

let ticks = 0
let ticker: Timer | undefined
let isPixel = false
let scale: 1 | 2 = 1
let drawnSlots = new Set<string>()
// Kept here, not in $.state or $.store: a render hook may not write.
let isDrawn = false
let waitingSince: number | undefined
let shownStatus: string | undefined
let statusSeq = 0
let isPolling = false
let undrawn = ''
let usageCalls = 0
let usageInFlight = 0
let usageEpoch = 0
const pendingStarts = new Map<string, Promise<void>>()

const armExpiry = ($: EngineInterface, slot: string, until: number, delay: number) => {
  $.clock.after(delay, () => {
    void update($, office, one => expire(one, slot, until)).catch(() => {})
  })
}

const dropAdvice = async ($: EngineInterface, until: number) => {
  const written = await update($, office, one => expireAdvice(one, until)).catch(() =>
    read($, office),
  )
  $.ui.invalidate('ui.render')
  await settle($, written)
}

const armAdvice = ($: EngineInterface, until: number, delay: number, isDrop = false) => {
  try {
    $.clock.after(delay, () => (isDrop ? void dropAdvice($, until) : $.ui.invalidate('ui.render')))
  } catch {}
}

const finishAgent = async (
  $: EngineInterface,
  slot: string,
  agentId: string,
  reason: Reason,
  outcome?: string,
  isOnDesk = false,
) => {
  const now = await $.clock.now()
  const until = now + MARK_MS
  const written = await update($, office, one =>
    isOnDesk && !one.desks[slot]?.agentIds.includes(agentId)
      ? one
      : finish(one, slot, agentId, reason, now, outcome),
  )
  armExpiry($, slot, until, MARK_MS)

  return written
}

const poll = async ($: EngineInterface, isAbandoned: () => boolean) => {
  if (usageInFlight === 0) {
    const call = ++usageCalls
    usageInFlight = call
    const epoch = usageEpoch
    const isStale = () => epoch !== usageEpoch || usageInFlight !== call
    const release = () => {
      if (usageInFlight === call) usageInFlight = 0
    }
    const timer = $.clock.after(POLL_WAIT_MS, release)
    void $.session
      .usage()
      .then(async used => {
        if (isStale()) return
        const current = await read($, office)
        if (mergePoll(current, [], used) !== current) {
          await update($, office, one =>
            isStale() ? one : mergePoll(one, [], used),
          )
        }
      })
      .catch(() => {})
      .finally(() => {
        timer.cancel()
        release()
      })
  }
  const listed = await $.agent.list()
  if (isAbandoned()) return undefined
  const now = await $.clock.now()
  if (isAbandoned()) return undefined
  let latest = await read($, office)
  if (isAbandoned()) return undefined

  if (mergePoll(latest, listed, undefined) !== latest) {
    try {
      latest = await update($, office, one => mergePoll(one, listed, undefined))
    } catch {}
    if (isAbandoned()) return undefined
  }

  for (const [slot, desk] of Object.entries(latest.desks)) {
    for (const agentId of desk.agentIds) {
      if (isAbandoned()) return undefined
      const status = listed.find(one => one.id === agentId)?.status
      if (status === 'completed') {
        const started = latest.agents?.[agentId]?.started
        latest = await finishAgent(
          $,
          slot,
          agentId,
          'answer',
          started === undefined ? undefined : elapsed(now - started),
          true,
        )
      } else if (status === 'failed' || status === 'killed') {
        latest = await finishAgent($, slot, agentId, 'error', undefined, true)
      }
      if (isAbandoned()) return undefined
    }
  }

  return latest
}

const tick = async ($: EngineInterface) => {
  ticks += 1
  const state = await read($, office)
  const now = state.advisor === undefined ? 0 : await $.clock.now()

  if (isPixel) {
    const missing: string[] = []
    for (const [slot] of DESKS) {
      const desk = state.desks[slot]
      const look =
        state.advisor === undefined && state.consulting === undefined
          ? undefined
          : sceneOf(state, slot, now)
      const isConsulting = slot === 'advisor' && look === 'working'
      if (look !== 'advised' && !isConsulting && (!isWorking(desk) || isWaiting(state, desk!))) continue
      if (!drawnSlots.has(slot)) {
        missing.push(slot)
        continue
      }

      const drawn = await $.ui.blit({
        requestId: PANE,
        key: `desk-${slot}`,
        cells: encodeCells(
          composeDesk(slot, look ?? 'working', frameOf(ticks, slot), scale),
        ),
      })
      if (drawn.deny !== undefined) {
        isPixel = false
        $.ui.invalidate('ui.render')
        missing.length = 0
        break
      }
    }
    if (missing.join() !== undrawn) {
      undrawn = missing.join()
      if (undrawn !== '') $.ui.invalidate('ui.render')
    }
  }

  if (state.advisor !== undefined && state.advisor.until < now) {
    void dropAdvice($, state.advisor.until).catch(() => {})
  }

  if (ticks % POLL_EVERY === 0 && !isPolling) {
    isPolling = true
    let isAbandoned = false
    const expired = deferred()
    const timer = $.clock.after(POLL_WAIT_MS, () => {
      isAbandoned = true
      expired.resolve()
    })
    const run = (async () => {
      const latest = await poll($, () => isAbandoned)
      if (latest !== undefined && !isAbandoned) await settle($, latest)
    })()
    run.catch(() => {})
    try {
      await Promise.race([run, expired.promise])
    } finally {
      timer.cancel()
      isPolling = false
    }
  }
}

const syncStatus = async ($: EngineInterface, state: Office) => {
  const seq = ++statusSeq
  const isAlive = Object.entries(state.desks).some(
    ([slot, desk]) => slot !== 'manager' && isWorking(desk),
  )
  const isPlaced = (await $.ui.panes()).some(
    pane => pane.id === PANE && pane.isPlaced,
  )
  const wanted =
    isAlive && !isPlaced && (await isAuto($)) ? crewSummary(state) : undefined
  if (seq !== statusSeq || wanted === shownStatus) return

  await $.ui.status(wanted)
  shownStatus = wanted
}

const settle = async ($: EngineInterface, state: Office) => {
  void syncStatus($, state).catch(() => {})
  const isBusy =
    Object.values(state.desks).some(isWorking) ||
    state.consulting === true ||
    (state.advisor !== undefined && state.advisor.until > (await $.clock.now()))

  if (isBusy && ticker === undefined) {
    ticks = 0
    undrawn = ''
    ticker = $.clock.every(TICK_MS, () => {
      void tick($).catch(() => {})
    })
  } else if (!isBusy && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

const isAuto = async ($: EngineInterface) =>
  (await $.store.get('auto')) !== false

const isListed = async ($: EngineInterface) =>
  (await $.ui.panes()).some(pane => pane.id === PANE)

const outcomeOf = (reason: Reason, durationMs: number): string | undefined => {
  if (reason === 'answer') return elapsed(durationMs)
  if (reason === 'refusal') return 'refused'

  return reason === 'error' ? 'error' : undefined
}

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const watchDraw = async ($: EngineInterface) => {
  isDrawn = false
  waitingSince = await $.clock.now()
}

const isNeverDrawn = async (
  $: EngineInterface,
  pane: { isPlaced: boolean; isShown: boolean } | undefined,
) =>
  pane?.isPlaced === true &&
  pane.isShown &&
  !isDrawn &&
  waitingSince !== undefined &&
  (await $.clock.now()) - waitingSince >= DRAW_WAIT_MS

const autoOpen = async ($: EngineInterface) => {
  if (await isListed($)) return
  if (!(await isAuto($))) return

  await watchDraw($)
  await $.ui.open(OPEN)
  if (!(await isAuto($))) await $.ui.close({ id: PANE })
}

const turnOn = async ($: EngineInterface) => {
  await $.store.set('auto', true)
  const listed = (await $.ui.panes()).find(pane => pane.id === PANE)
  if (listed?.isPlaced) {
    return { text: (await isNeverDrawn($, listed)) ? NOT_DRAWN_ON : ON }
  }

  try {
    await watchDraw($)
    const opened = await $.ui.open(OPEN)

    return {
      text: opened.isPlaced
        ? ON
        : `Crew office on, not shown yet: ${opened.reason}`,
    }
  } catch (error) {
    return { text: `Crew office on, not shown yet: ${reasonOf(error)}` }
  }
}

const turnOff = async ($: EngineInterface) => {
  await $.store.set('auto', false)
  let text = OFF
  try {
    const listed = (await $.ui.panes()).find(pane => pane.id === PANE)
    if (listed !== undefined) {
      if (await isNeverDrawn($, listed)) text = NOT_DRAWN_OFF
      await $.ui.close({ id: PANE })
    }
  } catch (error) {
    return {
      text: `Crew office off, but the pane is still open: ${reasonOf(error)}`,
    }
  }

  return { text }
}

const runCommand = async ($: EngineInterface, args: string) => {
  const arg = args.trim().toLowerCase()
  if (arg === 'on') return turnOn($)
  if (arg === 'off') return turnOff($)
  if (arg !== '') return { text: USAGE }

  return (await isAuto($)) ? turnOff($) : turnOn($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Turn the crew office pane on or off: /crew-office [on|off]',
    })
    try {
      waitingSince ??= await $.clock.now()
      $.ui.invalidate('ui.render')
      const state = await read($, office)
      const now = await $.clock.now()
      for (const [slot, desk] of Object.entries(state.desks)) {
        if (desk.until !== undefined) {
          armExpiry($, slot, desk.until, Math.max(0, desk.until - now))
        }
      }
      if (state.advisor !== undefined) {
        armAdvice($, state.advisor.until, Math.max(0, state.advisor.until - now), true)
      }
      await settle($, state)
    } catch {}

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    try {
      if (e.source === 'startup' || e.source === 'clear') {
        usageEpoch += 1
        await settle($, await update($, office, resetCounts))
      }
    } catch {}

    return next(e)
  })

  on('command.run', { command: PANE }, async ($, e) => runCommand($, e.args))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)

    if (spawned.deny === undefined) {
      const slot = deskOfType(e.subagentType)
      if (slot !== 'guest') void autoOpen($).catch(() => {})
      const recording = (async () => {
        const now = await $.clock.now()
        const written = await update($, office, one =>
          spawned.agentId === undefined || hasEnded(one, spawned.agentId)
            ? one
            : noteSpawn(one, slot, spawned.agentId, {
                desc: e.description,
                model: spawned.model,
                now,
              }),
        )
        await settle($, written)
      })().catch(() => {})
      await within($, recording)
    }

    return spawned
  })

  on('turn.start', async ($, e, next) => {
    const who = e.agentId ?? MAIN
    const recording = (async () => {
      const slot = await slotOf($, e.agentId)
      const now = who === MAIN ? await $.clock.now().catch(() => undefined) : undefined
      const written = await update($, office, one => {
        const placed = begin(one, slot, who)

        return now === undefined ? placed : noteStart(placed, who, now)
      })
      await settle($, written)
    })().catch(() => {})
    pendingStarts.set(who, recording)
    void recording.then(() => {
      if (pendingStarts.get(who) === recording) pendingStarts.delete(who)
    })
    const answer = await next(e)
    await within($, recording)

    return answer
  })

  on('tool.call', async ($, e, next) => {
    const recording = (async () => {
      const slot = await slotOf($, e.agentId)
      const written = await update($, office, one =>
        useTool(one, slot, e.agentId ?? MAIN, e.tool, targetOf(e.tool, e)),
      )
      await settle($, written)
    })().catch(() => {})
    const answer = await next(e)
    await within($, recording)

    return answer
  })

  on('turn.step', async function* ($, e, next) {
    const recording = (async () => {
      const who = e.agentId ?? MAIN
      const model = who === MAIN ? e.model : undefined
      const current = await read($, office)
      if (noteEffort(current, who, e.effort, model) !== current) {
        await update($, office, one => noteEffort(one, who, e.effort, model))
      }
    })().catch(() => {})
    let isEnded = false
    let isReading = false
    let isAgain = false
    let writing: Promise<void> | undefined
    const setConsulting = async (isOn: boolean) => {
      const current = await read($, office)
      if (noteConsulting(current, isOn) === current) return
      const written = await update($, office, one =>
        isEnded && isOn ? one : noteConsulting(one, isOn),
      )
      await settle($, written)
    }
    const consult = async () => {
      const found = await $.session.messages({ last: 1, as: 'api' })
      const message = 'deny' in found ? undefined : found.at(-1)
      const content =
        message?.role === 'assistant' && Array.isArray(message.content)
          ? (message.content as { type?: string; name?: string; id?: string; tool_use_id?: string }[])
          : []
      const isOn = content.some(
        call =>
          call.type === 'server_tool_use' &&
          call.name === 'advisor' &&
          !content.some(one => one.tool_use_id === call.id),
      )
      if (isEnded) return
      writing = setConsulting(isOn)
      await writing
    }
    // Engine chunks are opaque: the newest message is the only mid-step signal.
    // The delta chunks never carry it, so they trigger no read.
    const watch = () => {
      if (isEnded) return
      if (isReading) {
        isAgain = true
        return
      }
      isReading = true
      void consult()
        .catch(() => {})
        .finally(() => {
          isReading = false
          if (isAgain) {
            isAgain = false
            watch()
          }
        })
    }
    const isMain = e.agentId === undefined
    const stream = next(e)
    let answer
    try {
      for await (const chunk of stream) {
        if (isMain && chunk.kind !== 'text' && chunk.kind !== 'thinking' && chunk.kind !== 'input') {
          watch()
        }
        yield chunk
      }
      answer = await stream.result
    } finally {
      isEnded = true
      if (isMain) {
        await within(
          $,
          (async () => {
            await writing?.catch(() => {})
            await setConsulting(false)
          })().catch(() => {}),
        )
      }
    }
    const uses =
      isMain
        ? (answer?.serverToolUses?.filter(
            one => one.name === 'advisor' && one.endedAt !== undefined,
          ).length ?? 0)
        : 0
    const advice =
      uses > 0
        ? (async () => {
            const until = (await $.clock.now()) + ADVISE_MS
            const written = await update($, office, one =>
              noteAdvice(countAdvice(one, uses), until),
            )
            armAdvice($, until, ADVISE_MS)
            await settle($, written)
            const model = await $.settings.read({ key: 'advisorModel' })
            if (typeof model === 'string') {
              await update($, office, one =>
                one.advisor?.until === until ? noteAdvice(one, until, model) : one,
              )
              $.ui.invalidate('ui.render')
            }
          })().catch(() => {})
        : undefined
    await within($, recording)
    if (advice !== undefined) await within($, advice)

    return answer
  })

  on('turn.complete', async ($, e, next) => {
    const recording = (async () => {
      await pendingStarts.get(e.agentId ?? MAIN)
      const slot = await slotOf($, e.agentId)
      const written = await finishAgent(
        $,
        slot,
        e.agentId ?? MAIN,
        e.reason,
        outcomeOf(e.reason, e.durationMs),
      )
      await settle($, written)
    })().catch(() => {})
    const answer = await next(e)
    await within($, recording)

    return answer
  })

  on('ui.press', async ($, e, next) => {
    const slot = e.element.slice(VIEW_KEY.length)
    if (
      e.requestId !== PANE ||
      !e.element.startsWith(VIEW_KEY) ||
      !DESKS.some(([one]) => one === slot)
    ) {
      return next(e)
    }
    await showDesk($, slot)

    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isDrawn = true
    const state = await read($, office)
    const now = await $.clock.now()
    const { bodyColumns, placement, scroll } = e.props

    if (
      e.surface === 'terminal' &&
      bodyColumns >= 18 &&
      scroll.bodyRows >= 12 &&
      placement !== 'widget'
    ) {
      isPixel = true
      const drawing = arrange(state, now, bodyColumns, scroll.bodyRows)
      scale = drawing.scale
      drawnSlots = new Set(drawing.lines.flat())

      return pixels($.ui.resolve(e), state, now, drawing, bodyColumns, ticks)
    }

    isPixel = false

    return rows($.ui.resolve(e), state, now)
  })
}
