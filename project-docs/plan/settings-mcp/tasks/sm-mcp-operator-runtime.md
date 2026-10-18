# sm-mcp-operator-runtime

Operator 정의의 `mcp_servers` 층을 runtime이 실제로 쓰게 한다. turn을 준비할 때 그 Operator의 정의 층을 읽어 연결하고, runtime child의 Deno 권한(`--allow-net`·`--allow-run`)과 `mcp.` secret 목적지에 그 층의 server를 넣고, 정의가 바뀌면 child가 다시 뜨게 한다. 지금은 편집 화면이 정의 file에 server를 저장하지만 runtime은 읽지 않아 조용히 안 쓰인다(`project-docs/issues/agent-definition.md`).

- 단위: sm-mcp (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/agents/layers.ts`
  - `packages/core/lophn-agent/extensions/mcp-toolkit.ts`
  - `packages/core/lophn-agent/extensions/mcp-toolkit_test.ts`
  - `packages/core/lophn-agent/extensions/mcp-snapshot.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-team.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
  - `packages/core/main/daemon/wiring/secrets.ts`
- 읽을 것:
  - issue: `project-docs/issues/agent-definition.md`의 "agent 정의의 MCP server 층이 type과 정의 file에만 있다"(정한 것: 살린다)
  - architecture: `project-docs/architecture/agent-definition.md`(층 규칙: 같은 이름은 마지막 층이 덮는다. 문서 고침은 lead가 끝에 한다), `project-docs/architecture/approval.md`
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`), `packages/core/main`. harness(lophn-agent)는 agent-roles를 import하지 못한다. 둘을 아는 것은 wiring(`main/daemon/wiring`)이다.
  - 본보기: project 층이 이미 가는 길. `extensions/project-servers.ts`(`collectProjectMcpEntries`), `extensions/mcp-snapshot.ts`(`registeredMcpServers`·`mcpServerSnapshot`), `run-loop/runtime.ts`의 poll(`readMcp` → `allowNetList`·`allowRunList` 비교 → `deps.io.updateSpec`)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/operators.ts`의 Operator 정의(`mcp_servers`는 이미 있다), `packages/protocol/lophn-agent/mcp-settings.ts`의 `McpServer`
  - 내놓는 것(`sm-mcp-operator-grants`가 쓴다): `mcp-toolkit.ts`의 `serversOf(place, agent)`가 `agent: { servers, off }`를 받는 현재 모양 그대로. 새 계약을 만들지 않는다.

## 현재 호출 길(확인한 것)

- `run-loop/prepare.ts` `prepare()`가 `resolveTurnAgent(machine, { …, mcp: async (off, place) => { mcp = await loadMcp(start.session, { place, skip: off }) … } })`를 부른다. `loadMcp(session, options: McpSourceOptions)`는 `deps.toolkit.mcp?.(session).source(session, options)`로 간다. `McpSourceOptions`는 `{ place?, skip?, only? }`이고 `agent`가 없다. 정의가 틀리거나 시작할 수 없는 turn의 대비로 `mcp ?? await loadMcp(start.session, { place: agent.place })`도 한 번 더 있다.
- `agents/layers.ts` `resolveTurnAgent`는 정의(`definition`)를 읽고 `serversOff`(`mcp_off` 중 서버 통째)만 `input.mcp(serversOff, place)`로 넘긴다. 정의의 `mcp_servers`는 넘기지 않는다.
- `extensions/mcp-toolkit.ts` `makeToolkit().source(assignment, options?: McpSourceInput)`가 `serversOf(options?.place ?? null, options?.agent)`를 부른다. `McpSourceInput = McpSourceOptions & { agent?: McpAgentLayer }`이고 `agent`를 채워 부르는 곳이 없다(`serversOf`의 agent 층 코드는 이미 있고 죽어 있다).
- `session/compactor.ts`도 `resolveTurnAgent`를 `mcp: () => Promise.resolve([])`로 부른다. 그 file은 계획 `prompt-text`의 소유(`session/**`)라 고치지 않는다. 그래서 `mcp` callback의 시그니처는 인자를 **더하기만** 한다(`(off, place)`를 쓰던 호출은 그대로 컴파일된다).
- runtime child의 권한: `main/daemon/wiring/lophn-agent-runtime.ts`가 `readMcpServers: () => mcpServerSnapshot(ctx.ledgerPath, { projectLayer: PROJECT_LAYER })`를 넘기고, `run-loop/runtime.ts`가 `AGENT_RUNTIME_HOSTS_POLL_MS`마다 읽어 `allowNetList`·`allowRunList`가 달라졌으면 도는 turn이 없을 때 `updateSpec`으로 child를 다시 띄운다. project 층 변경이 지금 이 길로 child를 다시 띄운다. 이 길을 그대로 쓴다. 새 장치를 만들지 않는다.
- `mcp.` secret 목적지: `main/daemon/wiring/secrets.ts`가 같은 `mcpServerSnapshot`을 `createSecretDestinations`에 넘긴다(`lophn-agent/secret-destinations.ts`). 그 snapshot에 정의 층이 없으면 정의 층 server의 bearer·API key 값이 부착되지 않는다.

## 할 일

1. `run-loop/prepare.ts`: `McpSourceOptions`에 `agent?: { servers: readonly McpServer[]; off: readonly string[] }`를 더한다(toolkit이 이 type을 import하므로 여기가 정본이다). `prepare()`의 `mcp` callback이 세 번째 인자 `ownServers`를 받아 `loadMcp(start.session, { place, skip: off, agent: { servers: ownServers, off: [...off] } })`로 넘긴다.
2. `agents/layers.ts`: `input.mcp`의 type을 `mcp(off, place, servers?: readonly McpServer[])`로 더하고, 정의가 Operator 모양이고 `mcp_servers`가 있을 때만 그 값을 세 번째 인자로 넘긴다(`"mcp_servers" in definition`). 다른 role과 정의가 없는 agent는 빈 목록이다. 이것이 "그 Operator만"의 경계다: 정의 file이 agent마다 따로이고 `resolveTurnAgent`는 session의 agent 정의만 읽는다.
3. `extensions/mcp-toolkit.ts`: `McpAgentLayer`·`McpSourceInput`을 지우고 `source(assignment, options?: McpSourceOptions)`가 `options?.agent`를 `serversOf`에 넘긴다. `serversOf(place, agent)`의 겹치기(전역 → project → agent, 같은 이름은 마지막 층, `off`는 아래 층 이름을 지움)는 그대로 둔다. 머리 주석은 이미 agent 정의 층을 말하므로 맞춘다.
4. `extensions/mcp-snapshot.ts`: `McpSnapshotDeps`에 `operators?: () => Promise<Result<readonly OperatorMcpEntry[]>>`를 더한다(`OperatorMcpEntry`는 `{ place: AgentPlace; server: McpRuntimeServer }`, 서버는 `runtimeServerOfLayer(server, place)`). `registeredMcpServers`는 그대로 두고(OAuth begin이 place로 서버를 고르는 길이라 정의 층을 섞지 않는다) `mcpServerSnapshot`만 `operators`의 서버를 뒤에 더한다. 머리 주석의 "agent 정의가 가진 서버는 정의 파일에 있어 여기 없다"를 고친다. `operators`가 없으면(harness, test) 빈 목록이다.
5. `register.ts`와 `main/daemon/wiring/lophn-agent-team.ts`: harness는 agent-roles를 모르므로 조립이 만든다. `createLophnAgent`가 이미 내놓는 `openAgents(sql)`와 `listOperators(context)`(`lophn-agent/agents/inspect.ts`)로 모든 Operator의 `{ place, definition.mcp_servers }`를 모으는 함수 `operatorMcpServers(sql)`를 만든다. 정의 file이 틀린 Operator(`issues.length > 0`)는 건너뛴다(project 층이 틀린 file을 건너뛰는 것과 같다). 동기 file API는 core module graph에 정적으로 두지 않는다: `lophn-agent-team.ts`는 이미 node-fs adapter를 URL로 여는 `register.ts`를 쓰므로 그 길을 따른다.
6. `wiring/lophn-agent-runtime.ts`의 `readMcpServers`와 `wiring/secrets.ts`의 `mcpServers`가 `operators: () => Promise.resolve(ledgerSnapshot(ctx.ledgerPath, (lookup) => operatorMcpServers(lookup.sql)))` 꼴로 정의 층을 넘긴다(`ledgerSnapshot`은 `lophn-agent/session/rewind/files.ts`에 있고 `lophn-agent-runtime.ts`가 이미 import한다. 읽기만 하고 그 file은 고치지 않는다). 읽지 못하면 `Result` 오류를 돌려 runtime의 "읽지 못한 목록은 바꾸지 않은 것으로 본다"(`readMcp`)를 따르게 한다.
7. 정의가 바뀌면 child가 다시 뜨는지 손으로 확인한다(아래 끝남). 위 poll이 새 server의 `--allow-run`/`--allow-net` 변화를 보고 `updateSpec`을 부른다. 그 외 재시작 코드는 더하지 않는다.
8. test 하나를 `extensions/mcp-toolkit_test.ts`에 쓴다(아래 끝남). `createMcpToolkit`의 `create`로 `McpConnections`를 가짜로 끼운다(`source`는 `acquire`·`toolList`만 부른다. `deps.machine`은 `settings/list`에 빈 설정을 답하는 가짜 CoreCall).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(하나, 새 E2E·process 없음): "Operator 정의 층의 server는 그 Operator의 turn 준비(`source`에 `agent` 층을 준 호출)에만 연결 대상에 들고, 같은 place의 다른 agent(`agent` 없이 부른 호출)에는 없다." 같은 place와 같은 전역 설정에서 `source(a, { place, agent: { servers: [x], off: [] } })`의 `servers`에는 `x`가 있고 `source(b, { place })`에는 없다. 권한 경계(어느 agent가 어느 server를 쓰는가)라 test 대상이다. 같은 test에서 `off`로 지운 이름이 합쳐진 목록에서 빠지는 것도 한 줄로 본다.
- 남지 않음: `grep -rn "McpAgentLayer\|McpSourceInput" packages --include=*.ts --exclude-dir=node_modules --exclude-dir=dist`가 0줄이다.
- 손으로 확인: lead가 `deno task dev`(fake provider)에서 Operator 편집 화면의 Add server로 stdio server 하나(예: 존재하는 실행 파일 경로)를 저장하고, runtime child가 다시 뜨는지(로그나 `ps`에서 `--allow-run`에 그 경로가 보임)를 본다. 진짜 provider·진짜 MCP 서비스는 쓰지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 알려진 미완 동작(고치지 않고 적는다):
  - 정의 층 server의 OAuth 로그인: 만들지 않는다(사람이 정함). 편집 화면의 form은 none·bearer·api_key만 받는다. 정의 file을 손으로 고쳐 `oauth2`를 넣은 server는 로그인할 길이 없어 연결이 `failed_auth`로 끝난다(`mcp-auth-control`의 begin·complete·state가 place로 서버를 고르고 정의 층 server는 `registeredMcpServers`에 없다).
  - `McpRuntimeServer.fingerprint`는 `[place id, server]`로 만든다. 같은 place의 두 Operator가 똑같은 server를 가지면 fingerprint가 같다. 연결은 assignment마다 따로라 동작에는 영향이 없어 그대로 둔다.
  - credential 이름 충돌은 `sm-mcp-operator-secret-name`이 고친다(이 task는 이름 규칙을 건드리지 않는다).
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
