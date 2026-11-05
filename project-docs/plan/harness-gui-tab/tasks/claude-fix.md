# claude-fix

Claude adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-claude.md` §4 adapter 1-11과 §5.4 A-F다:

- 명령 분류(내장 고정 목록에 `source: "harness"`와 `opens`, skill·plugin·MCP·custom 출처, SDK `aliases`, TUI 전용 숨김)
- 명령 출력(`SDKLocalCommandOutputMessage`를 `command_output`으로, turn이 없을 때 버리지 않기, `/usage`·`/cost`는 adapter가 답, `/context`는 `getContextUsage`를 `usage.context.parts`로)
- subagent(`parent_tool_use_id` 메시지를 Agent tool call id를 `child`로 하는 `child_update`로)
- todo(TodoWrite를 `plan_changed`로)
- background task와 멈추기(`background_tasks_changed`를 `tasks_changed`로, `stop_task`를 `stopTask`로)
- `/clear`(같은 탭에서 resume 없는 새 query)
- 사용 한도(`rate_limit_event`)
- 알림(`system/informational` 등을 `info`로)
- message `origin`(SDK uuid)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-claude.md` 전부(§1 원인, §2 기능표, §4, §5 명령 분류와 §5.4), `claude.md`(첫 조사)
  - SDK type: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `sdk-tools.d.ts`
  - 앞 녹화 원본: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/`(README의 scrub 규칙)
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·`info.level`·turn 없는 notice, subagent detail·`child_update`·`stop_child`, `tasks`·`tasks_changed`·`stop_task`, `limits`·`context.parts`, `toggles`·`set_toggle`, `goal`·`set_goal`, plan `cancelled`, tool `body`, plan 승인 subject와 `decide {kind: "mode"}`, `tool_detail_changed`, `origin_set`, meta `harness`, message `origin`. subagent가 tool 줄과 agent task 둘로 다 오면 하나만 낸다(dock의 Running card가 둘을 겹쳐 보이지 않게). `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다). Agent SDK 0.3.318
  - 내놓는 것:
    - adapter 표의 `claude` 칸(이름 그대로)
    - 녹화 script `fixtures/claude/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/claude-v2/`에 쓰고, model은 haiku다. worker는 돌리지 않고 scenario 목록을 보고한다

## 할 일

줄여 쓴 path: `CL` = `packages/shell/main/extensions/bundled/harness-gui/claude.ts`, `SDK` = `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `TOOLS` = 같은 폴더의 `sdk-tools.d.ts`, 점검 보고 `audit-claude.md` = `AC`. acp-more가 고정한 이름·꼴(`opens` 값, 상한, decide의 mode 칸 등)을 그대로 쓴다. 꼴이 모자라면 고치지 말고 "계약 바꾸기 요청"으로 보고한다.

1. 명령 목록(`publishCommands`, `CL:556-567`. 근거 `AC` §5.3, §5.4 A·E, README 정한 것 16):
   - SDK 줄: `builtin === true`면 `source: "harness"`다. 아니면 SDK가 출처를 주지 않으므로 `system/init`의 `plugins`·`skills` 목록과 이름 꼴(`<plugin>:<name>`, `mcp__<server>__<prompt>`)로 `plugin`·`mcp`·`skill`을 가르고, 남은 것은 `custom_user`다(user·project를 가를 단서가 없다. 정한 것으로 보고). `aliases`는 SDK `aliases ?? []`, `opens`는 null이다. `SdkMessage`(`CL:72-118`)에 init의 `skills`·`plugins`를 더한다.
   - 숨김: `terminalCommands`(이미 뺀다)에 더해 이름 목록 `__remote-workflow`, `workflow-launch-exec`, `heapdump`, `design-consent`, `design-revoke`, `agents`, `ultrareview`, `login`(`AC` §5.3 (3)). 화면 동작이 대신하는 CLI 줄 `model`, `effort`, `fast`, `rename`, `context`, `usage`, `cost`, `stats`, `clear`도 뺀다(데스크톱의 `hidesCliRow`).
   - adapter가 직접 내는 화면 동작 줄(`source: "harness"`, 알맞은 `opens`): `model`(model picker), `effort`(effort 축), `permissions`(mode), `plan`(plan mode), `rename`, `rewind`, `fork`, `status`, `usage`(`aliases: ["cost", "stats"]`), `context`. SDK 목록에 없는 TUI 명령(`permissions`, `plan`, `rewind`, `status`)도 데스크톱처럼 여기서 낸다(`AC` §5.3 (1)).
   - adapter가 받는 줄(`opens: null`): `clear`(`aliases: ["reset", "new"]`, 할 일 7)와 SDK 줄 그대로인 `compact`(인자 `[instructions]`이 있어 CLI로 보낸다). 나머지 SDK 줄은 지금처럼 `run_command` → `sendCommand`로 사람 말풍선과 함께 CLI에 간다.
2. 명령 출력과 알림(`AC` §1, §5.1-5.2, §4 adapter 1·8):
   - `info()`(`CL:641-653`)가 turn이 없을 때 버리는 줄을 지우고 `turn: null` notice를 낸다. level(`info`·`warning`)을 받는다.
   - local 명령 출력 셋을 `command_output {command, text, format: "markdown"}`으로 바꾼다: `onAssistant`의 `local_command_run`(`CL:898-903`, command는 `local_command_run.command`), `onMessage`의 user replay `<local-command-stdout>`(`CL:1110-1120`. `<local-command-stderr>`는 warning `info`), `onSystem`의 `local_command_output`(`CL:1067-1069`). 뒤 둘은 명령 이름이 없으니 마지막 `run_command`의 이름을 기억해 쓴다.
   - compaction·`api_retry`·`permission_denied`·task 알림은 `info` 그대로 두고, `compact_result: "failed"`·`api_retry`·`permission_denied`는 warning이다.
   - 버리던 `system/informational`(level), `system/notification`(text), `system/model_refusal_fallback`, `system/hook_response`(실패만)를 `info`로 낸다. `SdkMessage`에 칸을 더한다(이름은 `SDK`에서 확인).
   - `/context`: `refreshContext`(`CL:586-595`)가 `getContextUsage({detail: "full"})`을 읽어 categories를 `usage.context.parts`(label, tokens)로 옮긴다. row 분류(used, free, buffer, deferred)는 `SDK:4110` 주석대로 kind 칸으로 가르고 이름으로 가르지 않는다.
   - `/usage`는 CLI에 보내지 않는다. SDK mode에서 답이 오지 않는다(`AC` §1). 화면이 `opens`로 그리고 adapter는 `usageNow()`(`CL:568-585`)의 합계·`costs`와 할 일 3의 `limits`만 채운다.
3. 사용 한도와 goal:
   - `rate_limit_event`(`CL:1124-1129`)를 늘 `usage.limits`에 넣는다: `{id: rateLimitType ?? "default", label: 그 창 이름(five_hour → 5h, seven_day → 7d 등), used_percent: utilization, left: null, resets_at: resetsAt의 ISO}`(`SDKRateLimitInfo`, `SDK:5972`). utilization이 0-1인지 0-100인지, resetsAt이 초인지는 녹화로 본다. status가 `allowed`가 아니면 지금처럼 warning `info`도 낸다.
   - goal: `active_goal` 메시지(`SDKActiveGoalMessage`, `SDK:3699`)를 `onMessage` switch에 더한다. value를 meta `goal {objective: condition, status: "active", detail: iterations와 last_reason}`으로, null이면 goal null로 낸다. `set_goal {objective}`는 `/goal <objective>`를 보이지 않는 명령으로 보낸다(`setEffort`의 `silent`, `CL:1408-1413`). 지우기(objective null)와 멈추기(paused)는 녹화로 CLI의 말을 보고, 없으면 그 입력에 "이 CLI는 안 된다" info를 낸다. capability `goal`.
4. todo(`AC` §1, §4 adapter 2):
   - TodoWrite tool_use `input.todos`(`TodoWriteInput`, `TOOLS:1089`)를 `plan_changed`로 낸다. entry text는 `in_progress`면 `activeForm`, 아니면 `content`다(꼴은 `codex.ts:1262-1271`과 같다).
   - CLI가 Task tool(`TaskCreate`·`TaskUpdate`, `TOOLS:2793-2859`)을 쓰면 taskId별 목록을 두고 create(결과 `task.id`)와 update(status, `deleted`면 뺀다)로 고쳐 `plan_changed`를 낸다. claude 2.1.318이 SDK에서 어느 쪽을 쓰는지 녹화(`todo`)로 보고 쓰는 쪽만 짠다.
   - 그 tool 줄은 내지 않는다(데스크톱과 같다. todo는 dock이 그린다). `toolStart`(`CL:656-683`)에서 거른다.
   - `replay`(`CL:1143-1179`)도 같은 길을 타서 resume하면 마지막 목록이 되살아난다. Claude에는 `cancelled`가 없다.
5. subagent(`AC` §1 subagent 행, §4 adapter 3):
   - `Agent` tool_use(`AgentInput`, `TOOLS:763`)의 detail은 `{kind: "subagent", agent: subagent_type ?? "general-purpose", description, child, state: "running", model: input.model ?? null, last: null}`이다. `detailOf`(`CL:295-314`)가 만든다. `child`는 그 tool_use id로 만든 key다(task 알림이 `tool_use_id`를 싣는다).
   - `onMessage`의 `if (message.parent_tool_use_id) return;`(`CL:1101-1103`)과 `replay`의 같은 줄(`CL:1146`)을 지우고 그 메시지를 자식 대화로 낸다. 지금 root 대화의 상태(`turn`, `seq`, `calls`, `reasoning`, `streamed`, `modelCall`)를 lane 하나로 묶고 Agent tool_use id마다 child lane을 둔다. child lane의 publish는 `child_update {child, update}`로 싼다. `onAssistant`·`onToolResults`·`onStream`·`toolStart`·`toolEnd`·`addUser`가 lane을 받게 바꾼다. 자식의 승인·질문(`canUseTool`)은 root에 카드로 낸다(사람이 답한다).
   - task 알림으로 detail을 고친다: `task_started`(task_id ↔ tool_use_id), `task_progress`(`last_tool_name`·`summary` → `last`), `task_updated`(`patch.status`), `task_notification`(status, summary). completed는 done, failed는 failed, stopped·killed는 cancelled다(`SDK:6401-6540`). 시작 detail은 `tool_started`, 끝 detail은 `tool_ended`에 싣는다. background agent(`run_in_background`)는 tool_result가 먼저 와서 `tool_ended` 뒤에 상태가 바뀐다. acp-more에 끝난 tool의 detail을 바꾸는 갱신이 없으면 보고한다.
   - 끝난 뒤 흐르지 않은 글은 `getSubagentMessages(cliSession, task_id, {dir: cwd})`(`SDK:973`)로 읽어 child lane에 채운다. 이미 낸 uuid는 건너뛴다. `ClaudeSdk`(`CL:52-58`)와 `claudeAdapter`(`CL:1749-1755`)에 `getSubagentMessages`를 더한다.
   - `stop_child {child}`는 그 child의 task_id로 `live.q.stopTask`를 부른다. capability는 `stop_child` true, `steer_child` false다(SDK에 host가 도는 subagent에 말을 넣는 호출이 없다).
6. background task(`AC` §4 adapter 9):
   - `background_tasks_changed`(`CL:1084-1087`)의 목록(`SDK:3840`)을 `tasks_changed`로 낸다: `{id: task_id, kind: task_type이 shell 계열이면 shell, agent 계열이면 agent, 그 밖은 other, description, state: "running", started_at: 처음 본 시각, output: null}`. task_type 값은 녹화로 본다. 지금 `tasks` Set(`CL:530`)은 이 목록으로 바꾼다.
   - `task_notification`의 status(completed·failed·stopped)와 summary로 끝난 task를 done·failed·stopped로 남긴다(목록에서 빠져도 끝난 것으로 보인다).
   - `stop_task {task}`는 `live.q.stopTask(task)`(`SDK:3344`)다. capability `tasks`.
   - `running()`(`CL:1724`)의 `tasks`는 도는 것의 수다. rewind·fork·clear가 query를 다시 열면(`retire`·`reopen`, `CL:1275-1295`) process와 함께 task가 끝나므로 도는 것을 stopped로 바꾼다.
7. `/clear`(`AC` §5.4 D): `run_command`의 name이 `clear`면 CLI에 보내지 않는다. `fork`(`CL:1530-1552`)처럼 `retire()`하고, 첫 항목부터 `hideFrom`으로 접고, `reopen(old, {sessionId: uuidOf(ids)})`로 resume 없이 연다. 합계·cost·title·plan(`plan_changed` 빈 목록)·goal·tasks·자식 lane을 비운다. 빈 새 session을 `tuiCommand`(`CL:1696-1720`)의 `--resume`이 받지 못하면(녹화 `clear_resume`) 첫 메시지 전에는 `--session-id`로 연다.
8. 승인 subject와 plan 카드(`AC` §2 승인 subject·plan 승인 행, §4 adapter 4):
   - `subjectOf`(`CL:341-370`): Edit·Write·MultiEdit·NotebookEdit는 `file_change`다. path는 cwd 기준, 줄 수는 `detailOf`의 셈과 같다. Write는 `create`로 두고 덮어쓰기를 가르지 않는다(정한 것으로 보고).
   - ExitPlanMode는 `{kind: "plan", plan: input.plan(markdown), modes}`다. modes는 `MODES`(`CL:141-146`)에서 plan을 뺀 default·acceptEdits·auto다. `closeApproval`(`CL:725-772`)의 plan 분기는 `decide`가 실은 mode로 `setMode`를 만들고 destination은 `session`뿐이다. mode가 없으면 default다. "계속 plan"은 reject다(지금과 같다).
9. tool 본문: `toolStart`가 `body.input`(입력 JSON을 줄 맞춘 글)을, `onToolResults`(`CL:933-945`)가 tool_result content(글 block을 이은 것)를 `body.output`으로 싣는다. 시작과 끝에 싣는 길과 한 쪽 상한은 acp-more대로다(상한이 없으면 `packages/protocol/lophn-agent/turn-reads.ts:140` `TURN_BODY_VIEW_MAX_BYTES`). `Block`(`CL:62-71`)에 tool_result `content`를 더한다.
10. fast·thinking(`AC` §4 adapter 7): `ModelInfo.supportsFastMode`인 model이면 toggle `fast`를 내고 `set_toggle`은 `live.q.applyFlagSettings({fastMode})`다(init `fast_mode_state`가 처음 값). `supportsAdaptiveThinking`이면 toggle `thinking`을 내고 `setMaxThinkingTokens`(`SDK` Query)를 부른다. 둘 다 `carry`(`CL:510-523`)에 넣어 `open()`(`CL:1184-1264`)이 다시 넘긴다. TUI로 넘길 flag가 없으면 넘기지 않고 보고한다. capability `toggles`.
11. session 제목(`AC` §4 adapter 10): 시작·resume과 첫 turn 끝에 `getSessionInfo(cliSession, {dir: cwd})`(`SDK:906`)로 제목을 읽어 `session_changed {title}`를 낸다. `ClaudeSdk`에 더한다.
12. meta와 origin: 처음 `changed({...})`(`CL:1306-1316`)에 `harness: "claude"`를 넣는다. message `origin`은 SDK uuid다. 사람 메시지는 `addUser`의 uuid(줄에 섰던 것은 `onStarted`의 uuid), assistant는 `message.uuid`, replay는 transcript의 uuid라 resume해도 같다. 줄→가져감(`message_taken`)과 `message_recorded`에 origin을 싣는 칸은 acp-more 꼴대로 쓴다. 없으면 보고한다.
13. 녹화(`AC` §4 adapter 11, §5.4 F): `fixtures/claude/record.ts`를 고친다.
    - 출력 폴더는 `RECORD_OUT`을 꼭 받는다(없으면 멈춘다. worktree 안 `.dev-data`는 merge 때 지워진다). lead는 `RECORD_OUT=/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/claude-v2`로 돈다. model은 haiku다(지금 기본).
    - scenario를 더하거나 고친다:
      - `todo`: todo 목록을 만들고 하나씩 끝내게 한다. TodoWrite인지 Task tool인지 본다.
      - `subagent`: foreground Agent. 자식 assistant·tool 메시지가 `parent_tool_use_id`와 흐르는지, task_* 순서, 끝난 뒤 `getSubagentMessages`·`listSubagents` 결과를 본다.
      - `subagent_background`: `run_in_background` Agent를 `stopTask`로 끈다.
      - `background_task`: 있는 (f) 그대로 둔다(task_type 값, stopTask 뒤 task_notification).
      - `commands`: 지금 `context_command`를 넓힌다. `/context`의 `local_command_run`과 `context_usage`, `/usage`(30초 기다림), 인자 없는 `/effort`·`/model`, `/config`, `/mcp`, `/recap`, `/goal <조건>`과 `active_goal`, goal을 지우는 말. 출력마다 `AC` §5.2 셋 중 어느 꼴인지 남긴다.
      - `plan_exit`: 있는 (c). `input.plan` 글과 고른 mode의 결과를 본다.
      - `fast`: `supportedModels`의 `supportsFastMode`, `applyFlagSettings({fastMode})`.
      - `clear_resume`: 메시지 없는 새 sessionId를 `claude -p --resume <id>`가 받는지 본다(`print_handoff`가 본보기).
      - `origin`: push한 uuid와 `getSessionMessages`의 uuid가 같은지 본다.
      - `edit_approval`: Edit·MultiEdit·Write의 canUseTool 입력.
    - 지키는 것: 승인 답은 `allowOnce`·`allowSession`(destination session)과 plan의 session `setMode`뿐이다. `updateSettings`·`toggleMcpServer`·`setMcpServers`·`reloadPlugins`는 부르지 않는다. 사람의 `~/.claude` 설정을 고치지 않는다.
    - worker는 녹화를 돌리지 않는다. 보고에 scenario 이름과 각각이 확인할 것을 적는다. lead가 원본 경로를 건네면 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 "Scrub"대로 test가 쓰는 줄만 `fixtures/claude/`에 옮긴다. 원본이 오기 전에는 `SDK`·`TOOLS` type과 첫 판 녹화(`.cache/harness-gui-recordings/claude/subagent.jsonl`, `text.jsonl`)로 짜고, 녹화로 확인할 곳을 보고에 적는다.
14. `claude_test.ts`: 가짜 SDK에 `getSubagentMessages`·`getSessionInfo`를 더하고 아래 위험 test를 쓴다. 출처 이름·`opens` 표·출력 꼴은 test하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "plan 카드에서 어느 mode를 골라도 SDK에 가는 `updatedPermissions`는 `destination: "session"`인 `setMode` 하나뿐이다"(사람 설정 file에 쓰지 않는다. 있는 "'이 session 동안' 허락" test 옆).
  - "resume으로 다시 그린 사람 메시지의 `origin`은 처음 보낼 때 단 uuid와 같다"(녹화 `origin`. key가 바뀌면 사람의 bookmark를 잃는다).
- 남지 않음: `grep -nE 'parent_tool_use_id\) (return|continue)|ExitPlanMode: ' packages/shell/main/extensions/bundled/harness-gui/claude.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 더해서 녹화 scenario 목록(이름, 확인할 것), 녹화로 확인할 곳, acp-more 꼴이 모자란 곳.
