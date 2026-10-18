# sm-mcp-operator-secret-name

Operator 편집 화면이 정의 층 server의 credential 이름에 Operator id를 넣게 하고(`mcp.<agt id>.<server>`), 저장한 뒤 그 값을 보호 입력으로 받게 한다. 지금 편집 화면은 이름을 `mcp.<project id 또는 global>.<server>`로 만들어 같은 project의 project 층 server, 전역 server, 같은 place의 다른 Operator의 server와 secret 이름을 같이 쓸 수 있다. `mcp.` 값의 목적지는 그 이름을 쓰는 켜진 모든 http server의 origin이라(`mcpSecretDestinations`) 이름이 겹치면 한 server의 secret이 다른 server의 origin으로 갈 수 있다. secret 경계(AGENTS.md "위험")라 고친다.

- 단위: sm-mcp (wave 5)
- 선행: sm-envelope-sites, sm-mcp-operator-runtime
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/core-source.ts`
  - `packages/shell/renderer/workspace/agents/fake-source.ts`
  - `packages/shell/renderer/workspace/agents/editor/agent-editor.tsx`
  - `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`
  - `packages/shell/renderer/workspace/agents/editor/server-form.tsx`
  - `packages/core/lophn-agent/extensions/mcp-server_test.ts`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "agent 정의의 MCP server 층이 type과 정의 file에만 있다"
  - 이름이 만들어지는 곳: `editor/server-form.tsx`의 `serverOf(scope, …)`(`mcp.${scope}.${fields.name}`), 그 `scope`를 넘기는 `editor/definition-form.tsx`의 `<ServerForm scope=…>`(project place면 project id, 아니면 `global`). 전역 server는 `desktop/settings/agents/core-source.ts`의 `createServer`가 같은 form을 `scope="global"`로 쓰고 저장 뒤 `enterSecret`으로 값을 받는다. Operator 편집 화면에는 이 값 받기가 없다.
  - 목적지 규칙(바꾸지 않는다): `packages/core/lophn-agent/extensions/mcp-server.ts`의 `mcpSecretDestinations`, `secret-destinations.ts`
  - 이름 schema: `packages/protocol/lophn-agent/mcp-settings.ts`의 `secretNameSchema.startsWith("mcp.")`(`agt_…`는 허용 문자 `[A-Za-z0-9_.:-]`다)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `desktop/settings/core-call.ts`의 `enterSecret`·`windowSecretInputOpener`(이미 있다. 보호 입력 창 열기만 하고 값은 지나지 않는다)
  - 내놓는 것: 새 Operator도 저장 전에 id를 가진다. `AgentDetail`에 `draftId: string | null`(새 Operator는 `newOperatorId`로 미리 만든 `agt_…`, 저장된 agent는 null), `SaveInput`에 같은 이름의 `draftId`.

## 할 일

1. `workspace/agents/source.ts`: `AgentDetail.draftId`와 `SaveInput.draftId`를 더한다(위 계약).
2. `workspace/agents/core-source.ts`: `newOperator`가 `draftId: newOperatorId(bytes())`를 담아 돌려주고, `saveAgent`의 Operator 만들기가 `id: input.draftId ?? newOperatorId(bytes())`를 쓴다. 저장 성공 뒤, 이번 저장에서 새로 생긴 정의 층 server(저장 전 `detail.definition.mcp_servers`에 없던 이름) 중 `bearer`·`api_key`인 것마다 `enterSecret(openSecret, { name: 그 server의 credential secret, purpose: "mcp", subject: server.name })`를 부른다(`openSecret`은 `deps`로 받고 기본은 `windowSecretInputOpener()`. 창을 열지 못하거나 취소해도 저장은 되돌리지 않는다: 전역 `createServer`와 같다). 값은 이 file을 지나지 않는다.
3. `fake-source.ts`: 가짜 `newOperator`가 `draftId`를 담는다.
4. `editor/agent-editor.tsx`: `saveAgent` 호출에 `draftId: detail.draftId`를 싣는다.
5. `editor/definition-form.tsx`: `<ServerForm scope=…>`의 scope를 이 Operator의 id(`detail.assignment ?? detail.draftId`)로 한다. 내장 role(`builtIn`)의 편집 화면은 `mcp_servers`를 받지 않으므로(`builtinDefinitionSchema`에 칸이 없고 `saveAgent`가 `builtInDefinition`으로 걸러 낸다) MCP 칸의 Add server 단추와 form을 `builtIn`이면 그리지 않는다.
6. `editor/server-form.tsx`: `scope` 주석을 "전역은 `global`, Operator 정의 층은 그 Operator의 `agt_…` id"로 고친다.
7. test 하나를 `mcp-server_test.ts`에 쓴다(아래 끝남).

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test(하나, process 없음): "Operator 정의 층 secret 이름은 그 Operator의 server origin으로만 간다." 같은 server 이름 `docs`를 전역(`mcp.global.docs`), project 층(`mcp.prj_….docs`), Operator A(`mcp.<agt A>.docs`), Operator B(`mcp.<agt B>.docs`)가 각각 다른 http origin으로 가진 서버 목록을 `runtimeServerOfLayer`로 만들어 `mcpSecretDestinations(servers, name)`가 이름마다 자기 origin 하나만 돌려주는지 표로 본다. 새 Operator의 이름 규칙이 깨지면(예: scope로 project id를 다시 쓰면) 같은 이름이 둘이 되어 한 이름이 두 origin을 돌려준다는 점이 test가 지키는 위험이다. 이름 접두를 core가 강제하지는 않는다: 정의를 쓰는 것은 사람뿐이고 project 층도 같은 신뢰다.
- 남지 않음: `grep -rn "mcp\.\${scope}" packages/shell --include=*.tsx --include=*.ts --exclude-dir=dist --exclude-dir=node_modules`의 scope가 전역(`global`)과 Operator id뿐이다(눈으로 확인한다. `desktop/settings/core-source.ts`는 `sm-mcp-settings-path`가 지운다).
- 손으로 확인: `deno task dev`에서 새 Operator를 만들어 bearer server를 더하고 저장하면 보호 입력 창이 `mcp.agt_….<server>` 이름으로 열린다. 내장 role(Project Manager 등)의 편집 화면에는 Add server가 없다.

## 보고

- 바꾼 file, 통과한 check
- 정한 것: 이름 접두는 core가 강제하지 않고 편집 화면이 만든다(위 이유). 새 Operator의 id를 저장 전에 만드는 것은 credential 이름에 id가 먼저 필요해서다.
- 알려진 미완 동작: 기존 정의 file에 `mcp.<project id>.<server>` 이름을 쓴 server가 있으면 그대로 동작한다(이름을 다시 쓰지 않는다. 개발 data는 지우고 새로 만든다).
- 무겁게 짠 것: 없으면 "없음"
