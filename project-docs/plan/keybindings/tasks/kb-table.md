# kb-table

작업대 단축키 표를 README의 "표"대로 넓히고, binding id를 main→renderer payload로 쓰며, 사람이 단 동적 `app.panel:*` binding과 겹침 판정, menu 항목의 키 칸을 더한다. wave 2 task 셋이 기대는 계약이다.

- 단위: kb (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/keybindings.ts`
  - `packages/shell/ipc/keybindings_test.ts`
  - `packages/shell/ipc/shortcuts.ts`
  - `packages/shell/preload/shortcut-api.ts`
  - `packages/shell/preload/keybindings-api.ts`
  - `packages/shell/main/desktop/shortcuts.ts`
  - `packages/shell/main/desktop/wiring/desktop.ts`
  - `packages/shell/renderer/commands/registry.ts`
  - `packages/shell/renderer/commands/keybinding-service.ts`
  - `packages/shell/renderer/commands/window.ts`
  - `packages/shell/renderer/commands/react.tsx`
  - `packages/shell/renderer/commands/commands_test.ts`
  - `packages/shell/renderer/desktop/palette/host.tsx`
  - `packages/shell/renderer/desktop/settings/keyboard/model.ts`
  - `packages/core/config/shell-settings.ts`
  - `packages/design/components/overlay/menu/menu.tsx`
  - `packages/design/components/overlay/menu/menu.module.css`
  - `packages/design/i18n/catalog/workspace-settings.ts`
- 읽을 것:
  - plan: `project-docs/plan/keybindings/README.md` (정한 것, 표)
  - architecture: `project-docs/architecture/keybindings.md`
  - 지금 코드: `packages/shell/ipc/keybindings.ts`, `packages/shell/main/desktop/wiring/desktop.ts`의 `KEYBINDINGS_CHANNEL`·`listenShortcuts` 부분, `packages/shell/renderer/desktop/palette/host.tsx`
- 계약:
  - 쓰는 것: `shell.keybindings` 설정(core `packages/core/config/shell-settings.ts`), IPC `shell:shortcut`·`shell:keybindings`
  - 내놓는 것(wave 2가 기댄다. 이름을 이대로 쓴다):
    - `Command`에 README 표의 새 command 모두. `Binding.section: KeySection`(`"tab" | "pane" | "desk" | "float" | "open" | "view" | "app"`), `Binding.arg?: number | string`.
    - `APP_PANEL = "app.panel"`, `appPanelBindingId(app, surface): string`, `parseBindingId(id): { command: Command; arg?: number | string } | null`(표에 있는 id와 모양이 맞는 `app.panel:<app>:<surface>`만).
    - `resolveBindings(platform, overrides)`가 표 뒤에 overrides의 `app.panel:*` binding을 붙인다(section `app`, main both, 다른 platform chord는 빈 목록).
    - `KeyConflict { chord: string; ids: readonly string[]; reserved: boolean }`, `findConflicts(platform, overrides): readonly KeyConflict[]`.
    - `commandLabel(command, platform, arg?, overrides?)`의 arg가 `number | string`. 새 `bindingLabel(id, platform, overrides): string | null`(첫 chord 이름).
    - `WindowShortcut = PaletteShortcut | string`(binding id). `isWindowShortcut`이 `parseBindingId`로 검사한다.
    - `WindowCommands.subscribe(listener): () => void`(사람이 바꾼 키가 바뀌면 부른다). `commands/react.tsx`에 `useKeyLabel(): (bindingId: string) => string | null` hook — `WindowCommands`가 없으면(gallery) 늘 null.
    - design `MenuItem.shortcut?: string` — 항목 오른쪽에 흐린 글로 그린다(typeahead에는 넣지 않는다).

## 할 일

1. `packages/shell/ipc/keybindings.ts`
   - README 표의 새 command를 `Command`와 표(`FIXED`, 번호 줄)에 넣는다. 지금 줄에도 `section`을 단다. 키가 없는 줄은 `other: []`, `mac: []`. `desk.nth`는 1~9 번호 줄(`tab.nth`처럼)이다.
   - `MainCommand`와 `isMainCommand`를 지우고, main이 받는 것은 binding의 `main`만 본다. `matchKey`가 `arg`를 돌린다(이미 있다). 새 `main: BOTH` 줄은 README 표대로.
   - `bindingId`를 `arg: number | string`에 맞춘다. `parseBindingId`, `appPanelBindingId`, `APP_PANEL`을 더한다. app·surface 글자 규칙은 `packages/core/config/shell-settings.ts`의 `shell.quick_launch` `apps` 항목 상한(길이 1~64)을 따르고 `:`와 공백은 받지 않는다. app·surface id가 실제로 어떤 글자인지 `packages/protocol`에서 확인하고 보고에 적는다.
   - `parseKeyOverrides`가 `app.panel:*` id도 받는다(모양이 틀리면 버린다). `resolveBindings`가 그것을 표 뒤에 붙인다.
   - `RESERVED`에 OS·글자 편집 키를 더한다: other `Ctrl+KeyA/C/V/X/Z/Y`, `Ctrl+Shift+KeyZ`, `Alt+F4`, `Alt+Tab`; mac `Cmd+KeyA/C/V/X/Z`, `Cmd+Shift+KeyZ`, `Cmd+KeyQ`, `Cmd+KeyH`, `Cmd+KeyM`, `Cmd+Tab`, `Cmd+Space`, `Cmd+Shift+Digit3/4/5`. 기본 표가 이것과 겹치지 않는다.
   - `findConflicts`: 이 platform에서 resolved binding끼리 `sameChord`인 묶음, 그리고 RESERVED와 같은 chord를 가진 binding 하나(`reserved: true`). 같은 binding 안의 같은 chord 두 번은 겹침이 아니다.
   - `bindingLabel`을 더하고 `commandLabel` arg type을 넓힌다.
   - 파일 머리 주석을 새 흐름에 맞춘다(main 줄, `app.panel`).
2. `packages/shell/ipc/shortcuts.ts`·`packages/shell/preload/shortcut-api.ts`: payload를 binding id 글자로. `isWindowShortcut`은 palette·home이거나 `parseBindingId`가 null이 아닌 것.
3. `packages/shell/main/desktop/shortcuts.ts`·`packages/shell/main/desktop/wiring/desktop.ts`: main이 맞춘 binding의 id를 보낸다. Linux·Windows에서 shell renderer 자신의 키는 renderer가 받는다는 규칙(`isMainCommand(shortcut)` 자리)은 "palette·home이 아닌 binding id"로 바꿔 그대로 둔다.
4. `packages/shell/renderer/desktop/palette/host.tsx`: binding id를 `parseBindingId`로 풀어 `registry.execute(command, arg)`.
5. `packages/shell/renderer/commands/*`: `KeybindingInput.arg`는 이미 unknown이다. `WindowCommands.subscribe`와 `useKeyLabel`을 더한다(`useSyncExternalStore`). `setOverrides`가 listener를 부른다.
6. `packages/shell/renderer/desktop/settings/keyboard/model.ts`: `WORDING`에 새 command의 name·help key를 더하고(`app.panel`은 name만 쓰거나 빈 help — 화면은 `kb-settings`가 고친다), `keyRows`가 `app.panel` binding을 건너뛰게 한다(그 줄은 `kb-settings`가 따로 만든다). 이름·설명 글은 `packages/design/i18n/catalog/workspace-settings.ts`의 `settings.label.key-*`·`settings.note.key-*`에 영어로 더한다. menu 항목과 같은 말을 쓴다.
7. `packages/core/config/shell-settings.ts`: `shell.keybindings` overrides key 길이 상한 160, 항목 수 상한 256. 주석을 맞춘다.
8. design `Menu`: `MenuItem.shortcut?: string`을 오른쪽에 흐린 글로 그린다. 글 크기·색은 design token만 쓴다. gallery의 Menu page가 있으면 한 항목에 shortcut을 보인다(`tools/wireframes`는 소유가 아니니 없으면 보고만).
9. 표의 새 기본 키가 다른 곳과 부딪히는지 본다: `grep -rn "key === \"" packages/shell/renderer`(component가 직접 받는 키), CodeMirror 기본 keymap(`node_modules/@codemirror/commands`의 `defaultKeymap`·`standardKeymap`), xterm 쪽(`packages/shell/renderer/terminal/xterm-view.ts`), Electron app menu accelerator(`packages/shell/main`에서 `accelerator`·`role` grep). README의 "정한 것"과 다르게 부딪히면 그 키를 고치지 말고 보고에 적는다.
10. `place-window.tsx`(`kb-workspace` 소유)는 type이 깨질 때만 한 줄로 맞추고 "넘길 줄"에 적는다. 새 command의 handler는 쓰지 않는다.

## 끝남

- `npm run check`가 통과한다. renderer build(`node packages/shell/renderer/build.ts`)가 된다.
- 위험 test(`keybindings_test.ts`에 더하거나 고친다. 몇 개면 된다):
  - "기본 표는 platform마다 겹침이 없고 RESERVED와 겹치지 않는다"(지금 첫 test를 새 표와 RESERVED로 넓힌다).
  - "`parseKeyOverrides`는 모양이 맞는 `app.panel:<app>:<surface>`만 남기고 그 binding을 `resolveBindings`가 표 뒤에 붙인다".
  - "사람이 단 키가 다른 binding의 기본 키나 RESERVED와 같으면 `findConflicts`가 그 둘을 낸다".
  - "`isWindowShortcut`은 palette·home·표의 binding id·`app.panel` id를 받고 모르는 글자는 거절한다".
- 남지 않음: `grep -rn "MainCommand\|isMainCommand" packages tools`가 0줄.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: app·surface id 글자 규칙, 부딪혀서 남긴 키
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
