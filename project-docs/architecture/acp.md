# acp

ACP(App Context Protocol)는 agent 쪽이 내놓는 대화(메시지와 content block, tool 진행, 묻기·승인, 흘러나오는 글, turn 상태)와 화면이 보내는 대화 조작을 정한 lophn 규격이다. 표준 Agent Client Protocol이 아니다. lophn 채팅 화면이 이 규격만 보고 그리고, 뒤에 앱 화면과 third-party CLI GUI가 같은 규격을 쓴다. 정의는 `packages/protocol/acp/`다. 지금(계획 acp의 wave 1)은 protocol에 규격과 순수 함수만 있고, 만드는 core와 읽는 화면은 뒤 wave에서 옮긴다. 그동안 옛 길(`ThreadView`, `foldEvent`)과 나란히 있다.

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
 AgentEvent ── acpUpdatesOf(event, AcpContext) ────┘   (core가 부른다. 순수)
```

- `AcpItem`은 대화의 줄이고 `seq`(session 안의 순번, 1부터)로 순서를 정한다. 종류는 다섯이다.
  - `message`: actor(user, agent, received), sender, call, reply_to, delivery, turn, `content`(content block 배열), `reasoning`, `complete`.
  - `tool`: tool call 하나. `tool`(정본 이름), `category`, `title`, `state`, `duration_ms`, 그리고 종류 `detail`.
  - `approval`: 승인 결정 뒤 남는 줄(subject, outcome, choice, reason).
  - `notice`: turn의 꼬리. 정상·멈춤은 `turn_end`(active_ms, waited_ms), 실패는 `error`(code, message).
  - `hidden`: rewind가 숨긴 구간. 숨긴 항목은 `items`(평평한 목록)에 들고, `seq`는 숨긴 첫 항목의 순번이다. top-level에서는 그 항목들이 빠진다.
- tool 종류(`detail.kind`): `edit`(document, path, added, removed), `call`(call, to, task, reply, state, fail_reason, session), `question`(group, outcome, lines), `consent`(release), `generic`. 종류마다 화면에 필요한 칸만 싣고 입력·출력·diff 같은 큰 본문은 싣지 않는다(따로 읽는다). 화면은 tool 이름이나 JSON을 읽어 종류를 가르지 않는다.
- `AcpState`의 나머지: `turn`(가장 늦게 시작한 turn: phase, started_at, elapsed), `queued`(도는 중에 다음 turn으로 보낸 사람 메시지. 순번이 없다), `pending`(composer 위에 놓이는 승인 카드와 질문 묶음. 둘 다 있으면 turn은 waiting), `writing`(저장 전 model 호출 하나의 글), `dropped`(늦은 조각을 거를 기억), `reread`.
- message의 `content`는 content block이다(`contentBlockSchema`). `complete`가 false면 `content`는 흘러나온 글(최종 본문의 앞부분)이거나 비어 있다. stream은 저장된 agent message의 본문을 싣지 않으므로 최종 본문은 snapshot이 준다.
- `AcpInput`은 대화 조작뿐이다: `send`(content block, 앱 context는 `resource` block), `stop`, `retry`, `answer`, `decide`(`TurnRequestChoice` 그대로), 다음 turn 줄 고치기 넷. session 관리(fork, rewind, model 바꾸기, compact)는 ACP 입력이 아니다.

## 지키는 것

순서와 읽기
- 항목의 순서는 `seq`다. 같은 항목을 snapshot과 갱신이 같은 순번으로 낸다.
- `reduceAcp`는 같은 갱신을 두 번 접어도 같은 상태를 낸다. 항목은 id로 한 번만 들고, 글 조각은 겹친 부분을 두 번 붙이지 않는다. snapshot보다 앞선 갱신을 snapshot 위에 다시 접지 않는 일(읽기 시작 때 쌓인 갱신 개수 표시)은 읽는 쪽의 몫이다.
- `reread`가 서면 화면은 snapshot을 다시 읽어 상태를 바꿔 끼운다. 서는 때: ① 다음 순번(`state.seq + 1`)을 건너뛴 항목이 왔을 때, ② 글 조각의 offset이 앞 글 길이를 넘었을 때, ③ 놓친 `approval_opened`로 닫는 갱신의 승인 카드를 모를 때, ④ turn이 끝났는데 본문을 모르는 agent message(`complete` false)가 있을 때. ②는 한 model 호출에서 한 번만 다시 읽는 것이 읽는 쪽의 몫이다(그러고도 안 맞으면 `message_recorded`가 맞춘다).
- 줄에 선 메시지(`queued`)는 순번이 없다. 대화에 들 때(`message_taken`: turn이 가져가거나 steer로 올릴 때) 순번을 받는다. 순번을 미리 받으면 줄에 선 동안 항목 사이에 빈 순번이 생겨 `reread`가 거짓으로 선다.

secret
- 흘러나온 글(`writing_streamed`)의 redaction은 core `run-loop/live-turns.ts`의 규칙 그대로이고 ACP로 나가는 글은 그것을 거친 뒤의 것뿐이다(결정 8). `acpUpdatesOf`는 순수 projection이라 redaction을 하지 않고 규칙을 복사하지도 않는다. 받는 `AgentEvent`가 Bus에서 나온 것(`ModelOutputStreamed`, `ToolCallStarted.display`는 이미 redaction을 거침)이어야 하고, `AcpContext`가 주는 값(질문 글, 승인 이유 등)도 core가 redaction을 거친 값이어야 한다. 갱신에 실리는 글은 event의 것과 context의 것뿐이다.
- `writing`에서 message로 넘어갈 때 흘러나온 글은 최종 본문의 앞부분이다(붙잡은 꼬리는 나가지 않았다). 그래서 `complete: false`다.

## core가 해야 할 것 (AgentEvent에 없는 것)

`acpUpdatesOf(event, context)`는 event만으로 알 수 없는 것을 `AcpContext`로 받는다. `AgentEvent`는 바꾸지 않았다. core(wave 2)가 이것을 채운다.

| context | 내용 | 이유 |
|---|---|---|
| `seq(id)` | 항목이 대화에 들 때 session마다 1부터 이어 붙여 **저장한** 순번. message id, tool_call id, 승인 request id, `acpNoticeId(turn)`(`end-<turn>`)로 찾는다. 줄에 선 메시지는 null | event에 순번이 없고 snapshot이 같은 순번을 내야 한다. 항목이 될 id에 null이 오면 그 갱신은 만들지 않는다 |
| `tool(toolCall)` | tool 종류와 칸. 모르면 null(=generic) | tool 이름으로 종류를 가르는 일을 core가 한다. `edit`의 document·path·added·removed는 끝나야 알아 `ToolCallEnded`에서야 준다 |
| `questions(toolCall)` | 대기 중인 질문 묶음 내용 | `QuestionAsked`는 내용을 싣지 않는다 |
| `agentOf(session)` | 메시지를 보낸 session의 agent | `MessageReceived.from`은 session id뿐이다 |
| `decision(request)` | 사람이 고른 허락 범위와 거절 이유 | `TurnRequestClosed`는 allow·reject·cancelled만 싣는다. snapshot과 같은 상태를 내려면 필요하다 |

그 밖에 core가 해야 하는 것(snapshot과 갱신이 같은 상태를 내려면):
- 항목 순번을 기록에 둔다(새 ledger step). 승인 결과(`approval`)와 turn 꼬리(`notice`)와 rewind 숨김(`hidden`)을 기록에서 만들 수 있게 하고, 없으면 기록을 더한다.
- `hidden_added`는 `AgentEvent`가 없어 core가 rewind 때 직접 낸다.
- snapshot의 `writing`은 core `live-turns.ts`가 낸 글 그대로이고 `elapsed`·`queued`·`pending`도 같은 상태에서 만든다.
- `MessageReceived.body`는 아직 string이라 `acpUpdatesOf`가 text block 하나로 싼다. wave 2에서 body가 content block이 되면 그 한 줄을 바꾼다.
- 메시지의 `reasoning`(part `{text, duration_ms}`)은 ACP 칸이다. `app_card` part(`visual.show`)는 content block이 아니어서 아직 ACP 칸이 없다(wave 2에서 정한다).

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
