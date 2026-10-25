[English](IM_BRIDGE_ARCHITECTURE.en.md) | **中文**

# IM Bridge 架构（DSH 插件）

> 状态：方案 + v0.2 实现说明。
> 读者：维护者、未来贡献者、安装前想评估这个插件的人。

## 1. 决策：DSH 原生插件，不做独立前端

**我们把它做成一个带原生 Settings 卡片和右侧栏面板的 DSH 插件。**

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 独立 Web 控制台（像旧的 `launcher/` 跑在 3210） | 不做，只保留一次性迁移/诊断脚本 | 重复实现登录、CSRF、主题、i18n 和部署；用户还要记住第二个 URL。它唯一不可替代的价值是启动 DSH 不该拥有的进程（SnowLuma），而这仍应由用户自己操作。仓库只提供迁移脚本，不提供第二个控制台。 |
| 只有 Host 的 DSH 插件 + `/lane-bridge/` 独立静态页 | 只适合过渡 | 实现快，但像 iframe 产品：没有共享的设置外壳、语言和主题，两套视觉语言。 |
| DSH Host 插件 + 原生 client Settings section + 右侧栏 tab | **采用** | 一次安装、一套鉴权、一套生命周期、一套外观。DSH 已经提供 `settings.section`、`sidebarRightTabs`、`sidebar.right.pane.tab` 和带鉴权的 HTTP 路由；设置页负责完整配置，侧栏负责日常会话管理。 |

插件仍然暴露 HTTP API（`/lane-bridge/api/*`），因为浏览器卡片和外部“推送”调用方需要一个稳定边界。这个 API 是传输层，不是第二个产品界面。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| **Channel / 渠道** | 一个传输账号：`snowluma`（OneBot v11）、`qqbot`（官方 QQ Bot），以及 `discord`。 |
| **Conversation / 会话** | 渠道看到的一个聊天线程：群或私聊。Key：`<channel>:<group|private>:<externalId>`。 |
| **Domain / 领域** | 可复用的行为：角色卡、agent preset、模型、知识库 scope、宿主工具白名单、群聊触发策略（all/mention/keyword/off）、回复策略、可选的 GitHub 仓库/分支覆盖。可以理解为“租户”或“产品线”。 |
| **Binding / 绑定** | 会话 → 领域（可选按会话覆盖角色/preset/模型）。没有绑定的会话会被 *发现*，但不会调用模型。 |
| **Role card / 角色卡** | 共享角色库里的 Markdown 人格。领域和绑定按名字引用。 |
| **Knowledge base / 知识库** | 共享 Markdown 目录树（`knowledge/<scope>/...`），由 `lane_kb_*` 工具读取。领域选择 scope。 |
| **Domain memory / 领域记忆** | 可选的共享笔记（`memories/<domainId>.json`），由 `lane_memory_*` 读写；按时间顺序注入 prompt，有长度上限。 |
| **Session** | 与一个外部会话 1:1 映射的 DSH session。 |
| **Push / 推送** | 操作者主动发往任意已绑定会话的消息（HTTP + agent 工具）。 |

### 领域解析顺序

```
binding 覆盖（role / preset / model）
  → 绑定的 domain
  → 全局默认 domain
  → 硬编码默认值
```

没有 binding 时，插件把会话记录为“已发现”，不触发 agent。这是成本/安全默认值；操作者可以显式绑定（或为客服收件箱打开 `autoReplyPrivate`）。

## 3. 运行时形态

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
                                     │            ├─ follow() 事件流
                                     │            └─ 按 agent 的工具/限制
                                     ▼
                              ReplyDispatcher ──► ChannelAdapter.send()
                                     ▲
                              lane_send 工具 / push API
```

### 渠道适配器契约

```js
adapter.start()                       // 连接；不能阻塞插件激活
adapter.stop()                        // 幂等
adapter.send(conversation, messages)  // string[]；适配器负责分条
adapter.status()                      // { connected, selfId, lastError, lastEventAt }
adapter.onMessage(cb)                 // cb({ channel, kind, externalId, senderId,
                                      //      senderName, text, images, raw })
```

适配器只负责传输，不碰 DSH session、角色卡或 store。

### 为什么一个外部会话一个 DSH session？

- 转录在 DSH 侧栏可见，工具和审批也都在。
- DSH 的压缩、模型选择和 token 统计按 session 工作。
- 重置/删除一个会话不会影响其他会话。

插件把 `sessionId` 存在自己的 state 里；DSH 重启后由 `sessionController.prompt` 冷恢复。

### 按 agent 的工具面

插件把工具注册在 `agent.ctx`，不是全局：

- `lane_send`（发给当前或指定会话）
- `lane_conversation_info`
- `lane_kb_list` / `lane_kb_read` / `lane_kb_search`
- `lane_memory_read` / `lane_memory_add`
- `lane_escalate`

然后调用 `agent.ctx.tools.restrict({ allow: domain.allowedHostTools })` 隐藏继承来的宿主工具（bash、fs、subagent、plugin manager……）。默认白名单为空：客服 agent 只能聊天、读知识库、推送，别的都没有。领域可以显式放行只读宿主工具，例如 `web_search`。

这比旧桥接的 preset 级守卫更严格：限制挂在**具体会话的 agent** 上，新 preset 或新 DSH 版本不能悄悄扩大能力面。

## 4. 数据模型

默认都在 `$DSH_HOME/lane-bridge/` 下（可用插件行的 `dataDir` 覆盖）：

```text
lane-bridge/
├── state.json          # config、domains、bindings、conversations、sessions
├── roles/
│   ├── 客服.md
│   └── ...
├── knowledge/
│   └── <scope>/*.md
├── memories/
│   └── <domainId>.json
├── usage.jsonl         # Token 用量账本
└── logs/               # 可选
```

`state.json` 是运行时配置的唯一事实源。写入是原子的（临时文件 + rename）并且串行化。Settings 卡片读到的是**脱敏投影**：密钥只返回“是否已配置”，不会返回明文。

为什么不把所有东西都塞进 DSH profile YAML？因为绑定变化频繁、以外部 id 为 key，而且不应该触发插件 remount。DSH settings 适合启动值（数据目录、默认 preset）；运行模型是插件自己拥有的文档，类似数据库。

## 5. 入站 → 回复流程

1. 适配器归一化消息，调用 `router.handleInbound`。
2. Router 找 binding，并应用领域触发策略（`all`/`mention`/`keyword`/`off`）。没有 binding 或未命中：记录会话，停止，不调用模型。
   然后按会话做短 debounce（默认 800ms），把连续消息合成一次 prompt。
3. `SessionPool.ensure(key)` 恢复/创建 DSH session，应用领域 model/preset，注册 scoped 工具，并在新会话上启动 `sessionQuery.follow`。
4. 消息前面加一段紧凑的上下文头；首次回合或角色变化时加完整角色卡。
5. `sessionController.prompt` 接收回合。
6. follow 循环收集 `assistant/message` 文本，直到 `turn/end`。
7. 如果这一轮 `lane_send` 成功过，收集到的文本**不会**再自动发送（agent 已经自己选了气泡）。否则最终文本按上限拆分，由适配器发出。
8. 错误只回一句简短道歉，绝不在聊天里发堆栈。

“agent 已经发过”的抑制很重要：没有它，一个用 `lane_send` 发了三条短气泡的客服，还会把拼接后的 assistant 文本当第四条泄露出去。

## 6. 统一推送

两个入口，一套实现：

- Agent 工具 `lane_send({ target?, targets?, messages })`。
- `POST /lane-bridge/api/push`，外部系统用 `Authorization: Bearer <pushToken>`，浏览器测试按钮用同源请求。

目标解析顺序：显式会话 key → 精确 binding 名字 → 当前会话（仅工具）。工具/API 可以接收列表做广播。广播只允许已绑定会话；未绑定 key 直接拒绝。每次推送都会记录来源（`agent` / `api`）、目标和结果。限流目前未实现，属于后续工作。

## 7. 安全基线

- **绑定优先**：未绑定会话绝不进入模型。
- **默认没有继承工具**：每个 agent 用 `tools.restrict`。
- **密钥**：存在 `state.json`，尽力设为 0600，永不返回浏览器；UI 只显示“已配置”。
- **路由**：浏览器写操作做同源检查；外部推送使用独立 bearer token；默认假设只监听回环地址。
- **模型不能任意读文件**：知识库工具只能在 `knowledge/` 内解析，拒绝 `..`、绝对路径和非 `.md/.txt`。
- **不控制厂商进程**：插件绝不启动/停止 SnowLuma 或其他厂商原生组件。那是用户动作（通常也是 EULA 条款）。
- **Prompt injection**：外部文本不可信；persona 要求 agent 把用户消息当数据，工具面尽量小。
- **图片**：只允许公网 http(s)、逐跳校验重定向、限制类型和字节数，避免 SSRF 和超大响应。

## 8. 从 `qq-bridge` 迁移

旧的独立 `qq-bridge` 源码**不在本仓库**。迁移脚本可以读取一个外部的旧项目目录。迁移顺序：

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 插件骨架、store、领域/绑定路由、Settings 卡片、push API、会话重置 | v0.1 |
| M2 | SnowLuma 适配器 + 会话编排 + 自动回复 | v0.1 |
| M3 | 官方 QQ Bot 适配器 | v0.1（实验性） |
| M4 | 知识库工具 + 角色库 + 按 agent 限制 | v0.1 |
| M5 | Discord 适配器（`discord.js`；私聊/频道 + mention gate） | v0.1 基础 |
| M6 | GitHub 只读 + 知识库草稿/审批 + 侧栏 | v0.2 |
| M6 | 费用折算、表情包、语音、黑话、仿真调度器 | 后续 |
| M7 | `config.json`/`roles/`/`knowledge/`/`state/sessions.json` 一键迁移 | 脚本已有，UI 后续 |

首版**刻意不迁**：一代/二代仿真调度器、表情包收藏、语音发送、黑话学习。它们依赖长期自治循环，不适合“客服收件箱”模型，应该以后作为独立的领域策略重建。

## 9. 安装与升级

```sh
dsh plugin --profile web add dsh-lane-bridge
dsh plugin --profile web add dsh-lane-bridge
```

发布包声明了两个 patch 文件，插入：

- `dsh-lane-bridge` host 行（带 `inject` services）；
- `lane-support` agent preset 行（persona，无内置工具）。

没有第二个进程、没有端口、没有控制台 token。升级插件不会碰 `state.json`、角色或知识库。发布/安装细节见 [guides/PUBLISHING.md](./guides/PUBLISHING.md)。

## 10. 验证状态

仓库当前验证的内容（`npm test`，88 个测试）：

| 区域 | 证据 |
| --- | --- |
| State store | 原子写、schema 修复、密钥保留、角色文件对账 |
| 领域/绑定 resolver | 未绑定默认、按绑定覆盖、禁用绑定、按领域触发策略 |
| 知识库工具 | scope 隔离、草稿隐藏、路径穿越拒绝、搜索 |
| 知识库草稿 | 只写 `_待审`、不参与 list/search/read、去重/限流、采纳追加+备份、丢弃 |
| GitHub 只读 | 固定仓库/路径、token 脱敏、issue/文件/提交、401 重试、代码搜索需鉴权 |
| HTTP 边界 | 同源写、密钥脱敏、bearer push、参数校验错误 |
| 会话编排 | 新建 session、冷 `agents.resume` setup、角色卡首次/再次注入、回合收集、`lane_send` 抑制 |
| 广播 | `lane_send` 发往多个已绑定会话，拒绝未绑定 |
| 入站 debounce | 消息合并、动态延迟、0=立即、stop 清理 timer |
| 领域记忆 | append/dedupe/render/replace/clear、损坏文件备份、prompt 注入、领域隔离 |
| 入站图片 | 公网/重定向/类型/字节校验；多模态 content；纯文本降级 |
| 人工接管 | 暂停 binding、通知接管人、提示、恢复、路由鉴权 |
| Token 用量 | 逐消息账本、按会话聚合、清空、路由 |
| 会话重置 | 清除映射、中止 follow、下一条消息新建 session |
| 回复分发 | Markdown 清理、分条、`lane_send` 后不重复、失败一句道歉、空回合静默 |
| OneBot 传输 | echo 关联、access token、入站事件解析、失败动作拒绝 |
| SnowLuma 发现 | 从 `onebot_*.json` 读 per-account WS token/端口，显式配置优先 |
| Discord 适配器 | fake discord.js client：ready、私聊/频道归一化、mention gate、回复元数据、禁用 mention 解析 |
| QQ Bot 适配器 | fake SDK client：ready、c2c/group 归一化、bot 过滤、被动回复 target、缺凭据 |
| Client bundle | module-loader wrapper、`settings.section` 注册、清理 |
| 包清单 | host/client exports、bundle patch 路径、`lane-support` preset id |
| Cordis 激活 | 用真实 `@deepseek-ai/cordis` 和 fake host services 激活插件，并干净销毁两个路由（能抓 mock ctx 抓不到的 async apply/effect 错误） |
| 迁移 | 旧 config/roles/KB/sessions → 新 state |

**未验证**（需要真实 DSH + 真实渠道）。可复现的首次验收清单见 [guides/LIVE_TEST.md](./guides/LIVE_TEST.md)。

- 通过 `dsh plugin add` 安装并渲染 Settings 卡片（API 形状来自已安装的 DSH 0.2.1-rc.3 包和 Discord/QQ Bot 插件）。
- 真实 SnowLuma 账号的 OneBot 收发。
- 官方 QQ Bot 凭据和被动回复 `msgId` 路径。
- 真实 Discord bot token 和 gateway（适配器只用 fake client 测过）。
- 插件内的完整模型回合（测试使用 fake `sessionController` 和 `sessionQuery`；真实服务只在 DSH Host 里跑）。

v0.2 应视为**可运行骨架 + 完整管理面**，在真实清单通过前不要当成生产客服机器人。

## 11. 待定问题

- 一个领域是否应该拥有多个渠道（例如同一个产品同时接 QQ + Discord）？当前模型：可以，binding 只指向领域，与渠道无关。
- 知识库草稿已进入 v0.2；下一步考虑草稿 diff 视图、批量审批和审批人记录。
