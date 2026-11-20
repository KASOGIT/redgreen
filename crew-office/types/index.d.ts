export type DeskState = {
  agentIds: string[]
  tool?: string
  count?: number
  mark?: 'done' | 'failed'
  until?: number
  target?: string
  outcome?: string
  last?: string
}

export type Note = {
  desc?: string
  label?: string
  started?: number
  model?: string
  effort?: string
  tokens?: number
  window?: number
  samples?: number[]
  status?: string
}

export type FeedEvent = { at: number; label: string; text: string }

export type Office = {
  desks: { [slot: string]: DeskState }
  deskOf: { [agentId: string]: string }
  agents?: { [id: string]: Note }
  usage?: { percent?: number; usd?: number; fiveHour?: number; sevenDay?: number }
  advisor?: { until: number; model?: string }
  // Written by older versions; only the session reset still clears it.
  feed?: FeedEvent[]
}

declare module 'claude-code' {
  interface PluginState {
    'crew-office': { office: Office }
  }
}
