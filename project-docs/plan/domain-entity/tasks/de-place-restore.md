# de-place-restore

계획 `domain-place`가 줄인 `Role`·`Place`를 예전 합집합으로 되돌리고(`app_engineer` role, `app` place), lophn-agent harness의 앱 place 갈래(session 표의 `app` 열, 정의 file 자리, call 대상)를 되살린다. 이 task는 타입과 harness만 되돌리는 codemod다. App Engineer의 지침·tool·file 범위·reaction, 앱 저장 자리, `App.project`는 다른 task가 한다(이 task는 그것들이 타입 오류 없이 서 있게 최소로만 맞춘다). 합집합을 넓히면 `Record<Role, …>`와 exhaustive `switch`가 한꺼번에 깨지므로 한 task가 한 번에 type check까지 맞춘다(그래서 codemod다).

- 단위: place-restore (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{places,scope,agent-values,agent-definitions,calls,operators,sessions}.ts`
  - `packages/core/lophn-agent/agents/{commands,commands_test,definition-file,inspect,layers,ports,reads,resolve,resolve_test,validate}.ts`
  - `packages/core/lophn-agent/places/{directory,lifecycle,places_test,ports}.ts`
  - `packages/core/lophn-agent/session/{message-commands,model}.ts`
  - `packages/core/lophn-agent/session/rewind/artifact-writer_test.ts`
  - `packages/core/lophn-agent/commands/registry.ts`
  - `packages/core/lophn-agent/instructions/{files,model,read_test}.ts`
  - `packages/core/lophn-agent/extensions/{mcp-toolkit,project-settings,registry,skill-folders,skill-read,skills}.ts`
  - `packages/core/lophn-agent/tools/{tool-context,registry_test}.ts`
  - `packages/core/lophn-agent/tools/bundles/call.ts`
  - `packages/core/lophn-agent/tools/call/target.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/approvals/grants/{reads,reads_test}.ts`
  - `packages/core/router/{environment,reads}.ts`
  - `packages/core/agent-roles/{commands,credentials,tool-lists}.ts`
  - `packages/core/agent-roles/agents/role-table.ts`
  - `packages/core/agent-roles/place/{data-folder,instruction-rules,place-data,place-folders,place-info,project-layer,session-directory}.ts`
  - `packages/core/agent-roles/tools/{kind,kind_test,operator,operator-place,operator-place_test}.ts`
  - `packages/core/apps/agent-tools/app.ts`
  - `packages/core/apps/annotations/reads.ts`
  - `packages/core/apps/registration/commands.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/daemon/wiring/{apps-usage,instructions-registration,lophn-agent-runtime,lophn-agent-team}.ts`
  - `packages/shell/renderer/app-frame/agent-select.tsx`
  - `packages/shell/renderer/app-frame/annotate/annotation-panel.tsx`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`
  - `packages/shell/renderer/conversation/thread/sender-chip.tsx`
  - `packages/shell/renderer/desktop/connection/events/waiting-store.ts`
  - `packages/shell/renderer/desktop/connection/waiting/{model.ts,cards/head.tsx}`
  - `packages/shell/renderer/workspace/agents/{core-source,source}.ts`
  - `tests/e2e/`
  - `tests/eval/checks/calls.ts`
  - `tests/eval/types.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("지키는 것"의 role·place), `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기", `project-docs/products/roadmap/domain.md`의 "role과 place"
  - 되돌릴 본보기(git): `5d9017800`(protocol 합집합 줄이기), `8836b2caa`(죽은 place 검사 지우기), `9fe28a39b`와 `cce5a1d23`(harness에서 앱 place 지우기), `a66724c30`의 role-table·tool-lists·place-folders 쪽(PM에 합친 App Engineer의 옛 모양은 `a66724c30^`)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것(다른 task가 기대는 모양)
    - `Role`(`packages/protocol/lophn-agent/places.ts`)은 `lophn | project_manager | app_engineer | operator`, `Place`는 `{kind: "project", id: prj} | {kind: "app", id: app}`다. `ROLE_PLACES`는 `app_engineer: ["app"]`, `operator: ["project", "app"]`다. `AgentRef`에 `{role: "app_engineer", app}`가 돌아오고 `agentRefOfColumns`·`agentIdentityOf`·`placeOfAgentRef`의 `app` 갈래가 돌아온다. `BUILTIN_ROLE_NAMES.app_engineer`는 "App Engineer"다.
    - `sessions` 표의 `app` 열, `place_kind in ('project','app')`, `role` 검사의 `app_engineer`, 정체성 trigger의 `app` 열이 돌아온다(`packages/core/lophn-agent/session/model.ts`).
    - 앱 place의 정의 file 자리는 `<data>/apps/<app>/agents/`다(`placeDataFolder`·`placeAgentsFolder`).
    - 새 type 칸(값은 임시 기본값으로 채우고 쓰는 일은 다른 task가 한다): `AvailableSkill.domain`·`SkillEntry.domain`(`string | null`, domain 층 skill이 아니면 null), `ResolvedAgent.domains`(`string[]`, 비면 그릇의 전부), `ToolContext.domains`(`readonly string[]`), agent 정의 frontmatter `domains`(optional, Operator 정의에만 있다. 모양은 아래 "정한 것").

## 할 일

1. protocol: `places.ts`의 `ROLES`, `placeSchema`·`placeOutputSchema`(두 갈래 discriminatedUnion), `ROLE_PLACES`, `agentRefSchema`·`agentRefOutputSchema`, `placeOfAgentRef`, `agentRefOfColumns`(row에 `app`), `agentIdentityOf`(column에 `"app"`)를 `5d9017800`의 역으로 되돌린다. `scope.ts`(`AGENT_ROLES`, `workPlaceSchema` 합집합, `scopeShape`의 app_engineer 갈래), `agent-values.ts`(`agentPlaceSchema` 합집합, `BUILTIN_ROLE_NAMES`), `agent-definitions.ts`(`builtinAgentRefBranches`에 app_engineer), `operators.ts`·`calls.ts`·`sessions.ts`는 코드 갈래만 되돌린다. 주석만 바뀐 곳은 건드리지 않아도 된다(각 영역 task가 자기 영역 주석을 고친다).
2. harness 되돌리기: `9fe28a39b`와 `cce5a1d23`을 `packages/core/lophn-agent/**`, `packages/core/approvals/grants/reads*.ts`, `packages/core/main/daemon/wiring/{instructions-registration,lophn-agent-team}.ts`에 역으로 적용한다(`git show <sha> -- <path> | git apply -R --3way`). 그 사이에 land한 다른 계획의 변경(kinds, Operator의 skill 이름 고르기 `skills`, artifact)은 지우지 않는다. 충돌은 새 쪽을 살리고 앱 갈래만 더한다.
   - 예외: 앱 place의 project 지침은 되살리지 않는다. `instructions/files.ts`의 `projectOfApp`와 wiring `instructions-registration.ts`의 `projectOfApp`·`appSourcePath`·`innermostProjectOfPath` import는 되돌리지 않고, 앱 place에서는 `ownProject`가 null을 돌려준다(정한 것: 앱 그릇에는 `LOPHN.md`가 없다).
3. agent-roles·apps·router·shell의 타입 오류: 합집합이 넓어져 깨지는 `Record<Role, …>`, `satisfies Record<Role, …>`, exhaustive `switch`는 `a66724c30^`(PM에 합치기 전)의 모양으로 항목을 되돌린다(`role-table.ts`의 `PROFILES.app_engineer`·`BUILTIN_FILES`·`slotOf`·`builtinRefs`, `tool-lists.ts`의 `ROLE_WRITE_TOOLS.app_engineer`와 `APP_API_TOOLS`를 lophn·app_engineer에, `place-folders.ts`의 앱 갈래, `place-data.ts`의 `ROLE_LINE`, `credentials.ts`의 `agentConditions` app_engineer 갈래, `operator-place.ts`). 이 항목의 정확한 내용(지침, 목록 조정, 범위)은 `de-roles-core`·`de-place-info`가 다시 다듬으므로 여기서는 type check가 서고 옛 동작이 돌아오는 정도면 된다. PM의 새 `conditions.app` 같은 임시 앱 연결은 그대로 둔다.
4. `AvailableSkill`(`packages/core/lophn-agent/agents/resolve.ts`)과 `SkillEntry`(`packages/core/lophn-agent/extensions/skills.ts`)에 `domain: string | null`을, `ResolvedAgent`에 `domains: string[]`을(`RESOLVED_FIELDS`·hash 재료에 `domains`를 더한다. Operator는 정의의 `domains`, 그 밖은 `[]`), `ToolContext`(`packages/core/lophn-agent/tools/tool-context.ts`)에 `domains: readonly string[]`을 더한다. 만드는 곳(`run-loop/prepare.ts`의 ToolContext 조립, skill 발견)은 기본값(`null`, `[]`)으로 채운다. agent 정의 frontmatter에 `domains` 칸을 더한다(`agent-values.ts`의 `frontmatterFields`·`frontmatterOutputFields`, `operators.ts`의 `definitionKeys`). built-in 정의(`builtinKeys`)에는 넣지 않는다.
5. `tests/e2e/`의 type 오류만 기계적으로 고친다. `5d9017800`이 지운 e2e 단계(App Engineer session, 앱 place Operator)는 되살리지 않는다. 타입 때문에 깨지는 줄만 맞춘다.
6. 위험 test: `9fe28a39b`가 지운 `places_test.ts`·`resolve_test.ts`·`registry_test.ts`·`read_test.ts`·`artifact-writer_test.ts`의 앱 place·App Engineer 사례는 그대로 되살린다(session을 role과 맞지 않는 place에 열지 못하게 하는 경계다). 새 test는 쓰지 않는다.

## 정한 것

- Operator의 `domains`는 agent 정의 frontmatter의 id 목록이다. 비면 그릇의 domain 전부다. domain id가 그 Operator의 place 그릇 것인지의 검사는 `de-agents-domains`가 한다.
- `idSchema("dom")`은 같은 wave의 `de-domain-core`가 더한다. 이 task가 먼저 끝나면 `domains`를 `z.array(z.string().min(1))`로 두고(중복은 거절), wave 1이 다 merge된 뒤 lead가 `idSchema("dom")`으로 좁히는 작은 commit을 한다. `de-domain-core`가 먼저 merge됐으면 worker가 바로 `idSchema("dom")`을 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "role과 맞지 않는 place(예: App Engineer를 project에, PM을 app에)에는 session이 열리지 않는다" — 되살린 `places_test.ts`가 보고 통과한다.
- 남지 않음(이 task가 만든 뒤에 있어야 하는 것이 사라지지 않았는지):
  - `grep -rn "app_engineer" packages/protocol/lophn-agent/places.ts packages/core/lophn-agent/session/model.ts`가 1줄 이상이다(되돌렸다).
  - `grep -rn "projectOfApp" packages`가 0줄이다.
  - `grep -rn "TODO\|FIXME" <바꾼 file>`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`tools/check-deps.ts`의 `ROLE_NAMES`는 건드리지 않는다. `app_engineer`가 거기 없어 harness 안의 되살린 줄이 check에 걸리지 않는다)
- 안 쓰게 된 export
- 정한 것: `domains` 칸 모양, 임시 기본값으로 채운 곳
- 넘길 줄: 합집합이 넓어져 임시로 되돌린 `agent-roles`·`apps`·shell 갈래의 file:줄(영역 task가 다듬는다)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
