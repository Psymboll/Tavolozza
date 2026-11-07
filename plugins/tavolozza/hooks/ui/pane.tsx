// The Tavolozza pane: preset row, board (palette or list), dry-run, footer.
// Mechanics only: every control is a Button, so Tab walks them and the
// hotkeys work while the pane holds the keyboard.

import type { ElementTable } from 'claude-code'

import type { PaneModel, PluginRow } from '../../types'
import * as act from '../actions'
import { fit, flowRows, PALETTE_WIDTH, pageCount, pageSlots, paletteRows, SEGMENTS, SLOTS_PER_PAGE, textRows, TOTAL_WIDTH } from '../lib/palette'
import { presetNames, STACK_PRESETS } from '../lib/presets'
import { fmtTokens, totalTokens } from '../lib/settings'

/** One colour per marketplace (the plugin's "group"), in order of appearance. */
const GROUP_COLORS = ['magenta', 'cyan', 'yellow', 'green', 'blue', 'red']

function groupColor(rows: PluginRow[], row: PluginRow): string {
  const groups = [...new Set(rows.map(r => r.marketplace))]
  return GROUP_COLORS[groups.indexOf(row.marketplace) % GROUP_COLORS.length] ?? 'cyan'
}

function tokenText(r: PluginRow): string {
  return `~${fmtTokens(r.tokens)} tok${r.hasMcp ? ' +MCP' : ''}`
}

/**
 * Draws the pane from the model. `els` is the surface's element table
 * ($.ui.resolve(e)), `columns` the pane body's width; every button calls an
 * action through `io`.
 */
export function renderPane(els: ElementTable, m: PaneModel, io: act.Io, columns: number, bodyRows: number) {
  const { Box, Text, Button, Code } = els
  const Input = (els as unknown as Record<string, unknown>).Input as ElementTable<'terminal'>['Input'] | undefined

  if (m.status === 'loading' && m.rows.length === 0) return <Text dimColor>Reading installed plugins…</Text>
  if (m.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="error">Could not read plugins: {m.message}</Text>
        <Button key="retry" hotkey="r" onPress={() => act.refresh(io)}>Retry</Button>
      </Box>
    )
  }

  const rows = m.rows
  const on = rows.filter(r => m.selection[r.id]).length
  const total = `${fmtTokens(totalTokens(rows, m.selection))} tok · ${on}/${rows.length}`
  const changed = (r: PluginRow) => (m.selection[r.id] ?? r.enabled) !== r.enabled
  const sourceText = (r: PluginRow) => `${r.name}: ${r.source}${r.locked ? ' (locked)' : ''}${changed(r) ? '*' : ''}, ${tokenText(r)}`

  // ---- how many rows everything except the board takes, at this width
  const presetLabels = ['presets:', ...presetNames(m.presets).map(n => n + (n === m.suggested ? ' (suggested)' : '') + (n in m.presets && !(n in STACK_PRESETS) ? ' ·' : ''))]
  const footerLabels = ['Save', 'List', 'Prev', 'Next', 'Save as preset', 'Re-read', 'Not for this folder', 'Not for 7 days', 'Close'].map(l => l.length + 4)
  const chrome =
    flowRows(presetLabels.map(l => l.length), columns) +
    flowRows(footerLabels, columns) +
    1 /* key hint */ +
    1 /* page marker */ +
    (m.message ? textRows(m.message.length, columns) : 0) +
    (m.warning ? textRows(m.warning.length, columns) : 0)

  // ---- palette only when it fits whole, in width and in height; else the list
  const firstPage = pageSlots(rows, 0).filter((r): r is PluginRow => r !== null)
  const paletteNeeds = paletteRows(chrome + textRows(firstPage.map(sourceText).join(' · ').length, columns))
  const fitsWidth = columns >= PALETTE_WIDTH
  const fitsHeight = paletteNeeds <= bodyRows
  const view = m.view === 'palette' && fitsWidth && fitsHeight ? 'palette' : 'list'
  const tooSmall = m.view === 'palette' && view === 'list'

  // List rows per page: as many as fit (each row may wrap when narrow), 1–9 for the hotkeys.
  const listRowRows = textRows(4 + 22 + 1 + 18 + 1 + 16, columns)
  const listFit = Math.floor((bodyRows - chrome - 1 /* total line */) / listRowRows)
  const per = view === 'palette' ? SLOTS_PER_PAGE : Math.max(1, Math.min(act.LIST_PAGE, listFit))
  const pages = pageCount(rows.length, per)
  const page = ((m.page % pages) + pages) % pages

  // Digit hotkeys of the plugins drawn on this page.
  const onPage = Math.max(0, Math.min(per, rows.length - page * per))
  const hotkeys = onPage <= 1 ? '1' : `1-${onPage}`

  // ---- preset row
  const presetRow = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text dimColor>presets:</Text>
      {presetNames(m.presets).map(name => (
        <Button key={`preset-${name}`} plain dimColor={name !== m.suggested} onPress={() => act.choosePreset(io, name)}>
          {name}
          {name === m.suggested ? ' (suggested)' : ''}
          {name in m.presets && !(name in STACK_PRESETS) ? ' ·' : ''}
        </Button>
      ))}
    </Box>
  )

  // ---- board
  let board
  if (rows.length === 0) {
    board = <Text dimColor>No other plugins installed. Install some with /plugin, then reopen /tavo.</Text>
  } else if (view === 'palette') {
    const slots = pageSlots(rows, page)
    board = (
      <Box flexDirection="column">
        {SEGMENTS.map((segs, line) => (
          <Box key={`line-${line}`} flexDirection="row">
            {segs.map(s => {
              if (s.kind === 'text') return <Text>{s.text}</Text>
              if (s.kind === 'total') return <Text weight="bold">{fit(total, TOTAL_WIDTH)}</Text>
              const r = slots[s.index]
              if (!r) return <Text>{' '.repeat(12)}</Text>
              const isOn = m.selection[r.id] ?? r.enabled
              // plain + hotkey draws "1: " before the label: 3 + 9 = the 12-column slot.
              // The first slot holds the focus ring when the pane takes the keys, so the
              // arrows start on the board.
              return (
                <Button
                  key={`slot-${r.id}`}
                  plain
                  hotkey={String(s.index + 1)}
                  {...(s.index === 0 ? { autoFocus: true as const } : {})}
                  onPress={() => act.toggle(io, r.id)}
                >
                  <Text color={groupColor(rows, r)} dimColor={!isOn}>
                    {fit(`${isOn ? '●' : '○'} ${r.name}`, 9)}
                  </Text>
                </Button>
              )
            })}
          </Box>
        ))}
        <Text dimColor>
          {slots
            .filter((r): r is PluginRow => r !== null)
            .map(sourceText)
            .join(' · ')}
        </Text>
      </Box>
    )
  } else {
    board = (
      <Box flexDirection="column">
        {rows.slice(page * per, (page + 1) * per).map((r, i) => {
          const isOn = m.selection[r.id] ?? r.enabled
          return (
            <Button
              key={`row-${r.id}`}
              plain
              hotkey={String(i + 1)}
              {...(i === 0 ? { autoFocus: true as const } : {})}
              onPress={() => act.toggle(io, r.id)}
            >
              {isOn ? '● on ' : '○ off'} {fit(r.name, 22)}
              <Text dimColor>
                {fit(r.source + (r.locked ? ' (locked)' : '') + (changed(r) ? '*' : ''), 18)} {tokenText(r)}
              </Text>
            </Button>
          )
        })}
        <Text>
          <Text weight="bold">~{total}</Text>
          <Text dimColor> always-on tokens · plugins on</Text>
        </Text>
      </Box>
    )
  }

  // ---- save / preset naming area
  let action = null
  if (m.mode === 'confirm') {
    action = (
      <Box flexDirection="column">
        <Text>Dry run: .claude/settings.local.json will hold</Text>
        <Code source={m.preview} language="json" />
        <Box flexDirection="row" columnGap={1}>
          <Button key="write" hotkey="w" variant="primary" onPress={() => act.writeSave(io)}>Write</Button>
          <Button key="cancel" hotkey="c" onPress={() => act.cancelSave(io)}>Cancel</Button>
        </Box>
      </Box>
    )
  } else if (m.mode === 'name-preset' && Input) {
    action = (
      <Input
        key="preset-name"
        label="Preset name"
        placeholder="e.g. backend"
        autoFocus
        onSubmit={(value: string) => act.savePreset(io, value)}
      />
    )
  }

  const footer = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="save" hotkey="s" variant="primary" onPress={() => act.prepareSave(io)}>Save</Button>
      <Button key="view" hotkey="l" onPress={() => act.toggleView(io)}>{view === 'palette' ? 'List' : 'Palette'}</Button>
      {pages > 1 && <Button key="prev" hotkey="p" onPress={() => act.setPage(io, -1)}>Prev</Button>}
      {pages > 1 && <Button key="next" hotkey="n" onPress={() => act.setPage(io, 1)}>Next</Button>}
      <Button key="add-preset" hotkey="a" onPress={() => act.startNamingPreset(io)}>Save as preset</Button>
      <Button key="reread" hotkey="r" onPress={() => act.refresh(io, columns)}>Re-read</Button>
      <Button key="quiet-folder" hotkey="f" dimColor onPress={() => act.snooze(io, 'folder')}>Not for this folder</Button>
      <Button key="quiet-week" hotkey="z" dimColor onPress={() => act.snooze(io, 'week')}>Not for 7 days</Button>
      <Button key="close" hotkey="q" role="dismiss" onPress={() => io.closePane()}>Close</Button>
    </Box>
  )

  // While confirming, the dry-run replaces the board so Write is never scrolled out of view.
  if (m.mode === 'confirm') {
    return (
      <Box flexDirection="column">
        {action}
        {m.warning !== null && <Text color="warning">{m.warning}</Text>}
        <Text dimColor>w write · c cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {presetRow}
      {board}
      {pages > 1 && <Text dimColor>page {page + 1}/{pages}</Text>}
      {action}
      {m.message !== '' && <Text color="suggestion">{m.message}</Text>}
      {m.warning !== null && <Text color="warning">{m.warning}</Text>}
      {footer}
      <Text dimColor>
        ↑↓ move · Enter toggle · {hotkeys} · s save · l {view === 'palette' ? 'list' : 'palette'} · Esc close
        {tooSmall ? ` · ${fitsWidth ? 'too short' : 'too narrow'} for the palette` : ''}
      </Text>
    </Box>
  )
}
