// Unit tests for the pure helpers in hooks/lib. Run: claude plugin test plugins/tavolozza

import { describe, expect, test } from 'claude-code/testing'

import type { PluginRow } from '../types'
import { isAllowedTarget, localEnabledPlugins, parseLocal, previewText, renderLocal } from '../hooks/lib/diff'
import { decideStartup, driftSummary, installedHash } from '../hooks/lib/drift'
import { chooseView, fit, flowRows, PALETTE_WIDTH, paletteRows, textRows, pageSlots, renderPaletteText, segmentLine, slotLabel, TEMPLATE } from '../hooks/lib/palette'
import { parseDetails, parsePluginList } from '../hooks/lib/plugins'
import { applyPreset, detectPreset, matchingPreset } from '../hooks/lib/presets'
import { buildRows, bug27247Warning, enabledPluginsOf, fmtTokens, resolve, totalTokens } from '../hooks/lib/settings'

const LIST_JSON = JSON.stringify([
  { id: 'caveman@dir', version: '1.1.2', scope: 'user', enabled: true },
  { id: 'playwright@dir', version: '7d7d', scope: 'user', enabled: true, mcpServers: { playwright: {} } },
  { id: 'tavolozza@mine', version: '0.1.0', scope: 'user', enabled: true },
])

const DETAILS = `caveman 1.1.2
Projected token cost
  Always-on:   ~139 tok   added to every session
  MCP servers (0)`

function row(id: string, over: Partial<PluginRow> = {}): PluginRow {
  const at = id.indexOf('@')
  return {
    id,
    name: id.slice(0, at),
    marketplace: id.slice(at + 1),
    version: '1',
    enabled: true,
    source: 'user',
    base: true,
    locked: false,
    tokens: 100,
    hasMcp: false,
    ...over,
  }
}

describe('plugins parsing', () => {
  test('plugin list json', () => {
    const list = parsePluginList(LIST_JSON)
    expect(list.length).toBe(3)
    expect(list[0]).toEqual({ id: 'caveman@dir', name: 'caveman', marketplace: 'dir', version: '1.1.2', enabled: true, hasMcp: false })
    expect(list[1]?.hasMcp).toBe(true)
  })
  test('details always-on line', () => {
    expect(parseDetails(DETAILS)).toEqual({ tokens: 139, hasMcp: false })
    expect(parseDetails('Always-on:   ~1.2k tok').tokens).toBe(1200)
    expect(parseDetails('Always-on:   ~12,345 tok').tokens).toBe(12345)
    expect(parseDetails('MCP servers (1)  playwright').hasMcp).toBe(true)
    expect(parseDetails('nothing here').tokens).toBe(null)
  })
})

describe('settings precedence', () => {
  test('local beats project beats user; policy beats all', () => {
    const layers = { user: { a: true }, project: { a: false }, local: { a: true }, policy: {} }
    expect(resolve('a', layers)).toEqual({ value: true, source: 'local' })
    expect(resolve('a', { ...layers, policy: { a: false } })).toEqual({ value: false, source: 'policy' })
    expect(resolve('a', { user: { a: true } })).toEqual({ value: true, source: 'user' })
    expect(resolve('b', layers)).toBe(null)
  })
  test('rows: effective state, source, base, self excluded, locked', () => {
    const installed = parsePluginList(LIST_JSON)
    const rows = buildRows(
      installed,
      { user: { 'caveman@dir': true, 'playwright@dir': true }, local: { 'caveman@dir': false }, policy: { 'playwright@dir': true } },
      'tavolozza',
      { 'caveman@dir': { tokens: 139, hasMcp: false } },
    )
    expect(rows.map(r => r.id)).toEqual(['caveman@dir', 'playwright@dir'])
    expect(rows[0]).toMatchObject({ enabled: false, source: 'local', base: true, locked: false, tokens: 139 })
    expect(rows[1]).toMatchObject({ enabled: true, source: 'policy', locked: true, tokens: null, hasMcp: true })
  })
  test('unnamed plugin falls back to the CLI state', () => {
    const rows = buildRows(parsePluginList(LIST_JSON), {}, 'tavolozza')
    expect(rows[0]).toMatchObject({ enabled: true, source: 'default', base: true })
  })
  test('enabledPluginsOf ignores junk', () => {
    expect(enabledPluginsOf({ enabledPlugins: { a: true, b: 'yes' } })).toEqual({ a: true })
    expect(enabledPluginsOf({})).toBe(undefined)
    expect(enabledPluginsOf(null)).toBe(undefined)
  })
  test('tokens', () => {
    expect(fmtTokens(139)).toBe('139')
    expect(fmtTokens(1234)).toBe('1.2k')
    expect(fmtTokens(2000)).toBe('2k')
    expect(fmtTokens(12345)).toBe('12k')
    expect(fmtTokens(null)).toBe('…')
    expect(totalTokens([row('a@m'), row('b@m', { tokens: 50 })], { 'a@m': true, 'b@m': false })).toBe(100)
  })
  test('#27247 warning only when user settings lack the key', () => {
    expect(bug27247Warning({ enabledPlugins: {} })).toBe(null)
    expect(bug27247Warning({})).not.toBe(null)
  })
})

describe('local diff', () => {
  const rows = [row('a@m'), row('b@m', { base: false, enabled: false }), row('c@m', { locked: true, source: 'policy' })]
  test('only differences from the inherited state are written', () => {
    expect(localEnabledPlugins(rows, { 'a@m': false, 'b@m': false, 'c@m': false }, undefined)).toEqual({ 'a@m': false })
    expect(localEnabledPlugins(rows, { 'a@m': true, 'b@m': true }, undefined)).toEqual({ 'b@m': true })
  })
  test('a redundant local key is dropped; unknown ids are kept', () => {
    const next = localEnabledPlugins(rows, { 'a@m': true, 'b@m': false }, { 'a@m': true, 'gone@m': false })
    expect(next).toEqual({ 'gone@m': false })
  })
  test('locked plugins keep whatever local had', () => {
    expect(localEnabledPlugins(rows, { 'c@m': false }, { 'c@m': true })).toEqual({ 'c@m': true })
  })
  test('other keys of the local file are preserved; empty map removes the key', () => {
    const text = JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { x: true } })
    expect(JSON.parse(renderLocal(text, { 'a@m': false }))).toEqual({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'a@m': false } })
    // an empty map is still written: it marks the folder as having a profile
    expect(JSON.parse(renderLocal(text, {}))).toEqual({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: {} })
    expect(renderLocal(null, { 'a@m': false })).toBe('{\n  "enabledPlugins": {\n    "a@m": false\n  }\n}\n')
  })
  test('malformed local file is refused, never overwritten', () => {
    expect(() => parseLocal('{ nope')).toThrow()
    expect(() => parseLocal('[1]')).toThrow()
    expect(parseLocal('  ')).toEqual({})
  })
  test('write target guard', () => {
    expect(isAllowedTarget('.claude/settings.local.json')).toBe(true)
    expect(isAllowedTarget('/p/.claude/settings.local.json')).toBe(true)
    expect(isAllowedTarget('.claude/settings.json')).toBe(false)
    expect(isAllowedTarget('/home/u/.claude/settings.json')).toBe(false)
  })
  test('preview', () => {
    expect(previewText({})).toMatch(/"enabledPlugins": \{\}/)
    expect(previewText({ 'a@m': false })).toMatch(/"a@m": false/)
  })
})

describe('presets', () => {
  const rows = [row('jdtls-lsp@m'), row('playwright@m'), row('caveman@m', { locked: true, enabled: true })]
  test('lean / full / stack / user', () => {
    expect(applyPreset('lean', rows, {})).toEqual({ 'jdtls-lsp@m': false, 'playwright@m': false, 'caveman@m': true })
    expect(applyPreset('full', rows, {})).toEqual({ 'jdtls-lsp@m': true, 'playwright@m': true, 'caveman@m': true })
    expect(applyPreset('java', rows, {})).toEqual({ 'jdtls-lsp@m': true, 'playwright@m': false, 'caveman@m': true })
    expect(applyPreset('mine', rows, { mine: ['playwright'] })?.['playwright@m']).toBe(true)
    expect(applyPreset('nope', rows, {})).toBe(null)
  })
  test('detection and matching', () => {
    expect(detectPreset(['README.md', 'pom.xml'])).toBe('java')
    expect(detectPreset(['README.md'])).toBe(null)
    const two = [row('a@m'), row('b@m')]
    expect(matchingPreset(two, { 'a@m': false, 'b@m': false }, {})).toBe('lean')
    expect(matchingPreset(two, { 'a@m': true, 'b@m': false }, {})).toBe(null)
  })
})

describe('startup decision', () => {
  const base = { hash: 'h1', now: 1000 }
  test('modes', () => {
    expect(decideStartup({ ...base, mode: 'never', hasProfile: false, record: undefined })).toBe('quiet')
    expect(decideStartup({ ...base, mode: 'always', hasProfile: true, record: { hash: 'h1' } })).toBe('pane')
    expect(decideStartup({ ...base, mode: 'on-change', hasProfile: false, record: undefined })).toBe('pane')
    expect(decideStartup({ ...base, mode: 'on-change', hasProfile: true, record: { hash: 'h1' } })).toBe('band')
    expect(decideStartup({ ...base, mode: 'on-change', hasProfile: true, record: { hash: 'h0' } })).toBe('drift')
    expect(decideStartup({ ...base, mode: 'first-visit', hasProfile: true, record: { hash: 'h0' } })).toBe('band')
    expect(decideStartup({ ...base, mode: 'on-change', hasProfile: true, record: undefined })).toBe('band')
  })
  test('snooze', () => {
    expect(decideStartup({ ...base, mode: 'always', hasProfile: false, record: { snoozeForever: true } })).toBe('quiet')
    expect(decideStartup({ ...base, mode: 'always', hasProfile: false, record: { snoozeUntil: 2000 } })).toBe('quiet')
    expect(decideStartup({ ...base, mode: 'always', hasProfile: false, record: { snoozeUntil: 500 } })).toBe('pane')
  })
  test('hash is order-independent and version-sensitive', () => {
    const a = installedHash([{ id: 'a', version: '1' }, { id: 'b', version: '1' }])
    expect(installedHash([{ id: 'b', version: '1' }, { id: 'a', version: '1' }])).toBe(a)
    expect(installedHash([{ id: 'a', version: '2' }, { id: 'b', version: '1' }])).not.toBe(a)
  })
  test('drift summary', () => {
    expect(driftSummary(['a'], ['a', 'b'])).toBe('1 new plugin')
    expect(driftSummary(['a', 'b'], ['c'])).toBe('1 new plugin, 2 removed')
    expect(driftSummary(['a'], ['a'])).toBe('plugins updated')
  })
})

describe('palette layout', () => {
  test('wrapping estimates', () => {
    expect(flowRows([5, 5, 5], 20)).toBe(1) // 5+1+5+1+5 = 17
    expect(flowRows([5, 5, 5], 10)).toBe(3)
    expect(flowRows([5, 4, 5], 10)).toBe(2)
    expect(flowRows([30], 10)).toBe(1)
    expect(flowRows([], 10)).toBe(0)
    expect(textRows(0, 10)).toBe(0)
    expect(textRows(21, 10)).toBe(3)
    expect(paletteRows(6)).toBe(16)
  })
  test('template has six slots in a column and one total', () => {
    const segs = TEMPLATE.flatMap(segmentLine)
    expect(segs.filter(s => s.kind === 'slot').map(s => (s as { index: number }).index)).toEqual([0, 1, 2, 3, 4, 5])
    // one slot per line
    expect(TEMPLATE.filter(l => /([A-F])\1{17}/.test(l)).length).toBe(6)
    expect(segs.filter(s => s.kind === 'total').length).toBe(1)
    expect(PALETTE_WIDTH).toBe(47)
  })
  test('rendered lines keep the template width', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`plugin-with-a-long-name-${i}@m`))
    const lines = renderPaletteText(rows, {}, 0, '8.9k tok · 3/6')
    lines.forEach((l, i) => expect(Array.from(l).length).toBe(TEMPLATE[i]?.length))
    expect(lines.join('\n')).toMatch(/8\.9k tok · 3\/6/)
    // page 2 holds the 7th plugin and five empty slots
    expect(pageSlots(rows, 1).filter(r => r !== null).length).toBe(1)
  })
  test('slot labels', () => {
    expect(slotLabel('caveman', true)).toBe('● caveman         ')
    expect(slotLabel('playwright', true)).toBe('● playwright      ')
    expect(slotLabel('averyverylongpluginname', false)).toBe('○ averyverylongpl…')
    expect(fit('abc', 2)).toBe('a…')
  })
  test('view choice', () => {
    expect(chooseView({ paletteOption: true, columns: 120, count: 5, remembered: undefined })).toBe('palette')
    expect(chooseView({ paletteOption: false, columns: 120, count: 5, remembered: undefined })).toBe('list')
    // width is decided at draw time, not here: the preference survives a resize
    expect(chooseView({ paletteOption: true, columns: 40, count: 5, remembered: 'palette' })).toBe('palette')
    expect(chooseView({ paletteOption: true, columns: 120, count: 30, remembered: undefined })).toBe('list')
    expect(chooseView({ paletteOption: true, columns: 120, count: 30, remembered: 'palette' })).toBe('palette')
    expect(chooseView({ paletteOption: true, columns: 120, count: 5, remembered: 'list' })).toBe('list')
  })
})
