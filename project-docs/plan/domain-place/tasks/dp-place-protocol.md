# dp-place-protocol

wave 2의 마지막 cleanup이다. 앞 task들이 앱 place와 `app_engineer`를 쓰는 곳을 모두 지웠으니 protocol의 합집합에서 앱 갈래와 `app_engineer`를 지우고, type 때문에 남겨 둔 `Record<Role, …>`의 빈 `app_engineer` 항목과 `switch` 갈래를 걷는다. 이 task가 끝나면 코드 전체에서 `Place`는 project 하나이고 `Role`은 lophn, project_manager, operator 셋이다.

- 단위: place-core (wave 3)
- 선행: dp-agents-core, dp-place-events, dp-agent-roles-scope, dp-agent-roles-prompt, dp-operator-skills, dp-storage-apps, dp-problems-core, dp-shell-app-space, dp-shell-agents, dp-shell-launcher, dp-coding-text, dp-eval. 모든 쓰는 곳이 앱 갈래를 버린 뒤에만 합집합을 줄일 수 있다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/places.ts`
  - `packages/protocol/lophn-agent/scope.ts`
  - `packages/protocol/lophn-agent/agent-values.ts`
  - `packages/protocol/lophn-agent/agent-definitions.ts`
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/lophn-agent/operators.ts`
  - `packages/protocol/lophn-agent/sessions.ts`
  - `packages/protocol/apps/annotation.ts`
  - `packages/protocol/apps/package-routes.ts`
  - `packages/protocol/apps/apps.ts`
  - `packages/protocol/server/identity.ts`
  - `packages/protocol/problems/problem-views.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/commands.ts`
  - `packages/core/agent-roles/agents/role-table.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/place/place-info.ts`
  - `packages/core/agent-roles/place/session-directory.ts`
  - `packages/core/agent-roles/tools/context.ts`
  - `packages/core/agent-roles/tools/context/`
  - `packages/core/lophn-agent/commands/registry.ts`
- 추가 소유(lead가 더함. 앞 task가 "넘길 줄"로 남긴 `app_engineer`·앱 place 갈래와 App Engineer 문구의 그 줄만):
  - `packages/core/lophn-agent/tools/call/target.ts`
  - `packages/core/lophn-agent/session/model.ts`
  - `packages/core/lophn-agent/places/lifecycle.ts`
  - `packages/core/lophn-agent/extensions/skill-read.ts`
  - `packages/core/lophn-agent/tools/app-public.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/apps/registration/commands.ts`
  - `packages/core/apps/blueprint/reads_test.ts`
  - `packages/core/approvals/grants/reads.ts`
  - `packages/core/main/daemon/wiring/apps-usage.ts`
  - `packages/core/agent-roles/place/place-folders.ts`
  - `packages/core/agent-roles/place/data-folder.ts`
  - `packages/core/agent-roles/place/instruction-rules.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/shell/renderer/desktop/connection/waiting/cards/head.tsx`
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/core-source.ts`
  - `packages/shell/renderer/app-frame/agent-select.tsx`
  - `packages/shell/renderer/app-frame/annotate/annotation-panel.tsx`
  - `tests/eval/types.ts`
  - `tests/eval/checks/calls.ts`
  - `tests/e2e/`
  - `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`, `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `agents`, `project-docs/module-catalog.yaml`의 `packages/protocol`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > place"
- 계약:
  - 쓰는 것: 앞 task들의 결과(앱 갈래 없음)
  - 내놓는 것:
    - `ROLES = ["lophn", "project_manager", "operator"]`, `Place = { kind: "project"; id: Id<"prj"> }`(`placeSchema`·`placeOutputSchema`는 단일 object), `agentRefSchema`에 `app_engineer`가 없다. `rolePlaceFits`: lophn은 place 없음, PM과 Operator는 project.
    - `agentPlaceSchema`(정의와 설정이 놓이는 자리)는 project 하나다. `app_reads` 칸(앱 Operator가 읽을 (앱, command) 쌍. 쓰는 곳 없음)은 지운다.
    - `CallAgent`의 `coding_agent` 가지(`{ role: "coding_agent", app }`)와 `NamedAgent.place`의 `{ app }`는 coding agent 이름 풀기에만 남는다.

## 할 일

1. `places.ts`: `ROLES`에서 `app_engineer`를 지우고 `placeSchema`·`placeOutputSchema`를 project 하나로, `ROLE_PLACES`(25째 줄)·`agentRefSchema`·`agentRefOutputSchema`·`placeOfAgentRef`·`agentRefOfColumns`·`agentIdentityOf`(`column`에서 `"app"` 제거)를 맞춘다. session 표의 `app` 열은 `dp-agents-core`가 지웠으니 `agentRefOfColumns`의 입력에서 `app`을 뺀다.
2. `scope.ts`: `AGENT_ROLES`에서 `app_engineer`, `workPlaceBranches`·`workPlaceOutputBranches`의 app 갈래, `scopeShape`의 `app_engineer` 분기를 지운다(쓰는 곳은 `sessions.ts`의 `work_place`, `traces.ts`의 `agentRoleSchema`뿐이다). `sessions.ts`의 주석(98~99째 줄 "AE=담당 app … lophn=project/app")을 맞춘다.
3. `agent-values.ts`: `agentPlaceSchema`·`agentPlaceOutputSchema`(40~46째 줄)를 project 하나로, `appReadFields`~`appReadsOutputSchema`와 `frontmatterFields`·`frontmatterOutputFields`의 `app_reads`, 주석(49, 178~179째 줄)을 지운다. `BUILTIN_ROLE_NAMES`(240째 줄)에서 `app_engineer`를 지운다. `agent-definitions.ts`(49째 줄 `builtinAgentRefBranches`, 38, 114째 줄 주석), `operators.ts`(38째 줄 주석), `calls.ts`(`namedAgentSchema.place`의 `{ app }`가 coding agent 전용임을 주석으로 적는다)를 맞춘다.
4. 주석만 남은 곳: `packages/protocol/apps/{annotation.ts(122~124째 줄), package-routes.ts(65, 101째 줄), apps.ts(94째 줄)}`, `packages/protocol/server/identity.ts`(54째 줄), `packages/protocol/problems/problem-views.ts`(198째 줄)의 App Engineer를 Project Manager로.
5. type 때문에 남겨 둔 `app_engineer`를 걷는다. 컴파일러가 알려 준다: `packages/core/agent-roles/{tool-lists.ts(`ROLE_WRITE_TOOLS`), commands.ts(`ROLE_COMMANDS`), agents/role-table.ts(`PROFILES`, `slotOf`), place/place-data.ts(`ROLE_LINE`), place/place-info.ts(`ROLE_LABEL`, 73째 줄), place/session-directory.ts}`, `packages/core/lophn-agent/commands/registry.ts`의 `RoleCommands`, `packages/core/agent-roles/tools/context.ts`·`packages/core/agent-roles/tools/context/visible.ts`(앱 place 갈래. `domain-kinds`가 이미 지웠으면 할 일이 없다. 아직 있으면 앱 갈래만 걷는다).
6. 마지막으로 전체를 훑는다: 아래 "남지 않음"이 0이 되도록 소유 밖에 남은 곳은 고치지 말고 보고에 적는다(lead가 합칠 때 정리한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음:
  - `grep -rn "app_engineer" packages tools tests --include=*.ts --include=*.tsx | grep -v "tests/eval/runs/\|tests/eval/registry/\|tests/eval/experiments/\|tests/eval/scorecards/"`가 0줄이다.
  - `grep -rn "App Engineer" packages tools --include=*.ts --include=*.tsx --include=*.md` 가 `packages/core/projects/contexts/`(`domain-kinds`가 지운다)를 뺀 곳에서 0줄이다.
  - `grep -rn 'kind: z.literal("app")' packages/protocol/lophn-agent`가 0줄이다.
  - `grep -rn "skills_off" packages/protocol/lophn-agent/agent-values.ts packages/protocol/lophn-agent/operators.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄: 소유 밖에 남은 `app_engineer`·`App Engineer` 줄(file:줄)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

## lead가 더함

- 이 task는 계획 맨 끝으로 옮겼다(wave 3). 앞 task가 모두 merge됐고, domain-kinds가 context를 지운 main 위에 있다. `packages/core/agent-roles/tools/context.ts`·`tools/context/`는 이미 없으면 건너뛴다.
- 앞 task가 넘긴 줄(type 때문에 남긴 갈래):
  - lophn-agent: `tools/call/target.ts`의 `default: return null` 갈래, `session/model.ts`의 `agentRefOfColumns({ ...row, app: null })`, `places/lifecycle.ts`의 project 아닌 place를 없는 곳으로 보는 줄, `extensions/skill-read.ts`의 `place` type, `tools/app-public.ts` `callerProject`의 앱 place 갈래.
  - core: `approvals/grants/reads.ts`의 `app: null`, `wiring/apps-usage.ts` `agentProject`의 default 갈래, `apps/agent-tools/app.ts`의 `ctx.place.kind === "project" ? … : …` 식, `agent-roles` 안의 `app_engineer` 빈 항목(`tool-lists.ts`, `role-table.ts`의 `PROFILES`·`slotOf`, `session-directory.ts`, `commands.ts`, `place-info.ts`의 `ROLE_LABEL`, `place-data.ts`의 `ROLE_LINE`·`labelOf`), `place-folders.ts` `PlaceFacts.place`의 `"app"`, `data-folder.ts`·`instruction-rules.ts`의 앱 갈래.
  - shell: `agent-tab-core-source-sessions.ts`의 `case "app_engineer"`, `sender-chip.tsx`, `waiting/cards/head.tsx`·`waiting/model.ts`의 `app_engineer` 항목, `workspace/agents/source.ts`의 `AgentRole = Exclude<Role, "app_engineer">`와 `core-source.ts` `toRow`의 cast, `app-frame/agent-select.tsx`의 role type.
  - tests: `tests/eval/types.ts`의 `Exclude<Role, "app_engineer">`, `tests/eval/checks/calls.ts` `targetKey`의 빈 갈래.
- App Engineer 문구가 남은 주석과 오류 문구: `apps/registration/commands.ts`(source 연결은 그 project의 Project Manager), `apps/blueprint/reads_test.ts`(test 이름과 주석), `app-frame/annotate/annotation-panel.tsx`. `tools/check-deps.ts`의 `ROLE_NAMES`에서 `app_engineer`를 뺀다.
- `kind: "app"`이 앱을 부르는 대상(call target, caller, invocation)이면 앱 place가 아니라 그대로 둔다. `Place` 합집합을 줄이면 compiler가 앱 place 갈래만 짚는다.
- `tests/e2e`: 돌리지 않는다. type이 막는 곳만 입력 모양을 기계적으로 고친다(`app_engineer` → 그 앱 project의 `project_manager`). 기능이 통째로 사라진 test는 지운다.
- 그대로 두는 것: eval 자료 `tests/eval/materials/*/1/files/source/AGENTS.md.tmpl`(판을 올려야 바뀐다), `tests/eval/experiments/*/report.md`(지난 기록).
- 끝: `grep -rn "app_engineer\|App Engineer" packages tests tools --include=*.ts --include=*.tsx`가 위 그대로 두는 것 밖에서 0줄이다.
