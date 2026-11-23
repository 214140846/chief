# chief

[中文](README.md) · English

chief gives you a personal-assistant session in the Claude App (the "chief 消息中心", message hub). When someone needs you on Slack, GitHub, Jira or Notion, the hub decides what to do by your rules, hands real work to separate Claude work sessions, tracks progress, and only surfaces what you must decide. You talk to the hub; a side panel (`/chief`) shows progress, pending replies and rules.

The plugin ships three parts: the panel (`/chief`), the hub skill (`/chief:hub`) and a background engine. The UI and the hub speak Chinese.

```
Slack (push) / GitHub, Jira, Notion (polled every 5 min)
  → chief engine (launchd, ~/chief/data/app): writes only "someone needs you" items to ~/chief/data/events.jsonl
  → the hub session follows them with Monitor and decides by your rules: dispatch / note / ask you
  → work sessions do the work and report back: progress / needs your decision / draft reply
  → drafts wait in the outbox; you confirm in the panel (or a rule allows auto-send); the engine sends as you, undoable for 5 s
```

See also: [Architecture](ARCHITECTURE.md) (Chinese) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

## Install

Requirements: macOS, the Claude App (the panel and session dispatch do not work in terminal Claude Code), Node 24+, Google Chrome (for Slack login). For GitHub / Jira, install and log in to `gh` and `acli` (or `twg`).

1. Install the plugin:

   ```bash
   claude plugin marketplace add jinjin99/chief
   claude plugin install chief@chief --scope user
   ```

2. Open any session in the Claude App and type `/chief`. Before the engine is installed, the panel shows only the Settings (设置) tab.
3. Click **装引擎** (install engine): creates `~/chief`, copies the engine to `~/chief/data/app`, installs dependencies and registers a launchd agent.
4. Click **登录 Slack**: log in normally in the separate Chrome window. For SSO workspaces, type your workspace name (`xxx` in `xxx.slack.com`) first. The session cookie goes into the macOS Keychain.
5. Optional: connect GitHub / Jira (uses your logged-in `gh`, `acli` or `twg`).
6. Start the hub. It must run in `~/chief` so it can read your notes and instructions. Either click **在工作目录开主会话** (the current session opens a new session in `~/chief` using the App's session tool), or create a new session yourself with folder `~/chief`, type `/chief` and click **开消息中心**. Use the bypass permissions mode (see Risks) and keep the hub open.

## Update

The plugin follows released tags (`v*`) only. Turn on auto-update under `/plugin` → Marketplaces → chief, or run `claude plugin update chief@chief`. The engine updates itself the next time a session loads the new plugin; click 重读规则 (reload rules) in Settings to make the hub pick up the new skill.

## Risks

Read [SECURITY.md](SECURITY.md) before using chief.

- **Bypass permissions.** The hub and its work sessions run without per-command approval and read text written by other people. The skill tells them to treat messages as data, but that is model behaviour, not isolation: prompt injection is possible.
- **Sending as you.** The engine gates every outgoing message: you click Send in the panel, you say "send" in the hub (the plugin verifies you typed it), or a rule allows it (exact quick replies, trusted people, scenarios set to auto). Loosening rules from the hub only creates a proposal you must accept.
- **Slack uses your browser session cookie**, not an official Slack app. It has full access to your account. Check that your workspace policy allows this.
- **Data is stored in plaintext locally** under `~/chief/data`. Nothing is uploaded elsewhere by chief.

## Where data lives

- `~/chief/rules.json` — your rules; `~/chief/config.json` — engine settings (`chief config` lists the keys, `chief config set` changes them).
- `~/chief/CLAUDE.md`, `~/chief/notes/` — your instructions and the hub's notes.
- `~/chief/data/*.json(l)` — events, decisions, tasks, questions, outbox (contains other people's messages).
- `~/chief/data/archive/` — finished items older than 7 days, moved here monthly and kept (not deleted).
- macOS Keychain items `chief:slack.cookie_d` and `chief:notion.token`.
- The plugin's own store (in Claude's plugin directory) holds the confirm key the panel uses to prove a send was yours; `~/chief/data` only has its fingerprint.
- `~/Library/LaunchAgents/dev.chief.engine.plist` — the launchd agent.

Quiet hours and daily digests (`quietHours`, `digest.morning` / `digest.evening` in `config.json`, also settable in the panel's Setup tab, take effect immediately): during quiet hours the engine holds its notifications (except a corrupt data file or a changed confirm key) and the hub holds its pushes unless urgent; held items go into the next digest. Auto-sent replies are not affected. At digest times the hub posts a summary of what's waiting on you (`chief digest` prints the raw material).

Backup: `chief export [--out <dir>]` writes `~/chief/exports/chief-export-<time>.tar.gz` (rules, config, CLAUDE.md, notes, data files, archives; no secrets).

To remove everything: run `chief uninstall --purge` in a terminal and type `purge`. It unloads the engine, deletes `~/chief` (keeping `exports/`) and chief's Keychain items, and lists what it removed. Then uninstall the plugin in Claude (`/plugin` → chief → uninstall).

## Troubleshooting

Start with `chief status`, `chief logs` and `chief doctor` (`~/chief/data/bin/chief`).

- **Node too old / not found**: install Node 24+, then click install again.
- **Chrome missing**: install Google Chrome; chief opens a separate profile window only for login.
- **SSO login loops**: enter the workspace name in Settings and log in again, or run `chief connect slack --workspace xxx`.
- **Slack session expired**: the Slack row turns red and chief notifies you; click 重新登录 (log in again). Events are not lost.
- **Confirm key mismatch** (panel Send disabled): run `~/chief/data/bin/chief key reset` in a real terminal, then `/reload-plugins`. A reset always notifies you.
- **Engine not running**: start or restart it from Settings; check `chief logs`.
- **Messages between sessions are "held"**: the work session's permission mode differs from the hub's; switch it to bypass permissions.

## License

MIT
