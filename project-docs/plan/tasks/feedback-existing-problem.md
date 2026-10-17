# feedback-existing-problem

제보 dialog의 "새 문제 / 기존 문제" 고르기를 살린다. 빠진 것은 dialog에 같은 앱의 열린 문제 목록을 넘기는 연결 하나다. dialog의 고르기 화면과 core의 덧붙이기 분기(`existing_problem`)는 이미 있다.

- 단위: feedback (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/feedback.ts`, `packages/shell/main/desktop/wiring/feedback.ts`
  - `packages/shell/ipc/feedback.ts`, `packages/shell/preload/feedback-api.ts`, `packages/protocol/shell/feedback.ts`
  - `packages/shell/ipc/overlay.ts`, `packages/shell/main/app-frame/overlay.ts`
  - `packages/shell/renderer/overlay/surfaces/surface.tsx`, `packages/shell/renderer/overlay/feedback/feedback-dialog.tsx`
- 읽을 것:
  - 이슈: `project-docs/issues/shell.md`의 "제보 창이 기존 문제를 못 고른다". 정한 것은 "살린다"다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `problems`. `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`.
  - 본보기(화면): `tools/wireframes/frames/compositions/app-space/space.tsx`의 existing 블록과 `pages.tsx`의 `ReportExisting`. 고르기 화면 모양은 이미 그 wireframe대로다. 바꾸지 않는다.
- 계약:
  - 쓰는 것: core `problem.list`(`packages/protocol/problems/problem-views.ts`의 `problemList`, 입력 `app`, `state`, `limit`), core `problem.submit_feedback`의 `existing_problem`(`packages/protocol/problems/problem-feedback.ts`). 둘 다 바꾸지 않는다.
  - 바꾸는 것: shell 안 계약만. 열린 문제 목록이 main에서 dialog까지 가는 길.

## 할 일

1. main이 목록을 읽는다: `shell/main/app-frame/feedback.ts`의 `begin()`이 draft를 만들 때 그 view의 앱으로 열린 문제를 읽어 draft에 둔다. 읽기는 `FeedbackDeps`에 `problems(app)`를 더하고 `desktop/wiring/feedback.ts`가 core session으로 `problem.list`를 `{ app, state: "open", limit: 20 }`쯤으로 부른다(같은 file의 `submit`이 core session을 쓰는 꼴을 따른다). dialog 주석이 "열림·해결됨 문제만 온다"면 그 뜻에 맞춰 state를 고른다. 읽기가 실패하면 빈 목록이 아니라 `undefined`(고르기 없음, 늘 새 문제)로 둔다.
2. 목록을 dialog까지 넘긴다. 둘 중 단순한 쪽을 고르고 보고에 적는다.
   - (a) overlay가 dialog를 열 때 싣는다: `overlay.openFeedback(draftRef)`가 problems도 받고, `shell/ipc/overlay.ts`의 surface `feedback`이 draftRef와 problems를 싣고, `surface.tsx`가 `FeedbackDialog`에 `problems`를 넘긴다.
   - (b) dialog가 feedback 통로로 읽는다: `shell/ipc/feedback.ts`에 draft의 problems를 읽는 channel을 더하고 preload와 `protocol/shell/feedback.ts`의 api에 메서드를 더해 `FeedbackDialog`가 처음에 읽는다.
3. 보내기: dialog가 고른 기존 문제를 `sendFeedback`의 `existing_problem`으로 보내고 main이 그대로 core에 넘기는 길이 지금 맞게 이어지는지 확인한다. `beginFeedback(view_session, problem?)`의 `problem`(미리 고른 문제로 여는 인자)은 부르는 곳이 없으면 지운다.
4. 목록 줄의 모양은 dialog의 `FeedbackProblem`(`id`, `title`, `count`)이다. core `problemListItemSchema`의 칸에서 옮긴다(제목·발생 수에 해당하는 칸을 확인한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면과 연결이다).
- core를 띄워 한 앱에 문제 하나를 만든 뒤 제보 dialog가 "Send it as"와 그 문제를 보여 주는지 확인한다. `mkdir -m 700 -p $PWD/.dev-data/feedback-existing-problem && export LOPHN_HOME=$PWD/.dev-data/feedback-existing-problem` 뒤 띄우고 `$!`로 받은 PID만 끈다. 띄워 보기 어려우면 그 사실을 보고한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: 2의 (a)/(b)와 1의 state
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
