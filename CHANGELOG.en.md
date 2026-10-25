[中文](CHANGELOG.md) | **English**

# Changelog

## 0.1.0

First runnable plugin skeleton.

- DSH host plugin: channels, domains, bindings, per-conversation sessions, and a
  native Settings card.
- Channels: SnowLuma OneBot v11 (in-tree WS client), official QQ Bot
  (`@tencent-connect/qqbot-nodejs`, experimental), Discord (`discord.js`).
- Domain policy: role card, agent preset, optional `provider/model`, KB scopes,
  host-tool allow-list, group trigger policy (`all`/`mention`/`keyword`/`off`).
- Shared role-card library and Markdown knowledge base (`lane_kb_*`).
- Unified push: `lane_send` agent tool and `POST /lane-bridge/api/push`
  (`target` or broadcast `targets`).
- Chat-friendly batching: per-conversation debounce merges message bursts into
  one prompt (configurable, 0 disables).
- Per-domain trigger policy: all / mention / keyword / off.
- Session reset for a conversation (new DSH session on the next message).
- Optional domain-scoped shared memory (`lane_memory_read` / `lane_memory_add`).
- Inbound image understanding with SSRF/byte caps and a text-only fallback.
- Human handoff: pause/escalate/resume with an operator notification.
- Local token ledger and a Usage tab (per-conversation token totals).
- One-shot migration from the legacy `qq-bridge` layout.
- Security defaults: unbound chats never prompt, per-agent tool restriction,
  KB path confinement, same-origin browser writes, bearer-token external push.
- Tests: store, resolver, KB, routes, session orchestration, reply delivery,
  OneBot, QQ Bot, Discord, migration, client bundle, package manifest.

Not yet: live-install verification, cost conversion dashboard, stickers, voice,
slang learning, simulation scheduler.
