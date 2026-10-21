# sj-shell-job-screen

job 목록과 job run 기록을 화면에 둔다. job이 연 run의 session은 다른 run처럼 sidebar에서 그 run 아래에 묶이고(`headless-run`의 run 묶음), 그 run에는 job의 `title`을 붙여 보인다. job 화면의 기록 줄은 그 run으로 가는 길이다. 자리와 모양은 `ui-design` skill로 wireframe부터 정한다.

- 단위: shell (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/jobs/`(새 폴더)
  - `packages/shell/renderer/desktop/settings/model.ts`
  - `packages/shell/renderer/desktop/settings/settings-screen.tsx`
  - `packages/shell/renderer/desktop/settings/settings-space.tsx`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
  - `packages/shell/renderer/icons/settings.ts`
  - `packages/shell/renderer/workspace/sidebar/`(run 목록과 run 줄 이름. 앞 계획 land 뒤 path 확인)
  - `packages/shell/renderer/workspace/source.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/fake-source.ts`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/app-frame/app-runs.ts`
  - `packages/design/wording/catalog/workspace-settings.ts`
  - `packages/design/wording/catalog/workspace-settings.placeholders.ts`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
  - `tools/wireframes/pages/screens/jobs.tsx`(새 file)
  - `tools/wireframes/pages/screens/jobs/`(새 폴더)
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/mock/app-space/data.ts`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/app-space.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`
    - "이 계획에서 더 정한 것": job 목록과 job run 기록을 화면에 둔다. job 표에는 다음 차례 시각과 마지막 run을 둔다.
    - "뼈대 검토에서 정한 것": job 화면은 모든 place의 job을 모은 목록 하나다. 사람도 job 화면에서 끄고 지운다. `job.delete`는 job과 그 기록을 지우고, 도는 run은 끝까지 돈다. job에 `title`을 둔다.
    - "살 단계 검토에서 정한 것": job이 연 run의 session은 sidebar에서 그 run 아래에 묶이고 run에 job `title`을 붙인다. 기록 줄은 그 run으로 가는 길이다. app 상세의 부른 쪽 이름은 이 화면의 낱말을 따른다.
  - roadmap: `project-docs/products/roadmap/headless-schedule.md`의 "정할 것" 1(1시간 주기 job이 session을 sidebar에 쌓으면 하루 24개)과 "놓친 차례"
  - 앞 계획(run 목록의 정본): `project-docs/plan/headless-run/tasks/hr-screen-wireframe.md`(`RunList`, `RunRow`, `RunRecordView`, `PanelRun`, project sidebar의 run 묶음, 앱 공간의 "Background" 목록, 정한 것 1~9)와 `project-docs/plan/headless-run/tasks/hr-screen-data.md`(`WorkspaceSource.runs()`, `panelRuns`, 다시 읽는 때). 앞 계획 land 뒤 path 확인: 두 task가 실제로 land한 file과 이름을 먼저 본다.
  - 계약: `project-docs/plan/schedule-job/tasks/sj-jobs-contract.md`와 코드 `packages/protocol/jobs/jobs.ts`(`JobRecord`, `JobRunRecord`, `jobList`, `jobRunList`, `jobUpdate`, `jobDelete`, route 표), `packages/protocol/jobs/values.ts`(`JobAction`, `JobRunState`, `every`·`at` 모양), `packages/protocol/events/transient.ts`(`JobChanged`). run은 `packages/protocol/runs/runs.ts`(`runRead`, `RUN_FAIL_REASONS`, 앞 계획 land 뒤 path 확인)
  - 낱말: `project-docs/plan/schedule-job/tasks/sj-apps-program-caller.md`의 wording 줄(app 상세의 부른 쪽 이름 "Scheduled job")
  - architecture: `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다", `project-docs/architecture/event.md`의 "agent event와 화면"(조건을 건 뒤 ready에 읽는다, session 없는 event는 종류 조건으로만 받는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙": 토글과 행동 단추는 줄 오른쪽 끝 고정 열), `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 본보기(화면)
    - 전역 목록 항목 하나의 꼴: `packages/shell/renderer/desktop/settings/reactions/`(`source.ts`, `core-source.ts`, `model.ts`, `reactions-panel.tsx`, `testdata/fake-source.ts`)
    - Settings 줄: `settings/general/general-panel.tsx`(`Switch` 줄, `endSlot`), `settings/general/named-control.tsx`, `settings/settings.module.css`(`paneTitle`, `lead`, `lines`, `line`, `lineMain`, `lineControl`), `settings/core-call.ts`(`call`, `command`), `settings/use-reload.ts`
    - gallery: `tools/wireframes/pages/screens/settings-frame.tsx`(SettingsSpace를 fake로 띄우는 틀), `headless-run`이 더한 page `new-agent-sidebar-runs`(`project-workspace.tsx`)와 `new-app-runs`(`app-space.tsx`), `tools/wireframes/mock/drive.ts`
  - renderer(모두 `packages/shell/renderer/` 아래)
    - Settings: `desktop/settings/model.ts`(`SettingsPane`, `SETTINGS_GROUPS`), `desktop/settings/settings-screen.tsx`(`SettingsPanels`, `bodyOf`), `desktop/settings/settings-space.tsx`, `desktop/settings/sidebar/sidebar.tsx`(읽기만)
    - 조립: `desktop/entry.tsx`(`settingsPanels`, `events`), `desktop/main.tsx`의 `openSession`(읽기만. session의 place로 창을 고른다), `desktop/dev-mock/admin.ts`(`mockSettingsPanels`)
    - 통로: `desktop/palette/catalog.ts`(`CatalogSource`), `desktop/connection/events/client.ts`(`EventClient.subscribe`), `desktop/connection/events/hooks.tsx`(`useSessions`), `desktop/connection/waiting/fake-source.ts`(`createFakeWaiting`, 읽기만), `icons/settings.ts`
    - run 목록: `workspace/sidebar/run-list.tsx`, `workspace/sidebar/use-agent-panel.ts`(`PanelRun`, `PanelSession`, `agentPanelOf`), `workspace/sidebar/panel-sessions.ts`(`panelRuns`), `workspace/core-source.ts`의 `runs()`, `app-frame/app-runs.ts`, `parts/avatar/avatar.tsx`(`AvatarProfile`)
  - design: `@lophn/ui/input`의 `Switch`, `@lophn/ui/overlay`의 `Dialog`, `@lophn/ui/feedback`의 `EmptyState`·`ErrorState`·`Loading`, `@lophn/wording`의 `formatRelativeTime`
- 계약:
  - 쓰는 것:
    - `sj-jobs-contract`의 read `jobList`(`job.list`, user는 거르지 않고 모든 place)와 `jobRunList`(`job_run.list`)
    - 사람이 켜고 끄고 지우는 command `jobUpdate`(`job.update`, `{job, enabled}`)와 `jobDelete`(`job.delete`). 둘 다 actor user를 받는다.
    - `JobRecord`(`next_due_at`, `last_run`, `enabled`)
    - `JobRunRecord`의 `run`과 `session`(기록 줄이 그 run으로 가는 길)과 `reason`(`person`, `overlap`, `superseded`)
    - 남지 않는 event `JobChanged`
    - `headless-run`의 run 목록: `RunList`·`RunRow`·`RunRecordView`(`workspace/sidebar/run-list.tsx`), `PanelRun`(`workspace/sidebar/use-agent-panel.ts`), `WorkspaceSource.runs()`, `app-frame/app-runs.ts`. 이 task가 `RunRecordView`에 `job_title`, `PanelRun`에 `title`, `RunRow`에 `note`, run 상태 보기에 두 값을 더한다(할 일 1).
    - `headless-run`의 run 읽기(`runRead`의 `error`)
    - run 기록이 그 run을 시작한 job을 가리키는 칸(`job: Id<"job"> | null`). 지금 어느 계약에도 없다. planner가 `sj-runs-job-origin`(run 표와 run 기록)에 더한 뒤 이름을 맞춘다.
    - 팔레트의 `CatalogSource`(project와 앱 이름)
  - 내놓는 것: 화면 낱말 "Scheduled job"(복수 "Scheduled jobs"). `sj-apps-program-caller`의 app 상세 부른 쪽 이름과 `sj-shell-hold-card`의 대기 목록 묶음 이름이 이 낱말을 쓴다. 등록할 것(lead): gallery `tools/wireframes/pages/index.ts`의 Screens에 새 영역 `jobsArea`

## 할 일

이 brief는 main `e192a9d8c` 기준이다. 앞 계획이 같은 file을 먼저 고친다.

- `problem-remove`: `desktop/entry.tsx`와 Settings의 Reactions 목록
- `approval-simplify`: Settings 항목(shell 규칙)
- `headless-run`: run protocol, `RunList`와 project sidebar의 run 묶음, 앱 공간의 "Background" 목록, workspace source의 `runs()`

아래의 줄 위치, `SETTINGS_GROUPS`의 System 묶음 내용, `runRead`의 이름과 path, `RunList`·`RunRow`·`PanelRun`·`app-runs.ts`의 실제 이름과 칸, gallery fixture의 자리는 앞 계획 land 뒤 path 확인.

근거: README "job 목록과 job run 기록은 화면에 둔다", "job 화면은 모든 place의 job을 한곳에 모은 목록 하나다", "사람도 job 화면에서 끄고 지운다", "job이 연 run의 session은 다른 run처럼 sidebar에서 그 run 아래에 묶인다. run에는 job의 `title`을 붙여 보인다". 자리는 아래 "정한 것" 1이다. run 줄의 모양은 `headless-run`의 `RunList` 하나를 쓴다(정한 것 3).

아래의 `desktop/`, `workspace/`, `app-frame/`, `icons/`는 `packages/shell/renderer/` 아래다. route 이름은 protocol 상수(`jobList.resource`, `jobList.method` 등)로만 쓴다.

1. `RunList`를 job 기록도 그릴 만큼만 넓힌다(`workspace/sidebar/run-list.tsx`, `use-agent-panel.ts`). 모두 칸을 더하는 것이고, 주지 않으면 지금 모양 그대로다.
   - run 상태 보기(`RunStateView`)에 `"waiting"`과 `"skipped"`를 더한다. waiting은 sidebar session의 사람을 기다림 점(`data-state="waiting"`, 접근 이름 `common.label.tab-waiting`)과 같은 표시이고, skipped는 "Skipped" 글(`run-list.label.skipped`)이다. 이 둘은 job 기록에서만 온다.
   - `RunRow`에 `note?: string`을 더한다. 있으면 이름 아래 흐린 한 줄이다.
   - `RunRecordView`에 `job_title: string | null`을 더한다(그 run을 시작한 job의 제목).
   - `PanelRun`에 `title: string | null`을 더하고, `agentPanelOf`가 `RunRow.name`을 `title ?? <받는 agent 이름>`으로 만든다. avatar는 그대로 받는 agent다.
   - 상태와 시각을 그리는 오른쪽 끝 열을 component 하나로 export한다(job 줄의 마지막 run 표시가 같은 것을 쓴다).
2. job이 연 run에 job 제목을 붙인다. 근거: README "살 단계 검토에서 정한 것". 어떤 run을 묶고 session을 그 아래 두는 규칙은 `headless-run` 그대로 둔다.
   - `workspace/source.ts`의 `runs()` 주석에 `job_title`을 적는다. `workspace/core-source.ts`의 `runs()`는 run page를 모을 때 `jobList`도 모아 job id → `title` 표를 만들고, run 기록의 job 칸(계약 줄)으로 `job_title`을 채운다. job을 지웠거나 job run이 아니면 null이다. 한 번 읽을 때 `jobList`도 한 번이다(`hr-screen-data`가 정한 다시 읽는 때를 따른다).
   - `workspace/fake-source.ts`: run fixture의 기본은 `job_title: null`이다.
   - `workspace/sidebar/panel-sessions.ts`의 `panelRuns`가 `PanelRun.title`에 `job_title`을 싣는다.
   - `app-frame/app-runs.ts`: 앱 공간 "Background" 목록의 `RunRow.name`을 `job_title ?? <지금 이름>`으로 만든다.
   - `workspace/workspace.tsx`는 위 값을 넘기는 데 필요할 때만 고친다.
3. Settings 항목을 만든다(ui-design skill "새 화면 만들기". gallery page는 5에서 단다).
   - `desktop/settings/jobs/source.ts`: `JobsSource`.
     - `watch(listener)`: core 연결 상태. Reactions와 같다(`useReload`가 쓴다).
     - `changed(listener): () => void`: job이 바뀌었다는 신호.
     - `jobs(cursor?)`: `SourceResult<{ jobs: JobRecord[]; next: string | null }>`
     - `history(job, cursor?)`: `SourceResult<{ lines: JobRunRecord[]; next: string | null }>`. 새것부터다.
     - `failure(run)`: `SourceResult<{ reason; message } | null>`. failed 줄의 run 이유다.
     - `setEnabled(job, enabled)`: `SourceResult<JobRecord>`
     - `remove(job)`: `SourceResult<null>`
   - `desktop/settings/jobs/testdata/fake-source.ts`: `fakeJobs({ preset })`. 메모리로 돌고, `setEnabled`와 `remove`는 값을 바꾼 뒤 `changed` listener를 부른다. id는 `job_01h455vb4pex5v6nkc6gd5fd01` 꼴이다. preset은 gallery page 하나에 하나다.
     - `list`: 넷. lophn이 만든 1시간 주기 job(place 없음, Operator agent run, 마지막 done), Project Manager의 매일 09:00 job(tool run, 마지막 failed), App Engineer의 10일 주기 `hold` job(마지막 줄 held), 꺼 둔 job 하나
     - `empty`: 없음
     - `running`: 마지막 줄이 running이고 session이 있다. 앞 줄은 done, interrupted, 앞 차례가 아직 돌아 건너뛴 skipped(reason `overlap`)다.
     - `held`: held 줄 하나, 사람이 건너뛴 skipped(reason `person`), 제때 온 차례가 닫은 skipped(reason `superseded`)
     - `failed`: tool run의 failed 줄 둘(run 이유가 다르다)
   - `desktop/settings/jobs/model.ts`: 순수 함수.
     - 주기 글: `every`의 `m|h|d`와 수, `at`이 있으면 그 시각
     - 할 일 글: `agent_run`은 받는 agent의 role 이름, `tool_run`은 앱 이름 › tool
     - 놓친 차례 정책 글: `run`과 `hold`
     - place 글: `CatalogSource`의 이름. 못 찾으면 id 뒤 여섯 글자다.
     - 기록 줄 → `RunRow`(`historyRow`). 칸은 아래와 같다.
       - `id`: job run id. `name`: 할 일 글. `profile`: agent run이면 받는 agent role의 icon(대기 목록 card의 얼굴과 같은 icon id), tool run이면 null. `at`: `due_at`.
       - `state`: queued·running → running, done → done, failed·interrupted → failed, cancelled → cancelled, held → waiting, skipped → skipped
       - `note`: 아래 중 있는 것 하나. 놓친 차례를 대신한 줄이면 그 수, skipped면 이유 글(`person`, `overlap`, `superseded`만 글이 있다), interrupted면 "lophn이 꺼져 끊겼다", failed면 `failure(run)`이 읽은 이유
       - `session`: 그 run이 연 session이 있으면 `PanelSession`. `title`은 job 제목, `status`와 `open`은 `useSessions()`의 그 session, `at`은 `started_at`이다. `agent`는 이 화면에서 쓰지 않는다(빈 문자열).
   - `desktop/settings/jobs/jobs-panel.tsx`(줄이 길면 `job-history.tsx`로 나눈다)와 `jobs.module.css`(새 모양만. token 변수만 쓴다)
     - 머리: 항목 제목과 한 문장 안내. 읽는 중은 `Loading`, 못 읽으면 `ErrorState`, 없으면 `EmptyState`다.
     - job 줄(Settings 줄 모양). 왼쪽 줄은 셋이다.
       - 제목, 그리고 "만든 agent · place"
       - 주기 · 할 일 · 놓친 차례 정책
       - 다음 차례(상대 시각, 꺼져 있으면 "Off"), 마지막 run(1에서 export한 상태·시각 열)
     - 오른쪽 끝 고정 열에 켜기 `Switch`와 기록 펼침 `IconButton`을 둔다.
     - 펼치면 그 job 아래에 기록을 `RunList`로 그린다(`historyRow`로 옮긴 줄, 새것부터).
       - session 줄을 누르면 `onOpenSession(session.id)`다. 그 session은 sidebar나 앱 공간의 "Background"에서 그 run 아래에 있다. 이것이 기록 줄의 "run으로 가는 길"이다.
       - failed 줄의 이유는 펼칠 때 그 page의 failed 줄만 `failure(run)`으로 읽는다.
       - `next`가 있으면 기록 아래에 [Show more]가 있다.
       - 기록 아래 오른쪽 끝에 [Delete]가 있다.
     - [Delete]는 `Dialog`로 한 번 묻는다. 기록도 같이 지워지고 도는 것은 끝까지 돈다는 한 문장을 둔다. 확인하면 `remove`한다.
     - 켜기·지우기가 실패하면 앞의 값으로 돌아가고 그 줄에 오류 한 줄을 보인다(Reactions의 `failed`와 같다).
     - drive가 찾을 data 속성: `data-jobs`, `data-job=<job id>`, `data-job-history`, `data-job-enabled`, `data-job-delete`. 기록 줄은 `RunList`의 `data-run`이다.
     - 읽기는 처음 열 때와 `useReload`, `changed`가 올 때 목록과 펼친 기록을 다시 한다.
   - `desktop/settings/model.ts`: `SettingsPane`에 `"jobs"`를 더하고, `SETTINGS_GROUPS`의 `system` 묶음 맨 앞에 `{ id: "jobs", label: "settings.label.tab-jobs", icon: settingsIcons.jobs }`를 둔다.
   - `icons/settings.ts`: `jobs`에 lucide의 시계 달린 달력 아이콘(`CalendarClock` 같은 것)을 더한다.
   - `desktop/settings/settings-screen.tsx`
     - `SettingsPanels`의 `Pick`에 `"jobs"`를 더한다.
     - props에 `jobs?: JobsSource`, `catalog?: CatalogSource`, `onOpenSession?: (session: string) => void`를 더한다.
     - `bodyOf()`에 `case "jobs"`를 더한다. 없으면 지금처럼 준비 전 안내다.
   - `desktop/settings/settings-space.tsx`: `SettingsScreen`에 `catalog={source}`와 `onOpenSession`을 넘긴다(둘 다 이미 받는 값이다).
   - `desktop/dev-mock/admin.ts`: `mockSettingsPanels()`에 `jobs: fakeJobs({ preset: "list" }).source`를 더한다.
4. core 연결.
   - `desktop/settings/jobs/core-source.ts`: `coreJobsSource(core: CoreSource, events: EventClient): JobsSource`. `../core-call.ts`의 `call`·`command`를 쓴다.
     - `jobs`: `jobList`를 `{ cursor? }`로 읽는다. 거르기 칸은 쓰지 않는다.
     - `history`: `jobRunList`
     - `failure`: `runRead`를 읽고 그 run의 `error`를 돌려준다. 앞 계획 land 뒤 path 확인.
     - `setEnabled`: `jobUpdate`에 `{ job, enabled }`. `remove`: `jobDelete`에 `{ job }`. `compare`는 `{}`다(계약 "command의 `compare`는 모두 `z.strictObject({})`"). key는 job id와 바꿀 값으로 만든다.
     - `changed`: `events.subscribe({ types: ["JobChanged"] }, …)`이다. `ready`와 `event`를 받으면 listener를 부른다. session을 건 조건은 쓰지 않는다(`event.md`).
   - `desktop/entry.tsx`: `settingsPanels`에 `jobs: coreJobsSource(core, events)`를 더한다. `events`는 그 위에서 이미 만든다.
5. gallery
   - `tools/wireframes/pages/screens/jobs/jobs-pages.tsx`
     - `JobsFrame({ preset, steps })`는 `settings-frame.tsx`처럼 `SettingsSpace`를 `settingsPane="jobs"`로 띄운다.
     - 받는 값: `devMock("?mock")`의 통로, `settingsPanels={{ ...mock.settingsPanels, jobs: fakeJobs({ preset }).source }}`, `EventsProvider`와 `createEventClient(createFakeWaiting([]))`
     - mount 뒤 `useDrive(() => runSteps(steps))`로 기록을 펴거나 [Delete]를 누른다.
     - 무대 배치 말고는 CSS를 두지 않는다(check-kit).
   - `tools/wireframes/pages/screens/jobs.tsx`: `jobsArea`(`id: "jobs"`, title "Scheduled jobs", 한국어 summary). page:
     - `new-jobs-list`("Scheduled jobs · list"): 모든 place의 job 넷, 켜기 Switch, 다음 차례와 마지막 run
     - `new-jobs-empty`("Scheduled jobs · empty")
     - `new-jobs-running`("Scheduled jobs · running"): 기록을 편 job. 맨 위 running 줄 아래에 session 줄이 있다.
     - `new-jobs-held`("Scheduled jobs · held"): waiting 줄 하나와 skipped 줄 셋(사람, 앞 차례가 돎, 제때 온 차례)
     - `new-jobs-failed`("Scheduled jobs · failed"): tool run의 failed 줄과 이유
     - `new-jobs-delete`("Scheduled jobs · delete"): [Delete]를 눌러 연 확인 창
   - run 목록 page는 새로 만들지 않고 `headless-run`의 두 page에 job run 하나씩을 더한다.
     - `new-agent-sidebar-runs`: `tools/wireframes/mock/agents-data.ts`의 run fixture에 job이 연 agent run 하나(그 아래 session 하나, `title` 있음)를 더하고, `tools/wireframes/pages/screens/project-window.tsx`의 `PageSidebar`가 그 `title`을 `PanelRun`에 넘긴다. `project-workspace.tsx`의 page description에 job 제목이 붙은 줄을 한 마디 더한다.
     - `new-app-runs`: `tools/wireframes/mock/app-space/data.ts`의 run fixture에 `job_title`이 있는 tool run 하나를 더한다. `app-space.tsx`의 page description을 같이 맞춘다.
6. wording
   - `packages/design/wording/catalog/workspace-settings.ts`
     - 화면 낱말은 "Scheduled job"(복수 "Scheduled jobs")이다(정한 것 2). 항목 이름 `settings.label.tab-jobs`의 값이 "Scheduled jobs"다.
     - 안내와 오류 대상은 Reactions처럼 `settings.intro.jobs`, `settings.label.jobs-target`이다.
     - 본문은 `jobs.*`다. 주기(분, 시간, 일 plural과 시각), 정책 둘, skip 이유 셋, 끊김 한 줄, 놓친 수, 다음 차례, 꺼짐, [Show more], [Delete], 확인 창 제목·본문·단추, 비었을 때, 실패 한 줄이다.
     - run 실패 이유(`RUN_FAIL_REASONS`)는 `headless-run` 화면이 둔 key가 있으면 그것을 쓰고, 없으면 `jobs.label.fail-<reason>`으로 더한다. 앞 계획 land 뒤 path 확인.
   - `packages/design/wording/catalog/project.ts`: `run-list.label.skipped`("Skipped") 하나. waiting은 `common.label.tab-waiting`을 쓴다.
   - `common.*`, `waiting.*`, `run-list.*`에 같은 뜻이 있으면 그것을 쓴다.
   - sidebar와 "Background"의 run 이름은 job `title` 그대로라 새 key가 없다.
   - 값에 안쪽 말(`run`, `call` 등, `packages/design/wording/rules.ts`의 `INTERNAL_WORDS`)과 raw enum을 쓰지 않는다.
   - `deno task wording`으로 placeholders를 다시 만든다.

정한 것:
1. job 화면은 Settings의 System 묶음에 둔 항목 "Scheduled jobs"다(맨 앞, Reactions·Diagnostics와 같은 묶음). 이유는 넷이다.
   - README가 모든 place의 job을 한 목록에 모으라고 정했다. project 창과 앱 공간은 place 하나의 화면이고, Settings는 place 없는 전역 공간이다.
   - Reactions도 같은 System 묶음에 있다. Reactions는 lophn이 사람 없이 하는 일을 사람이 켜고 끄는 항목이다.
   - 항목 틀(sidebar 줄, 항목마다의 source, 오른쪽 끝 control 열)이 이미 있다.
   - `SettingsSpace`가 이미 `CatalogSource`와 `onOpenSession`을 받는다.

   사람이 gallery를 보고 자리를 옮기라 하면 그때 옮긴다(ui-design skill: 사람이 gallery를 보고 고른다).
2. 화면 낱말은 "Scheduled job"이다. 이유: 값에 안쪽 말 `run`을 쓸 수 없고(그래서 `headless-run`의 목록 이름도 "Background"다), "job"만으로는 무엇이 언제 도는지 드러나지 않는다. `sj-apps-program-caller`가 app 상세의 부른 쪽 이름에 이미 이 값을 쓴다.
3. job 기록은 `headless-run`의 `RunList`로 그린다. 상태 둘(waiting, skipped)과 `note` 한 줄만 더한다. 이유: planner가 run 줄 모양을 하나로 정했다. job 기록에는 run이 없는 줄(held, skipped)과 job만의 끝(interrupted)이 있어 그만큼만 넓힌다. 다른 목록에서는 이 값이 오지 않아 모양이 그대로다.
4. job 제목은 `WorkspaceSource.runs()`가 `RunRecordView.job_title`로 한 번 풀고, project sidebar와 앱 공간 "Background"가 같이 쓴다. 이유: 두 화면이 같은 `runs()`를 읽는다(`hr-screen-data` 정한 것). 화면마다 따로 job을 읽지 않는다.
5. 사람이 이 화면에서 하는 것은 켜기·끄기와 지우기뿐이다. 주기, 할 일, 정책은 고치지 않는다. 이유: README "job은 agent가 만들고 켠다"와 "사람도 job 화면에서 끄고 지운다. '시킨 것이 승낙'이지만, 사람이 멈출 길은 있어야 한다".
6. 지우기는 `Dialog`로 한 번 묻는다. 이유: 기록까지 지워지고 되돌릴 수 없다.
7. held 줄에서는 결정하지 않는다. [지금 실행]·[건너뛰기]는 대기 목록 card(`sj-shell-hold-card`)의 일이다. 이 줄은 상태만 보인다.
8. 기록 줄의 "run으로 가는 길"은 `RunList`의 session 줄이다. 누르면 그 session을 열고, 거기서 그 session은 sidebar나 "Background"의 그 run 아래에 있다. 이유: `RunList`의 run 줄은 누르는 곳이 아니다(`hr-screen-wireframe`). tool run은 session이 없어 `note`의 이유 한 줄로 대신한다.
9. run 실패 이유는 job 기록의 failed 줄에만 `note`로 보이고, 펼친 page의 failed 줄만 읽는다. 이유: 계약 "`headless-run`의 run 읽기(run 결과)". sidebar와 "Background"는 `headless-run`이 정한 대로 이유를 보이지 않는다.
10. 기록 줄의 session 제목은 job 제목이다. 이유: 그 session은 이 job이 연 것이고, Settings에서 agent마다 대화 목록을 읽지 않는다.
11. 만든 agent와 받는 agent는 role 이름과 role icon만 보인다(Operator의 정의 이름은 읽지 않는다). place는 `CatalogSource`의 이름이다. 이유: 대기 목록 card와 같은 수준이고 읽기를 늘리지 않는다.
12. 목록과 기록은 한 page씩 읽고 [Show more]로 더 읽는다. 이유: 두 read가 cursor를 받는다.
13. skip 이유는 계약 주석의 셋(`person`, `overlap`, `superseded`)만 글로 보인다. 모르는 값은 보이지 않는다. 이유: 계약 type이 `string | null`이다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다. `check:full`은 renderer build를 보지 않는다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없고, 새 key에 안쪽 말 warning이 없다.
- `deno task wireframes`가 되고(ui-design skill "확인"), gallery에서 다음이 그려진다. 영역 등록(`pages/index.ts`)은 lead가 한다. worker는 확인하는 동안만 `jobsArea`를 `GROUPS`의 Screens에 붙여 보고, commit 전에 되돌린다.
  - `new-jobs-list`: Settings sidebar의 System 묶음에 "Scheduled jobs"가 있고 고른 상태다. job 넷이 place(lophn, project, 앱)를 섞어 보이고, 켜기 Switch가 오른쪽 끝 같은 열에 있다.
  - `new-jobs-empty`, `new-jobs-running`, `new-jobs-held`, `new-jobs-failed`, `new-jobs-delete`가 할 일 3·5의 상태로 그려지고, 기록은 sidebar의 run 묶음과 같은 줄 모양이다.
  - `new-agent-sidebar-runs`, `new-app-runs`: job이 연 run 하나가 job 제목으로 보이고, 나머지 줄과 `new-agent-sidebar`는 그대로다.
  - 이미 있는 Settings page(`new-settings-general` 등)의 sidebar에도 "Scheduled jobs"가 보인다.
- `deno task dev:mock`에서 Settings › Scheduled jobs의 Switch를 끄면 다음 차례가 "Off"가 되고, [Delete]를 확인하면 그 줄이 빠진다.
- 위험 test: 없음. 화면이다(write-test skill). 사람이 남의 job을 끄고 지울 권한은 core route가 지킨다.
- 남지 않음:
  - `grep -rnE 'resource: "|method: "' packages/shell/renderer/desktop/settings/jobs tools/wireframes/pages/screens/jobs`가 0줄이다. route 이름은 protocol 상수로만 쓴다.
  - `ls packages/shell/renderer/workspace/jobs`가 없다고 답한다(뼈대가 짐작한 자리에 만들지 않았다).
  - `grep -rln "job_title" packages/shell/renderer`가 `workspace/sidebar/run-list.tsx`, `workspace/sidebar/panel-sessions.ts`, `workspace/core-source.ts`, `workspace/fake-source.ts`, `app-frame/app-runs.ts`뿐이다(job을 따로 읽는 화면이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 적어도 gallery `tools/wireframes/pages/index.ts`의 Screens `areas`에 `jobsArea`
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(run 상태 보기를 넓혀 type이 깨진 곳이 소유 밖이었다면 그곳)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(run 기록의 job 칸이 없거나 이름이 다르면)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
