[中文](CHANGELOG.md) | **English**

# Changelog

## 0.6.0

- **The deposition prompts were rewritten for the current model**: the knowledge
  sections of `lane_kb_draft`, `lane_retire` and the preset persona now describe
  knowledge bases as per-topic units with their own triggers, name the bases the
  domain binds, and require "one topic per draft" plus "3–8 phrases the player
  would actually type".
- **Drafts must carry triggers**: `lane_kb_draft` gained a required `triggers`
  parameter; a draft without them is rejected with a reason (otherwise the adopted
  document could never be retrieved). Draft files now carry frontmatter
  (`title` / `triggers`) instead of a plain heading.
- **Drafts land in a base the domain binds**: the `?? 'default'` fallback is gone —
  a domain with no bound base errors out, several bound bases require an explicit
  `scope`, and an out-of-range scope is refused with the list of choices.
  `lane_retire` follows the same rule and logs skipped drafts.
- **Approval creates a document**: previously it appended to a target file
  (default `常见问题.md`) chosen in the UI; now it writes
  `knowledge/<base>/<title>.md` with frontmatter and never overwrites (duplicates
  get `-2`).
- **The approval page edits triggers**: each draft's keywords are an add/remove
  chip list and "approve" is disabled while empty; the card also shows which base
  it will be written into and which domains bind that base, with a warning when
  none do.
- **Mismatch hints on the domain/knowledge pages**: the bound-base dropdown shows a
  document count per base and flags `空库`; binding an empty base shows a warning
  that retrieval and AI drafts will both target an empty library, and the knowledge
  page shows which domains reach the selected base.
- Two real bugs fixed: same-title drafts created within the same second overwrote
  each other (now suffixed), and an empty bound base silently received drafts in
  `默认知识库`.
- Tests up to 156 (trigger validation, adopted documents match via
  `matchDocuments`, no overwrite on duplicate titles, out-of-range scope refusal,
  no target-file dropdown on the approval page).

## 0.5.2

- **The Discord card now says which credential to paste**: only the **Bot Token**
  (Developer Portal → your app → Bot page → `Reset Token`). The card explains that
  the OAuth2 client secret and the General Information public key are unused — the
  former belongs to authorization-code flows, the latter verifies HTTP
  interactions, and this adapter uses the gateway websocket. Mirrored into the
  README and LIVE_TEST.
- No behavior change; hints and docs only.

## 0.5.1

- **Rename a document from the editor**: the edit card now has a "file name" field,
  which accepts subdirectories too (`mechanics/relic.md`); saving writes to that
  location.
- **Transfer documents between knowledge bases**: the edit card gained a
  "knowledge base" dropdown. Rename and transfer are the same operation
  (`POST /api/knowledge` with `action: "move"`): the file is moved first, then the
  content is written. An existing target is **refused with a reason** instead of
  being overwritten silently; overwriting needs an explicit `force`.
- Server-side guards added: the target base must exist, paths cannot escape the
  directory, and the draft area cannot be moved into or out of.
- Tests: 154 (rename, cross-base transfer, clash refusal, traversal refusal, route
  round-trip).

## 0.5.0

- **Knowledge bases are first-class**: one subdirectory of `knowledge/` is one
  knowledge base, registered in `state.knowledgeBases` with a display name. New
  `/api/kb` endpoint (create/rename/delete): renaming moves the directory and
  repoints every domain that bound it; deleting a non-empty base requires an
  explicit `force` and unbinds it from all domains.
- **Domains bind knowledge bases**: the Domains page no longer asks for a scope
  name — it picks from a dropdown, adds with + and removes with x (same editor as
  the operator whitelist). Several can be bound, and every role in the domain then
  hits each document's own triggers.
- **Documents no longer declare domains**: the `domains` frontmatter field and the
  editor's "bound domains" checkboxes are gone. Ownership is the knowledge base a
  document lives in; leftover `domains:` lines are ignored instead of silently
  hiding documents.
- **Two dedicated pages**: "Knowledge" (pick/create/rename/delete a base, list and
  edit its documents) and "Memory" (domain dropdown + editor). The role card keeps
  only the role and its domain.
- Fixed an edge case: a domain with no bound knowledge base no longer falls back to
  "read every knowledge base"; it injects nothing (the model can still call
  `lane_kb_*`).
- Tests: 152 (base CRUD + domain rewiring, document ownership, both new pages).

## 0.4.6

- **No more one-write-per-message in full-message groups**: `touchConversation`
  used to deep-clone the whole `state.json` and atomically rewrite it for every
  inbound message. With the official QQ Bot in "receive all messages" mode that
  turned ordinary group chatter into a full file write per message. That path now
  **coalesces writes** (default: one save per second) and `flush()`es on unload;
  operator edits (config, roles, bindings) still hit the disk immediately.
- Documented where the permissions actually live: the active-message and
  "receive all messages" switches are **only on the bot's profile page in the
  mobile QQ app**, not in the open-platform web console. The console's "server IP
  allowlist" is unrelated (it only restricts who may call the API). The doc also
  states that `40034105` and "no `GROUP_MESSAGE_CREATE` in the logs" share the
  same root cause.
- Tests: 148 (coalesced writes persist once; visible after flush).

## 0.4.5

- **Fix `40034005 回复消息msg_id已过期`**: since 0.4.3 ("always attach msg_id"),
  pushes and cross-group sends also reused the conversation's stored msg_id and
  were rejected as expired replies. Sends are now split by **intent**: turn
  replies, error notices and the hand-off ack carry msg_id; the push API,
  cross-group `lane_send` and the hand-off notification are active messages and
  carry none.
- If a reply's msg_id has expired (slow model, >5 minutes) and "allow active
  messages" is on, the send is retried once as an active message and logged;
  otherwise it reports "被动回复已过期（msg_id 只有 5 分钟有效期）".
- `sendKey` / `sendToConversation` take `{ reply: boolean }`; the channel manager
  no longer guesses freshness on its own.
- 147 tests.

## 0.4.4

- **Keyword triggers now work on the official QQ Bot** — provided the bot enables
  "receive all messages" on the open platform, which makes the platform push
  `GROUP_MESSAGE_CREATE` for every group message. The previous "QQ groups only
  deliver @-messages" claim was only half true: that is the default, but full mode
  delivers everything, `msg_id` included, so replies stay passive.
- Fixed the **@ false positive** in full mode: `mentions` there contains whoever
  was @-ed, not just the bot, and the old `mentions.length > 0` check treated
  "someone @-ed a member" as "the bot was mentioned". Detection now uses
  `is_you`, the bot's own openid, or a `<@openid>` marker in the content.
- @-ing another member no longer wakes the bot, and `<@openid>` markers are
  stripped from the text so keyword matching and the model see a clean sentence.
- Inbound logs gained `event=GROUP_MESSAGE_CREATE|GROUP_AT_MESSAGE_CREATE` so you
  can tell whether full mode is active.
- The trigger-policy hint and the docs were corrected accordingly.
- 146 tests.

## 0.4.3

- **Corrects the 0.4.1 behaviour**: the bridge used to strip `msg_id` after a
  self-invented 4-minute window, which turned a valid passive reply into an active
  message and produced `40034105`. A `msg_id` is now always sent when the
  conversation has one, and the platform decides whether it is still valid.
  `passiveMinutes` is gone.
- **QQ rules taken from the official docs**: passive `msg_id` is valid for 5
  minutes with at most 5 replies per message; active messages are rate-limited at
  60 qpm (certified) / 30 qpm (uncertified) per bot, 20 qpm per relationship and
  1000/day per group. The adapter caps passive replies at 5 bubbles and logs the
  overflow.
- **Error-code translation**: `40034105` (no permission — usually not published or
  sandboxed), `40034100` (rate limit), `40034005`/`40034128` (passive reply
  expired), `40034024`, `40034101`/`40054003`, `40054002`, `40054005`, `40054007`,
  `40054010`, `40054016` all get a concrete fix hint.
- Sends without a `msg_id` (push, cross-group, never-received conversations) are
  still refused locally unless "allow active messages" is ticked.
- 145 tests.

## 0.4.2

- **Partial push failures no longer show a bare "HTTP 207"**: `POST /api/push`
  answers 207 (Multi-Status) when some targets fail, but the body had no readable
  reason while the client turned the status code into the error text. The response
  now carries `error` (`n/m 个会话发送失败：target：reason`) and the client merges
  the per-target reasons from `results`, so curl callers see it too.
- The push card explains that 207 means "partial success", not a bridge failure,
  and lists the reasons per conversation.
- 144 tests.

## 0.4.1

- **Fix "主动消息失败, 无权限"**: the official QQ Bot only allows passive replies
  (within a window after receiving a message, carrying its `msg_id`). The bridge
  used to send with a stale `msg_id`, which the platform treated as an active
  message and rejected with an opaque error. The window is now evaluated in the
  adapter (default 4 minutes, configurable) and an out-of-window send is refused
  locally with a reason instead of hitting the API.
- New `channels.qqbot.allowActive` (default off) plus "passive reply window
  (minutes)": turn it on deliberately if you really need active pushes — you still
  need the active-message permission/配额 from the QQ Open Platform.
- Permission errors now distinguish "this is an active message (needs a quota)"
  from "this passive reply has expired", and `lane_send` / the push panel surface
  that sentence verbatim.
- The window check moved from the channel manager into each adapter, so OneBot and
  Discord are unaffected (no such restriction).
- 144 tests.

## 0.4.0

- **Model is now conversation → role → domain**: a binding only picks a role card,
  the role card is bound to a domain, and the domain is infrastructure (KB scopes,
  shared memory, repo, operators, attention policy, preset/model). Domains no
  longer name a role, and the bindings table no longer offers a domain selector.
- The role card gained a "domain" selector; the domain card replaces its old role
  dropdown with a read-only "roles that use it" list, so the direction is no
  longer written backwards.
- Legacy state migrates automatically: 0.3.x's `domain.role` becomes that role
  card's `domainId`, and an old binding without a role keeps resolving through its
  `domainId` until you pick a role for it in the UI.
- Role files stay `roles/*.md` (name + body); the domain binding lives in
  `state.json` and is reconciled with the files on load, so a restart cannot reset
  roles to the first domain.
- Domain-level preset/model/triggers/operators are unchanged — they were always
  infrastructure, they just stopped being described as role attributes.
- 140 tests.

## 0.3.1

- **Knowledge retrieval is now per document, not per global keyword**: each
  Markdown file can carry frontmatter — `title`, `triggers` (its own words) and
  `always` (base documents injected every turn). Only the documents whose own
  triggers match are injected.
- Settings → Knowledge now shows each document's triggers, lets you add/remove
  them, and toggle "always inject"; saving writes the frontmatter for you.
- Frontmatter is excluded from full-text search and never appears in the body the
  model reads (`lane_kb_read` returns clean content plus structured triggers).
- Legacy documents keep working through the domain **fallback words** + full-text
  search, now labelled "legacy only" in the UI.
- The domain-level keyword list is demoted from primary mechanism to fallback.
- 136 tests.

## 0.3.0

- **Session archival (`sessionMaxTurns`, off by default)**: each domain can set a
  turn budget. When it is reached the bridge runs one internal turn asking the
  model to call the new `lane_retire`, which splits the outcome in two: facts that
  matter beyond this chat go to domain memory, product facts confirmed here
  become KB drafts (still human-approved). The DSH session is then reset, so the
  next message starts from a clean context. The archival text never reaches the
  chat; a model that ignores the instruction cannot pin the conversation — the
  wait is capped at 90 s and the reset happens anyway, with a log line saying
  nothing was sedimented.
- **Turn counting is persisted** in `state.sessions[key].turns`, and archival only
  triggers after an answered turn, so a live exchange is never interrupted.
- **Optional keyword-triggered knowledge retrieval**: enable it on the domain and
  maintain trigger words as a chip list (empty falls back to the reply keywords).
  Only a matching inbound message triggers a search, and the injected snippets are
  capped by `kbRetrieveChars` (default 1500). **The KB is never injected in full**;
  `lane_kb_*` stays available for follow-up reading. Default stays off.
- `lane_retire` only works inside the archival flow; calling it from a normal
  message is rejected, so a group member cannot talk the model into poisoning the
  shared memory.
- Memory limits are now documented: ≤500 chars per entry, ≤200 entries per domain,
  injection capped by `memoryMaxChars` (default 2000, max 8000, newest first).
- 131 tests.

## 0.2.16

- **Multi-value fields no longer rely on comma separation**: knowledge scopes,
  allowed host tools, keywords and the operator whitelist are now chip lists with
  an explicit add button and ×/− removal, so what will be saved is always visible.
- **The operator whitelist has a fixed shape**: each row is a channel enum
  dropdown (official QQ Bot / SnowLuma / Discord) + an id input + a remove
  button, with "+ Add" creating a row. "Everyone is an operator (*)" is its own
  checkbox instead of a magic string typed into a textarea. Spaces and stray
  colons are stripped from ids so nothing silently becomes invalid.
- Copying `channel:id` from the Conversations table and pasting it into the id
  field just works: a known prefix switches the dropdown and is stripped, never
  producing `qqbot:qqbot8FD9…`.
- Keywords and friends still accept a pasted comma/newline list, but they are
  **stored as discrete entries** rather than parsed from a separator later.
- 126 tests.

## 0.2.15

- **Role cards and the domain's extra instructions can branch on identity**:
  `{{#if operator}}…{{else}}…{{/if}}` (`else` optional), with `group` / `private`
  as extra conditions and `{{identity}}`, `{{sender}}`, `{{senderId}}`,
  `{{channel}}`, `{{kind}}`, `{{externalId}}`, `{{domain}}`, `{{role}}` as
  variables. No nesting, loops or expressions; a mistyped variable renders as
  nothing instead of leaking braces into the prompt.
- The prompt gained an explicit 「发言者身份：管理员／普通成员」 line next to the
  operator marker, so both template conditions and the model have a clear basis.
- Fix the cache problem this exposed: the role card is injected per `roleKey`, so
  identity flips must re-inject it or two speakers share the first one's version.
  `roleKey` now carries `admin`/`member`.
- Restating the split: templates only change wording. Authorization (issue
  creation, cross-conversation push, shared memory) stays in `tools.js` behind
  the operator whitelist; "you are an administrator" in a card unlocks nothing.
- 125 tests.

## 0.2.14

- **Operator whitelist.** A domain's `operators` decides who administers the bot.
  Entries are `channel:id` — `qqbot:8FD96C63927394130884C87F9F708895` (official QQ
  Bot openid), `snowluma:123456789` (QQ number), `discord:123456789012345678`
  (Discord user id) — or a bare id (any channel) or `*` (everyone). **Empty means
  nobody**, which is the new strict default (there was no identity check before).
- Admin-only actions: `lane_repo_create_issue`, `lane_send` to any conversation
  other than the current one, and `lane_memory_add` (shared domain memory).
  Everything else is unchanged: multi-bubble replies in the current chat,
  `lane_kb_draft` (review queue), `lane_escalate`.
- Identity is scoped to a **single inbound turn**, never to the session:
  `SessionPool.prompt()` records that turn's `senderId` and `isOperator` and the
  `lane_*` tools read it, so one member cannot inherit the previous speaker's
  rights. Nicknames are prompt text only and never used for authorization.
- On an operator's turn the prompt prefix becomes
  「本次发言者：X（本领域管理员，可执行管理操作）」; `lane_conversation_info` also
  returns `senderId` / `isOperator`.
- **New "recent senders" column** in the conversations table: each member shows
  as `channel:id`, one click copies it for the operator field.
  `conversations[key].senders` keeps the last 10 participants.
- Inbound logs print `sender=…`.
- Saving a domain validates operator ids and fails with
  「管理者 id 格式不对：…」 instead of silently dropping them.
- 116 tests.

## 0.2.13

- Fix "group @ gets no reply" on the official QQ Bot: `GROUP_AT_MESSAGE_CREATE`
  already means the bot was mentioned, but the payload carries no `mentions`
  array while the adapter checked `mentions.length > 0`, so a mention-only
  trigger policy threw the message away. Detection is now event-type based.
- Inbound logs gained `mentionsBot` / `replyToBot` / `kind` so a trigger miss is
  readable from the log.
- Documented that the official QQ Bot only delivers @-messages in groups, so
  keyword triggers there need SnowLuma.
- 108 tests.

## 0.2.12

- Fix the first message after a DSH restart always failing with
  `prompt variable "{{model}}" has no value for this assembly`: cold-resuming via
  `agents.resume` skipped the Session Controller setup, so the session had no
  model selection. `sessionController.resolveAgent()` is now preferred.
- 107 tests.

## 0.2.11

- Fix the "type it manually" option in the preset dropdown: selecting it now
  switches to the text input and keeps the previous value.

## 0.2.10

- **Agent preset is a dropdown** fed by the host's `agentPresets` registry
  (`GET /api/presets`), with name/id, default and broken markers, plus a note
  describing what the preset gives the session. Unknown ids can still be typed.
- **Push supports multiple targets**: checkboxes with select-all/clear, `targets`
  payload, per-target success/failure, 207 on partial failure.
- 106 tests.

## 0.2.9

- Trigger multi-select polish: unchecking "all messages" switches to "@ or reply",
  unchecking "off" returns to "all messages" instead of doing nothing.

## 0.2.8

- **Group attention policies are now multi-select**: "@ or reply" and "keyword"
  can be enabled together and either one wakes the bot; "all messages" and
  "off" stay exclusive. Old single-value `trigger` state migrates automatically.
- **Fix issue creation failing on unknown labels**: when the configured label
  does not exist in the repo (the default `agent` usually does not), GitHub
  returns 422 and rejects the whole issue. The bridge now retries without labels
  and reports `labelsDropped` instead of losing the bug report.
- The GitHub settings card gains a per-hour limit input and spells out that
  "allow issue creation" also needs the domain's repo switch; `lane_repo_status`
  now reports the label and limit.
- 102 tests (multi-select triggers, label fallback, settings rendering).

## 0.2.7

- The settings header now shows the **plugin version the running host actually
  loaded** (`/api/health` reports the process's real version), so "is the new
  build loaded?" is a number to read instead of a guess.
- Includes every 0.2.6 fix: the `AbortSignal` on `prompt`, the
  `sessionController.history.follow` event stream, envelope unwrapping, and the
  **DSH session** column.
- 99 tests.

## 0.2.6

- **Fix the root cause of QQ / QQ Bot / Discord messages getting only the
  apology, never a model reply**: DSH's `sessionController.prompt(request,
  signal)` requires an `AbortSignal`. The bridge omitted it, so the host threw
  `Cannot read properties of undefined (reading 'throwIfAborted')` at admission
  and the message never reached the session. Every prompt now carries a signal.
- **Fix the session event stream**: DSH moved the follower from
  `sessionQuery.follow` to `sessionController.history.follow`. The old call
  failed with `is not a function`, so turns were never collected and no reply
  could be delivered. The bridge now prefers the new API and falls back to the
  old one.
- Unwrap DSH's `{ type: 'event', event }` envelope so `turn/start`,
  `assistant/message`, and `turn/end` are recognised again; token accounting and
  replies work.
- The **Conversations** table now has a **DSH session** column showing the bound
  session id, or "not created yet", so it is obvious whether a session exists.
- 98 tests; new regressions for envelope unwrapping and the required prompt
  signal.

## 0.2.5

- If the prompt still fails after retries, clear that conversation's session
  mapping so the next message creates a fresh session instead of staying stuck
  on a broken one.
- Log the Remote code and `details.reason` for prompt failures, and surface them
  in **View logs**.

## 0.2.4

- Every module header now has an **explicit Save button** (domains, bindings,
  general, GitHub, each channel, role card, memory, knowledge), so saving no
  longer depends on the bottom bar. The domain card has Save in its title row.
- Fix a freshly created session being prompted before its inbox projection was
  active, which surfaced as `session/agent-busy` and sent only the apology
  without a model reply. The bridge now waits for projection readiness and
  retries that transient failure.
- Bridge failures (turn submission, tool registration, etc.) now appear in the
  channel **View logs** panel instead of only in the host console.
- Ignore late `disconnected` events from a replaced adapter so they cannot
  overwrite the live `connected` status.
- Test suite grows to 97.

## 0.2.3

- GitHub is now a **global default plus per-domain overrides**: each domain can
  choose its own `repo` / `branch`, so different projects and groups can point at
  different repositories. Empty fields inherit the global repo.
- **Load repos** now lists every repository visible to the GitHub account
  (`gh repo list` or paginated `/user/repos`), not just the current workspace.
  The picker is a real `select`, so a prefilled input no longer hides matches.
- Every channel card has its own **Save** button (SnowLuma / official QQ Bot /
  Discord) with explicit success and error feedback.
- Every settings module can be **collapsed/expanded** from its title row.
- Fix the GitHub `branch` setting not being applied to file reads and recent
  commits.
- Test suite grows to 95, covering domain repo overrides, repo pagination,
  channel saving, and collapsible cards.

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
- Test suite grows to 90, including the GitHub repo/branch routes.

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
