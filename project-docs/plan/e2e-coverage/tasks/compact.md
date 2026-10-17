# compact

사람이 compact를 요청하면 앞 구간이 요약으로 바뀌고 다음 model 요청이 요약을 쓰며 원문은 그대로 남는다. 요약 call이 실패해도 원문과 session의 나머지는 그대로고 다음 turn이 이어진다. `tests/e2e/compact_test.ts`.

- 단위: compact (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/compact_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/session/compact.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 7(`compact-roundtrip`); `candidates-product.md` 후보 `compact-failure-keeps-history`
  - architecture: `project-docs/architecture/agent-definition.md`("compact는 사람이 부를 때만", 입력이 예산을 넘으면 `context_limit`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `run-loop`, `models`
  - 코드: `packages/protocol/lophn-agent/sessions.ts`(`requestSessionCompact` compare `{state: "open", state_seq}`, `compactSession`, `failSessionCompact`, 실패 이유 6, `sessionSummary`), `packages/core/lophn-agent/session/{compact,compactor}.ts`, `packages/core/lophn-agent/run-loop/runtime-access.ts`(runtime이 요청을 읽는 길), `packages/protocol/lophn-agent/agent-sessions.ts`(`agentSessionRead`의 `compaction`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `requestSessionCompact`·`sessionSummary`·`agentSessionRead`·`receivedMessageList`·`modelCallList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 새 file이다. 같은 `Deno.test` 한 개 안에서 core를 한 번 띄우고 행마다 새 session을 연다(행의 준비를 반복하지 않는다). 준비: `connectFakeProvider`. 행마다 `openSession(lophn)`(project가 필요 없다). 사람 글에 행마다 다른 표지(`FIRST-MARK-<행>`)를 넣는다.
2. 행 표(요청 번호는 fake journal의 1부터).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `compact-ok` | `say`(표지 포함) → `waitTurnEnd` → `agentSessionRead`(`state_seq`) → `requestSessionCompact` → `agentSessionRead.compaction`이 null이 아닐 때까지 poll(`until`) → `say` → `waitTurnEnd(1)` | ① text ② text(요약. `SUMMARY-MARK`) ③ text | ledger: `agentSessionRead.compaction`이 있고 `sessionSummary.text`에 `SUMMARY-MARK`가 있으며 `receivedMessageList`에 첫 turn의 message가 그대로다(원문 유지) / fake: 3번 요청 본문에 `SUMMARY-MARK`가 있고 `FIRST-MARK`는 없다 / blob: `modelCallList`에 요약 call이 있다(call 셋) | 후보 7. 대화 이력은 사용자 data |
| `compact-fails` | 위와 같고 요약 요청이 실패 | ① text ② `{kind: "error", status: 400, body: ...}` ③ text | ledger: `agentSessionRead.compaction`이 null이고 `receivedMessageList` 개수가 그대로 / fake: 3번 요청 본문에 `FIRST-MARK`가 그대로 있다 / process: runtime child가 같은 pid로 살아 있고 둘째 turn이 `completed` | `compact-failure-keeps-history`. 실패 이유(`model_failed`)는 사람이 읽는 route가 없다. 단정하지 않는다 |

3. 요약에 turn이 하나로 부족하면(`nothing_to_summarize`) 첫 행에 turn을 하나 더 두는 대신 보고에 적고 harness로 내리는 것을 추천한다(대답이 4가 된다).
4. 실패 이유(`nothing_to_summarize`, `too_large`, `session_changed`) 경우의 수는 harness의 몫이다. 여기서 늘리지 않는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-sessions`(compact는 원문을 대체하지 않는 derived이고 어느 쪽이든 원문과 session의 나머지는 바뀌지 않는다), `run-loop`(요청 event를 runtime이 집어 가는 왕복), `models`(요약 call).
- 현실적 회귀: 요약 실패가 이력을 지우거나 session을 망가뜨리는 것, 요약이 만들어졌는데 다음 요청이 옛 원문을 쓰는 것, 요청을 runtime이 집어 가지 못해 영영 열려 있는 것.
- 왜 지금 test가 못 잡나: compactor의 경우의 수는 harness가 맡을 수 있지만 core의 요청 event를 child가 읽어 가고 `compactSession`/`failSessionCompact`로 돌아오는 왕복은 process를 건너야 한다. 지금 그 왕복을 보는 test가 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/compact_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/compact_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "compact는 성공하면 다음 요청이 요약을 쓰고, 실패해도 원문과 대화가 그대로다"

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
