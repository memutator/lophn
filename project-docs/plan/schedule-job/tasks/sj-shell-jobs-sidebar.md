# sj-shell-jobs-sidebar

승인된 `drafts/jobs-sidebar/`를 renderer로 옮겨 project 창 activity bar에 "Scheduled jobs" 항목과 panel을 둔다. panel은 그 project와 걸린 job을 보이고, 줄과 "Open all jobs"는 Settings › System › Scheduled jobs를 연다.

- 단위: shell (wave 4)
- 선행: sj-jobs-sidebar-wireframe, sj-shell-jobs-screen, sj-shell-job-labels. 사람의 draft 승인도 기다린다(lead가 본다).
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/job-panel.tsx` (새 file)
  - `packages/shell/renderer/workspace/sidebar/job-panel.module.css` (새 file)
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.module.css`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/settings/jobs/model.ts`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `tools/wireframes/drafts/jobs-sidebar/` (지운다)
  - `tools/wireframes/mock/jobs-sidebar-data.ts` (지운다)
- 소유 밖 예외: wording catalog에 key만 더한다(`packages/design/wording/catalog/workspace-settings.ts`의 `jobs.*`, 생성물은 `deno task wording`). `tools/wireframes/drafts/index.tsx`의 `// jobs-sidebar` 줄은 지운 draft를 가리키던 등록 줄이라 같이 뺀다.
- 읽을 것:
  - 규칙: `AGENTS.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/schedule-job/tasks/sj-jobs-wireframe.md` 끝 "사람이 고른 것", `tasks/sj-jobs-sidebar-wireframe.md`(정한 것: 걸린 job 규칙, 줄 칸, 누르면 Settings), 그 task의 보고에 적힌 정한 것(lead가 이 brief 끝에 옮긴다)
  - architecture: `project-docs/architecture/workspace-layout.md`(activity bar와 panel)
  - 옮길 것: `tools/wireframes/drafts/jobs-sidebar/job-panel.tsx` → `packages/shell/renderer/workspace/sidebar/job-panel.tsx`. 거르는 함수는 `desktop/settings/jobs/model.ts`의 `jobsOfProject(jobs, project)`로 옮긴다.
  - 쓰는 것: `packages/shell/renderer/desktop/settings/jobs/{source,core-source,model}.ts`(`JobsSource`, `JobView`, 주기·다음 차례·결과 글), `desktop/settings/model.ts`의 `SettingsPane`(jobs 항목), `desktop/connection/events/hooks.tsx`의 `useJobChanges`, `icons/settings.ts`의 `settingsIcons.jobs`
  - 본보기: `workspace/sidebar/workflow-panel.tsx`(읽기, 다시 읽기, 실패 표시), `workspace/sidebar/project-sidebar.tsx`의 `ACTIVITY_ENTRIES`와 탭 갈래
- 계약:
  - 쓰는 것: `JobsSource`(`sj-shell-jobs-screen`이 만든 것. 이름이 다르면 merge된 코드가 맞다), `Workspace`의 `onSettings(pane?)`
  - 내놓는 것: 없음

## 정한 것

- 통로: `desktop/main.tsx`가 이미 받는 `settingsPanels`의 jobs 통로를 `Workspace`에 `jobs?: JobsSource` prop으로 넘기고, `Workspace`가 `ProjectSidebar`에 넘긴다. 없으면 activity bar에 항목을 두지 않는다. `WorkspaceSource`에 method를 더하지 않는다(같은 읽기를 두 통로에 두지 않는다).
- 줄을 누르거나 "Open all jobs"를 누르면 `onSettings("jobs")`다(`SettingsPane`의 jobs 항목 id는 merge된 코드를 따른다).
- Switch는 `JobsSource.setEnabled`를 부른다. 실패하면 줄을 되돌리고 Settings 화면과 같은 실패 글을 panel 위쪽에 짧게 보인다(새 Toast 자리를 만들지 않는다).
- 다시 읽기: panel이 열릴 때와 `JobChanged`(`useJobChanges`) 때 `JobsSource.list()`를 다시 읽는다.
- `SidebarTab`에 `"jobs"`를 더한다. `ACTIVITY_ENTRIES`의 Workflows 다음 자리다.

## 할 일

1. 승인 확인. draft page를 `?frame=draft-jobs-sidebar-list&theme=light` 등으로 열어 옮긴 뒤 대조할 기준을 눈으로 본다.
2. `desktop/settings/jobs/model.ts`에 `jobsOfProject(jobs, project)`를 더한다(draft의 거르는 함수를 옮긴다).
3. `workspace/sidebar/job-panel.tsx`: draft를 옮긴다. 박힌 글 → `t("jobs.…")`, 박힌 data → `JobsSource`, draft의 CSS 경로 → `project-sidebar.module.css`(새 class가 필요하면 그 file에 더한다).
4. `project-sidebar.tsx`: `SidebarTab`, `ACTIVITY_ENTRIES`(label `t("jobs.label.sidebar-tab")`, icon `settingsIcons.jobs`), `jobs` prop, 탭 본문 갈래, `onOpenJobs` prop.
5. `workspace.tsx`와 `desktop/main.tsx`: `jobs` prop과 `onOpenJobs = () => onSettings("jobs")`를 잇는다.
6. gallery: `pages/screens/project-window.tsx`에서 sidebar를 그리는 page에 fake `JobsSource`(`desktop/settings/jobs/testdata/fake-source.ts`의 `fakeJobs`)를 넘기고, Scheduled jobs 탭을 고른 page 하나를 더한다(id는 `draft-`를 뗀 `project-window-jobs` 꼴). draft 폴더, fixture, `drafts/index.tsx`의 `// jobs-sidebar` 줄을 지운다.
7. 확인: `deno task wireframes`, `deno run -A packages/shell/renderer/build.ts`, gallery에서 새 page를 Light와 Dark로 본다.

## 끝남

- `deno task check:full`과 renderer build가 통과한다.
- gallery의 새 page가 옮긴 component로 그려지고 draft와 같은 모양이다. 다른 project의 job은 보이지 않는다.
- 남지 않음: `grep -rn "draft-jobs-sidebar\|jobs-sidebar-data" tools packages`가 0줄이다.
- 위험 test: 없음(화면은 test하지 않는다).

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: wording 생성을 돌렸는지
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음"

## lead가 더함

- 사람이 draft를 그린 대로 승인했다(2026-10-22).
- draft 보고의 정한 것(그대로 옮긴다):
  - 줄 전체가 button 하나이고 Switch는 그 위 오른쪽 끝 고정 열에 겹쳐 둔다(button 안에 button을 넣지 않는다). 제목은 Switch 열 앞에서 줄어든다. 아래 줄은 길면 접히고 Failed 표시는 제 줄로 내려간다.
  - Switch는 Settings와 같은 "On"/"Off" label(design `Switch`가 보이는 label을 요구한다), `size="sm"`.
  - 상태 순서: Turned off → Waiting for your decision(`last_run.state === "held"`) → Next.
  - "Open all jobs"는 빈 상태에도 보이고 화살표가 없다.
- 추가 소유: `packages/shell/renderer/workspace/sidebar/job-panel.module.css`(새 file). draft의 `drafts/jobs-sidebar/jobs-sidebar.module.css`를 옮긴다. `project-sidebar.module.css`에는 더하지 않는다.
- draft의 `jobs-text.ts`는 옮기지 않는다. 주기 글, 다음 차례 글, 실패 글은 merge된 `desktop/settings/jobs/model.ts`의 함수와 `jobs.*` key를 쓰고, 없는 글("Waiting for your decision", 빈 상태 두 줄, "Open all jobs", 항목 이름)만 key를 더한다.
- `JobNames`(`desktop/settings/jobs/source.ts`)에 `operators`가 있다. panel 줄은 이름을 쓰지 않으니 읽지 않아도 된다.
- draft `frame.tsx`의 `"jobs" as SidebarTab` cast는 `SidebarTab`에 `"jobs"`를 더하면서 없어진다.
