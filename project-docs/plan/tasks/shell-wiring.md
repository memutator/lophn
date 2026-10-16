# shell-wiring

`packages/shell/main/desktop/main.ts`(1,688줄)를 영역별 등록 file과 짧은 조립 file로 쪼갠다. 동작은 바꾸지 않는다. wave 3에서 여러 단위가 shell main 등록을 동시에 고쳐도 같은 file에서 부딪치지 않게 하는 것이 목적이다.

- 단위: shell-wiring (wave 0)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/main.ts`
  - `packages/shell/main/desktop/wiring/`(새로)
- 읽을 것:
  - `../orchestrator.md` 6장(등록 file은 lead), `../ownership.md`(wave 3에 이 file들을 받을 단위)
  - 같은 일을 core에 하는 `core-wiring-split.md`의 꼴(약속 type, 순서 제약)
  - 지금 `main.ts`의 구획: core 연결(약 324~380줄), 앱 view·frame·visibility·view IPC(388~503), 앱 호출·외부 링크·view 오류·앱 IPC(504~575), feedback(581~694), 확인 창(771~823), 앱 창(831~960), coding·터미널(961~1064), restore·update(1065~1103), layout(1104~1116), 폴더 고르기·외부 열기·windowless 확인 등 handle(1117~1186), 편집기(1187~1247), 종료·수명·단일 instance·launch mode·창(1248~1688)
- 계약:
  - 쓰는 것: 지금의 `packages/shell/ipc/*`, preload, `desktop/core/*`. 바꾸지 않는다.
  - 내놓는 것: `wiring/context.ts`의 `ShellContext`(공용 값: `core`, `coreInternal`, `windows`, `log`, `dataRoot`, `headless`, `overlays`, `ipc` 등록 함수)와 영역마다 `register(ctx): Registered` 꼴. `Registered`는 `stop()`을 가진다. `main.ts`는 이 목록을 순서대로 부르고 끝날 때 거꾸로 멈춘다.

## 할 일

1. `wiring/context.ts`에 `ShellContext`와 `Registered` type을 둔다. 지금 `main.ts` 위쪽의 공용 값(`dataRoot`, `headless`, `overlays`, `windows`, `appWindowRefs`, `log`, `core`, `coreInternal`, `windowOfRef`, `shellWindowOf`)을 여기서 만든다.
2. 영역마다 file 하나로 옮긴다. 이름과 wave 3에 받을 단위는 이렇다.
   - `wiring/core.ts`: core 연결과 상태 relay → platform
   - `wiring/app-views.ts`: app views, frame, visibility, view IPC, 외부 링크, view 오류, 앱 창, `openIntent`, `refreshAppViews` → screens-app-space
   - `wiring/app-calls.ts`: `createAppCall`, `createAppConnector`, `registerAppIpc`, blueprint 읽기 → app-calls
   - `wiring/feedback.ts`: feedback → releases-problems
   - `wiring/confirmation.ts`: 확인 창 coordinator와 windowless 확인 → screens-data
   - `wiring/coding.ts`: coding 연결, coding 시작, 터미널 supervisor, 터미널·coding IPC → coding-agent
   - `wiring/restore-update.ts`: restore와 update IPC, OS notification → remove-platform(지운다)
   - `wiring/layout.ts`: layout store, layout IPC, live view, view hint → screens-project
   - `wiring/editor.ts`: file adapter, close guard, editor IPC, 지침 → screens-project. restorer, creator, placer 줄은 wave 1에 remove-documents가 지운다.
   - `wiring/desktop.ts`: 폴더 고르기, 외부 열기, 단축키, 단일 instance, launch mode, 창 열기, 종료 흐름 → platform
3. `main.ts`는 `ShellContext`를 만들고 위 `register`를 정해진 순서로 부른 뒤, `will-quit`과 `before-quit`에서 거꾸로 `stop()`을 부르는 조립만 남긴다. 순서는 지금 `main.ts`의 실행 순서를 그대로 지킨다. 특히 core 연결 → app views → 나머지, 단일 instance 확인 뒤 창 열기 순서다.
4. 영역끼리 직접 import하지 않는다. 서로 필요한 값(예: `appViews`를 coding이 쓴다)은 `ShellContext`에 칸으로 올리거나, `register`가 돌려주는 값을 `main.ts`가 다음 `register`에 넘긴다.
5. 한 영역을 옮길 때마다 commit한다. 중간에 끊겨도 이어 갈 수 있다.

## 끝남

- `deno task check`가 통과한다(shell 단계에 `tsc`와 desktop core `deno check`가 들어 있다).
- `npm --prefix packages/shell/main run build`가 된다.
- 기동 확인: 쪼개기 전과 뒤에 `LOPHN_SHELL_HEADLESS=1`로 shell을 띄워(개발 data root) 창이 열리고 core 연결 상태가 `ready`가 되는지 본다. 기준선에서 먼저 돌려 본다.
- 위험 test: 없음(동작을 바꾸지 않는다)
- 남지 않음: `main.ts`에 `ipcMain.handle`이 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음(`main.ts`는 이 task 뒤 lead 소유가 된다)
- 영역 경계에서 애매했던 줄과 어느 file에 두었는지
- 영역 사이에 오가는 값 목록(`ShellContext` 칸)
