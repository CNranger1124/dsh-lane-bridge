[中文](README.md) | **English**

# dsh-lane-bridge

A **DeepSeek Harness (DSH) plugin** that connects QQ (SnowLuma OneBot v11),
the official QQ Bot, and Discord to DSH agents: **one plugin, many channels,
shared knowledge bases, per-conversation personas, and a single outbound push
API**. Current version: `0.8.0`.

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
domain, a sample role card, a default knowledge base, and a memory directory.

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
   `node index.mjs` there; wait for `listening 127.0.0.1:3001` in its log.
2. Open **Settings → IM 桥接 → 概览与通道**.
3. In the **启动通道** card at the top, find **SnowLuma / QQ** and click
   **Start**. The pill should turn **已连接**. If not, the row shows the reason.
4. For official QQ Bot / Discord: fill AppID+AppSecret / Bot Token, then click
   **Start**. Click **Stop** for channels you do not use. Discord takes exactly
   one credential, the **Bot Token** (Developer Portal → your app → **Bot** page
   → `Reset Token`); the OAuth2 client secret and the General Information public
   key are not used.
5. If it is started but still disconnected, click **Retry** on that bot's card —
   it reconnects only that bot and leaves every other one alone.

> **Start/Stop** saves and reconnects just that instance. The cards below are for
> editing several fields and saving them together. Use **Add bot** to run another
> AppID of the same transport (two AppIDs are two bots), then point a domain at it
> on the **Domain** page so that project is served only by that bot.

## One project, one bot

An AppID is a bot, and `openid`s are scoped per bot: the same group has different
ids under two bots, so conversations, memory, and bindings are not shared. To give
each project its own bot:

1. **Channels** page → **Add bot**: pick **Official QQ Bot**, give it a project-ish
   name (for example "Shajin support"), then fill the second AppID/AppSecret and
   save.
2. **Domains** page → select the project's domain → set **Bot this domain uses**.
3. Unbound groups/private chats on that bot now resolve to that domain and use its
   knowledge bases, persona, and wake policy. An explicit role binding still wins.

Deleting a bot asks for a second click; conversation history is kept, and domains
that pointed at it fall back to generic routing.

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
only a one-shot legacy migration script.

## What it gives you

- **Multiple bots**: SnowLuma (OneBot v11), official QQ Bot (AppID/AppSecret), and
  Discord (Bot Token + Message Content Intent), each addable several times (several
  AppIDs / tokens). Every bot starts, reconnects, and reports status on its own,
  and the page keeps the last 300 connect/error lines.
- **Conversation → role → domain**: a conversation only picks a role card; the
  role is bound to a domain; the domain owns the infrastructure (bound knowledge
  bases, shared memory, repo, operators, attention policy, preset/model).
  Swapping the role swaps the whole policy.
- **Domains**: preset dropdown, model, host-tool allow-list, **operator
  whitelist** (`channel:id`; empty means nobody), multi-select group attention
  policies (mention/reply and keyword can both apply, or all/off), auto-retrieval
  and context budgets (`kbRetrieveChars`, `memoryMaxChars`, `sessionMaxTurns`).
- **Two built-in personas**: `lane-support` for a support desk and `lane-chat` for
  group chit-chat / role-play. The latter treats the role card as the highest
  identity setting (card over generic rules, in-character play allowed, silence
  allowed in groups); neither registers built-in tools.
- **Knowledge bases are first-class**: one directory under `knowledge/<name>/` is
  one knowledge base. Create, rename, and delete them on the Knowledge page. A
  domain binds **several** bases, and renaming a base repoints every domain that
  bound it.
- **Per-document triggers**: each Markdown document carries `title` / `triggers` /
  `always` frontmatter; only the matching document is injected. `always: true`
  injects on every turn. Legacy documents still work through the domain's
  fallback words plus full-text search.
- **Knowledge editor**: rename a document (subdirectories allowed) or move it to
  another knowledge base. An existing target is refused, never overwritten.
- **KB drafts + human approval**: `lane_kb_draft` writes a single-topic draft with
  **mandatory triggers** into `_待审/` of a base the domain binds. The approval
  page edits the triggers; approving creates a real document with frontmatter in
  that base (duplicates get a suffix, never overwrite).
- **AI sediment**: when `sessionMaxTurns` is reached, an internal archival turn
  asks the model to `lane_retire` what matters into domain memory or KB drafts,
  then resets the session. Archival text never reaches the chat.
- **Operator whitelist + identity templates**: only whitelisted members can
  create issues, push to another conversation, or write shared memory. Role cards
  and domain prompts can switch wording with `{{#if operator}}…{{else}}…{{/if}}`;
  the hard gate stays in code.
- **Read-only GitHub**: global default repo with per-domain overrides; repo/branch
  dropdowns list everything visible to the `gh` CLI; path guards, token
  redaction, ETag cache; `lane_repo_*` for issues/files/code/commits. Issue
  creation is off by default, rate-limited when enabled, and degrades to no
  labels when the configured label does not exist.
- **Unified push**: `lane_send` agent tool + `POST /lane-bridge/api/push`; single
  or broadcast (`lane_send` caps at 20 conversations, the push API at 50 targets),
  with a 207 response that explains each partial failure.
- **Inbound images**: safe download (SSRF/byte caps) + multimodal prompt parts,
  with a text-only fallback for non-vision models.
- **Human handoff**: `lane_escalate` pauses auto-replies, notifies the configured
  operator conversation, and resumes from Settings.
- **Usage ledger**: local per-conversation input/output/cache token totals.
- **Management surface**: nine tabs (Overview & channels, Conversations, Domains,
  Roles, Knowledge, Memory, KB approval, Usage, Push), each module with its own
  Save button and collapsible header, plus a sticky save bar. The sidebar panel
  shares the same state.
- **Tests**: 157, covering store, resolver, routes, session orchestration,
  GitHub, knowledge bases and draft approval, channel adapters, and the plugin
  harness.

## Configuration model: conversation → role → domain

Three layers, in one direction:

```text
conversation (one group / one private chat)  -- binds one role card
                                                    └─ the role belongs to a domain
                                                         └─ domain = bound knowledge bases
                                                            + memory + repo + operators
                                                            + attention policy + preset/model
```

- **A binding only picks a role.** There is no domain selector; swapping the role
  swaps the knowledge bases, memory, and policy with it.
- **Domains never name a role**; they describe infrastructure only. One domain
  can host several roles.
- **Unbound conversations are recorded but never prompt a model.** Open
  `autoReplyPrivate` for an inbound support inbox.
- Legacy 0.3.x `domain.role` / `binding.domainId` migrate to “role → domain” on
  load.

The detailed manual (operator format, identity templates, document triggers,
draft approval, archival budget, QQ Bot passive vs active messages) lives in
[the plugin README](./packages/dsh-lane-bridge/README.en.md).

## Docs

| Document | Contents |
| --- | --- |
| [packages/dsh-lane-bridge/README.en.md](./packages/dsh-lane-bridge/README.en.md) | Full manual: configuration, operators, templates, knowledge bases, archival, QQ Bot rules, API |
| [docs/IM_BRIDGE_ARCHITECTURE.en.md](./docs/IM_BRIDGE_ARCHITECTURE.en.md) | Architecture, data model, inbound flow, security baseline, migration and verification status |
| [docs/guides/LIVE_TEST.en.md](./docs/guides/LIVE_TEST.en.md) | First-run checklist on a real DSH install and real channels |
| [docs/guides/PUBLISHING.en.md](./docs/guides/PUBLISHING.en.md) | Local link install, npm release, CI, upgrade/uninstall |
| [CHANGELOG.en.md](./CHANGELOG.en.md) | User-visible changes per version |

## Status

`0.8.0` turns channels into bot instances: several AppIDs per transport, one bot per project, a domain picks the bot it uses, and reconnects/saves only touch that one instance. `0.7.0` adds the `lane-chat` preset (group chit-chat / role-play, role card first).
`0.6.0` makes knowledge bases first-class: drafts require triggers, land only in a
base the domain binds, and approving creates a standalone document (the approval
page edits the triggers). `0.5.x` added knowledge-base CRUD, cross-base moves and
renames, and multi-base domain binding; `0.4.x` fixed official QQ Bot passive
replies, full-mode group messages, and mention detection; `0.3.x` introduced the
conversation → role → domain model. See [CHANGELOG.en.md](./CHANGELOG.en.md).

The code and tests are complete (157 passing); real DSH / official QQ Bot
acceptance is in progress, while SnowLuma / Discord end-to-end traffic is not
verified yet. Use [LIVE_TEST.en.md](./docs/guides/LIVE_TEST.en.md).

The legacy project still has features the plugin does not port: group slang
learning, the sticker library, voice messages, cost conversion, and the
simulation scheduler. The token usage ledger is included. The architecture doc
tracks the migration.

## Credits

Derived from `qq-bridge` by Derpyu520 and contributors (MIT). See
[NOTICE](NOTICE). The legacy source, its SnowLuma distribution, and any local
`config.json` are not part of this repository or the published package.

## License

MIT. Chinese reference translation: [LICENSE.zh.md](LICENSE.zh.md); the English
text prevails. The legacy project is MIT too; its bundled SnowLuma distribution
and any machine-local `config.json` are **not** part of this repository or the
published package.
