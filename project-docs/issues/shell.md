# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 사람이 만든 agent의 home session이 런처에서 lophn 얼굴로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금(uo-home 전): home(workspace 없음) session은 런처의 lophn 패널에서만 열었고 패널은 lophn source 하나만 만들었다. 패널은 없어졌고 Home session은 agent 탭으로 열린다(`packages/shell/renderer/desktop/main.tsx`의 `openSession` → Home의 `WorkspaceWindow`가 `agentRow`로 그 session의 agent를 찾아 연다). 다른 agent의 Home session이 맞게 열리는지 확인하고 닫는다. 사람이 만든 agent의 home session(workspace 없는 `call`, job의 `agent_run`, CLI `lophn agent run --agent <이름>`이 연다)을 열면 그 session을 lophn의 source로 읽는다.

영향: 사람이 그 session을 열면 머리와 composer가 lophn 이름과 얼굴을 보이고, session 목록에도 lophn의 session만 보여 그 agent의 대화를 찾기 어렵다.

고치려면:
- 패널이 연 session의 agent(session store `SessionEntry.agent`)로 source를 고른다(작음, 패널 하나). 런처에서 home의 다른 agent를 고르는 길은 없다.
- 런처에 home의 agent select를 둔다(중간, 화면을 새로 그린다).
- 추천: 앞의 것. 여는 길이 이미 session id라 그 session의 agent를 쓰면 된다.

## 일하는 중 보낸 이미지만 든 사람 메시지가 대기 줄에서 빈 줄로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
```

지금: `MessageReceived` event의 `body`는 글 block만 이은 글이다(`packages/core/lophn-agent/run-loop/work.ts`의 `blocksText(input.body)`). live 경로(`packages/shell/renderer/conversation/agent-tab-data.ts`)는 그 글로 대기 메시지의 `summary`를 채운다. 그래서 agent가 일하는 중에 이미지만 붙여 보낸 메시지는 snapshot을 다시 읽기 전까지 대기 줄이 비어 있다. snapshot 경로는 본문 part로 `[image]`를 보인다.

영향: 사람은 방금 보낸 메시지가 대기 줄에 빈 줄로 보여 무엇을 보냈는지 알아보지 못한다. 데이터는 잃지 않는다.

고치려면:
- event의 `body`를 `blocksSummary(input.body)`로 채운다(작음, core 한 줄). live 메시지 목록도 본문을 읽기 전까지 `[image]`를 보인다.
- event에 block을 싣는다(중간, event 계약이 바뀐다).
- 추천: 앞의 것.

## 앱·project 설정에 이름 바꾸기와 보관이 없다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: 보관과 되살리기는 Home 오른쪽 sidebar의 Workspaces panel(`packages/shell/renderer/shell/workspaces-panel.tsx`)에서만 된다. 줄 위 ⋯ menu의 Archive, "Archived N"의 Unarchive다. project 이름은 project 설정 탭 General(`packages/shell/renderer/workspace/project-settings/project-settings-page.tsx`)과 panel의 Details에서 바꾸지만 보관은 없다. 앱 상세(`packages/shell/renderer/app-frame/app-detail/app-detail.tsx`)는 아이콘·폴더·Version·Access·Activity뿐이라 이름도 보관도 없다. core에는 `app.rename`(`packages/protocol/apps/apps.ts`)이 있는데 부르는 화면이 없다.

영향: 사람은 그 앱·project 안에서 이름을 바꾸거나 보관하지 못하고, Home으로 가서 숨은 ⋯ menu를 찾아야 한다. 앱 이름은 아예 바꾸지 못한다.

고치려면:
- project 설정 General 맨 아래에 Archive(secondary), 앱 상세 맨 위에 General 칸(이름 바꾸기 `app.rename`, Archive)을 둔다. 지금 들어와 있는 workspace를 보관하면 Home으로 옮긴다. Workspaces panel의 ⋯ menu는 빠른 길로 둔다(작음, renderer와 gallery만).
- 추천: 이것.

## 기동 때 쓴 program 기록의 toast가 뜨지 않는다

```yaml
kind: bug
modules: [packages/shell/main, packages/core/main]
```

지금: `noticesWiring.afterReady`가 쓰는 program 기록(`sdk_update_needed`)의 `NoticePosted`는 shell main이 받지 못한다. `afterReady`는 core가 부모(shell main)에게 hello를 보내기 전에 돌고(`packages/core/main/daemon/core.ts`), shell의 Gateway 구독은 hello 뒤에 열려서 그 event는 구독이 없을 때 나간다. 놓친 알림은 다시 띄우지 않는다. 확인했다(코드 순서). sdk-forest 변경으로 배지가 안 읽은 기록을 세어 사람이 몰라서 못 보는 일은 줄었다.

영향: 기동 중에 쓴 필수 알림(SDK 업데이트 필요)은 toast·OS 알림이 없다. 배지와 History로만 보인다.

고치려면:
- 기동 뒤 Gateway가 붙으면 안 읽은 급한 program 줄(`sdk_update_needed`, `app_unavailable`)을 `notices.open`으로 읽어 toast로 한 번 보인다(작음).
- 추천: 이것. 배지가 있으니 급하지는 않다.

## `--quit`이 창이 없으면 도는 터미널을 확인 없이 끈다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: second-instance의 `--quit`는 `requestQuit`(`packages/shell/main/desktop/quit.ts`)로 간다. 창이 하나라도 있으면 `quitFlow.request`가 도는 터미널·저장 중인 문서를 묻지만, 창이 없으면(tray에 남아 창만 다 닫은 상태. `window-all-closed`는 아무것도 안 한다) 확인 없이 `stop`을 부른다. 그런데 `QuitWork.runningTerminals`는 창과 무관하게 PTY 수를 센다(`wiring/desktop.ts`의 `createQuitFlow`). 같은 상황에서 tray의 Quit은 `quitFlow.request`라 창 없이도 묻는다(`dialog.showMessageBox`는 parent 없이 뜬다). 저장 중인 문서는 창과 함께 사라지므로 창이 없으면 없다.

영향: 창을 닫아 둔 채 tray로 돌고 있는 터미널(agent TUI 포함)이 `lophn --quit` 한 번에 확인 없이 끝난다. 같은 일을 tray Quit으로 하면 묻는다.

고치려면: 창이 없을 때도 `quitFlow.request`를 쓴다. headless처럼 dialog를 띄울 수 없는 실행만 `stopNow`로 간다(작음, `requestQuit`의 `confirmWithWindows`를 창 유무와 상관없이 부른다). 추천: 이것.

## 첫 시작의 `--quit`가 종료하지 않고 창을 연다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: 떠 있는 shell이 없을 때 `lophn --quit`로 시작하면 이 process가 single-instance lock을 얻고, `wiring/desktop.ts`의 시작부가 `readOpenIntent(process.argv)`를 읽어 `app`이면 앱 창, 아니면 `desktop.open()`을 부른다. `quit` intent는 처리하는 곳이 없어 기본 창이 열리고 tray가 남는다. 처리는 `startSingleInstance`의 second-instance 쪽에만 있다(`single-instance.ts`).

영향: shell을 멈추는 스크립트(설치·업데이트 전 정리)가 이미 꺼져 있는 lophn을 새로 띄운다.

고치려면: 시작부에서 `start.kind === "quit"`이면 창을 열지 않고 끝낸다(작음, `app.quit()`). 추천: 이것.

## 두 번째 shell process가 single-instance lock보다 먼저 core를 확인하고 띄운다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `main.ts`의 `startDesktop`은 `createShellContext`에서 `connectCore`(`wiring/context.ts` → `core/connection.ts`의 `startCoreConnection`)를 만들고, 이 함수는 끝에서 곧바로 `void recover()`를 부른다. `recover`는 `control.identify()`, 이어서 `ensure()`(core가 없으면 띄우고 `productVersion`이 다르면 갈아 띄운다)를 한다. single-instance lock은 그 뒤 `desktop.register`의 `startSingleInstance`에서 잡으므로, lock을 못 얻어 곧 끝날 두 번째 process도 그 전에 core를 건드린다.

영향: 이미 떠 있는 shell 위에서 `--quit`나 `--open-app`, 아이콘 두 번째 클릭이 core를 띄울 수 있다. `Stop lophn`으로 core를 멈춰 둔 shell 옆에서 두 번째 process가 core를 되살리고, 판이 다른 빌드(dev 실행과 설치본)를 두 번째로 켜면 돌고 있는 core를 갈아 띄워 첫 shell의 연결이 끊긴다.

고치려면: lock을 `startDesktop` 맨 앞(context 만들기 전)에서 잡거나, `connectCore`의 `recover`를 lock을 얻은 뒤에 시작한다(작음). 추천: 앞의 것.

## 보호 입력 창의 `loadURL`이 실패하면 열기가 끝나지 않고 앱 입력이 막힌 채 남는다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `openSecretInputWindow`(`packages/shell/main/secret-input/window.ts`)는 `void window.loadURL(SECRET_INPUT_URL).then(reveal)`로 실패를 받지 않는다. 창은 `show: false`로 만들어지고 `blockAppInput`이 부모의 앱·artifact·browser view 입력을 이미 막았다. 로드가 실패하면 `onClosed`·`onCrashed`가 불리지 않아 `registerSecretInputIpc`의 `done`이 불리지 않는다. 그래서 `shell:secret-input-open`의 promise가 끝나지 않고, `active`가 남아 다음 열기는 `conflict`다.

영향: 설치 묶음의 secret-input 페이지가 깨졌거나 protocol 처리에서 로드가 거절되면, API key 연결이 영원히 대기하고 그 창의 앱 view 키 입력이 앱을 다시 켜기 전까지 막힌다. 평소에는 안 일어나지만 보호 창 쪽에는 실패를 알릴 다른 길이 없다.

고치려면: `loadURL(...)`에 `.catch(() => input.onCrashed())`를 붙인다(작음). 추천: 이것.

## 현재 보기 relay(`workspace.*`)는 부르는 쪽이 없고, 끊긴 뒤 다시 켜지지도 않는다

```yaml
kind: defect
modules: [packages/core/server, packages/protocol, packages/shell/main]
```

지금: `packages/core/server/workspace.ts`의 `createWorkspaceRelay`가 `workspace/publish`·`bind`·`unpublish`·`read` 네 route를 core 메모리에 둔다(`protocol/shell/workspace.ts`의 `WORKSPACE_ROUTES`). grep으로 확인한 대로 `workspace/publish`·`bind`·`unpublish`를 부르는 shell 코드가 없고, `workspace.read`(actor `agent`)를 부르는 agent 도구·CLI 명령도 없다. 게다가 `connected`는 `disconnect()`(shell의 Gateway 연결이 끝날 때 `capabilities.ended`, core 종료)에서 false가 된 뒤 true로 돌아가는 곳이 없어, 나중에 publish가 붙어도 shell이 재연결한 뒤 core가 끝날 때까지 publish·bind·unpublish는 `unavailable`이다.

영향: 기능이 하나도 이어져 있지 않아 지금 잃는 사람은 없다. 이대로 두면 반쯤 만든 route 네 개와 redaction·한도 코드가 계속 유지 비용이 되고, 나중에 이어 붙이는 사람이 재연결 뒤 막히는 결함까지 같이 만난다.

고치려면:
- 지운다(중간, protocol route 4개와 `server/workspace.ts`, `runtime.memory`의 연결, 관련 test).
- 이어 붙인다(큼: shell이 창 상태를 publish하고 agent가 읽는 도구를 만든다. 이때 `connected`를 shell이 새로 붙을 때 true로 되돌린다).

정할 것: 지금 agent가 사람 화면을 읽는 기능을 만들 계획이 있는지. 없으면 지우는 쪽을 추천한다(제품 기능을 포기하는 일이라 사람이 정한다).
