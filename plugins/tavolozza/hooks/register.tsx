// Tavolozza's hooks module: wiring only. Logic is in ./actions.ts (through the
// Io ports) and ./lib (pure); drawing is in ./ui/pane.tsx.
//
// Engine rule: `$` may only be spelled `$.noun.method(...)` inside a hook
// declared at the top of a file; it can't be handed to a helper. So `main`
// below is the one hook that builds the Io object (closures over `$`), and it
// is registered for every event that needs it.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import * as act from './actions'
import { EMPTY_MODEL, options, PANE_ID } from './state'
import { renderPane } from './ui/pane'

type AnyEvent = Record<string, unknown>

// Session state (contract: types/index.d.ts). Bump the model's shape tag when
// PaneModel changes, so a value stored by older code reads as EMPTY_MODEL.
const model = atom({ plugin: 'tavolozza', key: 'model' } as const, EMPTY_MODEL, { shape: 'model-1' })
const band = atom({ plugin: 'tavolozza', key: 'band' } as const, null)
const started = atom({ plugin: 'tavolozza', key: 'started' } as const, false)

const main = async ($: EngineInterface, e: AnyEvent, next: (e: AnyEvent) => Promise<unknown>) => {
  const io: act.Io = {
    pluginName: $.plugin.name,
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs: timeoutMs ?? 30_000 }),
    settings: source => $.settings.read({ source }),
    exists: path => $.fs.exists(path),
    readFile: path => $.fs.read(path),
    writeFile: (path, text) => $.fs.write(path, text),
    listDir: async () => (await $.fs.list(await $.session.cwd())).map(entry => entry.name),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    now: () => $.clock.now(),
    cwd: () => $.session.cwd(),
    getModel: () => read($, model),
    setModel: fn => update($, model, fn),
    setBand: value => update($, band, () => value),
    // Asked for (/tavo): a dialog-style pane that takes the keys, so Tab and the
    // arrows walk its buttons and Esc closes it. `rows` asks for enough height
    // for the whole palette (the engine grants what the layout can spare).
    openPane: async (focus, rows) =>
      (
        await $.ui.open({
          id: PANE_ID,
          title: 'Tavolozza',
          rows,
          ...(focus ? { focus: true as const, closeOnEscape: true as const } : {}),
        })
      ).isPlaced,
    closePane: () => $.ui.close({ id: PANE_ID }),
    focus: key => $.ui.focus({ requestId: PANE_ID, key }),
    toast: text => $.ui.toast(text),
    runCommand: command => $.command.run({ command }),
  }

  // ui.render for our pane: draw from the model (read() subscribes the redraw).
  if (e.component === 'Pane') {
    const ev = e as unknown as Parameters<EngineInterface['ui']['resolve']>[0] & {
      props: { bodyColumns: number; scroll: { bodyRows: number } }
    }
    // `ev.surface` is where the pane is drawn: terminal gets ASCII, desktop/vscode/mobile an SVG.
    return renderPane($.ui.resolve(ev), await read($, model), io, ev.props.bodyColumns, ev.props.scroll.bodyRows, ev.surface)
  }

  // ui.render for the band above the prompt: startup summary, drift notice, or
  // the "no profile" line with a button that opens the pane.
  if (e.component === 'AbovePrompt') {
    const ev = e as unknown as Parameters<EngineInterface['ui']['resolve']>[0] & { props: { hasSurvey: boolean } }
    const current = await read($, band)
    if (current === null || ev.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(ev)
    if (!current.open) return <Text dimColor>{current.text}</Text>
    // The press is the person asking, so the pane is placed at any width.
    const open = async () => {
      await update($, band, () => null)
      await act.openPane(io, true)
    }
    return (
      <Box flexDirection="row">
        <Text dimColor>{current.text}</Text>
        <Button key="open-tavo" hotkey="1" plain onPress={open}>Choose plugins</Button>
      </Box>
    )
  }

  // command.run for /tavo: reload from disk and open with focus.
  // `/tavo snooze` (this folder, for good), `/tavo snooze week`, `/tavo unsnooze`:
  // the startup quieting, kept off the pane's buttons.
  if (e.command === 'tavo') {
    const args = String(e.args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (args[0] === 'snooze') {
      if (args.length > 2 || (args[1] !== undefined && args[1] !== 'week' && args[1] !== 'folder')) {
        return { text: 'Usage: /tavo snooze [week] · /tavo unsnooze' }
      }
      return { text: await act.snooze(io, args[1] === 'week' ? 'week' : 'folder') }
    }
    if (args[0] === 'unsnooze') return { text: await act.unsnooze(io) }
    if (args.length > 0) return { text: 'Usage: /tavo · /tavo snooze [week] · /tavo unsnooze' }
    const presentation = e.presentation as { columns: number } | undefined
    const placed = await act.openPane(io, true, presentation?.columns)
    return { text: placed ? 'Tavolozza opened.' : 'Tavolozza is waiting for room to open.' }
  }

  // session.start: register /tavo, then the startup check once per session.
  await $.command.register({
    name: 'tavo',
    description: 'Choose which plugins are on for this project (Tavolozza)',
    argumentHint: '[snooze [week] | unsnooze]',
    immediate: true,
  })
  const result = await next(e)
  // /reload-plugins runs session.start again; `started` survives it.
  if (e.isInteractive !== true || (await read($, started))) return result
  await update($, started, () => true)
  // In the background, so the first prompt never waits on `claude plugin list`.
  void act.startup(io, String(e.cwd)).catch(err => $.ui.log(`tavolozza: startup failed: ${String(err)}`, { to: 'debug' }))
  return result
}

/** First prompt of the session clears the band. */
const clearBand = async ($: EngineInterface, e: AnyEvent, next: (e: AnyEvent) => Promise<unknown>) => {
  if ((await read($, band)) !== null) await update($, band, () => null)
  return next(e)
}

export const register: Register = (on, opts) => {
  const mode = opts.startup
  if (mode === 'always' || mode === 'first-visit' || mode === 'on-change' || mode === 'never') options.startup = mode
  if (typeof opts.palette === 'boolean') options.palette = opts.palette

  // `main` serves several events, so its type is loose; the casts are erased at compile time.
  on('session.start', main as never)
  on('command.run', { command: 'tavo' }, main as never)
  on('ui.render', { component: 'Pane', requestId: 'tavolozza' }, main as never)
  on('ui.render', { component: 'AbovePrompt' }, main as never)
  on('prompt.submit', clearBand as never)
}
