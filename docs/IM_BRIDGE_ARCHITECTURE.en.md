[中文](IM_BRIDGE_ARCHITECTURE.md) | **English**

# IM Bridge architecture (DSH plugin)

> Status: proposal + v0.8.1 implementation notes.
> Audience: maintainers, future contributors, and anyone evaluating the plugin
> before installing it.

## 1. Decision: native DSH plugin, not a separate frontend

**We build the product as a DSH plugin with a native Settings card and a right-sidebar panel.**

| Option | Verdict | Why |
| --- | --- | --- |
| Standalone web console (like the old `launcher/` on port 3210) | No, except one-shot migration/diagnostics scripts | It duplicates login, CSRF, theme, i18n, and deployment; users have to discover and remember a second URL. Its only unique value was starting a process DSH should not own (SnowLuma), which remains a user action. The repo ships a migration script, not a second console. |
| Host-only DSH plugin + separate static page served at `/lane-bridge/` | Interim only | Easy to ship, but it feels like an iframe product: no shared settings shell, no shared locale/theme, two visual languages. |
| Native DSH host plugin + native client Settings section + right-sidebar tab | **Yes** | One install, one auth session, one lifecycle, one look. DSH already provides `settings.section`, `sidebarRightTabs`, `sidebar.right.pane.tab`, and authenticated HTTP routes; the Settings page is for full configuration, the sidebar for day-to-day conversation management. |

The plugin still exposes an HTTP API (`/lane-bridge/api/*`) because the browser
card and external "push" callers need a stable boundary. That API is a transport,
not a second product surface.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **Channel** | A transport account: `snowluma` (OneBot v11), `qqbot` (official QQ Bot), `discord`. |
| **Conversation** | One chat thread seen by a channel: a group or a private chat. Key: `<channel>:<group|private>:<externalId>`. |
| **Domain** | **Infrastructure**: bound knowledge bases (several), shared memory, GitHub repo, host-tool allow-list, operator whitelist, group trigger policy (all/mention/keyword/off; mention and keyword can be enabled together), agent preset/model, reply policy. A domain never names a role. |
| **Binding** | Conversation → role. There is no domain on a binding; it only picks a role card. A conversation without a binding is *discovered* but does not call a model. |
| **Role card** | A Markdown persona plus its **domain**. The conversation picks the role; the role decides which infrastructure is used. |
| **Knowledge base** | A named document container: one directory under `knowledge/<name>/`, registered in `state.knowledgeBases`. A domain binds several of them by name. |
| **Knowledge document** | One Markdown file inside a knowledge base, carrying `title` / `triggers` / `always` frontmatter. It is injected only when its triggers match. A document belongs to the base it lives in; it no longer declares a domain. |
| **KB draft** | A single-topic document the AI writes under `knowledge/<base>/_待审/`. Triggers are **mandatory**; after a human edits the triggers in the KB approval tab and approves it, it becomes a real document in that base. Drafts are invisible to retrieval and to the model. |
| **Domain memory** | Optional shared notes (`memories/<domainId>.json`) read/written by `lane_memory_*`; injected into the prompt chronologically, capped. |
| **Operator** | A member on the domain whitelist, written as `channel:id` (`qqbot:8FD9…`, `snowluma:123456789`, `discord:123…`), a bare id, or `*`. An **empty list means nobody**. |
| **Session** | The DSH session mapped 1:1 to a conversation. |
| **Push** | Operator-initiated outbound message to any bound conversation (HTTP + agent tool). |

### Resolution order: conversation → role → domain

```
binding.role (else config.defaultRole / the first role card)
  → the role card's domainId
  → the domain (bound knowledge bases, memory, repo, operators, triggers, preset/model)
  → the global default domain (role missing / legacy data)
```

State from 0.3.x is migrated here: an old `domain.role` becomes that role card's
`domainId`, and a `binding.domainId` without a role still resolves through that
domain, so behaviour is unchanged until the operator picks a role in the UI.

If no binding exists, the plugin records the conversation under "discovered" and
does not prompt an agent. This is the cost/safety default; an operator explicitly
binds it (or enables `autoReplyPrivate` for a support inbox).

## 3. Runtime shape

```text
  QQ (SnowLuma)  ─┐
  QQ (official)  ─┼─ ChannelAdapter ─┐
  Discord        ─┘                  │  normalized InboundMessage
                                     ▼
                              ConversationRouter
                                     │  binding + domain + trigger policy
                                     ▼
                              InboundQueue (800 ms debounce)
                                     ▼
                              SessionPool ──► DSH sessionController
                                     │            │
                                     │            ├─ follow() event stream
                                     │            └─ per-agent tools / restrictions
                                     ▼
                              ReplyDispatcher ──► ChannelAdapter.send()
                                     ▲
                              lane_send tool / push API
```

### Channel adapter contract

```js
adapter.start()                       // connect; must not block plugin activation
adapter.stop()                        // idempotent
adapter.send(conversation, messages)  // string[]; adapter handles chunking
adapter.status()                      // { connected, selfId, lastError, lastEventAt }
adapter.onMessage(cb)                 // cb({ channel, kind, externalId, senderId,
                                      //      senderName, text, images, mentionsBot,
                                      //      replyToBot, raw })
```

Adapters own only transport concerns. They never touch DSH sessions, role cards,
or the store.

### Channel instances: one bot per entry

`config.channels` is an **instance map**: the key is the instance id (also the
conversation-key prefix), and the value carries `kind` (`snowluma` / `qqbot` /
`discord`), `label`, and credentials. The same transport can therefore run several
bots side by side (two AppIDs are two QQ bots).

- The default instances keep the ids `snowluma` / `qqbot` / `discord`. Older
  states have no `kind`; it is inferred from the id, so 0.7.x conversation keys
  (`qqbot:group:<openid>`), bindings, operator lists, and memory stay valid with
  no migration.
- New instances (`qqbot-2`, `support-bot`, …) get a namespace of their own:
  conversations, roles, domains, and sessions are keyed per instance id.
- `ChannelManager` is per instance: `startOne` / `stopOne` / `restart(id)` /
  `sync(ids)`. Saving config compares entries one by one and restarts only the
  ones that actually changed; deletion goes through `POST /api/channels/remove`
  (a config patch deep-merges and can never drop a key).
- A domain claims a bot through `domain.channelId`. Unbound conversations resolve
  as: bound role → legacy binding `domainId` → the domain that claims the bot →
  the global default domain. Once a domain owns a bot, unbound conversations on
  that bot follow that domain's `autoReply` and wake policy instead of the global
  "unbound groups" switch.
- If several domains claim the same bot, inbound uses the first in the domain
  list and the domain page warns; one domain claims at most one bot.

### Why one DSH session per conversation?

- The transcript is inspectable in the DSH sidebar, with tools and approvals.
- DSH's compaction, model selection, and token meter work per session.
- Resetting a conversation does not affect other sessions (the old DSH session stays in history).

The plugin stores the `sessionId` in its state; on DSH restart the session is
resumed by `sessionController.prompt` (persisted sessions are cold-resumed).

### Per-agent tool surface

The plugin registers its tools on `agent.ctx`, not globally:

- `lane_send` (send to current or named conversation)
- `lane_conversation_info`
- `lane_kb_list` / `lane_kb_read` / `lane_kb_search` / `lane_kb_draft`
- `lane_memory_read` / `lane_memory_add`
- `lane_retire` (only during an archival turn)
- `lane_repo_status` / `lane_repo_list_issues` / `lane_repo_get_issue` /
  `lane_repo_read_file` / `lane_repo_search_code` / `lane_repo_recent_commits` /
  `lane_repo_create_issue`
- `lane_escalate`

Then it applies `agent.ctx.tools.restrict({ allow: domain.allowedHostTools })` to
hide inherited host tools (bash, fs, subagents, plugin manager…). The default
allow-list is empty: a support agent can talk, read the KB, and push — nothing
else. A domain can opt into read-only host tools such as `web_search`.

This is deliberately stricter than the legacy bridge's preset-level guard: the
restriction is attached to the exact conversation's agent, so a new preset or a
new DSH version cannot silently widen the surface.

### Identity: the operator whitelist

A group shares one DSH session, so "who said this" can only be scoped to a
**single inbound turn**, never to the session:

- Every inbound message carries `senderId` (QQ number for SnowLuma, openid for
  the official QQ Bot, snowflake for Discord). `senderName` is prompt text only
  and **never** used for authorization.
- The domain holds `operators: string[]`. Entries are `channel:id`, a bare id
  (any channel), or `*` (everyone). The channel must match the conversation
  key's prefix. An **empty array means nobody**.
- `SessionPool.prompt()` records `{ senderId, senderName, isOperator }` in
  `turnSender[key]` before submitting the turn; `lane_*` tools read it through
  `pool.currentSender(key)`, so one member can never inherit the previous
  speaker's rights.
- Gated actions: `lane_repo_create_issue`, `lane_send` with a target other than
  the current conversation, and `lane_memory_add`. Everything else (multi-bubble
  replies in the same chat, KB drafts, human escalation) stays open to everyone;
  `lane_retire` only works inside an archival turn.
- On an operator's turn the prompt prefix says
  「本次发言者：X（本领域管理员，可执行管理操作）」 plus an explicit
  「发言者身份：管理员／普通成员」 line.
- `conversations[key].senders` keeps the last 10 participants per conversation
  (`channel:id` plus nickname) so the settings page can offer one-click copy.

### Identity branching in prompts (soft layer)

Role cards and `domain.systemPrompt` run through `renderTemplate()`
(`lib/template.js`) before injection: `{{identity}}` and friends, plus
`{{#if operator}}…{{else}}…{{/if}}`. The render context and `isOperator()` share
one source, so the identity the prompt sees can never disagree with the identity
the tool gate checks.

Two constraints worth remembering:

- Rendering happens once, inside `buildContextPrefix()`, and `roleKey` carries an
  `admin`/`member` suffix, so flipping identity re-injects the role card —
  otherwise the cache would hand the first speaker's version to everyone.
- Templates only change wording. Authorization still happens exclusively in
  `tools.js`'s `requireOperator()`; writing "you are an administrator" in a card
  does not unlock a tool.

This is still *channel identity*, not strong authentication: the SnowLuma QQ
number is only as trustworthy as the OneBot gateway, whereas openids are issued
by the platform and are unique per bot.

### Context budget

Four blocks make up a conversation's prompt, each with its own cap:

| Block | How it is injected | Cap |
| --- | --- | --- |
| Role card / domain instructions | at session creation, re-injected when the identity or the card changes | role card 8000 chars |
| Domain shared memory | **in full** when `memoryEnabled`, newest first | `memoryMaxChars` (200–8000, default 2000) |
| Knowledge base | **not injected** by default; the model calls `lane_kb_*` | per-call limits |
| KB auto retrieval | with `kbAutoRetrieve` on, only documents whose **own triggers** match are injected | `kbRetrieveChars` (200–8000, default 1500) |

With `sessionMaxTurns > 0`, answered turns are counted and the threshold starts an
archival turn: `prompt()` sends an internal instruction, the model calls
`lane_retire` to write memory / KB drafts, then `reset()` drops the DSH session.
While `isRetiring(key)` is true, `index.js`'s `onTurnEnd` returns early, so neither
the instruction nor the model's reply reaches the chat. The wait for that turn is
bounded (90 s by default) and the reset happens regardless — losing one
sedimentation is preferable to unbounded context growth.

## 4. Data model

Everything lives under `$DSH_HOME/lane-bridge/` by default (override with the
plugin row's `dataDir`):

```text
lane-bridge/
├── state.json          # config, domains, knowledgeBases, roles, bindings, conversations, sessions
├── roles/
│   ├── 客服.md
│   └── ...
├── knowledge/
│   └── <base>/
│       ├── save.md     # frontmatter: title / triggers / always
│       └── _待审/      # AI drafts; excluded from retrieval
├── memories/
│   └── <domainId>.json
├── usage.jsonl         # token usage ledger
└── logs/               # optional
```

`state.json` is the single source of truth for runtime configuration. Writes are
atomic (temp + rename) and serialized; only high-frequency conversation activity
is coalesced (default one write per second, with `flush()` on unload), while
config, roles, and bindings still land immediately. The Settings card reads a
**redacted** projection: secrets become presence flags, never clear text.

Knowledge bases have two sources of truth: the directory is the document truth,
and `state.knowledgeBases` holds ids and display names. Renaming a base moves the
directory and repoints every domain that bound it; deleting a non-empty base
requires an explicit `force` and then unbinds it everywhere. `/api/kb` also reports
orphan directories that exist on disk but are not registered, so legacy data is
visible instead of silently ignored.

Drafts live under `_待审/`; `walkScope` skips every `_`-prefixed path, so listing,
retrieval, and the model cannot see them. Approval writes the new document first
and then deletes the draft; a name clash gets a numeric suffix.

Why not store everything in the DSH profile YAML? Because bindings change often,
are keyed by external ids, and must not trigger a plugin remount. DSH settings are
for bootstrap values (data directory, default preset); the operational model is a
document the plugin owns, like a database.

## 5. Inbound → reply flow

1. Adapter normalizes a message and calls `router.handleInbound`.
2. Router finds the binding and applies the domain trigger policy
   (`all`/`mention`/`keyword`/`off`; mention and keyword combine with OR). A
   mention includes being @-ed and replying to the bot's message. If missing or
   not triggered: record the conversation, stop. No model call.
   A short per-conversation debounce (default 800 ms) merges message bursts into
   one prompt before the next step.
3. `SessionPool.ensure(key)` resumes/creates the DSH session, applies domain
   model/preset, registers scoped tools, and starts a `sessionQuery.follow`
   loop if this session is new.
4. The message is prefixed with a compact context header and, on first turn or
   role change, the full role card. If auto retrieval is on, snippets of
   documents whose triggers match are injected too (capped by
   `kbRetrieveChars`); only when no document matches does the legacy path fall
   back to the domain's fallback words plus full-text search.
5. `sessionController.prompt` admits the turn.
6. The follow loop collects `assistant/message` text until `turn/end`.
7. If `lane_send` succeeded during that turn, the collected text is **not**
   auto-sent (the agent already chose its bubbles). Otherwise the final text is
   split and sent by the adapter.
8. Errors produce one short apology, never a stack trace in chat.

The "agent already sent" suppression matters: without it, a support agent that
uses `lane_send` to send three short bubbles would also leak the concatenated
assistant text as a fourth.

### KB drafts and approval

- `lane_kb_draft` takes `title`, `content`, `triggers` (required), `source`
  (required), and `scope` (required when the domain binds several bases).
- A domain with no bound base errors out; a `scope` outside the bound set is
  refused with the choices listed; with exactly one bound base, `scope` may be
  omitted.
- Drafts are deduplicated and capped, and file names carry a timestamp suffix so
  two same-titled drafts in one second cannot overwrite each other.
- The approval page shows which base the draft will land in and which domains
  bind that base; **Approve** is disabled while the trigger list is empty.
  Approval creates `<title>.md` in that base with frontmatter and the source — it
  never appends to a large file and never overwrites an existing document.

## 6. Unified push

Two entry points, one implementation:

- Agent tool `lane_send({ target?, targets?, messages })`.
- `POST /lane-bridge/api/push` with `Authorization: Bearer <pushToken>` (external
  systems) or a same-origin browser request (Settings card test button).

Targets resolve as: explicit conversation key → exact binding name → current
conversation (tool only), and the tool/API can take a list for a broadcast
(`POST /api/push` caps at 50 targets, the `lane_send` tool at 20 conversations).
A broadcast is limited to bound conversations; unbound keys are rejected. A
partial failure returns 207 with a readable `error` and per-target `results`.
Every push is logged with source (`agent` / `api`), target, and result. Rate
limiting is not implemented yet.

## 7. Security baseline

- **Binding-first**: unbound conversations never reach a model.
- **No inherited tools by default**: `tools.restrict` per agent.
- **Admin actions go through the whitelist**: issue creation, cross-conversation
  push, and shared-memory writes require `operators`; the default empty list
  allows nobody.
- **Secrets**: stored in `state.json` with best-effort 0600 and never returned to
  the browser; the UI only shows "configured".
- **Routes**: same-origin check for browser writes; a separate bearer token for
  external push; loopback-only assumptions documented.
- **No arbitrary file access** from the model: KB tools resolve inside
  `knowledge/`, reject `..`, absolute paths, and non-`.md/.txt` files; drafts may
  only be written under `_待审/`.
- **No process control**: the plugin never starts/stops SnowLuma or another
  vendor's native component. That is a user action (and often an EULA term).
- **Prompt injection**: external text is untrusted; the persona tells the agent
  to treat user messages as data, and the tool surface is minimal.
- **Images**: public http(s) only, hop-by-hop redirect validation, type and byte
  caps to avoid SSRF and oversized responses.

## 8. Migration from `qq-bridge`

The legacy `qq-bridge` source is **not included** in this repository. The
migration script can read an external legacy checkout. Port order:

| Milestone | Content | Status |
| --- | --- | --- |
| M1 | Plugin skeleton, store, domain/binding router, Settings card, push API, session reset | v0.1 |
| M2 | SnowLuma adapter + session orchestration + auto-reply | v0.1 |
| M3 | Official QQ Bot adapter | v0.1 (experimental) |
| M4 | Knowledge tools + role library + per-agent restriction | v0.1 |
| M5 | Discord adapter (`discord.js`; DM/guild + mention gate) | v0.1 basic |
| M6 | GitHub read-only + KB draft/approval + sidebar | v0.2 |
| M7 | Conversation → role → domain, operator whitelist, identity templates, QQ Bot full-mode group messages and passive-reply fixes | v0.3–v0.4 |
| M8 | Knowledge bases first-class, multi-base domain binding, document rename/cross-base move, mandatory draft triggers, approval creates a document | v0.5–v0.6 |
| M9 | Cost conversion, stickers, voice, slang, simulation scheduler | later |
| M10 | One-click UI migration of `config.json`, `roles/`, `knowledge/`, `state/sessions.json` | script exists; UI later |

Features intentionally **not** ported at first: gen-1/gen-2 simulation
schedulers, meme/sticker collection, voice sending, slang learning. They depend
on a long-lived autonomous loop that does not fit the "support inbox" model and
should be rebuilt as a separate domain policy later.

## 9. Install and upgrade

```sh
dsh plugin --profile web add dsh-lane-bridge
```

The package declares three patch files that insert:

- the `dsh-lane-bridge` host row (with `inject` services),
- the `lane-support` agent preset row (support persona + no built-in tools), and
- the `lane-chat` agent preset row (chat/role-play persona with the role card on
  top, also no built-in tools).

No second process. No port. No console token. Upgrading the plugin does not
touch `state.json`, roles, or knowledge. The Settings header shows the version the
running host actually loaded (`/api/health`), so "did the restart pick up the new
build?" is answerable. Publishing/install details:
[guides/PUBLISHING.en.md](./guides/PUBLISHING.en.md).

## 10. Verification status

What the repository verifies today (`npm test`, 168 tests):

| Area | Evidence |
| --- | --- |
| State store | atomic writes, schema repair, secret preservation, role-file reconciliation, coalesced conversation writes and flush |
| Domain/binding resolver | unbound default, per-binding overrides, disabled binding, per-domain trigger (all/mention/keyword/off, multi-select), legacy state migration |
| Channel instances | legacy `kind` inference from the id, add/rename/delete and per-instance reconnect, domain-claim resolution order, duplicate-AppID warning |
| Knowledge bases | create/rename/delete with domain repointing, document rename/cross-base move, traversal rejection, `_`-prefixed hiding |
| Document triggers | matching only by a document's own triggers, `always`, no injection without a hit, fallback only for legacy docs, ranking and character budget |
| KB drafts | write-only `_待审`, excluded from list/search/read, dedupe/rate limit, triggers required and scope must be bound by the domain, approval creates a new triggered document (suffix on name clash), discard, no target-file picker |
| GitHub read-only | fixed repo/path guards, token redaction, issues/files/commits, 401 retry, code search requires auth, label-missing degradation |
| HTTP boundary | same-origin writes, secret redaction, bearer push, validation errors, 207 partial-failure reasons |
| Session orchestration | new session creation, cold `agents.resume` setup, role-card first/again injection, turn collection, `lane_send` suppression |
| Identity and templates | `{{#if operator}}`, variable substitution, re-injection on identity flip, unknown variables render empty |
| Broadcast | `lane_send` targets multiple bound conversations and refuses unbound ones (tool max 20, push API max 50 targets) |
| Inbound debounce | burst merge, dynamic delay, 0=immediate, stop cancels timers |
| Domain memory | append/dedupe/render/replace/clear, corrupt-file backup, prompt injection, domain isolation |
| Archival | threshold triggers `lane_retire`, bounded wait, replies suppressed during it, session reset afterwards |
| Inbound images | public-address/redirect/type/byte checks; multimodal content; text-only fallback |
| Human handoff | pause binding, operator notification, ack, resume, route auth |
| Token usage | per-message ledger, aggregation by conversation, clear, route |
| Session reset | forget mapping, abort follow, next message creates a new session |
| Reply delivery | markdown stripping, chunking, no double-send after `lane_send`, one apology on failure, quiet empty turn |
| OneBot transport | echo correlation, access token, inbound event parsing, failed action rejection |
| SnowLuma discovery | per-account WS token/port from `onebot_*.json`, explicit settings win |
| Discord adapter | fake discord.js client: ready, DM/guild normalization, mention gate, reply metadata, mention parsing disabled |
| QQ Bot adapter | fake SDK client: ready, c2c/group normalization, bot filter, passive reply target, full-mode mention detection, 5-bubble cap, error-code translation |
| Client bundle | module-loader wrapper, `settings.section` registration, nine tabs rendering, cleanup |
| Package manifest | host/client exports, bundle patch paths, `lane-support` / `lane-chat` preset ids |
| Cordis activation | the real `@deepseek-ai/cordis` runtime activated the plugin with fake host services and disposed both routes cleanly (catches async-apply/effect mistakes that a mock ctx misses) |
| Migration | legacy config/roles/KB/sessions → new state |

**Real-environment status** (as of 2026-10-26):

- **Running in production**: Discord and the official QQ Bot. The real DSH
  installation and Settings rendering, real model turns, and traffic on both
  channels are all in production use.
- **Tested, not in production**: SnowLuma OneBot traffic (tested, but it has not
  run in production).
- **Confirm against the target account**: the official QQ Bot "receive all
  messages" and active-message permissions (the switches live on the bot profile
  page in the mobile QQ app).
- **Can be re-verified with LIVE_TEST**: browser interaction for low-frequency
  flows such as KB approval and session archival.

v0.8.1 is positioned as: Discord and the official QQ Bot running in production;
SnowLuma tested but not yet deployed to production.

## 11. Open questions

- KB drafts next: a diff view, batch approval, and an approver audit trail; should
  drafts about the same topic merge instead of stacking?
- KB retrieval is trigger + full-text matching today. Should it add vector search,
  and how do we keep it from eating the context budget?
- Should a domain bind several channel accounts with per-channel presets/models?
  The current model already lets one domain serve QQ + Discord, but not with
  different policies per channel.
- Should the legacy simulation scheduler, stickers, voice, and slang learning be
  rebuilt as separate domain policies, or stay in the legacy project?
- Push rate limiting and retries: only a 50-target cap and per-target results
  exist today; there is no queue.
