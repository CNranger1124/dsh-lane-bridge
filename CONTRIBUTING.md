[English](CONTRIBUTING.en.md) | **中文**

# 参与贡献

感谢查看。这个项目是一个 DSH 插件；旧的独立 `qq-bridge` 源码不属于本仓库，也不属于发布包。

## 开发

```sh
npm test
```

测试只使用 Node 内置模块，覆盖：纯 store/resolver/KB/路由代码、带 fake DSH 服务的会话与回复编排、带 fake SDK 的渠道适配器，以及带 fake module loader 的浏览器 bundle。

## 基本规则

- **不要第二个服务**：所有用户可见的东西都要适配 DSH 插件生命周期和原生 Settings 卡片。一次性迁移/诊断脚本可以保留。
- **绑定优先**：没有 binding 的会话绝不能触发模型。
- **工具面按会话隔离**：在 `agent.ctx` 上注册 `lane_*` 工具，并用领域白名单收紧继承来的宿主工具。不要新增能发消息的全局工具。
- **密钥不进浏览器**：新增密钥字段时，同时更新 `redactState` 和 `mergeConfig`，保证 UI 只看到“已配置”、空保存不会把值清掉。
- **不控制厂商进程**：插件不启动/停止 SnowLuma 或其他厂商的原生组件。
- **改行为先补测试**：尤其是 store、resolver、路由和适配器这些 seam。需要真实 DSH 才能验证的改动，写进 `docs/guides/LIVE_TEST.md`。
- **文档跟代码一起改**：用户可见的行为/界面/配置变化，同一次改动里更新 `README.md`、`CHANGELOG.md`、`docs/IM_BRIDGE_ARCHITECTURE.md`；改了验收步骤还要更新 `docs/guides/LIVE_TEST.md`。中英文是成对的，不要只改一边。

## Pull Request

- 保持发布包体积小；测试和文档不进 `files`。
- 在 `packages/dsh-lane-bridge` 下跑 `npm test` 和 `npm pack --dry-run`。
- 用户可见改动更新 `CHANGELOG.md`。
- 行为变了而文档没跟着改，PR 视为未完成。
