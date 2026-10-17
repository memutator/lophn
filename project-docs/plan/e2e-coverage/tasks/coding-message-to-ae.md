# coding-message-to-ae

막히거나 blueprint·의존을 바꿔야 할 때 coding agent는 CLI `lophn message send`로 맡긴 App Engineer에게 말한다. 맡긴 session이 열려 있으면 그 session의 입력이 되고, 닫혀(archive) 있으면 그 앱의 새 App Engineer session이 받는다. 사람과 직접 이야기하는 길은 없다. `tests/e2e/coding_test.ts`에 행 둘을 더한다.

- 단위: coding-message-to-ae (wave 3)
- 선행: coding-end-without-report. 같은 `tests/e2e/coding_test.ts`를 순서대로 고친다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/coding/message.ts`
  - `packages/core/apps/tickets/coding/relay.ts`
  - `packages/core/router/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-message-to-ae`; `candidates-product.md` 후보 `coding-message-to-ae`
  - architecture: `project-docs/architecture/coding-agent.md`("사람은 coding agent와 직접 이야기하지 않는다. 막히면 App Engineer에게 메시지를 보낸다. 닫혀 있으면 그 앱의 새 App Engineer session이 받는다"), `project-docs/architecture/agent-call.md`("열린 session, 없으면 새 session"은 놓치면 안 되는 사실을 맡긴 App Engineer에게 돌려줄 때만 쓴다), `project-docs/products/AGENT-ROLE.md` K4
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `app-tickets`, `coding-agent-cli-interface`, `agent-sessions`
  - 코드: `packages/core/apps/tickets/coding/message.ts`(`applyMessage`: 보낸 session이 끝났으면 `forbidden`, 맡긴 call의 보낸 agent session으로 `open_session_or_new`, `reply: "none"`, refs는 coding session과 ticket), `packages/protocol/coding-agent/message.ts`(`codingMessageSend`: 입력 `body`, 선택 `refs`(ticket id), 출력 `{accepted: true}`), `packages/protocol/lophn-agent/{agent-sessions,sessions,received-messages,calls}.ts`(`agentSessionRead`, `agentSessionList {agent, archived}`, `archiveSession`(compare `{state_seq}`), `receivedMessageList`, `callRead`)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/coding/{cli,hand-off}.ts`(`codingCli`, `handOff`), `tests/support/fake-server/{mod,probe}.ts`(`journal()`, `lastUserText`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `coding-token-scope`가 만든 `coding_test.ts`의 `Ctx`·`ROWS`와 `Started`(`cli`, `call`, `ticket`, `session`), `agentSessionRead`·`agentSessionList`·`archiveSession`·`receivedMessageList`·`callRead`
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `coding-end-without-report`가 merge됐다. `ROWS`에 행 둘을 더한다.
2. 행 둘. 앱은 행마다 새로 만든다. 메시지는 hook 없이도 배달된다(`applyMessage`는 coding session의 상태(`heard`)를 보지 않는다. PTY로 가는 길(`transport.send`)이 아니라 App Engineer로 가는 길이다). hook 신호(`lophn hook`)는 이 행에 필요 없다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `open-session` | `ctx.handOff(app)` → `fake.script([text])` → `cli.run("message send", {body: "BLUEPRINT-MARK needs a new field"})` → `waitTurnEnd(core, app.ae, 1)` → 읽기 | 맡기기 셋(helper) + ① text | fake: 마지막 model 요청(App Engineer의 둘째 turn)의 마지막 user 글에 `BLUEPRINT-MARK`가 있다 / inbox: `receivedMessageList {session: app.ae}`에 `from.kind === "coding_agent"`이고 `from.session`이 이 coding session인 입력이 하나 있고 refs에 ticket이 있다 / ledger: `callRead {call}`가 여전히 `accepted`다(메시지는 맡긴 call을 닫지 않는다) | 후보 `coding-message-to-ae`, K4 |
| `closed-session` | `ctx.handOff(app)` → `agentSessionRead {session: app.ae}`(`state_seq`) → `archiveSession`(compare `{state_seq}`) → `fake.script([text])` → `cli.run("message send", {body: "BLUEPRINT-MARK ..."})` → `until`로 `agentSessionList {agent: {role: "app_engineer", app: app.app}}`(열린 것만)에 session이 보일 때까지 → `waitTurnEnd(core, 그 session, 0)` → 읽기 | 맡기기 셋(helper) + ① text | route: 열린 App Engineer session이 정확히 하나이고 id가 `app.ae`와 다르다(옛 session은 archive에 있고 다시 열리지 않았다) / inbox: 새 session의 `receivedMessageList`에 `coding_agent`가 보낸 입력이 하나이고 옛 session에는 그런 입력이 없다 / fake: 마지막 model 요청의 마지막 user 글에 `BLUEPRINT-MARK`가 있다(새 session의 turn이 받았다) | 후보 `coding-message-to-ae`, K4("맡긴 session이 닫혀 있으면 그 앱의 App Engineer 새 session이 받는다") |

3. 새 session의 id는 `agentSessionList`가 알려 준다. 목록에 나오기를 기다리는 `until`의 제한 시간과 이유(무엇을 기다렸는지)를 담는다. sleep이 아니다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `router`·`app-tickets`·`coding-agent-cli-interface`(coding agent의 막힘은 맡긴 App Engineer에게 가고, 닫혀 있으면 새 session이 받는다), `agent-sessions`.
- 현실적 회귀: archive된 session이 메시지를 삼켜 coding agent의 막힘이 아무에게도 안 가는 것, 새 session을 열지 않고 오류로 끝나는 것, 메시지가 맡긴 call을 닫아 대화가 끊기는 것.
- 왜 지금 test가 못 잡나: `apps/tickets/coding/coding_test.ts`·Router unit은 `open_session_or_new`의 풀기를 따로 본다. CLI token → `exited`와 별개의 `send_message` route → Router → 새 App Engineer session의 turn까지 이어지는 길은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "coding agent가 CLI로 보낸 메시지는 맡긴 App Engineer session에, 닫혀 있으면 그 앱의 새 session에 도착한다"

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
