# role-rules-turn-agent

turn을 준비할 때 resolved agent를 만드는 길(`agents/layers.ts`, `agents/resolve.ts`)에서 role 이름과 projects route를 걷어낸다. role마다 다른 값(built-in 이름, 기본 profile, 받는 context)은 `agent-roles`의 role 표가 내놓고 harness는 인자로 받는다. harness 쪽 표 type(`AgentRoleTable`)을 여기서 처음 만들고 다음 task(`role-rules-agent-files`)가 정의 file 쪽 멤버를 더한다.

- 단위: role-rules (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/agents/role-table.ts`
  - `packages/core/lophn-agent/agents/layers.ts`
  - `packages/core/lophn-agent/agents/resolve.ts`
  - `packages/core/lophn-agent/agents/resolve_test.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/agent-roles/agents/role-table.ts`
  - `packages/core/agent-roles/place/active-contexts.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(harness와 lophn domain 절), `project-docs/architecture/agent-definition.md`
  - 이슈: `project-docs/issues/layers.md`(첫 절 "harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 본보기: 지난 계획이 같은 일을 나눈 방식은 `project-docs/products/change-log/0.2.0.md`의 "lophn-agent를 harness, role 층, domain tool로 나눔"(role 층이 값·규칙을 갖고 harness는 조립이 넘긴 것으로 돈다. `main/daemon/wiring/lophn-agent-team.ts`가 꽂는다)
  - 지금 코드(열어서 확인함): `agents/layers.ts`의 `activeContexts`(projects `contextListRoute`를 페이지로 훑음)와 `DEFAULT_PROFILES[role]`, `agents/resolve.ts`의 `operator`·`role === "project_manager"` 분기와 `BUILTIN_NAMES[role]`, `run-loop/prepare.ts`의 `roleTools`(deps, 151줄 근처)와 `resolveTurnAgent` 호출(620줄 근처), `session/compactor.ts`의 `roleTools`와 `summaryChoice`, `main/agent-runtime/product-driver.ts`의 `roleTools: builtinToolNames` 두 곳
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/`의 `Role`, `Profile`, `Place`, `AgentRef`, `rolePlaceFits`. `agent-roles/place/place-data.ts`(`place-folders`가 wave 1에서 고친다)는 읽기만 한다. 그 file에 페이지 훑는 helper가 export돼 있으면 쓰고 없으면 `active-contexts.ts`에 작게 둔다(file을 고치지 않는다).
  - 내놓는 것(`role-rules-agent-files`가 기대는 모양):
    - harness `agents/role-table.ts`: `type AgentRoleTable = { isOperator(role: Role): boolean; builtinName(role: Role): string | null; defaultProfile(role: Role): Profile; contextsOf(role: Role, input: { chosen: readonly string[]; active: readonly string[] }): { contexts: string[]; picked: boolean } }`. `builtinName`은 Operator에 null. `contextsOf`는 지금 `resolve.ts`의 규칙 그대로다(Operator는 정의가 고른 것 중 active인 것을 정의 순서로, Project Manager는 active 전부를 주어진 순서로, 나머지는 빈 목록).
    - `agent-roles/agents/role-table.ts`: `ROLE_TABLE: AgentRoleTable`. 값은 지금 `BUILTIN_NAMES`·`DEFAULT_PROFILES`(`agents/names.ts`, `agents/builtin.ts`)와 같다. 그 두 file은 이 task에서 지우지 않는다(`role-rules-agent-files`가 지운다).
    - `agent-roles/place/active-contexts.ts`: `activeContextsOf(machine: CoreCall, place: Place | null): Promise<Result<string[]>>`. 지금 `layers.ts`의 `activeContexts`와 같은 동작(project place만, `status: "active"`, 페이지 상한 50).

## 지켜야 할 것(계획 README, 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

그 밖에: harness 폴더의 비운 file에는 role 이름 문자열 리터럴(`"project_manager"`, `"app_engineer"`, `"operator"`; `tools/check-deps.ts`의 `ROLE_NAMES`)이 type 자리(`Exclude<Role, "operator">` 같은 것)까지 한 줄도 남으면 안 된다. 판정은 role 표가 함수로 내놓는다(`isOperator(role)` 꼴). `tools/check-deps.ts`는 이 task가 비운 file의 `HARNESS_LEFTOVERS` 항목만 지운다. 다른 task도 다른 줄을 고치므로 소유 줄에 두지 않았다(겹치면 lead가 rebase에서 두 쪽을 다 남긴다). 항목을 안 지우면 check가 "목록에서 빼라"고 실패한다.

## 할 일

1. harness `agents/role-table.ts`에 `AgentRoleTable` type만 둔다(근거: `layers.md`의 "harness는 role 이름과 domain route를 모르고 조립이 넘긴 것으로 돈다").
2. `agents/resolve.ts`: `BUILTIN_NAMES`·`operator` 변수·`role === "project_manager"` 분기를 `ResolveInput`으로 받은 `roles: AgentRoleTable`로 바꾼다(`isOperator`, `builtinName`, `contextsOf`). 에러 코드와 `sources`, hash 입력은 바뀌지 않는다.
3. `agents/layers.ts`: `contextListRoute` import와 `activeContexts`를 지우고, `resolveTurnAgent`의 input에 `roles: AgentRoleTable`과 `activeContexts(place: Place | null): Promise<Result<string[]>>`를 받게 한다. `DEFAULT_PROFILES[role]`은 `roles.defaultProfile(role)`로 바꾼다. `roleTools`는 그대로 둔다.
4. `run-loop/prepare.ts`와 `session/compactor.ts`: deps에 `roles`와 `activeContexts`를 `roleTools` 옆에 더하고 `resolveTurnAgent`에 넘긴다. 이 두 file은 `place-folders`(wave 1)도 고친 file이다. 그쪽이 merge된 상태에서 시작하며 turn 준비의 다른 부분은 건드리지 않는다.
5. `main/agent-runtime/product-driver.ts`: 두 곳(preparer, compactor)에서 `ROLE_TABLE`과 `activeContextsOf`를 꽂는다(composition root가 role 층을 harness에 넘기는 자리).
6. `agent-roles/agents/role-table.ts`, `agent-roles/place/active-contexts.ts`를 만든다.
7. `agents/resolve_test.ts`를 새 입력에 맞춘다. 새 test는 쓰지 않는다.
8. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`에서 `agents/layers.ts`, `agents/resolve.ts` 두 항목을 지운다.

## 끝남

- `deno task check`가 통과한다.
- 동작을 바꾸지 않는다: role 4개(lophn, project_manager, app_engineer, operator)의 tool 목록·prompt bytes·정의 file 자리를 전후로 비교한다. 이 task가 건드리지 않는 것(tool 목록, prompt)은 소유 file 밖이라 diff에 없음을 보이면 되고, 정의 file 자리와 이름·기본 profile처럼 이 task가 옮기는 값은 옮기기 전 값을 임시 script(commit하지 않는다)로 뽑아 옮긴 뒤 값과 같음을 보인다. 확인은 unit test와 `deno task check`까지다.
- 새 E2E·subprocess·서버 test를 만들지 않는다.
- 위험 test: 없음(기존 `resolve_test.ts`가 "정의 file에 tool을 적어도 role이 고정한 목록은 바뀌지 않는다"를 지키고 이 task는 그 test를 새 입력에 맞추기만 한다. 규칙은 옮겼을 뿐 새 판정이 없다).
- 남지 않음: `grep -n "project_manager\|app_engineer\|\"operator\"\|protocol/projects" packages/core/lophn-agent/agents/layers.ts packages/core/lophn-agent/agents/resolve.ts`가 0줄이다. `HARNESS_LEFTOVERS`에 두 file 줄이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

