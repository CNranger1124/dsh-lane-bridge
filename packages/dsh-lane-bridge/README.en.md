[中文](README.md) | **English**

# dsh-lane-bridge

DeepSeek Harness plugin for chat / customer-support bots across QQ (SnowLuma
OneBot v11), the official QQ Bot, and Discord.

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

**Only seeing "not connected / stopped"?** Start SnowLuma first (double-click
`launcher.bat` in its folder, or run `node index.mjs` there and wait for
`127.0.0.1:3001` in its log), then click **Enable** on its card. The plugin does
not start SnowLuma for you. For official QQ Bot / Discord, fill the credentials
and click **Enable** the same way.

Local development:

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

## Features

- **One plugin**: channels, domain routing, role cards, knowledge, and push live
  together. No second server or console token.
- **One DSH session per conversation**: transcripts, tools, and token usage are
  visible in the normal DSH UI.
- **Domains**: bind a group/private chat to a reusable policy (preset, model,
  **bound knowledge bases**, host-tool allow-list, group trigger policy).
- **Shared libraries**: role cards and the Markdown knowledge bases are shared; a
  domain binds *several* knowledge bases, and every document inside them is
  reachable by its own triggers. Optional domain-scoped memory
  (`lane_memory_*`) accumulates cross-conversation experience.
- **KB drafts + approval**: `lane_kb_draft` writes a **single-topic draft**
  (title + triggers + body + source) into the review queue of a knowledge base the
  domain binds; the "KB approval" tab lets you correct the triggers, and approving
  creates a real document with them (no overwrite: duplicates get a suffix).
- **Read-only GitHub**: global default repo with per-domain repo/branch
  overrides; issue/file/code/commit queries; repo/branch dropdowns list every
  repo visible to the account via the `gh` CLI (no manual token after
  `gh auth login`), token redaction, path guards, ETag cache. Issue creation is
  off by default.
- **Channel launcher**: Start/Stop/Retry and View logs per channel at the top,
  with an actionable reason when disconnected. Every module header has its own
  Save button, every module collapses, and the save bar is sticky.
- **Unified push**: `lane_send` tool + `POST /lane-bridge/api/push` (single or broadcast).
- **Images**: inbound attachments are downloaded with SSRF/byte caps and sent as
  multimodal prompt parts; non-vision models fall back to text.
- **Human handoff**: `lane_escalate` pauses a conversation, notifies the
  configured operator conversation, and can be resumed from Settings.
- **Token usage**: a local per-conversation token ledger and a Usage tab.
- **Chat-friendly batching**: a short per-conversation debounce merges message bursts
  into one prompt (configurable, `0` disables).

## Model: conversation → role → domain

Three layers, in one direction:

```text
conversation (one group / one private chat)
  └─ picks a role card
       └─ the role is bound to a domain
            └─ the domain is infrastructure: bound knowledge bases, shared memory,
               repo, operators, attention policy, preset/model
```

- **A conversation only picks a role.** There is no domain selector on a
  binding — swapping the role swaps the knowledge base, memory and policy with it.
- **A role card = persona text + domain.** "Domains" on the Roles page decides
  which infrastructure the role uses.
- **Domains never name a role**; they describe infrastructure only.
- One domain can host several roles (same knowledge, different personas); a role
  belongs to exactly one domain.
- Unbound conversations are recorded but never prompt a model.
- Legacy state: 0.3.x's `domain.role` and `binding.domainId` are migrated to
  "role → domain" on load, so nothing needs reconfiguring.

## Operators (whitelist)

One group shares one DSH session, so "who is the administrator" cannot come from
the chat itself. Nicknames are ignored; the bridge only trusts the **sender id**
reported by the channel. The list lives on the **domain** as `operators`
(Settings → IM Bridge → Domains → Operators).

**The UI never asks you to type the format**: each administrator is a row of
"channel dropdown + id input + add/remove".

```text
Operators
[Official QQ Bot ▾] [openid, e.g. 8FD96C63…]  [+ Add]

  [Official QQ Bot ▾]  8FD96C63927394130884C87F9F708895   [−]
  [Discord         ▾]  123456789012345678                 [−]
[ ] Everyone is an operator (*)

stored as: operators: ["qqbot:8FD96C63…", "discord:123456789012345678"]
```

The channel enum is fixed at `qqbot`, `snowluma`, `discord`; only the id half is
typed, so the prefix is never a typing error.

| UI choice | Stored value | Where the id comes from |
| --- | --- | --- |
| Official QQ Bot | `qqbot:8FD96C63927394130884C87F9F708895` | the event's `senderId` (openid, 32 hex chars, compared case-insensitively) |
| SnowLuma | `snowluma:123456789` | `event.sender.user_id` (QQ number) |
| Discord | `discord:123456789012345678` | `message.author.id` (snowflake) |
| legacy bare id | `123456789` | that id on any channel |
| "everyone" checkbox | `*` | explicit opt-in, avoid in public groups |
| empty list | — | nobody is an operator (default) |

Rules that matter:

- The prefix must match the conversation key's channel (`qqbot:group:…` ↔
  `qqbot:…`). The same QQ account has different ids per channel (openid vs QQ
  number) and they do not cross-match.
- Nicknames and guild display names never participate: they are mutable and not
  unique.
- To find an id: Settings → IM Bridge → Conversations, the "recent senders"
  column lists `channel:id` per member; clicking copies it. Pasting it into the
  id field is enough — a known prefix is detected and switches the dropdown
  instead of producing `qqbot:qqbot…`. Logs also print `sender=…`.
- The whitelist is **per domain** and shared by every binding on that domain.
  Different admins per group means different domains.
- Only whitelisted members may: create issues (`lane_repo_create_issue`), push
  into another conversation (`lane_send` with a foreign target), write shared
  domain memory (`lane_memory_add`).
- Everyone else can still: split a reply into several bubbles in the current
  chat, draft knowledge-base entries (review queue only), and escalate to a
  human (`lane_escalate`).
- On an operator's turn the prompt carries
  "本次发言者：X（本领域管理员，可执行管理操作）" so the model knows.

## Different wording per identity (templates)

Role cards and the domain's extra instructions accept two tiny constructs so the
same card can say different things to an administrator and to a member:

```md
## Permissions
{{#if operator}}
This speaker is an administrator: internal roadmaps, repo branches and config
are fair game; creating an issue is allowed.
{{else}}
This speaker is an ordinary member: no internal details, no schedule promises;
gather the facts and escalate with lane_escalate.
{{/if}}

Identity: {{identity}} | from: {{kind}} | channel: {{channel}}
```

- Variables: `{{identity}}` (管理员/普通成员), `{{sender}}`, `{{senderId}}`,
  `{{channel}}`, `{{kind}}`, `{{externalId}}`, `{{domain}}`, `{{role}}`.
- Conditions: `operator`, `group`, `private`, written as
  `{{#if cond}}A{{else}}B{{/if}}`; `else` is optional (nothing renders when the
  condition is false).
- No nesting, loops or expressions — a role card is prose. A mistyped variable
  renders as nothing instead of leaking `{{…}}` into the prompt.
- Re-rendered on every turn; the role card is re-injected when the speaker flips
  between administrator and member, so one person's version never sticks.

**Keep the two layers apart**:

| | Mechanism | Strength |
| --- | --- | --- |
| "may this happen" | domain operator whitelist + `repoEnabled` / `kbDraftEnabled`, enforced in `lane_*` tools | hard, prompt injection cannot override |
| "how should it be phrased" | `{{#if operator}}` in the role card / domain prompt | soft, the model can be talked around |

If ordinary members must not obtain some information at all, do not rely on the
prompt — put it in another knowledge base and let only that domain bind it.

## Context budget: archival, memory length, knowledge retrieval

Three different things reach the prompt in three different ways:

| What | How it enters | Cap |
| --- | --- | --- |
| Role card + domain extra instructions | injected when the session is created; re-injected when the speaker identity flips | role card 8000 chars |
| Domain shared memory | **injected in full** when `memoryEnabled`, newest first | `memoryMaxChars` 200–8000, default 2000 |
| Knowledge base | **never injected by default**; only when the model calls `lane_kb_*` | per-call limits |
| KB auto retrieval | when enabled, a document is injected only if the inbound text matches **that document's own triggers** | `kbRetrieveChars` 200–8000, default 1500 |

In other words: only memory is injected wholesale. The knowledge base is never
sent in full — the default behaviour already matches what you want.

### How knowledge bases, domains, and roles fit together

```
knowledge bases (a directory each, many)  <-- domain "bound knowledge bases"
                                                    ^
                                          role card picks its domain
                                                    ^
                                             conversation / group / DM
```

- A **knowledge base** is a container: `knowledge/<name>/`, one subdirectory, each
  Markdown file carrying its own triggers. Create / rename / delete it on the
  "Knowledge" page; renaming also moves the directory and repoints every domain
  that bound it.
- A **domain** binds **several** knowledge bases (Domains page → bound knowledge
  bases, picked from a dropdown instead of typing a folder name). Once bound, any
  role in that domain can hit the triggers of every document inside them.
- **Documents no longer carry a `domains` list**: the knowledge base they live in
  is their owner. A leftover `domains:` line in an old file is ignored.
- In the editor you can **rename a document** (subdirectories allowed, e.g.
  `mechanics/relic.md`) and **transfer it to another knowledge base**: change
  "knowledge base" + "file name" and save. The file is moved first, then written;
  an existing target is refused rather than overwritten.
- Binding nothing means the domain injects **no** knowledge automatically (it does
  not fall back to "everything"). The model can still call `lane_kb_*`.
- **Memory** is domain-scoped too and has its own page; the knowledge base wins on
  conflicts.

### A knowledge document is a unit with its own triggers

The knowledge base is not one blob of text scanned as a whole: each document is a
self-contained unit, like a skill, carrying its own trigger words in frontmatter:

```md
---
title: Save location
triggers: 存档, 存档在哪, save
---

# Save location

Windows: %APPDATA%/Game/save. macOS: ~/Library/Application Support/Game.
```

- A document is injected only when the inbound message matches **its** triggers —
  a hit in "save.md" does not drag "multiplayer.md" along.
- `title` is used in the list and as the injected heading; omit it and the first
  `# heading` (then the file name) is used instead.
- `always: true` documents are injected on every turn — useful for a product
  overview, but they do consume context every time.
- Frontmatter is not part of full-text search and never shows up in the body the
  model reads; the Settings → Knowledge page lets you add/remove triggers per
  document without writing YAML.
- Documents without frontmatter still work through the domain's **fallback
  trigger words** plus full-text search (labelled "legacy only" in the UI).
- `kbRetrieveChars` caps one injection; multiple matches are ordered by number of
  matched triggers, then trigger length.

### How AI sediment becomes a document

`lane_kb_draft` does not append a section to one big file. It writes a
**standalone, single-topic** draft:

```md
---
title: 宝具不生效
triggers: 宝具不生效, 宝具没用, 宝具机制, 图鉴
---

# 宝具不生效

> 来源：commit f179be46
> 起草：2026-10-25T14:30:00.000Z（客服 AI 生成，待人工审核；未采纳前不参与检索）

宝具槽位需要在装备界面点「装备」才会生效；只放进背包不算。
```

- **Triggers are mandatory**: a draft without them is rejected (the tool returns
  the reason), because the adopted document would never be retrieved. The
  approval page edits them as chips, and "approve" stays disabled while empty.
- **It lands in a knowledge base the domain binds**: with exactly one bound,
  `scope` may be omitted; with several the model must name one, otherwise the
  tool refuses and lists the choices. A domain with no bound base gets an error
  instead of silently writing somewhere else.
- **Approval creates a document**: `knowledge/<base>/<title>.md` with frontmatter —
  it does not append to `常见问题.md` and never overwrites (duplicates become
  `title-2.md`).
- `_待审/` is invisible to retrieval and to the model; discarding deletes it.

### Session archival (`sessionMaxTurns`)

`0` disables it (default). With N:

1. Every answered turn increments `state.sessions[key].turns` (persisted, survives restarts).
2. At N the bridge starts an **internal archival turn**: the model is asked to
   call `lane_retire` and split what matters into
   - `memory`: facts needed beyond this conversation → domain memory;
   - `kb`: product facts confirmed here and not covered yet → a KB **draft**,
     one topic per draft, **with triggers and a knowledge base** (still requires
     human approval).
3. The DSH session is then reset; the next message starts clean, with the freshly
   written memory and KB matches.

Boundaries:

- The archival turn's text **never reaches the chat** (replies are suppressed while
  `isRetiring`).
- A model that ignores the instruction cannot pin the conversation: the wait is
  capped at 90 s and the reset happens anyway (the log says
  `归档回合未沉淀任何内容`).
- Archival runs only after an answered turn; it never interrupts a live exchange.
- Each archival costs one extra model call. Very small N (5) makes both cost and
  the "memory wipe" feeling obvious; 30–80 is the sane range for support.

### Memory length

- One entry ≤500 chars, ≤200 entries per domain; injection takes the newest
  entries until `memoryMaxChars` (default 2000, max 8000) is reached and drops the
  rest.
- 8000 Chinese chars ≈ 4k tokens; unless you keep long checklists, 2000–3000 is
  the better trade.

## Official QQ Bot: passive reply vs active message

The same endpoint (`/v2/groups/{group_openid}/messages`) carries both kinds, and
the only difference is whether `msg_id` is present.

| | Passive reply | Active message |
| --- | --- | --- |
| Request | includes `msg_id` (+ incrementing `msg_seq`) | no `msg_id` |
| Validity | `msg_id` valid for **5 minutes**, **≤5 replies** per message | no such window |
| Permission | none beyond being in the group | the bot must be able to send proactively |
| Rate limit | — | **60 qpm (certified) / 30 qpm (uncertified)** per bot, **20 qpm** per relationship, **1000/day per group** |

Common error codes (from the official send-message docs):

| Code | Meaning | Fix |
| --- | --- | --- |
| `40034105` | active message failed, no permission | the bot cannot send proactively: **not published / still sandboxed**, or the switch is off (it lives on the bot's profile page in the **mobile QQ app**, not in the web console) |
| `40034100` | active message rate-limited | 60/30 qpm, 20 qpm, 1000/day |
| `40034005` / `40034128` | msg_id expired / reply count exceeded | reply within 5 minutes, ≤5 times |
| `40034024` | msg_id invalid or not yours | that message does not belong to this bot |
| `40034101` / `40054003` | bot is not a group member | add the bot to the group |
| `40054005` | message deduplicated | `msg_seq` must increment for the same `msg_id` |
| `40054002` / `40054007` / `40054010` | muted / too long / URL not allowed | follow the hint |

What the bridge does:

- **A `msg_id` is only attached for an actual reply**: turn replies, error
  notices and the hand-off ack are replies; the push API, cross-group `lane_send`
  and the hand-off notification are **active messages** and never reuse the
  conversation's stored `msg_id` — reusing it is what produced
  `40034005 回复消息msg_id已过期`.
- Passive replies are capped at **5 bubbles**; the overflow is dropped with a log
  line (platform hard limit).
- If a reply's `msg_id` expired while "allow active messages" is on, the send is
  retried once as an active message (logged); otherwise the expiry is surfaced.
- Sends **without** a `msg_id` (push, cross-group relay, a conversation that never
  received anything) are refused locally with a reason; tick "allow active
  messages" in Settings → IM Bridge → Official QQ Bot when you really need them.
- Platform errors are translated into the fixes above, visible in `lane_send` and
  the push panel.

For reliable unprompted announcements, either publish the bot and confirm active
messages work, or use the SnowLuma channel — OneBot has no such restriction.

### These permissions only exist in the mobile QQ app

`40034105 主动消息失败, 无权限` and "no `GROUP_MESSAGE_CREATE`" share one cause: **the
switches are not in the open-platform web console — they live on the bot's profile
page inside the mobile QQ app.**

- Mobile QQ → open the chat with the bot, or the bot's card in the group → bot
  profile → turn on switches such as "receive bot pushes";
- the console's "event subscription & callback" page **does not** offer these, so not
  finding them there is expected; the "server IP allowlist" on that page is
  unrelated — it only restricts who may call the API (empty means everyone), and
  filling it in wrong starts breaking sends;
- no plugin restart is needed — the next send or the next group message uses it;
- how to verify: have someone post a keyword **without @-ing the bot**; an
  `event=GROUP_MESSAGE_CREATE` log line means full mode is live, and pushes no
  longer returning `40034105` mean active messages are live.

### Keyword triggers need "receive all messages"

The official QQ Bot pushes one of two group events:

| Event | When it fires | What `mentions` means |
| --- | --- | --- |
| `GROUP_AT_MESSAGE_CREATE` | only when the bot is @-ed | excludes the bot (the event itself *is* the mention) |
| `GROUP_MESSAGE_CREATE` | every group message, once the bot enables **"receive all messages"** | **everyone** who was @-ed, not only the bot |

So:

- answering only when @-ed → the default works as-is;
- making keyword triggers work in a QQ group → enable "receive all messages" on the
  bot's profile page in the **mobile QQ app** (the web console has no such switch),
  and tick "keyword" in the domain's trigger policy;
- with full mode on, every group message arrives; the bridge decides "was the bot
  mentioned" by its **own openid** (someone else's @ does not count) and strips
  `<@openid>` markers before keyword matching;
- `event=GROUP_MESSAGE_CREATE` in the log is the proof that full mode is active.

## Migrating from `qq-bridge`

```sh
node scripts/migrate-from-qq-bridge.mjs --from /path/to/external/qq-bridge --data-dir ~/.dsh/lane-bridge
```

Add `--dry-run` to inspect the summary, `--force` to overwrite an existing
`state.json`. `--from` points at an external legacy checkout; this repository does not include the legacy source. The migration copies role cards and knowledge, maps legacy
`allow.private` / `allow.groups` / `support.conversations` to bindings, and
rewrites session ids to the `snowluma:` conversation keys. It does **not** start
SnowLuma.

## Security defaults

- The default `lane-support` preset registers no built-in tools.
- Every conversation's agent gets `lane_send` / `lane_kb_*` / `lane_kb_draft` /
  `lane_repo_*` and a `tools.restrict({ allow: allowedHostTools })` mask; the
  default allow-list is empty.
- KB tools read the official tree only; drafts write only to `_待审/` and are
  excluded from retrieval. GitHub is off per domain unless enabled.
- Issue creation, cross-conversation push, and shared-memory writes are limited
  to the domain's operator whitelist; the whitelist defaults to empty (nobody).
- Secrets are never returned to the browser; the UI only displays presence.
- Browser writes require a same-origin request; external push requires the
  configured bearer token.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/lane-bridge/api/state` | Redacted state + channel status (same-origin) |
| `POST` | `/lane-bridge/api/config` | Merge channel/general config |
| `POST` | `/lane-bridge/api/domains` | Replace domains |
| `POST` | `/lane-bridge/api/roles` | Replace role cards |
| `POST` | `/lane-bridge/api/bindings` | Replace bindings |
| `POST` | `/lane-bridge/api/push` | Send to one `target` or many `targets` (bearer token or same-origin) |
| `POST` | `/lane-bridge/api/session/reset` | Forget a conversation's DSH session (next message starts fresh) |
| `POST` | `/lane-bridge/api/channels/restart` | Reconnect adapters |
| `GET`/`POST` | `/lane-bridge/api/knowledge` | List / write KB documents |
| `GET`/`POST` | `/lane-bridge/api/kb/drafts` | List / approve / discard pending drafts; approve takes `{action:'approve', scope, file, triggers:[...]}` and creates a new document with those triggers |
| `GET`/`POST` | `/lane-bridge/api/memory` | Read / replace / clear domain memory |
| `POST` | `/lane-bridge/api/handoff` | pause / escalate / resume a conversation |
| `GET`/`POST` | `/lane-bridge/api/usage` | read / clear the local token ledger |

## Status

The QQ / official QQ Bot / Discord adapters and the management surface are in
place. The legacy simulation/sticker/voice/**cost-conversion** features are not
ported yet; the token usage ledger is included. See the repository's
`docs/IM_BRIDGE_ARCHITECTURE.en.md` for the design and live-verification
checklist.

The code and tests are complete, but live DSH installation and real channel
traffic are not verified yet.

## Credits

Derived from `qq-bridge` by Derpyu520 and contributors (MIT). See
[NOTICE](NOTICE).

## License

MIT. Chinese reference translation: [LICENSE.zh.md](LICENSE.zh.md); the English text prevails.
