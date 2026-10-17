# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 제보 창이 기존 문제를 못 고른다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/ipc, packages/shell/main]
```

지금: `overlay/surfaces/surface.tsx`가 `FeedbackDialog`를 `problems` 없이 마운트한다. dialog는 `problems`가 있어야 "새 문제 / 기존 문제" 고르기를 그리므로 늘 새 문제로 간다. `beginFeedback(view_session, problem?)`과 main의 `existingProblem`은 있지만 부르는 곳이 `report-button.tsx` 하나이고 `problem`을 안 넘긴다. 옛 글의 "Issues에서 연 제보는 붙는다"는 틀렸다. Issues 탭에는 `beginFeedback`을 부르는 단추가 없다.

영향: 같은 문제가 제보마다 새 문제로 중복해서 올라간다. dialog 쪽 고르기 코드는 죽어 있다.

고치려면: `beginFeedback` 답을 `{draftRef, problems}`로 넓혀 main이 같은 앱의 열린 문제를 읽어 싣고, overlay가 `problems`를 dialog에 넘긴다(계약 고침, 중간). 안 살릴 거면 dialog의 고르기와 `existing_problem` 경로를 지운다(작음).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## 새 session 첫 말의 context chip을 session에 싣지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
```

지금: `agent-view.tsx`의 `ensureSession`이 `openSession({id, contexts: chips})`를 부르지만 `agent-tab-core-source-sessions.ts`의 `openSession`은 `contexts`를 버리고 `opening_context: null`로 연다. 첫 말은 `sendText`가 `attached: []`로 보낸다. chip은 쓴 글이 없을 때 보낼 글감(`chipText`, 라벨만)으로만 쓰인다. 계약은 이미 있다: `SendMessage.attached`가 `context`·`violation` chip을 받는다.

영향: PM이나 lophn에게 context를 chip으로 붙여 말해도 agent는 chip을 모르고 글 라벨만 본다. 위반 chip도 마찬가지다.

고치려면: `sendText`가 첫 말의 chip을 `attached`로 싣는다. `ContextChipView`에 context id가 없어(`id`는 위반 key나 check id) 필드를 더해야 한다. contexts의 "열린 PM session에 위반 chip" 이슈와 같은 고침이다(중간, 계약 변경 없음).

## project 등록 slug 재시도

```yaml
kind: defect
modules: [packages/shell/renderer, packages/protocol, packages/core/projects]
```

지금: `lophn-space/projects/core-source.ts`의 `createProject`가 제목에서 slug(`slugOf`)를 만들어 `project.create`의 `name`으로 보내고, `conflict`면 `-2`…`-5`로 `NAME_ATTEMPTS = 5`번까지 다시 보낸다. 어떤 `conflict`든 다시 보내므로 이름이 아니라 폴더 겹침 같은 다른 충돌도 다섯 번 돈 뒤에야 실패한다. 호출처는 launcher와 projects 화면 둘이 이 함수 하나를 쓴다.

영향: 충돌 원인을 사람에게 못 알리고 요청이 다섯 번 나간다. slug 규칙(`SLUG_MAX`, 정규화)을 renderer가 안다.

고치려면: `project.create`의 `name`을 입력에서 빼고 core가 title에서 정하게 한다(계약 변경, core·protocol·renderer 모두, 중간). 계약을 안 바꾸려면 `conflict` 메시지로 이름 충돌만 골라 재시도한다(작음).

## native view 위 toast가 두 길이다

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `app-frame/annotate/use-view-toast.ts`가 `overlay`가 있으면 overlay의 `notification` 표면으로 열고, 없으면 `dom` 값을 돌려줘 `app-space.tsx`가 같은 모양을 DOM으로 그린다. overlay가 없는 경우는 앱 view가 없는 창과 gallery뿐이다. `desktop/connection/toasts/toast-host.tsx`는 overlay 한 길만 쓴다.

영향: toast 모양·동작을 고치면 두 곳을 맞춰야 한다. DOM 길은 gallery에서만 실제로 쓰인다.

고치려면: overlay 하나로 하고 gallery용으로는 overlay stub을 주입한다(작음~중간). DOM 길과 `dom` 반환값, `app-space.tsx`의 `viewToast` 블록이 사라진다.

## project 고르기 scrim

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `app-frame/app-space.tsx`가 앱 place에서 연 화면에서 view를 project 없이 먼저 열어 두고(`viewState.project === null`), 그 위에 `ProjectPicker`를 얹는다. native view가 DOM을 가리므로 `project-picker.tsx`가 `useViewCover`로 view를 숨기고, 고르면 `views.setViewProject`로 main에 project를 알린다.

영향: view를 먼저 열고 덮고 다시 보이는 단계가 늘어, view 상태와 가리기가 어긋나는 경우를 따로 챙겨야 한다. 고르기 전에는 앱이 project 없이 뜬 채 가려져 있다.

고치려면: project를 고른 뒤에 view를 연다. main의 view 열기 흐름(`setViewProject`)과 renderer의 view 생명 주기를 함께 고쳐야 한다(중간~큼).

## fake source가 보관·rollback을 메모리에서 실제로 돌린다

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `workspace/contexts/fake-source.ts`(1194줄)의 `createFakeContextsSource`가 `archive`·`unarchive`·`rollback`을 사본 Map 위에서 revision 충돌 검사까지 흉내 낸다. 쓰는 곳은 dev-mock과 `tools/wireframes`의 gallery 화면 여럿이다.

영향: core 규칙이 바뀌면 fake도 따로 고쳐야 한다. 화면 모양에 필요한 것보다 크다.

고치려면: gallery에 필요한 만큼만 남긴다. 상태를 바꾸는 동작은 호출만 기록하고 고정된 성공 값을 돌려준다(작음). 이때 보관 목록·rollback 화면을 gallery에서 보여 주는 frame이 있는지 먼저 확인한다.

## 보낸 말을 `accepted`로 남겼다가 확정 메시지가 오면 지운다

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `conversation/drafts.ts`의 `DraftStore.accepted`가 접수된 말을 입력칸에서 비우면서 `outgoing`을 `accepted`로 남긴다. `agent-view.tsx`가 thread의 messages나 queued에 같은 id가 도착한 것을 보면 `outgoing: null`로 지운다.

영향: 임시 상태가 하나 더 있고 `delivery-state.ts`의 단계(sending·accepted·not_sent·unconfirmed)와 같이 움직인다. 확정 메시지(또는 다음 turn 줄)가 오기 전까지 접수된 말을 thread에 임시로 보이게 하는 값이다.

고치려면: 추천: 남긴다. 접수 응답과 event 도착 사이 틈을 메우는 상태이므로 이유를 `accepted` 주석에 적고 이 절을 지운다(몇 줄).

정한 것: 다이어트 계획에서 줄일지 정한다.

## 터미널 요청은 `request.coding.app === app`일 때만 pane에서 받는다

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `app-frame/app-space.tsx`의 `useTerminalOpenRequests` 콜백이 `request.coding.app !== app`이면 버린다. 훅(`terminal/use-terminal-open-requests.ts`)은 앱·project 구분 없이 모든 coding runtime을 알리고 호스트가 자기 것을 고른다고 주석에 적혀 있다. project 창은 `workspace/kinds/terminal.tsx`가 따로 받는다.

영향: 호스트마다 같은 검사를 각자 해야 하고 빼먹으면 다른 앱의 터미널이 열린다.

고치려면: 추천: 남긴다. 훅이 호스트 둘이 공유하는 것이라 검사는 호스트에 두는 게 단순하다. archived로 닫는다(kept). 바꾼다면 훅이 `filter` 인자를 받는다(작음).

정한 것: 다이어트 계획에서 줄일지 정한다.

## 새 session 입력 메모리 key `new:role:name:place`

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `conversation/agent-view-model.ts`의 `newSessionKey`가 `new:${role}:${name}:${place.kind}:${place.name}`로 key를 만든다. 함수 주석에 "같은 창의 다른 agent와 섞이지 않는다"는 이유가 이미 있다. 이름에 `:`가 들어가면 서로 다른 agent의 key가 겹칠 수 있다.

영향: 거의 없다. key 규칙이 함수 한 곳에 있다.

고치려면: 추천: 남긴다. 이 절을 지운다. 겹침이 걱정되면 이름 부분을 `encodeURIComponent`로 감싼다(한 줄).

정한 것: 다이어트 계획에서 줄일지 정한다.

## panel 층(rewind·권한·recap)을 `layer` state 하나로 둔다

```yaml
kind: defect
modules: [packages/shell/renderer]
```

지금: `conversation/agent-view.tsx`가 `Layer` 합집합(`rewind | permissions | recap`) state 하나로 열린 panel을 둔다. 타입 주석에 "하나만 열린다"고 불변 조건이 적혀 있다. 다만 이 파일이 617줄이다.

영향: panel 하나를 더하면 합집합과 분기가 늘지만, 동시에 둘이 열리는 상태가 생길 수 없게 해 주는 단순한 표현이다.

고치려면: 추천: 남긴다. 이 절을 지운다. 파일 길이가 문제라면 panel 렌더 블록을 컴포넌트로 빼는 것은 별개의 정리다.

정한 것: 다이어트 계획에서 줄일지 정한다.
