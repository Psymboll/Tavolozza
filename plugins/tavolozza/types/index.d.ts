// Tavolozza's state contract: every value the mod keeps in $.state, and the
// plain data types the hooks and the pure helpers in hooks/lib share.

/** Which settings layer decided a plugin's state ('default': none did). */
export type Scope = 'user' | 'project' | 'local' | 'flag' | 'policy' | 'default'

/** One installed plugin as the pane shows it. */
export type PluginRow = {
  /** `name@marketplace`, the key used in `enabledPlugins`. */
  id: string
  name: string
  marketplace: string
  version: string
  /** Effective state when the pane was loaded (all layers merged). */
  enabled: boolean
  /** The layer that decided `enabled`. */
  source: Scope
  /** State inherited from user + project settings, ignoring local: the diff base. */
  base: boolean
  /** Set by managed policy or a CLI flag: local settings cannot change it. */
  locked: boolean
  /** Always-on token estimate from `claude plugin details`; null while unknown. */
  tokens: number | null
  /** Ships MCP servers, whose tool schemas are not counted in `tokens`. */
  hasMcp: boolean
}

export type View = 'palette' | 'list'

/**
 * edit: toggling. confirm: dry-run shown, waiting for Write. name-preset:
 * typing a preset name. load-preset: picking a preset to apply.
 */
export type Mode = 'edit' | 'confirm' | 'name-preset' | 'load-preset'

/** Everything the pane draws from. */
export type PaneModel = {
  status: 'loading' | 'ready' | 'error'
  rows: PluginRow[]
  /** Pending choice, by plugin id. */
  selection: Record<string, boolean>
  page: number
  view: View
  mode: Mode
  /** Dry-run: the JSON that Write will put in settings.local.json. */
  preview: string
  /** One info line under the board (last action's outcome). */
  message: string
  /** Preset suggested from the folder's files (pom.xml → java). */
  suggested: string | null
  /** The person's own presets: name → plugin names that are on. */
  presets: Record<string, string[]>
  /** A setup problem worth showing (bug #27247, unreadable local file). */
  warning: string | null
  /** Terminal width the pane was last opened at, for the palette/list choice. */
  columns: number
}

/** The one-line band above the prompt; null hides it. */
export type Band = { text: string } | null

declare module 'claude-code' {
  interface PluginState {
    tavolozza: {
      model: Shaped<PaneModel>
      band: Band
      /** Startup already ran in this session (survives /reload-plugins). */
      started: boolean
    }
  }
}
