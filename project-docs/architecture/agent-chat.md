# agent-chat

agent chat 화면(Home·project·앱 workspace 창의 Agent 탭)이 대화를 보이고 다루는 설계다. 사람은 agent의 답이 provider가 쓰는 대로 markdown으로 흐르는 것을 보고, reasoning과 tool 줄과 "Worked for"로 agent가 한 일과 걸린 시간을 읽는다. 같은 화면을 lophn agent 대화와 터미널 탭의 harness GUI([harness-gui.md](harness-gui.md))가 쓴다.

화면은 대화 상태와 갱신, 조작의 규격인 ACP([acp.md](acp.md))만 보고 그린다. core가 `AcpSnapshot`과 `AcpUpdated`를 내고 `AcpSend` 하나로 조작을 받는다. 화면은 agent event를 직접 접지 않고 tool 이름이나 JSON으로 tool의 종류를 가르지 않는다. 이 문서는 ACP 위에서 쓰는 글이 어떻게 흘러 나가고(streaming, redaction, 저장), 화면이 무엇을 어떤 규칙으로 그리는지를 적는다.

## 문제

- agent 글이 plain text였고 tool call 없는 마지막 답만 저장했다. "X를 확인하겠다" 같은 중간 글은 model 이력에만 들어가 사람이 끝내 보지 못했고, 마지막 답도 turn이 끝나야 보였다. markdown으로 답해도 기호가 그대로 보였다.
- 한 turn에서 agent가 무엇을 하는지(글, reasoning, 무슨 파일을 읽고 무슨 명령을 돌렸는지)와 일한 시간을 읽을 수 없었다. tool 줄은 tool 이름뿐이었고 "Worked for"는 승인을 기다린 시간까지 센 wall clock이었다.
- 쓰는 중인 글을 사람에게 보이면 secret이 그 글에 섞여 나갈 수 있다. 저장된 글은 redaction을 거치지만 흐르는 글은 그 사이에 있다.
- agent 답은 인터넷에서 온 글일 수 있다. 답 안의 image URL이나 link가 대화를 밖으로 새게 하거나 shell 창 전체를 web page로 넘기면 안 된다.
- 긴 대화에서 글 조각마다 대화 전체가 다시 그려지면 streaming과 입력이 끊긴다.

## 목표와 비목표

- 목표: 글을 token streaming으로 보이고, 중간 글과 멈춘 답까지 저장되어 사람이 본 것이 기록과 같게 한다. reasoning, tool 제목, 일한 시간(active)을 보인다. secret과 바깥 자원 접근은 화면 규칙이 아니라 경계에서 막는다. 긴 대화도 끊기지 않는다.
- 비목표: 지금 구현에서 옮기는 비용을 근거로 쓰지 않는다. 비교한 harness(Claude, ChatGPT/Codex, Hermes, OpenCode, Gemini CLI, Cline 등)가 모인 정석과 맞는 의미를 고른다.
- 비목표: reasoning을 model 이력에 되돌리지 않는다. 보이기만 한다.
- 비목표: 쓰는 중인 글(조각)은 저장하지 않는다. 저장은 응답이 끝난 message(와 멈춘 순간의 글)뿐이다.

## 모델

글은 provider에서 화면까지 네 곳을 지난다.

```
 provider 응답 ─ adapter ─ 글·reasoning 조각 (reasoning은 block 시작·끝도 알림)
                    ▼
 agent runtime(child): 한 attempt의 날 글을 약 50ms 묶음으로
                    │ 감독 pipe `model_output` {session, turn, model_call, kind, text}   ← redaction 전
                    ▼
 core: session마다 attempt 하나의 날 글과 낸 글을 메모리에 쥔다
        쌓인 날 글 전체에 redaction ─ 붙잡는 자리 앞까지 ─▶ ModelOutputStreamed {offset, text}
        ACP snapshot `writing` = 낸 글
                    │
 응답이 끝나면 RecordMessage(machine, id는 model 호출에서 정함) ─▶ MessageRecorded ─▶ Bus
                    │
 core acp wiring: Bus의 agent event ─ projection ─▶ AcpUpdated(transient) ─▶ Gateway ─▶ shell
                    ▼
 shell renderer: AcpSnapshot(처음·reread) + AcpUpdated를 reduceAcp로 접고, 접은 상태를 화면 줄로 편다
        writing 글 ─ 약 40ms로 묶어 그림 ─ chat용 markdown ─ code block은 Worker의 highlighter가 칠함

 대화 조작(보내기, 멈추기, 다시 하기, 묻기 답, 승인 결정, 대기 고치기, session 기능):
 shell renderer ─ AcpSend {type, ...} ─▶ core ─ 부른 사람의 자격으로 ─▶ 해당 route
```

- model 응답 하나가 agent message 하나다(`MessageRecorded`). 글이나 reasoning이 있는 응답은 tool call과 같이 와도 그 응답의 tool call보다 먼저 저장한다. 그래서 `MessageRecorded`가 그 응답의 `ToolCallStarted`보다 먼저 온다. tool call 없는 마지막 응답은 글이 비어도 저장한다.
- reasoning은 같은 조각 길에 `kind: "reasoning"`으로 흐르고 저장할 때 message part `{kind: "reasoning", text, duration_ms}`가 된다(part 순서는 reasoning, text). 시간은 provider가 알린 reasoning block의 시작부터 끝까지이고 읽을 글 없이 암호화만 와도 잰다. 화면은 "Thinking" → "Thought for {d}" / "Thought"이고 펼치면 요약이다. 요약을 받으려면 요청에 싣는다(Anthropic adaptive thinking `display: "summarized"`, OpenAI Responses `reasoning.summary: "auto"`).
- 사람이 멈추면 core가 `StopTurn` 앞에서 그 turn의 `writing`(사람이 본 글)을 machine `RecordMessage`로 저장하고 `MessageRecorded`를 낸 뒤, 끝난 순간까지의 active를 마감하고 `StopTurn`을 넘긴다. 화면·run·workflow의 모든 멈춤이 같은 길이다.
- 시간: core가 lophn turn마다 active(사람 기다림 제외)를 메모리로 센다. 승인 request와 질문이 열리면 멈추고, 마지막 기다림이 닫히면 `TurnResumed {turn, active_ms}`를 낸다. ACP snapshot의 `turn.elapsed`가 도는 turn의 값이다. turn이 끝날 때(정상, 멈춤, 실패, 끊김)는 끝난 순간까지의 active를 마감해 `TurnEnded.active_ms`에 싣는다. `active_ms`를 모르는 turn(null)은 wall이다. trace의 `wall_ms`는 진짜 wall이다.
- 기록한 tool call 행은 항상 `finished`로 닫힌다. 진입(`started`)한 뒤 결과 저장·redaction·finish 기록이 실패하거나 handler가 던져도 `uncertain`으로 닫고 model에도 같은 `uncertain` 결과를 준다. 기록 열의 `result`는 core의 JSON 본문 한도(256 KiB·깊이 16·항목 4,096)와 summary 400자 안이어야 해서, finish가 `invalid_input`으로 거절되면 줄인 기록(내용을 버리고 이미지는 개수만 남김)으로 한 번 더 낸다. 전체 결과는 output blob에 있고 model에는 전체가 간다. 중단 요청에 grace 안에 답하지 않아 loop가 포기한 call(`abort_unconfirmed`)은 늦은 결과가 오면 그때 닫힌다. 끝나지 않은 행은 ACP 화면이 실행 중으로 그린다.
- tool 제목: tool 정의마다 입력에서 `{category, title}`을 만든다(`Read <file> (10-80)`, `Search TODO in src`, `Fetch https://…`). 지금의 redaction을 거친 뒤 한 줄 120자로 자른다. `ToolCallStarted`와 `ListToolCalls`(core API read, `tool` filter가 있다)가 같은 규칙으로 만들고 제목은 저장하지 않는다. `shell.run`의 선택 칸 `description`이 있으면 제목이고 비면 명령 첫 줄이다.

### 화면이 그리는 것

- agent 글은 markdown, 사람 글은 plain이다. code block은 Shiki(JS regex engine)를 shell의 Worker에서 돌려 token을 span으로 칠하고, grammar는 언어마다 lazy chunk다.
- 대화 한 줄의 단위는 ACP 항목이다. tool 항목은 하나씩이고 묶는 일은 화면의 몫이다: 이어진 read·list·search는 하나로, command·web은 category마다, other는 같은 tool끼리 묶고 사이에 agent message가 오면 끊는다. 묶음을 펼치면 call마다 제목과 시간이고, call을 펼치면 입력·출력이다.
- 대화 밖 session 기능(model 고르기와 축, mode, `/` 명령, `/status` 사용량, 이름, fork, compact, rewind)은 ACP의 `session`(`AcpSessionMeta`)에서 읽고 ACP 입력으로 보낸다. 칸은 `session.capabilities`가 켠다.
- composer 위에는 승인·질문 card 아래 dock이 있다. Goal → Todo(`plan`) → Running(도는 subagent·background task) → Queue(다음 turn 줄) card를 쌓는다.
- subagent tool 줄을 누르면 대화 위 한 겹으로 자식 대화(`children[child]`)를 읽기 전용 thread로 연다.
- 본 대화 왼쪽에 thread index rail(사람 메시지 하나에 눈금 하나)이 있고 사람 메시지에 bookmark를 단다.
- 대화는 가상화한다. 화면 근처의 줄만 그린다.
- 보낸 말 하나의 전달 상태: 보내는 중, 접수됨, 못 보냄, 접수 확인 안 됨(결과를 모르면 다시 보내기보다 접수 조회를 먼저 낸다), 다른 기기에서 바뀜. 보내기는 이 화면이 아는 마지막 사람 메시지(`seen`. 대화와 다음 turn 줄의 마지막 사람 메시지, 아니면 접수됐지만 아직 대화에 오지 않은 자기 메시지. 대화의 첫 snapshot을 받기 전에는 싣지 않는다)를 싣고, core가 그 뒤의 다른 사람 메시지로 거절하면(`conflict`, `details.reason: "changed_elsewhere"`, `acp.md`) 쓴 글과 첨부를 입력칸에 두고 "This conversation changed on another device. Read the new messages, then send again." 한 줄을 보이며 대화를 다시 읽는다. 연결이 없으면 `unavailable`이고 쓴 글이 남는다(꺼진 기계에 맡겨 두는 queue는 없다). coding agent(harness) session은 이 검사가 없다.
- shell mode: capability `shell`이 켜져 있고 입력이 `!`로 시작하면 입력칸이 shell mode가 된다.

## 지키는 것

secret
1. live 글의 redaction은 core가 한다. child는 날 글을 `model_output`으로 보낼 뿐이고, core가 attempt마다 쌓인 날 글 전체에 redaction을 건다. batch마다 따로 가리면 두 batch에 걸친 secret이 나간다.
2. 붙잡는 자리(어디까지 내보내도 되는지)는 core 안에서만 쓴다. 감독 pipe의 `redact_request`·`redact_response`에 싣지 않는다. child가 "이 끝이 secret의 앞부분인가"를 물을 수 있으면 글을 골라 거듭 물어 값을 한 자씩 알아낼 수 있다.
3. 붙잡는 자리는 상수 길이가 아니다. 끝 글이 알려진 값의 앞부분(값 전체 포함)이거나 credential 규칙의 match로 이어질 수 있는 가장 이른 자리이고, 지운 span 안에 떨어지면 그 span의 시작이다. 상수로 붙잡으면 그보다 긴 token(OAuth, JWT, PEM)의 앞부분이 나간다.
4. 알려진 값을 아직 다 모르면 내지 않는다. 앞서 낸 자리를 redaction이 바꾸면 그 attempt의 그 kind는 더 내지 않는다(화면이 본 글을 되돌리지 않는다).
5. attempt가 끝나면 붙잡은 꼬리는 나가지 않는다. 저장된 message 본문(저장 준비 단계에서 redaction한다)이 live 글을 대신한다.
6. reasoning 글과 tool 제목은 지금의 redaction을 거친다. tool 제목은 자르기 전에 redaction한다(120자 경계에 걸친 secret의 앞부분이 남지 않게). redaction을 끝내지 못하면 제목은 tool 이름이다.
7. 승인 카드에는 agent가 쓴 설명(`shell.run`의 `description`)을 싣지 않는다. `description`은 tool 줄 제목에만 쓴다([approval.md](approval.md)의 지키는 것: 카드 내용은 program이 GateCall에서 만든다).

데이터
8. 한 model 호출의 message는 하나다. message id는 `model_call`에서 정해(`msg_` + 그 ULID) 멈춤 길과 child가 같은 응답을 둘 다 저장하려 해도 둘째는 같은 id 규칙에 걸린다.
9. provider가 끊어 retry하는 attempt(partial)의 글은 버린다. 다른 `model_call`의 조각이 오면 core와 화면이 앞 글을 버린다. `ToolCallStarted`와 `TurnEnded`도 그 turn의 쓰는 중인 글을 비우고, 저장된 `model_call`과 끝난 turn의 늦은 조각은 버린다.
10. run의 답은 그 turn의 마지막 agent message의 글이다([run.md](run.md)). 마지막 응답을 빈 글이어도 저장하므로 중간 응답의 글이 답이 되지 않고, 빈 답은 `no_answer`다.
11. reasoning 글은 model 이력으로 가지 않는다. 이력은 text part만 읽는다. opaque 상태(signature, `encrypted_content`)는 adapter의 opaque handle로만 되돌아간다.
12. 쓰는 중인 글의 조각(`ModelOutputStreamed`)은 저장하지 않는다. 쓰는 중인 글은 core 메모리에만 있고, 늦게 붙거나 다시 붙은 화면은 ACP snapshot의 `writing`(낸 글 그대로)과 그 뒤 `writing_streamed`의 `offset`으로 맞춘다. offset이 맞지 않으면 `reread`가 서고 화면은 model 호출 하나에서 한 번 snapshot을 다시 읽는다.
13. 쓰는 중인 글은 core 한 곳에 둔다. 날 글을 받는 곳과 snapshot을 싣는 곳이 달라도 한 곳에 있어야 retry·저장·멈춤에서 날 글과 낸 글이 같이 비워진다.
14. "Worked for"는 active다. 기다린 시간(wall − active)은 1초 이상일 때 완료 줄 tooltip이다. 일하는 중 줄은 `active + (now − 기준 시각)`이라 기다림 뒤에 건너뛰지 않는다.
15. 대화 조작은 `AcpSend`로 보내고 core가 부른 사람의 자격으로 지금 route에 넘긴다. 화면이 route를 골라 부르지 않으니 새 조작을 더해도 권한은 그 route가 본다([acp.md](acp.md)). session 관리(fork, rewind, model 바꾸기, compact)는 제 route다.

화면: 바깥 자원
16. chat의 markdown image는 불러오지 않고 alt 글의 link로 둔다. agent 답의 image URL로 대화가 새는 길(`![](https://…?q=<secret>)`)을 막는다. 바깥 image는 shell CSP(`img-src 'self' data: blob:`)도 막는다.
17. link는 renderer와 shell 창의 navigation guard 둘 다가 막는다. 창 main frame은 `lophn-shell://desktop` 밖으로 가지 않고 `http`/`https`는 OS browser로 열며 새 창 요청은 deny다. renderer만 막으면 다음에 `<a href>`를 그리는 화면이 또 뚫린다.
18. highlight는 token 배열을 React span으로 그리고 HTML 문자열을 넣지 않는다. CSP(wasm·eval 없음)를 바꾸지 않는다. 자라는 code block은 받은 결과가 지금 code의 앞부분이면 그만큼 칠하고 나머지는 plain으로 붙인다.
19. 닫히지 않은 code fence는 그릴 때만 닫는다. 저장된 본문은 고치지 않는다.
20. agent 글은 markdown이고 사람 글은 plain이다. 사람이 친 `*`, `_`는 모양으로 바뀌지 않는다.

화면: 대화와 조작
21. 화면은 ACP만 본다. 같은 대화가 snapshot에서 왔든 갱신으로 접었든 줄과 묶음이 같다. 그래서 turn이 끝나 snapshot을 다시 읽어도 줄이 뛰지 않는다. 펼친 call의 입력·출력은 ACP에 싣지 않고 사람 화면용 body view(64 KiB, 지금의 redaction)로 따로 읽는다(harness는 tool item의 `body`).
22. 칸은 `session.capabilities`가 켠다: model·mode·명령·rewind(file·앱 부분은 `rewind_files`)·fork·compact·rename·usage·steer·줄 고치기(`queue_edit`)·Retry·이미지·머리의 session 목록(`sessions`). meta가 아직 없으면(snapshot 전) lophn의 capability 묶음으로 그린다. model을 바꿀 때 축 값은 화면이 새 model에 맞춰 보낸다. `/` 메뉴를 열 때 snapshot을 다시 읽어 새 skill이 보인다. 여러 줄 입력은 `/`로 시작해도 메시지로 보낸다.
23. `/` 명령은 이름이 아니라 `opens`로 실행한다. `opens`가 있으면 화면 동작(새 session, 이름 바꾸기, archive, compact, fork, rewind, model·effort·mode, permissions, status·usage·context, mcp·skills, subagents·tasks·goal)이고, null이거나 `argument_hint`가 있는 명령에 인자를 쳤으면 `run_command`로 보낸다(출력은 `command_output` 줄로 온다). 인자가 필요한 명령을 메뉴에서 고르면 `/<이름> `로 바꾸고 기다린다. 메뉴 줄은 늘 `/<이름>`이다.
24. 메뉴 순위는 이름 정확 → 이름 앞부분(짧은 것이 위) → 별칭 → 이름 조각 → 이름 포함 → 설명 단어이고 같은 순위는 출처 순서와 이름 순이다. query가 비면 lophn → harness(vendor 아이콘과 이름) → Skills → Plugins & MCP → Custom 묶음, 있으면 머리 글 없이 한 목록에 출처 배지다. 도는 중이면 메뉴 아래 한 줄이 다음 turn에 들어간다고 알린다.
25. info notice는 회색 한 줄(warning은 경고 아이콘), `command_output`은 `/<명령>` 머리가 있는 블록(markdown이거나 고정폭)이다. `turn`이 null이면 agent 덩어리에 넣지 않아 "Worked for"가 붙지 않는다. harness 대화의 얼굴은 vendor 아이콘이고 harness tool 줄은 item의 `body`로 입력·출력을 펼친다.
26. plan 승인은 plan 본문(12줄 접기)과 mode마다 "Approve · {mode}" 단추, "Keep planning"이 있는 카드이고, 결과 줄은 `approval_closed.mode`로 고른 mode를 보인다("Plan approved · {label}"). 승인 카드의 단추는 pending의 `choices` 순서다.
27. dock은 내용이 없는 card는 그리지 않고, 접힌 요약 한 줄이 기본이며 card 하나만 펼친다. `/subagents`·`/tasks`는 Running card를, `/goal`은 Goal card를 연다. 도는 turn 중에 보낸 다음 turn 말은 줄에 오기 전까지 대화에 보낸 말로 그리지 않고 Queue card 끝에 흐린 줄로 보인다. 줄이나 대화에 그 id가 오면 사라진다. 못 보냄·접수 확인 안 됨은 다시 보내기 단추가 있는 대화 줄로 남는다. 켜고 끄는 상태(`toggles`)는 composer 안 chip, role은 model picker 맨 아래 Roles 절, 사용 한도와 context 분해는 status layer다.
28. subagent tool은 대화 안 subagent 줄이고 누르면 자식 대화를 한 겹 위에 연다(손자는 한 겹 더). 자식이 돌고 capability가 켜져 있으면 아래 줄에서 방향을 주거나(`steer_child`) 멈춘다(`stop_child`). subagent 보기에는 따로 머리 줄이 없다. 자식이 열려 있으면 탭 머리의 ←/→가 한 겹씩 나오고 다시 들어가며, 제목은 `{agent} › {subagent} · subagent`와 상태·model·경과다.
29. model picker: Roles(omp만)가 맨 위다. provider 묶음은 접고 펴며 지금 model의 묶음만 열려 있고(묶음이 하나면 늘 열림) 검색어가 있으면 접힘을 무시한다. 접힘은 picker 단추가 사는 동안만 기억한다. `kind: "switch"` 축은 Switch 줄이고 단추 요약에 켠 switch가 붙는다("Sonnet 5.5 · High · Fast"). lophn agent의 picker와 agent 편집의 model 칸도 같은 body를 쓴다.
30. harness session menu: capability `resume`이 있는 harness는 머리에 그 CLI의 지난 session(목록, 바꾸기, 새로)을 보인다. 이름 바꾸기·archive·지우기·메시지 찾기는 없다. 바꾸면 `open_session {cli_session}`을 보내고 바뀌는 동안 "Opening session"을 보인다. 새로는 이름이나 별칭이 `new`인 명령을 `run_command`로 보낸다. `/resume`(`opens: "resume"`)이 같은 menu를 연다.
31. shell mode에서는 입력칸이 고정폭, warning 테두리, Shell chip, "Runs in your shell · Esc to leave" 줄로 바뀌고 `/` 메뉴와 첨부는 꺼진다. Esc나 `!` 하나에서 Backspace로 나온다. 보내면 `send` 대신 `run_shell`이다. 답 안의 code block이 `!`로 시작하면 복사 단추 왼쪽의 shell 단추가 그 글을 입력칸에 채워 이 mode로 연다(보내지는 않는다). `by: "user"` tool item은 turn이 있든 없든 agent 덩어리에 넣지 않고 사람 쪽 "You ran" 줄(`! 명령`은 줄바꿈하고 3줄이 넘으면 흐려지며 접혀 눌러 펼친다, 출력은 펼친 채 20줄에서 접는다, exit code가 0이 아니면 warning 색)로 그린다. lophn의 `run_shell`은 명령이 끝나야 답하므로 그동안 도는 줄을 보인다.
32. vendor 얼굴은 배경 원 없이 아이콘이 칸을 채운다. `/` 메뉴는 고른 줄을 따라 스크롤하고 가로 scroll이 없다(이름은 반폭에서 말줄임). 언어 머리가 없는 code block은 머리 줄 없이 복사 단추를 오른쪽 위에 겹친다.
33. `draft_set`은 `key`가 새 값일 때 한 번 composer를 그 글로 채운다(사람이 이미 친 글은 덮지 않는다. 화면을 처음 열 때 이미 있던 key는 채우지 않는다). OpenCode `/undo`가 쓴다.
34. thread index: 본 대화(subagent 보기는 아니다) 왼쪽에 사람 메시지(top-level, 숨긴 구간과 대기열은 뺀다) 하나에 눈금 하나인 rail을 둔다. 사람 메시지가 4개 이상이고 왼쪽 여백이 48px 이상일 때만 그린다. 눈금에 pointer를 올리면 popover card(오른쪽에 열고 focus를 가져가지 않는다)가 그 메시지 첫 줄, 다음 사람 메시지 전 마지막 agent 답 2줄, bookmark 단추를 보인다. 누르기·끌기·Alt+↑/↓로 그 turn에 간다. 가는 곳은 DOM이 아니라 잰 높이와 추정으로 셈하므로 아직 그리지 않은 줄에도 간다.
35. 대화는 가상화한다. 화면에서 600px 안의 줄과 끝 줄 셋(흐르는 꼬리, 보내는 말, Working)만 그리고 나머지는 높이만큼의 빈 칸이다. 높이는 줄 key마다 재서 기억하고 안 잰 줄은 잰 줄의 평균으로 둔다. 끝에 있으면 끝을 따라가고, 위로 올려 읽는 중에는 화면 맨 위 줄을 기준으로 높이가 바뀐 만큼 scroll 위치를 맞춰 읽던 자리가 움직이지 않는다. 읽던 자리는 draft store의 `scroll`(`{row, offset}`)로 남는다. 찾기 막대가 열린 동안은 모든 줄을 그린다. 화면 밖으로 나간 줄의 안 상태(펼친 tool 본문 등)는 남지 않는다. 사람이 보내면 따라가기를 켜고 맨 아래로 간다("최신으로"와 같은 길).
36. key scroll은 command `agent.scroll-page-up`·`agent.scroll-page-down`·`agent.scroll-top`·`agent.scroll-bottom`(context `agentView`, 기본 PageUp·PageDown·Ctrl+Home·Ctrl+End)이고 입력칸에 focus가 있어도 대화가 scroll한다. 층(자식 대화·권한)이나 rewind dialog가 열려 있으면 그쪽이 key를 받는다. 위로 가면 따라가기가 꺼지고 아래로 맨 아래 여유에 닿으면 켜진다.
37. 글 조각은 store가 약 40ms로 묶어 알리고, 흐르는 글은 끝난 덩어리(memo)와 꼬리로 나눠 그린다. 흐르는 꼬리는 덜 쓴 표·제목·목록 표시·link를 감추고 parse 결과를 cache한다. 자라는 code block은 새 줄만 칠하고 끝난 결과를 cache한다. 긴 대화 비용은 측정했다(200 turn 대화의 main thread 바쁜 시간 78.8초→7.2초(CPU 4배 느리게), 15초 streaming 50ms 넘는 frame 42→0).

## 경계와 계약

- 감독 pipe(child → core): `model_output {session, turn, model_call, kind, text}`는 redaction 전 날 글이다. `redact_request`·`redact_response`에는 붙잡는 자리를 싣지 않는다.
- event: `ModelOutputStreamed {offset, text}`(core가 redaction 뒤 낸다), `MessageRecorded`, `ToolCallStarted`(제목 포함), `TurnResumed {turn, active_ms}`, `TurnEnded.active_ms`. 쓰는 중인 글은 저장하지 않는다.
- route: `AcpSnapshot`(`writing`, `turn.elapsed`, `session` 포함), transient event `AcpUpdated`(`writing_streamed`와 `offset`, `message_recorded`, `tool_*`, `notice_added`, `command_output` 등), `AcpSend {type, ...}`(`send`, `stop`, `retry`, `answer`, `decide`, 다음 turn 줄 고치기 넷, `set_model`, `run_command`, `run_shell`, `open_session`, `steer_child`, `stop_child` 등. 목록은 [acp.md](acp.md)), `ListToolCalls`(redaction을 거친 tool 제목, `tool` filter).
- message part: `{kind: "reasoning", text, duration_ms}`. 한 응답의 part 순서는 reasoning, text.
- tool 제목은 `{category, title}`이고 한 줄 120자다. 저장하지 않는다.
- 설정: `lophn-agent.run.active_ms`는 없다. 일한 시간은 "Worked for"에 쓰려고만 센다.
- command(단축키): `agent.scroll-page-up`·`agent.scroll-page-down`·`agent.scroll-top`·`agent.scroll-bottom`, context `agentView`.
- 저장: thread bookmark는 shell main만 `<data root>/shell/thread-bookmarks.json`(`{[session key]: [{message, at}]}`)에 줄 세운 원자 쓰기로 쓰고 깨진 file은 덮지 않는다. session key는 lophn이면 `ses_…`, harness면 `<harness>:<cli_session>`이고 message key는 lophn이면 ACP message id, harness면 `origin`이라 `origin`이 null인 harness 메시지는 bookmark할 수 없다. 화면은 preload `lophnThreadBookmarks`(list, set, onChanged)로 읽고 쓴다.
- CSP: shell 화면은 `img-src 'self' data: blob:`이고 wasm·eval을 허용하지 않는다. 창 navigation은 `lophn-shell://desktop` 안으로만 간다.
- source: lophn agent 대화는 core의 ACP를 읽고, harness 대화는 [harness-gui.md](harness-gui.md)의 adapter가 같은 ACP로 낸다.

## 결정

- 글은 token streaming으로 보인다. 이유: 정석(Claude, ChatGPT, Codex, Hermes)이 답이고 지금 구현에서 옮기는 비용은 근거가 아니다. (사람, 2026-10-25)
- 고르는 기준은 정석과 맞는 의미다. 지금 구현에 맞추느라 고르지 않는다. (사람, 2026-10-25)
- tool call은 무엇을 했는지 semantic하게 보이고(Claude Code의 Bash `description`처럼) 펼치면 내용이 보인다. (사람, 2026-10-25)
- live 글의 redaction은 core가 하고 붙잡는 자리는 child에 알리지 않는다. 이유: child가 물을 수 있으면 secret 값을 한 자씩 알아낼 수 있다. 값을 아는 곳(core)이 가리고 붙잡는다. child는 이미 `redact_request`로 날 글을 core에 보내므로 날 글을 보내는 것은 새 노출이 아니다. 버린 안: child에서 가리기(붙잡을 자리를 core에 물어야 한다), 상수 길이로 붙잡기(긴 token의 앞부분이 나간다). (agent)
- 쓰는 중인 글을 core 한 곳에 둔다. 이유: 날 글을 받는 곳과 snapshot을 싣는 곳이 다르지만 한 곳에 있어야 retry·저장·멈춤에서 같이 비워진다. wiring끼리 import하지 않으므로 늦은 칸으로 넘긴다. (agent)
- model 응답 하나가 agent message 하나이고 한 model 호출의 message id는 `model_call`에서 정한다(`msg_` + ULID). (agent, planner·lead)
- 마지막 응답은 글이 비어도 저장하고 run은 빈 답을 `no_answer`로 본다. 이유: 중간 응답의 글이 run의 답이 되지 않게 한다. (agent, lead)
- 멈춘 답은 사람이 본 데까지 turn이 끝나기 전에 core가 저장한다. provider가 끊어 retry하는 attempt의 글은 버린다. 이유: child가 멈춤을 알 때는 core가 turn을 이미 닫아 `RecordMessage`가 거절하고, 멈춤 handler는 writer Worker에서 돌아 core 메모리를 읽지 못한다. (agent)
- `TurnResumed`는 core가 낸다. 이유: child는 Gate 판정마다 기다림 표시를 돌려 진짜 사람 기다림을 가르지 못하고, 사람 기다림 event(turn request, 질문)는 core Bus에 있다. 멈춤·실패·끊김으로 끝나는 turn도 active를 끝난 순간까지 마감한다. (agent)
- "Worked for"는 active다. 이유: 이름과 달리 wall clock이라 승인을 기다린 시간이 들어가고 기다림 뒤 일하는 중 줄이 기다린 만큼 건너뛰었다. (agent)
- 기록한 tool call은 항상 닫고, 줄인 기록은 finish가 거절된 뒤에 낸다. 이유: core의 한도를 복제하지 않는다. `result` 열은 context 추정만 읽어 이미지는 개수만 남긴다. 끝난 turn의 열린 행은 결과를 모르므로 `uncertain`으로 닫는다. 큰 이미지·긴 page·깊은 schema의 결과가 이 한도에 걸려 retry까지 같은 이유로 실패하던 것을 고친 것이다. 원인으로 처음 짚은 blob 동시 준비 한도는 ledger와 맞지 않아(call 하나짜리 응답에서도 생겼다) 장치를 넣지 않았다. (agent)
- tool 제목은 저장하지 않고 읽을 때 지금의 redaction으로 만든다. 이유: redaction 규칙이 바뀌어도 옛 제목에 secret이 남지 않고 화면 셋이 같은 제목을 쓴다. 그래서 `ListToolCalls`는 blob을 기다릴 수 있고 redaction이 있는 core API read다. 앱 tool 제목은 저장된 wire 이름이다. (agent)
- model이 쓰는 설명은 `shell.run`에만 두고 승인 카드에는 싣지 않는다. 나머지 tool은 인자 template이다. 이유: 비교한 harness들이 모인 대로다. file·web tool은 인자 template으로 읽히고 shell 명령만 읽기 어렵다. 칸은 선택이라 비면 명령 첫 줄을 쓴다. (agent)
- markdown은 이미 있는 Lezer 기반 `Markdown`, highlight는 Shiki(JS engine, Worker, lazy grammar)다. 사람 글은 plain, chat image는 불러오지 않는다. 이유: URL 정책과 raw HTML 규칙이 이미 있는 markdown 안에 있고, Shiki는 비교한 세 앱이 모두 쓴다. grammar는 언어를 미리 고르지 않고 lazy chunk로 둔다(설치본 약 9 MB). (agent)
- link는 renderer와 shell 창 navigation guard 둘 다로 막는다. (agent)
- reasoning을 보이고 시간은 provider가 알린 reasoning block의 시작과 끝으로 잰다. 이유: 버리던 이유는 opaque 상태의 규칙이었지 보이지 않기로 한 제품 결정이 아니었다. (agent)
- thread index는 사람 메시지 4개부터 보이고 bookmark는 shell data file 하나에 둔다. 이유: harness 대화는 ledger에 없다. (사람, 2026-11-05)
- fast·thinking·Speed는 composer chip이 아니라 model picker의 축이다. picker는 Roles를 맨 위에 두고 provider 묶음을 접는다. lophn agent도 같다. (사람, 2026-11-05)
- subagent 보기는 따로 둔 Back 줄 없이 탭 머리 ←/→로 오간다. (사람, 2026-11-05)
- shell mode는 harness 넷과 lophn agent 모두에 둔다. 방향은 사람, 모양은 agent. lophn `!`는 사람이 친 것이라 승인 없이 agent shell runner로 돌고 앱 bridge는 막는다(`run_shell`은 `forbidden`). 사람 메시지(`shell` 칸)로 저장하고 turn을 열지 않으며 다음 turn이 `<lophn-shell>`로 가져간다. (agent 추천, 사람이 반대하지 않음)
- 명령은 화면 동작(`opens`), CLI에 보내고 출력 그리기, TUI 전용 숨김의 셋이다. palette 순위는 이름 정확 > 이름 앞부분 > 별칭 > 이름 조각 > 설명이다. (사람이 문제를 짚고 agent가 레퍼런스로 정함)
- 대화 밖 session 기능은 ACP의 입력과 갱신이고 화면은 capability 검사로 칸을 가린다(첫 판의 `external` 숨김을 바꿈). (사람, 2026-11-05)
- 대화를 가상화하고 글 조각 묶음은 약 40ms로 한다. 이유: 긴 대화에서 글 조각마다 모든 markdown이 다시 그려져 streaming·입력이 끊겼다. 참고: Claude·Codex·omp desktop 앱의 throttle(걸린 timer를 지우지 않음). (사람이 끊김을 말함, agent가 측정하며 고침)
- 보내면 따라가기를 켜고 맨 아래로 가며, 대화는 key로도 scroll한다(`agent.scroll-*`). 이유: 올려 읽다 보낸 메시지가 화면 밖에 붙거나 mouse 없이 긴 대화를 읽지 못했다. harness GUI를 CLI 대신 쓰는 사람이 가장 먼저 느낀다. PageUp·PageDown은 tab·pane key와 겹치지 않는다. (agent)

## 열린 것

- 수 MB 이미지 결과의 redaction이 시간 안에 끝나는지는 확인하지 못했다.
- 화면 밖으로 나간 줄의 안 상태(펼친 tool 본문 등)는 가상화 때문에 남지 않는다.
- 두 기기(창, 폰, 다른 기계의 창)가 한 lophn session을 같이 쓸 때: 줄 선 메시지를 한 기기가 고치거나 옮기면 다른 기기의 화면은 옛 글과 순서 그대로다(이슈 `queued-edit-move-not-relayed`). 한 기기가 보관하면 다른 기기가 방금 시작한 turn이 말없이 멈춘다(`archive-stops-turn-started-elsewhere`).
