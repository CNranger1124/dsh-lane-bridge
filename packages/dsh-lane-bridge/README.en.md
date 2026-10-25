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
- **Domains**: bind a group/private chat to a reusable policy (role card, preset,
  model, KB scopes, host-tool allow-list, group trigger policy).
- **Shared libraries**: role cards and the Markdown knowledge base are shared;
  domains choose which KB scopes they can read. Optional domain-scoped memory
  (`lane_memory_*`) accumulates cross-conversation experience.
- **KB drafts + approval**: `lane_kb_draft` writes only to `_待审/`; the Settings
  "KB approval" tab approves/discards before drafts affect retrieval.
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

## Configuration model

- **Channels** live in `state.json` (`config.channels.*`).
- **Domains** describe behavior: role card name, agent preset, optional
  `provider/model`, knowledge scopes, allowed host tools, reply limit, and
  optional `repo` / `branch` (empty inherits the global GitHub repo).
- **Bindings** attach a conversation key (`snowluma:group:123456`,
  `qqbot:private:openid`) to a domain.
- Unbound conversations are recorded but never prompt a model. Use
  `autoReplyPrivate` for an open support inbox.

## Operators (whitelist)

One group shares one DSH session, so "who is the administrator" cannot come from
the chat itself. Nicknames are ignored; the bridge only trusts the **sender id**
reported by the channel. The list lives on the **domain** as `operators`
(Settings → IM Bridge → Domains → Operators), one entry per line:

| Entry | Meaning | Where the id comes from |
| --- | --- | --- |
| `qqbot:8FD96C63927394130884C87F9F708895` | a user of the official QQ Bot | the event's `senderId` (openid, 32 hex chars, compared case-insensitively) |
| `snowluma:123456789` | a QQ number on the SnowLuma channel | `event.sender.user_id` |
| `discord:123456789012345678` | a Discord user | `message.author.id` (snowflake) |
| `123456789` | no prefix: that id on any channel | — |
| `*` | everyone is an operator (explicit opt-in to the old behavior) | — |
| empty | nobody is an operator (default) | — |

Rules that matter:

- The prefix must match the conversation key's channel (`qqbot:group:…` ↔
  `qqbot:…`). The same QQ account has different ids per channel (openid vs QQ
  number) and they do not cross-match.
- Nicknames and guild display names never participate: they are mutable and not
  unique.
- To find an id: Settings → IM Bridge → Conversations, the "recent senders"
  column lists `channel:id` per member; clicking copies it. Logs also print
  `sender=…`.
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
prompt — put it in another domain with another knowledge scope.

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
| `GET`/`POST` | `/lane-bridge/api/kb/drafts` | List / approve / discard pending drafts |
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
