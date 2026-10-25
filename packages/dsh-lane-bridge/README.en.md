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
- **Read-only GitHub**: fixed repo, issue/file/code/commit queries; repo/branch
  dropdowns from the `gh` CLI (no manual token after `gh auth login`), token
  redaction, path guards, ETag cache. Issue creation is off by default.
- **Channel launcher**: Start/Stop/Retry and View logs per channel at the top,
  with an actionable reason when disconnected. The save bar is sticky.
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
  `provider/model`, knowledge scopes, allowed host tools, reply limit.
- **Bindings** attach a conversation key (`snowluma:group:123456`,
  `qqbot:private:openid`) to a domain.
- Unbound conversations are recorded but never prompt a model. Use
  `autoReplyPrivate` for an open support inbox.

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
