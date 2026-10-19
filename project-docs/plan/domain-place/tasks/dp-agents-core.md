# dp-agents-core

lophn-agent harness에서 앱 place와 `app_engineer`를 쓰는 곳을 지운다. session 표는 project place만, agent 정의 저장소와 지침 읽기는 project 하나만 알게 한다. 이 task는 protocol 합집합(`Place`, `ROLES`)을 아직 바꾸지 않는다(마지막 `dp-place-protocol`이 지운다). 이 task 안의 코드가 앱 place와 `app_engineer`를 더 이상 만들지도 읽지도 않게 하는 것이 일이다.

- 단위: place-core (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/`
  - `packages/core/lophn-agent/places/`
  - `packages/core/lophn-agent/agents/`
  - `packages/core/lophn-agent/instructions/`
  - `packages/core/lophn-agent/commands/`
  - `packages/core/lophn-agent/extensions/`
  - `packages/core/lophn-agent/tools/call/`
  - `packages/core/lophn-agent/tools/bundles/call.ts`
  - `packages/core/lophn-agent/tools/registry_test.ts`
  - `packages/core/lophn-agent/ports.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-session.ts`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("지키는 것"의 role·place), `project-docs/architecture/agent-definition.md`, `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agents`, `agent-sessions`, `router`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > place", `project-docs/products/AGENT-ROLE.md`의 P1~P8, 5.2 표
- 계약:
  - 쓰는 것: `dp-app-project`의 `appOfProject`, `appProjectOf`(`packages/core/apps/lookups.ts`)
  - 내놓는 것: 이 task가 끝나면 lophn-agent 안의 코드가 `place.kind === "app"`, `role === "app_engineer"`, `sessions.app` 열을 쓰지 않는다. coding agent를 받는 `CallAgent`(`{ role: "coding_agent", app }`)와 `NamedAgent.place`의 `{ app }`(coding agent 이름 풀기용)는 그대로 둔다.

## 할 일

1. `packages/core/lophn-agent/session/model.ts`의 sessions 표(48~85째 줄)를 project place만 받게 고친다: role check에서 `app_engineer`, `app` 열, `place_kind in ('project','app')`의 `'app'`, `check (app is …)`, `(role = 'app_engineer' and …)`를 지우고 `sessions_identity_immutable` trigger의 열 목록에서 `app`을 뺀다. `AgentSessionRow`(152~154째 줄)·`SESSION_COLUMNS`·`sessionRowOf`·`agentRefOf`·`placeOf`·`agentClause`에서 app 갈래를 지운다. 개발 data는 새로 만드는 것이 규칙이라 step을 고치고 migration을 만들지 않는다.
2. `packages/core/lophn-agent/places/lifecycle.ts`: `placeUsable`(35째 줄)이 project만 본다. `startSession`의 INSERT(92째 줄)에서 `app` 열을 뺀다. `packages/core/lophn-agent/places/directory.ts`의 `placeArchived`(39째 줄)도 project만 본다. `PlaceDeps.apps`는 coding agent 이름 풀기(`router-registration.ts`의 `resolveAgent`)가 쓰므로 남기되 session 열기와 보관 판정에는 쓰지 않는다.
3. `packages/core/lophn-agent/agents/`와 `register.ts`: 정의 자리 목록(`register.ts`의 `agentLookups.places`, 433~435째 줄)에서 앱을 빼고 `placeExists`(409째 줄)를 project만 본다. `packages/core/lophn-agent/agents/ports.ts`의 `AgentLookups.appExists`·`appIds`와 `PlaceLookups`의 앱 조회를 지운다. `packages/core/lophn-agent/agents/definition-file.ts`(158째 줄)의 `target.place === "app"` 갈래, `packages/core/lophn-agent/agents/commands.ts`·`resolve.ts`·`role-table.ts`의 App Engineer 주석과 `builtinRefs(places)`의 app 갈래를 지운다. 쓰는 곳 `packages/core/main/daemon/wiring/lophn-agent-registration.ts`의 `apps`(`PlaceDeps.apps`는 남는다)와 `lophn-agent-session.ts`를 맞춘다.
4. `packages/core/lophn-agent/tools/call/target.ts`: `named()`(52째 줄)와 `openSession()`(80째 줄)의 `app_engineer` 갈래를 지운다. 이름으로 받는 `coding_agent`는 `{ app: 이름 }`로 앱을 푼다(그대로). `packages/core/lophn-agent/tools/bundles/call.ts` 설명문의 "role is project_manager, app_engineer, operator, lophn or coding_agent; place is {project: name} or {app: name}"을 `app_engineer`가 빠진 문장으로 고친다("{app: name}은 coding_agent에만"). `reply: … conversation (App Engineer and coding agent only)`는 "Project Manager and coding agent only"로 고친다.
5. `packages/core/lophn-agent/instructions/files.ts`: `InstructionReadDeps.projectOfApp`(94째 줄)을 지우고 `ownProject`(101째 줄)가 `place.id`를 그대로 돌려준다. wiring `instructions-registration.ts`의 `projectOfApp`·`appSourcePath` import를 같이 지운다. `read_test.ts`를 맞춘다.
6. `packages/core/lophn-agent/extensions/skill-read.ts`의 `place: { kind: "project" | "app"; … }`(173째 줄), `packages/core/lophn-agent/extensions/` 안의 앱 갈래 주석, `packages/core/lophn-agent/session/caller-directory.ts`의 주석을 맞춘다. 이 task는 `skills_off`를 건드리지 않는다(`dp-operator-skills`가 한다).
7. 시험을 고친다: `packages/core/lophn-agent/places/places_test.ts`, `packages/core/lophn-agent/agents/{resolve,commands,caller,reads}_test.ts`, `packages/core/lophn-agent/tools/registry_test.ts`, `packages/core/lophn-agent/session/*_test.ts`의 App Engineer·앱 place 사례는 지운다(옮겨 살리지 않는다). 위험 test는 새로 쓰지 않는다.
8. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(앱 place·`app_engineer` 사례를 지우는 task다. 새 경계가 없다)
- 남지 않음: 아래가 0줄이다.
  - `grep -rn "app_engineer\|App Engineer" packages/core/lophn-agent`
  - `grep -rn "kind === \"app\"\|kind: \"app\"" packages/core/lophn-agent` (coding agent 대상 `{ role: "coding_agent", app }`는 이 grep에 걸리지 않는다)
  - `grep -n "app" packages/core/lophn-agent/session/model.ts`의 `app text`, `place_kind … 'app'`

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `AgentLookups.appExists`·`appIds` 등. 남이 쓰던 것은 지우지 않고 적는다
- 정한 것: coding agent 이름 풀기에 필요해 `PlaceDeps.apps`는 남겼다 / `NamedAgent.place`의 `{ app }`는 coding agent 전용으로 둔다
- 넘길 줄: `domain-kinds`와 겹친 `packages/core/lophn-agent/agents/*`는 앱 갈래만 고쳤다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
