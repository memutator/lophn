# key-ext

extension manifest `contributes`(commands, keybindings), `ctx.commands`, renderer로 넘기기, harness-gui의 harness별 keymap. 할 일과 계약은 계획 README와 lead의 worker prompt에 있다.

- 단위: key-ext (wave 2)
- 선행: key-core
- 소유(이 task만 고친다):
  - `packages/protocol/extensions/`
  - `packages/shell/main/extensions/registry.ts`
  - `packages/shell/main/extensions/registry_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/manifest.json`
  - `packages/shell/main/desktop/wiring/extensions.ts`
  - `packages/shell/ipc/extensions.ts`
  - `packages/shell/preload/extensions-api.ts`
  - `packages/shell/renderer/commands/{extension-keys.ts,window.ts,keybinding-service.ts,commands_test.ts}`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/settings/keyboard/`
  - `packages/design/i18n/catalog/`
