// Pure: what Tavolozza writes to .claude/settings.local.json.
// Only plugins whose chosen state differs from what user + project settings
// already give end up in the local file; every other key is kept as it was.

import type { PluginRow } from '../../types'

/** The one file Tavolozza ever writes, relative to the project folder (the write itself: register.tsx, `writeLocal`). */
export const LOCAL_SETTINGS = '.claude/settings.local.json'

/**
 * The new local `enabledPlugins` map.
 * - a plugin whose choice equals its inherited state is left out (no redundant key);
 * - a locked plugin (policy / flag) is never written;
 * - ids in the current local map that the pane does not list (uninstalled
 *   plugins, Tavolozza itself) are kept untouched.
 */
export function localEnabledPlugins(
  rows: PluginRow[],
  selection: Record<string, boolean>,
  currentLocal: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const listed = new Set(rows.map(r => r.id))
  const out: Record<string, boolean> = {}
  for (const [id, v] of Object.entries(currentLocal ?? {})) {
    if (!listed.has(id)) out[id] = v
  }
  for (const r of rows) {
    if (r.locked) {
      if (currentLocal && r.id in currentLocal) out[r.id] = currentLocal[r.id] as boolean
      continue
    }
    const want = selection[r.id] ?? r.enabled
    if (want !== r.base) out[r.id] = want
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export class LocalSettingsError extends Error {}

/** Parse the local file's text; null (missing file) or blank → {}. */
export function parseLocal(text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === '') return {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new LocalSettingsError(`${LOCAL_SETTINGS} is not valid JSON; fix it by hand, Tavolozza will not overwrite it.`)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new LocalSettingsError(`${LOCAL_SETTINGS} does not hold a JSON object; Tavolozza will not overwrite it.`)
  }
  return data as Record<string, unknown>
}

/**
 * The whole new file text: the old object with only `enabledPlugins` replaced.
 * Kept even when empty: `"enabledPlugins": {}` is how a folder says "a profile
 * was chosen here, and it matches user/project settings". A file without the
 * key means no profile, and Tavolozza opens at startup.
 */
export function renderLocal(text: string | null, enabled: Record<string, boolean>): string {
  const obj = { ...parseLocal(text), enabledPlugins: enabled }
  return JSON.stringify(obj, null, 2) + '\n'
}

/** The dry-run line(s): just the part Tavolozza changes. */
export function previewText(enabled: Record<string, boolean>): string {
  if (Object.keys(enabled).length === 0) {
    return '"enabledPlugins": {}  (every plugin matches user/project settings)'
  }
  return '"enabledPlugins": ' + JSON.stringify(enabled, null, 2)
}
