# adapter-opencode

OpenCode adapter를 `opencode acp`에서 OpenCode server API(HTTP+SSE)로 다시 짠다(README 정한 것 9). `opencode gui`로 시작한 대화는 탭 전용 `opencode serve`에 GUI와 TUI(`opencode --server <url>`)가 같이 붙고(정한 것 7, 8), 그냥 `opencode`로 시작한 TUI는 처음 넘길 때 재시작한다. CLI의 채팅 기능 전부를 넣고 첫 판 결함을 없앤다. 녹화는 lead가 돌린다.

- 단위: adapter (wave 3)
- 선행: acp-core, acp-screen, tab-gui
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui-tab/README.md` 정한 것 5, 7, 8, 9, 11, 12, 13. 계약: 같은 폴더 `acp-session.md`, 탭 쪽 흐름: `tab-gui.md`
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/opencode.md` 전부(§0 구조, §1-2 기능표와 server API, §3 탭 전용 server와 password, §4 첫 판 결함 7, §5 만들 것과 호출)
  - 본보기(lab 소스 2.2.5, 읽기만. 설치된 판은 2.1.4라 쓰는 endpoint는 2.1.4 binary 문자열로 확인한다. 보고서가 "2.1.4 ✓"로 표시한 것): `/home/pyosechang/projects/harness-lab/open-code/open-code-cli/packages/`
    - endpoint와 입력 꼴: `protocol/src/groups/`(session.ts, permission.ts, form.ts, command.ts, event.ts, message.ts)
    - server 띄우기와 lease: `cli/src/server-process.ts:85-89,208-246`
    - TUI가 server에 붙는 법: `cli/src/services/standalone.ts:17-56`, `server-connection.ts:30-45`
    - server event를 갱신으로 옮기는 본보기: `cli/src/acp/translate.ts`, `replay.ts`, `child.ts`
    - 데스크톱이 부르는 법: `app/src/session/`(revert.ts, fork.ts, requests/, composer/), `app/src/composer/submit.ts`
    - 승인 범위: `core/src/permission.ts:165,325,332-337`
  - 지금 code: `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`(다시 짠다), `opencode_test.ts`, `fixtures/opencode/`(ACP 녹화라 새 꼴로 바꾼다), 본보기 `claude.ts`, `index.ts`(login shell env, spawn)
  - 녹화: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`(꼴과 scrub 규칙, 첫 판에 ask 규칙을 건 `OPENCODE_CONFIG_CONTENT`)
  - architecture: `project-docs/architecture/harness-gui.md`(OpenCode adapter 절은 이 task가 바꾸는 대상), `acp.md`, `terminal-agent.md`(탭의 `opencode` 함수와 `--standalone`을 쓰는 이유)
- 계약:
  - 쓰는 것: acp-session의 `HarnessGuiAdapter`(`handoff: "shared"`, 처음 넘김은 restart), `HarnessGuiRun`, `AcpTerminal`, `AcpSessionMeta`·`session_changed`, 새 `AcpInput`과 승인 범위(`session`은 `session.update {permissions}`, `always`는 영구 표시). opencode 2.1.4 server API
  - 내놓는 것: adapter 표의 `opencode` 칸

## 할 일

1. 연결을 감싼다. OpenCode server와 말하는 길(HTTP 요청 하나, SSE `/api/event` 구독)을 주입할 수 있게 둔다(기본은 실제 fetch와 SSE, test는 녹화를 재생하는 가짜). client는 손으로 짠다. 쓰는 endpoint 스무 개쯤만 둔다(`opencode.md` §5). `@opencode/client`는 쓰지 않는다(`effect` 4.0.6에 기대고 OpenCode 판 하나에 묶인다).
2. 탭 전용 server(정한 것 7, 8, 9, `opencode.md` §3). `opencode gui`로 시작했거나 처음 넘김(아래 4) 뒤의 run만 쓴다. 평소 `opencode`(`--standalone`)는 건드리지 않는다.
   - `start`가 `opencode serve --stdio --port 0`을 adapter가 받은 `spawn`으로 띄운다. env는 그 `spawn`의 것에 `terminal.env`(그 탭의 hook env)와 `OPENCODE_PASSWORD`를 덧붙인다. 그래서 plugin·hook이 탭의 env를 본다.
   - password는 `start`가 받은 값의 주입 자리(`ids` 등)에서 만든다. stdout의 `{"url": …}` 줄을 읽는다(`server-process.ts:208`). stdin을 열어 두는 것이 server의 lease다(`:234-246`). `run.stop()`은 stdin을 닫고 process group째 끝낸다.
   - 요청은 Basic auth `opencode:<password>`다(`standalone.ts:51-56`).
   - 처음에 `server.info`로 판을 본다. 녹화한 판(2.1.4)과 다르면 "OpenCode <판>은 lophn이 확인한 2.1.4와 달라 일부 기능이 안 될 수 있다"를 info notice로 한 번 낸다.
3. TUI 쪽(`tuiCommand()`). 같은 server에 붙는 client 명령을 낸다: `opencode --server <url> --session <id>`(2.1.4 `--help`에 둘 다 있다). 탭의 `opencode` 함수는 `--server`가 있으면 `--standalone`을 붙이지 않는다.
   - password는 친 글에 싣지 않는다. 터미널 env는 PASSWORD가 든 이름을 지워(`packages/shell/terminal-host/env.ts`의 `SECRET_NAME`) 물려줄 수도 없다.
   - 그래서 `os.tmpdir()` 아래 `mkdtemp`(0700) 폴더의 0600 file에 쓰고, 명령은 `OPENCODE_PASSWORD="$(cat '<file>')" opencode --server <url> --session <id>`로 낸다. 폴더는 run이 끝나면 지운다. 이 file system 쓰기는 1의 주입 자리 뒤에 둔다(정한 것, 근거: 계약에 탭으로 비밀을 넘기는 길이 없고, 그 탭 사람의 file 권한이면 된다).
4. 처음 넘김(정한 것 8). 그냥 `opencode`로 시작한 TUI 대화를 GUI로 넘길 때는 `exitTui(terminal)`가 TUI를 끝낸다. TUI의 private server는 TUI와 같이 끝난다(stdin lease).
   - tab-gui가 `terminal.onForegroundExit` 뒤에 `start({resume: terminal.sessionId()})`를 부른다. session은 같은 SQLite에 있어 새 server가 `session.get`·`session.messages`로 앞 대화를 다시 그린다.
   - 하던 turn은 새 server가 "server restarted" 합성 메시지로 이어 간다(`core/src/session/execution/restart.ts:16-17`). 그 사실을 info notice로 보인다.
   - TUI를 깨끗이 끝내는 길(`/exit` 명령, 키)은 `packages/tui/src`에서 찾아 쓰고 근거를 보고한다.
5. server event → ACP(`translate.ts`·`replay.ts`를 본보기로).
   - 이 run의 session id에 해당하는 event만 접는다.
   - 글과 reasoning은 흘러나오는 글, tool part는 tool 줄이다. edit 종류는 `edit` 칸(path, 줄 수)이다.
   - 같이 붙은 TUI에서 보낸 사람 메시지도 `message_added`로 낸다(우리가 보낸 것은 응답의 message id로 거른다).
   - child session(`parentID`가 이 session)의 글과 tool은 주 메시지로 그리지 않고 부모 task tool 줄 하나에 둔다(첫 판 결함 1).
6. `AcpSessionMeta`(`session_changed`, `opencode.md` §5).
   - `cli_session`: session id. `title`: session 갱신 event와 `session.update {title}`.
   - `models`·`model`·`efforts`·`effort`: `model.list`, variant. `set_model {model, effort}` → `session.switchModel {model: {providerID, id, variant}}`.
   - `modes`·`mode`: `agent.list`(build, plan, 사람의 custom agent). `set_mode` → `session.switchAgent {agent}`.
   - `commands`: `command.list`(server 명령)와 client 명령 `/undo` `/redo` `/fork` `/compact` `/rename` `/new`. `run_command {name, argument}` → server 명령은 `session.command {name, text}`, client 명령은 아래 7의 호출이다.
   - `usage`: `session.context`와 사용량 갱신 event → `{context_used, context_limit, tokens, cost_usd}`.
   - `capabilities`: `model`, `effort`, `mode`, `commands`, `rewind`, `fork`, `compact`, `rename`, `usage`, `steer`, `queue_edit`, `retry`은 true다.
     - `rewind_files`는 `revert.stage`의 `files`가 file을 되돌리는지 lab 소스로 확인해 정한다.
     - `images`는 입력에 local path가 올 때만 true다. 안 오면 false로 두고 보고한다.
7. 새 입력과 보내기.
   - 보내기: `session.prompt {text, files, delivery}`다. 도는 중의 steer는 `delivery: "steer"`(데스크톱 기본), 다음 turn은 `"queue"`다.
     - 줄 고치기: `send_queued`는 `session.inbox.update {delivery: "steer"}`, `remove_queued`는 inbox cancel이다. `edit_queued`·`move_queued`는 cancel한 뒤 다시 넣는다(inbox 순서는 넣은 순서다).
     - 글이 `!`로 시작하면 `session.shell {command}`다. `retry`는 그 turn의 사람 메시지를 새 prompt로 보낸다.
   - `stop`: `session.interrupt`다.
   - `rewind {message, files}`: 도는 중이면 `session.interrupt`와 `experimental.session.wait`를 먼저 부른다. 그다음 `session.revert.stage {messageID, files?}`로 되돌리고, 되돌린 항목을 `hidden_added`로 숨긴다.
     - 다음 보내기 전에 `session.revert.commit`이다. `/redo`는 `session.revert.clear`다(TUI·데스크톱과 같다).
   - `fork {message | null}`: `session.fork {before?: messageID}`로 새 session을 만들어 같은 탭에서 연다(`session_changed {cli_session}`, 다시 그리기). TUI client를 새 `--session`으로 다시 띄우는 것은 tab-gui의 몫이다(`run.sessionId()`가 바뀐 것으로 안다).
   - `compact`: `session.compact`. `session.compaction.*` event는 info notice다(첫 판 결함 4).
   - `rename {title}`: `session.update {title}`.
8. 승인 범위(정한 것 12, `opencode.md` §1 approvals, §5). `permission.asked` → `approval_opened`.
   - 한 번 → reply `once`.
   - 이 session 동안 → `session.update {permissions: [지금 것, 요청의 save 규칙]}` 뒤 reply `once`. 영구 규칙이 남지 않는다.
   - 영구 → reply `always`. "영구: 이 project의 OpenCode 규칙에 저장" 표시를 붙인다(`core/src/permission.ts:332-337`).
   - 거절 → reply `{decision: "reject", message: <이유>}`. turn은 이유를 받고 이어 간다(`CorrectedError`). 그 tool은 거절로 끝나고 turn을 stopped로 그리지 않는다(첫 판 결함 2).
   - 다른 client(TUI)가 먼저 답한 승인(`permission.replied` 류 event)은 답 없이 닫는다.
   - edit 승인은 지금 `subject.kind: "mcp_tool"`로 그려진다(첫 판 결함 6). 편집 subject 꼴은 `packages/protocol/approvals/gate-call.ts`에 없으니 계약 바꾸기 요청으로 보고하고, 그 전에는 path를 subject에 싣는다.
9. 질문. `form.created`(question 종류) → `question_asked`. `answer` → `session.form.reply`, 닫기 → `session.form.cancel`. 다른 client가 답하거나 닫은 form은 `question_resolved`다. 열린 이슈 "CLI가 사람에게 묻는 요청이 질문 카드로 오지 않고 turn이 실패한다"의 OpenCode 쪽이다. 실제로는 실패가 아니라 "보여 줄 수 없었다"로 짐작해 이어 갔다(첫 판 결함 3).
10. 첨부(첫 판 결함 7). `resource_link`의 `file://`은 `files: [{uri, name}]`이고, `resource`(앱 context)는 글이다.
11. 첫 판의 ACP code(`initialize`, `session/new`, `session/load`, `session/prompt`, `session/request_permission`, `session/cancel`)와 ACP 녹화 fixture를 지운다. 주석과 이름도 grep해 고친다.
12. 녹화(정한 것 13). worker는 실제 CLI를 띄우지 않는다.
    - `fixtures/opencode/record.ts`를 쓴다. 이 script는 `.dev-data/adapter-opencode/rec/<scenario>/`(0700) cwd에서 2와 같이 `opencode serve --stdio --port 0`을 password와 함께 띄운다. HTTP와 SSE client 둘(A=GUI, B=TUI 대신)로 아래 scenario를 몰고 JSONL(`{t, kind, data}`)을 `.dev-data/adapter-opencode/rec/<scenario>.jsonl`에 쓴다.
    - 승인 scenario만 첫 판처럼 `OPENCODE_CONFIG_CONTENT`로 shell·edit에 ask를 건다. adapter 자신은 사람 설정을 바꾸지 않는다.
    - scenario:
      - text, 도는 중 steer, queue와 inbox list·update·cancel, interrupt
      - 승인 once, 이 session 동안(`session.update permissions` 뒤 같은 꼴을 다시 묻지 않음), 이유 붙은 거절(turn이 이어 감), B가 먼저 답해 A가 받는 event
      - 질문 form 답과 닫기
      - `model.list`와 variant 바꾸기, `agent.list`와 plan으로 바꾸기, `command.list`와 server 명령 하나
      - `revert.stage` 뒤 commit, `revert.clear`, `fork {before}`
      - compact, rename, context·사용량
      - file 첨부, `!` shell, subagent(task tool의 child session)
      - 새 server process에서 `session.get`·`session.messages`(resume), `server.info`
    - **`always` 승인은 녹화에서 보내지 않는다.** 사람의 OpenCode DB에 project 규칙이 남는다.
    - script를 쓰면 scenario 목록과 돌리는 명령을 보고하고 멈춘다. lead가 사람 허락 아래 돌리고 녹화를 건넨다(SendMessage). 받으면 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 scrub 규칙대로 test에 필요한 줄만 `fixtures/opencode/`에 옮긴다. password와 url의 port도 지운다. test는 recorder를 부르지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(녹화 fixture로 adapter를 돌린다. 실제 opencode를 띄우지 않는다):
  - "permission 요청은 창이 답하기 전까지 reply가 나가지 않는다"
  - "거절하면 reply가 reject와 이유를 싣고, 그 tool은 거절로 끝나며 turn은 stopped로 그려지지 않는다"
  - "다른 client가 먼저 답하면 이쪽 카드가 답 없이 닫힌다"
  - "이 session 동안 허락은 `session.update permissions`와 `once`만 보내고 `always`를 보내지 않는다. `always`는 영구 표시된 선택에서만 나간다"
- 남지 않음:
  - `grep -n "session/prompt\|session/request_permission\|session/new\|\"acp\"" packages/shell/main/extensions/bundled/harness-gui/opencode.ts`가 0줄이다.
  - `grep -l '"jsonrpc"' packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 따로 적을 것:
- 쓴 endpoint와 각각을 2.1.4에서 확인한 근거
- 판 확인 notice의 꼴
- `exitTui`의 근거
- password file을 둔 자리
- 녹화에 쓴 scenario와 녹화가 보이지 않은 동작
- 계약 바꾸기 요청(편집 승인 subject)
- 등록할 것: adapter 표의 `opencode` 칸(lead)
- `project-docs/architecture/harness-gui.md`의 OpenCode adapter 절에서 lead가 바꿀 내용(`opencode acp`를 버렸다)

## lead가 더한 것

- (lead가 더함) adapter가 받는 `spawn`은 login shell env < 탭 hook env < 넘긴 key 순서로 합친다(`tab-gui`). adapter는 자기가 바꾸는 key만 넘기고 env 전체를 복사해 넘기지 않는다(그러면 login shell env를 덮는다).
