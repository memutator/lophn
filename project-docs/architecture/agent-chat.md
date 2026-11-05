# agent-chat

agent chat 화면(Home·project·앱 workspace 창의 Agent 탭)이 쓰는 길이다. `AgentView` → `AgentThread`(`packages/shell/renderer/conversation/`)를 쓴다. agent 답은 provider가 쓰는 대로 흘러 markdown으로 그려지고, reasoning과 tool 줄과 "Worked for"가 agent가 한 일과 걸린 시간을 보인다. 여러 module에 걸친다. provider adapter(`packages/core/lophn-agent/providers/`), run-loop child(`run-loop/turn.ts`, `core-ports.ts`, `live-turns.ts`의 `createLiveOutput`), 감독 pipe(`main/agent-runtime/turn-source-link.ts` → `run-loop/turn-pipe.ts`), core 메모리(`run-loop/live-turns.ts`의 `createLiveTurns`, `withLiveTurns`), ACP(`main/daemon/wiring/acp.ts`, `acp-build.ts`, `acp-send.ts`와 `packages/protocol/acp/`, `events/acp-project.ts`), tool 제목(`packages/core/lophn-agent/tools/display.ts`, `packages/core/lophn-agent/tools/reads.ts`), renderer(`conversation/live-text.ts`, `agent-tab-data.ts`, `thread-layout.ts`, `agent-tab-core-source-commands.ts`, `agent-tab-core-source-bodies.ts`, `message-list/`, `activity/`), design(`components/reading/`)과 shell의 highlight Worker(`renderer/highlight/`)다.

화면이 읽는 대화 상태와 갱신, 화면이 보내는 대화 조작의 규격은 ACP다(`architecture/acp.md`). core가 `AcpSnapshot`과 `AcpUpdated`를 내고 `AcpSend` 하나로 조작을 받는다. 화면은 ACP만 보고 그린다: agent event를 직접 접지 않고 tool 이름이나 JSON으로 종류를 가르지 않는다.

## 흐름

```
 provider SSE ─ adapter(messages·responses·chat-completions) ─ text·reasoning 쌓기
                        │ invoke.ts collector가 늘어난 조각을 onDelta로 (reasoning은 block 시작·끝도 빈 조각으로)
                        ▼
 run-loop child: createLiveOutput (attempt 하나, 50ms 묶음, 날 글)
                        │ 감독 pipe `model_output` {session, turn, model_call, kind, text}  ← redaction 전
                        ▼
 core: createLiveTurns (session마다 attempt 하나의 날 글·낸 글)
        쌓인 날 글 전체 ─ redactSettled(text, known) ─ 붙잡는 자리 앞까지 ─▶ ModelOutputStreamed {offset, text}
        ACP snapshot `writing` = 낸 글                                     │
                        │                                                   ▼
 응답이 끝나면 child: RecordMessage(machine, id = msg_<mcl ULID>) ─▶ MessageRecorded ─▶ Bus
                                                                                         │
 core acp wiring: Bus의 agent event ─ acpUpdatesOf ─▶ AcpUpdated(transient) ─▶ Gateway ─▶ shell
                                                                                                  │
 shell renderer: AcpSnapshot(처음·reread) + AcpUpdated를 reduceAcp로 접기(useAcpUpdates) ─ layoutOf(thread-layout.ts)가 줄로
        writing 글 ─ throttle 100ms ─ closeOpenFence ─ ChatMarkdown(Markdown variant chat)
        CodeBlock ─ HighlighterProvider ─ Shiki Worker(highlight-worker.js, grammar chunk lazy)

 대화 조작(보내기, 멈추기, 다시 하기, 묻기 답, 승인 결정, 대기 고치기):
 shell renderer ─ AcpSend {type, ...} ─▶ core acp wiring ─ 부른 사람의 자격으로 ─▶ SendMessage · StopTurn · AnswerAskQuestions · DecideTurnRequest · 줄 고치기 넷
```

- model 응답 하나가 agent message 하나다. 글이나 reasoning이 있는 응답은 tool call과 같이 와도 그 응답의 tool call보다 먼저 저장한다. 그래서 `MessageRecorded`가 그 응답의 `ToolCallStarted`보다 먼저 온다. 마지막 응답(tool call 없음)은 글이 비어도 저장한다.
- 사람이 멈추면 core의 writer 앞 처리기 `withLiveTurns`가 `StopTurn` 앞에서 그 turn의 `writing`(사람이 본 글)을 machine `RecordMessage`로 저장하고 `MessageRecorded`를 낸 뒤, 끝난 순간까지의 active를 `CheckpointTurn`으로 마감하고 `StopTurn`을 넘긴다. `ctx.writer`를 지나는 모든 `StopTurn`(화면, run, workflow)이 같은 길이다.
- reasoning은 같은 delta 길에 `kind: "reasoning"`으로 흐르고 저장할 때 message part `{kind: "reasoning", text, duration_ms}`가 된다(part 순서는 reasoning, text). 시간은 provider가 알린 reasoning block의 시작부터 끝까지다.
- 시간: core가 lophn turn마다 active(사람 기다림 제외)를 메모리로 센다. 승인 request와 질문이 열리면 멈추고, 마지막 기다림이 닫히면 `TurnResumed {turn, active_ms}`를 낸다. ACP snapshot의 `turn.elapsed`가 도는 turn의 값이다. turn이 끝날 때는 child가 `FinishTurn` 앞에서, core가 `StopTurn`·`InterruptTurns` 앞에서 active를 마감해 `TurnEnded.active_ms`가 끝난 순간까지의 값을 싣는다.
- tool 제목: tool 정의마다 `display(input) → {category, title}`이 있고 `toolCallDisplay`(`packages/core/lophn-agent/tools/display.ts`)가 지금의 redaction을 거친 뒤 한 줄 120자로 자른다. `ToolCallStarted`(child, 감독 pipe의 redact)와 `ListToolCalls`(core API read, 저장된 입력 blob과 core의 redaction)가 같은 함수를 부르고, 제목은 저장하지 않는다.

## 지키는 것

secret
- live 글의 redaction은 core가 한다. child는 날 글을 `model_output`으로 보낼 뿐이고 core가 attempt마다 쌓인 날 글 전체에 `redactSettled`를 건다. batch마다 따로 가리면 두 batch에 걸친 secret이 나간다.
- 붙잡는 자리(`hold_from`)는 core 안에서만 쓴다. 감독 pipe의 `redact_request`·`redact_response`에 싣지 않는다. child가 "이 끝이 secret의 앞부분인가"를 물을 수 있으면 글을 골라 거듭 물어 값을 한 자씩 알아낼 수 있다.
- 붙잡는 자리는 상수 길이가 아니다. 끝 글이 알려진 값의 앞부분(값 전체 포함)이거나 credential 규칙의 match로 이어질 수 있는 가장 이른 자리이고, 지운 span 안에 떨어지면 그 span의 시작이다(`run-loop/runtime-redaction.ts`의 `redactSettled`, `KnownSecretMatch.prefixFrom`, `packages/base/redaction/patterns.ts`의 `credentialPrefixFrom`). 상수로 붙잡으면 그보다 긴 token(OAuth, JWT, PEM)의 앞부분이 나간다.
- 알려진 값을 아직 다 모르면(`ready`가 아님) 내지 않는다. 앞서 낸 자리를 redaction이 바꾸면 그 attempt의 그 kind는 더 내지 않는다(화면이 본 글을 되돌리지 않는다).
- attempt가 끝나면 붙잡은 꼬리는 나가지 않는다. 저장된 message 본문(`message-body.ts`의 준비 단계가 redaction한다)이 live 글을 대신한다.
- reasoning 글과 tool 제목은 지금의 redaction을 거친다. tool 제목은 자르기 전에 redaction한다(120자 경계에 걸친 secret의 앞부분이 남지 않게). redaction을 끝내지 못하면 제목은 tool 이름이다.

데이터
- 한 model 호출의 message는 하나다. message id를 `model_call`에서 정해(`messageIdOf`) 멈춤 길과 child가 같은 응답을 둘 다 저장하려 해도 둘째는 같은 id 규칙에 걸린다.
- provider가 끊어 retry하는 attempt(partial)의 글은 버린다. 다른 `model_call`의 조각이 오면 core와 화면이 앞 글을 버린다. `ToolCallStarted`와 `TurnEnded`도 그 turn의 쓰는 중인 글을 비우고, 저장된 `model_call`과 끝난 turn의 늦은 조각은 버린다.
- run의 답은 그 turn의 마지막 agent message의 글이다(`architecture/run.md`). 마지막 응답을 빈 글이어도 저장하므로 중간 응답의 글이 답이 되지 않고, 빈 답은 지금처럼 `no_answer`다(`wiring/runs.ts`).
- reasoning 글은 model 이력으로 가지 않는다. 이력(`session/history.ts`, turn 안의 `state.history`)은 text part만 읽는다. opaque 상태(signature, `encrypted_content`)는 지금처럼 adapter의 opaque handle로만 되돌아간다.
- agent event는 저장하지 않는다. 쓰는 중인 글은 core 메모리(`createLiveTurns`)에만 있고, 늦게 붙거나 다시 붙은 화면은 ACP snapshot의 `writing`(낸 글 그대로)과 그 뒤 `writing_streamed`의 `offset`으로 맞춘다. offset이 맞지 않으면 `reread`가 서고 화면은 model 호출 하나에서 한 번 snapshot을 다시 읽는다.

화면
- agent 글은 markdown(`ChatMarkdown` → design `Markdown` variant chat)이고 사람 글은 plain(`ArtifactText`)이다. 사람이 친 `*`, `_`는 모양으로 바뀌지 않는다.
- chat의 markdown image는 불러오지 않고 alt 글의 link로 둔다. agent 답의 image URL로 대화가 새는 길(`![](https://…?q=<secret>)`)을 막는다. 바깥 image는 main CSP(`img-src 'self' data: blob:`)도 막는다.
- link는 renderer `onOpenLink`(→ `lophnShell.openExternal`)와 shell 창의 navigation guard(`desktop/navigation-guard.ts`의 `decideShellNavigation`) 둘 다가 막는다. shell 창 main frame은 `lophn-shell://desktop` 밖으로 가지 않고 `http`/`https`는 OS browser로, 새 창 요청은 deny다. renderer만 막으면 다음에 `<a href>`를 그리는 화면이 또 뚫린다.
- 닫히지 않은 code fence는 그릴 때만 닫는다(`closeOpenFence`). 저장된 본문은 고치지 않는다.
- 대화 밖 session 기능(model 고르기와 축, mode, `/` 명령, `/status` 사용량, 이름, fork, compact, rewind)은 ACP의 `session`(`AcpSessionMeta`)에서 읽고 `source.act`(ACP 입력)로 보낸다. 칸은 `session.capabilities`가 켠다: model·mode·명령·rewind(file·앱 부분은 `rewind_files`)·fork·compact·rename·usage·steer·줄 고치기(`queue_edit`)·Retry·이미지·머리의 session 목록(`sessions`). meta가 아직 없으면(snapshot 전) lophn의 capability 묶음(`LOPHN_CAPABILITIES`, `agent-view-model.ts`)으로 그린다. model을 바꿀 때 축 값은 화면이 새 model에 맞춰(`fitOptionValues`) 보낸다. `/` 메뉴를 열 때 snapshot을 다시 읽어 새 skill이 보인다. `/` 명령은 이름이 아니라 `opens`로 실행한다. `opens`가 있으면 화면 동작(새 session, 이름 바꾸기, archive, compact, fork, rewind, model·effort·mode(composer의 picker·menu), permissions, status·usage·context(status layer), mcp·skills)이고, null이거나 `argument_hint`가 있는 명령에 인자를 쳤으면 `run_command`로 보낸다(출력은 `command_output` 줄로 온다). 인자가 필요한 명령을 메뉴에서 고르면 `/<이름> `로 바꾸고 기다린다. 메뉴 줄은 늘 `/<이름>`이다. 순위는 이름 정확 → 이름 앞부분(짧은 것이 위) → 별칭 → 이름 조각 → 이름 포함 → 설명 단어이고 같은 순위는 출처 순서(`ACP_COMMAND_SOURCES`)와 이름 순이다(`slashEntriesOf`, `agent-view-model.ts`). query가 비면 lophn → harness(vendor 아이콘과 이름) → Skills → Plugins & MCP → Custom 묶음, 있으면 머리 글 없이 한 목록에 출처 배지다. 도는 중이면 메뉴 아래 한 줄이 다음 turn에 들어간다고 알린다.
- info notice는 회색 한 줄(`InfoRow`, warning은 경고 아이콘), `command_output`은 `/<명령>` 머리가 있는 블록(`CommandOutput`, markdown이거나 고정폭)으로 그린다. `turn`이 null이면 agent 덩어리에 넣지 않아 "Worked for"가 붙지 않는다. harness 대화의 얼굴은 vendor 아이콘(`AgentProfile` `{kind: "vendor"}`)이고, harness tool 줄은 item의 `body`로 입력·출력을 펼친다. plan 승인은 plan 본문(12줄 접기)과 mode마다 "Approve · {mode}" 단추, "Keep planning"이 있는 카드다(`approval-card/plan-card.tsx`). 결과 줄은 `approval_closed.mode`로 고른 mode를 보인다("Plan approved · {label}").
- composer 위에는 승인·질문 card 아래에 dock 한 자리가 있다(`conversation/dock/`). dock은 Goal → Todo(`plan`) → Running(도는 subagent·background task) → Queue(다음 turn 줄) card를 같은 규칙으로 쌓고, 내용이 없는 card는 그리지 않으며, 접힌 요약 한 줄이 기본이고 card 하나만 펼친다. `/subagents`·`/tasks`는 Running card를, `/goal`은 Goal card를 연다. 켜고 끄는 상태(`toggles`)는 composer 안 chip, role은 model picker 맨 아래 Roles 절, 사용 한도와 context 분해는 status layer다.
- subagent tool은 대화 안 subagent 줄(`activity/subagent-row.tsx`)이고 누르면 대화 위 한 겹으로 자식 대화(`children[child]`를 같은 `layoutOf`로 그린 읽기 전용 thread, 손자는 한 겹 더)를 연다. 자식이 돌고 capability가 켜져 있으면 아래 줄에서 방향을 주거나(`steer_child`) 멈춘다(`stop_child`).
- `draft_set`은 `key`가 새 값일 때 한 번 composer를 그 글로 채운다(사람이 이미 친 글은 덮지 않는다. 화면을 처음 열 때 이미 있던 key는 채우지 않는다). OpenCode `/undo`가 쓴다. 승인 카드의 단추는 pending의 `choices` 순서다. 같은 화면을 lophn session이 아닌 대화(터미널 탭의 harness GUI, [harness-gui.md](harness-gui.md))도 쓴다. source는 `packages/shell/renderer/conversation/agent-tab-gui-source.ts`다.
- tool 줄은 ACP의 `tool` 항목 하나씩이고, 묶는 일은 화면의 몫이다. snapshot에서 온 항목이든 갱신으로 접은 항목이든 `layoutOf`(`thread-layout.ts`)가 같은 묶기 함수(`packages/shell/renderer/conversation/activity/tool-groups.ts`)로 묶는다. 그래서 turn이 끝나 snapshot을 다시 읽어도 줄이 뛰지 않는다. 이어진 read·list·search는 하나로, command·web은 category마다, other는 같은 tool끼리 묶고, 사이에 agent message가 오면 끊는다. 펼친 call의 입력·출력은 ACP에 싣지 않고 사람 화면용 body view(64 KiB, 지금의 redaction)로 따로 읽는다(`agent-tab-core-source-bodies.ts`).
- highlight는 Shiki의 JS regex engine을 Worker에서 돌리고 token 배열을 React span으로 그린다. HTML 문자열을 넣지 않고 CSP(`shell-protocol.ts`, wasm·eval 없음)를 바꾸지 않는다. 자라는 code block은 받은 결과가 지금 code의 앞부분이면 그만큼 칠하고 나머지는 plain으로 붙인다.
- 대화 조작은 `AcpSend`로 보내고 core가 부른 사람의 자격으로 지금 route에 넘긴다. 화면이 route를 골라 부르지 않으니 새 조작을 더해도 권한은 그 route가 본다(`architecture/acp.md`). session 관리(fork, rewind, model 바꾸기, compact)는 제 route다.
- 승인 카드에는 agent가 쓴 설명(`shell.run`의 `description`)을 싣지 않는다. `description`은 tool 줄 제목에만 쓴다(`architecture/approval.md` "카드 내용은 program이 GateCall에서 만든다").
- "Worked for"는 active다. 기다린 시간(wall − active)은 1초 이상일 때 완료 줄 tooltip이다. 일하는 중 줄은 `active + (now − 기준 시각)`이라 기다림 뒤에 건너뛰지 않는다. `active_ms`를 모르는 turn(null)은 wall이다.

## 왜 이 모양인가

- token streaming이 정석이다(Claude, ChatGPT, Codex, Hermes). 지금 구현에서 옮기는 비용은 근거로 쓰지 않았다(사람, 2026-10-25).
- live 글을 child에서 가리는 안을 버렸다. child가 붙잡을 자리를 core에 물어야 하고, 그 물음이 secret 값을 한 자씩 알아내는 길이 된다. 값을 아는 곳(core)이 가리고 붙잡는다. child는 이미 `redact_request`로 날 글을 core에 보내므로 날 글을 보내는 것은 새 노출이 아니다.
- 쓰는 중인 글을 core 한 곳(`live-turns.ts`)에 둔다. 날 글을 받는 곳(감독 pipe)과 ACP snapshot을 싣는 곳(`acp` wiring)이 다르지만, 한 곳에 있어야 retry·저장·멈춤에서 날 글과 낸 글이 같이 비워진다. wiring끼리 import하지 않으므로 늦은 칸 `ctx.liveTurns`로 넘긴다.
- 멈춘 글은 core가 `StopTurn` 앞에서 저장한다. child가 멈춤을 알 때는 core가 turn을 이미 닫아 `RecordMessage`가 거절한다. handler는 writer Worker에서 돌아 core 메모리를 읽지 못한다.
- `TurnResumed`는 core가 낸다. child는 Gate 판정마다 기다림 표시를 돌려 진짜 사람 기다림을 가르지 못하고, 사람 기다림 event(turn request, 질문)는 core Bus에 있다.
- tool 제목은 저장하지 않고 읽을 때 만든다. redaction 규칙이 바뀌어도 옛 제목에 secret이 남지 않고 화면 셋이 같은 제목을 쓴다. 그래서 `ListToolCalls`는 blob을 기다릴 수 있고 지금의 redaction이 있는 core API read다.
- model이 쓰는 설명은 `shell.run`에만 둔다. 비교한 harness들이 모인 대로다: file·web tool은 인자 template으로 읽히고, shell 명령만 읽기 어렵다. 칸은 선택이라 비면 명령 첫 줄을 쓴다.
- markdown은 이미 있는 Lezer `Markdown`을 쓴다. URL 정책과 raw HTML 규칙이 그 안에 있다. highlight는 비교한 세 앱이 모두 쓰는 Shiki다. grammar는 언어를 미리 고르지 않고 lazy chunk로 둔다(설치본 약 9 MB).
- reasoning을 보인다. 버리던 이유는 opaque 상태의 규칙이었지 보이지 않기로 한 제품 결정이 아니었다. 요약을 받으려면 요청에 실어야 한다(Anthropic adaptive thinking `display: "summarized"`, OpenAI Responses `reasoning.summary: "auto"`).
