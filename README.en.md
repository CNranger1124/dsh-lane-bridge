[中文](README.md) | **English**

# dsh-lane-bridge

A **DeepSeek Harness (DSH) plugin** that connects social chat channels to DSH agents:
one plugin, many channels, shared knowledge, per-conversation personas, and a
single outbound "push" API.

This repository started from `qq-bridge` (a standalone QQ ↔ DSH bridge). The
plugin in [`packages/dsh-lane-bridge`](./packages/dsh-lane-bridge) is the new home
for the product. The legacy source tree is **not included** in this repository;
the migration script can read an external legacy checkout. The repository keeps
only the plugin, docs, and tests.

## Quick install (latest by default)

> Both paths install the latest version: GitHub Release uses `latest`, npm uses the versionless command. Use GitHub Release while npm is not published.

### DSH Web

```sh
dsh plugin --profile web add dsh-lane-bridge
```

If npm is not published yet, use the latest GitHub Release:

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

### DSH Desktop

Fully quit DSH Desktop first, then:

```sh
dsh plugin --profile desktop add dsh-lane-bridge
```

Or use the latest GitHub Release:

```sh
dsh plugin --profile desktop add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

Fully restart DSH and open **Settings → IM 桥接**. You can also open the **IM 桥接**
panel from the DSH right sidebar's “+” menu to manage conversations, channels,
and domains directly. The first run creates `~/.dsh/lane-bridge/` with a default
domain, a sample role card, and a KB skeleton.

Local development:

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

> Installation is managed by `dsh plugin`; SnowLuma remains a separate,
> user-installed component (see its EULA). First-run checklist:
> [docs/guides/LIVE_TEST.en.md](./docs/guides/LIVE_TEST.en.md).

## Starting a channel (why it says "not connected / stopped")

The plugin does not start SnowLuma for you (licence reasons). "Enabled but not
connected" usually means SnowLuma is not running, or the WS port is wrong.

1. Start SnowLuma yourself: double-click `launcher.bat` in its folder, or run
   `node index.mjs` there; wait for `listening 127.0.0.1:3001` in its log. The
   plugin does not start it for you (EULA reasons).
2. Open **Settings → IM 桥接 → 概览与通道**.
3. In the **启动通道** card at the top, find **SnowLuma / QQ** and click
   **Start**. The pill should turn **已连接**. If not, the row shows the reason.
4. For official QQ Bot / Discord: fill AppID+AppSecret / Bot Token, then click
   **Start**. Click **Stop** for channels you do not use. Discord takes exactly
   one credential, the **Bot Token** (Developer Portal → your app → **Bot** page
   → `Reset Token`); the OAuth2 client secret and the General Information public
   key are not used.
5. If it is started but still disconnected, click **Retry** or **Reconnect all**.

> **Start/Stop** saves and reconnects immediately. The cards below are for
> editing several fields and saving them together.

## Why a plugin instead of a separate app?

- **One install**: `dsh plugin add dsh-lane-bridge` mounts channels, tools, and the
  settings card; there is no second server, port, or console token to manage.
- **One identity**: the browser already has an authenticated DSH session; the
  plugin UI is a normal Settings section, so channel secrets never need a second
  login screen.
- **One lifecycle**: the DSH host starts/stops the adapters with the plugin fiber.
- **One chat surface**: each external conversation is a real DSH session, visible
  in the sidebar with its own transcript, instead of an opaque bridge database.

A standalone frontend would duplicate authentication, theme, session list, and
deployment. We therefore build the management surface **inside DSH**, and keep
only a one-shot legacy migration script for moving an existing install.

## What is in the box (v0.2 scope)

- Channel adapter interface + SnowLuma (OneBot v11) adapter (QQ).
- Official QQ Bot adapter (experimental; requires an app id/secret). The official
  platform only pushes **@-mentions** in group chats (`GROUP_AT_MESSAGE_CREATE`),
  never ordinary group traffic, so keyword triggers cannot work there; use
  SnowLuma when you need every group message.
- Discord adapter (`discord.js`; DM + guild channels, optional mention gate; the
  only credential is a Bot Token).
- Domain / binding model: one DSH session per group or private chat, with a
  domain-level role card, preset, model, KB scopes, and host-tool allow-list.
  Group attention policies are multi-select: mention/reply and keyword can be
  enabled together and either one wakes the bot (`all` and `off` stay exclusive).
- Shared role-card library, shared knowledge base (`lane_kb_*`), and optional
  domain-scoped shared memory (`lane_memory_*`).
- **KB drafts + human approval**: `lane_kb_draft` writes a single-topic draft with
  triggers into the review queue of a knowledge base the domain binds; the Settings
  "KB approval" tab lets you correct the triggers, and approving creates a real
  document there (never overwriting: duplicates get a suffix).
- **Read-only GitHub repo**: one global default repo, with per-domain repo/branch
  overrides; path guards, token redaction, ETag cache; repo/branch dropdowns list
  every repo visible to the account from the `gh` CLI (so `gh auth login` removes
  the need for a manual token); `lane_repo_*` tools for issues/files/code/commits.
  Issue creation is off by default and rate-limited when enabled; if the
  configured label does not exist in the repo, the issue is created without
  labels instead of failing.
- **Channel logs**: "View logs" in the launcher shows the last 300
  connect/reconnect/error lines instead of just "not connected".
- Unified push: `lane_send` agent tool + `POST /lane-bridge/api/push`; the
  Settings page can select several conversations at once and the API takes a
  `targets` array, reporting success/failure per target.
- Domain agent presets are a dropdown fed by the host's own preset registry
  (`/api/presets`), with a one-line explanation of what each preset provides.
- Native DSH Settings card + right-sidebar panel: channels, conversations,
  domains, roles, KB, approval, and push, sharing one state.
- The top **启动通道** card has Start/Stop/Retry per channel plus View logs, with
  actionable connection hints (for example, "SnowLuma is not running").
- Every module header has its own Save button; every module collapses from its
  title row.
- The save bar is sticky at the bottom of the page, so Save is always visible.
- Inbound image understanding: safe image download (SSRF/byte caps) + multimodal
  prompt parts, with a text-only fallback for non-vision models.
- Human handoff: `lane_escalate` pauses auto-replies, notifies an operator
  conversation, and resumes from the Settings card.
- Local token ledger + Usage tab (per-conversation input/output/cache totals).
- Tests for store, resolver, routes, session orchestration, GitHub, draft
  approval, and the plugin harness.

See [docs/IM_BRIDGE_ARCHITECTURE.en.md](./docs/IM_BRIDGE_ARCHITECTURE.en.md) for the
architecture and migration plan, and
[docs/guides/PUBLISHING.en.md](./docs/guides/PUBLISHING.en.md) for publishing and
installation details.

## Status

`0.2.8` makes group attention policies multi-select (mention and keyword together)
and stops issue creation from failing when the configured label is missing (it
retries without labels). `0.2.7` shows the running plugin version in Settings;
`0.2.6` fixes the missing `AbortSignal` on prompt submission and the stale event
stream API that made QQ reply with only an apology. `0.2.4` adds an explicit Save
button to every module header. The legacy standalone `qq-bridge` project still has
features the plugin does not yet port: group slang learning, sticker library,
voice messages, cost conversion, and the simulation scheduler. The architecture
doc tracks the migration.

The code, tests, and package are complete; real DSH / official QQ Bot acceptance
is in progress, while SnowLuma / Discord end-to-end traffic is not verified yet.
Use [LIVE_TEST.en.md](./docs/guides/LIVE_TEST.en.md).

## Credits

Derived from `qq-bridge` by Derpyu520 and contributors (MIT). See
[NOTICE](NOTICE). The legacy source, its SnowLuma distribution, and any local
`config.json` are not part of this repository or the published package.

## License

MIT. Chinese reference translation: [LICENSE.zh.md](LICENSE.zh.md); the English
text prevails. The legacy project is MIT too; its bundled SnowLuma distribution
and any machine-local `config.json` are **not** part of this repository or the
published package.
