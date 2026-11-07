# app-place

- 목표: 앱 화면 선언을 "화면(인자를 받는 앱의 부분)과 자리(`places`)"로 바꾼다. 그 위에 전역 float, 작업 표시줄, 오른쪽 sidebar 등록과 앱 sidebar panel, 앱 tray를 올린다.
- 재료: `project-docs/products/roadmap/app-place.md`, `project-docs/architecture/workspace-layout.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/app-notice.md`, `project-docs/architecture/ui-kit.md`
- 범위 밖:
  - 앱 화면 안 link로 다른 화면 열기
  - OS tray(`packages/shell/main/desktop/tray.ts`)
  - extension 묶음(`ExtensionContext`) API
  - 크기 bucket
  - workflow engine 옮기기
  - Masup·Mahas 고치기(앱 일)
  - 새 activity bar 모양. 지금 title bar 오른쪽 icon tab이 그 자리다.
- 단위: `place`(선언, 인자), `shell`(전역 float, 작업 표시줄, sidebar), `tray`

## 정한 것

1. `sizes` → `places`, `full` → `tab`이고 새 값은 `sidebar`, `tray`다(사람, roadmap 정한 것 3). `@lophn/declaration`은 4.0.0이다.
   - ledger `releases.declaration`은 schema step으로 옮긴다.
   - 봉인된 옛 bundle은 manifest hash가 묶여 옮길 수 없다. 그래서 새 판에서 뜨지 않고, 앱을 다시 release해야 한다(agent, 0.14.0·0.18.0 선례). 사람의 앱 Mahas와 Masup도 같다.
2. `@lophn/app-ui`는 wave 1에서 declaration pin 때문에 2.3.0, wave 2에서 `usePlace()`로 2.4.0이 된다(agent). 같은 판 번호로 bytes를 바꾸지 않는다(0.14.0).
3. 자리는 열린 view 하나에 고정이다(agent). dock, desk float, 전역 float는 모두 `panel`이다. 그래서 자리 바뀜 event를 두지 않고, 화면은 열릴 때 URL query로 `place`, `params`, `workspace`를 받는다. roadmap의 "자리가 바뀌면 알린다"는 바뀌는 경우가 없어 버린다.
4. 화면은 지금 workspace(`{kind, id, folders}`)를 안다(agent).
   - 앱 sidebar panel은 workspace 종류를 가리지 않고 모든 sidebar에 나온다. 화면이 workspace를 보고 맞춘다.
   - 선언에 workspace 종류 칸을 더하지 않는다.
5. 전역 float는 `panel` 자리 앱 화면만 된다(agent). 다른 탭 kind(파일, 터미널, session)는 workspace에 묶여 있다.
6. 전역 float의 위치는 이렇게 정한다(agent).
   - 전역 float는 desk float 위 층이다.
   - float bar 단추 하나로 desk float ↔ 전역 float를 옮긴다.
   - QuickLaunch의 앱 panel 단추는 그 화면이 전역 float면 그것을 펼친다.
7. 전역 float 저장은 `<data>/shell/global-floats.json`이다(main store, IPC, preload)(agent). workspace layout 파일은 바꾸지 않는다. 접힘, rect, pin이 workspace와 재시작을 넘는다(사람, roadmap 정한 것 11).
8. 전역 float의 `<webview>` 그릇은 renderer `Desktop`에 창마다 하나 둔다(agent). 지금 그릇은 `WorkspaceWindow`마다 새로 생겨서 workspace를 옮기면 다시 load된다. `workspace-layout.md`의 "창마다 하나"는 틀렸고, lead가 고친다.
9. 작업 표시줄은 `.shell` 맨 아래 줄이다(agent). `.body` 밖이라 float가 덮지 않는다. `shell.taskbar` 기본은 켬이고, Settings › Appearance의 Switch로 바꾼다.
10. tray 값은 앱 process가 `@lophn/cap-notify`의 `setTray`로 낸다(권한 `notify.send`)(agent). 새 SDK package와 새 permission kind를 만들지 않는다. core는 마지막 값을 memory에 둔다. 앱 process가 오래 살아서 다시 켜면 다시 낸다. shell에는 transient event와 read route로 준다.
11. 어떤 앱 화면이 sidebar·tray에 나오는지는 사람이 켠다(agent). 설정은 `shell.sidebar_panels`와 `shell.tray`(각 `{app, screen}[]`)이고, Settings › Quick launch pane의 목록과 Switch로 켠다.
12. 오른쪽 sidebar 열림은 workspace마다 따로 기억한다(사람, 2026-11-07). localStorage key에 workspace key를 붙인다. 왼쪽 열림과 폭은 그대로 쪽마다 하나다. `shell-taskbar`가 한다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `place-declaration` | `sizes`→`places`, `params` schema, ledger step, declaration 4.0.0, 모든 쓰는 곳 |
| 1 | `shell-global-float` | `Desktop` 층과 창 단위 `<webview>` 그릇, `global-floats.json`, float bar 단추, chip |
| 2 | `place-params` | view 열기에 place·params·workspace, URL query, `lophnApp.place`, `usePlace()`, app card params |
| 2 | `shell-taskbar` | 작업 표시줄, chip 옮기기, `shell.taskbar` |
| 3 | `shell-sidebar-slots` | sidebar panel 등록, 앱 sidebar panel, `shell.sidebar_panels` |
| 4 | `tray` | `setTray`, core memory store·event·read, 작업 표시줄 tray와 popup, `shell.tray` |

## lead가 할 일

- merge마다: 보고의 "등록할 것"(protocol `mod.ts`, core wiring 목록, gallery `pages/index.ts`, `package.json`)을 합친다.
- 다 끝나면:
  - `project-docs/architecture/workspace-layout.md`를 고친다: 전역 float, 작업 표시줄, `<webview>` 그릇의 실제 수명, sidebar 등록, 오른쪽 sidebar 열림(줄 37), 앱 화면 자리 줄 128.
  - `app-call.md`(선언 `places`·`params`, SDK pin), `app-notice.md`(tray), `ui-kit.md`(`usePlace`)를 고친다.
  - changelog 0.18.0에 항목을 덧붙이고 roadmap 상태를 고친다.
  - 사람에게 알린다: Mahas·Masup을 `places`로 고쳐 다시 release해야 한다.
