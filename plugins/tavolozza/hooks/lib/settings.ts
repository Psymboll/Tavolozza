// Pure: from the settings layers and the installed list to one row per plugin.
// No `$` here, so the tests can call it directly.

import type { PluginRow, Scope } from '../../types'
import type { InstalledPlugin } from './plugins'

/** `enabledPlugins` of each layer, as the settings files hold it. */
export type Layers = Partial<Record<Exclude<Scope, 'default'>, Record<string, boolean> | undefined>>

/** Highest precedence first, as Claude Code merges them. */
const ORDER: Exclude<Scope, 'default'>[] = ['policy', 'flag', 'local', 'project', 'user']

/** Pull `enabledPlugins` out of a settings object, ignoring anything malformed. */
export function enabledPluginsOf(settings: unknown): Record<string, boolean> | undefined {
  if (settings === null || typeof settings !== 'object') return undefined
  const raw = (settings as Record<string, unknown>).enabledPlugins
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

/** The first layer (by precedence) that sets `id`, and its value. */
export function resolve(
  id: string,
  layers: Layers,
  order: Exclude<Scope, 'default'>[] = ORDER,
): { value: boolean; source: Scope } | null {
  for (const scope of order) {
    const v = layers[scope]?.[id]
    if (typeof v === 'boolean') return { value: v, source: scope }
  }
  return null
}

/**
 * One row per installed plugin, Tavolozza itself left out.
 * `fallback` is the state the CLI reported, used when no layer names the plugin.
 */
export function buildRows(
  installed: InstalledPlugin[],
  layers: Layers,
  selfName: string,
  costs: Record<string, { tokens: number | null; hasMcp: boolean }> = {},
): PluginRow[] {
  const rows: PluginRow[] = []
  for (const p of installed) {
    if (p.name === selfName) continue
    const eff = resolve(p.id, layers)
    const inherited = resolve(p.id, layers, ['project', 'user'])
    const enabled = eff ? eff.value : p.enabled
    const cost = costs[p.id]
    rows.push({
      id: p.id,
      name: p.name,
      marketplace: p.marketplace,
      version: p.version,
      enabled,
      source: eff ? eff.source : 'default',
      base: inherited ? inherited.value : p.enabled,
      locked: eff?.source === 'policy' || eff?.source === 'flag',
      tokens: cost ? cost.tokens : null,
      hasMcp: cost ? cost.hasMcp || p.hasMcp : p.hasMcp,
    })
  }
  rows.sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.name.localeCompare(b.name))
  return rows
}

/** Sum of always-on tokens for the plugins switched on in `selection`. */
export function totalTokens(rows: PluginRow[], selection: Record<string, boolean>): number {
  let sum = 0
  for (const r of rows) if (selection[r.id] && r.tokens) sum += r.tokens
  return sum
}

/** 139 → "139", 1234 → "1.2k", 12345 → "12k". */
export function fmtTokens(n: number | null): string {
  if (n === null) return '…'
  if (n < 1000) return String(n)
  const k = n / 1000
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : String(Math.round(k))) + 'k'
}

/**
 * Workaround check for anthropics/claude-code#27247: a local `enabledPlugins`
 * is ignored unless the key exists in the user settings file.
 */
export function bug27247Warning(userSettings: unknown): string | null {
  if (userSettings !== null && typeof userSettings === 'object' && 'enabledPlugins' in userSettings) {
    return null
  }
  return 'Add "enabledPlugins": {} to ~/.claude/settings.json, or the local choice may be ignored (#27247).'
}
