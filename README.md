[English](README.en.md) | **中文**

# dsh-lane-bridge

一个把社交聊天渠道接入 DSH agent 的 **DeepSeek Harness (DSH) 插件**：一个插件、多个渠道、共享知识、按会话人格，以及统一的出站推送 API。

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
`~/.dsh/lane-bridge/`，包含默认领域、示例角色卡和知识库骨架。

本地开发：

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

> 插件安装由 `dsh plugin` 管理；SnowLuma 仍是用户自行安装/启动的独立组件（见其 EULA）。首次验收见 [docs/guides/LIVE_TEST.md](./docs/guides/LIVE_TEST.md)。

## 首次启用通道（为什么只看到「未连接 / 已停用」）

插件不会代启动 SnowLuma（许可证原因），所以「已启用但未连接」通常只是 SnowLuma 没开，或 WS 端口不对。

1. 先自行启动 SnowLuma，确认它的 OneBot v11 WebSocket 在 `127.0.0.1:3001`（SnowLuma 日志里会写 `listening 127.0.0.1:3001`）。
2. 打开 **Settings → IM 桥接 → 概览与通道**。
3. 在 **SnowLuma / QQ** 卡片右上角点 **启用**；状态应变成 **已连接**。如果仍是「未连接」，卡片里会直接显示原因。
4. 官方 QQ Bot / Discord：填好 AppID+AppSecret / Bot Token，点卡片右上角 **启用**；不需要用的通道点 **停用** 即可。

> 通道卡片右上角的 **启用/停用** 会立即保存并重连；下面的复选框适合改完多个字段后统一「保存通道设置」。

## 为什么做成插件，而不是独立前端？

- **安装一次**：`dsh plugin add dsh-lane-bridge` 同时挂载渠道、工具和设置卡片；不需要第二个服务、端口或控制台 token。
- **身份统一**：浏览器已经有 DSH 登录态；插件 UI 就是普通的 Settings 页面，渠道密钥不需要第二套登录。
- **生命周期统一**：DSH Host 跟着插件 fiber 启停渠道适配器。
- **会话统一**：每个外部群/私聊对应一个真实的 DSH session，在侧栏能看到转录，而不是藏在一个不透明的桥接数据库里。

独立前端会重复实现鉴权、主题、会话列表和部署。因此管理界面放在 **DSH 内部**，仓库只保留一个一次性的旧项目迁移脚本。

## v0.2 包含什么

- 渠道适配器接口 + SnowLuma（OneBot v11）适配器（QQ）。
- 官方 QQ Bot 适配器（实验性；需要 AppID/AppSecret）。
- Discord 适配器（`discord.js`；私聊 + 服务器频道，可选 mention gate）。
- 领域/绑定模型：每个群或私聊一个 DSH session，领域级角色卡、preset、模型、知识库 scope、宿主工具白名单。
- 共享角色卡库、共享知识库（`lane_kb_*`）、可选的领域共享记忆（`lane_memory_*`）。
- **知识库草稿与人工审批**：`lane_kb_draft` 只写 `_待审/`；Settings 新增「知识库审批」页，采纳/丢弃后才影响检索。
- **GitHub 仓库只读**：固定仓库、路径校验、token 脱敏、ETag 缓存；`lane_repo_*` 工具查 issue、读文件、搜代码、看提交；建 issue 默认关闭。
- 统一推送：`lane_send` agent 工具 + `POST /lane-bridge/api/push`。
- 原生 DSH 设置卡片 + 右侧栏面板：渠道、会话、领域、角色、知识库、审批、推送；两处共用同一份状态。
- 通道卡片直接「启用/停用」，未连接时显示可操作原因（例如 SnowLuma 未启动）。
- 入站图片理解：安全下载（SSRF/字节上限）+ 多模态 prompt part；非视觉模型自动降级为纯文本。
- 人工接管：`lane_escalate` 暂停自动回复、通知接管会话，并可在设置页恢复。
- 本地 Token 用量账本 + 「用量」页（按会话统计输入/输出/缓存 token）。
- 覆盖 store、resolver、路由、会话编排、GitHub、草稿审批和插件 harness 的测试。

架构与迁移计划见 [docs/IM_BRIDGE_ARCHITECTURE.md](./docs/IM_BRIDGE_ARCHITECTURE.md)；发布与安装细节见 [docs/guides/PUBLISHING.md](./docs/guides/PUBLISHING.md)。

## 状态

`0.2.0` 把旧项目的 GitHub 只读和知识库草稿审批迁进来了。旧项目还有群聊黑话学习、表情包库、语音消息、费用折算和仿真调度器没有迁；架构文档会跟踪。

当前代码、测试和发布物已经完成；**尚未在真实 DSH 上做安装验收**，也没有在真实 SnowLuma/QQ Bot/Discord 账号上做端到端收发。请按 [LIVE_TEST.md](./docs/guides/LIVE_TEST.md) 验证。

## 来源与致谢

派生自 Derpyu520 和贡献者的 `qq-bridge`（MIT）。见 [NOTICE](NOTICE)。旧项目的 SnowLuma 发行物和本机 `config.json` 不属于本仓库，也不属于发布包。

## 许可证

MIT。中文参考译文见 [LICENSE.zh.md](LICENSE.zh.md)，以英文原文为准。旧项目的 SnowLuma 发行物和任何本机 `config.json` **不**包含在发布包中；本仓库也不包含旧项目源码。
