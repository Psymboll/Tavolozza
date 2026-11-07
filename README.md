# Tavolozza

A Claude Code mod to pick which plugins are on, per project. Choose the right colours for your project.

Every installed plugin adds always-on tokens to every session, even where it is useless. Tavolozza (Italian for a painter's palette) adds a `/tavo` command that opens a pane listing every installed plugin with its effective state and the settings layer that decided it (user / project / local / policy), with the always-on token total of your selection. Toggle plugins, load a preset (`lean`, `full`, `java`, your own), check the dry run, and save: Tavolozza writes only the differences to `.claude/settings.local.json` and runs `/reload-plugins` for you. It never touches `.claude/settings.json` or your user settings.

At session start it behaves like asdf with `.tool-versions`: it opens in a folder without a profile (no `enabledPlugins` in `.claude/settings.local.json`), then shows a one-line summary above the prompt, and speaks up again only when installed plugins change. Claude Code opens a pane on its own only in a terminal at least 144 columns wide (110 once you have used `/tavo`); in a narrower one Tavolozza shows a one-line reminder above the prompt instead, and pressing `1` in the empty prompt (or clicking *Choose plugins*) opens the pane.

Requires Claude Code 2.1.287 or later, in the terminal or the desktop Code tab.

## Install

At the prompt of a terminal session:

```
/plugin install tavolozza --marketplace Psymboll/Tavolozza
```

From a shell: `claude plugin install tavolozza --marketplace Psymboll/Tavolozza`.

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Psymboll/Tavolozza`, then **Add plugin**.

## Use

The palette shows six plugins per page, one per line, with the always-on token total under them; it updates as you toggle. A `●` painted in its slot's colour is on, a dim `○` is off. The row under the board lists the actions with their keys:

| Key | Action |
| --- | --- |
| `1`–`6` (palette) / `1`–`9` (list) | toggle a plugin |
| `s` then `w` / `c` | save: show the dry run, then write or cancel |
| `a` | save the current selection as a preset |
| `p` | load a preset (`lean`, `full`, a suggested stack preset, your own) |
| `l` | switch between palette and list |
| `b` / `n` | previous / next page (shown only when there is a second page) |
| `q` / `Esc` | close |

**↑ / ↓** move between plugins and on to the actions, **Enter** toggles the focused one. The palette needs 47 columns and 11 rows; when the pane is smaller it switches to the list by itself and back again when there's room. Run `/tavo` again to re-read settings from disk.

**Quiet at startup:** `/tavo snooze` keeps Tavolozza quiet when a session starts in this folder, `/tavo snooze week` does so for 7 days, and `/tavo unsnooze` undoes either. `/tavo` itself always works.

**Accessibility:** the palette is ASCII art, which a screen reader reads character by character. Turn it off in `/config` → Tavolozza → *Palette view*, or press `l`; the list view states each plugin as `on` / `off` in words.

**Options** (`/config`): *When to show at session start* (`always`, `first-visit`, `on-change` (default), `never`) and *Palette view*.

**Known Claude Code bug** ([#27247](https://github.com/anthropics/claude-code/issues/27247)): a local `enabledPlugins` is ignored unless the key exists in `~/.claude/settings.json`. Tavolozza warns you if it is missing; add `"enabledPlugins": {}` there.

## Develop

```
claude plugin validate plugins/tavolozza
claude plugin test plugins/tavolozza
```
