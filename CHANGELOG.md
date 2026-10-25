[English](CHANGELOG.en.md) | **中文**

# 变更记录

## 0.2.7

- 设置页标题栏显示 **当前运行的插件版本**（`/api/health` 返回进程真实版本）。以后再问「新版本到底加载了没有」，看这个数字即可，不用再靠猜。
- 含 0.2.6 的全部修复：prompt 补传 `AbortSignal`、事件流改用 `sessionController.history.follow`、事件信封解包、「DSH 会话」列。
- 测试增至 99 项。

## 0.2.6

- **修复 QQ / QQ Bot / Discord 消息只收到道歉、没有模型回复的根因**：DSH 的 `sessionController.prompt(request, signal)` 必须传 `AbortSignal`，以前漏传，宿主在入口就抛 `Cannot read properties of undefined (reading 'throwIfAborted')`，消息根本没进会话。现在每次提交都带一个可取消的 signal。
- **修复会话事件流监听**：DSH 已把事件流从 `sessionQuery.follow` 移到 `sessionController.history.follow`，旧调用直接 `is not a function`，导致回合永远收不到、回复发不出去。现在优先用新接口，并保留旧接口兜底。
- 兼容 DSH 的 `{ type: 'event', event }` 事件信封：`turn/start`、`assistant/message`、`turn/end` 现在能正确解包，token 统计和回复都恢复正常。
- 「会话」表格新增 **DSH 会话** 列：直接显示该会话对应的 DSH session id，没建会话时显示「尚未建立」，不用再猜到底有没有新开。
- 测试增至 98 项；新增事件信封解包、prompt 必须带 signal 的回归测试。

## 0.2.5

- 如果重试后会话投影仍不可用，自动清理该会话映射；下一条消息会重建新会话，不会一直卡在坏会话上。
- 会话提交失败的错误会写明 Remote code 和 `details.reason`，并进入「查看日志」。

## 0.2.4

- 每个模块标题栏增加**显式保存按钮**（领域、会话绑定、通用、GitHub、各通道、角色卡、记忆、知识库），不再只靠页面底部保存栏；领域卡片顶部现在直接有「保存领域」。
- 修复直接新建会话后立即提交时，会话 inbox 投影尚未就绪导致 `session/agent-busy`、用户只收到道歉没有模型回复的问题：提交前等待投影就绪，并对该瞬时错误自动重试。
- 回合失败、工具注册失败等桥接错误现在会写进「查看日志」的通道日志，不再只留在宿主控制台。
- 修复旧适配器晚到的 `disconnected` 覆盖新适配器 `connected` 状态的问题。
- 测试增至 97 项。

## 0.2.3

- GitHub 仓库改为 **全局默认 + 领域覆盖**：领域可以单独选择 `repo` / `branch`，不同项目/群绑定到不同仓库；留空继承全局。
- 「读取仓库」现在列出当前 GitHub 账号可见的**全部仓库**（`gh repo list` 或 `/user/repos` 分页），不再受当前工作区影响；下拉改为真正的 `select`，不会因为输入框预填而只显示一个匹配项。
- 每个通道配置卡新增独立 **保存按钮**（SnowLuma / 官方 QQ Bot / Discord），保存后有明确成功/失败提示。
- 所有设置模块支持点标题 **折叠/展开**（带状态箭头），不再需要一路滚到底。
- 修复 GitHub `branch` 配置未用于读文件和最近提交的问题。
- 测试增至 95 项，覆盖领域仓库覆盖、仓库分页/分支、通道保存与折叠。

## 0.2.2

- 设置页底部保存栏改为 **固定在视口底部**，滚动到任何位置都能看到「保存」。
- GitHub 仓库支持从本机 `gh` CLI / token 自动读取仓库列表和分支列表，生成可下拉选择；也可以用 `gh auth login`，不必手填 token。
- 增加 GitHub 登录态检查；`gh` token 失效时会明确提示（当前机器就是 gh 已安装但登录失效）。
- 通道启动卡新增 **查看日志**：显示最近 300 条通道连接/重连/错误日志，不再只有一个「未连接」。
- 启动卡保留 **启动 / 停止 / 重试连接 / 全部重连**。
- 测试增至 90 项（含 GitHub 仓库/分支路由）。

## 0.2.1

- 设置页顶部新增 **启动通道** 卡片：SnowLuma / 官方 QQ Bot / Discord 每个渠道都有明确的 **启动 / 停止 / 重试连接 / 全部重连**，不用再猜怎么开。
- 通道卡片右上角按钮改为 **启动/停止**，与顶部启动台一致。
- 未启动/未连接时，行内直接显示操作步骤和原因（例如「先启动 SnowLuma，默认 127.0.0.1:3001」）。
- 文档补充 SnowLuma 的启动方式（`launcher.bat` / `node index.mjs`）。

## 0.2.0

把旧 `qq-bridge` 的 GitHub 只读和知识库草稿审批迁进插件，并修通道启用引导。

- 新增 GitHub 仓库只读：`lane_repo_status/list_issues/get_issue/search_code/read_file/recent_commits`；仓库由配置固定，token 脱敏，ETag 缓存；`repo_create_issue` 默认关闭。
- 新增知识库草稿：`lane_kb_draft` 只写 `knowledge/<scope>/_待审/`，不参与 list/search/read；每小时限流、同内容去重。
- 新增「知识库审批」页：逐条采纳/丢弃；采纳时先备份正式文档，再追加小节并保留来源。
- 领域新增 `repoEnabled` / `kbDraftEnabled` 开关；GitHub 默认关闭，知识库草稿默认开启。
- 通道卡片新增直接「启用/停用」按钮和可操作提示：SnowLuma 未启动、端口不对、未填 AppID/Token 时直接说明。
- 修复「会话」空列表导致整个设置页空白的问题（0.1.1 继续保留）。
- 测试增至 88 项，覆盖 GitHub 请求/脱敏/路径校验、草稿生命周期、审批路由和空会话渲染。

## 0.1.1

修复与侧栏入口。

- 修复「会话」页在没有会话时崩溃、导致整个设置界面空白的问题：空列表现在正常显示占位行。
- 设置卡片和侧栏面板都加了错误边界；单个面板渲染失败时只显示错误和「重试」，不会再拖垮整个 UI。
- 新增 DSH 右侧栏「IM 桥接」面板，可直接打开会话、通道、领域、角色/知识库、用量和推送；与 Settings 卡片共用同一份状态。
- 回归测试覆盖空会话列表渲染和侧栏 tab 注册/清理。

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
