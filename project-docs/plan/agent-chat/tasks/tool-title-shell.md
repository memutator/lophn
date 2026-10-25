# tool-title-shell

tool 줄이 무엇을 했는지 보인다: 이어진 read/list/search call은 tool이 달라도 하나로 묶고("Read 3 files · Searched 2 times · Listed 1 folder"), command와 web도 묶으며, call이 하나면 그 제목이다. 묶음을 펼치면 call마다 제목과 걸린 시간이, call을 펼치면 redaction된 입력 전체와 출력(64 KiB에서 잘렸다고 표시)이 보인다. 도는 중과 끝난 뒤가 같은 묶기 함수를 써서 turn이 끝날 때 화면이 뛰지 않고, 성공한 edit/write는 도는 중에도 tool 줄로 쌓지 않는다. 보기 select의 Everything은 묶음만 펼친다.

- 단위: tool-title (wave 3)
- 선행: clock-shell. 같은 thread file을 고친다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/activity/tool-groups.ts` (새 file)
  - `packages/shell/renderer/conversation/activity/{tool-line,file-edit-card}.tsx`
  - `packages/shell/renderer/conversation/activity/model.ts`
  - `packages/shell/renderer/conversation/activity/activity.module.css`
  - `packages/shell/renderer/conversation/agent-tab-data.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/agent-view-model.ts`
  - `packages/design/wording/catalog/{conversation,conversation.placeholders}.ts` (공용, key만 더한다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/agent-chat.md` 7 "묶기", "펼치기"와 마지막 줄(도는 중도 같은 묶기 함수, 성공한 edit/write는 도는 중에도 tool 줄이 아니다), 9 "범위 밖", `project-docs/plan/agent-chat/README.md` "정한 것"의 tool 제목 줄
  - 계약 모양: `project-docs/plan/agent-chat/tasks/chat-protocol.md`(`ToolCallDisplay`, `TOOL_CALL_CATEGORIES`, `ListedToolCall`, `ToolCallStarted.display`), `tool-title-core.md` "정한 것"(제목 글 모양, 명령 가르기, 앱·MCP·edit/write는 tool 이름 fallback)
  - architecture: `project-docs/architecture/event.md` "agent event와 화면"(화면은 snapshot을 읽고 그 뒤 event로 고친다, event는 놓칠 수 있다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, interface `event-stream`, `core-api`, `design-api`. `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`(문구는 wording key), `tools`
  - skill: `.claude/skills/wording/SKILL.md`(ICU plural, `label`은 마침표 없음·`note`·`error`는 마침표, 안쪽 말 `call` 금지, "key를 지우기 전에"), `.claude/skills/ui-design/SKILL.md`("먼저 알아둘 것", "확인", "함정")
  - 본보기(화면): 따로 그린 wireframe은 없다. gallery는 renderer component를 fake source(`agent-tab-fake-source.ts`)로 그린다. tool 줄이 보이는 page는 `tools/wireframes/pages/screens/agent.tsx`의 `new-agent-session-archived`(`report` 장면)와 `new-agent-conversation`(`working` 장면)이다. 장면을 고르는 곳은 `tools/wireframes/pages/screens/conversation.tsx`의 `sceneOf`다.
  - 코드(wave 3 앞 task가 고친 뒤의 모양을 읽는다. 줄 번호는 brief를 쓸 때의 main 기준이라 글로 찾는다):
    - snapshot 길: `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`의 `viewOf`, `readToolCalls`(`TOOL_CALL_LIMIT`), `lineOf`, `bucketOf`, `toolEntries`(run과 `flush`, 재시도한 call 거르기, `ask`·`call`·`file.write`·`file.edit`의 전용 줄), `askEntry`, `editEntry`, `agent-tab-core-source-calls.ts`의 `callViewOf`(`viewOf` 값을 쓴다)
    - 도는 중 길: `agent-tab-data.ts`의 `foldEvent`(`ToolCallStarted` 접기, `withEntries`, `TurnEnded` 뒤 snapshot 다시 읽기)
    - 화면 값: `agent-tab-source.ts`(`ToolLineView`, `ThreadTools`, `ThreadEntry`, `AgentTabSource`, `SourceResult`), `activity/model.ts`(`ToolLineView`, `ToolLineDetail`, `ViewDetail`), `agent-view-model.ts`(`shownEntries`: Messages는 tools 줄을 숨긴다)
    - 그리기: `agent-thread.tsx`(`itemsOf`의 `case "tools"`, `AgentThreadProps.source`·`now`·`detail`), `activity/tool-line.tsx`(`ToolRow`, `ToolLine`), `activity/activity.module.css`(`.tool`, `.toolHead`, `.toolSub`), `activity/worked-for.tsx`(`clock-shell`이 고친 `duration`), `message-list/agent-turn.tsx`의 `WorkingRow`(1초 tick 본보기)
    - 내용 읽기: `packages/protocol/lophn-agent/turn-reads.ts`의 `turnBodyView`(`truncated`이면 `value`는 JSON 글의 앞 64 KiB 문자열), `packages/core/lophn-agent/tools/shell/run.ts`(`shell.run` 결과 `content`: `exit_code`, `stdout`, `stderr`, `stdout_truncated`, `stderr_truncated`)
    - 승인 카드는 고치지 않는다: `approval-card/`(agent가 쓴 `description`을 싣지 않는다, `project-docs/architecture/approval.md` 51줄)
    - wording: `packages/design/wording/catalog/conversation.ts`의 `conversation.label.tool-read-documents`, `conversation.label.tool-used`, `conversation.label.call-failed`·`call-cancelled`(같은 꼴의 상태 낱말 본보기)
- 계약:
  - 쓰는 것: `chat-protocol`의 `ToolCallStarted.display`, `ToolCallEnded`, `ListedToolCall`(`display`, `started_at`, `duration_ms`); `tool-title-core`가 채운 실제 display; `turnBodyView`(`packages/protocol/lophn-agent/turn-reads.ts`, 64 KiB, `truncated`); `stream-shell`의 message·tool 줄 배치; `clock-shell`의 `duration`.
  - 내놓는 것: 도는 중과 snapshot이 같이 쓰는 묶기 함수(`activity/tool-groups.ts`). 뒤 task가 기대는 것은 없다.

## 할 일

`stream-shell`이 만든 배치를 지킨다: 한 turn 안에서 message와 tool 묶음은 시간순이고, 두 call 사이에 message가 오면 묶음을 거기서 끊는다. 묶기 함수를 `tool-groups.ts`로 옮길 때 이 끊기를 같이 옮긴다(planner).

정한 것(살 단계):
- 묶는 열쇠는 category다: read·list·search는 하나("탐색"), command, web, other다. other는 tool 이름까지 같아야 묶고 접힌 줄은 지금 문구 "Used {tool} N times"(`conversation.label.tool-used`)다. 이유: roadmap은 other 묶기를 말하지 않는다. 지금 코드(`bucketOf`)가 같은 tool이 이어지면 묶으므로 그 동작을 남긴다. 앱·MCP tool은 제목이 tool 이름이라 "Used calendar_events_create 3 times"로 읽힌다.
- web 묶음의 접힌 줄은 "Used the web N times"(새 key)다. roadmap은 "web call도 같다"만 말한다. web은 category 하나라 탐색처럼 나누지 않는다.
- 탐색 묶음의 접힌 줄은 read·search·list 순으로 0이 아닌 것만 key 셋을 `" · "`로 잇는다(roadmap "Read 3 files · Searched 2 times · Listed 1 folder"). 셋을 한 ICU 문장에 넣으면 0인 부분의 구분자가 남는다. 구분자로 잇는 것은 `approval-card/approval-card.tsx`의 `ApprovalResult` `detail`과 같은 본보기다.
- 묶음의 call이 하나면 줄은 그 call 줄 자체다(제목, 시간, 누르면 내용). 보기 select의 Everything은 call이 둘 이상인 묶음만 펼치고 call 내용은 열지 않는다(roadmap "Everything은 묶음만 펼친다. call 내용은 누를 때 열린다").
- 끝나지 않은 call 말고 성공하지 않은 call은 시간 옆에 상태 낱말(Failed, Denied, Cancelled)을 붙인다. 지금 `lineOf`가 `tool (failure)`로 보이던 사실을 wording key로 옮긴다.
- 도는 중에는 `file.write`·`file.edit`도 `ask`·`call`처럼 줄을 만들지 않는다. `ToolCallStarted` 때는 성공할지 모르고, edit card의 내용(path, 줄 수)은 event에 없다. 실패한 edit/write의 tool 줄과 성공한 것의 edit card는 turn이 끝나 snapshot을 다시 읽을 때 생긴다(`agent-tab-data.ts` 머리 주석 "모자란 칸은 turn이 끝난 뒤 snapshot을 다시 읽어 채운다"와 같다).
- call 내용의 입력은 `shell.run`이면 입력의 `command` 글, 그 밖은 입력 JSON(2칸 들여쓰기)이다(roadmap). 출력은 저장된 tool 결과의 `content`다: `shell.run`은 `stdout`과 `stderr` 가운데 빈 것이 아닌 것을 줄바꿈으로 잇고, 글이면 그대로, 그 밖은 JSON(2칸 들여쓰기)이다. `truncated`이면 값은 JSON 글의 앞부분 문자열이라 그대로 보이고 잘렸다는 note를 붙인다. 출력이 없으면(도는 중, 실행하지 않음 → `not_found`) 출력 칸을 그리지 않는다. 읽기가 다른 이유로 실패하면 오류 한 줄이다.
- 따로 그린 wireframe이 없으므로 renderer component를 고치고 fake 장면으로 gallery에서 본다. 새 gallery page는 만들지 않는다(page 목록 file이 소유 밖이다). 펼친 모양은 gallery에서 눌러 본다.

1. `packages/shell/renderer/conversation/activity/model.ts` (근거: roadmap 7 "펼치기", 화면 값)
   - `ToolLineView`를 지우고 call 하나의 화면 값을 둔다:
     `export interface ToolCallView { readonly id: string /* tcl_… */; readonly tool: string /* 정본 이름(file.read, shell.run) */; readonly category: ToolCallCategory; readonly title: string; readonly state: ToolCallState; readonly startedAt: string | null; readonly durationMs: number | null }`
     `export type ToolCallState = "running" | "ok" | "error" | "denied" | "cancelled"`(`ToolCallEnded.outcome`과 같은 낱말에 running을 더한 것).
   - `ToolCallCategory`는 `packages/protocol/lophn-agent/tool-values.ts`에서 type import한다. `ToolLineDetail`, `ViewDetail`과 머리 주석은 둔다(머리 주석의 "turn trace(ReadAgentTrace)에서 그리는"이 지금과 다르면 "tool 호출 기록과 agent event에서"로 고친다).
2. `packages/shell/renderer/conversation/agent-tab-source.ts` (근거: 화면 값, `chat-protocol`)
   - 내보내지 않는 `ToolLineView`(229~236줄)를 지우고 `ThreadTools`를 `{ kind: "tools"; calls: readonly ToolCallView[] }`(+ `EntryBase`)로 바꾼다. `id`는 첫 call의 id, `at`은 첫 call의 시각이다. 주석: 이어진 call 묶음 하나이고 call이 하나면 그 call 줄이다.
   - `AgentTabSource`의 읽기에 `toolCallBody(toolCall: string, part: "input" | "output"): Promise<SourceResult<ToolCallBodyView>>`를 더하고 `export interface ToolCallBodyView { readonly value: unknown; readonly truncated: boolean }`을 둔다. 주석: 사람 화면용으로 지금의 redaction을 거친 값이다. call 줄을 펼칠 때 읽는다. 아직 출력이 없으면 not_found다.
3. `packages/shell/renderer/conversation/activity/tool-groups.ts` (새 file. 근거: roadmap 7 "도는 중의 tool 줄도 snapshot과 같은 묶기 함수로 묶는다")
   - `export function groupToolCalls(calls: readonly ToolCallView[]): ToolCallView[][]`: 차례를 지키고 열쇠(위 "정한 것")가 같은 이웃 call을 한 묶음으로 둔다. 순수 함수이고 `t`를 부르지 않는다.
   - `export function toolEntriesOf(calls: readonly ToolCallView[], at: string): ThreadEntry[]`: `groupToolCalls`의 묶음마다 `ThreadTools` 하나(`id` 첫 call id, `at` 첫 call의 `startedAt ?? at`)를 낸다. snapshot과 도는 중이 모두 이것만 부른다. 묶음의 id가 첫 call id라 call이 늘어도 React key가 바뀌지 않는다.
   - `ThreadEntry`, `ToolCallView` type만 import한다(값 import 없음).
4. `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` (근거: roadmap 7 "묶기", "펼치기", `viewOf`는 64 KiB·`truncated`)
   - `ThreadMemo.views`가 `{ value, truncated }`를 들게 하고 `viewOf`는 지금처럼 `value`만 돌려준다(`askEntry`, `editEntry`, `callViewOf`가 쓴다). 읽기에 실패한 값은 지금처럼 기억하지 않는다(끝나기 전 출력은 not_found라 나중에 다시 읽힌다).
   - `export async function readToolCallBody(env, memo, toolCall, part): Promise<SourceResult<ToolCallBodyView>>`를 더한다: `turnBodyView`를 `tool_call_input`/`tool_call_output`으로 같은 memo를 거쳐 읽고, 실패는 그 code 그대로다.
   - `readToolCalls`가 `ListedToolCall[]`을 돌려준다(`chat-protocol`의 type, `tool-values.ts`).
   - call → `ToolCallView`: `category`·`title`은 `call.display`, `startedAt`은 `call.started_at`, `durationMs`는 `call.duration_ms`, `state`는 `state !== "finished"`면 running, 끝났으면 outcome으로 가른다: success → ok, not_executed의 code가 `cancelled` → cancelled, `denied`·`rejected` → denied, 나머지 → error(`packages/core/lophn-agent/run-loop/core-ports.ts`의 `endedOutcome`과 같은 가르기).
   - `toolEntries`: run은 같은 turn 안에서 전용 줄(질문 요약, call 블록, 성공한 edit/write의 edit card, `stream-shell`이 둔 agent message)이 끼지 않은 call들이다. `flush`는 `toolEntriesOf(run.map(<위 변환>), <첫 call의 started_at ?? finished_at ?? turn.started_at>)`를 그 turn에 넣는다. tool이 바뀐다고 run을 끊는 조건(`bucketOf(...) !== bucketOf(...)`)은 지운다. 묶음은 `groupToolCalls`가 가른다. 재시도 거르기, `ask`·`call`·`file.write`·`file.edit`의 처리는 그대로다(실패한 edit/write는 run에 든다).
   - `lineOf`, `bucketOf`와 `conversation.label.tool-read-documents`·`conversation.label.tool-used`를 부르던 `t` 호출을 지운다. 이 file에 `t` import가 더 쓰이지 않으면 지운다.
5. `packages/shell/renderer/conversation/agent-tab-core-source.ts`: source 값에 `toolCallBody: (toolCall, part) => readToolCallBody(env, memo, toolCall, part)`를 더한다(같은 `memo`).
6. `packages/shell/renderer/conversation/agent-tab-data.ts` (근거: roadmap 7 마지막 줄, `chat-protocol`의 `ToolCallStarted.display`, `ToolCallEnded`)
   - `case "ToolCallStarted"`: `tool`이 `ask`·`call`·`file.write`·`file.edit`이면 그대로 둔다. 아니면 `ToolCallView`(`category`·`title`은 `display`, `state: "running"`, `startedAt: event.at`, `durationMs: null`)를 만들고, `view.entries` 끝에 이어진 `tools` 줄들(끝에서부터 `kind === "tools"`인 것)의 call에 이 call을 더해 `toolEntriesOf(…, event.at)`로 다시 묶은 줄로 바꾼다. 같은 `tool_call`이 이미 있으면 그대로 둔다(같은 event를 두 번 접어도 같은 결과).
   - `case "ToolCallEnded"`를 더한다: 그 call이 든 `tools` 줄을 찾아 call의 `state`를 outcome(`ok`·`error`·`denied`·`cancelled`)으로, `durationMs`를 `max(0, event.at − startedAt)`으로 바꾼다. 없는 call(건너뛴 tool)이면 그대로 둔다. 정확한 `duration_ms`는 turn이 끝나 snapshot을 다시 읽을 때 들어온다.
   - `foldEvent` 머리 주석의 `ToolCall*` 줄을 고친다: "tool 줄은 snapshot과 같은 묶기 함수(`toolEntriesOf`)로 묶는다. ask·call·edit/write는 줄을 만들지 않는다."
7. `packages/shell/renderer/conversation/activity/tool-line.tsx` (근거: roadmap 7 "펼치기", ui-design "모든 화면의 규칙")
   - `ToolLine`을 묶음 하나를 그리는 component로 바꾼다. props: `calls: readonly ToolCallView[]`, `detail: ToolLineDetail`, `now: () => number`, `readBody: (toolCall: string, part: "input" | "output") => Promise<SourceResult<ToolCallBodyView>>`.
     - `detail`이 hidden이면 그리지 않는다(지금과 같다).
     - call이 하나면 `ToolCallLine` 하나다. 둘 이상이면 지금 `ToolRow`의 머리(접힌 줄 글 + 펼침 icon, `aria-expanded`)에 묶음 글을 두고 펼치면 call마다 `ToolCallLine`이다. 펼침은 `detail === "expanded" || 누른 값`이다(지금 `ToolLine`의 `pressed`와 같다).
     - 묶음 글(`groupLabel`, 이 file 안 함수): 탐색은 `conversation.label.tool-read`·`tool-searched`·`tool-listed`를 0이 아닌 것만 `" · "`로 잇고, command는 `tool-ran`, web은 `tool-web`, other는 `tool-used`(`{count, tool}`)다.
   - `ToolCallLine`(이 file 안): 제목, 걸린 시간, 상태 낱말이 한 줄이고 누르면(`aria-expanded`) 아래에 `ToolCallBody`가 열린다. Everything에서도 닫힌 채 시작한다.
     - 시간: 끝난 call은 `duration(durationMs)`(`activity/worked-for.tsx`, `clock-shell`이 고친 것. import만), `durationMs`가 null이면 비운다. running은 `duration(now() − startedAt)`이고 줄이 보이는 동안 1초마다 다시 그린다(`WorkingRow`의 interval 본보기). `startedAt`이 없으면 비운다.
     - 상태 낱말: error → `conversation.label.tool-call-failed`, denied → `tool-call-denied`, cancelled → `tool-call-cancelled`. ok와 running은 없다.
   - `ToolCallBody`(이 file 안): 처음 열릴 때 `readBody(id, "input")`과 `readBody(id, "output")`을 한 번 읽는다. 입력·출력 글은 위 "정한 것"대로 만들고 `conversation.label.tool-input`·`tool-output` 머리 아래 `<pre>`(mono, 줄바꿈 유지, 가로로 넘치면 줄 안에서 scroll)에 둔다. `truncated`면 그 칸 아래 `conversation.note.tool-body-truncated`. 출력이 not_found면 출력 칸이 없다. 그 밖의 실패는 `conversation.error.tool-body-failed` 한 줄이다.
   - `ToolRow`는 묶음 머리와 call 줄이 같이 쓰도록 고쳐도 된다. `ToolRow`의 export는 `chip-remove` 뒤 이 file 밖에서 쓰는 곳이 없다(`chip-remove` 보고). 쓰지 않으면 export를 뗀다.
8. `packages/shell/renderer/conversation/activity/activity.module.css`: call 줄(제목, 시간·상태는 `--color-text-muted`), 펼친 내용의 머리와 `<pre>`(token만, `.mono`의 `--font-mono`), note를 더한다. 지금 `.tool`·`.toolHead`·`.toolSub`의 모양(작은 글, 왼쪽 선)을 따른다. 값을 직접 쓰지 않고 token var를 쓴다(ui-design).
9. `packages/shell/renderer/conversation/agent-thread.tsx`
   - `case "tools"`: `<ToolLine key={entry.id} calls={entry.calls} detail={props.detail === "everything" ? "expanded" : "collapsed"} now={props.now} readBody={props.source.toolCallBody} />`.
   - `AgentThreadProps.source`의 `Pick`에 `"toolCallBody"`를 더한다. `agent-view.tsx`는 source 전체를 넘기므로 고치지 않는다.
10. `packages/shell/renderer/conversation/agent-view-model.ts`: 고칠 것이 없을 것이다(Messages는 `tools` 줄을 그대로 숨긴다). `ThreadTools` 모양을 읽는 곳이 생기면 맞춘다.
11. `packages/shell/renderer/conversation/agent-tab-fake-source.ts` (근거: ui-design "fake data", gallery가 화면 모양의 기준)
    - `tools(minutes)`를 `ToolCallView` call 배열의 `tools` 줄로 바꾼다. `report` 장면은 탐색 묶음 하나(`file.read` 둘, `file.grep` 하나, `file.glob` 하나 → "Read 2 files · Searched 1 time · Listed 1 folder")와, edit card 앞에 `description`이 있는 `shell.run` 하나(category command, 제목은 description, 예: "Count regressions per scenario")를 둔다. 제목 글은 `tool-title-core`의 template 모양(`Read docs/reports/2026-w39.md`, `Search regression in eval`, `List eval/runs/*.json`)을 따른다.
    - `working` 장면에 command 묶음 하나를 더한다: 끝난 `shell.run` 하나와 `startedAt`이 `NOW` 몇 초 전이고 `state: "running"`인 `shell.run` 하나("Ran 2 commands", 펼치면 도는 call의 시간이 보인다).
    - `toolCallBody`를 더한다: 장면의 call id마다 고정 입력·출력. `shell.run` 출력은 `{ status: "success", summary: "exit code 0", content: { exit_code: 0, stdout, stderr: "", stdout_truncated: false, stderr_truncated: false }, … }` 모양이다. 한 call의 출력은 `truncated: true`와 글 값으로 두어 잘림 note가 gallery에 보이게 한다. 없는 id와 도는 call의 출력은 `not_found`다.
    - 지금 `"Read 3 documents"` 줄과 `lines` 값은 지운다.
12. wording (근거: `wording` skill, roadmap 7 "`wording` skill로 문구를 정한다")
    - `packages/design/wording/catalog/conversation.ts`에 더한다(기존 정렬을 따른다):
      - `conversation.label.tool-read`: `{count, plural, one {Read # file} other {Read # files}}`
      - `conversation.label.tool-searched`: `{count, plural, one {Searched # time} other {Searched # times}}`
      - `conversation.label.tool-listed`: `{count, plural, one {Listed # folder} other {Listed # folders}}`
      - `conversation.label.tool-ran`: `{count, plural, one {Ran # command} other {Ran # commands}}`
      - `conversation.label.tool-web`: `{count, plural, one {Used the web # time} other {Used the web # times}}`
      - `conversation.label.tool-call-failed`: `Failed`, `conversation.label.tool-call-denied`: `Denied`, `conversation.label.tool-call-cancelled`: `Cancelled`
      - `conversation.label.tool-input`: `Input`, `conversation.label.tool-output`: `Output`
      - `conversation.note.tool-body-truncated`: `Only the first 64 KiB is shown.`
      - `conversation.error.tool-body-failed`: `Couldn't load the input and output.`
    - `conversation.label.tool-used`는 other 묶음이 계속 쓴다. `conversation.label.tool-read-documents`는 쓰는 곳이 없어지므로 지운다(앞부분 `conversation.label.tool-`로 template 호출이 없는지 grep한다). wave 3에서 이 task가 마지막이라 catalog를 같이 고치는 task가 없다(planner).
    - `deno task wording`으로 `conversation.placeholders.ts`를 다시 만든다. 손으로 고치지 않는다. 같은 wave의 `stream-shell`·`reasoning-shell`·`clock-shell`이 같은 catalog에 key를 더했으므로 충돌하면 `conversation.ts`만 풀고 다시 만든다.
13. `tools/wireframes/pages/screens/agent-chat.tsx`는 `chip-remove`가 지웠다. 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`가 통과한다.
- `deno task wireframes`가 되고 `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음. 화면과 문구다(README "위험 test", `write-test`). 묶기 함수도 test하지 않는다.
- 남지 않음:
  - `grep -rnw "bucketOf\|lineOf\|ToolLineView" packages/shell tools --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`가 0줄이다.
  - `grep -rn "tool-read-documents\|Read 3 documents" packages/shell tools --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`가 0줄이다.
- gallery(ui-design "확인"):
  - `new-agent-session-archived`(`report` 장면)에 "Read 2 files · Searched 1 time · Listed 1 folder" 줄과 description 제목의 command 줄이 있다. 묶음 줄을 누르면 call마다 제목과 시간이, call 줄을 누르면 Input·Output이 열리고 잘린 출력에는 note가 붙는다.
  - 보기 select를 Everything으로 바꾸면 묶음은 펼쳐지고 call 내용은 닫혀 있다. Messages면 tool 줄이 없다.
  - `new-agent-conversation`(`working` 장면)에 "Ran 2 commands" 줄이 있고 펼치면 도는 call의 시간이 보인다.
- 앱에서(lead가 merge 때 본다, README "lead가 할 일"): `deno task dev`로 tool을 여럿 부르는 turn을 돌려 도는 중의 묶음이 turn이 끝난 뒤의 묶음과 같은지 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. wording 생성물(`conversation.placeholders.ts`)을 다시 만들었음을 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다).
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"과 다르게 한 곳이 있으면 이유와 함께)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적을 것: 도는 중에는 edit/write가 보이지 않다가 turn이 끝나면 edit card나 실패 줄로 생긴다. 도는 중에 재시도한 call은 두 줄이고 snapshot은 마지막 시도 하나다(`ToolCallStarted`에 `retry_of`가 없다). 도는 중의 call 시간은 event 시각으로 센 값이라 사람 승인을 기다린 시간이 들 수 있고, snapshot의 `duration_ms`로 바뀐다. 펼친 출력은 열 때 한 번 읽으므로 도는 중에 연 call은 끝나도 출력이 저절로 생기지 않는다.
