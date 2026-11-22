import type { AgentInfo, SessionUsage } from 'claude-code'

import type { DeskState, Note, Office } from '../types'

import { layout, shortRows, tallPlan } from './scene'
import type { Look } from './scene'

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

export type Reason = 'answer' | 'error' | 'refusal' | 'aborted'

export const MAIN = 'main'
export const MARK_MS = 5000
export const ADVISE_MS = 5000

const CREW = DESKS.slice(1, -2).map(([slot]) => slot)

export const emptyOffice: Office = { desks: {}, deskOf: {} }

export const deskOfType = (type: string): string => {
  const name = type.slice(type.lastIndexOf(':') + 1)

  return CREW.includes(name) ? name : 'guest'
}

export const toolLabel = (tool: string): string =>
  (tool.startsWith('mcp__')
    ? tool.slice(tool.lastIndexOf('__') + 2)
    : tool
  ).slice(0, 14)

const TARGET_MAX = 24

export const clean = (text: string): string =>
  text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')

const WIDE = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xa960, 0xa97f],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x17000, 0x1b2ff],
  [0x1f200, 0x1f2ff],
  [0x20000, 0x3fffd],
] as const

const columnsOf = (char: string): 1 | 2 => {
  const code = char.codePointAt(0)!

  return WIDE.some(([from, to]) => code >= from && code <= to) ||
    /\p{Extended_Pictographic}/u.test(char)
    ? 2
    : 1
}

const widthOf = (text: string): number =>
  [...text].reduce((sum, char) => sum + columnsOf(char), 0)

const cut = (text: string, width: number): string => {
  if (widthOf(text) <= width) return text
  let used = 0
  let kept = ''
  for (const char of text) {
    used += columnsOf(char)
    if (used > width - 1) break
    kept += char
  }

  return `${kept}…`
}

export const elapsed = (ms: number): string => {
  const total = Math.floor(Math.max(0, ms) / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m${two(total % 60)}s`

  return `${Math.floor(total / 3600)}h${two(Math.floor((total % 3600) / 60))}m`
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const lastPart = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const targetPart = (tool: string, input: Record<string, unknown>): string | undefined => {
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'Read': {
      const path = text(input.file_path)

      return path === undefined ? undefined : lastPart(path)
    }
    case 'NotebookEdit': {
      const path = text(input.notebook_path)

      return path === undefined ? undefined : lastPart(path)
    }
    case 'Bash': {
      const words = text(input.command)?.trim().split(/\s+/) ?? []
      const target = words.findIndex(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))

      return words
        .slice(0, target < 0 ? words.length : target)
        .some(word => /^[A-Za-z_][A-Za-z0-9_]*=['"]/.test(word))
        ? undefined
        : words[target]
    }
    case 'Grep':
    case 'Glob':
      return text(input.pattern)
    case 'WebFetch':
      return text(input.url)?.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]*)/i)?.[1]
    case 'WebSearch':
      return text(input.query)
    default:
      return undefined
  }
}

export const targetOf = (
  tool: string,
  input: Record<string, unknown>,
): string | undefined => {
  const part = targetPart(tool, input)

  return part === undefined || part === '' ? undefined : [...clean(part)].slice(0, TARGET_MAX).join('')
}

export const labelOf = (slot: string): string =>
  DESKS.find(([one]) => one === slot)?.[1] ?? slot

const deskIn = (office: Office, slot: string): DeskState =>
  office.desks[slot] ?? { agentIds: [] }

const withDesk = (office: Office, slot: string, desk: DeskState): Office => ({
  ...office,
  desks: { ...office.desks, [slot]: desk },
})

export const begin = (office: Office, slot: string, agentId: string): Office => {
  const previous = office.deskOf[agentId]
  const moved =
    previous === undefined || previous === slot
      ? office
      : withDesk(office, previous, {
          ...deskIn(office, previous),
          agentIds: deskIn(office, previous).agentIds.filter(id => id !== agentId),
        })
  const { agentIds, tool, count, target, last } = deskIn(moved, slot)
  const desk: DeskState = {
    agentIds: agentIds.includes(agentId) ? agentIds : [...agentIds, agentId],
  }
  if (agentIds.length > 0 && tool !== undefined) desk.tool = tool
  if (agentIds.length > 0 && target !== undefined) desk.target = target
  if (count !== undefined) desk.count = count
  if (last !== undefined) desk.last = last

  return {
    ...withDesk(moved, slot, desk),
    deskOf: { ...moved.deskOf, [agentId]: slot },
  }
}

export const hasEnded = (office: Office, agentId: string): boolean =>
  agentId in office.deskOf &&
  !Object.values(office.desks).some(desk => desk.agentIds.includes(agentId))

export const noteSpawn = (
  office: Office,
  slot: string,
  agentId: string,
  note: { desc: string; model: string; now: number },
): Office => {
  const placed = begin(office, slot, agentId)
  const effort = placed.agents?.[agentId]?.effort

  return {
    ...withDesk(placed, slot, { ...deskIn(placed, slot), last: agentId }),
    agents: {
      ...placed.agents,
      [agentId]: {
        ...(effort === undefined ? {} : { effort }),
        desc: clean(note.desc),
        model: clean(note.model),
        started: note.now,
      },
    },
  }
}

export const useTool = (
  office: Office,
  slot: string,
  agentId: string,
  tool: string,
  target?: string,
): Office => {
  const started = agentId in office.deskOf ? office : begin(office, slot, agentId)
  const { target: _, ...desk } = deskIn(started, slot)

  return withDesk(started, slot, {
    ...desk,
    tool: toolLabel(tool),
    ...(target === undefined ? {} : { target }),
    last: agentId,
  })
}

export const finish = (
  office: Office,
  slot: string,
  agentId: string,
  reason: Reason,
  now: number,
  outcome?: string,
): Office => {
  const { tool, agentIds, count = 0, target, last } = deskIn(office, slot)
  const until = now + MARK_MS
  const desk: DeskState = { agentIds: agentIds.filter(id => id !== agentId) }
  if (tool !== undefined) desk.tool = tool
  if (target !== undefined) desk.target = target
  if (last !== undefined) desk.last = last
  const isCounted =
    reason === 'answer' && slot !== 'manager' && agentIds.includes(agentId)
  if (count > 0 || isCounted) desk.count = count + (isCounted ? 1 : 0)
  if (desk.agentIds.length === 0 && reason !== 'aborted') {
    desk.mark = reason === 'answer' ? 'done' : 'failed'
    desk.until = until
    if (outcome !== undefined) desk.outcome = clean(outcome)
  }

  return withDesk(office, slot, desk)
}

export const expire = (office: Office, slot: string, until: number): Office => {
  const { agentIds, tool, count, target, last, until: marked } = deskIn(office, slot)
  if (marked !== until) return office
  const desk: DeskState = { agentIds }
  if (tool !== undefined) desk.tool = tool
  if (count !== undefined) desk.count = count
  if (target !== undefined) desk.target = target
  if (last !== undefined) desk.last = last
  const kept = withDesk(office, slot, desk)
  if (kept.agents === undefined) return kept
  const onDesk = new Set(
    Object.values(kept.desks).flatMap(one => [
      ...one.agentIds,
      ...(one.last !== undefined && (one.mark !== undefined || one.agentIds.length > 0)
        ? [one.last]
        : []),
    ]),
  )

  return {
    ...kept,
    agents: Object.fromEntries(
      Object.entries(kept.agents).filter(([id]) => onDesk.has(id)),
    ),
  }
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const noteOf = (info: AgentInfo): Note =>
  Object.fromEntries(
    Object.entries({
      label: info.label === undefined ? undefined : clean(info.label.split(/\r\n|[\n\u0085\u2028\u2029]/)[0]!),
      model: info.model === undefined ? undefined : clean(info.model),
      started: info.startTime,
      tokens: info.tokenCount,
      window: info.contextWindowSize,
      samples: info.tokenSamples,
      status: info.status,
    }).filter(([, value]) => value !== undefined),
  )

export const mergePoll = (
  office: Office,
  listed: AgentInfo[],
  used: SessionUsage | undefined,
): Office => {
  const onDesk = new Set(Object.values(office.desks).flatMap(one => one.agentIds))
  const notes = { ...office.agents }
  let isChanged = false
  for (const info of listed) {
    if (!onDesk.has(info.id)) continue
    const before = notes[info.id] ?? {}
    const next = { ...before, ...noteOf(info) }
    if (sameJson(before, next)) continue
    notes[info.id] = next
    isChanged = true
  }

  const percent = used?.context.percent
  const usd = used?.cost?.usd
  const fiveHour = used?.rateLimits?.find(one => one.kind === 'five_hour')?.percentUsed
  const sevenDay = used?.rateLimits?.find(one => one.kind === 'seven_day')?.percentUsed
  const usage = {
    ...(percent === undefined ? {} : { percent }),
    ...(usd === undefined ? {} : { usd }),
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(sevenDay === undefined ? {} : { sevenDay }),
  }
  const isUsageNew =
    Object.keys(usage).length > 0 && !sameJson(office.usage, usage)
  if (!isChanged && !isUsageNew) return office

  return {
    ...office,
    ...(isChanged ? { agents: notes } : {}),
    ...(isUsageNew ? { usage } : {}),
  }
}

export const noteStart = (office: Office, agentId: string, now: number): Office => ({
  ...office,
  agents: { ...office.agents, [agentId]: { ...office.agents?.[agentId], started: now } },
})

export const noteEffort = (
  office: Office,
  agentId: string,
  effort: string | number | undefined,
  model?: string,
): Office => {
  const note = office.agents?.[agentId]
  const same = effort === undefined ? undefined : String(effort)
  const named = model === undefined ? note?.model : clean(model)
  if (note?.effort === same && note?.model === named) return office
  const { effort: _, ...before } = note ?? {}
  const next = {
    ...before,
    ...(named === undefined ? {} : { model: named }),
    ...(same === undefined ? {} : { effort: same }),
  }

  return { ...office, agents: { ...office.agents, [agentId]: next } }
}

export const resetCounts = (office: Office): Office => {
  const { usage: _usage, feed: _feed, agents: _agents, advisor: _advisor, consulting: _consulting, ...rest } = office

  return {
    ...rest,
    desks: Object.fromEntries(
      Object.entries(office.desks).map(([slot, { count: _, last: __, ...desk }]) => [
        slot,
        desk,
      ]),
    ),
  }
}

export const isWorking = (desk: DeskState | undefined): boolean =>
  (desk?.agentIds.length ?? 0) > 0

export const lookOf = (desk: DeskState | undefined, now: number): Look => {
  if (isWorking(desk)) return 'working'

  return desk?.mark !== undefined && (desk.until ?? 0) > now ? desk.mark : 'idle'
}

export const frameOf = (ticks: number, slot: string): 0 | 1 | 2 | 3 =>
  ((ticks + DESKS.findIndex(([one]) => one === slot)) % 4) as 0 | 1 | 2 | 3

export const isAdvised = (office: Office, slot: string, now: number): boolean =>
  slot === 'manager' && (office.advisor?.until ?? 0) > now

export const noteAdvice = (office: Office, until: number, model?: string): Office => ({
  ...office,
  advisor: { until, ...(model === undefined ? {} : { model: clean(model) }) },
})

export const countAdvice = (office: Office, uses: number): Office =>
  withDesk(office, 'advisor', {
    ...deskIn(office, 'advisor'),
    count: (deskIn(office, 'advisor').count ?? 0) + uses,
  })

export const noteConsulting = (office: Office, isOn: boolean): Office => {
  if ((office.consulting === true) === isOn) return office
  const { consulting: _, ...rest } = office

  return isOn ? { ...rest, consulting: true } : rest
}

export const expireAdvice = (office: Office, until: number): Office => {
  if (office.advisor?.until !== until) return office
  const { advisor: _, ...rest } = office

  return rest
}

export const sceneOf = (office: Office, slot: string, now: number): Look => {
  if (isAdvised(office, slot, now)) return 'advised'
  if (slot === 'advisor' && office.consulting === true) return 'working'
  const desk = office.desks[slot]
  const look = lookOf(desk, now)

  return look === 'working' && isWaiting(office, desk!) ? 'waiting' : look
}

const crowd = (desk: DeskState): string =>
  desk.agentIds.length > 1 ? `x${desk.agentIds.length}` : ''

const counted = (desk: DeskState | undefined, text: string): string =>
  (desk?.count ?? 0) >= 1 ? `${desk?.count} · ${text}` : text

export const statusText = (
  desk: DeskState | undefined,
  now: number,
): string => {
  const look = lookOf(desk, now)
  if (look !== 'working' || desk === undefined) return counted(desk, look)

  return counted(desk, ['working', crowd(desk), desk.tool].filter(Boolean).join(' '))
}

export const isWaiting = (office: Office, desk: DeskState): boolean =>
  desk.agentIds.every(id => office.agents?.[id]?.status === 'waiting')

export const deskStatus = (
  office: Office,
  slot: string,
  now: number,
  width: number,
): string => {
  const desk = office.desks[slot]
  if (isAdvised(office, slot, now)) {
    const model = office.advisor?.model

    return cut(model === undefined ? 'advised' : `advised by ${shortModel(model)}`, width)
  }
  if (slot === 'advisor' && office.consulting === true) {
    return cut(counted(desk, 'consulting'), width)
  }
  const look = lookOf(desk, now)
  if (desk === undefined || look === 'idle') return cut(counted(desk, 'idle'), width)
  if (look === 'done') {
    return cut(counted(desk, ['done', desk.outcome].filter(Boolean).join(' ')), width)
  }
  if (look === 'failed') return cut(counted(desk, desk.outcome ?? 'failed'), width)
  if (isWaiting(office, desk)) return cut(counted(desk, 'waiting'), width)

  const parts = [crowd(desk), desk.tool, desk.target].filter(Boolean)

  return cut(counted(desk, parts.length === 0 ? 'working' : parts.join(' ')), width)
}

const crewCounts = (office: Office): { working: number; done: number } => {
  const desks = Object.entries(office.desks).filter(
    ([slot]) => slot !== 'manager' && slot !== 'advisor',
  )

  return {
    working: desks.reduce((sum, [, desk]) => sum + desk.agentIds.length, 0),
    done: desks.reduce((sum, [, desk]) => sum + (desk.count ?? 0), 0),
  }
}

export const headerText = (office: Office, width: number): string => {
  const { working, done } = crewCounts(office)
  const { percent, usd, fiveHour, sevenDay } = office.usage ?? {}
  const segments = [
    `${working} working`,
    `${done} done`,
    ...(percent === undefined ? [] : [`ctx ${Math.round(percent)}%`]),
    ...(fiveHour === undefined ? [] : [`5h ${Math.round(fiveHour)}%`]),
    ...(sevenDay === undefined ? [] : [`7d ${Math.round(sevenDay)}%`]),
    ...(usd === undefined || usd === 0 ? [] : [`~$${usd.toFixed(2)}`]),
  ]
  while (segments.length > 1 && segments.join(' · ').length > width) segments.pop()

  return segments.join(' · ')
}

export const crewSummary = (office: Office): string => {
  const { working, done } = crewCounts(office)

  return `crew: ${working} working · ${done} done`
}

const agentNote = (office: Office, desk: DeskState | undefined, look: Look) => {
  if (desk === undefined || look === 'idle') return undefined
  const id = desk.agentIds[desk.agentIds.length - 1] ?? desk.last

  return id === undefined ? undefined : office.agents?.[id]
}

export const taskText = (
  office: Office,
  slot: string,
  now: number,
  width: number,
  count: 1 | 2,
): string[] => {
  const desk = office.desks[slot]
  const note = agentNote(office, desk, lookOf(desk, now))
  const parts = [
    ...new Set(
      [note?.label, note?.desc]
        .filter(Boolean)
        .map(one => clean(one!.split(/\r\n|[\n\u0085\u2028\u2029]/)[0]!)),
    ),
  ]

  return Array.from({ length: count }, (_, at) => cut(parts[at] || ' ', width))
}

const EFFORTS: Record<string, string> = {
  low: 'lo',
  medium: 'me',
  high: 'hi',
  xhigh: 'xh',
  max: 'ma',
}

const MODELS = ['sonnet', 'opus', 'fable', 'haiku']

const shortModel = (model: string): string => MODELS.find(one => model.includes(one)) ?? model

export const meterText = (
  office: Office,
  slot: string,
  now: number,
  width: number,
): string => {
  const desk = office.desks[slot]
  const note = lookOf(desk, now) === 'working' ? agentNote(office, desk, 'working') : undefined
  if (note === undefined) return ' '
  const { started, model, effort } = note
  const time = started === undefined ? '' : elapsed(now - started)
  const name = model === undefined ? '' : shortModel(model)
  const spaced = [effort === undefined ? '' : (EFFORTS[effort] ?? effort), time]
    .filter(Boolean)
    .join(' ')
  const isSpaced =
    effort !== undefined && width - widthOf(` ${spaced}`) >= Math.min(3, widthOf(name))
  const tail = isSpaced ? spaced : time
  const gap = isSpaced ? ' ' : ' · '
  const head = cut(name, Math.max(1, width - (tail === '' ? 0 : widthOf(`${gap}${tail}`))))

  return cut([head, tail].filter(Boolean).join(gap) || ' ', width)
}

export type Drawing = {
  scale: 1 | 2
  tasks: 1 | 2
  lines: string[][]
  info: Set<string>
  roster?: string
}

const rankOf = (office: Office, slot: string, now: number): number => {
  const desk = office.desks[slot]
  const look = lookOf(desk, now)
  if (isAdvised(office, slot, now)) return 0
  if (look === 'working') return isWaiting(office, desk!) ? 1 : 0

  return look === 'idle' ? 3 : 2
}

const NINE = DESKS.map(([slot]) => slot).filter(slot => slot !== 'advisor')

const seatAdvisor = (
  lines: string[][],
  columns: number,
  left: number,
  scale: 1 | 2,
  isGuestIdle: boolean,
): { lines: string[][]; seat: 'drawn' | 'swapped' | 'listed' } => {
  const last = lines[lines.length - 1]
  if (lines.flat().length === NINE.length && last !== undefined) {
    if (last.length < columns) {
      return { lines: [...lines.slice(0, -1), [...last, 'advisor']], seat: 'drawn' }
    }
    if (left >= 8 * scale + 2) return { lines: [...lines, ['advisor']], seat: 'drawn' }
  }
  if (isGuestIdle && lines.flat().includes('guest')) {
    return {
      lines: lines.map(line => line.map(slot => (slot === 'guest' ? 'advisor' : slot))),
      seat: 'swapped',
    }
  }

  return { lines, seat: 'listed' }
}

export const arrange = (
  office: Office,
  now: number,
  bodyColumns: number,
  bodyRows: number,
): Drawing => {
  const { columns, scale } = layout(bodyColumns, bodyRows)
  const advisor = office.desks.advisor?.count ?? 0
  const advisorEntry = [
    'advisor',
    ...(advisor >= 1 ? [advisor] : []),
    ...(office.consulting === true ? ['consulting'] : []),
  ].join(' ')
  const isGuestIdle = rankOf(office, 'guest', now) === 3
  const tall = tallPlan(columns, scale, bodyRows)
  if (tall !== undefined) {
    const nine = []
    for (let from = 0; from < NINE.length; from += columns) {
      nine.push(NINE.slice(from, from + columns))
    }
    const left =
      bodyRows -
      (1 + nine.length * (8 * scale + 4) + (tall.tasks === 2 ? nine.length : 0))
    const { lines, seat } = seatAdvisor(nine, columns, left, scale, isGuestIdle)
    const entry = seat === 'swapped' ? 'guest' : advisorEntry

    return {
      scale,
      ...tall,
      lines,
      info: new Set(NINE),
      ...(seat === 'drawn' || left < 1 ? {} : { roster: cut(entry, bodyColumns) }),
    }
  }

  const ranks = new Map(NINE.map(slot => [slot, rankOf(office, slot, now)]))
  const ordered = [...NINE].sort((a, b) => ranks.get(a)! - ranks.get(b)!)
  const rows: string[][] = []
  const info = new Set<string>()
  let from = 0
  let used = 0
  for (const { count, isInfo } of shortRows(
    ordered.map(slot => ranks.get(slot)! < 3),
    columns,
    bodyRows,
  )) {
    const line = ordered.slice(from, from + count)
    from += count
    rows.push(line)
    used += isInfo ? 12 : 10
    if (isInfo) line.filter(slot => ranks.get(slot)! < 3).forEach(slot => info.add(slot))
  }
  const { lines, seat } = seatAdvisor(rows, columns, bodyRows - 2 - used, scale, isGuestIdle)
  const rest = ordered.slice(from)
  const entries = rest.map(slot => labelOf(slot) + (ranks.get(slot)! < 3 ? '*' : ''))
  if (seat === 'listed') {
    entries.splice(rest.filter(slot => ranks.get(slot)! < 3).length, 0, advisorEntry)
  }
  if (seat === 'swapped') entries.push('guest')
  const roster = entries.join('  ')

  return {
    scale,
    tasks: 1,
    lines,
    info,
    ...(roster === '' ? {} : { roster: cut(roster, bodyColumns) }),
  }
}
