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

## project 등록 slug 재시도

```yaml
kind: defect
modules: [packages/shell/renderer, packages/protocol, packages/core/projects]
closed: kept
guard: 없음
```

지금: `lophn-space/projects/core-source.ts`의 `createProject`가 제목에서 slug(`slugOf`)를 만들어 `project.create`의 `name`으로 보내고, `conflict`면 `-2`…`-5`로 `NAME_ATTEMPTS = 5`번까지 다시 보낸다. 어떤 `conflict`든 다시 보내므로 이름이 아니라 폴더 겹침 같은 다른 충돌도 다섯 번 돈 뒤에야 실패한다. 호출처는 launcher와 projects 화면 둘이 이 함수 하나를 쓴다.

영향: 충돌 원인을 사람에게 못 알리고 요청이 다섯 번 나간다. slug 규칙(`SLUG_MAX`, 정규화)을 renderer가 안다.

고치려면: `project.create`의 `name`을 입력에서 빼고 core가 title에서 정하게 한다(계약 변경, core·protocol·renderer 모두, 중간). 계약을 안 바꾸려면 `conflict` 메시지로 이름 충돌만 골라 재시도한다(작음).

닫음: 이름 아닌 충돌(id, 폴더 겹침)이 드물고 다섯 번 재시도는 해롭지 않다. 이름 정하기를 core로 옮기는 계약 변경은 core·protocol·renderer 모두에 걸려 비용이 중간이다.

## native view 위 toast가 두 길이다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `app-frame/annotate/use-view-toast.ts`가 `overlay`가 있으면 overlay의 `notification` 표면으로 열고, 없으면 `dom` 값을 돌려줘 `app-space.tsx`가 같은 모양을 DOM으로 그린다. overlay가 없는 경우는 앱 view가 없는 창과 gallery뿐이다. `desktop/connection/toasts/toast-host.tsx`는 overlay 한 길만 쓴다.

영향: toast 모양·동작을 고치면 두 곳을 맞춰야 한다. DOM 길은 gallery에서만 실제로 쓰인다.

고치려면: overlay 하나로 하고 gallery용으로는 overlay stub을 주입한다(작음~중간). DOM 길과 `dom` 반환값, `app-space.tsx`의 `viewToast` 블록이 사라진다.

닫음: DOM 길은 gallery에서만 쓰이는데 지우려면 gallery에 overlay stub을 주입해야 해서 얻는 것이 작다. toast 모양을 고칠 때 두 곳을 맞춘다.

## project 고르기 scrim

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `app-frame/app-space.tsx`가 앱 place에서 연 화면에서 view를 project 없이 먼저 열어 두고(`viewState.project === null`), 그 위에 `ProjectPicker`를 얹는다. native view가 DOM을 가리므로 `project-picker.tsx`가 `useViewCover`로 view를 숨기고, 고르면 `views.setViewProject`로 main에 project를 알린다.

영향: view를 먼저 열고 덮고 다시 보이는 단계가 늘어, view 상태와 가리기가 어긋나는 경우를 따로 챙겨야 한다. 고르기 전에는 앱이 project 없이 뜬 채 가려져 있다.

고치려면: project를 고른 뒤에 view를 연다. main의 view 열기 흐름(`setViewProject`)과 renderer의 view 생명 주기를 함께 고쳐야 한다(중간~큼).

닫음: project를 고른 뒤 view를 열게 바꾸려면 main의 view 열기 흐름(`setViewProject`)과 renderer의 view 생명 주기를 함께 고쳐야 한다(중간~큼). 지금 동작은 맞다.

## fake source가 보관·rollback을 메모리에서 실제로 돌린다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `workspace/contexts/fake-source.ts`(1194줄)의 `createFakeContextsSource`가 `archive`·`unarchive`·`rollback`을 사본 Map 위에서 revision 충돌 검사까지 흉내 낸다. 쓰는 곳은 dev-mock과 `tools/wireframes`의 gallery 화면 여럿이다.

영향: core 규칙이 바뀌면 fake도 따로 고쳐야 한다. 화면 모양에 필요한 것보다 크다.

고치려면: gallery에 필요한 만큼만 남긴다. 상태를 바꾸는 동작은 호출만 기록하고 고정된 성공 값을 돌려준다(작음). 이때 보관 목록·rollback 화면을 gallery에서 보여 주는 frame이 있는지 먼저 확인한다.

닫음: gallery와 dev-mock이 보관·rollback의 상태 변화를 그대로 쓰는지 확인 없이 stub으로 줄이면 화면이 비는 frame이 생길 수 있다. 줄이는 것은 core 규칙이 바뀌어 fake가 어긋나는 날 한다.

## 보낸 말을 `accepted`로 남겼다가 확정 메시지가 오면 지운다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `conversation/drafts.ts`의 `DraftStore.accepted`가 접수된 말을 입력칸에서 비우면서 `outgoing`을 `accepted`로 남긴다. `agent-view.tsx`가 thread의 messages나 queued에 같은 id가 도착한 것을 보면 `outgoing: null`로 지운다.

영향: 임시 상태가 하나 더 있고 `delivery-state.ts`의 단계(sending·accepted·not_sent·unconfirmed)와 같이 움직인다. 확정 메시지(또는 다음 turn 줄)가 오기 전까지 접수된 말을 thread에 임시로 보이게 하는 값이다.

고치려면: 추천: 남긴다. 접수 응답과 event 도착 사이 틈을 메우는 상태이므로 이유를 `accepted` 주석에 적고(몇 줄).

닫음: 접수 응답과 event 도착 사이 틈을 메우는 상태이고 `delivery-state.ts`의 단계와 같이 움직인다. 이유를 `accepted` 주석에 둔다.

## 터미널 요청은 `request.coding.app === app`일 때만 pane에서 받는다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `app-frame/app-space.tsx`의 `useTerminalOpenRequests` 콜백이 `request.coding.app !== app`이면 버린다. 훅(`terminal/use-terminal-open-requests.ts`)은 앱·project 구분 없이 모든 coding runtime을 알리고 호스트가 자기 것을 고른다고 주석에 적혀 있다. project 창은 `workspace/kinds/terminal.tsx`가 따로 받는다.

영향: 호스트마다 같은 검사를 각자 해야 하고 빼먹으면 다른 앱의 터미널이 열린다.

고치려면: 추천: 남긴다. 훅이 호스트 둘이 공유하는 것이라 검사는 호스트에 두는 게 단순하다. 바꾼다면 훅이 `filter` 인자를 받는다(작음).

닫음: 훅이 앱 창과 project 창 둘이 공유하는 것이라 검사는 호스트에 두는 편이 단순하다. 바꾼다면 훅이 `filter` 인자를 받는다.

## 새 session 입력 메모리 key `new:role:name:place`

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `conversation/agent-view-model.ts`의 `newSessionKey`가 `new:${role}:${name}:${place.kind}:${place.name}`로 key를 만든다. 함수 주석에 "같은 창의 다른 agent와 섞이지 않는다"는 이유가 이미 있다. 이름에 `:`가 들어가면 서로 다른 agent의 key가 겹칠 수 있다.

영향: 거의 없다. key 규칙이 함수 한 곳에 있다.

고치려면: 추천: 남긴다. 겹침이 걱정되면 이름 부분을 `encodeURIComponent`로 감싼다(한 줄).

닫음: key 규칙이 `newSessionKey` 한 곳에 있고 영향이 거의 없다. 이름에 `:`가 들어가 겹칠 일이 생기면 이름 부분을 `encodeURIComponent`로 감싼다(한 줄).

## panel 층(rewind·권한·recap)을 `layer` state 하나로 둔다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: kept
guard: 없음
```

지금: `conversation/agent-view.tsx`가 `Layer` 합집합(`rewind | permissions | recap`) state 하나로 열린 panel을 둔다. 타입 주석에 "하나만 열린다"고 불변 조건이 적혀 있다. 다만 이 파일이 617줄이다.

영향: panel 하나를 더하면 합집합과 분기가 늘지만, 동시에 둘이 열리는 상태가 생길 수 없게 해 주는 단순한 표현이다.

고치려면: 추천: 남긴다. 파일 길이가 문제라면 panel 렌더 블록을 컴포넌트로 빼는 것은 별개의 정리다.

닫음: 동시에 둘이 열리는 상태가 생길 수 없게 해 주는 단순한 표현이다. 파일 길이(617줄)는 별개의 정리다.

## 제보 dialog의 기존 문제 목록이 열린 것 20개뿐이고 열린 뒤 갱신되지 않는다

```yaml
kind: bug
modules: [packages/shell/main]
closed: kept
guard: 없음
```

지금: `shell/main/desktop/wiring/feedback.ts`의 `problems(app)`가 `state: "open"`, `limit: 20`으로 한 번 읽고 페이지를 넘기지 않는다. 해결됨·무시됨 문제는 목록에 없다. dialog가 열린 뒤 생긴 문제는 보이지 않는다. 읽기가 느리면 `begin()` 응답과 dialog 표시가 그만큼 늦는다(timeout 없음).

영향: 문제가 많은 앱에서 사람이 덧붙이려는 문제가 목록에 없을 수 있다. 해결됨 문제가 다시 생겼다고 알릴 길이 없다.

고치려면:
- 그대로 둔다(작은 앱이면 20개로 충분하다).
- 해결됨도 같이 읽고, 많으면 dialog에서 검색한다(중간).

닫음: 문제가 20개를 넘는 앱은 드물고 지금 규모에서는 20개로 충분하다. 문제가 많은 앱에서 덧붙이려는 문제가 안 보이는 일이 실제로 생기면 해결됨도 같이 읽고 검색을 붙인다.
