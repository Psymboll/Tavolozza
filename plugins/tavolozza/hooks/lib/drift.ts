// Pure: per-folder memory (kept in $.store, never in the repo) and the
// startup decision.

export type StartupMode = 'always' | 'first-visit' | 'on-change' | 'never'

/** What Tavolozza remembers about one project folder. */
export type FolderRecord = {
  /** Hash of the installed plugin list when the profile was last saved/seen. */
  hash?: string
  savedAt?: number
  /** "not for this folder". */
  snoozeForever?: boolean
  /** "not for 7 days": epoch ms. */
  snoozeUntil?: number
  /** Installed plugin ids at `hash` time, to say what changed. */
  ids?: string[]
}

export const DAY_MS = 24 * 60 * 60 * 1000

/** $.store key for a folder. */
export function folderKey(cwd: string): string {
  return 'folder:' + cwd
}

/**
 * FNV-1a over the sorted `id@version` list: stable, cheap, no crypto needed.
 * A plugin update changes its version and so counts as drift. Token costs are
 * not hashed: they load lazily and would make the hash flap.
 */
export function installedHash(items: { id: string; version: string }[]): string {
  const text = items
    .map(i => `${i.id}@${i.version}`)
    .sort()
    .join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export type StartupOutcome =
  /** Open the full pane (no profile yet, or mode 'always'). */
  | 'pane'
  /** One-line summary above the prompt. */
  | 'band'
  /** Installed plugins changed since the profile was saved. */
  | 'drift'
  /** Show nothing. */
  | 'quiet'

export function decideStartup(input: {
  mode: StartupMode
  /** Local settings already hold `enabledPlugins`, or Tavolozza saved here before. */
  hasProfile: boolean
  record: FolderRecord | undefined
  hash: string
  now: number
}): StartupOutcome {
  const { mode, hasProfile, record, hash, now } = input
  if (mode === 'never') return 'quiet'
  if (record?.snoozeForever) return 'quiet'
  if (record?.snoozeUntil !== undefined && record.snoozeUntil > now) return 'quiet'
  if (mode === 'always') return 'pane'
  if (!hasProfile) return 'pane'
  if (mode === 'on-change' && record?.hash !== undefined && record.hash !== hash) return 'drift'
  return 'band'
}

/** Plugins added/removed between two id lists, for the drift message. */
export function driftSummary(before: string[], after: string[]): string {
  const b = new Set(before)
  const a = new Set(after)
  const added = after.filter(x => !b.has(x)).length
  const removed = before.filter(x => !a.has(x)).length
  const parts: string[] = []
  if (added) parts.push(`${added} new plugin${added > 1 ? 's' : ''}`)
  if (removed) parts.push(`${removed} removed`)
  return parts.length ? parts.join(', ') : 'plugins updated'
}
