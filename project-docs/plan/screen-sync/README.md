# screen-sync

- 목표: 상태를 바꾸는 route가 무엇을 바꾸는지 선언하고 core가 commit 뒤 event 하나를 내어, 누가 바꿔도(다른 창, CLI, agent, 뒤의 폰) 열린 화면이 다시 읽게 한다. 화면의 읽기를 공통 읽기 하나로 모으고 polling을 지운다.
- 재료: `project-docs/products/roadmap/screen-sync.md`(지금 코드의 숫자와 path가 여기 있다), `project-docs/architecture/event.md`, `project-docs/issues/provider-id-overwrite.yaml`
- 범위 밖: roadmap "하지 않는 것". 앱 화면(SDK `useOperation`)의 자동 다시 읽기는 이 계획 뒤에 한다. 연결 층을 다른 package로 옮기는 것은 폰 화면을 지을 때 한다.

## 정한 것

- **사람의 "reactor"는 화면 갱신이다.** 저장, replay, core가 event를 듣고 일하는 것은 없다. (사람이 방향을 냄 2026-11-14, 읽기는 agent. 사람이 달리 말하지 않았다)
- **선언 칸 이름.** 상태를 바꾸는 route(command, upload, memory)는 `changes`, read route는 `reads`다. 둘 다 `packages/protocol/base/route.ts`의 route 정의에 있다. command와 upload는 `changes`가 필수다(없으면 type 오류). memory route는 상태를 바꾸는 것만 적는다. (agent: 잊지 못하게 type으로 막는다. memory는 읽기와 쓰기가 한 종류라 필수로 두면 빈 목록 40여 개가 생긴다)
- **대상 이름은 닫힌 목록이다.** `packages/protocol/events/changes.ts`의 `CHANGE_NAMES`. 화면이 읽는 단위로 짓는다(`agents`, `projects`, `apps`, `providers`, `jobs` 등). `changes`의 항목은 이름이거나, 이름과 입력·결과에서 id를 뽑는 함수다. (agent)
- **event는 하나다.** 남지 않는 event `StateChanged`, subject null, payload `{changes: [{name, id: string | null}]}`. 내용을 싣지 않는다. (agent)
- **내는 곳.** command는 writer Worker가 그 tx에서 돈 command(다른 command 안에서 돈 것 포함)의 선언을 모아 commit 결과에 싣고 main thread가 Bus에 낸다(지금 after-commit 길). memory route와 upload는 `packages/core/server/dispatch.ts`가 handler 성공 뒤에 낸다. route 밖에서 core가 상태를 바꾸는 곳은 같은 함수를 부른다. (agent)
- **대화는 빈 목록이다.** session, turn, message, tool call처럼 agent event와 `AcpUpdated`가 이미 알리는 command는 `changes: []`를 적는다. session 이름처럼 대화 화면 밖 목록이 읽는 것은 적는다. (agent)
- **공통 읽기.** `useCoreRead(route, input)`가 route의 `reads`를 보고 구독해 `StateChanged`와 `ready`에 다시 읽는다. 겹친 다시 읽기는 하나로 합친다. 자리는 `packages/shell/renderer/desktop/connection/`이고 Electron 전역을 새로 끌어오지 않는다. (agent)
- **합치는 event 넷.** `JobChanged`, `WorkflowInstanceChanged`, `AppTrayChanged`, `SettingsChanged`를 지우고 `StateChanged`로 바꾼다(`SettingsChanged`의 key는 id 자리). `AppViewChanged`, `AppRemoved`, 내용을 싣는 event, toast 계기는 그대로 둔다. (agent)
- **내용을 접는 store는 그대로다.** session 목록, Inbox, 대화 store는 옮기지 않는다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `sync-core` | 없음 | `changes` 칸, 대상 이름 목록, `StateChanged`, 내는 길, 상태를 바꾸는 route 전부에 선언 |
| 2 | `sync-read` | `sync-core` | read route의 `reads`, `useCoreRead`, check |
| 3 | `sync-lists` | `sync-read` | agent, project, 앱 목록과 session 이름을 공통 읽기로 |
| 3 | `sync-app-detail` | `sync-read` | 앱 상세(run, access, versions, activity, rewind)와 preview 탭을 공통 읽기로, polling 지우기 |
| 3 | `sync-settings` | `sync-read` | 설정(provider, model, 기기, agent, skill)과 sign-in을 공통 읽기로 |
| 4 | `sync-fold` | `sync-lists`, `sync-app-detail`, `sync-settings` | event 넷을 `StateChanged`로 합치고 옛 hook과 `useRead`·`useReload`를 지운다 |

## 위험 test (task brief에 있다)

- 되돌아간 tx의 선언은 event로 나가지 않는다.
- 다른 command 안에서 돈 command의 선언도 나간다.

## lead가 할 일

- merge마다 `npm run check`. flows(event를 더하고 지우는 것)는 각 task가 고친다.
- 끝나면: `architecture/event.md`(비목표와 결정의 "일반 change notification", 남지 않는 event 목록, 지키는 것 17·18, 화면 약속), `job.md`, `workflow.md`, `settings.md`, `app-notice.md`를 고친다. change-log 항목을 쓰고 `provider-id-overwrite` 이슈가 고쳐졌는지 본다. roadmap `screen-sync.md`는 앱 화면 단계만 남기고 줄인다.
- 사람에게: 끝난 뒤 창 둘을 띄워 한 창에서 project 이름을 바꾸면 다른 창이 바뀌는지, CLI로 agent를 만들면 열린 목록에 보이는지 확인을 부탁한다.
