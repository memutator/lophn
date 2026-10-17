# role-rules-agent-files

agent 정의 file을 읽고 쓰고 검사하는 길(`agents/`의 나머지 8개 file)과 `register.ts`의 `operatorDirectory`에서 role 이름을 걷어낸다. role별 정의 file 자리(`slotOf`), built-in 이름, Operator 판정, place 목록 순서를 `agent-roles`의 role 표로 옮기고 harness는 `AgentDeps`로 받는다. 정의 file이 놓이는 자리와 형식은 바뀌지 않는다.

- 단위: role-rules (wave 2)
- 선행: role-rules-turn-agent, role-rules-data-folder. turn-agent가 만든 `AgentRoleTable`을 늘려 쓰고 `agents/names.ts`·`agents/builtin.ts`의 마지막 사용처(`resolve.ts`, `layers.ts`)를 먼저 끊어 준다. data-folder가 agents 폴더 규칙 함수를 준다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/agents/role-table.ts`
  - `packages/core/lophn-agent/agents/names.ts`
  - `packages/core/lophn-agent/agents/builtin.ts`
  - `packages/core/lophn-agent/agents/store.ts`
  - `packages/core/lophn-agent/agents/inspect.ts`
  - `packages/core/lophn-agent/agents/reads.ts`
  - `packages/core/lophn-agent/agents/commands.ts`
  - `packages/core/lophn-agent/agents/commands_test.ts`
  - `packages/core/lophn-agent/agents/definition-file.ts`
  - `packages/core/lophn-agent/agents/validate.ts`
  - `packages/core/lophn-agent/agents/profile-asset.ts`
  - `packages/core/lophn-agent/agents/ports.ts`
  - `packages/core/lophn-agent/agents/mod.ts`
  - `packages/core/lophn-agent/agents/caller.ts`
  - `packages/core/lophn-agent/agents/caller_test.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-team.ts`
  - `packages/core/agent-roles/agents/role-table.ts`
  - `packages/core/agent-roles/agents/role-table_test.ts`
  - `packages/core/agent-roles/agents/operator-directory.ts`
  - `packages/core/agent-roles/agents/ensure.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(harness와 lophn domain 절), `project-docs/architecture/agent-definition.md`
  - 이슈: `project-docs/issues/layers.md`(첫 절 "harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 본보기: 지난 계획이 같은 일을 나눈 방식은 `project-docs/products/change-log/0.2.0.md`의 "lophn-agent를 harness, role 층, domain tool로 나눔"(role 층이 값·규칙을 갖고 harness는 조립이 넘긴 것으로 돈다. `main/daemon/wiring/lophn-agent-team.ts`가 꽂는다)
  - 지금 코드(열어서 확인함):
    - `names.ts`: `BUILTIN_NAMES`, `isReservedAgentName`(`definition-file.ts`의 이름 검사가 씀)
    - `builtin.ts`: `DEFAULT_PROFILES`
    - `store.ts`: `BUILTIN_FILES`, `placeAgentsFolder`, role별 `slotOf`. `createAgentStore`·`dataRootOf`는 role을 모른다. `dataRootOf`는 `run-loop/commands.ts`, `instructions/files.ts`, `register.ts`, `main/daemon/wiring/lophn-agent-registration.ts`도 쓰므로 harness에 남긴다.
    - `inspect.ts`: `loadAgent`의 role별 place 계산, `findOperator`·`listOperators`가 만드는 `{ role: "operator", agent }`, `nameOf`·`profileOf`
    - `reads.ts`: 목록 순서(lophn, 그 다음 place마다 Project Manager 또는 App Engineer, 끝에 Operator), `kind: operator ? "operator" : "built_in"`
    - `commands.ts`(Operator ref 만들기), `definition-file.ts`(145줄, `target.role === "operator"`), `validate.ts`(`role: "operator"`, `Exclude<Role, "operator">`), `profile-asset.ts`(188줄, Operator만 profile 이미지)
    - `register.ts`의 `operatorDirectory`(600~650줄 근처. `loaded.ref.role === "operator"`와 ref 만들기)
    - `agent-roles/agents/ensure.ts`(harness `slotOf`를 씀)
- 계약:
  - 쓰는 것: `role-rules-turn-agent`가 만든 `AgentRoleTable`(`isOperator`, `builtinName`, `defaultProfile`, `contextsOf`)과 `ROLE_TABLE`. `role-rules-data-folder`의 `placeAgentsFolder`, `lophnAgentsFolder`.
  - 내놓는 것: `AgentRoleTable`에 정의 file 쪽 멤버를 더한다(이름은 이 task가 바꿔도 되나 `role-rules-instructions`가 `slotOf`를 기대한다. 바꾸면 보고의 "정한 것"에 쓴다).
    - `slotOf(root: string, ref: AgentRef, operatorPlace?: Place): AgentSlot | null`(지금 `store.ts`의 `slotOf`와 같은 결과)
    - `placeOfRef(ref: AgentRef): Place | null | undefined`(Project Manager·App Engineer는 ref의 place, lophn은 null, Operator는 ref에 place가 없어 undefined)
    - `builtinRefs(places: readonly Place[]): AgentRef[]`(목록 순서: lophn, 그 다음 place마다 하나)
    - `operatorRef(id: string): AgentRef`
    - `kindOf(role: Role): AgentDefinitionRow["kind"]`(type은 protocol의 것을 쓴다. harness file에 리터럴을 쓰지 않는다)
    - `isReservedName(name: string): boolean`
    - `agent-roles/agents/operator-directory.ts`: `OperatorDirectory`(type은 `lophn-agent/places/ports.ts`)를 만드는 함수. harness `createLophnAgent`는 `operatorDirectory` 대신 sql로 `AgentContext`를 여는 길을 내놓고 team file이 둘을 잇는다.

## 지켜야 할 것(계획 README, 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

그 밖에: harness 폴더의 비운 file에는 role 이름 문자열 리터럴(`"project_manager"`, `"app_engineer"`, `"operator"`; `tools/check-deps.ts`의 `ROLE_NAMES`)이 type 자리(`Exclude<Role, "operator">` 같은 것)까지 한 줄도 남으면 안 된다. 판정은 role 표가 함수로 내놓는다(`isOperator(role)` 꼴). `tools/check-deps.ts`는 이 task가 비운 file의 `HARNESS_LEFTOVERS` 항목만 지운다. 다른 task도 다른 줄을 고치므로 소유 줄에 두지 않았다(겹치면 lead가 rebase에서 두 쪽을 다 남긴다). 항목을 안 지우면 check가 "목록에서 빼라"고 실패한다.

## 할 일

1. `agents/role-table.ts`의 `AgentRoleTable`에 위 멤버를 더하고 `agent-roles/agents/role-table.ts`의 `ROLE_TABLE`을 채운다. `agents/store.ts`·`names.ts`·`builtin.ts`의 role별 값(`BUILTIN_FILES`, 폴더 배치, `BUILTIN_NAMES`, `DEFAULT_PROFILES`)을 옮기고 폴더 계산은 `role-rules-data-folder`의 함수를 쓴다(근거: `layers.md` 이슈 "사본이 하나로 모인다").
2. `agents/store.ts`에서 `slotOf`·`placeAgentsFolder`·`BUILTIN_FILES`를 지운다. `createAgentStore`는 `operatorIds(place)`가 agents 폴더를 알아야 하므로 폴더 계산 함수를 인자로 받게 하거나 `slotOf` 결과의 `folder`를 쓰게 바꾼다(가장 단순한 쪽).
3. `agents/ports.ts`의 `AgentDeps`에 `roles: AgentRoleTable`을 더한다. `inspect.ts`, `reads.ts`, `commands.ts`, `validate.ts`, `definition-file.ts`, `profile-asset.ts`, `caller.ts`는 role 이름 대신 `deps.roles`(또는 `AgentContext`에 실어 둔 표)를 쓴다. `Exclude<Role, "operator">` 같은 type 자리 리터럴도 지운다(protocol에 built-in role type이 필요하면 `Role`에서 표가 내놓는 멤버로 대신한다. protocol은 바꾸지 않는다).
4. `agents/names.ts`, `agents/builtin.ts`를 지우고 `agents/mod.ts`의 export를 맞춘다. `resolve.ts`·`layers.ts`는 `role-rules-turn-agent`에서 이미 표를 쓴다.
5. `register.ts`: `createLophnAgent` ports에 `roles: AgentRoleTable`을 받아 `agentDeps`에 넣는다. `operatorDirectory`를 지우고 대신 `openAgents(sql)`(sql로 `AgentContext`를 열어 `loadAgent`·`listOperators`를 부를 수 있는 것)을 내놓는다. `agent-roles/agents/operator-directory.ts`가 그것으로 `OperatorDirectory`를 만든다.
6. `main/daemon/wiring/lophn-agent-team.ts`: `roles: ROLE_TABLE`을 꽂고 `operatorDirectory`를 agent-roles 것으로 다시 내보낸다(이름과 시그니처 `(sql) => OperatorDirectory`는 `wiring/lophn-agent-registration.ts`가 쓰므로 그대로).
7. `agent-roles/agents/ensure.ts`는 harness `slotOf` 대신 표의 `slotOf`를 쓴다.
8. `commands_test.ts`, `caller_test.ts`를 새 입력에 맞춘다.
9. `agent-roles/agents/role-table_test.ts`에 표 test 하나: 4개 role × (정의 file 자리, built-in 이름)이 지금 값 그대로다(`slotOf` 결과 folder·file 문자열).
10. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`에서 `agents/commands.ts`, `definition-file.ts`, `inspect.ts`, `names.ts`, `profile-asset.ts`, `reads.ts`, `store.ts`, `validate.ts`, `register.ts` 항목을 지운다(`names.ts`는 file이 없어지므로 항목도 없어진다).

## 끝남

- `deno task check`가 통과한다.
- 동작을 바꾸지 않는다: role 4개(lophn, project_manager, app_engineer, operator)의 tool 목록·prompt bytes·정의 file 자리를 전후로 비교한다. 이 task가 건드리지 않는 것(tool 목록, prompt)은 소유 file 밖이라 diff에 없음을 보이면 되고, 정의 file 자리와 이름·기본 profile처럼 이 task가 옮기는 값은 옮기기 전 값을 임시 script(commit하지 않는다)로 뽑아 옮긴 뒤 값과 같음을 보인다. 확인은 unit test와 `deno task check`까지다.
- 새 E2E·subprocess·서버 test를 만들지 않는다.
- 위험 test: "role 4개의 정의 file 자리와 built-in 이름이 전과 같다"(`role-table_test.ts`). 자리가 어긋나면 사람이 만든 Operator 정의와 지침이 읽히지 않아 사라진 것처럼 보이므로 둔다. 기존 `commands_test.ts`(Operator만 사람이 만들고 지운다, 옛 hash는 충돌)와 `caller_test.ts`(agent는 자기 place만)는 새 입력에 맞춰 살린다.
- 남지 않음: `grep -rn "BUILTIN_NAMES\|DEFAULT_PROFILES\|isReservedAgentName\|placeAgentsFolder" packages --include=*.ts`가 `agent-roles/`(옮긴 자리) 밖에서 0줄이다. 같은 grep을 `packages/core/lophn-agent`에 하면 0줄이다. `grep -n "project_manager\|app_engineer\|\"operator\"" packages/core/lophn-agent/agents/*.ts packages/core/lophn-agent/register.ts`가 `_test.ts`를 빼고 0줄이다. `HARNESS_LEFTOVERS`에 위 9개 줄이 없다.

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

