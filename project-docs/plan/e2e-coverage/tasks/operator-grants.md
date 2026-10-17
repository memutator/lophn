# operator-grants

Operator의 grant가 session 도중 바뀌어도 tool 목록은 그대로이고 대화 끝에 program이 쓴 고정 알림이 붙는다. grant 없이 만든 Operator에는 app-api tool이 하나도 없고, Project Manager의 `operator.create`는 grant를 줄 길이 없다. `tests/e2e/operator_test.ts`의 table에 행 셋을 더한다.

- 단위: operator (wave 3)
- 선행: operator-app-api. 같은 file(`tests/e2e/operator_test.ts`)과 그 안의 준비(`operatorWith`, 앱 activation)를 이어 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/operator_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/prompt-assembly/`
  - `packages/core/lophn-agent/agents/`
  - `packages/core/agent-roles/tools/operator.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md` 전체(특히 "정한 것" 3·9~11, 지켜야 할 것), `project-docs/plan/e2e-coverage/research/candidates-docs.md` §1(Operator와 agent grant)
  - 이 계획의 `tasks/operator-app-api.md`("이 file의 준비"와 `operatorWith`), `tasks/reply-fn.md`(`probe.ts`), `tasks/pm-tools.md`(PM turn의 `operator.create` Gate 통과. 같은 tool을 부르지만 이 task는 grant를 본다)
  - architecture: `project-docs/architecture/agent-definition.md`("tool 목록은 session을 시작할 때 고정한다", "notice는 program이 쓴 고정 문장만", "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"), `project-docs/architecture/approval.md`("agent는 자기 grant를 넓히지 못한다", agent의 설정 고치기는 기본 물음)
  - 제품 결정: `project-docs/products/AGENT-ROLE.md`의 H3, T3~T6
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agents`, `agent-roles`, `agent-tools`, `approvals`, `run-loop`
  - 코드: `packages/core/lophn-agent/run-loop/prepare.ts`(`toolsNotice`·`noticeText`: session 첫 turn이 고정한 목록과 지금 목록의 차이를 `tools_changed` notice로 대화 끝에 붙인다. `listed`는 고정 목록이다), `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`(`appendNotices`), `packages/core/agent-roles/tools/operator.ts`(`operator.create`: 입력은 `strict`이고 grant 칸이 없다. `gate`가 `settingsEditIntent`로 묻는다), `packages/core/agent-roles/tool-lists.ts`(wire 이름은 `.`→`_`), `packages/protocol/approvals/grants.ts`(`agentGrantsGet`·`agentGrantsSet`), `packages/protocol/apps/blueprint/read.ts`(`appAppApi`: app-api의 `description`. user가 읽을 수 있다), `packages/protocol/lophn-agent/agent-definitions.ts`(`agentDefinitionList({place})`: Operator가 목록에 보인다)
  - main의 `tests/e2e/approval_test.ts`(PM session에서 `waitPermission`→`decide`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `operator-app-api`가 만든 `tests/e2e/operator_test.ts`의 준비(`operatorWith`, `TestApp`, `fake.reset()` 뒤의 빈 fake)와 거기서 쓰는 support 전부, `agentGrantsGet`·`agentGrantsSet`, `agentDefinitionList`, `appAppApi`, `waitPermission`·`decide`. **support brief의 이름으로 맞춘다**: `operator-app-api`가 쓴 이름을 따른다.
  - 내놓는 것: 같은 file의 행 셋. 새 helper는 없다.

## 할 일

1. `operator_test.ts`를 열어 준비를 다시 쓰지 않고 행 셋만 더한다. 머리 주석의 세 질문에 이 task의 줄을 더한다.
2. 행 셋. 같은 core·앱·project를 쓰고 행마다 새 Operator·session을 연다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `grant-added` | `operatorWith`(entries 없음) → `say` → `waitTurnEnd`(0) → `agentGrantsSet {agent, entries: [{kind: "app", app, apis: []}]}` → `say` → `waitTurnEnd`(1) | ① text ② text | fake: 둘째 요청의 `tools[]`가 첫 요청과 같다(session 시작 때 고정. 새 앱 tool이 목록에 끼지 않는다) 그리고 둘째 요청의 마지막 user message에 `tools_changed` notice가 있고 새로 할당한 앱 tool 둘(`__list_items`, `__add_item`)의 이름을 말하며 `appAppApi`로 읽은 app-api `description`의 글은 들어 있지 않다(notice는 program이 쓴 고정 문장만) / ledger: `agentGrantsGet`의 entries가 set한 그대로이고 `appInvocations({app, session})`이 비어 있다(알림만 가고 호출은 없었다) | agent-definition "tool 목록은 session을 시작할 때 고정", "notice는 program이 쓴 고정 문장만". 후보 `grant-change-mid-session` |
| `no-grant` | `operatorWith`(entries 없음, `agentGrantsSet`을 부르지 않는다) → `say` → `waitTurnEnd` → `agentGrantsGet` | ① text | fake: 첫 요청 `tools[]`에 `app__`로 시작하는 tool이 하나도 없다(활성 앱이 있는데도) / ledger: `agentGrantsGet`의 entries가 비어 있다(또는 grant 행이 없다고 `not_found`가 오면 그것이 기본값임을 보고에 적는다) | O1. 앱은 grant로만 tool이 된다. 후보 `operator-no-grant` |
| `pm-creates-no-grant` | `openSession`(PM, `{role: "project_manager", project}`) → `say` → `waitPermission`(이때 `agentDefinitionList({place})`를 한 번 읽는다) → `decide`(allow) → `waitTurnEnd` → `agentDefinitionList` + `agentGrantsGet`(새 Operator) | ① tool `operator_create {place: {project: <project 이름>}, name: "pm-made", body: ""}` ② text | ledger: 허락 전에는 목록에 `pm-made`가 없고 허락 뒤에는 있다(agent의 설정 고치기는 묻는다) 그리고 새 Operator의 `agentGrantsGet` entries가 비어 있다 / fake: PM 첫 요청의 `operator_create` tool `input_schema`에 grant로 읽히는 칸이 없다(`properties` 키 중 `grant`를 포함한 것이 없다) | agent-definition "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다", approval "agent는 자기 grant를 넓히지 못한다". 후보 `operator-no-grant`의 PM 쪽 |

3. 행마다 fake 대답 2개 이하, 단정 2~3개, 단계 6 이하다. 읽기(`agentDefinitionList` 등)는 단정의 재료이고 단계로 세지 않는다. `pm-creates-no-grant`의 PM tool 이름은 `toolNames`로 `operator_create`가 맞는지 확인한 뒤 쓴다. `operator-app-api` 행의 앱 title과 겹치지 않게 이 행들은 앱에 write하지 않는다.
4. 어긋난 단정이 제품 bug로 보이면 test를 맞추지 않는다. 고치기 전 코드에서 그 행이 실패하는 것을 먼저 확인하고(출력 한 줄을 보고에 적는다) 추가 소유 안에서만 고친다. 크거나 제품 동작을 새로 정해야 하면 고치지 말고 "사람에게 물을 것"으로 보고한다(README "정한 것" 8).
5. 정한 것(문서에 답이 없어 이 brief가 정한 것):
   - planner 검토로 정했다: architecture `agent-definition.md`가 "tool 목록은 session을 시작할 때 고정한다"고 정했으므로 틀린 것은 notice 문구다. 코드는 `listed`(고정 목록)만 실행하니 session 도중 할당한 tool은 그 session에서 부를 수 없다. `prepare.ts`의 `tools_changed` notice 문장을 "새 session부터 쓸 수 있다"는 뜻의 고정 문장으로 고친다(추가 소유 `run-loop/prepare.ts`). `grant-added` 행에 단정 하나를 더하지 않고 fake 단정의 notice 확인을 "tool 이름과 새 session 안내가 있다"로 본다. 고치기 전 코드에서 notice가 "Now available"인 것을 보고에 적는다.
   - notice의 형식은 `tools_changed` kind(`prepare.ts`의 `noticeText`)와 tool 이름만 본다. 문장은 단정하지 않는다.
   - app-api `description` 단정은 `appAppApi`를 user로 읽어 얻는다. user가 읽지 못하면 그 단정만 빼고 이유를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `run-loop`·`agent-tools`(tool 목록은 session을 시작할 때 고정하고 바뀐 것은 program이 쓴 고정 알림으로만 간다), `agents`·`approvals`(Operator 정의를 만드는 길은 grant를 주지 못하고 grant는 사람의 `agent_grants/set`뿐이다).
- 현실적 회귀: session 도중 grant가 바뀌어 `tools[]`가 달라져 prompt cache가 깨지는 것, notice에 앱이 쓴 글(tool 설명)이 들어가 같은 재료가 같은 bytes가 아니게 되는 것, grant 없는 Operator에 앱 tool이 보이는 것, `operator.create`에 grant 칸이 생겨 agent가 자기 권한을 넓히는 것.
- 왜 지금 test가 못 잡나: `turn-prompt`와 `tool-lists`의 unit은 입력으로 받은 목록만 본다. 사람이 grant를 session 도중 바꾸는 일과 agent runtime child가 session마다 고정한 목록을 지키는 일은 process를 건너야 한다. `operator.create`의 입력 schema가 model 요청에 실제로 실리는 모양도 마찬가지다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/operator_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/operator_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "grant는 사람만 주고(agent의 `operator.create`에는 grant 칸이 없다), session 도중 바뀐 grant는 tool 목록을 흔들지 않고 고정 알림으로만 간다"

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

