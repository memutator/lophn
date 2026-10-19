# tr-e2e-app-tools

떨어진 e2e 셋(`app-call`, `app-data-rewind`, `operator`)이 agent의 앱 tool을 못 받는 원인을 가른다. 새 설계(domain 단위 공개 tool 거르기, Operator domain 좁히기)대로 숨겨진 것이면 test를 새 설계로 다시 쓰고, 제품 bug면 아래 제품 file에서 bug를 고친다.

- 단위: e2e (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/app-call_test.ts`
  - `tests/e2e/app-data-rewind_test.ts`
  - `tests/e2e/operator_test.ts`
  - `tests/support/app/patch-call.ts`
  - `tests/support/app/patch-rewind.ts`
  - `tests/support/app/patch-public.ts` (새 file. 필요할 때만)
  - 제품 bug일 때만: `packages/core/lophn-agent/tools/{app-public,app-public_test,app-tools,app-toolkit}.ts`, `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - `AGENTS.md`, `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/domain.md`("흐름"의 `turn ── ResolvedAgent.domains` 묶음, "지키는 것"의 "다른 domain의 비공개 tool은 보이지 않는다"), `project-docs/architecture/agent-definition.md`("다른 domain의 비공개 tool은 agent의 tool 목록에도…" 줄: domain이 없는 lophn은 `public`만 본다), `project-docs/architecture/app-call.md`, `project-docs/architecture/testing.md`(앱 길, E2E 실행 폴더, case 고르는 규칙)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`·`agents`·`domains`·`app-runtime`·`app-data`·`approvals`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(`lophn-agent`)·`packages/core/main`(`core`)
  - 실패 기록: `.dev-data/plan-test-restore/e2e-run.log`의 `ERRORS` 절(main checkout에만 있다. git 밖이라 worktree에는 없다)
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"
- 계약:
  - 쓰는 것: `tests/support/app/activate.ts`의 `activateTestApp`·`startTestApp`·`deliverRelease`·`approveActivation`·`waitRunning`(고치지 않는다. 바꿀 것은 보고에 요청으로 적는다), `project-docs/architecture/domain.md`의 "turn ── ResolvedAgent.domains" 규칙
  - 내놓는 것: 보고의 "정한 것"에 진단 한 줄씩(file마다 새 설계 / 제품 bug와 근거). `operator_test.ts`의 공용 준비(core, 앱, Operator를 만드는 helper)는 `tr-e2e-operator-domain`이 이어 쓴다

## 할 일

1. **진단을 확인한다. 코드를 고치기 전에 한다.** 아래는 brief를 쓰며 코드에서 본 근거다. 다시 열어 맞는지 보고, file마다 결론 한 줄을 보고의 "정한 것"에 적는다.
   - `packages/core/main/agent-runtime/product-driver.ts`의 `callerDomains`: lophn은 `placeOfAgentRef`(`packages/protocol/lophn-agent/places.ts`)가 `null`이라 `[]`다. Operator는 `agentDefinitionRead`로 읽은 place 그릇의 active domain에 정의의 `domains`를 `workingDomains`(`packages/core/lophn-agent/agents/resolve.ts`)로 건다. domain이 0개인 project의 Operator는 `[]`다.
   - `packages/core/lophn-agent/tools/app-public.ts`의 `withPublicOnly`: `tool.public`이 false인 tool은 그 tool의 domain id가 위 집합에 있을 때만 남는다.
   - template tool은 모두 `public: false`다(`packages/core/apps/packages/template/app/blueprint.ts.tmpl`). `patch-call.ts`·`patch-rewind.ts`·`patch-net.ts`가 더하는 tool도 `public: false`다.
   - core의 호출 길(`packages/core/apps/calls/`)은 domain을 보지 않는다. 막는 곳은 목록 거르기 하나다(domain.md "다른 domain의 비공개 tool은 보이지 않는다").
   - log와 맞는다. `app-call`의 `agent-calls-app`은 fake 대답 함수 `callApp`이 요청에서 tool을 못 찾아 던져(fake가 400) invocation이 0이다. allow-session-scope 둘은 같은 이유로 권한 요청이 오지 않아 30초씩 기다렸다. `app-data-rewind`는 `addItemTool`이 `tool_not_offered`를 불러 229줄 `titles` 단정에서 떨어졌다. `operator`는 project Operator의 앱 tool이 0개라 143줄에서 떨어졌다.
   - 그래서 셋 다 새 설계대로 숨겨진 것이고 test가 틀렸다고 본다. 다르게 나오면(예: 아래 2의 앱 place Operator도 비공개 tool을 못 받는다) 제품 bug다. 소유한 제품 file에서 고치고 위험 test를 더한다("끝남").
2. **`operator_test.ts`: Operator를 앱 place에 둔다.** 근거: domain.md "Operator: 정의의 domains ∩ 그릇의 active domain, 비면 그릇의 전부". 정의에 `domains`가 없으면 앱의 domain을 모두 맡아 비공개 tool을 받는다.
   - `operatorWith(core, project, name, entries)`를 `operatorWith(core, place, name, entries)`로 바꾼다(`place: Place`, `packages/protocol/lophn-agent/mod.ts`). tool·excluded·ask-reject·ask-allow·no-grant·grant-added 행은 `{ kind: "app", id: app.app }`로 만든다.
   - pm-creates-no-grant 행은 project의 Project Manager 행이라 그대로 둔다(`openProject`, `operator_create`의 `place: { project }`, `agentDefinitionList({ place })`).
   - `operatorWith`는 helper 하나로 남긴다. `tr-e2e-operator-domain`이 여기에 정의 `domains`를 더해 이어 쓴다.
   - 지금 log는 첫 행에서 멈췄다. domain 계획들 뒤로 나머지 행은 한 번도 돌지 않았다. 끝까지 돌리고, 더 떨어지는 행은 1과 같은 기준(새 설계 / 제품 bug)으로 가른다.
   - 머리 주석의 "준비"(project 하나를 모든 행이 나눠 쓴다)를 지금 모양에 맞춘다.
3. **`app-call_test.ts`: lophn 대신 앱 place의 Operator가 부른다.**
   - 준비의 `agentGrantsSet({ agent: { role: "lophn" }, … })`를 다음 둘로 바꾼다. 먼저 `operatorCreate`(`packages/protocol/lophn-agent/agent-definitions.ts`, `id: core.ids.newId("agt")`, `place: { kind: "app", id }`, definition `{ name, body }`)로 Operator를 만들고, 그 ref(`{ role: "operator", agent }`)에 `agentGrantsSet`으로 `[{ kind: "app", app: id, tools: [] }]`를 준다.
   - agent-calls-app과 allow-session-scope 두 행의 `openSession(c, { role: "lophn" })`을 그 ref로 연다. `openSession`(`tests/support/core/human.ts`)은 부를 때마다 새 session이라 두 행의 `assertNotEquals(session, granted)`는 그대로 선다.
   - 머리 주석의 "앱 activation helper의 Project Manager 대답"은 지금 helper가 App Engineer session(`TestApp.ae`)으로 건다. 맞게 고친다.
4. **`app-data-rewind_test.ts`: session-rewind-with-app 행도 같은 앱 place Operator로 한다.** 216~219줄의 lophn grant와 226줄의 `openSession(core, { role: "lophn" })`을 3과 같이 바꾸고, 215줄 주석("lophn session의 rewind")을 고친다. 앞 세 행(사람이 부르는 호출)은 그대로 둔다.
5. **`patch-public.ts`는 만들지 않는다**(정한 것). `public: true`로 바꾸면 public tool 장치(`app.usage`, release 막기, `PublicToolsChanged`)를 이 flow들에 끌어들인다. 그리고 `operator_test.ts`에서는 뒤 task가 비공개 tool이 domain으로 좁혀지는 것을 봐야 한다. 새 설계에서 비공개 tool을 부르는 길은 그 domain을 맡은 agent다.
   - 그래서 `patch-call.ts`·`patch-rewind.ts`도 고칠 일이 없다.
   - 앱 place Operator 길이 새 설계상의 이유로 막힐 때만 `patch-public.ts`를 만든다. 그때도 `app-call`·`app-data-rewind`에만 쓰고 `operator_test.ts`에는 쓰지 않는다. 이유를 "정한 것"에 적는다.
6. **시간을 잰다.** 세 file은 고친 뒤 지금보다 크게 늘지 않아야 한다. `app-call`은 지금 1분 11초다. 그 가운데 1분은 실패 둘이 30초씩 기다린 것이라 크게 줄어야 한다. 각 file의 고친 뒤 시간을 보고에 적는다.

## 끝남

- `deno task check:full`이 통과한다.
- `deno task e2e:deps`를 한 번 돌린 뒤, 세 file이 각각 `deno test --allow-all --no-check tests/e2e/<file>`로 10번 연속 통과한다. flaky한 행은 꺼 두지 않고 고친다(testing.md 규칙 8).
- 끝난 뒤 `/tmp/lophn-e2e-*`가 남지 않고, `pgrep -af daemon/main.ts`에 그 run의 core가 없다.
- 위험 test: 새 설계면 없음(다시 쓴 e2e 행이 본다). 제품 bug면 "<bug를 한 문장으로>"를 가장 싼 층(`packages/core/lophn-agent/tools/app-public_test.ts` 등)에 한 행 더한다. 고치기 전 코드에서 그 행이 떨어지는 것을 확인한다.
- 남지 않음: 앱 place Operator 길이면 `grep -n 'role: "lophn"' tests/e2e/app-call_test.ts tests/e2e/app-data-rewind_test.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check와 file마다 10번 연속 결과, 고친 뒤 시간
- 등록할 것: 없을 것이다(lead가 고칠 목록 file을 건드리지 않는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: file마다 진단 한 줄(새 설계 / 제품 bug와 근거). 2에서 더 떨어진 행의 진단도 같은 꼴로. 앱 place Operator 대신 다른 길을 골랐으면 그 이유
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `activate.ts`를 바꿔야 하면 고치지 말고 여기 적는다(그 file은 `tr-e2e-coding-mcp` 소유다)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
