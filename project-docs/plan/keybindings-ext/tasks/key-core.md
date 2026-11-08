# key-core

context stack, 연속 key, 동적 id 저장·검증, Settings의 동적 행, 표 밖 key(palette·home·북마크·터미널 복사)를 표로, `shellOwns`를 `terminal` context로. 할 일과 계약은 계획 README와 lead의 worker prompt에 있다.

- 단위: key-core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/{keybindings.ts,keybindings_test.ts,shortcuts.ts}`
  - `packages/shell/renderer/commands/`
  - `packages/shell/renderer/desktop/settings/keyboard/`
  - `packages/shell/renderer/desktop/palette/`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/main/desktop/{shortcuts.ts,wiring/desktop.ts}`
  - `packages/shell/preload/{keybindings-api.ts,shortcut-api.ts}`
  - `packages/shell/renderer/terminal/{terminal-tab.tsx,xterm-view.ts}`
  - `packages/shell/main/browser/{electron-view.ts,registry.ts}`
  - `packages/shell/ipc/browser.ts`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/design/i18n/catalog/`
  - `tools/wireframes/pages/screens/settings-pages.tsx`
