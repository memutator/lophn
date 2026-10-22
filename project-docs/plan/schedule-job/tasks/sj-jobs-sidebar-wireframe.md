# sj-jobs-sidebar-wireframe

project 창 sidebar의 "Scheduled jobs" panel을 gallery Drafts에 그린다. 사람이 고른 자리다(`sj-jobs-wireframe.md` 끝 "사람이 고른 것"). 사람이 gallery에서 보고 승인한다. 승인 전에는 `sj-shell-jobs-sidebar`를 띄우지 않는다.

- 단위: shell (wave 3)
- 선행: sj-jobs-wireframe
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/jobs-sidebar/` (새 폴더)
  - `tools/wireframes/mock/jobs-sidebar-data.ts` (새 file)
  - `tools/wireframes/drafts/index.tsx` (`// jobs-sidebar` 줄만 더한다)
- 읽을 것:
  - 규칙: `AGENTS.md`, `.claude/skills/ui-design/SKILL.md`(gallery server는 `timeout 900 python3 -m http.server 0 -d tools/wireframes`로만 띄운다), `.claude/skills/wording/SKILL.md`(draft 글은 check-wording 검사 밖이지만 renderer task가 key로 옮기므로 같은 규칙으로 쓴다)
  - 계획: `project-docs/plan/schedule-job/tasks/sj-jobs-wireframe.md`(끝의 "사람이 고른 것"과 job 화면의 정한 것), `tasks/sj-jobs-contract.md`의 `JobRecord`
  - architecture: `project-docs/architecture/workspace-layout.md`(activity bar와 panel), `project-docs/architecture/ui-kit.md`
  - 본보기(panel): `packages/shell/renderer/workspace/sidebar/{project-sidebar.tsx,activity-bar.tsx,workflow-panel.tsx,project-sidebar.module.css}`. Workflow panel이 가장 가까운 꼴이다(줄 하나가 아이콘, 이름, 아래 줄).
  - 본보기(job 줄의 글): `packages/shell/renderer/desktop/settings/jobs/` 또는(아직 merge 전이면) `tools/wireframes/drafts/jobs-screen/{jobs-text.ts,job-line.tsx}`. 주기 글, 다음 차례 글, 마지막 결과 글을 같은 말로 쓴다.
  - gallery: `tools/wireframes/pages/screens/project-window.tsx`(project 창 page가 sidebar를 그리는 꼴), `tools/wireframes/drafts/jobs-screen/frame.tsx`(틀을 복사해 세운 앞 사례)
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 `JobRecord`(fixture는 이 모양 그대로, id는 문자열). `ActivityBar`(`entries` prop으로 항목을 받는다).
  - 내놓는 것: draft page 둘(id `draft-jobs-sidebar-*`)과 걸린 job을 가르는 규칙 한 줄(아래 "정한 것"). `sj-shell-jobs-sidebar`가 이 draft를 옮긴다.

## 정한 것

- 자리: project 창 activity bar의 항목 "Scheduled jobs". Workflows 아래에 둔다. 아이콘은 Settings 항목과 같은 lucide `CalendarClock`이다(draft에서는 `lucide-react`를 바로 import해도 된다. renderer task가 `settingsIcons.jobs`를 쓴다).
- 걸린 job: 아래 셋 가운데 하나면 그 project의 job이다. 재료는 모두 `JobRecord`에 있다(계약을 바꾸지 않는다).
  - `creator.role === "project_manager"`이고 `creator.project`가 그 project
  - `action.kind === "agent_run"`이고 `action.agent_place`가 `{kind: "project", id: 그 project}`
  - `action.kind === "workflow_start"`이고 `action.project`가 그 project
- 줄: 제목, 오른쪽 끝 고정 열에 Switch. 아래 줄은 주기 글과 상태 하나("Next in 3 hours", 꺼짐이면 "Turned off", hold 줄이 있으면 "Waiting for your decision"). 마지막 결과가 failed면 아래 줄 끝에 실패 표시(Settings 화면과 같은 글)를 붙인다.
- 줄을 누르면 Settings › System › Scheduled jobs를 연다(그 job을 펼친 채로 여는 길은 만들지 않는다. router에 칸이 늘어 무겁다). panel 맨 아래에 "Open all jobs" 단추 하나를 둔다.
- 빈 상태: "No scheduled jobs for this project." 한 줄과 "Ask an agent to schedule one." 한 줄.
- Edit, Delete, 기록은 panel에 그리지 않는다. Settings 화면에서 한다.

## 할 일

1. fixture `mock/jobs-sidebar-data.ts`: interface를 따로 선언한다(`JobView`. 칸 이름은 contract와 같다). job 다섯: 이 project의 PM이 만든 `workflow_start`(켜짐), lophn이 만든 `agent_run`으로 이 project의 PM을 부르는 것(hold 대기 중), 이 project의 Operator를 부르는 `agent_run`(꺼짐), 마지막 결과가 failed인 것, 다른 project의 job 하나(걸리지 않아 보이지 않아야 한다). 시각은 `Date.now()` 기준 상대값이다.
2. `drafts/jobs-sidebar/frame.tsx`: project 창 sidebar 틀. `ActivityBar`에 지금 항목 다섯과 "Scheduled jobs" 항목을 넘기고 그 항목을 고른 상태로 그린다. 오른쪽 panel 머리와 본문은 `project-sidebar.module.css` class를 쓴다. 주석에 "gallery 틀이고 renderer로 옮기지 않는다. renderer에서는 `ACTIVITY_ENTRIES`에 항목 하나를 더한다"를 쓴다.
3. `drafts/jobs-sidebar/job-panel.tsx`: 본문. data와 `project`를 props로 받고, 위 "걸린 job" 규칙으로 거른 뒤 그린다. 이 file을 `sj-shell-jobs-sidebar`가 옮긴다. 거르는 함수는 같은 file이나 `jobs-text.ts` 같은 순수 file 하나에 둔다.
4. page(id `draft-jobs-sidebar-list`, `draft-jobs-sidebar-empty`): 줄 넷이 보이는 목록과 빈 상태. `title`은 영어, `description`은 한국어 한두 문장이고 사람이 정할 것(자리, 줄 칸, 누르면 Settings로 가는 것)을 적는다.
5. `drafts/index.tsx`: 다른 draft 줄과 같은 꼴로 `// jobs-sidebar` 주석 줄을 끼워 import 한 줄과 spread 한 줄을 더한다. 다른 화면 task가 같은 file에서 자기 줄을 지우고 있으니 다른 줄은 건드리지 않는다.
6. 확인: `deno task wireframes`, gallery server로 page 둘을 Light와 Dark로 본다(`dist/index.html?frame=<id>&theme=dark`). 오른쪽 끝 고정 열, 같은 배경 규칙(ui-design "모든 화면의 규칙")을 대조한다.

## 끝남

- `deno task wireframes`와 `deno task check`가 통과한다.
- page 둘이 Light와 Dark에서 빈 화면이나 콘솔 오류 없이 그려진다. 다른 project의 job은 목록에 없다.
- renderer 코드, protocol, wording catalog를 고치지 않는다.
- 위험 test: 없음(화면은 test하지 않는다).

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 사람에게 보일 목록: page id마다 한 줄과 gallery 주소 꼴
- 정한 것: 문서에 답이 없어 worker가 정한 것(글, 줄 칸)
- 넘길 줄: 없음이 기본
- 계약 바꾸기 요청: 걸린 job을 가르는 데 `JobRecord`에 모자란 칸이 있으면 적는다
- **무겁게 짠 것**: 없음이 기본
- **알려진 미완 동작**: draft라 동작하지 않는 단추는 적지 않는다. 그리지 못한 상태가 있으면 적는다.
