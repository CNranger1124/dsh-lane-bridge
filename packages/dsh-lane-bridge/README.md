[English](README.en.md) | **中文**

# dsh-lane-bridge

把 QQ（SnowLuma OneBot v11）、官方 QQ Bot 和 Discord 接入 DSH 的聊天/客服 Bot 插件。

- **一个插件**：渠道、领域路由、角色卡、知识库和推送都在一起。不需要第二个服务或控制台 token。
- **一个会话一个 DSH session**：转录、工具和 token 用量都能在正常 DSH UI 里看到。
- **领域**：把群/私聊绑定到可复用策略（角色卡、preset、模型、知识库 scope、宿主工具白名单、群聊触发策略）。
- **共享库**：角色卡和 Markdown 知识库共享；领域选择能读哪些 KB scope。可选的领域记忆（`lane_memory_*`）跨会话积累经验。
- **统一推送**：`lane_send` 工具 + `POST /lane-bridge/api/push`（单发或广播）。
- **图片**：入站附件经 SSRF/字节上限检查后作为多模态 prompt part 发送；非视觉模型降级为文本。
- **人工接管**：`lane_escalate` 暂停会话、通知配置的接管会话，并可在 Settings 恢复。
- **Token 用量**：本地按会话的 token 账本和「用量」页。
- **聊天式合并**：按会话短 debounce，把连续消息合成一次 prompt（可配置，`0` 关闭）。

## 安装

```sh
dsh plugin --profile web add dsh-lane-bridge@0.1.0
```

Desktop 版把 `web` 换成 `desktop`，并先完全退出 DSH Desktop。

npm 发布前也可以直接从 GitHub Release 安装 tarball：

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/download/v0.1.0/dsh-lane-bridge-0.1.0.tgz
```

然后打开 **Settings → IM 桥接**。首次运行会创建
`~/.dsh/lane-bridge/`，包含默认领域、示例角色卡和知识库骨架。

本地开发：

```sh
dsh plugin --profile web add link:F:/path/to/repo/packages/dsh-lane-bridge
```

## 配置模型

- **渠道** 在 `state.json` 的 `config.channels.*`。
- **领域** 描述行为：角色卡名、agent preset、可选 `provider/model`、知识库 scope、允许的宿主工具、回复上限。
- **绑定** 把会话 key（`snowluma:group:123456`、`qqbot:private:openid`）挂到领域。
- 未绑定会话只记录，不触发模型。想做开放客服收件箱可打开 `autoReplyPrivate`。

## 从 `qq-bridge` 迁移

```sh
node scripts/migrate-from-qq-bridge.mjs --from /path/to/external/qq-bridge --data-dir ~/.dsh/lane-bridge
```

`--from` 指向一个外部的旧项目 checkout；本仓库不包含旧源码。`--dry-run` 先看摘要，`--force` 覆盖已有 `state.json`。迁移会复制角色卡和知识库、把旧 `allow.private` / `allow.groups` / `support.conversations` 映射成绑定，并把 session id 改写成 `snowluma:` 会话 key。它**不会**启动 SnowLuma。

## 安全默认

- 默认 `lane-support` preset 不注册任何内置工具。
- 每个会话的 agent 会拿到 `lane_send` / `lane_kb_*` / `lane_memory_*` / `lane_escalate`，并应用 `tools.restrict({ allow: allowedHostTools })`；默认白名单为空。
- KB 工具只读，限制在 `knowledge/`。
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
