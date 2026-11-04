# acp

ACP(App Context Protocol)는 agent 쪽이 내놓는 대화(메시지와 content block, tool 진행, 묻기·승인, 흘러나오는 글, turn 상태)와 화면이 보내는 대화 조작을 정한 lophn 규격이다. 표준 Agent Client Protocol이 아니다. lophn 채팅 화면이 이 규격만 보고 그리고, 뒤에 앱 화면과 third-party CLI GUI가 같은 규격을 쓴다. 정의는 `packages/protocol/acp/`(항목, 상태, 갱신, `reduceAcp`, route)와 `packages/protocol/events/acp-project.ts`(`acpUpdatesOf`)다. projection은 `AgentEvent`를 읽고 events가 `AcpUpdated`를 위해 acp를 읽으므로 protocol 최상위 순환을 피하려고 events에 둔다. core가 만든다: route `AcpSnapshot {session}`(→ `AcpState`)과 transient event `AcpUpdated`(payload `{session, update}`, subject는 null이라 화면은 type으로 건 구독에서 session을 고른다). 읽는 화면은 뒤 wave에서 옮기고, 그동안 옛 길(`ThreadView`, `foldEvent`)과 나란히 있다.

## 모양

```
 AcpState (snapshot)                      AcpUpdate (stream)                 AcpInput (화면 → core)
  seq, items[], turn, queued[],            message_added/queued/removed/taken  send, stop, retry, answer, decide,
  pending{approval, question},             turn_started/resumed/ended          send_queued, remove_queued,
  writing, dropped, reread                 writing_streamed, message_recorded  edit_queued, move_queued
                                           tool_started/ended, hidden_added
        ▲ 처음·다시 읽을 때                 approval_opened/closed, question_*
        │                                          │
        └──────────── reduceAcp(state, update) ◀──┘
                                                   ▲
 AgentEvent ── acpUpdatesOf(event, AcpContext) ────┘   (core가 부른다. 순수. events/acp-project.ts)
```

- `AcpItem`은 대화의 줄이고 `seq`(session 안의 순번, 1부터)로 순서를 정한다. 종류는 다섯이다.
  - `message`: actor(user, agent, received), sender, call, reply_to, delivery, turn, `content`(content block 배열), `reasoning`, `cards`(`visual.show`가 올린 앱 카드 `{app, view}`), `complete`.
  - `tool`: tool call 하나. `tool`(정본 이름), `category`, `title`, `state`, `duration_ms`, 그리고 종류 `detail`.
  - `approval`: 승인 결정 뒤 남는 줄(subject, outcome, choice, reason).
  - `notice`: turn의 꼬리. 정상·멈춤은 `turn_end`(active_ms, waited_ms), 실패는 `error`(code, message).
  - `hidden`: rewind가 숨긴 구간. 숨긴 항목은 `items`(평평한 목록)에 들고, `seq`는 숨긴 첫 항목의 순번이다. top-level에서는 그 항목들이 빠진다.
- tool 종류(`detail.kind`): `edit`(document, path, added, removed), `call`(call, to, task, reply, state, fail_reason, session), `question`(group, outcome, lines), `consent`(release), `generic`. 종류마다 화면에 필요한 칸만 싣고 입력·출력·diff 같은 큰 본문은 싣지 않는다(따로 읽는다). 화면은 tool 이름이나 JSON을 읽어 종류를 가르지 않는다.
- `AcpState`의 나머지: `turn`(가장 늦게 시작한 turn: phase, started_at, elapsed), `queued`(도는 중에 다음 turn으로 보낸 사람 메시지. 순번이 없다), `pending`(composer 위에 놓이는 승인 카드와 질문 묶음. 둘 다 있으면 turn은 waiting), `writing`(저장 전 model 호출 하나의 글), `dropped`(늦은 조각을 거를 기억), `reread`.
- message의 `content`는 content block이다(`contentBlockSchema`). `message_recorded`는 core가 읽은 저장된 본문(`body`)을 싣고, 그러면 항목은 `complete`이고 snapshot과 같다. 본문을 못 읽었으면(`body` null) `content`는 흘러나온 글(최종 본문의 앞부분)이거나 비어 있고 `complete`가 false라 snapshot을 다시 읽는다. harness가 쓴 tool 줄(`harness_tool` part)은 전용 항목이 생기기 전까지 `[상태] 이름: 요약` 글 block 하나다.
- `cards`는 content block이 아니라 message의 따로 칸이다. agent message의 `app_card` part를 `{app, view}`로 옮긴다.
- `AcpInput`은 대화 조작뿐이다: `send`(content block, 앱 context는 `resource` block), `stop`, `retry`, `answer`, `decide`(`TurnRequestChoice` 그대로), 다음 turn 줄 고치기 넷. session 관리(fork, rewind, model 바꾸기, compact)는 ACP 입력이 아니다.

## 지키는 것

순서와 읽기
- 항목의 순서는 `seq`다. 같은 항목을 snapshot과 갱신이 같은 순번으로 낸다.
- `reduceAcp`는 같은 갱신을 두 번 접어도 같은 상태를 낸다. 항목은 id로 한 번만 들고, 글 조각은 겹친 부분을 두 번 붙이지 않는다. snapshot보다 앞선 갱신을 snapshot 위에 다시 접지 않는 일(읽기 시작 때 쌓인 갱신 개수 표시)은 읽는 쪽의 몫이다.
- `reread`가 서면 화면은 snapshot을 다시 읽어 상태를 바꿔 끼운다. 서는 때: ① 다음 순번(`state.seq + 1`)을 건너뛴 항목이 왔을 때, ② 글 조각의 offset이 앞 글 길이를 넘었을 때, ③ 놓친 `approval_opened`로 닫는 갱신의 승인 카드를 모를 때, ④ turn이 끝났는데 본문을 모르는 agent message(`complete` false)가 있을 때(core가 본문을 읽지 못한 때뿐이다). ②는 한 model 호출에서 한 번만 다시 읽는 것이 읽는 쪽의 몫이다(그러고도 안 맞으면 `message_recorded`가 맞춘다).
- 줄에 선 메시지(`queued`)는 순번이 없다. 대화에 들 때(`message_taken`: turn이 가져가거나 steer로 올릴 때) 순번을 받는다. 순번을 미리 받으면 줄에 선 동안 항목 사이에 빈 순번이 생겨 `reread`가 거짓으로 선다.

secret
- 흘러나온 글(`writing_streamed`)의 redaction은 core `run-loop/live-turns.ts`의 규칙 그대로이고 ACP로 나가는 글은 그것을 거친 뒤의 것뿐이다(결정 8). `acpUpdatesOf`는 순수 projection이라 redaction을 하지 않고 규칙을 복사하지도 않는다. 받는 `AgentEvent`가 Bus에서 나온 것(`ModelOutputStreamed`, `ToolCallStarted.display`는 이미 redaction을 거침)이어야 하고, `AcpContext`가 주는 값(질문 글, 승인 이유 등)도 core가 redaction을 거친 값이어야 한다. 갱신에 실리는 글은 event의 것과 context의 것뿐이다.
- `writing`에서 message로 넘어갈 때 흘러나온 글은 최종 본문의 앞부분이다(붙잡은 꼬리는 나가지 않았다). 그래서 `complete: false`다.

## core가 하는 것

`acpUpdatesOf(event, context)`는 event만으로 알 수 없는 것을 `AcpContext`로 받는다. `AgentEvent`에서 바뀐 것은 `MessageReceived.body`가 content block 배열이라는 것뿐이다. core는 `wiring/acp.ts`(Bus 구독, route, rewind 훅)와 `wiring/acp-build.ts`(기록 읽기, snapshot 조립, 갱신 projection)로 채운다.

| context | 내용 | core가 채우는 곳 |
|---|---|---|
| `seq(id)` | 항목이 대화에 들 때 session마다 1부터 이어 붙여 **저장한** 순번. message id, tool_call id, 승인 request id, `acpNoticeId(turn)`로 찾는다. 줄에 선 메시지는 null | 표 `acp_items(session, id, seq, kind, turn, at, data)`. event를 처리할 때 command `AllocateAcpItems`가 붙이고(이미 있는 id는 그 순번) snapshot도 같은 표를 읽는다 |
| `tool(toolCall)` | tool 종류와 칸. 모르면 null(=generic) | 시작 때는 `ask`만 안다. `ToolCallEnded`에서 저장된 입력·결과를 읽어(redaction을 한 번 더 거쳐) `edit`·`call`·`question`·`consent`를 만든다. snapshot도 같은 함수 |
| `questions(toolCall)` | 대기 중인 질문 묶음 내용 | event를 받는 순간 메모리 기다림에서 읽어 redaction한다(풀리면 사라진다) |
| `agentOf(session)`, `agentName(agent)` | 보낸 session의 agent와 그 이름 | session·agent 정의 read. 그래서 snapshot과 갱신이 같은 이름을 낸다 |
| `body(message)` | 저장된 agent message의 본문 | `ReadMessageBody`를 읽어 redaction한 content·reasoning·cards |
| `decision(request)` | 사람이 고른 허락 범위와 거절 이유 | event를 받는 순간 approvals의 결정을 읽는다 |

같은 상태가 되는 방법
- snapshot과 갱신이 같은 읽기 함수(`readMessageBody`, `toolDetailOf`)와 같은 순번 표를 쓴다. test는 같은 기록에서 갱신을 `reduceAcp`로 접은 상태와 snapshot이 같은지 본다.
- 순번이 없는 기록(옛 data, 놓친 event)은 snapshot을 처음 읽을 때 대화에 든 때 순서(turn을 연 입력은 turn의 시작 시각, 나머지는 만든 시각, 같은 시각이면 메시지, tool, 승인 결과, 꼬리 순)로 이어 붙인다. 표 채우기 migration이 따로 없다.
- 승인 결과(`approval`)는 기록에 없어 결정할 때 `acp_items.data`에 내용(subject, outcome, choice, reason)을 저장한다. turn 꼬리(`notice`)는 turn 행에서, 숨김(`hidden`)은 rewind 기록의 boundary_seq와 result_seq 사이의 메시지와 메시지가 전부 숨은 turn의 항목에서 만든다.
- `hidden_added`는 `AgentEvent`가 없어 core가 `Rewind` command가 성공한 뒤 snapshot을 다시 만들어 숨긴 구간을 낸다. 구간이 합쳐지면 새 `hidden`이 앞 구간의 항목을 평평하게 품고 `reduceAcp`가 앞 `hidden`을 걷는다.
- 줄에 선 메시지는 도는 turn이 있을 때 사람이 다음 turn으로 보낸 것이다. 순번을 받지 않았으면(`acp_items`에 없으면) 줄에 서고, turn이 가져가거나 steer로 올릴 때 순번을 받는다.
- snapshot의 `writing`은 core `live-turns.ts`가 낸 글 그대로이고 `at`은 그 turn의 시작이다. `pending`은 approvals(harness 물음은 거른다)와 질문 기다림에서, `turn.elapsed`는 live-turns에서 읽는다.
- 대기 중인 질문의 묶음 id는 메모리에만 있어, 풀린 질문의 `group`은 null이다.

redaction
- 나가는 글(message의 글·reasoning, tool의 칸, 승인 subject·reason, 질문 글, 접힌 구간의 대상)은 모두 core의 지금 redaction을 한 번 더 거친다. 저장된 본문이어도 같다. 알려진 secret을 다 모르는 동안은 빈 글이다. `MessageReceived.body`도 갱신에 싣기 전에 거친다. 흘러나온 글(`ModelOutputStreamed`)은 live-turns가 이미 거친 것이다.

## 옛 `ThreadView`와의 대응

| 옛 | ACP |
|---|---|
| `entries`(시각 merge) | `items`, `seq` 순서 |
| `message`의 `text` / `liveReasoning` | `content` / `reasoning`, `complete` |
| `tools`(묶음), `edit`, `call`, `release-consent`, `questions` | `tool` 항목 하나씩, `detail.kind` 넷. 이어진 call을 묶는 일은 화면의 몫이다 |
| `approval-result`, `turn-end`, `provider-error`, `hidden` | `approval`, `notice`(`turn_end`·`error`), `hidden` |
| `pending.approval` / `pending.questions` | `pending.approval` / `pending.question` |
| `live`(+`gap`), `dropped` | `writing`, `dropped`, `reread` |
| `foldEvent`, `foldDelta`, `turnEndTimes` | `reduceAcp`, `acpUpdatesOf`, `acpTurnTimes` |

## 왜 이 모양인가

- 순번이 항목을 정하는 것으로 한 것: 시각으로 merge하면 같은 시각의 항목과 늦게 온 항목의 자리가 흔들리고, snapshot과 stream이 겹칠 때 중복·누락을 알아볼 방법이 없다. 순번은 빠짐을 곧바로 알려 주고 `reread`로 맞춘다.
- reducer를 protocol에 둔 것: core(snapshot 확인)와 화면(상태 접기)과 뒤의 third-party GUI가 같은 접기를 써야 같은 상태가 나온다. 의존 없는 순수 함수를 shell과 core가 같이 써야 할 때의 예외다(module-catalog).
- projection이 context를 받는 것: event를 바꾸지 않고(`AgentEvent`를 쓰는 곳이 많다) event에 없는 칸만 core가 채우게 했다. 모두 이미 있는 값을 찾는 함수라 IO가 없고, `acpUpdatesOf`는 순수하다.
- `queued`가 항목이 아닌 것: 줄에 선 메시지는 아직 대화의 일이 아니다(고치고 빼고 순서를 바꿀 수 있다).
