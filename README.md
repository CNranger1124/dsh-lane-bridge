[English](README.en.md) | **中文**

# dsh-lane-bridge

把 QQ（SnowLuma OneBot v11）、官方 QQ Bot 和 Discord 接入 DSH 的聊天/客服 Bot 插件：**一个插件、多个渠道、共享知识库、按会话人格、统一推送**。当前版本 `0.8.0`。

本仓库从独立的 `qq-bridge` 项目演进而来。产品代码在
[`packages/dsh-lane-bridge`](./packages/dsh-lane-bridge)；旧的 `qq-bridge` 源码**不包含**在仓库里，迁移脚本可以读取一个外部的旧项目目录。仓库只包含插件、文档和测试。

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

安装后完全重启 DSH，打开 **Settings → IM 桥接**；也可以从 DSH 右侧栏的「+」里打开 **IM 桥接** 面板，直接管理会话、通道和领域。首次运行会创建
`~/.dsh/lane-bridge/`，包含默认领域、示例角色卡、默认知识库和记忆目录。

本地开发：

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

> 插件安装由 `dsh plugin` 管理；SnowLuma 仍是用户自行安装/启动的独立组件（见其 EULA）。首次验收见 [docs/guides/LIVE_TEST.md](./docs/guides/LIVE_TEST.md)。

## 启动通道（为什么只看到「未连接 / 已停用」）

插件不会代启动 SnowLuma（许可证原因），所以「已启用但未连接」通常只是 SnowLuma 没开，或 WS 端口不对。

1. 先自行启动 SnowLuma：双击 SnowLuma 目录里的 `launcher.bat`，或在目录里运行 `node index.mjs`；确认日志出现 `listening 127.0.0.1:3001`。
2. 打开 **Settings → IM 桥接 → 概览与通道**。
3. 在页面顶部 **启动通道** 卡片里，找 **SnowLuma / QQ** 点 **启动**；状态应变成 **已连接**。如果仍是「未连接」，卡片里会直接显示原因。
4. 官方 QQ Bot / Discord：填好 AppID+AppSecret / Bot Token，点对应行的 **启动**；不需要的通道点 **停止**。Discord 只认 **Bot Token**（开发者门户 → 应用 → **Bot** 页 → `Reset Token`）：OAuth2 页的客户端密钥和 General Information 页的公钥都用不上。
5. 已启动但连不上时，点那个机器人卡片上的 **重试连接**——它只重连这一个，不会影响其他机器人。

> **启动/停止** 会立即保存并只重连这一个实例；下面的通道卡片更适合改多个字段后统一「保存」。同一个渠道可以点「添加机器人」再加一个 AppID（两个 AppID 就是两个机器人），到 **领域** 页把某个领域指向它，那个项目就只在这个机器人上接待。

## 多个项目用多个 Bot

一个 AppID 就是一个机器人，`openid` 也按机器人隔离——同一个群在两个 Bot 下拿到的是不同的 id，所以会话、记忆、绑定都不通用。想"一个项目一个机器人"：

1. **通道** 页 →「添加机器人」：类型选 **官方 QQ Bot**，起个能认出项目的名字（例如「砂金客服」），添加后填第二个 AppID/AppSecret，保存。
2. **领域** 页 → 选中那个项目的领域 → **这个领域用的机器人** 选刚加的机器人。
3. 之后这个机器人上**未绑定**的群/私聊就归这个领域，按它的知识库、人格、唤醒策略接待；显式绑了角色的会话仍以角色所属领域为准。

删除机器人时卡片上要点两次确认；历史会话保留，指向它的领域会回到"通用"。

## 为什么做成插件，而不是独立前端？

- **安装一次**：`dsh plugin add dsh-lane-bridge` 同时挂载渠道、工具和设置卡片；不需要第二个服务、端口或控制台 token。
- **身份统一**：浏览器已经有 DSH 登录态；插件 UI 就是普通的 Settings 页面，渠道密钥不需要第二套登录。
- **生命周期统一**：DSH Host 跟着插件 fiber 启停渠道适配器。
- **会话统一**：每个外部群/私聊对应一个真实的 DSH session，在侧栏能看到转录，而不是藏在一个不透明的桥接数据库里。

独立前端会重复实现鉴权、主题、会话列表和部署。因此管理界面放在 **DSH 内部**，仓库只保留一个一次性的旧项目迁移脚本。

## 能做什么

- **多机器人**：SnowLuma（OneBot v11）、官方 QQ Bot（AppID/AppSecret）、Discord（Bot Token + Message Content Intent）三种渠道，每种都可以加多个实例（多个 AppID / 多个 Token）；每个机器人独立启动、独立重连、独立状态，可查看最近 300 条连接/错误日志。
- **会话 → 角色 → 领域**：会话只选角色卡；角色卡绑定领域；领域承载基础设施（绑定的知识库、共享记忆、仓库、管理者、触发策略、preset/模型）。换角色就整套换策略。
- **领域**：preset 下拉、模型、宿主工具白名单、**管理者白名单**（`渠道:id`，空列表＝没有管理员）、群聊触发策略多选（@/回复、关键词可同时生效，也可选所有消息或关闭）、自动检索与上下文预算（`kbRetrieveChars`、`memoryMaxChars`、`sessionMaxTurns`）。
- **两种内置人格**：`lane-support` 客服、`lane-chat` 群聊闲聊/角色扮演。后者把角色卡当最高身份设定（卡片优先于通用规则、允许入戏、群聊里可以不说），两者都不注册内置工具。
- **知识库是一等公民**：`knowledge/<库名>/` 一个目录就是一个知识库，可在「知识库」页新建、改名、删除；领域可以绑定**多个**知识库，重命名会自动更新所有绑定它的领域。
- **文档自带触发词**：每篇 Markdown 的 frontmatter 写 `title` / `triggers` / `always`，命中哪篇就注入哪篇；`always: true` 每轮注入。旧文档可以靠领域里的兜底词 + 全文检索。
- **知识库编辑器**：改文件名（可带子目录）、跨知识库转移；目标重名会拒绝而不是覆盖。
- **知识库草稿 + 人工审批**：`lane_kb_draft` 写的是一篇带**必填触发词**的单主题草稿，落在领域绑定库的 `_待审/`；「知识库审批」页可改触发词，采纳后在该库新建一篇带 frontmatter 的文档（同名自动加序号，不覆盖）。
- **AI 沉淀**：`sessionMaxTurns` 达到阈值后发起一次内部归档回合，让模型用 `lane_retire` 把值得留的内容写成领域记忆或知识库草稿，然后重置会话；归档文本不会发到群里。
- **管理者白名单 + 身份模板**：只有白名单成员能建 issue、跨会话推送、写共享记忆；角色卡/领域提示词可用 `{{#if operator}}…{{else}}…{{/if}}` 按身份切换说法，硬权限仍在代码里。
- **GitHub 只读**：全局默认仓库 + 每领域覆盖；`gh` CLI 读取可见仓库/分支下拉；路径校验、token 脱敏、ETag 缓存；`lane_repo_*` 查 issue/文件/代码/提交。建 issue 默认关闭，开启后有每小时上限；配置标签不存在时自动降级为不带标签创建。
- **统一推送**：`lane_send` agent 工具 + `POST /lane-bridge/api/push`；支持单发和广播（`lane_send` 最多 20 个会话，push API 最多 50 个目标），部分失败返回 207 并逐个给出原因。
- **入站图片理解**：安全下载（SSRF/字节上限）+ 多模态 prompt part；非视觉模型自动降级为纯文本。
- **人工接管**：`lane_escalate` 暂停自动回复、通知接管会话，并可在 Settings 恢复。
- **用量账本**：本地按会话统计输入/输出/缓存 token。
- **管理面**：概览与通道、会话、领域、角色卡、知识库、记忆、知识库审批、用量、推送共 9 个页面；每个模块标题栏有独立保存按钮、可折叠，底部保存栏固定。侧栏面板与设置页共用同一份状态。
- **测试**：157 项，覆盖 store、resolver、路由、会话编排、GitHub、知识库与草稿审批、渠道适配器和插件 harness。

## 配置模型：会话 → 角色 → 领域

三层，方向是单向的：

```text
会话（一个群 / 一个私聊）  ── 绑定一张角色卡
                               └─ 角色卡属于一个领域
                                    └─ 领域 = 绑定的知识库 + 记忆 + 仓库 + 管理者 + 触发策略 + preset/模型
```

- **绑定只选角色**，没有「领域」这个选项；换角色，知识库/记忆/策略整套跟着换。
- **领域不点名角色**，只描述基础设施；一个领域可以挂多个角色。
- **未绑定会话只记录，不触发模型**；开放客服收件箱可打开 `autoReplyPrivate`。
- 0.3.x 的 `domain.role` / `binding.domainId` 会在加载时自动迁移成「角色 → 领域」。

更细的配置说明（管理者格式、身份模板、知识库触发词、草稿审批、归档预算、QQ Bot 被动回复与主动消息）在
[插件完整说明](./packages/dsh-lane-bridge/README.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [packages/dsh-lane-bridge/README.md](./packages/dsh-lane-bridge/README.md) | 完整使用手册：配置、管理者、模板、知识库、归档、QQ Bot 规则、API |
| [docs/IM_BRIDGE_ARCHITECTURE.md](./docs/IM_BRIDGE_ARCHITECTURE.md) | 架构、数据模型、入站流程、安全基线、迁移与验证状态 |
| [docs/guides/LIVE_TEST.md](./docs/guides/LIVE_TEST.md) | 真实 DSH/渠道上的首次验收清单 |
| [docs/guides/PUBLISHING.md](./docs/guides/PUBLISHING.md) | 本地 link、npm 发布、CI 与升级/卸载 |
| [CHANGELOG.md](./CHANGELOG.md) | 每个版本的用户可见变更 |

## 状态

`0.8.0` 把通道变成"机器人实例"：同一渠道可加多个 AppID，一个项目一个 Bot，领域可指定自己用的机器人，重连/保存都只影响那一个实例。`0.7.0` 新增 `lane-chat` preset：群聊闲聊/角色扮演，把角色卡当最高身份设定。`0.6.0` 把知识库变成一等公民：草稿必须带触发词、只能落在领域绑定的库里，采纳＝新建一篇独立文档；审批页可改触发词。`0.5.x` 引入知识库增删改、跨库转移/改名和领域多库绑定；`0.4.x` 修正官方 QQ Bot 的被动回复、全量群消息与 @ 判定；`0.3.x` 把模型改成「会话 → 角色 → 领域」。细节见 [CHANGELOG.md](./CHANGELOG.md)。

代码与测试已完成（157 项通过），真实 DSH/官方 QQ Bot 正在验收，SnowLuma/Discord 尚未做端到端收发。请按 [LIVE_TEST.md](./docs/guides/LIVE_TEST.md) 验证。

旧项目还有群聊黑话学习、表情包库、语音消息、费用折算和仿真调度器没有迁；Token 用量账本已经实现。架构文档会跟踪。

## 来源与致谢

派生自 Derpyu520 和贡献者的 `qq-bridge`（MIT）。见 [NOTICE](NOTICE)。旧项目的 SnowLuma 发行物和本机 `config.json` 不属于本仓库，也不属于发布包。

## 许可证

MIT。中文参考译文见 [LICENSE.zh.md](LICENSE.zh.md)，以英文原文为准。旧项目的 SnowLuma 发行物和任何本机 `config.json` **不**包含在发布包中；本仓库也不包含旧项目源码。
