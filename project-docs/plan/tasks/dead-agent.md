# dead-agent

lophn-agent에서 반쯤 만들고 안 쓰는 길 셋을 지운다: deferred tool(`tool.search` 포함), App Engineer의 active context 읽기, 되살리기(`unarchiveSession`) route.

- 단위: dead (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/skill.ts`, `packages/core/lophn-agent/tools/tool-context.ts`
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`, `packages/core/lophn-agent/prompt-assembly/model.ts`
  - `packages/protocol/lophn-agent/tool-catalog.ts`
  - `packages/core/lophn-agent/agents/layers.ts`, `packages/core/lophn-agent/agents/resolve.ts`, `packages/core/lophn-agent/agents/ports.ts`, `packages/core/lophn-agent/agents/reads.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/protocol/lophn-agent/sessions.ts`, `packages/protocol/lophn-agent/registry.ts`
- 읽을 것:
  - issues: `project-docs/issues/agent-definition.md`의 "deferred tool을 아무 tool에도 켜지 않는다"와 "App Engineer의 active context 읽기가 쓰이지 않는다", `project-docs/issues/place-session.md`의 "session 되살리기(unarchive) route에 handler가 없다". 셋 다 정한 것이 "지운다"다.
  - architecture: `project-docs/architecture/agent-definition.md`, `project-docs/architecture/place-session.md`(되살리기는 지금 없다고 이미 적혀 있다). 문서는 lead가 고친다.
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/protocol`
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/tool-catalog.ts`(builtin tool 이름 목록 `COMMON_TOOLS`와 `TOOL_INPUTS`), `packages/protocol/lophn-agent/sessions.ts`의 `SESSION_COMMANDS`.
  - 바꾸는 것: 계약을 지운다. `tool.search` tool 이름과 입력 schema, `unarchiveSession` command와 그 input·compare schema. 쓰는 쪽은 모두 이 task의 소유에 넣었다(아래 할 일). 새로 더하는 계약은 없다.
  - 내놓는 것: 없음.
- 정한 것: `tool.search`가 안 쓰이면 prompt의 system 층 `tools`(deferredBlock이 유일한 내용)도 쓸 곳이 없다. `model.ts`의 `TurnLayerKind`에서 `"tools"`를 지운다. `AgentLookups.activeContexts`는 App Engineer 분기가 없어지면 `role` 인자가 필요 없다. `(place)` 한 인자로 줄이고 호출처(`agents/reads.ts`, `register.ts`)를 맞춘다.

## 할 일

### 1. deferred tool 지우기 (agent-definition.md 이슈의 (a))

1. `packages/core/lophn-agent/tools/bundles/skill.ts`: `SKILL_TOOLS`에서 `tool.search` 정의를 지운다. `skill.read`만 남긴다. 안 쓰게 된 import(`inputJsonSchema` 등)를 지운다.
2. `packages/protocol/lophn-agent/tool-catalog.ts`: `COMMON_TOOLS`에서 `"tool.search"`와 `TOOL_INPUTS`의 `"tool.search"` 칸(주석 "정본 이름 1~20개." 포함)을 지운다. 이 file의 outline 쪽은 건드리지 않는다(다른 task `dead-contexts`가 이 task 뒤에 고친다).
3. `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`: `TurnTool` type(`deferred?`)을 지우고 `TurnPromptInput.tools`를 `readonly PromptTool[]`로 한다. `deferredBlock`을 지운다. `texts`에서 `["tools", ...]` 줄을 지우고 `tools` 거르기의 `.filter((t) => t.deferred !== true)`를 지운다. `toWireToolName` import가 `wire()`에서 아직 쓰이는지 본다.
4. `packages/core/lophn-agent/prompt-assembly/model.ts`: `TurnLayerKind`에서 `"tools"`와 이를 가리키는 주석("순서대로 role, tools, instructions, ...")을 고친다.
5. `packages/core/lophn-agent/tools/tool-context.ts`: `listed` 칸 주석의 "tool.search가 읽는다"를 지운다. `listed` 칸 자체는 `tools/work.ts`와 `run-loop`가 쓰므로 남긴다.

### 2. App Engineer active context 읽기 지우기 (agent-definition.md 이슈의 (a))

6. `packages/core/lophn-agent/agents/layers.ts`: `activeContexts`에서 App Engineer 분기(`role === "app_engineer" ? { app: place.id }`)를 지운다. project place만 `{ project: place.id }`로 읽고 그 밖에는 `ok([])`다. 인자 `role`과 안 쓰는 import(`Role`)를 지우고, 함수 위 주석과 파일 머리 주석("place의 active context")에서 App Engineer 말을 뺀다. 호출(`resolveTurnAgent`)을 맞춘다.
7. `packages/core/lophn-agent/agents/resolve.ts`: `else if (role !== "lophn") { contexts = [...environment.active_contexts]; }`를 `else if (role === "project_manager")`로 고친다. `ResolveEnvironment.active_contexts` 주석에서 "App Engineer는 그 앱을 읽는 것이다"를 뺀다.
8. `packages/core/lophn-agent/agents/ports.ts`: `AgentLookups.activeContexts(place, role)`를 `activeContexts(place)`로 줄이고 주석에서 App Engineer 말을 뺀다.
9. `packages/core/lophn-agent/agents/reads.ts`: `lookups.activeContexts(loaded.place, loaded.role)`를 `(loaded.place)`로 맞춘다. (Operator의 contexts 수만 센다.)
10. `packages/core/lophn-agent/register.ts`: `activeContexts: (place, role) => ...`에서 `role === "app_engineer"`의 `context_app_data` join 분기(SQL 포함)와 그 주석을 지우고 인자를 `(place)`로 줄인다. project place는 그대로다. 테스트 쪽 가짜(`agents/commands_test.ts`의 `activeContexts: () => []`)는 인자 수가 안 맞아도 컴파일되므로 고치지 않는다.

### 3. unarchiveSession 지우기 (place-session.md 이슈의 A)

11. `packages/protocol/lophn-agent/sessions.ts`: `unarchiveSessionInputSchema`, `unarchiveSessionCompareSchema`, `export const unarchiveSession`, `SESSION_COMMANDS`의 `unarchiveSession` 줄을 지운다. `archiveSession*`과 `stateSeqCompareSchema`는 남긴다.
12. `packages/protocol/lophn-agent/registry.ts`: `unarchiveSession` import와 `ROUTES`를 거르는 목록의 `unarchiveSession` 줄을 지운다. (이미 거르던 줄이라 route는 등록돼 있지 않았다. 거르는 목록의 나머지 `openSession`, `sessionList`, `closeSession`은 이 task의 일이 아니다.)
13. 쓰는 쪽: `unarchiveSession`을 부르는 곳은 코드에 없다(shell UI, core handler, wording, boundary-catalog 모두 확인했다). 다시 `grep`으로 확인하고 있으면 같이 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우는 일이고 `tool-catalog_test.ts`가 이름 충돌을 이미 본다.
- 남지 않음:
  - `grep -rn "tool\.search\|deferredBlock\|t\.deferred\|deferred?:" packages/core/lophn-agent/prompt-assembly packages/core/lophn-agent/tools/bundles packages/core/lophn-agent/tools/tool-context.ts packages/protocol/lophn-agent/tool-catalog.ts`가 0줄이다. (`tools/questions`와 `decision-values.ts`의 `deferred`는 질문을 닫는 이유라 다른 것이다. 지우지 않는다.)
  - `grep -rn "unarchiveSession" packages tools --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist`가 0줄이다.
  - `grep -n "app_engineer" packages/core/lophn-agent/agents/layers.ts packages/core/lophn-agent/register.ts`가 0줄이다.
  - `grep -rn "activeContexts" packages --include=*.ts --exclude-dir=node_modules --exclude-dir=dist`의 모든 호출이 인자 하나다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(지우기만이다)
- 안 쓰게 된 export: `tools/domain/result.ts` 등에서 이 task로 쓰는 곳이 없어진 것이 있으면 적는다. 남이 쓰던 것은 지우지 않는다.
- 정한 것: 위 "정한 것"에서 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
