[中文](CONTRIBUTING.md) | **English**

# Contributing

Thanks for taking a look. This project is a DSH plugin; the legacy standalone
`qq-bridge` source is not part of this repository or the published package.

## Development

```sh
npm test
```

The tests use only Node built-ins. They cover the pure store/resolver/KB/routes
code, the session and reply orchestration with fake DSH services, the channel
adapters with fake SDK clients, and the browser bundle with a fake module loader.

## Ground rules

- **No second server**: everything user-facing must fit the DSH plugin lifecycle
  and the native Settings card. One-shot migration/diagnostic scripts are fine.
- **Binding-first**: a conversation without a binding must never prompt a model.
- **Tool surface is per-conversation**: register `lane_*` tools on `agent.ctx`,
  and restrict inherited host tools to the domain allow-list. Do not add a
  global tool that can send messages.
- **Secrets never reach the browser**: add new secret fields to
  `redactState`/`mergeConfig` together, so the UI sees presence without the
  value and a blank save does not erase it.
- **No vendor process control**: the plugin does not start/stop SnowLuma or
  another vendor's native component.
- **Tests before behavior changes** for the store, resolver, route, and adapter
  seams. If a change needs a live DSH to verify, add it to
  `docs/guides/LIVE_TEST.en.md`.
- **Docs change with the code**: for any user-visible behavior, UI, or
  configuration change, update `README.en.md`, `CHANGELOG.en.md`, and
  `docs/IM_BRIDGE_ARCHITECTURE.en.md` in the same change; update
  `docs/guides/LIVE_TEST.en.md` when verification steps change. English and
  Chinese are paired — do not update only one side.

## Pull requests

- Keep the package tarball small; tests and docs stay outside `files`.
- Run `npm test` and `npm pack --dry-run` in `packages/dsh-lane-bridge`.
- Update `CHANGELOG.md` for user-visible changes.
- A behavior change without the matching docs update is an incomplete PR.
