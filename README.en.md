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

Fully restart DSH and open **Settings → IM 桥接**. The first run creates
`~/.dsh/lane-bridge/` with a default domain, a sample role card, and a KB
skeleton.

Local development:

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

> Installation is managed by `dsh plugin`; SnowLuma remains a separate,
> user-installed component (see its EULA). First-run checklist:
> [docs/guides/LIVE_TEST.en.md](./docs/guides/LIVE_TEST.en.md).

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

## What is in the box (v0.1 scope)

- Channel adapter interface + SnowLuma (OneBot v11) adapter (QQ).
- Official QQ Bot adapter (experimental; requires an app id/secret).
- Discord adapter (`discord.js`; DM + guild channels, optional mention gate).
- Domain / binding model: one DSH session per group or private chat, with a
  domain-level role card, preset, model, KB scopes, and host-tool allow-list.
- Shared role-card library, shared knowledge base (`lane_kb_*`), and optional
  domain-scoped shared memory (`lane_memory_*`).
- Unified push: `lane_send` agent tool + `POST /lane-bridge/api/push`.
- Native DSH Settings card: channels, conversations, domains, roles, KB, push.
- Inbound image understanding: safe image download (SSRF/byte caps) + multimodal
  prompt parts, with a text-only fallback for non-vision models.
- Human handoff: `lane_escalate` pauses auto-replies, notifies an operator
  conversation, and resumes from the Settings card.
- Local token ledger + Usage tab (per-conversation input/output/cache totals).
- Tests for the store, resolver, route handlers, and the plugin harness.

See [docs/IM_BRIDGE_ARCHITECTURE.en.md](./docs/IM_BRIDGE_ARCHITECTURE.en.md) for the
architecture and migration plan, and
[docs/guides/PUBLISHING.en.md](./docs/guides/PUBLISHING.en.md) for publishing and
installation details.

## Status

`0.1.0` is an MVP. The legacy standalone `qq-bridge` project still has features
the plugin does not yet port: group slang learning, sticker library, voice
messages, cost conversion, and the simulation scheduler. The architecture doc
tracks the migration.

The code, tests, and package are complete; **live DSH installation and real
SnowLuma / QQ Bot / Discord traffic are not verified yet**. Use
[LIVE_TEST.en.md](./docs/guides/LIVE_TEST.en.md).

## Credits

Derived from `qq-bridge` by Derpyu520 and contributors (MIT). See
[NOTICE](NOTICE). The legacy source, its SnowLuma distribution, and any local
`config.json` are not part of this repository or the published package.

## License

MIT. Chinese reference translation: [LICENSE.zh.md](LICENSE.zh.md); the English
text prevails. The legacy project is MIT too; its bundled SnowLuma distribution
and any machine-local `config.json` are **not** part of this repository or the
published package.
