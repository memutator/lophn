# @lophn/declaration

## 목적

모든 앱이 같은 apps/declaration 계약으로 선언을 작성하고 검사하는 도우미다.
선언은 앱 code 안의 `lophn.ts`이고 release와 함께 봉인된다. 앱마다 선언 schema의
다른 사본을 만들지 않는다.

## 공개 API와 type

```ts
import { defineApp, validateDeclaration } from "@lophn/declaration";
```

- `defineApp(declaration)` — 앱의 선언(`lophn.ts`의 default export)을 만든다.
- `validateDeclaration(value)` — 선언 값을 검사한다(`ValidationResult`).
- `validateInput(schema, value)` — command 입력을 검사한다.
- `canonicalInputHash(schema, value)` — 정규 입력 hash를 낸다.
- type: `AppDeclaration`, `ScreenDeclaration`, `OperationDeclaration`,
  `CommandDeclaration`, `Place`, `ToolEffect`, `AppCommandUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
  `SkillDeclaration`, `AppKeyDeclaration`, `EventDeclaration`, `SubscriptionDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`

## 선언의 칸

`name`, `description`, `screens`, `operations`, `commands`, `permissions`,
`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`만 있다. 알 수 없는 칸은 거절한다.

- `screens` — 화면 목록이다. 항목은 `{key, label, path, places, params?, tray?}`다. `places`는
  화면을 열 수 있는 자리이고 비지 않고 겹치지 않는다.
  - `tab` — 앱 workspace와 앱 창이다. 첫 `tab` 화면이 앱의 입구다.
  - `panel` — project의 dock·float와 전역 float다. 사람이 "앱 · 화면 label"을 골라
    열고 activity bar에 고정한다. 한 가지 일만 하는 화면을 `panel`로 따로 두면 사람이
    앱 전체를 열지 않고 그 일만 옆에 띄운다. 넓어야만 쓸 수 있는 화면에는 `panel`을 뺀다.
  - `card` — agent 대화 안의 카드다.
  - `sidebar` — 오른쪽 sidebar다.
  - `tray` — 작업 표시줄 tray popup이다.
  - `tray` 칸 — tray popup의 크기다. `{width?, height?}`이고 단위는 px다. 둘 중 하나는
    있어야 하고 없는 쪽은 기본값(너비 360, 높이 480)이다. 각 쪽은 둘 중 하나다.
    - 숫자: 그 크기로 고정한다.
    - `{min?, max?}`: 화면 내용에 맞춰 그 범위 안에서 늘고 준다. 높이는 내용 높이를 따른다
      (목록이 짧으면 짧고, max를 넘으면 popup 안에서 스크롤한다). 너비는 min(없으면 기본값을
      범위 안으로 맞춘 값)에서 시작해 내용이 가로로 넘칠 때만 max까지 넓어진다. 높이를 맞추려면
      html·body·root 요소에 `height: 100%`를 두지 않는다(그러면 내용 높이를 잴 수 없어
      처음 높이에 머문다).

    너비는 240~720, 높이는 160~720의 정수이고 min은 max보다 클 수 없다. `places`에 `tray`가
    없는 화면에 두면 선언 오류다. 창이 더 작으면 lophn이 창 안으로 줄인다. 크기는 release에
    고정되므로 바꾸려면 다시 release한다.

    ```ts
    { key: "status", label: "Status", path: "/status", places: ["tray"],
      tray: { width: { max: 520 }, height: { min: 160, max: 480 } } }
    ```
  - `params` — 화면이 받는 인자의 schema다. 없으면 인자가 없는 화면이다. root type은
    object이고 command `inputSchema`와 같은 schema 규칙이다. 한 화면 안의 부분을
    따로 쓰고 싶으면 인자로 가르지 말고 화면으로 나눈다.

- `icon` — 앱 icon이다. 두 꼴 가운데 하나를 쓴다. 없으면 기본 모양이다.
  - `"lucide:<이름>"` — lucide icon 이름이다(`"lucide:folder-kanban"`). 이름은 lucide.dev/icons의
    kebab-case 이름이고, lophn이 theme 글자색으로 그린다. 파일이 필요 없다. 없는 이름은 release
    준비가 거절한다. 앱 agent는 icon을 직접 그리기 전에 이것을 먼저 고른다.
  - bundle 안 이미지 파일의 경로(`"/assets/icon.svg"`) — `.svg`, `.png`, `.webp`만 받고
    64 KiB 이하여야 한다. 파일은 source에 commit해 두면 release에 담기고, 선언했는데 파일이
    없으면 release 준비가 거절한다. 색을 theme에 맞출 필요가 없는 그림일 때 쓴다.

  lophn이 탭과 앱 목록에서 앱을 보일 때 쓴다. 사람이 App details에서 올린 icon이 있으면
  그것이 먼저다.

- `skills` — 앱이 내놓는 skill 목록이다. 항목은 `{name, public, commands}`다. skill 본문은
  source의 `.lophn/skills/<name>/SKILL.md`에 commit한다(release 준비가 없으면 거절한다.
  `.gitignore`가 `.lophn/`을 통째로 빼면 `.lophn/sdk/`로 바꾼다). `name`은 skill 폴더 이름
  규칙(소문자·숫자·`-`, 64자까지)이고 겹치지 못한다. `commands`는 이 선언의 command 이름이다.
  `public`이 true인 skill은 다른 agent에게도 주므로 `commands`가 모두 public command여야
  한다. 없는 command나 비공개 command를 쓰는 public skill은 선언 오류다.
  공개 skill을 지우는 release는 막지 않고, 그 앱을 할당받은 agent가 있으면 준비 결과의
  `removed_public_skills`에 그 skill이 실린다.
- `keys` — 앱이 내는 key(단축키) 목록이다. 항목은 `{id, title, key: {mac?, other}, context?}`다.
  - `id`는 이 앱 안의 이름이다(영문·숫자·`_ - .`, 1~64자, 겹치지 못한다). Settings › Keyboard에는
    `app.<앱 id>.<id>` command의 줄로 보이고 사람이 바꿀 수 있다. `title`은 그 줄의 이름이다(한 줄).
  - `key.other`는 Linux·Windows의 key, `key.mac`은 macOS의 key다. `mac`이 없으면 `other`와 같다.
    key는 홑 타 하나이고 modifier(`Ctrl`·`Cmd`·`Alt`·`Shift`)가 있거나 F1~F12여야 한다(글 입력을 삼키지 않게).
    예 `"Ctrl+KeyS"`, `"Cmd+KeyS"`, `"F5"`. 두 타 key(`"Ctrl+KeyX Ctrl+KeyE"`)는 선언할 수 없다.
  - `context`는 Settings 줄에 쓰는 context 이름이다. 빼면 `app:<앱 id>`다. 보통 빼 둔다.
  - key는 화면이 `@lophn/app-ui`의 `useCommand`로 같은 `id`에 handler를 건 동안만 돈다. handler가 없으면 줄만 보이고
    아무 일도 없다. 앱 안에서 맞은 key는 앱이 가져가고, 앱이 맞추지 않은 shell key(탭 이동, palette 등)는 shell이 돈다.
    `main`이 먼저 받는 key(탭 닫기 Ctrl+W 등)는 앱에 닿기 전에 shell이 가져가므로 앱 key로 주지 않는다.
- `events` — 이 앱이 내는 event 목록이다. 항목은 `{name, description, payloadSchema}`다. `name`은 1~64자
  (영문·숫자·`_ - .`)이고 겹치지 못한다. `payloadSchema`는 payload의 schema이고 root type은 object이며 command
  `inputSchema`와 같은 규칙(설명을 단다)이다. 앱 process가 `@lophn/cap-tool`의 `publish(name, payload)`로 내고, 선언하지 않았거나
  payload가 schema와 맞지 않으면 core가 `invalid_input`으로 거절한다.
  - event는 일이 일어난 **뒤의 알림**이다. 한 번 전달되고 저장되지 않는다. 그 순간 켜져 있는 구독 앱만 받는다.
    그래서 event만으로 상태를 만들지 말고, 발행 앱은 지금 값을 읽는 read command를 따로 내놓는다. 구독 앱은 켜질 때 그 command를
    한 번 읽는다.
- `subscriptions` — 이 앱이 듣는 event 목록이다. 항목은 `{source, event}`다. `source`는 event를 낸 앱의 slug이거나
  lophn이 내는 event의 `"lophn"`이다(lophn이 내는 event는 session lifecycle의 `session.started|running|waiting|idle|ended`다. `@lophn/agent` guide). 사람 허락은 없다. 받는 handler 이름은 `on.<source>.<event>`로 정해지고
  operation·command와 같은 handler 이름 공간을 쓴다(64자 안, 겹치면 선언 오류). 앱 process가 `@lophn/cap-tool`의
  `subscribe(source, event, handler)`로 그 handler를 등록한다. handler 등록은 필수가 아니다: 등록하지 않은 앱(화면만 구독하는 앱)의 process에는 그 event가 가지 않는다. 선언하지 않은 구독의 handler를 등록하면 앱이 시작하지 못한다.
  - 전달은 구독 앱의 handler 호출(invocation) 하나다. 앱 호출 기록(`lophn app invocations`)에 어느 앱의 어느 event가
    불렀는지 보인다. handler는 write로 기록되고 changeset을 떠서 rewind 대상이다.
- `operations` — 앱 안의 operation 목록이다. 화면(`lophnApp.callOperation`)과 앱
  자신이 쓰는 저수준 동작이고, agent·다른 앱·job·flow는 부르지 못한다(core가
  막는다). 항목은 `{name, title, effect}`다. `title`은 화면 `OperationButton`이
  쓰는 글이고, `effect`는 `read`·`write`·`external`이다. lophn이 아는 것은 이
  셋뿐이다. 입력 schema와 설명은 앱 code의 일이고, 결과 크기는 command보다 넉넉하다.
  write·external operation도 core를 지나 줄, 기록, changeset을 거치므로 rewind
  대상이다.
- `commands` — 앱이 골라 내놓는 바깥 명령 목록이다. agent, 다른 앱, job, flow가
  부른다. 의미 단위로 나누고 결과를 작게 둔다(모든 행 목록 같은 화면용 동작은
  operation이다). 항목은 `{name, description, inputSchema, effect, public}`다.
  `inputSchema`는 입력 schema나 입력이 없으면 `null`이다(`null`이 아니면 root type은
  object). `effect`는 `read`·`write`·`external`이다. `public`은 필수 boolean이고
  다른 앱의 agent에 보이는지를 뜻한다. 비공개 command는 그 앱 workspace의 session만 본다.
  agent는 `lophn <앱 slug> <command>`로 부른다.
  - operation과 command의 이름(1~64자, 영문·숫자·`_ - .`)은 합쳐 하나이고
    handler는 이름 하나로 등록한다. 이름을 두 목록에 같이 쓰지 못한다.
  - CLI에서는 command 이름의 `.`을 낱말 경계로, `_`를 `-`로 바꾼다.
    `add_event`는 `lophn <slug> add-event`, `quota.list`는 `lophn <slug> quota list`다.
    입력 필드 `start_time`의 flag는 `--start-time`이다. JSON 입력과 handler 이름은 원래 이름을 쓴다.
    실제 호출법은 `lophn <slug> --help`로 확인한다. 앱 command는 호출마다 현재 선언과 할당을 읽으므로
    새 command를 쓰려고 새 session을 열 필요는 없다.
  - CLI로 바꾼 뒤 같은 이름이 되는 command(`add_event`와 `add-event`)나 같은 flag가 되는
    최상위 입력 필드(`start_time`과 `start-time`, boolean `enabled`와 `no_enabled`)는 선언 오류다.
    필드 충돌 검사는 JSON 안의 nested object에는 적용하지 않는다.
- `permissions` — 앱이 바깥에 닿는 자원이다. 항목은 `{kind, scope, reason}`이고
  kind는 `fs.read`·`fs.write`(`{path, recursive}`), `net.fetch`·`net.listen`
  (`{host, port}`), `secret.use`(`{name, oauth?}`), `notify.send`(`{}`, scope 없음.
  사람에게 알린다. `@lophn/cap-notify` guide)다. 같은 `name`의 `secret.use`는 하나뿐이다.
  - `oauth`를 두면 그 secret은 사람이 sign-in해 받은 OAuth access token이다.
    `{authorization_endpoint, token_endpoint, scopes, params?}`이고 끝점은
    https이거나 loopback http다. `scopes`는 정렬하고 중복을 지운다. `params`는
    authorize URL에 더할 parameter(8개까지)이고 `client_id`, `scope`,
    `redirect_uri`, `state` 같은 OAuth 표준 key는 쓸 수 없다. 쓰는 법은
    `@lophn/cap-secret` guide다.
  - `oauth` 칸(끝점, scope, params)을 바꾸면 늘어난 선언이라 activation 때
    사람에게 다시 묻는다.
- `app_connections` — 이 앱이 부를 다른 앱의 command다(operation은 못 부른다). 항목은
  `{app, commands: string[], reason}`이고 자기 앱은 대상이 될 수 없다.

## 요구 permission

없다. 검사 도우미는 앱 밖 접근을 하지 않는다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { defineApp, validateDeclaration } from "@lophn/declaration";

const declaration = defineApp({
  name: "notes",
  description: "메모 앱",
  screens: [],
  operations: [],
  commands: [],
  permissions: [],
  app_connections: [],
  sdk_dependencies: [{ name: "@lophn/declaration", version: "4.5.1" }],
});

const result = validateDeclaration(declaration);
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다. 새 helper나 새 type이 여기 더해진다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도
  major다(patch나 minor 절에 permission 증가를 두지 않는다).
