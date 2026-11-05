# gui-cleanup

첫 판의 별도 창 길을 지운다. 탭 안 GUI(`tab-gui`)가 들어온 뒤에는 쓰는 곳이 없다: 별도 창(`gui-window.ts`)과 그 renderer route, open intent의 harness-gui 길과 second-instance 연결, `lophn gui` CLI(`LocalContext.cwd`는 남긴다: 새 길이 shell의 cwd를 `lophn hook`으로 넘긴다), 예약 slug `"gui"`, wiring의 옛 창 port(`AcpWindowPort`, `openHarnessGui`, intent 대기 줄). README 정한 것 1(lophn 터미널 탭에서만), 6(hook socket 길).

- 단위: tab (wave 3)
- 선행: tab-gui
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/gui-window.ts`
  - `packages/shell/renderer/harness-gui/`
  - `packages/shell/renderer/desktop/router.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/main/desktop/wiring/desktop.ts`
  - `packages/shell/main/desktop/wiring/extensions.ts`
  - `packages/shell/main/desktop/main.ts`
  - `packages/shell/main/desktop/open-intent.ts`
  - `packages/shell/main/desktop/open-intent_test.ts`
  - `packages/shell/main/desktop/single-instance.ts`
  - `packages/cli/commands/gui.ts`
  - `packages/cli/commands/gui_test.ts`
  - `packages/cli/main.ts`
  - `packages/coding-agent/local/types.ts`
  - `packages/protocol/apps/declaration/types.ts`(`RESERVED_APP_SLUGS`의 `"gui"` 한 줄)
  - `packages/shell/ipc/harness-gui.ts`(옛 창 channel)
  - `packages/shell/preload/harness-gui-api.ts`
  - `packages/shell/preload/shell.ts`(옛 창 API 노출 줄)
  - `packages/shell/main/tsconfig.json`
  - `packages/shell/main/tsconfig.node.json`
  - `packages/protocol/extensions/acp-session.ts`(옛 open intent type `HarnessGuiOpen`·`onOpenIntent`)
- 계약:
  - 쓰는 것: `tab-gui`의 탭 GUI 길(이것만 남는다)
  - 내놓는 것: 없음(지우기)

- 읽을 것:
  - 계획: `project-docs/plan/harness-gui-tab/README.md`의 정한 것 1, 6. `project-docs/plan/harness-gui-tab/tasks/tab-gui.md`(남는 길)
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/code.md` §5(지울 것의 path와 줄 수)
  - architecture: `project-docs/architecture/harness-gui.md`(고치는 것은 lead다)

## 할 일

1. 별도 창.
   - `packages/shell/main/desktop/gui-window.ts`를 지운다. `packages/shell/main/tsconfig.json`의 exclude 줄 `"desktop/gui-window.ts"`(`:21`)도 지운다(소유 밖, "넘길 줄").
   - `packages/shell/main/desktop/main.ts`에서 `guiWindows` register와 port의 `open`을 뺀다.
   - `packages/shell/main/desktop/wiring/extensions.ts`에서 `AcpWindowPort`, `AcpWindowHandle`, `openHarnessGui`, intent 대기 줄(`pending`, `dispatch`)을 지운다. `showExtensionSettings`는 탭 길(`packages/shell/main/terminal/gui.ts`)이 쓰므로 남긴다.
2. renderer route. `packages/shell/renderer/harness-gui/`(창과 feed)를 지운다. `packages/shell/renderer/desktop/router.ts`의 `harness-gui` space와 `openHarnessGui()`, `entry.tsx`의 `#harness-gui=` hash 처리, `main.tsx`의 harness-gui 그리기 분기(이 창만 ToastHost·DesktopIntents를 빼던 줄 포함)를 지운다.
3. open intent.
   - `packages/shell/main/desktop/open-intent.ts`: `{kind: "harness-gui"}`, `HARNESS_GUI_FLAG`·`CWD_FLAG`·`RESUME_FLAG`, `=` 꼴을 읽는 helper와 주석의 harness-gui 줄을 지운다. `--open-app`·`--quit`은 그대로다.
   - `open-intent_test.ts`: harness-gui case를 지우고 남는 case는 둔다.
   - `single-instance.ts`의 `onOpenHarnessGui`와 주석, `packages/shell/main/desktop/wiring/desktop.ts`의 `harnessGui` 인자, second-instance 연결, 첫 시작의 harness-gui 분기를 지운다.
4. `lophn gui`. `packages/cli/commands/gui.ts`와 `gui_test.ts`를 지우고 `packages/cli/main.ts`의 `all`에서 `GUI_COMMANDS`를 뺀다. `packages/protocol/apps/declaration/types.ts:239` `RESERVED_APP_SLUGS`의 `"gui"`를 뺀다(명령 낱말이 아니게 됐다). `domain-names_test`가 통과하는지 본다.
5. `LocalContext.cwd`(`packages/coding-agent/local/types.ts`)와 `packages/cli/main.ts`의 `cwd: process.cwd()`는 tab-gui가 hook의 gui 요청에 cwd를 실으면(tab-gui 할 일 1) 남긴다. 쓰는 곳이 없을 때만 지운다. 어느 쪽인지 보고한다.
6. 첫 판 창의 IPC와 preload. `packages/shell/ipc/harness-gui.ts`의 창 channel(tab-gui가 더한 탭 channel 말고)과 `packages/shell/preload/harness-gui-api.ts`의 창 method가 쓰는 곳이 없어진다. 두 file과 `packages/shell/preload/shell.ts`의 노출 줄, `packages/protocol/extensions/acp-session.ts`의 `HarnessGuiOpen`·`onOpenIntent`는 wave 3에서 이 task 소유다. 쓰는 곳이 없어진 것을 지운다.
7. 지운 이름과 문구를 grep해 주석과 오류 문구에 남은 것을 고친다. 창만 쓰던 i18n key가 있으면 지우고 보고한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(지우기). 남는 `open-intent_test.ts`의 `--open-app`·`--quit` case가 통과한다.
- 남지 않음:
  - `grep -rn -- "--harness-gui\|openHarnessGui\|onOpenHarnessGui\|AcpWindowPort\|AcpWindowHandle\|gui-window\|HARNESS_GUI_FLAG\|GUI_COMMANDS" packages tools`가 0줄이다.
  - `grep -rn "lophn gui" packages tools`가 0줄이다.
  - `grep -rn '"harness-gui"' packages/shell/renderer/desktop`가 0줄이다.
  - `LocalContext.cwd`는 할 일 5대로다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 할 일 5와 6에서 어느 쪽을 택했는지 적는다.

등록할 것(lead): 없음. 지운 export와 i18n key가 있으면 보고한다.
