# de-roles-core

role 층의 코드(tool 목록, credential, role 표, built-in 정의 만들기, role 명령, file hook, Operator tool)를 예전 role 배분으로 되돌리고 domain을 더한다: App Engineer가 앱 일(ticket, problem, package, source 연결)을 도로 맡고, Project Manager는 project와 그 안의 domain만 맡는다. 둘 다 `domain.create`를 쓰고, Operator tool이 `domains`를 받는다. prompt 글(`roles/**`)과 place 정보(`place/**`)는 `de-roles-text`·`de-place-info`가 한다.

- 단위: roles (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/{tool-lists,tool-lists_test,credentials,commands,hooks,hooks_test}.ts`
  - `packages/core/agent-roles/agents/`
  - `packages/core/agent-roles/place/session-directory.ts`
  - `packages/core/agent-roles/tools/{operator,operator-place,operator-place_test,instructions,guide,mod}.ts`
  - `packages/core/main/agent-tools.ts`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/daemon/wiring/lophn-agent.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정", "agent credential의 operation 상한", "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"), `project-docs/architecture/place-session.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기 > role", "domain을 만드는 쪽", `project-docs/products/AGENT-ROLE.md`(A·C·O·L 줄)
  - 본보기(git): `a66724c30^`의 `packages/core/agent-roles/{agents,tool-lists.ts,credentials.ts,tools/operator*.ts,place/session-directory.ts}`(App Engineer가 있던 모양), `a66724c30`(PM에 합친 diff를 거꾸로 읽는다)
- 계약:
  - 쓰는 것: `de-domain-core`의 `DOMAIN_AGENT_TOOLS`(`packages/core/domains/agent-tools.ts`)와 `domainList`·`domainGet`, `de-place-restore`가 넓힌 `Role`·`Place`·`AgentRef`
  - 내놓는 것
    - role 목록: `app_engineer`는 `ticket.create`·`ticket.update`·`ticket.verify`·`ticket.cancel`·`problem.set_state`·`app.link_source`·`package.publish`·`operator.create`·`operator.update`·`domain.create`와 `app.app_api`를 갖는다. `project_manager`는 `operator.create`·`operator.update`·`domain.create`만 쓴다(ticket·problem·source 연결·package는 없다). 모든 role이 `domain.list`·`domain.get`을 읽는다. `app.app_api`는 lophn과 App Engineer다.
    - credential 조건: App Engineer는 `conditions.app`(담당 앱), 프로젝트 place의 PM·Operator는 `conditions.project`, 앱 place의 Operator와 lophn은 조건이 없다. PM의 `conditions.app`은 없어진다(`agentConditions`의 `app` 입력이 App Engineer 전용이 된다).
    - Operator tool: `operator.create`·`operator.update`의 place 입력이 `{project: 이름}`과 `{app: 이름}` 둘이고, 입력에 `domains`(그 그릇의 domain **이름** 목록. tool이 id로 바꿔 정의에 쓴다)가 생긴다. `operatorPlaceAllowed`는 PM은 자기 project, App Engineer는 자기 앱의 Operator만 허락한다.

## 할 일

1. `tool-lists.ts`: 위 목록으로 `ROLE_WRITE_TOOLS`(`satisfies Record<Role, …>`에 `app_engineer`가 돌아온다), `READ_TOOLS`(`domain.list`, `domain.get`), `APP_API_TOOLS`(lophn과 app_engineer), `builtinToolNames`, `TOOL_ORDER`(`domain.list`·`domain.get`·`domain.create`를 `app.create` 앞쪽에 정해진 자리로)를 고친다. `tool-lists_test.ts`를 맞춘다.
2. `credentials.ts`: `roleOperations`의 `annotationsGet`은 app_engineer·project_manager·operator에게, `PLACE_READS`에 `domainList.name`·`domainGet.name`을 더한다. `agentConditions`는 위 계약 그대로 만든다.
3. `agents/`: `role-table.ts`에 `PROFILES.app_engineer`(icon `apps`), `BUILTIN_FILES.app_engineer`(`app-engineer.md`), `slotOf`의 app_engineer, `builtinRefs`의 앱 갈래를 되살린다(`a66724c30^` 모양). `ensure.ts`에 `ensureAppEngineer`를 되살리고 `ensureProjectManager`가 만들던 project skill 폴더는 더 만들지 않는다(skill 폴더는 domain 몫이다). `app-engineer.ts`(`withAppEngineer` writer 감싸기)를 되살리고 `wiring/lophn-agent.ts`가 앱 등록(`appCreate.name`) 뒤에 그 앱의 정의 file을 만들게 한다. `role-table_test.ts`를 맞춘다.
4. `place/session-directory.ts`: `createPlaceRoleRules`의 `resolveNamed`에 app_engineer(`{app}` 이름), Operator의 앱 place, `nameOf`의 app_engineer를 되살린다. `PlaceDeps.apps`는 `de-place-restore`가 되살렸다.
5. `commands.ts`: `ROLE_COMMANDS.app_engineer`를 빈 목록으로 더한다. `NEW_APP_PROMPT`는 "어느 project에 둘지"를 묻는 말을 빼고(앱은 project에 묶이지 않는다) 나머지는 그대로 둔다. `CHECK_KINDS_PROMPT`는 "this project" 대신 "each domain of this project"로 고쳐 domain마다 `kind.check`를 돌리게 한다.
6. `hooks.ts`: 주석을 바꾼다(domain 폴더의 `DOMAIN.md`·`kinds.yaml`·`skills/`·`artifacts/`는 file tool이 닿고 Gate 없이 쓴다. 지침 Gate는 `LOPHN.md`뿐이다). 동작은 그대로다. `hooks_test.ts`에 한 사례를 더한다(아래 위험 test).
7. `packages/core/agent-roles/tools/operator.ts`·`operator-place.ts`: 위 계약대로 되돌리고 `domains` 입력을 더한다. 입력의 domain 이름을 그 place 그릇의 `domainList`(`ctx.core`, 그릇 owner를 주고 읽는다)에서 id로 바꾸고, 그릇에 없는 이름은 `invalid_input`이다. `operatorDefinition`(`omit`된 목록)에서 `domains`를 빼지 않는다. `operator-place_test.ts`를 되살린다.
8. `main/agent-tools.ts`에 `DOMAIN_AGENT_TOOLS`를 모은다. `main/agent-tools_test.ts`를 맞춘다: "App Engineer의 credential 상한에 `ticket.create` route가 든다", "Project Manager의 상한에는 없다", "role 목록의 모든 이름에 정의가 있고 그 반대도 그렇다".
9. 조립 `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`의 `conditionsFor`(PM의 담당 앱을 ledger에서 읽어 `agentConditions`에 `app`으로 넘기던 부분, 217~231째 줄)와 `appOfProject` import(46째 줄)만 걷어 낸다: 이제 `agentConditions(input)`을 그대로 부른다(App Engineer의 `conditions.app`은 place에서 정해진다). 이 file의 나머지는 `de-place-info`의 소유라서 건드리지 않고 "넘길 줄"에 적는다.
10. 이 task는 `agent-roles/tools/kind*.ts`(→ `de-kinds-domain`), `roles/**` 글(→ `de-roles-text`), `place/` 나머지(→ `de-place-info`)를 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "Project Manager는 다른 project의 Operator를 만들거나 고치지 못하고, App Engineer는 다른 앱의 Operator를 만들지 못한다. 서로의 place도 만들지 못한다" — `packages/core/agent-roles/tools/operator-place_test.ts`
  - "App Engineer의 credential 상한에는 ticket 쓰기 route가 있고 Project Manager의 상한에는 없다" — `packages/core/main/agent-tools_test.ts`
  - "`LOPHN.md` 쓰기는 Gate를 거치고 `DOMAIN.md` 쓰기는 거치지 않는다" — `packages/core/agent-roles/hooks_test.ts`
- 남지 않음: `grep -n "app" packages/core/agent-roles/credentials.ts`의 `conditions`·`agentConditions` 쪽 `app` 줄이 App Engineer 갈래뿐이다(PM의 임시 `app` 조건이 사라졌다). 눈으로 확인해 보고에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: AE profile icon과 role 명령 문구
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: lophn의 `app.create`가 아직 project를 받는다(`de-apps-unbind`가 푼다)
