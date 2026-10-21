# tr-e2e-call-fix

agent call과 session 규칙, PM tool e2e를 지금 설계로 고친다. grant 준비를 걷고, B의 turn을 붙잡던 묻기를 `shellAsk`로, App Engineer lane을 `release_prepare`로 가르고, `operator_create` 허락 단계(지금은 묻지 않는다)를 뺀다. 묻지도 막지도 않는 agent call을 재던 `call-gate_test.ts`는 지운다(`architecture/approval.md`).

- 단위: e2e (wave 2)
- 선행: tr-e2e-approval.
- 소유(이 task만 고친다):
  - `tests/e2e/agent-call_test.ts`
  - `tests/e2e/session_test.ts`
  - `tests/e2e/pm-tools_test.ts`
  - `tests/e2e/call-gate_test.ts` (지운다)
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(지우는 e2e의 `call-gate_test.ts`, 묻게 하는 helper 줄)과 "지켜볼 것"의 `app.create` 직후 runtime 재기동 줄. `project-docs/plan/test-restore/survey-e2e.md` §0 approval·assignment 줄과 `app.create` 줄, §1 1행(agent-call), 11행(call-gate), 19행(pm-tools), 27행(session), §6 2
  - 계약: `project-docs/plan/test-restore/tasks/tr-e2e-approval.md`의 "내놓는 것"(`ShellAsk`, `shellAsk(folder, name?)`)
  - architecture: `project-docs/architecture/approval.md`의 "흐름"(gate 없는 tool은 판정을 거치지 않는다: file, call, `operator.create`) 28행과 "왜 이 모양인가"의 "agent call은 묻지도 막지도 않는다"(73), `project-docs/architecture/agent-call.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/testing.md`의 "case 고르는 규칙" 4(session 둘이 서로를 기다리는 행의 fake 대답 예외)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `agent-sessions`, `agent-tools`, `approvals`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드
    - role tool 목록: `packages/core/agent-roles/tool-lists.ts` 54-74(App Engineer도 `operator.create`를 가진다. lophn만 `app.create`, App Engineer만 `release.prepare`)
    - 묻지 않는 tool: `packages/core/agent-roles/tools/operator.ts` 98-133(`operator.create`에 `gate`가 없다)
    - runtime 폴더: `packages/core/main/daemon/place-folders-glue.ts`의 `runtimeFoldersOf`(앱 source 전체가 runtime 권한 폴더라 `app.create`가 source를 이으면 child가 다시 뜬다), `tests/support/core/human.ts` 48-61(`settle(core, since)`), `tests/support/core/process.ts`(`runtimePids`)
    - 지금 test: `tests/e2e/agent-call_test.ts`(10-17 머리 주석, 19 import, 57-79 lane, 119-124 `fileWrite`, 201-204 grant, 396-446 operator-to-app-ae, 448-494 call-cancel-late-reply, 496-533 call-sender-archived, 535-586 inbox-order, 588-631 restart-lost), `tests/e2e/session_test.ts`(9-16 머리 주석, 38 import, 169-217 `openCallWaitingPermission`, 481-533 archive-call·delete-call), `tests/e2e/pm-tools_test.ts`(17-23 import, 76-79)
- 계약:
  - 쓰는 것: tr-e2e-approval의 `tests/support/core/shell-ask.ts`와 옮긴 이름, `tests/support/core/human.ts`(`settle`: `app.create` 뒤 App Engineer session을 열기 전에 runtime child가 다시 뜨기를 기다린다), `packages/protocol/approvals/turn-request.ts`(`turnRequestDecide`)
  - 내놓는 것: 없음

## 할 일

근거는 `architecture/approval.md`(agent call, `operator.create`, file 쓰기는 묻지 않는다. 묻는 것은 shell 규칙이 ask인 명령뿐)와 README "정한 것"이다. 지금 `deno check` 오류는 `agentGrantsSet`·`approvalsDecideTurn` import와 `"allow"`뿐이지만, runtime에서는 `file_write LOPHN.md`가 묻지 않아 B를 붙잡지 못하고 `ticket_create`가 없어 App Engineer lane이 맞지 않는다.

1. `tests/e2e/agent-call_test.ts`
   1. 19의 `agentGrantsSet` import와 201-204의 lophn grant 준비, 413-416의 Operator grant 준비를 지운다(call은 grant 없이 간다).
   2. lane(62-79)의 `ticket_create`를 `release_prepare`로 바꾼다: PM은 `operator_create`가 있고 `app_create`·`release_prepare`가 없는 요청, AE는 `release_prepare`가 있는 요청, OPERATOR는 `call`이 있고 `app_create`·`operator_create`·`release_prepare`가 없는 요청이다. App Engineer도 `operator_create`를 가지므로 PM lane에서 `release_prepare`를 빼야 AE 요청이 PM으로 가지 않는다.
   3. 119-124 `fileWrite`를 지운다. B를 붙잡던 네 행은 행마다 `const ask = await shellAsk(folder, "<행 이름>")`(196의 `folder`, 행마다 다른 이름)를 만들고 PM lane 첫 step을 `{ reply: ask.reply("w1") }`로 바꾼다: call-cancel-late-reply 464, call-sender-archived 505, inbox-order 545, restart-lost 598. 그 행의 `decide(…, "allow")`(478, 516, 556)를 `"once"`로 바꾼다. 단정은 그대로다.
   4. operator-to-app-ae(396-446): `appCreate` 앞에서 `const before = await runtimePids(c.run.home)`를 읽고 `appCreate` 뒤에 `await settle(c, before)`를 둔다(core가 template source를 이으면서 runtime child가 다시 뜬다. 그 사이 열린 App Engineer turn은 끊길 수 있다, README "지켜볼 것"). `runtimePids`는 `../support/core/process.ts`에서 import한다.
   5. 머리 주석을 맞춘다: 12의 lane 설명("lophn은 app_create, PM은 operator_create(app_create·release_prepare 없이), App Engineer는 release_prepare, 그 외 call을 가진 것은 Operator"), 17의 "같은 grant를 쓰고"를 지운다.
   - 정한 것: `coding_agent`로의 call이 `invalid_input`인 행(survey §1 1행의 선택 행)은 더하지 않는다. 이유: README 표에 없고 Router unit이 본다.
2. `tests/e2e/session_test.ts`
   1. 38 import를 `turnRequestDecide`로 바꾼다.
   2. `openCallWaitingPermission`(169-217): project 폴더 `${core.run.work}/${name}`에 `shellAsk`를 만들고, PM lane step(195-204)을 `{ reply: ask.reply("w1") }`로, lane `match`(206-209)의 `ticket_create`를 `release_prepare`로 바꾼다. 돌려주는 값에 `ask`를 더한다. call body 글(179 "update LOPHN.md")은 "clean up"처럼 지금 행에 맞는 글로 바꿔도 된다.
   3. archive-call·delete-call(481-533): 523-527을 `turnRequestDecide`와 `choice: { kind: "once" }`로, 530 disk 단정을 "폴더가 그대로 있다"(`assert(await ask.exists())`)로 바꾼다.
   4. 머리 주석 11의 "늦은 allow가 쓰기를 일으키는 것"을 "늦은 once가 명령을 돌리는 것"으로 맞춘다.
   5. lophn-reads-not-writes(429-479)의 `file_write`는 lophn 목록에 없는 tool을 부르는 행이라 그대로다.
3. `tests/e2e/pm-tools_test.ts`: 76-79에서 `waitPermission`·`decide`를 지우고 `say` 뒤 바로 `waitTurnEnd`를 기다린다(`operator.create`에 gate가 없고 `SHELL`은 ask 규칙에 맞지 않는다). 17-23 import에서 `decide`, `waitPermission`을 뺀다. 나머지 단정은 그대로다.
4. `tests/e2e/call-gate_test.ts`를 지운다(`git rm`). 지키던 것(call의 grant `ask`, `gate_allowed`)이 설계에서 없어졌다(`approval.md` 73). 같이 없어지는 권한 경계는 없다: 받은 agent는 자기 할당으로만 일하고 그 판정은 `packages/core/approvals/gate/judge_test.ts`가 본다.
5. file마다 `deno test --allow-all --no-check tests/e2e/<file>`로 돌린다. agent-call은 core 하나에 행이 순서대로 돌므로 실패하면 step 이름과 fake journal(207-222의 감싼 오류)을 본다. 앱을 release하지 않으므로 `deno task e2e:deps`는 필요 없다. operator-to-app-ae가 `settle`을 넣고도 끊기면 고치지 말고 보고의 "알려진 미완 동작"에 적는다(lead가 제품 이슈로 올린다).

## 끝남

- `deno task check`가 통과한다. `tests/e2e`는 아직 `NOT_CHECKED`라 type check를 따로 돈다: `deno check tests/e2e/agent-call_test.ts tests/e2e/session_test.ts tests/e2e/pm-tools_test.ts`가 오류 0이다.
- 세 file이 `deno test --allow-all --no-check tests/e2e/<file>`로 각각 통과한다. agent-call은 세 번 연속 통과를 본다(`settle`을 넣은 행이 있다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- `tests/e2e/call-gate_test.ts`가 없다.
- 위험 test: 없음(새 test가 없다. 고친 file들이 지금 재는 것을 그대로 잰다)
- 남지 않음: `grep -n "agentGrants\|ticket_create\|fileWrite\|\"allow\"\|kind: \"allow\"\|approvalsDecideTurn" tests/e2e/{agent-call,session,pm-tools}_test.ts`가 0줄이다. `grep -rn "call-gate" tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(e2e는 file마다 걸린 시간과 agent-call을 돌린 횟수)
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: `ShellAsk`로 안 되는 행이 있으면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. `app.create` 뒤 runtime 재기동 창에 App Engineer turn이 끊기는 일을 보았으면 재현 조건과 함께 적는다. 없으면 "없음"
