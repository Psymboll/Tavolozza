// Pure: presets.
// A preset is a list of plugin *names* (no marketplace) that are on; every
// other listed plugin is off. `lean` and `full` are computed, not stored.

import type { PluginRow } from '../../types'

export const BUILTIN = ['lean', 'full'] as const

/** All preset names, built-ins first, then the person's own. */
export function presetNames(user: Record<string, string[]>): string[] {
  const names: string[] = [...BUILTIN]
  for (const n of Object.keys(user)) if (!names.includes(n)) names.push(n)
  return names
}

/** The selection a preset gives. Locked plugins keep their current state. */
export function applyPreset(
  name: string,
  rows: PluginRow[],
  user: Record<string, string[]>,
): Record<string, boolean> | null {
  let on: (r: PluginRow) => boolean
  if (name === 'lean') on = () => false
  else if (name === 'full') on = () => true
  else {
    const list = user[name]
    if (!list) return null
    const set = new Set(list)
    on = r => set.has(r.name)
  }
  const sel: Record<string, boolean> = {}
  for (const r of rows) sel[r.id] = r.locked ? r.enabled : on(r)
  return sel
}

/** The current selection as a preset (names that are on). */
export function presetFromSelection(rows: PluginRow[], selection: Record<string, boolean>): string[] {
  return rows.filter(r => selection[r.id]).map(r => r.name).sort()
}

/** Which preset (if any) the selection equals exactly, for the band text. */
export function matchingPreset(
  rows: PluginRow[],
  selection: Record<string, boolean>,
  user: Record<string, string[]>,
): string | null {
  for (const name of presetNames(user)) {
    const sel = applyPreset(name, rows, user)
    if (sel && rows.every(r => sel[r.id] === (selection[r.id] ?? false))) return name
  }
  return null
}
