[中文](IM_BRIDGE_ARCHITECTURE.md) | **English**

# IM Bridge architecture (DSH plugin)

> Status: proposal + v0.1 implementation notes.
> Audience: maintainers, future contributors, and anyone evaluating the plugin
> before installing it.

## 1. Decision: native DSH plugin, not a separate frontend

**We build the product as a DSH plugin with a native Settings card.**

| Option | Verdict | Why |
| --- | --- | --- |
| Standalone web console (like the old `launcher/` on port 3210) | No, except one-shot migration/diagnostics scripts | It duplicates login, CSRF, theme, i18n, and deployment; users have to discover and remember a second URL. Its only unique value was starting a process DSH should not own (SnowLuma), which remains a user action. The repo ships a migration script, not a second console. |
| Host-only DSH plugin + separate static page served at `/lane-bridge/` | Interim only | Easy to ship, but it feels like an iframe product: no shared settings shell, no shared locale/theme, two visual languages. |
| Native DSH host plugin + native client Settings section | **Yes** | One install, one auth session, one lifecycle, one look. DSH already provides `settings.section`, `configForms`, and authenticated HTTP routes. |

The plugin still exposes an HTTP API (`/lane-bridge/api/*`) because the browser
card and external "push" callers need a stable boundary. That API is a transport,
not a second product surface.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **Channel** | A transport account: `snowluma` (OneBot v11), `qqbot` (official QQ Bot), later `discord`. |
| **Conversation** | One chat thread seen by a channel: a group or a private chat. Key: `<channel>:<group|private>:<externalId>`. |
| **Domain** | Reusable behavior: role card, agent preset, model, KB scopes, host-tool allow-list, group trigger policy (all/mention/keyword/off), reply policy. Think "tenant" or "product line". |
| **Binding** | Conversation → domain (+ optional per-conversation role/preset/model overrides). A conversation without a binding is *discovered* but does not call a model. |
| **Role card** | A Markdown persona in the shared role library. Domains and bindings reference it by name. |
| **Knowledge base** | Shared Markdown tree (`knowledge/<scope>/...`) read by `lane_kb_*` tools. Domains choose scopes. |
| **Domain memory** | Optional shared notes (`memories/<domainId>.json`) read/written by `lane_memory_*`; injected into the prompt chronologically, capped. |
| **Session** | The DSH session mapped 1:1 to a conversation. |
| **Push** | Operator-initiated outbound message to any bound conversation (HTTP + agent tool). |

### Domain resolution order

```
binding override (role / preset / model)
  → bound domain
  → global default domain
  → hard defaults
```

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
                                     │  binding + domain
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
                                      //      senderName, text, images, raw })
```

Adapters own only transport concerns. They never touch DSH sessions, role cards,
or the store.

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
- `lane_kb_list`, `lane_kb_read`, `lane_kb_search`

Then it applies `agent.ctx.tools.restrict({ allow: domain.allowedHostTools })` to
hide inherited host tools (bash, fs, subagents, plugin manager…). The default
allow-list is empty: a support agent can talk, read the KB, and push — nothing
else. A domain can opt into read-only host tools such as `web_search`.

This is deliberately stricter than the legacy bridge's preset-level guard: the
restriction is attached to the exact conversation's agent, so a new preset or a
new DSH version cannot silently widen the surface.

## 4. Data model

Everything lives under `$DSH_HOME/lane-bridge/` by default (override with the
plugin row's `dataDir`):

```text
lane-bridge/
├── state.json          # config, domains, bindings, conversations, sessions
├── roles/
│   ├── 客服.md
│   └── ...
├── knowledge/
│   └── <scope>/*.md
├── memories/
│   └── <domainId>.json
├── usage.jsonl         # token usage ledger
└── logs/               # optional
```

`state.json` is the single source of truth for runtime configuration. Writes are
atomic (temp + rename) and serialized. The Settings card reads a **redacted**
projection: secrets become presence flags, never clear text.

Why not store everything in the DSH profile YAML? Because bindings change often,
are keyed by external ids, and must not trigger a plugin remount. DSH settings are
for bootstrap values (data directory, default preset); the operational model is a
document the plugin owns, like a database.

## 5. Inbound → reply flow

1. Adapter normalizes a message and calls `router.handleInbound`.
2. Router finds the binding and applies the domain trigger policy
   (`all`/`mention`/`keyword`/`off`). If missing or not triggered: record the
   conversation, stop. No model call.
   A short per-conversation debounce (default 800 ms) merges message bursts into
   one prompt before the next step.
3. `SessionPool.ensure(key)` resumes/creates the DSH session, applies domain
   model/preset, registers scoped tools, and starts a `sessionQuery.follow`
   loop if this session is new.
4. The message is prefixed with a compact context header and, on first turn or
   role change, the full role card.
5. `sessionController.prompt` admits the turn.
6. The follow loop collects `assistant/message` text until `turn/end`.
7. If `lane_send` succeeded during that turn, the collected text is **not**
   auto-sent (the agent already chose its bubbles). Otherwise the final text is
   split and sent by the adapter.
8. Errors produce one short apology, never a stack trace in chat.

The "agent already sent" suppression matters: without it, a support agent that
uses `lane_send` to send three short bubbles would also leak the concatenated
assistant text as a fourth.

## 6. Unified push

Two entry points, one implementation:

- Agent tool `lane_send({ target?, messages })`.
- `POST /lane-bridge/api/push` with `Authorization: Bearer <pushToken>` (external
  systems) or a same-origin browser request (Settings card test button).

Targets resolve as: explicit conversation key → exact binding name → current
conversation (tool only), and the tool/API can take a list for a broadcast. A
broadcast is limited to bound conversations; unbound keys are rejected. Every
push is logged with source (`agent` / `api`), target, and result. Rate limiting
is not implemented yet.

## 7. Security baseline

- **Binding-first**: unbound conversations never reach a model.
- **No inherited tools by default**: `tools.restrict` per agent.
- **Secrets**: stored in `state.json` with best-effort 0600 and never returned to
  the browser; the UI only shows "configured".
- **Routes**: same-origin check for browser writes; a separate bearer token for
  external push; loopback-only assumptions documented.
- **No arbitrary file access** from the model: KB tools resolve inside
  `knowledge/`, reject `..`, absolute paths, and non-`.md/.txt` files.
- **No process control**: the plugin never starts/stops SnowLuma or another
  vendor's native component. That is a user action (and often an EULA term).
- **Prompt injection**: external text is untrusted; the persona tells the agent
  to treat user messages as data, and the tool surface is minimal.

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
| M6 | Cost conversion, stickers, voice, slang, simulation scheduler | later |
| M7 | One-click UI migration of `config.json`, `roles/`, `knowledge/`, `state/sessions.json` | script exists; UI later |

Features intentionally **not** ported at first: gen-1/gen-2 simulation
schedulers, meme/sticker collection, voice sending, slang learning. They depend
on a long-lived autonomous loop that does not fit the "support inbox" model and
should be rebuilt as a separate domain policy later.

## 9. Install and upgrade

```sh
dsh plugin --profile web add dsh-lane-bridge@0.1.0
dsh plugin --profile web add dsh-lane-bridge@<new-version>
```

The package declares one bundle patch that inserts:

- the `dsh-lane-bridge` host row (with `inject` services), and
- the `lane-support` agent preset row (persona + no built-in tools).

No second process. No port. No console token. Upgrading the plugin does not
touch `state.json`, roles, or knowledge.

## 10. Verification status

What the repository verifies today (`npm test`, 82 tests):

| Area | Evidence |
| --- | --- |
| State store | atomic writes, schema repair, secret preservation, role-file reconciliation |
| Domain/binding resolver | unbound default, per-binding overrides, disabled binding, per-domain trigger (all/mention/keyword/off) |
| Knowledge tools | scope isolation, draft hiding, traversal rejection, search |
| HTTP boundary | same-origin writes, secret redaction, bearer push, validation errors |
| Session orchestration | new session creation, cold `agents.resume` setup, role-card first/again injection, turn collection, `lane_send` suppression |
| Broadcast | `lane_send` targets multiple bound conversations and refuses unbound ones |
| Inbound debounce | burst merge, dynamic delay, 0=immediate, stop cancels timers |
| Domain memory | append/dedupe/render/replace/clear, corrupt-file backup, prompt injection, domain isolation |
| Inbound images | public-address/redirect/type/byte checks; multimodal content; text-only fallback |
| Human handoff | pause binding, operator notification, ack, resume, route auth |
| Token usage | per-message ledger, aggregation by conversation, clear, route |
| Session reset | forget mapping, abort follow, next message creates a new session |
| Reply delivery | markdown stripping, chunking, no double-send after `lane_send`, one apology on failure, quiet empty turn |
| OneBot transport | echo correlation, access token, inbound event parsing, failed action rejection |
| SnowLuma discovery | per-account WS token/port from `onebot_*.json`, explicit settings win |
| Discord adapter | fake discord.js client: ready, DM/guild normalization, mention gate, reply metadata, mention parsing disabled |
| QQ Bot adapter | fake SDK client: ready, c2c/group normalization, bot filter, passive reply target, missing credentials |
| Client bundle | module-loader wrapper, `settings.section` registration, cleanup |
| Package manifest | host/client exports, bundle patch paths, `lane-support` preset id |
| Cordis activation | the real `@deepseek-ai/cordis` runtime activated the plugin with fake host services and disposed both routes cleanly (catches async-apply/effect mistakes that a mock ctx misses) |
| Migration | legacy config/roles/KB/sessions → new state |

What is **not** verified in this checkout (needs a live DSH + a real channel).
The reproducible first-run checklist is [guides/LIVE_TEST.en.md](./guides/LIVE_TEST.en.md).

- Loading the package through `dsh plugin add` and rendering the settings card in
  a real DSH build (the API shape is taken from the installed DSH 0.2.1-rc.3
  packages and the Discord/QQ Bot plugins).
- SnowLuma OneBot traffic (connect, inbound, outbound) on the target account.
- Official QQ Bot credentials and the passive-reply `msgId` path.
- Discord against a real bot token and gateway (the adapter is tested with a fake discord.js client).
- A full model turn inside the plugin (the tests use a fake `sessionController`
  and `sessionQuery`; the real services are only exercised by the DSH host).

Treat v0.1 as a **runnable skeleton with a complete management surface**, not as
a production support bot until the live checklist above passes.

## 11. Open questions

- Should a domain be able to own multiple channels (e.g., QQ + Discord for the
  same product)? Current model: yes, bindings point to one domain regardless of
  channel.
- Should KB drafts (AI-written, human-approved) be in v0.2? The legacy bridge has
  them; they need a review UI, which is a natural next Settings tab.
