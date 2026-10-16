# screens-app-space-main

shell main의 `app-frame/` 가운데 app-calls와 annotation 몫이 아닌 file을 새 화면에 맞춘다. 제보에서 screenshot·화면 상태 캡처를 지우고(글만 보낸다), 쓰는 곳이 없는 문서 view를 지우고, 화면 검사 host를 지운다. 앱 view의 project 저장과 `setViewProject`는 app-calls의 `app-calls-shell`이 한다(`registry.ts`, `view-model.ts`, `view-ipc.ts`가 그쪽 소유다). 계약은 wave 2가 둔 것을 따르고 이 task는 구현만 한다.

- 단위: screens-app-space (wave 3)
- 선행: platform-desktop, screens-data-secret-input (둘 다 `packages/shell/main/build.ts`를 같이 고치므로 순서를 건다. 계약은 wave 2에서 고정됐고 renderer 쪽 `screens-app-space-frame`과는 서로 기다리지 않는다)
- 소유(이 task만 고친다). `packages/shell/main/app-frame/` 가운데 아래 file만이다. 나머지는 app-calls(`app-call.ts`, `app-connection.ts`, `app-invoke.ts`, `app-ipc.ts`, `app-protocol.ts`, `binding.ts`, `blueprint-source.ts`, 그리고 `app-calls-shell`이 받은 `registry.ts`, `view-model.ts`, `view-ipc.ts`, `view-error.ts`, `visibility.ts`, `session-policy.ts`, `view-closed.ts`)와 annotation(`annotate.ts`, `capture.ts` 새로)의 것이다.
  - `packages/shell/main/app-frame/{feedback,document-view,document-protocol,screen-test-host}.ts` (이 넷이 이 task의 일이다)
  - `packages/shell/main/app-frame/{frame,electron-app-frame,electron-overlay,overlay,overlay-security,view-order,placement,network-policy,external-link,crash,diagnostics}.ts` (위 일에 닿을 때만 고친다)
  - `packages/shell/main/entry-screen-test.ts` (화면 검사 host의 진입점. 소유 바꾸기 요청: 지도에 없는 file이다)
  - `packages/shell/main/build.ts` (`screen-test` 두 entry 줄만. 소유 바꾸기 요청: 다른 단위도 이 file을 고친다. 합칠 때 lead가 푼다)
  - `packages/shell/main/tsconfig.json` (`entry-screen-test.ts` 줄만. 소유 바꾸기 요청)
  - `packages/shell/main/package.json` (`check` script의 `entry-screen-test.ts` 인자만. 소유 바꾸기 요청: check 단위가 가진 file이다)
- 읽을 것:
  - spec: S9 3장(shell main이 하는 일: 앱 view capture와 release·화면 위치를 안다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - inventory: `U2.4#10`(제보 캡처 쪽), `U2.4#13`(문서 view slot의 main 쪽). 줄 자체는 `screens-app-space-frame`이 맡고 이 task는 main 몫이다. `U2.4#12`의 main 몫(앱 view에 project)은 app-calls-shell이 한다. `I2.9#6`(제보 화면의 첨부)은 contract-releases-problems 줄이고, 그 중 `main/app-frame/feedback.ts`가 이 task 몫이다. `I1.7#18`(화면 검사 host)은 releases-problems 줄이고 shell 쪽 삭제가 이 task 몫이다
  - 결정: `../README.md` 3장 #17(앱 view를 다시 그리는 신호는 남지 않는 event `AppViewChanged`. main의 그 처리는 platform 몫이라 이 task에서 하지 않는다)
- 계약:
  - 쓰는 것:
    - 제보: `protocol/shell/feedback.ts`와 `shell/ipc/feedback.ts`에 contract-releases-problems(wave 2)가 더한 새 보내기 — `FEEDBACK_SEND_CHANNEL = "shell:feedback-send"`, `feedbackSendSchema = { draftRef, text }`, 반환 `{ report, problem | null }`. 시작(`shell:feedback-begin`)과 취소(`shell:feedback-cancel`)는 옛것 그대로다. core 쪽 입력은 `protocol/problems/problem-feedback.ts`의 `ProblemFeedbackInput`(`report_id`, `app`, `text`, `existing_problem`, `observed_at`, `view`). `view`는 옛 `feedbackViewSchema`에서 `capture`와 `final_screenshot_hash`를 뺀 모양이다. route 이름 `problem.submit_feedback`. core 쪽 구현은 releases-problems-intake다.
  - 내놓는 것: `shell:feedback-send` handler. renderer(`screens-app-space-frame`의 제보 dialog)가 부른다.

## 할 일

1. **제보에서 캡처를 뺀다** — `feedback.ts`(501줄). (`U2.4#10`, `I2.9#6`, S9의 "annotation은 따로 간다")
   - 지운다: view 캡처 요청과 `settle`·`shot`·`hash`·`png`, `FEEDBACK_CAPTURE_MS` 대기, `screenshot_png` 미리보기 push, `selection`(screen·screenshot)과 화면 상태(`facts`) 조립, `FeedbackCaptureBlock`, png 한도 검사. `view.capture()` 자체(`electron-app-frame.ts`)는 지우지 않는다. annotation이 쓴다.
   - 남긴다: [Report a problem]을 누른 시점에 view를 고정하고 `view_session`으로 앱·release·화면을 main이 정하는 binding(`view`), draft의 메모리 보관, 취소, 접수 뒤 묶인 문제로 가는 길(`FEEDBACK_OPEN_ISSUE`).
   - 새로 한다: `shell:feedback-send`를 받아 `ProblemFeedbackInput`을 만들어 `problem.submit_feedback`으로 보낸다. 답으로 `{ report, problem }`을 돌려준다. 기존 문제로 보내기(`existing_problem`)는 renderer 입력에 그 칸이 있을 때 검사해서 싣는다. 지금 `feedbackSendSchema`에는 그 칸이 없다 — 보고의 "계약 바꾸기 요청"에 적는다(추천: `existing_problem: problem id | null`을 send에 더하고, 같은 앱의 열린·해결됨 문제 목록은 begin의 답으로 준다).
2. **쓰는 곳 없는 문서 view를 지운다** — `document-view.ts`, `document-protocol.ts`. (`U2.4#13`의 main 몫) 지금 `openDocumentView`를 부르는 곳이 없다(`grep -rn "openDocumentView\|document-view\|document-protocol" packages/shell`로 확인한다). 호출자가 없으면 두 file을 지우고 `lophn-document://` scheme 등록이 `electron-app-frame.ts` 등에 있으면 같이 지운다. 호출자가 있으면 지우지 말고 판(`versionId`) 없이 파일 경로로 열도록 고친다. 어느 쪽인지 "정한 것"에 적는다. IPC `shell:view-open-document`와 `documentViewOpenSchema`는 contract 소유라 그대로 둔다.
3. **화면 검사 host를 지운다** — `screen-test-host.ts`(441줄), `main/entry-screen-test.ts`(398줄). (`I1.7#18`의 shell 몫) S7에 화면 검사가 없고 core의 화면 검사(`releases-problems-tests`)가 지워진다. 두 file을 지우고 `build.ts`의 `entry-screen-test.ts`·`preload/screen-test.ts` entry 두 줄, `tsconfig.json`의 `entry-screen-test.ts` 줄, `package.json` check script의 `entry-screen-test.ts` 인자를 뺀다. `preload/screen-test.ts`, `ipc/screen-test.ts`, `protocol/shell/screen-test.ts`는 contract 쪽 file이라 지우지 않고 보고에 적는다(cleanup이 지운다). 다른 곳이 `screen-test-host.ts`를 import하면(`grep`으로 확인) 지우지 말고 보고하고 멈춘다.
4. **top bar 높이.** `electron-overlay.ts`는 `desktop/window.ts`의 `TOP_BAR_HEIGHT`를 import한다. platform-desktop이 그 값을 36으로 바꾸면 따라가므로 이 task는 확인만 한다(ui-chrome 보고의 "wave 3 단위가 36으로 바꾼다" 항목).
5. **남은 흔적을 확인한다.** wave 1이 `shell/main/editor/{restore,create,place}.ts`와 확인 창 쪽을 지웠다. 이 폴더가 그것을 import하는 줄이 있으면 지운다. 없으면 한다.

- (lead가 더함, releases-problems-intake가 넘긴 것) `shell/main/app-frame/feedback.ts`와 `shell:feedback-send`가 옛 `SubmitFeedback`(PNG·facts·targets)을 보낸다. core에는 이제 `problem.submit_feedback`(입력 `{report_id, app, text, existing_problem, observed_at, view|null}`)만 있다. 그것으로 바꾼다.

- (lead가 더함, app-calls-shell이 넘긴 것) `AppViewHost`에 optional `send?(view, channel, payload)`가 생겼다. `electron-app-frame.ts`가 `webContents.send`로 구현한다(안 하면 annotate의 `send`가 no-op이다). `screen-test-host.ts`·`entry-screen-test.ts`에 컴파일용으로 `Invoker`·`nodeInvoke`·`outcomeOf`가 복사돼 있다. 이 file을 지울 때 같이 간다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (제보 view 고정 binding의 검사는 기존 동작이 그대로고 새로 생기는 판정이 없다)
- 남지 않음:
  - `grep -rn "screenshot\|FEEDBACK_CAPTURE_MS\|screenshot_png" packages/shell/main/app-frame`이 `view.capture` 정의 밖에서 0줄이다.
  - `grep -rn "screen-test-host\|entry-screen-test" packages/shell/main`이 0줄이다(`node_modules` 제외).

## 보고

- 바꾼 file
- 등록할 것: 없음 | (main 조립 file이 새 export를 부르면 적는다). `shell/main/desktop/main.ts`가 `shell:feedback-send` handler를 등록하는 줄이 필요하면 적는다(platform-desktop 몫).
- 안 쓰게 된 export: `document-view.ts`·`document-protocol.ts`의 export, `feedback.ts`의 캡처 관련 type, 옛 `shell:feedback-submit` handler, `preload/screen-test.ts`·`ipc/screen-test.ts`·`protocol/shell/screen-test.ts`
- 정한 것: 문서 view를 지웠는지 고쳤는지
- 계약 바꾸기 요청(wave 3): `feedbackSendSchema`에 `existing_problem` 칸과 기존 문제 목록 통로 | 없음

- (lead가 더함, screens-app-space-frame가 넘긴 것) 제보 dialog의 [Send]가 `api.sendFeedback(draftRef, text, existing_problem)`을 부른다. `shell/ipc/feedback.ts`의 `LophnOverlayFeedback`에 `sendFeedback`을 더하고 `submitFeedback`·`subscribePreview`를 걷는다. `preload/feedback-api.ts`도 구현한다. 기존 문제 목록은 `beginFeedback`의 답에 열린·해결된 문제 목록을 실어 dialog의 `problems` prop으로 넘긴다(추천).
