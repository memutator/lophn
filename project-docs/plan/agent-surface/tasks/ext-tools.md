# ext-tools

shell extension이 manifest `contributes.tools`로 schema 있는 tool을 선언하고 `ctx.tools.handle`로 처리한다. 사람이 정의 칸 `extensions`로 할당한 lophn agent의 `tools[]`에 실리고, 호출은 host queue를 거쳐 shell main handler로 간다.

- 단위: ext (wave 3)
- 선행: surf-tui. host queue protocol·core·surface wiring을 같이 고쳐 줄 세운다.
- 소유(이 task만 고친다):
  - `packages/protocol/extensions/manifest.ts`
  - `packages/protocol/lophn-agent/{host-queue,extension-tools,agent-values}.ts`(`extension-tools.ts`는 새 file)
  - `packages/protocol/approvals/gate-call.ts`
  - `packages/core/host-queue/`
  - `packages/core/main/daemon/wiring/{host-queue,extension-tools,assignment-file}.ts`(`extension-tools.ts`는 새 file)
  - `packages/core/approvals/`
  - `packages/core/lophn-agent/tools/{registry.ts,extension-tools.ts}`(`extension-tools.ts`는 새 file)
  - `packages/core/lophn-agent/run-loop/{prepare,runtime-access}.ts`
  - `packages/core/lophn-agent/agents/{definition-file,definition-file_test,commands,commands_test,validate}.ts`
  - `packages/cli/commands/agent.ts`
  - `packages/shell/main/extensions/{registry,registry_test}.ts`
  - `packages/shell/main/desktop/wiring/{extensions,surface}.ts`
- 읽을 것:
  - `project-docs/plan/agent-surface/README.md`, `project-docs/products/roadmap/tool-extension.md`(무엇을 만드나, 정한 것 1~8)
  - architecture: `project-docs/architecture/{extension,agent-definition,approval}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `extension-api`, `extension-host`
  - manifest·registry: `packages/protocol/extensions/manifest.ts`(`contributes`, `ExtensionContext`), `packages/shell/main/extensions/registry.ts`(`discover`, `contextFor`, `run`), `packages/shell/main/desktop/wiring/extensions.ts`
  - tool: `packages/core/lophn-agent/tools/registry.ts`(`ToolDefinition`, `definitionHash`), `packages/core/lophn-agent/extensions/mcp-tools.ts`(`buildMcpTools`, `externalToolName`), `packages/core/lophn-agent/run-loop/prepare.ts`(`visibleTools`, `material`, `fixedBySession`, `toolsNotice`), `packages/protocol/lophn-agent/tool-catalog.ts`(`WIRE_TOOL_NAME_PATTERN`), `packages/core/lophn-agent/tools/wire.ts`(겹친 이름 하나가 목록 전체를 깬다)
  - Gate: `packages/protocol/approvals/gate-call.ts`, `packages/core/approvals/gate/judge.ts`, `packages/core/approvals/approvals.ts`
  - 정의: `packages/core/lophn-agent/agents/definition-file.ts`(`orderedFrontmatter`, `EMPTY_DEFAULT_LISTS`), `agents/commands.ts`(`HUMAN_ONLY_MESSAGE`), `agents/validate.ts`(`knownToolName`), `packages/protocol/lophn-agent/agent-values.ts`(`frontmatterFields`)
  - 자격: `packages/core/agent-workspaces/credentials.ts`, `packages/core/main/daemon/wiring/harness-credential.ts`(turn마다 내고 끝에 거두는 선례), `packages/core/lophn-agent/run-loop/runtime-access.ts`(`AGENT_BASE_OPERATIONS`, `RUNTIME_MACHINE_ROUTES`)
- 계약:
  - 쓰는 것: surf-queue의 host queue(`HostQueue.enqueue`, `attached()`, `host/take`·`host/done`).
  - 내놓는 것:
    - manifest `contributes.tools[]`: `{name, description, inputSchema(JSON Schema object), effect: "read" | "write" | "external"}`. `name`은 `^[a-z][a-z0-9_]*$`이고 `__`가 없다. extension 안에서 겹치지 않고 model 이름이 64자를 넘지 않는다. schema에서 막아 `invalid`로 보인다.
    - model 이름: `ext__<extension id>__<tool name>`. 내장(`file_read`처럼 `_` 하나)과 MCP(`mcp__`)와 겹치지 않는다. 판정·저장·picks 모두 이 이름 하나를 쓴다.
    - `ctx.tools.handle(name, handler) → dispose`. handler는 `(input, call: {session, workspace, core}) → Promise<Result<ContentBlock[]>>`이다. `call.core.call(kind, resource, method, input)`은 그 호출 session의 agent 자격으로 부른다. `ctx.core`(사람 권한)와 다르다.
    - route(`packages/protocol/lophn-agent/extension-tools.ts`): `extension_tools/publish`(user, shell main이 sync마다 켜진·꺼진 것 상관없이 판이 맞는 manifest의 `{id, name, description, tools[]}` 전부를 통째로 바꾼다), `extension_tools/catalog`(user·machine read, 켜진 것만), `extension_tools/call`(agent, `{name, input}` → `{content: ContentBlock[]}`).
    - host 요청 kind `tool_call`: payload `{extension, tool, input, session, workspace, credential}`. workspace를 가리지 않고 아무 shell main이 가져간다. `host/done`에 `output: {content} | {error: LophnError}`를 더한다.
    - Gate `GateCall`에 `{kind: "extension_tool", extension, tool}`. 판정은 할당했으면 `run`, 정의 `extensions`에 없으면 `deny not_assigned`, extension이 꺼졌거나 catalog에 그 tool이 없으면 `deny removed`. 묻지 않으므로 `acpApprovalSubjectSchema`에는 넣지 않는다(renderer·SDK ACP type이 넓어지지 않게).
    - 정의 칸 `extensions: string[]`(extension id). 사람만 쓴다.

## 할 일

1. **manifest.** `contributes`에 `tools`(기본 `[]`)를 더하고 이름 규칙을 schema refine으로 막는다. `ExtensionContext`에 `tools.handle`을 더한다.
2. **shell registry.** `contextFor`가 `tools.handle`을 extension마다 handler map에 건다. 끄면 commands처럼 다 버린다. `callTool(extension, tool, input, call)`은 `run`처럼 없는 handler면 `not_found`, throw면 `internal`. `sync()` 끝에 catalog를 `extension_tools/publish`로 보낸다(core는 manifest를 읽지 못하고 standalone이면 설치 경로도 모른다). surface wiring이 `tool_call` 요청을 받아 `callTool`을 부르고 결과를 `host/done`에 싣는다. handler의 `call.core`는 요청에 실린 자격 token으로 만든 client다(`ctx.coreInternal`을 쓰지 않는다).
3. **catalog(core).** `extension_tools/publish`를 메모리에 두고, `catalog`는 설정 `extensions.<id>.enabled`가 켜진 것만 낸다. shell이 아직 publish하지 않았으면 비어 있다. 그때 연 session은 extension tool 없이 시작하고 publish 뒤 `tools_changed`로 받는다(roadmap에 없는 동작이라 문서에 적는다).
4. **호출 route.** `extension_tools/call`은 caller session의 agent 정의 `extensions`와 catalog로 Gate `extension_tool`을 판정한다(lophn runtime과 다음 task의 harness CLI가 같은 한 곳을 거친다. 그래서 tool 정의에는 `gate`를 두지 않는다). `deny`면 그 이유로 `forbidden`. shell이 붙어 있지 않으면(`HostQueue.attached()`가 false) `unavailable`. 통과하면 이 호출만 쓰는 agent 자격을 낸다: conditions `{session, workspace, process: "extension"}`, 상한은 그 workspace 종류의 `lophn` 명령 route(`harnessOperations`)이고, 호출이 끝나면 거둔다. `tool_call`을 넣고 `host/done`을 기다려 돌려준다. 기다리는 동안 shell이 떨어지면 `unavailable`. 결과를 `<lophn-untrusted>`로 감싸지 않는다(정한 것 4). `AGENT_BASE_OPERATIONS`에 이 route를, `RUNTIME_MACHINE_ROUTES`에 `catalog`를 더한다(빠지면 unit과 기동은 통과하고 turn에서만 깨진 일이 있다).
5. **tool 목록.** `ToolOrigin`에 `extension`. `tools/extension-tools.ts`가 catalog와 정의 `extensions`로 `ToolDefinition`(이름 `ext__…`, `inputSchema`, effect, handler는 `extension_tools/call`)을 만든다. `prepare.ts`의 `material`·`visibleTools`가 MCP 옆에 싣는다. lophn runtime은 할당한 extension의 tool 전부, bare는 그 가운데 `tools` picks만. 처음부터 다 싣는다. `tools_changed`는 목록 key가 바뀌면 저절로 난다.
6. **정의 칸.** `agent-values.ts`의 frontmatter 입력·출력에 `extensions`, `definition-file.ts`의 `orderedFrontmatter`와 `EMPTY_DEFAULT_LISTS`에 `extensions`(빠지면 저장할 때 조용히 사라진다), `agents/commands.ts`의 create·change 사람만 검사와 `HUMAN_ONLY_MESSAGE`, `packages/cli/commands/agent.ts`의 `omit`과 help 글, `validate.ts`의 `knownToolName`에 `ext__` 갈래. 새 optional 칸이라 옛 정의 file은 그대로 읽혀 migration이 없다(보고에 적는다). UI 이름은 core의 skill·MCP "Extensions"와 헷갈리니 다음 task가 "Shell extensions"로 쓴다.
7. 이름·route를 문자열로도 grep한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "할당하지 않은 extension의 tool은 `extension_tool` 판정이 `deny not_assigned`, 꺼진 extension은 `deny removed`다"(`judge_test.ts`).
  - "extension handler에 가는 자격은 그 session의 agent 자격이고 사람 전용 route(`settings/update` 같은)를 부르면 `forbidden`이다"(core unit).
  - "agent 자격으로 정의를 만들거나 고칠 때 `extensions`를 넣으면 `forbidden`이다"(`commands_test.ts`의 `humanOnly` 표에 한 줄).
  - "`extensions`가 serializer를 지나 남는다"(`definition-file_test.ts`).
- 남지 않음: `TODO`·`FIXME`를 남기지 않는다. 바꾼 route·칸 이름이 문자열로 남지 않는다.

## 보고

brief-template의 보고 꼴. 등록할 것(`packages/protocol/lophn-agent/{mod,registry}.ts`, core registration의 `memoryRoutes`, `packages/core/main/daemon/assembly.ts`)을 적는다. `ToolCall.extension.canonical_name`(`^ext_` schema, 지금 MCP 이름이 들어간다)을 어떻게 했는지 적는다.
