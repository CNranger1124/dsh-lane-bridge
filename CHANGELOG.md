[English](CHANGELOG.en.md) | **中文**

# 变更记录

## 0.1.0

第一个可运行的插件骨架。

- DSH Host 插件：渠道、领域、绑定、按会话 session，以及原生 Settings 卡片。
- 渠道：SnowLuma OneBot v11（自带 WS 客户端）、官方 QQ Bot（`@tencent-connect/qqbot-nodejs`，实验性）、Discord（`discord.js`）。
- 领域策略：角色卡、agent preset、可选 `provider/model`、知识库 scope、宿主工具白名单、群聊触发策略（`all`/`mention`/`keyword`/`off`）。
- 共享角色卡库和 Markdown 知识库（`lane_kb_*`）。
- 统一推送：`lane_send` agent 工具 + `POST /lane-bridge/api/push`（单发 `target` 或广播 `targets`）。
- 聊天式消息合并：按会话 debounce，把连续消息合成一次 prompt（可配置，0 关闭）。
- 按领域的触发策略：所有消息 / @ 或回复 / 关键词 / 关闭。
- 单个会话重置（下一条消息创建新的 DSH session）。
- 可选的领域共享记忆（`lane_memory_read` / `lane_memory_add`）。
- 入站图片理解：SSRF 防护、字节上限、纯文本降级。
- 人工接管：暂停/转人工/恢复，并通知接管会话。
- 本地 Token 用量账本和「用量」页（按会话统计）。
- 从旧 `qq-bridge` 布局一次性迁移。
- 安全默认：未绑定不触发模型、按 agent 收紧工具、知识库路径限制、同源浏览器写、外部推送 bearer token。
- 测试：store、resolver、KB、路由、会话编排、回复分发、OneBot、QQ Bot、Discord、迁移、client bundle、包清单。

尚未完成：真实安装验收、费用折算看板、表情包、语音、黑话学习、仿真调度器。
