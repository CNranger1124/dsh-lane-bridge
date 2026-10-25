[English](IM_BRIDGE_ARCHITECTURE.en.md) | **中文**

# IM Bridge 架构（DSH 插件）

> 状态：方案 + v0.7.0 实现说明。
> 读者：维护者、未来贡献者、安装前想评估这个插件的人。

## 1. 决策：DSH 原生插件，不做独立前端

**我们把它做成一个带原生 Settings 卡片和右侧栏面板的 DSH 插件。**

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 独立 Web 控制台（像旧的 `launcher/` 跑在 3210） | 不做，只保留一次性迁移/诊断脚本 | 重复实现登录、CSRF、主题、i18n 和部署；用户还要记住第二个 URL。它唯一不可替代的价值是启动 DSH 不该拥有的进程（SnowLuma），而这仍应由用户自己操作。 |
| 只有 Host 的 DSH 插件 + `/lane-bridge/` 独立静态页 | 只适合过渡 | 实现快，但像 iframe 产品：没有共享的设置外壳、语言和主题，两套视觉语言。 |
| DSH Host 插件 + 原生 client Settings section + 右侧栏 tab | **采用** | 一次安装、一套鉴权、一套生命周期、一套外观。DSH 已经提供 `settings.section`、`sidebarRightTabs`、`sidebar.right.pane.tab` 和带鉴权的 HTTP 路由；设置页负责完整配置，侧栏负责日常会话管理。 |

插件仍然暴露 HTTP API（`/lane-bridge/api/*`），因为浏览器卡片和外部“推送”调用方需要一个稳定边界。这个 API 是传输层，不是第二个产品界面。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| **Channel / 渠道** | 一个传输账号：`snowluma`（OneBot v11）、`qqbot`（官方 QQ Bot），以及 `discord`。 |
| **Conversation / 会话** | 渠道看到的一个聊天线程：群或私聊。Key：`<channel>:<group|private>:<externalId>`。 |
| **Domain / 领域** | **基础设施**：绑定的知识库（可多个）、共享记忆、GitHub 仓库、宿主工具白名单、管理者白名单（`operators`）、群聊触发策略（all/mention/keyword/off，可多选：mention 与 keyword 取或，all/off 互斥）、agent preset/模型、回复策略。领域**不点名角色**。 |
| **Binding / 绑定** | 会话 → 角色。绑定里没有领域；它只选一张角色卡。没有绑定的会话会被 *发现*，但不会调用模型。 |
| **Role card / 角色卡** | 共享角色库里的 Markdown 人格 + **所属领域**。会话选角色，角色决定用哪套基础设施。 |
| **Knowledge base / 知识库** | 具名文档容器：`knowledge/<库名>/` 一个子目录，登记在 `state.knowledgeBases` 里。领域按名字绑定若干个库。 |
| **Knowledge document / 知识文档** | 知识库里的一篇 Markdown，自带 `title` / `triggers` / `always` frontmatter；命中触发词才会被注入。文档的归属是它所在的知识库，不再声明领域。 |
| **KB draft / 知识库草稿** | AI 写在 `knowledge/<库>/_待审/` 的单主题文档，**必须带触发词**；人工在「知识库审批」页改触发词并采纳后，才变成该库里一篇正式文档。草稿不参与检索，模型也读不到。 |
| **Domain memory / 领域记忆** | 可选的共享笔记（`memories/<domainId>.json`），由 `lane_memory_*` 读写；按时间顺序注入 prompt，有长度上限。 |
| **Operator / 管理者** | 领域白名单里的成员，写法是 `渠道:id`（`qqbot:8FD9…`、`snowluma:123456789`、`discord:123…`）、纯 id 或 `*`。**空数组＝没有人是管理员**。 |
| **Session** | 与一个外部会话 1:1 映射的 DSH session。 |
| **Push / 推送** | 操作者主动发往任意已绑定会话的消息（HTTP + agent 工具）。 |

### 解析顺序：会话 → 角色 → 领域

```
binding.role（没有就用 config.defaultRole / 第一张角色卡）
  → 角色卡的 domainId
  → 领域（绑定的知识库、记忆、仓库、管理者、触发策略、preset/模型）
  → 全局默认领域（角色缺失或旧数据时）
```

0.3.x 的数据在这里自动迁移：旧 `domain.role` 会被写成对应角色卡的 `domainId`；旧 `binding.domainId`（没有角色的行）仍然按它解析，所以在设置页重选一次角色之前，行为不变。

没有 binding 时，插件把会话记录为“已发现”，不触发 agent。这是成本/安全默认值；操作者可以显式绑定（或为客服收件箱打开 `autoReplyPrivate`）。

## 3. 运行时形态

```text
  QQ (SnowLuma)  ─┐
  QQ (official)  ─┼─ ChannelAdapter ─┐
  Discord        ─┘                  │  normalized InboundMessage
                                     ▼
                              ConversationRouter
                                     │  binding + domain + trigger policy
                                     ▼
                              InboundQueue（800ms debounce）
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
                                      //      senderName, text, images, mentionsBot,
                                      //      replyToBot, raw })
```

适配器只负责传输，不碰 DSH session、角色卡或 store。

### 通道实例：一个机器人一个实例

`config.channels` 是一张**实例表**：key 是实例 id（同时是会话键前缀），value 带 `kind`（`snowluma` / `qqbot` / `discord`）、`label` 和凭据。所以同一个渠道可以并排跑多个机器人（两个 AppID = 两个 QQ 机器人）。

- 默认实例沿用 `snowluma` / `qqbot` / `discord`。老状态里没有 `kind`，按 id 推断，因此 0.7.x 的 `qqbot:group:<openid>` 会话键、绑定、管理员白名单、记忆全部有效，无需迁移。
- 新实例（`qqbot-2`、`support-bot`…）天然有独立命名空间：会话、角色、领域、session 都按实例 id 分开。
- `ChannelManager` 的生命周期是**按实例**的：`startOne` / `stopOne` / `restart(id)` / `sync(ids)`。保存配置时后端逐条比对实例条目，只重启真正变了的实例；删除走 `POST /api/channels/remove`（配置补丁是深合并，删不掉 key）。
- 领域用 `domain.channelId` 认领一个机器人。未绑定会话的解析顺序：绑定角色 → 绑定遗留 `domainId` → 认领该机器人的领域 → 全局默认领域。认领机器人后，该机器人上未绑定的会话按这个领域自己的 `autoReply` 与唤醒策略回答（不再依赖全局「未绑定群聊自动回复」开关）。
- 同一个机器人被多个领域认领时入站取领域列表里第一个，领域页红字提示；一个领域只认领一个机器人。

### 为什么一个外部会话一个 DSH session？

- 转录在 DSH 侧栏可见，工具和审批也都在。
- DSH 的压缩、模型选择和 token 统计按 session 工作。
- 重置/删除一个会话不会影响其他会话。

插件把 `sessionId` 存在自己的 state 里；DSH 重启后由 `sessionController.prompt` 冷恢复。

### 按 agent 的工具面

插件把工具注册在 `agent.ctx`，不是全局：

- `lane_send`（发给当前或指定会话）
- `lane_conversation_info`
- `lane_kb_list` / `lane_kb_read` / `lane_kb_search` / `lane_kb_draft`
- `lane_memory_read` / `lane_memory_add`
- `lane_retire`（只在归档回合可用）
- `lane_repo_status` / `lane_repo_list_issues` / `lane_repo_get_issue` /
  `lane_repo_read_file` / `lane_repo_search_code` / `lane_repo_recent_commits` /
  `lane_repo_create_issue`
- `lane_escalate`

然后调用 `agent.ctx.tools.restrict({ allow: domain.allowedHostTools })` 隐藏继承来的宿主工具（bash、fs、subagent、plugin manager……）。默认白名单为空：客服 agent 只能聊天、读知识库、推送，别的都没有。领域可以显式放行只读宿主工具，例如 `web_search`。

这比旧桥接的 preset 级守卫更严格：限制挂在**具体会话的 agent** 上，新 preset 或新 DSH 版本不能悄悄扩大能力面。

### 身份：管理者白名单

一个群共用一个 DSH session，所以“谁说的话”只能在**每一轮入站**上区分，不能挂在 session 上：

- 入站消息带 `senderId`（SnowLuma = QQ 号；官方 QQ Bot = openid；Discord = snowflake）。`senderName` 只用于提示词文案，**永不**参与鉴权。
- 领域里有 `operators: string[]`，写法是 `渠道:id`、纯 id（任意渠道）或 `*`（所有人）。`渠道` 必须与会话 key 的前缀一致。**空数组＝没有人是管理员**。
- `SessionPool.prompt()` 在提交回合前把 `{ senderId, senderName, isOperator }` 记到 `turnSender[key]`；`lane_*` 工具通过 `pool.currentSender(key)` 读取，所以上一位发言者的权限不会漏给下一位。
- 受限动作：`lane_repo_create_issue`、`lane_send` 的跨会话目标、`lane_memory_add`。其余（本会话多条气泡、KB 草稿、转人工）对所有人生效；`lane_retire` 只在归档回合内可用。
- 管理员那一轮的提示词前缀会带「本次发言者：X（本领域管理员，可执行管理操作）」和「发言者身份：管理员／普通成员」。
- `conversations[key].senders` 记录每个会话最近的 10 位成员（`渠道:id` + 昵称），供设置页一键复制填白名单。

### 提示词按身份分支（软层）

角色卡和 `domain.systemPrompt` 在注入前会过一遍 `renderTemplate()`（`lib/template.js`），支持 `{{identity}}` 等变量和 `{{#if operator}}…{{else}}…{{/if}}` 块。渲染上下文与 `isOperator()` 同源，所以提示词里看到的身份与工具门禁看到的身份不可能不一致。

两条约束值得记住：

- 模板只在 `buildContextPrefix()` 里渲染一次，`roleKey` 里带了 `admin`/`member` 后缀，因此身份切换会重新注入角色卡——否则缓存会把第一个发言者的版本留给所有人。
- 模板能改的只是“说法”。权限判断仍然只发生在 `tools.js` 的 `requireOperator()`，模板里写“你是管理员”不会让工具放行。

注意这仍是**渠道身份**，不是强认证：SnowLuma 的 QQ 号可信度取决于 OneBot 网关；openid 由官方平台签发，才具备跨会话唯一性。

### 上下文预算

一个 IM 会话的上下文由四块拼成，各有各的上限：

| 块 | 注入方式 | 上限 |
| --- | --- | --- |
| 角色卡 / 领域附加说明 | 新建会话时注入，身份或角色卡内容变化时重新注入 | 角色卡 8000 字 |
| 领域共享记忆 | `memoryEnabled` 时**全量**注入，最近的优先 | `memoryMaxChars`（200~8000，默认 2000） |
| 知识库 | 默认**不注入**，模型按需调 `lane_kb_*` | 单次调用上限 |
| 知识库自动检索 | 开启 `kbAutoRetrieve` 后，按**每篇文档自己的触发词**命中才注入 | `kbRetrieveChars`（200~8000，默认 1500） |

`sessionMaxTurns > 0` 时，回合结束后计数，达到阈值触发归档：`prompt()` 发一条内部指令 → 模型调用 `lane_retire` 写记忆 / 知识库草稿 → `reset()` 丢弃 DSH 会话。归档期间 `isRetiring(key)` 为真，`index.js` 的 `onTurnEnd` 直接返回，所以归档指令和模型对它的回应都不会发到群里。等待归档回合有上限（90 秒），到点无论如何都重置——宁可丢一次沉淀，也不让上下文无限增长。

## 4. 数据模型

默认都在 `$DSH_HOME/lane-bridge/` 下（可用插件行的 `dataDir` 覆盖）：

```text
lane-bridge/
├── state.json          # config、domains、knowledgeBases、roles、bindings、conversations、sessions
├── roles/
│   ├── 客服.md
│   └── ...
├── knowledge/
│   └── <知识库>/
│       ├── 存档.md      # frontmatter: title / triggers / always
│       └── _待审/       # AI 草稿；不参与检索
├── memories/
│   └── <domainId>.json
├── usage.jsonl         # Token 用量账本
└── logs/               # 可选
```

`state.json` 是运行时配置的唯一事实源。写入是原子的（临时文件 + rename）并且串行化；只有“会话最近活动”这类高频变化会合并写入（默认 1 秒一批，插件卸载前 `flush()`），改配置、角色、绑定仍然立即落盘。Settings 卡片读到的是**脱敏投影**：密钥只返回“是否已配置”，不会返回明文。

知识库有两层事实：目录是文档的事实源，`state.knowledgeBases` 是库名与显示名的事实源。重命名库会同时移动目录并更新所有绑定它的领域；删除非空库需要显式 `force`，删除后自动从各领域解绑。`/api/kb` 还会报告“目录存在但未登记”的孤儿库，方便发现旧数据。

草稿单独放在 `_待审/`，`walkScope` 会跳过所有 `_` 前缀的目录和文件，所以列表、检索、模型读取都看不到草稿；采纳时先在目标库生成新文档，再删除草稿，同名文档自动加序号。

为什么不把所有东西都塞进 DSH profile YAML？因为绑定变化频繁、以外部 id 为 key，而且不应该触发插件 remount。DSH settings 适合启动值（数据目录、默认 preset）；运行模型是插件自己拥有的文档，类似数据库。

## 5. 入站 → 回复流程

1. 适配器归一化消息，调用 `router.handleInbound`。
2. Router 找 binding，并应用领域触发策略（`all`/`mention`/`keyword`/`off`；mention 与 keyword 可同时启用，命中任意一条即回复）。mention 包含“被 @”和“回复机器人消息”。没有 binding 或未命中：记录会话，停止，不调用模型。
   然后按会话做短 debounce（默认 800ms），把连续消息合成一次 prompt。
3. `SessionPool.ensure(key)` 恢复/创建 DSH session，应用领域 model/preset，注册 scoped 工具，并在新会话上启动 `sessionQuery.follow`。
4. 消息前面加一段紧凑的上下文头；首次回合或角色变化时加完整角色卡。若领域开启了自动检索，命中触发词的文档片段会一并注入（受 `kbRetrieveChars` 限制）；没有文档命中时，才回退到领域兜底词 + 全文检索。
5. `sessionController.prompt` 接收回合。
6. follow 循环收集 `assistant/message` 文本，直到 `turn/end`。
7. 如果这一轮 `lane_send` 成功过，收集到的文本**不会**再自动发送（agent 已经自己选了气泡）。否则最终文本按上限拆分，由适配器发出。
8. 错误只回一句简短道歉，绝不在聊天里发堆栈。

“agent 已经发过”的抑制很重要：没有它，一个用 `lane_send` 发了三条短气泡的客服，还会把拼接后的 assistant 文本当第四条泄露出去。

### 知识库草稿与审批

- `lane_kb_draft` 参数：`title`、`content`、`triggers`（必填）、`source`（必填）、`scope`（领域绑多个库时必填）。
- 领域一个库都没绑 → 直接报错；`scope` 不在绑定范围内 → 拒绝并列出可选项；没有 `scope` 且只绑了一个 → 用它。
- 草稿有数量上限与去重，文件名带时间序号，同一秒内同名不会互相覆盖。
- 审批页展示「将写入哪个库、这个库被哪些领域绑定」；触发词为空时“采纳”禁用。采纳 = 在该库新建 `<标题>.md`（带 frontmatter 与来源），不是追加到某个大文件，也不覆盖同名文档。

## 6. 统一推送

两个入口，一套实现：

- Agent 工具 `lane_send({ target?, targets?, messages })`。
- `POST /lane-bridge/api/push`，外部系统用 `Authorization: Bearer <pushToken>`，浏览器测试按钮用同源请求。

目标解析顺序：显式会话 key → 精确 binding 名字 → 当前会话（仅工具）。工具/API 可以接收列表做广播：`POST /api/push` 最多 50 个目标，`lane_send` 工具最多 20 个会话。广播只允许已绑定会话，未绑定 key 直接拒绝。部分目标失败时返回 207，响应带可读的 `error` 和逐目标 `results`。每次推送都会记录来源（`agent` / `api`）、目标和结果。限流目前未实现，属于后续工作。

## 7. 安全基线

- **绑定优先**：未绑定会话绝不进入模型。
- **默认没有继承工具**：每个 agent 用 `tools.restrict`。
- **管理动作走白名单**：建 issue、跨会话推送、写共享记忆只认 `operators`；默认空列表＝谁都不能。
- **密钥**：存在 `state.json`，尽力设为 0600，永不返回浏览器；UI 只显示“已配置”。
- **路由**：浏览器写操作做同源检查；外部推送使用独立 bearer token；默认假设只监听回环地址。
- **模型不能任意读文件**：知识库工具只能在 `knowledge/` 内解析，拒绝 `..`、绝对路径和非 `.md/.txt`；草稿区只允许写 `_待审/`。
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
| M7 | 会话 → 角色 → 领域、管理者白名单、身份模板、QQ Bot 全量群消息与被动回复修正 | v0.3–v0.4 |
| M8 | 知识库一等公民、领域多库绑定、文档改名/跨库转移、草稿必带触发词、采纳即新建文档 | v0.5–v0.6 |
| M9 | 费用折算、表情包、语音、黑话、仿真调度器 | 后续 |
| M10 | `config.json`/`roles/`/`knowledge/`/`state/sessions.json` 一键迁移 | 脚本已有，UI 后续 |

首版**刻意不迁**：一代/二代仿真调度器、表情包收藏、语音发送、黑话学习。它们依赖长期自治循环，不适合“客服收件箱”模型，应该以后作为独立的领域策略重建。

## 9. 安装与升级

```sh
dsh plugin --profile web add dsh-lane-bridge
```

发布包声明了三个 patch 文件，插入：

- `dsh-lane-bridge` host 行（带 `inject` services）；
- `lane-support` agent preset 行（客服 persona，无内置工具）；
- `lane-chat` agent preset 行（闲聊/角色扮演 persona，角色卡优先，同样无内置工具）。

没有第二个进程、没有端口、没有控制台 token。升级插件不会碰 `state.json`、角色或知识库。设置页标题会显示当前运行中的插件版本（`/api/health`），用来判断“重启后到底加载了新版本没有”。发布/安装细节见 [guides/PUBLISHING.md](./guides/PUBLISHING.md)。

## 10. 验证状态

仓库当前验证的内容（`npm test`，157 个测试）：

| 区域 | 证据 |
| --- | --- |
| State store | 原子写、schema 修复、密钥保留、角色文件对账、会话写合并与 flush |
| 领域/绑定 resolver | 未绑定默认、按绑定覆盖、禁用绑定、按领域触发策略（可多选）、旧数据迁移 |
| 知识库 | 库的创建/重命名/删除与领域联动、文档改名/跨库转移、路径穿越拒绝、`_` 目录隐藏 |
| 知识库触发词 | 按文档自己的 triggers 命中、`always`、无命中不注入、兜底词仅旧文档、排序与字符预算 |
| 知识库草稿 | 只写 `_待审`、不参与 list/search/read、去重/限流、必须带 triggers 且 scope 在领域绑定内、采纳＝新建带触发词的文档（同名加序号）、丢弃、审批页无目标文件下拉 |
| GitHub 只读 | 固定仓库/路径、token 脱敏、issue/文件/提交、401 重试、代码搜索需鉴权、标签缺失降级 |
| HTTP 边界 | 同源写、密钥脱敏、bearer push、参数校验错误、207 部分失败原因 |
| 会话编排 | 新建 session、冷 `agents.resume` setup、角色卡首次/再次注入、回合收集、`lane_send` 抑制 |
| 身份与模板 | `{{#if operator}}`、变量替换、身份切换重新注入、错误变量不泄漏 |
| 广播 | `lane_send` 发往多个已绑定会话，拒绝未绑定（工具最多 20 个，push API 最多 50 个目标） |
| 入站 debounce | 消息合并、动态延迟、0=立即、stop 清理 timer |
| 领域记忆 | append/dedupe/render/replace/clear、损坏文件备份、prompt 注入、领域隔离 |
| 归档 | 达到轮数触发 `lane_retire`、等待上限、期间回复被抑制、结束后重置 |
| 入站图片 | 公网/重定向/类型/字节校验；多模态 content；纯文本降级 |
| 人工接管 | 暂停 binding、通知接管人、提示、恢复、路由鉴权 |
| Token 用量 | 逐消息账本、按会话聚合、清空、路由 |
| 会话重置 | 清除映射、中止 follow、下一条消息新建 session |
| 回复分发 | Markdown 清理、分条、`lane_send` 后不重复、失败一句道歉、空回合静默 |
| OneBot 传输 | echo 关联、access token、入站事件解析、失败动作拒绝 |
| SnowLuma 发现 | 从 `onebot_*.json` 读 per-account WS token/端口，显式配置优先 |
| Discord 适配器 | fake discord.js client：ready、私聊/频道归一化、mention gate、回复元数据、禁用 mention 解析 |
| QQ Bot 适配器 | fake SDK client：ready、c2c/group 归一化、bot 过滤、被动回复 target、全量模式 @ 判定、5 条气泡上限、错误码翻译 |
| Client bundle | module-loader wrapper、`settings.section` 注册、9 个页面渲染、清理 |
| 包清单 | host/client exports、bundle patch 路径、`lane-support` / `lane-chat` preset id |
| Cordis 激活 | 用真实 `@deepseek-ai/cordis` 和 fake host services 激活插件，并干净销毁两个路由（能抓 mock ctx 抓不到的 async apply/effect 错误） |
| 迁移 | 旧 config/roles/KB/sessions → 新 state |

**未验证**（需要真实 DSH + 真实渠道）。可复现的首次验收清单见 [guides/LIVE_TEST.md](./guides/LIVE_TEST.md)。

- 通过 `dsh plugin add` 安装并渲染 Settings 卡片（API 形状来自已安装的 DSH 包；DSH 的 slot 接口可能随版本演进）。
- 真实 SnowLuma 账号的 OneBot 收发。
- 官方 QQ Bot 凭据、被动回复 `msgId`、全量群消息与主动消息权限。
- 真实 Discord bot token 和 gateway（适配器只用 fake client 测过）。
- 插件内的完整模型回合（测试使用 fake `sessionController` 和 `sessionQuery`；真实服务只在 DSH Host 里跑）。
- 知识库/审批/领域联动的浏览器真实交互（client 测试只到渲染层）。

v0.7.0 应视为**功能完整、测试覆盖的管理面 + 待真实渠道验收的运行时**；在真实清单通过前不要当成生产客服机器人。

## 11. 待定问题

- 知识库草稿下一步：diff 视图、批量审批、审批人记录；同一主题的草稿是否应该合并去重。
- 知识库检索目前是触发词 + 全文匹配；是否引入向量检索，以及如何避免它把上下文预算吃满。
- 是否给领域绑定多个渠道账号（同一产品同时接 QQ + Discord 已经可行，但“同一领域下不同渠道用不同 preset/模型”还没有建模）。
- 旧项目的仿真调度器、表情包、语音、黑话学习是否作为独立的领域策略重建，还是彻底留在旧项目。
- 推送限流与重试：目前只有 50 目标上限和逐目标结果，没有队列。
