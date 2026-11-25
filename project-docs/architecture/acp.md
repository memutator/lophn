# acp

ACP(App Context Protocol)는 agent 쪽이 내놓는 대화(메시지와 content block, tool 진행, 묻기·승인, 흘러나오는 글, turn 상태)와, 화면이 보내는 대화 조작을 정한 lophn 규격이다. 표준 Agent Client Protocol이 아니다. lophn 채팅 화면은 이 규격만 보고 그리고 이 규격으로만 보낸다. 앱 화면도 같은 규격으로 자기 앱 workspace의 session과 이야기하고(`lophnApp.agent`), third-party CLI GUI(Claude Code, Codex, OpenCode, omp)도 같은 규격으로 그려진다.

규격은 세 덩어리다. 상태 `AcpState`(snapshot), 상태를 한 걸음씩 바꾸는 갱신 `AcpUpdate`, 화면이 보내는 `AcpInput`. 갱신을 상태에 접는 reducer는 순수 함수이고 규격과 같이 protocol에 있다. core는 기록에서 snapshot을 만들고 agent event를 갱신으로 바꿔 내보낸다. 화면은 snapshot을 한 번 읽고 그 위에 갱신을 접는다. 순서가 어긋나면 snapshot을 다시 읽는다.

## 문제

- 화면이 session 기록(메시지, turn, tool call, rewind)을 제 나름대로 읽어 대화를 만들면, tool 이름과 JSON으로 줄 종류를 짐작하고 snapshot과 event를 시각으로 합쳐야 한다. 그러면 turn이 끝난 뒤 줄이 튀고, 승인 결과처럼 event 길에만 있던 것은 다시 읽으면 사라지며, 같은 해석을 앱 화면과 third-party GUI가 다시 짜야 한다.
- 화면의 대화 조작이 route 여러 개와 그 입력 모양을 직접 알면, 다른 화면이 같은 대화를 하려 할 때 그 지식을 다시 짜야 한다.
- harness(third-party CLI)의 대화는 lophn 기록에 없다. 그래도 같은 화면이 그려야 한다.

## 목표와 비목표

- 목표: 화면이 대화를 그리고 조작하는 데 필요한 것을 agent가 낸 모양 그대로 규격 하나로 준다. lophn agent와 harness가 같은 모양을 낸다. snapshot과 갱신이 같은 상태가 된다. 순서와 빠짐을 화면이 스스로 알아본다.
- 목표: 화면은 source가 가진 기능을 capability로 알고 칸을 켠다. 이름이나 JSON을 해석하지 않는다.
- 비목표: 표준 ACP를 따르는 것. lophn에 맞춰 정했다.
- 비목표: 화면 모양. 항목은 agent가 낸 것의 모양이고, 이어진 call을 묶는 것 같은 줄 배치는 화면(renderer)의 몫이다.
- 비목표: 앱 화면이 agent의 승인이나 rewind를 조작하는 것. 앱 화면은 입력 일부만 보낸다.

## 모델

```
 AcpState (snapshot)                      AcpUpdate (stream)                 AcpInput (화면 → source)
  seq, items[], turn, queued[],            message_added/queued/removed/taken  send, stop, retry, answer, decide,
  pending{approval, question},             turn_started/resumed/ended          send_queued, remove_queued,
  writing, dropped, reread,                writing_streamed, message_recorded  edit_queued, move_queued,
  session, plan, children, tasks, draft    tool_started/ended/detail_changed   세션 조작(아래)
        ▲ 처음·다시 읽을 때                 approval_opened/closed, question_*
        │                                  session_changed, plan_changed ...
        └────────── reducer(state, update) ◀──┘
                                    ▲
 AgentEvent ── projection(event, context) ──┘   (core가 돌린다. 순수)
```

### 항목

`AcpItem`은 대화의 줄 하나이고 `seq`(session 안의 순번, 1부터)로 순서를 정한다. 종류는 다섯이다.

- `message`: actor(user, agent, received), sender, call, reply_to, delivery, turn, `content`(content block 배열), `reasoning`, `cards`, `complete`, `origin`.
  - `received`는 다른 쪽(다른 agent나 program)이 보낸 메시지이고 sender로 가른다. 다른 컴퓨터의 agent가 보낸 것은 sender가 agent(agent id 없음)이고 이름이 "<name> on <computer>"다(live와 이력이 같은 글).
  - `via`(선택 `{app, name}`)는 앱 화면이 보낸 사람 메시지의 이름표다. 이름표일 뿐 보낸 쪽(sender)이 아니다: 메시지는 사람의 것(`actor: user`, `from` human)이고 model이 받는 글, 허락, attended, checkpoint·rewind·steer·queue edit은 그대로다. name은 보낼 때의 앱 slug다. snapshot과 갱신, 줄 선 메시지(`queued`)에 모두 있다. 채팅 탭·CLI·run·job이 보낸 메시지에는 없다.
  - `cards`는 `visual.show`가 올린 앱 카드 `{app, view, params?}`이고 content block이 아니라 message의 따로 칸이다. `params`는 그 카드 화면의 선언 schema로 검사해 실은 인자이고, 옛 message에는 없다.
  - `origin`은 그 CLI 자신의 message id다. 같은 CLI session을 다시 열어도 같아서 thread bookmark의 key가 된다. lophn은 null이고 늦게 알면 `origin_set`으로 채운다.
  - `complete`가 false면 `content`는 흘러나온 글(최종 본문의 앞부분)이거나 비어 있다. 최종 본문은 snapshot을 다시 읽어야 안다.
  - harness가 쓴 tool 줄(`harness_tool` part)은 전용 항목이 생기기 전까지 `[상태] 이름: 요약` 글 block 하나다.
- `tool`: tool call 하나. `by`(agent, user), `tool`(정본 이름), `category`, `title`, `state`(running, ok, error, denied, cancelled), `duration_ms`, 종류 `detail`, harness면 `body`.
- `approval`: 승인 결정 뒤 남는 줄(subject, outcome, choice, reason, plan 승인이면 고른 `mode`).
- `notice`: 정상·멈춤은 `turn_end`(active_ms, waited_ms), 실패는 `error`(code, message, 있으면 판정 경로와 provider request id를 담은 `evidence`), 알림은 `info`(text, level info·warning), 슬래시 명령 출력은 `command_output`(command, text, format markdown·preformatted). `turn`은 nullable이다: turn 밖에서 돈 명령의 출력은 turn이 없고 화면은 "Worked for"를 붙이지 않는다. `turn_end`·`error`는 늘 turn이 있다.
- `hidden`: rewind가 숨긴 구간. 숨긴 항목은 지워지지 않고 `items`(평평한 목록, 앞서 숨은 구간의 항목도 평평하게)에 들고, `seq`는 숨긴 첫 항목의 순번이라 대화 안의 자리가 그대로다. top-level에서는 그 항목들이 빠진다.

### tool 종류와 본문

`detail.kind`는 `edit`(document, path, added, removed), `call`(call, to, task, reply, state, fail_reason, session, remote. `remote`는 다른 컴퓨터로 보낸 call의 `{machine, computer, delivery, session}`이고 이 기계 안의 call은 null이다. `architecture/machine-a2a.md`), `question`(group, outcome, reply, lines), `consent`(release), `subagent`(agent, description, `child`, state, model, last), `generic`이다.

- 종류는 tool 이름이 정하므로 시작 때부터 그 종류이고, 실패·거절·취소해도 지킨다(실패는 항목의 `state`가 말한다). 단 동의(`consent`)는 결과를 봐야 알아 성공해 끝난 뒤에만 생긴다.
- 입력에서 뽑는 칸(`edit`의 path·줄 수, `call`의 to·task·reply)은 시작 때부터 차 있다. 결과에서 아는 칸(`call`의 call id·state·fail_reason·session)은 call이 생긴 뒤에야 알아서 그 전과 실패한 tool에서는 null이다.
- 끝난 뒤 detail이 바뀌면(background로 돈 subagent가 끝남) `tool_detail_changed`가 detail만 바꾼다.
- `question`의 outcome은 submitted, human_message, cancelled, parent_reply다. 팀 자식의 질문을 부모가 `call reply`로 답했으면 `parent_reply`이고 부모의 답 글이 `reply` 한 칸에 실린다. 자식 탭의 카드는 "Answered by the parent"와 그 글을 보인다.
- 종류마다 화면에 필요한 칸만 싣는다. 입력·출력 본문은 lophn이면 싣지 않고(redaction 경계) 별도 읽기(`toolCallBody`)로 읽는다. harness는 다시 읽을 저장소가 없어서 handle(core 안)의 tool item이 `body`(`{input, output, truncated}`, 한 쪽 64 KiB까지)를 쥐고, 화면으로 가는 snapshot·갱신에서는 뺀다(사람이 친 명령은 명령 글만 남긴다). 화면은 줄을 펼칠 때 그 tool 하나의 본문을 `acp/tool_body`로 읽는다(desktop과 폰이 같다. `harness-gui.md`). 화면은 tool 이름이나 JSON을 읽어 종류를 가르지 않는다.
- 사람이 돌린 명령: `by: "user"`이면 사람이 `!`로 돌린 명령이다(`tool: "shell"`, `category: "command"`, `title`은 명령 첫 줄, `body.input`은 명령 전체, `body.output`은 출력). 화면은 사람 쪽에 출력을 펼쳐 그린다. turn 밖에서 돈 그 줄만 `turn`이 null이다.

### 상태의 나머지

- `turn`: 지금 turn(phase working·waiting·ended, started_at, elapsed). 도는 turn이 있으면 그것이고 없으면 가장 늦게 시작한 turn이다. 사람이 답할 것(`pending`)이 있으면 waiting이다.
- `queued`: 도는 중에 다음 turn으로 보낸 사람 메시지. 아직 대화의 일이 아니므로 항목이 아니고 순번이 없다. turn이 가져가거나 steer로 올릴 때(`message_taken`) 항목이 되며 그때 순번을 받는다.
- `pending`: composer 위에 놓이는 승인 카드(`approval`)와 질문 묶음(`question`). 승인 카드는 `choices`(once·session·always·reject)를 싣고, subject에는 편집(`file_change`: path, 만들기·고치기·지우기, 줄 수)과 plan 승인(`plan`: plan markdown, 다음 mode 후보 `modes`)이 있다. plan 승인은 `decide {kind: "mode", mode}`로 다음 mode를 골라 답한다.
- `writing`: 저장 전 model 호출 하나의 글(text, reasoning). 저장되면 그 message 항목이 된다.
- `dropped`: 마지막으로 글을 버린 model 호출과 끝난 turn. 그 늦은 조각이 새 글로 보이지 않게 거르는 기억이다.
- `reread`: 화면이 snapshot을 다시 읽어야 한다는 표시.
- `plan`: agent의 todo 목록. lophn agent는 todo가 없어 null이다.
- `draft {key, content}`: 화면이 composer에 한 번 채울 글(OpenCode `/undo`가 숨긴 사람 글을 돌려준다). 새 `key`를 볼 때 한 번만 채운다. 바깥 상태에만 있고 lophn은 늘 null이다.
- `children`·`tasks`: 아래.

### subagent와 background task

`children`(child key → 자식 상태)은 subagent 대화이고 `tasks`는 background task 목록이다(id, kind agent·shell·other, description, state, started_at, output 꼬리). 자식 갱신 `child_update {child, update}`는 그 자식 상태에 같은 reducer로 접히고(자식의 순번이 빠지면 바깥 `reread`), `tasks_changed`는 목록을 통째로 바꾼다. 자식 대화는 한 층이다. 손자 subagent도 바깥 `children`에 평평하게 들고, 그 subagent tool 줄의 `child`가 바깥 key를 가리킨다. 그래서 schema와 SDK type이 재귀하지 않는다.

### 대화 밖 session 기능

`AcpState.session`(session meta)은 source가 가진 대화 밖 기능이다.

- 제목, CLI session id(`cli_session`, lophn은 null), `harness`(harness id, 화면이 vendor 얼굴을 고른다. lophn은 null).
- capability: model, effort, mode, commands, rewind, rewind_files, fork, compact, rename, usage, steer, background, queue_edit, images, retry, sessions, stop_child, steer_child, tasks, toggles, goal, roles, shell, resume. 화면은 capability를 보고 칸을 켠다.
- model 묶음(provider나 CLI가 주는 묶음)과 지금 값. effort·speed·thinking 같은 것은 model의 축(`kind`가 `choice`면 값 목록, `switch`면 값 둘이고 `[0]`이 끔 `[1]`이 켬이며 picker가 켜고 끄기로 그린다. `options`에 없는 switch 축은 끈 것이다)이고 composer chip이 아니다. 지금 값의 `layer`(global, project, agent, session)는 값이 어느 층에서 왔는지다. `project`는 지금 workspace 층(Home·project·앱)을 뜻한다.
- mode, 명령 목록, 사용량(`usage.limits`: 사용 한도, `usage.context.parts`: `/context` 분해).
- `toggles`(켜고 끄는 상태: Codex plan, omp fast/slow, OpenCode auto-accept), `goal`, `roles`(omp role. 이 session만 그 role의 model로 바꾸는 `use_role`뿐이고 role 배정을 쓰는 입력은 없다).

명령(`AcpCommand`)은 `source`(app, harness, skill, plugin, mcp, custom_user, custom_project), `aliases`, `opens`, `argument_hint`(null이면 인자 없음)를 싣는다. 화면은 명령 이름을 해석하지 않고 `opens`(화면이 하는 동작: new, rename, archive, compact, fork, rewind, model, effort, mode, permissions, status, usage, context, mcp, skills, subagents, tasks, goal, resume)만 본다.

- `opens`가 null이면 `run_command`로 보낸다. 켜고 끄기만 하는 명령(Codex `/plan`, omp `/fast`)도 null이고 source가 바꾼 뒤 `session_changed`를 낸다.
- `opens`가 있는데 사람이 인자를 쳤고 그 값이 인자를 쓰지 않는 동작(`rename`·`goal` 밖)이면, `argument_hint`가 있을 때 `run_command`로 보낸다(`/model sonnet`은 CLI가 바로 바꾼다).
- TUI에서만 되는 명령은 목록에 넣지 않는다.
- 같은 탭에서 새 session을 여는 harness의 `/new`·`/clear`는 `opens`가 null이고 adapter가 연다.

갱신은 `session_changed`(부분. 맨 위 칸만 덮어 합치고 capability는 통째로 바꾼다. 첫 갱신은 모든 칸이 있어야 하며 없으면 `reread`), `plan_changed`, `notice_added`(turn 중 `info` notice)다.

### 다른 session으로 바꾸기

`open_session {cli_session}`은 같은 CLI의 다른 session을 같은 탭에서 연다(harness만, capability `resume`, `opens: "resume"`이 머리 session menu를 연다). adapter는 `session_reset`으로 대화 상태(items, turn, queued, pending, writing, dropped, plan, children, tasks, draft)를 비우고 session meta와 `seq`·`reread`는 둔다. adapter는 순번을 처음부터 다시 세지 않고 이어 세어, 비운 뒤 빈 순번이 gap으로 읽히지 않는다. 새 session의 제목·`cli_session`·명령은 바로 뒤 `session_changed`가 싣는다.

### 숨긴 것 되살리기

`hidden_restored {hidden}`은 그 hidden 항목을 빼고 든 항목을 제 `seq` 자리로 돌린다(OpenCode redo). 없는 id면 그대로다.

## 지키는 것

순서와 읽기

1. 항목의 순서는 `seq`다. 같은 항목을 snapshot과 갱신이 같은 순번으로 낸다. 시각으로 순서를 정하지 않는다.
2. reducer는 같은 갱신을 두 번 접어도 같은 상태를 낸다. 항목은 id로 한 번만 들고, 글 조각은 겹친 부분을 두 번 붙이지 않는다. snapshot보다 앞선 갱신을 snapshot 위에 다시 접지 않는 일(읽기 시작 때 쌓인 갱신 개수 표시)은 읽는 쪽의 몫이다.
3. `reread`가 서면 화면은 snapshot을 다시 읽어 상태를 바꿔 끼운다. 서는 때: ① 다음 순번(`seq + 1`)을 건너뛴 항목이 왔을 때, ② 글 조각의 offset이 앞 글 길이를 넘었을 때, ③ 놓친 `approval_opened`로 닫는 갱신의 승인 카드를 모를 때, ④ turn이 끝났는데 본문을 모르는 agent message(`complete` false)가 있을 때(core가 본문을 읽지 못한 때뿐이다), ⑤ session meta를 아직 모르는데 모든 칸을 싣지 않은 `session_changed`가 왔을 때(첫 갱신은 모든 칸을 싣는 것이 source의 약속이다), ⑥ 자식 대화의 순번이 빠졌을 때. ②는 한 model 호출에서 한 번만 다시 읽는 것이 읽는 쪽의 몫이다(그러고도 안 맞으면 `message_recorded`가 맞춘다).
4. 줄에 선 메시지(`queued`)는 순번이 없다. 대화에 들 때 순번을 받는다. 순번을 미리 받으면 줄에 선 동안 항목 사이에 빈 순번이 생겨 `reread`가 거짓으로 선다.
5. snapshot의 지금 turn은 도는 turn이 있으면 그것이다. turn 시작·끝은 ledger event가 아니라서 값(`state_seq`)이 같은 두 turn 중 끝난 쪽이 뽑히면 화면이 turn이 끝난 것으로 보아 멈춤 단추를 잃는다.
6. snapshot과 갱신이 같은 상태가 된다. 같은 기록에서 갱신을 접은 상태와 snapshot이 같다.

secret

7. ACP로 나가는 글은 모두 core의 지금 redaction을 거친 것뿐이다. 알려진 secret을 다 모르는 동안은 빈 글이다. 저장된 본문, `MessageReceived.body`, tool 칸, 승인 subject·이유, 질문 글, 접힌 구간의 대상 모두 한 번 더 거친다.
8. projection은 순수라 redaction을 하지 않고 규칙을 복사하지도 않는다. 받는 `AgentEvent`가 Bus에서 나온 것(흘러나온 글과 tool 제목은 이미 거침)이어야 하고 context가 주는 값도 거친 값이어야 한다. 갱신에 실리는 글은 event의 것과 context의 것뿐이다.
9. `writing`에서 message로 넘어갈 때 흘러나온 글은 최종 본문의 앞부분이다(붙잡은 꼬리는 나가지 않았다). 그래서 `complete: false`다.
10. lophn의 tool 입력·출력 본문은 ACP에 싣지 않는다. 사람이 `!`로 돌린 명령의 출력은 저장 전에 이미 redaction을 거쳤으므로 싣는다.

입력

11. `AcpSend`는 새 권한이나 새 처리를 더하지 않는다. 부른 사람의 자격으로 지금 있는 route를 부르고 각 route가 자기 scope와 actor를 본다. 가는 route의 scope가 없는 호출자는 `AcpSend`로도 `forbidden`이다.
12. 같은 `key`로 다시 보내도 한 번만 접수된다. 새 입력이 만드는 message·session·rewind id도 `key`마다 같다.
13. 팀 자식의 요청과 질문(부모가 푸는 것)은 갱신으로 나가지 않는다. 그 닫힘 event도 거른다.
14. `seen`을 실은 보내기는 그 뒤에 다른 사람 메시지가 있으면 아무것도 쓰지 않고 `changed_elsewhere`로 끝난다. 검사와 쓰기는 한 transaction이다.

## 경계와 계약

### route와 event

- `AcpSnapshot {session}` → `AcpState`(read, actor user).
- `AcpDraft {agent, workspace}` → session meta(read). 첫 메시지 전 새 session 화면용이고 title·usage·`cli_session`은 null이다. 그 agent와 workspace로 session을 열면 받을 meta를 session 없이 읽는다. 명령 목록(`ListCommands`)도 `{session}` 대신 `{agent, workspace}`로 받는다. harness session은 늘 session이 있어 draft를 쓰지 않는다.
- `AcpUpdated`(transient event, payload `{session, update}`). envelope에도 `session`이 있어 화면은 `{types: ["AcpUpdated"], session}`으로 걸고 Gateway가 session으로 거른다. 남지 않는 event다. 화면은 ready 때 snapshot을 다시 읽으므로 그때 쌓인 갱신은 버린다.
- `AcpSend {AcpInput}`(memory route, actor user). 답의 `session`은 `fork`가 연 새 session이다. 오류는 공통 코드 중 `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unavailable`.
- `AllocateAcpItems`(command, machine 자격만). 항목이 대화에 들 때 session 안의 순번을 정해 저장하고 이미 있는 id는 그 순번을 그대로 준다.
- 순번 저장: 표 `acp_items(session, id, seq, kind, turn, at, data)`. `data`는 기록에서 다시 만들 수 없는 항목(승인 결과)의 내용이다.

### 입력 `AcpInput`

대화 조작: `send`(content block, 앱 context는 `resource` block), `stop`, `retry`, `answer`, `decide`(core 결정에 `session` 범위와 plan 승인 `mode`를 더한 ACP 쪽 선택), 다음 turn 줄 고치기 넷(`send_queued`, `remove_queued`, `edit_queued`, `move_queued`).
session 조작: `set_model`, `set_mode`, `run_command`, `rewind`, `fork`, `compact`, `rename`, `stop_child`, `steer_child`, `stop_task`, `background_tool`(도는 root tool을 background로, capability `background`), `set_toggle`, `set_goal`, `use_role`, `open_session`, `run_shell`, `stop_shell`.
session 조작은 모두 `key`를 싣는다(`stop_shell`은 `item`).

`send`는 `seen`을 싣는다: 그 화면이 아는 마지막 사람 메시지의 id이고 null은 하나도 못 봤다는 뜻이다(새 session의 첫 말). 한 session에 여러 기기(이 컴퓨터의 창, 폰, 이 session의 컴퓨터를 보는 다른 컴퓨터의 창)가 쓸 수 있어서다. core는 메시지를 넣는 같은 transaction에서 `seen` 뒤에 사람 메시지가 있는지 보고, 있으면 아무것도 넣지 않고 `conflict`(`details.reason: "changed_elsewhere"`)로 끝낸다. 합치지 않는다. 사람 메시지는 사람이 보낸 message이고 `!` 명령 기록과 rewind가 숨긴 메시지는 세지 않는다. 모르는 `seen`은 `invalid_input`이다. `seen`이 없으면 검사하지 않는다(화면이 없는 보내는 쪽: CLI, run, call). 이미 받은 id를 다시 보내면 검사보다 앞서 앞의 결과를 돌려준다. 화면은 `seen`을 대화와 다음 turn 줄의 마지막 사람 메시지, 아니면 받았지만 아직 대화에 오지 않은 자기 메시지에서 고른다. 대화의 첫 snapshot을 받기 전에는 아는 것이 없어 `seen`을 싣지 않는다(검사 없이 들어간다. 읽기 전의 보내기가 거짓 `changed_elsewhere`로 막히지 않는다). 거절이면 거절이면 쓴 글과 첨부를 입력칸에 두고 "This conversation changed on another device. Read the new messages, then send again." 한 줄을 보이며 대화를 다시 읽는다(`agent-chat.md`의 전달 상태). coding agent(harness) session의 보내기와 coding relay는 이 검사를 하지 않는다.

lophn core는 입력을 지금 route로 나눈다.

| 입력 | 가는 route | 더 하는 일 |
|---|---|---|
| `send` | `SendMessage` (`refs: []`) | `key`가 idempotency key |
| `stop` | `StopTurn` | 부른 사람의 자격으로 `ReadTurn`을 읽어 `state_seq`를 compare에 싣는다. `key`가 `request_key`이자 idempotency key |
| `retry` | `SendMessage` | 실패한 turn의 입력 메시지를 `next_turn`으로 다시 보낸다. 새 메시지 id는 turn마다 한 번 정해 기억하고 key는 turn으로 정해져(`retry-turn-<turn>`) 다시 눌러도 한 번만 접수된다 |
| `answer` | `AnswerAskQuestions` | |
| `decide` | `DecideTurnRequest` | `session` 범위와 `mode`(plan 승인)는 lophn에 없어 `invalid_input` |
| `send_queued`, `remove_queued`, `edit_queued`, `move_queued` | `SteerQueuedNow`, `RemoveQueued`, `EditQueued`, `MoveQueued` | core가 돌리는 harness session은 도는 turn에 steer를 올리지 못해(입력이 다음 turn으로 간다) `send_queued`가 `unavailable`이다 |
| `set_model` | `changeSessionModel` | model id는 `<provider id>/<model 이름>`이다. `options`는 그대로 `option_values`다(새 model에 맞추는 일은 보내는 쪽 몫) |
| `set_mode` | `changeSessionSkip` | mode는 `ask`·`skip`뿐이고 그 밖은 `invalid_input` |
| `run_command` | `SendMessage` | skill 요청 글("Use the \"<skill>\" skill for this request.", 화면 i18n과 같은 영어 글, 인자가 있으면 뒤에 붙인다)로 보낸다. 내장 명령 이름과 그 별칭은 `invalid_input`(화면이 `opens`로 처리한다) |
| `rewind` | `sessionRewindPreview` → `sessionRewind` | preview의 hash로 되돌린다. blocked면 `conflict` |
| `fork` | `forkSession` | 답의 `session`이 새 session |
| `compact` | `requestSessionCompact` | |
| `rename` | `renameSession` | 앞뒤 빈칸을 자르고 빈 이름은 `invalid_input` |
| `run_shell` | `RecordShellMessage` | 아래 |
| `stop_child`, `steer_child`, `stop_task`, `background_tool`, `stop_shell`, `set_toggle`, `set_goal`, `use_role`, `open_session` | 없음 | lophn agent에 그 기능이 없어 `unavailable`(capability도 false) |

`run_shell`(사람이 composer에서 `!`로 돌리는 명령)

- 부른 사람의 scope에 `RecordShellMessage`가 있는지 돌리기 전에 먼저 본다(돌린 명령은 되돌릴 수 없어서).
- session workspace의 기본 폴더(project·앱 workspace는 첫 폴더, Home은 OS home 폴더)에서 agent `shell.run`과 같은 runner(env allowlist, 시간·출력 상한)로 승인 없이 돌린다.
- 명령·stdout·stderr를 redaction해 사람 메시지(`shell` 칸, `next_turn`)로 저장한다. turn을 시작하지 않고, 다음 turn이 그 입력 메시지와 같은 tx에서 가져가 `<lophn-shell command=… exit_code=…>` tag로 model에 보인다.
- 같은 `key`는 한 번만 돈다. `ShellRan` event가 `by: "user"` tool item(turn null)이 된다(snapshot의 그 item은 `duration_ms`가 null).
- shell 메시지는 고치기·옮기기·빼기를 `conflict`로 막고, fork는 이미 가져간 shell 메시지를 그 turn째 옮긴다.

lophn agent session의 session meta: capability는 harness 전용(`stop_child`·`steer_child`·`tasks`·`background`·`toggles`·`goal`·`roles`·`resume`) 밖은 켜고 `steer`는 harness session이 아닐 때만 켠다. `harness`·`toggles`·`goal`·`roles`는 비우고 `cli_session`은 null, mode는 `ask`·`skip`, `plan`은 null이다. 이름·model·mode가 바뀐 뒤와 turn·compact가 끝난 뒤 사용량을 `session_changed`로 낸다.

lophn 내장 명령 열넷(new, model, effort, permissions, status, usage, context, rewind, fork, rename, compact, archive, mcp, skills)은 `source: "app"`이고 `opens`·별칭·`argument_hint`는 core가 정한 표를 따른다(`/clear`는 `new`의 별칭, `rename`만 인자 `[title]`). skill은 `source: "skill"`, `opens: null`이고 내장 이름이나 별칭과 같은 skill은 목록에서 빠진다. session이 있어야 하는 내장(status, usage, context, rewind, fork, rename, compact, archive)은 draft meta에서 뺀다. 명령 목록은 snapshot에만 있다(skill이 바뀌는 event가 없어 화면이 `/` 메뉴를 열 때 다시 읽는다).

### core가 갱신을 만드는 법

projection은 event만으로 알 수 없는 것을 core가 context로 받는다. 모두 이미 있는 값을 찾기만 하므로 IO가 없고 projection은 순수하다. `AgentEvent`에서 바뀐 것은 `MessageReceived.body`가 content block 배열이라는 것뿐이다.

| context | 내용 | core가 채우는 법 |
|---|---|---|
| 항목의 순번 | session마다 1부터 이어 붙여 **저장한** 순번. message id, tool_call id, 승인 request id, turn 꼬리 id로 찾는다. 줄에 선 메시지는 null | event를 처리할 때 `AllocateAcpItems`로 붙이고(이미 있는 id는 그 순번) snapshot도 같은 표를 읽는다 |
| tool 종류와 칸 | 모르면 null(generic) | 종류는 tool 이름이 정한다: `file.write`·`file.edit`→`edit`, `call.send`→`call`, `ask`→`question`, `release.activate`→`consent`. 시작·끝 event에서 저장된 입력·결과를 읽어(redaction을 한 번 더 거쳐) 칸을 채운다. 시작 때 입력을 못 읽는 `edit`는 generic, `ask`는 빈 `question`이다. snapshot도 같은 읽기 |
| 대기 중인 질문 묶음 | 질문 묶음의 내용 | event를 받는 순간 메모리 기다림에서 읽어 redaction한다(풀리면 사라진다) |
| 보낸 session의 agent와 이름 | | session·agent 정의 read. snapshot과 갱신이 같은 이름을 낸다 |
| 저장된 agent message 본문 | content·reasoning·cards | `ReadMessageBody`를 읽어 redaction한다 |
| 사람이 고른 허락 범위와 거절 이유 | | event를 받는 순간 approvals의 결정을 읽는다 |

- snapshot과 갱신은 같은 읽기와 같은 순번 표를 쓴다. 저장된 본문은 갱신(`message_recorded`)에 실어 turn이 끝날 때 다시 읽지 않는다.
- 순번이 없는 기록(옛 data, 놓친 event)은 snapshot을 처음 읽을 때 대화에 든 때 순서(turn을 연 입력은 turn의 시작 시각, 나머지는 만든 시각, 같은 시각이면 메시지, tool, 승인 결과, 꼬리 순)로 이어 붙인다. 표 채우기 migration은 없다.
- 승인 결과(`approval`)는 기록에 없어 결정할 때 `acp_items.data`에 내용(subject, outcome, choice, reason)을 저장한다. turn 꼬리(`notice`)는 turn 행에서, 숨김(`hidden`)은 rewind 기록의 구간과 메시지가 전부 숨은 turn의 항목에서 만든다.
- `hidden_added`는 대응하는 `AgentEvent`가 없어 core가 rewind가 성공한 뒤 snapshot을 다시 만들어 숨긴 구간을 낸다. 구간이 합쳐지면 새 `hidden`이 앞 구간의 항목을 평평하게 품고 reducer가 앞 `hidden`을 걷는다.
- 줄에 선 메시지는 도는 turn이 있을 때 사람이 다음 turn으로 보낸 것이다. 순번을 받지 않았으면(`acp_items`에 없으면) 줄에 선다.
- snapshot의 `writing`은 core가 낸 글 그대로이고 `at`은 그 turn의 시작이다. `pending`은 approvals와 질문 기다림에서, `turn.elapsed`는 도는 turn에서 읽는다. harness가 주체인 승인 물음은 대화에 오지 않는다.
- 대기 중인 질문의 묶음 id는 메모리에만 있어 풀린 질문의 `group`은 null이다.
- 사람에게 가는 질문은 session당 하나만 열린다(`pending.question`이 한 칸이라서다). 한 응답의 `ask` 호출 여럿은 병렬로 오지만 core의 질문 기다림이 나머지를 줄 세우고, 앞 질문이 풀린 때 다음 질문의 `QuestionAsked`를 낸다. 열리지 않은 질문은 `ask/read`·`ask/answer`가 `not_found`이고 snapshot의 질문 목록에도 없으며 닫혀도 `QuestionResolved`가 나가지 않는다.
- 팀 자식의 요청과 질문(`to_parent`)은 부모가 푸는 것이라 `approval_*`·`question_*` 갱신으로 나가지 않는다. core가 열 때 기억해 두었다가 닫힘 event도 거른다. 그 자식의 `ask` tool 항목은 부모가 `call reply`로 답한 질문의 outcome을 `parent_reply`로 내고 부모의 답 글을 `reply`에 싣는다(답 글은 tool 결과에서 읽으므로 저장 data는 바뀌지 않는다).

### 화면

- lophn 채팅 화면은 대화 조작을 모두 `AcpSend`로 보낸다. 줄 고치기는 메시지 id만 알아서 받은 메시지 read로 session을 찾아 싣는다. `edit_queued`의 글이 아닌 block(이미지, 링크)을 지키는 것은 보내는 쪽(화면)의 몫이다.
- 대기 목록(waiting store)은 대화 화면이 아닌 곳의 조작이라 승인 결정과 질문 답을 제 memory route(`turn_requests/decide`, `ask/answer`)로 그대로 보내고 `AcpSend`를 거치지 않는다.
- 줄 배치(이어진 tool call 묶기 등)는 renderer의 몫이다. 규격은 agent가 낸 것의 모양만 준다.

### 앱 화면

앱 화면도 ACP 화면이다. 앱 bridge `lophnApp.agent`(`open({agent, title?})`, `snapshot(session)`, `onUpdate(listener)`, `send(input)`)가 `app_sessions.open`(선택 `workspace`: 그 앱이 call로 닿을 수 있는 workspace), `AcpSnapshot`, `AcpUpdated`, `AcpSend`를 사람 자격으로 넘긴다. 앱은 sender view에서 정해지고 page가 고르지 못한다. 붙을 수 있는 session은 그 앱에 보이는 lophn·harness session이다(앱 workspace에서 call로 닿을 수 있는 workspace의 것, call 정책). 안 보이는 session, 없는 session, 터미널 탭(`term:`)은 `forbidden`이다. 앱이 보낸 call로 받은 메시지는 sender가 `{kind: app, app, name}`(name은 보낼 때의 slug)이고 chat에 "From <slug>" chip으로 보인다.

- `AcpSend`의 `send`는 선택 `via_app`을 받는다. shell main이 앱 화면의 `send`에 sender view의 앱을 싣는다(page가 준 값은 덮는다). core는 그 앱의 slug를 얼려 메시지에 남기고(불변) fork가 복사한다. 다른 컴퓨터가 기기로 보낸 `send`는 그 앱의 앱 화면 view를 열어 둔 때만 이름표를 얻고 아니면 이름표 없는 사람의 메시지로 간다.
- `AcpSend`로는 입력 `send`·`stop`·`answer`·`rename`만 간다. 나머지(승인 `decide`, `rewind`, `fork`, `run_shell` 등)는 core에 닿기 전에 `forbidden`이다. 승인은 lophn 채팅 탭에서만 한다.
- 앱이 연 session의 turn 끝 알림과 Finished 표시는 내지 않는다([app-call.md](app-call.md)의 "앱 화면의 agent session").
- core는 앱이 연 session을 따로 다루지 않는다. prompt 조립과 답 꼴은 앱과 SDK(`@lophn/agent`)의 몫이고 core는 모른다. SDK가 snapshot 위에 갱신을 같은 reducer로 접는다.
- 설치된 앱의 SDK 사본은 앱 bundle 안에서 zod도 저장소도 없이 읽혀 protocol의 ACP type(zod 정본)을 싣지 못한다. 그래서 zod 없는 type 사본을 따로 두고 정본과 서로 대입되는지 type 검사로 맞춘다. ACP 항목·상태·갱신의 모양을 바꾸면 그 사본도 같이 고친다. 사본의 reducer가 runtime import를 더하면 설치 사본이 깨진다. bridge type은 ACP type을 SDK가 채우는 generic이다(이 portable entry가 protocol을 import하면 shell main tsc가 base까지 읽어 깨진다).

### ledger 밖의 ACP: harness GUI

third-party CLI GUI(extension `harness-gui`, [harness-gui.md](harness-gui.md))의 대화는 ledger에 없다. adapter가 core 안 extension host의 session handle에 `AcpUpdate`를 publish하고 화면의 `AcpInput`을 받는다. handle은 갱신을 reducer로 접은 `AcpState` 하나만 쥔다. 순번(`seq`)은 adapter가 1부터 이어 붙인다. 위 "core가 갱신을 만드는 법"과 입력 표는 ledger session만의 이야기다. desktop 탭과 폰은 lophn agent session과 같은 route와 event로 읽고 보낸다. session id는 `ses_<터미널 ULID>`이다.
- `AcpSnapshot {session}`은 그 session의 handle이 있으면 handle의 상태(tool 본문을 뺀 것)다. 없으면 ledger를 읽고, ledger에도 없으면 `not_found`다.
- `AcpSend`는 handle이 있는 session이면 입력 꼴을 가리지 않고 handle에 그대로 넘긴다. 위 입력 표의 route 나누기는 타지 않는다. core는 입력을 상태에 적용하지 않고 결과는 adapter가 내는 갱신으로 돌아온다. `key`가 있는 입력(`send`는 `id`와 `key`)은 session마다 200개를 기억해 다시 오면 넘기지 않고 성공으로 답한다. adapter가 key를 거르지 않고 폰이 다시 붙은 뒤 같은 입력을 다시 보내기 때문이다.
- `AcpUpdated`는 core가 handle마다 20ms 모은 갱신을 하나씩 내고, 받는 화면(desktop GUI 탭, lophn agent 탭, 폰)은 한 프레임 동안 모은 `AcpUpdated`를 한 번에 접어 그린다(이벤트 모양은 바꾸지 않는다). handle이 열리거나 닫히거나 replay commit으로 상태가 통째로 바뀌면 `StateChanged{coding_sessions, id: session}`을 내고 화면이 snapshot을 한 번 다시 읽는다.
- 사용자 메시지는 앱이 보낼 때 소유한다: 일반 전송과 steer 모두 보내는 순간 대화에 기록하고 큐에서 빼며, live 구간의 CLI 에코(`user_message_chunk`)는 무시한다(과거 `session/load` 리플레이에서만 복원).
- slash 명령은 세 갈래로 나눈다: 호스트 UI/로컬 명령(`opens` 등), 유지보수 화이트리스트(`/compact` — 사용자 메시지 없이 `command_output`), 나머지 대화형/agent 명령(`/swarm`, `/plan`, skill 등 — 일반 사용자 메시지로 남기고 원문 그대로 보낸다; 턴 중에는 큐로 직렬화). 차단 목록(`withheldCommands`, 예: `agy`의 `logout`)은 목록에서 빼고 직접 쳐도 막는다.
- 내기 전에 제품 redactor(`env.redact`와 같은 규칙)로 snapshot과 갱신의 모든 글을 거른다. 알려진 secret을 아직 다 모르면 내지 않는다(snapshot은 `unavailable`, 갱신은 버리고 화면이 다시 읽게 한다. 빈 글로 바꾸면 갱신의 `type` 같은 칸까지 비어 상태가 깨진다). desktop 탭과 폰이 같은 길이다.

## 결정

- ACP는 lophn 자체 규격이고 표준 Agent Client Protocol이 아니다. 이유: 사람이 "renderer가 다 알아서 그리는 게 아니라 lophn acp protocol이 정립되어 있으면 third-party CLI에 GUI를 덮어씌우기도 쉽다"고 했다. 앱 화면과 third-party CLI GUI가 같은 규격을 쓴다. (사람, 2026-11-04)
- 항목 순서는 저장한 session 순번이다. 이유: 시각으로 merge하면 같은 시각의 항목과 늦게 온 항목의 자리가 흔들리고, snapshot과 stream이 겹칠 때 중복·누락을 알아볼 방법이 없다. 순번은 빠짐을 곧바로 알려 주고 `reread`로 맞춘다. 버린 안: 시각 merge. (agent)
- projection은 순수 함수이고 event에 없는 것(순번, tool 종류, 질문, 보낸 agent, 승인 결정)은 core가 context로 준다. 이유: `AgentEvent`를 쓰는 곳이 많아 event를 바꾸지 않으려 했고, 찾기만 하므로 IO가 없다. (agent)
- reducer와 projection을 protocol에 둔다. 이유: core(snapshot 확인)와 화면(상태 접기)과 앱 SDK와 third-party GUI가 같은 접기를 써야 같은 상태가 나온다. projection은 `AgentEvent`를 읽고 events가 `AcpUpdated`를 위해 acp를 읽으므로 protocol 최상위 순환을 피하려고 projection을 events 쪽에 둔다. 의존 없는 순수 함수를 shell과 core가 같이 써야 하는 경우의 예외다(module-catalog). (agent)
- 저장된 agent message의 본문을 갱신에 실어 turn이 끝날 때 다시 읽지 않는다. (agent)
- `app_card` part는 message 항목의 `cards`로 낸다. harness의 `harness_tool` part는 글 block 하나다. (agent)
- 대화 조작의 입구는 `AcpSend` 하나다. 이유: 화면이 route 여러 개와 입력 모양을 알면 third-party GUI가 같은 대화를 하려 할 때 그 지식을 다시 짜야 한다. 일은 지금 route가 하게 두어 권한과 멱등을 새로 만들지 않았다. (agent)
- `AcpSend`는 core 안 machine 자격으로 대신 부르지 않는다. 이유: 대신 부르면 `SendMessage`나 `StopTurn` 권한이 없는 호출자도 `AcpSend`로는 할 수 있게 되어 새 권한 경계가 생긴다. (agent)
- 입력 검사는 두 번이다: `AcpSend`의 입력 schema와 가는 route의 입력 schema. content block이 사람 메시지로 허용되는 꼴인지는 가는 route가 본다. (agent)
- `queued`는 항목이 아니다. 이유: 줄에 선 메시지는 아직 대화의 일이 아니다(고치고 빼고 순서를 바꿀 수 있다). (agent)
- 대화 밖 session 기능(model, mode, 명령, 사용량, rewind, fork 등)은 ACP의 입력과 갱신이고, source가 가진 기능은 capability로 알린다. 이유: 첫 판의 `external` 숨김으로는 harness GUI가 CLI 기능을 다 쓸 수 없었다. 숨김은 capability 검사로 바꿨다. (사람, 2026-11-05)
- 명령은 화면 동작(`opens`), CLI에 보내고 출력 그리기(`run_command`), TUI 전용 숨김의 셋으로 나눈다. 화면은 명령 이름을 해석하지 않는다. (사람이 문제를 짚고 agent가 각 CLI를 참고해 모양을 정함)
- omp role은 "이 session만 이 role의 model로"(`use_role`)만 넣고 `~/.omp`의 배정은 바꾸지 않는다. (사람, 2026-11-05)
- fast·thinking·Speed는 composer chip이 아니라 model 축이고 picker가 그린다. lophn agent도 같다. (사람, 2026-11-05)
- `!` shell mode는 harness와 lophn agent 모두에 둔다. lophn은 사람이 친 것이라 승인 없이 agent shell runner로 돌리고 앱 bridge는 막는다. (agent가 추천, 사람이 반대하지 않음)
- 받은 메시지는 있는 ACP 칸(`received`, sender agent | program | app)으로 가른다. 앱이 보낸 call(`architecture/agent-call.md`)은 sender `app`을 더해 chip으로 보이게 했다. A2A의 다른 화면은 사람이 모양을 정한 뒤에 한다. (agent)
- 팀 자식의 event는 그대로 내고 표시로 거른다. `TurnResumed`, snapshot의 `waiting`, acp가 그 event에 기댄다. (agent)
- 질문의 부모 답 글은 질문 줄(`lines`)이 아니라 항목의 `reply` 한 칸에 둔다. 이유: 부모의 답은 질문마다가 아니라 한 글이다. (agent)
- model 출처 값 `project`는 이제 workspace 층(Home·project·앱)을 뜻하지만 이름은 그대로 둔다. 이유: 공개 SDK type의 session meta `layer`에 실려 있어 바꾸면 SDK가 깨지는 변경이 된다. 화면 글만 "workspace default"다. (agent)
- 앱 화면에서 보낸 것은 그 앱을 쓰는 사람의 메시지이고 따로 허락 단계를 두지 않는다. (사람, 2026-11-04)
- 앱 bridge는 허용 목록(`send`, `stop`, `answer`, `rename`)으로 막는다. 이유: 새 ACP 입력이 늘어도 앱은 닿지 못하게 하려는 것이다. 앱 code가 자기 agent의 승인(`decide`)이나 `rewind`·`fork`를 보낼 수 있던 것을 막았다. 버린 안: `run_shell`만 막고 나머지를 넘기기. (사람)
- 앱과 session 사이는 ACP 그대로이고 bridge는 route 셋과 event 하나만 그 앱 workspace로 묶는다. (agent)
- 앱 session은 화면을 열 때가 아니라 첫 `send`에서 연다. 이유: 열 때마다 sidebar에 session이 하나 생긴다. 제목은 `rename` 입력으로 붙이고 못 붙여도 열기는 성공한다. (agent)
- 앱 SDK의 설치 사본은 zod 없는 ACP type 사본을 두고 정본과 type 검사로 맞춘다. 버린 안: `reducer`의 import 범위(protocol·base file 51개와 zod)를 vendor하기(앱에 zod를 더해야 하고 base의 한 file이 앱 tsconfig에서 깨진다), protocol의 ACP type을 zod 없는 정본으로 옮기기(그 계획보다 크다). (agent)
- harness GUI 대화는 core 안의 handle이 같은 `AcpSnapshot`·`AcpSend`·`AcpUpdated`로 낸다. 이유: desktop 탭과 폰이 lophn agent와 같은 대화 화면과 card를 쓰고 snapshot과 event의 순서가 core 한 곳에서 정해진다. 처음에는 handle이 shell main에 있어 desktop 창은 IPC로 붙고 폰에는 core가 접은 사본을 중계했다(접는 곳이 둘이고 연결이 끊기면 사본이 사라졌다). handle이 core로 오며 사본을 없앴다. 버린 안: 폰 전용 route와 화면. (agent)
- harness GUI의 handle은 갱신 묶음이 아니라 접은 상태 하나를 쥐고 붙을 때 snapshot을 주며 그 뒤 갱신을 묶어 낸다. 이유: 접은 상태와 snapshot, 묶은 갱신으로 같은 문제(긴 대화의 다시 그리기·끊김)를 푼 다른 GUI(emdash, t3code, happy)를 참고했다.

## 열린 것

- ACP session meta의 `layer` 값 목록과 비용 종류 목록(`usage.costs[].kind`)이 lophn 원본의 사본이다. 원본을 import하면 shell main의 tsc가 큰 import 사슬까지 읽고 깨져서 값을 옮겨 적었다. 두 사본이 어긋나면 core의 type 검사가 먼저 실패한다(ACP를 짓는 core 쪽이 원본 값을 ACP type에 넣는다). leaf file로 옮기는 것은 얻는 것이 작아 이대로 둔다(이슈 `acp-session-copies-value-lists`, kept).
- `reread`의 ②(글 조각 offset 어긋남)는 한 model 호출에서 한 번만 다시 읽는 규칙을 읽는 쪽이 지켜야 한다. 규격이 막지 않는다.
- harness가 쓴 tool 줄은 전용 항목이 없어 글 block 하나다.
