# 화면 갱신: 누가 바꿔도 모든 화면이 따라온다

상태: **설계안.** 2026-11-14 사람이 "reactor"를 말했고 planner가 화면 갱신으로 읽어 정리했다. 그 읽기가 맞는지는 사람이 확인하지 않았다(아래 "사람이 정할 것" 1). 설계와 추천은 planner의 것이다. 계획으로 열기 전에 사람이 정한다.
배경 문서: `project-docs/architecture/{event,job,workflow,settings,app-notice,app-call}.md`, `project-docs/products/roadmap/{mobile,command-surface,app-sdk}.md`. 옛 Reactor를 지운 기록: `project-docs/products/change-log/0.6/drop-reactor-and-domain-events.yaml`.
`roadmap/mobile.md`보다 먼저 한다. 폰 화면을 여기서 만드는 공통 읽기 위에 짓는다.

## 사람의 말 (원문)

2026-11-14:

> 그리고 reactor를 만드는 것도 좋아보여 왜냐하면 이제는 이벤트 발행하고 shell에서 렌더링이 바뀌어야하는 경우가 앞으로 더 늘어날 것 같거든
> 모바일 앱도 있고, loph도 cli로 이제 더 많은 그런 기능에 대한 접근을 열 생각이라서

## 옛 Reactor와 다르다

- 옛 Reactor(0.6에서 지움)는 core가 저장된 event를 듣고 스스로 일을 하는 장치였다(cursor, 멱등 key, backoff, 5초 poll). 꼭 이어져야 하는 일은 그 일을 아는 command가 같은 tx에서 하게 되어 반응할 event가 없어졌다(`architecture/event.md` 결정).
- 사람이 든 이유는 "event가 나면 shell의 rendering이 바뀌어야 한다"이다. core가 일을 하는 것이 아니라 화면이 따라오는 일이다. 저장도 재시도도 필요 없어 옛 Reactor의 짐이 돌아오지 않는다.
- 그래서 이 로드맵은 화면 갱신만 다룬다. program이 event를 듣고 일하게 하는 것은 넣지 않았다.

## 왜

- `architecture/event.md`는 "일반 change notification(어느 대상이 바뀜)은 두지 않았다. 받을 화면이 없다"고 정했다. 화면이 desktop 창 하나이고 바꾸는 쪽도 그 창이던 때의 이유다.
- 이제 화면이 는다. 폰이 두 번째 화면이 된다(`roadmap/mobile.md`). desktop 창이 둘일 때도 같은 문제가 이미 있다.
- 화면 밖에서 바꾸는 쪽이 는다. CLI 명령 약 74개 가운데 약 26개가 core 상태를 바꾸고, 사람은 CLI로 여는 기능을 늘릴 생각이다. agent, job scheduler, 앱도 바꾼다.
- 지금은 "바뀌었으니 다시 읽어라"를 기능마다 손으로 단다. 달지 않은 곳은 화면을 다시 열 때까지 옛 값이다.

## 지금 코드 (2026-11-14 조사, main, 제품 판 0.23.52)

### 내는 쪽

- 상태를 바꾸는 route는 약 191개다(command 130, 상태를 바꾸는 memory route 약 61). 그 가운데 Bus event를 하나라도 내는 것이 약 89개, 아무것도 내지 않는 것이 약 102개다. 대화가 아닌 event(남지 않는 event)를 내는 command는 약 27개뿐이다(jobs 9, releases 7, notices 4, apps 3, approvals 2, workflows 2).
- 남지 않는 event는 16종이다(`packages/protocol/events/transient.ts`). "다시 읽어라"뿐인 것이 다섯이다: `JobChanged`, `WorkflowInstanceChanged`, `SettingsChanged`, `AppTrayChanged`, `AppViewChanged`. 나머지는 내용을 싣거나(`AcpUpdated`, `AppEventPublished`, `Notice*`, `ActivationConsent*`, `ShareRequest*`) toast 계기다(`AppRestartHalted`). `AppRemoved`는 shell의 정리 신호다.
- 내는 길: command handler가 `tx.port(afterCommit).push(topic, data)`로 쌓고(`packages/core/storage/ledger/after-commit.ts`), writer Worker가 commit된 결과에 실어 보내면(`writer-worker.ts:203-215`) main thread의 `withAfterCommit`이 wiring마다 topic을 걸러 Bus에 낸다(`wiring/router.ts:545`, `jobs.ts:287`, `apps.ts:486`, `workflows.ts:397` 등). memory route는 writer를 거치지 않고 handler가 `ctx.bus.publish`를 직접 부른다.
- 모든 command가 지나는 곳이 둘 있다. writer를 감싸는 자리(`core.ts:414-419`. `wiring/acp.ts`와 `apps-delete.ts`가 이미 `envelope.command`를 보고 event를 낸다)와 HTTP 입구(`packages/core/server/dispatch.ts:236-262`)다. 앞의 것은 다른 command의 tx 안에서 도는 command(`tx.call`)를 보지 못하고, 뒤의 것은 core 안에서 낸 command를 보지 못한다.
- route 정의(`packages/protocol/base/route.ts`)에는 그 route가 무엇을 바꾸는지 적는 칸이 없다. 기록 event의 `subject`는 `tx.emit` 24곳(앱, tool call, rewind, package)에만 있다.
- 화면에 보이는데 아무것도 내지 않는 route의 예: `agents/create|change|delete`, `agent_assignments/set`, `projects/*` 6개, `apps/create|rename|set_icon|edit_folders|unarchive|enable_execution|disable_execution`, `app_grants/revoke`, `releases/prepare|activate`, `activations/activate_previous`, `providers/connect|disconnect|refresh-models`, `model-default/change`, `shown-models/change`, `secrets/put|delete`, `logins/*`.

### 읽는 쪽

- 화면이 core를 읽는 공통 hook이나 cache가 없다. 기능마다 `source.ts`와 route 이름을 든 `core-source.ts`가 따로 있고(약 20개), 다시 읽는 방식이 여덟 가지쯤이다.
  - `syncOnReady`(`packages/shell/renderer/desktop/connection/events/store.ts`): `ready` 뒤 읽고, 읽는 동안 온 event를 모았다가 적용한다. session 목록과 Inbox가 쓴다.
  - 종류마다의 hook: `useSettingsChanged`, `useWorkflowChanges`, `useJobChanges`(`events/hooks.tsx`). 뒤의 둘은 `ready`에 다시 읽지 않아 끊긴 사이 바뀐 것을 놓친다. Inbox History도 같다(`waiting/history.ts:160`).
  - `useRead`(`app-frame/app-detail/use-read.ts:26`): mount, 손으로 `reload()`, 선택 polling. event를 듣지 않는다.
  - `useReload`(`desktop/settings/use-reload.ts`): mount, 연결 ready, 창 focus, `SettingsChanged`.
  - 손으로 짠 effect와 `reads` counter: mount와 자기가 쓴 뒤에만 읽는다.
- event로 갱신되는 화면은 session 목록, Inbox, job, workflow instance, 설정 panel 여섯이다.
- 다른 client가 바꿔도 모르는 화면: agent 목록(`workspace/agents/agents-page.tsx:94`), project와 앱 목록(`shell/use-left-sidebar.ts`, `shell/workspaces-panel.tsx:168`), 앱 상세의 access와 activity, provider 목록(`settings/providers/provider-list.tsx:69`), skill 목록.
- polling으로 때우는 곳: 앱 상세의 run(3초), access(2초), versions(2초), rewind(1.5초), preview 탭(`workspace/app-preview-tab.tsx:26`, 2초), sign-in(`desktop/settings/sign-in.ts:146`, 2초).
- 창이 둘일 때 event가 없어 창 focus에 다시 읽는 것: session 이름(`shell/use-left-sidebar.ts:100`, 주석 "다른 창에서 바꾼 이름은 이 창에 event가 없다").
- renderer의 event 층은 Electron에 묶이지 않는다. `CoreSource`(`subscribe`, `call`, `watch`, `onEvent`) 하나만 다른 전송으로 갈아 끼우면 된다. wireframe이 fake source로 browser에서 쓴다(`tools/wireframes/mock/mock-desktop.tsx:391`).
- 앱 화면(SDK)에는 cache도 다시 읽기도 없다. `useOperation`(`packages/sdk/app-ui/use-operation.ts:46`)은 호출 하나의 상태만 들고, 앱이 자기 write 뒤나 `useEvent` listener에서 operation을 다시 부른다.

### 이슈

- `provider-id-overwrite`(open): 한 창의 옛 provider 목록이 다른 창이 먼저 이은 provider를 덮어쓴다.
- `session-name-falls-back-until-reselected`(고침): 자동 제목에 event가 없어 목록의 이름이 옛 값이었다.

## 무엇을 만드나

### core

1. **route가 무엇을 바꾸는지 선언한다.** 상태를 바꾸는 route 정의(command, upload, memory)에 바뀌는 대상의 목록을 적는 칸을 둔다. 대상은 이름(`agents`, `projects`, `apps`, `providers`, `jobs` 같은 닫힌 목록)과, 있으면 id다. 화면이 읽는 상태를 바꾸지 않거나 이미 내용 있는 event가 알리는 route(대화)는 빈 목록을 적는다. 칸은 필수라 적지 않은 route는 build가 서지 않는다.
2. **commit 뒤 event 하나를 낸다.** command를 실행하는 한 곳(writer Worker)이 그 tx에서 돈 command들의 선언을 모아 commit 결과에 싣고, main thread가 남지 않는 event 하나로 낸다. 지금 after-commit과 같은 길이라 되돌아간 tx의 것은 나가지 않고, 다른 command 안에서 돈 command의 것도 빠지지 않는다. memory route는 입구(dispatch)가 handler 성공 뒤에 낸다. route를 거치지 않고 core 안에서 상태를 바꾸는 곳(설정 file watch 등)은 같은 함수를 직접 부른다.
3. **"다시 읽어라"뿐인 event를 이 하나로 합친다.** `JobChanged`, `WorkflowInstanceChanged`, `AppTrayChanged`, `SettingsChanged`(바뀐 key가 id 자리로 간다)를 지우고 쓰는 쪽을 같은 변경에서 고친다. 내용을 싣는 event와 toast 계기, `AppViewChanged`(host가 view를 다시 bind하라는 신호), `AppRemoved`는 그대로 둔다.

### 화면

4. **read route가 무엇에 기대는지 선언한다.** read route 정의에 그 읽기가 기대는 대상의 목록을 적는다. 내는 쪽과 읽는 쪽이 같은 계약(`packages/protocol`)에서 같은 이름을 쓴다. check가 "읽기가 기대는 이름을 내는 route가 하나도 없다"를 잡는다.
5. **공통 읽기 하나.** 구독하고, `ready`를 받고, 읽고, 기대는 대상이 바뀌었다는 event나 `ready`가 오면 다시 읽는다. 겹친 다시 읽기는 하나로 합친다. 이 하나가 `useRead`의 polling, `useReload`, 종류마다의 hook, 손으로 짠 effect를 대신한다. 내용을 접는 store(session 목록, Inbox, 대화)는 그대로 둔다.
6. **desktop renderer와 폰 화면이 같이 쓰는 자리에 둔다.** Electron에 묶이지 않은 연결 층(`CoreSource`, event client, store, 공통 읽기)을 둘이 같이 import하는 자리로 옮긴다.
7. **화면을 옮긴다.** agent, project, 앱 목록과 앱 상세, provider와 model, skill, job, workflow instance, 설정을 공통 읽기로 바꾸고 polling 여섯 곳을 지운다.

### 앱 화면 (사람이 정할 것 2)

8. 앱의 write가 끝나면 그 앱의 열린 화면이 안다. core는 앱 호출의 effect가 write인지 안다. write 호출이 끝나면 대상 "그 앱의 data"가 바뀌었다고 내고, SDK의 `useOperation`이 읽기 operation을 다시 부른다. 폰과 desktop에 같은 앱이 열려 있을 때 한쪽에서 바꾸면 다른 쪽이 따라오고, 앱을 지은 agent가 따로 할 일이 없다. SDK와 앱 agent 지침이 바뀐다(`sdk-note`).

## 정한 것

1. 저장하지 않고 replay하지 않는다. 놓친 화면은 `ready`에 다시 읽는다. 정본은 각 module의 표다(`architecture/event.md` 지키는 것 11, 19, 20). (agent)
2. core는 이 event를 듣고 일하지 않는다. 뒤에 꼭 움직여야 하는 일은 지금처럼 그 일을 아는 command가 같은 tx에서 한다(같은 문서 1, 7, 32). (agent)
3. 선언은 handler가 아니라 route 정의에 둔다. 이유: 내는 것을 잊지 못하게 type으로 강제하고, 화면 쪽이 같은 계약에서 읽기의 기댐을 읽는다. 버린 안: handler마다 event를 내기(지금 방식. 약 102개가 빠져 있다), route의 `resource` 이름을 그대로 대상으로 쓰기(다른 resource를 바꾸는 command와 여러 표를 모아 읽는 read가 많다). (agent)
4. event에 내용을 싣지 않는다. 이름과 id뿐이고 화면이 다시 읽는다. 이유: 내용을 실으면 event마다 schema와 접는 코드가 생겨 손으로 다는 지금으로 돌아간다. 잃는 것: 줄 하나가 바뀌어도 그 읽기를 통째로 다시 한다. 한 사람이 쓰는 양에서는 문제가 아니다. 잦은 것(대화)은 내용 있는 event를 그대로 쓴다. (agent)
5. core가 정본인 상태만 다룬다. shell이 정본인 상태(탭 layout, 터미널, bookmark, 전역 float)는 shell main의 IPC broadcast가 그대로 맡는다. 폰과 나눠야 하는 것이 생기면 그 상태를 core로 옮기는 것이 먼저다(`roadmap/mobile.md`의 `unseen`). (agent)
6. `architecture/event.md`의 결정 "일반 change notification은 두지 않았다"를 뒤집는다. 이유였던 "받을 화면이 없다"가 더는 맞지 않는다. (사람이 방향을 냄, 2026-11-14)

## 사람이 정할 것

1. **"reactor"를 화면 갱신으로 읽은 것이 맞나.** program이 event를 듣고 일을 하게 하려는 뜻이었다면 이 로드맵과 다른 일이고, 옛 Reactor를 지운 이유(꺼진 사이 놓친 반응을 믿게 하려면 저장, cursor, 재시도, 멱등 key가 다시 필요하다)를 다시 따져야 한다.
2. **앱 화면에도 줄까(무엇을 만드나 8).** 추천: 준다. lophn 화면을 옮긴 뒤의 단계로 둔다. 얻는 것: 같은 앱이 폰과 desktop에서 같이 갱신되고 앱마다 갱신 코드를 짓지 않는다. 잃는 것: SDK가 바뀌고, write마다 열린 화면이 읽기 operation을 다시 부른다. 주지 않으면 앱이 앱 event로 스스로 맞춰야 하는데, 앱은 자기가 낸 event를 받지 않는다(`architecture/event.md` 지키는 것 34). 이 규칙이 같은 앱의 화면에도 걸리는지는 계획에서 확인한다.

## 단계

1. core: 선언 칸, 내는 길, event 하나. 상태를 바꾸는 route 약 191개에 선언을 적고 "다시 읽어라" event 넷을 합친다.
2. 화면: read route의 선언, 공통 읽기, 연결 층 옮기기. desktop 화면을 옮기고 polling을 지운다.
3. 앱 화면(사람이 정하면).

1에서 event의 모양과 대상 이름이 정해지면 2의 화면 옮기기는 화면 영역마다 path가 겹치지 않아 나눠 돌릴 수 있다. 계획을 열 때 정한다.

## 하지 않는 것

- event의 저장, 구독자 cursor, replay, 재시도.
- program이 event를 듣고 일하거나 agent session을 여는 것.
- disk를 따라가는 것: file tree(3초 poll), artifact folder, editor의 file stat. core 상태가 아니다.
- shell main의 연결 감지 poll(`wiring/extensions.ts:653`)과 harness host의 turn 읽기 poll(`extensions/bundled/harness/host.ts`). 화면 갱신이 아니다.
- route를 거치지 않고 data root의 file을 직접 고친 것을 알아채기(file watch가 이미 있는 설정은 그대로).
- 바뀐 내용을 event로 실어 화면이 읽지 않고 고치게 하는 것.

## 같이 고칠 문서

- `architecture/event.md`: 비목표와 결정의 "일반 change notification", 남지 않는 event 목록, 지키는 것 17·18, "화면" 약속.
- `architecture/job.md`, `workflow.md`, `settings.md`, `app-notice.md`(tray 값): 지우는 event.
- `project-docs/flows/`: event를 더하고 지운다(`flows` skill).
- `boundary-catalog.yaml`의 `events`, `event-stream`.
- SDK guide와 `design-app`(단계 3을 하면, `sdk-note`).

## 끝남 기준

- CLI로 agent를 만들면 열려 있는 agent 목록에 다시 열지 않아도 보인다. project, 앱, provider도 같다.
- 창 둘에서 한 창이 project 이름을 바꾸면 다른 창이 바뀐다.
- 앱 상세의 run, access, versions, rewind와 preview 탭, sign-in에 polling이 없다.
- core에 다시 붙으면 열려 있는 모든 읽기가 다시 읽는다.
- 상태를 바꾸는 route가 선언 없이 build되지 않는다.
- `JobChanged`, `WorkflowInstanceChanged`, `AppTrayChanged`, `SettingsChanged`가 코드에 없다.
