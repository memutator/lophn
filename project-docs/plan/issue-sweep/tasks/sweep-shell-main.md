# sweep-shell-main

shell main의 시작·종료·연결·알림 bug를 고친다.

- 단위: shell-main (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/{quit.ts,main.ts,single-instance.ts,autostart-migrate.ts,window.ts,launch-mode.ts,core/,viewer/}`
  - `packages/shell/main/desktop/wiring/{desktop.ts,notice.ts,desktop-window.ts,machine-windows.ts}`
  - `packages/shell/main/secret-input/`
  - `packages/shell/preload/notice-api.ts`
  - `packages/core/attention/`
  - `packages/protocol/apps/notice.ts`
  - `packages/core/always-on/`
  - `packages/core/main/daemon/main.ts`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `first-start-quit-opens-window`: flows `shell-desktop.yaml`의 그 줄도 고친다
2. `quit-without-window-skips-confirm`
3. `secret-input-loadurl-failure-hangs`
4. `shell-misses-new-core-after-stop`: `attached`를 비우는 것과 30초 identify 둘 다
5. `startup-program-notice-no-toast`
6. `keep-running-notice-waits-for-window`
7. `legacy-autostart-kept-without-systemd`
8. `electron-default-menu-ctrl-r-reload`
9. `machine-window-position-not-saved`
10. `session-reveal-into-new-window-dropped`
11. `push-alert-program-kinds-differ`: 목록을 protocol 하나로. `phone_changed`는 push에 넣지 않는다(바뀌기 전 폰에 가는 알림은 뜻이 없다)
12. `core-entry-own-stderr-logger`

알아 둘 것:
- Windows 전용 갈래는 여기서 돌려 볼 수 없으니 고치지 않는다.
- `desktop/wiring/surface.ts`, `coding.ts`, `terminal-view.ts`는 `sweep-phone-terminal`의 것이다.

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
