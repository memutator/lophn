# role-rules-session-places

session 표의 행과 `AgentRef`를 오가는 변환(`session/model.ts`)과 session을 열고 Router에 이름을 푸는 길(`places/directory.ts`, `places/lifecycle.ts`)에서 role 이름을 걷어낸다. 행 변환과 "같은 agent인가" 조건은 `AgentRef`와 `Role`만 다루는 순수 함수라 여러 harness file(`session/{reads,fork,commands}.ts`, `commands/reads.ts`, `agents/caller.ts`, `places/*`)이 직접 import한다. 표 인자를 이 모두에 끌고 다니지 않도록, role과 ref의 짝을 이미 갖고 있는 `packages/protocol/lophn-agent/places.ts`(`ROLE_PLACES`, `rolePlaceFits`, `agentRefSchema`)에 그 변환을 더한다. 이름 풀기와 이름으로 agent 고르기(project·앱·Operator 조회가 섞인 규칙)는 `agent-roles`로 옮겨 `PlaceDeps`로 꽂는다.

- 단위: role-rules (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/places.ts`
  - `packages/core/lophn-agent/session/model.ts`
  - `packages/core/lophn-agent/places/directory.ts`
  - `packages/core/lophn-agent/places/lifecycle.ts`
  - `packages/core/lophn-agent/places/ports.ts`
  - `packages/core/lophn-agent/places/unwired.ts`
  - `packages/core/lophn-agent/places/places_test.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
  - `packages/core/agent-roles/place/session-directory.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(harness와 lophn domain 절), `project-docs/architecture/agent-definition.md`
  - 이슈: `project-docs/issues/layers.md`(첫 절 "harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 본보기: 지난 계획이 같은 일을 나눈 방식은 `project-docs/products/change-log/0.2.0.md`의 "lophn-agent를 harness, role 층, domain tool로 나눔"(role 층이 값·규칙을 갖고 harness는 조립이 넘긴 것으로 돈다. `main/daemon/wiring/lophn-agent-team.ts`가 꽂는다)
  - 지금 코드(열어서 확인함): `session/model.ts`의 `agentRefOf`(213줄 근처)와 `agentClause`(225줄 근처)의 role switch. 같은 file의 DDL 문자열(`role in (...)`, role·place 짝 check)은 template 안이라 check-deps가 보지 않고 schema step이라 건드리지 않는다. `places/directory.ts`의 `nameOf(row)`와 `resolve(named)`(role별 project·앱·Operator 조회), `places/lifecycle.ts`의 `placeOfAgent`(role별 place, Operator는 `deps.operators`로 찾음), `places/ports.ts`의 `PlaceDeps`
  - 설치 자리: `main/daemon/wiring/lophn-agent-registration.ts`의 `installPlaceEnvironment({ deps: (sql) => ({ projects, apps, operators }) })`. `router-registration.ts`는 `placeDepsOf(view.sql)`를 펼쳐 쓰므로 `PlaceDeps`에 칸을 더하면 고치지 않아도 된다.
- 계약:
  - 쓰는 것: `ROLES`, `Role`, `Place`, `AgentRef`, `NamedAgent`, `CallAgent`(protocol), `OperatorDirectory`·`PlaceDeps`(`places/ports.ts`)
  - 내놓는 것(protocol에 옆에 더한다. 옛 export를 바꾸지 않는다):
    - `placeOfAgentRef(ref: AgentRef): Place | null | undefined`: Project Manager·App Engineer는 ref의 place, lophn은 null, Operator는 undefined(place는 정의에 있다)
    - `agentRefOfColumns(row: { role: Role; project: string | null; app: string | null; operator: string | null }): AgentRef`
    - `agentIdentityOf(ref: AgentRef): { role: Role; column: "project" | "app" | "operator" | null; value: string | null }`: harness가 `role = ? and <column> = ?` 조건을 만드는 재료. column 이름을 role 이름 없이 다룬다.
    - harness `places/ports.ts`: `PlaceDeps`에 `roles: PlaceRoleRules`. `PlaceRoleRules = { nameOf(ref: AgentRef): string; resolveNamed(named: NamedAgent): Result<CallAgent> }`(`nameOf`와 `resolveNamed`는 `projects`·`apps`·`operators` 조회를 쥔 채로 만든다. 지금 `directory.ts`의 두 함수 본문 그대로). `agent-roles/place/session-directory.ts`가 `PlaceDeps`의 조회 함수를 받아 이것을 만든다.

## 지켜야 할 것(계획 README, 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

그 밖에: harness 폴더의 비운 file에는 role 이름 문자열 리터럴(`"project_manager"`, `"app_engineer"`, `"operator"`; `tools/check-deps.ts`의 `ROLE_NAMES`)이 type 자리(`Exclude<Role, "operator">` 같은 것)까지 한 줄도 남으면 안 된다. 판정은 role 표가 함수로 내놓는다(`isOperator(role)` 꼴). `tools/check-deps.ts`는 이 task가 비운 file의 `HARNESS_LEFTOVERS` 항목만 지운다. 다른 task도 다른 줄을 고치므로 소유 줄에 두지 않았다(겹치면 lead가 rebase에서 두 쪽을 다 남긴다). 항목을 안 지우면 check가 "목록에서 빼라"고 실패한다.

## 할 일

1. `packages/protocol/lophn-agent/places.ts`에 위 세 함수를 더한다. `session/model.ts`의 `agentRefOf`·`agentClause`가 이것을 쓰게 하고 role switch를 지운다(조건 SQL은 `role = ? and project = ?` 꼴의 인자로 바꿔도 되고, 결과 행과 인덱스(`sessions_agent`) 사용은 같아야 한다). DDL 문자열은 건드리지 않는다. protocol은 module barrel `export *`라 `mod.ts`를 고치지 않는다.
2. `places/lifecycle.ts`의 `placeOfAgent`: switch를 `placeOfAgentRef`로 바꾼다. undefined(Operator)일 때만 `deps.operators.operator(...)`로 찾는다. 같은 `rolePlaceFits` 검사와 에러 코드·메시지를 지킨다.
3. `places/directory.ts`: `nameOf(row)`와 `resolve(named)`를 `deps.roles.nameOf`·`deps.roles.resolveNamed`로 바꾼다. 본문은 `agent-roles/place/session-directory.ts`로 옮긴다(에러 code·message 그대로).
4. `places/ports.ts`·`places/unwired.ts`의 `PlaceDeps`에 `roles`를 더한다(unwired는 "아무것도 못 찾는" 값).
5. `main/daemon/wiring/lophn-agent-registration.ts`: `installPlaceEnvironment`의 deps에 `roles: createPlaceRoleRules({ projects, apps, operators })`를 넣는다.
6. `places/places_test.ts`를 새 `PlaceDeps`에 맞춘다. 새 test는 쓰지 않는다(기존 "role과 place가 맞지 않는 session은 열리지 않는다"가 `lifecycle` 길을 본다).
7. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`에서 `places/directory.ts`, `places/lifecycle.ts`, `session/model.ts` 항목을 지운다.

## 끝남

- `deno task check`가 통과한다.
- 동작을 바꾸지 않는다: role 4개(lophn, project_manager, app_engineer, operator)의 tool 목록·prompt bytes·정의 file 자리를 전후로 비교한다. 이 task가 건드리지 않는 것(tool 목록, prompt)은 소유 file 밖이라 diff에 없음을 보이면 되고, 정의 file 자리와 이름·기본 profile처럼 이 task가 옮기는 값은 옮기기 전 값을 임시 script(commit하지 않는다)로 뽑아 옮긴 뒤 값과 같음을 보인다. 확인은 unit test와 `deno task check`까지다.
- 새 E2E·subprocess·서버 test를 만들지 않는다.
- 위험 test: 없음(기존 `places_test.ts`가 "role과 place가 맞지 않는 session은 열리지 않는다", "archive한 session은 입력을 받지 않는다"를 지키고, 이 task는 그 입력만 맞춘다. `agentClause`의 조건이 달라져 다른 agent의 session을 열면 곤란하므로 `openOf`가 같은 agent의 열린 session을 고르는지는 `places_test.ts`에 이미 있는 경로로 본다. 없으면 표 test 한 줄을 더한다).
- 남지 않음: `grep -n "project_manager\|app_engineer\|\"operator\"" packages/core/lophn-agent/session/model.ts packages/core/lophn-agent/places/directory.ts packages/core/lophn-agent/places/lifecycle.ts`가 DDL template 문자열 줄을 빼고 0줄이다. `HARNESS_LEFTOVERS`에 세 file 줄이 없다.

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

