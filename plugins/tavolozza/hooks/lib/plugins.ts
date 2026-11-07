// Pure parsers for the output of `claude plugin list --json` and
// `claude plugin details <id>`. The hooks module runs the commands.

export type InstalledPlugin = {
  id: string
  name: string
  marketplace: string
  version: string
  /** What the CLI reports as enabled (used only when no settings layer names the plugin). */
  enabled: boolean
  hasMcp: boolean
}

export type Cost = { tokens: number | null; hasMcp: boolean }

/** `claude plugin list --json` → installed plugins. Throws on output that is not a JSON list. */
export function parsePluginList(stdout: string): InstalledPlugin[] {
  const data: unknown = JSON.parse(stdout)
  if (!Array.isArray(data)) throw new Error('plugin list is not a JSON array')
  const out: InstalledPlugin[] = []
  const seen = new Set<string>()
  for (const item of data) {
    if (item === null || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || seen.has(o.id)) continue
    seen.add(o.id)
    const at = o.id.lastIndexOf('@')
    out.push({
      id: o.id,
      name: at > 0 ? o.id.slice(0, at) : o.id,
      marketplace: at > 0 ? o.id.slice(at + 1) : '',
      version: typeof o.version === 'string' ? o.version : '',
      enabled: o.enabled === true,
      hasMcp: o.mcpServers !== undefined && o.mcpServers !== null && Object.keys(o.mcpServers as object).length > 0,
    })
  }
  return out
}

/**
 * `claude plugin details <id>` → always-on token estimate.
 * Reads the line `Always-on:   ~139 tok   added to every session`.
 */
export function parseDetails(stdout: string): Cost {
  const m = /Always-on:\s*~?\s*([\d.,]+)\s*(k?)\s*tok/i.exec(stdout)
  let tokens: number | null = null
  if (m && m[1] !== undefined) {
    const n = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(n)) tokens = Math.round(m[2] ? n * 1000 : n)
  }
  const mcp = /MCP servers \((\d+)\)/.exec(stdout)
  return { tokens, hasMcp: mcp !== null && Number(mcp[1]) > 0 }
}
