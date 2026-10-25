# agent-chat: agent 답을 markdown으로 흘려 그리고, 한 일과 걸린 시간을 읽을 수 있게 한다

- **목표:** 화면 셋(Agent 탭, 앱 공간 agent 칸, 런처 lophn 칸)이 함께 쓰는 agent chat을 비교한 harness들의 정석에 맞춘다.
  - agent 답이 쓰이는 대로 markdown과 code highlight로 보인다.
  - reasoning이 보인다.
  - tool call은 무엇을 했는지 제목으로 보이고, 펼치면 입력과 출력이 보인다.
  - "Worked for"는 agent가 일한 시간을 보인다.
  - markdown link가 shell 창을 바깥 page로 넘기지 못한다.
- **재료:**
  - roadmap `project-docs/products/roadmap/agent-chat.md`: 지금 코드(path:줄), 다른 harness 조사, 무엇을 만드나 1~9, 정한 것
  - 이슈 `project-docs/issues/shell.md` "파일 읽기의 markdown link를 누르면 shell 창이 그 web page로 넘어간다"
  - architecture: `event.md`(agent event, Bus, snapshot, 감독 pipe), `approval.md`(승인 카드는 program이 만든다, 51줄), `ui-kit.md`(kit과 앱 template 의존), `artifact.md`·`browser-tab.md`(navigation guard 본보기)
  - 배경 보고서: `reports/채팅 렌더링과 마크다운 비교.md`(commit 안 됨), `../rea/project/agent-activity-reversing/reports/report-lophn-comparison-ko.md`와 같은 폴더 `src/`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:** roadmap 9를 그대로 따른다. 수식·다이어그램, transcript 가상화와 `content-visibility`, turn마다 펼치기, 보기 select 저장, code wrap toggle, 한국어 catalog, agent todo list.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다.

## 정한 것

사람(2026-10-25)
1. **글은 token streaming으로 보인다.** provider SSE delta를 화면까지 흘린다. 정석이 답이고, 지금 구현에서 옮기는 비용은 근거가 아니다.
2. **고르는 기준은 정석과 맞는 의미다.** 지금 구현에 맞추느라 고르지 않는다. 이 기준으로 아래 agent 결정이 나왔다.
3. **tool call은 무엇을 했는지 semantic하게 보인다.** Claude Code의 Bash `description`처럼 읽히게 한다. 펼치면 내용이 보인다.

agent(planner). 근거는 roadmap "정한 것 (agent)"에 있다.
- markdown은 이미 있는 Lezer `Markdown`(`@lophn/ui/reading`)을 쓴다. 사람 글은 plain이다. chat에서 markdown image는 불러오지 않고 alt 글의 link로 둔다.
- link는 renderer `onOpenLink`(→ `lophnShell.openExternal`)와 shell 창 main의 navigation guard 둘 다로 막는다.
- highlight는 Shiki다. JS regex engine을 쓰므로 CSP를 바꾸지 않는다. Worker에서 돌리고 grammar는 lazy로 불러온다. 결과는 token 배열로 받아 React span으로 그린다.
  - design `CodeBlock`은 highlighter를 React context에서 받는다. shell이 그 context를 준다. context가 없는 앱은 plain이다.
- streaming의 길: adapter callback → run-loop가 묶어 agent event로 낸다 → 감독 pipe → core Bus → shell.
  - core는 session마다 쓰는 중인 글을 메모리에 들고 session snapshot에 싣는다.
  - 답이 저장되면 event를 내고, 화면은 저장된 본문으로 바꾼다.
  - retry하면 앞 attempt의 글을 버린다. 멈춰도 사람이 본 글은 남는다.
- reasoning을 보인다.
  - adapter가 읽을 수 있는 reasoning 글을 opaque 상태와 따로 모은다. OpenAI Responses는 `reasoning.summary`를 요청한다.
  - 그 글은 session 기록에 redaction을 거쳐 저장한다. reasoning 글은 model 이력으로 가지 않는다.
  - 화면은 "Thinking" → "Thought for {d}"이고 펼치면 요약이 보인다.
- "Worked for"는 active(사람 대기 제외)다.
  - turn이 끝날 때 active를 마감해 저장한다.
  - `TurnEnded`와 다시 도는 순간의 event, snapshot이 active를 싣는다.
  - `WorkingRow`는 기다림 뒤에 건너뛰지 않는다.
  - 기다린 시간은 완료 줄 tooltip에 보인다.
  - 60분 이상은 `1h 5m`이다.
  - `assembleTrace`의 `wall_ms`는 진짜 wall이다.
- tool 제목:
  - `shell.run`에 선택 칸 `description`(Claude Code 문구)을 둔다. 비면 명령 첫 줄을 보인다. tool 줄 제목에만 쓰고 승인 카드에는 싣지 않는다(`approval.md:51` "agent가 쓴 설명은 싣지 않는다". 승인은 사람이 agent를 막는 자리다).
  - tool 정의마다 `display(input) → {category, title}`이 있다. shell 명령은 read/list/search/command로 가른다.
  - core가 `ToolCallStarted`·`ListToolCalls`를 낼 때 만들고 redaction을 거친다. 저장하지 않는다.
  - 이어진 read/list/search는 하나로 묶고, command·web도 묶는다. call 하나면 그 제목이다.
  - 묶음을 펼치면 call마다 제목과 시간이 보이고, call을 펼치면 입력 전체와 출력이 보인다(64 KiB, 잘렸다고 표시).
  - 도는 중과 끝난 뒤가 같은 묶기 함수다.
- `ProgressChip`, Tasks popover, `TaskView`, fake `TASKS`, `tasks` 칸을 지운다(죽은 코드). 어디서도 import하지 않는 wireframe page `tools/wireframes/pages/screens/agent-chat.tsx`도 지운다.

agent(planner, 뼈대 검토 2026-10-25)
- **model 응답 하나가 agent message 하나다.** 지금은 tool call 없는 마지막 답만 저장한다(`run-loop/turn.ts`의 `afterModel` → `conclude`만 `ports.answer`). tool call과 같이 온 글은 model 이력에만 들어가 사람은 turn이 끝나도 못 본다. 그래서 글이나 reasoning이 있는 응답은 tool call보다 먼저 저장한다.
- **멈춘 답은 사람이 본 데까지 저장한다.** turn이 끝나기 전에 저장한다. provider가 끊어 retry하는 attempt의 글은 버린다.
- **live 글의 redaction은 core가 한다.** child는 날 delta를 감독 pipe로 core에 보내고(redact 요청으로 이미 날 글을 보내고 있다), core가 쌓인 글 전체를 secret 값으로 가리고 secret이 시작됐을 수 있는 끝(`hold_from`)을 붙잡은 뒤 `ModelOutputStreamed`를 낸다. child가 redact pipe에 "이 끝이 secret의 앞부분인가"를 물을 수 있으면 글을 골라 secret 값을 한 글자씩 알아낼 수 있다. 상수 길이로 붙잡으면 그보다 긴 token(OAuth, JWT)의 앞부분이 나오고, batch마다 가리면 두 batch에 걸친 secret이 나온다.
- **tool 제목은 한 줄, 120자에서 자른다.**
- **멈춤·실패·끊김으로 끝나는 turn도 active를 끝난 순간까지 마감한다.**
- **승인 카드에는 description을 싣지 않는다.** `approval.md:51`("agent가 쓴 설명은 싣지 않는다")을 따른다. `tool-title-approval` task는 지웠다.
- **앱 tool 제목은 저장된 wire 이름(`calendar_event_list`)이다.** core는 앱 tool의 선언 이름을 모른다. 선언 이름을 남길 칸을 새로 둘 만큼 얻는 것이 없다.
- **`ListToolCalls`에 `tool` filter를 둔다.** `session/history.ts`의 `readLoads`는 turn마다 session의 tool call을 다 읽는데 쓰는 것은 `tool.load`뿐이다. 제목을 만들려고 입력 blob을 읽게 되면 turn 시작마다 그 blob을 다시 읽게 된다.
- **`TurnResumed`는 core가 낸다.** turn request와 질문 event를 접어 마지막 기다림이 닫힐 때다. child는 gate 판정마다 `paused()`가 돌아 진짜 기다림을 가르지 못한다.
- **마지막 응답은 글이 비어도 저장하고, 중간 응답은 글이나 reasoning이 있을 때만 저장한다.** run의 답(`architecture/run.md:62`)이 지금과 같다.
- **한 model 호출의 message는 하나다.** message id를 `model_call`에서 정해 멈춤 길과 child가 같은 응답을 두 번 저장하지 못한다.
- **reasoning 시간은 provider가 알린 reasoning block의 시작과 끝으로 잰다.** 읽을 글 없이 암호화만 와도 "Thought for {d}"가 된다.

lead가 계획 안에서 정할 것(roadmap에 "계획에서 본다"로 남긴 것)
- esbuild(`packages/shell/renderer/build.ts`)가 Shiki grammar와 Worker를 따로 묶는 방법.
- 새 npm 의존(`shiki` 등)의 정확한 판.

## 단위

뼈대 worker가 task로 나눈다. 아래는 나누는 축이다.

| 단위 | 하는 일 | roadmap |
|---|---|---|
| `link` | shell 창 navigation guard, `MarkdownPane`의 `onOpenLink` | 1 |
| `chat-md` | `Markdown`의 chat 쓰임(간격, artifact path, 표 wrapper, task list, code label, image link), `MessageBody`가 `Markdown`을 쓴다 | 2 |
| `highlight` | Shiki Worker, `CodeBlock`의 highlighter context, code token | 3 |
| `chat-protocol` | 아래 core·shell task가 기대는 계약을 한 번에 고정한다: 글·reasoning delta event, 답 저장 event, snapshot의 쓰는 중인 글과 turn `elapsed`, `TurnEnded`·다시 도는 event의 active, `ToolCallStarted`·`ListToolCalls`의 `{category, title}`, reasoning 저장 모양 | 4·5·6·7 |
| `stream` | core의 live redaction(`hold_from`), adapter callback, run-loop 묶기, 감독 pipe, core의 쓰는 중인 글과 snapshot, retry·멈춤, renderer live 글(throttle, fence 고치기, memo) | 4 |
| `reasoning` | adapter의 reasoning 모으기와 요청, 저장, delta, 시간 재기, 화면 | 5 |
| `clock` | active 마감과 event·snapshot, `WorkingRow`·`WorkedFor`·`tailOf`, `duration`, `assembleTrace` | 6 |
| `tool-title` | tool `display`, `shell.run` `description`, 명령 가르기, 묶기·펼치기 | 7 |
| `chip-remove` | ProgressChip과 tasks 칸 지우기 | 8 |

## 순서

- wave 1: `link`, `chat-md`, `chat-protocol`, `chip-remove`, `stream-redact`. 서로 소유가 겹치지 않게 뼈대가 정한다.
- wave 2: core 쪽(`stream`, `reasoning`, `clock`, `tool-title`의 core task)과 `highlight`. `chat-protocol`의 계약에 기댄다.
  - 같은 file(예: `core/lophn-agent/run-loop/turn.ts`, adapter 셋)을 고치는 task는 선행으로 줄을 세운다.
- wave 3: shell renderer 쪽(`stream`, `reasoning`, `clock`, `tool-title`의 화면 task).
  - `packages/shell/renderer/conversation/agent-tab-data.ts`, `agent-tab-core-source-thread.ts`, `agent-tab-source.ts`, `agent-thread.tsx`를 여럿이 고친다. 같은 wave에서 겹치면 선행으로 세운다.
- 계약을 바꿔야 하면 worker는 고치지 않고 보고한다. lead가 `chat-protocol`을 고쳐 다시 고정한다.

## 위험 test

- "shell 창의 main frame은 `lophn-shell://` 밖으로 가지 않고, `http`/`https`는 open-external로 넘어간다." 인터넷에서 온 글이 shell 창을 차지하는 경계다.
- "retry된 attempt의 글은 화면에 남지 않고, 멈춘 답은 사람이 본 데까지 남는다." 사람이 본 답을 잃거나 틀린 답이 남는 데이터 규칙이다.
- "두 batch에 걸친 secret도 live delta에 나오지 않는다." "글 끝에 걸친 secret의 앞부분은 `hold_from`이 가리킨다." secret 경계다.
- "reasoning 글과 tool 제목은 지금의 redaction을 거친다." secret 경계다.
- 시간, 문구, 화면, 명령 가르기는 test하지 않는다(AGENTS.md "속도").

## lead가 할 일

- merge 때마다:
  - `deno task dev`(fake provider)로 세 화면 중 하나에서 본다: 글이 흘러 나오는가, code fence가 열린 채 흐를 때 깨지지 않는가, tool 묶음과 펼치기, 기다림 뒤 시간.
  - fake server에 thinking·reasoning delta가 없으면 `tests/fixtures/provider/`에 SSE fixture를 더한다.
- 다 끝나면:
  - architecture:
    - `event.md`: 새 agent event, snapshot의 쓰는 중인 글
    - `ui-kit.md`: `CodeBlock` highlighter context, 앱 template 의존
  - streaming이 adapter → run-loop → 감독 pipe → Bus → shell로 여러 module을 건너므로 `project-docs/architecture/agent-chat.md`를 새로 쓴다. `project-docs/context-component-registry.yaml`에 올린다.
  - 이슈 `shell.md`의 navigation 절을 `archived/shell.md`로 닫는다.
  - changelog 열린 판 `0.8.0`에 항목 하나. 결정은 위 "정한 것"을 옮긴다.
  - roadmap `agent-chat.md`를 지운다. 범위 밖으로 남긴 것 중 다시 열 것은 따로 roadmap으로 둔다.
  - 계획 폴더를 지운다.
- 사람에게 묻는 것:
  - AGENTS.md "사람에게 묻는 것" 전부. reasoning과 streaming을 실제 provider로 확인하는 것도 여기 든다.
  - Worker·subprocess를 띄우는 새 test(Shiki Worker 포함).
  - 그 밖은 lead가 정하고 기록한다.
