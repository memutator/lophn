# e2e-approval

Gate가 묻는 쓰기(지침 파일 `LOPHN.md` 쓰기)가 사람의 결정까지 turn을 세워 두고, 허락하면 쓰이고 거절하면 file이 생기지 않고 거절이 다음 model 요청에 실리는 것을 core 전체로 본다.

- 단위: e2e (wave 2)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tests/e2e/approval_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("core E2E 후보" 2번)
  - architecture: `project-docs/architecture/approval.md`("지키는 것"의 request, "허락은 그 intent에 한 번만", "거절 이유는 agent에게 그대로 간다"). 주의: file tool은 Gate가 없고 지침 파일(`LOPHN.md`) 쓰기만 "설정 고치기"라 묻는다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `agent-tools`, `run-loop`
  - 코드: `packages/core/agent-roles/hooks.ts`(`FILE_HOOKS.writeGate`: 이름이 `LOPHN.md`인 file 쓰기가 Gate에 간다), `packages/core/approvals/turn-requests.ts`(turn 안 request, 메모리), `packages/protocol/approvals/requests.ts`(`DecideTurnPermission`: `approvals/decide_turn`), `packages/protocol/events/snapshot.ts`(`session_snapshots/list`의 `permission_requests`)
  - 앞 task가 만든 `tests/support/fake-server/`, `tests/support/core/`와 그 brief의 "내놓는 것"
- 계약:
  - 쓰는 것: fake-server(`startFakeServer`, `Reply`, `journal`), core support(`createRun`, `bootCore`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `waitPermission`, `decide`, `waitTurnEnd`), route `tool-calls/list`.
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

- 묻는 쓰기는 `LOPHN.md`다(role은 `project_manager`). 이유: 이 제품에서 turn 안 Gate에 걸리는 file 쓰기는 지침 파일뿐이다(`FILE_HOOKS.writeGate`). roadmap의 "Gate가 걸린 쓰기"가 가리키는 것이 이것이다.
- 두 행(허락, 거절)을 한 core·한 project로 돈다. 폴더 `proj/a`, `proj/b`를 미리 만들고 행마다 다른 쪽의 `LOPHN.md`를 쓴다(project를 둘 만들면 runtime 재기동이 한 번 더 든다). 행마다 `fake.reset()`과 새 session이다.
- 거절이 "다음 model 요청에 실린다"는 문구가 아니라 구조로 본다: 둘째 요청의 마지막 user message에 그 call id의 `tool_result` block이 있고, 그 내용이 허락 행의 같은 자리 내용과 다르다.

## 할 일

1. 준비: `createRun` → `startFakeServer` → `bootCore` → `connectFakeProvider` → `run.work/proj/{a,b}` 만들기 → `openProject(core, run.work/proj)`.
2. 행마다(fake 대답 2개):
   - 대답 ① `{kind:"tool", calls:[{id:"t1", name:"file_write", arguments: JSON.stringify({path:"<a|b>/LOPHN.md", content:"rules"})}]}` ② `{kind:"text", text:"done"}`.
   - `openSession(project_manager)` → `say` → `waitPermission(core, session)`(turn이 세워져 있다) → 이때 **file이 아직 없는 것**을 disk로 확인 → `decide(core, session, request, "allow" | "reject")` → `waitTurnEnd`.
3. 단정(행마다 3개 이하, 서로 다른 곳):

| 행 | disk | ledger(`tool-calls/list`) | fake가 받은 요청 |
|---|---|---|---|
| 허락(`a`) | 결정 전에는 `a/LOPHN.md`가 없고, 결정 뒤 내용이 `rules` | t1 `success` | 둘째 요청에 t1의 `tool_result`가 있다(내용을 `allowText`로 기억) |
| 거절(`b`) | 결정 뒤에도 `b/LOPHN.md`가 없다 | t1이 `success`가 아니다(상태와 code는 코드가 정한 값이고 test는 `!== "success"`만 본다) | 둘째 요청에 t1의 `tool_result`가 있고 그 내용이 `allowText`와 다르다 |

4. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `approvals`(결정은 사람 자격으로만, 허락은 한 intent에 한 번, 거절 이유가 agent에게 간다), `agent-tools`.
- 현실적 회귀: Gate를 건너뛰고 쓰기가 실행되는 수정(허락 전에 file이 생김), 거절했는데 쓰기가 되는 수정, turn이 기다리다가 결정 뒤 이어 가지 못하는 수정.
- 왜 지금 test로 못 잡나: `approvals_test.ts`·`gate_test.ts`는 판정과 request 표만 본다. turn이 child process에서 세워졌다가 core의 결정으로 이어지는 왕복은 process를 건너야만 보인다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/approval_test.ts`를 **10번 연속** 통과한다(결과를 보고에 적는다). 끝난 뒤 `.dev-data/e2e/`가 비어 있다.
- 위험 test: "묻는 쓰기는 사람이 허락하기 전에 실행되지 않고, 거절하면 실행되지 않으며 거절이 agent에게 전해진다"
- 남지 않음: `grep -rn "sleep\|setTimeout" tests/e2e/approval_test.ts`가 0줄이다.

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

