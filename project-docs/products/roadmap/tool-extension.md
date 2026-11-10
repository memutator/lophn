# tool extension: extension이 agent의 tool을 등록한다

상태: 끝남(계획 agent-surface, 2026-11-08, changelog 0.22.0). 2026-11-08 사람이 방향을 냈고 planner가 정리했다.
배경 문서: `project-docs/architecture/{extension,agent-definition,approval,coding-agent}.md`, `project-docs/products/roadmap/{command-surface,tool-lazy-loading}.md`. 비교: `../harness-lab/_report/tool-extension-architecture.md`(dsh, pi), `../harness-lab/_report/extension-systems-report.md:256`(Claude Code mod).

## 사람의 말 (원문)

2026-11-08:

> 다음은 tool extension에서 지금은 cli command랑 skill로 하는데 진짜 tool 자체도 등록하고 싶거든?

진짜 tool이어야 하는 이유를 물었을 때: "그냥 !"

## 왜

- 지금 agent가 할 수 있는 일을 넓히는 길은 lophn 명령(`lophn` tool 하나, `packages/cli/commands/`), skill, 앱 command(`lophn <slug> <command>`), 외부 MCP다. shell extension은 agent에게 아무것도 주지 못한다.
- 뒤에 올 browser-use처럼 shell 쪽에서만 할 수 있는 일(webview, 화면)을 schema 있는 tool로 내놓을 자리가 없다.

## 지금 코드

shell extension (`project-docs/architecture/extension.md`)
- manifest `{id, name, description, version, entry, provides, contributes}`. `provides`는 설정 화면 표시용 `string[]`(`packages/protocol/extensions/manifest.ts:77`), `contributes`는 명령과 keybinding뿐이다.
- entry는 shell main에서 켜졌을 때만 `require`하고 `activate(ctx)`한다. `ctx = {core, settings, spawn, acp, clock, ids, files, commands}`. `ctx.core.call`은 사람 권한으로 core route를 부른다(shell → core 한 방향).
- 켜기 설정 `extensions.<id>.enabled`는 `packages/core/config/shell-settings.ts`에 id마다 정적으로 선언한다.
- agent runtime은 core의 child process라 extension과 닿는 길이 없다. 선례는 extension `harness`가 core의 harness queue를 1초마다 `harness/take`로 가져가는 것이다.

tool registry (`packages/core/lophn-agent/tools/`)
- `ToolDefinition`(`registry.ts:20-50`): `name, description, input, inputSchema?, effect, origin: builtin|app|external, handler?, display?, gate?, operations[]`. 바뀜 판단은 name·description·input schema·effect의 hash(`registry.ts:62-69`).
- `tools[]`: workspace 종류 고정 목록(`workspaceToolNames`, `packages/protocol/lophn-agent/tool-lists.ts`) + 설정한 MCP tool(`mcp__<server>__<tool>`, `origin: external`). `visibleTools`(`run-loop/prepare.ts:291-327`), 첫 turn에 session 고정(`prepare.ts:995-1000`), 바뀌면 `tools_changed` notice(`prepare.ts:349-368`).
- 앱 command는 `tools[]`에 없고 `lophn` 명령으로 푼다(`command-surface.md`). `architecture/agent-definition.md`에 할당된 앱 tool을 `tools[]`에 싣는다는 옛 문장이 남아 있으면 옛 문장이다(`agent-surface.md` 단계 0이 고친다).
- Gate: `gate()`가 `GateCall {app_tool | mcp_tool | shell}`을 내면 core가 판정한다(`architecture/approval.md`의 판정 흐름). MCP는 설정한 층이 곧 할당이고 실행 때 묻지 않는다.
- agent 자격의 operation 상한은 workspace 종류 목록 tool의 route 합집합이다(`agent-workspaces/credentials.ts:52-92`).

## 비교 (harness-lab)

- dsh: `defineTool({name, description, parameters, output, execute})`, `ctx.tools.register(def)`이 disposer를 돌려준다. 범위(agent 하나)를 줄 수 있다. 호출마다 pre-execute(allow/deny/ask) → guard → post-execute pipeline. 바뀌면 대화에 `tool-addition`·`tool-removal`.
- pi: `pi.registerTool({…, execute, exposure})`, 평평한 Map(먼저 등록한 것이 이긴다), 호출별 승인 없음, `exposure: deferred`와 `tool_search`로 늦게 싣기.
- Claude Code mod: `$.tool.register({name, description, inputSchema})` → `mcp__<plugin>__<name>`, mod가 `tool.call` hook으로 답한다.
- 보고서는 lophn 추천을 하지 않는다. lophn에 가까운 것은 schema를 선언하고 host가 호출을 넘기는 Claude Code 꼴과, 승인 자리가 이미 있는 dsh 꼴이다.

## 무엇을 만드나

- manifest `contributes.tools[]`: `{name, description, inputSchema, effect}`. schema는 정적이다.
- `activate(ctx)`에서 `ctx.tools.handle(name, handler)`. handler는 입력과 호출 context(session, workspace, 그 호출의 agent 자격으로 부르는 `core`)를 받아 MCP ContentBlock 배열(text, image)을 돌려준다.
- tool 목록: core는 manifest를 읽지 못하므로 shell main이 판이 맞는 manifest의 tool 목록을 core에 올린다. core는 메모리에만 두고 shell이 다시 붙을 때마다 다시 받는다. 올리기 전에 연 session은 목록이 온 뒤 `tools_changed`로 받는다.
- 호출 길: run-loop → core host queue(`agent-surface.md`) → shell main extension handler → 결과. shell이 붙어 있지 않으면 그 호출은 `unavailable`이다.
- 정의에 사람만 쓰는 칸 `extensions`(extension id 목록)를 더한다. 할당한 extension의 tool이 그 agent의 `tools[]`에 들어간다. custom은 그 안에서 `tools`로 고른다.
- Gate에 `extension_tool`을 더한다. 할당했으면 run, 아니면 `not_assigned`, 켜진 extension의 목록에서 빠졌으면(꺼짐, tool 없어짐) `removed`.
- harness agent는 같은 tool을 CLI로 부른다(`lophn` 명령 하나, 입력은 JSON). 자격과 Gate는 같다.
- 편집기의 할당 화면에 extension을 고르는 칸을 더한다.

## 정한 것

1. 진짜 tool이다: model의 `tools[]`에 schema와 함께 들어간다. (사람, 2026-11-08)
2. schema는 manifest에 정적으로 선언한다. 실행 중 등록(`register()`)은 두지 않는다. (agent) 정의 hash·`tools_changed` notice·session 고정 목록 규칙이 그대로 맞고, 설정 화면이 code를 load하지 않고 tool을 보인다. Claude Code mod와 같은 꼴.
3. 할당한 agent에게만 싣는다. 단위는 extension 하나(그 tool 전부)이고 칸은 사람만 쓴다(`apps`, `mcp_servers`와 같다). (agent) 2026-11-01 "`tools[]`는 workspace 종류마다 작은 고정 집합"을 기본 상태에서 지키고, 넓히는 길이 할당 하나라는 원칙(`architecture/agent-definition.md`의 지키는 것)과 맞는다.
4. 할당이 곧 허락이다. 실행 때 묻지 않고 결과를 `<lophn-untrusted>`로 감싸지 않는다. (agent) 사람이 설치하고 켜고 할당한 code는 MCP처럼 믿는다(`architecture/agent-definition.md`의 MCP 층, `architecture/approval.md`의 할당이 허락이라는 원칙).
5. handler가 core를 부를 때는 사람 권한이 아니라 그 호출 session의 agent 자격(상한은 그 workspace 종류)을 쓴다. (agent) agent가 tool 하나로 사람 권한을 얻지 않게. harness turn 자격(`harness-credential.ts`)과 같은 선례.
6. 처음부터 다 싣는다. 늦게 싣기는 하지 않는다. (agent) `architecture/agent-definition.md`의 지키는 것(숨기거나 늦게 펼치는 장치는 없다). tool이 많은 extension의 비용은 사람이 할당으로 조절한다(MCP와 같다, `command-surface.md`).
7. model에 보이는 이름은 `ext__<extension id>__<tool name>`이다. provider 이름 규칙(`[A-Za-z0-9_-]{1,64}`)에 맞고 내장(`_` 하나)·MCP(`mcp__`)와 겹치지 않는다. tool name은 `[a-z][a-z0-9_]*`이고 `__`가 없으며 길이는 manifest schema가 막는다. (agent, 계획 agent-surface가 정함)
8. extension tool의 첫 실제 사용자는 browser-use extension이다. (2026-11-09: browser use는 CLI + skill로 갔다(사람, changelog 0.22.0). extension tool의 실제 사용자는 아직 없고, 남길지는 사람이 정한다.) 이 로드맵은 test extension fixture로만 확인한다. (agent) AGENTS.md "쓰일지 모를 확장 지점을 미리 만들지 않는다"와 어긋나지만, 사람이 명시해 만든다.

## 단계

| 단계 | 하는 일 |
|---|---|
| 1 | manifest `contributes.tools`, `ctx.tools.handle`, host queue 위의 호출 길, registry origin `extension`, Gate `extension_tool`, 정의 칸 `extensions`, handler 자격, `tools_changed` notice |
| 2 | harness agent용 CLI 꼴, 편집기 할당 화면, 명함 차이(`diff.plus`)에 extension tool |

## 하지 않는 것

- 실행 중 tool 등록·해제, 늦게 싣기·tool search.
- extension을 별도 process·sandbox에서 돌리기(지금 extension처럼 shell main 안이다).
- extension이 내장 tool을 덮어쓰기.
- 호출마다 묻는 승인, 인자 고치기 hook.
- browser-use 자체.
