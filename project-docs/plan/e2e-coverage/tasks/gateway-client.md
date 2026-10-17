# gateway-client

test가 shell main 역할로 Gateway(`GET /gateway`, subprotocol `lophn.gateway.1`)에 붙어 event와 `coding_terminal` frame을 받고, harness 감지 보고와 터미널 결과를 core에 알리는 helper를 `tests/support/gateway/`에 만든다. 이 support가 맞게 도는지 `tests/e2e/gateway_test.ts` 하나로 본다(Gateway에 늦게 붙은 화면이 snapshot으로 대기 중인 허락을 본다).

- 단위: gateway-client (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/gateway/`
  - `tests/e2e/gateway_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("화면은 조건을 걸고 ready를 받은 뒤 snapshot을 읽는다", "agent event는 저장하지 않고 replay하지 않는다"), `project-docs/architecture/coding-agent.md`(Gateway frame `open`/`input`/`stop`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `event-stream`, `core-api`, `coding-agent-cli-interface`
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 16(`gateway-late-join`), `candidates-bugs.md` 후보 `gateway-turn-events`, `candidates-product.md` 후보 `gateway-pending-visible`, 묶음 G3
  - 코드: `packages/protocol/events/gateway.ts`(`GATEWAY_PATH`, `GATEWAY_SUBPROTOCOL`, `gatewayServerFrameSchema`, watch frame), `packages/protocol/events/bus.ts`(`eventConditionSchema` = `{session?, types?}`), `packages/protocol/coding-agent/{terminal-requests,harness-report,harnesses,launch-plan}.ts`, `packages/core/server/socket.ts`, `packages/core/events/gateway.ts`(frame은 watch와 상관없이 연결된 session 전부로 간다. 연결이 없으면 `unavailable`)
  - main의 `tests/support/core/{mod,process,human}.ts`(지금 계약: `createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(지금 계약: `createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `packages/protocol/events/mod.ts`의 `gatewayServerFrameSchema`·`eventConditionSchema`·`sessionSnapshotsList`, `packages/protocol/coding-agent/mod.ts`의 `harnessReport`·`codingTerminalResult`·`codingTerminalExited`·`codingTerminalFrameSchema`. 연결은 Deno `new WebSocket(url, { protocols: [GATEWAY_SUBPROTOCOL], headers: { authorization: "Bearer " + core.token } })`다(Origin을 보내지 않는다).
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

```ts
// tests/support/gateway/mod.ts
connectGateway(core: Core, options?: { conditions?: EventCondition[] }): Promise<Gateway>
// watch frame을 보내고 `ready`를 받은 뒤 돌아온다. conditions를 안 주면 []다.
type Gateway = {
  frames(): readonly GatewayServerFrame[];                // 받은 순서 전부
  next<T extends GatewayServerFrame["type"]>(type: T, match?: (frame: Extract<GatewayServerFrame, {type: T}>) => boolean, timeoutMs?: number): Promise<Extract<GatewayServerFrame, {type: T}>>;
  // 아직 안 가져간 frame 중 처음 맞는 것. 없으면 올 때까지(제한 시간 30초, 신호를 읽는 대기이지 sleep이 아니다)
  watch(conditions: EventCondition[]): Promise<void>;     // 조건을 바꾸고 `ready`를 기다린다
  close(): Promise<void>;                                 // 소켓을 닫고 onclose까지 기다린다
};

// tests/support/gateway/shell.ts   (shell main이 하는 일. PTY는 없다)
reportHarness(core: Core, harness?: HarnessId): Promise<void>;
// `harness/report`로 detection 하나를 알린다(discovery detected, selected_executable은 절대 경로 하나, version verified, auth verified).
// 기본 harness는 canLaunch가 true인 "claude"다. 실행 파일은 실제로 실행되지 않는다.
waitCodingTerminal(gateway: Gateway): Promise<{ request: string; plan: CodingLaunchPlan }>;   // `coding_terminal` frame의 `open`
answerTerminal(core: Core, request: string): Promise<void>;                                   // coding_agent_terminals/result {ok: true}
exitTerminal(core: Core, session: string, reason?: "exited" | "killed" | "host_lost"): Promise<void>;   // coding_agent_terminals/exited
```

## 할 일

1. `tests/support/gateway/`를 위 모양으로 만든다. file은 `mod.ts`(연결)와 `shell.ts`(shell main 역할) 둘이다. 받은 frame은 `gatewayServerFrameSchema`로 검사해 쌓는다. 근거: README "지켜야 할 것"(coding token은 Gateway frame으로만), 묶음 G3.
2. `reportHarness`의 detection 값은 `harnessDetectionSchema`가 통과하는 가장 작은 것으로 만든다(`observed_at`, `candidates`, `version`, `auth`, `probe_results` 칸). 이름·경로 어느 것도 사람의 PATH를 읽지 않는다.
3. 먼저 확인할 것(코드로 읽음, 돌려 보지 않음): `Deno.WebSocket`이 `headers` 옵션을 받는지, `Host`·`Origin` gate(`packages/core/server/request.ts`)가 통과하는지, frame이 `watch` 전에도 오는지. 막히면 임시로 고치지 말고 "계약 바꾸기 요청"에 적는다.
4. 자기 점검 E2E `tests/e2e/gateway_test.ts` 하나(`candidates-invariants.md` 후보 16, `candidates-product.md` `gateway-pending-visible`):

| 항목 | 내용 |
|---|---|
| case | 허락을 기다리는 turn이 있을 때 Gateway에 늦게 붙은 화면이 snapshot으로 대기 요청을 보고, replay는 없고, 결정 뒤 두 연결 모두 turn 끝을 받는다 |
| route 순서 | `bootCore` → `connectFakeProvider` → `openProject` → `openSession`(PM) → `connectGateway`(A, 조건 `{session}`) → `say` → A `next("event", PermissionRequested)` → `connectGateway`(B, 같은 조건) → `sessionSnapshotsList` → `decide(allow)` → A·B `next("event", TurnEnded)` |
| fake 대답(2) | ① tool `file_write {path: "LOPHN.md", content: "rules"}`(`LOPHN.md` 쓰기만 Gate가 묻는다. `agent-roles/hooks.ts`의 `writeGate`) ② text |
| 단정(3) | event: A는 `PermissionRequested`를 정확히 한 번 받았고 B는 `ready` 뒤 snapshot을 읽을 때까지 그 event를 받지 않았다 / route: B가 읽은 snapshot에 request가 하나, 결정 뒤 `turnsOf`가 completed / disk: `LOPHN.md`가 있다 |

   event 이름·payload 칸은 `packages/protocol/events/{agent,bus}.ts`에서 읽는다. event type 목록을 test에 복사하지 않는다.
5. 소켓과 timer가 test 끝에 남지 않게 `try/finally`로 `close()`한다(sanitizer를 끄지 않는다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `event-stream`(Gateway는 ready 뒤 snapshot을 읽는 계약이고 replay·ack가 없다), `core-api`(Gateway frame과 snapshot read).
- 현실적 회귀: ready 전에 event를 흘려 늦게 붙은 화면이 옛 요청을 두 번 보는 것, snapshot에 대기 요청이 안 실려 화면이 허락 요청을 못 보고 turn이 영영 멈추는 것(commit `5e99b50f7`, `6fb8e7312`가 test 없이 land했다), 토큰 없는 upgrade가 열리는 것.
- 왜 지금 test가 못 잡나: Gateway는 socket이 필요해 unit이 없고 지금 E2E 7개는 route poll(`waitPermission`)로만 본다. `events` unit은 조건 매칭만 본다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/gateway_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/gateway_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- `tests/support/gateway/`의 `shell.ts` 중 `waitCodingTerminal`·`answerTerminal`·`exitTerminal`은 이 task에서 돌려 볼 길이 없다(App Engineer의 call이 필요). 그래서 type 검사(`deno check`)와 schema 대조까지만 하고 "알려진 미완 동작"에 `test-app`이 처음 돌려 본다고 적는다.
- 위험 test: "Gateway에 늦게 붙은 화면이 snapshot으로 대기 중인 허락 요청을 보고, 결정 뒤 turn 끝을 받는다"

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
