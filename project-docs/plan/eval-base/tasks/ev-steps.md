# ev-steps

재료로는 못 하는 case 준비를 `Setup` 함수로 만든다: 부르지 못하게 하는 grant, 열린 problem, ticket 하나. 그리고 `Target`을 id로 푸는 helper와 session을 조용히 닫는 helper를 낸다. 모두 사람 자격 route나 fake 대본으로 하고 진짜 model은 쓰지 않는다.

- 단위: ev (wave 2)
- 선행: ev-contracts, ev-provider
- 소유(이 task만 고친다):
  - `tests/eval/steps.ts`
- 읽을 것:
  - 계획: `project-docs/products/roadmap/eval.md`의 "책임에 따른 call" 표(T19 두 행, L7 행의 setup 열), "재료"의 "다시 만들어야 하고 담을 수 없는 것"
  - 조사: `project-docs/plan/eval-base/research/roles-and-outcomes.md` 0절(R-ticket, R-problem), 8절(L7 setup), 7절 9번(기본 grant는 모두 허락)
  - 본보기:
    - 문제 열기: `tests/e2e/reaction_test.ts`의 `reportViewError`(`observeViewError`, 앱 process 없이 되고 그 앱의 App Engineer session을 reaction이 연다. 설정 `reactions.problem_opened`는 `settingsUpdate`로 `off`·`ask`·`open`)
    - ticket 만들기: `tests/support/coding/hand-off.ts`의 `createTicket`(fake App Engineer가 `ticket_create`를 부른다. 이 helper는 `TestApp`이 필요해 그대로 못 쓴다. `ticket.create`는 agent만 부를 수 있고(`packages/core/apps/tickets/commands.ts:41-49`) 앱의 source는 필요 없다)
    - grant: `tests/e2e/agent-call_test.ts:200-205`, `tests/e2e/operator_test.ts:256-285`(`agentGrantsGet`·`agentGrantsSet`)
    - 닫기: `tests/e2e/agent-call_test.ts`의 `archive`(`agentSessionRead`의 `state_seq`로 `archiveSession`)
  - 주의: grant setting은 `excluded`(부르지 못함), `never`(묻지 않음 = 허락), `ask`(물음)다(`packages/protocol/approvals/grants.ts:36-52`). roadmap의 T19 행은 "`never`"라고 썼지만 그러면 call이 그대로 허락된다. 거절은 `excluded`다.
  - 계약: `tests/eval/types.ts`(`Target`, `WorldIds`, `Setup`, `SetupCtx`)
- 계약:
  - 쓰는 것: `tests/eval/types.ts`, `tests/support/core/provider.ts`의 `changeModel`, `tests/support/core/human.ts`, `tests/support/fake-server`
  - 내놓는 것:
    - `refOf(target: Target, ids: WorldIds): AgentRef`와 `callAgentOf(target, ids)`(`call` 대상용. `{role:"coding_agent", app}`는 `Target`에 없으므로 만들지 않는다)
    - `excludeCall(from: Target, to: Target): Setup`: `from`의 grant에 `{kind:"agent", agent: to, setting:"excluded"}`를 더한다. 먼저 `agentGrantsGet`으로 지금 entries를 읽고 같은 대상 줄은 바꾸고 나머지는 남긴다(`agentGrantsSet`은 entries를 통째로 바꾼다).
    - `openProblem(app: string): Setup`: `reactions.problem_opened`를 `off`로 한 뒤(program이 App Engineer session을 열지 않게) `observeViewError`로 앱에 problem 하나를 연다.
    - `seedTicket(app: string, goal?: string): Setup`: 그 앱의 App Engineer session을 열고(`openSession`) `changeModel`로 `ctx.restoreModel`을 준 뒤, `ctx.fake`에 `ticket_create`(check `{kind:"text", text:"the work is done"}`) → text 두 step을 대본으로 걸고 `say`, `waitTurnEnd`로 ticket 하나를 만든다. 끝나면 그 session을 닫는다.
    - `archiveQuiet(core: Core, session: string): Promise<void>`: `ev-restore`도 쓴다.

## 할 일

1. 위 함수를 쓴다. 각 함수는 시작과 끝에서 fake를 `reset()`해 앞 대본이 남지 않게 한다(`seedTicket`만 대본을 건다).
2. `Setup`은 `ctx.ids`로 이름을 id로 푼다. 이름이 없으면 어느 이름이 world에 없는지 담아 던진다.
3. 확인(진짜 provider 없이): scratch(`.dev-data/ev-steps/check.ts`, commit하지 않는다)에서 `bootCore` + `startFakeServer` + `connectFakeProvider(core, fake, {default:false})`로 core를 띄우고, 앱 둘을 `appCreate`한 뒤 `SetupCtx`를 손으로 만들어 세 setup을 불러 본다. 본다: problem이 `problemList`에 열려 있고 App Engineer reaction session이 안 열렸다 / `ticketList`에 ticket이 하나 / lophn의 grant에 `excluded` 줄이 있고 기존 줄이 남았다 / lophn session에서 fake가 `call`을 가계부 App Engineer로 보내면 tool call이 `not_executed`/`denied`로 끝나고 그 App Engineer session이 열리지 않았다(`packages/core/approvals/gate/gate.ts:92-93`: `excluded`는 Gate가 deny한다).
4. 이 file이 `tests/eval/` 밖의 helper를 고쳐야 하면 고치지 말고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(`tests/eval`은 check의 test discovery 밖이고, 확인은 위 3번의 core 한 번이다).
- 남지 않음: scratch를 commit하지 않았다. `/tmp/lophn-e2e-*`와 core process가 남지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: `ticket.create`에 source 없는 앱이 되는지(되면 그렇다고, 안 되면 어떻게 했는지), problem 입력 칸
- 계약 바꾸기 요청: `Setup`/`SetupCtx`를 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 없음이면 "없음"
