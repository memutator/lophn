# acp-more

wave 5-7이 기댈 ACP 계약을 한 번에 정한다. 사람이 실제 앱에서 찾은 것(README 정한 것 14)을 고치는 데 필요한 것이다: 정한 것 15의 확장, 명령 칸(출처, 별칭, `opens`, 정한 것 16), thread index bookmark가 쓸 message 출처 id(정한 것 17). 계약을 쓰는 곳(core, adapter 넷, 화면, gallery)은 이 task에서 type이 맞을 만큼만 고친다(새 칸은 빈 값, 새 입력은 `unavailable`). 실제로 채우고 그리는 것은 wave 5다.

- 단위: acp (wave 4)
- 선행: 없음. wave 1-3(merge됨) 위에서 한다.
- 소유(이 task만 고친다):
  - `packages/protocol/acp/{session.ts,state.ts,input.ts,items.ts,reduce.ts,reduce_test.ts}`
  - `packages/sdk/agent/acp-types.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/adapter.ts`(`HarnessGuiRun`·`HarnessGuiAdapter` type만. `HARNESS_GUI_ADAPTERS` 표는 lead가 고친다)
- 맞출 곳(새 칸·입력에 type이 맞을 만큼만, 그 줄만. wave 4에는 이 task 하나라 겹치지 않는다):
  - core: `packages/core/main/daemon/wiring/acp-build.ts`(`commandsOf`의 출처 이름, meta·state 새 칸의 빈 값), `acp-build_test.ts`(출처 literal), `acp-send.ts`(새 입력은 `unavailable`)
  - adapter: `packages/shell/main/extensions/bundled/harness-gui/{claude,codex,opencode,omp}.ts`(출처 이름, meta 새 칸, 새 입력은 받지 않음)
  - 화면: `packages/shell/renderer/conversation/{agent-view.tsx,agent-view-model.ts,thread-layout.ts,agent-tab-fake-commands.ts,agent-tab-fake-source.ts}`, `slash-menu/{types.ts,slash-menu.tsx}`(출처 이름, notice의 `turn` null)
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

할 일: (살 단계가 채운다)
