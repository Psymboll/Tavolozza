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
 * The last drawing's layout, for the ui.focus hook that turns the page when
 * the arrows leave the board. Module state: a reload starts it over, which
 * only means the first arrow after a reload doesn't turn the page.
 */
export const paneLayout = {
  surface: 'terminal',
  page: 0,
  pages: 1,
  per: SLOTS_PER_PAGE,
  prefix: 'slot-',
  order: [] as string[],
}

/**
 * Draws the pane from the model. `els` is the surface's element table
 * ($.ui.resolve(e)), `columns` the pane body's width; every button calls an
 * action through `io`. `docked`: the pane stands beside a fullscreen
 * transcript at full height, so the key row gets a blank row above it.
 */
export function renderPane(els: ElementTable, m: PaneModel, io: act.Io, columns: number, bodyRows: number, surface: string, docked = false) {
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
  // `s: Save · a: Save as preset · …`; paging has a bar of its own under the board.
  const keyRowWidth = KEYS.reduce((w, [, , l]) => w + 3 + (l || 'Palette').length, 0) + (KEYS.length - 1) * SEP.length
  const chrome = textRows(keyRowWidth, columns) + (m.warning ? textRows(m.warning.length, columns) : 0) + (docked ? 1 : 0)

  // ---- palette only when it fits whole, in width and in height; else the list
  // (one more row for the page bar when there is a second page)
  const paletteNeeds = paletteRows(chrome) + (rows.length > SLOTS_PER_PAGE ? 1 : 0)
  const fitsWidth = Svg !== undefined || columns >= PALETTE_WIDTH
  const fitsHeight = Svg !== undefined || paletteNeeds <= bodyRows
  const view = m.view === 'palette' && fitsWidth && fitsHeight ? 'palette' : 'list'
  const tooSmall = m.view === 'palette' && view === 'list'

  // List rows per page: as many as fit (each row may wrap when narrow), 1–9 for
  // the hotkeys, keeping one row for the page bar when they don't all fit.
  const listRowRows = textRows(4 + 22 + 1 + 18, columns)
  const listRoom = bodyRows - chrome - 1 /* total line */
  const listNeedsBar = rows.length > Math.min(act.LIST_PAGE, Math.floor(listRoom / listRowRows))
  const listFit = Math.floor((listRoom - (listNeedsBar ? 1 : 0)) / listRowRows)
  const per = view === 'palette' ? SLOTS_PER_PAGE : Math.max(1, Math.min(act.LIST_PAGE, listFit))
  const pages = pageCount(rows.length, per)
  const page = ((m.page % pages) + pages) % pages
  const slotPrefix = view === 'palette' ? 'slot-' : 'row-'

  const pageText = `page ${page + 1}/${pages}`

  /** `‹ page 1/2 ›`: the pager under the board (b / n). */
  const pageBar = () => (
    <Box flexDirection="row" columnGap={1}>
      <Button key="prev" hotkey="b" plain onPress={() => act.setPage(io, -1)}>‹</Button>
      <Text dimColor>{pageText}</Text>
      <Button key="next" hotkey="n" plain onPress={() => act.setPage(io, 1)}>›</Button>
    </Box>
  )

  // ---- board
  let board
  if (rows.length === 0) {
    board = <Text dimColor>No other plugins installed. Install some with /plugin, then reopen /tavo.</Text>
  } else if (view === 'palette' && Svg) {
    // Graphical palette: the board as an SVG picture, then one toggle Button
    // per blob (an Svg is a leaf and takes no presses). Same keys 1–6.
    const slots = pageSlots(rows, page)
    const isOn = (r: PluginRow) => m.selection[r.id] ?? r.enabled
    const pageLabel = pages > 1 ? pageText : ''
    const svg = renderPaletteSvg(
      slots.map((r, i) => (r ? { name: r.name, on: isOn(r), paint: paint(i) } : null)),
      total,
      pageLabel,
    )
    const alt =
      'Plugin palette: ' +
      slots.flatMap((r, i) => (r ? [`${i + 1} ${r.name} ${isOn(r) ? 'on' : 'off'}`] : [])).join(', ') +
      `. ${total}${pageLabel ? `, ${pageLabel}` : ''}`
    // With a second page, Prev / Next stand either side of the board.
    const picture = <Svg source={svg} alt={alt} width={480} height={320} />
    board = (
      <Box flexDirection="column" gap={1}>
        {pages > 1 ? (
          <Box flexDirection="row" alignItems="center" columnGap={2}>
            <Button key="prev" hotkey="b" onPress={() => act.setPage(io, -1)}>‹ Prev</Button>
            {picture}
            <Button key="next" hotkey="n" onPress={() => act.setPage(io, 1)}>Next ›</Button>
          </Box>
        ) : (
          picture
        )}
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
        {pages > 1 && pageBar()}
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
        {pages > 1 && pageBar()}
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
    // The way back: the Cancel button (↓ or Tab from the field, or a click), or
    // Enter on an empty field. No hotkey: a letter would be typed into the name.
    keyRow = (
      <Box flexDirection="column">
        <Input
          key="preset-name"
          label="Preset name"
          placeholder="e.g. backend · empty to go back"
          autoFocus
          onSubmit={(value: string) => act.savePreset(io, value)}
        />
        <Button key="cancel-name" plain dimColor onPress={() => act.cancelPreset(io)}>Cancel</Button>
      </Box>
    )
  } else if (m.mode === 'load-preset') {
    keyRow = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text dimColor>load:</Text>
        {presetNames(m.presets).map((name, i) => (
          <Button
            key={`preset-${name}`}
            plain
            {...(i === 0 ? { autoFocus: true as const } : {})}
            onPress={() => act.choosePreset(io, name)}
          >
            {name}
          </Button>
        ))}
        <Button key="cancel-preset" hotkey="c" plain dimColor onPress={() => act.cancelPreset(io)}>Cancel</Button>
      </Box>
    )
  } else {
    const items = []
    for (const [hotkey, key, label] of KEYS) {
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

  // What the arrow-key paging (register.tsx, ui.focus) needs: the focus ring's
  // order as drawn here, and the page it shows. The ring walks Buttons in
  // document order: the board's toggles, its page bar, then the key row.
  const pageRows = rows.slice(page * per, (page + 1) * per)
  const slotKeys = pageRows.map(r => slotPrefix + r.id)
  const keyRowKeys =
    m.mode === 'edit'
      ? KEYS.map(([, key]) => key)
      : []
  Object.assign(paneLayout, {
    surface,
    page,
    pages,
    per,
    prefix: slotPrefix,
    order:
      m.mode === 'confirm' || rows.length === 0
        ? []
        : Svg && view === 'palette'
          ? [...(pages > 1 ? ['prev', 'next'] : []), ...slotKeys, ...keyRowKeys]
          : [...slotKeys, ...(pages > 1 ? ['prev', 'next'] : []), ...keyRowKeys],
  })

  // While confirming, the dry-run replaces the board so Write is never scrolled out of view.
  if (m.mode === 'confirm') {
    return (
      <Box flexDirection="column">
        <Text>Dry run: .claude/settings.local.json will hold</Text>
        <Code source={m.preview} language="json" />
        {m.warning !== null && <Text color="warning">{m.warning}</Text>}
        {docked && <Text> </Text>}
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
      {docked && <Text> </Text>}
      {keyRow}
    </Box>
  )
}
