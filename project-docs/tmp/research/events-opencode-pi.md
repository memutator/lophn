# OpenCode와 Pi의 lifecycle event 조사

사실만 쓴다. 추천이나 lophn 설계 제안은 없다. 확인하지 못한 것은 "확인 못함"이라고 적었다.

## 0. 범위와 근거

source를 직접 읽었다. clone 위치는 `/tmp/claude-1000/-home-pyosechang-projects-lophn-project-docs/c3fd2111-562b-41c5-8a67-86a862b12e16/scratchpad/research/` 아래.

| 약어 | 무엇 | commit |
|---|---|---|
| `v1` | github.com/sst/opencode, tag `v1.19.0` (2026-10-11) | `733b2c62` |
| `v2` | github.com/sst/opencode, 기본 branch `dev` (`packages/core` 2.0.27) | `417f120e` |
| `pi` | github.com/badlogic/pi-mono, `packages/coding-agent` 1.2.0 | `7d75a0e3` |

경로 약어. 모두 해당 commit의 repo 안 경로다.

- `v1/S` = `packages/schema/src`, `v1/O` = `packages/opencode/src`, `v1/C` = `packages/core/src`
- `v2/S` = `packages/schema/src`, `v2/C` = `packages/core/src`, `v2/P` = `packages/plugin/src`
- `pi/CA` = `packages/coding-agent`, `pi/A` = `packages/agent`

공식 문서도 같은 commit의 repo 안 문서를 읽었다: `v1`은 `packages/web/src/content/docs/plugins.mdx`, `server.mdx`. `v2`는 `services/www/src/docs/content/build/plugins/index.mdx`, `migrate-v1.mdx`. `pi`는 `pi/CA/docs/json.md`, `rpc.md`, `rpc-commands.md`, `rpc-extension-ui.md`, `extensions.md`, `session-format.md`. pi 문서 안의 링크는 `github.com/earendil-works/pi`를 가리킨다(저장소 이름이 옮겨진 것으로 보이나 확인 못함). 웹 사이트는 열어 보지 않았다.

### 먼저 알아야 할 것: OpenCode는 두 갈래다

- 기본 branch `dev`는 **V2**(`@opencode/*` package, 2.0.x)다. event를 새로 정의했다(`session.execution.*`, `session.step.*`, `session.tool.*` 등). V2 plugin은 V1 plugin을 그대로 못 돌린다(`v2 services/www/.../migrate-v1.mdx`).
- `v1.19.0`도 같은 주에 릴리스된 현재 판이다. 질문에 예로 든 `message.updated`, `session.idle`, `chat.params`, `tool.execute.before` 같은 이름은 **V1** 것이다.
- 그래서 OpenCode는 V1, V2를 따로 쓴다. V2 dev 안에도 V1 event 정의(`v2/S/v1/session.ts`)가 남아 있지만 V2 manifest(`v2/S/event-manifest.ts`)에 들어 있지 않아 SSE로 나가지 않는다.

### 용어

- bus: 프로세스 안 event 통로. publish/subscribe.
- durable: DB에 남는 event. ephemeral: 메모리에만 있고 놓치면 끝인 event. (V1은 `define`의 `durable` 옵션, V2는 `Event.durable()`/`Event.ephemeral()`로 나뉜다.)
- hook: plugin이 끼어드는 지점. 입력을 바꾸거나 막을 수 있는 것이 있다.

---

## 1. OpenCode V1 (`v1.19.0`)

### 1.1 통로

| 통로 | 내용 | 근거 |
|---|---|---|
| bus | 모든 event가 `EventV2Bridge`를 거쳐 publish된다. 사용자 plugin의 `event` hook과 SSE가 여기서 읽는다. | `v1/O/event-v2-bridge.ts`, `v1/O/plugin/index.ts` (`events.listen`) |
| plugin hook | `Hooks` interface. 아래 1.3 표. | `packages/plugin/src/index.ts:222-335` |
| SSE | `GET /event`, `GET /global/event`, `GET /api/event`. 아래 1.4. | `v1/O/server/routes/instance/httpapi/handlers/event.ts`, `.../global.ts`, `packages/server/src/handlers/event.ts` |

### 1.2 bus event 표

모든 bus event는 읽기 전용이다. 구독자가 값을 돌려줘서 막거나 바꿀 수 없다. (표의 "막기/바꾸기"는 모두 "불가"여서 열 이름만 남기고 한 번에 쓴다. 막거나 바꾸는 것은 1.3 hook 표에 있다.)

`durable`은 7개(session.created/updated/deleted, message.updated/removed, message.part.updated/removed)이고 나머지는 ephemeral이다(`v1/S/v1/session.ts`, 테스트 `packages/schema/test/legacy-event.test.ts`가 같은 목록을 고정). 
payload는 SSE에서 `{ id, type, properties }`로 나간다.

#### session, message (V1 이름)

| event | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `session.created` (durable) | session을 만들 때 | `sessionID`, `info`(id, parentID, title, agent, model, time, cost, tokens, permission, revert, ...) | `v1/S/v1/session.ts:564`, publish `v1/O/session/session.ts:535` |
| `session.updated` (durable) | title, summary, archived, revert 같은 session 정보가 바뀔 때 | `sessionID`, `info` | `v1/S/v1/session.ts:572`, `session.ts:746` |
| `session.deleted` (durable) | session 지울 때 | `sessionID`, `info` | `session.ts:622` |
| `message.updated` (durable) | user/assistant message가 만들어지거나 바뀔 때 | `sessionID`, `info`(role user 또는 assistant. assistant는 `modelID`, `providerID`, `agent`, `cost`, `tokens`, `finish`, `error`, `time.completed`) | `v1/S/v1/session.ts:588,455`, publish `session.ts:631` |
| `message.removed` (durable) | message 지울 때 | `sessionID`, `messageID` | `session.ts:857` |
| `message.part.updated` (durable) | part가 만들어지거나 바뀔 때. tool 호출 상태 변화도 여기로 나간다 | `sessionID`, `part`, `time`. part 종류: text, reasoning, file, agent, compaction, subtask, retry, step-start, step-finish, snapshot, patch, tool. tool part의 `state.status`: pending, running, completed, error | `v1/S/v1/session.ts:604, 66-317`, `session.ts:637` |
| `message.part.removed` (durable) | part 지울 때 | `sessionID`, `messageID`, `partID` | `session.ts:869` |
| `message.part.delta` | text나 reasoning이 스트리밍으로 붙을 때 | `sessionID`, `messageID`, `partID`, `field`, `delta` | `v1/S/v1/session.ts:624`, `session.ts:884` |
| `session.status` | 상태가 바뀔 때 | `sessionID`, `status`(`idle` / `busy` / `retry{attempt,message,action?,next}`) | `v1/S/session-status-event.ts`, publish `v1/O/session/status.ts:41` |
| `session.idle` | status가 idle이 될 때. 코드에 `// deprecated` 표시 | `sessionID` | `v1/S/session-status-event.ts:43-50`, `status.ts:43` |
| `session.compacted` | compact가 끝났을 때 | `sessionID` | `v1/S/session-compaction-event.ts`, publish `v1/O/session/compaction.ts:554` |
| `session.diff` | 변경 파일 diff가 계산되거나 revert로 바뀔 때 | `sessionID`, `diff[]` | `v1/S/v1/session.ts:635`, `session/summary.ts:114`, `session/revert.ts:78` |
| `session.error` | 오류가 났을 때(model 오류, abort, context overflow, plugin 로드 실패 등 여러 곳) | `sessionID?`, `error`(`name` + `data`. 이름: `APIError`, `ProviderAuthError`, `MessageAbortedError`, `MessageOutputLengthError`, `ContextOverflowError`, `StructuredOutputError`, `ContentFilterError`) | `v1/S/v1/session.ts:643, 30-60`, `v1/O/session/processor.ts:625-634`, `session/prompt.ts` 여러 곳 |
| `command.executed` | slash command 실행 뒤 | `name`, `sessionID`, `arguments`, `messageID` | `v1/S/v1/legacy-event.ts`, `session/prompt.ts:1474` |
| `todo.updated` | todo tool로 목록이 바뀔 때 | `sessionID`, `todos[]`(content, status, priority) | `v1/S/session-todo.ts`, `v1/O/session/todo.ts:50` |

#### 권한, 질문

| event | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `permission.asked` | tool이 승인을 물을 때 | `id`, `sessionID`, `permission`, `patterns[]`, `metadata`, `always[]`, `tool{messageID,callID}` | `v1/S/v1/permission.ts:61`, publish `v1/O/permission/index.ts:100` |
| `permission.replied` | 답을 받았을 때 | `sessionID`, `requestID`, `reply`(`once` / `always` / `reject`) | `permission/index.ts:115,132,160` |
| `question.asked` | question tool이 사람에게 물을 때 | `id`, `sessionID`, `questions[]`, `tool?` | `v1/S/v1/question.ts:58`, `v1/O/question/index.ts:104` |
| `question.replied` / `question.rejected` | 답하거나 거절했을 때 | `sessionID`, `requestID`, (`answers`) | `question/index.ts:126,143` |
| `permission.v2.asked` / `.replied`, `question.v2.asked` / `.replied` / `.rejected` | V2 쪽 권한/질문 service용 이름. 누가 publish하는지는 확인 못함 | V1 것과 같은 모양 | `v1/S/permission.ts:43`, `v1/S/question.ts:70` |

#### session.next.* (V2 runner 계열이 V1 안에 들어온 것)

`session.next.agent.switched`, `.model.switched`, `.moved`, `.prompt.admitted`, `.prompted`, `.context.updated`, `.step.started/ended/failed`, `.text.started/delta/ended`, `.reasoning.started/delta/ended`, `.tool.input.started/delta/ended`, `.tool.called/progress/success/failed`, `.retried`, `.compaction.started/delta/ended`, `.shell.started/ended`, `.synthetic`, `.revert.staged/committed/cleared`. 대부분 durable, `*.delta`와 `tool.progress`는 ephemeral. 정의: `v1/S/session-event.ts`. publish는 `v1/C/session/runner/*`, `session/input.ts`, `session/compaction.ts`에서 한다. `v1/O/session/prompt.ts`/`processor.ts` 쪽 기본 대화 경로는 위 V1 이름(`message.*`)을 publish한다. 두 경로가 한 대화에서 같이 나는지는 확인 못함.

#### 그 밖

| event | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `file.edited` | edit, write, apply_patch tool이 파일을 고쳤을 때 | `file` | `v1/S/v1/filesystem.ts`, `v1/O/tool/edit.ts:115` 외 |
| `file.watcher.updated` | file watcher 또는 같은 tool들 | `file`, `event`(add/change/unlink) | `v1/S/filesystem-watcher.ts` |
| `lsp.updated` | LSP client 상태가 바뀔 때 | 없음 | `v1/S/lsp-event.ts`, `v1/O/lsp/lsp.ts:293` |
| `vcs.branch.updated` | git branch가 바뀔 때 | `branch?` | `v1/S/vcs-event.ts`, `v1/O/project/vcs.ts:328` |
| `installation.updated` / `installation.update-available` | 업데이트 됐을 때 / 새 버전이 있을 때 | `version` | `v1/S/installation-event.ts` |
| `project.updated` | project 정보가 바뀔 때 | project info | `v1/S/project.ts` |
| `project.directories.updated`, `reference.updated`, `catalog.updated`, `models-dev.refreshed`, `plugin.added`, `integration.updated`, `integration.connection.updated` | 목록이 바뀌었다는 신호 | 대부분 field 없음 | `v1/S/` 각 파일 |
| `pty.created/updated/exited/deleted` | 터미널(pty) lifecycle | `info` 또는 `id`, `exitCode` | `v1/S/pty.ts:34-37` |
| `mcp.tools.changed`, `mcp.browser.open.failed` | MCP server tool이 바뀔 때, OAuth용 browser를 못 열었을 때 | `server` / `mcpName`, `url` | `v1/S/mcp-event.ts` |
| `worktree.ready/failed`, `workspace.ready/failed/status` | worktree, workspace 준비 결과와 연결 상태 | `name`, `branch?`, `message`, `workspaceID`, `status` | `v1/S/worktree-event.ts`, `workspace-event.ts` |
| `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `tui.session.select` | TUI를 원격 조작하는 신호 | `text` / `command` / `title,message,variant,duration` / `sessionID` | `v1/S/tui-event.ts` |
| `ide.installed` | IDE 확장을 설치했을 때 | `ide` | `v1/S/ide-event.ts` |
| `server.connected`, `server.heartbeat`, `server.instance.disposed`, `global.disposed` | SSE 연결 신호와 instance 종료 | 없음 | `v1/O/.../handlers/event.ts`, `global.ts`, `v1/S/server-event.ts` |

참고: plugin 문서(`v1 packages/web/src/content/docs/plugins.mdx:142-210`)는 `lsp.client.diagnostics`도 event로 적는다. 현재 source의 event 정의에서는 찾지 못했고 옛 SDK 생성 타입(`packages/sdk/js/src/gen/types.gen.ts`)에만 있다. 문서가 `tool.execute.before`, `shell.env`를 "event" 아래에 같이 적었지만 이것들은 bus event가 아니라 hook이다.

### 1.3 plugin hook 표 (V1)

`Hooks` interface 전체. 모든 hook은 `(input, output)`을 받고 `output`을 고치는 식이다. 같은 이름 hook이 여러 plugin에 있으면 등록 순서대로 하나씩 await한다(`v1/O/plugin/index.ts:284-297`). hook이 throw하면 아래 "막기/바꾸기" 칸처럼 호출한 쪽 동작에 영향을 준다.

| hook | 통로 | 언제 나는가 | 주요 field | 막기/바꾸기 | 근거 |
|---|---|---|---|---|---|
| `event` | plugin hook | bus의 모든 event(같은 directory 것) | `{ event: { id, type, properties } }` | 불가(관찰) | `v1/O/plugin/index.ts` (`events.listen`) |
| `config` | plugin hook | plugin 로드 뒤 config를 알릴 때 | config | config 객체를 고칠 수 있음 | 같은 파일 |
| `dispose` | plugin hook | plugin을 내릴 때 | 없음 | - | 같은 파일 |
| `tool` | plugin 등록 | custom tool 정의 | - | tool 추가 | `packages/plugin/src/index.ts:226` |
| `auth`, `provider` | plugin 등록 | 인증 방법과 model provider 추가 | - | - | 같은 파일 |
| `chat.message` | plugin hook | user message를 만들 때(저장 전) | in: `sessionID, agent?, model?, messageID?, variant?` / out: `message, parts` | message와 parts를 바꿈 | `v1/O/session/prompt.ts:999` |
| `command.execute.before` | plugin hook | slash command 실행 전 | in: `command, sessionID, arguments` / out: `parts` | parts를 바꿈 | `prompt.ts:1460` |
| `chat.params` | plugin hook | model 호출 직전 | in: `sessionID, agent, model, provider, message` / out: `temperature, topP, topK, maxOutputTokens, options` | 값 변경 | `v1/O/session/llm/request.ts:114` |
| `chat.headers` | plugin hook | 같은 요청의 header 만들 때 | out: `headers` | 변경 | `request.ts:134` |
| `experimental.chat.system.transform` | plugin hook | system prompt 만들 때 | out: `system[]` | 변경 | `request.ts:69`, `v1/O/agent/agent.ts:381` |
| `experimental.chat.messages.transform` | plugin hook | model에 보낼 message 목록 만들 때, compact 때 | out: `messages[]` | 변경 | `prompt.ts:1255`, `compaction.ts:379` |
| `tool.definition` | plugin hook | tool 정의(description, parameters)를 model에 줄 때 | in: `toolID` / out: `description, parameters` | 변경 | `v1/O/tool/registry.ts:318` |
| `tool.execute.before` | plugin hook | tool 실행 직전 | in: `tool, sessionID, callID` / out: `args` | `args` 변경. throw하면 tool을 실행하지 않고 오류가 된다(공식 문서 예제 ".env protection") | `v1/O/session/tools.ts:106` 외, `prompt.ts:307`(subtask), `tool/code-mode.ts:141` |
| `tool.execute.after` | plugin hook | tool 실행 직후 | in: `tool, sessionID, callID, args` / out: `title, output, metadata` | 결과 변경 | `tools.ts:121` 외, `prompt.ts:389` |
| `shell.env` | plugin hook | shell tool, 사용자 shell, pty를 띄울 때 | in: `cwd, sessionID?, callID?` / out: `env` | env 추가 | `v1/O/tool/shell.ts:417`, `prompt.ts:554`, `plugin/pty-environment.ts:18` |
| `permission.ask` | plugin hook | 타입에는 있음(`status: ask/deny/allow`). trigger 호출 위치는 찾지 못함 | `Permission`, `status` | 확인 못함 | `packages/plugin/src/index.ts:261` |
| `experimental.session.compacting` | plugin hook | compact 시작 전 | in: `sessionID` / out: `context[]`, `prompt?` | 프롬프트 추가나 교체 | `v1/O/session/compaction.ts:373` |
| `experimental.compaction.autocontinue` | plugin hook | compact 성공 뒤, 자동 "continue" message를 넣기 전 | in: `sessionID, agent, model, provider, message, overflow` / out: `enabled` | 끌 수 있음 | `compaction.ts:500` |
| `experimental.text.complete` | plugin hook | text part가 끝났을 때 | in: `sessionID, messageID, partID` / out: `text` | text 변경 | `v1/O/session/processor.ts:530` |
| `experimental.provider.small_model` | plugin hook | 보조용 작은 model 고를 때 | out: `model?` | 변경 | `v1/O/provider/provider.ts:1975` |

### 1.4 SSE (`opencode serve`)

| 경로 | 내용 | 근거 |
|---|---|---|
| `GET /event` | instance(directory) 하나의 bus event. 첫 event `server.connected`, 그 뒤 bus event, 10초마다 `server.heartbeat`, `server.instance.disposed`가 오면 끝난다. 각 줄은 `{ id, type, properties }`. directory/workspace로 걸러 보낸다. | `v1/O/server/routes/instance/httpapi/handlers/event.ts`, `server.mdx:275-281` |
| `GET /global/event` | 모든 instance event를 `{ directory, project, workspace, payload }`로 감싸 보낸다. durable event는 `payload.type: "sync"` + `syncEvent{ id, type(버전 붙음), seq, aggregateID, data }`가 한 번 더 온다. | `.../handlers/global.ts`, `v1/O/event-v2-bridge.ts` |
| `GET /api/event` | V2 모양(`{ id, type, data, ... }`). 첫 event `server.connected`, 15초마다 `: heartbeat` 주석. `OpenCodeEvent` schema(`EventManifest.ServerDefinitions`)로 인코딩. | `packages/server/src/handlers/event.ts`, `packages/protocol/src/groups/event.ts` |

SSE는 구독한 뒤 생긴 event만 준다. 끊긴 동안 놓친 event를 되받는 방법은 이 경로들에 없다(`/event`). V2 로그 읽기는 1.5 참고.

### 1.5 session 상태와 저장

- 상태 값: `idle`, `busy`, `retry`(`attempt`, `message`, `action?`, `next`). 근거 `v1/S/session-status-event.ts:8-37`.
- 상태는 **메모리 Map**이다(instance 상태). idle이면 Map에서 지우고 `get`은 기본값 idle을 돌려준다. 근거 `v1/O/session/status.ts:27-45`.
- busy로 바뀌는 때: runner가 busy가 될 때(`v1/O/session/run-state.ts:64`)와 model 호출 시작 때(`processor.ts:653`). idle: runner가 비었을 때(`run-state.ts:62`), cancel, 오류로 멈출 때(`processor.ts:626,638`). retry: 재시도 정책이 다음 시도를 잡을 때(`processor.ts:679`).
- 저장: durable event는 SQLite `event` 표(`id, aggregate_id, seq, type, data`)에 **항상** 쓰이고(`v1/C/event.ts:337`), projector가 session/message/part/todo 표를 갱신한다(`v1/C/session/sql.ts`). DB 파일은 `<xdg data>/opencode/opencode.db`(`v1/C/database/database.ts:53`, `v1/C/global.ts:11`). ephemeral event(`message.part.delta`, `session.status`, `session.idle`, `session.error`, `permission.*`, `question.*`, `file.*`, `pty.*` 등)와 session 상태는 메모리뿐이다.
- 질문, 권한 승인("always")은 `PermissionTable`에 저장된다(`v1/C/permission/sql.ts`). 요청 자체(`permission.asked`)는 event로 남지 않는다.

---

## 2. OpenCode V2 (`dev`)

### 2.1 통로

| 통로 | 내용 | 근거 |
|---|---|---|
| bus | `Bus` service. `publish`, `subscribe`, `log`(durable 읽기). 모든 event가 `{ id, type, created, data, location?, metadata?, durable? }` 모양 | `v2/C/bus.ts`, `v2/S/event.ts` |
| plugin hook | `ctx.<domain>.hook(name, cb)`. domain: `aisdk`, `session`, `permission`, `shell`, `tool` | `v2/C/plugin/hooks.ts`, `v2/P/effect/*.ts` |
| plugin 구독 | `ctx.event.subscribe()` (공개 event stream을 AsyncIterable로) | `v2/P/effect/event.ts`, 문서 `build/plugins/index.mdx:1273` |
| plugin transform | 상태를 고치는 `transform`(agent, command, integration, mcp, model, provider, reference, skill, tool, vcs, websearch). lifecycle이 아니라 설정 편집이라 event 표에서는 뺀다 | `v2/P/README.md` |
| SSE | `GET /api/event`, durable 로그는 `GET /api/experimental/session/:sessionID/log` | `packages/server/src/handlers/event.ts`, `packages/protocol/src/groups/session.ts:726` |

### 2.2 bus event 표

`D` = durable, `E` = ephemeral. `SSE` 칸은 `/api/event`로 나가는지(= `EventManifest.ServerDefinitions` 포함 여부, `v2/S/event-manifest.ts:62-80`). 모든 bus event는 구독자가 막거나 바꿀 수 없다(관찰 전용). 막거나 바꾸는 것은 2.3.

#### session lifecycle와 설정 (모두 D, SSE 나감)

| event | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `session.created` | session 생성. subagent도 이것으로 생기며 `parentID`가 채워진다 | `sessionID, projectID, location, subpath?, parentID?, slug, title?, agent?, model?, metadata?, permissions?, version` | `v2/S/session-event.ts:49` |
| `session.forked` | fork | `sessionID, parentID, boundary, instructions?` | `:188` |
| `session.moved` | 다른 location으로 이동 | `sessionID` + 이동 정보 | `:92` |
| `session.renamed` | title 변경 | `sessionID, title` | `:102` |
| `session.metadata.updated` | metadata 변경 | `sessionID, metadata` | `:112` |
| `session.permissions` | session 권한 규칙 변경 | `sessionID, permissions` | `:122` |
| `session.agent.selected` / `session.model.selected` | agent, model 전환 | `sessionID, agent|model, previous?` | `:70,81` |
| `session.viewed` | 사람이 session을 봤다는 표시 | `sessionID, idle`(본 idle 시각) | `:132` |
| `session.deleted` | 삭제 | `sessionID` | `:178` |
| `session.instructions.updated` | AGENTS.md 같은 instruction이 바뀜 | `sessionID, delta, text?` | `:262` |
| `session.skill.activated` | skill 켜짐 | `sessionID, id, name, text` | `:293` |
| `session.shell.started` / `session.shell.ended` | 사용자가 session 안에서 shell 명령을 돌릴 때 | `sessionID, shell`, (`output`) | `:307,317` |
| `session.revert.staged` / `.cleared` / `.committed` | 되돌리기 준비, 취소, 확정 | `sessionID`, `revert` / `to` | `:640-650` |
| `session.synthetic` | 사람이 아닌 쪽이 session에 넣는 message. subagent 완료 알림이 이것(`metadata.source = "subagent"`) | `sessionID, text, description?, metadata?` | `:280`, `v2/C/session/subagent-completion.ts:30-41` |

#### 입력, 실행, 대화 흐름

| event | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `session.inbox.enqueued` (D) | prompt 접수. 사람 입력은 `item.type = "user"`, 그 밖에 `synthetic`, `compaction`, `move`. `delivery`는 `steer` / `queue` | `sessionID, inboxID, item` | `:216`, `v2/S/session-inbox.ts` |
| `session.inbox.delivered` (D) | 접수한 입력이 실제 message로 session에 들어갈 때(projector가 user message 행을 만든다) | `sessionID, inboxID` | `:209`, `v2/C/session/projector.ts:618` |
| `session.inbox.cancelled` / `session.inbox.delivery.changed` (D) | 취소, delivery 변경 | `sessionID, inboxID`, (`delivery`) | `:226,233` |
| `session.execution.started` (D) | session이 busy period가 시작될 때 | `sessionID` | `:240`, publish `v2/C/session/execution.ts:115` |
| `session.execution.succeeded` / `.failed` / `.interrupted` (D) | busy period가 끝날 때. 이어 붙은 drain 여러 번을 묶어 **한 번만** 낸다 | `sessionID`, (`error`), (`reason`: `user` / `shutdown` / `superseded` / `inactivity`) | `:243-258`, `execution.ts:125-160` |
| `session.step.started` (D) | model 요청을 보낼 때(응답 기다리기 전) | `sessionID, assistantMessageID, agent, model, snapshot?, started` | `:330` |
| `session.step.streamed` (D) | provider 응답 body가 끝난 때 | `sessionID, assistantMessageID` | `:346` |
| `session.step.ended` (D) | step 끝 | `finish`, `rawFinish?`, `cost`, `tokens`, `snapshot?`, `files?` | `:356` |
| `session.step.failed` (D) | step 실패 | `error`, `finish?`, `cost?`, `tokens?`, `files?` | `:373` |
| `session.text.started` / `.ended` (D), `session.text.delta` (E) | assistant text 블록 | `assistantMessageID, ordinal`, (`text` / `delta`) | `:393-416` |
| `session.reasoning.started` / `.ended` (D), `.delta` (E) | reasoning 블록 | 같음 | `:431-455` |
| `session.tool.input.started` / `.ended` (D), `.delta` (E) | model이 tool 입력을 쓰는 중 | `assistantMessageID, id, name`, (`delta` / `text`) | `:477-497` |
| `session.tool.called` (D) | tool 입력이 완성돼 호출될 때 | `id, input, executed, state?` (`executed`: provider가 직접 실행했는지) | `:508` |
| `session.tool.progress` (E) | 실행 중 metadata | `id, metadata` | `:521` |
| `session.tool.success` (D) | tool 성공 | `id, content[], metadata?, executed` | `:531` |
| `session.tool.failed` (D) | tool 실패 | `id, error, content?, metadata?, executed` | `:552` |
| `session.retry.scheduled` (D) | provider 오류 뒤 재시도를 잡을 때 | `assistantMessageID, attempt, at, error` | `:570`, publish `v2/C/session/runner/retry.ts:104` |
| `session.compaction.started` / `.ended` / `.failed` (D), `.delta` (E) | compact 시작, 요약 스트림, 끝, 실패 | `reason`(`auto` / `manual`), `recent`, `text`, `cost`, `tokens`, `error` | `:584-624` |
| `session.usage.updated` (E) | 누적 비용, token 갱신 | `sessionID, cost, tokens` | `:168` |
| `session.usage.recorded` (D), `session.message.content.updated` (D) | 내부, 옛 replay용. 공개 manifest에서 뺐다 | - | `:156,144,694-700` (`DurableDefinitions`) |

#### 권한, 질문(form), 알림

| event | 언제 | 주요 field | 근거 |
|---|---|---|---|
| `permission.asked` (E, SSE) | 권한이 `ask`로 정해져 사람에게 물을 때 | `id, sessionID, action, resources[], save?, metadata?, source?{type:"tool", messageID, id}, message?` | `v2/S/permission.ts:45`, publish `v2/C/permission.ts:217` |
| `permission.replied` (E, SSE) | 답이 왔을 때 | `sessionID, requestID, reply`(`once` / `always` / `reject`) | `permission.ts:137,270,284,315` |
| `form.created` / `form.replied` / `form.cancelled` (E, SSE) | 사람에게 묻는 form(질문). V1의 `question.*` 자리 | `form` / `id, sessionID, answer` | `v2/S/form.ts:173-175`, `v2/C/form.ts:188` |
| `tui.toast.show` (E, SSE) | toast 요청 | `title?, message, variant, duration` | `v2/S/tui-event.ts` |

#### session.status, session.idle, session.compacted

`session.status`(`idle`/`busy`/`retry`), `session.idle`(코드에 `// deprecated`), `session.compacted`는 V2 manifest에 정의되어 있고 SSE 대상에도 들어 있다. 그러나 `packages/` 안(core, server, protocol, cli)에서 이 event를 publish하는 코드를 찾지 못했다(검색: `SessionStatus`, `session.status`, `session.idle`, `session.compacted`; 걸리는 것은 schema 정의, client 생성 타입, e2e fixture뿐). V2 client는 상태를 `session.execution.*`에서 계산한다(`packages/client/src/solid/data.ts:54,1016`: `"idle" | "running"`). 근거 `v2/S/session-status-event.ts`, `session-compaction-event.ts`.

#### resource, 환경 변경 신호 (거의 모두 E, SSE 나감, field는 대부분 없음)

`location.shutdown`, `models-dev.refreshed`, `credential.updated`, `credential.switched{integrationID, credentialID|null}`, `integration.updated`, `provider.updated`, `model.updated`, `agent.updated`, `command.updated`, `skill.updated`, `reference.updated`, `plugin.updated`, `config.updated`, `websearch.updated`, `project.updated`(project info), `worktree.updated{projectID}`, `worktree.resolved`(D), `filesystem.changed{file, event: add/change/unlink}`, `vcs.branch.updated{branch?}`, `installation.updated`, `installation.update-available`, `mcp.status.changed{server}`, `mcp.resources.changed{server}`, `pty.created/updated/exited/deleted`, `persistent-pty.added/removed`, `shell.created/exited/deleted`, `tui.prompt.append`, `tui.command.execute`, `tui.session.select`. 근거: `v2/S/*.ts` 각 파일, 목록 `v2/S/event-manifest.ts`.

SSE에 안 나가는 것(bus에는 있음): `lsp.updated`, `mcp.tools.changed`, `workspace.ready/failed/status`, `worktree.ready/failed`, `command.executed`, `file.edited`, `server.disposed` 계열(`global.disposed`), `sdk.plugin.updated`, `wellknown.updated`, `instruction-discovery.updated`, `mcp.prompts.changed`(core 내부 event). 근거 `v2/S/event-manifest.ts:82-103`(`Definitions`와 `ServerDefinitions` 차이), `v2/C/wellknown.ts:60`, `v2/C/instruction-discovery.ts:20`, `v2/C/plugin/sdk.ts:9`, `v2/C/mcp/index.ts:24`.

### 2.3 plugin hook 표 (V2)

hook은 한 개의 mutable event 객체를 받는다. 등록 순서대로 하나씩 await하고, 뒤 hook은 앞 hook이 바꾼 값을 본다(`v2/C/plugin/hooks.ts` `trigger`). 실패 channel은 `tool.execute.before`만 있다(`Failures`, `hooks.ts:21-27`).

| hook | 통로 | 언제 나는가 | 주요 field | 막기/바꾸기 | 근거 |
|---|---|---|---|---|---|
| `session.prompt` | plugin hook | 사람/command 입력을 inbox에 받기 전(admission). 한 번만 | `sessionID, messageID, prompt{text,files,agents,skills}, metadata, delivery` | prompt, metadata, delivery 변경. 거절 API 없음 | `v2/C/session/prompt.ts:40`, 문서 `index.mdx:1339-1354` |
| `session.context` | plugin hook | agent loop의 model 요청 직전 | `sessionID, model, agent, system[], messages[], options, tools` | system, messages, options, tools를 바꿈(저장된 기록은 안 바뀜) | `v2/C/session/model-request.ts:424` |
| `session.compaction` | plugin hook | compact용 model 요청 직전 | context와 같음 + `result?` | `result`를 채우면 model 호출 없이 그것을 요약으로 씀 | `model-request.ts:424`, `v2/P/effect/session.ts:34-37` |
| `session.generate`, `session.title` | plugin hook | 일반 생성 요청, title 생성 요청 직전 | 위와 같음 (`title`은 `result?`) | 변경, `title`은 `result`로 대체 | `model-request.ts:428-430` |
| `session.model.request` | plugin hook | 모든 model 요청마다, route 정한 뒤 | `sessionID, agent, model, kind(primary/compaction/title/generate), baseURL?, headers` | baseURL, headers 변경 | `model-request.ts:305` |
| `session.http.request` / `session.http.response` | plugin hook | provider HTTP 요청 직전, 응답 직후 | `request` / `request, response` | 요청, 응답 객체 교체 | `model-request.ts:343,355` |
| `session.experimental.ws.handshake` / `.send` / `.receive` | plugin hook | WebSocket 연결, 보내는 frame, 받는 frame | `url, headers` / `frame` | 변경 (실험 중) | `v2/P/effect/session.ts:80-110` |
| `session.retry` | plugin hook | provider 오류 뒤 재시도할지 정할 때 | `sessionID, agent, model, error, attempt, decision` | `decision`으로 재시도 여부와 delay 변경 | `model-request.ts:399` |
| `permission.evaluate` | plugin hook | 설정된 규칙으로 `allow`/`ask`가 나온 뒤, 승인 prompt를 내기 전 | `sessionID, agent?, action, resources[], metadata?, source?, effect, message?` | `effect`를 allow/ask/deny로 바꿈. 설정이 `deny`면 hook을 부르지 않는다 | `v2/C/permission.ts:179`, 문서 `index.mdx:1560-1590` |
| `tool.execute.before` | plugin hook | tool 실행 직전 | `tool, sessionID, agent, messageID, id, input` | `input` 변경. `Tool.Error`를 반환하면 호출을 거절 | `v2/C/tool.ts:104`, `v2/P/effect/tool.ts:25-33` |
| `tool.execute.after` | plugin hook | tool 실행 직후(성공이든 실패든) | 위 + `status: completed` + `result` / `status: error` + `error` | `result` 변경(실패 channel 없음) | `tool.ts:137,149` |
| `shell.create.before` | plugin hook | shell 프로세스를 띄우기 전 | `command, cwd, timeout, shell, env` | 모두 변경 | `v2/C/shell.ts:274` |
| `aisdk.sdk` / `aisdk.language` | plugin hook | AI SDK 객체, language model을 만들 때 | `model, package, options, sdk?` / `language?` | 객체 교체 | `v2/P/effect/aisdk.ts` |

V1 hook 중 V2에 바로 대응하는 것이 없는 것: `experimental.compaction.autocontinue`, `experimental.provider.small_model`, `experimental.text.complete`, `command.execute.before`(문서가 직접 적음, `migrate-v1.mdx`).

### 2.4 SSE

- `GET /api/event` 하나뿐이다(V1의 `/event`, `/global/event`는 V2 server 코드에서 찾지 못함). 모든 location의 공개 event를 `data: <JSON>\n\n`로 보낸다. 첫 event `server.connected`, 15초마다 `: heartbeat`. 근거 `packages/server/src/handlers/event.ts`, `packages/server/src/event-feed.ts`.
- 보내는 event: `server.connected`, `ServerDefinitions`에 든 것, `rpc.*`(plugin RPC event). 근거 `packages/protocol/src/groups/event.ts:73`.
- 놓침: 구독자 큐가 4096개(`SubscriberCapacity`)를 넘으면 그 구독자의 stream이 오류로 끝난다. 끊긴 동안의 event는 못 받는다. 문서 설명이 "Volatile by contract"(`event.ts:51`).
- durable 로그: `GET /api/experimental/session/:sessionID/log?after=<seq>&follow=<bool>`. `seq` 뒤부터 durable event를 읽고 `follow=true`면 이어서 live. 근거 `packages/protocol/src/groups/session.ts:726-743`. 아래 2.5의 persist가 꺼져 있을 때 과거 로그가 어떻게 되는지는 확인 못함.

### 2.5 session 상태와 저장

- 상태 값 (`session.status` 정의): `idle`, `busy`, `retry`(`attempt, message, action?, next`). 하지만 위 2.2처럼 publish 코드를 못 찾았다. 실제로 쓰는 상태는 두 가지다.
  - client 계산: `idle` / `running`(`packages/client/src/solid/data.ts:54`).
  - DB 열: `session_v2.time_idle`(마지막으로 idle이 된 시각), `idle_outcome`(`succeeded` / `failed` / `interrupted`), `time_suspended`(실행 claim). `execution.succeeded/failed/interrupted`마다 projector가 갱신한다. 단 `interrupted` 중 `reason = "shutdown"`은 갱신하지 않는다. 근거 `v2/C/session/sql.ts:22-70`, `v2/C/session/projector.ts:409-440`, `v2/S/session.ts:43-48`.
- durable event: `Bus.publish` 때 같은 transaction 안에서 projector가 session 표들(`session_v2`, `session_message`, `session_inbox` 등, `v2/C/session/sql.ts`)을 갱신한다. aggregate는 `sessionID`, 순서번호 `seq`가 붙는다.
- event 원본 행(`event` 표: `id, aggregate_id, seq, created, type, data`, `v2/C/event/sql.ts`)은 `persist` 옵션이 켜졌을 때만 쓴다. 기본값 `false`(`v2/C/bus.ts:203`). 켜는 곳은 `packages/server/src/workerd.ts:69`뿐이고 `packages/cli/src`에서는 켜는 코드를 찾지 못했다.
- ephemeral event는 메모리 PubSub뿐이다(`v2/C/bus.ts` `notify`).
- DB 파일: data 폴더 아래 `opencode.db`(채널별 이름이 다를 수 있음, `packages/cli/src/database-path.ts`).
- 정리: 로컬 CLI 기본 설정에서 V2는 "event 원본"이 아니라 "event를 반영한 결과 표"를 남긴다(원본은 persist 때만).

---

## 3. Pi coding agent (`pi`, coding-agent 1.2.0)

### 3.1 통로

| 통로 | 내용 | 근거 |
|---|---|---|
| session event | `AgentSessionEvent`. SDK `session.subscribe()`로 받고, `--mode json`, `--mode rpc`의 stdout으로 나간다. rpc/json은 `message_update`만 `partial`을 뺀다 | `pi/CA/src/core/agent-session.ts:196-237`, `pi/CA/src/modes/rpc/rpc-mode.ts:355`, `pi/CA/src/modes/json-event.ts`, 문서 `pi/CA/docs/json.md` |
| rpc 전용 record | `response`(명령 결과), `extension_ui_request`/`extension_ui_response`, `extension_error` | `pi/CA/docs/rpc.md`, `rpc-extension-ui.md`, `rpc-mode.ts:349` |
| extension event | `pi.on(name, handler)`. 프로세스 안, 순서대로 await. 일부는 결과로 막거나 바꾼다 | `pi/CA/src/core/extensions/types.ts:1597-1664` |
| extension 사이 bus | `pi.events`(`emit(channel, data)`, `on(channel, handler)`). channel 이름은 자유 | `pi/CA/src/core/event-bus.ts` |
| rpc 명령(입력 쪽) | `prompt`, `steer`, `follow_up`, `abort`, `compact`, `new_session`, `switch_session`, `fork` 등 | `pi/CA/docs/rpc-commands.md` |

rpc의 stdout은 JSONL(줄 하나가 JSON 하나, LF로 끝). extension event는 rpc 선로에는 나가지 않는다. 대신 extension handler가 throw하면 `extension_error{extensionPath, event, error}` 한 줄이 나간다(`json.md` "RPC-only events").

### 3.2 session event 표 (rpc `--mode rpc` / json 에서 보이는 것)

모두 읽기 전용이다. rpc client가 값을 돌려줘 막을 수는 없고, 흐름을 바꾸려면 명령(`abort`, `steer` 등)을 따로 보낸다. "막기/바꾸기"는 같은 이름의 extension event를 3.3에서 본다.

| event | 통로 | 언제 나는가 | 주요 field | 근거 |
|---|---|---|---|---|
| `agent_start` | session event | 저수준 agent run 시작 | 없음 | `pi/A/src/agent-loop.ts:117,146`, `docs/json.md` |
| `agent_end` | session event | 그 run 끝. 재시도, overflow 복구, compact, steering, follow-up이 이어질 수 있다 | `messages[]`, `willRetry` | `agent-session.ts:199`, `docs/json.md` |
| `agent_settled` | session event | 자동으로 더 이어질 일이 없다고 확정될 때. 호출하는 쪽이 "끝났다"를 알려면 이것을 기다리라고 문서가 적음 | `aborted` | `agent-session.ts:1084-1085`, `docs/rpc.md` "Run lifecycle" |
| `turn_start` | session event | assistant 응답 한 번(turn) 시작 | 없음 | `agent-loop.ts:118,147,207` |
| `turn_end` | session event | 응답 한 번과 그 tool 결과까지 끝 | `message`, `toolResults[]` | `agent-loop.ts:253,287` |
| `message_start` / `message_end` | session event | user, assistant, toolResult message 시작과 끝. `message_end`가 최종 확정본 | `message` | `agent-loop.ts:120-121,212-213,420,454`, `docs/json.md` |
| `message_update` | session event | assistant message 스트리밍 중 | `usage`, `assistantMessageEvent`(`text_start/delta/end`, `thinking_start/delta/end`, `toolcall_start/delta/end`, `start`, `done`, `error`) | `agent-loop.ts:435`, `docs/json.md` |
| `tool_execution_start` | session event | tool 실행 시작 | `toolCallId, toolName, args`, `parentToolCallId?` | `agent-loop.ts:484,542,597` |
| `tool_execution_update` | session event | tool이 중간 결과를 낼 때 | `toolCallId, toolName, args, partialResult` | `agent-loop.ts:781` |
| `tool_execution_end` | session event | tool 실행 끝 | `toolCallId, toolName, result, isError, durationMs?` | `agent-loop.ts:920` |
| `queue_update` | session event | steering/follow-up queue가 바뀔 때 | `steering[]`, `followUp[]` | `agent-session.ts:1047` |
| `entry_appended` | session event | extension이 `pi.appendEntry()` 등으로 session entry를 추가했을 때 | `entry` | `agent-session.ts:834,1027,1253` |
| `session_info_changed` | session event | session 이름이 바뀔 때 | `name?` | `agent-session.ts:3969` |
| `thinking_level_changed` | session event | thinking level이 바뀔 때 | `level` | `agent-session.ts:2653` |
| `compaction_start` | session event | compact 시작 | `reason`(`manual` / `threshold` / `overflow`) | `agent-session.ts:2792,3144` |
| `compaction_end` | session event | compact 끝(성공, 취소, 실패) | `reason`, `result?{summary, firstKeptEntryId, tokensBefore, ...}`, `aborted`, `willRetry`, `errorMessage?` | `agent-session.ts:213-220` |
| `auto_retry_start` / `auto_retry_end` | session event | assistant turn의 자동 재시도 시작과 끝 | `attempt, maxAttempts, delayMs, errorMessage` / `success, attempt, finalError?` | `agent-session.ts:3804`, `docs/json.md` |
| `summarization_retry_scheduled` / `summarization_retry_attempt_start` / `summarization_retry_finished` | session event | compact나 branch 요약의 재시도 | `attempt, maxAttempts, delayMs, errorMessage` / `source`, `reason?` | `agent-session.ts:223-236` |
| `bash_execution_update` | session event (rpc의 `bash` 명령용) | rpc `bash` 명령이 출력 chunk를 낼 때 | `id?`, `delta` | `agent-session.ts:237`, `docs/json.md` |
| `extension_error` | rpc 전용 | extension handler가 throw했을 때 | `extensionPath, event, error` | `rpc-mode.ts:349` |
| `extension_ui_request` (+ `extension_ui_response`) | rpc 전용 | extension이 `ctx.ui`의 `select`/`confirm`/`input`/`editor`를 부르면 요청이 나가고 client가 `id`로 답한다. `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`는 답이 필요 없다 | `id`, `method`, `title`, `options` 등 | `pi/CA/docs/rpc-extension-ui.md` |
| `response` | rpc 전용 | 명령 하나의 결과. `prompt`의 성공은 "받았다"는 뜻이고 `data.disposition`이 `started` / `queued` / `handled` | `id?, command, success, data? / error` | `docs/rpc.md`, `docs/rpc-commands.md` `prompt` |

assistant message의 `stopReason` 값: `pending`, `stop`, `length`, `toolUse`, `error`, `aborted`, `deferred`(`packages/ai/src/types.ts:469`). provider 오류와 abort는 별도 error event가 아니라 `message_end`의 `stopReason`과 `agent_end`/`agent_settled.aborted`로 드러난다(`docs/rpc.md` "Errors").

### 3.3 extension event 표

`pi.on(name, handler)`. handler가 돌려주는 값이 있는 것만 "막기/바꾸기"에 쓴다. 이름 옆 `(=)`는 3.2의 session event와 같은 이름이다(extension이 먼저 받고 그 뒤 listener에게 간다: `agent-session.ts:1143-1144` "Emit to extensions first, then notify public listeners"). 근거는 모두 `pi/CA/src/core/extensions/types.ts`(줄 번호는 interface 정의)와 문서 `pi/CA/docs/extensions.md`.

| event | 언제 | 주요 field | 막기/바꾸기 | 줄 |
|---|---|---|---|---|
| `project_trust` | project 확장을 불러오기 전 | `cwd` | `trusted: yes/no/undecided`, `remember?`를 돌려 결정 | 700 |
| `resources_discover` | `session_start` 뒤 | `cwd`, `reason`(startup/reload) | `skillPaths`, `promptPaths`, `themePaths` 추가 | 725 |
| `session_start` | session을 열 때(시작, 새로 만들기, 이어하기, fork, reload) | `reason`(startup/reload/new/resume/fork), `previousSessionFile?` | 관찰 | 755 |
| `session_before_switch` | 다른 session으로 바꾸기 전 | `reason`(new/resume), `targetSessionFile?` | `cancel` | 771 |
| `session_before_fork` | fork 전 | `entryId`, `position` | `cancel`, `skipConversationRestore` | 778 |
| `session_before_compact` | compact 전 | `preparation, branchEntries, customInstructions?, reason, willRetry, signal` | `cancel`, `compaction`(직접 만든 결과로 대체) | 785 |
| `session_compact` | compact 성공 후 | `compactionEntry, fromExtension, reason, willRetry` | 관찰 | 798 |
| `session_compact_failed` | compact 실패나 취소 후 | `reason, errorMessage?, aborted, willRetry, fromExtension` | 관찰 | 809 |
| `session_before_tree` / `session_tree` | session tree 이동 전 / 후 | `preparation, signal` / `newLeafId, oldLeafId, summaryEntry?` | before는 `cancel`, `summary`, `customInstructions`, `replaceInstructions`, `label` | 847,854 |
| `session_info_changed` (=) | session 이름 변경 | `name?` | 관찰 | 764 |
| `session_shutdown` | extension runtime을 내릴 때(종료, reload, session 교체) | `reason`(quit/reload/new/resume/fork), `targetSessionFile?` | 관찰. resource 정리용 | 824 |
| `mcp_servers_change` | extension이 MCP server를 등록하거나 해제할 때 | `servers[]` | 관찰 | 744 |
| `input` | 사람/rpc/extension 입력을 받았을 때, agent가 처리하기 전 | `text, images?, source`(interactive/rpc/extension), `streamingBehavior?` | `{action: continue}` / `{action: transform, text, images}` / `{action: handled}` | 1171 |
| `before_agent_start` | run 시작 전(compact 점검 이후) | `systemPrompt`, `systemPromptOptions`, `messageType: user`(+`prompt, images`) 또는 `custom`(+`message`) | `message` 추가, `systemPrompt` 전체 교체, `systemPromptOptions` 변경 | 941-957 |
| `agent_start` (=) / `agent_end` (=) | run 시작 / 끝 | - / `messages[]` | 관찰 | 960,965 |
| `agent_before_settle` | 끝내기 직전. 마지막으로 행동할 수 있는 지점 | `entries[], continue, context, outcome`(completed/aborted/error) | `entries` 추가, `continue: true`로 model 요청 한 번 더 | 1028 |
| `agent_settled` (=) | 끝이 확정된 뒤 | `aborted` | 관찰 | 1033 |
| `turn_start` (=) / `turn_end` (=) | turn 시작 / 끝 | `turnIndex, timestamp` / `turnIndex, message, toolResults, messageEntryId, toolResultEntryIds, entries, continue, outcome` | `turn_end`는 `entries`, `continue`로 이어서 한 번 더 | 1058,1065 |
| `message_start` (=) / `message_update` (=) | 시작, 스트리밍 | `message` / `message, assistantMessageEvent` | 관찰 | 1075,1081 |
| `message_end` (=) | 확정 | `message` | `message` 교체(role은 그대로) | 1088 |
| `context` | model 호출 직전마다 | `messages[]`(system message 제외) | `messages` 교체 | 885 |
| `context_with_system` | 같은 시점, `context` 뒤 | `messages[]`(system 포함) | 전체 교체(첫 번째가 system) | 895 |
| `cache_warming_decision` | idle일 때 prompt cache를 데울지 정할 때 | 정의는 `pi/CA/src/core/cache-warmer.ts` (이 조사에서는 읽지 않음) | `{action: "warm"}` / `{action: "stop"}` | 문서 `extensions.md` |
| `before_provider_request` | provider 요청 payload를 만든 뒤 | `payload` | 돌려준 값으로 payload 교체 | 901 |
| `before_provider_headers` | header를 모은 뒤, HTTP 호출 전 | `headers` | 직접 고침(`null`이면 지움). 반환값은 무시 | 911 |
| `after_provider_response` | 응답을 받은 뒤, stream 읽기 전 | `status, headers` | 관찰 | 917 |
| `provider_stream_event` | provider stream event를 하나 파싱할 때마다, Pi가 정규화하기 전 | `provider, api, model, data` | 관찰(읽기 전용으로 쓰라고 문서가 적음). 저장 안 함 | 924 |
| `tool_call` | tool 실행 직전(검증 뒤) | `toolCallId, toolName, input`(tool별 타입), `parentToolCallId?` | `input`을 제자리에서 고침, `{block: true, reason, terminate?}`로 막기. handler가 throw해도 막힌다 | 1200-1260 |
| `tool_result` | tool 실행 직후 | `toolCallId, toolName, input, content, structuredContent?, isError, details, usage?` | `content, details, structuredContent, isError, usage` 교체. handler끼리 이어진다 | 1264-1335 |
| `tool_execution_start` / `_update` / `_end` (=) | 3.2 참고 | | 관찰 | 1094-1115 |
| `user_bash` | 사용자가 `!` 또는 `!!`로 shell을 돌릴 때 | `command, excludeFromContext, cwd` | `operations` 또는 `result`로 실행을 대신함 | 1153 |
| `model_select` | model이 바뀔 때 | `model, previousModel?, source`(set/cycle/restore) | 관찰 | 1134 |
| `thinking_level_select` | thinking level이 바뀔 때 | `level, previousLevel` | 관찰 | 1142 |
| `ui_prompt_start` / `ui_prompt_end` | 사람에게 blocking UI prompt(select, confirm, input, editor, custom)를 띄우는 동안 | `kind, title?` | 관찰 | 1042,1050 |

참고: 위 이름 중 `message_*`, `turn_*`, `agent_*`, `tool_execution_*`는 `AgentSessionEvent`와 같은 객체를 extension에도 먼저 준다. `compaction_*`, `queue_update`, `auto_retry_*`, `entry_appended`, `thinking_level_changed`, `bash_execution_update`는 session event에만 있고 extension event에는 없다(`ExtensionEvent` union, `types.ts:1405-1437`).

### 3.4 Pi에 없거나 core 밖인 것

- 권한 요청 event: core에 없다. 문서가 "does not ask for approval before every tool call"이라고 적는다(`pi/CA/docs/security.md:3`). extension이 `tool_call`에서 막거나 `ctx.ui.confirm()`으로 묻는다. rpc에서는 `extension_ui_request` `confirm`으로 나간다. 예제 `pi/CA/examples/extensions/permission-gate.ts`(읽지 않음).
- subagent: core에 없다. README가 "skips features like sub-agents"라고 적는다(`pi/CA/README.md:19`). 예제 `pi/CA/examples/extensions/subagent`가 있으나 읽지 않았다. 비슷한 것으로 tool이 다른 tool을 부르는 `ctx.executeTool()`이 있고, 이때 `tool_execution_*`에 `parentToolCallId`가 붙고 `toolCallId`가 `<parent id>/<n>`이 된다(`docs/extensions.md` "Tools").
- 따로 된 오류 event: 없다. 위 3.2 끝 단락 참고.

### 3.5 저장

- session 파일 `~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl`. JSONL, entry가 `id`/`parentId`로 tree를 이룬다(branch가 한 파일 안에서 가능). 근거 `pi/CA/docs/session-format.md`.
- entry 종류: `session`(header), `message`(role: system / user / assistant / toolResult / custom 등), `model_change`, `thinking_level_change`, `usage`, `compaction`, `context_edit`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`. 근거 `session-format.md`, `pi/CA/src/core/session-manager.ts:183-194`.
- 저장되는 것: `message_end`의 message(`agent-session.ts:1165`), compact 결과, model 변경(`:2510,2577,2612`), thinking level 변경(`:2652`), session 이름(`:3968`), extension의 `appendEntry`.
- 저장되지 않는 것: `agent_start`, `agent_end`, `agent_settled`, `turn_*`, `message_update`, `tool_execution_*`, `queue_update`, `auto_retry_*`, `compaction_start`, extension event 전부. 이것들은 live로만 나간다. tool 결과는 `toolResult` message entry로 남는다. `provider_stream_event`는 문서가 "is not persisted"라고 적음.
- `--no-session`이면 파일을 쓰지 않는다(`session-manager.ts`의 `persist` 플래그, 문서 `rpc.md`의 예). rpc는 세션 header를 stdout으로 내지 않는다. 현재 session id와 file은 `get_state`로 얻는다(`docs/json.md`).

---

## 4. lifecycle 단계별 정리

event 이름은 backtick, hook은 `hook:`, 다른 통로는 설명을 붙였다. "없음"은 해당 단계에 맞는 event나 hook을 source에서 찾지 못했다는 뜻이다.

| 단계 | OpenCode V1 (`v1.19.0`) | OpenCode V2 (`dev`) | Pi |
|---|---|---|---|
| session 시작 | `session.created`(durable) | `session.created`(durable) | rpc 선로에는 없음. extension `session_start`(reason: startup/reload/new/resume/fork) |
| 사람 입력(prompt) | hook: `chat.message`(user message 저장 전), `command.execute.before`. event: `message.updated`(user), `message.part.updated`, `command.executed` | hook: `session.prompt`(접수 전). event: `session.inbox.enqueued`(item.type user) -> `session.inbox.delivered` | rpc 명령 `prompt`/`steer`/`follow_up` -> `response{disposition}`, `queue_update`. extension `input`(막기/변환), `before_agent_start`. 이후 `message_start`/`message_end`(role user) |
| turn 시작 | 없음 (비슷한 것: `session.status` busy, assistant `message.updated`, part `step-start`) | `session.execution.started`(busy period), 각 model 호출은 `session.step.started` | `agent_start`, `turn_start` |
| turn 끝 | 없음 (비슷한 것: part `step-finish`, assistant `message.updated`에 `time.completed`, 전체 끝은 `session.status` idle) | `session.step.ended`(model 호출 하나), busy period 끝은 `session.execution.succeeded` / `.failed` / `.interrupted` | `turn_end`, `agent_end`, 최종 `agent_settled`. extension `agent_before_settle`(이어하기 요청 가능) |
| model 호출 | hook: `chat.params`, `chat.headers`, `experimental.chat.system.transform`, `experimental.chat.messages.transform`. event: part `step-start`/`step-finish`, `message.part.delta`(text/reasoning 스트리밍) | hook: `session.context`, `session.model.request`, `session.http.request`/`.response`, `session.experimental.ws.*`. event: `session.step.started` / `.streamed` / `.ended` / `.failed`, `session.text.*`, `session.reasoning.*`, `session.usage.updated` | extension `context`, `context_with_system`, `before_provider_request`, `before_provider_headers`, `after_provider_response`, `provider_stream_event`. session event: `message_start`, `message_update`, `message_end`(assistant) |
| tool 호출 전 | hook: `tool.execute.before`(args 변경, throw로 막기), `tool.definition`. event: `message.part.updated`(tool part `pending` -> `running`) | hook: `tool.execute.before`(input 변경, `Tool.Error`로 거절). event: `session.tool.input.started` / `.delta` / `.ended`, `session.tool.called` | extension `tool_call`(input 변경, `block`). session event: `message_update`의 `toolcall_*`, `tool_execution_start` |
| tool 호출 후 | hook: `tool.execute.after`(결과 변경). event: `message.part.updated`(tool part `completed` / `error`), `file.edited` 등 | hook: `tool.execute.after`. event: `session.tool.progress`, `session.tool.success` / `session.tool.failed` | extension `tool_result`(결과 교체). session event: `tool_execution_update`, `tool_execution_end{isError}`, toolResult의 `message_start` / `message_end` |
| 권한 요청 | `permission.asked`, `permission.replied`. hook `permission.ask`는 타입에만 있고 호출 위치 확인 못함. 질문은 `question.asked` / `.replied` / `.rejected` | `permission.asked`, `permission.replied`. hook: `permission.evaluate`(effect 변경). 질문은 `form.created` / `.replied` / `.cancelled` | 없음(core). extension `tool_call`로 막기 + `ctx.ui.confirm()` -> rpc `extension_ui_request`(confirm). `ui_prompt_start`/`ui_prompt_end` |
| compact | hook: `experimental.session.compacting`, `experimental.compaction.autocontinue`. event: part `compaction`, `session.compacted` | hook: `session.compaction`(요약 대체 가능). event: `session.compaction.started` / `.delta` / `.ended` / `.failed`. (`session.compacted`는 정의만, publish 확인 못함) | `compaction_start`, `compaction_end`. extension `session_before_compact`(취소, 대체), `session_compact`, `session_compact_failed`. 재시도: `summarization_retry_*` |
| subagent | task tool이 child session을 만듦(`session.created`에 `parentID`). part `subtask`. task tool에도 `tool.execute.before`/`.after`가 걸린다 | child session의 `session.created`(`parentID`). 끝나면 부모에 `session.synthetic`(`metadata.source = "subagent"`, state completed/error/cancelled) | 없음(core 밖. 예제만 있고 읽지 않음). 비슷한 것: `parentToolCallId`가 붙은 nested `tool_execution_*` |
| 알림과 idle | `session.status`(idle/busy/retry), `session.idle`(deprecated), `tui.toast.show`. hook: `event`로 받음 | `session.execution.succeeded` / `.failed` / `.interrupted`(+ session의 `time_idle`, `idle_outcome`), `tui.toast.show`. `session.status` / `session.idle`은 정의만. TUI 내장 알림 plugin이 `session.execution.*`, `permission.asked`, `form.created`를 듣는다(`packages/tui/src/feature-plugins/system/notifications.ts`) | idle = `agent_settled`. 알림 = extension이 `ctx.ui.notify()` -> rpc `extension_ui_request`(notify). 사람 기다림 = `ui_prompt_start`/`_end` |
| 오류 | `session.error`(`error.name`: APIError, ProviderAuthError, MessageAbortedError, ContextOverflowError, ...), assistant `message.updated`의 `error`, `session.status` retry | `session.execution.failed`, `session.step.failed`, `session.tool.failed`, `session.compaction.failed`, `session.retry.scheduled`. hook: `session.retry` | 따로 error event 없음. `message_end`의 `stopReason: error/aborted`, `tool_execution_end{isError}`, `auto_retry_start`/`_end`, `compaction_end{errorMessage}`, rpc `extension_error`, `response{success:false}` |
| session 끝 | `session.deleted`(지울 때). 대화가 끝나는 event는 없고 idle로 갈 뿐 | `session.deleted`. 끝 개념은 없고 `session.execution.*`로 busy period만 끝남 | rpc 선로에는 없음(stdin을 닫으면 종료). extension `session_shutdown`(quit/reload/new/resume/fork) |

---

## 5. 확인 못한 것

- OpenCode V1: `permission.ask` hook의 trigger 위치. `permission.v2.*`, `question.v2.*`를 publish하는 곳. `session.next.*`와 `message.*`가 한 대화에서 같이 나는지. `lsp.client.diagnostics`를 지금 source에서 publish하는지(정의는 못 찾음).
- OpenCode V2: `session.status`, `session.idle`, `session.compacted`를 publish하는 곳(없는 것으로 보임). `persist: false`일 때 `session.log` 동작. V2 TUI plugin API(`packages/plugin/src/tui`)의 event 구독 모양(notifications plugin이 `context.data.on(...)`을 쓰는 것만 확인).
- Pi: `cache_warming_decision` field(`cache-warmer.ts` 미독). 예제 extension(`permission-gate.ts`, `subagent`, `notify.ts`) 내용. 웹 문서 사이트(pi 문서는 repo의 `docs/*.md`만 읽음).
- 두 제품 모두: 실제로 프로세스를 띄워 event를 받아 보는 실험은 하지 않았다. 위 내용은 source와 repo 문서를 읽은 결과다.
