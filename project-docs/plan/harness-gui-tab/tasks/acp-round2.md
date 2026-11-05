# acp-round2

사람이 써 본 둘째 묶음(README 정한 것 20-29)을 고치는 데 wave 10·11이 기댈 ACP·IPC 계약을 한 번에 정한다. shell mode(`shell`, `run_shell`, 사람 tool 줄 `by`), harness resume(`resume`, `open_session`, `session_reset`, session 목록), rewind 미리보기, `switch` 축이다. 계약을 쓰는 곳(core, adapter 넷, 화면, gallery)은 type이 맞을 만큼만 고친다: 새 칸은 빈 값이고, 새 입력은 `unavailable`이거나 무시한다. 실제로 채우고 그리는 것은 wave 10·11이다.

- 단위: acp (wave 9)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/acp/{session.ts,state.ts,input.ts,items.ts,reduce.ts,reduce_test.ts}`
  - `packages/sdk/agent/acp-types.ts`
  - `packages/protocol/extensions/acp-session.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/{adapter.ts,index.ts}`
  - `packages/shell/ipc/harness-gui.ts`
  - `packages/shell/preload/harness-gui-api.ts`
  - `packages/shell/main/terminal/gui.ts`
  - `packages/shell/main/desktop/wiring/extensions.ts`
- 맞출 곳(새 칸·입력에 type이 맞을 만큼만, 그 줄만. wave 9에는 이 task 하나라 겹치지 않는다):
  - core: `packages/core/main/daemon/wiring/{acp-build.ts,acp-build_test.ts,acp-send.ts}`, `packages/protocol/events/acp-project.ts`
  - adapter: `packages/shell/main/extensions/bundled/harness-gui/{claude,codex,opencode,omp}.ts`와 그 `_test.ts`의 literal
  - 화면: `packages/shell/renderer/conversation/{agent-tab-gui-source.ts,agent-tab-fake-source.ts,agent-tab-fake-models.ts,thread-layout.ts,thread-layout_test.ts}`의 literal과 exhaustive switch
  - gallery: `tools/wireframes/pages/screens/harness-gui.tsx`, `tools/wireframes/mock/agents-data.ts`의 literal
- 읽을 것:
  - README 정한 것 20-29
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-core-tab.md`(A·B와 끝 표), `round2-claude.md`, `round2-others.md`, `round2-screen.md`
  - architecture: `project-docs/architecture/acp.md`(모양, 갱신, 입력), `harness-gui.md`(adapter와 탭 흐름), `extension.md`(`ExtensionAcp`)
  - 지금 꼴: `ACP_CAPABILITIES`(`packages/protocol/acp/session.ts`), `acpModelAxisSchema`(같은 file), `acpToolItemSchema`(`items.ts`), `acpUpdateSchema`·`acpChildUpdateSchema`(`state.ts`), `reduceAcp`(`reduce.ts`). `running`의 IPC 길(`HARNESS_GUI_TAB_RUNNING_CHANNEL`)이 새 IPC의 본보기다: preload `harness-gui-api.ts` → `desktop/wiring/extensions.ts`의 `handle(...)` → `terminal/gui.ts` `running()` → `createAcp`의 tab handler → extension `index.ts` `running` → `tab.run.running()`.
- 계약:
  - 쓰는 것: wave 1-8의 ACP(`AcpSessionMeta`, `AcpToolItem`, `AcpUpdate`, `AcpInput`, `reduceAcp`), `HarnessGuiRun`·`HarnessGuiAdapter`(`adapter.ts`), `HarnessGuiTabApi`(`ipc/harness-gui.ts`), `ExtensionAcp.onTab`(`acp-session.ts`)
  - 내놓는 것(이 이름과 칸이다. 새 입력은 모두 다른 입력처럼 `session`과 `key`를 가진다):
    1. capability: `ACP_CAPABILITIES`에 `shell`(composer shell mode와 `run_shell`)과 `resume`(harness 머리 session menu의 지난 session 목록과 바꾸기)을 더한다.
    2. 입력:
       - `run_shell {session, key, command: string(min 1)}`. 사람이 친 `!` 뒤의 글이다(앞 `!`는 뺀다).
       - `open_session {session, key, cli_session: string(min 1)}`. 그 CLI의 다른 session으로 같은 탭에서 바꾼다.
    3. 사람 tool 줄:
       - tool item에 `by: "agent" | "user"`를 더한다.
       - `user`는 사람이 돌린 명령이다: `tool: "shell"`, `category: "command"`, `title`은 명령 첫 줄, `detail: {kind: "generic"}`, 출력은 `body.output`(`body.input`은 명령 전체)이다.
       - 화면은 `user`를 사람 쪽에 펼친 채 그린다.
       - tool item의 `turn`은 nullable로 바꾼다. null은 `by: "user"`이고 turn 밖에서 돈 명령일 때만이다(주석). lophn의 `!`와 omp `bash`는 turn이 없다.
    4. `session_reset`: 바깥 갱신 `{type: "session_reset"}`이다(`acpChildUpdateSchema`가 아니라 `acpUpdateSchema`에만).
       - reducer는 `{...EMPTY_ACP_STATE, seq: state.seq, session: state.session, reread: state.reread}`를 돌려준다.
       - 비우는 것: `items`, `turn`, `queued`, `pending`, `writing`, `dropped`, `plan`, `children`, `tasks`, `draft`.
       - 남는 것: `session` meta와 `seq`. 다음 항목은 `seq + 1`부터다. adapter는 순번을 처음부터 다시 세지 않고 이어 센다. 그래서 빈 seq를 순번 빠짐(`reread`)으로 보지 않는다.
       - 새 session의 제목·`cli_session`·명령은 adapter가 바로 뒤의 `session_changed`로 낸다.
    5. model 축: `acpModelAxisSchema`에 `kind: "choice" | "switch"`를 더한다.
       - `switch`는 값이 정확히 둘이고 `[0]`이 끔, `[1]`이 켬이다. picker는 켜고 끄기로 그린다.
       - `options`에 그 축이 없으면 끔으로 그린다.
       - 지금 있는 축은 모두 `choice`다.
    6. 명령: `ACP_COMMAND_OPENS`에 `resume`을 더한다(머리 session menu를 연다. harness). 표 주석에 한 줄을 더한다.
    7. harness run(`adapter.ts`의 `HarnessGuiRun`, optional):
       - `sessions?(): Promise<{id: string, title: string | null, updated_at: string | null}[]>`: 그 CLI가 이 폴더에서 가진 지난 session, 최근 순이다.
       - `rewindPreview?(message: string): Promise<{files: {path: string, change: "create" | "update" | "delete"}[]}>`: 그 사람 메시지로 rewind하면 되돌아갈 file이다. `change`는 `file_change` subject와 같은 값이다.
    8. IPC: `HarnessGuiTabApi`에 `sessions(handle)`과 `rewindPreview(handle, message)`를 더한다.
       - 새 channel은 `harness-gui:tab-sessions`, `harness-gui:tab-rewind-preview`이고 둘 다 renderer → main invoke다.
       - run이 없거나 method가 없으면 `sessions`는 `[]`, `rewindPreview`는 `null`이다.
       - 길: preload → main `handle` → `gui.ts`(`byHandle`로 terminal을 찾는다) → `createAcp`의 tab handler → `ExtensionAcp.onTab`의 새 handler `sessions(terminalId)`·`rewindPreview(terminalId, message)` → extension `index.ts`가 `tabs.get(id)?.run?.sessions?.()`.
    9. fork·rewind 뒤의 info 줄은 지금 있는 `notice_added` info notice다. 계약을 바꾸지 않는다(정한 것 28).

## 할 일

1. `session.ts`
   - `ACP_CAPABILITIES`에 `shell`, `resume`을 더하고 각각 주석 한 줄을 단다.
   - `acpModelAxisSchema`에 `kind: z.enum(["choice", "switch"])`를 더하고 위 5의 규칙을 주석으로 적는다.
   - `ACP_COMMAND_OPENS`에 `resume`을 더하고 표 주석에 줄을 더한다.
2. `items.ts`: `acpToolItemSchema`에 `by: z.enum(["agent", "user"])`를 더하고 `turn`을 `id.nullable()`로 바꾼다. 주석에 위 3을 적는다.
3. `input.ts`: `run_shell`과 `open_session`을 `acpInputSchema`에 더한다.
4. `state.ts`: `acpUpdateSchema`의 바깥 갱신에 `{type: "session_reset"}`을 더한다(`child_update`·`tasks_changed`·`draft_set` 옆).
5. `reduce.ts`: `reduceAcp`에 `session_reset`을 위 4의 규칙대로 더한다. `reduceChild`에는 없다. `tool_started`의 writing 버리기는 `turn`이 null이면 그대로다(지금 식이 그렇게 돈다).
6. `reduce_test.ts`: 지금 literal에 `by`·`kind`·새 capability를 맞추고 아래 위험 test를 더한다.
7. `packages/sdk/agent/acp-types.ts`: 1-5를 zod 없이 옮긴다(`agent_test.ts`의 `Same<>` 검사가 본다).
8. IPC 길(위 8)
   - `ipc/harness-gui.ts`: channel 이름 둘과 `HarnessGuiTabApi`의 method 둘, 값 type `HarnessGuiSessionEntry`, `HarnessGuiRewindPreview`.
   - `preload/harness-gui-api.ts`: method 둘.
   - `desktop/wiring/extensions.ts`: `handle(...)` 둘(`z.strictObject({handle, message?})`, 글 길이 상한은 지금 `handleOnly`와 같다)과 `createAcp`의 tab handler 연결.
   - `terminal/gui.ts`: `TabGui`에 `sessions(handle)`, `rewindPreview(handle, message)`.
   - `protocol/extensions/acp-session.ts`: `onTab` handler에 `sessions`, `rewindPreview`.
   - `harness-gui/index.ts`: `onTab({gui, tui, running, sessions, rewindPreview})`.
   - `harness-gui/adapter.ts`: `HarnessGuiRun`에 optional method 둘.
9. 맞출 곳(type만)
   - core:
     - `acp-build.ts`: tool item에 `by: "agent"`, 축에 `kind: "choice"`, capability `shell: false`, `resume: false`
     - `acp-send.ts`: `run_shell`과 `open_session`은 `unavailable`. `run_shell`은 다음 wave의 `core-shell`이 채운다
     - `acp-project.ts`: `tool_started` item에 `by: "agent"`
   - adapter 넷: tool item에 `by: "agent"`, 축 `kind: "choice"`, capability 둘 false, 새 입력은 받지 않는다
   - 화면과 gallery: literal에 같은 값
   - exhaustive switch가 깨지는 곳(`AcpInput`, `AcpUpdate`, `AcpCommandOpens`)은 그 case만 더한다. 화면은 `resume`을 지금 아무것도 하지 않는 case로 둔다
10. grep: `grep -rn "acpModelAxisSchema\|AcpModelAxis" packages tools`로 축 literal을 만드는 곳을 다 찾아 `kind`를 맞춘다. tool item literal도 `kind: "tool"`로 찾는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`reduce_test.ts`): "`session_reset`을 접으면 items·turn·queued·pending·writing·plan·children·tasks·draft가 비고 session meta와 seq는 남는다. 이어서 `seq + 1`의 항목을 접으면 그 항목이 들고 `reread`가 서지 않는다. 같은 갱신을 두 번 접어도 같은 상태다."
- 남지 않음: 새 이름을 쓰는 곳이 type check를 지난다. 이 task는 지우는 이름이 없다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 lead가 문서(`acp.md`, `harness-gui.md`, `extension.md`)에 옮길 것을 적는다: 새 capability 둘, 입력 둘, `by`와 `turn` null 규칙, `session_reset` 규칙, 축 `kind`, `opens: "resume"`, IPC 둘의 길.
