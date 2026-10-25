[English](README.en.md) | **中文**

# dsh-lane-bridge

把 QQ（SnowLuma OneBot v11）、官方 QQ Bot 和 Discord 接入 DSH 的聊天/客服 Bot 插件。

## 快速安装（默认最新版）

> 两种方式都安装最新版：GitHub Release 用 `latest`，npm 用无版本号命令。npm 尚未发布时请用 GitHub Release。

### DSH Web

```sh
dsh plugin --profile web add dsh-lane-bridge
```

npm 尚未发布时，用 GitHub 最新 Release：

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

### DSH Desktop

先完全退出 DSH Desktop，然后：

```sh
dsh plugin --profile desktop add dsh-lane-bridge
```

或者用 GitHub 最新 Release：

```sh
dsh plugin --profile desktop add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

安装后完全重启 DSH，打开 **Settings → IM 桥接**。首次运行会创建
`~/.dsh/lane-bridge/`，包含默认领域、示例角色卡和知识库骨架。

**只看到「未连接 / 已停用」？** 先启动 SnowLuma（双击其目录里的 `launcher.bat`，或在目录运行 `node index.mjs`，等日志出现 `127.0.0.1:3001`），然后在 SnowLuma 卡片右上角点 **启用**。插件不会代启动 SnowLuma；官方 QQ Bot / Discord 填好凭据后同样点 **启用**。

本地开发：

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

## 功能

- **一个插件**：渠道、领域路由、角色卡、知识库和推送都在一起。不需要第二个服务或控制台 token。
- **一个会话一个 DSH session**：转录、工具和 token 用量都能在正常 DSH UI 里看到。
- **领域**：把群/私聊绑定到可复用策略（角色卡、preset、模型、知识库 scope、宿主工具白名单、管理者白名单、群聊触发策略）。
- **共享库**：角色卡和 Markdown 知识库共享；领域选择能读哪些 KB scope。可选的领域记忆（`lane_memory_*`）跨会话积累经验。
- **知识库草稿 + 人工审批**：`lane_kb_draft` 只写 `_待审/`，Settings 的「知识库审批」页采纳/丢弃后才进入检索。
- **GitHub 只读**：全局默认仓库 + 每个领域可覆盖成不同仓库/分支；issue/文件/代码/提交查询；支持 `gh` CLI 读取账号可见的全部仓库/分支下拉，`gh auth login` 后无需手填 token；token 脱敏、路径校验、ETag 缓存。建 issue 默认关闭。
- **启动通道**：页面顶部每个渠道有启动/停止/重试按钮和「查看日志」，未连接时显示原因（例如 SnowLuma 未启动）。每个模块标题栏都有独立保存按钮，所有模块可折叠，保存栏固定在底部。
- **统一推送**：`lane_send` 工具 + `POST /lane-bridge/api/push`（单发或广播）。
- **图片**：入站附件经 SSRF/字节上限检查后作为多模态 prompt part 发送；非视觉模型降级为文本。
- **人工接管**：`lane_escalate` 暂停会话、通知配置的接管会话，并可在 Settings 恢复。
- **Token 用量**：本地按会话的 token 账本和「用量」页。
- **聊天式合并**：按会话短 debounce，把连续消息合成一次 prompt（可配置，`0` 关闭）。

## 配置模型

- **渠道** 在 `state.json` 的 `config.channels.*`。
- **领域** 描述行为：角色卡名、agent preset、可选 `provider/model`、知识库 scope、允许的宿主工具、管理者白名单、回复上限，以及可选的 `repo` / `branch`（留空继承全局 GitHub 仓库）。
- **绑定** 把会话 key（`snowluma:group:123456`、`qqbot:private:openid`）挂到领域。
- 未绑定会话只记录，不触发模型。想做开放客服收件箱可打开 `autoReplyPrivate`。

## 管理者（白名单）

一个群只有一个 DSH 会话，所有群友共用它。桥接不看昵称，只认渠道给出的**发送者 id**。谁是管理员写在**领域**的 `operators` 里（Settings → IM 桥接 → 领域 → 管理者）。

**界面上不是手打字符串**，而是「渠道下拉 + id 输入框 + 添加/移除」：

```text
管理者（白名单）
[官方 QQ Bot ▾] [openid，例如 8FD96C63…]  [+ 添加]

  [官方 QQ Bot ▾]  8FD96C63927394130884C87F9F708895   [−]
  [Discord     ▾]  123456789012345678                 [−]
[ ] 所有人都是管理员（*）

存下来是 operators: ["qqbot:8FD96C63…", "discord:123456789012345678"]
```

渠道只有三个枚举值：`qqbot`（官方 QQ Bot）、`snowluma`（OneBot）、`discord`。id 只填后半截，前缀由下拉决定，不用记格式。

| 界面选择 | 存成的值 | id 从哪来 |
| --- | --- | --- |
| 官方 QQ Bot | `qqbot:8FD96C63927394130884C87F9F708895` | 事件里的 `senderId`（openid，32 位十六进制，比较时忽略大小写） |
| SnowLuma | `snowluma:123456789` | `event.sender.user_id`（QQ 号） |
| Discord | `discord:123456789012345678` | `message.author.id`（snowflake） |
| 既有数据里的纯 id（无前缀） | `123456789` | 任意渠道上的这个 id |
| 勾选「所有人」 | `*` | 显式放行，不建议在公开群用 |
| 空列表 | — | 没有人是管理员（默认） |

要点：

- 前缀必须和会话 key 的渠道一致（`qqbot:group:…` ↔ `qqbot:…`）。同一个 QQ 号在 `qqbot` 和 `snowluma` 下是 openid / QQ 号两个不同的值，不能互认。
- 昵称、群名片不参与判断：可以随便改，也不唯一。
- 不知道 id 是多少：Settings → IM 桥接 → 会话，表格里的「最近发言者」按成员列出 `渠道:id`，点一下即复制。直接粘进 id 输入框即可——带前缀会被自动识别并切换渠道下拉，不会出现 `qqbot:qqbot…`。日志也会打印 `sender=…`。
- 白名单是**领域级**的：同一领域下所有绑定共享。要给不同群不同管理员，就拆成不同领域。
- 只有白名单成员能：建 issue（`lane_repo_create_issue`）、往别的会话推送（`lane_send` 的跨会话目标）、写领域共享记忆（`lane_memory_add`）。
- 其他人仍然可以：在本会话分多条气泡发送、写知识库草稿（进待审区，等人工采纳）、`lane_escalate` 转人工。
- 管理员发言的那一轮，提示词会带「本次发言者：X（本领域管理员，可执行管理操作）」和「发言者身份：管理员」，模型据此判断该怎么答。

## 按身份写不同的话（模板）

角色卡和「领域附加说明」可以写两段不同的说法，用两个极简结构：

```md
## 权限
{{#if operator}}
本次发言者是管理员：可以回答内部排期、仓库分支、配置项，可以直接建 issue。
{{else}}
本次发言者是普通成员：不透露内部信息、不承诺排期；收集完信息用 lane_escalate 转人工。
{{/if}}

当前身份：{{identity}}｜来源：{{kind}}｜渠道：{{channel}}
```

- 变量：`{{identity}}`（管理员/普通成员）、`{{sender}}`、`{{senderId}}`、`{{channel}}`、`{{kind}}`（群聊/私聊）、`{{externalId}}`、`{{domain}}`、`{{role}}`。
- 条件：`operator`、`group`、`private`。写法 `{{#if 条件}}A{{else}}B{{/if}}`，`else` 可省略（省略时条件不成立就什么都不渲染）。
- 不支持嵌套、循环、表达式：角色卡是散文，不是程序。写错变量名（例如 `{{opertor}}`）会渲染成空，不会把 `{{…}}` 原样塞给模型。
- 每一轮都按当轮发言者重新渲染；管理员和普通成员交替发言时会重新注入角色卡，不会沿用上一个人的版本。

**必须分清的两层**：

| | 用什么 | 强度 |
| --- | --- | --- |
| “能不能做” | 领域管理者白名单 + `repoEnabled` / `kbDraftEnabled` 等开关，由 `lane_*` 工具在代码里拦截 | 硬，提示词骗不过去 |
| “怎么说、说什么” | 角色卡 / 领域附加说明里的 `{{#if operator}}` | 软，模型可能被话术带偏 |

想让普通成员**根本拿不到**某类信息，别只写在提示词里——把那部分内容放进另一个领域，用另一个知识库 scope。

## 上下文预算：归档、记忆长度、知识库怎么给

先分清三样东西，它们进上下文的方式完全不同：

| 进上下文的内容 | 怎么进来 | 上限 |
| --- | --- | --- |
| 角色卡 + 领域附加说明 | 新建会话时注入一次；发言者身份变化时重新注入 | 角色卡 8000 字 |
| 领域共享记忆 | `memoryEnabled` 打开后**全量注入**，最近的条目优先 | `memoryMaxChars` 200~8000 字，默认 2000 |
| 知识库 | **默认完全不注入**，只有模型主动调 `lane_kb_*` 才读 | 单次调用有上限 |
| 知识库自动检索 | 勾选后，入站文本命中**触发词**才注入命中的片段 | `kbRetrieveChars` 200~8000 字，默认 1500 |

也就是说：**全量注入的只有记忆，知识库从来不是全量**。如果你担心上下文被知识库塞满，默认配置本来就不会。

### 会话归档（`sessionMaxTurns`）

`0` = 不归档（默认）。设成 N 后：

1. 每个回答完的回合 +1（计数存在 `state.sessions[key].turns`，重启不丢）；
2. 达到 N 时，桥接发起一次**内部归档回合**：让模型调用 `lane_retire`，把本次对话里值得留的东西分成两类写入——
   - `memory`: 跨会话还需要知道的事实 → 领域记忆；
   - `kb`: 确认过、且现有知识库没覆盖的产品口径 → 知识库**草稿**（仍然要人工采纳才生效）；
3. 归档回合结束后**重置 DSH 会话**，下一条消息是一个干净上下文 + 刚写入的记忆/知识库检索。

几条边界：

- 归档回合的文本**不会发给用户**（`isRetiring` 期间屏蔽回复）。
- 模型不听话不调工具也没关系：等待上限 90 秒，到点照样重置，只是没有沉淀，日志会写 `归档回合未沉淀任何内容`。
- 归档只在「回答完一个回合」之后触发，不会打断正在进行的对话。
- 每轮归档会多花一次模型调用；轮数设太小（比如 5）成本和重置感都会变强，客服场景建议 30~80。

### 记忆最大长度

- 单条记忆 ≤500 字，每个领域最多 200 条，注入时按 `memoryMaxChars`（默认 2000，上限 8000）**从最近往前取**，放不下就丢弃更旧的。
- 8000 字约等于 4k tokens 的中文；除非你确实在记长清单，2000~3000 更划算。

## 从 `qq-bridge` 迁移

```sh
node scripts/migrate-from-qq-bridge.mjs --from /path/to/external/qq-bridge --data-dir ~/.dsh/lane-bridge
```

`--from` 指向一个外部的旧项目 checkout；本仓库不包含旧源码。`--dry-run` 先看摘要，`--force` 覆盖已有 `state.json`。迁移会复制角色卡和知识库、把旧 `allow.private` / `allow.groups` / `support.conversations` 映射成绑定，并把 session id 改写成 `snowluma:` 会话 key。它**不会**启动 SnowLuma。

## 安全默认

- 默认 `lane-support` preset 不注册任何内置工具。
- 每个会话的 agent 会拿到 `lane_send` / `lane_kb_*` / `lane_kb_draft` / `lane_repo_*` / `lane_memory_*` / `lane_escalate`，并应用 `tools.restrict({ allow: allowedHostTools })`；默认白名单为空。
- KB 工具只读正式区；草稿只能写 `_待审/`，且不参与检索。GitHub 默认关闭，按领域开启。
- 建 issue、跨会话推送、写共享记忆只允许领域管理者白名单里的成员；白名单默认留空＝谁都不能。
- 密钥永不返回浏览器；UI 只显示“已配置”。
- 浏览器写操作要求同源；外部推送要求配置的 bearer token。
- 图片只允许公网 http(s)，逐跳校验重定向，限制类型和字节数。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/lane-bridge/api/state` | 脱敏 state + 渠道状态（同源） |
| `POST` | `/lane-bridge/api/config` | 合并渠道/通用配置 |
| `POST` | `/lane-bridge/api/domains` | 替换领域 |
| `POST` | `/lane-bridge/api/roles` | 替换角色卡 |
| `POST` | `/lane-bridge/api/bindings` | 替换绑定 |
| `POST` | `/lane-bridge/api/push` | 发到单个 `target` 或多个 `targets`（bearer token 或同源） |
| `POST` | `/lane-bridge/api/session/reset` | 忘记会话的 DSH session（下一条消息新建） |
| `POST` | `/lane-bridge/api/channels/restart` | 重连适配器 |
| `GET`/`POST` | `/lane-bridge/api/knowledge` | 列出/写入 KB 文档 |
| `GET`/`POST` | `/lane-bridge/api/kb/drafts` | 列出/采纳/丢弃待审草稿 |
| `GET`/`POST` | `/lane-bridge/api/memory` | 读取/替换/清空领域记忆 |
| `POST` | `/lane-bridge/api/handoff` | 暂停 / 转人工 / 恢复会话 |
| `GET`/`POST` | `/lane-bridge/api/usage` | 读取/清空本地 token 账本 |

## 状态

QQ / 官方 QQ Bot / Discord 适配器和管理面已经就位。旧的仿真/表情包/语音/**费用折算**尚未迁移；Token 用量账本已经有了。设计、迁移和 live 验收清单见仓库的 `docs/IM_BRIDGE_ARCHITECTURE.md`。

当前代码和测试完成，但尚未在真实 DSH 安装和真实渠道上验收。

## 来源与致谢

派生自 Derpyu520 和贡献者的 `qq-bridge`（MIT）。见 [NOTICE](NOTICE)。

## 许可证

MIT。中文参考译文见 [LICENSE.zh.md](LICENSE.zh.md)，以英文原文为准。
