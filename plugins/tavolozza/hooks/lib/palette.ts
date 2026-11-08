// Pure: the terminal palette layout. The template is the handoff's: each
// 18-character run of A–F is one plugin slot, one per line (a column), the 15 T's are the total.
// The UI turns slot segments into Buttons and text segments into Text, so
// this file only cuts lines into segments and formats slot labels.

import type { PluginRow } from '../../types'

export const TEMPLATE: readonly string[] = [
  "              _.--~~~~~~~~~~~~--._",
  "         .-~'' AAAAAAAAAAAAAAAAAA ''~-.",
  "      .-'      BBBBBBBBBBBBBBBBBB       '-.",
  "    .'         CCCCCCCCCCCCCCCCCC          '.",
  "   /           DDDDDDDDDDDDDDDDDD    .--.    \\",
  "  |            EEEEEEEEEEEEEEEEEE   (    )    |",
  "   \\           FFFFFFFFFFFFFFFFFF    '--'    /",
  "    '.         TTTTTTTTTTTTTTT            .-'",
  "      '-._         .-~~~-.          _.--'",
  "          '-.____.'       '.____.--'",
]

/** Widest template line: below this many columns the pane uses the list. */
export const PALETTE_WIDTH = Math.max(...TEMPLATE.map(l => l.length))
export const SLOTS_PER_PAGE = 6
export const SLOT_WIDTH = 18
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
  const re = new RegExp(`([A-F])\\1{${SLOT_WIDTH - 1}}|T{${TOTAL_WIDTH}}`, 'g')
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

/** `● name` when on, `○ name` when off, exactly SLOT_WIDTH columns. */
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

// ---- The graphical palette (desktop, vscode, mobile: surfaces with `Svg`).
// Same page of SLOTS_PER_PAGE slots as the terminal, same paging and keys;
// only the drawing changes. The SVG is a picture (an `Svg` is a leaf and can't
// be pressed), so the pane draws toggle Buttons beside it.

export type SvgSlot = { name: string; on: boolean; paint: string } | null

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Blob centres, in slot order: two rows of three across the board. */
const BLOB_AT: readonly [number, number][] = [
  [135, 100], [225, 82], [315, 92],
  [115, 182], [205, 172], [295, 178],
]

/** A paint blob: a wobbly circle, its wobble fixed per slot so it never jumps. */
function blobPath(cx: number, cy: number, r: number, seed: number): string {
  const n = 10
  const pts: [number, number][] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    const rr = r * (1 + 0.1 * Math.sin(3 * a + seed * 1.7) + 0.05 * Math.cos(5 * a + seed))
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  const mid = (i: number): [number, number] => {
    const p = pts[i % n]!
    const q = pts[(i + 1) % n]!
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  }
  const f = (v: number) => v.toFixed(1)
  const [sx, sy] = mid(0)
  let d = `M${f(sx)} ${f(sy)}`
  for (let i = 1; i <= n; i++) {
    const [px, py] = pts[i % n]!
    const [mx, my] = mid(i)
    d += ` Q${f(px)} ${f(py)} ${f(mx)} ${f(my)}`
  }
  return d + 'Z'
}

/**
 * The palette as an SVG document: wood board wider at the top right, an
 * off-centre thumb hole holding the total, a notch in the bottom edge; one
 * blob per slot, filled when on, hollow when off.
 */
export function renderPaletteSvg(slots: SvgSlot[], total: string, pageLabel: string): string {
  const wood = '#c89a6a'
  const edge = '#9c6b3f'
  const ink = '#3b2716'
  // Outline plus the thumb hole as a second subpath, cut out by evenodd.
  const board =
    'M60 150 C40 70 150 22 262 28 C385 34 462 92 452 172 C446 242 382 292 292 288 ' +
    'C262 286 252 264 230 264 C206 264 198 292 160 292 C92 292 70 222 60 150 Z ' +
    'M404 196 a30 30 0 1 0 -60 0 a30 30 0 1 0 60 0 Z'
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" width="480" height="320" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
    `<path d="${board}" fill="${wood}" fill-rule="evenodd" stroke="${edge}" stroke-width="3"/>`,
    `<path d="M120 60 C170 40 260 38 330 50" fill="none" stroke="#e0bb8e" stroke-width="6" stroke-linecap="round" opacity="0.6"/>`,
  ]
  slots.forEach((s, i) => {
    const at = BLOB_AT[i]
    if (!at || !s) return
    const [cx, cy] = at
    const d = blobPath(cx, cy, 24, i)
    parts.push(
      s.on
        ? `<path d="${d}" fill="${s.paint}" stroke="${edge}" stroke-width="1.5"/>` +
            `<ellipse cx="${cx - 8}" cy="${cy - 9}" rx="6" ry="3.5" fill="#fff" opacity="0.35"/>`
        : `<path d="${d}" fill="none" stroke="${s.paint}" stroke-width="2.5" stroke-dasharray="5 4"/>`,
      `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${s.on ? '#fff' : s.paint}">${i + 1}</text>`,
      `<text x="${cx}" y="${cy + 42}" text-anchor="middle" font-size="12" fill="${ink}" opacity="${s.on ? 1 : 0.55}">${esc(fit(s.name, 14).trimEnd())}</text>`,
    )
  })
  // The total sits by the thumb hole, as on the terminal palette.
  parts.push(`<text x="350" y="252" text-anchor="middle" font-size="15" font-weight="700" fill="${ink}">${esc(total)}</text>`)
  if (pageLabel) parts.push(`<text x="350" y="270" text-anchor="middle" font-size="11" fill="${ink}" opacity="0.7">${esc(pageLabel)}</text>`)
  parts.push('</svg>')
  return parts.join('')
}
