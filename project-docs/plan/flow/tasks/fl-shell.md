# fl-shell

화면이 flow를 다룬다. workflow 탭에서 flow도 시작하고, `by: program`을 "Program"으로 보이고, `program_exited` 줄은 끝 code와 stderr 끝 줄을 보이고, sidebar의 "Flow · can't be started here"를 지운다. 화면 모양이 크게 바뀌지 않아 wireframe 승인 관문은 없다. gallery의 workflow page를 같이 맞춘다.

- 단위: shell (wave 2)
- 선행: fl-contract
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workflow/instance-view.tsx`
  - `packages/shell/renderer/workflow/instance-list.tsx`
  - `packages/shell/renderer/workflow/workflow-page.tsx`
  - `packages/shell/renderer/workflow/use-workflow.ts`
  - `packages/shell/renderer/workflow/model.ts`
  - `packages/shell/renderer/workflow/start-dialog.tsx`
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/fake-source.ts`
  - `packages/shell/renderer/workspace/sidebar/workflow-panel.tsx`
  - `packages/design/wording/catalog/workflow.ts`
  - `packages/design/wording/catalog/workflow.placeholders.ts`
  - `tools/wireframes/pages/screens/workflow.tsx`
  - `tools/wireframes/pages/screens/workflow/pages.tsx`
  - `packages/shell/renderer/app-frame/app-detail/model.ts`
  - `packages/shell/renderer/app-frame/app-detail/source.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/activity/activity-tab.tsx`
  - `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`
  - `packages/design/wording/catalog/{app-space,app-space.placeholders,conversation,conversation.placeholders}.ts`
- 읽을 것:
  - 계획: `project-docs/plan/flow/README.md`의 "화면"과 "instance와 줄"(`by: program`, `program_exited`, `lophn_restarted`, 켤 때 닫기)
  - 계약 모양: `project-docs/plan/flow/tasks/fl-contract.md`의 "모양"(`instances.ts`의 줄과 entry), `fl-workflows.md`(flow instance는 `participants: {}`, 시작은 `step` 입력을 거절, 시작 결과 `handed: null`)
  - architecture: `project-docs/architecture/workflow.md`(instance와 줄, 켤 때와 멈춤. "화면" 절은 따로 없다. 문서는 lead가 land 때 고친다), `project-docs/architecture/ui-kit.md`
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery는 renderer component를 fake source로 그린다. 모양을 덮어쓰는 CSS와 gallery 전용 prop을 두지 않는다), `.claude/skills/wording/SKILL.md`(key 이름, 마침표 규칙, 생성)
  - 지금 코드(고칠 곳):
    - `packages/shell/renderer/workflow/{workflow-page.tsx,use-workflow.ts,start-dialog.tsx,instance-view.tsx,model.ts}`
    - `packages/shell/renderer/workspace/{source.ts,core-source.ts,fake-source.ts}`, `workspace/sidebar/workflow-panel.tsx`
    - `packages/design/wording/catalog/workflow.ts`
  - 본보기(화면): `tools/wireframes/pages/screens/workflow.tsx`와 `workflow/pages.tsx`. renderer는 이미 wireframe가 쓰는 component(`WorkflowPage`)를 그대로 쓴다. 새 component를 만들지 않는다.
  - 본보기(줄을 그리는 법): `instance-view.tsx`의 `noteOf`(머리 쪽 줄)와 design `CodeBlock`(`@lophn/ui/reading`, stderr 끝 줄을 보일 때 쓴다. 새 CSS가 필요 없다)
- 계약:
  - 쓰는 것: `fl-contract`가 바꾼 protocol 출력(`LineBy` `program`, `started` 줄 step nullable, `lophn_restarted`의 step·receiver nullable, 줄 `program_exited {code: int | null, stderr_tail}`(by lophn), `WorkflowEntry.problem.reason`(`no_flow_file`, `not_agent` 없음), flow entry의 `startable`(= `flow.ts` 유무)·`steps`(by `FLOW_STEP_BY`), `StartWorkflow.output.handed` nullable, 상수 `FLOW_STEP_BY`(`packages/protocol/workflows/values.ts`). shell은 `workspace/source.ts`에 자기 view type을 두므로 거기를 맞춘다. entry는 `(problem !== null) === !startable`이다.
  - 내놓는 것: 없음(다른 task가 기대는 것이 없다).

## 정한 것 (brief가 정함)

- **flow는 시작 dialog에서 first step을 고르지 않는다.** `fl-workflows`가 flow 시작에 `step` 입력이 있으면 `invalid_input`으로 거절한다. flow의 step은 report의 자리일 뿐 시작 자리가 아니다. 입력 글만 받는다.
- **flow instance의 step 담당 글은 보이지 않는다.** `step.by === FLOW_STEP_BY`이면서 `instance.participants`에 그 key가 없을 때만 감춘다(agent workflow가 참가자 key를 `program`이라 지어도 안 가려진다).
- **`started` 줄(step null)은 step 줄 어디에도 안 들어가고 머리에도 안 둔다.** 시작 입력과 시각이 instance 머리에 이미 있다.
- **`program_exited`와 flow의 `lophn_restarted`(step null)는 머리 쪽 줄(`headLines`)로 보인다.** step이 없어서다. `program_exited`는 한 줄 글 아래에 stderr 끝 줄이 비어 있지 않을 때만 `CodeBlock`으로 보인다.
- **sidebar의 `metaOf`는 `entry.problem !== null`이면 "Has errors"(`workflow.label.invalid`)를 보인다.** flow가 `flow.ts` 없음(`startable` false이고 invalid 아님)일 때도 같은 글이다. 이유 글은 이미 줄의 `title`과 탭 머리에 있다. 새 key를 만들지 않는다.
- `workflow.error.not-startable`은 지운다. 시작 실패는 `workflow.error.start-failed` 하나로 보인다(`startable`일 때만 [Start]가 눌리므로 `conflict`는 목록을 읽은 뒤 `flow.ts`가 지워진 드문 경우뿐이다).

## 할 일

1. `workspace/source.ts`(view type. `core-source.ts`는 core 값을 그대로 옮기므로 type 말고 mapping은 바뀌지 않는다. 확인만 하고 안 고쳐도 되면 두고 보고에 적는다):
   - `WorkflowLineBy`에 `{ readonly kind: "program" }`를 더한다.
   - `WorkflowLineView`: `started`의 `step`을 `string | null`로, `lophn_restarted`의 `step`을 `string | null`·`receiver`를 `string | null`로, 새 줄 `{ readonly kind: "program_exited"; readonly code: number | null; readonly stderr_tail: string }`을 더한다.
   - `WorkflowEntryView.startable` 주석을 "false면 시작하지 못한다(invalid 또는 flow.ts가 없다)"로 고친다. `startWorkflow`의 `step?`은 그대로다(flow는 안 보낸다).
2. `workflow/model.ts`:
   - `headLines`에 `program_exited`와 `lophn_restarted` 가운데 `step === null`인 것을 더한다(주석의 "step이 없는 줄" 목록도 맞춘다).
   - `stepRows`의 `notice`는 그대로다(step이 있는 줄만 본다). TypeScript가 `started.step` null 때문에 막으면 비교만 맞춘다.
3. `workflow/instance-view.tsx`:
   - `whoOf`: `line.by.kind === "program"`이면 `t("workflow.label.role-program")`. `line.by.session`을 읽기 전에 처리한다(type 좁히기).
   - `textOf`: `program_exited` 갈래를 더한다. `code === null`이면 `workflow.note.program-signal`, 아니면 `workflow.note.program-exited`(`{code}`). `lophn_restarted`는 `line.step === null`이면 `workflow.note.restarted-flow`, 아니면 지금의 `workflow.note.restarted`. `started`의 step null은 글에 영향이 없다.
   - 머리 쪽 줄 목록(`notes.map`): `line.kind === "program_exited" && line.stderr_tail !== ""`이면 그 `<li>`에 글 아래 `<CodeBlock code={line.stderr_tail} />`를 더한다(`import { CodeBlock } from "@lophn/ui/reading"`). 나머지 줄은 그대로다. `noteOf`는 `program_exited`에도 `note-line`(누가: 글)을 쓰므로 바꾸지 않는다.
   - step 담당(`assignee`) 글: 위 "정한 것"의 조건이면 `stepWho` span을 그리지 않는다. `FLOW_STEP_BY`는 `../../../protocol/workflows/values.ts`에서 가져온다(shell은 protocol을 import할 수 있다. `check-deps`가 막으면 `model.ts`에 같은 값을 주석과 함께 적는다).
4. `workflow/workflow-page.tsx`:
   - 문제 줄의 [Refresh] 조건 `entry.invalid || entry.kind === "flow"`를 `entry.invalid`로 고친다(목록 절이 있는 탭은 거기에 [Refresh]가 있다).
   - instance 목록 절을 가리던 `entry.invalid || entry.kind === "flow"`도 `entry.invalid`로 고친다. flow도 instance 목록을 보인다.
   - 목록이 빈 `EmptyState`의 `action`은 `entry.startable`이면 [Start], 아니면 [Refresh](`state.refresh`)다(`action`은 필수 prop이다).
   - `Head`의 `entry.kind === "flow"` 갈래는 남긴다. `workflow.label.sub-flow`는 agent처럼 도는 수를 받는다(`t("workflow.label.sub-flow", { count: running })`). [Start]가 꺼진 갈래(`Tooltip`, `data-start-tip`)는 `startable` false일 때 그대로 쓴다(flow의 `no_flow_file`).
   - `StartDialog`의 `onStart`는 `(text, step: string | undefined)`로 맞춘다.
5. `workflow/start-dialog.tsx`, `workflow/use-workflow.ts`:
   - dialog: `entry.kind === "flow"`이면 "First step" `Select`를 그리지 않고 `onStart(text, undefined)`를 부른다. 입력 도움 글은 flow면 `workflow.note.input-help-flow`다.
   - `use-workflow.ts`: `start(text: string, step?: string)`. `source.startWorkflow({workflow, text, step})`(undefined면 core-source가 칸을 빼므로 그대로 둔다). 실패 `body`는 `t("workflow.error.start-failed")` 하나로 하고 `conflict` 갈래를 지운다.
6. `workspace/sidebar/workflow-panel.tsx`: `metaOf`에서 `!entry.startable` 갈래(`workflow.label.not-startable`)를 지운다. `entry.problem !== null`이면 "Has errors"를 돌려준다(invalid는 항상 problem이 있어 `entry.invalid` 갈래는 이것으로 합친다).
7. wording (`packages/design/wording/catalog/workflow.ts`. 정렬은 지금 순서를 따른다):
   - 지운다: `workflow.label.not-startable`, `workflow.error.not-startable`. 지우기 전에 앞부분 `workflow.error.`·`workflow.label.not-`으로 `packages`와 `tools`(catalog·placeholders 제외)를 grep해 template 호출이 없음을 본다.
   - 고친다: `workflow.label.sub-flow` → `"flow · {count, number} running"`(`sub-agent`와 같은 꼴).
   - 더한다:
     - `workflow.label.role-program`: `"Program"`
     - `workflow.note.program-exited`: `"The program exited with code {code}."`
     - `workflow.note.program-signal`: `"The program was stopped before it finished."`
     - `workflow.note.restarted-flow`: `"lophn restarted while the flow was running, so the flow ended. It isn't started again."`
     - `workflow.note.input-help-flow`: `"The flow gets this text as its input."`
   - 값 이름 `{code}`가 `t`의 값 type과 맞는지 `check-wording`으로 본다(숫자를 받지 못하면 문자열로 넘긴다). `.placeholders.ts`는 손으로 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
8. `workspace/fake-source.ts` (gallery도 이것을 쓴다. `FAKE_WORKFLOW_INSTANCES`의 앞 여섯 순서를 바꾸지 않는다. 새것은 뒤에 붙인다):
   - `FAKE_WORKFLOWS`: `nightly-flow`를 `startable: true`, `problem: null`, `steps` 셋(`fetch`·`summarize`·`publish`, 각 `by: "program"`, `with: null`, `next: []`)으로 바꾼다(`not_agent` 문구를 지운다). 끝에 `missing-flow`를 더한다: `kind: "flow"`, `startable: false`, `invalid: false`, `steps: null`, `problem: {reason: "no_flow_file", message: "flow.ts is missing in the workflow folder."}`.
   - 줄 helper: `program = { kind: "program" } as const`, program이 낸 report를 만드는 함수(`by: program`, `session: "new"`, `next: null`).
   - flow instance 셋(`nightly-flow`, `participants: {}`, steps는 위 entry에서 옮기고 `prompt`·`in`·`out`은 `""`, `started` 줄 step은 null):
     - 도는 것: `current: {step: "summarize", human_turn: false}`, 줄은 `started`(by user), `fetch` report, `summarize` report(진행 글, `next` null).
     - `program_exited`로 닫힌 것: job이 시작(`started_by` job, 제목 있음), 줄은 `started`, `fetch`·`summarize` report, `program_exited`(by lophn, `code: 1`, `stderr_tail`은 세 줄짜리 deno 오류 글), `ended`(by lophn). `state: "ended"`, `current: null`.
     - 켜질 때 닫힌 것: 줄은 `started`, `fetch` report, `lophn_restarted`(step null, receiver null), `ended`. `state: "ended"`.
   - `startWorkflow`: entry가 flow(`kind === "flow"`)면 `step`을 `invalid_input`으로 거절하고, 만들 instance는 `participants: {}`, `current: null`, `started` 줄 step null로 한다. `steps`가 `null`이면 `conflict`는 그대로다.
9. `tools/wireframes/pages/screens/workflow/pages.tsx`와 `workflow.tsx`:
   - `pages.tsx`: 새 instance id 셋을 `FAKE_WORKFLOW_INSTANCES.map`의 destructure 뒤에 이어 받는다. 옛 `Flow`(꺼진 [Start]의 tooltip을 여는 drive)는 `FlowMissing`으로 이름을 바꿔 `missing-flow`를 그린다. 새 `Flow`는 `nightly-flow`의 도는 instance를, `FlowExited`는 `program_exited` instance를, `FlowRestarted`는 켜질 때 닫힌 instance를, `StartDialogFlow`는 `nightly-flow`에서 `fillStartDialog`한 dialog를 그린다.
   - `workflow.tsx`: 옛 `workflow-tab-flow`는 id를 그대로 두고 설명만 "startable flow의 도는 instance(Program report, 담당 글 없음)"로 고친다. 새 page를 더한다: `workflow-tab-flow-exited`(Program 종료 줄과 stderr 끝 줄, 상태 Ended), `workflow-tab-flow-restarted`(lophn이 다시 켜져 닫힘), `workflow-tab-flow-missing`(`flow.ts` 없음. [Start] 꺼짐, tooltip 열어 둠), `workflow-start-dialog-flow`(first step 칸 없음). title은 영어, description은 한국어 한두 문장이다. 영역 `summary`에 flow를 한 마디 더한다.
   - 새 id는 주소라 정하면 바꾸지 않는다. `pages/index.ts`는 영역이 같아 고치지 않는다.

10. flow의 앱 호출 이름 (planner가 더함). `fl-contract`가 부르는 쪽에 `{kind: "flow", instance}`를 더하면, 지금은 앱 activity 화면(`app-frame/app-detail/model.ts`의 `app-detail.label.caller-program`)과 session rewind 목록(`conversation/agent-tab-core-source-rewind.ts`의 `callerName`)이 그 호출을 "Scheduled job"으로 보인다. `flow` 갈래를 따로 두어 "Workflow"로 보인다(wording key `app-detail.label.caller-flow`, `app-detail.label.called-by-flow`, `conversation.label.rewind-caller-flow`. 문구는 `caller-flow`·`rewind-caller-flow`가 `"Workflow"`, `called-by-flow`가 `"A workflow"`로 기존 program 문구와 같은 꼴이다). job의 `program` 갈래는 그대로다. 고칠 곳: `app-detail/source.ts`의 caller view type에 `{ kind: "flow" }`, `app-detail/core-source.ts`의 `callerOf`(contract가 `case "flow"`를 `program`과 같이 두었다. 갈라서 `{kind: "flow"}`를 돌려준다), `app-detail/model.ts`(`caller-flow`)와 `activity/activity-tab.tsx`(`called-by-flow`)의 `switch`, `agent-tab-core-source-rewind.ts`의 `callerName`. placeholders는 generate로 만든다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면, 문구는 test하지 않는다)
- `deno task wireframes`가 되고, gallery의 `workflow-tab-flow`(Program report), `workflow-tab-flow-exited`(`program_exited` 줄과 stderr 끝 줄), `workflow-start-dialog-flow`가 renderer component로 그려진다. 한 화면만 보려면 `index.html?frame=<page id>`(ui-design skill "확인").
- renderer build가 선다: `deno run -A packages/shell/renderer/build.ts`.
- 남지 않음:
  - `grep -rn "can't be started\|not-startable\|not_agent" packages tools`가 0줄이다(`fl-contract`가 core의 `not_agent`를 지운 뒤다).
  - `grep -rn "kind === \"flow\"" packages/shell/renderer/workflow`는 `Head`의 sub 글과 `start-dialog.tsx`뿐이다(시작을 막던 갈래가 없다).
  - wording: `deno task wording --check`가 통과하고 `deno run --allow-read tools/check-wording.ts`에 새 warning이 없다.
- merge 뒤 lead가 `deno run -A packages/shell/renderer/build.ts`를 돈다(worker도 위처럼 build가 서는지 본다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
