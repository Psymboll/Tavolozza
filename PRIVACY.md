# Privacy

Tavolozza collects no data and sends nothing off your machine. It has no server, no account, no analytics and no network access.

**What it reads, on your machine only**

- Your Claude Code settings (user, project, local, flag and managed), to see which plugins are on and which layer decided it.
- The output of `claude plugin list --json` and `claude plugin details <id>`, to list your installed plugins and estimate their always-on tokens.

It does not read your conversation, your files or any credential.

**What it stores, on your machine only**

- The `enabledPlugins` key of `.claude/settings.local.json` in your project, when you confirm a save.
- In Claude Code's per-plugin store: token estimates, your presets, your palette or list choice, and a per-folder record (when a profile was saved, snoozes).
Nothing is shared with the author or with anyone else.

Questions: <https://github.com/Psymboll/Tavolozza/issues>.
