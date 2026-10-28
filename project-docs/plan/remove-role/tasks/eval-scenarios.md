# eval-scenarios

eval scenario를 role 폴더(`tests/eval/scenarios/{app-engineer,lophn,operator,project-manager}`)에서 place 종류로 다시 쓰고, registry의 instruction·tool·skill 항목, 되살리기(`restore/operators.ts`), 참가자와 기록 읽기를 새 정의·주소·route로 고친다. 돌리지 않는다.

- 단위: eval (wave 3)
- 선행: shell-events. eval runner가 session snapshot을 읽는다.
- 소유(이 task만 고친다):
  - `tests/eval`
- 읽을 것:
  - architecture: `project-docs/architecture/eval.md`(흐름, 자리, "지키는 것": 진짜 model은 `real` 참가자만, 되살리기의 흔적, 버전은 hash로 고정, `tests/eval`의 `*_test.ts`는 순수). `project-docs/architecture/testing.md`의 eval 줄. `project-docs/architecture/agent-definition.md`의 model 층 순서(이 대화 > agent 정의 > project > 전역 기본값). 이 문서들의 role 말과 바뀐 자리는 lead가 고친다.
  - skill: `.claude/skills/eval-run/SKILL.md`(어느 명령이 진짜 provider를 부르고 기록을 쓰는지 알려고만 읽는다. 이 task는 그 명령을 돌리지 않는다), `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`(eval은 test가 아니다). 시나리오가 재는 계약은 `project-docs/boundary-catalog.yaml`의 `router`, `agent-sessions`, `agents`, `agent-tools`
  - 제품 결정: `project-docs/plan/remove-role/README.md`의 "주소와 넘기기"(domain 일을 받는 쪽은 주인 그릇 place의 lophn session, 새 앱은 그 앱 place의 lophn session), "저장과 test"의 eval 줄, "뼈대 검토"(eval의 지난 기록은 고치지 않는다, guide skill 이름 `guide-agents-and-assignments`). `project-docs/products/roadmap/remove-role.md`의 "왜"(role이 없으면 버그를 찾은 agent가 고친다). 시나리오의 출처 줄은 `project-docs/products/AGENT-ROLE.md`(계획 뒤 planner가 다시 쓴다)
  - 계약 모양: `project-docs/plan/remove-role/tasks/contract-agent.md`(`AgentId`, `LOPHN_AGENT_ID`, `LOPHN_AGENT_NAME`, `AgentAtPlace`, `AgentAddress`, `agentCreate`, `agentList`), `project-docs/plan/remove-role/tasks/contract-session.md`(`placeSessionOpen`·`placeSessionRead`, `agentCallRead`, `AgentCallRow`, `CallTarget`), `project-docs/plan/remove-role/tasks/place-prompts.md`(지침 file 자리, guide skill 이름), `project-docs/plan/remove-role/tasks/shell-events.md`(snapshot의 `agent: AgentId`)
  - 코드(`tests/eval` 안):
    - 계약 type: `types.ts`(`Participant`, `WorldIds`, `SessionRecord`, `SentCall`, `Metrics.agent_calls`, `MaterialKind`)
    - 되살리기: `restore/{mod,operators,manifest,hash}.ts`, `restore/materials_test.ts`(커밋된 재료 전부의 hash·id·needs를 본다), `materials/operators-home/5/`, `materials/tax-kinds/2/`
    - model 붙이기와 단계: `provider/attach.ts`, `runner/{steps,trial,replay,roots,spend,cap,idle,experiment}.ts`
    - 기록 읽기: `collect/{read,metrics}.ts`
    - check: `checks/{records,fixtures,validate}.ts`
    - 버전: `versions/{components,registry,files,authored}.ts`, `experiment/variant/texts.ts`, `experiment/overfit/terms.ts`, `experiment/assembly/prefix.ts`
    - 시나리오: `scenarios/**`(11개와 `common.ts` 넷), `runner/discover.ts`
    - session model route: `packages/protocol/lophn-agent/sessions.ts`의 `changeSessionModel`(input `{ session, model }`, compare `{ state: "open", state_seq }`)
- 계약:
  - 쓰는 것: `contract-agent`의 `AgentId`, `AgentAddress`, `agentCreate`, `assignmentSet`. `contract-session`의 `PLACE_SESSION_ROUTES`, `AGENT_CALL_ROUTES`. `place-prompts`의 지침 file 자리와 바꾼 guide skill 이름. `place-tools`의 tool 목록 함수.
  - 내놓는 것: scenario 폴더는 place 종류(`home`, `project`, `app`)이고, 참가자는 agent 이름과 place다. registry의 instruction 항목은 place 종류 셋, tool 항목은 `agent.create`·`agent.update`다. 지난 기록(`runs/`, `scorecards/`, `experiments/*/`)과 git이 추적하지 않는 `materials/calendar-app-*`는 고치지 않는다.

## 할 일

scenario·restore·check·collect를 새 계약으로 다시 쓰고 eval의 test(`*_test.ts`)가 통과하게 한다. 실제 model은 부르지 않는다.

1. 돌리지 않는 것과 건드리지 않는 것:
   - 돌리지 않는다: `npm run eval`, `eval:experiment`, `eval:gate`, `eval:judge`, `eval:scorecard`, `test:live`. `eval`·`eval:experiment`는 `.env`의 key로 진짜 provider를 부르고(AGENTS.md "사람에게 묻는 것"), 나머지도 registry·기록을 쓰거나 e2e를 돈다.
   - 고치지 않는다(README "eval의 지난 기록은 고치지 않는다"): `tests/eval/runs/`, `tests/eval/scorecards/`, `tests/eval/experiments/`(그 안 file 전부), `tests/eval/registry/`(정한 것). git이 추적하지 않는 `tests/eval/materials/calendar-app-{dev,user}/`는 worktree에 없다. 만들지도 옮기지도 않는다.
2. `types.ts`(eval의 계약):
   - `Participant` = contract-agent의 `AgentAddress`(`{ agent: <agent 이름>, place?: { project } | { app } }`, place가 없으면 home). 지금 주석의 role 설명을 이 뜻으로 바꾼다.
   - `WorldIds.operators` → `agents: Record<string, Id<"agt">>`(agent 이름 → id).
   - `SessionRecord`: `agent: AgentId`, `agent_name: string`, `place: PlaceName | null`(null이면 home).
   - `SentCall`: `record: AgentCallRow | null`, `receiver: AgentId | null`, `receiver_name: string | null`. `receiver_place`는 그대로다.
   - `Metrics.agent_calls[].receiver_role` → `receiver_agent: string | null`(받는 agent 이름).
   - `MaterialKind`의 `"operator"` → `"agent"`.
   - import의 `AgentRef`, `NamedAgent`, `Role`, `AgentCallRecord`를 `AgentAddress`, `AgentId`, `AgentCallRow`로 바꾼다.
3. 되살리기(`restore/`, README "agent와 정의": 정의는 전역이고 place가 없다):
   - `operators.ts`를 `git mv`로 `agents.ts`로 옮기고 `restoreAgents(ctx, material)`로 다시 쓴다. `agents.json` = `[{ "definition": { "name", "body" } }]`를 읽어 `agentCreate { id: material.manifest.ids[name], definition }`를 부르고 `ctx.world.agents[name] = id`로 둔다. model은 정의에 넣지 않는다(지금처럼).
   - `manifest.ts`의 `ID_PREFIX`: `operator: "agt"` → `agent: "agt"`.
   - `mod.ts`: `restoreOne`의 `case "agent"`, `restoreContext`의 world `{ apps, projects, agents }`. `agentRefOf`를 `agentAtPlaceOf(world, p): AgentAtPlace`로 바꾼다: agent는 `p.agent === LOPHN_AGENT_NAME`이면 `LOPHN_AGENT_ID`, 아니면 `world.agents[p.agent]`. place는 없으면 `null`, `{ app }`이면 `{ kind: "app", id: world.apps[app] }`, `{ project }`이면 `{ kind: "project", id: world.projects[project] }`. 못 풀면 지금처럼 던진다.
4. 재료(`materials/`):
   - 새 `agents-home/1/`: `material.json` = `{ "kind": "agent", "ids": { "세무정리": "agt_0000000000000000000000ag02" }, "needs": [], "content_hash": … }`, `files/agents.json` = `[{ "definition": { "name": "세무정리", "body": <operators-home@5의 세무정리 본문 그대로> } }]`. `content_hash`는 `restore/hash.ts`의 `contentHash`로 잰다(`.dev-data/eval-scenarios/` 안의 작은 script). JSON은 `JSON.stringify(v, null, 2) + "\n"`로 쓴다(`eval.md` "버전은 hash로 고정한다": 재료는 biome 밖이고 쓴 byte로 hash를 잰다).
   - `operators-home/`(n 2~5 전부)를 지운다.
5. 진짜 model 붙이기(`provider/attach.ts`, `runner/{steps,trial,replay}.ts`. 정한 것):
   - `runner/steps.ts`에 `openRoots(core, world, participants, roots)`를 더한다. 참가자마다 `agentAtPlaceOf`로 풀어 `placeSessionOpen { id: core.ids.newId("ses"), agent, place }`로 열고 `roots`(key `JSON.stringify(<AgentAtPlace>)`)에 넣는다. 이미 있으면 다시 열지 않는다. `runSteps`의 `say`도 같은 key로 찾고 없으면 같은 함수로 연다. `tests/support/core/human.ts`의 `openSession`은 쓰지 않는다(e2e-agents와 선행이 없어 그 helper의 꼴에 기대지 않는다).
   - `attachRealModels(core, { key, model, options?, sessions: string[], endpoint? })`: provider 연결과 "전역 기본 model이 비어 있다" 검사는 그대로다. 정의를 고치던 자리에서 받은 session마다 `placeSessionRead`로 `state_seq`를 읽고 `changeSessionModel { session, model }`(compare `{ state: "open", state_seq }`)을 부른다. `agentDefinitionRead`·`operatorChange`·`builtinAgentChange` import를 지운다.
   - `runner/trial.ts`·`runner/replay.ts`: `prepareTrialWorld` 뒤, t0 전에 `openRoots(…, scenario.real, roots)` → `attachRealModels(…, { sessions: [...roots.values()] })` → `runSteps({ …, roots })` 순서다. session을 t0 전에 열어도 turn이 없어 collect의 t0 거르기와 부딪치지 않는다.
6. 기록 읽기(`collect/read.ts`, `collect/metrics.ts`):
   - session은 `placeSessionRead`로 읽는다(`agent`, `place`). call은 `agentCallRead`로 읽는다. `to`(`CallTarget`)가 `new_session`·`open_session_or_new`면 `to.agent`(`AgentAtPlace`)가 받는 쪽이고, `open_session`이면 그 session을 읽는다. `coding_agent` 갈래는 없다.
   - agent 이름은 `agentList`를 한 번 읽어(`readNames` 옆에서) id → 이름 표로 채운다. place 이름은 지금 `Names`(앱·project 이름)로 채운다. `placeOf(agent: AgentRef, names)`는 `placeOf(place: Place | null, names)`가 된다.
   - `metrics.ts`: `receiver_agent` = 기록의 `receiver_name`, 없으면 `call` 입력 `to.agent`가 string일 때 그것, 아니면 `null`.
7. check helper(`checks/records.ts`, `checks/fixtures.ts`):
   - `matchTarget(c, t)`: 받는 agent 이름이 `t.agent`이고 place가 같다. `t.place`가 없으면 받는 쪽이 home(`receiver_place === null`)이어야 한다. 이것이 home의 lophn과 앱·project place의 lophn을 가른다. 기록(`receiver_name`)이 없으면 `call` 입력 `to`(`{ agent, place? }`)에 같은 규칙을 쓴다. `{ session }` 입력은 기록 없이는 맞지 않는다.
   - `nameForm`은 `to.agent`가 string인 입력을 읽는다.
   - `fixtures.ts`: `refOf`는 agent id를 낸다(lophn은 `LOPHN_AGENT_ID`, 나머지는 `agt_fx_<이름>`). `sessionOf` = `ses_fx_<agent 이름>_<place 이름 또는 home>`이다. 같은 lophn의 home session과 tax session이 다른 session이어야 C8·A12의 fixture가 맞다. 보낸 call의 `record.to`는 `{ kind: "new_session", agent: { agent, place } }`이고 `receiver`, `receiver_name`, `receiver_place`를 채운다.
8. 그 밖의 role 이름과 말:
   - `experiment/overfit/terms.ts`: `p.name` 대신 `p.agent`를 이름에 넣되 `LOPHN_AGENT_NAME`은 뺀다(lophn은 모든 지침에 나와 늘 경고가 된다). place 이름은 지금처럼 넣는다.
   - `experiment/assembly/prefix.ts`: 첫 system block 이름 `"role"` → `"place_kind"`(place-scope가 정한 제품 prompt 층 이름과 같다). `experiment/assembly/replay_test.ts`의 자료도 같이 바꾼다. `experiment/assembly/prefix_test.ts`의 `role_prompt`가 남았으면 `place_kind_prompt`로 바꾼다.
   - `versions/{components,registry,files,versions_test}.ts`, `experiment/variant/{texts,variant_test}.ts`: wave 2(agent-places-rename, agents-core, place-scope, place-prompts)가 넘길 줄로 경로와 함수를 바꿨다. 남은 role 이름(`ROLE_SET`, `ROLES`, `readRole`, `roleByText`, `role_prompts`, "role prompt" 주석과 오류 글)을 place 종류 말(`PLACE_KINDS`, `readPlacePrompt`, `place_prompts`, "place prompt")로 바꾼다. instruction component 이름은 place 종류(`home`, `project`, `app`)이고 tool 이름은 `agent.create`·`agent.update`다. `versions_test.ts`의 기대 값(`instruction:lophn@1` 같은 것)과 test 이름의 "role"도 이 이름으로 맞춘다. 그 test는 임시 registry 폴더를 쓴다. 진짜 `tests/eval/registry/`에는 쓰지 않는다.
   - `runner/spend.ts`의 `roleSpendUsd`·`roleSpend` → `agentSpendUsd`·`agentSpend`(`trial.ts`도). 주석의 "role agent"(`runner/{cap,spend,trial,idle,roots}.ts`) → "참가자 agent". `runner/roots.ts`의 "(Project Manager 등)"을 지운다. `runner/experiment.ts`의 "(앱, project, Operator)" → "(앱, project, agent)".
   - `experiment/spec/types.ts`의 `Role`(target·guard·case)과 model 메시지의 `role`은 다른 뜻이라 그대로다.
9. 시나리오(`scenarios/`): 폴더를 place 종류 `home`, `project`, `app`으로 다시 묶는다. 폴더는 말 상대(진짜 model을 받는 참가자)의 place 종류다.
   - 남기는 시나리오는 id를 그대로 두고 n을 `tests/eval/registry/scenario/<id>.json`의 가장 큰 n보다 하나 크게 한다. 폴더와 같은 폴더의 helper가 바뀌면 hash가 바뀐다(`versions/authored.ts`의 `scenarioHash`).
   - 참가자 상수 이름에서 role 접두(`AE_`, `PM_`, `OP_`)를 뺀다(예: `LOPHN_가계부` = `{ agent: "lophn", place: { app: "가계부" } }`, `LOPHN_tax` = `{ agent: "lophn", place: { project: "tax" } }`).
   - 새 폴더마다 `common.ts`에 그 폴더가 쓰는 참가자와 helper(`firstCallBody`, `askedQuestions`)를 둔다. 옛 폴더 넷(`lophn`, `project-manager`, `app-engineer`, `operator`)은 남지 않는다.
   - 출처 주석은 role 말 없이 다시 쓴다(무엇을 재는지와 근거 README·roadmap 줄).

   | 지금 | 새 자리 | 바꿀 것 |
   |---|---|---|
   | `lophn/L1` | `home/L1` | 참가자 꼴만 |
   | `lophn/L4-app` | `home/L4-app` | 받는 쪽은 그 앱 place의 lophn. wrong의 받는 쪽도 각 앱 place의 lophn |
   | `lophn/L5` | `home/L5` | 받는 쪽은 lophn @ tax(reply result), wrong은 lophn @ hr |
   | `lophn/L6` | `home/L6` | 사람 말 "Operator는 뭐고 누가 만들어?" → "agent는 뭐고 누가 만들어?". 읽을 skill은 place-prompts가 바꾼 이름(`guide-agents-and-assignments`. `packages/core/agent-places/skills/`에서 확인). wrong의 call은 lophn @ 가계부 |
   | `lophn/L8` | 지운다 | 기대가 role 넘기기다(앱에 붙는 Operator를 그 앱의 AE에게) |
   | `project-manager/C8` | `project/C8` | 말 상대는 lophn @ tax, 받는 쪽은 home의 lophn(`{ agent: "lophn" }`, reply none). wrong 둘은 lophn @ hr로 보낸 call과 home의 lophn에 reply result로 보낸 call |
   | `project-manager/C9-other` | 지운다 | 기대가 role이다(다른 project의 Operator). agent는 place에 속하지 않는다 |
   | `app-engineer/A1-ask` | `app/A1-ask` | 말 상대는 lophn @ 가계부 |
   | `app-engineer/A12` | `app/A12` | 말 상대는 lophn @ 가계부, 받는 쪽은 home의 lophn, wrong은 lophn @ 할일 |
   | `operator/O6` | `project/O6` | 아래 뒤집은 기대로 다시 쓴다 |
   | `operator/O7` | 지운다 | 기대가 role이다(Operator가 자기 grant를 청하고 AE에게 넘기지 않는다). 앱 place session은 이제 앱을 직접 고친다 |

   - `project/O6`: 말 상대 `세무정리` = `{ agent: "세무정리", place: { project: "tax" } }`, world `["projects-home@1", "tax-kinds@2", "agents-home@1"]`, 사람 말은 지금 그대로다. check는 `callCount("no-call", { count: 0 })`와 inline program check `edits-kinds`(성공한 `file.edit`·`file.write`의 입력 `path`가 `kinds.yaml`로 끝나는 것이 1개 이상. C9-other의 inline check 모양)다. fixture right는 그 `file.edit` 성공 하나, wrong은 lophn @ tax로 보낸 call(fails `no-call`, `edits-kinds`)과 아무것도 안 한 trial(fails `edits-kinds`)이다. `proposal: true`. judge check는 두지 않는다.
10. eval의 `*_test.ts`를 새 꼴로 고쳐 통과시킨다(새 test는 쓰지 않는다): `checks/validate_test.ts`, `collect/read_test.ts`(가짜 기록을 `PlaceSession`·`AgentCallRow`·`CallTarget` 꼴로), `experiment/overfit/overfit_test.ts`(참가자 꼴, lophn을 이름으로 세지 않는다), `experiment/assembly/{prefix_test,replay_test}.ts`. `experiment/{select,verdict,trials}/*_test.ts`, `scorecard/scorecard_test.ts`, `runner/change_test.ts`의 자료 `instruction:lophn`은 `instruction:home`으로 바꾼다(이제 없는 component 이름이라 헷갈린다).

## 정한 것

- `tests/eval/registry/`는 손대지 않는다. 이유: program이 덧붙이기만 하는 version 기록이다. `runs/`의 요약이 `instruction:lophn@4`, `tool:operator.create@3` 같은 이름으로 가리키고 `scorecard diff`와 experiment의 overfit이 그 content를 읽는다. 앞서 이름을 바꿀 때도 옛 항목을 남겼다(`registry/skill/lophn-build-app.json`, `registry/tool/blueprint.check.json`). 새 이름(`instruction:home|project|app`, `tool:agent.create|update`, `skill-description:guide-agents-and-assignments`)의 항목은 다음 진짜 run의 `resolveVersion`이 쓴다. 계약의 "registry의 instruction 항목은 place 종류 셋, tool 항목은 `agent.create`·`agent.update`"는 이 task가 `versions/`에서 그 이름으로 재게 만들어 지킨다(8). 지금 `currentVersions`로 미리 쓰면 wave 4에 또 바뀔 core·runtime·tool hash의 항목이 아무 run도 보지 않은 채 남는다. 그래서 "남지 않음" grep은 `tests/eval/registry`를 뺀다(README의 지난 기록 목록에 더해 달라고 보고한다).
- 진짜 model은 agent 정의가 아니라 `real` 참가자의 session에 붙인다. 이유: 정의가 전역이 되어 lophn 정의에 model을 붙이면 home·project·app의 lophn session이 모두 진짜 model을 받는다. 그러면 call로 열린 받는 쪽(L4-app·L5의 앱·project place lophn, C8·A12의 home lophn)도 돌아 비용과 기록이 바뀌고 `eval.md` "진짜 model은 real 참가자만 받는다"가 깨진다. session model은 정의 model보다 앞서고(`agent-definition.md`) call로 연 session에 이어지지 않는다(`places/lifecycle.ts`의 `startSession`은 fork에서만 `model_selection`을 잇는다). 모든 시나리오의 `real`이 말 상대 하나라 session이 늘 먼저 열린다.
- L8, C9-other, O7은 지운다. 이유: 기대가 role 사이 넘기기나 place에 묶인 agent 자체다(README "role이 주제인 test는 지운다"를 eval에도 쓴다). 넘기기가 place 사이 넘기기로 남는 L4-app, L5, C8, A12는 받는 쪽만 그 place의 lophn으로 옮긴다(README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session").
- O6은 기대를 뒤집는다(project place의 agent가 `kinds.yaml`을 직접 고치고 아무에게도 call하지 않는다). 이유: 옛 기대(kind를 바꾸려면 PM에게 넘긴다)가 roadmap이 role을 없애는 까닭(넘기기가 비싸다, 버그를 찾은 agent가 고친다)이라 그대로 두면 새 지침과 반대인 case가 남는다. 사람이 만든 agent를 재는 case가 하나 남아 `restore/agents.ts`가 쓰인다. 지침 줄이 아직 product 문서에 없으므로 `proposal: true`다.
- `operators-home` 재료를 지운다. 이유: kind `operator`는 새 `loadMaterial`이 읽지 못하고(`ID_PREFIX`), place를 정의에 두는 꼴이라 되살릴 길도 없다. 재료는 입력이지 기록이 아니고, 옛 run 요약은 ref와 hash만 갖는다(hash 기록은 `registry/material/operators-home.json`에 남는다).
- `agents-home@1`의 needs는 비우고 `세무정리` 하나만 둔다. 이유: 정의가 전역이라 앱·project가 먼저 있을 필요가 없고, `월말정리`를 쓰던 O7은 지운다.

## 끝남

- `npm run check`가 통과한다. `tests/eval`의 `*_test.ts`(`restore/materials_test.ts`가 새 재료의 hash·id·needs를 본다)가 여기서 돈다.
- fixture와 n 확인(model, core, registry 쓰기 없이): `.dev-data/eval-scenarios/check.ts`에 다음을 하는 script를 쓰고 `node .dev-data/eval-scenarios/check.ts`가 문제 0개를 찍는다.
  - `discoverScenarios()`(`tests/eval/runner/discover.ts`)로 시나리오를 모두 읽고 `validateFixtures`(`tests/eval/checks/mod.ts`)의 problems가 빈다.
  - 시나리오마다 `readEntries(REGISTRY_DIR, "scenario", id)`의 가장 큰 n보다 `scenario.n`이 크다.
  - 시나리오마다 `orderMaterials(MATERIALS_ROOT, scenario.world)`가 `ok`이고 `verifyMaterial`이 모두 `ok`다.
  - registry에 쓰는 함수(`registerAll`, `registerAuthored`, `resolveVersion`, `currentVersions`, `seenComponents`)는 부르지 않는다.
- 위험 test: 없음. eval은 test가 아니고(`eval.md`), 그 안의 `*_test.ts`는 고치기만 한다.
- 남지 않음:
  - `ls tests/eval/scenarios`가 `app home project`이고 `ls tests/eval/materials`에 `operators-home`이 없다.
  - `grep -rn 'project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|operator\|AgentRef\|NamedAgent\|agentRefOf\|role: "lophn"\|ROLE_SET\|role_prompts\|roleSpend\|receiver_role\|guide-roles-and-assignments\|\bPM_\|\bAE_\|\bOP_' tests/eval --exclude-dir=runs --exclude-dir=scorecards --exclude-dir=experiments --exclude-dir=registry --exclude-dir=calendar-app-dev --exclude-dir=calendar-app-user`가 0줄이다(빼는 폴더는 지난 기록, program이 쓰는 registry, git 밖 재료다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
