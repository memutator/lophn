# wf-wireframe

workflow 탭과 project sidebar의 activity bar(그 안의 Workflows 입구 포함)의 wireframe을 Drafts에 그린다. 사람이 gallery에서 workflow 탭과 activity bar를 함께 보고 승인한다. 승인 전에는 renderer task(`wf-sidebar-activity`, `wf-screen-source`, `wf-screen-tab`, `wf-screen-sidebar`)를 띄우지 않는다.

- 단위: shell (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/workflow/`(새 폴더)
  - `tools/wireframes/drafts/index.tsx`
  - `tools/wireframes/mock/workflow-data.ts`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것" 가운데 "화면 (이 계획)", "시작과 멈춤", "report, 고치기, 넘기기"
  - 제품 결정: `project-docs/products/roadmap/workflow.md`의 "instance와 report", "instance 고치기", "사람 step", "화면과 shell". 기본 view는 목록과 글만 보인다. lophn이 graph를 그리지 않는다(graph는 artifact가 그린다)
  - 다음 계획: `project-docs/plan/workflow-shell/README.md`. 이 탭을 workflow별 자리(desk)에 놓는다. 그래서 탭 하나는 "workflow 하나"가 되는 쪽이 자연스럽다(추천안의 근거)
  - 계약: 이 plan의 `tasks/wf-contract.md`의 "instance와 줄", "route", `last_reports`. fixture는 이 모양 그대로 쓴다
  - skill: `.claude/skills/ui-design/SKILL.md`(특히 "모든 화면의 규칙"과 "새 화면(page) 만들기"), `.claude/skills/wording/SKILL.md`(Drafts는 영어 문구를 박아도 된다. renderer task가 key로 옮기므로 `INTERNAL_WORDS`의 `run`, `call`, `claim`, `handoff` 같은 낱말은 처음부터 쓰지 않는다), `.claude/skills/write-test/SKILL.md`(화면은 test하지 않는다)
  - 본보기(화면):
    - `tools/wireframes/drafts/index.tsx`(`draftsArea.pages`가 지금 비어 있다), `tools/wireframes/drafts/app-space/orders-view.module.css`와 `tools/wireframes/mock/app-space/orders-view.tsx`(Drafts의 CSS와 mock이 짝으로 사는 꼴)
    - `tools/wireframes/pages/screens/domain.tsx`와 `domain/pages.tsx`(영역 file 하나가 page 목록을 내는 꼴, description 문체)
    - `tools/wireframes/pages/screens/project-window.tsx`의 `stripTabsOf`·`PageSidebar`(탭 줄과 sidebar 조각)
    - `packages/shell/renderer/workspace/sidebar/run-list.tsx`(`RunList`)와 `project-sidebar.module.css`의 `.runRow`부터(run 줄. workflow 줄이 같은 꼴이다), `packages/shell/renderer/workspace/sidebar/domain-panel.tsx`(탭 하나가 목록 머리와 줄을 갖는 꼴)
  - design: `packages/design/components/<분류>/mod.ts`(`Button`, `Dialog`, `Textarea`, `Select` 계열, `Toast`, `EmptyState`, `ErrorState`, `Loading`, `Tooltip`, `Menu`). 만들기 전에 있는 것을 먼저 쓴다. `Workflow` 아이콘은 `lucide-react`(`tools/wireframes/deno.json`에 있다)에서 직접 가져와도 된다(gallery의 kit page들이 그렇게 한다)
- 계약:
  - 쓰는 것: `wf-contract`의 `WorkflowEntry`, `WorkflowInstance`, `WorkflowLine`, `last_reports`(가짜 data는 이 모양 그대로), `ui-design` skill. 같은 모양의 본보기: run 줄(`tools/wireframes/pages/screens/project-window.tsx`가 보이는 sidebar Background)과 domain 화면(`pages/screens/domain.tsx`)
  - 내놓는 것: 사람이 정할 자리 셋을 page로 그린다.
    - **workflow 탭 한 개의 본문.** project의 workflow 목록(오류 있는 것의 이유, `flow`는 시작 못 함 표시), 고른 workflow의 instance 목록, 고른 instance의 기본 view(step마다 마지막 report 글과 줄, 지금 step과 사람 차례, 멈춘 표시, [Stop]), [Start]에서 입력 글과 step 고르기, artifact가 있으면 [Open artifact] 둘(static, instance). 상태별 page: 비어 있음, 돌고 있음, 사람 차례, 끝남, 멈춤, "넘기지 못함" 줄이 있음, 오류 있는 workflow.
    - **activity bar.** 사람이 정했다(2026-10-22): project sidebar를 VS Code처럼 왼쪽 끝 icon 세로 줄로 바꾼다. 누르면 그 panel을 열고, 열린 icon을 다시 누르면 접는다. 지금의 위쪽 segmented control과 접힌 rail을 대신한다. 항목은 Explorer, Agents, Artifacts, Domains, Workflows다(뒤에 더하는 것은 항목 하나 더하기). 지금 접힌 rail의 바로 가기(Terminal, Agent, Search)는 bar 아래쪽 묶음으로 옮겨 남긴다(VS Code가 아래쪽에 계정·설정을 두는 자리). 이 wireframe은 bar의 모양(폭, 선택 표시, tooltip, 접힘)과 Workflows panel의 줄 모양(workflow 이름, 도는 instance 수, 오류 표시. run 줄처럼)을 그린다. project 창만이고 앱 공간은 그대로다.
    - **tab의 정체성.** workflow 하나가 탭 하나인지(탭 안에서 instance를 고른다), instance 하나가 탭 하나인지. 추천안은 workflow 하나가 탭 하나(key `workflow:<name>`, 필드 `{ workflow, instance? }`)다. 사람이 다르게 고르면 `wf-screen-tab`·`wf-screen-sidebar`의 brief를 고친다.
  - Drafts라서 CSS는 `drafts/workflow/` 안에만 둔다. 문구는 영어로 박고 renderer task가 wording key로 옮긴다.

## 정한 것

1. **component는 data를 props로 받고 읽지 않는다.** 이유: renderer task가 같은 component에 hook이 읽은 값을 넘기면 그대로 옮겨진다(`wf-screen-tab`). 이름과 renderer로 갈 위치를 미리 맞춘다.

   | Drafts (`tools/wireframes/drafts/workflow/`) | 갈 곳 | task |
   |---|---|---|
   | `workflow-body.tsx`: `WorkflowBody` | `packages/shell/renderer/workflow/workflow-page.tsx` | `wf-screen-tab` |
   | `instance-list.tsx`: `InstanceList` | `packages/shell/renderer/workflow/instance-list.tsx` | `wf-screen-tab` |
   | `instance-view.tsx`: `InstanceView` | `packages/shell/renderer/workflow/instance-view.tsx` | `wf-screen-tab` |
   | `start-dialog.tsx`: `StartDialog` | `packages/shell/renderer/workflow/start-dialog.tsx` | `wf-screen-tab` |
   | `activity-bar.tsx`: `ActivityBar` | `packages/shell/renderer/workspace/sidebar/activity-bar.tsx` | `wf-sidebar-activity` |
   | `sidebar-workflows.tsx`: `SidebarWorkflows`(Workflows panel 본문) | `packages/shell/renderer/workspace/sidebar/workflow-panel.tsx` | `wf-screen-sidebar` |
   | `frame.tsx`: 탭 줄과 본문을 한 창으로 보이는 틀 | 옮기지 않는다(gallery 전용) | 없음 |
   | `workflow.module.css` | renderer 쪽 `.module.css`로 나눠 옮기고 값은 token 변수만 쓴다 | 위 셋 |

2. **fixture 이름을 정해 둔다.** 이유: `wf-screen-source`가 이 fixture를 `fake-source.ts`의 기본 목록으로 옮긴다(renderer가 `tools/`를 import하지 못한다). 이름이 같으면 옮기는 일이 복사다.
   - project는 `phroner`(gallery의 fake project 이름과 같다). workflow 넷: `phroner/eval-loop`(agent, artifact 둘 다, step 넷, 참가자 PM·Operator·human), `phroner/paper-review`(agent, artifact 없음, human step 하나), `phroner/broken-draft`(`state: "invalid"`, `problem.reason: "invalid_declaration"`), `phroner/nightly-flow`(`kind: "flow"`, `startable: false`, `problem.reason: "not_agent"`).
   - instance는 `eval-loop`에 상태별로 하나씩(running, 사람 차례, ended, stopped, `not_handed` 줄이 있는 것, `lophn_restarted` 줄이 있는 것). id는 `wfi_01h455vb4pex5v6nkc6gd5fd01`꼴이다.
   - 줄의 `report.text`는 짧은 자연어(두세 줄)다. 긴 글은 접힘 모양을 사람이 볼 수 있게 한 줄만 길게 둔다.

3. **default view는 목록과 글만 그린다.** graph, 진행 막대, 도식을 그리지 않는다(roadmap "원칙"과 "node 시각화". 그림은 artifact의 일이다). 상태는 글과 아이콘으로도 구별한다(색에만 기대지 않는다).

4. **step 줄이 보이는 것의 출처.** step마다 이름, 담당(`by`와 `with`의 참가자 이름), 지금 step 표시, 마지막 report 글(`last_reports[step]`), 그 step의 줄 펼침(`lines` 가운데 `step`이 같은 줄). `step`이 없는 줄(`ended`, `stopped`, step 없는 `edit`)은 instance 머리 쪽에 둔다. 줄 종류별 글은 `wf-contract`의 줄 표를 따른다.

5. **사람 차례는 대화로 가는 길을 보인다.** `current.human_turn`이 true일 때 "사람 차례" 표시와 그 step을 받은 agent 이름, [Open conversation]을 둔다(가장 최근 `handed` 줄의 `receiver` session을 연다). 이유: roadmap "사람 step"이 사람이 그 agent와 대화로 논의한다고 하는데, 화면에 길이 없으면 사람이 그 session을 찾아야 한다. 이 단추는 이 wireframe이 새로 더하는 것이라 사람이 승인 때 본다.

6. **오류 알림은 탭 위쪽 toast다**(ui-design 규칙). 시작·멈춤 실패 page가 하나 있다. 색 띠나 상자를 쓰지 않는다.

7. **`lophn_restarted` 줄도 그린다.** `wf-contract`의 줄 종류는 여덟이고 그 하나다(`step`, `receiver`). 그 step 줄 안에 `not_handed`처럼 이유 글 한 줄로 보인다(예: "lophn restarted; this step may need to be handed again"). 상태와 지금 step 표시는 바꾸지 않는다.

8. **workflow 목록은 activity bar의 Workflows panel이 보이고, 탭 본문은 workflow 하나다.** 계약 줄은 탭 한 개의 본문에 "project의 workflow 목록"이 있다고 하지만, 탭이 workflow 하나(추천안)면 목록을 탭 안에 또 두는 것은 중복이다. 그래서 목록과 오류 표시는 sidebar 입구(`SidebarWorkflows`)가 맡고, 틀린 선언의 이유는 그 workflow의 탭 머리가 보인다. 사람이 "instance당 탭"이나 "탭 안에서 workflow 고르기"를 고르면 `draft-workflow-tab-identity`가 그 모양을 보이므로 그때 다시 정한다.

## 사람이 정할 것 (승인 때 묻는다)

1. activity bar의 모양(사람이 activity bar로 정했다. 여기서는 모양만 묻는다): bar 폭과 icon 크기, 열린 항목 표시(왼쪽 띠 / 배경), 접힌 모양(bar만 남음)과 좁은 창에서의 모양, Workflows icon. 추천안은 폭 56px, 열린 항목에 왼쪽 띠와 배경 둘 다, 접히면 bar만이다.
2. tab의 정체성: workflow 하나가 탭 하나(추천) / instance 하나가 탭 하나.
3. instance 기본 view의 모양(step 줄과 줄 펼침, 사람 차례 표시, 멈춘 표시).
4. [Start] dialog(입력 글, step 고르기)와 [Open artifact] 둘의 자리.

## 할 일

1. `tools/wireframes/mock/workflow-data.ts`(새 file)를 쓴다. `packages/protocol/workflows/mod.ts`의 `WorkflowEntry`, `WorkflowInstance`, `WorkflowLine`, `WorkflowInstanceSummary`를 `import type`으로 가져와 위 "정한 것" 2의 fixture를 그 type으로 선언한다(`ReadWorkflowInstance` 결과 꼴인 `{ instance, last_reports, lines }`도 묶음 type으로 낸다). 시각은 고정 ISO 글, 시각 표시는 `@lophn/wording`의 `formatRelativeTime`(기준 시각을 고정하는 도구가 `mock/`에 있으면 그것).
2. `tools/wireframes/drafts/workflow/`에 component를 쓴다. 파일과 이름은 "정한 것" 1의 표대로다. 화면 규칙은 `ui-design` skill대로: 행동 단추([Start], [Stop], [Open artifact], [Open conversation])는 줄 오른쪽 끝 고정 열, 탭 본문은 최대 폭 기둥을 가로 가운데, 본문 배경은 탭과 같은 색, 글 넣는 칸의 focus는 테두리 색만. 문구는 영어로 박는다(renderer task가 `workflow.*` key로 옮긴다). CSS는 `drafts/workflow/workflow.module.css` 하나에만 두고 값은 token 변수만 쓴다.
   - `WorkflowBody` props: `entry`(`WorkflowEntry`), `instances`(`WorkflowInstanceSummary[]`), `selected`(id | null), `detail`(고른 instance의 읽기 결과 | null), 콜백 `onSelect`, `onStart`, `onStop`, `onOpenArtifact(view)`, `onOpenConversation`, `onRefresh`.
   - 머리: workflow 이름, kind, [Start], artifact가 있으면 [Open artifact]. 이름 옆에 지금 도는 instance 수. `entry.state === "invalid"`면 `problem.message`를 머리 아래에 보이고 [Start]는 없다. `startable: false`(flow)면 [Start]는 꺼지고 이유를 tooltip으로 보인다.
   - instance 목록: 새것이 앞. 줄마다 시작 입력 글 한 줄, 상태(running, ended, stopped), 지금 step, 시작 시각. 고르면 아래(또는 옆)에 `InstanceView`가 선다.
   - `InstanceView`: 머리에 상태와 [Stop](running일 때만), 사람 차례 표시, 시작 입력. 그 아래 step 줄 목록(위 "정한 것" 4). `not_handed`·`lophn_restarted` 줄은 그 step 줄 안에 이유 글로 보인다.
3. `StartDialog`: 입력 글(`Textarea`, 필수), step 고르기(기본은 첫 step, 선언의 `steps` 이름), [Cancel]·[Start]. 채운 채 [Start]를 누를 수 있는 상태를 그린다.
4. `ActivityBar`와 `SidebarWorkflows`. `ActivityBar`: 왼쪽 끝 56px 세로 줄에 위쪽은 Explorer, Agents, Artifacts, Domains, Workflows icon, 아래쪽은 바로 가기 Terminal, Agent, Search(실제 `icons/*.ts` 묶음과 `IconButton`·`Tooltip`). 열린 항목 표시와 접힌 상태를 props(`entries`, `selected`, `open`)로 받는다. `SidebarWorkflows`: Workflows panel 본문의 workflow 줄(이름, 도는 instance 수, 오류 표시. run 줄과 같은 `.runRow` 꼴). 둘 다 `ProjectSidebar`를 고치지 않고 `drafts/workflow/`의 조각으로만 그린다(실제 sidebar가 아직 activity bar가 아니므로 `frame.tsx`가 bar 56px와 panel 열(전체 240px)과 탭 줄을 `TabStrip`·`Tooltip`으로 같은 모양으로 세운다). panel 본문은 Explorer 쪽은 `PageSidebar`가 쓰는 조각이나 정적인 목록으로, 그 밖에는 있는 조각을 쓴다.
5. `frame.tsx`: 실제 `TabStrip`(`packages/shell/renderer/parts/tab-strip/tab-strip.tsx`)과 `stripTabsOf` 조각으로 탭 줄과 본문을 한 창으로 보인다. page마다 탭 줄에 다른 탭(문서 등) 하나를 같이 둔다.
6. `tools/wireframes/drafts/workflow/pages.tsx`에 page 목록을 쓰고 `tools/wireframes/drafts/index.tsx`의 `draftsArea.pages`가 그것을 펼친다. id는 한 번 정하면 바꾸지 않는다. 제목은 영어, description은 한국어 한두 문장이다.

   | id | 보이는 것 |
   |---|---|
   | `draft-workflow-tab-empty` | instance가 없는 workflow. 머리와 [Start], 안내 글 |
   | `draft-workflow-tab-running` | 목록과 running instance. 지금 step 표시, step마다 마지막 report와 줄 펼침, [Stop] |
   | `draft-workflow-tab-human-turn` | 사람 차례. 받은 agent 이름과 [Open conversation] |
   | `draft-workflow-tab-ended` | `ended` instance. [Stop] 없음 |
   | `draft-workflow-tab-stopped` | `stopped` instance. 멈춘 표시와 멈춘 시각, [Stop] 없음 |
   | `draft-workflow-tab-not-handed` | `not_handed` 줄이 있는 step. 이유 글이 보인다 |
   | `draft-workflow-tab-restarted` | `lophn_restarted` 줄이 있는 step. lophn이 다시 켜졌고 그 step이 다시 넘겨져야 할 수 있다는 글이 보인다 |
   | `draft-workflow-tab-invalid` | 선언이 틀린 workflow. 이유 글, [Start] 없음 |
   | `draft-workflow-tab-flow` | `flow` workflow. [Start]가 꺼지고 이유 tooltip |
   | `draft-workflow-tab-artifact` | artifact가 있는 workflow. [Open artifact] 둘(static, instance). instance 쪽은 고른 instance 것을 연다 |
   | `draft-workflow-start-dialog` | [Start] dialog, 채운 상태 |
   | `draft-workflow-start-failed` | 시작이 실패해 탭 위쪽에 toast가 뜬 상태 |
   | `draft-activity-bar-explorer` | activity bar와 Explorer가 열린 panel. 열린 항목 표시 |
   | `draft-activity-bar-workflows` | Workflows가 열린 panel. 도는 instance가 있는 줄, 오류 workflow 줄, flow 줄, 빈 목록 안내(page 하나에 둘 이상 상태를 두려면 위아래로 나눠 그린다) |
   | `draft-activity-bar-collapsed` | 접힌 모양. bar만 남고 tooltip이 열린 icon 하나 |
   | `draft-activity-bar-narrow` | 좁은 창(창이 좁아 자동으로 접힘). bar와 탭 줄, 본문이 겹치거나 잘리지 않는 모양 |
   | `draft-workflow-tab-identity` | 탭 줄 두 줄: workflow당 탭 하나 / instance당 탭 하나. 같은 workflow의 instance 둘이 열렸을 때 |

7. 둘러보기: `deno task wireframes` 뒤 `python3 -m http.server <port> -d tools/wireframes`로 띄우고 `http://localhost:<port>/dist/index.html`(page 하나는 `?frame=<page id>&theme=dark`)에서 위 page를 Light와 Dark로 모두 확인한다. 좁은 폭(sidebar 240px, 탭 본문 폭이 작을 때)에서 글이 잘리거나 겹치지 않는지 본다.
8. 마지막에 lead에게 "사람이 본다"를 넘긴다: 보고에 page id 목록과 위 "사람이 정할 것" 4개에 대한 추천안을 쓴다. 사람은 activity bar를 workflow 탭과 함께 승인한다. 이 task는 사람이 승인하기 전에는 merged로 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- (화면) `deno task wireframes`가 되고 gallery의 Drafts에 workflow page들이 보인다.
- `git diff --name-only`가 소유 file만 가리킨다. `tools/wireframes` 안의 CSS는 `drafts/workflow/`에만 있다(`deno task check`의 kit 검사가 본다).
- **사람이 본다.** 사람이 gallery에서 위 page(workflow 탭과 activity bar)를 보고 "사람이 정할 것" 4개를 고른다. 승인 전에는 `wf-sidebar-activity`·`wf-screen-source`·`wf-screen-tab`·`wf-screen-sidebar`를 띄우지 않는다. 사람이 고른 모양이 이 brief와 다르면 lead가 이 brief 끝에 "사람이 고른 모양"으로 적고 네 renderer brief를 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 사람에게 보일 page id 목록과 "사람이 정할 것" 4개에 대한 추천안
- 등록할 것: lead가 고칠 목록 file. 없으면 "없음"(Drafts 영역은 `draftsArea` 하나라 `pages/index.ts`는 고치지 않는다)
- 안 쓰게 된 export: 없음이 정상이다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `wf-contract`의 type이 화면에 모자라거나 남으면(예: `lines`에 step 없는 줄을 그릴 칸이 없다) 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
