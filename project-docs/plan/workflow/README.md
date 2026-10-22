# workflow: project에 정의한 workflow를 instance로 돌리고, 말한 대로 기록하고 전한다

- **목표:** roadmap `project-docs/products/roadmap/workflow.md`의 `kind: agent` workflow를 만든다.
  - PM이 project의 `workflows/<name>/`에 정의를 쓴다. 선언 `workflow.yaml`, 글 `workflow.md`, 고르는 artifact다.
  - 사람이 instance를 시작한다. lophn은 step 메시지를 담당에게 넣고, 참가자의 report와 instance 고친 기록을 남기고, 화면에 보인다.
  - lophn은 판정, 검증, 넘기기 정책을 두지 않는다. 말한 대로 기록하고 전할 뿐이다.
  - node 시각화를 kit component로 키우고, artifact가 kit을 쓰게 한다.
- **재료:**
  - roadmap `project-docs/products/roadmap/workflow.md` 전체. 특히 "원칙", "정의", "instance와 report", "instance 고치기", "agent가 아는 것", "사람 step", "묻기", "node 시각화", "정한 것"
  - architecture:
    - `run.md`: 본보기. 기록 표, CLI, unattended 입력, 화면
    - `agent-call.md`: Router 한 입구, 입력 tag
    - `approval.md`: turn mode
    - `agent-definition.md`: Operator 정의 자리, place 층, tool 목록은 session 시작 때 고정
    - `artifact.md`, `ui-kit.md`
    - `domain.md`: `placeScope`
    - `event.md`, `place-session.md`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - `kind: flow`와 결정적 program이 사는 곳(roadmap "정할 것" 1)
  - 서드 파티 harness 참가자: 선언은 받고, 넘기지는 못한다
  - workflow별 layout과 title bar selector: 계획 `workflow-shell`
  - job이 instance를 시작하는 것: `schedule-job` 뒤
  - 비용, approval 설계
  - 새 e2e와 eval: 사람에게 묻는다. 있는 e2e는 land가 돌리고 통과해야 한다
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `wf-`로 시작한다.
- **시작 조건:** 없다. `headless-run`은 land했다.

## 정한 것

roadmap의 "정한 것 (사람)"과 "정한 것 (agent)"을 따른다. 아래는 이 계획에 걸려 agent가 정한 것이다(2026-10-22).

모듈과 기록
- **새 module은 runs를 본보기로 둔다.**
  - protocol은 `packages/protocol/workflows/`, core는 `packages/core/workflows/`다.
  - instance와 그 줄(report, 고친 기록, 넘긴 기록, 넘기지 못한 기록)을 core 표에 둔다. 정본은 표다.
  - 근거: run이 같은 모양(기록 한 행, CLI, unattended 입력, 화면이 다시 읽기)을 이미 갖고 있다.
- **정의 자리는 `<data>/projects/<prj_id>/workflows/<name>/`다.**
  - 안에 `workflow.yaml`, `workflow.md`가 있고, 고른 경우 `artifacts/static/index.html`, `artifacts/instance/index.html`이 있다. `<name>`은 slug다.
  - workflow의 key는 `<project 이름>/<name>`이다.
- **instance는 시작할 때 선언의 step을 옮겨 갖는다.** 그 뒤 선언이 바뀌어도 instance는 그대로이고, instance의 step은 agent가 고친다.

선언 읽기
- **lophn이 읽는 칸은 이것뿐이다.**
  - `kind`
  - `participants`의 `role`, `place?`, `name?`
  - `steps`의 `by`, `with`, `prompt`, `in`, `out`, `next`

  다른 칸은 두고 읽지 않는다(strict가 아니다). `in`, `out`, `prompt`는 자연어이고 그대로 전한다.
- **role은 `lophn | project_manager | app_engineer | operator | human | harness`다.**
  - `harness`는 선언으로 받되 넘기지 못한다. 넘길 때 "넘기지 못함" 줄로 남는다.
- **`kind`가 `agent`가 아니면 그 workflow를 시작하지 못한다고 보인다.** flow는 범위 밖이다.
- **틀린 선언은 그 workflow만 뺀다.** 이유는 `workflow.list`(agent)와 화면(사람)에 보인다.

report, 고치기, 넘기기
- **report는 tool이다.**
  - 칸은 instance, step, 글, `next?`, `session?`이다.
  - `session`은 `new` 또는 `same`이다. `same`은 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session이다. 없으면 `new`다.
  - 같은 입력을 CLI `lophn workflow report`로도 낸다. 사람과 program이 쓰고, 자격은 run처럼 user token이다. program 자격을 따로 정하는 일은 roadmap "정할 것" 1이다.
- **고치기와 읽기도 tool이다.**
  - 고치기: step 더하기, 고치기, 지우기, 끝, 지금 넘기기. 자격 판정이 없고 누가 고쳤는지 줄로 남는다.
  - 읽기: instance 상태 읽기, 정의와 오류 목록(`workflow.list`).
- **workflow tool은 모든 role이 받는다(lophn, PM, App Engineer, Operator).** 누구든 참가자일 수 있어서다.
- **step 메시지는 새 입력 종류다.**
  - Router로 넣고 unattended 표시를 싣는다.
  - tag 안에는 instance, step 이름, 그 step의 `prompt`, 받는 것(앞 step의 report 글), 낼 것, 다음 후보 step 이름이 있다.
  - `workflow.md`와 다른 step은 싣지 않는다.
  - approval 코드는 바꾸지 않는다. 입력이 unattended 표시를 실을 뿐이다.
- **담당이 사람이면 `with`의 agent에게 넣고 instance에 사람 차례를 적는다.** 그 session에서 사람이 보낸 메시지는 지금처럼 attended다.
- **담당을 풀 수 없으면 넘기지 않고 그 사실을 줄로 남긴다.** harness, 없는 이름, 선언에 없는 step이 그런 경우다. 고치는 것은 agent의 일이다.

시작과 멈춤
- **시작은 사람이 한다.** 화면과 CLI `lophn workflow start`로 한다.
  - 입력은 자연어 글이다. step을 고르지 않으면 첫 step이다.
  - agent가 시작하는 tool은 두지 않는다. roadmap은 시작을 사람과 job으로 정했다.
- **멈춤도 사람이 한다(화면, CLI).**
  - 멈춘 instance에는 넘기지 않는다.
  - 그 instance의 step 메시지를 받은 session에서 도는 turn을 멈춘다.
- **끝(`ended`)은 누가 그렇게 말했다는 기록일 뿐이다.**
  - 그 뒤 report나 고치기가 넘기면 instance는 다시 running이 된다.
  - 사람이 멈춘(`stopped`) instance만 넘기지 않고, 고치기를 받지 않는다(`conflict`).
  - 근거: 끝을 lophn이 굳히면, 다시 열어야 할 예외를 agent가 다루지 못한다(roadmap "원칙").
- **lophn이 꺼졌다 켜졌을 때 넘긴 step은 다시 넣지 않는다.**
  - 대상: 넘겼는데 turn이 가져가지 않은 step, restart로 끊긴 step.
  - 이런 step에는 `lophn_restarted` 줄을 남기고 화면에 보인다.
  - 다시 넘기는 일은 agent나 사람이 고치기(지금 넘기기)로 한다.
  - 근거: run과 같다. 다시 넣으면 바깥 효과가 두 번 날 수 있다(`architecture/run.md`). 그래도 말없이 잃지는 않는다(`architecture/agent-call.md`).

쓰기 범위
- **project의 `workflows/`는 그 project의 PM만 file tool로 쓴다.**
  - Operator와 App Engineer는 쓰지 못한다.
  - `placeScope`, runtime 권한, rewind 쓰기 폴더를 같이 고친다.

화면 (이 계획)
- **renderer에 workflow 탭 kind 하나를 둔다.**
  - 보이는 것: project의 workflow 목록과 오류, instance 목록, instance 하나의 기본 view(step마다 마지막 report와 줄, 사람 차례, 멈춤), 시작, artifact 열기.
  - 여는 곳은 sidebar다. run처럼 둔다.
  - `workflow-shell`이 이 탭을 workflow의 layout에 놓는다.
- **모양은 wireframe으로 먼저 그리고 사람이 본다**(`ui-design` skill). 사람이 보기 전에는 renderer task가 돌지 않는다.
- **project sidebar는 activity bar가 된다**(사람, 2026-10-22).
  - 왼쪽 끝 icon 세로 줄을 늘 두고, 누르면 그 panel을 열고, 열린 icon을 다시 누르면 접는다. 위쪽 segmented control과 접힌 rail(Terminal·Agent·Search 바로 가기 포함)을 대신한다. project 창만이고 앱 공간은 그대로다.
  - 항목은 Explorer, Agents, Artifacts, Domains, Workflows다. `wf-sidebar-activity`가 앞의 넷으로 틀을 바꾸고, `wf-screen-sidebar`가 Workflows 항목을 더한다.
- **instance가 바뀌면 화면이 다시 읽는다.** run은 session event 때 다시 읽는다. CLI로 낸 report는 session event가 없으므로, 알리는 길을 뼈대에서 정한다.

artifact와 kit
- **workflow artifact는 봉한 view로 연다.**
  - instance artifact는 instance 하나를 골라 연다. 가상 `data/_instance.json`이 그 instance의 상태(step, 줄)를 준다.
  - instance가 바뀌면 그 view를 다시 load한다.
  - annotation은 사람의 `.html`과 같은 길(그 project의 PM)로 간다.
- **kit의 `GraphDiagram`에 node 상태와 짧은 글을 더한다.**
  - component는 상태 값의 뜻을 모른다.
  - artifact view가 판을 고정한 kit browser build를 가상 path로 내준다.
  - gallery page도 고친다.

role 글
- **내장 skill `guide-workflows`를 만든다.** 정의 셋의 꼴, kit으로 node 그리기, artifact를 둘지 사람에게 묻기를 적는다.
- **PM 지침에 workflow를 만들고 고치는 책임을 한 줄 넣는다.**
- **모든 role의 제품 규칙에 step 메시지 tag의 뜻과 report·고치기 tool 쓰는 법을 넣는다.** step을 받으면 report한다.

## 사람이 정할 것

- workflow 탭의 wireframe을 본다.

## 순서

- wave와 선행은 tasks의 brief가 정한다. 계약을 먼저 고정한다.
  - 계약: protocol type, route와 command, 입력 종류와 tag, tool 모양, kit component props, artifact 가상 path
- renderer task는 wireframe 승인 뒤에 돈다.

## lead가 할 일

- **새 module 등록.** `project-docs/module-catalog.yaml`과 `project-docs/boundary-catalog.yaml` 줄을 계약 task보다 먼저, 또는 같이 commit한다.
- **등록 목록(planner 결정, 2026-10-22).** worker는 아래를 고치지 않고 보고의 "등록할 것"에 적는다.
  - wave 4 전에 미리 등록한다.
    - 빈 `workflow` wording 영역: `packages/design/wording/en.ts`, `placeholders.ts`.
    - gallery 등록: `tools/wireframes/pages/index.ts`. Screens에 `workflowArea`(import할 `pages/screens/workflow.tsx`를 `pages: []`인 빈 영역으로 같이 둔다. `wf-screen-tab`이 채운다), Drafts는 `draftsArea`가 이미 있어 `wf-wireframe`이 `drafts/index.tsx`의 pages를 채우면 된다.
  - `packages/protocol/mod.ts`의 export와 `ALL_ROUTES`(memory route 포함, workflows route 전부). `ReadWorkflowInstance`의 actors에 `machine`이 있어야 한다.
  - core 조립: `workflowsWiring`은 `runsWiring` 바로 뒤. `register.ts`는 `TEAMS`와 `TEAM_MODULES`에. 빈 `packages/core/workflows/mod.ts`는 `wf-contract`보다 먼저.
  - catalog 줄: `workflows` module과 boundary, `agent-tool-spi`의 `provided_by`.
- **`check:full`은 renderer build를 보지 않는다.** `wf-artifact-tab`, `wf-kit-graph`, `wf-kit-build`는 merge 전에 `deno run -A packages/shell/renderer/build.ts`를 돌린다.
- **changelog에 적을 것.**
  - 개발 data를 새로 만들어야 한다(`messages` 표 DDL이 바뀌었고 migration이 없다).
  - 모든 role의 prompt cache가 한 번 깨지고, PM session은 한 번 더 깨진다(place 정보 한 줄).
- **wireframe 승인 뒤.** planner가 사람이 고른 모양을 `wf-wireframe.md` 끝 "사람이 고른 모양"에 적고 renderer brief를 고친다.
- **`schedule-job`과 겹치는 file** (뼈대 대조, 2026-10-22). 나중에 land하는 lead가 rebase 때 두 쪽을 다 남긴다.
  - `wf-agent-tools` · `sj-jobs-tools`: `packages/core/agent-roles/tool-lists.ts`와 그 test, `packages/core/main/agent-tools.ts`와 그 test, `tests/eval/versions/files.ts`
  - `wf-contract` · `sj-jobs-contract`: `packages/protocol/base/ids.ts`, `packages/protocol/events/transient.ts`, `tools/check-deps.ts`
  - lead가 같이 고치는 file: `packages/protocol/mod.ts`, core `assembly.ts`
  - `wf-screen-source` · `sj-shell-job-screen`: renderer `workspace/{source,core-source,fake-source}.ts`
  - `wf-sidebar-activity`·`wf-screen-sidebar` · `sj-shell-job-screen`(이 task는 `workspace/sidebar/` 폴더 전체를 소유한다): `workspace/workspace.tsx`, `workspace/sidebar/project-sidebar.{tsx,module.css}`(`wf-sidebar-activity`는 `activity-bar.tsx`를 더하고 `rail.tsx`를 지운다), gallery `pages/screens/project-{window,workspace}.tsx`. `wf-sidebar-activity`는 `project-pages.tsx`·`project-app.tsx`·`domain/pages.tsx`와 wording `catalog/project.ts`도 고친다
  - `workspace/workspace.tsx`는 계획 `workflow-shell`의 `ws-layout-map`·`ws-wire-state`·`ws-wire-selector`도 고친다. 세 계획(`workflow`, `workflow-shell`, `schedule-job`)이 이 file을 차례로 고치므로 rebase 때 줄을 조심해서 합친다
  - wording `catalog/project.ts`·`project.placeholders.ts`: `wf-sidebar-activity`, `ws-desk-wireframe`·`ws-wire-selector`(key 추가), `sj-shell-job-screen`이 같이 고친다. `packages/design/wording`을 통째로 소유한다고 적은 `sj-shell-hold-card`와도 겹친다. key 줄만 더하고 생성(`deno task wording`)은 마지막에 합친 쪽이 다시 돌린다
  - wording catalog: `sj-shell-hold-card`
- **`workflow-shell` 순서.**
  - `workflow-shell`의 renderer 연결 task는 이 계획의 `wf-screen-sidebar` 뒤에 돈다.
  - workflow 목록 읽기(`workflows(project)`)는 `wf-screen-source`가 내놓고, `workflow-shell`은 그것을 쓴다.
  - `workspace.tsx`는 두 계획이 차례로 고친다.
- **merge와 land.**
  - merge할 때마다 바뀐 곳의 test를 돌린다.
  - land는 `deno task check:full`과 `deno task e2e`를 돈다. 이 계획은 e2e를 새로 쓰지 않는다.
- **위험 test는 둘이다.**
  - instance의 unattended가 할당을 넓히지 않는다. step을 받은 agent는 그래도 자기 할당에 없는 앱 tool을 쓰지 못한다.
  - project의 `workflows/`는 그 project의 PM만 file tool로 쓴다. Operator는 쓰지 못한다.
- **다 끝나면 문서를 고친다.**
  - 새 architecture 문서(workflow)를 쓴다.
  - `approval.md`·`agent-call.md`·`run.md`(unattended 표시를 싣는 곳), `agent-definition.md`(project의 `workflows/`), `artifact.md`(workflow artifact, instance data, kit build), `ui-kit.md`(node 시각화, artifact가 kit을 받는 길), `domain.md`(`placeScope`), `event.md`(사람 화면의 workflow instance)를 고친다.
  - `project-docs/products/AGENT-ROLE.md`에 workflow 참가자, 사람 참가자, PM의 workflow 책임을 더한다.
  - roadmap `workflow.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- **사람에게 묻는 것:** push, wireframe 승인. 그 밖은 planner에게 묻는다.
