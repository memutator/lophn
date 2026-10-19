# domain-tools: app-api를 MCP tool 모양으로 바꾸고 coding agent에 MCP를 연다

- 목표:
  - 앱의 app-api 선언과 호출 길을 MCP tool 모양 하나로 바꾼다. 선언, SDK handler, 화면 bridge, agent tool, ticket examples가 모두 그 모양을 쓴다.
  - app-api의 project 범위(`project_scope`)를 지운다.
  - core가 lophn terminal의 coding agent에게 MCP endpoint를 연다.
- 재료:
  - `project-docs/products/roadmap/domain.md`: "domain", "core가 아는 한 가지 모양", "MCP server와 경계, 여러 domain을 쓰는 agent", "정한 것"
  - `project-docs/architecture/app-call.md`(호출 길, Gate, invocation, rewind, project), `architecture/approval.md`, `architecture/coding-agent.md`, `architecture/annotation.md`(화면 신원)
  - `project-docs/boundary-catalog.yaml`의 `apps` 아래 경계. `module-catalog.yaml`의 `packages/core/apps`, `packages/sdk`
- 범위 밖:
  - 앱을 project에 묶기, 앱 place와 App Engineer 없애기. 계획 `domain-place`가 한다.
  - 이름 바꾸기(app → domain tool, `app__` 접두). 계획 `domain-rename`이 한다.
  - Claude Desktop 같은 lophn 밖 MCP client 연결(roadmap "하지 않는 것").
  - MCP `resources`와 `prompts`.
  - 외부 MCP server tool에 invocation과 rewind 주기. 지금처럼 session ToolCall만 남는다.
  - e2e. 아래 "e2e" 절을 따른다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `dt-`로 시작한다.
- 단위와 순서: `tasks/*.md`가 정한다.
  - wave 1(사슬):
    - `dt-decl`: 선언 모양과 `public`
    - `dt-call-route`: `app.call_tool`, 호출 길에서 project 지우기
  - wave 2:
    - `dt-invocation-project`
    - `dt-preview-call`(`dt-invocation-project` 뒤)
    - `dt-sdk`
    - `dt-agent-tools`
    - `dt-shell-bridge`
    - `dt-examples`
    - `dt-coding-text`
  - wave 3(사슬):
    - `dt-mcp-endpoint`
    - `dt-mcp-harness`
- 시작 조건: 없다. 계획 `domain-kinds`, `domain-place`, `artifact`와 같이 돈다.

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- **선언 모양**
  - blueprint의 `app_api[]`를 tool 선언 목록으로 바꾼다. 칸은 MCP tool 정의를 따른다: 이름, 설명, input schema, output schema(선택).
  - 여기에 lophn 칸 둘을 더한다.
    - `effect`(`read` | `write` | `external`). program이 강제하는 값이다.
    - `public`(boolean). 다른 project에 보이는지다. 이 계획은 칸만 둔다. 읽는 쪽은 `domain-place`가 쓴다.
  - MCP annotation(`readOnlyHint`, `destructiveHint`, `openWorldHint`)은 effect에서 만들어 바깥에 보일 때만 쓴다. 강제는 지금처럼 Gate와 runtime 권한이 한다.
  - 이름 규칙과 input schema 제약은 계약 task가 MCP spec과 지금 `InputSchema` 제약을 보고 정한다.
- **SDK**
  - handler는 `appApi(key, handle)` 대신 tool 이름으로 등록한다.
  - `@lophn/app-ui`의 `useAppApi`, `AppApiButton`도 같은 이름으로 바꾼다.
  - 정확한 export 이름은 계약 task가 정한다.
- **bridge:** 화면의 `window.lophnApp.call(api, input)`은 tool 호출 하나(`callTool`)가 된다. `openExternal`은 그대로 둔다.
- **호출 길**
  - route `app.call_api`를 tool 호출 route로 바꾼다.
  - Gate, write queue, invocation 기록, changeset, rewind, unknown 처리는 그대로 둔다.
  - 거절 code `project_required`, `project_mismatch`, `project_not_found`는 지운다.
- **project 범위 지우기**
  - 지울 것: 선언의 `project_scope`, 호출 입력의 `project`, `pickProject`(`core/apps/calls/project.ts`), agent tool 입력의 project 칸(`lophn-agent/tools/app-api/input.ts`), SDK `cap-project`(`currentProject`, `listProjects`), broker `projects/list`, shell 앱 view의 project picker(`renderer/app-frame/project-picker.tsx`와 `registry.ts`의 `setProject`).
  - invocation의 `project` 칸은 지운다. 어느 project가 불렀는지는 부른 session의 place로 안다.
  - 근거: 앱은 계획 `domain-place`에서 project 하나에 묶인다. 앱 코드가 project별로 data를 나누는 관례는 core가 지키지 못한다(roadmap "지금 코드").
- **agent tool:** 이름은 지금처럼 `app__<app>__<tool>`이다. 이름 바꾸기는 `domain-rename`이 한다. 결과 mapping(`resultOf`)은 그대로 둔다.
- **ticket examples:** `steps[{api, input, expect}]`를 tool 이름으로 바꾼다. 실행 길(test bundle의 control socket)은 그대로 둔다.
- **coding agent MCP endpoint**
  - core HTTP server에 MCP Streamable HTTP endpoint 하나를 연다. 판은 lophn client와 같은 `2025-06-18`이다.
  - 자격은 coding agent의 자격이다. `tools/list`는 그 coding agent가 맡은 ticket의 앱 tool을 보인다.
  - `tools/call`은 그 앱의 **preview**(fixture data, `/previews/*`)로만 간다. preview가 없으면 `unavailable`이다. live data를 부르지 않는다.
    - 근거: coding agent는 자기 코드를 확인하려고 부른다. AI가 만든 코드와 agent의 실수로 사용자 data를 잃지 않게 한다(AGENTS.md "속도").
    - preview 호출은 지금처럼 invocation과 rewind가 없다.
  - harness가 이 endpoint를 쓰게 하는 설정은 harness마다 brief가 실제 launch 코드(`packages/coding-agent/harnesses/`)를 보고 정한다. 예: Claude Code의 MCP 설정.
- **brief를 쓰며 정한 것**(brief worker, planner 검토)
  - **선언:** `{name, title, description, inputSchema | null, outputSchema?, effect, public}`이다. `label`은 `title`이 된다. 이름은 1..64자 `[A-Za-z0-9_.-]`이다.
  - **annotation:** effect에서 만든다(`toMcpTool`, `toolAnnotations`).
  - **route:** `app.call_tool`(`appCallTool`)이다. invocation operation은 `{kind: "tool", tool}`이다. 읽기 route `app.app_api`·`app.app_api_index`는 이름을 두고 출력 key만 `tools`가 된다.
  - **bridge:** `window.lophnApp.callTool(tool, input)`이다. IPC는 `app:call-tool`이다.
  - **preview 호출은 invocation을 남기지 않는다.** 지금은 mode=preview 행을 남긴다. 하지만 ledger의 `release`가 NOT NULL이라 release 없는 bundle은 남길 수 없다.
    - preview 호출이 tool을 preview bundle의 blueprint에서 찾게 고친다(`dt-preview-call`). 지금은 활성 release에서 찾아 새 tool이 `not_declared`가 된다.
  - **coding agent MCP 호출의 caller:** `person` caller로 들어간다. auth는 `{actor: "user", previewOnly: true}`다.
    - 새 caller kind를 만들면 ledger CHECK, switch, rewind를 고쳐야 한다. 그런데 preview 호출은 기록이 없다.
    - `previewOnly`가 호출 길 자체에서 live를 막는다. 왜 person인지는 그 자리 주석에 적는다.
  - **MCP endpoint**
    - POST만 받는다. SSE와 `Mcp-Session-Id`는 없고, batch는 거절한다.
    - `tools/list`는 preview가 돌면 그 bundle의 선언, 아니면 활성 release의 선언이다. `listChanged`는 없다.
    - 자격은 coding token의 새 operation `coding.mcp`다.
  - **harness**
    - Claude Code: `--mcp-config <json>`(prompt 뒤에 둔다)
    - Codex: `-c mcp_servers.lophn.*`
    - OpenCode: `OPENCODE_CONFIG_CONTENT`
    - token은 env(`LOPHN_CODING_TOKEN`)로만 준다. 사람의 전역 설정에는 쓰지 않는다.
    - Gemini, pi, Hermes, OpenClaw는 잇지 않는다.
  - **이름 경계(`domain-rename`에 넘긴다):** 아래 이름은 이 계획에서 두고 `domain-rename`이 바꾼다.
    - approval intent kind `app_api`
    - grant 칸(`app_apis`, `apis`)
    - attestation·desired·probe의 `app_api`
    - `app_connections[].app_api`
    - process-wire·broker의 `api`
    - SDK package 이름 `@lophn/cap-app-api`
    - file·폴더 이름(`app-api.ts`, `tools/app-api/`)
    - session `tool_calls.app_api`
- **test(AGENTS.md "속도")**
  - 위험 test: coding agent MCP의 `tools/call`이 live로 가지 않는다. 다른 ticket·앱의 tool이 `tools/list`에 없다. write tool 호출이 지금처럼 invocation과 changeset을 남긴다(이미 있는 test를 옮겨 살린다).
  - 화면과 이름은 test하지 않는다.

## e2e

- 이 계획은 e2e를 돌리지도 고치지도 않는다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh domain-tools`로 돈다.

## 같이 도는 계획

`domain-kinds`(`dk-`), `domain-place`(`dp-`), `artifact`(`af-`)가 같이 돈다. 겹치는 file은 아래 표와 같다.
- running task끼리는 `status.py ready`가 가른다.
- land의 rebase 충돌은 두 쪽을 다 남긴다.
- 계획 사이 순서나 계약이 걸리면 planner session `lophn-7e`에게 SendMessage로 묻는다.

| file | 겹치는 계획 |
|---|---|
| `packages/protocol/apps/blueprint/*` | `domain-place`는 `public` 칸을 읽기만 한다 |
| `packages/core/apps/calls/*`, `invocations/*` | `domain-place`는 건드리지 않는 것으로 나눴다 |
| `packages/core/lophn-agent/tools/app-tools.ts`, `app-toolkit.ts`, `app-api/*` | `domain-place`는 다른 project의 공개 tool만 보이게 거르는 일을 이 file 밖(grant·toolkit 입력)에서 한다. 겹치면 그 task를 이 계획 뒤로 미룬다 |
| `packages/core/agent-roles/tool-lists.ts` | `domain-kinds`, `domain-place` |
| `packages/shell/main/app-frame/*`, `renderer/app-frame/*` | `domain-place`(앱 place 화면: agent select, app agents), `artifact`(annotate 쪽 `annotate.ts`) |
| `packages/coding-agent/*` | `domain-place`(App Engineer → PM 문구) |
| `packages/design/wording/catalog/*` | 모두 |
| `tests/eval/*` | 모두 |

- `domain-place`의 lophn 지도와 다른 project 공개 tool 거르기는 이 계획의 계약 task(`public` 칸)가 land한 뒤에 돈다. planner가 그 사이를 잇는다.

## lead가 할 일

- **wave 2를 띄우기 전에:** wave 1이 merge되면 선언 모양, route 이름, SDK 이름, bridge IPC가 brief와 같은지 본다.
  - wave 1을 land하고 planner(`lophn-7e`)에게 알린다. `domain-place` wave 3이 `public`을 기다리므로 wave 1은 따로 먼저 land한다.
- **`dt-mcp-endpoint` 뒤:** 아래를 등록한다.
  - `core/main/daemon/assembly.ts`의 `WIRINGS`에 `wiring/coding-mcp.ts`
  - `Built`의 mcp 칸
- **rebase 충돌:** `wiring/{apps,projects,context}.ts`와 wording catalog는 두 쪽을 다 남긴다.
- **HTTP 수준 MCP test:** brief는 handler 수준 test만 쓴다. HTTP 수준 test가 필요하면 사람에게 묻는다.
- **merge 때마다:** wording 생성과 등록 file(`protocol/**/mod.ts`, core wiring, `deno.json`)을 고친다.
- **wave 3 뒤(손으로):** 확인할 것은 아래다. fake model server를 쓰고, 사람의 `~/.lophn`은 건드리지 않는다.
  - `deno task dev`로 앱 하나에 ticket을 맡긴다.
  - coding agent terminal에서 preview를 띄운 뒤 MCP로 그 앱 tool을 부를 수 있다.
  - preview가 없으면 `unavailable`이다.
- **다 끝나면**
  - `architecture/app-call.md`를 고친다. tool 선언, 호출 route, project 범위 지움, preview 호출이 기록을 남기지 않음, MCP endpoint를 적는다.
  - `architecture/coding-agent.md`에 coding agent MCP를 적는다.
  - `boundary-catalog.yaml`에 MCP endpoint interface를 더한다.
  - changelog 열린 판에 항목을 덧붙인다.
  - worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 올린다.
- **사람에게 묻는 것:** coding agent가 live tool을 불러야 하는 경우가 나올 때. subprocess·Electron test를 새로 만들 때.
