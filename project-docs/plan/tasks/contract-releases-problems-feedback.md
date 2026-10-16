# contract-releases-problems-feedback

제보(글, 기존 문제 고르기)의 core route와 shell IPC 모양을 고정한다. 제보는 글만 받는다. 화면 상태, screenshot, 지목(`targets`)은 없다(annotation은 App Engineer에게 가는 별도 길이다, 결정 #88). 옛 계약은 지우지 않고 새것을 옆에 더한다.

- 단위: contract-releases-problems (wave 2)
- 선행: `contract-releases-problems-problems`(같은 `protocol/problems`를 고친다)
- 소유(이 task만 고친다):
  - `packages/protocol/problems/problem-feedback.ts` (새)
  - `packages/protocol/shell/feedback.ts`
  - `packages/shell/ipc/feedback.ts`
- 읽을 것:
  - spec: S9 1장(제보는 따로다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/annotation.md`
  - inventory: `I2.9#6`(제보 화면의 첨부). 모양의 근거: `I2.7#31`
  - 결정: `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md`의 #88
  - 지금 코드: `packages/protocol/problems/feedback.ts`, `packages/protocol/shell/feedback.ts`, `packages/shell/ipc/feedback.ts`
- 계약:
  - 쓰는 것: 옛 `protocol/problems/feedback.ts`의 `feedbackTextSchema`, `feedbackViewSchema`의 binding 개념, 옛 `reports.ts`의 `reportAcceptanceSchema`, `REPORT_ERRORS`. 새 `problem-report.ts`(같은 wave의 `contract-releases-problems-problems`)는 import하지 않는다.
  - 내놓는 것: 아래 "모양". wave 3의 releases-problems-intake(core 쪽)와 screens-app-space(shell 쪽)가 쓴다.

## 모양

### `protocol/problems/problem-feedback.ts` (새)

1. `problemFeedbackInputSchema`(type `ProblemFeedbackInput`): strict
   - `report_id: Report id`
   - `app`
   - `text`: 옛 `feedbackTextSchema` 그대로(공백 외 1~500 Unicode scalar)
   - `existing_problem: Problem id | null`: 사람이 고른 같은 앱의 기존 문제. null이면 새 문제다.
   - `observed_at`
   - `view: problemFeedbackViewSchema | null`: 버튼을 누른 시점에 shell main이 고정한 앱 view. 옛 `feedbackViewSchema`에서 `capture`와 `final_screenshot_hash`를 뺀 것이다: `{ binding, name, app, release: Release id | null, mode, bundle_hash: sha256 | null, diagnostic_scope: string | null, observed_at }`. `mode === "live"`이면 `diagnostic_scope`가 null이고 아니면 값이 있다(옛 refine 그대로). binding은 불투명한 참조이고 권한이 아니다.
   - refine: `view`가 있으면 `view.app === app`이고 `view.observed_at === observed_at`.
2. route `problem.submit_feedback`: kind worker, resource `problems`, method `submit_feedback`, actors `["user"]`, 출력 `reportAcceptanceSchema`, 오류 `REPORT_ERRORS`. 입력 크기 상한은 JSON 8,192 byte(글 500자에 view를 더한 값. `REPORTING_LIMITS.feedback_total_bytes`는 screenshot 때문에 컸던 값이라 쓰지 않는다).
3. 이 route의 접수 결과는 core가 `problem.record_report`(source `feedback`)로 기록한다. 그 모양은 `contract-releases-problems-problems`가 둔다.

### `protocol/shell/feedback.ts` (더하기만)

4. 버튼 시점 고정(`feedbackBeginSchema`, `shell:feedback-begin`)과 취소(`feedbackCancelSchema`)는 옛것을 그대로 쓴다.
5. 새 보내기: `feedbackSendSchema`(strict `{ draftRef, text: feedbackTextSchema }`)와 `FEEDBACK_SEND_IPC = { "shell:feedback-send": feedbackSendSchema }`. 옛 `feedbackSubmitSchema`의 `selection`이 없다.
6. 새 renderer 쪽 type `LophnShellFeedbackSend`: `sendFeedback(draftRef: string, text: string): Promise<{ report: string; problem: string | null }>`. 접수된 Report와 묶인 문제(live가 아니면 null)다. 미리보기 push(`FEEDBACK_PUSH`)와 `existing_issue`는 새 흐름에 없다.

### `packages/shell/ipc/feedback.ts` (더하기만)

7. main tsc가 contracts package를 보지 않아 같은 모양을 사본으로 둔다(이 file 머리 주석). 위 5·6의 사본을 더한다: `FEEDBACK_SEND_CHANNEL = "shell:feedback-send"`, `feedbackSendSchema`, `FeedbackSendReply`.
8. 두 file의 `feedbackSendSchema`가 같은 모양이어야 한다.

## 할 일

1. `problem-feedback.ts`를 만든다(모양 1·2).
2. `protocol/shell/feedback.ts`에 모양 5·6을 더한다.
3. `shell/ipc/feedback.ts`에 모양 7을 더한다.
4. 옛 `feedbackSubmitSchema`, `feedbackPreviewSchema`, `FEEDBACK_PUSH`, `submitFeedback` route는 지우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -n "screenshot\|capture\|facts\|targets\|selection" packages/protocol/problems/problem-feedback.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/problems/mod.ts`에 `problem-feedback.ts` export, `protocol/problems/registry.ts`의 `PROBLEM_ROUTES`에 `problemSubmitFeedback`(registry.ts는 `contract-releases-problems-problems`가 소유하므로 그쪽이 merge된 뒤 lead가 더한다). `shell/ipc`의 channel 목록과 preload에 `shell:feedback-send` 연결(preload는 contract-shell 소유)
- 안 쓰게 된 export(지우지 않는다): `submitFeedback`, `feedbackSubmitSchema`, `feedbackPreviewSchema`, `FEEDBACK_PUSH`, `FEEDBACK_CAPTURE_BLOCKS`, `FEEDBACK_SCREENSHOT_STATES`, `feedbackScreenFactsSchema`, `feedbackTargetsSchema`, `feedbackScreenshotInputSchema`, `FEEDBACK_PROBLEM_MESSAGE`
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 계약 바꾸기 요청: 없음(wave 2는 직접 고친다)
