# sync-core

상태를 바꾸는 route가 무엇을 바꾸는지 선언하게 하고, core가 commit 뒤 남지 않는 event `StateChanged` 하나를 내게 한다.

- 단위: sync (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/base/route.ts`
  - `packages/protocol/events/{changes,transient}.ts`
  - `packages/protocol/**`의 route 정의 file(`defineCommand`, `defineUpload`, 상태를 바꾸는 `defineMemory`가 있는 file)
  - `packages/core/storage/ledger/{after-commit,writer-worker,writer-message}.ts`
  - `packages/core/server/dispatch.ts`
  - `packages/core/main/daemon/wiring/`에 새 file 하나(Bus에 내는 wiring)
  - `project-docs/flows/`의 event 항목
- 읽을 것:
  - 계획 README "정한 것"
  - roadmap: `project-docs/products/roadmap/screen-sync.md`의 "지금 코드 › 내는 쪽"
  - architecture: `project-docs/architecture/event.md` 지키는 것 7~14
- 계약:
  - 쓰는 것: 지금 after-commit(`tx.port(afterCommit).push`, `withAfterCommit`)
  - 내놓는 것: route 정의의 `changes`, `CHANGE_NAMES`와 type `ChangeName`, event `StateChanged {changes: [{name, id: string | null}]}`, route 밖에서 부르는 내는 함수 하나

## 할 일

1. `packages/protocol/events/changes.ts`: `CHANGE_NAMES`(닫힌 목록)와 `ChangeName`. 이름은 화면이 읽는 단위로 짓는다. roadmap의 "화면에 보이는데 아무것도 내지 않는 route"와 지금 "다시 읽어라" event가 덮는 것(job, workflow instance, 설정, tray 값)을 모두 덮는다.
2. `route.ts`: command와 upload 정의에 필수 칸 `changes`, memory 정의에 선택 칸 `changes`. 항목은 이름이거나 `{name, id(input, output)}`다.
3. `transient.ts`: `StateChanged`를 더한다. flows의 event 항목도 더한다(`flows` skill).
4. 상태를 바꾸는 route 전부(command 130, upload 4, 상태를 바꾸는 memory 약 61)에 `changes`를 적는다. 대화 command는 `[]`다(README). 다른 표를 같이 바꾸는 command(예: `share_requests/decide`가 할당을 바꾼다, `apps/delete`)는 그 이름도 적는다.
5. writer Worker: command가 돌 때마다(다른 command 안에서 `tx.call`로 돈 것 포함) 그 route의 `changes`를 입력·결과로 풀어 모으고, commit된 결과에 싣는다. 되돌아간 tx와 replay된 결과는 싣지 않는다.
6. main thread: 실려 온 것을 `StateChanged` 하나로 Bus에 낸다. 같은 `{name, id}`는 한 번만 싣는다. 실패해도 command는 실패하지 않는다(지키는 것 11).
7. `dispatch.ts`: memory route와 upload가 성공하면 그 route의 `changes`를 같은 함수로 낸다.
8. route 밖에서 상태를 바꾸는 곳 가운데 지금 "다시 읽어라" event를 내는 곳(설정 file watch, job scheduler의 claim)은 그대로 둔다. 옛 event를 지우는 것은 `sync-fold`의 일이다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "되돌아간 tx의 선언은 event로 나가지 않는다", "다른 command 안에서 돈 command의 선언도 나간다"
- `changes` 없는 `defineCommand`가 type 오류다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 정한 대상 이름 목록과, 어느 이름을 붙일지 애매했던 route를 "정한 것"에 적는다.
