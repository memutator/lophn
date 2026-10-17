# e2e-file-write

project manager가 data root 밖 project 폴더에 file을 쓰고(agent runtime child의 Deno 권한), 폴더 밖 쓰기는 거절되는 것(file tool scope)을 core 전체로 본다.

- 단위: e2e (wave 2)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tests/e2e/file-write_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("core E2E 후보" 1번, "case 고르는 규칙")
  - architecture: `project-docs/architecture/place-session.md`(place 폴더가 agent의 범위다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `agent-roles`, `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`, `packages/core/lophn-agent`
  - 코드: `packages/core/lophn-agent/tools/runtime-permissions.ts`(runtime의 Deno 권한), `packages/core/lophn-agent/tools/file/{write,scope}.ts`(scope 검사), `packages/core/agent-roles/place/place-folders.ts`, `packages/core/agent-roles/tool-lists.ts`(PM은 `file.write`를 가진다)
  - 앞 task가 만든 `tests/support/fake-server/`, `tests/support/core/`와 그 brief(`project-docs/plan/testing/tasks/e2e-support-server.md`, `e2e-support-core.md`의 "내놓는 것")
- 계약:
  - 쓰는 것: `startFakeServer`·`Reply`(fake-server), `createRun`·`bootCore`·`connectFakeProvider`·`openProject`·`openSession`·`say`·`waitTurnEnd`(core support), route `tool-calls/list`(`ListToolCalls`, `protocol/lophn-agent/tool-calls.ts`).
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

- role은 `project_manager`다. 이유: `file.write`를 가진 role 중 project 폴더에서 일하는 role이고(`lophn`은 쓰기 tool이 없다), place 규칙이 project 폴더 읽기·쓰기를 준다(`placeScope`).
- project 폴더는 `run.work` 아래 임시 폴더다. 폴더 밖 쪽은 `run.work`의 다른 폴더(`outside`)다. 이유: data root 밖이면서 project 폴더 밖이어야 scope 거절을 본다.
- Deno 권한 경계는 "쓰기가 성공한다"로 본다. 권한이 빠지면(과거 `NotCapable` 사례) scope 검사는 통과해도 쓰기가 실패한다. 반대로 폴더 밖 거절은 scope 검사(`forbidden`)가 먼저 막는다. 두 겹의 거절을 따로 보려면 scope를 우회하는 길이 필요한데 없으므로 이 flow는 겹쳐서 본다.

## 할 일

1. 준비(file당 한 번, `try/finally`로 닫는다): `createRun` → `startFakeServer` → `bootCore` → `connectFakeProvider(core, fake)` → 폴더 `run.work/proj`, `run.work/outside` 만들기 → `openProject(core, proj)` → `openSession(core, {role:"project_manager", project})`.
2. fake 대답(2개): ① `{kind:"tool", calls:[{id:"t1", name:"file_write", arguments: '{"path":"note.md","content":"hello"}'}, {id:"t2", name:"file_write", arguments: JSON.stringify({path: "<run.work>/outside/leak.md", content:"leak"})}]}` ② `{kind:"text", text:"done"}`. tool 이름은 wire 이름(`.`이 `_`)이다. 둘째 call의 경로는 절대 경로다.
3. `say(core, session, "write the note")` → `waitTurnEnd(core, session)`.
4. 단정(3개, 서로 다른 곳):
   - disk: `proj/note.md`의 내용이 `hello`이고 `outside/leak.md`는 없다(`outside/` 아래에 file이 하나도 없다).
   - ledger: `tool-calls/list`에서 t1은 `success`, t2는 `failure`이고 code가 `forbidden`이다.
   - fake가 받은 요청: `fake.journal()`이 2개이고, 둘째 요청 본문의 마지막 user message에 `tool_result`가 두 개(id `t1`, `t2`)다. 문구는 단정하지 않는다.
5. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `agent-tools`(file tool의 scope), `run-loop`(agent runtime child의 권한). architecture `place-session.md`의 "place 폴더가 범위".
- 현실적 회귀: runtime child의 `--allow-write`에서 place 폴더가 빠져 `NotCapable`로 쓰기가 실패하는 것(이미 한 번 난 일), scope 검사에서 절대 경로나 `..`가 새는 것.
- 왜 지금 test로 못 잡나: `scope_test.ts`는 scope 함수만 보고, child process의 Deno 권한은 process를 건너야만 보인다. harness는 in-process라 권한 문제가 없다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/file-write_test.ts`를 **10번 연속** 통과한다(`for i in $(seq 10)`로 돌려 결과를 보고에 적는다). 끝난 뒤 `.dev-data/e2e/`가 비어 있다.
- 위험 test: "agent는 자기 project 폴더에는 쓰고 그 밖에는 쓰지 못한다"
- 남지 않음: `grep -rn "sleep\|setTimeout" tests/e2e/file-write_test.ts`가 0줄이다.

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

