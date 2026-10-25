[English](LIVE_TEST.en.md) | **中文**

# 真实安装 / 冒烟验收清单

## 快速安装（默认最新版）

> 两种方式都安装最新版：GitHub Release 用 `latest`，npm 用无版本号命令。npm 尚未发布时请用 GitHub Release。

### DSH Web

```sh
dsh plugin --profile web add dsh-lane-bridge
```

npm 尚未发布时：

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

### DSH Desktop

先完全退出 DSH Desktop：

```sh
dsh plugin --profile desktop add dsh-lane-bridge
```

npm 尚未发布时：

```sh
dsh plugin --profile desktop add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

这是在真实 DSH 安装上第一次运行的清单。仓库测试使用 fake host services；下面这些步骤验证真实服务。

## 1. 安装

```sh
dsh plugin --profile web add dsh-lane-bridge
```

本地 checkout：

```sh
dsh plugin --profile web add link:/absolute/path/to/repo/packages/dsh-lane-bridge
```

Desktop 版把 `web` 换成 `desktop`，并先完全退出 DSH Desktop。

发布/安装细节见 [PUBLISHING.md](PUBLISHING.md)。

重启 DSH（或让插件管理器重载），然后打开 **Settings → IM 桥接**；再从右侧栏的「+」打开 **IM 桥接** 面板。

预期：

- 两个入口都正常渲染，不是空白。
- **会话** 页在没有会话时显示占位行（不会崩溃或清空整个界面）。
- `GET /lane-bridge/api/health` 返回 `{ok:true}`。
- `~/.dsh/lane-bridge/state.json` 存在，包含 `version`、`config`、`domains`、`roles`。

如果页面空白或出现「面板渲染失败」，打开浏览器 console：通常是 `settings.section` / `sidebarRightTabs` slot 不存在或 client bundle 加载失败；错误边界会尽量保留界面并显示错误信息。

### 通道启用/停用

1. 通道卡片右上角应有 **启用/停用**；点 **启用** 会立即保存并重连。
2. 未连接时卡片显示原因：SnowLuma 未启动、端口不对、缺少 AppID/Token 等。
3. 停用通道后应显示 **已停用**；重新启用后应回到 **未连接/已连接**。

## 2. SnowLuma（QQ）

1. 你自己启动 SnowLuma 并登录 bot 账号；确认 OneBot WS 监听 `127.0.0.1:3001`。
2. 在 **IM 桥接 → 概览与通道**：
   - 填 **SnowLuma 安装目录**（例如 `F:/SnowLuma`），token 留空，让插件按账号发现；或
   - 显式填 WebSocket 地址和 access token。
3. 点卡片右上角 **启用**；渠道应显示 **已连接**。
4. 用允许的账号给 bot 发私聊。它应出现在 **会话**，key 形如 `snowluma:private:<id>`。
5. 绑定到默认领域，再发一条。DSH 侧应出现一个 session，assistant 的回合会发回 QQ。

常见失败：

| 现象 | 检查 |
| --- | --- |
| 渠道红色、“连接失败” | SnowLuma WS 端口/token；Node 22+ 是否有全局 WebSocket |
| 消息出现在会话但没有回复 | 是否已绑定、`autoReply` 是否打开、领域角色/preset 是否存在 |
| 回复出现在 DSH 但没到 QQ | 是否用了 `lane_send`？看渠道发送错误日志 |
| `/lane-bridge/api/*` 401/403 | 浏览器同源检查；用 DSH 地址打开，不要用复制出来的文件 |
| session 里没有 `lane_*` 工具 | 领域是在插件加载前绑定的；重新绑定或重置会话 |

## 3. 官方 QQ Bot

1. 在 QQ 开放平台创建应用，开启需要的 bot 能力。
2. 在渠道卡片填 `AppID` / `AppSecret` 并启用。
3. 等 **已连接**（gateway READY），然后发 c2c/群消息。
4. 第一条回复使用入站 `msgId`；被动回复窗口过后，主动推送 c2c 可能被平台拒绝。

## 4. Discord

1. 在 Discord Developer Portal 创建 bot，开启 **Message Content Intent**，用 `bot` + `applications.commands` scope 邀请。
2. 在 Discord 渠道卡片填 bot token 并启用。
3. 等 **已连接**，然后发 DM 或在已绑定频道发消息。
4. 建议打开 **群聊里必须 @ 或回复机器人才响应**，避免每条服务器消息都触发。
5. 服务器频道绑 `discord:group:<channelId>`；DM 绑 `discord:private:<userId>`。

Discord 回复在入站消息较新时使用 `reply.messageReference`；`allowedMentions.parse` 为空，模型生成的 `@everyone` 不会 ping 服务器。

## 5. 统一推送

浏览器测试：**推送** 页 → 选会话 → 发送。

外部测试：

```sh
curl -X POST http://127.0.0.1:<dsh-port>/lane-bridge/api/push \
  -H "Authorization: Bearer $LANE_PUSH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"snowluma:group:123456","messages":"维护通知"}'
```

`targets` 可以传数组做广播（最多 50 个）。

## 6. 知识库与角色卡

- 在 **角色与知识** 编辑角色卡；使用它的会话下一轮会重新注入（内容 hash 变了）。
- 在 `~/.dsh/lane-bridge/knowledge/<scope>/` 下加 Markdown；领域必须列出该 scope。agent 通过 `lane_kb_*` 读取。
- `_` 前缀的文件/目录是私有草稿，不会被列出。
- 打开领域的 **共享记忆** 并写入一行；该领域下会话的下一轮 prompt 应包含这条记忆。关掉它再验证 prompt 不再带。
- 在已绑定会话发一张图片。开启 **图片理解** 且模型支持视觉时，session 请求应包含 image part；非视觉模型会降级为文本，而不是让回合失败。
- 几轮模型回合后打开 **用量**：会话应出现 input/output/cache token 统计。清空一次，表格应归零。
- 配置 **接管会话**，在会话上点 **转人工**：应显示 **人工中**，给用户发提示，并通知接管会话。再发用户消息（预期不自动回复），然后点 **恢复自动回复**，验证下一条消息重新有模型回复。

### 6.1 GitHub 仓库只读

1. 在 **概览与通道 → GitHub 仓库** 填 `owner/repo`、可选 token、保存并勾选启用。
2. 在领域里勾选 **允许读取仓库**，保存。
3. 在已绑定会话问一个需要查仓库的问题；模型应先调 `lane_repo_status`，再查 issue/文件/提交。
4. 验证 `lane_repo_read_file` 不能读 `../`，错误里不出现 token；`lane_repo_create_issue` 默认报“未开启”。

### 6.2 知识库草稿审批

1. 让模型查到一个知识库没有覆盖的新结论，调用 `lane_kb_draft`（title/content/source 必填）。
2. **知识库审批** 页应出现草稿；`lane_kb_list/search/read` 不应看到它。
3. 选目标文件点 **采纳**：正式文档应追加小节并保留来源，草稿消失；点 **丢弃** 则只删除草稿。
4. 确认 `~/.dsh/lane-bridge/kb-backups/` 有采纳前备份。

## 7. 失败时记录什么

- DSH 版本和插件版本。
- 完整的 `state.json`（把 token 涂掉）和 console 错误。
- `GET /lane-bridge/api/state` 的响应（不含密钥）。
- session 在 DSH 里是否可见、工具是否出现。
