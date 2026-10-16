# contract-calls-places-places

role과 place 모델, session 수명(열림, archive, 지움), session rewind의 앱 고르기, Operator 정의(만들기·고치기가 받는 값), agent 정의의 grant 이전 칸 정리를 protocol에 새 모양으로 더하고, core lophn-agent의 port를 고정한다. 옛 계약(`assignments.ts`, `scope.ts`의 `AGENT_ROLES`, `sessions.ts`의 `SessionRecord` 등)은 지우지 않고 옆에 새것을 더한다.

- 단위: contract-calls-places (wave 2)
- 선행: 없음. 단 `protocol/base/ids.ts`에 접두사 `agt`(Agent)가 먼저 들어 있어야 한다. lead가 이 task를 띄우기 전에 더해 둔다. 없으면 고치지 말고 멈춰서 보고한다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/places.ts` (새로)
  - `packages/protocol/lophn-agent/agent-sessions.ts` (새로)
  - `packages/protocol/lophn-agent/session-rewinds.ts` (새로)
  - `packages/protocol/lophn-agent/operators.ts` (새로)
  - `packages/protocol/lophn-agent/agent-values.ts` (더하기만. 아래 5번)
  - `packages/core/lophn-agent/ports.ts` (새로. 뒤 task인 contract-calls-places-calls가 call 길 port를 더한다)
- 읽을 것:
  - spec: S8 2·3·4·5·6·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S4 2장(정의의 구성), 4장 `operator.create`·`operator.update`, 11장 13·18 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S3 4장(닫힘의 뜻) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S5 8장(session rewind와 앱 rewind 나누기) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory: `I2.4#1`, `I2.4#38`, `I2.8#5`
  - 요구: req-1526(Operator 만들기·고치기) — `/home/pyosechang/projects/lophn/project-docs/requirements/core-lophn-agent.yaml`
  - 결정: `../README.md` 3장 #18·23·57(`project_manager`, steer, turn)
  - 지금 코드: `packages/protocol/lophn-agent/{scope,assignment-values,assignments,sessions,reverts,agent-values,agents}.ts`, `packages/core/lophn-agent/agents/ports.ts`(port를 어떻게 쓰는지 본보기)
- 계약:
  - 쓰는 것: `protocol/base/{ids,route,envelope,values}`, `protocol/lophn-agent/{models,message-content,run-values의 readCursorSchema·positiveRevisionSchema}`(import만), `protocol/projects`의 `projectIdSchema`·`appIdSchema`
  - 내놓는 것: 아래 "모양". 이 task의 file을 다른 wave 2 task(`contract-calls-places-calls`, `contract-agent-tools`)와 wave 3 router·places-sessions·agent-definition이 import한다.

## 모양

모든 새 이름은 lead가 `packages/protocol/lophn-agent/mod.ts`에 `export *`로 올리므로 옛 export와 이름이 겹치면 안 된다. 겹치면 문서의 말에 뜻을 구별하는 말을 붙여 짓는다(`v2`, `new`, `next` 금지). 아래 이름은 겹치지 않는 것을 확인했다. 쓰기 전에 `grep -rn "export .*<이름>" packages/protocol`로 한 번 더 확인한다.

### `places.ts` (S8 2장)

- `ROLES = ["lophn", "project_manager", "app_engineer", "operator"] as const`, `roleSchema`, `type Role`
- `placeSchema`: `z.discriminatedUnion("kind", [{kind:"project", id: prj}, {kind:"app", id: app}])`와 output 짝(`placeOutputSchema`), `type Place`
- `ROLE_PLACES`: role마다 놓일 수 있는 place 종류. `lophn: []`, `project_manager: ["project"]`, `app_engineer: ["app"]`, `operator: ["project", "app"]`
- `rolePlaceFits(role: Role, place: Place | null): boolean`. 순수 함수. lophn은 place가 null일 때만, 나머지는 `ROLE_PLACES`에 든 종류일 때만 true. session을 열 때와 정의를 만들 때 같은 표를 쓴다(`I2.8#5`, `I3.8#5`).
- `agentRefSchema`(와 output 짝), `type AgentRef`: 받을 agent를 가리키는 값. `z.discriminatedUnion("role", [`
  - `{role:"lophn"}`
  - `{role:"project_manager", project: prj}`
  - `{role:"app_engineer", app: app}`
  - `{role:"operator", agent: agt}`
  - `])`. Project Manager와 App Engineer는 place가 곧 정체성이고 Operator는 자기 ID다(`I2.8#6`의 "agent 식별"). 옛 `asg`를 대신한다.

### `agent-sessions.ts` (S8 3·5장)

- `SESSION_LIFECYCLES = ["open", "archived"] as const`, `sessionLifecycleSchema`. 지움은 상태가 아니라 record가 사라지는 것이다.
- `agentSessionSchema`(output), `type AgentSession`: 칸은 `id: ses`, `agent: AgentRef`, `place: Place | null`(편의 칸. `rolePlaceFits`가 true여야 한다), `title`(옛 `sessionTitleSchema` 재사용), `lifecycle`, `forked_from`(옛 `forkOriginOutputSchema` 재사용), `opening_context`(옛 `openingContextOutputSchema` 재사용), `model_selection`, `compaction`, `state_seq`. 옛 `assignment`, `work_place`, `state: open|closed`, `closed_reason`, `closed_at`은 옮기지 않는다.
- `openAgentSessionInputSchema`: `{id: ses, agent: AgentRef, opening_context}`. compare는 `{}`. 옛 `assignment_revision`·`assignment_state`는 없다.
- `listAgentSessionsInputSchema`: `{agent: AgentRef, archived?: "exclude"|"include"|"only", cursor?}`.
- route 정의: `openAgentSession`(OpenSession), `agentSessionRead`(ReadSession), `agentSessionList`(ListSessions). resource·method·name은 최종 이름을 쓴다(옛 `sessions.ts`와 같다). 옛 route와 이름이 같으므로 `AGENT_SESSION_ROUTES`로 묶기만 하고 `registry.ts`에는 올리지 않는다(등록은 lead가 places-sessions가 merge될 때 바꾼다).
- archive, delete, fork, rename, compact, change model의 input·compare·route는 모양이 그대로이므로 새로 만들지 않는다. 옛 `sessions.ts` 것을 그대로 쓴다. `closeSession`·`unarchiveSession` 계열은 옮기지 않는다(`I1.8#3`·`I1.8#4`는 places-sessions가 core에서 지운다. 옛 protocol 정의는 cleanup이 지운다).

### `session-rewinds.ts` (S8 4장, S5 8장)

- `sessionRewindInputSchema`: 옛 `rewindInputSchema`(`reverts.ts`)에 `apps: z.array(appIdSchema)`(사람이 고른 앱. 비면 앱 data는 그대로)를 더한 것. `choice`는 옛 `REWIND_CHOICES`(`restore_all`, `messages_only`, `summarize`)를 그대로 쓴다. `confirmation`·`binding`·`display_read`는 두지 않는다(확인은 대화 화면 안의 panel이다).
- `sessionRewindCompareSchema`: `{session_state: "open"(lifecycle), active_turn: null, applying_revert: null}`.
- `sessionRewindPreviewOutputSchema`: 옛 preview에 `app_writes: z.array({app: app, invocations: z.array(inv)})`를 더한다. 이 session이 고른 시점 뒤에 앱에 한 write invocation 목록이다(S5가 session·turn별 목록을 준다). 앱 rewind의 계획(함께 되돌아갈 다른 변경, external 효과, 되돌릴 수 없음)은 contract-app-calls가 정하는 앱 rewind 계획 route를 따로 읽어 보이므로 여기서 모양을 만들지 않는다.
- route 정의: `sessionRewind`(Rewind), `sessionRewindPreview`(PreviewRewind). 옛 route와 이름이 같으므로 등록하지 않는다.
- 옮기지 않는 것: `undo`·`redo` 계열(`undoEdit`, `redo`, `REVERT_REDO_STATES`), 앱 단계(`runAppRevert`, `appRevertBindingSchema`, `appStepResultSchema`). S8과 S5에 근거가 없다. 옛 `reverts.ts`는 지우지 않는다.

### `operators.ts` (S4 4장·11장 18, req-1526)

- `operatorDefinitionSchema`(와 output 짝): 옛 `agentFrontmatterSchema`에서 `app_reads`, `safe_tools`, `permissions`를 뺀 칸(`name`, `profile`, `model`, `contexts`, `skills_off`, `mcp_off`)과 `body`(지침). 쓰던 하위 schema는 `agent-values.ts`에서 import한다. grant가 대신하는 칸이므로 새 정의에 두지 않는다.
- `operatorDefinitionPatchSchema`: 위 정의의 모든 칸을 optional로 한 것(`operator.update`용).
- agent grant 칸과 앱 Operator의 project 폴더 칸은 이 정의에 없다. 사람만 정한다(req-1526). 그 칸의 저장과 화면 입력은 `agents.ts`의 사람용 route 몫이므로 여기서 만들지 않고 보고에 적는다.
- tool `operator.create`·`operator.update`의 입력(`place`는 이름, `operator`는 정의 이름)은 contract-agent-tools가 이 두 schema를 합쳐 짓는다. core command의 입력(id 기준)은 agent-definition의 `agents/commands.ts`가 정한다. 이 task는 정의 schema만 내놓는다.

## 할 일

1. `places.ts`를 만든다. 위 "모양"의 이름 그대로. `I2.4#1`: role 값이 `project_manager`이다. 옛 `context_engineer`를 읽는 값은 만들지 않는다.
2. `agent-sessions.ts`를 만든다. 옛 `sessions.ts`의 helper(`sessionTitleSchema`, `forkOriginOutputSchema`, `openingContextOutputSchema`, `compactionOutputSchema`)는 import한다. 같은 것을 복사하지 않는다.
3. `session-rewinds.ts`를 만든다. 옛 `reverts.ts`에서 쓰는 helper(`checkpointFields`, `previewItemSchema`, `preparedFilesSchema` 등)가 export돼 있지 않으면 `reverts.ts`에 `export`만 붙인다(더하기만. 이 file 고치기는 허용한다).
4. `operators.ts`를 만든다.
5. `agent-values.ts`에 더하기만 한다. `I2.4#38`: built-in 이름 목록에 새 이름이 필요하면(`BUILTIN_AGENT_NAMES`에 "Project Manager") 새 상수 `BUILTIN_ROLE_NAMES: Record<Role, string>`를 더한다. 옛 `BUILTIN_AGENT_NAMES`·`isBuiltinAgentName`은 옛 이름을 쓰는 곳이 있으므로 남긴다. 새 상수를 쓰는 `isBuiltinRoleName(name)`(`agentNameKey` 기준으로 대소문자·공백을 같게 본다)을 같이 더한다.
6. `core/lophn-agent/ports.ts`를 만든다(아래 "port"). type-only다. 구현을 넣지 않는다.
7. `packages/protocol/lophn-agent/mod.ts`의 `export *` 줄과 `registry.ts`의 `ROUTES`·`EVENTS`는 lead 몫이다. 고치지 않고 등록할 줄을 보고에 적는다. 같은 package 안의 다른 file은 상대 경로로 직접 import한다.
8. 새 schema가 정말 서로 맞는지 보는 test는 만들지 않는다. type check가 맞게 이어지는지만 본다.

## port: `packages/core/lophn-agent/ports.ts`

lophn-agent가 **바깥에서 받는 것**을 선언한다. 다른 domain module은 직접 import할 수 없으므로(code-map) 이 port를 `main/daemon/wiring`이 구현해 끼운다. 쓰는 곳은 wave 3 places-sessions, router, agent-definition이다. 구현을 넣지 않는다.

```ts
export type ProjectInfo = {
  id: string; name: string; purpose: string; archived: boolean;
  folders: readonly {
    path: string; description: string; found: boolean;
    subfolders: readonly { path: string; description: string }[];
  }[];
};
export interface ProjectDirectory {
  project(id: string): ProjectInfo | null;
  projectByName(name: string): ProjectInfo | null; // 정확히 맞는 이름만
  list(): readonly ProjectInfo[];
  contextsOf(project: string): readonly { id: string; name: string; status: "active" | "archived" | "drafting" }[];
}
export type AppInfo = { id: string; name: string; purpose: string; archived: boolean; sourceFolder: string | null };
export interface AppDirectory {
  app(id: string): AppInfo | null;
  appByName(name: string): AppInfo | null;
  list(): readonly AppInfo[];
}
// session을 지우거나 archive할 때 같은 tx 안에서 부른다.
export interface SessionEndEffects {
  cancelPendingRequests(tx: Tx, session: string): Result<void>; // 대기 권한 요청, 질문 -> cancelled
  forgetSessionGrants(session: string): void;                   // "이 session 동안" 허락
  failReceivedCalls(tx: Tx, session: string): Result<void>;     // 열린 call -> failed(receiver_ended)
}
// session rewind가 앱 rewind와 잇는 길(S5가 준다)
export interface AppWrites {
  writesAfter(session: string, checkpointSeq: string): readonly { app: string; invocation: string }[];
}
```

- `Tx`는 `protocol/server/mod.ts`에서 type으로 import한다(본보기: `core/lophn-agent/agents/ports.ts`).
- `ProjectInfo`의 폴더 칸은 `contract-calls-places-projects`가 정하는 project 읽기 모양을 따른다. 칸 이름이 다르면 그쪽에 맞추고 보고에 적는다.
- port 이름은 위와 다르게 써도 되지만, 바꾸면 보고 "정한 것"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(type과 순수 함수뿐이다. `rolePlaceFits`는 표 한 줄이라 test하지 않는다).
- 남지 않음: 없음(옛 계약은 wave 3 task와 cleanup이 지운다). 새 file에서 `grep -n "context_engineer\|assignment\|work_place" packages/protocol/lophn-agent/{places,agent-sessions,session-rewinds,operators}.ts packages/core/lophn-agent/ports.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/registry.ts`에 올릴 route(`AGENT_SESSION_ROUTES`, `sessionRewind`, `sessionRewindPreview`)는 옛 route와 이름이 같아 places-sessions가 merge될 때 바꿔 끼운다고 적는다. `protocol/base/ids.ts`의 `agt`.
- 안 쓰게 된 export: `AGENT_ROLES`·`agentRoleSchema`(`scope.ts`), `workPlaceSchema`, `assignment*`(`assignments.ts`, `assignment-values.ts`), `sessionRecordSchema`·`SESSION_STATES`·`closeSession`·`unarchiveSession`(`sessions.ts`), `rewindInputSchema`·`undoEdit`·`redo`(`reverts.ts`), `BUILTIN_AGENT_NAMES`
- 정한 것: `AgentRef`의 모양(Operator는 `agt` ID), `undo`·`redo`를 옮기지 않은 것, Operator 정의에서 뺀 칸, port 이름
- 계약 바꾸기 요청: 없음(wave 2)
