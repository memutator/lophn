# coding-shell

shell(main, terminal host, renderer)에서 lophn이 띄우는 coding session에만 쓰이는 갈래를 지운다: core가 Gateway frame으로 보내는 coding 터미널 열기·입력·멈춤, coding 터미널 hook을 core로 넘기기, 대기 목록의 coding 항목, 앱 공간의 coding 터미널 탭, Settings의 coding 기본 harness·model. 사람이 연 터미널의 agent 층(hook socket, tracker, 탭 icon·점·알림, hook 설치 물음, Settings › Coding agents의 감지·설치)은 남긴다.

- 단위: coding (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/coding` (지운다)
  - `packages/shell/main/terminal/{ipc,supervisor}.ts`
  - `packages/shell/main/terminal/agent/{tracker,ingress,hook-ask}.ts`
  - `packages/shell/main/desktop/wiring/{coding,agent,notice,desktop}.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/shell/main/notice/{rule,rule_test}.ts`
  - `packages/shell/main/workspace/kinds/terminal.ts`
  - `packages/shell/ipc/terminal.ts`
  - `packages/shell/terminal-host/{launch-plan,main}.ts`
  - `packages/shell/renderer/terminal/store.ts`
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/app-frame/app-space.tsx`
  - `packages/shell/renderer/conversation/{agent-tab-core-source-sessions,agent-tab-core-source-thread,agent-tab-data,agent-tab-fake-source}.ts`
  - `packages/shell/renderer/desktop/connection/events/{sessions-store,waiting-store,waiting-store_test}.ts`
  - `packages/shell/renderer/desktop/connection/waiting/{fake-source,finished,model}.ts`
  - `packages/shell/renderer/desktop/connection/waiting/{waiting-panel,cards/head,cards/coding-card}.tsx`
  - `packages/shell/renderer/desktop/settings/connections` (coding 기본 harness·model 칸)
  - `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/shell/terminal-host/{cli,coding-types}.ts`
  - `packages/shell/main/terminal/controller.ts`
  - `packages/shell/preload/terminal-api.ts`
  - `packages/shell/main/terminal/agent/agent_test.ts`
  - `packages/shell/renderer/terminal/use-terminal-open-requests.ts`
  - `packages/shell/renderer/terminal/{terminal-tab,exit-banner}.tsx`
  - `packages/shell/renderer/desktop/{main,entry}.tsx`
  - `packages/shell/renderer/desktop/connection/waiting/waiting-layer.tsx`
  - `packages/shell/renderer/desktop/settings/settings-space.tsx`
  - `packages/shell/renderer/desktop/launcher/launcher.tsx`
  - `packages/shell/renderer/desktop/connection/events/hooks.tsx`
  - `packages/shell/renderer/app-frame/side-panel.tsx`
  - `packages/shell/ipc/coding.ts`
  - `packages/shell/main/desktop/coding-connection.ts`
  - `packages/shell/renderer/desktop/settings/general/model.ts`
  - `tools/wireframes/mock/{fake-terminal,app-space/coding-terminal}.ts`
  - `tools/wireframes/pages/screens/{settings-frame,questions,app-space}.tsx`
  - `tools/wireframes/pages/screens/app-space/{space,pages}.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/terminal-agent.md` 전부. 남기는 층이다: hook socket(`LPN_TERMINAL_HOOK`), foreground 감지, tracker 상태, 탭 icon·점, 알림과 그 누름(`TERMINAL_REVEAL_CHANNEL`), Finished 줄, hook 설치 물음, Settings › Coding agents의 감지·설치.
  - architecture: `project-docs/architecture/coding-agent.md`의 "흐름"과 "지키는 것" 가운데 shell 쪽. 지우는 것이다: Gateway frame open·input·stop, `codingTerminalHook`, app space 패널의 coding 탭, 첫 신호 대기(`coding_start`), 대기 목록의 harness 물음, idle일 때 PTY에 넣기, 맡길 수 있는 제품과 기본 실행 옵션.
  - architecture: `project-docs/architecture/browser-tab.md`의 "coding 탭은 `BROWSER`를 받지 않는다" 줄과 `wiring/coding.ts`가 bridge를 만든다는 줄(bridge는 남는다).
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `coding-agent-harness-api`. `project-docs/module-catalog.yaml`의 `packages/shell/main`·`packages/shell/renderer`·`packages/shell/preload`·`packages/shell/ipc`·`packages/shell/terminal-host`(boundary `shell`)와 `tools`.
  - 계획: `project-docs/plan/remove-role/README.md`의 "범위 밖"(터미널 agent 층)과 "뼈대 검토"의 coding 갈래 줄(사람이 앱 공간이나 project에서 연 터미널은 남긴다)·wording catalog 줄(wave 1은 catalog를 고치지 않는다). `project-docs/plan/remove-role/tasks/coding-core.md`(이 task 뒤에 protocol file을 지운다).
  - 코드(남기는 것과 지우는 것이 한 file에 섞인 곳): `packages/shell/main/desktop/wiring/{coding,agent,notice}.ts`, `packages/shell/main/terminal/agent/{ingress,tracker,hook-install,agent_test}.ts`, `packages/shell/main/desktop/coding-connection.ts`, `packages/shell/ipc/{terminal,coding}.ts`, `packages/shell/terminal-host/{main,cli}.ts`, `packages/shell/renderer/terminal/{store.ts,terminal-tab.tsx,exit-banner.tsx}`, `packages/shell/renderer/desktop/connection/events/waiting-store.ts`, `packages/shell/renderer/desktop/settings/connections/connections-panel.tsx`.
- 계약:
  - 쓰는 것: 지금의 `packages/protocol/coding-agent/*`. 이 task는 protocol을 고치지 않는다(`coding-core`가 지운다).
  - 내놓는 것: shell은 `packages/protocol/coding-agent/{terminal-requests,launch-plan,transport,token,message,mcp,mcp-launch}.ts`와 `packages/protocol/events/gateway.ts`의 coding 터미널 frame을 import하지 않는다. 그래서 `coding-core`가 그것들을 지울 수 있다. 옛 `CallAgent`의 `coding_agent` 가지와 `coding_agent` actor는 protocol에 남아 있어 type은 그대로 쓴다(wave 3·4가 지운다).

## 할 일

선: 지우는 것은 lophn(core 요청)이 띄운 coding 터미널과 그 session에만 쓰이는 것이다. 남기는 것은 사람이 project 창 Workspace에서 연 터미널 탭이 쓰는 모든 것이다: hook socket과 key, foreground 감지, tracker, 탭 icon·점, toast·OS 알림과 누르면 그 탭 고르기(`onSelect`·`reveal`), Finished 줄, hook 설치 dialog, Settings › Coding agents의 감지·[Detect again]·Hooks 칸·[Install hooks]·Turn-end 칸. 앱 공간의 터미널 탭은 core 요청으로 열린 coding 터미널만 받았고 사람이 앱 공간에서 터미널을 여는 길은 없어서 통째로 지운다.

‡ 표시 file은 뼈대 소유에 없다. lead에게 보고했고, lead가 소유에 더한 뒤 고친다. 소유에 없는 채로 띄워졌으면 그 단계는 하지 말고, 할 수 있는 데까지 한 뒤 보고에 적는다.

### A. main과 terminal host: core가 연 coding 터미널

1. `packages/shell/main/terminal/coding/`(`requests.ts`)를 지운다. Gateway frame `coding_terminal`의 open·input·stop 처리, core `coding_agent_terminals/result`·`exited` 보고, 붙여 넣기 구간 입력과 focus가 풀릴 때까지 쥐기가 여기 있다.
2. `packages/shell/main/desktop/wiring/coding.ts`:
   - 지운다: `createCodingTerminalRequests` import, `codingTerminals`(만들기, `Coding` type 칸, return 칸), `ctx.relay.frames.push(...)`의 `coding_terminal` 처리, `createTerminalIpc`의 `coding:` 칸, `detectOnConnect` interval과 `stop()`의 `clearInterval`(core가 맡기기를 `not_connected`로 거절하지 않게 감지를 미리 알리던 것이다), `canLaunch` import와 `catalog.facts`의 `can_launch`, `createHarnessSettings`의 `core:` 칸(D2와 같이).
   - 남긴다: supervisor, hook asker와 installer(사람 터미널이 harness를 처음 알아봤을 때 `ensureOnce`, Settings [Install hooks]), bridge, notice, agent wiring, terminal IPC, Settings coding IPC(`registerCodingIpc`), `harnessLabel`, `projectFolders`, mock 폴더.
   - file 이름과 `register` export는 그대로 둔다(`packages/shell/main/desktop/main.ts`가 부른다). 머리 주석과 installer 주석에서 coding 탭을 뺀다.
3. `packages/shell/main/desktop/wiring/agent.ts`: ingress의 `onHook`은 `tracker.hook`만 부른다. core `coding_agent_terminals/hook`으로 넘기는 덩어리를 지운다. `hooks.bind`는 `(key, ref)`다. 머리 주석의 "coding 터미널의 hook은 core에도 넘긴다"를 지운다. 알림 `notify`의 `place`는 `basename(runtime?.cwd_at_start ?? "")`만 쓴다(B1에서 `runtime.title`이 없어진다).
4. `packages/shell/main/terminal/agent/ingress.ts`: `RoutedHook.session`, `TerminalHooks.bind`의 세 번째 인자, routes 표 값의 `session`을 지운다. 주석 "terminal IPC와 coding 요청이 hook 길을 부르는 모양"을 "terminal IPC가"로 고친다.
   - ‡ `packages/shell/main/terminal/agent/agent_test.ts`: ingress test의 `ingress.bind(KEY, "term_1", "ses_1")`을 `ingress.bind(KEY, "term_1")`로, 기대 값에서 `session: "ses_1"`을 뺀다. 이 test가 지키는 것(모르는 key, 긴 줄, 깨진 줄, 회수한 key를 버린다)은 그대로 둔다.
5. `packages/shell/main/terminal/agent/tracker.ts`: `registerCoding`(type과 구현)을 지운다. `fresh(harness, true)`는 foreground 길이 그대로 쓴다.
6. `packages/shell/main/terminal/agent/hook-ask.ts`: 고칠 것이 없다. Settings 설치 결과는 terminalRef 없이 마지막 focus 창에 가고 `running`은 false다. 주석에 coding 탭이 있으면 그 말만 뺀다.
7. `packages/shell/main/terminal/supervisor.ts`: `request()`의 revive 조건에서 `"open-coding"`을, restart의 `coding_tui` 거절 가지를 지운다.
8. `packages/shell/terminal-host/main.ts`: `HostRequest`의 `open-coding`, input의 `from_core`, `HostDeps.coding`과 `CodingHost` import, `bySession`, `startCoding`, `endPrompt`와 그 호출(`onExit`, 종료 정리), input의 첫 prompt 표시, restart의 `coding_tui` 거절, `foregroundChanges`의 `launch_kind !== "shell"` 조건(남는 조건은 `state !== "running"`)을 지운다. `start`의 runtime에서 `launch_kind`를 뺀다(B1).
9. `packages/shell/terminal-host/launch-plan.ts`를 지운다. ‡ `packages/shell/terminal-host/coding-types.ts`를 지운다. ‡ `packages/shell/terminal-host/cli.ts`에서 `createCodingHost` import와 `coding: createCodingHost(),` 줄을 뺀다.
10. `packages/shell/main/desktop/core/allowlist.ts`: `"memory:coding_agent_harnesses/list"`와 머리 주석의 그 줄(`coding_agent_harnesses`, `coding_agent_terminals`)을 지운다.
11. `packages/shell/main/workspace/kinds/terminal.ts`: layout의 `coding` 칸과 `title` 주석의 "coding 탭은 `coding.title`을 쓴다", restore 주석의 coding session을 지운다. 저장된 layout에 `coding`이 있으면 strict parse가 거절하지만, coding session을 여는 길이 없어 실제 data에는 없다.
12. `packages/shell/main/desktop/wiring/desktop.ts`: quit 확인의 `coding.terminals`만 쓴다. `Coding` type이 바뀌어도 type check가 통과하면 고칠 것이 없다.

### B. shell IPC: 터미널 runtime과 session으로 탭 고르기

1. `packages/shell/ipc/terminal.ts`에서 지운다.
   - `terminalFocusSessionSchema`, `TerminalFocusSession`, `TerminalApi.focusSession`, `TERMINAL_FOCUS_SESSION_CHANNEL`. 대기 목록 coding 카드의 [Answer in terminal]만 썼다.
   - `PromptOutcome`, `TerminalCodingSession`, `TerminalRuntime`의 `launch_kind`, `coding_session`, `title`, `product`(정한 것).
   - `TerminalFailure`의 `"no_terminal"`.
   - `onRuntime` 주석의 "(coding 탭 포함)".
   - 남긴다: `TerminalAgent`와 `agent` 칸, `TerminalReveal`·`onReveal`, bridge 칸과 채널, 나머지 채널.
2. `packages/shell/main/terminal/ipc.ts`: `TerminalIpc.focusSession`(type과 구현), `coding?` dep, `terminalFocusSessionSchema`·`TerminalFocusSession` import, `runningStub`의 `launch_kind`를 지운다.
3. ‡ `packages/shell/main/terminal/controller.ts`: `TERMINAL_FOCUS_SESSION_CHANNEL`을 import와 등록·해제 목록에서 뺀다. "terminal 채널 열 개" 주석을 맞춘다.
4. ‡ `packages/shell/preload/terminal-api.ts`: `focusSession` 줄과 그 channel import를 뺀다.

### C. renderer

1. ‡ `packages/shell/renderer/terminal/use-terminal-open-requests.ts`를 지운다. core 요청으로 열린 coding runtime을 탭으로 옮기던 hook이다.
2. `packages/shell/renderer/terminal/store.ts`:
   - 지운다: `TerminalEntry.session`, `Persisted.session`(sessionStorage 모양), `requestFromCore`, `tabOfSession`, `focusSession`, `adopt`의 `session`, `update` 기본값의 `session`, load·save의 session, `TerminalOpenRequest` import.
   - 남긴다: `onSelect`와 `reveal`(OS 알림·toast를 누르면 그 터미널 탭을 고르는 길, `terminal-agent.md` "알림"), `agentOf`, `agentTitleOf`, `noteTitle`.
3. ‡ `packages/shell/renderer/terminal/terminal-tab.tsx`: `coding` prop과 그 가지(main이 연 runtime에만 붙기, `codingEnded`, restart 단추 숨기기, `data-coding-session`, "side panel의 coding 터미널" 주석)를 지운다. ‡ `packages/shell/renderer/terminal/exit-banner.tsx`: `session_ended` 상태와 그 note를 지운다.
4. `packages/shell/renderer/workspace/kinds/terminal.tsx`:
   - 지운다: `codingOf`, `codingTabIcon`, `openCodingTerminal`, `TerminalOpenRequest` import, `fromStored`의 coding 가지, `toStored`의 `coding` 칸(이제 `auto`가 있으면 늘 `title`을 저장한다), `runtimeOf`와 `receive`의 `session`, `render`의 `coding` prop.
   - `iconOf`는 `agentTabIcon`만 쓴다. 사람이 띄운 harness의 vendor icon과 `dotOf`는 남는다. 안 쓰게 된 import(`vendorOf` 등)를 지운다. 이름 주석의 "coding session 제목"을 뺀다.
5. `packages/shell/renderer/workspace/workspace.tsx`: `useTerminalOpenRequests(...)` 덩어리, `openCodingTerminal`과 hook import, `WaitingLayer`의 `onAnswerInTerminal`을 지운다. `terminal.store.onSelect` effect는 알림 누름(reveal)이 쓰니 남기고, 주석 "대기 목록 카드가 터미널 session을 고르면"을 "알림을 누르면"으로 고친다.
6. `packages/shell/renderer/app-frame/app-space.tsx`:
   - 지운다: `coding` state, `useTerminalOpenRequests` 덩어리, coding 탭 `onSelect` effect, `terminalShown`과 `tabs`의 `"terminal"`, `closeTab`의 터미널 가지, `opened` state, `SidePanel`에 넘기던 `coding`·`opened`·`onOpenedClose`, `WaitingLayer`의 `onAnswerInTerminal`, prop `terminal`(이제 쓰는 곳이 없다)과 `closeTerminalTab`·`TerminalDeps` import.
   - `latestSession`의 `item.agent.role !== "coding_agent"` 거르기는 `keyOf`의 type이 요구하면 남긴다.
   - 머리 주석의 "coding 터미널이 탭이다"를 뺀다.
   - ‡ `packages/shell/renderer/app-frame/side-panel.tsx`: `PanelTab`의 `"terminal"`, `PaneTerminal`, prop `coding`·`opened`·`onOpenedClose`, 터미널 몸, `app-space.title.coding-opened` toast, `useTerminalDot`, `Head`의 terminal 탭과 안 쓰게 된 import를 지운다. 머리 주석을 맞춘다.
   - ‡ `packages/shell/renderer/desktop/main.tsx`: `AppSpace`에 `terminal`을 넘기지 않는다(project 창 Workspace와 `DetachedSpace`에는 그대로 넘긴다). `focusRequest` state와 effect, `answerInTerminal`, `SettingsSpace`·`Launcher`에 넘기던 `onAnswerInTerminal`을 지운다.
7. 대기 목록:
   - `packages/shell/renderer/desktop/connection/events/waiting-store.ts`:
     - 지운다: `WaitingEntry`의 `"coding"`과 `"coding_start"`, `STARTING_QUIET_MS`, `Timer`와 `createWaitingStore`의 `timer` 인자, `waitingStart`·`done`·`stopWaitingStart`·`waitStart`·`watchStart`·`startsWithSessionStart`, `HOOK_EVENT_TABLE`·`HarnessId` import, `replace`의 coding snapshot 줄과 `coding_start` 남기기.
     - `permission()`의 kind는 늘 `"permission"`이다. `SessionStarted`는 `sessions` 표만 채운다. `SessionEnded`는 할 일이 없어지니 `WAITING_CONDITION`과 `apply`에서 뺀다.
     - 남긴다: `noteFinished`, `FinishedTerminal`, `terminals.onRuntime` 구독(사람 터미널의 Finished 줄). `FinishedTerminal.title`은 시작 폴더 이름이다.
   - `events/waiting-store_test.ts`와 ‡ `packages/shell/renderer/desktop/connection/events/hooks.tsx`: `createWaitingStore`의 `timer` 인자를 뺀다.
   - `waiting/model.ts`: `cardOf`의 `coding_start`·`coding` 가지를 지운다. `permissionView`의 `harness` 가지와 `AGENT_LABELS.coding_agent`는 남긴다(정한 것).
   - `waiting/waiting-panel.tsx`: `GROUPS`의 permission kinds를 `["permission"]`로 줄이고, `CodingCard` import와 가지, prop `onAnswerInTerminal`을 지운다. Finished 줄의 harness vendor icon은 남는다.
   - `waiting/cards/coding-card.tsx`를 지운다. `waiting/cards/head.tsx`의 `FACES.coding_agent`는 `CallAgent` type이 요구해 남긴다. 그 밖에 고칠 것이 없으면 그대로 둔다.
   - ‡ `packages/shell/renderer/desktop/connection/waiting/waiting-layer.tsx`, ‡ `packages/shell/renderer/desktop/settings/settings-space.tsx`, ‡ `packages/shell/renderer/desktop/launcher/launcher.tsx`: prop `onAnswerInTerminal`과 넘김을 지운다.
   - `waiting/fake-source.ts`: `CODING_SESSION`, `CODING_ASK`, `allItems`의 `CODING_ASK()`를 지운다.
   - `waiting/finished.ts`: 주석 "coding agent session은 터미널 쪽이 알린다. main의 unseen에도 들지 않는다."를 지금 뜻(`unseen`이 없는 session은 줄이 없다)으로 고친다. 터미널 줄은 그대로다.
8. `packages/shell/renderer/desktop/connection/events/sessions-store.ts`: `SessionStarted`의 base는 늘 `"idle"`이다. `coding_agent`면 `"unknown"`이던 가지를 지운다.
9. 대화 화면 source:
   - `conversation/agent-tab-fake-source.ts`: `sender-chips` 장면의 coding 보낸이 envelope와 `CODING_ENDED_TEXT`를 지운다. 장면은 program 알림 하나와 agent 보낸이로 다시 짠다(글은 그 장면의 일에 맞게 짧게 쓴다). `{ kind: "coding" }` 보낸이를 만드는 fake가 남지 않는다.
   - `conversation/agent-tab-core-source-thread.ts`, `agent-tab-data.ts`, `agent-tab-core-source-sessions.ts`: `coding_agent`·`harness` 가지는 protocol type(`CallFrom`, `CallAgent`, `TurnRequest` subject)이 갖는 동안 남긴다(정한 것). "harness 물음은 대기 목록의 coding 카드가 그린다"처럼 지운 것을 가리키는 주석만 고친다.
10. 알림:
    - `packages/shell/main/desktop/wiring/notice.ts`의 `who()`: snapshot의 agent type이 아직 `coding_agent`를 가져 null로 거르는 줄은 남긴다. 주석 "coding session은 터미널 쪽 tracker가 알려서 건너뛴다"를 고친다.
    - `packages/shell/main/notice/rule.ts`: `who` 주석 "coding session(터미널 쪽이 알린다)이나 모르는 session은 null" → "모르는 session은 null".
    - `packages/shell/main/notice/rule_test.ts`: `ses_coding`을 모르는 session(`who`가 null)으로 바꾸고 test 이름을 "못 본 turn 끝은 탭이 보이거나 다음 turn이 시작하면 지우고, 끊은 turn과 모르는 session은 알리지 않는다"로 고친다.

### D. Settings › Coding agents

1. ‡ `packages/shell/ipc/coding.ts`: `HarnessSettingsView`에서 `can_launch`와 `reason`을 뺀다. `can_deliver_messages`(Turn-end 칸)는 남긴다. `codingCallSchema`의 "맡길 수 있는지"와 `HarnessSettingsView`의 `reason` 주석을 고친다.
2. ‡ `packages/shell/main/desktop/coding-connection.ts`:
   - 지운다: core `coding_agent_harnesses/report`로 알리던 `report()`와 `last.reported`, `HarnessSettingsDeps.core`, `HarnessCatalog.facts`의 `can_launch`, `reasonOf`, `unknownView`의 까닭 인자와 `fail(why)`의 글.
   - 남긴다: `childCliRunner`, `lophn harness detect|refresh` 실행, 마지막 결과 쥐기, `unknownView`(감지 실패나 항목 없음).
   - 머리 주석의 "core `harness.report`로 알린다", "맡길 때 core와 CLI가 한다"와 `HarnessCatalog` 위 주석의 `canLaunch`를 고친다. `coding-connection_test.ts`는 `childCliRunner`만 보니 고칠 것이 없다.
3. `packages/shell/renderer/desktop/settings/connections/`:
   - `connections-panel.tsx`: "Takes task" 칸(`settings.label.coding-col-takes-task` 머리, cell, `reason` caption), 기본 실행 옵션 덩어리(`settings.heading.coding-defaults` 제목, `ProductPicker`, model 칸, 저장 단추, 저장 상태와 `EMPTY_DEFAULTS`), `settings.note.coding-signal` 문단(첫 prompt만 보낸다는 coding session 글)을 지운다. 감지 칸, Turn-end 칸, Hooks 칸, [Detect again], 검색, `settings.note.coding-hooks` 문단은 남긴다. 머리 주석을 맞춘다.
   - `model.ts`: `pickable`과 머리 주석의 "맡길 수 있는지"를 지운다.
   - `source.ts`: `CodingDefaults`, `defaults()`, `saveDefaults()`와 머리 주석의 선언 설정 줄을 지운다.
   - `core-source.ts`: `DEFAULT_HARNESS_KEY`, `DEFAULT_MODEL_KEY`, `defaults`, `saveDefaults`, 설정 읽기·쓰기에만 쓰던 첫 인자(core)를 지운다. ‡ `packages/shell/renderer/desktop/entry.tsx`의 `coreCodingConnectionsSource(...)` 호출을 맞춘다.
   - `testdata/fake-source.ts`: `can_launch`, `reason`, defaults와 저장 기록을 지운다.
   - ‡ `packages/shell/renderer/desktop/settings/general/model.ts`: `SHOWN_ELSEWHERE`의 `"coding-agent.default_"`를 지운다. core 설정 `coding-agent.default_harness`·`coding-agent.default_model`은 `coding-core`가 지운다.

### E. wireframe

1. `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`: `onAnswerInTerminal={noop}`을 지우고, `WaitingList` 설명의 "권한 요청(shell 명령과 coding agent)"과 "coding agent의 물음은 … 터미널 탭으로 보낸다"를 지운다. Finished 줄의 터미널 행(사람 터미널)은 그대로다.
2. ‡ `tools/wireframes/mock/fake-terminal.ts`: `launch_kind`와 `focusSession`을 뺀다.
3. ‡ `tools/wireframes/mock/app-space/coding-terminal.ts`를 지운다. ‡ `tools/wireframes/pages/screens/app-space/space.tsx`: `terminal` 장면 prop, `openedToast`, `codingBridge`, `pane.view === "terminal"`, 터미널만 있는 장면 처리, renderer `AppSpace`에 넘기던 `terminal`을 지운다. ‡ `tools/wireframes/pages/screens/app-space/pages.tsx`: `CodingOpenedToast`, `CodingRunning`, `CodingPermission`, `CodingEnded`를 지운다. ‡ `tools/wireframes/pages/screens/app-space.tsx`: page 넷(`new-app-coding-toast`, `new-app-coding-terminal`, `new-app-coding-permission`, `new-app-coding-ended`)과 summary·패널 설명의 coding 탭 말을 지운다.
4. ‡ `tools/wireframes/pages/screens/settings-frame.tsx`: `onAnswerInTerminal={noop}`을 지운다. ‡ `tools/wireframes/pages/screens/questions.tsx`: 대기 목록 page 설명의 "권한 요청(shell 명령, coding agent)"과 "coding agent 항목은 harness 아이콘과 [Answer in terminal]만 있다"를 지운다. Finished 설명의 터미널 coding agent는 사람 터미널이라 남긴다.

### F. 고치지 않는 것과 이름 grep

1. wording catalog(`packages/design/wording/catalog`)는 고치지 않는다(README "뼈대 검토"의 wording catalog 줄). 안 쓰게 된 key는 보고의 "안 쓰게 된 export"에 적는다. 예: `waiting.title.coding-start`, `waiting.notice.coding-start`, `waiting.button.answer-in-terminal`, `app-space.title.coding-opened`, `app-space.button.show-terminal`, `terminal.label.session-ended`, `settings.label.coding-col-takes-task`, `settings.label.coding-launch-yes`·`-no`, `settings.heading.coding-defaults`, `settings.label.coding-model`, `settings.note.coding-model`, `settings.note.coding-defaults-saved`, `settings.error.coding-defaults`, `settings.note.coding-signal`. template literal로 만드는 key가 있는지 먼저 grep한다.
2. `packages/protocol`은 고치지 않는다(계약). `coding_agent` actor, `CallAgent`·`CallFrom`의 `coding_agent`, `TurnRequest` subject의 `harness`, snapshot의 `harness`, `SessionStarted`의 `external_session`은 protocol에 남는다.
3. 지운 이름(`codingTerminals`, `coding_session`, `coding_tui`, `open-coding`, `focusSession`, `coding_start`, `onAnswerInTerminal`, `requestFromCore`, `registerCoding`, `coding_agent_terminals`, `coding_agent_harnesses`, `can_launch`)을 `packages tools tests`에서 문자열로도 찾아 소유 안의 주석과 글을 고친다. channel 이름 `shell:terminal-focus-session`도 문자열로 찾는다.
4. 소유 밖에 주석이나 쓰는 곳 없는 export로만 남는 것(고치지 않고 보고에 적는다):
   - `packages/shell/main/terminal/agent/hook-install.ts` 머리 주석의 "coding 탭을 여는 길"과 `HookInstaller.ensureRegistered` export(이제 안에서만 쓴다).
   - main 전용 Gateway frame 길: `packages/shell/main/desktop/wiring/{core,context}.ts`의 `relay.frames`, `packages/shell/main/desktop/core/connection.ts`의 `own.frame`.
   - `packages/shell/renderer/workspace/kinds/host.ts`의 `openTab` `select: false` 주석(coding 터미널 탭).
   - `packages/shell/renderer/conversation/header/{session-popover,agent-header}.tsx`의 `queuedCoding`(넘기는 곳이 원래 없다), `packages/shell/renderer/conversation/thread/sender-chip.tsx`·`agent-tab-source.ts`의 `coding` 보낸이 종류.
   - `packages/shell/renderer/desktop/connection/waiting/decide.ts`의 "coding agent의 물음" 주석.
   - `packages/core/agent-roles/skills/guide-questions-and-decisions/SKILL.md`의 "The questions a coding agent asks in its own terminal also show in the waiting list"(이 task 뒤로 거짓이 된다).

### 정한 것

- **`TerminalRuntime.title`·`product`를 지운다.** 채우는 곳은 coding TUI 시작(`terminal-host/main.ts`의 `startCoding`)뿐이었다. 알림 제목의 place와 Finished 줄 제목은 사람 터미널에서 지금도 시작 폴더 이름이라 동작이 같다. 터미널 안 OSC 제목은 renderer store(`noteTitle`)에 따로 있다.
- **Settings의 Turn-end 칸은 남긴다.** 사람 터미널의 끝남 점과 알림이 그 신호를 쓴다(`terminal-agent.md`). Takes task 칸, 기본 실행 옵션, `settings.note.coding-signal` 문단은 coding session을 맡길 때에만 뜻이 있어 지운다.
- **`reason`을 지운다.** 화면에는 찾은 제품의 Takes task 칸에서만 보였고, 내용은 맡길 수 없는 까닭이었다. 감지 실패의 글은 찾지 못한 제품이라 화면에 나온 적이 없다.
- **`focusSession` IPC와 `onAnswerInTerminal` 길을 지운다.** 대기 목록의 harness 물음과 `coding_start` 항목에서 그 session의 터미널 탭을 고르는 길이었다. 사람 터미널은 session이 없고 알림 누름(`reveal`)으로 탭을 고른다.
- **protocol type이 아직 갖는 `coding_agent`·`harness` 가지는 renderer에 남긴다.** switch가 type 전부를 다뤄야 한다. 지우는 것은 wave 3(`shell-events`, `shell-conversation`)과 wave 4(`cleanup-protocol`, `cleanup-shell`)다. `coding-core` 뒤에는 core가 그런 값을 내지 않아 그 가지에 닿지 않는다.
- **앱 공간의 터미널 탭을 통째로 지운다.** 그 탭은 core 요청으로 열린 coding 터미널만 받았다. project 창 Workspace의 터미널 탭은 그대로다.

## 끝남

- `npm run check`가 통과한다.
- `node packages/shell/renderer/build.ts`가 된다. check:full이 renderer build를 보지 않는다.
- `npm run wireframes`가 되고, gallery의 waiting page들(`waiting-pages.tsx`)과 app-space page들이 그려진다. coding 터미널 page는 없다.
- 위험 test: 없음. 남는 test(`packages/shell/main/terminal/agent/agent_test.ts`의 hook ingress, `packages/shell/main/notice/rule_test.ts`, `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`)가 통과한다.
- 남지 않음:
  - `grep -rn "coding_session\|coding_tui\|open-coding\|focusSession\|FOCUS_SESSION\|terminal-focus-session\|coding_start\|STARTING_QUIET_MS\|CodingCard\|onAnswerInTerminal\|requestFromCore\|tabOfSession\|openCodingTerminal\|useTerminalOpenRequests\|TerminalOpenRequest\|registerCoding\|codingTerminals\|createCodingTerminalRequests\|createCodingHost\|CodingHost\|codingBridge\|PaneTerminal\|coding_agent_terminals\|coding_agent_harnesses\|can_launch\|canLaunch\|CodingDefaults\|coding-agent.default_\|CODING_ENDED_TEXT\|CODING_ASK" packages/shell tools`가 0줄이다(`packages/shell/main/release`의 build 산출물은 뺀다).
  - `grep -rn "protocol/coding-agent/\(terminal-requests\|launch-plan\|transport\|token\|message\|mcp\|mcp-launch\|harness-report\)" packages/shell tools`가 0줄이다.
  - `test ! -e packages/shell/main/terminal/coding && test ! -e packages/shell/terminal-host/launch-plan.ts && test ! -e packages/shell/renderer/desktop/connection/waiting/cards/coding-card.tsx`가 성공한다.
- 남는 것(지우지 않는다): `wiring/coding.ts`의 supervisor·hook 설치·Settings 감지, `lophn hook`이 쓰는 hook socket, tracker, `harnessOfProcess`, `HARNESS_ADAPTERS`(label·끊기 key), `canDeliverMessages`, Finished 줄, `TERMINAL_REVEAL_CHANNEL`.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
