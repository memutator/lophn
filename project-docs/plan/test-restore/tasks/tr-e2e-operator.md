# tr-e2e-operator

`operator_test.ts`를 할당(assignment) 설계로 다시 쓴다. README "정한 것" 표의 `operator` 줄이 재는 것이다: 할당의 `removed_tools`로 뺀 tool이 보이지 않는다, domain 좁히기, 할당 없음, session 중 할당이 바뀌면 알림, `operator.create`는 묻지 않는다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/operator_test.ts`
  - `tests/support/app/patch-domain.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" 표 `operator` 줄. `project-docs/plan/test-restore/survey-e2e.md` 0절(할당이 grant를 대신한다)과 1절 18번 줄(operator, rewrite), 2절 `app/patch-domain.ts` 줄
  - helper 계약: `project-docs/plan/test-restore/tasks/tr-support-app.md`의 "내놓는 것"(`startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `TestApp`. 옛 `gateway` 칸은 없다), `tests/support/app/deps.ts`(`appCoreEnv`. tr-support-app이 `tests/support/coding/`에서 옮긴다)
  - architecture: `project-docs/architecture/approval.md` 25줄(할당한 앱의 tool만 tool 목록에 뜬다), 28줄(`operator.create`는 묻는 것에 없다. 묻는 것은 shell 규칙 `ask`뿐이다), 35줄(할당하지 않은 앱 tool은 `deny not_assigned`, 뺀 tool은 `deny removed`), 39줄(할당 쓰기는 사람만, Operator 정의 tool은 `mcp_servers`·`skip`을 받지 않는다); `project-docs/architecture/agent-definition.md` 44줄(tool 목록은 session 시작 때 고정, 바뀐 것은 notice. notice에 앱 글이 없다), 47줄과 `project-docs/architecture/domain.md` 62·67줄(맡은 domain의 `DOMAIN.md`와 tool, 다른 domain은 public tool만), `agent-definition.md` 56줄(Operator 정의 tool은 할당을 주지 못한다); `project-docs/architecture/testing.md` "case 고르는 규칙"(91줄)
  - changelog: `project-docs/products/change-log/0.6.0.md`의 "approval을 할당, 기다리는 turn 하나, turn mode, shell 규칙으로 줄인다"(`LOPHN.md` 쓰기와 `operator.create`·`operator.update`는 이제 묻지 않는다, 할당은 `{app, removed_tools}` 줄과 revision compare)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `agent-tools`, `agents`, `run-loop`, `domains`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드
    - `packages/protocol/approvals/assignment.ts`(`AssignmentEntry {app, removed_tools}`, `agentAssignmentGet` → `{assignment: {agent, entries}, revision}`, `agentAssignmentSet` 입력 `{agent, entries}`와 compare `{revision}`. 줄이 없는 agent의 revision은 0이고 쓸 때마다 1 오른다). `packages/protocol/approvals/mod.ts`가 내보낸다
    - `packages/core/lophn-agent/tools/app-tools.ts` 24-31줄(`assigned`: 할당 줄이 없거나 `removed_tools`에 든 tool은 정의가 없다. `removed_tools`의 값은 tool 이름 그대로 `add_item`이다), `packages/core/approvals/gate/judge.ts` 40-48줄(call 때 지금 할당으로 막기)
    - `packages/core/lophn-agent/tools/work.ts` 89-105줄(목록 밖 wire 이름은 `not_found` "tool is not available"이고 실행하지 않는다)
    - `packages/core/lophn-agent/run-loop/prepare.ts` 230-269줄(`toolsNotice`, notice kind `tools_changed`. 이름만 싣는다), 363-395줄(지금 목록은 turn마다 지금 할당으로 다시 만든다), 515-518줄(고정 목록과 다르면 notice), `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts` 121-130줄
    - `packages/core/agent-roles/tools/operator.ts` 30-41줄(입력에서 `name`·`mcp_servers`·`skip`을 뺀 정의 + `place`, `name`, `domains?`), 99-133줄(`operator.create`), `packages/core/agent-roles/tool-lists.ts` 54-74줄(`operator.create`는 PM과 App Engineer만)
    - route: `packages/protocol/lophn-agent/agent-definitions.ts` 184-197줄(`operatorCreate {id, place, definition}`), 115-146줄(`agentDefinitionList {place}` 줄의 `agent`, `name`), `packages/protocol/domains/domains.ts`(`domainCreate`, `domainList`), `packages/protocol/domains/paths.ts`(`domainFolder`, `domainDocFile`), `packages/protocol/apps/blueprint/read.ts` 68줄(`appTools`), `packages/protocol/apps/calls/invocation.ts`(`appInvocations {app, session}`)
    - 옛 file: `tests/e2e/operator_test.ts`(행 표와 단정은 이 brief의 할 일이 줄마다 가리킨다)
    - helper: `tests/support/core/human.ts`(`settle` 51줄, `openProject` 115줄, `openSession` 134줄, `say` 143줄, `waitTurnEnd` 169줄), `tests/support/core/process.ts`(`runtimePids`), `tests/support/fake-server/probe.ts`(`systemText`, `toolNames`, `lastUserText`, `lastToolResult`)
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `TestApp`), `deps.ts`(`appCoreEnv`); `packages/protocol/approvals/assignment.ts`(`agentAssignmentGet`, `agentAssignmentSet`), `packages/protocol/lophn-agent/input-tags.ts`(`tools_changed`)
  - 내놓는 것: 없음

## 할 일

준비(core 하나, 앱 하나, project 하나)는 그대로 두고 행을 할당으로 다시 쓴다. 행마다 새 Operator와 새 session을 쓰고 `fake.reset()`으로 시작한다. 근거: README 표 `operator` 줄, `approval.md` 25·35·39줄, `agent-definition.md` 44·47·56줄.

1. 머리 주석(옛 1-20줄)을 다시 쓴다(`testing.md` 규칙 1).
   - contract: boundary `approvals`·`agent-tools`(앱 ∩ release 선언 ∩ 할당만 tool이 되고, 뺀 tool은 요청에 없고 불러도 core에 닿지 않는다), `run-loop`(tool 목록은 session 시작 때 고정하고 바뀐 것은 program이 쓴 고정 notice로만 간다), `domains`(좁힌 Operator는 맡은 domain의 `DOMAIN.md`·tool과 다른 domain의 public tool만 본다), `agents`(Operator를 만드는 tool은 할당을 주지 못하고 묻지 않는다)
   - 현실적 회귀: `removed_tools`가 무시되어 뺀 tool이 요청에 남는다, 할당 없는 Operator에 앱 tool이 보인다, session 도중 할당이 바뀌어 `tools[]`가 달라진다(prompt cache가 깨진다), notice에 tool 설명(앱 글)이 들어간다, child의 domain 거르기가 `resolve.ts`와 갈라진다, `operator.create`가 다시 묻거나 입력에 할당·`mcp_servers`·`skip` 칸이 생긴다
   - 왜 지금 test로 못 잡나: `app-tools`·`judge`·`turn-prompt`·`tool-lists`의 unit은 입력으로 받은 할당과 목록만 본다. 사람의 `SetAgentAssignment` 저장 → agent runtime child의 읽기 → model 요청의 `tools[]` → 호출이 core를 지나 앱 process에서 실행되는 왕복은 process를 건너야 보인다
   - fake 대답: 앱 activation helper의 App Engineer 대답은 행 몫에 세지 않는다. 행마다 둘 이하다.
2. import(옛 21-76줄): `agentGrantsGet`, `agentGrantsSet`, `approvalsDecideTurn`, `AgentGrantEntry`, `decide`, `waitPermission`, `toolCallList`를 지운다. `agentAssignmentGet`, `agentAssignmentSet`, `type AssignmentEntry`(`packages/protocol/approvals/mod.ts`)를 더한다. `appCoreEnv`는 `../support/app/deps.ts`에서 읽는다.
3. `operatorWith`(옛 78-101줄): `entries: AssignmentEntry[] | null`을 받는다. null이 아니면 `core.call(agentAssignmentSet, { agent: ref, entries }, { revision: 0 })`(새 Operator는 revision 0). 나머지(`operatorCreate`, `openSession`, `{ session, ref }`)는 그대로다.
4. 준비(옛 147-176줄): 순서와 이유 주석을 그대로 둔다(project 폴더 → `startTestApp(..., { patch: domainPatch(second) })` → `domainCreate {name: second, owner: {kind: "app", id}}` → `settle(core, oldPids)` → 준비 → 동의 → running).
   - `deliverRelease(core, fake, app, { goal })`는 `{ release, activated }`를 돌려준다(tr-support-app). 그 뒤 `approveActivation(core, app)` → `waitRunning(core, app, release)`.
   - 정한 것: `activateTestApp`을 쓰지 않고 `startTestApp`·`deliverRelease`·`approveActivation`·`waitRunning`을 쓴다. 이유: 둘째 domain은 release 준비 전에 active여야 하는데(앱 tool의 domain이 active domain 이름이 아니면 준비가 거절한다, `project-docs/architecture/app-call.md` "지키는 것" 첫 줄) `activateTestApp`은 시작과 준비 사이에 끼울 자리가 없다. 넷 다 tr-support-app이 내놓는 이름이다.
   - `let app`의 `app?.gateway.close()`(옛 427줄)를 지운다.
5. 행(각 `t.step` 하나. `Deno.test` 이름은 결과 한 문장으로 새로 쓴다)
   1. `assigned`(옛 183-208줄 `tool`): `operatorWith(core, appPlace, "Assigned", [{ app: id, removed_tools: [] }])`. 단정은 옛 것 그대로: fake의 앱 tool 끝 이름이 `["add_item", "list_items", "shelf_count", "shelf_list"]`, ledger의 그 session invocation 하나(write, succeeded, caller agent, changeset 있음), 앱 data에 `op-first`. 이 행이 다음 행 `removed`의 짝이다(뺀 것이 없을 때 보이고 불리는 것을 먼저 보인다).
   2. `removed`(옛 210-239줄 `excluded`): `[{ app: id, removed_tools: ["add_item"] }]`. model이 그래도 `domain__${app.slug}__add_item`을 부른다. 단정: fake의 앱 tool이 `["list_items", "shelf_count", "shelf_list"]`이고 둘째 요청의 `t1` 결과에 `not_found`가 있다, ledger의 그 session invocation이 없다, 앱 data에 `op-removed`가 없다. 옛 `toolCallList` 단정(236-237줄)은 지운다(목록 밖 tool은 실행되지 않는 것을 invocation과 data가 이미 본다).
   3. 옛 241-293줄 `ask-reject`·`ask-allow`를 지운다. 할당한 tool은 효과와 상관없이 묻지 않는다(`approval.md` 27줄).
   4. `domain-narrowed`(옛 295-331줄): `operatorWith(..., [{ app: id, removed_tools: [] }], [mine.id])`. 나머지 그대로(`DOMAIN.md` 둘을 file로 쓰고 system에 `Zebra rule`만, 앱 tool이 `["add_item", "list_items", "shelf_count"]`).
   5. `no-assignment`(옛 333-343줄 `no-grant`): `operatorWith(..., null)`. 단정: fake의 앱 tool이 없다, `agentAssignmentGet {agent: bare.ref}`의 `assignment.entries`가 `[]`이고 `revision`이 0이다.
   6. `assignment-added`(옛 345-374줄 `grant-added`): `operatorWith(..., null)`로 열고 첫 turn → `agentAssignmentSet({ agent, entries: [{ app: id, removed_tools: [] }] }, { revision: 0 })` → 둘째 turn. 단정: 두 요청의 `tools`가 JSON으로 같다, 둘째 요청의 `lastUserText`에 `tools_changed`와 `domain__${app.slug}__list_items`, `domain__${app.slug}__add_item`이 있고 `appTools {app: id}`의 어느 tool `description`도 없다, `agentAssignmentGet`의 entries가 쓴 값이고 revision이 1이다, 그 session invocation이 없다.
   7. `pm-creates-operator`(옛 376-425줄 `pm-creates-no-grant`): 대본(`operator_create {place: {project}, name: "pm-made", body: "do the assigned work"}`와 text)과 PM session은 그대로다. `waitPermission`·`decide`와 "허락 전" 단정(401-404줄)을 지우고 `say` 뒤 바로 `waitTurnEnd(core, manager)`를 기다린다(물었다면 turn이 기다려 30초 안에 끝나지 않는다). 단정: `agentDefinitionList {place}`에 `pm-made`가 있고 `agentAssignmentGet {agent: made.agent}`의 entries가 `[]`·revision 0이다, 첫 요청의 `operator_create` `input_schema.properties` key에 `mcp_servers`, `skip`이 없고 `assign`이나 `grant`가 든 key가 없다.
6. `tests/support/app/patch-domain.ts` 3줄 주석의 "platform app test(선언과 등록 handler가 같다)"를 지금 이름으로 고친다: release 준비의 handler 검사(봉인한 bundle을 preview로 한 번 띄워 선언과 등록 handler를 대조한다, `packages/core/apps/control.ts` 595줄). 코드는 바꾸지 않는다.
7. type check와 실행
   - `deno check tests/e2e/operator_test.ts tests/support/app/patch-domain.ts`. 두 file은 tr-check-enable 전까지 `tools/check.ts`의 `NOT_CHECKED`라 `deno task check`가 type을 보지 않는다.
   - `deno task e2e:deps`를 한 번 돌리고 `deno test --allow-all --no-check tests/e2e/operator_test.ts`.

## 끝남

- `deno task check`가 통과한다.
- `deno check`, `deno fmt --check`, `deno lint`가 `tests/e2e/operator_test.ts tests/support/app/patch-domain.ts`에서 오류 없이 끝난다.
- `deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/operator_test.ts`가 세 번 잇달아 통과한다(lead가 merge 전에 열 번 더 돌린다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 위험 test: 새 unit test는 없다. 이 file이 그 test다. 이름 예: "E2E Operator: 할당한 앱의 tool만 tool 목록에 오르고, 할당에서 뺀 tool은 요청에 없고 불러도 실행되지 않으며, session 도중 할당이 바뀌면 목록은 그대로이고 notice만 온다"
- 남지 않음: `grep -n "agentGrants\|AgentGrantEntry\|approvalsDecideTurn\|waitPermission\|decide(\|support/coding\|\.gateway" tests/e2e/operator_test.ts`가 0줄이다. `grep -n "platform app test" tests/support/app/patch-domain.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(e2e 세 번의 걸린 시간 포함)
- 등록할 것: 없음
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- notice: `tools_changed` notice가 `prepare.ts`의 것과 `turn-prompt.ts`의 것 가운데 어느 쪽으로 왔는지(둘 다면 둘 다) 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
