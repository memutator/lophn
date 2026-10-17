# coding-one-per-app

앱 하나에 coding session은 한 번에 하나다. 앞 session이 도는 동안 같은 앱에 둘째 ticket을 맡기면 call은 받는 session 없이 `accepted`로 줄에 서고(터미널 요청도 나가지 않는다), 앞 session이 끝나면 줄 맨 앞 call이 새 session(새 token)으로 열린다. `tests/e2e/coding_test.ts`에 행 하나를 더한다.

- 단위: coding-one-per-app (wave 3)
- 선행: coding-message-to-ae. 같은 `tests/e2e/coding_test.ts`를 순서대로 고친다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/coding/lines.ts`
  - `packages/core/apps/tickets/coding/transport.ts`
  - `packages/core/apps/tickets/coding/launch.ts`
  - `packages/core/apps/tickets/coding/sessions.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-one-per-app`
  - architecture: `project-docs/architecture/coding-agent.md`("앱 하나에 coding session은 한 번에 하나다. 그동안 온 맡기기는 앱마다 줄에 세웠다가 앞 session이 끝나면 연다"), `project-docs/architecture/agent-call.md`("coding agent에게 맡기기는 Router가 session을 열지 않고 coding transport가 연다. 앱에 끝나지 않은 coding session이 있으면 앱 줄에 서고, call은 받는 session 없이 accepted로 기다린다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `router`, `external-coding-agent`
  - 코드: `packages/core/apps/tickets/coding/transport.ts`(`start`: `activeOf`가 있으면 `pushLine`하고 `queued`), `packages/core/apps/tickets/coding/lines.ts`(`openNext`: 앞 session이 끝나면 줄 맨 앞을 `openSession`하고 `setReceiver`), `packages/core/apps/tickets/coding/sessions.ts`(`endSession`이 `openNext`를 부른다), `packages/protocol/coding-agent/launch-plan.ts`(`plan.session`, `plan.ticket`, `plan.first_prompt`), `packages/protocol/lophn-agent/calls.ts`(`callRead`: 줄에 선 call의 `receiver_session`은 null)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/gateway/`(`connectGateway`, `answerTerminal`, `exitTerminal`, `Gateway.next/frames`), `tests/support/coding/{cli,hand-off}.ts`(`codingCli`, `handOff`, `handOffQueued`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `coding-token-scope`가 만든 `coding_test.ts`의 `Ctx`(`tokens` 포함)·`ROWS`와 `Started`·`Queued`, `handOffQueued`(같은 App Engineer session에서 두 번째 맡기기), `Gateway.next("coding_terminal", match)`(`gateway-client`), `callRead`
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `coding-message-to-ae`가 merge됐다. `ROWS`에 행 하나를 더한다.
2. 행 하나. 같은 앱, 같은 App Engineer session에서 맡기기를 두 번 한다. 두 번째 `handOffQueued`의 tool call id는 첫 번째와 달라야 한다(`hand-off.ts`가 turn 번호로 구분한다. 같으면 새 call이 아니라 옛 call이 돌아온다). 앞 session을 끝내면 그 call이 실패로 닫히며 App Engineer에게 reaction turn이 하나 더 돈다(turn 2). 그 turn이 끝나야 행이 끝난다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `queue-then-open` | `ctx.handOff(app)`(#1) → `handOffQueued(core, fake, app)`(#2) → (`callRead`로 #2 읽기) → `fake.script([text])` → `exitTerminal(core, 세션1)` → `app.gateway.next("coding_terminal", (frame) => frame.request.kind === "open" && frame.request.plan.ticket === 티켓2)` + `answerTerminal` → `cli`(둘째 token)로 `ticket show {ticket: 티켓2}` → `waitTurnEnd(core, app.ae, 2)` | 맡기기 셋 ×2(helper) + ① text(앞 session의 끝 reaction) | ledger: 둘째 맡기기 직후 `callRead {call: #2}`가 `accepted`이고 `receiver_session`이 null이며, 이 앱의 `open` frame은 `app.gateway.frames()`에 하나뿐이다(터미널 요청이 나가지 않았다) / gateway: #1을 끝낸 뒤 둘째 `open` frame이 오고 `plan.session`이 #1과 다르고 `plan.env[CODING_TOKEN_ENV]`가 #1의 token과 다르며 `plan.first_prompt`가 티켓2를 가리키고, 그때 `callRead {call: #2}`의 `receiver_session`이 `plan.session`이다 / CLI: #1의 token은 `ticket show`가 `unauthorized`, 둘째 token은 티켓2를 읽는다 | 후보 `coding-one-per-app`(candidates-docs 9절이 적은 217행). 앞 session의 끝이 줄을 연다(`endSession` → `openNext`) |

   둘째 token은 `plan.env[CODING_TOKEN_ENV]`에서 읽는다(`codingCli(core, token)`). `ctx.tokens`에 쌓는 `ctx.handOff` 밖에서 받은 token이므로 행이 직접 `ctx.tokens.push(token)`한다(`coding-token-not-stored`가 마지막에 쓴다).
3. "터미널 요청이 나가지 않았다"는 없는 것을 보는 단정이라 sleep 없이는 완전하지 않다. 결정적인 단정은 `receiver_session`이 null이고 상태가 `accepted`인 것(ledger)이다. frame 개수는 보조로 쓴다(둘째 맡기기의 turn이 끝난 뒤라 frame이 왔다면 이미 도착해 있다). 이 보조 단정이 흔들리면(10번 연속에서 실패) 지우고 ledger 단정만 남긴다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-tickets`·`router`(앱 하나에 coding session은 하나이고 나머지는 줄에 선다), `external-coding-agent`.
- 현실적 회귀: 같은 source 폴더에 coding session 둘이 동시에 뜨는 것(서로 부딪친다), 줄에 선 call이 앞 session이 끝나도 열리지 않아 영영 `accepted`로 남는 것, 줄에서 열린 session이 앞 session의 token을 물려받는 것.
- 왜 지금 test가 못 잡나: `apps/tickets/coding/coding_test.ts`는 transport를 직접 부르고, 두 session의 token과 터미널 요청(Gateway frame)이 서로 다른지는 shell 역할과 CLI를 지나야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "한 앱에 coding session은 하나만 뜨고, 줄에 선 맡기기는 앞 session이 끝난 뒤 새 session과 새 token으로 열린다"

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
