[中文](LIVE_TEST.md) | **English**

# Live install / smoke checklist

## Quick install (latest by default)

> Both paths install the latest version: GitHub Release uses `latest`, npm uses the versionless command. Use GitHub Release while npm is not published.

### DSH Web

```sh
dsh plugin --profile web add dsh-lane-bridge
```

Before npm is published:

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

### DSH Desktop

Fully quit DSH Desktop first:

```sh
dsh plugin --profile desktop add dsh-lane-bridge
```

Before npm is published:

```sh
dsh plugin --profile desktop add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

This is the checklist for the first run on a real DSH installation. The
repository tests use fake host services; these steps exercise the real ones.

## 1. Install

```sh
dsh plugin --profile web add dsh-lane-bridge
```

Desktop: replace `web` with `desktop` and fully quit DSH Desktop first.

For a local checkout:

```sh
dsh plugin --profile web add link:/absolute/path/to/repo/packages/dsh-lane-bridge
```

Publishing/install details: [PUBLISHING.en.md](PUBLISHING.en.md).

Restart DSH (or let the plugin manager reload it), then open
**Settings → IM 桥接**, and open the **IM 桥接** panel from the right sidebar's
“+” menu.

Expected:

- Both entries render without a blank page.
- **会话** shows a placeholder row when there are no conversations (it must not
  crash or clear the whole UI).
- `GET /lane-bridge/api/health` returns `{ok:true}`.
- `~/.dsh/lane-bridge/state.json` exists with `version`, `config`, `domains`,
  `roles`.

If the page is blank or shows “面板渲染失败”, open the browser console: a missing
`settings.section` / `sidebarRightTabs` slot or a bundle load error is the usual
cause; the error boundary keeps the rest of the UI alive when it can.

### Starting a channel

1. The top **启动通道** card has **Start / Stop / Retry** for each channel.
2. **Start** saves and reconnects immediately. When disconnected, the row shows
   the reason: SnowLuma not running, wrong port, missing AppID/Token, etc.
3. Stopping should show **已停用**; starting again should return to
   **未连接/已连接**.

## 2. SnowLuma (QQ)

1. Start SnowLuma yourself and log in the bot account; confirm its OneBot WS is
   listening on `127.0.0.1:3001`.
2. In **IM 桥接 → 概览与通道**, either:
   - fill **SnowLuma 安装目录** (e.g. `F:/SnowLuma`) and leave the token blank
     for per-account discovery, or
   - fill the WebSocket URL and access token explicitly.
3. Click **Start** for SnowLuma in the top **启动通道** card. The channel should
   show **已连接**.
4. Send a private message to the bot from an allowed account. It appears under
   **会话** with a `snowluma:private:<id>` key.
5. Bind it to the default domain, then send another message. A DSH session
   appears in the bridge workspace; the assistant's turn is delivered back to
   QQ.

Common failures:

| Symptom | Check |
| --- | --- |
| Channel red, "连接失败" | SnowLuma WS port/token; Node 22+ has global WebSocket |
| Message appears in 会话 but no reply | Conversation is bound and `autoReply` is on; domain role/preset exists |
| Reply appears in DSH but not QQ | `lane_send` used? Check channel send error in logs |
| 401 / 403 from `/lane-bridge/api/*` | Browser same-origin check; open through the DSH URL, not a copied file |
| No `lane_*` tools in the session | Domain was bound before the plugin loaded; rebind or restart the bridge session |

## 3. Official QQ Bot

1. Create an app on the QQ Open Platform and enable the bot capabilities you
   need.
2. Fill `AppID` / `AppSecret` in the channel card and enable it.
3. Wait for **已连接** (gateway READY), then send a c2c/group message.
4. The first reply uses the inbound `msgId`; proactive pushes to c2c may be
   rejected by the platform after the passive-reply window.

## 4. Discord

1. Create a bot in the Discord Developer Portal, enable **Message Content
   Intent**, and invite it with `bot` + `applications.commands` scopes.
2. Fill the bot token in the Discord channel card and enable the channel.
3. Wait for **已连接**, then send a DM or a message in a bound guild channel.
4. Recommended: enable **群聊里必须 @ 或回复机器人才响应** so the bot is not
   triggered by every guild message.
5. For a guild, bind `discord:group:<channelId>`; for a DM, bind
   `discord:private:<userId>`.

Discord replies use `reply.messageReference` when the inbound message is fresh,
and `allowedMentions.parse` is empty so a model-generated `@everyone` cannot
ping the server.

## 5. Unified push

Browser test: **推送** tab → choose a conversation → send.

External test:

```sh
curl -X POST http://127.0.0.1:<dsh-port>/lane-bridge/api/push \
  -H "Authorization: Bearer $LANE_PUSH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"snowluma:group:123456","messages":"维护通知"}'
```

`targets` accepts an array for a broadcast (max 50).

## 6. Knowledge and role cards

- Edit a role card in **角色与知识**; the next turn of a conversation using it
  re-injects the card (the content hash changed).
- Add a Markdown file under `~/.dsh/lane-bridge/knowledge/<scope>/`; the domain
  must list that scope. The agent sees it through `lane_kb_*`.
- `_`-prefixed files/directories are private (drafts) and are not listed.
- Enable **共享记忆** on a domain and add a line in the memory editor; the next
  turn of a conversation in that domain should contain the memory. Disable it
  again to verify the prompt no longer carries it.
- Send an image in a bound conversation. With **图片理解** enabled and a vision
  model, the session request should include an image part; with a non-vision
  model the plugin falls back to text instead of failing the turn.
- After a few model turns, open **用量**: the conversation should appear with
  input/output/cache token totals. Clear it once and verify the table empties.
- Configure **接管会话** and click **转人工** on a conversation: it should show
  **人工中**, send the ack to the user, and notify the operator conversation.
  Send another user message (no auto-reply expected), then click **恢复自动回复**
  and verify the next message gets a model reply again.

### 6.1 Read-only GitHub

1. Run `gh auth login` (skip if already logged in), then in
   **概览与通道 → GitHub 仓库** click **Load repos** and pick one; click
   **Load branches** and pick a branch. You can also type `owner/repo` or a token.
2. Save and enable it; in the domain, enable **allow repository reads** and save.
3. Ask a bound conversation a question that needs the repo; the model should call
   `lane_repo_status` first, then issues/files/commits.
4. Verify `lane_repo_read_file` rejects `../`, errors never contain the token, and
   `lane_repo_create_issue` reports "not enabled" by default.

### 6.2 KB draft approval

1. Have the model learn a new fact not covered by the KB and call `lane_kb_draft`
   (title/content/source required).
2. The **知识库审批** tab should list the draft; `lane_kb_list/search/read` must
   not see it.
3. Choose a target file and click **Approve**: the document gets a new section
   with the source, and the draft disappears. **Discard** just removes the draft.
4. Confirm a backup exists under `~/.dsh/lane-bridge/kb-backups/`.

## 7. What to record if it fails

- DSH version and plugin version.
- The exact `state.json` (redact tokens) and the console error.
- `GET /lane-bridge/api/state` response (it contains no secrets).
- Whether the session is visible in DSH and whether tools appear.
