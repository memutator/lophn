# steer

turn이 도는 중(허락 대기)에 사람이 steer로 보낸 message는 다음 model 요청에 같이 실리지만 checkpoint는 아니다. `tests/e2e/steer_test.ts`. 우선순위가 낮다(규칙 자체는 loop 규칙이라 harness로 내릴 수 있다).

- 단위: steer (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/steer_test.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 8(`steer-mid-turn`)
  - architecture: `project-docs/architecture/agent-call.md`("steer는 사람 메시지만 고른다. call, 답, reaction, 알림은 항상 다음 turn"), `project-docs/architecture/place-session.md`("checkpoint는 turn을 시작하는 입력마다 생긴다. steer로 도는 turn에 들어간 메시지는 아니다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `agent-sessions`, `run-loop`
  - 코드: `packages/core/lophn-agent/run-loop/inbox.ts`(`put`: steer이고 도는 turn이 있으면 steering 목록), `packages/protocol/lophn-agent/inputs.ts`(`sendMessage` `delivery: "steer"`), `packages/core/lophn-agent/session/rewind/checkpoints.ts`, `packages/protocol/lophn-agent/session-rewinds.ts`(`sessionRewindPreview`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
  - 먼저 `tests/harness/loop`에 steering을 다음 요청에 싣는 행이 있는지 본다. 지금은 없다(`tests/support/loop/harness.ts`의 `inputs`는 steering을 늘 빈 목록으로 준다). 그 행을 harness에 더하는 것이 더 싸다면 그 행을 만들지 말고 보고에 "harness로"라고 적고 이 E2E는 단정 3(checkpoint 아님)만 남긴다.
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `sendMessage`·`receivedMessageList`·`sessionRewindPreview`·`turnList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 새 file이다. 같은 `Deno.test` 한 개 안에서 core를 한 번 띄우고 행마다 새 session을 연다(행의 준비를 반복하지 않는다). 준비: `connectFakeProvider`, project 폴더, `openProject`, `openSession(PM)`.
2. case 하나(대답 2):

| 항목 | 내용 |
|---|---|
| route 순서 | `say`(#1) → `waitPermission` → `core.call(sendMessage, {..., delivery: "steer"})`(#2. `say` helper는 `next_turn`만 보내므로 직접 부른다) → `decide(allow)` → `waitTurnEnd` → `sessionRewindPreview` ×2 |
| fake 대답 | ① tool `file_write {path: "LOPHN.md", content: "rules"}`(Gate가 허락을 기다리게 한다) ② text |
| 단정 1 (fake) | 둘째 요청의 마지막 user message에 `tool_result`(t1)와 #2의 text가 같이 있다(구조만) |
| 단정 2 (ledger) | `turnsOf`가 하나이고 `receivedMessageList`에서 #2의 `turn`이 그 turn이다(새 turn이 열리지 않았다) |
| 단정 3 (route) | `sessionRewindPreview {choice: "messages_only", checkpoint: #2}`는 오류이고 `checkpoint: #1`은 통과한다 |

3. `restore_all`은 쓰지 않는다(`rewind/preview`의 `restore_all` 실패 bug와 얽히지 않게 `messages_only`로 본다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `router`·`agent-sessions`(steer는 도는 turn의 다음 model 요청에 붙고 새 turn도 checkpoint도 만들지 않는다), `run-loop`.
- 현실적 회귀: steer가 다음 turn 입력으로 밀려 사람이 도는 turn에 끼어들 수 없는 것, steer로 들어간 message가 checkpoint가 되어 rewind 지점으로 잘못 보이는 것.
- 왜 지금 test가 못 잡나: steering 목록은 core 메모리(입력함)이고 child가 가져가는 길과 checkpoint 표는 process 둘을 건너야 이어진다. harness loop에 steering 행이 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/steer_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/steer_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: 없음(핵심 흐름이지만 사용자 data·권한·secret이 아니다. 우선순위가 낮으면 접는다 — 보고에 "접자"고 써도 된다)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
