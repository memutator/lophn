# sj-shell-jobs-screen

승인된 wireframe(`drafts/jobs-screen/`)대로 job 목록과 job run 기록 화면을 renderer에 둔다. 모든 place의 job을 한곳에 모은 화면 하나이고, 사람은 여기서 job을 보고 끄고 켜고 지운다. 사람이 wireframe을 승인한 뒤에 띄운다.

- 단위: shell (wave 3)
- 선행: `sj-jobs-wireframe`
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/jobs/` (새 폴더)
  - `packages/shell/renderer/desktop/settings/model.ts`
  - `packages/shell/renderer/desktop/settings/settings-screen.tsx`
  - `packages/shell/renderer/desktop/settings/settings-space.tsx`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
  - `packages/shell/renderer/icons/settings.ts`
  - `packages/shell/renderer/desktop/connection/events/hooks.tsx`
  - `tools/wireframes/pages/screens/settings.tsx`
  - `tools/wireframes/pages/screens/settings-pages.tsx`
  - `tools/wireframes/pages/screens/settings-frame.tsx`
  - `tools/wireframes/drafts/jobs-screen/` (지운다)
  - `tools/wireframes/mock/jobs-screen-data.ts` (지운다)
- 읽을 것:
  - 규칙: `AGENTS.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 승인된 draft(옮길 원본): `tools/wireframes/drafts/jobs-screen/`(`frame.tsx`는 gallery 틀이라 옮기지 않는다), `tools/wireframes/mock/jobs-screen-data.ts`. 사람이 고른 자리와 모양이 `sj-jobs-wireframe`의 보고와 이 brief의 가정(Settings › System 항목, 줄 오른쪽 끝 고정 열)과 다르면 코드를 쓰기 전에 lead에게 보고하고 멈춘다.
  - 계약: `tasks/sj-jobs-contract.md`의 `JobRecord`·`JobRunRecord`(`reason` 값)·route 표·`JobChanged`. route 상수는 계약이 정한 `packages/protocol/jobs/jobs.ts`의 export 이름 `jobList`·`jobRunList`·`jobUpdate`·`jobDelete`다.
  - 본보기(Settings 항목 하나가 서는 꼴): `packages/shell/renderer/desktop/settings/shell-rules/{source.ts,core-source.ts,shell-rules-panel.tsx,testdata/fake-source.ts}`, `desktop/settings/{core-call.ts,use-reload.ts,model.ts,settings-screen.tsx,settings-space.tsx}`
  - 이름 풀기: `desktop/launcher/projects/core-source.ts`의 `readProjects`, `packages/shell/renderer/apps/core-source.ts`의 `coreAppsSource().list()`
  - 신호: `desktop/connection/events/hooks.tsx`의 `useWorkflowChanges`(`JobChanged`를 듣는 hook의 본보기)
  - 부르는 길: `packages/shell/main/desktop/core/allowlist.ts`(`ALL_ROUTES`의 read·command는 모두 열린다. jobs route가 `packages/protocol/mod.ts`에 등록돼 있는지 확인한다), `renderer/command-call.ts`
  - gallery: `tools/wireframes/pages/screens/{settings.tsx,settings-pages.tsx,settings-frame.tsx}`, `mock/drive.ts`
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 route `job.list`·`job_run.list`·`job.update`(`{job, enabled}`)·`job.delete`와 `JobRecord`·`JobRunRecord`, 남지 않는 event `JobChanged`. route 이름 문자열을 직접 쓰지 않고 `jobList`·`jobRunList`·`jobUpdate`·`jobDelete`를 import한다.
  - 내놓는 것: Settings의 System 묶음에 항목 "Scheduled jobs"(자리는 wireframe 승인 결과를 따른다). 화면 낱말 "Scheduled job(s)"(`sj-apps-program-caller`의 부른 쪽 이름과 같다). gallery page는 있는 Settings 영역(`settings.tsx`)에 더하므로 영역 등록은 없다. `drafts/index.tsx`의 `jobs-screen` 줄은 지운 draft를 가리키던 등록 줄이라 소유 밖 예외로 같이 뺀다.

## 정한 것

- `JobChanged`를 받으면 `job.list`와 열려 있는 job의 `job_run.list`를 다시 읽는다. 끊긴 사이 놓친 것은 처음 읽을 때와 항목을 다시 열 때 맞춘다.
- 기록 줄의 run·instance로 가는 길은 wireframe 승인 결과를 따른다.
- Drafts의 component를 옮기고 보고 다시 그리지 않는다. fixture는 renderer `testdata`로 옮기고 gallery Screens page로 바꾼다.
- 사람이 하는 일은 보기, 켜고 끄기(`job.update {enabled}`), 제목·주기·놓친 차례 정책 고치기(`job.update`), 지우기(`job.delete`)뿐이다. 만드는 단추와 할 일(`action`) 편집은 없다(`job.create`는 agent만 부르고, 할 일 편집은 agent·앱·workflow 고르기가 필요해 무겁다).
- 이름 풀기: 앱·project 이름은 `readProjects`와 `coreAppsSource(core).list()`를 한 번씩 읽어 푼다. job의 `action`과 `creator`에는 id만 있다. 이름을 못 찾으면(지워졌거나 읽기 실패) 짧은 id 여섯 글자로 보인다. 화면은 읽기 실패로 막히지 않는다.
- 쓰기는 모두 command 봉투로 보낸다: `command(core, route, {input, compare: {}, key})`(`desktop/settings/core-call.ts`). key는 `jobs-${method}-${crypto.randomUUID()}`(앱 목록과 같은 꼴). 쓰기 뒤에는 응답을 믿지 않고 `list`를 다시 읽는다(실패해도 마찬가지). `not_found`는 agent가 먼저 지운 것이라 다시 읽어 줄이 사라지게 둔다.
- `job.list`와 `job_run.list`는 50개씩이다. 처음은 끝까지(상한 20쪽) 모으고, 기록은 펼친 job 하나만 읽는다.
- 소유 밖 예외: wording catalog에는 key만 더한다. 영역 file은 `packages/design/wording/catalog/workspace-settings.ts`(Settings 문구가 있는 곳)이고 key는 `jobs.*`, 항목 이름은 `settings.label.tab-jobs`다. 생성물(`workspace-settings.placeholders.ts`)은 `deno task wording`으로 만든다. 같은 wave의 `sj-shell-hold-card`(`catalog/data.ts`)와 `sj-shell-job-labels`(`catalog/project.ts`, `catalog/workflow.ts`)와 영역 file이 겹치지 않는다.
- 아이콘은 `icons/settings.ts`의 `settingsIcons.jobs`(lucide `CalendarClock`) 하나만 더한다. 다른 두 renderer task는 이 아이콘을 쓰지 않는다.
- 기록 줄에서 가는 길은 이미 있는 길뿐이다: session은 `onOpenSession`, workflow instance는 [Open project](`onProject`, 그 project의 id는 job의 `action.project`)다. instance를 바로 여는 길은 `router.ts`·`desktop/main.tsx`·workspace 변경이 필요해 소유 밖이다.
- `tools/wireframes/pages/screens/settings-frame.tsx`는 이 task의 소유다(다른 `sj-` task는 이 file을 고치지 않는다. `sj-jobs-wireframe`는 읽기만 한다). `SettingsFrame`에 `jobs?: Partial<FakeJobsOptions>` prop을 더해 "빈 목록" 같은 fixture를 지워서 만들지 않고 넣는다(`browser`·`appearance` prop과 같은 꼴: `panels`에 `jobs: fakeJobs(jobs).source`를 얹는다).
- gallery 문구: 새 page의 id는 `settings-jobs-*`다(`draft-`를 뗀다). Settings 영역 `summary`에 Scheduled jobs를 더한다.

## 할 일

1. 승인 확인. draft와 보고가 가정과 맞는지 본다(위 "읽을 것"). 맞으면 draft page를 `?frame=draft-jobs-screen-list&theme=light` 등으로 열어 옮긴 뒤 같은 모양인지 대조할 기준을 눈으로 본다(draft는 이 task가 마지막에 지운다).
2. 통로. `desktop/settings/jobs/source.ts`: draft fixture의 interface를 `JobView`·`JobRunView`로 옮긴다(화면이 쓰는 칸만, id는 문자열). `JobsSource = { watch(listener); list(): SourceResult<{jobs, names}>; runs(job): SourceResult<JobRunView[]>; setEnabled(job, enabled); update(job, patch: {title?, every?, at?, missed_policy?}); remove(job) }`. `names`는 `{apps, projects}` id → 이름 표.
   - `desktop/settings/jobs/core-source.ts`: `coreJobsSource(core)`. `job.list`는 `call(core, "read", …)`로 `cursor`를 따라 끝까지 모은다. `job.update`·`job.delete`는 `jobUpdate`·`jobDelete`와 `command()`로 보낸다(route 이름 문자열을 직접 쓰지 않는다). 읽기는 `jobList`·`jobRunList`다. `update`의 `at`은 단위를 `d`가 아닌 것으로 바꿀 때 `null`을 보낸다.
   - `desktop/settings/jobs/testdata/fake-source.ts`: `fakeJobs(options)`. `FakeJobsOptions = {jobs?: JobView[]; runs?: Record<string, JobRunView[]>; names?}`이고 안 주면 draft의 `mock/jobs-screen-data.ts` fixture를 옮긴 기본이다. 메모리 store로 둔다. `setEnabled`·`update`·`remove`가 store를 바꾸고 `watch`는 바로 ready를 알린다. `calls`를 기록한다(`fakeDiagnostics`처럼).
3. 순수 규칙 `desktop/settings/jobs/model.ts`: `scheduleText(every, at)`(plural은 ICU `{n, plural, …}`), `actionText(job, names)`, 기록 줄의 상태·`reason` → wording key 표(`skipped`의 세 reason, `interrupted`, `held`), 놓친 수를 접은 줄. `formatRelativeTime`(`@lophn/wording`)으로 다음 차례와 마지막 결과를 보인다.
4. 화면 `desktop/settings/jobs/jobs-panel.tsx`와 `jobs.module.css`: draft의 `drafts/jobs-screen/jobs-panel.tsx`와 CSS를 옮긴다(보고 다시 그리지 않는다). 바꾸는 것: 박힌 글 → `t("jobs.…")`, 박힌 data → `JobsSource`, draft가 import한 `settings.module.css` 경로 → `../settings.module.css`, [Edit]·[Delete] dialog의 동작, 저장 실패 → 탭 위쪽 `Toast`. 읽기는 `useReload(source, load)`로 처음·core 준비·창 focus에 맞추고, `JobChanged`가 오면 `job.list`와 펼친 job의 `job_run.list`를 다시 읽는다(위 "정한 것"). 읽기 실패는 `ErrorState`, 처음 읽는 동안은 `Loading`/`Skeleton`(shell-rules 패널처럼).
5. 신호. `desktop/connection/events/hooks.tsx`에 `useJobChanges(onChange)`를 더한다(`useWorkflowChanges`와 같은 꼴, `types: ["JobChanged"]`). 끊긴 사이 놓친 것은 처음 읽을 때와 항목을 다시 열 때 맞춘다.
6. Settings 연결.
   - `desktop/settings/model.ts`: `SettingsPane`에 `"jobs"`, `SETTINGS_GROUPS`의 `system` 묶음에 항목(`label: "settings.label.tab-jobs"`, `icon: settingsIcons.jobs`)을 draft가 보인 자리에 더한다. `icons/settings.ts`에 `jobs: CalendarClock`.
   - `desktop/settings/settings-screen.tsx`: `SettingsPanels`의 `Pick`에 `"jobs"`, props에 `jobs?: JobsSource`·`onOpenSession`·`onProject`, `bodyOf`에 `case "jobs"`(통로가 없으면 준비 전 안내), 기둥이 넓은 draft면 `WIDE`에 `"jobs"`.
   - `desktop/settings/settings-space.tsx`: 받은 `onOpenSession`·`onProject`를 `SettingsScreen`에 넘긴다.
   - `desktop/entry.tsx`: `settingsPanels`에 `jobs: coreJobsSource(core)`. `desktop/dev-mock/admin.ts`의 `mockSettingsPanels()`에 `jobs: fakeJobs().source`.
7. wording. `catalog/workspace-settings.ts`에 key를 더한다(`jobs.heading.*`, `jobs.label.*`, `jobs.button.*`, `jobs.note.*`, `jobs.empty.*`, `jobs.error.*`, `settings.label.tab-jobs`). 짧은 낱말은 `label`(마침표 없음), 문장은 `note`·`empty`·`error`(마침표 있음). 화면 글에 `run`·`claim`·`call`·`grant`를 쓰지 않는다. 먼저 `common.*`·`settings.*`에 같은 뜻이 있는지 grep한다. `deno task wording`, `deno run --allow-read tools/check-wording.ts`.
8. gallery. `pages/screens/settings.tsx`에 page `settings-jobs-empty`·`-list`·`-history`·`-edit`·`-delete`를 더하고 component는 `settings-pages.tsx`에 `SettingsFrame pane="jobs"`로 둔다. `settings-jobs-empty`는 `jobs={{ jobs: [] }}`로 fixture를 주입하고, 한 job의 기록·편집·지우기 확인은 `steps`의 `click`으로 연다(draft page와 같은 상태다). `settings-frame.tsx`에 `jobs` prop을 더한다. description은 draft의 것을 가져와 한국어 한두 문장으로 다듬는다.
9. 걷어내기. `tools/wireframes/drafts/jobs-screen/`, `tools/wireframes/mock/jobs-screen-data.ts`와 `tools/wireframes/drafts/index.tsx`의 `// jobs-screen` 주석 줄 아래의 import와 spread를 지운다.

## 끝남

- `deno task check`와 `deno run -A packages/shell/renderer/build.ts`가 통과하고 `deno task wireframes`가 된다.
- gallery Screens의 `settings-jobs-*` 다섯 page가 Light와 Dark에서 draft page(지우기 전에 나란히 대조한다)와 같은 모양으로 그려진다.
- `deno task dev:mock`에서 Settings › Scheduled jobs를 열어 켜고 끄기, 편집, 지우기, 기록 펼치기가 한 번씩 돈다.
- 화면 글이 모두 wording key이고 `deno run --allow-read tools/check-wording.ts`가 통과한다.
- 남지 않음: `grep -rn "jobs-screen" tools packages`가 0줄이다(draft 폴더, mock, `drafts/index.tsx`의 줄).
- 위험 test: 없음(화면은 test하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`catalog/workspace-settings.placeholders.ts`)은 이 task가 `deno task wording`으로 만든다. lead가 더할 것은 없다.
- 안 쓰게 된 export: 없음이 기본
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음이 기본
- 계약 바꾸기 요청: 화면이 route에서 모자란 칸을 만나면(예: 이름) 적는다
- **무겁게 짠 것**: 없음이 기본
- **알려진 미완 동작**: 기록 줄에서 workflow instance를 바로 열지 못하고 [Open project]까지만 간다(고치려면 `router.ts`·`desktop/main.tsx`에 instance 시작 칸이 필요하다).
