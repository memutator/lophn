# restart-rows

`tests/e2e/restart_test.ts`에 행 둘을 더한다: 정상으로 끝난 turn의 기록과 provider 연결이 core 재시작 뒤에도 그대로이고 같은 session이 이어진다(완료 기록), core 재시작 직전에 받아 turn을 열지 못한 사람 message가 재시작 뒤 turn을 연다(S4, 제품을 같이 고친다).

- 단위: restart-rows (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/restart_test.ts`
  - `packages/core/router/commands.ts`
  - `packages/core/router/router.ts`
  - `packages/core/main/daemon/wiring/router.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/session/message-commands.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md` "정한 것" 5(S4)
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md` 후보 `restart-queued-message`; `candidates-product.md` 후보 `restart-keeps-completed`
  - architecture: `project-docs/architecture/place-session.md`("입력함은 메모리", "입력함에 있던 call은 lophn_restarted로 닫힘"), `project-docs/architecture/agent-call.md`, `project-docs/architecture/event.md`(Reactor가 ledger에서 이어 간다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `agent-sessions`, `storage`, `secrets`
  - 코드: `packages/core/router/commands.ts`(`RecoverCalls`: `failLostOnStart` + `interruptRunningTurns`는 call만 닫는다), `packages/core/main/daemon/wiring/router.ts`(`start`가 `callsRecover`를 부르고 `createInboxApplier`가 commit 뒤 입력함을 채운다), `packages/core/lophn-agent/run-loop/inbox.ts`(메모리), `packages/protocol/lophn-agent/received-messages.ts`(`receivedMessageList`의 `turn`: 가져가지 않았으면 null)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `receivedMessageList`·`turnList`·`toolCallList`·`modelCallList`(`packages/protocol/lophn-agent/mod.ts`), `SECRET_FILE_NAME`(`packages/protocol/secrets/mod.ts`).
  - 내놓는 것: S4(제품): 재시작 때 `turn`이 null인 사람 message가 입력함에 돌아가 새 turn을 연다.

## 할 일

1. 시작 조건: `tests/e2e/restart_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-restart`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-restart`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. 지금 file은 `Deno.test` 하나다. 행마다 `Deno.test`를 하나씩 더한다. `session_snapshots/list` read가 있어야 한다(issues/event.md가 고쳐져 있어야 한다).
2. S4 고칠 것(제품). 추천값으로 간다: core를 켤 때 `RecoverCalls`와 같은 tx에서 state가 열린 session의 사람 message 가운데 `turn`이 null인 것(delivery `next_turn`, 아직 turn에 안 묶임)을 입력함에 되돌려 놓는다. 입력함은 메모리이므로 `createInboxApplier`(commit 뒤 입력함 반영)가 쓰는 길로 넣는다. 순서는 접수 순서다. call은 지금처럼 `lophn_restarted`로 닫는다(둘을 섞지 않는다). `inbox.ts`는 `turn-fate`가 고친다. 이 task는 router 쪽(`router/commands.ts`·`router.ts`, `wiring/router.ts`)에서 끝낸다. 입력함 file을 고쳐야 하면 보고한다.
3. 행 표.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `completed-survives` | `connectFakeProvider(key)` → `openSession(lophn)` → `say` → `waitTurnEnd` → 목록 넷을 문자열로 저장 → `core.kill()` → `bootCore` → `settle` → 같은 목록 → `say` → `waitTurnEnd(1)` | ① text ② text | ledger: 재시작 전후 `turnList`·`receivedMessageList`·`toolCallList`·`modelCallList` 출력이 같다 / fake: 둘째 요청의 `x-api-key`가 `key`와 같고(provider 연결을 다시 안 했다) 본문 messages에 첫 turn의 사람 글이 있다(history가 이어진다) / disk: `secrets.json`이 있고 mode가 0600이다 | `restart-keeps-completed`. 데이터 잃기 |
| `queued-message` (S4) | `openProject` → `openSession(PM)` → `say`(#1) → `fake.arrived(1)` → `say`(#2, 도는 중이라 입력함에 쌓임) → `core.kill()` → `bootCore` → `settle` → `waitTurnEnd(1)` | ① stall ② text | ledger: `turnsOf`가 둘이고 첫째는 `interrupted`·`restarted`, 둘째는 `completed`이며 `receivedMessageList`에서 #2의 `turn`이 둘째 turn의 id다 / fake: 둘째 요청 본문에 #2의 글이 있다(journal 2개) | `restart-queued-message`. 사람은 "보냈는데 아무 일도 안 일어남"을 본다 |

4. 고치기 전 코드에서 `queued-message`가 실패하는 것(둘째 turn이 안 열려 `waitTurnEnd(1)`이 제한 시간으로 실패)을 먼저 본다. 보고에 적는다.
5. 변경 항목: S4는 동작이 바뀐다. 전과 후를 보고에 적는다(changelog 재료).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `storage`·`secrets`(완료한 기록과 연결은 재시작에 남는다), `router`·`agent-sessions`(입력함은 메모리라 사라지지만 접수한 사람 message는 사라진 것으로 두지 않는다).
- 현실적 회귀: 재시작 뒤 기록이 비거나 key를 다시 넣어야 하는 것, 사람이 보낸 message가 접수 기록만 남고 영영 turn이 안 열리는 것.
- 왜 지금 test가 못 잡나: `restart`는 interrupted turn과 사라진 허락 요청만 본다. 완료한 기록의 보존과 입력함에 쌓인 사람 message의 운명은 ledger 파일이 남고 새 process가 읽는 재시작을 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/restart_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/restart_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 의심 S4: 고치기 전 코드에서 행 `queued-message`가 실패한 출력을 보고에 적었다.
- 위험 test: "재시작 뒤에도 완료한 기록이 그대로이고, 접수한 사람 message는 turn을 연다"

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
