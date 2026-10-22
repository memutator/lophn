# workflow-shell: project 창 layout의 최상위를 workflow로 한다

- **목표:** project 창의 layout을 desk마다 따로 갖게 한다.
  - desk는 default desk 하나와 그 project의 workflow마다 하나다. desk마다 자기 pane, tab, float, detached, minimized를 갖는다.
  - title bar 왼쪽 경로 `project ▾ / desk ▾`의 desk menu로 desk를 바꾼다.
- **재료:**
  - roadmap `project-docs/products/roadmap/workflow.md`의 "화면과 shell"과 "정한 것 (사람)"
  - architecture: `workspace-layout.md` 전체, `browser-tab.md`, `ui-kit.md`
  - 코드 본보기:
    - `packages/shell/renderer/workspace/model.ts`(`WorkspaceView`, 순수 함수와 위험 test `model_test.ts`)
    - `packages/shell/main/workspace/schema.ts`(`layout.json`, `LAYOUT_SCHEMA_VERSION`)
    - `workspace.tsx`의 `TopBar`
  - 계획 `workflow`의 README. workflow 목록 읽기와 workflow 탭 kind를 여기에 기댄다.
- **범위 밖:**
  - workflow의 기능과 instance 보기 화면: 계획 `workflow`가 만든다. 이 계획은 그 탭을 desk에 놓을 뿐이다.
  - 앱 공간의 layout: workflow는 project에만 산다.
  - 새 e2e: 사람에게 묻는다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `ws-`로 시작한다.
- **시작 조건:**
  - model, schema, detached, wireframe task(wave 1)는 바로 돌 수 있다.
  - renderer 연결 task는 계획 `workflow`의 `wf-screen-sidebar`가 main에 land한 뒤에 돈다.
  - workflow 목록 읽기는 `workflow`의 `wf-screen-source`가 renderer source에 내놓는 `workflows(project)`를 쓴다. 이 계획에서 따로 만들지 않는다.

## 정한 것

roadmap을 따른다. 아래는 이 계획에 걸려 agent가 정한 것이다(2026-10-22).

- **저장을 project마다 file 하나로 나눈다.**
  - 지금은 `<data>/shell/layout.json` 하나를 앱 전체가 쓴다. 다른 project를 열면 앞 project의 layout을 덮어쓴다(`packages/shell/main/workspace/layout-store.ts`).
  - workflow desk가 project마다 쌓이므로, 그대로 두면 project를 오갈 때마다 모든 workflow desk를 잃는다.
  - 그래서 `<data>/shell/layouts/<prj_id>.json`로 나눈다. project 이름은 바뀔 수 있으니(`project.update`) id로 둔다. 옛 `layout.json`은 읽지 않는다.
  - file 안에는 desk마다 `WorkspaceView`가 하나씩 있다: default desk와 workflow마다다.
  - schema 판을 올리고, 판이 다르면 새로 만든다. 호환 장치를 두지 않는다(AGENTS.md "호환성").
- **desk key는 그 project 안의 workflow 이름이다.** project 이름을 넣지 않는다. project 이름을 바꿔도 desk가 남는다. default desk key는 workflow 이름(slug)과 겹치지 않는 값으로 둔다.
- **desk를 바꾸면 그 desk의 `WorkspaceView`로 통째로 바뀐다.**
  - 떠난 desk의 탭은 고르지 않은 docked 탭처럼 다룬다. `keep` kind(app panel)는 숨긴 채 mount를 유지하고, 나머지는 unmount한다.
  - 떠난 desk의 detached 창은 닫지 않고 숨긴다. 돌아오면 다시 보인다.
  - 근거: 지금 minimized와 고르지 않은 탭을 다루는 규칙(`workspace-layout.md`)을 그대로 쓴다. terminal과 app panel의 살아 있는 상태를 잃지 않는다.
- **"탭 하나는 한 곳에만 있다"는 desk를 건너서도 지킨다.**
  - 같은 key의 탭은 두 desk에 없다.
  - 다른 desk에 있는 탭을 열면 그 desk로 바꿔 보인다. 지금 floated 패널을 맨 위로 올리고 detached 창을 앞으로 가져오는 것과 같다.
- **selector 목록은 default desk와 그 project의 workflow 목록이다.**
  - workflow desk를 처음 열면 그 workflow의 탭(계획 `workflow`의 탭 kind)이 열린 layout으로 시작한다.
- **목록에서 사라진 workflow의 desk는 default desk로 합친다.** 그 desk의 탭을 default desk로 옮기고 desk를 지운다. 근거: 탭이 말없이 사라지지 않는다.
- **단축키는 두지 않는다.** 지금 float, detach와 같다.
- **title bar 왼쪽은 `project ▾ / desk ▾`다(사람, 2026-10-22 wireframe을 보고).**
  - 파일 경로 breadcrumb(`project / notes.md`)을 project 창 상단 바에서 뺀다. selector는 가운데가 아니라 그 자리(왼쪽)에 둔다. 근거(사람): minimized span 단추들이 자리를 써야 한다.
  - project 쪽도 menu다. 고르면 그 project를 이 창에서 연다(launcher의 project card와 같은 route). project 창이 `projects.list`를 읽는다.
  - workflow가 없는 project는 `project ▾`만 보인다.

## 사람이 정할 것

- title bar selector와 desk 바꾸기의 wireframe을 본다. 사람이 보기 전에는 renderer task가 돌지 않는다.

## 순서

- wave와 선행은 tasks의 brief가 정한다.
- model과 schema(순수 함수, 위험 test)를 먼저 고정한다. renderer와 main은 그 다음이다.

## lead가 할 일

- 계획 `workflow`와 같이 돌 수 있다. renderer에서 겹치는 file(sidebar, workspace kind 목록)은 brief를 쓴 뒤 대조해 여기에 적는다.
- **옛 `<data>/shell/layout.json`은 `ws-schema` 뒤 읽지 않는다.** changelog에 적는다(개발 data는 새로 만든다).
- **`workspace.tsx`는 여러 task가 고친다.** 계획 `schedule-job`의 `sj-shell-job-screen`과 계획 `workflow`의 `wf-sidebar-activity`(`onRail` 줄 삭제)도 이 file을 고친다. `ws-layout-map`(wave 1)이 최소로 고치고, 뒤에 `ws-wire-state`, `ws-wire-selector`, 계획 `workflow`의 `wf-screen-sidebar`(두 줄)가 고친다. rebase 때 조심해서 합친다.
- **위험 test.** desk를 바꾸고 돌아와도, desk를 건너 열어도, workflow가 사라져 합쳐도 탭이 사라지거나 두 desk에 있지 않다. 지금 `model_test.ts`의 위험 test를 desk 층까지 넓힌다.
- **wording `catalog/project.ts`를 여럿이 고친다.** 이 계획의 `ws-desk-wireframe`·`ws-wire-selector`(`packages/design/wording`, key만), 계획 `schedule-job`의 `sj-shell-job-screen`(`project.ts`)·`sj-shell-hold-card`(`packages/design/wording`), 계획 `workflow`의 `wf-sidebar-activity`가 겹친다. key 줄만 더하고, 생성(`deno task wording`)은 마지막에 합친 쪽이 다시 돌린다.
- **land.** `deno task check:full`과 `deno task e2e`를 돈다. 있는 e2e가 layout을 건드리면 새 설계에 맞춰 고친다.
- **다 끝나면 문서를 고친다.**
  - `architecture/workspace-layout.md`에 desk 층, selector, 저장 꼴을 적는다.
  - roadmap `workflow.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- **사람에게 묻는 것:** push, wireframe 승인.
