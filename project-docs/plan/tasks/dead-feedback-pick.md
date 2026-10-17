# dead-feedback-pick

제보 dialog의 "새 문제 / 기존 문제" 고르기와 그쪽으로만 가던 `problem`·`existing_problem` 경로를 shell, protocol, core에서 모두 지운다. 제보는 늘 새 문제다.

- 단위: dead (wave 2)
- 선행: trust-view-error-signing. 같은 protocol·core reporting 파일을 고친다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/overlay/feedback/feedback-dialog.tsx`, `packages/shell/renderer/overlay/feedback/feedback-dialog.module.css`
  - `packages/shell/ipc/feedback.ts`, `packages/shell/preload/feedback-api.ts`, `packages/shell/main/app-frame/feedback.ts`
  - `packages/protocol/shell/feedback.ts`
  - `packages/design/wording/catalog/app-space.ts`, `packages/design/wording/catalog/app-space.placeholders.ts`
  - `tools/wireframes/frames/compositions/app-space/space.tsx`, `tools/wireframes/frames/compositions/app-space/pages.tsx`
  - `tools/wireframes/frames/screens.tsx`, `tools/wireframes/pages.ts`
  - `packages/protocol/problems/{problem-feedback,problem-report,reports}.ts`
  - `packages/core/problems/feedback/{model,work}.ts`, `packages/core/problems/reporting/{work,commands}.ts`, `packages/core/problems/reporting/worker/collector.ts`
  - 위 core 파일을 다루는 `packages/core/problems` 아래 test 중 `existing_problem`을 쓰는 것
- 읽을 것:
  - issues: `project-docs/issues/shell.md`의 "제보 창이 기존 문제를 못 고른다". 정한 것은 "지운다"다("안 살릴 거면 dialog의 고르기와 `existing_problem` 경로를 지운다").
  - architecture: 이 경로를 다루는 문서가 없다.
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/shell/ipc`, `packages/shell/main`, `packages/shell/preload`
- 계약:
  - 바꾸는 것(core): `problem.submit_feedback` 입력(`packages/protocol/problems/problem-feedback.ts`)과 보고 꼴(`problem-report.ts`, `reports.ts`)에서 `existing_problem`을 지우고, core의 기존 문제 분기(`core/problems/feedback/*`, `reporting/*`)를 지운다. 쓰는 쪽은 모두 이 task의 소유다.
  - 바꾸는 것: shell 안 계약을 줄인다.
    - `packages/shell/ipc/feedback.ts`: `feedbackBeginSchema`의 `problem`, `feedbackSendSchema`의 `existing_problem`, `LophnShellFeedbackBegin.beginFeedback`의 `problem` 인자, `LophnOverlayFeedback.sendFeedback`의 `existing_problem` 인자.
    - `packages/protocol/shell/feedback.ts`: `LophnShellFeedbackSend.sendFeedback(draftRef, text)`.
    - 쓰는 쪽은 모두 이 task의 소유에 넣었다: `feedback-dialog.tsx`, `preload/feedback-api.ts`, `main/app-frame/feedback.ts`, `tools/wireframes/.../space.tsx`. `report-button.tsx`와 `desktop/dev-mock/app-space.ts`는 `beginFeedback(viewSession)`을 이미 인자 하나로 부르므로 고치지 않는다.
- 정한 것: 반쯤 만들고 안 쓰는 길은 지운다(이슈의 정한 것). shell만 지우면 core 분기가 아무도 안 타는 코드로 남으므로 core와 protocol까지 지운다.

## 할 일

1. `packages/shell/renderer/overlay/feedback/feedback-dialog.tsx`: `FeedbackProblem` interface, `FeedbackDialogProps.problems`, `target`·`chosen` state, `missingProblem`, "Send it as" `Select`와 기존 문제를 고르는 `List`·`ListItem` 블록을 지운다. `send()`는 `api.sendFeedback(draftRef, text)`만 부른다. 안 쓰게 된 import(`List`, `ListItem`, `Select`)와 파일 머리 주석의 "사람이 고른 기존 문제" 말을 지운다. `feedback-dialog.module.css`에서 `.pickList`, `.note`를 지운다(쓰는 곳이 없어지는지 확인한다).
2. `packages/shell/ipc/feedback.ts`: 위 "바꾸는 것"대로 `problem`·`existing_problem`을 지운다. `LophnShellFeedbackBegin`의 주석("problem이 있으면 그 기존 문제에 덧붙이는 보고로 연다 ...")도 지운다.
3. `packages/shell/preload/feedback-api.ts`: `beginFeedback`은 `view_session`만 보낸다. `sendFeedback`은 `{ draftRef, text }`만 보낸다.
4. `packages/shell/main/app-frame/feedback.ts`: `Draft.existingProblem`과 `begin()`의 `existingProblem: checked.value.problem ?? null`을 지운다. `send()`에서 `existing_problem` 구조분해와 `request(draft, text, existing_problem ?? draft.existingProblem)`를 `request(draft, text)`로 한다. `SubmitFeedbackRequest`에서도 `existing_problem`을 뺀다.
5. `packages/protocol/shell/feedback.ts`: `sendFeedback(draftRef, text)`로 줄이고 `existing_problem` 주석을 지운다.
6. wording: `packages/design/wording/catalog/app-space.ts`에서 쓰는 곳이 없어지는 key를 지운다: `report-problem.empty.no-problems`, `report-problem.label.option-existing`, `report-problem.label.option-new`, `report-problem.label.report-count`, `report-problem.label.send-as`, `report-problem.label.which-problem`. `deno task wording`으로 `app-space.placeholders.ts`를 다시 만든다(손으로 고치지 않는다). 지우기 전에 `grep -rn "<key>" packages tools`로 다른 쓰는 곳이 없는지 확인한다.
7. gallery(wireframe): `tools/wireframes/frames/compositions/app-space/space.tsx`에서 `AppSpaceProps.report`의 `existing`·`chosen`과 `useDrive`의 existing 블록, `FeedbackDialog`에 넘기던 `problems` prop을 지운다(`report`는 dialog를 여는 표시만 남는다. `pages.tsx`의 `ReportNew`가 맞게 쓰도록 모양을 가장 단순하게 고친다). `pages.tsx`에서 `ReportExisting`을 지우고, 지운 것을 가리키던 등록 줄만 뺀다: `tools/wireframes/frames/screens.tsx`의 `ReportExisting` import와 `"new-app-report-existing"` 줄, `tools/wireframes/pages.ts`의 `"new-app-report-existing"` page type과 `fresh(...)` 항목. `ReportNew`("new-app-report") 쪽 설명이 "새 문제로 보낸다"라는 말을 담고 있으면 맞게 다듬는다. `ISSUES`·`ISSUE_ID` 등 space.tsx의 다른 쓰는 곳은 남긴다.

8. core와 protocol: `problem-feedback.ts`, `problem-report.ts`, `reports.ts`의 `existing_problem` 칸을 지우고, `core/problems/feedback/{model,work}.ts`, `reporting/{work,commands}.ts`, `reporting/worker/collector.ts`에서 기존 문제에 덧붙이는 분기를 지운다. 늘 새 문제로 만든다. 이 분기만 보던 test는 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우는 일이다.
- 남지 않음:
  - `grep -rnE "existingProblem|existing_problem|FeedbackProblem|option-existing|report-problem\.label\.(send-as|option-new|which-problem|report-count)|no-problems|report-existing|ReportExisting" packages tools --include=*.ts --include=*.tsx --include=*.css --exclude-dir=node_modules --exclude-dir=dist`가 0줄이다.
  - `grep -rn "problem?: string\|problem?:" packages/shell/ipc/feedback.ts`가 0줄이다.
- `deno task wireframes`가 되고, gallery의 `new-app-report`가 dialog로 그려지며 `new-app-report-existing`는 목록에 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. (`screens.tsx`·`pages.ts` 줄 빼기와 wording 생성은 이 task가 한다.)
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 위 "정한 것"에서 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
