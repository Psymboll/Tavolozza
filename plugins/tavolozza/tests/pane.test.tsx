// Integration test: /tavo → pane → toggle → Save → dry-run → Write, with
// every engine call the mod makes answered by the hooks below (they stand for
// Claude Code). Run: claude plugin test plugins/tavolozza

import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'tavolozza',
  component: 'Pane',
  requestId: 'tavolozza',
  props: {
    title: 'Tavolozza',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const LIST = JSON.stringify([
  { id: 'caveman@dir', version: '1.1.2', scope: 'user', enabled: true },
  { id: 'playwright@dir', version: '7d7d', scope: 'user', enabled: true, mcpServers: { playwright: {} } },
])

type Fake = { files: Record<string, string>; writes: { path: string; text: string }[]; commands: string[]; opens: { focus?: true }[] }

/** Answers every `$` call the mod makes; returns what it observed. */
function engine(on: Parameters<TestBody>[1], user: Record<string, unknown>, store: Record<string, unknown> = {}): Fake {
  const fake: Fake = { files: {}, writes: [], commands: [], opens: [] }
  mock.store(on, store)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'tavo' } }))
  on('ui.open', (_, e) => {
    fake.opens.push(e)
    return { value: { isPlaced: true } }
  })
  // The engine's own drawing, for sites the mod passes on (an empty band).
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.focus', () => ({}) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    if (argv === 'claude plugin list --json') return { value: { exitCode: 0, stdout: LIST, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv.startsWith('claude plugin details caveman')) {
      return { value: { exitCode: 0, stdout: 'Always-on:   ~139 tok\nMCP servers (0)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: 'Always-on:   ~0 tok\nMCP servers (1)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('settings.read', (_, e) => ({ value: (e.source === 'user' ? user : {}) as never }))
  on('fs.exists', (_, e) => ({ value: e.path in fake.files }))
  on('fs.read', (_, e) => ({ value: fake.files[e.path] ?? '' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    fake.writes.push({ path: e.path, text: e.text })
    fake.files[e.path] = e.text
    return { value: undefined }
  })
  on('command.run', (_, e) => {
    fake.commands.push(e.command)
    return { text: '' }
  })
  return fake
}

/** /tavo as typed at the prompt (the engine stamps origin and presentation). */
const TAVO = { command: 'tavo', args: '' } as never

const USER = { enabledPlugins: { 'caveman@dir': true, 'playwright@dir': true } }

test('toggle a plugin, dry-run, write only the diff, reload', async ($, on) => {
  const fake = engine(on, USER)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  const opened = await $.command.run(TAVO)
  expect(opened.text).toBe('Tavolozza opened.')
  // /tavo opens a dialog-style pane (arrows walk the buttons) asking for room for the palette.
  expect(fake.opens[0]).toMatchObject({ focus: true, closeOnEscape: true, rows: 20 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /caveman: user/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Palette view: slot buttons are keyed slot-<id>.
  await ui.press({ key: 'slot-caveman@dir' })
  expect(await ui.find({ type: 'Text', text: /caveman: user\*/ })).toBeDefined()

  await ui.press({ key: 'save' })
  expect(await ui.find({ type: 'Text', text: /Dry run/ })).toBeDefined()
  expect(fake.writes.length).toBe(0)

  await ui.press({ key: 'write' })
  expect(fake.writes.length).toBe(1)
  expect(fake.writes[0]?.path).toBe('/proj/.claude/settings.local.json')
  expect(JSON.parse(fake.writes[0]?.text ?? '{}')).toEqual({ enabledPlugins: { 'caveman@dir': false } })
  expect(fake.commands).toContain('reload-plugins')
  // Rows are re-read after the save: caveman's state now comes from local.
  expect(await ui.find({ type: 'Text', text: /caveman: local/ })).toBeDefined()
  await ui.unmount()
})

test('existing local keys survive, cancel writes nothing', async ($, on) => {
  const fake = engine(on, USER)
  fake.files['/proj/.claude/settings.local.json'] = JSON.stringify({ permissions: { allow: ['Bash(ls)'] } })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.command.run(TAVO)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'slot-playwright@dir' })
  await ui.press({ key: 'save' })
  await ui.press({ key: 'cancel' })
  expect(fake.writes.length).toBe(0)

  await ui.press({ key: 'save' })
  await ui.press({ key: 'write' })
  expect(JSON.parse(fake.writes[0]?.text ?? '{}')).toEqual({
    permissions: { allow: ['Bash(ls)'] },
    enabledPlugins: { 'playwright@dir': false },
  })
  await ui.unmount()
})

test('list view, presets and the #27247 warning', async ($, on) => {
  engine(on, { model: 'opus' }) // user settings without enabledPlugins
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.command.run(TAVO)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /#27247/ })).toBeDefined()

  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /always-on tokens/ })).toBeDefined()

  await ui.press({ key: 'preset-lean' })
  expect(await ui.find({ type: 'Text', text: /Preset lean applied/ })).toBeDefined()

  // Save the current selection as a named preset; it joins the preset row.
  await ui.press({ key: 'add-preset' })
  await ui.input({ key: 'preset-name', text: 'No Browser' })
  expect(await ui.find({ type: 'Text', text: /Preset no-browser saved/ })).toBeDefined()
  expect(await ui.find({ key: 'preset-no-browser' })).toBeDefined()
  await ui.unmount()
})

test('narrow pane falls back to the list', async ($, on) => {
  engine(on, USER)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.command.run(TAVO)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 40 } })
  expect(await ui.find({ type: 'Text', text: /too narrow for the palette/ })).toBeDefined()
  expect(await ui.find({ key: 'row-caveman@dir' })).toBeDefined()
  await ui.unmount()
})

test('short pane falls back to the list, and pages the list to fit', async ($, on) => {
  engine(on, USER)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.command.run(TAVO)
  const short = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 10 } } })
  expect(await short.find({ type: 'Text', text: /too short for the palette/ })).toBeDefined()
  expect(await short.find({ key: 'row-caveman@dir' })).toBeDefined()
  await short.unmount()
  // Tall enough: the palette.
  const tall = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await tall.find({ key: 'slot-caveman@dir' })).toBeDefined()
  await tall.unmount()
})

const BAND = {
  plugin: 'tavolozza',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('startup with a saved profile shows the band, first prompt clears it', async ($, on) => {
  const fake = engine(on, USER)
  fake.files['/proj/.claude/settings.local.json'] = JSON.stringify({ enabledPlugins: { 'caveman@dir': false } })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.advance(50)
  expect((await ui.find({ type: 'Text', text: /\/tavo/ }))?.text).toMatch(/1\/2 plugins/)
  await $.prompt.submit({ text: 'hello' } as never)
  await ui.advance(10)
  expect(await ui.find({ type: 'Text', text: /\/tavo/ })).toBe(undefined)
  await ui.unmount()
})

test('startup in a folder without a profile opens the pane unfocused', async ($, on) => {
  const fake = engine(on, USER)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.advance(50)
  expect(fake.opens.length).toBe(1)
  expect(fake.opens[0]?.focus).toBe(undefined)
  await ui.unmount()
})

test('a plugin installed since the profile was saved shows the drift notice', async ($, on) => {
  const fake = engine(on, USER, { 'folder:/proj': { hash: 'old', ids: ['caveman@dir'] } })
  fake.files['/proj/.claude/settings.local.json'] = JSON.stringify({ enabledPlugins: { 'caveman@dir': false } })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.advance(50)
  expect((await ui.find({ type: 'Text', text: /\/tavo/ }))?.text).toMatch(/1 new plugin since/)
  await ui.unmount()
})

test('a snoozed folder stays quiet at startup', async ($, on) => {
  const fake = engine(on, USER, { 'folder:/proj': { snoozeForever: true } })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.advance(50)
  expect(fake.opens.length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /\/tavo/ })).toBe(undefined)
  await ui.unmount()
})
