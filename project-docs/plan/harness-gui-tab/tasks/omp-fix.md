# omp-fix

omp adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-omp.md` §4의 1-10, §2 명령 분류(`opens`), §3 model role이다:

- 명령 출력 블록(`command_output`을 4000자 한 줄 `info` 대신 `format: "preformatted"`로. ANSI만 지운다)
- 도는 중 명령(말없이 버리지 않고 queue에 넣거나 알린다)
- 로컬 명령의 빈 turn(turn 밖 notice로)
- subagent(`subagent_progress`·`subagent_event`를 `child_update`로. 읽기는 `get_subagent_messages`, 멈춤은 `cancel_subagent`, 말 넣기는 `steer_subagent`)
- `get_session_stats`를 usage로
- `!cmd`(`bash`로 보내고 멈춤은 `abort_bash`)
- fast/slow(`toggles`), goal, `new_session`, `/export`
- 승인 mode(`--approval-mode`로 띄우고 `set_mode`는 다시 띄운다)
- TUI 전용 이름 막기
- `abandoned` todo를 `cancelled`로
- role(설정 파일을 읽어 `roles`를 내고, `use_role`을 `/switch @role`로. 정한 것 18: `~/.omp` 설정은 읽기만 하고 쓰지 않는다)
- message `origin`(omp entry id)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-omp.md` 전부(§3 role과 경계), `omp.md`(첫 조사)
  - omp 18.8.7 RPC 문서: `audit-omp.md`가 가리키는 `LAB/docs/rpc.md`, `models.md`, `config-usage.md`
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·turn 없는 notice, subagent detail·`child_update`·`stop_child`·`steer_child`, `toggles`·`set_toggle`, `goal`·`set_goal`, `roles`·`use_role`, `limits`, plan `cancelled`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다)
  - 내놓는 것:
    - adapter 표의 `omp` 칸(이름 그대로)
    - 녹화 script `fixtures/omp/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/omp-v2/`에 쓰고, model은 omp의 가장 싼 model이다(`--model`). scenario는 할 일 14의 목록이다. role 쓰기는 녹화하지 않는다. worker는 돌리지 않고 scenario 목록을 보고한다

## 할 일

약어: `HG/` = `packages/shell/main/extensions/bundled/harness-gui/`, `INST/` = `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/`(설치판 18.8.7, 동작은 이것으로 본다. 읽기만), `LAB/` = `/home/pyosechang/projects/harness-lab/omp/omp-cli/`(18.14.2 문서). 줄 번호는 지금 `HG/omp.ts`의 것이다(acp-more가 맞춘 뒤 조금 밀린다). 화면이 기대하는 모양은 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/ui-reference.md` §2(명령 출력), §4(subagent), §6(background task), §7(role)에 있다.

순서: 1-13은 지금 fixture와 test 안에서 손으로 만든 frame으로 짠다. 14에서 녹화 script를 고치고 **중간 보고**를 한다. lead가 녹화를 돌려 원본 경로를 주면 15를 한다.

1. 명령 목록(`meta()`의 `commands` 464-469, type `Command` 62):
   - `available_commands_update`의 `source`(`INST/slash-commands/available-commands.ts:11`)를 옮긴다: `builtin`→`harness`, `skill`→`skill`, `extension`→`plugin`, `mcp_prompt`→`mcp`, `custom`·`file`→`custom_user`. omp 목록 칸에는 user와 project 구분이 없다.
   - `aliases`는 omp 칸 그대로 쓴다. `Command` type에 `source`와 `aliases`를 더한다.
   - `opens`(audit-omp §2 (1)): `model`→model 고르기, `effort`→effort 고르기, `compact`→compact, `rename`→rename. `opens` 값의 이름은 acp-more가 고정한 것을 쓴다.
   - omp RPC 목록에 없는 TUI 이름 가운데 adapter가 RPC로 하는 것을 더한다(`source: "harness"`):
     - `new`(별칭 `clear`, `opens: null`, adapter가 `new_session`. README 정한 것 16)
     - `fork`(fork)
     - `branch`(별칭 `tree`, rewind)
     - `goal`(`argument_hint` 있음, `opens: null`, 할 일 7)
   - TUI 전용 [T]은 넣지 않는다(RPC 목록에도 원래 없다).
   - meta `harness: "omp"`.
2. 명령 출력과 알림(audit §4-1, §0 S1):
   - `info()`(325)의 4000자 자르기를 없앤다.
   - `command_output` frame(1152)은 acp-more `command_output {command, text, format}` notice로 낸다.
     - ANSI(`ANSI` 148)만 지우고 줄과 공백은 둔다.
     - `format`은 ``` 로 감싼 markdown이면 `markdown`(fixture `command_output.jsonl`의 `/usage`), 그 밖은 `preformatted`(같은 fixture의 `/context` 표)다.
     - `command`는 보낸 명령 이름이다. omp frame에는 이름이 없으니 adapter가 마지막으로 보낸 명령을 기억해 둔다.
   - 알림은 acp-more `info` notice에 `level`을 붙여 낸다. 대상은 `notice` frame(1155), `notify`·`open_url`(733-738), 재시도(1160-1168), compaction(1170-1181), `retry_fallback_applied`(1183)다. warning은 notice level warning·error, 재시도, compaction 실패, fallback이다.
   - turn이 없으면 `turn: null`이다(지금은 `turn ?? lastTurn ?? 새 id`).
3. 명령 보내기(`run_command` 1592, audit §4-2·3·9):
   - 도는 중에 버리지 않는다. 지금은 turn이 있으면 말없이 버린다(1593). 그런데 omp RPC는 도는 중에도 `prompt "/name"`의 skill·builtin을 session의 streaming 검사보다 먼저 처리한다(`INST/modes/rpc/rpc-mode.ts:1783-1830`). 그래서 도는 중이면 `prompt {message, streamingBehavior: "followUp"}`로 보낸다. prompt로 펼쳐지는 명령은 다음 turn에 선다.
   - 로컬 명령에 빈 turn을 만들지 않는다.
     - `ensureTurn()`(1594)를 지운다.
     - 명령용 `prompt`는 `promptTurn`에 묶지 않는다. 그 `prompt_result`가 도는 turn을 끝내지 않게 하려는 것이다.
     - agent turn을 여는 명령(`agentInvoked: true`, 예 `retry`, `compact`, skill)은 `agent_start`(1067)가 turn을 연다.
   - adapter가 하는 이름:
     - `new`/`clear` → `new_session`(`INST/modes/rpc/rpc-mode.ts:868`). cancelled면 info를 낸다. 그 뒤 `readState`로 새 id를 받고, 앞 대화를 `hideFrom`(1438)으로 숨기고, `userIds`를 비운다.
     - `goal`은 할 일 7이다.
   - TUI 전용 이름 막기: `send`(1467)의 글이 `/<name>`이고 name이 18.8.7의 [T] 목록(audit-omp §2 (3). 이 file에 상수로 둔다)에 있으면 omp에 보내지 않고 warning "TUI에서만 된다"를 낸다. omp는 handle이 없는 이름을 model에게 글로 보낸다(`INST/slash-commands/acp-builtins.ts:57-70`). adapter가 하는 [T](`new`, `clear`, `branch`, `tree`, `fork`, `goal`)는 막지 않고 그 동작으로 보낸다.
4. `!cmd`(audit §4-6):
   - `send`에서 글이 `!`로 시작하면 `prompt`가 아니라 `bash {command}`(`INST/modes/rpc/rpc-types.ts:107`)로 보낸다. RPC `prompt`는 `!`을 해석하지 않아서 지금은 model에게 간다.
   - tool 줄 하나(category command, title은 명령)로 그린다.
   - 답 `BashResult`(`INST/exec/bash-executor.ts:99`: `output`, `exitCode`, `cancelled`, `truncated`)로 줄을 끝낸다. cancelled면 cancelled, exitCode가 0이 아니면 error다.
   - 도는 동안의 `stop`은 `abort_bash`다. `bash`는 다른 명령과 같이 돈다(`LAB/docs/rpc.md:218-228`).
   - turn이 없으면 그 줄만의 turn을 열고 닫는다(OpenCode `shellLine`과 같다).
   - 다시 열 때 bash 기록이 `get_messages_page`에 어떻게 오는지(`bashExecution` message, `INST/session/agent-session.ts:3500`)는 녹화로 보고 `replay`(1287)에 넣는다.
5. subagent(audit §4-4, §0 S4):
   - 구독: `set_subagent_subscription`(1282)을 `progress`에서 `events`로 바꾼다. 그러면 lifecycle, progress, event 셋이 다 온다(`INST/modes/rpc/rpc-types.ts:630-639`).
   - 줄: `onSubagent`(987)는 lifecycle마다 따로 tool 줄을 연다. `payload.parentToolCallId`(`INST/modes/rpc/wire/rpc-wire.generated.ts:1045-1056`)가 있으면 그 `task` tool 줄(`calls`)에 붙여 acp-more `subagent` detail로 바꾸고, 없을 때만 지금처럼 따로 연다. 칸은 `agent`, `description`, `child = payload.id`, `state`, `model`, `last`다.
   - 자식 갱신: `subagent_event {id, event}`(`rpc-wire.generated.ts:1071`)의 event(`message_update`, `message_end`, `tool_execution_*`)를 부모와 같은 옮기기로 `child_update {child: id, update}`에 싸서 낸다. 부모 상태(turn, streams, calls, seq)를 쓰는 함수를 자식마다 하나씩 더 만들 수 있게 묶는다. `subagent_progress`로는 `last`(마지막 활동 한 줄)만 채운다.
   - 다시 열 때나 늦게 붙었을 때는 `get_subagent_messages {subagentId}`(`rpc-types.ts:72`)로 자식 대화를 읽는다.
   - 입력: `stop_child` → `cancel_subagent {subagentId}`, `steer_child` → `steer_subagent {subagentId, message}`(`rpc-types.ts:73-74`). capability 둘 다 true다.
   - background task: lifecycle `detached: true`인 subagent는 부모 turn이 끝나도 돈다.
     - 이것을 acp-more `tasks`에 `{id, kind: "agent", description, state, started_at, output: null}`로 두고 `tasks_changed`로 낸다.
     - `stop_task` → `cancel_subagent`. capability `tasks`는 true다.
     - `running().tasks`(1701)는 이 목록에서 도는 것의 수다(acp-more 계약).
     - bash background job은 18.8.7 RPC에 목록이 없어 넣지 않는다. `/jobs`는 글 출력뿐이다.
6. 사용량과 한도(audit §4-5):
   - `refresh()`(509)가 `get_session_stats`(`INST/session/agent-session-types.ts:518-540`)를 같이 읽는다. `usageOf`(387)는 token(`input`, `output`, `cacheRead`, `cacheWrite`)과 `costs: [{kind: "reported", currency: "USD", amount: String(cost)}]`를 채운다.
   - 한도: `get_state.usageLimit`(`rpc-types.ts:175`, 모양 `INST/session/usage-limit.ts:8`)이 있으면 `limits`에 한 줄을 둔다. stage가 이름, `allowanceLeftPercent`가 남은 몫, `resetsAtSec`이 `resets_at`이다. provider별 사용량 표는 `/usage` 명령 출력으로 본다.
   - `context.parts`는 빈 배열이다. 분해는 `/context` 출력에 있다.
   - `State` type(54)에 읽는 칸을 더한다.
7. goal:
   - meta: `get_state.goal`(`GoalModeState | null`, `rpc-types.ts:194`)과 `goal_updated` frame으로 meta `goal: {objective, status, detail}`을 채운다. `Goal`은 `objective`, `status`, `tokensUsed`, `tokenBudget`을 가진다(`~/.bun/install/global/node_modules/@oh-my-pi/pi-tui/src/tools/goal.ts:16-25`). `detail`은 token 사용 글이다.
   - 입력: `set_goal {objective, paused}` → `goal {op}`(`INST/modes/rpc/rpc-goal.ts:21-27`).
     - goal이 없고 objective가 있으면 `create`
     - objective가 null이면 `drop`
     - paused가 true면 `pause`, false면 `resume`
   - `/goal <글>`과 `/goal pause|resume|drop`도 같은 길로 간다. capability `goal`은 true다.
8. 켜고 끄기(audit §4-7):
   - `get_state`의 `fastModeEnabled`, `slowModeSupported`, `slowModeEnabled`, `slowModeScope`(`rpc-types.ts:163-173`)로 meta `toggles`를 채운다.
   - `fast`는 늘 낸다. 못 쓰는 model이면 `set_fast_mode`가 오류로 답하니 warning을 낸다.
   - `slow`는 `slowModeSupported && slowModeScope === "session"`일 때만 낸다. `global`이면 omp가 사람 설정 file에 쓴다(`rpc-types.ts:169-172`). 사람의 전역 harness 설정을 바꾸는 GUI 동작은 두지 않는다.
   - `set_toggle` → `set_fast_mode {enabled}` 또는 `set_slow_mode {enabled}`, 그 뒤 `readState`. capability `toggles`는 true다.
   - `/fast`·`/slow` 명령은 CLI로 가고, 그 뒤 `refresh()`가 toggle을 맞춘다.
9. role(README 정한 것 18, audit §3):
   - 읽기: `~/.omp/agent/config.yml`과 `<cwd>/.omp/config.yml`의 `modelRoles`를 읽는다(`LAB/docs/config-usage.md:179`, 190). 같은 role이면 project가 덮는다.
     - `OmpIo`(25)에 `home: string`을 더한다(`ompAdapter`는 `os.homedir()`).
     - 읽기는 `io.readFile`이고 parse는 `yaml` 2.9.1이다. root와 core가 이미 이 판으로 고정했다. `packages/shell/main/package.json`에 넣는 것은 lead가 한다(등록할 것).
     - file이 없거나 못 읽으면 `roles: []`다. 시작할 때 한 번 읽는다.
   - meta `roles: [{id, label, kind, model}]`:
     - id는 role 이름이다.
     - kind는 `image`, `web`, `speech`, `dictation`, `judge`면 `model`, 나머지는 `chat`이다(`LAB/docs/models.md:694-712`).
     - model은 설정 값(`provider/id:level`) 그대로다.
   - `use_role {role}` → `prompt "/switch @<role>"`(builtin이고 이 session만이다, `INST/slash-commands/builtin-modes.ts:497-520`) 뒤 `refresh()`. `kind: "model"` role은 받지 않는다. 대화 model이 아니다.
   - 설정 file에 쓰는 길은 두지 않는다. `OmpIo`에 쓰기 함수를 더하지 않는다. capability `roles`는 true다.
10. 승인 mode(audit §4-8, README 정한 것 7):
    - modes는 `always-ask`, `write`, `yolo`다(`INST/tools/approval.ts:17`, 설명은 `INST/tools/settings.ts:305-325`). 지금 값은 할 일 9가 같이 읽는 config의 `tools.approvalMode`이고, 없으면 `yolo`다. capability `mode`는 true다.
    - `set_mode`(1673)는 turn이 없을 때만 한다(`idleOnly` 1414). 이 process를 `run.stop()`과 같은 길로 끄고, 같은 session을 `--resume=<cliSession> --approval-mode=<mode>`로 다시 띄운다.
      - ACP 상태(`acp`)는 그대로 두고 앞 대화를 다시 그리지 않는다(`get_messages_page`를 하지 않는다).
      - spawn, `negotiate_protocol`, 구독(252-1282)을 다시 부를 수 있는 함수로 묶는다.
      - 다시 띄우는 동안 온 입력은 기다렸다가 준다.
    - 시작할 때는 `--approval-mode`를 넘기지 않는다(사람 설정, 1-3줄 주석). 이 run에서 바꾼 뒤에만 넘긴다.
    - `tuiCommand`(1698)는 바꾼 mode가 있으면 `--approval-mode=<mode>`를 싣는다.
11. todo: `abandoned`(494)를 `completed`로 접지 않고 acp-more `cancelled`로 낸다.
12. tool 본문: acp-more의 tool `body`를 채운다.
    - input은 `tool_execution_start.args`를 JSON으로, output은 `tool_execution_end.result.content`의 글이다(`onToolEnd` 603이 이미 모은다).
    - 다시 열 때는 assistant `toolCall.arguments`와 `toolResult` message 글을 쓴다(`replay` 1287).
    - 길이 상한은 acp-more가 정한 값이다.
13. message `origin`:
    - omp RPC는 message에 entry id를 주지 않는다. `messageId`는 process마다 새로 만든다(`LAB/docs/rpc.md:921`). entry id는 `get_entries`(`entryOf` 1421)로만 알아서, live message에는 늦다.
    - 그래서 사람 메시지의 origin은 그 session의 사람 entry 순번 `user:<n>`이다. `entryOf`가 rewind·fork에 쓰는 셈(`userIds`, 합성·agent entry는 세지 않는다)과 같아서, 같은 session file을 다시 열면(toggle, resume) 같은 값이 나온다.
    - 답의 origin은 null이다. bookmark는 사람 메시지에 단다(README 정한 것 17).
    - branch·fork·new 뒤에는 session id가 바뀌어 bookmark의 session key도 바뀐다.
14. 녹화 script `fixtures/omp/record.ts`(README 정한 것 13·19):
    - 출력: `OUT = join(ROOT, ".dev-data", "adapter-omp")`(38)를 `--out <dir>` 인자로 바꾼다. 없으면 쓰는 법을 찍고 끝낸다. lead가 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/omp-v2/`를 준다(worktree는 merge 뒤 지워진다). session은 `<out>/sessions/`에 둔다(`--session-dir` 254·575는 그대로). 사람의 `~/.omp`에 session을 쌓지 않는다.
    - scenario cwd(`workdir` 233)는 `os.tmpdir()` 아래 `mkdtemp` 폴더로 하고, 끝나면 지운다. lophn checkout 안이면 omp가 위 폴더의 AGENTS.md를 context로 읽을 수 있다.
    - model: `--model`(43)로 lead가 omp의 가장 싼 model을 준다.
    - 비용과 사람 설정을 지킨다:
      - `/switch @smol` 뒤에는 prompt를 보내지 않는다. role model은 사람 설정이라 비쌀 수 있다.
      - `set_fast_mode` on 뒤에도 prompt를 보내지 않는다. priority tier는 비싸다.
      - `set_slow_mode`는 `get_state.slowModeScope`가 `session`일 때만 보낸다.
      - role과 approval 설정 file은 쓰지 않는다.
      - 승인은 Approve와 Deny만 보낸다. 18.8.7에는 영구 규칙도 session 선택도 없다.
      - subagent는 omp의 `task` role model로 돈다. lead가 그 값을 먼저 본다.
    - 새 scenario(이름이 곧 fixture file 이름):
      - `todo`: `/todo` 출력과 todo tool 한 번. abandoned가 나오면 좋다.
      - `stats`: `/stats`, `/session`, `get_session_stats`.
      - `command_during_turn`: 긴 답 도중 `prompt "/context"`를 `streamingBehavior: "followUp"`으로 보낸다.
      - `subagent_events`: `events` 구독, `get_subagents`, `get_subagent_messages`, `steer_subagent`. detached subagent 하나와 그 `cancel_subagent`.
      - `goal`: `goal create` → `goal pause` → `goal drop`, 그 사이의 `goal_updated`.
      - `fast`: `set_fast_mode` on/off. 안 되는 model이면 그 오류.
      - `bash`: `bash "ls"`, `bash "sleep 30"` 뒤 `abort_bash`, 그 뒤 resume해 `get_messages_page`의 bash 기록.
      - `switch_role`: `/switch @smol`과 `model_changed`.
      - `new_session`: `new_session`과 그 뒤 `get_state`.
      - `export`: `/export` 출력(경로). `export_html` RPC는 쓰지 않는다. `/export`가 같은 일을 하고 경로를 `command_output`으로 준다(audit §2).
    - 승인 mode는 지금 `approval` scenario(319)가 이미 `--approval-mode=write`로 띄우니 따로 녹화하지 않는다. 지금 열네 scenario는 그대로 둔다.
    - 여기까지 하고 **중간 보고**를 한다: scenario 목록과 돌리는 명령 한 줄.
15. fixture와 test:
    - lead가 준 원본에서 test에 필요한 줄만 `fixtures/omp/<scenario>.jsonl`로 옮긴다. 원본은 commit하지 않는다.
    - scrub은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 "Scrub" 절을 따른다. scratch 경로 → `/work/<scenario>`, `/home/pyosechang` → `/home/user`. `/switch`·`/session`·`/usage` 출력의 사람 model·계정 줄은 test가 읽는 것만 남긴다.
    - role test의 config.yml은 손으로 쓴 작은 것이다. 사람의 file을 fixture로 옮기지 않는다.

하지 않는 것(이유):

- plan 승인 카드: 18.8.7 RPC에 plan mode가 없다. `/plan`은 [T]이고 `exit_plan_mode`는 `INST/modes/interactive-mode.ts`에만 있다. plan subject를 내지 않고, `/plan`은 할 일 3대로 막는다.
- `/btw`, `abort_retry`, role 값 쓰기(정한 것 18)는 하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`omp_test.ts`):
  - "`!ls`를 보내면 `bash {command: "ls"}`만 나가고 `prompt`는 나가지 않는다"
  - "`use_role`은 `prompt "/switch @<role>"`만 보낸다. `slowModeScope`가 `global`이면 slow toggle을 내지 않고, `set_toggle`이 와도 `set_slow_mode`를 보내지 않는다". 사람의 전역 omp 설정을 바꾸지 않는다(정한 것 18).
  - "도는 turn 중 `run_command`는 버려지지 않고 `prompt`(`streamingBehavior: "followUp"`)로 간다. 그 `command_output`은 turn 밖 notice이고 도는 turn을 끝내지 않는다". 사람이 찾은 "명령이 아무것도 안 한다"를 두 번째로 고치는 것이다.
- 남지 않음:
  - `grep -n 'slice(0, 4000)\|source: "cli"' packages/shell/main/extensions/bundled/harness-gui/omp.ts`가 0줄이다.
  - `grep -n '".dev-data", "adapter-omp"' packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/record.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 할 일 14 뒤의 중간 보고에는 scenario 목록과 돌리는 명령만 쓴다. 등록할 것에 `packages/shell/main/package.json`의 `yaml` 2.9.1을 적는다.

