import type { ElementTable } from 'claude-code'

import type { Office } from '../types'

import {
  DESKS,
  deskStatus,
  isAdvised,
  headerText,
  labelOf,
  frameOf,
  sceneOf,
  meterText,
  statusText,
  taskText,
} from './model'
import type { Drawing } from './model'
import { composeDesk, encodeCells } from './scene'

export const rows = (
  { Box, Text }: ElementTable,
  office: Office,
  now: number,
) => (
  <Box flexDirection="column">
    {DESKS.map(([slot, label]) => (
      <Text>{`${label}: ${
        isAdvised(office, slot, now)
          ? deskStatus(office, slot, now, Infinity)
          : statusText(office.desks[slot], now)
      }`}</Text>
    ))}
  </Box>
)

// The ui.press hook in office.tsx takes every press of these buttons; the
// engine only requires an onPress at the bottom of the chain.
const noPress = () => {}

const hotkeyOf = (slot: string) =>
  String(DESKS.findIndex(([one]) => one === slot))

const drawn = (
  office: Office,
  slot: string,
  now: number,
  ticks: number,
  scale: 1 | 2,
) => {
  return composeDesk(slot, sceneOf(office, slot, now), frameOf(ticks, slot), scale)
}

export const pixels = (
  { Box, Button, Raster, Text }: ElementTable<'terminal'>,
  office: Office,
  now: number,
  drawing: Drawing,
  bodyColumns: number,
  ticks: number,
) => {
  const { scale, tasks, lines, info, roster } = drawing
  const width = 16 * scale

  return (
    <Box flexDirection="column">
      <Box key="header">
        <Text>{headerText(office, bodyColumns)}</Text>
      </Box>
      {lines.map(line => (
        <Box flexDirection="row" columnGap={2}>
          {line.map(slot => (
            <Box flexDirection="column" width={width}>
              <Raster
                key={`desk-${slot}`}
                columns={width}
                rows={8 * scale}
                cells={encodeCells(drawn(office, slot, now, ticks, scale))}
              />
              <Button key={`view-${slot}`} hotkey={hotkeyOf(slot)} plain onPress={noPress}>
                {labelOf(slot)}
              </Button>
              <Box key={`status-${slot}`}>
                <Text>{deskStatus(office, slot, now, width)}</Text>
              </Box>
              {info.has(slot) ? (
                <Box key={`meter-${slot}`}>
                  <Text>{meterText(office, slot, now, width)}</Text>
                </Box>
              ) : null}
              {info.has(slot) ? (
                <Box key={`task-${slot}`} flexDirection="column">
                  {taskText(office, slot, now, width, tasks).map(one => (
                    <Text>{one}</Text>
                  ))}
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      ))}
      {roster === undefined ? null : (
        <Box key="roster">
          <Text>{roster}</Text>
        </Box>
      )}
    </Box>
  )
}
