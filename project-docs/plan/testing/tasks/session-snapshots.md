# session-snapshots

core에 `session_snapshots/list` read handler가 없어 `unavailable`이 나는 bug를 고친다. 화면(renderer)과 E2E support의 `waitPermission`이 이 read를 쓴다.

- 단위: fix (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/session-snapshots.ts`(새 file)
- 추가 소유(lead 승인):
  - `packages/core/main/daemon/assembly.ts`: wiring 목록에 이 wiring 한 줄을 더하는 것만
- 읽을 것:
  - `project-docs/issues/event.md`의 "core에 `session_snapshots/list` read가 없다"
  - `project-docs/architecture/event.md`(snapshot은 session의 지금 상태, 대기 중인 권한 요청, 질문을 담는다. 화면이 붙거나 다시 붙을 때 읽는다), `project-docs/architecture/approval.md`(turn 안 request는 메모리다)
  - `packages/protocol/events/snapshot.ts`(`sessionSnapshotsList` 입력·출력), `packages/protocol/lophn-agent/calls.ts`(`SENDABLE_SESSION_STATES`, `callAgentOutputSchema`)
  - read를 다는 본보기: `packages/core/main/daemon/wiring/diagnostics.ts`(`reads: (reads) => reads.set(...)`), `packages/core/main/daemon/wiring/context.ts`, `packages/core/main/daemon/assembly.ts`
  - 재료: `packages/core/approvals/approvals.ts`(service의 `turnRequests`), lophn-agent session·turn·질문 read(`packages/core/lophn-agent/session/`, `run-loop/`, `tools/questions/`), coding agent session의 상태(`packages/core/apps/tickets/coding/store.ts`의 `SessionState`)
  - 쓰는 쪽: `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`의 `readSessions`, `packages/shell/renderer/desktop/connection/events/snapshots.ts`, `tests/support/core/human.ts`의 `waitPermission`
- 계약:
  - 쓰는 것: `sessionSnapshotsList`(바꾸지 않는다), approvals service, 각 module이 이미 내놓은 read·함수.
  - 내놓는 것: core의 `session_snapshots/list` handler.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 부르지 않는다.
- 전역 mutable 상태를 두지 않는다. sleep으로 기다리지 않는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- E2E test file(`tests/e2e/*`)은 고치지 않는다. 그 test가 이 bug를 재현한다. test에 맞추려고 제품의 다른 동작을 바꾸지 않는다.

## 정한 것

- 조립은 main wiring에서 한다(approvals와 lophn-agent, apps를 잇는 곳이 main이다). 다른 module의 표를 SQL로 직접 읽지 않는다. 그 module이 이미 내놓은 read나 함수를 부른다. 필요한 것이 없으면 그 module에 export를 더하기만 하고(이름 하나, 기존 것을 안 바꾼다) 보고의 "넘길 줄"에 적는다. 크게 필요하면 멈추고 보고한다.
- `permission_requests`는 approvals의 `turnRequests`에서 온다(메모리. 재시작하면 사라지는 것이 맞다).
- `state`: lophn-agent session은 대기 중인 권한 요청이나 답 없는 질문이 있으면 `waiting`, 그렇지 않고 running turn이 있으면 `running`, 아니면 `idle`. coding agent session은 이미 있는 상태 계산(`apps/tickets/coding/store.ts`)을 쓴다. 같은 규칙을 새로 쓰지 않는다.
- `sessions`를 생략하면 열린 session 전부, 주면 그 session들이다(schema 주석). 없는 id는 빼거나 `not_found` 중 renderer가 견디는 쪽을 고르고 "정한 것"에 적는다.
- `as_of_seq` 등 `withReadCommon` 칸은 다른 read와 같은 방식으로 채운다.

## 할 일

1. 아래 "E2E로 확인하기"로 고치기 전 실패(`ListSessionSnapshots: unavailable`)를 본다.
2. handler를 만들고 wiring 목록에 단다.
3. E2E `restart_test.ts`를 10번 연속 돌린다. `approval_test.ts`는 성공한 tool call의 ledger bug(다른 fix task)에도 막혀 있으니 한 번 돌려 남은 실패가 ledger `success` 단정뿐인지만 본다(`git show e2e/e2e-approval:tests/e2e/approval_test.ts`로 같은 방법).

## E2E로 확인하기

이 bug를 재현하는 E2E는 아직 merge되지 않은 branch `e2e/e2e-restart`에 있다. 그 file을 이 worktree에 잠시 가져와 돌리고, 끝나면 지운다(commit하지 않는다).

```sh
git show e2e/e2e-restart:tests/e2e/restart_test.ts > tests/e2e/restart_test.ts
for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/restart_test.ts || echo FAIL $i; done
rm tests/e2e/restart_test.ts
```

- 고치기 전에 한 번 돌려 이 bug로 실패하는 것을 보고에 적는다. 고친 뒤 10번 연속 통과한다.
- 끝난 뒤 `ls .dev-data/e2e`가 비어 있고, `pgrep -af core/main/daemon/main.ts`에 이 worktree의 run이 없다(줄마다 `/proc/<pid>/environ`의 `LOPHN_HOME`으로 가린다. 읽기만 하고 pkill·killall은 쓰지 않는다).

## 끝남

- `deno task check:full`이 통과한다. core 기동 두 번이 된다.
- `restart_test.ts`가 10번 연속 통과한다(위 방법. commit하지 않음).
- `deno run -A packages/shell/renderer/build.ts`가 된다.
- 위험 test: 새로 쓰지 않는다(`tests/e2e/restart_test.ts`, `approval_test.ts`가 이 read를 쓴다).

## 보고

- 바꾼 file
- 고치기 전 E2E 실패(출력 한 줄)와 고친 뒤 10번 연속 결과
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
