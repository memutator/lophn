# ws-wire-selector

title bar 왼쪽에 승인된 `ProjectSelector / DeskSelector` 경로를 달고(파일 경로 breadcrumb을 뺀다) project와 자리를 바꾸게 한다. selector의 선택지는 기본 자리와 project의 workflow 목록이다. workflow 자리를 처음 열면 그 workflow의 탭이 열린 layout으로 시작하고, 목록에서 사라진 workflow의 자리는 기본 자리로 합친다. wireframe 승인 뒤에 돈다.

- 단위: wire (wave 3)
- 선행: ws-wire-state, ws-desk-wireframe. 앞은 이 task가 쓰는 state이고, 뒤는 사람이 승인한 selector 모양이다.
- 시작 조건: 계획 `workflow`의 `wf-screen-sidebar`(그 앞의 `wf-screen-tab`, `wf-screen-source` 포함)가 main에 land했다. 그 task들이 workflow 탭 kind와 workflow 목록 읽기(`source.workflows(project)`)를 내놓는다. lead가 확인한 뒤에 띄운다(`status.py`의 선행 줄은 이 계획의 id만 읽는다). lead가 시작할 때 이 task의 소유에 `packages/shell/renderer/workspace/kinds/workflow.tsx`(`wf-screen-tab`의 file)를 더한다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/workspace/kinds/kind.ts`
  - `packages/design/wording`(key만)
- 읽을 것:
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것"(selector 목록, 사라진 workflow는 기본 자리로 합친다)과 "사람이 정할 것"
  - 승인된 wireframe: gallery의 `project-desk-*` page(`tools/wireframes/pages/screens/project-desk.tsx`)와 사람의 승인 때 정한 것(ws-desk-wireframe의 보고)
  - 계약 brief: `project-docs/plan/workflow-shell/tasks/ws-wire-state.md`(`switchTo`, `mergeVanished`), `ws-desk-wireframe.md`(`DeskSelector`, `ProjectSelector`. 끝의 "사람 피드백 반영" 절), `ws-model.md`(`DEFAULT_DESK`, `vanishedDesks`)
  - 계획 `workflow`: `project-docs/plan/workflow/tasks/wf-screen-source.md`(`WorkspaceSource.workflows(project)`가 주는 `WorkflowEntryView`: `name`, `invalid: boolean`, 틀린 선언도 담은 평평한 배열), `wf-screen-tab.md`(탭 kind `workflow`, `workflowTab`, `openWorkflow`), `wf-screen-sidebar.md`(`WorkflowPanel`이 source를 직접 읽고 `workspace.tsx`는 두 줄만 고친다)
  - 코드: land한 `workspace/workspace.tsx`(`TopBar` 호출부, `openTab`, `wf-screen-sidebar`가 고친 두 줄), `workspace/kinds/kind.ts`(`TabKindDef`), `workspace/kinds/workflow.tsx`(`wf-screen-tab`이 land한 것)
  - skill: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`(wireframe을 옮기는 규칙)
- 계약:
  - 쓰는 것
    - ws-desk-wireframe: `DeskSelector`, `DeskOption`, `DeskSelectorProps`, `ProjectSelector`, `ProjectOption`, `ProjectSelectorProps`
    - ws-wire-state: `desks`, `switchTo(key, seed)`, `mergeVanished(liveKeys)`, `emptyView`
    - 계획 `workflow`: `source.workflows(project)`(`ReadResult<readonly WorkflowEntryView[]>`. entry의 `name`과 `invalid`. 틀린 선언도 담긴다), workflow 탭 kind(`packages/shell/renderer/workspace/kinds/workflow.tsx`)가 내놓는 `workflowTab(name: string, instance?: string): TabItem`(`wf-screen-tab`이 내놓는 순수 함수. `openWorkflow`도 이것을 쓴다). 이 이름이 없으면 시작하지 말고 lead에게 알린다.
  - 내놓는 것
    - selector 입력 만들기: `options = [{ key: DEFAULT_DESK, label: <기본 자리 label> }, ...entries.map(e => ({ key: e.name, label: e.name, invalid: e.invalid }))]`, `active = desks.active`, `onSelect = (key) => switchTo(key, seed(key))`. `seed(key)`는 workflow 탭이 열린 `WorkspaceView`(`openTabIn(emptyView(), workflowTab(key), () => false)`). desk key는 `entry.name`이다. 이미 있는 자리로 가면 seed는 쓰이지 않는다.
    - 목록 읽기에 실패했거나 아직 읽는 중이면 `options`는 기본 자리와 layout에 이미 있는 workflow 자리(`desks.desks`의 key. label은 key 그대로)다. 이때는 합치지 않는다.
    - 이 task가 `workspace.tsx`에서 `source.workflows(project)`를 직접 읽는다(`wf-screen-sidebar`의 `WorkflowPanel` state를 재사용하지 않는다). 읽은 결과는 `const [workflowList, setWorkflowList] = useState<ReadResult<readonly WorkflowEntryView[]> | null>(null)`에 둔다: `null`은 아직 안 읽었거나 읽는 중(project가 바뀌면 `null`로 되돌린다), `{ ok: false, message }`는 실패, `{ ok: true, value }`는 성공이다. 성공인지는 `result.ok === true`로만 가른다.
    - 읽기에 성공했을 때만(`workflowList?.ok === true`) `mergeVanished(workflowList.value.map(e => e.name))`를 한 번 부른다(`invalid` entry도 목록에 있으므로 합치지 않는다). 읽는 때는 project를 연 직후(layout 복원이 끝난 뒤. `readyProject === projectId`)와 selector menu를 열 때다.
    - `kinds/kind.ts`의 `TabKindDef`에 선택 칸 `homeDesk?(tab: TabItem): string | undefined`를 더한다: 이 탭이 사는 자리 key. workflow 탭 kind가 자기 workflow 이름을 돌려준다. 있으면 탭을 여는 길(`host.openTab`)이 `openAcrossDesks` 전에 그 자리로 `switchTo`한다(없는 자리면 그 탭이 열린 seed로 만든다). 없으면 보이는 자리다. workflow 탭 kind file에 이 함수를 더하는 변경은 계획 `workflow`의 file이므로 시작할 때 lead가 이 task의 소유에 그 file을 더한다.

## 정한 것

1. **사라졌다는 판정은 읽기에 성공한(`ok: true`) 목록에만 쓴다.** 근거: 실패나 로딩 중에 합치면 자리의 탭이 전부 기본 자리로 옮겨진다. 틀린 선언의 workflow는 목록에 `invalid: true`로 있어(`WorkflowEntryView`) 합쳐지지 않는다.
2. **sidebar에서 workflow 탭을 열면 그 workflow의 자리로 간다(`homeDesk`).** 근거: 안 그러면 기본 자리에 workflow 탭이 열리고, 그 workflow 자리를 selector로 처음 열 때 seed에서 그 탭이 빠져(ws-model "정한 것" 3) 빈 자리가 된다.
3. **selector를 숨기는 조건, 기본 자리의 이름 등 모양은 wireframe 승인 결과를 따른다.**
4. **자리 key는 workflow 이름이라 project 이름이 바뀌어도 자리가 남는다.** 근거: project 이름은 `project.update`로 바뀌고 layout 파일은 project id로 나뉘어 있다(ws-schema). workflow 폴더 이름을 바꾸는 일(PM이 한다)은 이름이 곧 정체성이라 옛 이름의 자리가 사라져 기본 자리로 합쳐지고 새 이름은 새 자리가 된다. 이를 보고의 "알려진 미완 동작"에 적는다.
5. **이 task가 `workspace.tsx`에서 목록을 직접 읽는다. `wf-screen-sidebar`의 state를 재사용하지 않는다.** 근거: `wf-screen-sidebar`는 `WorkflowPanel`이 source를 직접 읽게 하고 `workspace.tsx`를 두 줄(import, `onOpenWorkflow` prop)만 고친다(두 task가 같은 file을 최소로 고친다). 두 번 읽는 비용은 작고, 성공·실패·읽는 중을 `ReadResult | null`로 구분하는 쪽이 이 task라서 합치기가 안전하다.
6. **sidebar에서 workflow 탭을 여는 길이 자리를 만드는 시점은 `openTab`이다.** 근거: `openWorkflow(host, …)`는 `host.openTab`을 부르고(`wf-screen-tab`) `homeDesk`를 `openTab`이 읽으므로 sidebar와 selector가 같은 길을 쓴다.

## 할 일

지금: 상단 바 왼쪽은 `LauncherButton`(sidebar 접힘)·`Breadcrumbs`·`MinimizedBar`이고, `host.openTab`은 `openAcrossDesks`만 쓰며(ws-wire-state), workflow 탭 kind는 sidebar 입구와 함께 land해 있다.

1. `kinds/kind.ts`: `TabKindDef`에 `homeDesk?(tab: TabItem): string | undefined`를 더한다. 주석은 "이 탭이 사는 자리 key. 있으면 탭을 여는 길이 그 자리로 건너가서 연다"(왜: 정한 것 2). lead가 더한 소유대로 `kinds/workflow.tsx`의 `workflowKind`에 `homeDesk(tab)`을 더해 탭 필드의 workflow 이름을 돌려준다(없거나 문자열이 아니면 undefined).
2. `workspace.tsx`에서 목록을 쓴다.
   - `workflowList` state(`ReadResult<readonly WorkflowEntryView[]> | null`)를 더하고 `source.workflows(project)`를 직접 읽는다(정한 것 5). 읽기마다 `live` guard를 둔다(앞 project의 결과를 버린다).
   - selector menu를 열 때(`DeskSelector`의 열림 변화. wireframe이 정한 자리)와 project를 연 직후 한 번 읽는다. 성공(`ok: true`)한 결과로만 `mergeVanished(names)`를 부른다. 실패나 `null`(읽는 중)이면 부르지 않는다. 이미 불렀던 같은 목록으로는 다시 부르지 않는다(`vanishedDesks`가 비면 `mergeVanished`가 아무것도 안 한다).
3. `options`·`seed`를 만든다(계약 "내놓는 것"). 읽는 중·실패일 때의 `options`는 `desks.desks`의 key를 쓴다. 기본 자리 label은 wording key(`project-workspace.label.desk-default`, ws-desk-wireframe가 더한 것)다.
4. 상단 바 왼쪽을 승인된 wireframe대로 바꾼다. 아래 "사람 피드백 반영" 절을 따른다.
5. `homeDesk`를 쓴다: `openTab`의 맨 앞에 `home = tabKindOf(tab.kind)?.homeDesk?.(tab)`이 있고 보이는 자리와 다르면 `switchTo(home, openTabIn(emptyView(), tab, () => false))`를 부른 뒤 지금 흐름(`openAcrossDesks`)으로 이어 그 탭이 그 자리에서 선택되게 한다. 이미 그 자리에 있으면 `switchTo`는 자리만 바꾸고 `openAcrossDesks`가 탭을 고른다.
6. wording: selector에 필요한 문구가 wireframe 승인 때 더 생겼으면 `catalog/project.ts`에 key를 더하고 `deno task wording`을 돌린다.
7. `deno task dev:mock`(renderer를 먼저 build)에서 사람이 볼 수 있게 한다. fake source(`wf-screen-source`의 fake)가 workflow 둘과 틀린 선언 하나를 주는지 확인한다.

## 끝남

- `deno task check`가 통과한다. `deno run -A packages/shell/renderer/build.ts`도 선다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- 위험 test: 없음. 합치기와 자리 불변 조건은 ws-model의 위험 test가 본다.
- 사람이 본다: `deno task dev:mock`에서 selector로 자리를 바꾸고(탭, floated 패널, minimized span이 자리마다 따로다), sidebar의 workflow 줄을 누르면 그 workflow의 자리로 가고, 승인된 wireframe과 같은지 본다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`을 돌렸는지)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `kinds/workflow.tsx`(계획 `workflow`의 file)에 더한 `homeDesk`, `workspace.tsx`에서 `wf-screen-sidebar`가 고친 줄과 겹친 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: workflow 폴더 이름을 바꾸면 옛 이름의 자리가 기본 자리로 합쳐진다(정한 것 4). 그 밖에 알게 된 것.

## 사람 피드백 반영 (lead가 더함, 2026-10-22)

사람이 wireframe을 보고 상단 바를 바꿨다(README "정한 것"의 "title bar 왼쪽은 `project ▾ / desk ▾`다"). 위와 다르면 이 절이 이긴다.

- 추가 소유
  - `packages/shell/renderer/workspace/model.ts`: `breadcrumbs` 함수만 지운다(쓰는 곳이 `workspace.tsx`뿐이다). `Crumb` type은 `top-path/breadcrumbs.tsx`가 쓰므로 남긴다. `Breadcrumbs` component도 Settings가 쓰므로 남긴다.
  - `packages/shell/renderer/workspace/source.ts`, `core-source.ts`, `fake-source.ts`: project 목록 읽기를 더한다.
  - `packages/shell/renderer/desktop/main.tsx`: `Workspace`에 project를 여는 callback 한 줄.
  - `tools/wireframes/pages/screens/project-app.tsx`, `tools/wireframes/pages/screens/project-window.tsx`: 상단 바를 직접 그리는 gallery page라서 `Breadcrumbs`를 새 왼쪽 경로로 바꾼다(project 창 모양이 gallery 기준과 어긋나지 않게).
- 할 일
  1. `workspace.tsx` 상단 바 왼쪽 순서: (sidebar 접힘이면) `LauncherButton` → `ProjectSelector` → `/` → `DeskSelector`(workflow 목록에 항목이 있거나 layout에 workflow 자리가 있을 때) → `MinimizedBar`. `Breadcrumbs`와 `crumbs`를 지운다. `TopBar`에는 `center`가 없다.
  2. `WorkspaceSource`에 `projects(): Promise<ReadResult<readonly { id: string; title: string }[]>>`를 더한다. core는 `projects.list`(active)다. launcher의 `readProjects`(`desktop/launcher/projects/core-source.ts`)를 import할 수 있으면 그것을 쓰고 사본을 만들지 않는다. fake는 project 셋 이상을 준다.
  3. project 목록은 workflow 목록과 같은 때(project를 연 직후, menu를 열 때) 읽는다. 읽는 중이거나 실패면 `options`는 지금 project 하나(label은 `loaded.project?.title`)다.
  4. `Workspace` props에 `onOpenProject?: (project: string) => void`를 더하고 `desktop/main.tsx`가 launcher의 project card와 같은 route(`openProject(id)`)로 잇는다. `onSelect(id)`는 지금 project와 다를 때만 부른다. 떠나는 project의 layout 저장과 detached 창 닫기는 지금 project를 떠나는 길 그대로다.
  5. `grep -rn "breadcrumbs(" packages tools`가 0줄이다(`Breadcrumbs` component를 쓰는 Settings는 남는다).
- 넘길 줄: 계획 `workflow`의 `wf-screen-source`가 `source.ts`·`core-source.ts`·`fake-source.ts`에 더한 줄과 겹친 곳.
