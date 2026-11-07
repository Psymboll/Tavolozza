// Pure: the terminal palette layout. The template is the handoff's: each
// 12-character run of A–F is one plugin slot, the 15 T's are the total.
// The UI turns slot segments into Buttons and text segments into Text, so
// this file only cuts lines into segments and formats slot labels.

import type { PluginRow } from '../../types'

export const TEMPLATE: readonly string[] = [
  "              _.--~~~~~~~~~~~~--._",
  "         .-~''                    ''~-.",
  "      .-'   AAAAAAAAAAAA  BBBBBBBBBBBB  '-.",
  "    .'    CCCCCCCCCCCC  DDDDDDDDDDDD       '.",
  "   /    EEEEEEEEEEEE  FFFFFFFFFFFF   .--.    \\",
  "  |                                 (    )    |",
  "   \\     TTTTTTTTTTTTTTT             '--'    /",
  "    '.                                    .-'",
  "      '-._         .-~~~-.          _.--'",
  "          '-.____.'       '.____.--'",
]

/** Widest template line: below this many columns the pane uses the list. */
export const PALETTE_WIDTH = Math.max(...TEMPLATE.map(l => l.length))
export const SLOTS_PER_PAGE = 6
export const SLOT_WIDTH = 12
export const TOTAL_WIDTH = 15
/** Above this many plugins the pane opens in list mode by default. */
export const MANY_PLUGINS = 24

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'slot'; index: number }
  | { kind: 'total' }

/** Cut one template line into text / slot / total segments. */
export function segmentLine(line: string): Segment[] {
  const out: Segment[] = []
  const re = /([A-F])\1{11}|T{15}/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) })
    if (m[0][0] === 'T') out.push({ kind: 'total' })
    else out.push({ kind: 'slot', index: m[0].charCodeAt(0) - 65 })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

export const SEGMENTS: readonly Segment[][] = TEMPLATE.map(segmentLine)

/** Fit text to exactly `w` columns: cut with "…" or pad with spaces. */
export function fit(text: string, w: number): string {
  const chars = Array.from(text)
  if (chars.length > w) return chars.slice(0, w - 1).join('') + '…'
  return text + ' '.repeat(w - chars.length)
}

/** `● name` when on, `○ name` when off, exactly 12 columns. */
export function slotLabel(name: string, on: boolean): string {
  return fit(`${on ? '●' : '○'} ${name}`, SLOT_WIDTH)
}

/** The plugins on one page; `null` fills empty slots. */
export function pageSlots(rows: PluginRow[], page: number): (PluginRow | null)[] {
  const out: (PluginRow | null)[] = rows.slice(page * SLOTS_PER_PAGE, (page + 1) * SLOTS_PER_PAGE)
  while (out.length < SLOTS_PER_PAGE) out.push(null)
  return out
}

export function pageCount(n: number, perPage: number): number {
  return Math.max(1, Math.ceil(n / perPage))
}

/** Plain-text rendering of the whole palette (tests, debug, and a fallback). */
export function renderPaletteText(rows: PluginRow[], selection: Record<string, boolean>, page: number, total: string): string[] {
  const slots = pageSlots(rows, page)
  return SEGMENTS.map(segs =>
    segs
      .map(s => {
        if (s.kind === 'text') return s.text
        if (s.kind === 'total') return fit(total, TOTAL_WIDTH)
        const r = slots[s.index]
        return r ? slotLabel(r.name, selection[r.id] ?? r.enabled) : ' '.repeat(SLOT_WIDTH)
      })
      .join(''),
  )
}

/**
 * The preferred view, from the person's option, their last choice and the
 * plugin count. Whether the palette fits the pane right now (width and
 * height) is decided at every draw, so this preference survives a resize.
 */
export function chooseView(opts: {
  paletteOption: boolean
  columns: number
  count: number
  remembered: 'palette' | 'list' | undefined
}): 'palette' | 'list' {
  if (!opts.paletteOption) return 'list'
  if (opts.remembered) return opts.remembered
  if (opts.count > MANY_PLUGINS) return 'list'
  return 'palette'
}

/**
 * Rows a wrapping row of items takes (Box flexWrap="wrap", columnGap=gap),
 * given each item's width in columns.
 */
export function flowRows(widths: number[], columns: number, gap = 1): number {
  if (widths.length === 0) return 0
  let rows = 1
  let used = 0
  for (const w of widths) {
    const need = used === 0 ? w : used + gap + w
    if (need > columns && used > 0) {
      rows++
      used = w
    } else used = need
  }
  return rows
}

/** Rows a text of `len` columns takes when wrapped at `columns`. */
export function textRows(len: number, columns: number): number {
  return len <= 0 ? 0 : Math.ceil(len / Math.max(1, columns))
}

/** Rows the pane wants for the palette: the template plus everything around it. */
export function paletteRows(chromeRows: number): number {
  return TEMPLATE.length + chromeRows
}
