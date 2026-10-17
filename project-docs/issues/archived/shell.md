# shell (닫음)

## 앱 바로가기를 둘 곳이 없다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 앱 바로가기를 위쪽 바에서 뺀 뒤 옮길 곳을 정하지 않았다.

영향: 앱 공간으로 갈 수 없다.

닫음: 앱으로 가는 길이 셋 있다. launcher의 `AppsSection`(`desktop/launcher/apps-section.tsx`)이 앱 카드를 보이고 누르면 `onApp`으로 앱 공간을 연다. lophn space의 Apps 화면(`desktop/lophn-space/apps/apps-screen.tsx`)에 `onOpen`이 있다. palette(`desktop/palette/lophn-scope.ts`)에 `app` 항목이 있다. 위쪽 바(`top-bar.tsx`)에는 앱 진입이 없다.

## 제보 창이 기존 문제를 못 고른다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/ipc, packages/shell/main]
closed: fixed
guard: 없음
```

지금: `overlay/surfaces/surface.tsx`가 `FeedbackDialog`를 `problems` 없이 마운트한다. dialog는 `problems`가 있어야 "새 문제 / 기존 문제" 고르기를 그리므로 늘 새 문제로 간다. `beginFeedback(view_session, problem?)`과 main의 `existingProblem`은 있지만 부르는 곳이 `report-button.tsx` 하나이고 `problem`을 안 넘긴다. 옛 글의 "Issues에서 연 제보는 붙는다"는 틀렸다. Issues 탭에는 `beginFeedback`을 부르는 단추가 없다.

영향: 같은 문제가 제보마다 새 문제로 중복해서 올라간다. dialog 쪽 고르기 코드는 죽어 있다.

고치려면: `beginFeedback` 답을 `{draftRef, problems}`로 넓혀 main이 같은 앱의 열린 문제를 읽어 싣고, overlay가 `problems`를 dialog에 넘긴다(계약 고침, 중간). 안 살릴 거면 dialog의 고르기와 `existing_problem` 경로를 지운다(작음).

정한 것: 살린다. main이 같은 앱의 열린 문제를 읽어 dialog에 넘긴다(plan `feedback-existing-problem`). dialog의 고르기와 core의 덧붙이기 분기는 이미 있다.

닫음: main의 `begin()`이 live view면 그 앱의 열린 문제를 20개까지 읽어(`problems.list_problems`, `state: "open"`) `overlay.openFeedback(draftRef, problems)`로 dialog에 넘긴다. 읽기에 실패하면 고르기 없이 새 문제로만 보낸다. 부르는 곳 없던 `beginFeedback`의 `problem` 인자는 지웠다.
