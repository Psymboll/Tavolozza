// Everything that talks to Claude Code, through the Io ports below: the installed
// list, the settings layers, the per-folder memory in the store, and the actions
// the pane's buttons call. Pure logic lives in ./lib.

import type { Band, PaneModel, PluginRow, View } from '../types'
import { LOCAL_SETTINGS, LocalSettingsError, isAllowedTarget, localEnabledPlugins, parseLocal, previewText, renderLocal } from './lib/diff'
import { DAY_MS, type FolderRecord, decideStartup, driftSummary, folderKey, installedHash } from './lib/drift'
import { chooseView, TEMPLATE } from './lib/palette'
import { applyPreset, detectPreset, matchingPreset, presetFromSelection } from './lib/presets'
import { type Cost, type InstalledPlugin, parseDetails, parsePluginList } from './lib/plugins'
import { type Layers, buildRows, bug27247Warning, enabledPluginsOf, fmtTokens, totalTokens } from './lib/settings'
import { options } from './state'

/**
 * The ports to Claude Code. The engine only accepts `$` spelled directly at a
 * call site inside a hook, so register.tsx builds this object of closures
 * over `$` in each dispatch and the actions here take it instead of `$`.
 * Tests can build a fake one.
 */
export type Io = {
  pluginName: string
  run: (argv: string[], timeoutMs?: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  settings: (source: 'user' | 'project' | 'flag' | 'policy') => Promise<unknown>
  exists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, text: string) => Promise<void>
  listDir: () => Promise<string[]>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  now: () => Promise<number>
  cwd: () => Promise<string>
  getModel: () => Promise<PaneModel>
  setModel: (fn: (m: PaneModel) => PaneModel) => Promise<unknown>
  setBand: (band: Band) => Promise<unknown>
  /** Open the pane; `rows` is the body height it asks for inline, `columns` the width when docked. */
  openPane: (focus: boolean, rows: number, columns: number) => Promise<boolean>
  closePane: () => Promise<void>
  /** Move the pane's focus ring onto one of its elements, by key. */
  focus: (key: string) => Promise<unknown>
  toast: (text: string) => void
  runCommand: (command: string) => Promise<unknown>
}

/** Most rows per page in list view (hotkeys 1–9); fewer when the pane is short. */
export const LIST_PAGE = 9

/**
 * Body rows the pane asks for when it opens: the palette plus its one key
 * row. A request: the engine gives what the layout can spare, and the pane
 * falls back to the list when that is not enough.
 */
export const PANE_ROWS = TEMPLATE.length + 2 // the key row, and the page bar when there's a second page

/**
 * Body columns the pane asks for when docked beside a fullscreen transcript:
 * the key row on one line (`s: Save · … · l: Palette · q: Close`), which is
 * wider than the palette. A request, as the rows are.
 */
export const PANE_COLUMNS = 68

// ---------------------------------------------------------------- reading

export async function loadInstalled(io: Io): Promise<InstalledPlugin[]> {
  const res = await io.run(['claude', 'plugin', 'list', '--json'], 30_000)
  if (res.exitCode !== 0) throw new Error(`claude plugin list failed: ${res.stderr.trim() || res.exitCode}`)
  return parsePluginList(res.stdout)
}

/** Absolute path of the project's .claude/settings.local.json (never resolved against the process cwd). */
export async function localPath(io: Io): Promise<string> {
  return `${(await io.cwd()).replace(/\/+$/, '')}/${LOCAL_SETTINGS}`
}

/** Raw text of .claude/settings.local.json, null when missing. */
export async function readLocalText(io: Io): Promise<string | null> {
  const path = await localPath(io)
  if (!(await io.exists(path))) return null
  return io.readFile(path)
}

export type Loaded = {
  installed: InstalledPlugin[]
  layers: Layers
  warning: string | null
  hasLocalProfile: boolean
}

/**
 * The installed list plus each settings layer's `enabledPlugins`.
 * Local is read from the file itself (fresh after a save); the other layers
 * through $.settings, which also covers --settings flags and managed policy.
 */
export async function loadState(io: Io): Promise<Loaded> {
  const [installed, user, project, flag, policy, localText] = await Promise.all([
    loadInstalled(io),
    io.settings('user'),
    io.settings('project'),
    io.settings('flag'),
    io.settings('policy'),
    readLocalText(io),
  ])
  let local: Record<string, boolean> | undefined
  let warning = bug27247Warning(user)
  try {
    local = enabledPluginsOf(parseLocal(localText))
  } catch (err) {
    warning = err instanceof LocalSettingsError ? err.message : String(err)
  }
  return {
    installed,
    layers: {
      user: enabledPluginsOf(user),
      project: enabledPluginsOf(project),
      local,
      flag: enabledPluginsOf(flag),
      policy: enabledPluginsOf(policy),
    },
    warning,
    hasLocalProfile: local !== undefined,
  }
}

const costKey = (p: { id: string; version: string }) => `cost:${p.id}@${p.version}`

/** Token costs already cached in $.store (keyed by id@version, so an update re-measures). */
export async function cachedCosts(io: Io, installed: InstalledPlugin[]): Promise<Record<string, Cost>> {
  const out: Record<string, Cost> = {}
  for (const p of installed) {
    const c = (await io.storeGet(costKey(p))) as Cost | undefined
    if (c) out[p.id] = c
  }
  return out
}

/** Run `claude plugin details` for the plugins without a cached cost, then fill them in. */
export async function fetchMissingCosts(io: Io, installed: InstalledPlugin[], have: Record<string, Cost>): Promise<void> {
  const missing = installed.filter(p => !have[p.id] && p.name !== io.pluginName)
  await Promise.all(
    missing.map(async p => {
      let cost: Cost = { tokens: null, hasMcp: p.hasMcp }
      try {
        const res = await io.run(['claude', 'plugin', 'details', p.id], 60_000)
        if (res.exitCode === 0) {
          cost = parseDetails(res.stdout)
          await io.storeSet(costKey(p), cost)
        }
      } catch {
        // leave unknown; shown as "?"
      }
      await io.setModel(m => ({
        ...m,
        rows: m.rows.map(r => (r.id === p.id ? { ...r, tokens: cost.tokens ?? 0, hasMcp: r.hasMcp || cost.hasMcp } : r)),
      }))
    }),
  )
}

async function userPresets(io: Io): Promise<Record<string, string[]>> {
  return ((await io.storeGet('presets')) as Record<string, string[]> | undefined) ?? {}
}

async function folderRecord(io: Io, cwd: string): Promise<FolderRecord | undefined> {
  return (await io.storeGet(folderKey(cwd))) as FolderRecord | undefined
}

async function setFolderRecord(io: Io, cwd: string, patch: Partial<FolderRecord>): Promise<void> {
  const cur = (await folderRecord(io, cwd)) ?? {}
  await io.storeSet(folderKey(cwd), { ...cur, ...patch })
}

async function suggestion(io: Io): Promise<string | null> {
  try {
    return detectPreset(await io.listDir())
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- loading the pane

/**
 * Re-read everything from disk into the pane model; the pending selection
 * starts over from the effective state, unless `keepSelection` (the pane
 * closed on a blur with unsaved toggles). Token costs fill in afterwards.
 */
export async function refresh(io: Io, columns?: number, keepSelection = false): Promise<void> {
  await io.setModel(m => ({ ...m, status: 'loading', message: '' }))
  let loaded: Loaded
  try {
    loaded = await loadState(io)
  } catch (err) {
    await io.setModel(m => ({ ...m, status: 'error', message: String(err instanceof Error ? err.message : err) }))
    return
  }
  const costs = await cachedCosts(io, loaded.installed)
  const rows = buildRows(loaded.installed, loaded.layers, io.pluginName, costs)
  const presets = await userPresets(io)
  const remembered = (await io.storeGet('view')) as View | undefined
  const suggested = loaded.hasLocalProfile ? null : await suggestion(io)
  await io.setModel(m => {
    const cols = columns ?? m.columns
    return {
      ...m,
      status: 'ready',
      rows,
      selection: Object.fromEntries(rows.map(r => [r.id, keepSelection && !r.locked ? (m.selection[r.id] ?? r.enabled) : r.enabled])),
      page: 0,
      mode: 'edit',
      preview: '',
      suggested,
      presets,
      warning: loaded.warning,
      columns: cols,
      view: chooseView({ paletteOption: options.palette, columns: cols, count: rows.length, remembered }),
    }
  })
  void fetchMissingCosts(io, loaded.installed, costs)
}

/** The pane holds toggles that are not saved yet. */
export function isDirty(m: PaneModel): boolean {
  return m.rows.some(r => (m.selection[r.id] ?? r.enabled) !== r.enabled)
}

/** Open (or raise) the pane. `asked`: the person ran /tavo, so it may take focus. */
export async function openPane(io: Io, asked: boolean, columns?: number, keepSelection = false): Promise<boolean> {
  const loading = refresh(io, columns, keepSelection)
  const placed = await io.openPane(asked, PANE_ROWS, PANE_COLUMNS)
  await loading
  return placed
}

// ---------------------------------------------------------------- pane actions

export async function toggle(io: Io, id: string): Promise<void> {
  await io.setModel(m => {
    const row = m.rows.find(r => r.id === id)
    if (!row) return m
    if (row.locked) return { ...m, message: `${row.name} is set by ${row.source} settings and cannot be changed here.` }
    const cur = m.selection[id] ?? row.enabled
    return { ...m, mode: 'edit', message: '', selection: { ...m.selection, [id]: !cur } }
  })
}

export async function choosePreset(io: Io, name: string): Promise<void> {
  await io.setModel(m => {
    const sel = applyPreset(name, m.rows, m.presets)
    if (!sel) return { ...m, message: `Unknown preset ${name}.` }
    return { ...m, mode: 'edit', selection: sel, message: `Preset ${name} applied (not saved yet).` }
  })
}

export async function setPage(io: Io, delta: number): Promise<void> {
  await io.setModel(m => {
    // The pane wraps the page into range: it alone knows how many rows fit.
    return { ...m, page: m.page + delta }
  })
}

export async function toggleView(io: Io): Promise<void> {
  const m = await io.getModel()
  const view: View = m.view === 'palette' ? 'list' : 'palette'
  await io.storeSet('view', view)
  await io.setModel(cur => ({ ...cur, view, page: 0 }))
}

/** Step 1 of saving: compute the dry-run and wait for Write. */
export async function prepareSave(io: Io): Promise<void> {
  const m = await io.getModel()
  try {
    const current = enabledPluginsOf(parseLocal(await readLocalText(io)))
    const next = localEnabledPlugins(m.rows, m.selection, current)
    await io.setModel(cur => ({ ...cur, mode: 'confirm', preview: previewText(next), message: '' }))
  } catch (err) {
    await io.setModel(cur => ({ ...cur, message: err instanceof Error ? err.message : String(err) }))
  }
}

/** Step 2 of saving: write the local file, remember the folder, reload plugins. */
export async function writeSave(io: Io): Promise<void> {
  const m = await io.getModel()
  const cwd = await io.cwd()
  try {
    const text = await readLocalText(io)
    const current = enabledPluginsOf(parseLocal(text))
    const next = localEnabledPlugins(m.rows, m.selection, current)
    const path = await localPath(io)
    if (!isAllowedTarget(path)) throw new Error('refusing to write outside .claude/settings.local.json')
    await io.writeFile(path, renderLocal(text, next))
    await setFolderRecord(io, cwd, {
      hash: installedHash(m.rows),
      ids: m.rows.map(r => r.id),
      savedAt: await io.now(),
    })
  } catch (err) {
    await io.setModel(cur => ({ ...cur, mode: 'edit', message: err instanceof Error ? err.message : String(err) }))
    return
  }
  // Re-read so every row shows its new source ("local").
  await refresh(io)
  await io.setModel(cur => ({ ...cur, message: 'Saved to .claude/settings.local.json. Reloading plugins…' }))
  await io.storeSet('lastSave', { cwd, at: await io.now() })
  await io.setBand(null)
  await reloadPlugins(io)
}

/** Ask Claude Code to run /reload-plugins; tell the person to do it if that is refused. */
export async function reloadPlugins(io: Io): Promise<void> {
  try {
    // Queued until the session is idle; this may reload Tavolozza itself.
    void io.runCommand('reload-plugins').then(
      () => io.setModel(cur => ({ ...cur, message: 'Saved and reloaded. Run /context to see the effect.' })),
      () => io.setModel(cur => ({ ...cur, message: 'Saved. Run /reload-plugins to apply.' })),
    )
  } catch {
    await io.setModel(cur => ({ ...cur, message: 'Saved. Run /reload-plugins to apply.' }))
  }
}

export async function cancelSave(io: Io): Promise<void> {
  await io.setModel(cur => ({ ...cur, mode: 'edit', preview: '', message: 'Not saved.' }))
}

export async function startNamingPreset(io: Io): Promise<void> {
  await io.setModel(cur => ({ ...cur, mode: 'name-preset', message: '' }))
  // autoFocus only applies when the pane first takes the keys: move the ring explicitly.
  await io.focus('preset-name').catch(() => undefined)
}

export async function savePreset(io: Io, rawName: string): Promise<void> {
  const name = rawName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  if (!name || name === 'lean' || name === 'full') {
    await io.setModel(cur => ({ ...cur, mode: 'edit', message: 'Preset not saved: pick another name.' }))
    return
  }
  const m = await io.getModel()
  const presets = { ...m.presets, [name]: presetFromSelection(m.rows, m.selection) }
  await io.storeSet('presets', presets)
  await io.setModel(cur => ({ ...cur, presets, mode: 'edit', message: `Preset ${name} saved.` }))
}

export async function deletePreset(io: Io, name: string): Promise<void> {
  const m = await io.getModel()
  const presets = { ...m.presets }
  delete presets[name]
  await io.storeSet('presets', presets)
  await io.setModel(cur => ({ ...cur, presets, message: `Preset ${name} deleted.` }))
}

/** Show the preset picker in place of the action area. */
export async function startLoadingPreset(io: Io): Promise<void> {
  await io.setModel(cur => ({ ...cur, mode: 'load-preset', message: '' }))
}

/** Leave the preset picker or the name field without changing anything. */
export async function cancelPreset(io: Io): Promise<void> {
  await io.setModel(cur => ({ ...cur, mode: 'edit' }))
}

/**
 * Keep Tavolozza quiet at startup here: for good ('folder') or for 7 days
 * ('week'). Reached through `/tavo snooze [week]`; returns the line to show.
 */
export async function snooze(io: Io, kind: 'folder' | 'week'): Promise<string> {
  const cwd = await io.cwd()
  const now = await io.now()
  await setFolderRecord(io, cwd, kind === 'folder' ? { snoozeForever: true } : { snoozeUntil: now + 7 * DAY_MS })
  await io.closePane()
  return kind === 'folder' ? 'Tavolozza stays quiet in this folder. /tavo still works.' : 'Tavolozza stays quiet here for 7 days.'
}

/** Undo a snooze for this folder (`/tavo unsnooze`). */
export async function unsnooze(io: Io): Promise<string> {
  await setFolderRecord(io, await io.cwd(), { snoozeForever: false, snoozeUntil: 0 })
  return 'Tavolozza speaks up at startup in this folder again.'
}

// ---------------------------------------------------------------- startup

/** One-line summary: `java · 5 plugins · ~6k tok · /tavo`. */
export function summary(rows: PluginRow[], selection: Record<string, boolean>, presets: Record<string, string[]>): string {
  const on = rows.filter(r => selection[r.id]).length
  const preset = matchingPreset(rows, selection, presets) ?? 'custom'
  return `${preset} · ${on}/${rows.length} plugins · ~${fmtTokens(totalTokens(rows, selection))} tok · /tavo`
}

const NO_PROFILE = 'Tavolozza: no plugin profile for this folder yet · '

/** Runs once per session at start: reminder, summary band, drift notice, pane ('always') or nothing. */
export async function startup(io: Io, cwd: string): Promise<void> {
  if (options.startup === 'never') return
  const loaded = await loadState(io)
  const costs = await cachedCosts(io, loaded.installed)
  const rows = buildRows(loaded.installed, loaded.layers, io.pluginName, costs)
  const record = await folderRecord(io, cwd)
  const hash = installedHash(rows)
  const outcome = decideStartup({
    mode: options.startup,
    // The local file is the profile: without `enabledPlugins` there (a missing,
    // empty or `{}` file) the folder has none, whatever was saved here before.
    hasProfile: loaded.hasLocalProfile,
    record,
    hash,
    now: await io.now(),
  })
  const selection = Object.fromEntries(rows.map(r => [r.id, r.enabled]))
  if (outcome === 'quiet') return
  // No profile: a reminder, not the pane. Its button (or /tavo) is the person
  // asking, so the pane then opens with the keys, at any width.
  if (outcome === 'remind') {
    await io.setBand({ text: NO_PROFILE, open: true })
    return
  }
  if (outcome === 'pane') {
    const placed = await openPane(io, false)
    // Too narrow for an unasked pane: the band offers it instead.
    if (!placed) {
      const text = loaded.hasLocalProfile ? summary(rows, selection, await userPresets(io)).replace(/\/tavo$/, '') : NO_PROFILE
      await io.setBand({ text, open: true })
    }
    return
  }
  if (outcome === 'drift') {
    const what = driftSummary(record?.ids ?? [], rows.map(r => r.id))
    await io.setBand(({ text: `Tavolozza: ${what} since this folder's profile was saved · /tavo` }))
    return
  }
  // band: profile exists and nothing changed. Adopt a hand-made profile's hash.
  if (record?.hash === undefined) await setFolderRecord(io, cwd, { hash, ids: rows.map(r => r.id) })
  const text = summary(rows, selection, await userPresets(io))
  await io.setBand(({ text }))
}

export type { PaneModel }
