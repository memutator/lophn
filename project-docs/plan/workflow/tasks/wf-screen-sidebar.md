# wf-screen-sidebar

project sidebar의 activity bar(`wf-sidebar-activity`가 만든다)에 Workflows 항목을 더한다. 항목을 누르면 workflow 목록 panel이 열리고, 줄을 누르면 workflow 탭(`wf-screen-tab`)이 열린다. 모양은 승인한 wireframe(`wf-wireframe`)이 정한다.

- 단위: shell (wave 6)
- 선행: wf-screen-tab, wf-sidebar-activity
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/workflow-panel.tsx`(새 file)
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`(항목 한 줄, 본문 가지, prop 하나만. 틀은 `wf-sidebar-activity`가 먼저 고쳤다. 선행으로 순서를 정했다)
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.module.css`
  - `packages/shell/renderer/workspace/workspace.tsx`(정확히 두 줄. `wf-sidebar-activity`도 이 file의 `onRail`을 지웠다. 선행으로 순서를 정했다)
  - `packages/design/wording/catalog/workflow.ts`
  - `packages/design/wording/catalog/workflow.placeholders.ts`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
- 읽을 것:
  - 시작 조건: `wf-wireframe`를 사람이 승인했다. 이 task는 승인된 wireframe 코드를 **옮긴다**. 보고 다시 그리지 않는다. activity bar와 그 틀은 `wf-sidebar-activity`가 먼저 land했다(선행). `wf-wireframe.md` 끝 "사람이 고른 모양"이 있으면 그것이 우선이다
  - 계획: `project-docs/plan/workflow/README.md`의 "화면 (이 계획)"과 "lead가 할 일"의 `workflow-shell` 순서 줄. 다음 계획 `project-docs/plan/workflow-shell/README.md`의 "시작 조건"과 `tasks/ws-wire-selector.md`(`workspace.tsx`와 `kinds/kind.ts`를 이 task 뒤에 고친다)
  - 이 plan의 brief: `wf-sidebar-activity.md`(`ActivityBar`, `ACTIVITY_ENTRIES`, `SidebarTab`), `wf-wireframe.md`("정한 것" 1의 짝표: `sidebar-workflows.tsx` → `workflow-panel.tsx`), `wf-screen-source.md`("정한 것" 1~2의 `workflows(project)`와 `workflowInstances(filter)`, `useWorkflowChanges`), `wf-screen-tab.md`(`openWorkflow`, `commonIcons.workflow`, wording 영역 `workflow`)
  - 승인된 wireframe 코드: `tools/wireframes/drafts/workflow/sidebar-workflows.tsx`와 `workflow.module.css`의 sidebar 부분, gallery page `draft-activity-bar-workflows`(Workflows가 열린 모양)
  - 본보기(코드):
    - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`(`wf-sidebar-activity`가 land한 모양: `SidebarTab`, `ACTIVITY_ENTRIES`, 본문 `domain` 가지), `sidebar/domain-panel.tsx`(탭 본문 하나가 `source`를 직접 읽는 꼴. `workflow-panel.tsx`가 따른다), `sidebar/domain-panel.module.css`
    - run 줄: `sidebar/run-list.tsx`(`RunList`, `RunMeta`, `Dot`)와 `sidebar/project-sidebar.module.css`의 `.runRow`부터 `.runState`까지(이름 아래 caption 줄과 오른쪽 끝 표시를 쓰는 법)
    - `packages/shell/renderer/workspace/workspace.tsx`: import 줄 `import { openArtifact } from "./kinds/artifact.tsx";`(99번째 줄 근처), `<ProjectSidebar … onOpenDomainDoc={…} />`(1201번째 줄 근처)
    - gallery: `tools/wireframes/pages/screens/project-window.tsx`의 `SidebarSpec`·`PageSidebar`·`useSidebarScript`(`mode: SidebarTab`으로 sidebar 모양을 고른다)와 `pages/screens/project-workspace.tsx`의 page 목록(`new-agent-sidebar-runs`), `pages/screens/project-files/pages.tsx`의 `AgentsRuns`, 항목을 `data-activity`로 누르는 drive: `pages/screens/domain/pages.tsx`의 `openDomainsTab`(`wf-sidebar-activity`가 바꿨다)
  - wording: `.claude/skills/wording/SKILL.md`, 기존 `domain.label.sidebar-tab`·`project-workspace.label.sidebar-tab-*`(항목 이름 key의 본보기)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/write-test/SKILL.md`(화면은 test하지 않는다)
- 계약:
  - 쓰는 것: `wf-screen-source`의 `workflows`, `wf-screen-tab`의 `openWorkflow`, 승인한 wireframe. 본보기는 `sidebar/domain-panel.tsx`와 run 줄(`sidebar/run-list.tsx`, `workspace.tsx`가 처음과 session 상태가 바뀔 때 읽는 법)
  - 내놓는 것:
    - activity bar의 Workflows 항목과 그 panel의 workflow 줄: 이름, 도는 instance 수, 오류 있는 workflow 표시. 처음과 `useWorkflowChanges`가 올 때 다시 읽는다. 줄을 누르면 `openWorkflow`. 접힌 모습은 activity bar가 정한다(bar만 남는다).
    - `workspace.tsx`는 `ProjectSidebar`에 `workflows` 칸을 넘기고 `host`로 탭을 여는 연결만 고친다. `workflow-shell`이 같은 file의 selector·자리 바꾸기를 고치므로 겹치는 줄은 최소로 둔다(보고에 어느 줄인지 적는다).

## 정한 것

1. **입구는 activity bar의 Workflows 항목이다**(사람이 activity bar로 정했다. 항목 순서는 Explorer, Agents, Artifacts, Domains, Workflows이고 Workflows는 끝이다). 이 task는 `ACTIVITY_ENTRIES`에 항목 한 줄, `SidebarTab`에 `"workflow"`, 본문 가지 하나를 더할 뿐 bar의 틀·접힘·누르기 동작은 건드리지 않는다(`wf-sidebar-activity`의 일). 옛 rail과 위쪽 segmented control은 이미 없다.
2. **`workflow-panel.tsx`가 `source`를 직접 읽는다.** `DomainPanel`과 같은 꼴이다. `ProjectSidebar`가 받는 새 prop은 `onOpenWorkflow` 하나이고, 목록·도는 수는 panel이 `source.workflows(project)`와 `source.workflowInstances({ project, state: "running" })`로 읽는다. 계약 줄의 "`workflows` 칸을 넘긴다"와 다르다. 이유: `workspace.tsx`를 두 줄만 고치게 해 `workflow-shell`과 겹치는 줄을 줄인다(보고의 "계약 바꾸기 요청"에도 적는다).
3. **도는 수는 workflow 이름으로 센다.** `running` instance 목록(`WorkflowInstanceSummaryView.workflow`)을 이름별로 센다. 읽기 실패는 앞 값을 둔다. 목록이 실패하면 `ErrorState`와 [Try again]. 이유: instance가 바뀔 때마다 `useWorkflowChanges`가 오므로 그때 두 목록을 다시 읽으면 된다(상태를 서버에서 거르므로 가장 단순하다).
4. **줄을 누르면 `onOpenWorkflow(entry.name)`.** `source.workflows(project)`는 `invalid` 칸(boolean)이 있는 entry를 틀린 선언까지 평평한 배열로 준다. `invalid` workflow도 열린다(탭이 이유를 보인다). `startable`이 false인 `flow`는 표시만 다르다.
5. **`workspace.tsx`는 정확히 두 줄만 고친다.** 아래 "할 일" 5. `workflow-shell`의 `ws-wire-selector`가 같은 file의 selector·자리 바꾸기를 이 task 뒤에 고친다.

## 할 일

1. **sidebar 탭을 더한다.** `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`:
   - `SidebarTab`에 `"workflow"`를 더하고 `ACTIVITY_ENTRIES` 끝에 항목 `{ key: "workflow", label: t("workflow.label.sidebar-tab"), icon: commonIcons.workflow }`를 더한다(`commonIcons.workflow`는 `wf-screen-tab`이 `icons/common.ts`에 더했다. 이름은 domain처럼 `workflow` 영역 key).
   - `ProjectSidebarProps`에 `onOpenWorkflow?: (workflow: string) => void`를 더한다(주지 않으면 아무것도 하지 않는다. `onOpenDomainDoc`과 같다).
   - 탭 본문에 `{tab === "workflow" && project !== null ? <WorkflowPanel key={project.id} project={project.id} source={source} onOpen={onOpenWorkflow ?? (() => {})} /> : null}`를 더한다.
2. **panel을 옮긴다.** `tools/wireframes/drafts/workflow/sidebar-workflows.tsx`의 `SidebarWorkflows`를 `packages/shell/renderer/workspace/sidebar/workflow-panel.tsx`의 `WorkflowPanel`로 옮긴다(모양, 순서, 이름은 그대로).
   - 박아 둔 영어 글 → `t("workflow.…")`: 탭 이름은 `workflow.label.sidebar-tab`, 머리 `workflow.heading.list`, 줄의 도는 수 `workflow.label.running-count`(ICU plural), 오류 표시 `workflow.label.invalid`, 시작 못 하는 workflow 표시 `workflow.label.not-startable`, 빈 목록 `workflow.empty.sidebar.`, 오류 `workflow.error.load-failed`(`wf-screen-source`가 만들었다)와 `common.button.retry`. 같은 뜻의 key가 `workflow.ts`에 이미 있으면 그것을 쓴다(`wf-screen-tab`이 더했다). `INTERNAL_WORDS`를 쓰지 않는다. 영역 file은 `packages/design/wording/catalog/workflow.ts`이고 그다음 `deno task wording`이다.
   - 읽기: 마운트 때와 `useWorkflowChanges`가 올 때 `source.workflows(project)`와 `source.workflowInstances({ project, state: "running" })`를 `Promise.all`로 읽는다(`live` guard, 실패하면 앞 값, 목록 실패만 `ErrorState`). 이 panel이 열려 있을 때만 읽는다(탭이 닫히면 unmount되므로 `DomainPanel`과 같다).
   - CSS: 소유 목록에 panel 전용 module.css가 없으므로 `sidebar/project-sidebar.module.css` 끝에 `.workflow…` class를 더한다(run 줄의 `.runRow`, `.sessionText`, `.label`, `.sessionMeta`를 그대로 쓸 수 있으면 새 class를 줄인다). 값은 token 변수만 쓴다. 행동 단추 열이 있으면 줄 오른쪽 끝 고정 열이다.
3. **gallery를 고친다.**
   - `tools/wireframes/pages/screens/project-window.tsx`: 소유가 `wf-sidebar-activity`와 겹치지만 선행으로 순서가 정해져 있다. `SidebarSpec.mode`는 `SidebarTab`이라 `"workflow"`가 저절로 허용된다. `PageSidebar`는 `DEMO_SOURCE`(`fakeWorkspaceSource()`)를 넘기고 이 source의 기본 목록(`FAKE_WORKFLOWS`)이 줄이 된다. 더 고칠 것이 있는지만 본다(없으면 이 file은 안 고친다).
   - `tools/wireframes/pages/screens/project-workspace.tsx`: page 목록의 `new-agent-sidebar-runs` 뒤에 승인된 sidebar page(`draft-workflow-sidebar-tab`에서 옮긴 것, id `new-sidebar-workflows`)를 더한다. 본문은 `project-files/pages.tsx`의 `AgentsRuns`와 같은 꼴(`ProjectApp`의 `sidebar={{ mode: "workflow" }}`)인 작은 component를 이 file 안에 둔다(그 file은 소유가 아니다). 기본 목록(`FAKE_WORKFLOWS`)에 도는 instance가 있는 workflow, 오류 workflow, flow가 이미 있어 이 page 하나가 그 상태들을 보인다. 빈 목록은 `ProjectApp`이 source를 못 받으므로(`project-window.tsx`의 `DEMO_SOURCE`가 고정이다) 승인된 Drafts page처럼 틀 안에 `ProjectSidebar`를 직접 세우고 `fakeWorkspaceSource({ workflows: [] })`를 넘기는 page(id `new-sidebar-workflows-empty`)로 만든다(`pages/screens/domain/pages.tsx`의 `ProjectDomainsEmpty`가 본보기). 이 component도 이 file 안에 둔다.
   - `WorkflowPanel`은 `useWorkflowChanges`를 쓰므로 `EventsProvider`가 있어야 한다. `ProjectApp`과 직접 세운 `ProjectSidebar`는 Workspace 밖이라 provider가 없다. 두 page component 모두 `<EventsProvider client={…}>`(`createEventClient(createFakeSource())`, `pages/screens/conversation.tsx`가 본보기)로 감싼다. 기존 page는 workflow 탭이 mount되지 않아 영향이 없다.
   - 접힌 모양은 `wf-sidebar-activity`가 정리했으므로 `new-sidebar-collapsed` page는 그대로다.
4. **`openWorkflow`를 sidebar에 잇는다.** `workspace.tsx`에서만 한다. 아래 5.
5. **`packages/shell/renderer/workspace/workspace.tsx`에서 고치는 줄은 정확히 두 곳이다.**
   - import: `import { openArtifact } from "./kinds/artifact.tsx";` 다음 줄에 `import { openWorkflow } from "./kinds/workflow.tsx";`를 더한다.
   - `<ProjectSidebar … />`: `onOpenDomainDoc={(domain) => void openDomainDoc(domain)}` 다음 줄에 `onOpenWorkflow={(workflow) => openWorkflow(host, workflow)}`를 더한다.
   - 이 밖은 고치지 않는다(`workflows` state, effect, `sidebar` 관련 줄 모두). 보고에 두 줄의 위치(고친 뒤 줄 번호)를 적는다.
6. **check.** `deno task wording`, `deno run --allow-read tools/check-wording.ts`, `deno task check`, `deno task wireframes`, `deno run -A packages/shell/renderer/build.ts`. 승인된 Drafts page와 옮긴 page를 Light·Dark로 나란히 보고 어긋나면 옮긴 쪽을 고친다.

## 끝남

- `deno task check`가 통과한다. `deno run --allow-read tools/check-wording.ts`에 오류가 없고 새 key에 안쪽 말 warning이 없다.
- 위험 test: 없음
- (화면) `deno task wireframes`가 되고, gallery의 project window가 workflow 입구를 보인다. `deno run -A packages/shell/renderer/build.ts`도 선다.
- 승인된 wireframe과 옮긴 page가 같은 모양이다(Light·Dark). 기존 sidebar page(Explorer, Agent, Domains)는 `wf-sidebar-activity`가 land한 모양에서 바뀌지 않았다. `domain-project-a`의 drive가 여전히 Domains 항목을 연다.
- `git diff -U0 packages/shell/renderer/workspace/workspace.tsx`가 위 "할 일" 5의 두 줄(추가 2줄)뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 없으면 "없음". `deno task wording`을 돌렸는지
- 안 쓰게 된 export: 없음이 정상이다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- **`workspace.tsx`를 고친 줄**: 위치(고친 뒤 줄 번호)와 내용 두 줄. `workflow-shell`의 `ws-wire-selector` worker가 rebase 때 대조한다
- 계약 바꾸기 요청: `ProjectSidebar`에 `workflows` 칸 대신 `onOpenWorkflow`만 더한 것(정한 것 2), `wf-screen-source`의 method나 `wf-sidebar-activity`의 항목 모양이 모자라면 그것
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
