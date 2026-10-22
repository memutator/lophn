# wf-screen-source

renderer가 workflow data를 읽는 통로를 만든다. 정의 목록, instance 목록·읽기, 시작, 멈춤, 그리고 instance가 바뀌었다는 신호를 듣는 hook. 사람이 wireframe(`wf-wireframe`)을 승인한 뒤에 돈다.

- 단위: shell (wave 4)
- 선행: wf-wireframe, wf-service
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/fake-source.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/shell/renderer/desktop/connection/events/hooks.tsx`
  - `packages/design/wording/catalog/workflow.ts`(새 file)
  - `packages/design/wording/catalog/workflow.placeholders.ts`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것" 가운데 "화면 (이 계획)", "시작과 멈춤"
  - 계약: 이 plan의 `tasks/wf-contract.md`의 "route"(`ListWorkflows`, `StartWorkflow`, `StopWorkflow`는 memory, `ReadWorkflowInstance`·`ListWorkflowInstances`는 read), "instance와 줄", "남지 않는 event"(`WorkflowInstanceChanged`). land한 실제 모양은 `packages/protocol/workflows/`(`routes.ts`, `instances.ts`)에서 다시 확인한다
  - 다음 계획: `project-docs/plan/workflow-shell/README.md`의 "시작 조건"과 `tasks/ws-desk-wireframe.md`, `tasks/ws-wire-selector.md`. 그 계획이 `source.workflows(project)`를 읽는다(아래 "정한 것" 1)
  - 승인된 wireframe: `tools/wireframes/drafts/workflow/`와 `tools/wireframes/mock/workflow-data.ts`(fake 기본 data의 출처. 사람이 바꾸라고 한 것이 있으면 `wf-wireframe.md` 끝 "사람이 고른 모양")
  - 본보기(코드):
    - `packages/shell/renderer/workspace/source.ts`(`WorkspaceSource`, `RunFilter`, `ReadResult`)
    - `packages/shell/renderer/workspace/core-source.ts`(`collect`, `RunListValue`, `runs`, `domains`), `fake-source.ts`(`FakeWorkspaceOptions.runs`)
    - memory route를 renderer가 부르는 꼴: `packages/shell/renderer/desktop/connection/waiting/decide.ts`(`core.call({ kind: "memory", resource, method, body })`)
    - `packages/shell/main/desktop/core/allowlist.ts`(`RENDERER_MEMORY_ROUTES`와 머리 주석), `routes.ts`(`SHELL_ROUTES`는 `ALL_ROUTES`에서 온다)
    - event 구독: `packages/shell/renderer/desktop/connection/events/client.ts`(`EventClient.subscribe`, `EventMessage`), `hooks.tsx`(`useEventClient`), `toasts/toast-host.tsx`의 `client.subscribe` 쓰임
    - wording: `packages/design/wording/en.ts`, `catalog/domain.ts`(작은 영역 file의 꼴), `.claude/skills/wording/SKILL.md`
- 계약:
  - 쓰는 것: `wf-contract`의 route와 event. 본보기는 `runs`(`WorkspaceSource.runs`, `core-source.ts`의 `collect`)
  - 내놓는 것(`wf-screen-tab`, `wf-screen-sidebar`가 기대는 것):
    - `WorkspaceSource`에 평평한 method 다섯(`runs(filter)`·`domains(project)`와 같은 꼴): `workflows(project)`(`ListWorkflows`. `ReadResult<readonly WorkflowEntryView[]>`, 틀린 선언 entry도 `invalid: true`로 담는다), `workflowInstances(filter)`(`ListWorkflowInstances`), `workflowInstance(id)`(`ReadWorkflowInstance`, 줄을 끝까지), `startWorkflow({workflow, text, step?})`, `stopWorkflow(instance)`. 결과 type은 `ReadResult`다. 화면용 view type은 protocol type의 좁힌 사본이다(renderer는 protocol을 type check하지 않는다. run 줄과 같다). entry는 `{ key, project, name, invalid, startable, kind, problem, steps, artifacts }`이고 `project`(id)와 `name`을 그대로 싣는다.
    - `fake-source.ts`: `runs`처럼 옵션으로 가짜 목록을 받는다.
    - `allowlist.ts`의 renderer memory route에 `memory:workflows/list`, `memory:workflows/start`, `memory:workflows/stop`을 더한다(`ReportWorkflow`·`EditWorkflow`는 사람 화면이 부르지 않는다. 읽기 route는 자동으로 열린다).
    - `hooks.tsx`: `useWorkflowChanges(onChange)`. `{ types: ["WorkflowInstanceChanged"] }` 조건으로 걸고 event가 오면 `onChange(event.subject, event.payload)`를 부른다. 놓친 것은 화면이 다시 읽어 맞춘다.
    - wording catalog 파일은 이 task가 만들고(`workflow.*` key, 오류 문구부터), `wf-screen-tab`·`wf-screen-sidebar`가 이어 key를 더한다. 생성물과 `en.ts` 등록은 lead 몫이다.

## 정한 것

1. **읽기는 모두 평평한 method다. 목록 읽기 이름은 `workflows(project)`다**(planner가 정했다). `workflow-shell`(README, `ws-wire-selector`)이 `source.workflows(project)`를 부르고 `WorkspaceSource`의 다른 읽기(`runs(filter)`, `domains(project)`, `createDomain`)도 평평하다. `WorkspaceSource`에 이렇게 더한다.
   ```ts
   workflows(project: string): Promise<ReadResult<readonly WorkflowEntryView[]>>;          // ListWorkflows
   workflowInstances(filter: WorkflowInstanceFilter): Promise<ReadResult<readonly WorkflowInstanceSummaryView[]>>; // ListWorkflowInstances
   workflowInstance(instance: string): Promise<ReadResult<WorkflowInstanceDetailView>>;     // ReadWorkflowInstance, 줄을 끝까지
   startWorkflow(input: { workflow: string; text: string; step?: string }): Promise<ReadResult<{ instance: string }>>; // StartWorkflow
   stopWorkflow(instance: string): Promise<ReadResult<null>>;                               // StopWorkflow
   ```
   `ReadResult`의 실패 `message`는 다른 읽기와 같이 오류 code 글(`conflict`, `not_found` 등)이다. `workflow`(start의 입력)는 `WorkflowEntryView.key`다. `wf-screen-tab`·`wf-screen-sidebar`·`ws-wire-selector`는 이 method들로 읽는다.
2. **`workflows(project)`가 `workflow-shell`의 계약이다. `workflow-shell`은 따로 만들지 않는다.** entry는 `WorkflowEntryView`이고 칸은 이렇다. 이름을 바꾸지 않는다.
   ```ts
   interface WorkflowEntryView {
     readonly key: string;        // 보이는 이름 `<project 이름>/<name>`. StartWorkflow 입력으로도 쓴다
     readonly project: string;    // prj id
     readonly name: string;       // workflow 이름(slug). 자리·탭의 key는 project 안에서 이것이다
     readonly invalid: boolean;   // 선언이 틀렸다(protocol `state === "invalid"`)
     readonly startable: boolean; // false면 시작하지 못한다(invalid 또는 kind flow)
     readonly kind: "agent" | "flow" | null;
     readonly problem: { readonly reason: string; readonly message: string } | null;
     readonly steps: readonly { name: string; by: string; with: string | null; next: readonly string[] }[] | null; // 시작 dialog의 step 고르기
     readonly artifacts: { readonly static: boolean; readonly instance: boolean };
   }
   ```
   `invalid`는 목록에 남는다(자리를 잃지 않게 하려는 `workflow-shell`의 요구). 읽기 실패는 `ok: false`다. 빈 목록으로 돌려주지 않는다. `workflow-shell`의 desk selector가 쓰는 `{ name, invalid }`는 이 type의 부분집합이라 `ws-wire-selector`는 이 type을 import하면 된다(desk key는 `entry.name`).
3. **화면용 view type은 `source.ts`에 두는 protocol type의 좁힌 사본이다**(renderer는 protocol을 type check하지 않는다. `RunRecordView`와 같다). 다음을 `source.ts`에 낸다: `WorkflowEntryView`, `WorkflowInstanceFilter`(`{ project: string; workflow?: string; state?: "running" | "ended" | "stopped" }`), `WorkflowInstanceSummaryView`(`id, project, workflow, state, current, input, created_at, finished_at, last_line`), `WorkflowInstanceDetailView`(`{ instance: WorkflowInstanceView; last_reports: Record<string, WorkflowLineView>; lines: readonly WorkflowLineView[] }`), `WorkflowInstanceView`(`wf-contract`의 `WorkflowInstance`에서 `state_seq`만 뺀 것), `WorkflowLineView`(`kind`로 가르는 합. `wf-contract`의 줄 표 그대로 여덟 종류, `lophn_restarted` 포함). 이 파일은 순수 `.ts`라 `.tsx`에서 가져오지 않고 값을 import하지 않는다(source.ts 머리 주석이 말하는 css import 문제).
4. **`start`와 `stop`은 core의 결과를 `instance` id와 `null`로 줄인다.** 이유: 시작이 `not_handed`로 끝나도 줄이 남으므로 화면은 instance를 다시 읽어 보인다(`handed` 결과를 따로 들고 있지 않는다).
5. **fake의 기본 목록은 비어 있지 않다.** `runs`와 다르다. 이유: `ws-desk-wireframe`·`ws-wire-selector`가 정상 workflow 둘과 틀린 선언 하나를 기대하고(gallery, `dev:mock`, `dev-seed.ts`의 `SEEDED`는 `...FAKE`를 펼쳐 받는다), 이 task는 화면을 더하지 않아 기존 gallery page 모양이 바뀌지 않는다. 기본값은 `wf-wireframe`의 `mock/workflow-data.ts`와 같은 이름을 쓴다(`phroner/eval-loop`, `phroner/paper-review`, `phroner/broken-draft`, `phroner/nightly-flow`).
6. **event 신호만 듣는다.** `useWorkflowChanges`는 `ready`·`disconnected`를 따로 처리하지 않는다. 이유: 계약이 정한 대로 놓친 것은 화면이 열릴 때와 [Refresh]에서 다시 읽어 맞춘다. 끊겼다 붙으면 그 사이 바뀐 것은 다음 event나 [Refresh]까지 안 보일 수 있다(보고의 "알려진 미완 동작").
7. **wording 영역 file을 이 task가 만든다.** 영역 이름은 `workflow`이고 key는 `workflow.<part>.<name>`이다(이 plan의 다른 화면 task가 같은 file에 key를 더한다). `en.ts`와 `placeholders.ts` 등록은 lead 몫이라고 계약 줄이 말하지만, 등록이 없으면 `deno task wording`이 이 file을 만들지 못하고 `deno task check`가 서지 않는다. 그래서 lead가 이 task를 띄우기 전에 빈 영역을 등록해 두지 않았으면 worker가 한다: `en.ts`의 import 한 줄·`AREAS` 한 칸·`en` spread 한 칸과 `placeholders.ts`의 import와 `&` 한 칸(`.claude/skills/wording/SKILL.md` "새 영역 file"). 한 일은 "넘길 줄"에 적는다.

## 할 일

1. `packages/shell/renderer/workspace/source.ts`: 위 "정한 것" 3의 view type을 더하고 "정한 것" 1의 method 다섯을 `WorkspaceSource`에 더한다(주석은 "왜"만. `workflows`: workflow 정의 목록과 틀린 선언 이유, `workflow-shell`도 읽는다). `RunFilter`가 있는 자리 옆에 `WorkflowInstanceFilter`를 둔다.
2. `packages/shell/renderer/workspace/core-source.ts`: 응답 모양 interface를 다른 응답 옆에 더하고(`WorkflowListValue`, `WorkflowInstanceListValue`, `WorkflowReadValue`) method를 더한다. 실패는 다른 읽기와 같이 `{ ok: false, message: reply.error?.code ?? "internal" }`다.
   - `workflows(project)`: `core.call({ kind: "memory", resource: "workflows", method: "list", body: { project } })`. 목록은 page가 없다. 응답의 칸을 `WorkflowEntryView`로 옮긴다(`invalid`는 `state === "invalid"`).
   - `workflowInstances(filter)`: `collect(core, "workflow_instances", "list", { ...filter }, …)`로 모은다(새것이 앞, 50개씩, `PAGE_LIMIT`까지). `WorkflowInstanceSummaryView`의 칸만 옮긴다.
   - `workflowInstance(id)`: `workflow_instances/read`를 `{ instance, cursor? }`로 `next_cursor`가 null일 때까지 읽어 `lines`를 이어 붙인다(`collect`는 줄만 모으는 꼴이라 맞지 않으므로 작은 반복문을 따로 쓴다). `instance`와 `last_reports`는 마지막으로 읽은 page의 것을 쓴다. `PAGE_LIMIT`을 넘으면 거기까지다.
   - `startWorkflow`: memory `workflows/start`, body `{ workflow, text, ...(step === undefined ? {} : { step }) }`. 성공하면 `{ ok: true, value: { instance: <응답의 instance.id> } }`.
   - `stopWorkflow`: memory `workflows/stop`, body `{ instance }`. 성공하면 `{ ok: true, value: null }`.
3. `packages/shell/renderer/workspace/fake-source.ts`: `FakeWorkspaceOptions`에 `workflows?: readonly WorkflowEntryView[]`와 `workflowInstances?: readonly WorkflowInstanceDetailView[]`를 더한다. 기본값은 이 file이 내는 상수 `FAKE_WORKFLOWS`, `FAKE_WORKFLOW_INSTANCES`다("정한 것" 5. `tools/wireframes/mock/workflow-data.ts`에서 옮긴다. renderer가 `tools/`를 import하지 못하므로 복사이고 시각은 고정 ISO 글이다. `lophn_restarted` 줄이 있는 instance도 mock 그대로 옮긴다).
   - `workflows`는 목록을 `project` 인자와 상관없이 돌려준다. `workflowInstances`는 `filter`의 `workflow`와 `state`로 거르고 각 detail에서 summary를 만든다(`last_line`은 `lines`의 마지막). `workflowInstance`는 detail을 돌려주고 없으면 `{ ok: false, message: "not_found" }`.
   - `startWorkflow`는 메모리의 목록 맨 앞에 running detail 하나를 더한다(`started` 줄 하나, `current`는 고른 step 또는 첫 step). `startable`이 false인 workflow는 `{ ok: false, message: "conflict" }`다. `stopWorkflow`는 `state: "stopped"`와 `stopped` 줄을 더하고, 이미 `stopped`이면 `conflict`다. 실제 core와 같은 규칙만 흉내 낸다.
4. `packages/shell/main/desktop/core/allowlist.ts`: `RENDERER_MEMORY_ROUTES`에 `"memory:workflows/list"`, `"memory:workflows/start"`, `"memory:workflows/stop"`을 더하고 머리 주석 목록에 한 줄을 더한다("workflow 목록 읽기와 시작·멈춤(Workflows 탭과 sidebar)"). `ReportWorkflow`·`EditWorkflow`는 사람 화면이 부르지 않으므로 더하지 않는다. 읽기 route(`read:workflow_instances/list`, `read:workflow_instances/read`)는 `ALL_ROUTES`에 있으면 자동으로 열린다. `packages/protocol/mod.ts`의 `ALL_ROUTES`에 workflows route가 없으면(lead 등록) 고치지 말고 "등록할 것"에 적는다. 새 test는 더하지 않는다. 이유: 사람 화면이 부르는 memory route 세 개를 목록에 더할 뿐이고, agent용 `report`·`edit`을 더하지 않는 것이 이 경계의 전부다.
5. `packages/shell/renderer/desktop/connection/events/hooks.tsx`: `useWorkflowChanges(onChange: (instance: string, payload: { project: string; workflow: string }) => void): void`를 더한다. `useEventClient()`로 client를 얻고 `useEffect`에서 `client.subscribe({ types: ["WorkflowInstanceChanged"] }, (message) => …)`로 건다. `message.kind === "event"`이고 `event.type === "WorkflowInstanceChanged"`이면 `onChange(event.subject, event.payload)`다. 최신 `onChange`는 ref로 들어 effect가 매 render 다시 걸리지 않게 한다. 정리 함수에서 구독을 푼다. event type 값은 `wf-contract`가 land한 `packages/protocol/events/transient.ts`의 이름을 쓴다.
6. `packages/design/wording/catalog/workflow.ts`(새 file)와 생성물 `workflow.placeholders.ts`: 영역 `workflow`를 만든다(위 "정한 것" 7). 이 task가 쓰는 key는 읽기·시작·멈춤이 실패했을 때 화면이 보일 오류 문구뿐이다: `workflow.error.load-failed`, `workflow.error.instances-failed`, `workflow.error.start-failed`, `workflow.error.stop-failed`, `workflow.error.not-startable`. 값은 `domain.error.load-failed`("Couldn't load the domains.")와 같은 문체의 완성된 한 문장이고 마침표가 있다. `INTERNAL_WORDS`(`run`, `call`, `claim` 등)를 쓰지 않는다. 그다음 `deno task wording`으로 생성물을 만든다(손으로 고치지 않는다).
7. 도는 곳이 맞는지 본다: `deno task check`, `deno run -A packages/shell/renderer/build.ts`. 이 task는 화면을 더하지 않으므로 gallery 모양은 바뀌지 않아야 한다(`deno task wireframes`가 서고 기존 page가 같다).

## 끝남

- `deno task check`가 통과한다. `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 서고 기존 gallery page 모양이 바뀌지 않는다. `deno run -A packages/shell/renderer/build.ts`도 선다.
- 남지 않음: `grep -rn '"workflows"' packages/shell/renderer --include=*.ts --include=*.tsx`가 `workspace/core-source.ts` 한 곳이다(route를 부르는 곳이 하나다).
- `workflows(project)`의 모양이 위 "정한 것" 2와 같다(`workflow-shell`의 `ws-wire-selector`가 이 type을 그대로 쓴다).
- 위험 test: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. `ALL_ROUTES`에 workflows route가 없었으면 그것, wording 영역 등록(worker가 했으면 한 일)과 `deno task wording`을 돌렸는지
- 안 쓰게 된 export: 없음이 정상이다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 적어도 `en.ts`·`placeholders.ts`를 고쳤으면 그것
- 계약 바꾸기 요청: 고정 계약을 바꿔야 하면 여기에 적는다.
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: event를 놓친 동안 바뀐 instance는 다음 event나 [Refresh]까지 안 보인다
