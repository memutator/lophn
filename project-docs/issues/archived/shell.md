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

## context chip이 agent에게 chip으로 전해지지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
closed: fixed
guard: packages/shell/renderer/conversation/attached-chips_test.ts "context chip과 위반 chip은 SendMessage가 받는 attached로 바뀐다"
```

지금:
- 새 session 첫 말: `conversation/agent-view.tsx`의 `ensureSession`이 `openSession({id, contexts: chips})`를 부르지만 `conversation/agent-tab-core-source-sessions.ts`의 `openSession`은 `contexts`를 버리고 `opening_context: null`로 연다. 첫 말은 `agent-tab-core-source-commands.ts`의 `sendText`가 `attached: []`로 보낸다. chip은 쓴 글이 없을 때 보낼 글감(`chipText`, 라벨만)으로만 쓰인다.
- 열린 PM session: `workspace/workspace.tsx`의 `askPm`은 draft가 비어 있을 때만 위반 줄을 `파일 - 규칙` 글로 채운다(새 PM 탭은 `openAgent(... chips)`로 chip이 붙는다). `workspace/reactions/project-manager.ts`는 열린 session이 있으면 chip도 글도 없이 탭만 고른다. 열린 PM session 찾는 함수가 두 곳(`openedPmSession`, `openedSession`)에 따로 있다. composer는 `session === null`일 때만 chip을 그린다.

계약은 이미 있다: `SendMessage.attached`가 `context`·`violation` chip을 받는다.

영향: PM이나 lophn에게 context나 위반을 chip으로 붙여 말해도 agent는 chip을 모르고 글 라벨만 본다. 같은 위반이 열린 session에서는 글이고 새 탭에서는 chip이라 PM이 받는 모양이 다르고, 열린 session의 draft에 글이 있으면 위반이 아예 안 실린다.

고치려면: `sendText`가 chip을 `attached`로 싣고 composer가 열린 session에서도 chip을 그려 보낼 때 같이 싣는다. `ContextChipView`에 context id가 없어(`id`는 위반 key나 check id) 필드를 더해야 한다. 열린 PM session 찾는 함수는 하나로 합친다. 중간, 계약 변경 없음. 추천: 이 안.

닫음: `ContextChipView`에 ctx id(`context`)가 생겼고 `conversation/attached-chips.ts`의 `attachedOf`가 chip을 `attached`(위반이 있으면 `violation`, 없으면 `context`)로 바꾼다. `sendText`가 그것을 싣고, 보낼 말(`Outgoing`)이 chip을 쥐어 다시 보내기에도 실린다. chip은 탭의 `fields.chips`가 쥐고(controlled) composer는 열린 session에서도 그린다. `openAgent`는 열린 session의 탭에 새 chip을 더하고, `askPm`과 `openProjectManager`는 session 유무만 다르고 둘 다 chip을 붙인다(글로 채우던 길은 지웠다). 열린 PM session 찾기는 `sidebar/panel-sessions.ts`의 `openedProjectManagerSession` 하나다. `openSession`의 안 쓰던 `contexts` 인자는 지웠다.

## 보낸 chip이 대화에 남지 않고 다시 보내기가 chip을 빼고 보낸다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/protocol]
closed: fixed
guard: packages/shell/renderer/conversation/attached-chips_test.ts "chip을 본문 part로 쓰고 다시 읽으면 같은 attached가 되어 SendMessage가 받는다"
```

지금: composer의 context·위반 chip은 `SendMessage.attached`로만 간다(`packages/shell/renderer/conversation/attached-chips.ts`의 `attachedOf`, `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`의 `sendText`). core는 그것을 Router 입력 본문 앞의 `<lophn-attached …>` 줄로 만들 뿐 message 본문(`content.parts`)에는 chip이 없다. 그래서 대화 화면에는 보낸 글만 보이고, 같은 file의 `retryTurn`은 본문에서 chip을 다시 만들 수 없어 `attached: []`로 다시 보낸다. 글 없이 chip만 보내면 본문은 chip 라벨뿐이다.

영향: 사람은 어떤 위반·context를 붙여 보냈는지 대화에서 다시 볼 수 없다. 실패한 turn을 다시 시도하면 agent는 처음에 받은 위반(파일·규칙)을 받지 못하고 라벨 글만 본다.

고치려면(작음): 본문의 `attached` part는 이미 있다(`packages/protocol/lophn-agent/message-content.ts`의 `attachedFields`). 대화 화면의 `readBody`가 그 part를 그리고 `retryTurn`도 본문의 part를 복사한다. 모자란 것은 둘이다. (1) `attachedFields`에 optional `context`(ctx id)를 더하고 `sendText`가 chip마다 `attached` part를 본문에 쓴다. (2) `retryTurn`이 본문의 `attached` part로 `SendMessage.attached`를 다시 만든다.

정한 것: 위대로 고친다. 앞서 "보낸 chip은 본문에 남기지 않는다"고 정한 것(agent)을 뒤집는다. 다시 시도한 turn에서 agent가 위반을 잃는 것이 고치는 비용보다 크다. (agent)

닫음: `attachedFields`에 optional `context`(ctx id)가 생겼다. `conversation/attached-chips.ts`의 `attachedPartsOf`가 chip마다 `attached` part를 만들고 `sendText`가 그것을 글 앞에 쓴다. `attachedOfParts`가 본문의 part에서 `SendMessage.attached`를 되살려 `retryTurn`이 위반(파일·규칙)을 잃지 않고 다시 보낸다. 글 없이 chip만 보내면 라벨 글과 chip part가 같이 보인다. core의 이력(`session/history.ts`)은 `text` part만 읽으므로 뒤 turn의 이력에는 chip 줄이 없다.

## 일반 설정 통로의 MCP 함수를 화면이 부르지 않는다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: `packages/shell/renderer/desktop/settings/source.ts`의 `SettingsSource`에 `settings()`(skill 폴더와 MCP server 목록), `addSkillFolder`, `addServer`, `enterServerCredential`, `beginSignIn`, `cancelSignIn`, `finishSignIn`이 있고 `settings/core-source.ts`의 `coreSettingsSource`와 `settings/testdata/fake-settings.ts`가 구현한다. 화면에서 부르는 곳이 없다(`packages/shell`과 `tools`에서 `.addServer(`, `.enterServerCredential(`, `.beginSignIn(`, `.settings()` grep 0건). General 탭은 `declared`·`update`만 쓰고, Tools and skills 탭은 `AgentsSettingsSource`(`settings/agents/core-source.ts`의 `readExtensions`, `createServer`)를 쓴다.

영향: MCP server를 더하는 길이 둘이라 설정 꼴이나 secret 이름 규칙이 바뀔 때 두 곳을 고쳐야 한다(MCP credential을 `secrets.json`으로 옮길 때 쓰이지 않는 쪽도 새 꼴로 고쳤다). 개발 비용이다.

고치려면:
- 지운다(작음): `SettingsSource`의 위 함수와 그것만 쓰는 type(`SettingsView`, `ServerRow`, `NewServer`, `ServerSignIn` 등), `coreSettingsSource`와 fake의 구현을 지운다. 잃는 기능은 없다. 추천.
- 둔다: 전역 MCP 화면을 일반 설정 통로로 되돌릴 계획이 있을 때.

정한 것: 지운다. 잃는 기능이 없는 죽은 코드다(issue skill "정하기"). (agent)

닫음: `SettingsSource`는 `watch`, `declared`, `update` 셋만 남았다. MCP·skill 폴더 함수와 그것만 쓰던 type, `coreSettingsSource`의 구현, `fakeSettings`의 가짜를 지웠다. server를 더하는 길은 Tools and skills 탭(`AgentsSettingsSource`) 하나다.

## 설정 화면의 command가 compare를 빼서 provider 연결과 기본 model 바꾸기가 모두 거절된다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: packages/shell/renderer/command-call_test.ts "helper가 만든 봉투는 route의 봉투 schema를 통과한다"
```

지금: `packages/shell/renderer/desktop/settings/core-call.ts`의 `command()`는 `compare`를 받지 않으면 봉투에서 그 칸을 뺀다. command 봉투(`packages/protocol/base/envelope.ts`의 `commandRequestSchema`)는 compare가 없는 route에도 `compare: {}`를 요구하는 strict object라, main의 contract client(`packages/shell/main/desktop/core/client.ts`의 `openSession` → `packages/protocol/client/client.ts`)가 core에 보내기 전에 `invalid_input`으로 돌려준다. 이 helper로 compare 없이 보내는 곳은 `settings/providers/core-source.ts`의 `connectWithKey`(API key 연결), key 없는 custom provider 연결, `signIn`의 `login-begin`·`login-complete`·`login-cancel`, `settings/agents/core-source.ts`의 `changeDefaultModel`이다. 재현: 실제 core에 화면의 `coreProviderSettingsSource`를 main의 `openSession`·`nodeFetch`로 붙여 `connect("openai", "oauth")`를 부르면 `providers/definitions` read는 성공하고 `login-begin`이 `invalid_input`이다.

renderer에서 command 봉투를 손으로 짜는 곳이 10개 file에 11곳이다. type이 compare를 강제하는 곳은 대화의 `conversation/agent-tab-core-source-env.ts`(`CommandBody`) 하나이고, 나머지는 `compare: {}`를 손으로 적는다.

영향: 사람이 설정 화면에서 provider를 하나도 붙이지 못한다. API key, custom, ChatGPT·SuperGrok 로그인 모두 "Couldn't connect"로 끝나고 browser도 열리지 않는다. Agents 탭에서 기본 model도 바꾸지 못한다. dev는 `tools/dev.ts`가 fake provider를 core에 직접 연결해 두어 드러나지 않았다. 화면 test는 가짜 CoreSource를 쓰고 e2e는 core에 봉투를 직접 만들어 불러서, 화면이 만든 봉투를 contract schema로 보는 곳이 없다.

고치려면:
- 설정 helper만 고친다(작음): 늘 `compare: body.compare ?? {}`를 보낸다. 손으로 짠 봉투 11벌은 그대로다.
- 봉투를 하나로 모은다(작음~중간): 대화의 `CommandBody`처럼 protocol route를 받아 input·compare type을 route에서 꺼내는 helper 하나를 renderer에 두고 11곳이 그것만 쓴다. compare가 없는 route는 type이 `{}`를 강제한다. guard는 그 helper가 만든 봉투가 `commandRequestSchema`를 통과하는지 보는 test 하나(process 없이).

정한 것: 봉투를 하나로 모은다. 화면마다 손으로 짠 봉투가 11벌이라 한 곳의 실수가 설정의 연결 기능 전체를 조용히 막았다.

닫음: `packages/shell/renderer/command-call.ts`의 `commandBody`·`commandCall`이 protocol route를 받아 봉투를 만든다. compare는 type에서 필수라 빠뜨릴 수 없다. 설정, 대화, 앱, context, agent, 앱 상세, problem, 대기 목록, launcher의 손으로 짠 봉투를 모두 이 helper로 바꿨다. guard는 helper의 봉투가 compare 없는 route, compare 있는 route, confirmation 필수 route에서 `commandRequestSchema`를 통과하는지 본다.

## 데스크톱이 CLI의 `--json` 결과를 `data` 칸에서 찾아 harness 감지가 늘 실패한다

```yaml
kind: bug
modules: [packages/shell/main, packages/coding-agent]
closed: fixed
guard: packages/shell/main/desktop/coding-connection_test.ts "`lophn --json`의 성공 출력은 그대로 data가 되고 `{error}` 출력은 실패가 된다"
```

지금:
- `packages/shell/main/desktop/coding-connection.ts`의 `childCliRunner`는 `lophn ... --json`의 stdout을 `{ data?, error? }`로 읽고 성공이면 `body.data`를 돌려준다.
- CLI는 성공하면 data를 감싸지 않고 `JSON.stringify(data)` 한 줄을 쓴다(`packages/coding-agent/cli/output.ts`의 `result`). 실패만 `{ error }`로 감싼다.
- 그래서 성공한 `harness detect`의 결과가 늘 `undefined`이고, `run`은 "Detection gave an unknown result."로 모든 harness를 unknown으로 둔다. `harness install`의 결과도 같은 길로 읽는다.

영향: 데스크톱 앱에서 coding agent 감지와 hook·skill 설치가 결과를 읽지 못한다. 감지된 harness가 없으면 App Engineer가 ticket을 coding agent에게 맡기지 못한다.

고치려면: `childCliRunner`가 성공 출력을 그대로 data로 받는다(`body?.error`가 없으면 `body` 전체가 data)(작음). 이 runner에 CLI 출력 꼴 하나로 test를 둔다. 추천.

닫음: `childCliRunner`는 stdout JSON이 `{ error: { code, message } }` 꼴이면 실패로, 아니면 값 전체를 data로 돌려준다.

## app panel이나 browser 탭 page에 focus가 있으면 작업대 단축키가 듣지 않는다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/ipc]
closed: fixed
guard: packages/shell/renderer/workspace/keybindings_test.ts "한글 입력 상태의 키와 modifier가 더 붙은 키를 가려서 판정한다"
```

지금: 두 갈래다.
- browser 탭(`<webview>` guest): `packages/shell/main/desktop/wiring/desktop.ts`의 `web-contents-created`가 키를 보낼 창을 `window.webContents`와 `contentView`의 `WebContentsView` 자식에서만 찾는다. guest는 둘 다 아니라서 창을 못 찾고 `listenShortcuts`가 false를 낸다. palette·launcher chord, macOS `Cmd+W`까지 아무 단축키도 shell에 오지 않는다.
- app panel(native view): 키는 `packages/shell/main/desktop/wiring/desktop.ts`의 `web-contents-created`가 건 `listenShortcuts`(`packages/shell/main/desktop/shortcuts.ts`)만 본다. 이 함수의 `windowShortcut`은 palette·launcher chord(`WINDOW_SHORTCUTS`)와 작업대 단축키 표(`packages/shell/ipc/keybindings.ts`)에서 `main`이 적힌 것만 본다. 그 표에서 `main`이 적힌 것은 `tab.close`의 macOS `Cmd+KeyW` 하나다. 그래서 page에 focus가 있으면 Linux·Windows의 `Ctrl+W`·`Ctrl+F4`(`tab.close`), `Ctrl+Tab`·`Ctrl+Shift+Tab`(`tab.next`·`tab.prev`), `Ctrl+Shift+T`(`tab.reopen`) 같은 renderer 몫 단축키가 page로 가고 shell renderer에 오지 않는다.

영향: browser 탭을 보다가 키보드로 palette를 열거나 탭을 닫거나 넘기지 못한다. app panel에서는 탭을 닫거나 넘기지 못한다. 먼저 탭 줄을 눌러 focus를 shell로 옮겨야 한다. browser 탭이 생기면서 page에 focus가 오래 머무는 일이 많아진다.

고치려면:
- (browser, 작음, 먼저) 창을 찾을 때 guest면 `contents.hostWebContents`로 그 창을 찾는다.
- (추천, 작음) 작업대 단축키 표의 탭 이동·닫기·다시 열기 줄에 `main`을 모든 OS로 넓힌다. `listenShortcuts`가 그 키를 삼키고 shell renderer로 보낸다. page가 그 키를 못 받게 되는 것을 잃는다(Chrome과 같다).
- (중간) native view의 키를 모두 shell renderer에 보내 renderer의 matcher가 고르게 한다. 키마다 IPC가 생기고 page가 받을 키를 renderer가 다시 돌려줘야 한다.

닫음: `web-contents-created`가 `<webview>` guest의 창을 `hostWebContents`로 찾는다. 작업대 단축키 표의 탭 이동·닫기·다시 열기 줄(`tab.next`·`tab.prev`·`tab.close`·`tab.reopen`·`tab.move-left`·`tab.move-right`)을 모든 OS에서 `main`으로 바꿔 `listenShortcuts`가 page 대신 삼켜 shell renderer로 보낸다. Linux·Windows에서 shell renderer 자신의 키는 main이 삼키지 않고 renderer가 받는다(터미널의 Ctrl+W를 shell로 보내기 위해).

## 대화 입력창의 붙이기 단추가 아무 일도 하지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/design]
closed: fixed
guard: 없음
```

지금: `packages/shell/renderer/conversation/composer/agent-composer.tsx`가 붙이기 단추(`conversation.button.attach`, `onAttach`)를 그린다. host는 둘 다 빈 함수다(`packages/shell/renderer/workspace/kinds/agent.tsx`와 `packages/shell/renderer/app-frame/side-panel.tsx`의 `attach: () => {}`). 붙인 것(`attached`) 기구는 지웠다.

영향: 사람이 대화 입력창의 + 단추를 눌러도 아무 일도 일어나지 않는다.

고치려면: 단추와 `onAttach`, host의 `attach`, wording key `conversation.button.attach`를 지우고 wireframe을 맞춘다(작음). 추천. 붙이기 기능을 만들 때 다시 더한다.

닫음: 단추, `onAttach`, `AgentViewHost.attach`, 두 host의 `attach`, 아이콘 `conversationIcons.attach`, wording key `conversation.button.attach`를 지우고 wireframe 둘을 맞췄다. 붙이기 기능을 만들 때 다시 더한다.

## shell이 문자열로 부르는 core route가 지워져도 check가 잡지 못한다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer, tools]
closed: fixed
guard: tools/check-source.ts rule SHELL_ROUTE
```

지금: shell main과 renderer는 core route를 `call("read", "<resource>", "<method>", …)`처럼 문자열로 부른다(예: `packages/shell/main/app-frame/app-connection.ts`). route를 지우거나 이름을 바꿔도 type check와 core 기동은 통과한다. `releases.get`을 지운 commit 뒤 데스크톱 앱의 모든 live 앱 화면이 "Couldn't load <앱>"으로 떴고, 나흘 뒤 사람이 앱을 열어 보고서야 드러났다. 안 쓰는 export를 정리하다 화면 셋이 부르던 route를 지운 일도 앞서 있었다. 지금은 worker 지침의 "method를 문자열로도 grep한다"만 막는다.

영향: 사람이 데스크톱 앱에서 그 기능을 쓸 수 없다. e2e는 Electron 화면을 띄우지 않아 보지 못한다.

고치려면: `tools/check-source.ts`에 규칙 하나. shell의 문자열 route 호출(resource·method 짝)을 모아 protocol의 route 목록에 없는 짝을 막는다(작음). 추천.

닫음: `tools/check-source.ts`의 규칙 `SHELL_ROUTE`가 `packages/shell/main`·`packages/shell/renderer`의 문자열 route 호출(`call`·`internal`·`coreInternal`은 kind가 첫 인자, `read`·`memory`·`command`·`upload`·`fileStream`은 호출 이름이 kind)과 `"memory:settings/list"` 같은 이름 문자열을 `SHELL_ROUTES`(`packages/shell/main/desktop/core/routes.ts`)에 대어 없는 짝을 막는다. kind·resource·method가 변수인 호출은 읽지 않는다. 처음 돌렸을 때 깨진 호출은 없었다.
