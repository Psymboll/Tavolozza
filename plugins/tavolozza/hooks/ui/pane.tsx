// The Tavolozza pane: board (palette or list), dry-run / preset picker, footer.
// Mechanics only: every control is a Button, so Tab walks them and the
// hotkeys work while the pane holds the keyboard.

import type { ElementTable } from 'claude-code'

import type { PaneModel, PluginRow } from '../../types'
import * as act from '../actions'
import { fit, PALETTE_WIDTH, pageCount, pageSlots, paletteRows, renderPaletteSvg, SEGMENTS, SLOT_WIDTH, SLOTS_PER_PAGE, textRows, TOTAL_WIDTH } from '../lib/palette'
import { presetNames } from '../lib/presets'
import { fmtTokens, totalTokens } from '../lib/settings'

/**
 * One paint per slot, in slot order: only the ● of a plugin that is on is
 * painted; names stay in the theme's text colour, and an off plugin is dim.
 * Fixed per position (not per plugin), like the wells of a real palette.
 */
const PAINTS = [
  '#d9a62e', // cadmium yellow
  '#d9502f', // vermilion
  '#5f9a4a', // sap green
  '#8a5fbf', // cobalt violet (no blue: blue is the hotkeys' accent)
  '#c25a7c', // rose madder
  '#2e9a8a', // viridian
] as const

const paint = (slot: number): string => PAINTS[slot % PAINTS.length] ?? PAINTS[0]

/** The wood of the palette: the template's outline is drawn in it. */
const PALETTE_COLOR = '#9c6b3f'

/**
 * The key row under the board: one line that is both the actions and their
 * help. Plain Buttons draw as `s: Save`, the key in the accent colour.
 */
const KEYS = [
  ['s', 'save', 'Save'],
  ['a', 'add-preset', 'Save as preset'],
  ['p', 'load-preset', 'Load preset'],
  ['l', 'view', ''], // List or Palette, whichever is not showing
  ['q', 'close', 'Close'],
] as const

const SEP = ' · '

/**
 * Draws the pane from the model. `els` is the surface's element table
 * ($.ui.resolve(e)), `columns` the pane body's width; every button calls an
 * action through `io`.
 */
export function renderPane(els: ElementTable, m: PaneModel, io: act.Io, columns: number, bodyRows: number, surface: string) {
  const { Box, Text, Button, Code } = els
  const Input = (els as unknown as Record<string, unknown>).Input as ElementTable<'terminal'>['Input'] | undefined
  // Desktop, VS Code and mobile draw `Svg`; the terminal doesn't. There the
  // palette is a picture that scales, so the column/row fit checks don't apply.
  const graphical = surface !== 'terminal'
  const Svg = graphical ? ((els as unknown as Record<string, unknown>).Svg as ElementTable<'desktop'>['Svg'] | undefined) : undefined
  /** The state dot, painted as the terminal list paints it: by row position when on, dim when off. */
  const dot = (i: number, on: boolean) => (on ? <Text color={paint(i)}>●</Text> : <Text dimColor>○</Text>)

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

  // ---- how many rows everything except the board takes, at this width.
  // One key row (the preset picker or name field takes its place while open)
  // and a setup warning if there is one. Messages share the key row and are
  // not counted: a "Not saved." must never flip the palette to the list.
  // `s: Save · a: Save as preset · …`, plus `‹ 1/2 › · ` when there is a second page.
  const pagerWidth = rows.length > SLOTS_PER_PAGE ? 3 + 7 + 3 + SEP.length : 0
  const keyRowWidth = KEYS.reduce((w, [, , l]) => w + 3 + (l || 'Palette').length, 0) + (KEYS.length - 1) * SEP.length + pagerWidth
  const chrome = textRows(keyRowWidth, columns) + (m.warning ? textRows(m.warning.length, columns) : 0)

  // ---- palette only when it fits whole, in width and in height; else the list
  const paletteNeeds = paletteRows(chrome)
  const fitsWidth = Svg !== undefined || columns >= PALETTE_WIDTH
  const fitsHeight = Svg !== undefined || paletteNeeds <= bodyRows
  const view = m.view === 'palette' && fitsWidth && fitsHeight ? 'palette' : 'list'
  const tooSmall = m.view === 'palette' && view === 'list'

  // List rows per page: as many as fit (each row may wrap when narrow), 1–9 for the hotkeys.
  const listRowRows = textRows(4 + 22 + 1 + 18, columns)
  const listFit = Math.floor((bodyRows - chrome - 1 /* total line */) / listRowRows)
  const per = view === 'palette' ? SLOTS_PER_PAGE : Math.max(1, Math.min(act.LIST_PAGE, listFit))
  const pages = pageCount(rows.length, per)
  const page = ((m.page % pages) + pages) % pages

  // ---- board
  let board
  if (rows.length === 0) {
    board = <Text dimColor>No other plugins installed. Install some with /plugin, then reopen /tavo.</Text>
  } else if (view === 'palette' && Svg) {
    // Graphical palette: the board as an SVG picture, then one toggle Button
    // per blob (an Svg is a leaf and takes no presses). Same keys 1–6.
    const slots = pageSlots(rows, page)
    const isOn = (r: PluginRow) => m.selection[r.id] ?? r.enabled
    const pageLabel = pages > 1 ? `page ${page + 1}/${pages}` : ''
    const svg = renderPaletteSvg(
      slots.map((r, i) => (r ? { name: r.name, on: isOn(r), paint: paint(i) } : null)),
      total,
      pageLabel,
    )
    const alt =
      'Plugin palette: ' +
      slots.flatMap((r, i) => (r ? [`${i + 1} ${r.name} ${isOn(r) ? 'on' : 'off'}`] : [])).join(', ') +
      `. ${total}${pageLabel ? `, ${pageLabel}` : ''}`
    board = (
      <Box flexDirection="column" gap={1}>
        <Svg source={svg} alt={alt} width={480} height={320} />
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {slots.flatMap((r, i) =>
            r
              ? [
                  <Box key={`chip-${r.id}`} flexDirection="row" columnGap={1}>
                    {dot(i, isOn(r))}
                    <Button
                      key={`slot-${r.id}`}
                      plain
                      hotkey={String(i + 1)}
                      {...(i === 0 ? { autoFocus: true as const } : {})}
                      onPress={() => act.toggle(io, r.id)}
                    >
                      <Text dimColor={!isOn(r)}>{`${r.name} ${isOn(r) ? 'on' : 'off'}${changed(r) ? '*' : ''}`}</Text>
                    </Button>
                  </Box>,
                ]
              : [],
          )}
        </Box>
      </Box>
    )
  } else if (view === 'palette') {
    const slots = pageSlots(rows, page)
    board = (
      <Box flexDirection="column">
        {SEGMENTS.map((segs, line) => (
          <Box key={`line-${line}`} flexDirection="row">
            {segs.map(s => {
              if (s.kind === 'text') return <Text color={PALETTE_COLOR}>{s.text}</Text>
              if (s.kind === 'total') return <Text weight="bold">{fit(total, TOTAL_WIDTH)}</Text>
              const r = slots[s.index]
              if (!r) return <Text>{' '.repeat(SLOT_WIDTH)}</Text>
              const isOn = m.selection[r.id] ?? r.enabled
              // plain + hotkey draws "1: " before the label: 3 + the rest = the slot.
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
                  {isOn ? <Text color={paint(s.index)}>●</Text> : <Text dimColor>○</Text>}
                  <Text dimColor={!isOn}>{fit(` ${r.name}`, SLOT_WIDTH - 4)}</Text>
                </Button>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  } else {
    board = (
      <Box flexDirection="column">
        {rows.slice(page * per, (page + 1) * per).map((r, i) => {
          const isOn = m.selection[r.id] ?? r.enabled
          if (graphical) {
            // Desktop: the dot outside the native button, so its paint shows.
            return (
              <Box key={`line-${r.id}`} flexDirection="row" columnGap={1}>
                {dot(i, isOn)}
                <Button key={`row-${r.id}`} plain hotkey={String(i + 1)} {...(i === 0 ? { autoFocus: true as const } : {})} onPress={() => act.toggle(io, r.id)}>
                  <Text dimColor={!isOn}>{isOn ? 'on  ' : 'off '}{fit(r.name, 22)}</Text>
                  <Text dimColor>{fit(r.source + (r.locked ? ' (locked)' : '') + (changed(r) ? '*' : ''), 18)}</Text>
                </Button>
              </Box>
            )
          }
          return (
            <Button
              key={`row-${r.id}`}
              plain
              hotkey={String(i + 1)}
              {...(i === 0 ? { autoFocus: true as const } : {})}
              onPress={() => act.toggle(io, r.id)}
            >
              {isOn ? <Text color={paint(i)}>●</Text> : <Text dimColor>○</Text>}
              <Text dimColor={!isOn}>{isOn ? ' on  ' : ' off '}{fit(r.name, 22)}</Text>
              <Text dimColor>
                {fit(r.source + (r.locked ? ' (locked)' : '') + (changed(r) ? '*' : ''), 18)}
              </Text>
            </Button>
          )
        })}
        <Text>
          <Text weight="bold">~{total}</Text>
          <Text dimColor> plugins on, always-on tokens</Text>
        </Text>
      </Box>
    )
  }

  const press: Record<(typeof KEYS)[number][1], () => unknown> = {
    save: () => act.prepareSave(io),
    'add-preset': () => act.startNamingPreset(io),
    'load-preset': () => act.startLoadingPreset(io),
    view: () => act.toggleView(io),
    close: () => io.closePane(),
  }

  // ---- the key row; the preset picker and the name field replace it while open
  let keyRow
  if (m.mode === 'name-preset' && Input) {
    keyRow = (
      <Input
        key="preset-name"
        label="Preset name"
        placeholder="e.g. backend"
        autoFocus
        onSubmit={(value: string) => act.savePreset(io, value)}
      />
    )
  } else if (m.mode === 'load-preset') {
    keyRow = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text dimColor>load:</Text>
        {presetNames(m.presets).map((name, i) => (
          <Button
            key={`preset-${name}`}
            plain
            dimColor={name !== m.suggested}
            {...(i === 0 ? { autoFocus: true as const } : {})}
            onPress={() => act.choosePreset(io, name)}
          >
            {name}
            {name === m.suggested ? ' (suggested)' : ''}
          </Button>
        ))}
        <Button key="cancel-preset" hotkey="c" plain dimColor onPress={() => act.cancelPreset(io)}>Cancel</Button>
      </Box>
    )
  } else {
    const items = []
    for (const [hotkey, key, label] of KEYS) {
      if (key === 'close' && pages > 1) {
        // The pager sits before Close, only when there is a second page.
        items.push(<Button key="prev" hotkey="b" plain onPress={() => act.setPage(io, -1)}>‹</Button>)
        items.push(<Text dimColor> {page + 1}/{pages} </Text>)
        items.push(<Button key="next" hotkey="n" plain onPress={() => act.setPage(io, 1)}>›</Button>)
        items.push(<Text dimColor>{SEP}</Text>)
      }
      items.push(
        <Button
          key={key}
          hotkey={hotkey}
          plain
          {...(key === 'close' ? { role: 'dismiss' as const } : {})}
          onPress={press[key]}
        >
          {label || (view === 'palette' ? 'List' : 'Palette')}
        </Button>,
      )
      if (key !== 'close') items.push(<Text dimColor>{SEP}</Text>)
    }
    const note = m.message || (tooSmall ? `${fitsWidth ? 'too short' : 'too narrow'} for the palette` : '')
    keyRow = (
      <Box flexDirection="row" flexWrap="wrap">
        {items}
        {note !== '' && <Text color={m.message ? 'suggestion' : undefined} dimColor={!m.message}>{SEP}{note}</Text>}
      </Box>
    )
  }

  // While confirming, the dry-run replaces the board so Write is never scrolled out of view.
  if (m.mode === 'confirm') {
    return (
      <Box flexDirection="column">
        <Text>Dry run: .claude/settings.local.json will hold</Text>
        <Code source={m.preview} language="json" />
        {m.warning !== null && <Text color="warning">{m.warning}</Text>}
        <Box flexDirection="row">
          <Button key="write" hotkey="w" plain onPress={() => act.writeSave(io)}>Write</Button>
          <Text dimColor>{SEP}</Text>
          <Button key="cancel" hotkey="c" plain onPress={() => act.cancelSave(io)}>Cancel</Button>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {board}
      {m.warning !== null && <Text color="warning">{m.warning}</Text>}
      {keyRow}
    </Box>
  )
}
