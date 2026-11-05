# codex-fix

Codex adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-codex.md` §3의 1-9와 §2 명령 분류다:

- 명령 분류(`model`, `permissions`, `usage`, `agents`, `mcp`, `diff`, `ps`, `stop`, `init`, `clear`를 더하고 `opens`를 단다. TUI 전용은 넣지 않는다)
- 명령 출력(`/status`, `/mcp`, `/ps`, `/diff`, `/usage`를 `command_output`으로)
- `/review` 글(`exitedReviewMode.review`)
- subagent(자식 thread item을 `child_update`로, collab·`subAgentActivity`를 subagent detail로, 멈추기)
- plan mode 상태(`toggles`), goal(get/clear, `thread/goal/updated`, `set_goal`)
- 사용 한도(`account/rateLimits/read`·`updated`를 `limits`로)
- `imageGeneration` item
- elicitation·권한 요청을 사람에게 보이기
- 경고 notification(`warning`, `configWarning`, `model/rerouted`)을 `info`의 `level: "warning"`으로
- message `origin`(Codex item id)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-codex.md` 전부(§0-3, "ACP에 더할 것", "adapter·화면에서 고칠 것"), `codex.md`(첫 조사)
  - 앞 녹화 원본: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/codex/`와 README의 scrub 규칙
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·`info.level`·turn 없는 notice, subagent detail·`child_update`·`stop_child`·`steer_child`, `tasks`·`tasks_changed`·`stop_task`, `limits`, `toggles`·`set_toggle`, `goal`·`set_goal`, tool `body`, plan 승인 subject와 `decide {kind: "mode"}`, `tool_detail_changed`, `origin_set`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다)
  - 내놓는 것:
    - adapter 표의 `codex` 칸(이름 그대로)
    - 녹화 script `fixtures/codex/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/codex-v2/`에 쓰고, model은 Codex의 가장 싼 model이다. scenario는 할 일 14의 목록이다(review, compact, goal, plan, collab, rate_limits, background, mcp_status, origin, permissions). worker는 돌리지 않고 scenario 목록을 보고한다

## 할 일

줄여 쓴 path: `CX` = `packages/shell/main/extensions/bundled/harness-gui/codex.ts`, `TS` = `/home/pyosechang/projects/lophn/.cache/harness-gui-research/codex-ts-exp/v2/`(설치판 0.166.0의 `--experimental` type), `CR` = `/home/pyosechang/projects/harness-lab/codex/codex-cli/codex-rs/`, 점검 보고 `audit-codex.md` = `AX`. acp-more가 고정한 이름·꼴(`opens` 값, 상한, decide의 mode 칸 등)을 그대로 쓴다. 꼴이 모자라면 고치지 말고 "계약 바꾸기 요청"으로 보고한다.

1. 명령 목록(`BASE_COMMANDS`, `CX:354-362`, `commandsMeta`, `CX:594-621`. 근거 `AX` §2, README 정한 것 16):
   - 모든 줄의 source는 `"harness"`(skill은 `"skill"`)다. `aliases`와 `opens`를 단다.
   - 화면 동작 줄(알맞은 `opens`): `model`(model picker), `permissions`(mode), `status`, `usage`, `rename`, `fork`. 화면이 `opens`로 처리하므로 `runCommand`(`CX:1573-1663`)의 `rename`·`fork`·`status` case는 지운다(`status`의 한 줄 info, `CX:1632-1645`).
   - adapter가 받는 줄(`opens: null`): `compact`, `review [instructions]`, `goal [objective]`, `plan`(`canPlan`일 때), `new`(`aliases: ["clear"]`), `init`, `mcp`, `diff`, `ps`, `stop`.
   - `agents`: acp-more의 `opens`에 subagent 보기 값이 있으면 그 값으로 넣고, 없으면 넣지 않는다(dock이 subagent를 보인다).
   - TUI 전용(`AX` §2 (3))과 `/copy`, `/side`·`/btw`, `/mention`, `/auto-review`는 넣지 않는다.
   - `/init`: TUI 내장 글 `CR/tui/assets/prompt_for_init_command.md`(1836 byte)를 출처 주석과 함께 상수로 옮기고, 사람 메시지 turn으로 보낸다(TUI `CR/tui/src/chatwidget/slash_dispatch.rs:323-326`과 같다).
2. 명령 출력(`command_output`, `AX` §2 (1)):
   - `mcp`: `mcpServerStatus/list`(`TS/ListMcpServerStatusResponse.ts`). server마다 이름·상태·tool 수를 markdown으로 낸다.
   - `ps`: `thread/backgroundTerminals/list {threadId}`(`TS/ThreadBackgroundTerminal.ts`). command·cwd·pid를 낸다. 같은 값으로 할 일 5의 `tasks_changed`도 낸다.
   - `stop`: `thread/backgroundTerminals/clean {threadId}`. 결과 한 줄이다.
   - `diff`: `spawn("git", ["diff"], {cwd})`와 `git status --porcelain`의 untracked 이름을 preformatted로 낸다. git 폴더가 아니면 TUI처럼 한 줄이다(`CR/tui/src/chatwidget/slash_dispatch.rs:498-520`).
   - `goal` 인자 없음: 지금 goal을 한 줄로 낸다.
   - `info()`(`CX:624-637`)는 turn 밖이면 `lastTurn`을 지어 붙이지 않고 `turn: null`로 낸다. level(`info`·`warning`)을 받는다.
3. `/review`(`AX` §3.1): `itemDone`(`CX:813-834`)의 `exitedReviewMode`를 `record(item.review)`(assistant message, markdown)로 바꾼다. `enteredReviewMode`는 info 그대로다. 인자가 없으면 uncommitted다(지금과 같다).
4. subagent(`AX` §1 subagent 행, §3.2-3):
   - `collabAgentToolCall`이 `tool: "spawnAgent"`면 detail은 `{kind: "subagent", agent, description: prompt, child: receiverThreadIds[0], state, model, last: agentsStates[child]?.message ?? null}`이다. agent 이름은 `subAgentActivity.agentPath`가 오면 그것이다. state는 `CollabAgentStatus`를 옮긴다: pendingInit·running → running, completed → done, errored·notFound → failed, interrupted·shutdown → cancelled. 만드는 곳은 `describe`(`CX:675-742`)다.
   - 다른 collab tool(`wait`, `sendInput`, `closeAgent` …)과 `subAgentActivity`는 generic 줄 그대로 두되, 그 `agentsStates`로 spawn 줄의 상태를 고친다. acp-more에 끝난 tool의 detail을 바꾸는 갱신이 없으면 보고한다.
   - 자식 thread 이벤트: `onNotification`(`CX:1209-1212`)이 다른 thread를 버린다. 아는 자식 thread(`receiverThreadIds`, `agentThreadId`)면 child lane으로 보낸다. root 대화의 상태(`turn`, `codexTurn`, `seq`, `calls`, `streamed`, `reasoning`, `modelCall`)를 lane 하나로 묶고, child lane의 publish는 `child_update {child, update}`로 싼다. `toolStart`·`toolEnd`·`record`·`stream`·`itemDone`·`onUserMessage`가 lane을 받게 바꾼다. 모르는 thread(fork로 떠난 옛 thread)는 지금처럼 버린다.
   - 자식 thread의 승인·질문 요청(`onRequest`, `CX:1315-1348`, params `threadId`)은 root에 카드로 낸다(사람이 답한다). `openApproval`의 `calls.get(params.itemId)`(`CX:885`)는 그 thread의 lane에서 찾는다.
   - `stop_child {child}`는 그 thread의 도는 turn에 `turn/interrupt {threadId: child, turnId}`를 보낸다. `steer_child {child, text}`는 도는 turn이 있으면 `turn/steer {threadId: child, expectedTurnId, input}`, 없으면 `turn/start {threadId: child}`다. capability `stop_child`·`steer_child`. 자식 이벤트가 이 connection에 오는지와 interrupt·steer가 되는지는 녹화(`collab`)로 본다.
5. background task:
   - `thread/backgroundTerminals/list`를 `turn/completed` 뒤, `/ps`, `stop_task` 뒤에 읽는다. 그 목록과 도는 subagent로 `tasks_changed`를 낸다. shell은 `{id: processId, kind: "shell", description: command, state: "running", started_at: 처음 본 시각, output: null}`, subagent는 `{id: child, kind: "agent"}`다. 목록에서 사라진 shell은 done으로 둔다.
   - `stop_task {task}`: shell은 `thread/backgroundTerminals/terminate {threadId, processId}`, agent는 `stop_child`와 같다. capability `tasks`.
   - `running()`(`CX:1922`)의 `tasks`는 도는 것의 수다(지금은 늘 0).
6. plan mode toggle과 plan 카드(`AX` §1 plan 행, §3.5):
   - meta `toggles`: `canPlan`이면 `[{id: "plan", label: "Plan mode", description, on: settings.plan}]`다. `applySettings`(`CX:590-593`)가 같이 낸다. TUI의 Shift+Tab도 `thread/settings/updated`로 온다.
   - `set_toggle {id: "plan", on}`: `runCommand`의 `plan`(`CX:1591-1610`)에서 `thread/settings/update {collaborationMode}`를 함수로 빼서 같이 쓴다. `/plan`도 그 함수를 부른다. 상태는 toggle이 보이므로 "Plan mode is on/off" info는 지운다.
   - plan 카드: plan mode에서 `plan` item이 끝나고 `turn/completed`가 오면 TUI의 "Implement this plan?"(`CR/tui/src/chatwidget/plan_implementation.rs:9-14`, 띄우는 곳 `turn_runtime.rs:292`)을 approval로 낸다: subject `{kind: "plan", plan: item.text, modes: [{id: "default", label: "Implement"}]}`. server 요청이 아니라 adapter의 카드라 답할 rpc가 없다. 고르면 collaborationMode를 default로 바꾸고 "Implement the plan."(`PLAN_IMPLEMENTATION_CODING_MESSAGE`)을 사람 메시지로 보낸다. reject면 plan mode에 남는다. "clear context and implement"는 넣지 않는다.
7. goal(`AX` §3.6):
   - `OPT_OUT`(`CX:86-122`)에서 `thread/goal/cleared`를 뺀다. 시작할 때(`ready`, `CX:1471-1530`) `thread/goal/get {threadId}`로 읽는다.
   - `thread/goal/updated`(`CX:1300-1304`)는 meta `goal {objective, status, detail}`로 낸다(`TS/ThreadGoal.ts`. detail은 tokensUsed·tokenBudget·timeUsedSeconds 요약). `thread/goal/cleared`는 null이다. 지금의 info는 지운다.
   - `set_goal {objective, paused}`: objective null이면 `thread/goal/clear`, paused면 `thread/goal/set {status: "paused"}`, 그 밖은 `thread/goal/set {objective, status: "active"}`다. `/goal <objective>`도 같은 함수를 쓴다. capability `goal`.
8. 사용 한도(`AX` §3.4): `OPT_OUT`에서 `account/rateLimits/updated`를 빼고, 시작할 때 `account/rateLimits/read`를 읽는다. `rateLimitsByLimitId ?? {codex: rateLimits}`의 `primary`·`secondary`(`TS/RateLimitWindow.ts`, `{usedPercent, windowDurationMins, resetsAt}`)를 `usage.limits`로 옮긴다: `{id: "<limitId>.primary", label: 창 길이(300분 → 5h, 10080분 → weekly), used_percent: usedPercent, left: null, resets_at: resetsAt의 ISO}`. `usageOf`(`CX:1372-1389`)가 limits를 같이 싣는다. resetsAt 단위는 녹화로 본다.
9. 경고, elicitation, 추가 권한(`AX` §3.8-9):
   - `OPT_OUT`에서 `warning`, `configWarning`, `model/rerouted`를 빼고 warning `info`로 낸다(`TS/WarningNotification.ts` `message`, `ConfigWarningNotification.ts` `summary`·`details`, `ModelReroutedNotification.ts` from → to).
   - `item/permissions/requestApproval`(`CX:1333-1338`): 빈 권한으로 자동 답하던 것을 지우고 approval 카드를 낸다. subject는 `mcp_tool {server: "codex", tool: "extra permissions: <network·fileSystem 요약>", effect: "external"}`, choices는 once·session·reject다. once는 `{permissions: <요청한 것>, scope: "turn"}`, session은 `scope: "session"`, reject·cancelled는 `{permissions: {}, scope: "turn"}`이다(`TS/PermissionsRequestApprovalParams.ts`, `PermissionGrantScope.ts`). 영구 선택지는 없다(scope는 turn·session뿐이다).
   - `mcpServer/elicitation/request`(`CX:1324-1332`)는 decline 그대로 두고, info를 warning으로 바꿔 server 이름과 message를 싣는다. form을 질문 카드로 옮기지는 않는다.
10. `imageGeneration`(`AX` §3.7): `TOOL_ITEMS`(`CX:744-753`)와 `describe`에 넣어 `image_generation <revisedPrompt>` tool 줄로 낸다. `body.output`은 `savedPath`다. 그림을 화면에 띄우지는 않는다.
11. tool 본문: `describe`와 `itemDone`이 `body`를 싣는다. commandExecution은 `command`와 `aggregatedOutput`, fileChange는 경로와 `changes[].diff`, mcpToolCall·dynamicToolCall은 `arguments`와 `result`·`error`·`contentItems`(JSON 글), webSearch는 `query`다. 시작과 끝에 싣는 길과 한 쪽 상한은 acp-more대로다(상한이 없으면 `packages/protocol/lophn-agent/turn-reads.ts:140` `TURN_BODY_VIEW_MAX_BYTES`). `Item` type(`CX:128-149`)에 칸을 더한다(`TS/ThreadItem.ts`).
12. meta와 origin: 처음 `meta`(`CX:522-533`)에 `harness: "codex"`를 넣는다. message `origin`: 사람 메시지는 `clientId ?? item.id`다. 우리가 보낸 것은 `clientUserMessageId`로 보낸 ACP id라 보낼 때 이미 안다(`CX:1146`, `CX:1178`). assistant는 `agentMessage`의 item id다. `replay`(`CX:1405-1435`)도 같은 규칙이라 resume 뒤에도 같다. `thread/turns/list`가 `clientId`를 돌려주는지는 녹화(`origin`)로 본다. `message_recorded`에 origin을 싣는 칸은 acp-more 꼴대로 쓰고, 없으면 보고한다.
13. `/new`·`/clear`: 지금 `new`(`CX:1625-1631`)에 plan(`plan_changed` 빈 목록), goal(null), tasks(빈 목록), 자식 lane 비우기를 더한다.
14. 녹화: `fixtures/codex/record.ts`를 고친다.
    - 출력 폴더는 `LOPHN_REC_OUT`을 꼭 받는다(없으면 멈춘다. worktree 안 `.dev-data`는 merge 때 지워진다). lead는 `LOPHN_REC_OUT=/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/codex-v2`로 돈다.
    - model은 env `CODEX_MODEL`을 `thread/start`의 `model`로 넘긴다. lead가 `model/list`에서 가장 싼 것을 준다.
    - scenario:
      - `review`: git 폴더에 file 하나를 바꾸고 `review/start` → `exitedReviewMode.review`.
      - `compact`: 있는 것.
      - `goal`: set → `thread/goal/updated`, get, paused, clear → `thread/goal/cleared`.
      - `plan`: 있는 것에 더한다. `plan` item, `thread/settings/updated`, collaborationMode를 default로 바꾸고 "Implement the plan.".
      - `collab`: spawn → wait → close. 자식 thread 이벤트가 A에 오는지, `agentsStates`, 자식 turn에 `turn/interrupt`·`turn/steer`.
      - `rate_limits`: `account/rateLimits/read`와 `updated`.
      - `background`: background terminal 하나 → `thread/backgroundTerminals/list` → `terminate` → `clean`.
      - `mcp_status`: `mcpServerStatus/list`.
      - `origin`: 두 turn 뒤 새 process에서 `thread/resume`과 `thread/turns/list`. userMessage `clientId`와 item id가 처음과 같은지 본다.
      - `permissions`: 추가 권한 요청이 오게 해 본다(sandbox 밖 쓰기 등). 안 오면 안 왔다는 것을 note로 남긴다.
    - 지키는 것:
      - 승인 답에 `acceptWithExecpolicyAmendment`·`applyNetworkPolicyAmendment`를 보내지 않는다(script 머리 주석 그대로).
      - `config/value/write`, `config/batchWrite`, `skills/config/write`, `experimentalFeature/enablement/set`, account 쓰기를 부르지 않는다.
      - collab에 기능 켜기가 필요하면 `thread/start`의 thread 설정으로만 켜고 `~/.codex/config.toml`은 고치지 않는다.
      - scrub: `account/*`·`mcpServer/*` 줄은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 "Scrub"대로 뺀다. test가 그 꼴을 쓰면 숫자·이름을 가짜로 바꾼 한 줄만 남긴다.
    - worker는 녹화를 돌리지 않는다. 보고에 scenario 이름과 각각이 확인할 것을 적는다. lead가 원본 경로를 건네면 test가 쓰는 줄만 `fixtures/codex/`에 옮긴다. 원본이 오기 전에는 `TS` type과 첫 판 녹화(`.cache/harness-gui-recordings/codex/`)로 짠다.
15. `codex_test.ts`: 아래 위험 test를 쓴다. 명령 표·출력 꼴·toggle은 test하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`item/permissions/requestApproval`은 창이 답하기 전까지 app-server에 답이 나가지 않는다. 거절·취소는 빈 권한, 한 번은 `scope: "turn"`을 보낸다"(권한 경계. 꼴은 `codex_test.ts:197`의 승인 test).
  - "resume 뒤 다시 그린 사람 메시지의 `origin`은 처음 보낼 때와 같다"(녹화 `origin`. key가 바뀌면 사람의 bookmark를 잃는다).
- 남지 않음: `grep -nE 'Review finished\.|granted none|Plan mode is (on|off)' packages/shell/main/extensions/bundled/harness-gui/codex.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 더해서 녹화 scenario 목록(이름, 확인할 것), 녹화로 확인할 곳, acp-more 꼴이 모자란 곳.
