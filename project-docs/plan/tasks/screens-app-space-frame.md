# screens-app-space-frame

앱 공간의 틀(위쪽 바, 앱 화면, 옆 pane, 운영 패널 위치)을 wireframe 코드 `app-space/space.tsx`대로 renderer `app-frame/`에 옮긴다. 위쪽 바를 아이콘 단추만으로 바꾸고, agent·coding 터미널 pane, project 고르기, annotate mode 화면(S9), 제보 dialog를 새로 얹는다. gallery의 app-space page는 옮긴 component를 fake source로 그리게 하고, 이때 앞 task(`screens-app-space-detail`)의 탭들도 같이 그려진다.

- 단위: screens-app-space (wave 3)
- 선행: screens-app-space-detail, screens-data-waiting, screens-data-toast, screens-project-terminal (이유: 운영 패널의 탭 component와 fake를 gallery에서 같이 그리고 `AppDetail`·`IssuesTab`의 props가 바뀌므로 `app-space.tsx`가 그 뒤에 맞춘다 / 대기 목록의 `WaitingLayer`(pill과 panel)와 `useWaitingPanel`을 위쪽 바에 꽂고 옛 `SpaceDecisions`가 이 공간에서 갈아타진다 / `registerToastActionHandler`, `ToastAction`으로 이 공간이 보이는 동안 toast 행동 처리기를 등록한다 / `useTerminalOpenRequests`, `TerminalStore.focusSession`, `TerminalTab`의 `coding` prop을 앱 공간 pane이 같이 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/` (`app-detail/`은 앞 task 소유라 제외)
  - `packages/shell/renderer/overlay/feedback/` (`ownership.md`는 screens-data에 주었으나 제보 dialog는 이 task의 일이다. 소유 바꾸기 요청을 보고한다)
  - `tools/wireframes/frames/compositions/app-space/`
  - `packages/design/wording/catalog/app-space.ts` (앞 task와 같은 file. 앞 task가 먼저, 이 task가 뒤다)
  - `packages/design/wording/catalog/app-space.placeholders.ts` (`generate.ts`가 만드는 생성물)
- 읽을 것:
  - spec: S9 3·4·5·7·10장(부품과 소유, 고르기, annotation 값, 받는 session, 실패) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - spec: S8 2장(앱 place의 agent: lophn, App Engineer, Operator) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S6 5장·7장(lophn이 터미널을 연다, focus를 옮기지 않는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `U2.3#2`, `U2.4#10`, `U2.4#12`, `U2.4#13`, `U2.4#14`, `U3.4#1`, `U3.4#5`, `U6.6#1`, `U6.6#2`, `U6.6#3`, `I3.9#2`
  - 결정: `../README.md` 3장 #17(앱 view 다시 그리기 신호는 `AppViewChanged`), #18·#23·#57(이름), #112(annotation의 source 위치는 release의 source map. 이 task 몫 아님)
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/app-space/space.tsx` → `app-space.tsx`·`app-bar.tsx`·`agent-select.tsx`·`ops-panel-frame.tsx`
    - `tools/wireframes/frames/compositions/app-space/side-pane.tsx`, `coding-tab.tsx`, `toast.tsx` → `agent-pane.tsx`(pane 머리 `TabStrip`)
    - `tools/wireframes/frames/compositions/app-space/annotate.tsx` → 새 `annotate/annotation-panel.tsx`
    - `tools/wireframes/frames/compositions/app-space/project-picker.tsx` → 새 `project-picker.tsx`
    - `tools/wireframes/frames/compositions/app-space/report-dialog.tsx` → `overlay/feedback/feedback-dialog.tsx`
    - `tools/wireframes/frames/compositions/app-space/orders-view.tsx` (앱이 그린 화면의 고정 그림. gallery 전용으로 남긴다)
    - `ui-inventory.md` 6.1(탭 안 알림은 toast), 6.3(`TabStrip`), 6.6
- 계약:
  - 쓰는 것:
    - annotate: `packages/shell/ipc/annotation.ts`(contract-app-calls-annotation)의 `LophnShellAnnotateApi = { setMode, remove, send, subscribeState }`, `annotateStateSchema = { view_session, on, phase: "idle" | "sending", items: [{ n, kind, note, label }] }`, `annotateSendResultSchema = { sent, session }`. 실패는 code를 message로 싣은 Error로 거절된다.
    - 앱 view: `shell/ipc/app-frame.ts`의 `AppViewOpen.project`(optional), `AppFrameViewState.project`(nullable optional), `LophnShellViewsApi.setViewProject({ view_session, project | null })`(contract-app-calls-shell).
    - 제보: `shell/ipc/feedback.ts`의 `shell:feedback-begin`(시작), `shell:feedback-send`(`{ draftRef, text }` → `{ report, problem | null }`), `shell:feedback-cancel`. `LophnShellFeedbackSend.sendFeedback(draftRef, text)`(contract-releases-problems-feedback). 미리보기 push와 `selection`은 없다.
    - 터미널: `shell/ipc/terminal.ts`의 `TerminalApi.focusSession({ session })`와 `TerminalRuntime.coding_session`(contract-coding-routes).
    - overlay: `shell/ipc/overlay.ts`의 `notification` 표면(`label`, `text`, `choices` 앞 셋이 단추, `tone`). contract-shell.
    - ui-chrome(wave 2)의 design `TabStrip`, `Toast`(단추 오른쪽), `VendorIcon`, 위쪽 바(36px, ⌘ 단추 `PaletteButton`).
    - screens-conversation이 옮긴 `AgentView`, screens-agents-editor가 고친 `AgentsPage`·`AgentsSource.list`(읽기만).
    - screens-data-waiting의 `WaitingLayer({ onOpenSession, onAnswerInTerminal })`, `useWaitingPanel()`. screens-data-toast의 `registerToastActionHandler(handler)`와 `ToastAction`(`{ kind: "waiting" } | { kind: "session", session } | { kind: "project-manager", project, violation }`). screens-project-terminal의 `useTerminalOpenRequests(open)`, `TerminalStore.focusSession(session)`, `TerminalTab`의 `coding?: { product, session, ended? }`.
  - 내놓는 것 (이름 유지. 소비자: `desktop/main.tsx`(screens-workspace-space), `workspace/app-panel-tab.tsx`(screens-project)):
    - `AppSpace`와 props. 새 prop은 optional로만 더한다: `project?: string`(처음 project), `annotate?: LophnShellAnnotateApi`, `projects?`(project 고르기 목록을 읽는 함수), `overlay?: OverlayApi`(native view 위 toast), `session?: string`(처음에 열어 둘 agent session), `onOpenSession?(session)`, `terminal?: TerminalDeps`(터미널 탭 통로. 있어야 터미널 탭을 그린다). 안 쓰게 된 prop은 type에서 지우지 말고 보고의 "남긴 prop"에 적는다.
    - `EmbeddedView`와 `AppViewsDeps`에 `project?: string` 더하기. screens-project의 `app-panel-tab.tsx`가 넘긴다.
    - fake: gallery 전용 fake annotate 통로 `app-frame/testdata/fake-annotate.ts`의 `fakeAnnotate()`. dev-mock이 쓴다.

## 할 일

1. **위쪽 바를 wireframe대로 바꾼다** — `app-bar.tsx`, `app-space.tsx`. (`U6.6#1`, `U6.6#3`)
   - 앞쪽: 런처 단추, 앱 이름, 상태 표시, project가 정해졌으면 `· <project 이름>`(state의 `project`를 `projects` 목록에서 이름으로 푼다). 뒤쪽은 글자 없이 tooltip만 있는 아이콘 단추이고 순서는 [Annotate, Report(깃발)] | [Agent ▾, 앱 상세] | ⌘(`PaletteButton`)이다. 켜진 것(Annotate, Agent, 앱 상세)은 눌린 모양(`aria-pressed`)이다. 단추 사이에 가는 구분선이 있다.
   - 앱 화면은 위쪽 바 아래 전체를 쓴다. 탭 줄이 없다.
   - 대기 목록 pill은 뒤쪽 묶음 맨 앞의 `decisions` 칸에 `WaitingLayer`로 끼운다. 옛 `SpaceDecisions` import를 걷는다. `onOpenSession`은 이 공간의 agent pane에 그 session이 있으면 pane을 그 session으로 열고, 아니면 `onOpenSession` prop(호스트)에 넘긴다. `onAnswerInTerminal(session)`은 이 pane의 터미널 탭 session과 같으면 pane을 터미널 탭으로 바꾸고 `TerminalStore.focusSession(session)`을 부른다. 같지 않으면 아무것도 하지 않고 `false`로 알려 호스트가 다른 화면으로 가게 한다.
   - wireframe에 없는 단추는 뺀다: 문서 작업대로 가는 `onDocuments`(Documents 화면이 없다), 새 창 열기 `onNewWindow`. OS 앱 바로가기 안내(`ShortcutNotice`)와 `windows` 통로는 wireframe에 둘 곳이 없다. 쓰는 곳이 없으면 이 task에서 화면 코드를 지우고, props는 "남긴 prop"에 적는다. 앱 바로가기를 어디로 옮길지는 보고의 "정한 것"에 질문으로 남긴다.
2. **agent select를 맞춘다** — `agent-select.tsx`, `app-agents.ts`. (`U2.4#14`, `U2.3#2`의 이 파일 몫)
   - 메뉴 항목은 그 앱 place의 agent: lophn, App Engineer, 이 앱에 놓인 Operator들(avatar와 이름). 끝에 "Manage". `context_engineer`를 거르던 코드는 지운다(앱 place에는 Project Manager가 없다). role 이름은 `project_manager`로 바꾼다.
   - 단추는 Agent 아이콘과 chevron이고 옆 pane이 열려 있으면 눌린 모양이다.
   - `AgentsSource.list`가 앱 place 기준 줄을 돌려주는지 확인한다. 모양을 바꿔야 하면 screens-agents-editor에게 가는 보고에 적는다(이 task는 `workspace/agents/`를 고치지 않는다).
3. **옆 pane을 만든다** — `agent-pane.tsx`(`AGENT_PANE_WIDTH`, `agentPanePlacement` 규칙은 유지). (`U6.6#2`)
   - pane 머리는 design `TabStrip`이다: agent 탭(agent의 avatar와 이름)과, lophn이 연 coding 터미널이 있을 때만 터미널 탭(harness의 `VendorIcon`과 "Claude Code · <ticket 이름>", 상태 점 waiting·ended), 끝에 닫기 ×.
   - agent 탭 본문은 기존대로 `AgentView`(대화) 또는 Manage가 연 `AgentsPage`다.
   - 터미널 탭 본문은 renderer `terminal/terminal-tab.tsx`의 `TerminalTab`이다(screens-project 소유. 고치지 않고 import만 한다). core 요청으로 lophn이 여는 터미널은 `useTerminalOpenRequests(open)`으로 받는다. 요청의 coding 표지가 이 앱의 것이면(요청에 app이 있는지, 모양은 screens-project-terminal 보고) pane의 터미널 탭으로 두고 `open(tab, { focus: false })` 규칙대로 agent 탭에서 focus를 옮기지 않는다. 다른 앱의 요청은 받지 않는다. 끝난 터미널은 "session ended"로 보이고 다시 시작 단추는 없다(`TerminalTab`이 그린다).
   - 터미널 요청을 받으면 focus를 옮기지 않고 pane 머리 바로 아래에 toast를 띄운다: "App Engineer opened Claude Code for ticket ORD-12" + [Show terminal](누르면 터미널 탭으로 바뀐다). 이 toast는 pane 안(renderer DOM)이라 design `Toast`를 직접 쓴다. 단추는 오른쪽 끝이다.
4. **project 고르기를 만든다** — 새 `project-picker.tsx`. (`U3.4#5`, `U2.4#12`)
   - 앱 place에서 연 앱 공간은 project를 모른다. 계약대로 view는 먼저 열고(`openApp`, `project` 없이), state의 `project`가 null인 동안 그 위에 project 고르기(`List`/`ListItem`: 이름, 폴더)를 보인다. native view가 DOM을 가리므로 고르는 동안 view를 `useViewCover`(기존 `ViewCoversProvider`) 또는 `setViewsHidden`으로 가린다. 고르면 `views.setViewProject({ view_session, project })`를 부르고 state push로 갱신한 뒤 view를 다시 보인다.
   - 목록은 `projects` prop(project 목록을 읽는 함수. 없으면 고르기 없이 안내)에서 읽는다. 처음부터 `project` prop이 있으면(project 창에서 온 경우) 고르기를 건너뛰고 `openApp`에 싣는다.
   - `embedded-view.tsx`와 `app-views.tsx`가 `openApp` 입력에 `project`를 싣는다(`U2.4#11`의 renderer 몫).
5. **annotate mode 화면을 만든다** — `annotate/annotation-panel.tsx`, `annotate/use-annotate.ts`(`subscribeState`를 구독하는 hook). (`U3.4#1`, `I3.9#2`, S9 4·7장)
   - 이 task가 그리는 것은 shell renderer 몫 넷뿐이다: 위쪽 바의 Annotate 단추, "Annotate is on — Click an element or drag an area, then write a note. [Done]" toast, 모은 annotation 목록 panel, 보내기. 요소 윤곽·이름표·번호 표지·메모 칸은 앱 view 안에서 preload script가 그리므로 renderer 코드에 없다(annotation unit 몫).
   - Annotate 단추는 `annotate.setMode({ view_session, on })`을 부른다. Esc나 [Done]이 끈다. 목록(`state.items`: 번호, 대상 이름 `label`, 메모)은 `subscribeState`로 구독해 panel에 보인다. 하나씩 지우기(`remove({ view_session, n })`), [Clear all](`n: "all"`), [Send to App Engineer](`send({ view_session })`, 목록이 비면 꺼짐, `phase: "sending"`이면 진행 표시)가 있다. 보내면 mode가 꺼지고 "N annotations sent to App Engineer — They arrive in its session as one message." toast가 뜬다(N은 `sent`). 보관한 앱이면 보내기가 `conflict`로 거절되고 이유가 panel에 남는다(S9 10장).
   - panel 안내 글: "They go to App Engineer as one message. They don't become problems."
   - `annotate` prop이 없으면 Annotate 단추를 두지 않는다.
   - **native view 위 toast.** Annotate 켜짐·보냄·돌아감 같은 알림은 앱 화면 위쪽에 뜬다. native view가 DOM을 가리므로 `overlay` prop(`OverlayApi`)이 있으면 overlay의 `notification` 표면(`overlayConsumer`, `label`·`text`·`choices`)으로 연다. 없으면(gallery, 앱 view 없는 상태) 같은 모양의 design `Toast`를 앱 화면 영역 위쪽에 DOM으로 그린다. 두 경로를 `annotate/use-view-toast.ts` 한 곳에 둔다.
   - gallery 전용 fake: `app-frame/testdata/fake-annotate.ts`의 `fakeAnnotate()`(목록을 메모리에 들고 구독자에게 알린다).
6. **제보를 맞춘다** — `report-button.tsx`, `overlay/feedback/feedback-dialog.tsx`. (`U2.4#10`)
   - 단추는 깃발 `IconButton`(tooltip "Report a problem")이다. 글자 단추를 지운다. 누르면 기존대로 `beginFeedback(view_session)`이다.
   - dialog는 wireframe `report-dialog.tsx`: "What went wrong?"(글, 안내 "Only this text is sent. No screenshot and no screen state."), "Send it as"(`A new problem` | `Another report of an existing problem`), 기존 문제를 고르는 목록(열림·해결됨 문제. 무시한 문제는 뺀다), [Cancel]·[Send]. screenshot·화면 상태 미리보기와 항목별 체크(`Checkbox`, `FeedbackScreenshotState`, `screenshotNotice`, `subscribePreview`)를 지운다. [Send]는 `sendFeedback(draftRef, text)`를 부르고 접수 뒤 묶인 문제로 가는 길(`FEEDBACK_OPEN_ISSUE`)은 유지한다.
   - 새 보내기 입력 `feedbackSendSchema`에는 `existing_problem` 칸과 기존 문제 목록을 읽는 통로가 없다. 이 task는 목록과 선택까지 화면을 만들고, 그 값이 갈 곳이 계약에 없으면 보고의 "계약 바꾸기 요청"에 적는다(추천: send에 `existing_problem` 칸 추가, 목록은 begin 답으로). 그 사이 "Another report…" 갈래는 목록을 fake로만 채운다.
   - main 쪽 캡처 제거(`main/app-frame/feedback.ts`)는 `screens-app-space-main`이 한다.
7. **문서 보기 slot** — `document-view-slot.tsx`. (`U2.4#13`의 renderer 몫)
   - 지금 이 slot을 쓰는 곳이 없다(`grep -rn "DocumentViewSlot" packages` 확인). 부르는 쪽이 없는 동작은 만들지 않는다(`dev/code.md`). 호출자가 여전히 없으면 `document-view-slot.tsx`를 지우고 "정한 것"에 적는다. inventory 줄(판 칸 없이 파일 경로로 연다)은 호출자가 생길 때 다시 만든다.
   - 호출자가 생겼으면 판(`version`) 없이 파일 경로로 연다. 입력 모양은 contract-app-calls가 `protocol/shell/app-frame.ts`의 `documentViewOpenSchema`에 둔 것을 따른다.
8. **옛 조각을 지운다** — `app-space.tsx`의 `tasks`·`taskTarget`·`TasksTab`, `withReportAgain`, `onThingsToConfirm`(Things to confirm 화면이 없다), `onOpenResult`의 `version` 인자(문서 판이 없다), Documents 전환. `view-chrome.tsx`가 report 단추를 글자로 그리면 아이콘 단추로 맞춘다. 안 쓰게 된 prop은 "남긴 prop"에 적는다.
9. **toast 행동 처리기를 등록한다.** `AppSpace`가 마운트된 동안 `registerToastActionHandler`로 처리기 하나를 등록하고 해제한다(`app-frame/toast-handler.ts`). `{ kind: "waiting" }` → `useWaitingPanel().setOpen(true)`, `{ kind: "session", session }` → 그 session이 이 앱의 agent session이면 pane을 그 session으로 열고 `true`, 아니면 `false`(기본 처리기가 다른 화면으로 간다), `{ kind: "project-manager", … }` → `false`. 근거: S1 8장.
10. **글을 wording key로 바꾼다.** 박아 둔 영어 글을 `catalog/app-space.ts`의 key로 만든다. 글이 바뀌지 않은 곳은 기존 key를 그대로 쓴다. 안 쓰게 된 옛 key(`app-space.button.documents`, `report-problem.notice.screenshot-*` 등)는 지우지 않는다(4단계 cleanup). 만든 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 이 영역의 `catalog/app-space.placeholders.ts`를 다시 만든다.
11. **CSS** — `app-space.module.css`, `app-bar.module.css`, `agent-pane.module.css`, `agent-select.module.css`, `ops-panel-frame.module.css`를 wireframe `app-space.module.css`(950줄)에서 이 task 몫 규칙(바 구분선, 눌린 단추, pane, picker, annotation panel)으로 맞춘다. 탭 안 알림은 색 띠가 아니라 toast(6.1).
12. **gallery를 옮긴 component로 그린다.**
    - `app-space/space.tsx`: export `AppSpace`와 props(`panel`, `version`, `revoking`, `activity`, `issue`, `agentMenu`, `report`, `annotate`, `picker`, `pane`, `terminal`, `openedToast`)는 그대로 두고 본문을 renderer `AppSpace` + fake source로 바꾼다. `app-space/pages.tsx`는 고치지 않는다.
    - source: 앞 task의 `fakeDetail`·`fakeIssues`, 이 task의 `fakeAnnotate`, `desktop/dev-mock/app-space.ts`의 `mockViews`·`mockAppViews`·`mockFeedback`, agent는 `createFakeAgentsSource()`와 `desktop/dev-mock/agent.ts`의 `mockAgentViewSource`, 대기 목록은 `desktop/connection/waiting/fake-source.ts`, 터미널은 `frames/mock-desktop.tsx`가 쓰는 `fakeTerminal`과 `TerminalStore`(`requestFromCore`로 coding 탭을 채운다) 방식.
    - 앱 view 칸: fake views의 box 위치에 gallery 전용 `orders-view.tsx`(`OrdersView`와 `marks`: hover 윤곽, 번호 표지, 메모, 영역)를 그린다. 이 표시들은 실제로는 앱 view 안 preload가 그린다. wrapper가 `createPortal`로 box 안에 넣는다.
    - 상태 고정은 fake source의 설정(예: `fakeDetail({ activation: "applying" })`)과 mount 뒤 click(`app-bar`의 `data-app-bar="app-details"` 단추 등)으로 만든다. component에 gallery 전용 prop을 더하지 않는다. click helper가 필요하면 `app-space/drive.ts`에 작게 둔다.
    - 지운다: `app-space/{access-tab,activity-tab,version-tab,rewind-panel,issues-tab,parts,side-pane,coding-tab,toast,annotate,project-picker,report-dialog}.tsx`, `data.ts`에서 옮겨진 부분(앞 task가 fake로 복사한 것). 남기는 것: `space.tsx`, `pages.tsx`, `orders-view.tsx`와 그것이 쓰는 `ORDER_ROWS`, `APP_NAME`.
13. (lead가 맞추며 더함) `annotation.send`에 받을 `session`(null이면 새 session)을 같이 넘긴다(contract-app-calls-annotation).

- (lead가 더함, screens-project-window가 넘긴 것) `ipc/app-frame.ts`의 `AppViewOpen.project`를 `app-panel-tab`이 `EmbeddedView`에 넘기지만 `renderer/app-frame/embedded-view.tsx`의 `openApp` 입력이 `project`를 싣지 않는다. 그 한 줄을 더한다. screens-app-space-detail이 넘긴 것: `AppDetail`에 새 선택 prop `onOpenSession?: (session) => void`가 있다(앱 호출 기록의 session 이름을 누르면 그 session을 연다). frame이 잇는다. `app-space.tsx`의 `viewSession` 흐름을 정리한다. `AppDetailProps`의 `preview`·`onPreview`는 화면이 읽지 않는다.

- (lead가 더함, screens-project-reactions가 넘긴 것) app space도 위쪽 바에 `WaitingLayer`를 꽂고 보이는 동안 toast 처리기를 등록한다(project 창의 `workspace/reactions/toast-handler.ts`와 같은 꼴). 재시작 멈춤(`session:null`+`app`)과 그 앱의 App Engineer session 열기를 이 처리기가 받는다. 그 뒤 `app-space.tsx`의 `SpaceDecisions`·`WaitingPill`·`useRequestOverview` 쓰임을 걷는다. screens-agents-editor가 넘긴 것: `app-agents.ts`에 `project_manager` role을 거르는 한 줄이 들어갔다. agent key는 이제 role 이름 또는 `agt_…`이고 `asg_…`가 아니다.

- (lead가 더함, app-calls-shell의 계약 바꾸기 요청, lead 승인) `ipc/app-frame.ts`의 `appFrameViewStateSchema.project`를 `nullable()`(필수)로 바꾼다. main은 늘 채운다. 바꾸면 renderer fake의 `openApp`이 `project: null`을 싣게 맞춘다(계약 file 추가 소유).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 task. 보내기는 사람의 동작이고 Gate가 없다. 저장·ticket 근거는 B10 몫)
- 남지 않음:
  - `grep -rn "TasksTab\|taskTarget\|withReportAgain\|onThingsToConfirm\|context_engineer\|SpaceDecisions" packages/shell/renderer/app-frame`이 0줄이다.
  - `grep -rn "screenshot_png\|FeedbackScreenshotState" packages/shell/renderer/overlay`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-app-space`, `new-app-agent-pane`, `new-app-version-*`, `new-app-access*`, `new-app-activity`, `new-app-rewind-*`, `new-app-issues`, `new-app-issue-detail`, `new-app-report*`, `new-app-annotate*`, `new-app-project-picker`, `new-app-coding-*`이 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `app-space`의 새 key와 지운 key(wording 생성). `desktop/dev-mock/app-space.ts`(`mockViews`에 `setViewProject`와 annotate가 필요한지, `fakeAnnotate` 연결), `desktop/main.tsx`·`desktop/entry.tsx`가 `AppSpace`에 넘길 새 prop(`project`, `annotate`, `projects`, `overlay`, `terminal`, `session`, `onOpenSession`) — screens-workspace-space가 잇는다. `preload/shell.ts`가 `lophnShell`에 `LophnShellAnnotateApi`를 여는 줄은 contract-app-calls와 lead 몫이다. 확인해서 적는다.
- 안 쓰게 된 export: `ReportButton`의 글자 단추 props, `AppBar`의 `onDocuments`·`onNewWindow`, `feedback-dialog.tsx`의 preview 관련 등 (남이 쓰던 것은 지우지 않았다)
- 남긴 prop: `AppSpaceProps`의 `tasks`, `taskTarget`, `windows`, `onDocuments`, `onThingsToConfirm`, `onOpenResult`의 version 인자 등. screens-workspace-space가 지운다.
- 정한 것: 새 창 열기·OS 바로가기를 위쪽 바에서 뺀 것(wireframe에 없다. 어디로 옮길지 lead에 질문), 문서 slot을 지웠는지, project 고르기가 view를 먼저 열고 가리는 방식, native view 위 toast 경로
- 계약 바꾸기 요청(wave 3): `feedbackSendSchema`의 `existing_problem` 칸과 기존 문제 목록 통로, annotate 통로 type이 모자라면 적는다
