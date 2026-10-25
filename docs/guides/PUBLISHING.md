[English](PUBLISHING.en.md) | **中文**

# 发布与安装

本文覆盖：本地 link 安装、npm 发布、DSH 安装/更新/卸载，以及 CI 自动发布。

## 快速安装（默认最新版）

> 两种方式都安装最新版：GitHub Release 用 `latest`，npm 用无版本号命令。npm 尚未发布时请用 GitHub Release。

### DSH Web

npm 发布后：

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

安装后完全重启 DSH，打开 **Settings → IM 桥接**。

## 0. 发布对象

只发布插件包目录：

```text
F:/GithubProject/dsh-lane-bridge/packages/dsh-lane-bridge
```

不要发布仓库根目录，也不要发布 `qq-bridge`（旧项目源码不在本仓库；其 SnowLuma 发行物和本机 `config.json` 也不应发布）。

## 1. 最快路径：本地 link 安装

适合发布前验收。

前置：

- DSH 0.2.1-rc.3+
- Node 22+
- `pnpm`（DSH CLI 安装插件依赖时使用）

```sh
pnpm -v
# 没有就装：
npm i -g pnpm
```

确认 profile：

- `dsh web` → `--profile web`
- DSH Desktop → `--profile desktop`

```sh
dsh plugin --profile web add link:F:/GithubProject/dsh-lane-bridge/packages/dsh-lane-bridge
```

Desktop（先完全退出 DSH Desktop）：

```sh
dsh plugin --profile desktop add link:F:/GithubProject/dsh-lane-bridge/packages/dsh-lane-bridge
```

安装会从 npm 拉 `@tencent-connect/qqbot-nodejs` 和 `discord.js`。

然后完全重启 DSH，打开 **Settings → IM 桥接**，按 [LIVE_TEST.md](LIVE_TEST.md) 验收。

## 2. npm 发布

### 2.1 补元信息

`package.json` 已有 `repository`/`homepage`/`bugs`/`author`/`publishConfig`。发布前确认这些字段指向你的仓库。

### 2.2 发布前检查

```sh
cd /path/to/repo
npm test
cd packages/dsh-lane-bridge
npm pack --dry-run
```

预期：测试全部通过；tarball 约 65 KB，包含 `lib/`、`presets/`、`cordis.patch.yml`、`README.md`、`README.en.md`、`LICENSE`、`LICENSE.zh.md`、`NOTICE`、`scripts/`。

检查包名：

```sh
npm view dsh-lane-bridge version --registry=https://registry.npmjs.org
```

- `404` → 可用。
- 有版本号 → 已被占用，改用 scoped 包名（见第 5 节）。

### 2.3 登录官方 npm

`npmmirror` 是只读镜像，不能发布；必须用官方 registry：

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
```

### 2.4 发布

```sh
cd packages/dsh-lane-bridge
npm publish --registry=https://registry.npmjs.org
```

Scoped 包：

```sh
npm publish --access public --registry=https://registry.npmjs.org
```

验证：

```sh
npm view dsh-lane-bridge version --registry=https://registry.npmjs.org
```

### 2.5 CI 自动发布（可选）

仓库包含 [.github/workflows/release.yml](../../.github/workflows/release.yml)：推送 `v*` tag 时自动跑测试并发布。

需要在 GitHub 仓库设置里添加 Actions secret：

```text
NPM_TOKEN = 你的 npm automation token
```

然后：

```sh
git tag v0.2.3
git push origin v0.2.3
```

## 3. DSH 安装已发布版本

```sh
dsh plugin --profile web add dsh-lane-bridge
```

Desktop：

```sh
# 先完全退出 DSH Desktop
dsh plugin --profile desktop add dsh-lane-bridge
```

建议固定版本号，不要用 `@latest`，避免宿主与插件版本错配。

也可以直接从 GitHub Release 安装 tarball（npm 发布前可用）：

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

本地 tarball：

```sh
dsh plugin --profile web add file:F:/path/to/dsh-lane-bridge.tgz
```

然后完全重启 DSH，打开 **Settings → IM 桥接**。

## 4. 更新、卸载与数据

更新：改版本、发布，然后安装新版本。

```sh
cd packages/dsh-lane-bridge
npm version patch
npm publish --registry=https://registry.npmjs.org
dsh plugin --profile web add dsh-lane-bridge
```

卸载：

```sh
dsh plugin --profile web remove dsh-lane-bridge
```

卸载不会删除：

```text
~/.dsh/lane-bridge/
├── state.json
├── roles/
├── knowledge/
├── memories/
└── usage.jsonl
```

需要时再手动清理该目录。

## 5. 包名被占用：改用 scoped 名

需要同时改 3 个地方，否则 client bundle 加载不到：

1. `packages/dsh-lane-bridge/package.json` 的 `name`。
2. `packages/dsh-lane-bridge/cordis.patch.yml` 的 `name`。
3. `packages/dsh-lane-bridge/lib/client.js` 里 `window.__ModuleLoader__.load({ id: ... })`。

安装命令也改成 scoped 包名。

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| `dsh: pnpm was not found` | `npm i -g pnpm` |
| 发布到 npmmirror 失败 | 用 `--registry=https://registry.npmjs.org` |
| Desktop 安装提示 profile 被锁 | 完全退出 DSH Desktop 后再运行 CLI |
| 安装后 Settings 没有「IM 桥接」 | 完全重启 DSH；检查 profile 的 `dsh.profile.bundles` |
| 安装依赖失败 | 检查 pnpm registry / 代理；两个渠道 SDK 是运行时依赖 |
| `npm publish` 报 403 | 检查 npm 登录、2FA、scope 权限和 `--access public` |
