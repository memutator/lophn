# agent chat: 답을 markdown으로 그리고, 한 일과 걸린 시간을 읽을 수 있게 한다

상태: 2026-10-25 계획 `project-docs/plan/agent-chat/`으로 열었다. planner가 외부 비교 보고서 둘을 읽고 지금 코드와 맞춰 정리했다.
배경 보고서(저장소 밖이거나 commit되지 않음):
- `reports/채팅 렌더링과 마크다운 비교.md`: Claude, ChatGPT, Grok과 글·markdown·code·streaming 비교
- `../rea/project/agent-activity-reversing/reports/report-lophn-comparison-ko.md`: ChatGPT/Codex, Claude, Hermes, OpenCode와 활동 줄·경과 시간 비교. 참고 구현은 같은 폴더의 `src/`

보고서의 주장은 worker 둘이 코드와 대조했다. 아래 "지금 코드"는 대조한 값이다. 보고서와 다른 것: artifact 화면은 `Markdown`에 `onOpenLink`를 넘기지 않는다(`workspace/kinds/artifact.tsx:126`은 sandbox artifact view에 넘긴다). `Markdown`을 쓰면서 `onOpenLink`를 넘기는 곳은 하나도 없다.

## 고르는 기준

비교한 앱들이 모여 있는 정석과 맞는 의미를 고른다. 지금 구현에서 옮기는 비용은 근거로 쓰지 않는다. 틀린 대로 계속 도는 비용이 더 크다(사람, 2026-10-25). "미리 만들지 않는다"(AGENTS.md)는 쓰는 곳이 없는 것을 미루는 데만 쓴다.

## 왜

- agent가 `**굵게**`, 목록, 표, code fence로 답하면 사람은 기호를 그대로 본다. 비교한 앱은 모두 markdown으로 그린다. lophn에는 markdown renderer가 이미 있는데 파일 읽기에만 쓴다.
- 한 turn에서 agent의 마지막 답은 turn이 끝나야 보이고, tool 사이에 쓴 "X를 확인하겠다" 같은 글은 아예 저장되지 않아 보이지 않는다. tool 줄은 도는 중에 보이는데 글은 안 보인다.
- 펼친 tool 줄은 `file.read`, `shell (failed)`처럼 tool 이름만 보인다. 무슨 파일을 읽었고 무슨 명령을 돌렸는지 알 수 없다.
- "Worked for"의 주석과 실제 값이 다르고, 60분이 넘으면 `75m`이 된다.
- markdown link를 누르면 shell 창이 그 page로 넘어간다(이슈 `shell.md` "파일 읽기의 markdown link를 누르면 shell 창이 그 web page로 넘어간다"). chat을 markdown으로 그리면 이 길이 agent 답마다 열린다.

## 지금 코드

모든 path는 `packages/` 아래. `R` = `shell/renderer/conversation`.

### 화면

- agent chat을 그리는 화면은 셋이고 모두 `AgentView`(`R/agent-view.tsx:128`) → `AgentThread`(`R/agent-thread.tsx:82`)를 쓴다.
  - project·desktop 창의 Agent 탭: `shell/renderer/workspace/agent/agent-tab.tsx:54`
  - 앱 공간의 agent 칸: `shell/renderer/app-frame/side-panel.tsx:315`
  - 런처의 lophn 칸: `shell/renderer/desktop/launcher/lophn-panel/lophn-panel.tsx:164`
- 그래서 아래를 고치면 세 화면이 같이 바뀐다.

### 글

- agent 글은 plain text다. `R/message-list/message-body.tsx:42-44`의 `case "text"`가 `ArtifactText`(`artifact-text.tsx:22`)를 부르고, `<p>`에 `white-space: pre-wrap`(`message-body.module.css:8-15`)으로 넣는다. domain artifact path(`dom_*/…/name`)만 button link가 된다. 모르는 path가 보이면 artifact 목록을 다시 읽는다(`artifact-text.tsx:24-40`).
- 사람 글은 따로 `UserBody`(같은 file)가 그린다. agent끼리 받은 message도 `MessageBody`를 탄다(`agent-thread.tsx:361`).
- markdown renderer는 `design/components/reading/markdown/`의 `Markdown`(`markdown.tsx:200`)이다. `@lezer/markdown@1.7.2` GFM(`design/deno.json:39`, `parse.ts:3,17`) → 자체 AST → React다.
  - 쓰는 곳은 `shell/renderer/editor/markdown-pane.tsx:56` 하나이고 `onOpenLink`도 `resolveImage`도 넘기지 않는다.
  - raw HTML은 `<pre>` 글로 그린다(`parse.ts:226-229`, `markdown.tsx:162-163`). `dangerouslySetInnerHTML`은 packages 전체에 정적 SVG icon 두 곳뿐이다.
  - link는 `safeUrl`이 `http:`, `https:`, `mailto:`만 통과시킨다. `onOpenLink`가 없으면 `target`도 handler도 없는 `<a href>`다(`markdown.tsx:62-83`).
  - 본문은 reading 16/28로 고정(`reading.module.css:2-6`, `design/tokens.ts:98`)이고 chat 글은 body 14/22(`tokens.ts:97`)다.
  - 표는 wrapper 없는 `<table>`이라 넓으면 column을 넘는다(`markdown.tsx:164-166`, `reading.module.css:123-128`).
  - task list는 `<li data-task>`에 icon이고 checked를 screen reader에 알리지 않는다(`markdown.tsx:97-113`).
  - `useMemo([source, resolveImage])`로 source가 같으면 다시 parse하지 않는다.
- main renderer CSP(`shell/main/desktop/shell-protocol.ts:8-20`)는 `img-src 'self' data: blob:`이라 markdown의 바깥 `https` image는 뜨지 않는다. `wasm-unsafe-eval`이 없어 wasm을 돌리지 못한다. `worker-src`가 없어 worker는 `script-src 'self'`를 따른다.

### code

- `design/components/reading/code-block/code-block.tsx:18-27`은 언어 label(fence info 원문), `CopyButton`, `<pre><code>`다. highlight가 없다.
- 저장소에 highlighter가 없다(shiki, prism, highlight.js 0). CodeMirror는 있다: `shell/renderer/deno.json:12-18`에 `@codemirror/language@6.12.4`, `lang-json`, `lang-markdown`, `lang-yaml`이 직접 의존이고, `deno.lock`에 `@lezer/highlight`, `@lezer/javascript`, `@lezer/css`, `@lezer/html`, `@lezer/json`, `@lezer/yaml`이 따라 들어와 있다.

### 글이 도착하는 길

- agent 답 저장(`core/lophn-agent/session/message-commands.ts:346-374`)은 turn이 `running`일 때만 받는다. 그런데 run-loop는 tool call 없는 마지막 답만 저장한다(`run-loop/turn.ts`의 `afterModel` → `conclude`). tool call과 같이 온 글은 model 이력에만 들어가 사람은 turn이 끝나도 보지 못한다(뼈대 worker가 찾음).
- 그런데 shell은 `TurnEnded`(`R/agent-tab-data.ts:156-172`)가 실어 온 message id(`core/lophn-agent/run-loop/turn-events.ts:39`)로만 message 칸을 만들고 `ReadMessageBody`로 본문을 읽는다(`agent-tab-core-source-thread.ts:68-85`, 한 번에 4개 `bodies.ts`).
- lophn-agent event(`protocol/events/agent.ts:10-15`)는 TurnStarted/Ended, ToolCall*, Question*, Compact*다. 글 event는 없다.
- provider와는 SSE streaming이다(`core/lophn-agent/providers/invoke.ts:251,261`의 `accept: text/event-stream`, `stream: true`). core와 shell 사이는 WebSocket event다(`shell/main/desktop/core/connection.ts`). 끊기는 곳은 그 가운데다.
- provider adapter는 글 delta를 받아 쌓기만 한다: `core/lophn-agent/providers/adapters/messages.ts:277-278`, `responses.ts:230-232`, `chat-completions.ts:241-243`. 밖으로 내는 callback이 없다.

### transcript

- `R/message-list/thread-scroll.tsx:31-94`가 모든 turn을 DOM에 그린다. 가상화, `React.memo`, `content-visibility` 모두 0이다.
- tool call은 최근 100개만 읽는다(`TOOL_CALL_LIMIT`, `agent-tab-core-source-thread.ts:67,236`).
- 따라오는 중이면 render마다 바닥에 다시 붙는다(`thread-scroll.tsx:57-60`).

### 시간

- `R/activity/worked-for.tsx`:
  - `duration(ms)`(`:12-23`)는 초를 반올림해 `s`, `m`, `m s`만 쓴다. 시간 단위가 없어 75분은 `75m`이다. 쓰는 곳은 `WorkedFor`와 `WorkingRow` 둘이다.
  - `WorkedFor`(`:27-41`)는 "Worked for {d}" 또는 "Stopped after {d}"인 `<p>`다.
  - prop 주석(`:7`)은 trace의 `active_ms`라고 하지만 값은 wall clock이다. `tailOf`(`agent-tab-core-source-thread.ts:427-448`)가 `secondsBetween(turn.started_at, finished_at)`으로 만들고, `secondsBetween`(`:423-425`)은 이름과 달리 ms를 낸다.
  - 도는 중 받은 `TurnEnded`는 같은 값을 따로 계산한다(`agent-tab-data.ts:156-163`, `event.at - startedAt`). 뒤에 snapshot이 덮는다.
  - 실패한 turn은 시간 없이 `provider-error` 칸이다. `interrupted`의 이유(`restarted`, `user_stopped` …)는 모두 같은 "Stopped after"가 된다.
- `WorkingRow`(`R/message-list/agent-turn.tsx:194-214`): 300ms 뒤 뜨고 1초마다 다시 그리며 10초가 넘어야 시간을 보인다. `since`는 turn의 `started_at`이다. `role="status"`가 없다.
  - 사람을 기다리는 동안(승인, 질문)은 `phase`가 `waiting`이라 row가 사라지고 카드가 보인다(`agent-view.tsx:462-467`). 돌아오면 같은 `since`로 다시 떠서 기다린 시간만큼 건너뛴다. 완료 줄도 wall이라 둘은 맞는다.
- turn row에는 `elapsed.active_ms`(사람 대기 제외, `run-loop/limits.ts:168-175`)가 있고 shell도 `TurnRecord`를 읽는다. 다만 checkpoint 때 쓰는 값이라 끝난 직후엔 조금 모자랄 수 있고, `TurnEnded` event에는 없다.
- `core/lophn-agent/observability/model.ts:162,181-182`의 `assembleTrace`는 trace의 `wall_ms`와 `active_ms`에 같은 active 값을 넣는다. `wall_ms`를 읽는 곳은 합계(`model.ts:241`)뿐이다.
- 단위 문구는 `design/wording/catalog/conversation.ts:110-113`이다. wording은 영어(`en.ts`) 하나다.

### tool 줄

- lophn-agent tool:
  - `shell.run`(`core/lophn-agent/tools/bundles/shell.ts`)은 `command`, `timeout_ms`만 받는다. 무엇을 하는지 적는 칸이 없다.
  - file tool은 `file.read`, `file.write`, `file.edit`, `file.glob`, `file.grep`, `file.outline`, `pdf.read`, `image.read`다(`bundles/file.ts`).
  - 그 밖: `web.search`, `web.fetch`, `ask`, `call`, `skill`, `tool.load`, 앱 tool `<domain>_<tool>`, MCP tool.
- `ToolCallStarted`(`protocol/events/agent.ts:92-93`)는 `{turn, tool_call, tool}`만 싣는다. 목록은 `ListToolCalls`(`protocol/lophn-agent/tool-calls.ts:256`)로 읽는다. 둘 다 사람이 읽을 이름이 없다.
- shell 승인은 `{kind: "shell", command}`(`protocol/approvals/gate-call.ts:23-26`)를 보인다.
- `agent-tab-core-source-thread.ts`:
  - 이어진 call을 묶는다. `bucketOf`(`:266-268`)는 `file.read`면 documents, 나머지는 tool 이름이다.
  - 접힌 줄은 "Read N documents" / "Used {tool} N times"(`:360-374`)다.
  - 펼친 줄 `lineOf`(`:259-263`)는 tool 이름이나 `tool (outcome)`뿐이다.
  - 성공한 edit/write는 tool 줄 대신 edit card다.
- `viewOf`(`:215-227`)가 redaction된 `tool_call_input`/`tool_call_output` 본문을 읽는 길이 이미 있다(`core/lophn-agent/run-loop/turn-body-reads.ts:190-225`, 64 KiB, `truncated`). 지금은 `ask`, `call`, `file.write`, `file.edit`에만 쓴다.
- 도는 중(`agent-tab-data.ts`의 `ToolCallStarted`)에는 call마다 tool 이름 줄 하나씩 묶지 않고 쌓는다. turn이 끝나 snapshot을 다시 읽으면 묶인 줄로 바뀌어 화면이 한 번 뛴다. edit도 그동안 tool 줄로 보인다.
- `ToolCall`(`protocol/lophn-agent/tool-values.ts:129-193`)에 `started_at`, `finished_at`, `duration_ms`가 있지만 화면은 순서에만 쓴다.
- 보기 select(Messages / Compact / Everything, `R/activity/model.ts:5`)는 화면(`AgentView`)마다 state이고 저장하지 않는다. Compact와 Everything은 tool 줄을 접느냐 펴느냐만 다르다. Messages는 tool 줄과 "Worked for"를 숨긴다(`agent-view-model.ts:41-52`).

### 그 밖

- reasoning: adapter가 읽을 수 있는 reasoning을 일부러 버린다(`messages.ts:289`, `responses.ts:268-280`, `chat-completions.ts:4`). 남는 것은 token 수와 opaque handle뿐이다.
- `ProgressChip`과 Tasks popover(`R/activity/progress-chip.tsx`)는 production에서 늘 `tasks: []`(`agent-tab-core-source-thread.ts:656`, `agent-tab-data.ts:198`)라 그리지 않는다(`progress-chip.tsx:21`). 뒤에 둘 core의 todo/plan 개념이 없다. fake source와 wireframes에만 보인다.
- 위 어느 것에도 test가 없다(`duration`, `WorkedFor`, `WorkingRow`, `tailOf`, 묶기, `assembleTrace`).
- `shell:open-external`(`shell/ipc/open-external.ts:5`, `shell/main/desktop/open-external.ts`)이 이미 있다. `http`/`https`만, userinfo 거절, 길이 상한, desktop origin만 부른다. renderer는 `lophnShell.openExternal`로 부른다.

## 무엇을 만드나

### 1. link 경계 (먼저)

- 이슈 `shell.md`의 추천대로 한다. shell 창 webContents에 `will-frame-navigate` guard와 `setWindowOpenHandler` deny를 두고, `http`/`https`는 `shell:open-external`로 넘긴다.
- `Markdown`을 쓰는 곳(파일 읽기, 아래 chat)은 `onOpenLink`로 `lophnShell.openExternal`을 넘긴다.
- 막는 결정 함수에 unit test 하나(sandbox 경계, AGENTS.md "속도").

### 2. agent 글을 markdown으로

- `MessageBody`의 `case "text"`와 fallback 글을 `Markdown`으로 그린다.
- chat에서는 body 14/22 token과 좁은 간격을 쓴다. reading은 지금 그대로다.
- artifact path link를 지킨다.
  - `Markdown`이 글 조각을 그릴 때 shell이 준 함수로 artifact path를 button link로 바꾼다.
  - agent는 path를 backtick에 넣는 일이 많다. 그래서 inline code 전체가 artifact path이면 그것도 link로 둔다.
  - 모르는 path를 보면 목록을 다시 읽는 지금 동작도 남긴다.
- 사람 글(`UserBody`)은 plain 그대로다.
- `Markdown` 공통으로 고친다:
  - 표를 가로 scroll wrapper로 감싼다.
  - task list는 checked를 알리는 disabled checkbox 의미를 준다.
  - code 언어 label은 info의 첫 낱말만 쓴다.
- chat에서 markdown image는 그리지 않고 alt 글의 link로 둔다. agent 답의 image를 불러오면 그 URL로 대화 내용이 새어 나갈 수 있다(prompt injection이 `![](https://…?q=<secret>)`를 쓰게 하는 길). main CSP도 바깥 image를 막는다.

### 3. code highlight

- Shiki로 한다. 비교한 세 앱이 모두 Shiki다.
  - regex engine은 JavaScript engine을 쓴다. oniguruma wasm을 쓰지 않으므로 CSP(`wasm-unsafe-eval` 없음)를 바꾸지 않는다.
  - grammar는 fence 언어를 보고 그때 불러온다. 언어 목록을 미리 고르지 않는다. 모르는 언어는 plain이다.
  - Worker에서 돌린다(세 앱과 같다). CSP의 `script-src 'self'`가 같은 origin worker를 허락한다. streaming 중 자라는 code block도 main thread를 막지 않는다.
  - 결과는 token 배열로 받아 React span으로 그린다. HTML 문자열을 넣지 않는다(지금의 HTML sink 0을 지킨다).
  - 색은 Shiki의 css-variables theme에 design token을 물린다. `ui-design` skill대로 light·dark preset에 같이 둔다.
- design의 `CodeBlock`이 highlighter를 React context에서 받는다. shell이 Shiki worker를 context로 준다. context가 없는 곳(`@lophn/ui`를 쓰는 앱)은 지금처럼 plain이다.
- 파일 읽기와 chat이 같이 얻는다.
- esbuild(`shell/renderer/build.ts`)가 grammar와 worker를 따로 묶는지는 계획에서 본다.

### 4. 글이 쓰이는 대로 보인다 (token streaming)

core 사이 길은 이미 있다. provider SSE delta를 adapter가 받고, agent event는 agent runtime(child process) → 감독 pipe → core Bus → shell WebSocket으로 흐른다(`architecture/event.md:51`). 빠진 것은 delta를 이 길에 싣는 것이다.

- **adapter → run-loop.** adapter 셋(`messages.ts`, `responses.ts`, `chat-completions.ts`)은 글 delta를 쌓으면서 run-loop가 인자로 준 callback에도 넘긴다.
- **agent event.** run-loop는 delta를 짧게(예: 50ms) 묶어 agent event로 낸다.
  - 싣는 것: session, turn, model 호출 attempt, offset(앞까지의 글 길이), 글.
  - agent event 규칙대로 저장하지 않는다.
  - 묶어 내는 것은 Gateway가 느린 구독자를 끊기 때문이다(`event.md:57`).
- **늦게 붙은 화면.** core는 session마다 지금 쓰는 중인 글을 메모리에 들고 session snapshot에 싣는다. 답 도중에 연 탭이나 다시 붙은 화면도 쓰인 데까지 보고 이어 받는다(`event.md:55,66`의 "snapshot으로 맞춘다"). offset이 맞지 않으면 snapshot을 다시 읽는다.
- **저장되면 정본으로 바꾼다.** agent 답이 저장되면(`message-commands.ts`의 agent 답 기록) agent event 하나를 낸다. shell은 live 글을 버리고 저장된 본문을 읽는다. `TurnEnded`의 message 목록은 빠진 것을 채우는 데만 쓴다.
- **retry.** model 호출을 retry하면(`temporary`, partial) 앞 attempt의 live 글을 버린다. attempt가 바뀐 delta가 오면 새로 시작한다.
- **멈춤.** 사람이 멈추거나 호출이 끊겨도 사람이 본 글은 사라지지 않는다. 멈춘 attempt의 글을 지금 저장하는지(`run-loop/turn.ts`의 `cancelled`, `partial`)는 계획에서 보고, 저장하지 않으면 보인 데까지 저장한다.
- **renderer.**
  - live 글은 throttle(한 frame~100ms)해서 `Markdown`으로 다시 그린다.
  - 닫히지 않은 code fence는 그릴 때만 닫아 준다.
  - 다 쓴 message는 `React.memo`로 다시 그리지 않는다. delta마다 thread 전체를 다시 그리지 않게 한다.
  - 바닥 따라가기는 지금 `ThreadScroll`이 한다.
- tool call 인자 delta(`input_json_delta`)는 싣지 않는다. tool 줄은 지금처럼 `ToolCallStarted`로 뜬다.

### 5. reasoning을 보인다

Claude, ChatGPT, Hermes가 모두 보인다. 도는 동안 "Thinking", 끝나면 "Thought for 12s"이고, 펼치면 요약 글이 보인다. lophn adapter는 지금 이 글을 버린다. 주석의 이유는 "opaque 상태에 사람이 읽을 본문을 두지 않는다"(`messages.ts:11-13`, `responses.ts:268-269`)이다. 보이지 않기로 한 제품 결정이 아니다.

- adapter는 reasoning 글 delta(Anthropic `thinking_delta`, OpenAI `reasoning_summary_text.delta`, DeepSeek `reasoning_content`)를 opaque 상태와 따로 모은다. OpenAI Responses는 요약을 받으려면 요청에 `reasoning.summary`를 실어야 한다.
- reasoning 글은 agent 답처럼 session 기록에 redaction을 거쳐 저장한다. model 이력에는 지금처럼 opaque handle만 다시 보낸다.
- 4의 delta 길에 reasoning delta도 싣는다(종류만 다르다).
- 화면:
  - 도는 동안 "Thinking"이 보인다.
  - 끝을 본 reasoning은 "Thought for {d}"로 보인다. 시간은 core가 그 reasoning 첫 delta와 마지막 delta 사이를 재서 저장한다.
  - 펼치면 요약 글이 보인다. 보기 select의 Messages에서는 숨긴다.
- provider가 읽을 글을 주지 않으면(암호화만 오는 경우) "Thought"만 보이고 시간은 위처럼 잰다.

### 6. 시간

- **"Worked for"는 agent가 일한 시간이다.** 사람을 기다린 시간(승인, 질문)은 뺀다. 그 값은 이미 `TurnLimiter`가 잰다(`elapsed.active_ms`).
- core:
  - turn이 끝날 때 active를 마지막 checkpoint가 아니라 끝난 순간까지로 마감해 저장한다.
  - `TurnEnded`에 active를 싣는다.
  - 기다림에서 다시 도는 순간을 알리는 event와 session snapshot의 도는 turn에 `elapsed`(active, 기준 시각)를 싣는다.
- shell:
  - `WorkingRow`는 `active + (now − 기준 시각)`을 보인다. 기다림이 끝나 다시 떠도 기다린 만큼 건너뛰지 않는다.
  - 도는 중 `TurnEnded`와 snapshot의 `tailOf`가 같은 함수로 시간을 만든다. `secondsBetween`, `WorkedFor` 주석의 틀린 이름과 설명은 지운다.
  - 기다린 시간이 있었던 turn은 완료 줄 tooltip에 기다린 시간도 보인다(wall − active).
- `duration`에 시간 단위를 더한다. 60분 이상은 `1h 5m`이다. 문구는 `wording` skill대로 catalog에 둔다.
- `WorkingRow`에 `role="status"`를 준다. 1초마다 바뀌는 숫자는 읽지 않게 한다.
- `assembleTrace`의 `wall_ms`를 `finished_at - started_at`으로 고친다.

### 7. tool 줄이 무엇을 했는지 보인다

#### 다른 harness는 어떻게 하나 (2026-10-25 조사)

| harness | 사람이 읽을 이름 | 펼치면 |
|---|---|---|
| Claude Code | `Bash`에 model이 채우는 `description`(선택). Read·Edit·Grep·Glob·WebFetch는 칸 없이 인자 template("Read foo.ts"). Bash 명령을 read/search/list로 갈라 묶는다 | 명령, 출력, call마다 시간 |
| Codex (CLI, 데스크톱) | model 칸 없음. `parse_command`가 명령을 Read / ListFiles / Search / Unknown으로 가른다. 데스크톱은 "파일을 읽었습니다 명령을 실행함" | 원래 명령과 출력(TUI는 5줄 뒤 "… +N lines"), 서버 시간 |
| Gemini CLI | `run_shell_command.description`(선택). tool마다 `getDescription()` template | 확인 창에 description, 결과 요약, diff |
| Copilot (VS Code) | `run_in_terminal`에 `explanation`, `goal`(필수). 줄은 tool template("Running `cmd`", "Read <file>") | model 글은 확인 창에만 |
| Cline (새 SDK) | model 칸 없음. 인자와 결과로 label을 만들고 이어진 call을 " · "로 묶는다("Read file app.tsx (10-80)", "Ran command `bun test`") | call마다 상세, diff, 출력 64 KiB |
| Hermes | model 칸 없음. shell 명령 요약과 tool마다 preview 함수 | 인자 전체, 결과, diff, 시간 |
| OpenCode | v1은 bash `description`(필수)을 제목으로 썼다. 지금 v2는 칸을 지우고 "Shell" + 명령이다 | 명령과 출력 |
| Crush | bash `description`("30자쯤") | 명령과 출력 |
| Zed | tool마다 `initial_title(input)` template | — |

모인 것:
- 읽기 어려운 것은 shell 명령 하나다. 그래서 model이 쓰는 description은 shell tool에만 둔다. file·web tool은 인자 template으로 충분해서 어느 harness도 model에게 쓰게 하지 않는다.
- 명령을 client가 갈라(read/list/search) 탐색 call을 하나로 묶는 것도 흔하다(Claude Code, Codex, Hermes). token이 들지 않는다.
- description은 비거나 빠진다. Kilo는 필수였던 것을 선택으로 바꿨고, Copilot에는 "No explanation provided" 대체 문구가 있다. 그래서 빈 칸이면 명령을 잘라 보인다.
- 접으면 한 줄 제목이나 묶음 수("Read 3 files")다. 펼치면 원래 명령이나 인자와 출력이 보인다. 시간은 call마다 보인다.
- 따로 요약 model을 부르는 것은 Claude Code의 mobile·SDK용 하나뿐이다.

#### lophn에서

- **`shell.run`에 선택 칸 `description`을 더한다.** schema 설명은 Claude Code의 것을 따른다: 무엇을 하는지 능동형으로, 단순한 명령은 5~10 낱말, 명령·flag·path를 되풀이하지 않는다.
  - 비거나 없으면 명령 첫 줄을 잘라 보인다.
  - 승인 카드에는 싣지 않는다. 카드 내용은 program이 GateCall에서 만들고 agent가 쓴 설명은 싣지 않는다(`architecture/approval.md:51`). Claude Code와 Gemini는 확인 창에 보이지만, lophn에서 승인은 사람이 agent를 막는 자리라 agent 글이 판단을 흐리면 안 된다.
- **tool마다 제목 template을 둔다.** tool 정의에 `display(input)` 하나를 두고 `{category, title}`을 낸다.
  - `file.read`·`pdf.read`·`image.read` → read, "Read `path` (10-80)"
  - `file.grep` → search, "Search `pattern` in `path`"
  - `file.glob`·`file.outline` → list, "List `pattern`", "Outline `path`"
  - `web.search` → web, "Search the web for `q`"
  - `web.fetch` → web, "Fetch `url`"
  - `shell.run` → 명령을 갈라 정한다(아래). 나머지는 command, 제목은 description이고 없으면 명령이다.
  - `skill`, `tool.load`, 앱 tool, MCP tool → other, tool 이름(앱 tool은 선언의 이름)
  - edit/write는 지금처럼 edit card다.
- **shell 명령을 가른다.** `cd x &&` 앞부분을 떼고, 파이프와 `&&`로 이은 명령이 모두 읽기 계열이면 그 계열로 둔다. Codex `parse_command`의 작은 부분이다.
  - `cat`, `head`, `tail`, `sed -n`, `nl` → read
  - `ls`, `tree`, `find`, `fd` → list
  - `rg`, `grep`, `git grep` → search
  - 나머지 → command
- **title은 core가 만든다.** `ToolCallStarted`와 `ListToolCalls`의 call마다 `{category, title}`을 싣는다.
  - 만들 때 지금의 redaction을 거친다. body view와 같은 규칙이다.
  - 저장하지 않고 읽을 때 만든다. redaction 규칙이 바뀌어도 옛 제목에 secret이 남지 않는다.
  - renderer가 접힌 줄 때문에 call마다 입력 body를 읽지 않아도 된다.
- **묶기.**
  - 이어진 read/list/search call은 tool이 달라도 하나로 묶는다. 접힌 줄은 "Read 3 files · Searched 2 times · Listed 1 folder"다(`wording` skill로 문구를 정한다).
  - command call은 "Ran 3 commands"로 묶는다. web call도 같다.
  - call이 하나뿐이면 묶음 대신 그 call의 제목을 보인다.
- **펼치기.**
  - 묶음을 펼치면 call마다 제목과 걸린 시간이 보인다. 시간은 `ToolCall.duration_ms`이고, 도는 call은 `started_at`부터 센다.
  - call을 펼치면 redaction된 **입력 전체와 출력**이 보인다. 입력은 `shell.run`이면 명령 전체, 그 밖은 인자다. 64 KiB에서 잘린 것은 잘렸다고 쓴다. body는 펼칠 때 `viewOf`로 읽는다.
  - 보기 select의 Everything은 묶음만 펼친다. call 내용은 누를 때 열린다.
- 도는 중의 tool 줄도 snapshot과 같은 묶기 함수로 묶는다. 그러면 turn이 끝날 때 화면이 뛰지 않는다. 성공한 edit/write는 도는 중에도 tool 줄로 쌓지 않는다.

### 8. ProgressChip을 지운다

- `ProgressChip`, Tasks popover, `TaskView`, fake `TASKS`, `tasks: []` 칸을 지운다. 뒤에 둘 todo 개념이 core에 없어 production에서 한 번도 보이지 않는다(AGENTS.md "죽은 코드는 지운다").
- agent의 todo list(Claude Code `TodoWrite`, Codex `update_plan` 같은 것)는 model이 쓰는 tool부터 설계해야 하는 따로의 기능이다. 하게 되면 그 roadmap에서 화면을 새로 둔다.

### 9. 범위 밖

- 수식(KaTeX)과 다이어그램(Mermaid). 비교한 앱은 다 갖고 있다. lophn agent(PM, App Engineer)의 답에서 쓸 곳을 아직 못 봤다. 실제 답 표본도 저장소에 없다(`tests/eval/runs`에 답 글 없음, `.dev-data` message 0, provider fixture에 code fence 0). 쓰는 곳이 보이면 연다.
- transcript 가상화와 `content-visibility`. 4의 memo로 다시 그리기를 막는다. 가장 긴 session을 재어 느리면 연다.
- turn마다 펼치기. lophn은 화면마다 보기 select를 두는 쪽으로 이미 갔다.
- 보기 select 저장, code wrap toggle, 한국어 catalog.

## 정한 것 (사람)

- 글은 token streaming으로 보인다. 정석이 답이고, 지금 구현에서 옮기는 비용은 근거가 아니다(2026-10-25).

## 정한 것 (agent)

- markdown은 이미 있는 Lezer `Markdown`을 쓴다. ChatGPT의 `marked` token renderer나 react-markdown으로 바꾸지 않는다. 근거: 세 앱은 parser가 저마다 다르고 Lezer GFM도 그중 하나만큼 정석이다. URL 정책과 raw HTML 규칙이 이미 그 안에 있다.
- highlight는 Shiki(JS engine, Worker, lazy grammar)다. 근거: 세 앱이 모두 Shiki다. 처음에 Lezer를 골랐던 이유("이미 lock에 있다")는 비용 근거라 버렸다.
- link는 renderer의 `onOpenLink`와 main의 navigation guard 둘 다로 막는다. 근거: 인터넷에서 온 글을 막는 경계다(AGENTS.md "속도"). renderer만 막으면 다음 화면이 또 뚫린다.
- chat의 markdown image는 불러오지 않는다. 근거: agent 답의 image URL로 대화가 새는 길을 막는다.
- 사람 글은 plain으로 둔다. 사람이 친 `*`, `_`가 모양으로 바뀌면 안 된다.
- "Worked for"는 active(사람 대기 제외)다. 근거: label의 뜻이 "agent가 일한 시간"이다. lophn은 기다림을 따로 재는 엔진을 이미 갖고 있다. 처음에 wall을 골랐던 이유(event에 없다, checkpoint가 늦다)는 구현 근거라 버렸다.
- tool 제목은 harness들이 모인 대로 한다: model이 쓰는 description은 `shell.run`에만, 나머지는 tool마다 template, shell 명령은 client가 갈라 묶는다. 근거: 7의 조사. 여러 tool에 model 칸을 두는 Cursor(`explanation`)·Copilot(terminal과 edit tool)식은 칸이 비거나 빠지는 일이 잦고(Copilot의 대체 문구, Kilo의 선택 전환), file·web은 인자만으로 읽힌다.
- tool 제목은 core가 읽을 때 만들고 저장하지 않는다. 근거: redaction이 body view처럼 읽는 때의 규칙을 따른다. 화면 셋이 같은 제목을 쓴다.
- reasoning을 보인다. 근거: 세 앱의 정석이다. 지금 버리는 이유는 opaque 상태의 규칙이지 보이지 않기로 한 결정이 아니다.
- test는 navigation 결정(1), streaming의 retry·멈춤 때 글이 틀리게 남거나 사라지지 않는 규칙(4), reasoning 글과 tool 제목의 redaction(5, 7)에 둔다(AGENTS.md "속도": 사용자 데이터, secret 경계). 시간·문구·화면에는 붙이지 않는다.

## 순서 (계획을 열 때)

- 1은 이 roadmap과 상관없이 먼저 해도 된다(이슈 하나, 작음).
- 2 → 3: 같은 `design/components/reading/`를 고친다.
- 4 → 5: 5가 4의 delta 길을 쓴다. 4가 protocol(agent event, snapshot)을 먼저 고정한다.
- 7은 core(tool 정의의 `display`, `shell.run` schema, `ToolCallStarted`·`ListToolCalls`)를 먼저 고정하고 화면을 고친다.
- 4, 6, 7은 모두 `R/agent-tab-data.ts`를 고친다. 같은 wave에 두지 않는다.
- 8은 아무 때나.
