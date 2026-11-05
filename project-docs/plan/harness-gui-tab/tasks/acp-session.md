# acp-session

ACP에 대화 밖 session 기능(model, effort, mode, 명령, rewind, fork, compact, 이름, 사용량, CLI session id)과 source가 그 기능을 가졌는지 알리는 capability를 더하고(README 정한 것 5), harness adapter의 toggle port(정한 것 7)를 정한다. wave 2·3이 이 모양에 기댄다.

- 단위: acp (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/acp/session.ts`(새 file)
  - `packages/protocol/acp/state.ts`
  - `packages/protocol/acp/input.ts`
  - `packages/protocol/acp/items.ts`
  - `packages/protocol/acp/reduce.ts`
  - `packages/protocol/acp/reduce_test.ts`
  - `packages/protocol/extensions/acp-session.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/adapter.ts`(type과 이 wave의 표 stub)
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/protocol/acp/routes.ts`(`AcpSend` 출력: fork의 새 session id)
  - `packages/sdk/agent/acp-types.ts`(SDK의 zod 없는 ACP type 사본. `@lophn/agent` 1.1.0으로 올린다: type만 더한다. 판 등록과 template 고정 판은 lead)
  - `packages/protocol/approvals/gate-call.ts`(file 바꾸기 승인 subject, planner가 더함)
- 읽을 것:
  - architecture: `project-docs/architecture/acp.md`(모양, 지키는 것, "core 밖에서 내는 ACP"), `harness-gui.md`(첫 판의 handle·adapter), `agent-chat.md`
  - 계획: `project-docs/plan/harness-gui-tab/README.md` 정한 것 5, 7, 11, 12
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/code.md` §4·§5(ACP와 source가 지금 싣는 것과 빈 것), `claude.md` §4, `codex.md` §5, `opencode.md` §5, `omp.md` §4(CLI마다 기능과 경계 호출), `wrappers.md` §1(toggle 흐름)
  - 지금 코드: `packages/protocol/acp/{state,input,items,reduce,routes}.ts`, `packages/protocol/approvals/turn-request.ts`(`turnRequestChoiceSchema`), `packages/protocol/extensions/acp-session.ts`, `packages/shell/main/extensions/bundled/harness-gui/{adapter,index}.ts`, `packages/shell/renderer/conversation/agent-tab-source.ts:555-707`, `packages/shell/renderer/conversation/model-picker/types.ts`(lophn picker의 축), `packages/sdk/agent/acp-types.ts`와 `agent_test.ts`(설치 SDK의 zod 없는 사본과 양쪽 대입 검사), `packages/core/apps/packages/vendor.ts:87-100`(사본이 vendor하는 `reduce.ts`의 type import 규칙)
- 계약:
  - 쓰는 것: 지금 `packages/protocol/acp/`(`AcpState`, `AcpUpdate`, `AcpInput`, `reduceAcp`), `packages/protocol/approvals/turn-request.ts`(`TurnRequestChoice`, 바꾸지 않는다)
  - 내놓는 것:
    - `session.ts`: `AcpSessionMeta = {title, cli_session, capabilities, models, model, modes, mode, commands, usage}`(effort·speed·thinking·variant는 model의 축과 `model.options`다, 할 일 참조). `AcpCapabilities`(boolean 칸: `model`, `effort`, `mode`, `commands`, `rewind`, `rewind_files`, `fork`, `compact`, `rename`, `usage`, `steer`, `queue_edit`, `images`, `retry`, `sessions`). `AcpChoice = {id, label, description?}`, `AcpCommand = {name, description, argument_hint?}`, `AcpUsage = {context_used, context_limit, tokens?, cost_usd?}`.
    - `AcpState.session: AcpSessionMeta | null`. `AcpUpdate`에 `session_changed {session: Partial<AcpSessionMeta>}`(접으면 덮어 합친다). notice 항목에 `info` 종류(글 한 줄: compaction, 재시도, 명령 출력).
    - `AcpInput`에 `set_model {model, options?}`, `set_mode {mode}`, `run_command {name, argument}`, `rewind {message, files}`, `fork {message | null}`, `compact`, `rename {title}`.
    - 승인: `AcpPending.approval`이 harness가 내놓는 범위를 싣는다(`once`·`session`·`always`·`reject`, `always`는 영구라는 표시). `decide`의 choice에 ACP 쪽 `{kind: "session"}`을 더한다(`TurnRequestChoice`는 그대로).
    - `acp-session.ts`: `AcpTerminal = {id(terminal_ref), cwd, harness, env(그 탭의 hook env), state(), sessionId(), type(text), signal("SIGINT"|"SIGTERM"), onForegroundExit(listener)}`. `ExtensionAcp.open({terminal, harness, title})`이 그 탭에 묶인 `AcpSessionHandle`을 준다. `ExtensionAcp.onTab({gui(request), tui(terminalId)})`가 `onOpenIntent`를 대신한다(`request = {terminal, harness, resume?}`). `GUI_HARNESSES`에 `omp`.
    - `adapter.ts`: `HarnessGuiAdapter = {handoff: "restart" | "shared", start({terminal, resume?, session, spawn, clock, ids}) → Result<HarnessGuiRun>, exitTui(terminal)}`. `HarnessGuiRun = {stop(): Promise<void>, tuiCommand(): string, sessionId(): string | null, running(): {turn: boolean; tasks: number}}`(`running`은 restart 전 modal이 "멈출 것"을 말하게 한다. coordinator가 더함). restart는 `stop()`이 끝난 뒤 `tuiCommand()`(그 session의 resume과 넘길 flag)를 친다. shared는 `stop()` 없이 `tuiCommand()`(같은 server에 붙는 client)를 친다.
    - (coordinator가 더함) `gate-call.ts`: `fileChangeSubjectSchema = {kind: "file_change", changes: [{path, change: "create" | "update" | "delete", added: number | null, removed: number | null}]}`. `gateCallSchema`에는 넣지 않고 ACP 승인 subject만 `acpApprovalSubjectSchema = gateCall ∪ file_change`로 넓힌다(core Gate의 `judge`는 그대로).
    - (coordinator가 더함) `AcpState.plan: {entries: [{text, status: "pending" | "in_progress" | "completed"}]} | null`과 갱신 `plan_changed {entries}`(통째로 바꾼다). lophn agent는 todo가 없어 `null`이다.
    - (coordinator가 더함) harness 이미지: 사람 메시지의 이미지는 `resource_link {uri: "file://<경로>", name, mimeType: "image/…"}`이고 그 file은 shell main이 탭의 임시 폴더에 쓴다(`tab-gui`). `AgentTabSource.uploadImage(image) → {block: ContentBlock}`(core source는 지금처럼 blob hash의 `image` block, harness source는 위 `resource_link`). capability `images`가 붙이기를 켠다.
    - `agent-tab-source.ts`: `AgentTabSource.act(session, input)`(새 ACP 입력을 보내는 길 하나). capability는 source가 아니라 ACP 상태(`session.capabilities`)에서 읽는다. `external`은 지우지 않는다(wave 2가 읽기와 쓰기를 떼면 lead가 지운다).

## 할 일

계약 task다(brief-template "brief를 쓸 때 지킬 것"). 새 모양을 더하고, 옛 모양을 쓰는 곳이 wave 2·3에 남으므로 바로 바꾸기 어려운 곳은 옛것 옆에 새것을 둔다. 아래 꼴이 위 "계약" 줄보다 자세하고, 둘이 다르면 아래가 맞다(차이는 보고의 "정한 것"에 적는다).

1. `packages/protocol/acp/session.ts`(새 file, zod schema와 type). lophn agent의 지금 기능(model 축, skip, slash, rewind, fork, compact, 이름, `/status`)과 CLI 넷의 §5 표를 함께 덮는 가장 작은 꼴이다.
   - `AcpChoice = {id, label, description: string | null}`.
   - model: `AcpModelAxis = {id, label, values: [{value, label}]}`(lophn picker의 `PickerAxisView`와 같은 칸. effort·speed·thinking·variant가 다 축이다), `AcpModel = {id, label, axes: AcpModelAxis[]}`, `AcpModelGroup = {id, label, models: AcpModel[]}`(lophn은 provider 묶음, harness는 CLI가 주는 묶음이나 하나). `AcpModelCurrent = {model, label, options: Record<axis id, value>, layer: AgentValueLayer | null}`(`layer`는 lophn picker의 "어느 층의 값" 표시. harness는 null). model id는 source가 정하는 불투명 글이고 화면은 해석하지 않는다. 계약 줄의 `efforts`·`effort`는 따로 두지 않고 축과 `options`로 쓴다(lophn이 effort 밖의 축(speed)을 가져서다).
   - `AcpCommand = {name, description, argument_hint: string | null, source: "builtin" | "skill" | "cli"}`. `builtin`·`skill`은 lophn의 `COMMAND_SOURCES`(`packages/protocol/lophn-agent/commands.ts`)와 같은 뜻이고 `cli`는 harness가 주는 명령이다.
   - `AcpUsage = {context: {tokens, limit} | null, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens: number | null, turns: number | null, costs: [{kind, currency, amount}], provider: {name, definition, account, state, until} | null}`. 칸은 지금 `StatusView`(`agent-tab-source.ts:456-495`)와 같다(`/status`가 ACP 하나로 그려지게). harness는 아는 칸만 채운다.
   - `AcpCapabilities`: 계약 줄의 boolean 열넷(`model`, `effort`, `mode`, `commands`, `rewind`, `rewind_files`, `fork`, `compact`, `rename`, `usage`, `steer`, `queue_edit`, `images`, `retry`)에 `sessions`(lophn session 목록·바꾸기·새로·archive·delete. header의 session menu가 이것을 본다. lophn은 true, harness는 false)를 더한 열다섯. `effort`는 "model 축 값을 바꿀 수 있다"이다. rewind를 마지막 사람 메시지에만 받는 harness(Codex)는 `rewind`를 켜고 다른 메시지면 `invalid_input`으로 답한다(칸을 더 두지 않는다).
   - `AcpSessionMeta = {title: string | null, cli_session: string | null, capabilities, models: AcpModelGroup[], model: AcpModelCurrent | null, modes: AcpChoice[], mode: string | null, commands: AcpCommand[], usage: AcpUsage | null}`. `cli_session`은 harness CLI 자신의 session id이고(resume, 창 머리), lophn은 null이다.
2. `state.ts`: `AcpState.session: AcpSessionMeta | null`, `AcpState.plan`(위 계약), `EMPTY_ACP_STATE`에 둘 다 null. 갱신 셋을 더한다: `session_changed {session: Partial<AcpSessionMeta>}`(맨 위 칸만 덮어 합친다. `capabilities`는 통째로), `plan_changed {entries}`, `notice_added {item: AcpNoticeItem}`(turn 중간의 한 줄 알림. 순번은 다른 항목과 같은 규칙이다). `AcpPending.approval`에 `choices: ("once" | "session" | "always" | "reject")[]`를 더하고 `subject`를 `acpApprovalSubjectSchema`로 넓힌다. `always`는 어디서나 영구 규칙이고(lophn은 할당 규칙, Codex "비슷한 명령", OpenCode·omp always) `session`은 그 CLI session 안에서만이다(README 정한 것 12).
3. `items.ts`: notice 꼬리 union에 `{type: "info", text}`(compaction, 재시도, 명령 출력). approval 항목의 `choice`에 `"session"`, `subject`는 `acpApprovalSubjectSchema`.
4. `gate-call.ts`: 위 계약의 `fileChangeSubjectSchema`와 `acpApprovalSubjectSchema`를 둔다. `gateCallSchema`·`GateCall`과 core Gate는 바꾸지 않는다.
5. `input.ts`: 새 입력 일곱(모두 `session`과 idempotency `key`를 싣는다. 지금 `stop`과 같은 꼴): `set_model {model, options}`, `set_mode {mode}`, `run_command {name, argument}`, `rewind {message, files: boolean, apps: app id[]}`(lophn `RewindChoice`와 같은 칸), `fork {message: msg id | null}`, `compact`, `rename {title}`. `decide`의 `choice`는 ACP 쪽 union `acpDecideChoiceSchema`(`once`·`session`·`always`·`reject {reason?}`)로 바꾼다(`turnRequestChoiceSchema`는 그대로 두고 core가 `session`을 받지 않는다).
6. `reduce.ts`: 세 갱신을 접는다. 같은 갱신을 두 번 접어도 같고(`acp.md` "순서와 읽기"), `notice_added`는 순번 빈틈이면 다른 항목처럼 `reread`다. 설치 SDK 사본이 이 file을 vendor하므로(`packages/core/apps/packages/vendor.ts:87-100`) `items.ts`·`state.ts`에서 지금 shim이 내는 이름(`AcpItem`, `AcpMessageItem`, `AcpToolItem`, `AcpState`, `AcpTurn`, `AcpUpdate`)만 import하고 `session.ts`는 import하지 않는다(`NonNullable<AcpState["session"]>` 같은 indexed type을 쓴다).
7. `packages/protocol/extensions/acp-session.ts`: `GUI_HARNESSES`에 `omp`. `AcpTerminal`(계약 줄). `state()`는 `"shell" | "idle" | "running" | "waiting" | "unknown"`이다: `shell`은 PTY foreground에 harness가 없다(shell prompt), 나머지는 foreground harness의 terminal-agent tracker 상태다(coordinator가 더함). `ExtensionAcp.open`은 옛 `AcpOpenOptions`와 새 `{terminal, harness, title}`을 둘 다 받는다. `ExtensionAcp.onTab({gui(request), tui(terminal)})`를 더하고 `onOpenIntent`는 남긴다(지우기는 `gui-cleanup` 뒤 lead).
8. `adapter.ts`: `HarnessGuiAdapter`에 `handoff`, `exitTui(terminal): Promise<Result<void>>`(그 탭 PTY의 TUI를 깔끔하게 끝내고 foreground가 끝날 때 resolve). `start`의 입력에 `terminal: AcpTerminal | null`(null은 첫 판 창 길. `gui-cleanup` 뒤 lead가 `start` 입력의 null과 `cwd`를 정리한다. CLI의 `LocalContext.cwd`와는 상관없다)을 더하고 결과를 `HarnessGuiRun`으로 바꾼다. 표는 claude·omp `restart`, codex·opencode `shared`이고 `omp`는 `unavailable` stub이다. omp의 경계는 `omp --mode rpc-ui`다(주석에 쓸 때). toggle 흐름을 type 주석에 적는다:
   - restart, GUI → TUI: `run.running()`이 turn이나 task를 말하면 modal → `await run.stop()`(process가 끝날 때까지) → `terminal.type(run.tuiCommand() + "\r")`.
   - restart, TUI → GUI: `terminal.state()`가 `running`·`waiting`이면 modal → `await adapter.exitTui(terminal)` → `start({terminal, resume: terminal.sessionId()})`.
   - shared: `gui`로 시작할 때 `start`가 탭 전용 server와 GUI를 띄운다. GUI → TUI는 `terminal.state()`가 `shell`(PTY에 TUI client가 없다)일 때만 `terminal.type(run.tuiCommand() + "\r")`이고, 그 밖에는 화면만 바꾼다. 그냥 TUI로 시작한 대화를 처음 GUI로 넘길 때는 restart와 같이 `exitTui` 뒤 `start({resume})`(README 정한 것 8).
9. `agent-tab-source.ts`: `act(session, input: AcpInput): Promise<SourceResult<{session?: string}>>`(fork가 새 lophn session을 열면 그 id). `uploadImage`의 결과를 `{block: ContentBlock}`으로 바꾼다. 다른 member와 `external`은 그대로 둔다(wave 2가 뗀다).
10. 넘길 줄(남의 file을 compile되게 최소로): `packages/sdk/agent/acp-types.ts`에 새 칸·갱신·입력을 옮긴다(`agent_test.ts`의 양쪽 대입 검사가 통과해야 한다). `packages/core/main/daemon/wiring/acp-build.ts`의 상태 조립에 `session: null`, `plan: null`, 승인 `choices`(지금 판정 그대로: `once`, always 패턴이 있으면 `always`, `reject`). `acp-send.ts` switch의 새 입력과 `decide`의 `session`은 `unavailable`/`invalid_input`. core source의 `act`는 `acpSend`를 그대로 부르고, fake·gui source의 `act`는 `unavailable`이다. `uploadImage`를 쓰는 `agent-view.tsx` 한 곳과 source 셋. 새 subject `file_change`를 모르는 `packages/shell/renderer/conversation/approval-card/subject-text.ts`·`approval-card.tsx`(경로 한 줄), 새 notice `info`를 turn 끝으로 잘못 읽는 `packages/shell/renderer/conversation/thread-layout.ts:144`(글 한 줄로). `ExtensionAcp`를 쓰는 `packages/shell/main/extensions/registry.ts`·`registry_test.ts`·`packages/shell/main/desktop/wiring/extensions.ts`(새 `open` 꼴과 `onTab`은 `unavailable`/저장만). `HarnessGuiAdapter`를 쓰는 `claude.ts`·`codex.ts`·`opencode.ts`·`index.ts`(`handoff`, `exitTui` stub, `HarnessGuiRun`의 새 member stub).
11. 지운 이름·바꾼 칸은 `grep -rn`으로 주석·오류 문구까지 고친다. `decide` 입력의 `choice`와 `uploadImage` 결과는 문자열로도 grep한다(`choice:`, `.blob`).

등록할 것(lead): `packages/protocol/acp/mod.ts`에 `session.ts` export. 새 union 멤버와 바뀐 type으로 깨지는 남의 file은 최소로 맞추고 "넘길 줄"에 적는다: core `acp-send.ts`의 분배(`unavailable`), core·fake·gui source의 `act`(`unavailable`), `ExtensionAcp`을 쓰는 `packages/shell/main/extensions/registry.ts`·`registry_test.ts`·`packages/shell/main/desktop/wiring/extensions.ts`·`bundled/harness-gui/index.ts`, `HarnessGuiAdapter`를 쓰는 adapter 셋(`claude.ts`, `codex.ts`, `opencode.ts`). 옛 꼴을 쓰는 곳이 wave 2·3에 남으므로, 바로 바꾸기 어려운 곳은 옛것 옆에 새것을 더한다(brief-template "계약 task").

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "`session_changed`·`plan_changed`·`notice_added`를 두 번 접어도 같은 상태이고 `notice_added`의 순번 빈틈은 `reread`다"(`reduce_test.ts`에 지금 꼴의 case를 더한다). `packages/sdk/agent/agent_test.ts`의 정본·사본 대입 검사가 통과한다.
- 남지 않음: 없음(지우는 task가 아니다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 계약 줄과 달라진 칸(model 축, `notice_added`, `act` 결과, `uploadImage` 결과)을 "정한 것"에 적는다. `AcpSend` 출력에 fork의 새 session id를 실으려면 `packages/protocol/acp/routes.ts`가 필요하다(이 task 소유 밖이라 "계약 바꾸기 요청"으로 적는다).
