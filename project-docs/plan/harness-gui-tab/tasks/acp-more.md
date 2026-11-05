# acp-more

wave 5-7이 기댈 ACP 계약을 한 번에 정한다. 사람이 실제 앱에서 찾은 것(README 정한 것 14)을 고치는 데 필요한 것이다: 정한 것 15의 확장, 명령 칸(출처, 별칭, `opens`, 정한 것 16), thread index bookmark가 쓸 message 출처 id(정한 것 17). 계약을 쓰는 곳(core, adapter 넷, 화면, gallery)은 이 task에서 type이 맞을 만큼만 고친다(새 칸은 빈 값, 새 입력은 `unavailable`). 실제로 채우고 그리는 것은 wave 5다.

- 단위: acp (wave 4)
- 선행: 없음. wave 1-3(merge됨) 위에서 한다.
- 소유(이 task만 고친다):
  - `packages/protocol/acp/{session.ts,state.ts,input.ts,items.ts,reduce.ts,reduce_test.ts}`
  - `packages/sdk/agent/acp-types.ts`
  - `packages/protocol/approvals/gate-call.ts`(plan 승인 subject)
  - `packages/shell/main/extensions/bundled/harness-gui/adapter.ts`(`HarnessGuiRun`·`HarnessGuiAdapter` type만. `HARNESS_GUI_ADAPTERS` 표는 lead가 고친다)
- 맞출 곳(새 칸·입력에 type이 맞을 만큼만, 그 줄만. wave 4에는 이 task 하나라 겹치지 않는다):
  - core: `packages/core/main/daemon/wiring/acp-build.ts`(`commandsOf`의 출처 이름, meta·state 새 칸의 빈 값), `acp-build_test.ts`(출처 literal), `acp-send.ts`(새 입력은 `unavailable`)
  - adapter: `packages/shell/main/extensions/bundled/harness-gui/{claude,codex,opencode,omp}.ts`(출처 이름, meta 새 칸, 새 입력은 받지 않음)
  - 화면: `packages/shell/renderer/conversation/{agent-view.tsx,agent-view-model.ts,thread-layout.ts,agent-tab-fake-commands.ts,agent-tab-fake-source.ts}`, `slash-menu/{types.ts,slash-menu.tsx}`(출처 이름, notice의 `turn` null), `thread-layout_test.ts`, `approval-card/subject-text.ts`(plan subject), `composer/plan-list.tsx`(`cancelled`), `packages/design/i18n/catalog/conversation.ts`(그 key만)
  - lophn live projection: `packages/protocol/events/acp-project.ts`(새 칸의 빈 값)
  - gallery: `tools/wireframes/pages/screens/harness-gui.tsx`(literal의 새 칸)
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`: `audit-codex.md`의 "ACP에 더할 것"(A1-A6), `audit-opencode.md`·`audit-omp.md`의 같은 절(A7 role, `hidden_restored`, todo `cancelled`), `audit-claude.md` §3, §5.4, `ui-reference.md` §1 "ACP에 필요한 것", 부록 B
  - architecture: `project-docs/architecture/acp.md`, `harness-gui.md`
- 계약:
  - 쓰는 것: wave 1의 ACP(`AcpSessionMeta`, `AcpCommand`, `AcpUsage`, `AcpPlan`, `acpToolDetailSchema`, notice, `AcpInput`, `reduce.ts`), `HarnessGuiRun`·`HarnessGuiAdapter`(`adapter.ts`), `AcpOpenTab`·`AcpTerminal`(`protocol/extensions/acp-session.ts`. 바꾸지 않는다)
  - 내놓는 것(이름과 칸. 세부 type은 살 단계가 이 꼴 안에서 고정한다. 새 입력은 모두 다른 입력처럼 `session`과 `key`를 가진다):
    1. 명령 `AcpCommand`: `source`를 `app | harness | skill | plugin | mcp | custom_user | custom_project`로 바꾼다(`builtin`→`app`, `cli`→`harness`). `aliases: string[]`와 `opens: <화면 동작> | null`을 더한다. 화면은 명령 이름을 해석하지 않고 `opens`만 본다. `opens` 값은 정한 것 16의 화면 동작과 lophn 내장 아홉(`new, rename, archive, compact, fork, mcp, skills, permissions, status`)이 지금 하는 일을 다 덮는다. 인자가 있는지는 `argument_hint`로 본다(null이면 인자 없음).
    2. 명령 출력: notice `{type: "command_output", command, text, format: "markdown" | "preformatted"}`를 더하고, `info`에 `level: "info" | "warning"`을 둔다. notice item의 `turn`은 nullable이다(turn 밖 명령 출력. "Worked for"를 붙이지 않는다).
    3. subagent:
       - tool detail `{kind: "subagent", agent, description, child: string | null, state: "running" | "done" | "failed" | "cancelled", model: string | null, last: string | null}`
       - 갱신 `child_update {child, update: AcpUpdate}`. `reduce.ts`가 같은 reducer로 `AcpState.children[child]`에 접는다
       - 입력 `stop_child {child}`, `steer_child {child, text}`. capability `stop_child`, `steer_child`
    4. background task:
       - `AcpState.tasks: [{id, kind: "agent" | "shell" | "other", description, state: "running" | "done" | "failed" | "stopped", started_at, output: string | null}]`
       - 갱신 `tasks_changed {tasks}`, 입력 `stop_task {task}`, capability `tasks`
       - `HarnessGuiRun.running().tasks`는 이 목록에서 도는 것의 수다
    5. 사용 한도: `AcpUsage.limits: [{id, label, used_percent: number | null, left: string | null, resets_at: string | null}]`. `AcpUsage.context`에 `parts: [{label, tokens}]`를 둔다(`/context` card용. 분해를 모르면 빈 배열).
    6. 켜고 끄기: meta `toggles: [{id, label, description: string | null, on: boolean}]`, 입력 `set_toggle {id, on}`, capability `toggles`. 쓰는 곳은 Codex plan mode, omp fast/slow, OpenCode auto-accept다.
    7. goal: meta `goal: {objective, status, detail: string | null} | null`, 입력 `set_goal {objective: string | null, paused: boolean}`, capability `goal`.
    8. model role: meta `roles: [{id, label, kind: "chat" | "model", model: string | null}] | null`, 입력 `use_role {role}`(이 session만), capability `roles`. role 배정을 쓰는 입력은 두지 않는다(정한 것 18).
    9. 숨긴 것 되살리기: 갱신 `hidden_restored {hidden}`. reducer가 그 hidden item의 `items`를 제자리(같은 `seq`)로 돌린다.
    10. todo: `AcpPlan` entry status에 `cancelled`를 더한다.
    11. harness 얼굴: meta `harness: string | null`(harness id. lophn은 null). 화면이 이것으로 vendor 아이콘을 고른다.
    12. message 출처 id: message item에 `origin: string | null`을 더한다. 그 CLI 자신의 message id라 같은 CLI session을 다시 열어도 같다(adapter의 ACP `msg_` id는 run마다 새로 만든다). lophn은 null이다. thread index bookmark의 key다.
    13. tool 본문: harness tool 줄이 입력·출력 본문을 펼쳐 보이게 한다. tool item에 `body: {input: string | null, output: string | null} | null`을 둔다(harness adapter가 채우고 한 쪽에 길이 상한을 둔다. lophn은 null이고 지금처럼 blob read `toolCallBody`로 읽는다). GUI source의 `toolCallBody`는 이 칸을 돌려준다(지금은 늘 `not_found`).
    14. plan 승인 카드: approval subject에 `{kind: "plan", plan: string(markdown), modes: [{id, label}]}`를 더한다. 사람이 고른 다음 mode를 `decide`가 싣는다. Claude `ExitPlanMode`, Codex plan mode의 "이 plan대로 할까", OpenCode plan→build 전환, omp plan mode가 이 카드 하나로 간다(어느 CLI에 무엇이 있는지는 살 단계가 점검 보고로 확인한다).

## 할 일

근거: `project-docs/architecture/acp.md`(ACP는 lophn agent·harness·앱 화면이 같이 쓰는 입구, 화면은 capability만 본다, 갱신은 두 번 접어도 같다), README 정한 것 15·16·17. 아래 이름은 모두 새로 더하는 것이고, 지금 있는 칸의 뜻은 바꾸지 않는다(바꾸는 것은 명령 `source`의 두 이름과 notice `turn`의 null뿐이다). 모든 schema는 지금 file처럼 `z.strictObject`이고 모르는 값은 null이다(0이나 빈 글이 아니다).

### A. 계약(소유 file)

1. 승인 subject. `packages/protocol/approvals/gate-call.ts`의 `fileChangeSubjectSchema` 옆에 `planSubjectSchema`를 두고 `acpApprovalSubjectSchema`의 union에 더한다(이 file은 소유에 없다. 보고의 "계약 바꾸기 요청"을 보라):
   ```ts
   z.strictObject({
     kind: z.literal("plan"),
     plan: z.string(),            // markdown 본문
     modes: z.array(z.strictObject({ id: z.string().min(1), label: z.string() })).min(1),  // 승인하고 이어 갈 길
   })
   ```
   주석: harness의 plan 승인 카드다. `modes`는 harness가 주는 "승인하고 이렇게 이어 간다" 단추(Claude "Accept edits"·"Ask for edits", omp execute·keep context 등)이고 화면은 해석하지 않는다. plan 카드의 `pending.approval.choices`는 `["reject"]`이고(거절 = 계속 plan, 이유 글이 feedback이다) 승인은 아래 7의 `decide {kind: "mode"}`로 한다.
2. `packages/protocol/acp/session.ts`:
   - 명령 출처: `ACP_COMMAND_SOURCES = ["app", "harness", "skill", "plugin", "mcp", "custom_user", "custom_project"]`. 순서가 palette의 같은 순위 안 출처 순서다(`ui-reference.md` §1). 주석: `app`은 lophn 앱이 하는 명령(lophn 내장), `harness`는 그 CLI의 내장 명령, `custom_*`는 사람이 쓴 명령 file(Claude `~/.claude/commands`, `.claude/commands` 등).
   - 화면 동작: `ACP_COMMAND_OPENS`(아래 표의 18개)와 `acpCommandOpensSchema = z.enum(ACP_COMMAND_OPENS)`, type `AcpCommandOpens`.
   - `acpCommandSchema`에 `aliases: z.array(z.string().min(1))`(앞 `/` 없이), `opens: acpCommandOpensSchema.nullable()`를 더한다. `argument_hint`는 그대로 두고 주석에 "null이면 인자를 받지 않는다"를 적는다.
   - 표(주석으로 `ACP_COMMAND_OPENS` 위에 둔다. 화면은 명령 이름이 아니라 이 값만 본다):

     | `opens` | 화면이 하는 일 | 내는 쪽 |
     |---|---|---|
     | `new` | 새 session 화면을 연다 | lophn(`/new`, 별칭 `/clear`). harness는 쓰지 않는다: 같은 탭의 새 session은 adapter가 `run_command`로 연다(README 정한 것 16) |
     | `rename` | 인자가 비면 composer에 `/<이름> `을 채우고 기다리고, 있으면 `rename {title: 인자}` | 둘 다 |
     | `archive` | 이 session을 archive한다 | lophn |
     | `compact` | `compact` 입력 | 둘 다 |
     | `fork` | `fork {message: null}` | 둘 다 |
     | `rewind` | rewind 고르기를 연다 | 둘 다 |
     | `model` | model picker를 연다 | 둘 다 |
     | `effort` | model picker의 option 축을 연다 | 둘 다 |
     | `mode` | mode picker를 연다(harness `/permissions`, OpenCode `/agents`) | 둘 다 |
     | `permissions` | lophn 할당 보기(`PermissionsView`) | lophn |
     | `status` | status card | 둘 다 |
     | `usage` | usage card(`usage`와 `limits`) | 둘 다 |
     | `context` | context card(`usage.context`와 `parts`) | 둘 다 |
     | `mcp`, `skills` | lophn agent 설정의 그 절 | lophn |
     | `subagents` | dock의 subagent 목록 | harness |
     | `tasks` | dock의 background task 목록 | harness |
     | `goal` | 인자가 비면 goal 편집, 있으면 `set_goal {objective: 인자, paused: false}` | harness |

     규칙(주석에 적는다): `opens`가 null이면 화면은 `run_command`로 보낸다. `opens`가 있는데 사람이 인자를 쳤고 그 값이 인자를 쓰지 않는 것(`rename`·`goal` 밖)이면, `argument_hint`가 있을 때 `run_command`로 보낸다(`/model sonnet`은 CLI가 바로 바꾼다). TUI에서만 되는 명령은 목록에 넣지 않는다. 켜고 끄는 명령(Codex `/plan`, omp `/fast`)처럼 열 화면이 없는 것은 `opens: null`이고 adapter가 `run_command`에서 바꾼 뒤 `session_changed`를 낸다.
   - 사용량: `acpUsageSchema.context`를 `{tokens, limit, parts: z.array(z.strictObject({label: z.string(), tokens: count}))}`로 바꾼다(분해를 모르면 빈 배열). `limits: z.array(acpUsageLimitSchema)`를 더한다:
     ```ts
     acpUsageLimitSchema = z.strictObject({
       id, label: z.string(),
       used_percent: z.number().min(0).max(100).nullable(),
       left: z.string().nullable(),          // "$4.20 left"처럼 source가 만든 글
       resets_at: atSchema.nullable(),       // ../base/values.ts
     })
     ```
   - 켜고 끄기: `acpToggleSchema = {id, label: z.string(), description: z.string().nullable(), on: z.boolean()}`.
   - goal: `acpGoalSchema = {objective: z.string(), status: z.enum(["active", "paused", "blocked", "done"]), detail: z.string().nullable()}`. Codex `usageLimited`·`budgetLimited`는 `blocked`에 `detail`로 싣는다(adapter의 일).
   - role: `acpRoleSchema = {id, label: z.string(), kind: z.enum(["chat", "model"]), model: z.string().nullable()}`. role 배정을 바꾸는 칸은 두지 않는다(README 정한 것 18).
   - `acpSessionMetaSchema`에 `usage` 뒤로 `toggles: z.array(acpToggleSchema)`, `goal: acpGoalSchema.nullable()`, `roles: z.array(acpRoleSchema).nullable()`(null = role이 없는 source), `harness: z.string().min(1).nullable()`(harness id, `protocol/coding-agent/harness-id.ts`의 값. lophn은 null. 화면이 이 값으로 vendor 아이콘을 고른다)를 더한다.
   - `ACP_CAPABILITIES` 끝에 `stop_child`, `steer_child`, `tasks`(목록과 `stop_task`), `toggles`, `goal`, `roles`를 더한다. lophn은 여섯 모두 false다.
3. `packages/protocol/acp/items.ts`:
   - message: `acpMessageItemSchema`에 `origin: z.string().min(1).nullable()`. 주석: "그 CLI 자신의 message id. 같은 CLI session을 다시 열어도 같다(ACP id는 run마다 새로 만든다). thread index bookmark의 key이고 사람 메시지만 쓴다. lophn은 null이다."
   - tool 본문: `ACP_TOOL_BODY_LIMIT = 65_536`(한 쪽 글 길이. core의 tool body 읽기와 같은 64 KiB)과 `acpToolBodySchema = z.strictObject({input: z.string().nullable(), output: z.string().nullable(), truncated: z.boolean()})`. `acpToolItemSchema`에 `body: acpToolBodySchema.nullable()`. 주석: "harness가 싣는 입력·출력 글(JSON이면 그 글). 한 쪽이 상한을 넘으면 잘라 `truncated`. lophn은 null이고 본문은 blob read(`toolCallBody`)로 읽는다. lophn이 null인 것은 redaction 경계다(`acp-build_test.ts`의 'tool 본문이 없다' case)."
   - subagent: `acpToolDetailSchema`에 더한다:
     ```ts
     z.strictObject({
       kind: z.literal("subagent"),
       agent: z.string(),                // agent 종류(general-purpose, explore, …)
       description: z.string(),          // 맡긴 일 한 줄
       child: id.nullable(),             // AcpState.children의 key. 아직 모르면 null
       state: z.enum(["running", "done", "failed", "cancelled"]),
       model: z.string().nullable(),
       last: z.string().nullable(),      // 마지막 말이나 요약
     })
     ```
   - notice: `acpNoticeItemSchema.turn`을 `id.nullable()`로(turn 밖 명령 출력. 화면은 null이면 "Worked for"를 붙이지 않는다). `info`를 `{type: "info", text, level: z.enum(["info", "warning"])}`로, `{type: "command_output", command: z.string().min(1), text: z.string(), format: z.enum(["markdown", "preformatted"])}`을 더한다. `command`는 앞 `/` 없는 이름이고, `preformatted`는 ANSI를 지운 고정폭 글이다(adapter가 지운다). turn_end·error notice는 늘 turn이 있다(주석).
4. `packages/protocol/acp/state.ts`:
   - `acpPlanSchema` entry status에 `"cancelled"`(omp `abandoned`, OpenCode `cancelled`).
   - background task: `acpTaskSchema = z.strictObject({id, kind: z.enum(["agent", "shell", "other"]), description: z.string(), state: z.enum(["running", "done", "failed", "stopped"]), started_at: atSchema.nullable(), output: z.string().nullable()})`. `output`은 출력의 꼬리이고 `ACP_TOOL_BODY_LIMIT` 안이다.
   - 자식 대화: 지금 `acpStateSchema`의 칸을 shape 하나로 빼서 `acpChildStateSchema = z.strictObject(shape)`(자식 대화의 상태. `children`·`tasks`가 없다)로 두고, `acpStateSchema = z.strictObject({...shape, children: z.record(id, acpChildStateSchema), tasks: z.array(acpTaskSchema)})`로 한다. 자식은 한 층이다: 손자 subagent도 바깥 `children`에 평평하게 들고, 그 subagent tool 줄(자식 상태 안)의 `child`가 바깥 key를 가리킨다. 그래서 schema와 type이 재귀하지 않는다(zod `z.lazy`, SDK type의 재귀가 없다).
   - 갱신: 지금 `acpUpdateSchema`의 option 전부와 아래 둘을 `acpChildUpdateSchema`(자식에 접히는 갱신)로 두고, `acpUpdateSchema = z.discriminatedUnion("type", [...acpChildUpdateSchema.options, child_update, tasks_changed])`로 한다.
     - `{type: "hidden_restored", hidden: id}`: 숨긴 구간이 다시 보인다(OpenCode redo, 다른 client의 revert 풀기).
     - `{type: "origin_set", message: id, origin: z.string().min(1)}`: 사람 메시지의 CLI id를 늦게 안다(Codex `userMessage` item, omp entry id는 보낸 뒤에 온다).
     - `{type: "child_update", child: id, update: acpChildUpdateSchema}`(바깥만)
     - `{type: "tasks_changed", tasks: z.array(acpTaskSchema)}`(바깥만. 목록을 통째로 바꾼다)
     - `tool_ended`에 `body: acpToolBodySchema.nullable()`(null이면 시작 때 본문을 그대로 둔다).
     - `{type: "tool_detail_changed", tool_call: id, detail: acpToolDetailSchema}`: 끝난 tool 줄의 detail이 나중에 바뀐다(background로 돈 subagent가 끝남, Codex `wait`·`closeAgent`). reducer는 그 tool item의 `detail`만 바꾸고 없으면 그대로다.
   - type `AcpChildState`, `AcpChildUpdate`, `AcpTask`를 export한다.
5. `packages/protocol/acp/input.ts`:
   - `acpDecideChoiceSchema`에 `{kind: "mode", mode: z.string().min(1)}`(plan 승인. 그 subject의 `modes` id 하나). 주석: plan subject에만 쓰고 다른 subject면 받는 쪽이 `invalid_input`이다.
   - 입력(모두 `session`, `key: z.string().min(1)`):
     - `stop_child {child: z.string().min(1)}`
     - `steer_child {child, text: z.string().min(1)}`
     - `stop_task {task: z.string().min(1)}`
     - `set_toggle {id: z.string().min(1), on: z.boolean()}`
     - `set_goal {objective: z.string().min(1).nullable(), paused: z.boolean()}`(null = goal을 지운다. `paused`는 멈추기·다시 하기)
     - `use_role {role: z.string().min(1)}`(이 session만 그 role의 model로. omp `/switch @role`)
6. `packages/protocol/acp/reduce.ts`:
   - `EMPTY_ACP_STATE`에 `children: {}`, `tasks: []`. `EMPTY_ACP_CHILD_STATE`(children·tasks가 없는 꼴)를 export한다.
   - 지금 `reduceAcp`의 본문을 `AcpChildState`·`AcpChildUpdate` 위의 함수로 옮기고(`put`, `known`, `settle`, `mapTool` 등도 그 위에서 돈다. 바깥 state는 그 위에 칸이 더 있을 뿐이다), `reduceAcp(state: AcpState, update: AcpUpdate): AcpState`는 아래 둘만 따로 하고 나머지를 그 함수에 맡긴다. 이름은 worker가 정한다.
   - `child_update`: `children[child] = 접기(children[child] ?? EMPTY_ACP_CHILD_STATE, update)`. 자식의 `reread`가 서면 바깥 `reread`도 세운다. 접은 결과가 같으면 같은 상태다(두 번 접어도 같다).
   - `tasks_changed`: `tasks`를 통째로 바꾼다.
   - `hidden_restored`: top-level에서 `id === hidden`인 hidden 항목을 빼고 그 `items`를 다시 top-level에 넣어 `seq` 순으로 둔다. 없는 hidden이면 그대로다(두 번 접어도 같다). `seq` 최대값은 바뀌지 않는다.
   - `origin_set`: top-level message와 hidden 안 message에서 그 id의 `origin`을 바꾼다. 없으면 그대로다.
   - `tool_ended`: `body: update.body ?? item.body`.
   - reducer가 만드는 message 항목(`message_taken`, `turn_ended`, `message_recorded`)은 `origin: null`이다.
7. `packages/protocol/acp/reduce_test.ts`: 지금 case의 literal에 새 칸(`origin`, `body`, `children`, `tasks`, meta의 새 칸, `limits`, `parts`, `level`)을 맞추고 위험 test 둘을 더한다(아래 "끝남").
8. `packages/sdk/agent/acp-types.ts`: 위 1-6을 zod 없이 옮긴다(`AcpApprovalSubject`의 plan, `AcpCommand`, `AcpUsage`, meta 넷, `AcpToolDetail` subagent, tool `body`, message `origin`, notice 셋, `AcpPlan` cancelled, `AcpChildState`·`AcpState`의 children·tasks, `AcpUpdate`의 넷과 `tool_ended.body`). `agent_test.ts`의 `Same<AcpState, …>`·`Same<AcpUpdate, …>`·`Same<AcpItem, …>`가 통과해야 한다. SDK `AcpInput`(send·stop·answer만)은 그대로다. `@lophn/agent` 판(1.1.0)은 올리지 않는다: 1.1.0은 열린 판 0.18.0 안에서 올린 것이라 아직 낸 적이 없고, 설치 사본은 byte가 다르면 다시 쓴다(`packages/core/apps/packages/install.ts`의 `installCopy`).
9. `packages/shell/main/extensions/bundled/harness-gui/adapter.ts`: `HarnessGuiRun.running()`의 주석에 "`tasks`는 ACP `tasks` 중 `state: running`인 수"를 적는다. type은 바꾸지 않는다.

### B. 맞출 곳(type이 맞을 만큼만. 그리는 것, 채우는 것은 wave 5)

10. core `packages/core/main/daemon/wiring/acp-build.ts`:
    - `CAPABILITIES`(지금 `ACP_CAPABILITIES`를 모두 true로 만든다)를 새 여섯만 false인 값으로 바꾼다. lophn은 그 기능이 없다.
    - `commandsOf`: `source`는 `builtin` → `app`, `skill` → `skill`. `aliases: []`, `opens: null`(lophn 내장의 `opens`는 `core-commands`가 채운다).
    - `readUsage`: `context`에 `parts: []`, `limits: []`.
    - `metaOf`: `toggles: []`, `goal: null`, `roles: null`, `harness: null`.
    - snapshot(`AcpState`를 만드는 곳, `plan: null` 옆): `children: {}`, `tasks: []`. message 항목 `origin: null`, tool 항목 `body: null`.
    - `acp-build_test.ts`: 출처 literal(`builtin` → `app`)과 새 칸.
11. core `packages/core/main/daemon/wiring/acp-send.ts`: `decide`는 `session`과 같이 `mode`도 `invalid()`(core 승인에는 plan이 없다). 새 입력 여섯은 `err({code: "unavailable", message: "not supported by lophn agents"})`.
12. lophn live projection `packages/protocol/events/acp-project.ts`(맞출 곳에 없다. 보고를 보라): `message_added` item `origin: null`, `tool_started` item `body: null`, `tool_ended` `body: null`.
13. adapter 넷(`packages/shell/main/extensions/bundled/harness-gui/{claude,codex,opencode,omp}.ts`):
    - capability 값(`CAPABILITIES`, omp 422·codex 1485 근처의 literal): 새 여섯 false.
    - 첫 session meta literal: `toggles: []`, `goal: null`, `roles: null`, `harness: "claude" | "codex" | "opencode" | "omp"`(그 adapter의 id. 이 값은 바로 채운다).
    - 명령 `source` literal: `"cli"`·`"builtin"` → `"harness"`(opencode.ts:272의 client 명령 `undo`·`redo`·`new` 포함. 그 명령이 `run_command`로 가서 사는 것은 `opencode-fix`가 본다). skill은 그대로. `aliases: []`, `opens: null`.
    - usage literal: `limits: []`, `context`가 있으면 `parts: []`.
    - message item literal `origin: null`, tool item literal `body: null`, `tool_ended`에 `body: null`, info notice에 `level: "info"`.
    - 새 입력은 받지 않는다: 입력 switch가 값을 돌려주는 곳(codex·opencode·omp의 `default`)은 지금 모르는 입력과 같게 둔다. type error가 나는 곳만 고친다.
14. 화면(`packages/shell/renderer/conversation/`):
    - `agent-view.tsx`: `command.source === "builtin"` → `"app"`. 동작은 그대로다(이름 switch를 지우는 것은 `screen-thread`).
    - `agent-view-model.ts`: `LOPHN_CAPABILITIES`에 새 여섯 false. `GROUPS`의 `builtin` → `app`, `cli` → `harness`(묶음 머리 i18n key는 그대로 쓴다. 나머지 출처의 묶음은 `screen-thread`).
    - `slash-menu/types.ts`: `SlashEntryView.source`를 `AcpCommand["source"]`로. `slash-menu/slash-menu.tsx`는 type이 맞을 만큼만.
    - `thread-layout.ts`: `command_output`은 지금은 `info` entry(text만)로 둔다. `turn`이 null인 turn_end·error notice는 줄을 만들지 않는다(그런 notice는 없다). subagent detail은 `generic`과 같이 묶음으로 보낸다(`item.detail.kind === "generic"` 검사, 271줄 근처).
    - `agent-tab-fake-commands.ts`: `builtin` → `app`, `cli` → `harness`, `aliases: []`, `opens: null`.
    - `agent-tab-fake-source.ts`: capability 값(`EVERYTHING`, `HARNESS_CAPABILITIES`), meta·usage·item·notice literal의 새 칸.
    - 아래도 type error가 나는 곳이다(맞출 곳에 없다. 보고를 보라): `approval-card/subject-text.ts`(`titleOf`·`targetOf`·`effectOf`가 plan subject를 모른다: 제목은 지금 `approval-run` 꼴 대신 plan 줄 하나, 대상은 `modes` label, 효과는 null), `composer/plan-list.tsx`의 `STATUS` 표(`cancelled`. i18n key `conversation.label.plan-cancelled`를 `packages/design/i18n/catalog/conversation.ts`에 더한다), `thread-layout_test.ts`의 item literal, gallery `tools/wireframes/pages/screens/harness-gui.tsx`의 message·tool literal.
15. 지운 이름과 옛 값을 찾는다: `grep -rn 'source: "cli"\|source: "builtin"\|"slash-group-cli"' packages/shell packages/core/main packages/sdk tools/wireframes/pages tools/wireframes/mock`이 i18n key 하나(`slash-group-cli`, 묶음 머리 글) 말고 0줄이다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`reduce_test.ts`, 둘. 갱신을 잘못 접으면 대화가 사라진 것처럼 보인다):
  - "`child_update`는 같은 reducer로 `children`에 접히고 두 번 접어도 같으며, 자식의 순번 빈틈은 바깥 `reread`를 세운다"
  - "`hidden_restored`는 숨긴 항목을 같은 `seq` 자리로 돌리고 두 번 접어도 같다"
- 남지 않음: `grep -rn '"cli"' packages/protocol/acp packages/sdk/agent/acp-types.ts`가 0줄. 위 15의 grep.
- 화면은 바뀌지 않는다(그리는 것은 wave 5·6). `npm run wireframes`가 된다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 lead가 문서에 옮길 것: 새 schema 이름과 칸, `opens` 표, capability 여섯, 자식 대화가 한 층이라는 규칙.
