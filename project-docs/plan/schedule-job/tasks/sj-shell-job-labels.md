# sj-shell-job-labels

job이 연 run의 줄(project sidebar의 Background, 앱 공간의 Background)과 job이 시작한 workflow instance의 줄에 job의 제목을 붙인다. 승인된 wireframe(`drafts/jobs-origin/`)대로 옮긴다. 사람이 wireframe을 승인한 뒤에 띄운다.

- 단위: shell (wave 3)
- 선행: `sj-jobs-wireframe`
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/{run-list.tsx,use-agent-panel.ts,panel-sessions.ts}`
  - `packages/shell/renderer/workspace/{source.ts,core-source.ts,fake-source.ts}`
  - `packages/shell/renderer/app-frame/app-runs.ts`
  - `packages/shell/renderer/workflow/{instance-list.tsx,instance-view.tsx,model.ts,use-workflow.ts}`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-files/pages.tsx`
  - `tools/wireframes/pages/screens/app-space/{pages,space}.tsx`
  - `tools/wireframes/pages/screens/workflow/pages.tsx`
  - `tools/wireframes/mock/app-space/data.ts`
  - `tools/wireframes/drafts/jobs-origin/` (지운다)
  - `tools/wireframes/mock/jobs-origin-data.ts` (지운다)
- 읽을 것:
  - 규칙: `AGENTS.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 승인된 draft(옮길 원본): `tools/wireframes/drafts/jobs-origin/`(`run-rows.tsx`, `instance-rows.tsx`), `tools/wireframes/mock/jobs-origin-data.ts`. 승인된 모양이 이 brief의 가정(job 제목이 이름 자리, 새 CSS class 없음)과 다르면 코드를 쓰기 전에 lead에게 보고하고 멈춘다.
  - 계약: `tasks/sj-jobs-contract.md`의 "run의 `job` 칸"·"job이 시작한 instance"·`JobRecord`·route `job.list`(user는 모든 job, 50개씩 `cursor`)
  - architecture: `project-docs/architecture/run.md` "화면", `project-docs/architecture/workflow.md` "화면"
  - 지금 main의 이름(`workflow` 계획이 land한 뒤 모양): `packages/shell/renderer/workspace/source.ts`(`RunFilter`, `WorkflowInstanceView`, `WorkflowInstanceSummaryView`, `WorkflowLineBy`, `WorkflowLineView`, `WorkspaceSource.runs`·`workflowInstances`·`workflowInstance`), `workspace/core-source.ts`(`collect`, `coreWorkspaceSource`의 `runs`·`workflowInstances`·`workflowInstance`), `workspace/fake-source.ts`(`instanceOf`, `startLines`, `FAKE_WORKFLOW_INSTANCES`, `summaryOf`, `FakeWorkspaceOptions.runs`)
  - 줄을 그리는 곳: `workspace/sidebar/{run-list.tsx (RunRecordView, RunRow, RunList, RunMeta),panel-sessions.ts (panelRuns),use-agent-panel.ts (PanelRun, agentPanelOf)}`, `app-frame/app-runs.ts (useAppRuns)`, `workflow/{instance-list.tsx (InstanceList),instance-view.tsx (InstanceView, whoOf, textOf),model.ts}`
  - 읽는 때: `workspace/workspace.tsx`(`source.runs({place: {project}})`·`source.runs({agent: {role: "lophn"}})`가 처음과 session 상태가 바뀔 때마다 돈다), `desktop/main.tsx`(앱 공간의 `runs`), `workflow/use-workflow.ts`(`WorkflowInstanceChanged`) — 이 task는 읽는 때를 바꾸지 않는다.
  - gallery: `tools/wireframes/pages/screens/{project-window.tsx (PANEL_RUNS),project-files/pages.tsx (AgentsRuns),app-space/{pages,space}.tsx,workflow/pages.tsx}`, `tools/wireframes/mock/{agents-data.ts (RUNS),app-space/data.ts (fixedRuns)}`
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 run 기록의 `job: Id<"job"> | null`(`ListRuns`가 싣는다), instance의 `started_by`(`{kind: "job", job}`, `ListWorkflowInstances`·`ReadWorkflowInstance`가 싣는다), read `job.list`(제목 찾기. route 상수는 `jobList`)
  - 내놓는 것: `RunRecordView.job`과 `PanelRun.title`/`RunRow.name`(job 제목이 있으면 agent 이름 대신), workflow 탭 instance 줄의 "시작한 쪽 = Scheduled job <제목>".
    - `WorkspaceSource`에 새 통로를 더하지 않는다. 제목은 `workspace/core-source.ts`의 기존 `runs`, `workflowInstances`, `workflowInstance` 읽기 안에서 붙인다(`RunRecordView.job: {id, title} | null`, instance의 `started_by`에 제목).

## 정한 것

- 제목은 `job.list`를 읽어 job id로 붙인다. run과 instance에는 id만 있어, 지워진 job의 옛 줄은 제목 없이 원래 이름(agent 이름, "시작한 쪽 = job")으로 보인다.
- 새 신호는 없다. 지금 run 줄이 다시 읽는 때(session event)와 instance 줄이 다시 읽는 때(`WorkflowInstanceChanged`)에 제목도 같이 맞춘다.
- 소유 밖 예외: wording catalog에 key만 더한다. `tools/wireframes/drafts/index.tsx`의 `jobs-origin` 줄은 지운 draft를 가리키던 등록 줄이라 같이 뺀다.
- 제목 붙이기는 읽는 곳(`workspace/core-source.ts`)에서 한다. `runs`(`ListRuns`)와 `workflowInstances`·`workflowInstance`가 돌려주는 값에 제목을 같이 실어 보낸다. 이유: run 줄을 읽는 곳이 둘이고(`workspace/workspace.tsx`, `app-frame/app-runs.ts`를 쓰는 `desktop/main.tsx`) 둘 다 `WorkspaceSource.runs`를 부른다. 그 둘과 `workflow/use-workflow.ts`는 이 task의 소유가 아니어서, 호출하는 쪽을 고치지 않고 source 값이 제목을 나르게 한다. 제목 표는 `core-source.ts` 안쪽 함수 하나(`readJobTitles(core)`)가 만들고 `WorkspaceSource` 쪽에는 새 method가 없다.
- 제목 표는 `job.list`를 `cursor`로 끝까지 모아(`collect`, 상한 20쪽) 만든다. run 기록이나 instance에 job이 하나도 없으면 읽지 않는다. 읽기 실패는 제목만 빠질 뿐 run·instance 읽기를 실패로 만들지 않는다(제목은 꾸밈이다).
- 화면 type: `RunRecordView.job: {id, title} | null`, `WorkflowInstanceView.started_by`와 `WorkflowInstanceSummaryView.started_by`는 `{kind: "user"} | {kind: "job", job: string, title: string | null}`(새 type `WorkflowStartedBy`). 지워진 job이면 run은 `job: null`(일반 줄처럼 agent 이름)이고 instance는 `title: null`(제목 없이 "Scheduled job"만). `started` 줄의 `by`는 `WorkflowLineBy`에 `{kind: "job", job: string}`을 더해 받는다(제목은 `detail.instance.started_by`에서 읽는다).
- core-source의 `runs`·`workflowInstances` 매핑은 칸을 하나씩 옮긴다(`id`, `kind`, …). 새 칸 `job`·`started_by`를 그 목록에 더하지 않으면 값이 화면에 닿지 않는다. 이 둘이 빠지면 제목이 조용히 안 보인다. fake source는 이 매핑을 거치지 않아 gallery만 봐서는 누락을 못 잡으므로 core-source 매핑을 직접 읽어 확인한다. 응답의 raw type(`RunListValue`, `WorkflowInstanceListValue`, `WorkflowReadValue`)에도 새 칸(`job: string | null`, `started_by`)을 더한다.
- 새 page를 등록하지 않는다. 영역 file(`pages/screens/workflow.tsx`, `project-workspace.tsx`, `app-space.tsx`)은 소유 밖이다. 있는 page의 fixture를 바꿔 보인다: sidebar는 `project-window.tsx`의 `PANEL_RUNS`에서 run 두 개에 job 제목을 붙이고(`mock/agents-data.ts`는 소유 밖이라 거기서 `run-1`·`run-5`의 id로 매핑한다), 앱 공간은 `mock/app-space/data.ts`의 `fixedRuns`에 job 제목이 붙은 agent run 하나와 tool run 하나, workflow는 `FAKE_WORKFLOW_INSTANCES`의 `ended`를 job이 시작한 것으로 바꾼다(그 instance는 모든 workflow page의 목록 줄에도 보인다. page description이 시작한 쪽을 말하지 않아 바꿀 글이 없다).
- 새 CSS class를 더하지 않는다. `run-list.tsx`·`instance-list.tsx`·`instance-view.tsx`의 `.module.css`는 소유가 아니다. draft가 새 class를 요구하면 멈추고 보고한다.
- 소유 밖 예외: wording catalog에는 key만 더한다. `run-list.*`는 `packages/design/wording/catalog/project.ts`, `workflow.*`는 `catalog/workflow.ts`에 있다(생성물은 `deno task wording`). 같은 wave의 다른 renderer task와 영역 file이 겹치지 않는다. `tools/wireframes/drafts/index.tsx`의 `// jobs-origin` 주석 줄 아래 import와 spread는 지운 draft를 가리키던 등록 줄이라 같이 뺀다.

## 할 일

1. 승인 확인(위 "읽을 것"). draft page를 `?frame=draft-jobs-origin-runs&theme=light` 등으로 열어 지우기 전 기준을 눈으로 본다. 아래 이름이 main과 다르면 현재 main에서 같은 일을 하는 이름을 찾아 쓴다.
2. source type. `workspace/source.ts`:
   - `WorkflowStartedBy`를 더하고 `WorkflowInstanceView.started_by`(지금 `WorkflowLineBy`)를 이것으로 바꾼다. `WorkflowInstanceSummaryView`에 `started_by`를 더한다. `WorkflowLineBy`에 `{kind: "job"; job: string}`.
   - `workspace/sidebar/run-list.tsx`의 `RunRecordView`에 `job: {id, title} | null`.
   - `WorkflowLineBy`(`started` 줄의 `by`), `WorkflowInstanceView.started_by`, `WorkflowInstanceSummaryView.started_by` 셋이 모두 job 갈래를 갖는지 본다. 하나라도 빠지면 화면 값이 닿지 않는다.
3. 읽기. `workspace/core-source.ts`:
   - `readJobTitles(core)`: `jobList`(`packages/protocol/jobs/jobs.ts`)의 `resource`·`method`로 `job.list`를 `collect`로 모아 `Map<id, title>`. 실패는 빈 표다.
   - `runs`: 응답의 `run.job`(id 또는 null)을 모은 뒤 job이 있는 항목이 있을 때만 `readJobTitles`를 읽어 `job: {id, title}`로 바꾼다. 표에 없으면 `null`. 매핑 목록에 칸을 더한다.
   - `workflowInstances`와 `workflowInstance`: 응답의 `started_by`가 `{kind: "job", job}`이면 같은 방식으로 `title`을 붙인다. `workflowInstances`의 칸 목록에 `started_by`를 더한다. 상세의 `instance`는 지금 통째로 넘기므로 제목만 덧붙인다.
4. 줄. draft의 `run-rows.tsx`·`instance-rows.tsx`를 옮긴다(보고 다시 그리지 않는다).
   - `workspace/sidebar/run-list.tsx`: `RunRow`에 draft가 보인 칸(예: 제목이 있을 때 둘째 줄의 agent·tool 이름)을 더하고 `RunList`·`RunMeta`가 그린다.
   - `workspace/sidebar/panel-sessions.ts`의 `panelRuns`와 `workspace/sidebar/use-agent-panel.ts`의 `PanelRun`·`agentPanelOf`: `PanelRun.title`(`record.job?.title ?? null`)을 나르고 `RunRow.name`은 제목이 있으면 제목이다.
   - `app-frame/app-runs.ts`: tool run과 agent run의 `RunRow.name`을 같은 규칙으로 정한다(tool run은 tool 이름, agent run은 agent 이름이 둘째 줄로 간다).
   - `workflow/instance-list.tsx`: 줄 meta에 draft가 보인 job 표시. `workflow/instance-view.tsx`: 머리에 "시작한 쪽" 줄, `whoOf`에 `line.by.kind === "job"` 분기(`started` 줄은 job으로 시작한 줄이다. 글은 `detail.instance.started_by`의 제목으로 만든다: 제목이 있으면 "Scheduled job <제목>", `title: null`이면 "Scheduled job". 이 분기를 빼면 `line.by.session` 때문에 type check가 깨지고, 깨지지 않게 막아도 job 줄이 "Unknown"(`workflow.label.role-unknown`)으로 보인다). `workflow/model.ts`: 제목 글을 만드는 순수 함수가 필요하면 여기에 둔다.
   - `workflow/use-workflow.ts`: 읽는 때는 그대로다. type만 따라가야 하면 고친다.
5. fake와 gallery.
   - `workspace/fake-source.ts`: `instanceOf`에 `started_by` 인자를 더하고 `ended`를 job이 시작한 것으로(`startLines`의 `by`도 `{kind: "job", job}`), `summaryOf`가 `started_by`를 옮긴다. `FakeWorkspaceOptions.runs`로 job이 붙은 run을 줄 수 있다.
   - gallery fixture: `project-window.tsx`의 `PANEL_RUNS`, `mock/app-space/data.ts`의 `fixedRuns`(위 "정한 것"). `project-files/pages.tsx`·`app-space/{pages,space}.tsx`·`workflow/pages.tsx`는 fixture 변경에 맞춰 주석과 `source`를 고친다.
6. wording. `catalog/project.ts`에 `run-list.label.*`(job 표시 글), `catalog/workflow.ts`에 `workflow.label.*`(시작한 쪽 "Scheduled job"과 제목 있는/없는 글, 목록 줄 meta). 화면 글에 `run`·`claim`·`call`·`grant`를 쓰지 않는다. 먼저 같은 뜻의 key를 grep한다. `deno task wording`, `deno run --allow-read tools/check-wording.ts`.
7. 걷어내기. `tools/wireframes/drafts/jobs-origin/`, `tools/wireframes/mock/jobs-origin-data.ts`, `drafts/index.tsx`의 `// jobs-origin` 줄 아래 import와 spread.

## 끝남

- `deno task check`와 `deno run -A packages/shell/renderer/build.ts`가 통과하고 `deno task wireframes`가 된다.
- gallery의 기존 page(`project-files`의 Background, `app-space`의 Background, workflow 탭의 `ended`와 목록)에서 job 제목이 draft(지우기 전에 나란히 대조한다)와 같은 모양으로 보인다. Light와 Dark.
- `core-source.ts`가 `ListRuns`·`ListWorkflowInstances` 응답의 새 칸(`job`, `started_by`)을 화면 값으로 옮긴다(위 "정한 것"의 매핑 항목을 코드로 확인한다).
- 화면 글이 모두 wording key이고 `deno run --allow-read tools/check-wording.ts`가 통과한다.
- 남지 않음: `grep -rn "jobs-origin" tools packages`가 0줄이다.
- 위험 test: 없음(화면은 test하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`catalog/project.placeholders.ts`, `catalog/workflow.placeholders.ts`)은 이 task가 `deno task wording`으로 만든다. lead가 더할 것은 없다.
- 안 쓰게 된 export: 없음이 기본
- 정한 것: 문서에 답이 없어 worker가 정한 것(제목이 없을 때 글, 둘째 줄 칸)
- 넘길 줄: 호출하는 쪽(`workspace.tsx`, `desktop/main.tsx`)은 건드리지 않았다
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 읽을 때마다 `job.list`를 끝까지 읽는다면 적는다(job이 있는 run·instance가 있을 때만 읽는다). 없음이 기본
- **알려진 미완 동작**: job 제목을 바꾸거나 지워도 run 줄은 다음에 다시 읽을 때(session 상태가 바뀔 때) 맞는다. `JobChanged`로 맞추지 않는다.
