# adapter-codex

Codex adapter에 CLI의 채팅 기능 전부를 app-server로 넣는다. `codex gui`로 시작한 대화는 탭 전용 app-server(unix socket)에 GUI와 TUI(`codex --remote … --cd`)가 같이 붙고(README 정한 것 7, 8, 10), 그냥 `codex`로 시작한 TUI는 처음 넘길 때 재시작한다. 첫 판 결함을 고친다. 녹화는 lead가 돌린다.

- 단위: adapter (wave 3)
- 선행: acp-core, acp-screen, tab-gui
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`
- 읽을 것:
  - 계획: `project-docs/plan/harness-gui-tab/README.md` 정한 것 5, 7, 8, 10, 11, 12, 13. 계약: 같은 폴더 `acp-session.md`, 탭 쪽 흐름: `tab-gui.md`
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/codex.md` 전부(§0 핵심, §1 기능표와 app-server 호출, §3 A 같이 붙기와 걸리는 점, §4 첫 판 결함 11, §5 만들 표). protocol type은 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/codex-ts`(stable)와 `codex-ts-exp`(`--experimental`), 쓰는 method 목록은 `client-methods.txt`·`desktop-method-usage.txt`
  - 본보기(lab, 읽기만): `/home/pyosechang/projects/harness-lab/codex/codex-cli/codex-rs/`의 `app-server-protocol/src/protocol/v2/`(thread.rs, item.rs), `app-server/src/outgoing_message.rs`(서버 요청을 여러 client에 보내고 `serverRequest/resolved`), `tui/src/app_server_session.rs`(TUI가 부르는 순서), `tui/src/lib.rs:472-506`(`--remote unix://`), `app-server-transport/src/transport/unix_socket.rs:78-140`(socket 폴더 조건). 데스크톱: `/home/pyosechang/projects/harness-lab/codex/derived/codex-desktopapp/app/.vite/build/src-VqXTPopo.js:40652-40676`(unix socket 위 WebSocket), `:44060-44074`(initialize), `webview/assets/app-primary-7eef500906c5.js:348150-348200`(승인·질문 답), `app-initial-c8dbea294abe.js:145838-145870`(revert)
  - 지금 code: `packages/shell/main/extensions/bundled/harness-gui/codex.ts`, `codex_test.ts`, `fixtures/codex/`, 본보기 `claude.ts`(같은 계획에서 고쳐지는 중), `index.ts`(login shell env, spawn)
  - 녹화: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`(꼴과 scrub 규칙), 첫 판 녹화 `.../harness-gui-recordings/codex/`
  - architecture: `project-docs/architecture/harness-gui.md`(Codex adapter 절), `acp.md`, `terminal-agent.md`(탭의 `codex` 함수와 `--no-daemon`을 쓰는 이유)
- 계약:
  - 쓰는 것: acp-session의 `HarnessGuiAdapter`(`handoff: "shared"`, 처음 넘김은 restart), `HarnessGuiRun`, `AcpTerminal`(`env`로 탭의 hook env를 app-server에 준다), `AcpSessionMeta`·`session_changed`, 새 `AcpInput`. codex-cli 0.166.0 app-server
  - 내놓는 것: adapter 표의 `codex` 칸

## 할 일

1. 연결 하나를 감싼다. app-server와 말하는 길(줄 하나 보내기, 받은 줄 listener)을 주입할 수 있게 둔다(기본은 실제 연결, test는 녹화를 재생하는 가짜). 메시지 꼴은 지금처럼 `jsonrpc` 칸 없는 JSON-RPC다(`codex.md` §0).
2. 탭 전용 app-server(정한 것 7, 8, `codex.md` §3 A). `codex gui`로 시작했거나 처음 넘김(아래 4) 뒤의 run만 쓴다. 평소 `codex`(`--no-daemon`)는 건드리지 않는다.
   - `start`가 `codex app-server --listen unix://<폴더>/codex.sock`을 adapter가 받은 `spawn`으로 띄운다. env는 그 `spawn`의 것(login shell env 전체, 상위 session 표지를 뺀 것)에 `terminal.env`(그 탭의 hook env)를 덧붙인다. 그래서 hook이 탭의 `LPN_TERMINAL_HOOK`을 본다(첫 판 결함 11).
   - socket 폴더는 사람 소유이고 group·other가 쓸 수 없어야 한다(`unix_socket.rs:78-97`). `os.tmpdir()` 아래 `mkdtemp`(0700)로 만들고 run이 끝나면 지운다. 이 file system 쓰기는 1의 주입 자리 뒤에 둔다.
   - socket이 생길 때까지 기다린 뒤 GUI가 그 socket 위 WebSocket(`ws://localhost/rpc`, `net.connect(<socket>)`)으로 붙는다. 데스크톱과 같은 길이다. `ws`는 root `package.json`의 8.22.0이다. `packages/shell/main/package.json`에 선언이 필요하면 등록 요청한다.
   - `initialize`는 데스크톱처럼 `capabilities {experimentalApi: true, optOutNotificationMethods: [그리지 않는 알림]}`이다(첫 판 결함 2, `capabilities: null`을 없앤다).
   - 새 대화는 `thread/start`, `--resume <id>`나 처음 넘김은 `thread/resume {threadId, excludeTurns: true}` 뒤 `thread/turns/list`로 나눠 받아 앞 대화를 그린다(첫 판 결함 9).
   - `run.stop()`은 WebSocket을 닫고 server process를 process group째 끈 뒤 socket 폴더를 지운다. server가 먼저 죽으면 실패한 turn으로 알린다.
3. TUI 쪽(`tuiCommand()`). 같은 server에 붙는 client 명령을 낸다: `codex --remote unix://<socket> --cd "$PWD"`에 지금 thread를 여는 인자. `codex resume --help`와 `tui/src/lib.rs`로 `--remote`와 thread 지정이 같이 되는 꼴을 확인해 쓴다. 안 되면 보고한다. 탭의 `codex` 함수는 `--remote`가 있으면 `--no-daemon`을 붙이지 않는다(`packages/shell/terminal-host/shell-integration.ts:139`). TUI는 remote workspace mode라 `--cd`가 꼭 있어야 하고 그 탭에서는 `--worktree`·`--add-dir`이 안 된다(`codex.md` §3 걸리는 점). 그 사실을 run이 처음 TUI로 넘길 때 info notice 한 줄로 알린다.
4. 처음 넘김(정한 것 8). 그냥 `codex`로 시작한 TUI 대화를 GUI로 넘길 때는 `exitTui(terminal)`가 TUI를 끝내고, tab-gui가 `terminal.onForegroundExit` 뒤에 `start({resume: terminal.sessionId()})`를 부른다. Codex는 rollout file에 쓰는 process를 하나로 막는 lock이 없어(`codex.md` §3 B) 두 process가 같은 thread를 동시에 열면 안 된다. 그래서 끝난 것을 확인한 뒤에만 연다. TUI를 깨끗이 끝내는 길(빈 composer의 `/exit`·`/quit`, Ctrl+C 두 번 등)은 `tui/src`에서 찾아 `exitTui`에 쓰고 근거를 보고한다.
5. 같이 붙은 대화를 맞춘다(`codex.md` §0, §3 A).
   - `turn/start`·`turn/steer`에 ACP message id를 `clientUserMessageId`로 싣는다. `item/started userMessage`의 client id가 우리 것이 아니거나 없으면 `message_added`(사람 메시지)로 낸다. TUI에서 친 메시지가 GUI에 보인다(첫 판 결함 3).
   - model·effort·권한·plan 바꾸기는 `thread/settings/update`(experimental)로 한다. 그러면 TUI가 `thread/settings/updated`로 따라온다. 남이 바꾼 `thread/settings/updated`도 `session_changed`로 낸다.
   - 승인·질문은 붙은 client 모두에게 간다. 먼저 답한 쪽이 이기고 나머지는 `serverRequest/resolved`를 받는다. 받으면 답하지 않고 그 카드를 닫는다(`approval_closed`·`question_resolved`). turn이 끝날 때 남은 승인에 `cancel`을 보내지 않는다. 사람이 멈춘(stop) 때에도 이미 resolved된 것에는 보내지 않는다(첫 판 결함 10).
6. `AcpSessionMeta`를 채운다(`session_changed`, `codex.md` §5).
   - `cli_session`: thread id. `title`: `thread/name/updated`.
   - `models`·`model`·`efforts`·`effort`: `model/list`(`displayName`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `hidden`은 뺀다). `set_model {model, effort}` → `thread/settings/update {model, effort}`.
   - `modes`·`mode`: 권한 mode(데스크톱의 read-only, auto, full-access. granular·guardian은 `config/read`에 있으면). `set_mode` → `thread/settings/update {permissions, approvalPolicy, approvalsReviewer}`. full-access의 description에 "Codex가 묻지 않고 무엇이든 실행한다"를 적는다.
   - plan(collaboration mode): `collaborationMode/list`가 주면 명령 `/plan`(켜고 끄기)으로 둔다. ACP의 mode 축은 권한에 쓴다. plan 갱신(`turn/plan/updated`, `item/plan/delta`)은 맞는 ACP 칸이 없으면 단계 목록을 agent message 글로 내고 보고한다.
   - `commands`: client 표 하나로 둔다. 표: `/compact`(`thread/compact/start`), `/review`(`review/start`), `/plan`, `/goal <목표>`(`thread/goal/set`), `/rename <이름>`, `/fork`, `/new`(새 thread를 같은 탭에), `/status`(`config/read`와 사용량을 info notice로). `skills/list`의 skill은 이름을 명령으로 내고 실행은 `turn/start`의 `UserInput skill`이다. `run_command {name, argument}`가 이 표를 부른다.
   - `usage`: `thread/tokenUsage/updated` → `{context_used, context_limit, tokens}`(첫 판 결함 7).
   - `capabilities`: `model`, `effort`, `mode`, `commands`, `fork`, `compact`, `rename`, `usage`, `steer`, `queue_edit`, `retry`, `rewind`은 true. `rewind_files`는 false(`thread/revert`는 file을 되돌리지 않는다, `v2/thread.rs:1308-1318`). `images`는 입력에 local path가 오는 경우만 true이고, 오지 않으면 false로 두고 보고한다.
7. 새 입력.
   - `rewind {message}`: 데스크톱처럼 마지막 사람 메시지만, turn이 돌지 않을 때만이다. `thread/revert {threadId, beforeTurnId}` 뒤 되돌린 항목을 `hidden_added`로 숨긴다. 다른 메시지나 도는 중이면 `invalid_input`이다(`thread/rollback {numTurns}` 대체는 쓰지 않는다. 설치된 0.166.0에 `thread/revert`가 있다).
   - `fork {message | null}`: `thread/fork {threadId, lastTurnId | beforeTurnId}` → 새 thread를 같은 탭에서 연다(`thread/resume`, 다시 그리기, `session_changed {cli_session}`). TUI가 옛 thread에 붙어 있으면 TUI client를 다시 띄우는 것은 tab-gui의 몫이다. tab-gui가 `run.sessionId()`가 바뀐 것으로 알 수 있게만 한다.
   - `compact`: `thread/compact/start`. `contextCompaction` item은 info notice다.
   - `rename {title}`: `thread/name/set`.
   - 보내기: 도는 중의 `delivery` steer는 `turn/steer {expectedTurnId, clientUserMessageId}`다. 다음 turn은 지금처럼 adapter의 줄(`message_queued` → `message_taken`)이다. `retry`는 그 turn의 첫 사람 메시지를 새 turn으로 보낸다. 글이 `!`로 시작하면 `thread/shellCommand {threadId, command}`다.
8. 권한(정한 것 12, 첫 판 결함 5). `thread/start` 전에 `config/read`로 사람의 실제 `approvalPolicy`·sandbox를 읽는다. `never`이거나 `danger-full-access`일 때만 `approvalPolicy: "on-request"`, sandbox `workspace-write`를 넘긴다. 그 밖에는 아무것도 넘기지 않는다(read-only를 고른 사람을 느슨하게 하지 않는다). `codex.ts:15-18`의 늘 덮어쓰기를 지운다.
9. 승인 범위(정한 것 12, `codex.md` §1 approvals). 요청의 `availableDecisions`에 있는 것만 낸다.
   - 한 번 → `accept`. 이 session 동안 → `acceptForSession`.
   - 영구 → `{acceptWithExecpolicyAmendment}`(`proposedExecpolicyAmendment`가 있을 때)와 `{applyNetworkPolicyAmendment}`(network host). 둘 다 `always`이고 "영구: `~/.codex/rules`에 저장" 표시를 붙인다.
   - 거절 → `decline`(turn은 이어 간다). 사람이 멈춘 turn의 열린 승인 → `cancel`(위 5의 resolved 규칙).
   - patch 승인(`item/fileChange/requestApproval`)은 지금 `subject.kind: "mcp_tool"`로 그려진다(첫 판 결함 4). 편집 subject 꼴(paths, +/- 줄 수, `reason`, `grantRoot`)은 `packages/protocol/approvals/gate-call.ts`에 없다. 고치지 말고 계약 바꾸기 요청으로 보고하고, 그 전에는 지금 subject에 path와 이유를 싣는다.
10. 질문. `item/tool/requestUserInput {questions[{id, header, question, isOther, isSecret, options}]}` → `question_asked`. `answer` → `{answers: {[id]: {answers: [...]}}}`(`app-primary…js:348150-348166`). 지금의 `-32601` 답을 이 길로 바꾼다. 열린 이슈 "CLI가 사람에게 묻는 요청이 질문 카드로 오지 않고 turn이 실패한다"의 Codex 쪽이다. `mcpServer/elicitation/request`는 decline으로 답하고 info notice를 하나 낸다.
11. 그리지 않던 item(첫 판 결함 6, 7, 8).
    - `webSearch`, `mcpToolCall`, `dynamicToolCall`, `imageView`, collab·subagent item은 tool 줄이다(subagent는 부모 줄 하나).
    - `contextCompaction`, `enteredReviewMode`·`exitedReviewMode`, `error` 알림(재연결·재시도)은 info notice다.
    - `hook/*`는 그리지 않는다.
    - reasoning은 `summaryPartAdded`마다 줄을 나누고, summary와 raw `textDelta`가 같이 오면 summary 하나만 쓴다.
12. file chip(첫 판 결함 1). `resource_link`의 `file://`은 `UserInput {type: "mention", name, path}`, `resource`(앱 context)는 지금처럼 글이다(`codex.ts:54-58`).
13. 녹화(정한 것 13). worker는 실제 CLI를 띄우지 않는다.
    - `fixtures/codex/record.ts`를 쓴다. 이 script는 `.dev-data/adapter-codex/rec/<scenario>/`(0700)에서 2와 같은 탭 전용 app-server를 띄운다. WebSocket client 둘(A=GUI, B=TUI 대신)로 아래 scenario를 몰고 JSONL(`{t, kind, data}`, 첫 판 녹화와 같은 꼴)을 `.dev-data/adapter-codex/rec/<scenario>.jsonl`에 쓴다.
    - scenario:
      - text(`clientUserMessageId` 포함)
      - B가 보낸 메시지를 A가 받기
      - 명령 승인 경합(A·B 모두 받고 B가 답함 → A의 `serverRequest/resolved`)
      - 명령 decline, 명령 `acceptForSession` 뒤 같은 꼴 명령을 다시 묻지 않음, patch accept
      - `model/list`와 `thread/settings/update {model, effort}`(B가 `thread/settings/updated`를 받음)
      - 권한 mode 바꾸기, `collaborationMode/list`와 plan turn(`turn/plan/updated`)
      - `requestUserInput` 질문과 답
      - `thread/revert` 뒤 새 turn, `thread/fork`, `thread/compact/start`와 `thread/tokenUsage/updated`, `thread/name/set`
      - steer, interrupt, `excludeTurns` resume과 `thread/turns/list`
      - `!` shell, file mention 입력, webSearch, `config/read`
    - **영구 규칙을 쓰는 결정(`acceptWithExecpolicyAmendment`, `applyNetworkPolicyAmendment`)은 녹화에서 보내지 않는다.** 사람의 `~/.codex/rules`에 남는다.
    - script를 쓰면 scenario 목록과 돌리는 명령을 보고하고 멈춘다. lead가 사람 허락 아래 돌리고 녹화를 건넨다(SendMessage). 받으면 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 scrub 규칙대로 test에 필요한 줄만 `fixtures/codex/`에 옮긴다. 첫 판 fixture 중 새 꼴과 안 맞는 것은 지운다. test는 recorder를 부르지 않는다.
14. `codex.ts`의 첫 판 주석·이름 중 옛 동작(늘 덮어쓰는 권한, `-32601` 질문, ACP 쪽 "steer 없음" 등)을 grep해 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(녹화 fixture로 adapter를 돌린다. 실제 codex를 띄우지 않는다):
  - "명령·patch 승인은 창이 답하기 전까지 app-server에 답이 나가지 않는다"
  - "거절하면 그 tool이 declined로 끝나고 turn은 이어 간다"
  - "다른 client가 먼저 답하면(`serverRequest/resolved`) 이쪽 카드가 답 없이 닫힌다"
  - "이 session 동안 허락은 `acceptForSession`만 보내고, 영구 결정은 영구 표시된 선택에서만 나간다"
  - "사람 설정이 `never`·`danger-full-access`일 때만 `on-request`·`workspace-write`를 넘기고, 그 밖에는 권한을 넘기지 않는다"
- 남지 않음: `grep -n "capabilities: null\|-32601" packages/shell/main/extensions/bundled/harness-gui/codex.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 따로 적을 것:
- 녹화에 쓴 scenario와 녹화가 보이지 않은 동작
- `exitTui`의 근거
- TUI 쪽 `--remote` 명령의 최종 꼴
- 계약 바꾸기 요청(편집 승인 subject, plan 칸이 필요하면)
- 등록할 것: adapter 표의 `codex` 칸(lead), `ws` 선언(필요하면)

## lead가 더한 것

- (lead가 더함) adapter가 받는 `spawn`은 login shell env < 탭 hook env < 넘긴 key 순서로 합친다(`tab-gui`). adapter는 자기가 바꾸는 key만 넘기고 env 전체를 복사해 넘기지 않는다(그러면 login shell env를 덮는다).
