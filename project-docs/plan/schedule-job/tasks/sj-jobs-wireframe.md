# sj-jobs-wireframe

job 화면, 대기 목록의 hold card, run 줄과 instance 줄에 붙는 job 제목의 모양을 gallery Drafts에 그린다. 사람이 gallery에서 보고 승인한다. 승인 전에는 renderer task(`sj-shell-jobs-screen`, `sj-shell-hold-card`, `sj-shell-job-labels`)를 띄우지 않는다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/jobs-screen/` (새 폴더)
  - `tools/wireframes/drafts/jobs-hold/` (새 폴더)
  - `tools/wireframes/drafts/jobs-origin/` (새 폴더)
  - `tools/wireframes/drafts/index.tsx`
  - `tools/wireframes/mock/jobs-{screen,hold,origin}-data.ts` (새 file)
- 읽을 것:
  - 규칙: `AGENTS.md`, `.claude/skills/ui-design/SKILL.md`(gallery server는 `timeout 900 python3 -m http.server 0 -d tools/wireframes`로만 띄운다), `.claude/skills/wording/SKILL.md`(draft 글은 check-wording 검사 밖이지만 renderer task가 key로 옮기므로 같은 규칙으로 쓴다)
  - 계획: `project-docs/plan/schedule-job/README.md`의 "화면"·"누가", `tasks/sj-jobs-contract.md`의 `JobRecord`·`JobRunRecord`(`reason` 값)·route 표(사람이 부르는 route만 화면에 단추가 된다)
  - architecture: `project-docs/architecture/run.md` "화면"(Background 묶음, run 줄), `project-docs/architecture/workflow.md` "화면"(workflow 탭, instance 목록, Workflows panel), `project-docs/architecture/ui-kit.md`
  - 본보기(Settings 틀): `packages/shell/renderer/desktop/settings/{model.ts,settings-space.tsx,settings-space.module.css,settings.module.css,sidebar/sidebar.tsx,sidebar/sidebar.module.css}`
  - 본보기(줄 오른쪽 끝 고정 열, 지우기, 확인 dialog): `desktop/settings/shell-rules/shell-rules-panel.tsx`, `desktop/settings/browser/browser-panel.tsx`(`Dialog`), `desktop/settings/general/general-panel.tsx`(`Toast`)
  - 본보기(대기 목록): `packages/shell/renderer/desktop/connection/waiting/{waiting-panel.tsx,model.ts,waiting.module.css,cards/activation-card.tsx,cards/head.tsx,cards/decision.tsx}`
  - 본보기(제목 줄): `packages/shell/renderer/workspace/sidebar/run-list.tsx`(`RunRow`, `RunList`), `packages/shell/renderer/app-frame/app-runs.ts`, `packages/shell/renderer/workflow/{instance-list.tsx,instance-view.tsx}`
  - gallery: `tools/wireframes/pages/screens/{settings-frame.tsx,settings-pages.tsx,project-window.tsx,app-space/space.tsx,waiting/waiting-pages.tsx}`, `tools/wireframes/mock/{drive.ts,app-space/data.ts}`
  - 앞 사례: `git show --stat 33c395e04`(workflow Drafts를 틀을 복사해 세운 꼴. fixture는 `mock/`에 두었다), `git show --stat 7bfce6940`(승인 뒤 Drafts를 걷어낸 꼴. `sj-shell-*` task가 이렇게 한다)
- 계약:
  - 쓰는 것
    - `sj-jobs-contract`의 `JobRecord`, `JobRunRecord`, `JobHold`(fixture는 이 모양 그대로, 칸 이름도 같다). renderer는 protocol을 type check하지 않으므로 fixture type은 renderer 쪽 view interface(문자열 id)로 선언한다. 이 interface가 renderer task의 `source.ts` type이 된다.
    - run 줄과 instance 줄: `RunList`·`RunRow`·`RunRecordView`(`packages/shell/renderer/workspace/sidebar/run-list.tsx`), workflow 탭의 instance 목록(`packages/shell/renderer/workflow/instance-list.tsx`)
    - 대기 목록: `packages/shell/renderer/desktop/connection/waiting/`의 card 꼴
    - Settings: `SETTINGS_GROUPS`(`packages/shell/renderer/desktop/settings/model.ts`)
  - 내놓는 것: 사람이 정할 자리 셋을 page로 그린다(이름은 영어, 문구는 영어로 박는다. renderer task가 wording key로 옮긴다).
    - **job 화면**(`drafts/jobs-screen/`): 모든 place의 job을 한곳에 모은 화면과 job run 기록. 상태: 비어 있음, job 목록, 한 job의 기록(done, failed, held, skipped의 세 reason, interrupted, 놓친 수를 접은 줄, workflow instance로 가는 줄), 지우기 확인. 켜고 끄는 switch와 지우기는 줄 오른쪽 끝 고정 열이다.
    - **hold card**(`drafts/jobs-hold/`): 대기 목록의 job hold card(job 제목, 만든 agent, 할 일 요약, 놓친 수와 마지막 차례 시각, [Start now]·[Skip]). 앞 차례가 아직 돌아 [Start now]가 `conflict`로 막힌 상태도 그린다.
    - **job 제목 줄**(`drafts/jobs-origin/`): sidebar Background의 run 줄과 앱 공간 Background 줄에 붙는 job 제목, workflow 탭 instance 줄의 "시작한 쪽 = job".
  - gallery 이름은 page id가 `draft-jobs-*`다. 승인 뒤 renderer task가 Screens로 옮긴다.

## 정한 것

- 자리 추천: Settings › System 묶음의 "Scheduled jobs" 항목. project 창의 activity bar는 project마다이고 job은 project를 건너기 때문이다(README "화면"). 사람이 다른 자리를 고르면 `sj-shell-jobs-screen`의 brief를 고친다.
- 사람이 승인 때 보는 것: (1) 자리, (2) job 줄이 보이는 칸(제목, 주기 글, 할 일 요약, 만든 agent, 켜짐, 다음 차례, 마지막 run), (3) 기록 줄의 상태와 reason 글, (4) hold card의 정보와 단추, (5) run 줄과 instance 줄에 제목을 붙이는 모양.
- component는 data를 props로 받고 읽지 않는다. fixture 이름은 세 영역이 서로 맞추되 파일은 따로 둔다(renderer task가 각자 자기 몫을 지운다).
- 화면 글에 `run`, `claim`, `call`, `grant`를 쓰지 않는다(wording 규칙). 단추는 "Start now", "Skip".
- 사람이 하는 일은 보기, 켜고 끄기, 제목·주기·놓친 차례 정책 고치기, 지우기, hold 정하기다. job을 만드는 단추는 없다(`job.create`는 agent만 부른다). 빈 상태 글이 "agent에게 만들어 달라고 말한다"를 안내한다. 할 일(`action`)은 화면에서 고치지 않는다. `job.update`가 받더라도 부를 agent·앱·workflow를 고르는 입력을 그리면 무겁다(AGENTS.md "속도"). 고치고 싶으면 만든 agent에게 말한다.
- 다른 자리(project 창 activity bar의 항목, launcher)는 그리지 않는다. 사람이 Settings를 고르지 않으면 틀(`frame.tsx`)만 바꿔 다시 그릴 수 있게 본문(`jobs-panel.tsx`)과 틀을 나눠 둔다. activity bar 항목은 project마다라 job이 project를 건너는 것과 맞지 않다(README "화면").
- fixture의 interface는 파일마다 따로 선언한다. 세 renderer task가 각자 자기 몫을 지운다. 칸 이름은 contract와 똑같이 써서, `jobs-screen`의 것은 renderer `source.ts` type으로, `jobs-hold`의 것은 protocol `JobHold`로 바꿔도(대기 목록 코드는 이미 protocol type을 import한다) 값이 그대로 맞게 한다.
- 새 아이콘은 Settings 항목 하나(lucide `CalendarClock`)만 쓴다. 나머지 표식(job 제목 줄 등)은 글로 한다. 세 renderer task가 같은 wave에서 `icons/*.ts`를 같이 고치면 충돌한다.
- `jobs-origin`은 새 CSS를 만들지 않고 기존 class(`project-sidebar.module.css`, `instance-list.module.css`, `instance-view.module.css`)만 쓴다. `sj-shell-job-labels`의 소유에 그 CSS file이 없다.
- 앱과 project는 job에 id로만 저장된다(`tool_run.app`, `workflow_start.project`). hold card는 이름을 모르므로 기존 activation 카드처럼 짧은 id(`App a1b2c3`)로 그린다. job 화면은 앱·project 목록을 따로 읽어 이름으로 푼다고 가정하고 그린다. 사람이 hold card에서도 이름을 원하면 `JobHold`에 이름을 싣는 계약 바꾸기 요청이다(보고에 적는다).
- 기록 줄에서 run·instance로 가는 길은 이미 있는 길만 그린다. agent run이 연 session은 [Open session](`SettingsSpace.onOpenSession`), workflow instance는 [Open project](`onProject`, 그 project 창의 Workflows에서 본다)다. instance를 바로 여는 길은 router와 main이 따로 필요해 이 계획의 범위 밖이다.
- 화면 글은 영어로 박는다. `Scheduled job(s)`, `Start now`, `Skip`. `run`, `claim`, `call`, `grant`와 원시 enum(`superseded`)·id를 글에 쓰지 않는다. 짧은 낱말(상태)은 마침표가 없고 문장은 마침표가 있게 써서 key로 옮길 때 그대로 맞게 한다.

## 할 일

1. fixture. `mock/jobs-screen-data.ts`, `mock/jobs-hold-data.ts`, `mock/jobs-origin-data.ts`에 파일마다 자기 interface를 선언한다(`JobView`, `JobRunView`, hold는 `{job, job_run}`). 칸 이름과 값은 `sj-jobs-contract`의 `JobRecord`·`JobRunRecord`와 똑같이, id만 문자열로 쓴다(`job_`·`jbr_`·`prj_`·`app_` + 26자, 예 `job_01h455vb4pex5v6nkc6gd5fd01`). protocol/jobs는 같은 wave에 생기므로 import하지 않는다. 시각은 `Date.now()` 기준 상대값이다. `last_run`·`next_due_at`·`created_at`·`updated_at`까지 빠짐없이 채운다.
   - job은 넷 이상: lophn이 만든 `agent_run`(`1d` at `09:00`, `hold`), Project Manager가 만든 `workflow_start`(`7d` at `10:00`, `hold`), App Engineer가 만든 `tool_run`(`30m`, `run`), 꺼진 job 하나(`enabled: false`, `next_due_at: null`).
   - 기록 줄은 `JOB_RUN_STATES` 여덟 상태, skipped의 `reason` 세 값(`person`, `overlap`, `superseded`), `missed_count`가 3인 줄, `run`·`session`·`instance`가 채워진 줄, 시작하지 못한 failed 줄(`reason`이 `<code>: <message>`)을 모두 담는다.
2. job 화면 `drafts/jobs-screen/`
   - `frame.tsx`: Settings 틀. `settings-space.tsx`의 마크업(`settings-space.module.css`)을 복사하고, `SettingsSidebar` 자리에 `SETTINGS_GROUPS`를 읽어 System 묶음에 "Scheduled jobs" 항목을 하나 더 얹은 draft sidebar를 둔다(`sidebar.module.css` 재사용). 주석에 "gallery 틀이고 renderer로 옮기지 않는다. renderer에서는 `SETTINGS_GROUPS`에 항목 하나를 더하면 된다"를 쓴다. `WaitingLayer`는 넣지 않는다.
   - `jobs-panel.tsx`: 본문. data를 props로 받는다(읽지 않는다). 이 파일을 `sj-shell-jobs-screen`이 그대로 옮긴다.
   - 줄(추천 모양): 왼쪽에 제목, 주기 글("Every day at 09:00", "Every 30 minutes"), 할 일 요약("Asks Project Manager", "Uses an app tool", "Starts a workflow"), 만든 agent와 place, 놓친 차례 정책 글, 다음 차례("Next in 3 hours" 또는 꺼짐), 마지막 결과(상태와 시각). 오른쪽 끝 고정 열에 Switch, [Edit], [Delete], 기록을 펴는 토글. 이름이 길어도 열은 같은 위치다.
   - 기록(줄을 펴면 새것이 앞): 상태 표시(`StatusMark`)와 시각과 글 한 줄. 글을 모두 그린다: done, failed(이유 글), cancelled, running, queued, held("Waiting for your decision"), skipped 셋("You skipped it", "Skipped because the previous turn was still going", "Replaced by the turn that came on time"), interrupted("Interrupted because lophn was turned off"), 놓친 수를 접은 줄("Missed 3 times, started once"). session을 연 줄에 [Open session], workflow를 시작한 줄에 [Open project].
   - [Edit]는 `Dialog`: Title, Every(숫자와 단위 Select `m`·`h`·`d`), At(시각 입력, 단위가 `d`일 때만), If missed(Select: 켜질 때 한 번 시작 / 나에게 묻기). 할 일은 못 고친다는 안내 한 줄. 저장 실패 알림은 design `Toast`로 탭 위쪽에 띄운다.
   - [Delete]는 확인 `Dialog`. "job과 그 기록을 지운다. 돌고 있는 것은 끝까지 돈다"를 말한다.
   - page(id `draft-jobs-screen-*`): `empty`, `list`(넷, 하나는 꺼짐), `history`(기록 줄이 위 글을 모두 보인다. 한 job을 펴서 길게 그려도 되고 둘을 펴도 된다), `edit`, `delete`. 상태는 `mock/drive.ts`의 `useDrive`·`click`으로 만든다.
3. hold card `drafts/jobs-hold/`
   - `panel.tsx`: 대기 목록 panel 틀(`waiting-panel.tsx`의 머리·묶음 마크업과 `waiting.module.css`를 복사). 실제 `WaitingLayer`는 `job_hold` 종류를 모르므로 쓰지 않는다. 기존 permission·activation 카드를 실제 component로 몇 개 놓고 그 아래 묶음 "Scheduled jobs"에 hold card를 놓는다.
   - `hold-card.tsx`: card 한 장. 실제 `Head`·`waiting.module.css` class를 쓴다. 보이는 것: job 제목, 만든 agent와 place, 할 일 요약(agent_run은 받는 agent, tool_run은 앱(짧은 id)과 tool, workflow_start는 workflow 이름), 놓친 수와 마지막 차례 시각. 단추는 오른쪽 끝에 [Skip], [Start now](주 행동이 맨 오른쪽). 펼침 토글은 추천하지 않는다(정보가 이미 적다).
   - 결정한 뒤에는 `JobChanged` 뒤 다시 읽어 card가 목록에서 빠진다. 남는 줄과 toast는 없다(그리는 page는 필요 없고 description에 적는다).
   - page(id `draft-jobs-hold-*`): `list`(섞인 대기 목록), `kinds`(세 할 일 종류와 놓친 수 1·3), `conflict`(앞 차례가 아직 돌아 [Start now]가 `conflict`로 막힌 상태. card는 남고 사유 글 "The previous turn is still going. Try again when it finishes."가 단추 위에 보이며 [Skip]은 쓸 수 있다).
4. job 제목 줄 `drafts/jobs-origin/` (새 CSS 없이 기존 class만)
   - `run-rows.tsx`: `RunList`의 마크업 복사본. 일반 run 줄과 job run 줄이 한 목록에 나란히 있다. 추천: 이름 자리에 job 제목, 둘째 줄에 "{agent 이름 또는 tool 이름} · {시각}"(failed·cancelled는 지금처럼 뒤에 붙는다), avatar는 받은 agent 그대로. 지워진 job의 옛 줄은 일반 줄과 같다.
   - `instance-rows.tsx`: `InstanceList`·`InstanceView` 머리의 복사본. 목록 줄 meta에 "Scheduled job · {제목}", instance 머리에 "Started by Scheduled job {제목}", 지워진 job은 제목 없이 "Started by a scheduled job".
   - page(id `draft-jobs-origin-*`): `runs`(project sidebar Background와 앱 공간 Background 두 목록을 한 page에 나란히. 앱 공간 쪽에 tool run 줄 하나), `instances`(목록과 머리).
5. `tools/wireframes/drafts/index.tsx`: 세 영역의 pages를 `draftsArea.pages`에 더한다. 세 renderer task가 나중에 각자 자기 줄만 지우므로 import와 spread를 한 줄씩 쓰고 줄 사이에 `// jobs-screen`, `// jobs-hold`, `// jobs-origin` 주석 줄을 끼운다(붙은 줄을 셋이 따로 지우면 git이 충돌로 본다). `deno fmt`가 줄을 합치지 않는지 본다.
6. page의 `title`은 영어, `description`은 한국어 한두 문장이다. 사람이 정할 거리(자리, 줄이 보이는 칸, 상태 글, hold card 정보, 제목 붙이는 모양)를 description에 적는다.
7. 확인: `deno task wireframes`, 그다음 gallery server를 `timeout 900 python3 -m http.server 0 -d tools/wireframes`로 띄워 page 열 개를 Light와 Dark로 본다(`dist/index.html?frame=<id>&theme=dark`). 오른쪽 끝 고정 열, 한 기둥, 같은 배경 규칙(ui-design "모든 화면의 규칙")을 대조한다. server는 15분 뒤 저절로 꺼지고 따로 끄지 않는다.

## 끝남

- `deno task wireframes`와 `deno task check`가 통과한다.
- gallery Drafts의 `draft-jobs-*` page 열 개가 Light와 Dark에서 빈 화면이나 콘솔 오류 없이 그려진다.
- 사람이 정할 거리가 page로 모두 보인다: job 화면의 자리(Settings 항목)와 모양(`list`), hold card(`hold-list`·`kinds`·`conflict`), run 줄과 instance 줄의 제목(`origin-runs`·`origin-instances`), skipped 세 reason과 interrupted(`history`), 편집·지우기(`edit`·`delete`).
- fixture는 파일마다 독립이고 칸 이름이 `sj-jobs-contract`와 같다. renderer 코드, protocol, wording catalog를 고치지 않는다.
- 사람이 본다: 이 task의 끝은 merge다. 승인은 lead가 사람에게 gallery를 보여 받고, 받기 전에는 `sj-shell-*` 셋을 띄우지 않는다.
- 위험 test: 없음(화면은 test하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`drafts/index.tsx`는 소유다)
- 안 쓰게 된 export: 없음
- 사람에게 보일 목록: page id마다 한 줄(무엇을 정하는 page인가)과 gallery 주소 형식. 추천안과 그린 대안을 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(상태 글, 줄 칸 구성, 폼 칸)
- 넘길 줄: 없음이 기본
- 계약 바꾸기 요청: hold card·job 줄이 앱·project 이름이 필요하면 `JobRecord`/`JobHold`에 이름을 싣는 요청, 그 밖에 draft를 그리다 `JobRecord`·`JobRunRecord`에 모자란 칸이 보이면 적는다.
- **무겁게 짠 것**: 없음이 기본
- **알려진 미완 동작**: draft라서 동작하지 않는 단추(Switch, Delete 등)는 적지 않는다. 그리지 못한 상태가 있으면 적는다.

## 사람이 고른 것 (2026-10-22, lead가 적음)

- job을 project 창의 activity bar에도 둔다. Workflow panel처럼 "Scheduled jobs" 항목과 panel을 더하고, 그 project와 걸린 job(그 project의 PM이 만든 것, 그 project의 agent를 부르거나 그 project의 workflow를 시작하는 것)만 줄로 보인다. 줄은 제목, Switch, 주기 글, 다음 차례나 대기 상태다. 맨 아래 "Open all jobs →"는 Settings › System › Scheduled jobs로 간다. 모든 job을 모은 화면은 Settings에 그대로 둔다.
  - 이 draft는 아직 그리지 않았다. draft를 그리고 사람이 본 뒤 renderer task를 연다. renderer brief는 planner가 쓴다.
  - 걸린 job을 가르는 재료는 `JobRecord`에 다 있다(`creator.project`, `action.agent_place`, `action.project`). 계약은 바꾸지 않는다.
