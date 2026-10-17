# e2e-stop

turn 도중 사람이 멈추면 진행 중인 model 요청의 연결이 끊기고, turn은 사람이 멈춘 이유로 닫히며, 응답에 있던 tool은 실행되지 않는 것을 core 전체로 본다.

- 단위: e2e (wave 2)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tests/e2e/stop_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("core E2E 후보" 4번)
  - architecture: `project-docs/architecture/place-session.md`(turn 상태와 멈춤)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-sessions`, `supervision`(core가 멈춤을 child에 알리는 길)
  - 코드: `packages/protocol/lophn-agent/turns.ts`의 `stopTurn`(`turns/stop`, `compare: state_seq`), `run-loop/loop.ts`(`stop(reason)`이 진행 호출에 abort를 요청), `run-loop/turn-pipe.ts`·`work.ts`(멈춤이 child로 가는 길)
  - 앞 task가 만든 `tests/support/fake-server/`, `tests/support/core/`와 그 brief의 "내놓는 것"
- 계약:
  - 쓰는 것: fake-server(`startFakeServer`, `Reply`의 `stall`, `arrived(n)`, `aborted(n)`, `journal`), core support(`createRun`, `bootCore`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `stopTurn`, `waitTurnEnd`), route `turns/read`(`ReadTurn`), `tool-calls/list`.
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

- role은 `project_manager`, tool은 `file_write`다. 이유: 멈춘 뒤 "쓰기가 일어나지 않았다"를 disk로 단정하려면 쓰기 tool이 있는 role이어야 한다.
- 무응답이 아니라 `stall`을 쓴다: model이 tool call 하나를 말하다가(인자의 앞 절반만 보내고) 멈춘 응답이다. 사람이 멈추지 않으면 이 요청은 영원히 끝나지 않는다. 그래서 "멈춤이 요청을 끊는다"가 `aborted(1)`로만 풀린다.
- 기다림은 신호만 쓴다: `fake.arrived(1)`(요청이 도착), `fake.aborted(1)`(연결이 끊김). 각 await에 제한 시간(30초)을 건 도우미를 이 file에서 쓴다(멈춤이 안 먹히면 hang 대신 실패 메시지로 끝나야 한다).

## 할 일

1. 준비: `createRun` → `startFakeServer` → `bootCore` → `connectFakeProvider` → `run.work/proj` 만들기 → `openProject` → `openSession(project_manager)`.
2. fake 대답(1개): `{kind:"stall", partial:{tool:{id:"t1", name:"file_write", arguments: JSON.stringify({path:"stopped.md", content:"x"})}}}`(server가 인자의 앞 절반만 보낸다).
3. `say` → `await fake.arrived(1)` → `turnsOf(core, session)`에서 running turn을 찾아 `stopTurn(core, turn)` → `await fake.aborted(1)` → `waitTurnEnd`.
4. 단정(3개, 서로 다른 곳):
   - fake가 받은 요청: `aborted(1)`이 풀렸고 `fake.journal()`이 여전히 1개다(멈춘 뒤 새 요청이나 retry가 없다).
   - ledger: `turns/read`에서 turn이 `finished`, outcome이 `interrupted`이고 이유가 사람이 멈춘 값(코드의 `user_stopped` 계열 이유. 이름은 `TURN_OUTCOME_REASONS`에서 읽는다). `tool-calls/list`가 비어 있다.
   - disk: `proj/` 아래 file이 하나도 없다(`stopped.md`가 없다).
5. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `run-loop`(멈춤은 진행 중인 요청을 끊고 새 진입을 막는다), `agent-sessions`(turn이 사람 멈춤으로 닫힌다).
- 현실적 회귀: core가 turn을 닫았는데 child의 model 요청은 계속 열려 token을 쓰는 것, 멈춘 뒤에도 tool이 시작되는 것, 멈춤 신호가 child에 안 가 turn이 running으로 남는 것.
- 왜 지금 test로 못 잡나: harness loop는 `stop()`을 부르는 쪽(in-process)만 본다. core의 `turns/stop` → 감독 pipe → child의 loop → HTTP 연결 끊김까지는 process를 건너야 이어진다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/stop_test.ts`를 **10번 연속** 통과한다(결과를 보고에 적는다). 끝난 뒤 `.dev-data/e2e/`가 비어 있다.
- 위험 test: "사람이 멈추면 진행 중인 model 요청이 끊기고 응답의 tool은 실행되지 않는다"
- 남지 않음: `grep -rn "sleep\|setTimeout" tests/e2e/stop_test.ts`가 0줄이다(제한 시간 도우미는 `AbortSignal.timeout`을 쓴다).

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

