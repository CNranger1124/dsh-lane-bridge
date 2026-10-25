[中文](PUBLISHING.md) | **English**

# Publishing and installing

This covers local `link:` install, npm publishing, DSH install/update/uninstall,
and CI release.

## Quick install (latest by default)

> Both paths install the latest version: GitHub Release uses `latest`, npm uses the versionless command. Use GitHub Release while npm is not published.

### DSH Web

After the npm release:

```sh
dsh plugin --profile web add dsh-lane-bridge
```

Before npm is published, use the latest GitHub Release:

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

### DSH Desktop

Fully quit DSH Desktop first, then:

```sh
dsh plugin --profile desktop add dsh-lane-bridge
```

Or use the latest GitHub Release:

```sh
dsh plugin --profile desktop add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

Fully restart DSH and open **Settings → IM 桥接**.

## 0. What gets published

Only the package directory:

```text
F:/GithubProject/dsh-lane-bridge/packages/dsh-lane-bridge
```

Do not publish the repository root or `qq-bridge` (the legacy source is not in
this repository; its SnowLuma distribution and local `config.json` must not be
published either).

## 1. Fast path: local `link:` install

Use this to validate before publishing.

Prerequisites:

- DSH 0.2.1-rc.3+
- Node 22+
- `pnpm` (the DSH CLI uses it to install plugin dependencies)

```sh
pnpm -v
# if missing:
npm i -g pnpm
```

Pick the profile:

- `dsh web` → `--profile web`
- DSH Desktop → `--profile desktop`

```sh
dsh plugin --profile web add link:F:/GithubProject/dsh-lane-bridge/packages/dsh-lane-bridge
```

Desktop (fully quit DSH Desktop first):

```sh
dsh plugin --profile desktop add link:F:/GithubProject/dsh-lane-bridge/packages/dsh-lane-bridge
```

The install pulls `@tencent-connect/qqbot-nodejs` and `discord.js` from npm.

Then fully restart DSH, open **Settings → IM 桥接**, and follow
[LIVE_TEST.en.md](LIVE_TEST.en.md).

## 2. Publish to npm

### 2.1 Metadata

`package.json` already has `repository`/`homepage`/`bugs`/`author`/`publishConfig`.
Confirm they point at your repository.

### 2.2 Preflight

```sh
cd /path/to/repo
npm test
cd packages/dsh-lane-bridge
npm pack --dry-run
```

Expected: all tests pass; the tarball is about 65 KB and contains `lib/`,
`presets/`, `cordis.patch.yml`, `README.md`, `README.en.md`, `LICENSE`,
`LICENSE.zh.md`, `NOTICE`, and `scripts/`.

Check the name:

```sh
npm view dsh-lane-bridge version --registry=https://registry.npmjs.org
```

- `404` → available.
- a version → taken; use a scoped name (section 5).

### 2.3 Log in to the official npm registry

`npmmirror` is a read-only mirror and cannot publish. Use the official registry:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
```

### 2.4 Publish

```sh
cd packages/dsh-lane-bridge
npm publish --registry=https://registry.npmjs.org
```

Scoped package:

```sh
npm publish --access public --registry=https://registry.npmjs.org
```

Verify:

```sh
npm view dsh-lane-bridge version --registry=https://registry.npmjs.org
```

### 2.5 CI release (optional)

The repository includes [.github/workflows/release.yml](../../.github/workflows/release.yml):
pushing a `v*` tag runs tests and publishes.

Add an Actions secret in the GitHub repository:

```text
NPM_TOKEN = your npm automation token
```

Then:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## 3. Install a published version into DSH

```sh
dsh plugin --profile web add dsh-lane-bridge
```

Desktop:

```sh
# fully quit DSH Desktop first
dsh plugin --profile desktop add dsh-lane-bridge
```

Pin the version; avoid `@latest` so host and plugin versions cannot drift.

You can also install the GitHub Release tarball before the npm release:

```sh
dsh plugin --profile web add https://github.com/CNranger1124/dsh-lane-bridge/releases/latest/download/dsh-lane-bridge.tgz
```

Or a local tarball:

```sh
dsh plugin --profile web add file:F:/path/to/dsh-lane-bridge.tgz
```

Then fully restart DSH and open **Settings → IM 桥接**.

## 4. Update, uninstall, data

Update: bump, publish, install the new version.

```sh
cd packages/dsh-lane-bridge
npm version patch
npm publish --registry=https://registry.npmjs.org
dsh plugin --profile web add dsh-lane-bridge
```

Uninstall:

```sh
dsh plugin --profile web remove dsh-lane-bridge
```

Uninstall does **not** delete:

```text
~/.dsh/lane-bridge/
├── state.json
├── roles/
├── knowledge/
├── memories/
└── usage.jsonl
```

Remove that directory manually when you want a clean slate.

## 5. Name taken: switch to a scoped package

Change all three, or the client bundle will not load:

1. `packages/dsh-lane-bridge/package.json` → `name`.
2. `packages/dsh-lane-bridge/cordis.patch.yml` → `name`.
3. `packages/dsh-lane-bridge/lib/client.js` →
   `window.__ModuleLoader__.load({ id: ... })`.

Update the install command to the scoped name.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `dsh: pnpm was not found` | `npm i -g pnpm` |
| publishing to npmmirror fails | use `--registry=https://registry.npmjs.org` |
| Desktop reports a locked profile | fully quit DSH Desktop, then run the CLI |
| no “IM 桥接” in Settings | fully restart DSH; check the profile's `dsh.profile.bundles` |
| dependency install fails | check pnpm registry/proxy; both channel SDKs are runtime dependencies |
| `npm publish` 403 | check npm login, 2FA, scope permission, and `--access public` |
