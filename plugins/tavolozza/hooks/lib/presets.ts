// Pure: presets and folder detection.
// A preset is a list of plugin *names* (no marketplace) that are on; every
// other listed plugin is off. `lean` and `full` are computed, not stored.

import type { PluginRow } from '../../types'

export type StackPreset = {
  /** Files whose presence in the project root suggests this preset. */
  detect: string[]
  /** Plugin names switched on. Plugins not installed are ignored. */
  plugins: string[]
}

/**
 * Stack presets shipped with the mod. Edit freely: names only need to match
 * installed plugins; missing ones are ignored. (A hooks module can only load
 * .ts/.js files, so this lives here rather than in a JSON file.)
 */
export const STACK_PRESETS: Record<string, StackPreset> = {
  java: { detect: ['pom.xml', 'build.gradle', 'build.gradle.kts'], plugins: ['jdtls-lsp'] },
  web: { detect: ['package.json'], plugins: ['playwright', 'typescript-lsp', 'frontend-design'] },
  python: { detect: ['pyproject.toml', 'requirements.txt', 'setup.py'], plugins: ['pyright-lsp'] },
}

export const BUILTIN = ['lean', 'full'] as const

/** All preset names, built-ins first, then stack presets, then the person's own. */
export function presetNames(user: Record<string, string[]>): string[] {
  const names = [...BUILTIN, ...Object.keys(STACK_PRESETS)]
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
    const list = user[name] ?? STACK_PRESETS[name]?.plugins
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

/** First stack preset whose marker file is in the folder listing. */
export function detectPreset(fileNames: string[]): string | null {
  const have = new Set(fileNames)
  for (const [name, p] of Object.entries(STACK_PRESETS)) {
    if (p.detect.some(f => have.has(f))) return name
  }
  return null
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
