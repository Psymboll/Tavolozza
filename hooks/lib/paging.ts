// Pure: turning the page with the arrows. The engine's ui.focus event says
// where the focus ring is going, not which key moved it, but the ring moves
// one step at a time in document order. So a move from the page's last
// toggle to the element right after it is "down", and a move from the first
// toggle to the element right before it (or to one of the engine's own stops,
// which carry no key) is "up". Either one turns the page instead.

export type Turn = 'next' | 'prev' | null

export function crossPage(opts: {
  /** Every key the ring can stop on, in document order. */
  order: readonly string[]
  /** The keys of this page's plugin toggles, in order. */
  slots: readonly string[]
  /** Where the ring is now. */
  from: string | undefined
  /** Where it's about to go; undefined for an engine stop. */
  to: string | undefined
  page: number
  pages: number
}): Turn {
  const { order, slots, from, to, page, pages } = opts
  if (from === undefined || slots.length === 0 || order.length < 2) return null
  const i = order.indexOf(from)
  if (i < 0) return null
  if (to !== undefined && slots.includes(to)) return null
  const n = order.length
  const after = order[(i + 1) % n]
  const before = order[(i - 1 + n) % n]
  if (from === slots[slots.length - 1] && page < pages - 1 && to === after) return 'next'
  if (from === slots[0] && page > 0 && (to === before || to === undefined)) return 'prev'
  return null
}
