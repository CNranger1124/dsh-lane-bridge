[中文](CHANGELOG.md) | **English**

# Changelog

## 0.2.2

- The Settings save bar is now **sticky to the viewport bottom**, so Save is
  visible anywhere on the page.
- GitHub repo/branch fields now load dropdown choices from the local `gh` CLI or
  a token; `gh auth login` is enough, no manual token required.
- Add a GitHub auth check with a clear message when the local `gh` login is
  expired (which is the current state on this machine).
- Add **View logs** to the channel launcher: the last 300 connect/reconnect/error
  lines, instead of just "not connected".
- Keep **Start / Stop / Retry / Reconnect all** in the launcher.
- Test suite grows to 89.

## 0.2.1

- Add a **Launch channels** card at the top of Settings with explicit
  **Start / Stop / Retry / Reconnect all** for SnowLuma, official QQ Bot, and
  Discord, so users no longer have to guess how to open them.
- Channel card buttons now say **Start/Stop** to match the launcher.
- Show the exact next step and reason inline when stopped/disconnected (for
  example, "start SnowLuma first; default 127.0.0.1:3001").
- Document how to start SnowLuma (`launcher.bat` / `node index.mjs`).

## 0.2.0

Ports the legacy GitHub read-only tools and KB draft approval, and fixes channel
enablement guidance.

- Read-only GitHub: `lane_repo_status/list_issues/get_issue/search_code/read_file/recent_commits`;
  fixed repo, token redaction, ETag cache; `repo_create_issue` is off by default.
- KB drafts: `lane_kb_draft` writes only to `knowledge/<scope>/_待审/`; drafts are
  excluded from list/search/read, with hourly rate limiting and deduplication.
- New "KB approval" tab: approve/discard each draft; approval backs up the target
  document, appends a section, and keeps the source.
- Domain switches `repoEnabled` / `kbDraftEnabled`; GitHub is opt-in, KB drafting
  is on by default.
- Channel cards now have direct Enable/Disable buttons and actionable hints for
  SnowLuma not running, wrong port, or missing AppID/Token.
- The empty-conversation blank Settings page fix from 0.1.1 is retained.
- Test suite grows to 88 tests covering GitHub requests/redaction/path guards,
  draft lifecycle, approval routes, and empty-conversation rendering.

## 0.1.1

Bug fixes and a sidebar entry.

- Fix the Conversations tab crashing when there are no conversations, which
  blanked the whole Settings surface. An empty list now renders its placeholder.
- Add an error boundary to both the Settings card and the sidebar panel, so a
  panel render failure shows the error and a Retry button instead of taking down
  the whole UI.
- Add a DSH right-sidebar **IM 桥接** panel for conversations, channels, domains,
  roles/KB, usage, and push; it shares the same state as the Settings card.
- Regression tests cover empty-conversation rendering and sidebar tab
  registration/cleanup.

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
