# wf-screen-tab

renderer에 workflow 탭 kind 하나를 둔다. 승인한 wireframe(`wf-wireframe`)을 옮긴다. 보이는 것은 workflow 목록과 오류, instance 목록, instance 하나의 기본 view, 시작, artifact 열기다.

- 단위: shell (wave 5)
- 선행: wf-screen-source, wf-artifact-tab
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/workflow.tsx`(새 file)
  - `packages/shell/renderer/workspace/kinds/registry.ts`
  - `packages/shell/renderer/icons/common.ts`(`commonIcons.workflow` 한 줄. 이 file을 소유한 다른 task는 없다)
  - `packages/shell/renderer/workflow/`(새 폴더)
  - `packages/shell/main/workspace/kinds/workflow.ts`(새 file)
  - `packages/shell/main/workspace/kinds/registry.ts`
  - `packages/design/wording/catalog/workflow.ts`
  - `packages/design/wording/catalog/workflow.placeholders.ts`
  - `tools/wireframes/pages/screens/workflow.tsx`(lead가 빈 `workflowArea`로 먼저 둔다. 이 task가 page를 채운다)
  - `tools/wireframes/pages/screens/workflow/`(새 폴더)
- 읽을 것:
  - 시작 조건: `wf-wireframe`를 사람이 승인했다. 이 task는 승인된 wireframe 코드를 **옮긴다**. 보고 다시 그리지 않는다. 사람이 고른 모양이 `wf-wireframe.md` 끝 "사람이 고른 모양"에 있으면 그것이 우선이다. 탭의 정체성(workflow 하나 = 탭 하나)이 추천안과 다르게 정해졌으면 이 brief의 "탭 kind" 절을 그것에 맞게 lead가 고친 뒤에 돈다
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것" 가운데 "화면 (이 계획)", "시작과 멈춤", "report, 고치기, 넘기기". 다음 계획 `project-docs/plan/workflow-shell/README.md`(이 탭을 workflow 자리에 놓는다. 탭 key와 `TabItem`은 이 task가 정한다)
  - 이 plan의 brief: `wf-wireframe.md`("정한 것" 1의 파일 짝표가 옮길 곳이다), `wf-screen-source.md`("정한 것" 1~4의 method와 view type), `wf-artifact-tab.md`(`openWorkflowArtifact`), `wf-contract.md`("instance와 줄")
  - 승인된 wireframe 코드: `tools/wireframes/drafts/workflow/`(옮길 것: `workflow-body.tsx`, `instance-list.tsx`, `instance-view.tsx`, `start-dialog.tsx`, `workflow.module.css`), `tools/wireframes/mock/workflow-data.ts`, `tools/wireframes/drafts/index.tsx`의 page 목록(gallery page id와 description을 옮긴다)
  - 본보기(코드):
    - 탭 kind: `packages/shell/renderer/workspace/kinds/agents.tsx`(필드 하나를 가진 단순한 kind, `openAgents`, `PaddedTab bare`), `kinds/kind.ts`(`TabKindDef`), `kinds/host.ts`(`TabHost`, `host.props.source`, `host.agentView?.openSession`, `host.patchTab`), `kinds/artifact.tsx`(`openArtifact`, `openWorkflowArtifact`이 여기 있다), `kinds/registry.ts`
    - 저장: `packages/shell/main/workspace/kinds/agents.ts`와 `artifact.ts`(strictObject layout, `idOf`), `main/workspace/kinds/registry.ts`
    - 읽는 화면의 꼴: `packages/shell/renderer/workspace/agents/agents-page.tsx`(읽기, `live` guard, 실패 `ErrorState`, 맨 위 `Toast`가 들어가는 `toastSlot`), `workspace/sidebar/domain-panel.tsx`(`Loading`·`ErrorState`·빈 목록)
    - gallery: `tools/wireframes/pages/screens/domain.tsx`와 `domain/pages.tsx`(영역 file과 page), `pages/screens/conversation.tsx`의 `EventsProvider`·`createEventClient(createFakeSource())`(event hook이 쓰는 provider를 gallery에서 세우는 꼴), `mock/drive.ts`(`useDrive`, `click`, `find`, `type`)
  - wording: `.claude/skills/wording/SKILL.md`. `common.button.cancel`·`common.button.retry`가 이미 있다
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/write-test/SKILL.md`(화면은 test하지 않는다)
- 계약:
  - 쓰는 것: `wf-screen-source`의 `source.workflows(project)`·`workflowInstances`·`workflowInstance`·`startWorkflow`·`stopWorkflow`와 `useWorkflowChanges`, `wf-artifact-tab`의 `openWorkflowArtifact`, 승인한 wireframe(`tools/wireframes/drafts/workflow/`). 본보기는 `kinds/artifact.tsx`와 `kinds/domain` 쪽 탭
  - 내놓는 것:
    - 탭 kind `workflow`. 추천안(wireframe 승인 때 바뀔 수 있다): key `workflow:<name>`, 필드 `{ workflow: workflowName, instance?: wfi }`, layout 저장 꼴 `{ kind: "workflow", key, workflow, instance? }`. 탭은 `keep`이 아니고 unmount해도 잃을 상태가 없다(선택은 필드가 가진다).
    - 화면은 `useWorkflowChanges`로 열린 instance가 바뀌면 다시 읽는다. 정의 목록은 탭이 열릴 때와 [Refresh]에서 다시 읽는다.
    - 순수 함수 `workflowTab(name: string, instance?: string): TabItem`을 `kinds/workflow.tsx`에서 내보낸다. 탭 값(key `workflow:<name>`, kind `workflow`, title `name`, `fields.workflow = name`, `instance`가 있으면 `fields.instance`)만 만들고 `host`를 모른다. `openWorkflow`와 `workflow-shell`의 자리 seed(`ws-wire-selector`)가 같은 함수를 쓴다.
    - `workflow-shell`이 이 탭 kind를 workflow 자리에 놓는다. 이 task는 탭 kind와 여는 함수(`openWorkflow(host, workflow, instance?)`)까지다.
    - gallery: 승인한 Drafts page를 `pages/screens/workflow.tsx`의 Screens로 옮긴다(Drafts 쪽은 `wf-wireframe`의 file이라 지우지 않는다. 지우는 것은 lead가 승인 뒤 정리한다).

## 정한 것

1. **탭은 workflow 하나다**(wireframe 승인으로 바뀔 수 있다). key는 `workflow:<name>`, 필드 `{ workflow, instance? }`다. 이 값은 `workflowTab(name, instance?)` 하나가 만든다. `name`은 그 project 안의 workflow 이름(slug)이고 project 이름을 넣지 않는다. 이유: `workflow-shell`의 자리 key와 같은 규칙이고, project 이름을 바꿔도 탭이 남는다. 탭 이름(title)은 `name`이다.
2. **start에 쓰는 key와 project id는 탭이 목록에서 찾는다.** 탭 필드에 `<project 이름>/<name>`을 저장하지 않는다. `source.workflows(host.projectId)`로 읽은 entry 중 `name`이 같은 것의 `key`를 `startWorkflow`에 낸다. 목록에 없으면(지워진 workflow) 그 사실을 알리는 상태를 그린다(wireframe에 없으면 `EmptyState` 한 줄 `workflow.empty.not-found.`로 두고 "정한 것"으로 보고한다).
3. **page 컴포넌트는 `host`를 모른다.** `WorkflowPage`는 props `{ project, workflow, instance, source, onInstance(id | null), onOpenArtifact(view, instance?), onOpenConversation(session) }`를 받는다. `kinds/workflow.tsx`가 `host`로 이 props를 채운다(`onOpenArtifact`는 `openWorkflowArtifact(host, { project: host.projectId, workflow, view, instance })`, `onOpenConversation`은 `host.agentView?.openSession(session)`이고 `agentView`가 없으면 단추를 그리지 않는다). 이유: gallery가 Workspace 없이 이 component를 mount한다.
4. **읽는 때.** 정의 목록은 탭이 열릴 때와 [Refresh]. instance 목록과 고른 instance의 detail은 처음과 `useWorkflowChanges`가 올 때(payload의 `project`·`workflow`가 이 탭 것이거나, subject가 고른 instance일 때)와 시작·멈춤이 끝난 뒤. 읽는 동안 앞 값을 둔다(깜빡이지 않게). 읽기 실패는 앞 값을 지우지 않고 `ErrorState`/Toast로 알린다. 근거: README "instance가 바뀌면 화면이 다시 읽는다".
5. **글은 그대로 보인다.** report `text`는 자연어이고 markdown으로 해석하지 않는다(`white-space: pre-wrap`). 이유: lophn은 글을 판정·변형하지 않는다(roadmap "원칙"), 가장 단순하다.
6. **icon.** 탭과 sidebar 입구가 쓰는 workflow 아이콘 `commonIcons.workflow`(lucide `Workflow`)를 `packages/shell/renderer/icons/common.ts`에 더한다. 이 task가 소유한다(`wf-screen-sidebar`가 이것을 쓰므로 뒤 wave에서 쓰인다. 다른 계획 `schedule-job`은 `icons/settings.ts`만 고친다).

## 할 일

1. **탭 kind(main).** `packages/shell/main/workspace/kinds/workflow.ts`(새 file): `kinds/agents.ts` 꼴로 `defineTabKind`. layout은 `z.strictObject({ kind: z.literal("workflow"), key: tabKey, workflow: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/).max(63), instance: z.string().refine((value) => idOf("wfi", value) !== null).optional() })`(shell main은 protocol의 zod file을 import하지 못하므로 `artifactNameSchema`처럼 규칙을 사본으로 둔다). `restore`는 `Promise.resolve({ kind: "tab", tab })`(workflow가 지워졌는지는 탭이 열릴 때 목록을 읽어 보인다). `kinds/registry.ts`의 목록에 `workflowKind` 한 줄과 import.
2. **탭 kind(renderer).** `packages/shell/renderer/workspace/kinds/workflow.tsx`(새 file): 순수 함수 `workflowTab(name: string, instance?: string): TabItem`(`TabItem`은 `../model.ts`. key `workflow:<name>`, kind `workflow`, title `name`, `fields: { workflow: name, ...(instance 있으면 { instance }) }`)과 `openWorkflow(host, workflow, instance?)`(`host.openTab(workflowTab(workflow, instance))`. 이미 열려 있으면 고르기만 한다)와 `workflowKind: TabKindDef`(`kind: "workflow"`, `labelKey: "workflow.label.kind"`, `icon: commonIcons.workflow`). `fromStored`: `workflow`가 글이 아니면 null, `instance`는 글일 때만 필드에 둔다. `toStored`: `{ kind: "workflow", key, workflow, ...(instance 있으면) }`, `workflow`가 없으면 null. `render(tab, _active, host)`: `<PaddedTab bare><WorkflowPage key={tab.key} … /></PaddedTab>`. `instance` 고르기는 `host.patchTab(tab.key, () => ({ fields: … }))`다(`agents.tsx`의 `onAgent`와 같다). `keep`·`transfer`는 선언하지 않는다. `kinds/registry.ts`(renderer)의 `BUILT_IN_TAB_KINDS`에 한 줄과 import. **`homeDesk`는 이 task가 더하지 않는다**(`workflow-shell`의 `ws-wire-selector`가 이 file에 더한다).
3. **화면을 옮긴다.** `tools/wireframes/drafts/workflow/`의 component를 `packages/shell/renderer/workflow/`로 옮긴다(`wf-wireframe`의 짝표대로 `workflow-body.tsx` → `workflow-page.tsx`(`WorkflowPage`), `instance-list.tsx`, `instance-view.tsx`, `start-dialog.tsx`). 모양, 순서, 이름은 그대로 두고 아래만 바꾼다.
   - 박아 둔 영어 글 → `t("workflow.…")` key(`.claude/skills/wording/SKILL.md`: `<screen>.<part>.<name>`, 같은 뜻의 `common.*`가 있으면 그것). 영역 file은 `packages/design/wording/catalog/workflow.ts`(`wf-screen-source`가 만들었다)다. 이 task가 더하는 key 영역: 탭 종류 이름(`workflow.label.kind`), 머리와 절 제목(`workflow.heading.*`), 단추([Start] [Stop] [Refresh] [Open artifact] 둘 [Open conversation], `workflow.button.*`), instance 상태 글(`workflow.label.state-*`), 줄 종류별 글(`started`, `report`, `edit`, `handed`, `not_handed`, `ended`, `stopped`, `lophn_restarted`. 마지막은 "lophn이 다시 켜졌고 이 step을 다시 넘겨야 할 수 있다"는 뜻이다), 넘기지 못한 이유 다섯(`unknown_step`, `unknown_participant`, `harness`, `no_with`, `unresolved`. key 이름은 kebab으로 하고 protocol 값에서 key로 옮기는 표를 코드에 하나 둔다), 사람 차례 안내(`{agent}` placeholder), 빈 목록·오류·시작 dialog 글. `INTERNAL_WORDS`(`run`, `call`, `claim`, `handoff` 등)와 snake_case 값을 문구에 쓰지 않는다. 숫자·복수는 ICU plural. 상대 시각은 `formatRelativeTime`.
   - protocol type → view type. Drafts는 protocol의 `WorkflowEntry`(`state: "ok" | "invalid"`)를 props로 받는다. renderer는 `wf-screen-source`의 `WorkflowEntryView`(`invalid: boolean`)를 받으므로 `entry.state === "invalid"`를 `entry.invalid`로 바꾼다. `WorkflowInstance`·`WorkflowLine` 등도 같은 이름의 `...View`로 바꾼다.
   - mock 상수 → props. `WorkflowPage`는 `source`에서 읽은 값을 `use-workflow.ts`(새 file, 읽기·다시 읽기·시작·멈춤)에서 얻어 아래 component들에 넘긴다.
   - CSS: `workflow.module.css`를 `workflow-page.module.css`, `instance-view.module.css`처럼 component별 module로 나누고 값은 token 변수만 쓴다(`domain-panel.module.css`처럼). drafts의 class 이름을 그대로 가져와도 된다.
   - `lucide-react`를 직접 import하지 않는다. 아이콘은 `icons/*.ts`(`commonIcons.add`, `conversationIcons.stop`, `commonIcons.workflow`)에서 가져온다.
4. **읽기와 쓰기.** `packages/shell/renderer/workflow/use-workflow.ts`(새 file)에 hook 하나: `source.workflows(project)`로 entry를 찾고, `source.workflowInstances({ project, workflow })`, 고른 instance의 `source.workflowInstance(id)`를 읽는다. `useWorkflowChanges`(`desktop/connection/events/hooks.tsx`)로 다시 읽는다("정한 것" 4). 모든 읽기에 `live` guard를 둔다(`workspace.tsx`의 run 읽기와 같은 꼴). 시작: `StartDialog`의 확인이 `source.startWorkflow({ workflow: entry.key, text, step })`를 부른다. 성공하면 dialog를 닫고 instance 목록을 다시 읽고 새 instance를 고른다(`onInstance(result.value.instance)`). 실패(`conflict`는 시작할 수 없는 workflow)는 탭 위쪽 `Toast`(`agents-page.tsx`의 `toastSlot` 꼴)에 `workflow.error.start-failed`/`workflow.error.not-startable`로 보이고 dialog 입력은 잃지 않는다. 멈춤: [Stop]이 `source.stopWorkflow`를 부르고, 성공하면 다시 읽는다. 실패는 Toast `workflow.error.stop-failed`.
5. **순수 함수.** `packages/shell/renderer/workflow/model.ts`(새 file): step 줄 목록 만들기 `stepRows(detail)`(instance의 `steps` 순서, step마다 `last_reports[step]`, `lines` 가운데 `step`이 같은 줄, 지금 step 표시), step 없는 줄(`ended`, `stopped`, step 없는 `edit`) 모으기(`lophn_restarted`는 `step`이 있으므로 그 step 줄에 든다), 가장 최근 `handed` 줄의 `receiver`(사람 차례의 대화 session), 도는 instance 수. 이 파일은 `.tsx`를 import하지 않는다. test는 쓰지 않는다.
6. **gallery.** `tools/wireframes/pages/screens/workflow.tsx`(lead가 `pages: []`인 영역으로 먼저 둔 file을 채운다): 영역 `workflowArea`(`{ id: "workflow", title: "Workflow", summary, pages }`)를 낸다. page는 승인된 Drafts의 탭 쪽 page(`draft-workflow-tab-*`, `draft-workflow-start-dialog`, `draft-workflow-start-failed`)를 Screens로 옮긴 것이고 id는 `workflow-tab-*`, `workflow-start-dialog`, `workflow-start-failed`로 한다(Drafts의 id는 Drafts에 남는다). 구현은 `tools/wireframes/pages/screens/workflow/pages.tsx`(새 folder)에 둔다: `EventsProvider`(`createEventClient(createFakeSource())`)로 감싼 틀 안에 실제 `WorkflowPage`를 세우고 `fakeWorkspaceSource({ workflows, workflowInstances })`의 옵션으로 바탕을 정하고 `useDrive`로 사람이 한 것처럼 누른다(instance 고르기, [Start] 눌러 dialog 열기, 입력 채우기). 상태별 data는 `workspace/fake-source.ts`의 `FAKE_WORKFLOWS`·`FAKE_WORKFLOW_INSTANCES`(`wf-screen-source`가 `mock/workflow-data.ts`에서 옮긴 것)에서 옵션으로 고른다. 시작 실패는 fake가 `conflict`를 돌려주는 workflow(flow)에서 [Start]가 이미 꺼져 있으므로, 실패 page는 `startWorkflow`만 `{ ok: false, message: "internal" }`로 바꾼 source를 `{ ...fake, startWorkflow }`로 만들어 쓴다(gallery 전용 prop은 두지 않는다). 영역 등록(`pages/index.ts`의 `GROUPS`)은 lead가 미리 해 두었다.
7. **check.** `deno task wording`, `deno run --allow-read tools/check-wording.ts`, `deno task check`, `deno task wireframes`, `deno run -A packages/shell/renderer/build.ts`. 승인된 wireframe과 옮긴 page를 Light·Dark로 나란히 보고 어긋나면 옮긴 쪽을 고친다(wireframe을 고치지 않는다).

## 끝남

- `deno task check`가 통과한다. `deno run --allow-read tools/check-wording.ts`에 오류가 없고 새 key에 안쪽 말 warning이 없다.
- 위험 test: 없음
- (화면) `deno task wireframes`가 되고, gallery의 workflow page가 renderer component로 그려진다. `deno run -A packages/shell/renderer/build.ts`도 선다.
- 승인된 wireframe과 옮긴 page가 같은 모양이다(Light·Dark). 박아 둔 영어 글이 `packages/shell/renderer/workflow/`에 없다(`tools/check-wording.ts`가 `.tsx`의 직접 문구를 본다).
- `packages/shell/renderer/workflow/`에 `lucide-react` import가 없다.
- 저장된 layout의 `workflow` 탭이 main schema를 통과한다(`main/workspace/schema.ts`가 `kinds/registry.ts`의 `tabKindOf`로 탭 값을 읽으므로 registry에 올리면 된다). test는 더하지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. 미리 한 gallery 등록(`pages/index.ts`의 `workflowArea`)이 없었으면 그것, `deno task wording`을 돌렸는지
- 안 쓰게 된 export: 없음이 정상이다
- 정한 것: 문서에 답이 없어 worker가 정한 것(지워진 workflow의 탭 모양 등)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `wf-screen-source`의 method나 view type이 모자라면 고치지 말고 여기 적는다. 승인된 wireframe이 `wf-wireframe`의 짝표와 달라 옮기는 위치가 바뀌었으면 그것
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: 열려 있는 탭에 `openWorkflow(host, workflow, instance)`로 instance를 줘도 고르기만 하고 instance를 바꾸지 않는다
