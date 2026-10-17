# stop-rows

`tests/e2e/stop_test.ts`에 행 넷을 더한다: shell이 도는 중에 멈추면 shell process(group)가 죽는다, 허락을 기다리는 중 멈추면 늦게 온 허락이 쓰기를 일으키지 못한다, session을 archive하거나 지울 때도 진행 중인 model 요청이 끊긴다.

- 단위: stop-rows (wave 3)
- 선행: turn-fate. 같은 run-loop file을 고칠 수 있어 순서를 묶는다.
- 소유(이 task만 고친다):
  - `tests/e2e/stop_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/run-loop/core-ports.ts`
  - `packages/core/lophn-agent/run-loop/driver.ts`
  - `packages/core/lophn-agent/places/lifecycle.ts`
  - `packages/core/lophn-agent/tools/shell/run.ts`
  - `packages/protocol/lophn-agent/sessions.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 1(`stop-while-asking`), 3(`end-session-mid-turn`); `candidates-bugs.md` 후보 `stop-pending-permission`, `stop-triggers`; `candidates-product.md` 후보 `stop-kills-shell`
  - architecture: `project-docs/architecture/approval.md`("turn 안 request는 원래 일이 끝나면 cancelled, 허락은 그 intent에 한 번만"), `project-docs/architecture/place-session.md`("archive와 지움은 모든 영향을 한 tx에 묶는다. 도는 turn은 interrupted로 닫고 진행한다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-sessions`, `approvals`, `agent-tools`
  - 코드: `packages/core/lophn-agent/tools/shell/run.ts`(`setsid` group, 멈춤 신호), `packages/core/lophn-agent/run-loop/{core-ports,driver,interrupt,commands}.ts`(`stop()`이 `turns/read`가 실패하면 "안 멈췄다"로 본다. delete는 turn 행을 지우므로 child가 멈춤 신호를 못 받을 수 있다. 코드로 읽음, 돌리지 않음), `packages/core/lophn-agent/places/lifecycle.ts`(archive·delete의 한 tx), `packages/core/approvals/turn-requests.ts`(`cancel`이 entry를 지운다)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `archiveSession`·`deleteSession`(compare `{state_seq}`는 `agentSessionRead`의 `state_seq`), `turnRead`, `toolCallList`, `approvalsDecideTurn`, `sessionSnapshotsList`.
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/stop_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-stop`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-stop`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. "model 요청 중 멈춤이 요청을 끊는다"(issues/place-session.md의 turn 멈춤 message)가 고쳐져 있어야 한다. 아니면 시작하지 말고 보고한다. 지금 file의 `within`, `filesUnder` helper를 재사용하고 행마다 `Deno.test`를 하나씩 더한다.
2. 행 표.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `stop-shell` | `openProject` → `openSession(PM)` → `say` → project 폴더에 `started` file이 생길 때까지 신호 poll(`until`, 제한 시간 있음) → running turn을 `turnsOf`로 찾아 `stopTurn` → `waitTurnEnd` → `/proc/*/cmdline`에 표지가 없어질 때까지 poll | ① tool `shell_run {command: "touch started && sleep 2999.<고유 숫자>"}`. `<고유 숫자>`는 `core.ids`에서 만든 숫자(예 4~6자리)로 `sh -c` 줄과 `sleep` 인자 양쪽에 같은 표지가 남게 한다 | process: 표지(`sleep 2999.<숫자>`)가 든 cmdline이 `/proc`에 없다(group이 통째로 죽었다) / ledger: turn이 `finished`·`interrupted`·`user_stopped`이고 shell call의 outcome이 `success`가 아니다 / fake: journal이 1개(멈춘 뒤 새 요청 없음) | `stop-kills-shell`. shell은 Gate도 Deno 권한도 없는 층이라 멈춤이 여기까지 닿는지 아무도 안 본다 |
| `stop-while-asking` | `openSession(PM)` → `say` → `waitPermission` → `stopTurn` → `waitTurnEnd` → `core.tryCall(approvalsDecideTurn, {session, request, choice: {kind: "allow"}})` | ① tool `file_write {path: "LOPHN.md", content: "rules"}` | disk: project에 `LOPHN.md`가 없다 / ledger·route: turn이 `interrupted`·`user_stopped`, `toolCallList`에 `success`가 없고 snapshot의 `permission_requests`가 비며 늦은 `decide`가 오류(`!ok`)다 / fake: journal이 1개 | 후보 1, `stop-pending-permission`. 낡은 허락이 쓰이면 권한 경계가 깨진다 |
| `end-session-archive` | `openSession(PM)` → `say` → `fake.arrived(1)` → `agentSessionRead`(`state_seq`) → `archiveSession` → `within("요청이 끊김", fake.aborted(1))` → 새 session에서 `say` → `waitTurnEnd` | ① stall ② text | fake: `aborted(1)`이 풀리고 둘째 요청(새 session)이 정상 답을 받는다 / ledger: 옛 turn이 `finished`·`interrupted`·`session_ended`이고 session `lifecycle`이 `archived` / process: runtime child가 같은 pid로 살아 있다(`runtimePids`가 앞과 같다) | 후보 3. 비용(archive한 session의 열린 요청) |
| `end-session-delete` | 위와 같고 `deleteSession` | ① stall ② text | fake: `aborted(1)`이 풀리고 둘째 요청이 정상 답 / ledger: `agentSessionRead`가 `not_found`이고 새 session이 `completed` / process: runtime pid가 그대로 | 후보 3 (b). 코드로 읽은 의심: 지운 turn 행을 `stop()`이 못 읽어 요청이 `stall_ms`까지 열릴 수 있다 |

3. 행 `end-session-*`의 `within`은 stop 행과 같은 30초다. 이 안에 `aborted`가 안 풀리면 제품 bug다: 지금 `deleteSession` 주석("진행 중인 run이 있으면 conflict", `protocol/lophn-agent/sessions.ts`)과 command 동작("도는 turn은 interrupted로 닫고 진행")이 달라 낡은 주석도 같이 고친다(그 file이 추가 소유다).
4. 제품을 고쳤으면 고치기 전 코드에서 그 행이 실패한 출력을 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `run-loop`(멈춤은 진행 중인 요청과 tool 실행을 끊고 새 진입을 막는다), `agent-sessions`(archive·delete는 한 tx이고 도는 turn은 interrupted로 닫힌다), `approvals`(낡은 허락은 쓰이지 않는다).
- 현실적 회귀: 멈췄는데 shell 명령이 계속 돌거나 늦게 끝나 반쯤 쓴 file이 남는 것, 멈춘 뒤 도착한 `allow`가 쓰기를 일으키는 것, session을 지웠는데 model 요청이 token을 계속 쓰는 것.
- 왜 지금 test가 못 잡나: 지금 `stop`은 model 요청 abort 하나만 본다. harness는 loop의 `stop()` 호출 쪽만 보므로 core의 `turns/stop` → 감독 pipe → child → shell process, 그리고 archive·delete의 연쇄는 process를 건너야 이어진다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/stop_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/stop_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "멈춤과 session 끝은 진행 중인 shell·model 요청을 끊고 낡은 허락이 쓰기를 일으키지 못한다"

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
