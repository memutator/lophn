# e2e-restart

turn이 사람의 허락을 기다리는 도중 core가 꺼졌다 켜지면 session은 남고, 돌던 turn은 interrupted로 닫히며, 기다리던 permission request는 사라지고 쓰기는 일어나지 않았으며, 같은 session에서 새 message가 새 turn을 여는 것을 core 전체로 본다.

- 단위: e2e (wave 2)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tests/e2e/restart_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("core E2E 후보" 5번)
  - architecture: `project-docs/architecture/approval.md`("turn 안 request는 재시작 때 cancelled가 된다"), `project-docs/architecture/place-session.md`(재시작 뒤 상태), `project-docs/architecture/event.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-sessions`, `approvals`
  - 코드: `packages/core/lophn-agent/run-loop/interrupt.ts`(`interruptRunningTurns`: 재시작 때 running turn을 `{kind: "interrupted", reason: "restarted"}`로 닫는다), `packages/core/main/daemon/wiring/router-registration.ts`·`router.ts`(`RecoverCalls`가 같은 tx에서 부른다), `packages/core/approvals/turn-requests.ts`(메모리), `packages/protocol/events/snapshot.ts`
  - 앞 task가 만든 `tests/support/fake-server/`, `tests/support/core/`(특히 `kill()`과 같은 run으로 `bootCore`를 다시 부르는 길)와 그 brief의 "내놓는 것"
- 계약:
  - 쓰는 것: fake-server, core support(`createRun`, `bootCore`, `Core.kill`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `waitPermission`, `turnsOf`, `waitTurnEnd`), route `session_snapshots/list`, `sessions/read`.
  - 내놓는 것: 없음(test만).

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- 끄는 방법은 `core.kill()`(SIGKILL, crash 흉내)다. 이유: 정상 종료 때는 core가 먼저 정리할 수 있어 "꺼진 사이 돌던 turn이 시작 때 닫히는" 경로를 안 거칠 수 있다. 같은 run으로 다시 `bootCore`했을 때 instance lock이 막으면 고치지 말고 `e2e-support-core`의 `boot_test.ts`가 먼저 실패해 있을 것이다(그 task의 "계약 바꾸기 요청"을 따른다).
- 재시작 뒤에는 provider를 다시 연결하지 않는다(ledger에 남아 있다). fake server는 그대로 살아 있다(port 그대로). 재시작한 core가 runtime을 처음부터 맞는 권한으로 띄운다.
- 묻는 쓰기는 `e2e-approval`과 같은 `LOPHN.md`다.

## 할 일

1. 준비: `createRun` → `startFakeServer` → `bootCore` → `connectFakeProvider` → `run.work/proj` 만들기 → `openProject` → `openSession(project_manager)`.
2. fake 대답(2개): ① `{kind:"tool", calls:[{id:"t1", name:"file_write", arguments: JSON.stringify({path:"LOPHN.md", content:"rules"})}]}` ② `{kind:"text", text:"back"}`.
3. `say` → `waitPermission`(turn이 허락을 기다린다) → `core.kill()` → `bootCore(run)`으로 다시 띄운다(새 token) → `say(newCore, session, "again")` → `waitTurnEnd(newCore, session, 1)`.
4. 단정(3개, 서로 다른 곳):
   - ledger: `turnsOf`가 둘이고 첫 turn은 `finished`/outcome `interrupted`(이유 `restarted`), 둘째 turn은 `finished`/outcome `completed`. `sessions/read`로 session이 `open`이다.
   - 재시작 직후(두 번째 `say` 전에 한 번) `session_snapshots/list`의 그 session `permission_requests`가 비어 있다(메모리라 사라졌다).
   - disk: `proj/LOPHN.md`가 없다(허락 전에 꺼졌으니 쓰기는 일어나지 않았다). fake가 받은 요청은 정확히 2개(turn마다 하나)다.
5. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `run-loop`(재시작 때 돌던 turn이 interrupted로 닫힌다), `approvals`(turn 안 request는 재시작에 사라진다), `agent-sessions`(session은 남는다).
- 현실적 회귀: 재시작 뒤 turn이 running으로 남아 session이 영원히 바쁜 것, 사라졌어야 할 permission request가 남아 낡은 허락이 쓰이는 것, 재시작 뒤 새 message를 받지 못하는 것.
- 왜 지금 test로 못 잡나: `interruptRunningTurns`는 함수 단위 test도 없고, core가 실제로 꺼졌다 켜지는 흐름(ledger 파일이 남고 새 process가 읽는 것)은 process를 건너야 보인다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/restart_test.ts`를 **10번 연속** 통과한다(결과를 보고에 적는다). 끝난 뒤 `.dev-data/e2e/`가 비어 있고 `pgrep -af "\.dev-data/e2e"`가 0줄이다.
- 위험 test: "core가 꺼졌다 켜지면 돌던 turn은 interrupted로 닫히고 기다리던 permission은 사라지며 session은 새 message를 받는다"
- 남지 않음: `grep -rn "sleep\|setTimeout" tests/e2e/restart_test.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

