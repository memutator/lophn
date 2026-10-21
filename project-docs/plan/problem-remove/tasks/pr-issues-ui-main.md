# pr-issues-ui-main

renderer가 더 쓰지 않는 사람 feedback 통로를 shell main, IPC, preload에서 지운다: [Report a problem]의 시작·제출·screenshot·overlay dialog 연결, feedback이 묶인 Issue를 여는 shortcut, 문제 사람 결정 handle(`problems/closing`).

- 단위: issues-ui (wave 3)
- 선행: pr-issues-ui-screen. renderer가 이 통로를 쓰지 않게 된 뒤다.
- 소유(이 task만 고친다):
  - `packages/shell/ipc/feedback.ts`
  - `packages/shell/ipc/overlay.ts`
  - `packages/shell/ipc/shortcuts.ts`
  - `packages/shell/main/app-frame/feedback.ts`
  - `packages/shell/main/app-frame/overlay.ts`
  - `packages/shell/main/app-frame/registry.ts`
  - `packages/shell/main/app-frame/view-model.ts`
  - `packages/shell/main/app-frame/electron-overlay.ts`
  - `packages/shell/main/app-frame/electron-app-frame.ts`
  - `packages/shell/main/desktop/main.ts`
  - `packages/shell/main/desktop/wiring/feedback.ts`
  - `packages/shell/main/decision-handle/issue.ts`
  - `packages/shell/main/decision-handle/problem-decision.ts`
  - `packages/shell/main/decision-handle/ipc_test.ts`
  - `packages/shell/preload/feedback-api.ts`
  - `packages/shell/preload/shell.ts`
  - `packages/shell/preload/shortcut-api.ts`
  - `packages/shell/ipc/confirmation.ts`
  - `packages/shell/main/decision-handle/core.ts`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(사람의 feedback을 지운다, 죽은 problem 계약을 지운다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표(사람의 feedback 줄)
  - architecture: `project-docs/architecture/annotation.md`(screenshot은 view만 찍고 큰 이미지는 정해진 크기로 줄인다. 신원은 shell main이 sender view로 정한다), `project-docs/architecture/workspace-layout.md`("native view 층"의 overlay. overlay는 다른 문서다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `core-api`(shell main이 부르던 core route), `problems`; `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/ipc`, `packages/shell/preload`
  - IPC: `packages/shell/ipc/feedback.ts`, `packages/shell/ipc/overlay.ts`(`OverlaySurface`), `packages/shell/ipc/shortcuts.ts`(`AppIssueIntent`, `isDesktopIntent`), 읽기만 `packages/shell/ipc/confirmation.ts`(`ownerDecisionSchema`의 `choice`·`note`)
  - main: `packages/shell/main/app-frame/feedback.ts`, `app-frame/overlay.ts`(`openFeedback`, `closeFeedback`, `isOverlay`, `feedbackEnded`), `app-frame/electron-overlay.ts`(`controller`, `onFeedbackEnded`), `app-frame/registry.ts`·`app-frame/view-model.ts`(`feedbackView`, `FeedbackViewSnapshot`), `app-frame/electron-app-frame.ts`(`capture`의 `FEEDBACK_LIMITS.png_long_side`), `desktop/wiring/feedback.ts`, `desktop/main.ts`(모두 `packages/shell/main/` 아래)
  - main 읽기만: `packages/shell/main/app-frame/capture.ts`(annotation screenshot의 `SCREENSHOT_LONG_SIDE`), `packages/shell/main/desktop/wiring/context.ts`(`overlays`의 type은 `ReturnType<typeof electronOverlays>`다), `packages/shell/main/app-frame/view-error.ts`(`reportIdOf`는 `desktop/wiring/app-views.ts`가 계속 쓴다. `pr-log-view-error` 몫)
  - decision handle: `packages/shell/main/decision-handle/`의 `issue.ts`, `problem-decision.ts`, `provider-disconnect.ts`, `core.ts`, `ipc.ts`, `ipc_test.ts`
  - preload: `packages/shell/preload/feedback-api.ts`, `packages/shell/preload/shell.ts`, `packages/shell/preload/shortcut-api.ts`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - 지운다: `LophnShellFeedbackBegin`과 feedback IPC channel, preload `lophnFeedback`·`createFeedbackBegin`·`createOverlayFeedback`, overlay surface의 `feedback`·`feedbackProblems` 칸과 `feedbackEnded`, shortcut의 issue 대상(`problem` id), `FeedbackViewSnapshot`·`feedbackView`, decision handle의 `PROBLEM_CONCERN`·`PROBLEM_DECISION`
    - shell main은 core `problem.submit_feedback`을 부르지 않는다. annotation의 screenshot 잡기가 `FEEDBACK_LIMITS`를 쓰면 그 값을 annotation 쪽 이름으로 옮겨 남긴다.
    - decision handle은 provider 끊기(`PROVIDER_CONCERN`) 하나가 남는다.

## 할 일

근거는 README "정한 것"의 "사람의 feedback(앱 화면 'User report')을 지운다"와 "죽은 problem 계약을 지운다"다. renderer 쪽은 `pr-issues-ui-screen`이 이미 끊었다.

1. renderer가 끊겼는지 먼저 본다. `grep -rn "lophnFeedback\|beginFeedback\|feedbackProblems\|app-issue\|issueProblem" packages/shell/renderer`가 0줄이어야 한다. 아니면 멈추고 보고한다.
2. IPC 계약에서 feedback을 지운다(계약 "지운다").
   - `packages/shell/ipc/feedback.ts`를 지운다: channel 넷(`FEEDBACK_BEGIN_CHANNEL`, `FEEDBACK_SEND_CHANNEL`, `FEEDBACK_CANCEL_CHANNEL`, `FEEDBACK_OPEN_ISSUE_CHANNEL`), `FEEDBACK_LIMITS`, `FEEDBACK_PROBLEM_NAME`, schema, `LophnShellFeedbackBegin`, `LophnOverlayFeedback`, `FeedbackProblem`, `FeedbackReply`, `FeedbackAccepted`.
   - `packages/shell/ipc/overlay.ts`: `OverlaySurface`의 `feedback`·`feedbackProblems`와 그 주석, `FeedbackProblem` import를 지운다.
   - `packages/shell/ipc/shortcuts.ts`: `AppIssueIntent`, `APP_ID`·`PROBLEM_ID`, `isDesktopIntent`의 object 갈래와 그 주석을 지운다. `DesktopIntent`는 `typeof DESKTOP_INTENTS[number]`다.
3. preload.
   - `packages/shell/preload/feedback-api.ts`를 지운다(`createFeedbackBegin`, `createOverlayFeedback`).
   - `packages/shell/preload/shell.ts`: 그 import, desktop 쪽 `...createFeedbackBegin(ipcRenderer)`, overlay role의 `lophnFeedback` 노출 블록과 그 주석을 지운다.
   - `packages/shell/preload/shortcut-api.ts`: `createIntentApi`는 검사한 문자열 intent만 넘긴다(object를 새로 얼려 만드는 갈래를 지운다). 머리 주석의 "feedback의 Issue 열기"를 뺀다.
4. shell main의 feedback 길을 지운다. 이로써 core `problems/submit_feedback`(worker)과 `problems/list_problems`·`problems/get-report`(read)를 부르지 않는다. 그 route는 wave 4의 `pr-problems-core`가 지운다.
   - `packages/shell/main/app-frame/feedback.ts`와 `packages/shell/main/desktop/wiring/feedback.ts`를 지우고, `packages/shell/main/desktop/main.ts`의 import와 `add(feedback.register(ctx, views))`를 지운다.
   - `app-frame/overlay.ts`: `OverlayOptions.feedbackEnded`, `Surface`의 `feedback`·`feedbackProblems`, `resizeFrame`·`finish`·`snapshot`·`result`의 feedback 갈래, `openFeedback`, `closeFeedback`, `isOverlay`를 지운다. `isOverlay`는 feedback wiring만 썼다. `FeedbackProblem` import도 지운다. `CallerContents`는 `owns`와 `OverlayContents`가 계속 쓴다.
   - `app-frame/electron-overlay.ts`: `feedbackEnded` 변수, `onFeedbackEnded`, `controller()`, `createOverlay`에 넘기던 `feedbackEnded`를 지운다. `controller()`는 feedback wiring만 썼다. `byWindow`는 `raise`가 계속 쓴다.
   - `app-frame/registry.ts`, `app-frame/view-model.ts`: `FeedbackViewSnapshot`(정의, import, re-export)과 `feedbackView`를 지운다.
   - `app-frame/electron-app-frame.ts`: `FEEDBACK_LIMITS` import를 지우고, `capture`가 줄이는 긴 변 상한을 이 file 안 상수로 둔다(정한 것). 값(1,600px)과 동작은 그대로다. 이 `capture`는 annotation screenshot(`app-frame/capture.ts`)만 쓴다.
5. 문제 사람 결정 handle을 지운다(계약 "decision handle은 provider 끊기(`PROVIDER_CONCERN`) 하나가 남는다").
   - `packages/shell/main/decision-handle/problem-decision.ts`를 지운다(`PROBLEM_CONCERN`, `PROBLEM_DECISION`, `readProblemDecision`).
   - `decision-handle/issue.ts`: 그 import와 갈래, 머리 주석의 "문제 결정"을 지운다.
   - `decision-handle/ipc_test.ts`는 provider 결정으로 "창이 아닌 sender와 고정되지 않은 결정은 handle을 받지 못한다"를 보는 권한 경계 test다. 고치지 않고 통과만 본다(write-test skill: 지우는 test가 지키던 권한 경계 검사를 없애지 않는다).
6. problem 결정만 쓰던 것을 지운다(planner가 소유에 더했다).
   - `packages/shell/main/decision-handle/core.ts`의 `text`를 지운다. 쓰는 곳이 없어진다.
   - `packages/shell/ipc/confirmation.ts`의 `ownerDecisionSchema`에서 `choice` 값 `fixed`·`not_fixed`·`not_visible`·`dismiss`와 `note`를 지운다. 남는 `choice` 값이 decision handle에서 쓰이지 않으면 `choice` 칸째 지운다.
7. 지운 이름(`feedback`, `app-issue`, `problems/closing`, `problem_decision`, `[Report a problem]`, `User report`)을 주석과 오류 메시지에서도 grep해 맞춘다.

정한 것: `capture`의 긴 변 상한은 `electron-app-frame.ts` 안 상수 `SCREENSHOT_LONG_SIDE = 1600`으로 두고, `app-frame/capture.ts`의 같은 이름 값(annotation screenshot의 긴 변 상한)과 같다고 주석한다. 이유: 계약이 "annotation 쪽 이름으로 옮겨 남긴다"이고, 쓰는 곳이 이 file 하나이며 `capture.ts`는 소유 밖이다.

## 끝남

- `deno task check`가 통과한다. shell main의 `tsc`와 `node --test`(`packages/shell/main/*_test.ts`)가 같이 돈다.
- 위험 test: 없음. 남는 `packages/shell/main/decision-handle/ipc_test.ts`("화면을 누르지 않은 결정 요청은 handle을 받지 못한다")가 통과한다.
- 남지 않음:
  - `ls packages/shell/ipc/feedback.ts packages/shell/preload/feedback-api.ts packages/shell/main/app-frame/feedback.ts packages/shell/main/desktop/wiring/feedback.ts packages/shell/main/decision-handle/problem-decision.ts`가 모두 없다고 답한다.
  - `grep -rni --include=*.ts --exclude-dir=node_modules --exclude-dir=dist "feedback\|app-issue\|problems/closing\|problem_decision\|PROBLEM_CONCERN\|submit_feedback\|list_problems\|get-report\|list-reports" packages/shell/ipc packages/shell/main packages/shell/preload`가 0줄이다.
  - `grep -rn --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist "lophnFeedback\|FEEDBACK_\|FeedbackViewSnapshot\|feedbackView\|openFeedback\|closeFeedback\|isOverlay" packages/shell`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
