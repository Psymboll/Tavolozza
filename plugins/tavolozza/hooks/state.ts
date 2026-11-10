// Shared constants: the pane id, the empty model and the userConfig options.
// (The $.state atoms themselves live in register.tsx: the engine requires an
// atom to be declared in the same file that reads or writes it.)

import type { PaneModel } from '../types'

export const PANE_ID = 'tavolozza'

export const EMPTY_MODEL: PaneModel = {
  status: 'loading',
  rows: [],
  selection: {},
  page: 0,
  view: 'palette',
  mode: 'edit',
  preview: '',
  message: '',
  presets: {},
  warning: null,
  columns: 80,
}

/** userConfig values, set by register(). */
export const options = {
  startup: 'on-change' as 'always' | 'first-visit' | 'on-change' | 'never',
  palette: true,
}
