# turn-fate

agent runtime child가 사라질 때 돌던 turn이 어떻게 되는지를 정하고 고친 뒤 `tests/e2e/turn-fate_test.ts`로 본다. S1: child를 다시 띄워야 할 때(project 폴더·provider·MCP·skill 목록이 바뀜) 도는 turn이 있으면 그 turn이 끝날 때까지 미루고, child가 crash하면 돌던 turn을 `interrupted`(이유 `restarted`)로 닫는다. S3: supervisor의 재기동 횟수는 연속 실패만 센다(child가 ready 뒤 60초를 버티면 0으로 되돌린다).

- 단위: turn-fate (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/turn-fate_test.ts`
  - `packages/core/lophn-agent/run-loop/runtime.ts`
  - `packages/core/lophn-agent/run-loop/runtime_test.ts`
  - `packages/core/lophn-agent/run-loop/inbox.ts`
  - `packages/core/lophn-agent/run-loop/interrupt.ts`
  - `packages/core/lophn-agent/run-loop/commands.ts`
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
  - `packages/protocol/lophn-agent/turns.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
  - `packages/core/supervision/responsiveness/run.ts`
  - `packages/core/supervision/responsiveness/slot.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md` "정한 것" 4(S1), 6(S3)
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 2(`runtime-ends-mid-turn`)와 "조사가 더 필요한 것"의 `runtime-restart-limit`; `candidates-bugs.md` N2, 후보 `runtime-lost-midturn`
  - architecture: `project-docs/architecture/place-session.md`("폴더 목록이 바뀌면 process를 다시 띄우고 돌던 turn은 끊긴다", "file tool의 범위"), `project-docs/architecture/event.md`(돌던 turn은 interrupted로 닫고)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `supervision`, `agent-sessions`, `child-supervision-protocol`
  - 코드: `run-loop/runtime.ts`(1초 polling이 `updateSpec`으로 child를 바꾼다. `onEnd`는 credential만 회수한다), `run-loop/interrupt.ts`(`interruptRunningTurns`는 writer tx 안에서만 불린다. 부르는 곳: `RecoverCalls`와 session 끝), `run-loop/inbox.ts`(`running` 집합은 core 메모리라 child가 죽으면 그대로 남는다), `run-loop/turn-pipe.ts`(`began`·`ended` op), `supervision/responsiveness/{supervisor,run,slot}.ts`(`failures`는 늘기만 한다. `updateSpec`은 `makeSlot`으로 새 slot을 만들어 0으로 되돌린다. 그러므로 S3가 닿는 길은 폴더·provider 변경이 아니라 같은 slot의 crash가 누적되는 것이다)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `projectApi.register`(`openProject` helper가 쓰는 입력 모양을 따른다), `platformHealth`(`agent-runtime` observation), `turnRead`.
  - 내놓는 것: 없음(제품 동작이 바뀐다. 아래 "고칠 것")

## 할 일

1. S1 고칠 것(제품). 추천값으로 간다. 사람이 바꾸면 이 절만 바꾼다.
   - child가 끝나면(`runtime.ts`의 `onEnd`, crash든 교체든) core가 그 child의 running turn을 `{kind: "interrupted", reason: "restarted"}`로 닫는다. `interruptRunningTurns`는 writer tx 안에서만 부를 수 있으므로 core 안 machine 자격의 writer command 하나가 필요하다. `StopTurn`은 사람 멈춤(`user_stopped`) 하나뿐이고 `RecoverCalls`는 받은 call까지 닫아 쓸 수 없다. 새 command 하나를 최소로 더한다(`protocol/lophn-agent/turns.ts`에 route, `run-loop/commands.ts`에 handler, `runtime-access.ts`·`runtime.ts`의 operation 목록, wiring 주입). protocol을 바꾸므로 쓰는 쪽을 같은 변경에서 고친다.
   - 같은 때 `inbox`의 `running` 표시를 푼다(그대로 두면 새 입력이 "도는 turn" 취급을 받는다). 그 turn에서 기다리던 권한 요청·질문은 core 메모리에 남으므로 `turn_ended`로 취소한다(`approvals/turn-requests.ts`의 취소 길을 쓴다. `interrupt.ts` 머리 주석이 그 책임을 approvals와 agent-tools로 둔다).
   - `runtime.ts`의 polling은 도는 turn이 있으면 `updateSpec`을 부르지 않고 다음 주기로 미룬다. "도는 turn이 있다"는 `inbox`의 `running`이 정본이다(`Inbox`에 `anyRunning()` 하나를 더한다). 미루는 동안 목록이 또 바뀌어도 마지막 목록으로 한 번만 바꾼다(지금 비교 로직이 그대로 한다).
2. S3 고칠 것(제품, 작음): `supervision/responsiveness/run.ts`에서 child가 ready 뒤 60초를 버티면 `slot.failures = 0`으로 되돌린다(시각은 supervisor가 받는 clock으로 잰다). ready 직후 되풀이해 죽는 child가 끝없이 다시 뜨지 않게 하려는 것이다(planner 검토). `slot.ts`의 "ready는 이 수를 지우지 않는다" 주석도 고친다. test는 가짜 clock이 없으면 이 60초를 기다리지 않는다: E2E 행은 "연속 crash가 한도를 넘으면 멈춘다"만 보고, 60초 뒤 되돌림은 `run_test.ts`(unit)에 둔다.
3. unit 하나(위험: 도는 turn을 끊는 재기동): `run-loop/runtime_test.ts`에 `startAgentRuntimeChild`를 가짜 `io`(`updateSpec` 호출을 센다), `pollMs: 1`, 바뀌는 `readPlaceFolders`, "도는 turn 있음" 신호로 돌려 (a) turn이 도는 동안 목록이 바뀌어도 `updateSpec`이 안 불리고 (b) turn이 끝나면 한 번 불리는 것을 본다. 기다림은 `readPlaceFolders`가 N번 불린 것을 deferred로 신호받는 것이고 sleep이 아니다. 단정 둘.
4. E2E `tests/e2e/turn-fate_test.ts`: `Deno.test` 하나, core 하나, 행마다 새 session. 순서대로 돈다(c가 마지막).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `a-crash-mid-turn` (S1) | `openProject` → `openSession(PM)` → `say` → `fake.arrived(1)` → `Deno.kill(runtimePids(home)[0], "SIGKILL")` → `settle(core, [옛 pid])` → `waitTurnEnd(0)` → `say` → `waitTurnEnd(1)` | ① stall(tool 인자 앞 절반) ② text | ledger: turn 0이 `finished`·`interrupted`·이유 `restarted`, turn 1이 `completed`(둘째 `say`가 `conflict` 없이 열린다) / fake: `aborted(1)`이 풀렸고 journal이 2개 / process: `runtimePids(home)`가 새 pid 하나 | 후보 2(b), N2. 고치기 전에는 turn 0이 `running`으로 남아 `waitTurnEnd(0)`이 제한 시간으로 실패해야 한다 |
| `b-folder-added-mid-turn` (S1 미룸) | `openSession(PM)` → `say` → `waitPermission` → `core.call(projectApi.register, 둘째 폴더)`(`openProject`는 `settle`에서 막히므로 쓰지 않는다) → `decide(allow)` → `waitTurnEnd(0)` → `settle(core, [옛 pid])` → `say` → `waitTurnEnd(1)` | ① tool `file_write LOPHN.md`(Gate) ② text ③ text | ledger: turn 0이 `completed`(끊기지 않았다)이고 turn 1이 `completed` / disk: `LOPHN.md`가 쓰였다 / process: turn 0이 끝난 뒤 runtime pid가 바뀌었다(새 폴더로 다시 떴다) | 후보 2(a). 고치기 전 코드에서의 실패는 시간 경쟁이라 보장하지 않는다. 미룸 자체는 3의 unit이 지킨다 |
| `c-four-crashes` (S3) | `openSession(lophn)` → (`runtimePids` → SIGKILL → `settle(core, [옛 pid])`) ×4 → `say` → `waitTurnEnd` | ① text | process: 네 번째 crash 뒤에도 `platformHealth`의 `agent-runtime`이 available이고 pid가 하나 / ledger: turn이 `completed` / fake: journal이 1개 | `runtime-restart-limit`. 고치기 전에는 네 번째 뒤 `settle`이 제한 시간으로 실패한다(slot이 `restart limit reached`로 unavailable) |

5. 고치기 전 코드에서 a와 c가 실패하는 것을 먼저 본다(제품을 고치기 전에 test만으로 돌린다). 실패 출력 한 줄씩을 보고에 적는다.
6. c는 재기동 지연이 1초(후속 crash도 첫 지연)이고 spawn이 든다. 한 번 도는 데 20초를 넘으면 보고하고, 횟수를 줄이는 대신 table 밖으로 빼지 않는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `run-loop`(돌던 turn은 끊기면 닫힌다), `supervision`(child 재기동의 한도와 포기), `agent-sessions`(session은 남고 새 입력이 새 turn을 연다).
- 현실적 회귀: child가 죽거나 교체돼 turn 행이 `running`으로 남고 그 session이 사람이 멈출 때까지 새 입력을 못 받는 것(`turns_running_session` unique index가 `conflict`를 낸다), project를 몇 번 더하면 어느 순간 agent runtime이 영구 unavailable이 되는 것(crash 누적).
- 왜 지금 test가 못 잡나: `restart`는 core가 꺼지는 길(`RecoverCalls`)만 본다. child 단독 종료는 어떤 test도 안 보고, supervision 쪽은 unit이 없다(`responsiveness`에 `_test.ts`가 없다).

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/turn-fate_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/turn-fate_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- `deno test --no-check packages/core/lophn-agent/run-loop/runtime_test.ts`가 통과한다.
- 의심 S1·S3: 고치기 전 코드에서 행 a와 c가 실패한 출력을 보고에 적었다.
- 변경 항목: S1과 S3는 동작이 바뀐다. 전과 후를 보고에 적는다(changelog 재료).
- 위험 test: "child가 사라져도 돌던 turn은 닫히고 session은 새 입력을 받으며, 도는 turn이 있으면 child를 바꾸지 않는다"

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
