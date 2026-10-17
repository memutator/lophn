# coding-token-scope

coding agent의 token은 앱 하나 범위이고, session이 끝나면 회수된다. test가 shell 역할(Gateway client)로 `coding_terminal` frame에서 token을 받아 coding agent 역할(`lophn` CLI)로 부른다: 다른 앱의 ticket과 앱은 읽을 수도 claim할 수도 없고, session 끝 뒤 같은 token의 호출은 `unauthorized`다. 이 task가 `tests/e2e/coding_test.ts`(core 하나, table 행)와 coding 맡기기 helper `handOff`를 처음 만든다. 뒤의 `coding-*` 여섯이 같은 file에 행을 더한다.

- 단위: coding-token-scope (wave 3)
- 선행: test-app, coding-role, gateway-client, reply-fn. 앱 길(`startTestApp`), CLI runner(`codingCli`), shell 역할(`connectGateway`·`exitTerminal`), 함수 대답을 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
  - `tests/support/coding/hand-off.ts`(`handOffQueued`만. `handOff`는 `test-app`이 내놓는다)
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/model.ts`
  - `packages/core/apps/tickets/reads.ts`
  - `packages/core/apps/tickets/claims.ts`
  - `packages/core/server/identity/`
  - `packages/core/apps/tickets/coding/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-token-scope`; `candidates-invariants.md` 후보 28(`coding-session-ends-without-report`); `candidates-product.md` 후보 `coding-token-lifecycle`, 묶음 G3
  - architecture: `project-docs/architecture/coding-agent.md`("coding agent가 lophn에 닿는 길은 CLI 하나이고 인증은 앱 하나 범위의 token이다", "회수한 token의 새 호출은 거절한다"), `project-docs/products/AGENT-ROLE.md` K1·K5
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `external-coding-agent`, `coding-agent-cli-interface`, `core-api`
  - 코드(경로만. 코드로 읽고 정리한 사실은 아래 "할 일"):
    - `packages/core/apps/tickets/model.ts`(`boundApp`·`checkApp`: 다른 앱이면 `forbidden`), `packages/core/apps/tickets/{reads,claims}.ts`
    - `packages/core/server/identity/{coding-token,registry,model}.ts`(token의 operation 목록은 CLI 표에서 계산한다. `authorize`: 다른 앱의 `target.app`이면 `not_found`, `#context`: 회수한 credential은 `unauthorized`)
    - `packages/core/apps/tickets/coding/{terminal,sessions,events,relay}.ts`(`exited` → `endSession` → `revokeToken`. 회수는 commit 뒤 `relay.apply`가 하고 `storage/ledger/after-commit.ts`의 `withAfterCommit`이 command 응답 전에 동기로 부른다)
    - `packages/protocol/coding-agent/{terminal-requests,cli-commands,token}.ts`, `packages/coding-agent/cli/{main,output}.ts`(`--json`이면 실패도 stdout에 `{"error":{"code",...}}` 한 줄이고 종료 코드는 `unauthorized`·`forbidden` 3, `conflict`·`not_found` 4)
    - `packages/core/apps/agent-tools/ticket.ts`(`ticket.create {app, goal, check}`), `packages/core/lophn-agent/tools/bundles/call.ts`(`call` tool 입력)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/{mod,probe}.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `systemText`·`toolNames`·`lastToolResult`·`lastUserText`·`idIn`), `tests/support/gateway/`(`connectGateway`, `reportHarness`, `waitCodingTerminal`, `answerTerminal`, `exitTerminal`), `tests/support/coding/cli.ts`(`codingCli`), `tests/support/app/`(`startTestApp`, `TestApp`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: 위 support의 이름. 각 support brief(`test-app`, `coding-role`, `gateway-client`, `reply-fn`)가 정한 이름으로 맞춘다. 아직 merge되지 않은 이름은 그 brief의 "내놓는 것"을 따른다. route는 `callRead`·`callCancel`(`packages/protocol/lophn-agent/mod.ts`), `ticketShow`(`packages/protocol/coding-agent/ticket/mod.ts`), `receivedMessageList`, `agentSessionRead`·`agentSessionList`·`archiveSession`.
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

```ts
// tests/support/coding/hand-off.ts   (App Engineer가 ticket을 coding agent에게 맡기고 shell 역할이 터미널을 여는 데까지. 제품의 길 그대로다)
handOff(core: Core, fake: FakeServer, app: TestApp, options?: { goal?: string; harness?: HarnessId }): Promise<Started>
handOffQueued(core: Core, fake: FakeServer, app: TestApp, options?: { goal?: string; harness?: HarnessId }): Promise<Queued>
// handOffQueued: 앱에 끝나지 않은 coding session이 이미 있어 call이 줄에 서는 경우다. `coding_terminal` frame을 기다리지 않는다.
createTicket(core: Core, fake: FakeServer, app: TestApp, options?: { goal?: string }): Promise<string>
// ticket만 만든다(다른 앱의 ticket이 필요한 행). 대답 ① tool `ticket_create` ② text. 돌려주는 값은 ticket id다.
type Queued = { ticket: string; call: string; turn: number };
type Started = Queued & { session: string; token: string; request: string; plan: CodingLaunchPlan; cli: CodingCli };
// turn: 이 맡기기가 app.ae session의 몇 번째 turn인가(0부터). 뒤에서 waitTurnEnd(core, app.ae, turn)에 쓴다.
// token = plan.env[CODING_TOKEN_ENV]. cli = codingCli(core, token).
```

`handOff`가 하는 일(순서대로):
1. `fake.script`로 App Engineer의 대답 셋을 건다: ① tool `ticket_create {app: app.app, goal, check: {kind: "text", text: ...}}` ② 함수: ①의 tool_result에서 `idIn(..., "tkt")`로 ticket id를 뽑아 tool `call {to: {role: "coding_agent", place: {app: app.name}}, reply: "conversation", body: goal, refs: [{kind: "ticket", ticket}], options: {harness}}` ③ text. tool call id는 맡기기마다 다르게 둔다(`<slug>-<turn>-ticket`, `<slug>-<turn>-call`). 같은 session에서 두 번째 맡기기가 첫 번째와 같은 id를 쓰면 `call`의 dedup(보낸 session + tool call id)과 `ticket_create`의 idempotency key가 걸려 새 일이 안 생긴다.
2. `say(core, app.ae, goal)`. 그 전에 `turnsOf`의 개수로 `turn`을 정한다.
3. `Started`: `app.gateway.next("coding_terminal", (frame) => frame.request.kind === "open" && frame.request.plan.app === app.app)`로 이 앱의 `open` frame을 받고(여러 앱의 Gateway가 같은 frame을 받으므로 앱으로 가른다. `waitCodingTerminal`이 앱 조건을 받으면 그것을 쓴다) `answerTerminal(core, request)`로 터미널이 열렸다고 알린 뒤 `waitTurnEnd(core, app.ae, turn)`. `Queued`: frame을 기다리지 않고 turn 끝만 기다린다.
4. ticket id와 call id는 fake journal의 ②·③ 요청 tool_result에서 `idIn`으로 뽑는다(`cal` 접두).

`createTicket`은 위 1·2·4만 한다(대답은 `ticket_create`와 text 둘, `call` 없음, frame 없음). 돌려주는 ticket id는 `ticketList`(user, `app: app.app`)로 읽어도 된다.

support는 띄우기와 연결만 한다(README). 단정하지 않고, 어긋나면 무엇을 기다렸는지 담아 던진다. App Engineer의 대답 셋은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)와 같은 부류다. test 머리 주석에 이유를 한 줄 적는다.

## 할 일

1. 시작 조건: `test-app`·`coding-role`·`gateway-client`·`reply-fn`이 merge됐다. `test-app`이 이미 같은 단계(AE `ticket_create` + `call` → `open` frame → `answerTerminal`)를 `deliverRelease` 안에 갖고 있다. 겹치는 코드는 그대로 두고(그 file은 이 task의 소유가 아니다) "넘길 줄"에 어디가 겹치는지 적는다. planner 검토로 정했다: `handOff`는 `test-app`의 `tests/support/app/activate.ts`가 내놓는다. 이 task는 그것을 쓰고, `hand-off.ts`에는 줄에 서는 경우(`handOffQueued`)만 둔다.
2. `coding_test.ts`의 틀(이후 `coding-*` 여섯이 그대로 쓴다):
   - `Deno.test` 하나(이름은 결과 한 문장. 예: "coding token은 앱 하나 범위이고 session이 끝나면 회수되며 맡긴 call은 끝나는 길마다 한 번만 닫힌다"). `createRun` → `startFakeServer` → `bootCore(run)`(앱을 release까지 가져가지 않으므로 `DENO_DIR`는 필요 없다) → `connectFakeProvider`. `Ctx = { core, fake, tokens: string[], app(name), handOff(app, options?) }`. `ctx.app(name)`은 `startTestApp(core, fake, {name, slug: name})`을 부르고 만든 `TestApp`을 모아 두었다가 끝에서 `gateway.close()`한다. `ctx.handOff`는 `handOff`를 불러 `token`을 `ctx.tokens`에 쌓고 돌려준다(`coding-token-not-stored`가 마지막에 쓴다).
   - 행은 `ROWS: { name: string; run(ctx): Promise<void> }[]` table이고 `for (const row of ROWS) await t.step(row.name, () => row.run(ctx))`로 차례로 돈다. 행마다 앱을 새로 만든다(앱 하나에 coding session은 하나라 행이 서로의 줄을 건드리지 않게 한다. 앱 이름은 행 이름으로 겹치지 않게).
   - `finally`: 모든 `TestApp.gateway.close()`, `core?.kill()`, `fake.close()`, `run.remove()`. sanitizer를 끄지 않는다.
3. 행 둘. session을 `exitTerminal`로 끝내면 call이 닫히며 App Engineer에게 reaction 입력이 가서 turn이 하나 더 돈다(`closeCall`의 `CodingSessionEndedUnreported`). 그 turn이 fake 대답을 먹도록 끝내기 전에 text 대답 하나를 걸고(`fake.script([{ reply: text }])`), `waitTurnEnd(core, app.ae, 1)`까지 기다린 뒤 행을 끝낸다. 끝내지 않는 행은 reaction turn이 없다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `other-app` | 앱 둘(`ctx.app("scope-a")`, `ctx.app("scope-b")`) → `createTicket(core, fake, b)`(B의 ticket) → `ctx.handOff(a)` → `a.cli`로 B의 `ticket show {ticket}`, `ticket claim {ticket, base_revision}`, `app show {app: b.app}`(한 단계) → `a.cli`로 자기 ticket `ticket show`(통제) → 사람 자격 `ticketShow`(B ticket) | 없음(row 몫). helper가 B ticket 둘(① `ticket_create` ② text)과 A의 맡기기 셋을 건다 | CLI: 다른 앱의 `ticket show`, `ticket claim`, `app show`가 모두 종료 코드 0이 아니고 `value.error.code`가 `forbidden` 또는 `not_found`이며 출력에 B ticket의 goal 글이 없다 / CLI: 같은 token의 자기 앱 `ticket show`는 성공한다(위 실패가 token이 아예 안 통해서가 아님) / route(user): `ticketShow` B ticket이 `open`이고 claim이 null이다(A의 token이 claim하지 못했다) | 후보 `coding-token-scope`(candidates-docs 9절이 적은 210행). 코드로 읽은 예상: `ticket show`·`claim`은 `forbidden`("ticket belongs to another app"), `app show`는 `not_found`("target not found", `server/identity/model.ts`의 `authorize`). 정확한 code는 돌려 보고 정한다. 둘 다 "막힘"이 계약이다 |
| `after-exit` | `ctx.handOff(a)` → `cli.run("ticket list")` → fake에 text 하나 → `exitTerminal(core, session)` → `waitTurnEnd(core, a.ae, 1)` → 같은 `cli`로 `ticket list`, `ticket show` | 맡기기 셋(helper) + ① text(reaction turn) | CLI: 끝내기 전 `ticket list`는 성공한다 / CLI: 끝낸 뒤 `ticket list`와 `ticket show` 둘 다 `value.error.code`가 `unauthorized`다(종료 코드 3) | 후보 `coding-token-scope`, K5. 회수는 `exited` 응답 전에 끝나 있다고 읽었다(`withAfterCommit`). 아니라면 `until`(신호는 호출이 `unauthorized`가 되는 것, 제한 시간 있음)로 바꾸고 보고에 적는다 |

   call이 `failed`로 닫히고 App Engineer가 한 번만 알림을 받는 것은 `coding-end-without-report`가 본다. 이 행은 token만 본다. reaction turn은 fake 대답을 먹으므로 기다려 끝낸다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다. 고칠 수 없으면 행을 끄지 말고 보고한다(README 정한 것 8).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-tickets`·`coding-agent-cli-interface`(coding token은 앱 하나 범위이고 session이 끝나면 회수된다), `external-coding-agent`(coding agent는 token + CLI로만 닿는다).
- 현실적 회귀: 다른 앱의 ticket이나 앱을 token으로 읽거나 claim하는 것(앱 하나가 곧 격리 단위다), session이 끝났는데 token이 살아 있어 끝난 터미널이 계속 core를 쓰는 것, CLI 표가 바뀌어 token 범위가 어긋나는 것.
- 왜 지금 test가 못 잡나: `tickets_test`·`coding_test`는 token 없이 actor 문자열을 직접 만들고, token 발급·회수는 Gateway frame → shell 역할 → CLI → 서버 인증을 지나야 한다. 지금 E2E 7개에는 coding 길이 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "coding token은 앱 하나만 열고, session이 끝나면 같은 token의 호출이 거절된다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(`test-app`의 `deliverRelease`와 겹치는 단계)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- 한 번 도는 시간
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
