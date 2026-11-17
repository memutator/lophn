# sweep-shell-renderer

desktop 화면의 bug를 고친다: layout 저장과 읽기, agent가 연 탭의 자리, 설정 화면의 빠진 줄, preview 탭, 단축키 겹침 검사.

- 단위: shell-renderer (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/`
  - `packages/shell/renderer/shell/{desk-model.ts,desk-model_test.ts,layout-source.ts,global-floats/}`
  - `packages/shell/renderer/desktop/{main.tsx,connection/connection.tsx,workspaces/,palette/,settings/keyboard/}`
  - `packages/shell/renderer/browser/`
  - `packages/shell/renderer/app-frame/app-detail/{app-detail.tsx,core-source.ts}`
  - `packages/shell/main/browser/`
  - `packages/shell/main/workspace/`
  - `packages/shell/ipc/{browser.ts,workspace.ts}`
  - `packages/shell/preload/{browser-api.ts,layout-api.ts}`
  - `packages/protocol/shell/`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `layout-save-rejection-is-silent`
2. `unreadable-layout-overwrites-saved-file`
3. `agent-aside-shrinks-source`
4. `agent-float-cap-drops-tab`: 추천안(desk 끝 plain tab)
5. `app-project-rename-archive-missing`
6. `project-identity-row-missing-in-settings-page`
7. `remote-group-sessions-only-project-lophn`
8. `machine-window-update-after-connected`
9. `preview-tab-has-no-screen-picker`
10. `emulation-lost-on-devtools-open`
11. `bookmark-home-hint-ignore-custom-keys`
12. `harness-keymap-skips-conflict-check`
13. `app-keys-shadowed-by-main-shortcuts`: Settings의 겹침 검사가 알리게 하는 쪽
14. `start-failure-screen-no-recovery-path`: `decided`: 문구만

알아 둘 것:
- `packages/shell/renderer/conversation/`은 `sweep-phone-chat`, `renderer/shell/left-sidebar-workspaces.ts`는 `sweep-phone-lists`, `app-detail/machines-section.tsx`는 `sweep-folder-identity`, `desktop/settings/providers/`는 `sweep-core-agent`의 것이다.
- 화면을 바꾸면 gallery(`npm run wireframes`)가 되는지 본다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: 이슈의 `fix`가 "test를 쓴다"고 한 것과 데이터·권한에 닿는 것만(`write-test` skill). 나머지는 없음
- 이슈마다 고쳤는지, 못 고쳤으면 왜인지가 보고에 있다.

## 보고

- 이슈마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
