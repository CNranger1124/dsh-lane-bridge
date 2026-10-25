[中文](CHANGELOG.md) | **English**

# Changelog

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
