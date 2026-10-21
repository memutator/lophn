# pr-issues-ui-screen

앱 상세의 Issues 탭과 앱 공간의 [Report a problem](사람 feedback, "User report")을 renderer와 gallery에서 지운다. `ui-design` skill대로 gallery(wireframe) page부터 고친다. gallery가 renderer component를 그대로 그리므로 둘을 한 task에서 바꾼다. 사람에게는 toast와 annotation이 남는다.

- 단위: issues-ui (wave 2)
- 선행: pr-check-exclude.
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space`
  - `tools/wireframes/mock/mock-desktop.tsx`
  - `packages/shell/renderer/app-frame/app-detail/issues`
  - `packages/shell/renderer/app-frame/app-detail/app-detail.tsx`
  - `packages/shell/renderer/app-frame/app-space.tsx`
  - `packages/shell/renderer/app-frame/app-views.tsx`
  - `packages/shell/renderer/app-frame/app-bar.tsx`
  - `packages/shell/renderer/app-frame/report-button.tsx`
  - `packages/shell/renderer/app-frame/view-chrome.tsx`
  - `packages/shell/renderer/overlay/feedback`
  - `packages/shell/renderer/overlay/surfaces/surface.tsx`
  - `packages/shell/renderer/overlay/entry.tsx`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/router.ts`
  - `packages/shell/renderer/desktop/intents.tsx`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/mod.ts`
  - `packages/shell/renderer/desktop/dev-mock/app-space.ts`
  - `packages/protocol/shell/feedback.ts`
  - `packages/shell/renderer/workspace/app-panel-tab.tsx`
  - `packages/shell/renderer/workspace/visuals/app-card-block.tsx`
  - `packages/shell/renderer/app-frame/report-button.module.css`
  - `packages/shell/renderer/app-frame/app-bar.module.css`
  - `packages/shell/renderer/app-frame/app-detail/app-detail.module.css`
  - `packages/shell/renderer/app-frame/view-chrome.module.css`
  - `packages/design/wording` (key만)
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(사람의 feedback을 지운다, 앱 상세의 issues 화면을 지운다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표(사람의 feedback 줄, 앱 상세의 issues와 ticket 화면 줄)
  - architecture: `project-docs/architecture/annotation.md`(사람이 앱 화면에서 App Engineer에게 알리는 남는 길. 이 task는 annotate를 건드리지 않는다), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다", `project-docs/architecture/workspace-layout.md`(앱 패널 탭과 floated 패널. `ViewChrome`이 붙는 자리)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design-api`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/protocol`, `packages/design`
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery부터, "확인"), `.claude/skills/wording/SKILL.md`("key를 지우기 전에"), `.claude/skills/write-test/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/screens/app-space.tsx`(영역 file), `tools/wireframes/pages/screens/app-space/pages.tsx`, `tools/wireframes/pages/screens/app-space/space.tsx`, `tools/wireframes/mock/mock-desktop.tsx`
  - renderer: `packages/shell/renderer/app-frame/app-space.tsx`, `app-frame/app-bar.tsx`, `app-frame/report-button.tsx`, `app-frame/view-chrome.tsx`, `app-frame/app-views.tsx`, `app-frame/app-detail/app-detail.tsx`, `app-frame/app-detail/issues/`, `overlay/entry.tsx`, `overlay/surfaces/surface.tsx`, `overlay/feedback/feedback-dialog.tsx`, `desktop/main.tsx`, `desktop/router.ts`, `desktop/intents.tsx`, `desktop/entry.tsx`, `desktop/dev-mock/mod.ts`, `desktop/dev-mock/app-space.ts`(모두 `packages/shell/renderer/` 아래)
  - 읽기만(정의는 `pr-issues-ui-main`이 지운다): `packages/shell/ipc/feedback.ts`(`LophnShellFeedbackBegin`), `packages/shell/ipc/overlay.ts`(`OverlaySurface.feedback`·`feedbackProblems`), `packages/shell/ipc/shortcuts.ts`(`AppIssueIntent`), `packages/shell/preload/shell.ts`(`lophnFeedback`)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - gallery에서 지운다: page `new-app-issues`, `new-app-issue-detail`, `new-app-report`, `new-app-report-existing`(component `IssuesList`, `IssueRecurred`, `ReportNew`, `ReportExisting`). 앱 공간 page 설명에서 Issues와 [Report a problem]을 뺀다.
    - renderer는 `IssuesSource`, `LophnShellFeedbackBegin`, `LophnShellFeedbackSend`, overlay의 `feedback`·`feedbackProblems` 칸, shortcut의 issue 대상(`onIssue`, `issueProblem`)을 쓰지 않는다. 그 정의(`packages/shell/ipc/*`, preload, main)는 `pr-issues-ui-main`이 지운다.
    - 앱 상세 탭은 Version, Access, Activity 셋이다. 앱 bar에 report 자리가 없다.

## 할 일

근거는 모두 README "정한 것"의 "사람의 feedback(앱 화면 'User report')을 지운다"(annotation이 같은 일을 한다)와 "앱 상세의 issues 화면을 지운다"(사람에게는 toast가 남는다)다. gallery는 renderer component를 import해 그리므로(`ui-kit.md` "gallery가 정본이다") 1~2와 3~5를 같이 바꿔야 type check가 선다.

1. gallery 영역 file부터 고친다: `tools/wireframes/pages/screens/app-space.tsx`(ui-design skill "새 화면 만들기" 4, 7).
   - `pages`에서 넷을 지운다: `new-app-issues`, `new-app-issue-detail`, `new-app-report`, `new-app-report-existing`. import에서 `IssuesList`, `IssueRecurred`, `ReportNew`, `ReportExisting`를 뺀다.
   - 설명을 고친다(한국어 한두 문장을 지킨다).
     - 영역 `summary`: "Issues, 문제 보고"를 뺀다.
     - `app-space`: "[Report a problem]"과 "운영 탭(Issues 등)"을 뺀다.
     - `new-app-space`: title bar 단추 목록에서 [Report a problem]을 뺀다.
     - `new-app-version-applied`: "Version, Access, Activity, Issues 넷"을 "Version, Access, Activity 셋"으로 고친다.
     - `new-app-annotate-list`: "문제가 되지 않고"를 뺀다. problem이 없어진다.
2. gallery 화면 component를 맞춘다.
   - `tools/wireframes/pages/screens/app-space/pages.tsx`: `IssuesList`, `IssueRecurred`, `ReportNew`, `ReportExisting`를 지운다.
   - `tools/wireframes/pages/screens/app-space/space.tsx`: `issue`·`report` prop과 그 drive 단계, `OpsTab`의 `"issues"`와 `TAB_LABEL.issues`, `ISSUE_ID`, `REPEAT_TEXT`, `FEEDBACK_API`, `reporting` state, `feedback` memo, `dialogApi`, `<FeedbackDialog>` 그리기, `build()`의 `issues`, `RealAppSpace`의 `feedback`·`issues` prop, 그것들의 import(`fakeIssues`, `ISSUES`, `PRB_*`, `FeedbackDialog`, `FeedbackDialogApi`)를 지운다.
   - `tools/wireframes/mock/mock-desktop.tsx`: `<Desktop>`의 `issues={mock.issues}`와 `feedback={mock.feedback}`를 지운다.
3. 앱 상세에서 Issues 탭을 지운다(계약 "앱 상세 탭은 Version, Access, Activity 셋이다").
   - `packages/shell/renderer/app-frame/app-detail/issues/` 폴더를 통째로 지운다(`issues-tab.tsx`, `source.ts`, `core-source.ts`, `core-read.ts`, `model.ts`, `testdata/fake-source.ts`).
   - `app-frame/app-detail/app-detail.tsx`: `issues`·`initialTab` prop, Issues의 `Tab`과 `TabPanel`, 머리 주석의 "Issues"를 지운다. `Tabs`의 `defaultValue`는 `"version"`이다.
   - `app-frame/app-space.tsx`: `issues`·`issueProblem` prop과 import(`IssuesTab`, `IssuesSource`), `AppDetail`의 `initialTab`·`issues`를 지운다. `detailsOpen`, `panelTab`, `panelOpen`의 처음 값은 `false`, `"agent"`, `false`다.
4. [Report a problem]을 지운다(계약 "앱 bar에 report 자리가 없다").
   - `app-frame/report-button.tsx`를 지운다.
   - `app-frame/app-space.tsx`: `feedback` prop, `LophnShellFeedbackBegin`·`ReportButton` import, `AppBar`의 `report`를 지운다.
   - `app-frame/app-bar.tsx`: `report` prop과 `data-report-slot` span을 지우고 `marking`은 `annotate !== undefined`다. 머리 주석의 순서를 `[대기 목록] [Annotate] | [Agent, 앱 상세] | ⌘`로 고친다.
   - `app-frame/view-chrome.tsx`: `onReport` prop, 깃발 단추와 그것만 쓰던 import(`Flag`, `IconButton`, `Tooltip`), 머리 주석의 [Report a problem]을 지운다. `viewSession`은 `data-view-session`과 [Open again]이 계속 쓴다. (정한 것 1)
   - `app-frame/app-views.tsx`: `AppViewsDeps.report`를 지운다.
   - `overlay/feedback/` 폴더(`feedback-dialog.tsx`, `feedback-dialog.module.css`)를 지운다.
   - `overlay/surfaces/surface.tsx`: `FeedbackDialog` 갈래와 그 주석, `surfaceMount`의 `feedback` 인자를 지운다. surface는 늘 `SurfaceView`로 그리고 `surface.feedback`을 읽지 않는다.
   - `overlay/entry.tsx`: 전역 `lophnFeedback` 선언과 `FeedbackDialogApi` import를 지우고 `surfaceMount()`를 인자 없이 부른다.
   - `packages/protocol/shell/feedback.ts`(`LophnShellFeedbackSend`)를 지운다. 쓰는 곳이 `feedback-dialog.tsx`뿐이고 `packages/protocol/shell/mod.ts`와 `packages/protocol/deno.json`에 등록되어 있지 않다.
5. desktop 조립에서 두 통로와 Issue 열기를 뺀다(계약 "shortcut의 issue 대상을 쓰지 않는다").
   - `desktop/router.ts`: `Route.issueProblem`을 지운다.
   - `desktop/intents.tsx`: `onIssue` prop, `app-issue` 갈래, 머리 주석의 [View issue] 줄을 지운다. 받은 intent는 모두 전역 팔레트를 연다. `IntentApi`의 type은 아직 `AppIssueIntent`를 품지만(wave 3의 `pr-issues-ui-main`이 지운다) 그 갈래를 읽지 않는다.
   - `desktop/main.tsx`: `feedback`·`issues` prop과 import, `issueTarget`, `AppSpace`의 `feedback`·`issues`·`issueProblem`, `DesktopIntents`의 `onIssue`를 지운다. `AppSpace`의 `key`는 `route.app`이다. "한 번 쓰고 끝나는 시작값"을 적은 두 주석에서 "문제"를 뺀다.
   - `desktop/entry.tsx`: `coreIssuesSource`와 `issues`, `LophnShellFeedbackBegin`과 `feedback`, `bridges`의 `Partial<LophnShellFeedbackBegin>`, `Desktop`의 `issues`·`feedback`, appViews 주석의 "문제 알리기는 아직 core 통로가 없어 두지 않는다"를 지운다.
   - `desktop/dev-mock/mod.ts`, `desktop/dev-mock/app-space.ts`: `DevMock.issues`·`feedback`, `mockIssues`, `mockFeedback`, `mockAppViews`의 `report`, 머리 주석의 Issues와 [Report a problem]을 지운다.
6. 소유 줄에 없는 file. lead가 소유에 더하지 않았으면 최소로 고치고 보고의 "넘길 줄"에 적는다.
   - `packages/shell/renderer/workspace/app-panel-tab.tsx`, `packages/shell/renderer/workspace/visuals/app-card-block.tsx`: `onReport={deps.report}` 한 줄씩을 지운다. 지우지 않으면 4의 `ViewChrome`·`AppViewsDeps` 변경으로 type check가 깨진다.
   - `packages/shell/renderer/app-frame/report-button.module.css`를 지운다. `report-button.tsx`만 썼다.
   - CSS의 죽은 몫: `app-frame/app-bar.module.css`의 `.report:empty`, `app-frame/app-detail/app-detail.module.css`의 Issues 몫(`.issueRow`, `.issueRow:hover`, `.issueMeta`, `.occurrence`, `.quote`, `.code`, `.filterField`, `.stack`. `.issueTitle`은 `activity/rewind-panel.tsx`가 써서 남긴다), `app-frame/view-chrome.module.css` 머리 주석의 "끝에 문제 알리기"
7. wording key를 지운다(`packages/design/wording`, key만. wording skill "key를 지우기 전에").
   - 지울 것: 지운 file(`app-detail/issues/`, `overlay/feedback/`, `report-button.tsx`)이 쓰던 key 가운데 다른 곳이 안 쓰는 것 전부와 `app-detail.label.tab-issues`, `app-detail.note.issues-unavailable`, `common.button.report-problem`. `report-problem.*`는 `catalog/app-space.ts`와 `catalog/data.ts`에, Issues 탭의 `app-detail.*`는 `catalog/app-space.ts`에 있다. 조사로는 그 file들의 key 가운데 `common.button.cancel`과 `common.button.close`만 다른 곳이 쓴다.
   - key마다 앞부분으로 `packages`와 `tools`를 grep한다(catalog와 `.placeholders.ts` 제외). 조사로는 이 영역에 template literal key가 없다.
   - `deno task wording`으로 `.placeholders.ts`를 다시 만든다. 손으로 고치지 않는다.
8. 지운 이름(`issueProblem`, `onReport`, `report-problem`, `[Report a problem]`, `Issues`)을 주석과 문구에서도 grep해 맞춘다. 이름이 비슷한 다른 뜻(`AgentDefinitionIssue`, design의 `@lophn/ui/feedback` 분류)은 건드리지 않는다.

정한 것:
1. `ViewChrome`(앱 패널 탭과 세션 앱 카드의 크롬)의 깃발도 지운다. 이유: 같은 [Report a problem] 길의 다른 입구다. 제품 entry는 `AppViewsDeps.report`를 꽂지 않아 늘 잠겨 있었다(`desktop/entry.tsx` 주석).
2. gallery의 버린 화면 목록(`tools/wireframes/pages/index.ts` 머리 주석)에 "앱 상세 Issues, Report a problem dialog"를 더하는 것은 lead에게 넘긴다(보고의 "등록할 것"). 이유: ui-design skill이 버린 화면을 그 주석에 적게 하고, 그 file은 lead가 고치는 gallery 등록 file이다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다. `check:full`은 renderer build를 보지 않는다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고(ui-design skill "확인"), gallery에서 다음이 그려진다.
  - `new-app-space`: 바에 [Annotate]와 앱 상세 단추가 있고 깃발이 없다.
  - `new-app-version-applied`, `new-app-side-panel`: App details 탭이 Version, Access, Activity 셋이다.
  - `app-space`, `new-app-activity`, `new-app-annotate-list`, `domain-app-b`가 그대로 그려진다.
  - `new-float-over-app`: 앱 패널 탭의 크롬에 깃발이 없다.
  - `new-app-issues`, `new-app-issue-detail`, `new-app-report`, `new-app-report-existing`는 목록에 없다.
- 위험 test: 없음. 화면과 문구다(write-test skill).
- 남지 않음:
  - `ls packages/shell/renderer/app-frame/app-detail/issues packages/shell/renderer/overlay/feedback packages/shell/renderer/app-frame/report-button.tsx packages/shell/renderer/app-frame/report-button.module.css packages/protocol/shell/feedback.ts`가 모두 없다고 답한다.
  - `grep -rn --exclude-dir=dist "\bIssuesSource\b\|\bIssuesTab\b\|\bissueProblem\b\|\bonIssue\b\|app-issue\|FeedbackDialog\|lophnFeedback\|LophnShellFeedback\|beginFeedback\|feedbackProblems\|\bReportButton\b\|\bonReport\b\|data-report" packages/shell/renderer tools/wireframes packages/protocol`가 0줄이다.
  - `grep -rn --exclude-dir=dist "report-problem\|tab-issues\|issues-unavailable\|new-app-issue\|new-app-report" packages/design/wording packages/shell/renderer tools/wireframes`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 적어도 `tools/wireframes/pages/index.ts` 머리 주석의 버린 화면(정한 것 2)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(할 일 6)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
