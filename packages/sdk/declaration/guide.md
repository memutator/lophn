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
  `CommandDeclaration`, `ToolEffect`, `AppCommandUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
  `SkillDeclaration`, `SDKDependency`, `ValidationResult`, `ValidationError`

## 선언의 칸

`name`, `description`, `screens`, `operations`, `commands`, `permissions`,
`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`만 있다. 알 수 없는 칸은 거절한다.

- `screens` — 화면 목록이다. 항목은 `{key, label, path, sizes}`다. `sizes`는
  화면을 열 수 있는 자리다. `full`은 앱 창, `panel`은 project 창의 탭(사람이
  "앱 · 화면 label"을 골라 열고 activity bar에 고정한다), `card`는 agent 대화 안의
  카드다. 한 가지 일만 하는 화면을 `panel`로 따로 두면 사람이 앱 전체를 열지 않고
  그 일만 옆에 띄운다. 넓어야만 쓸 수 있는 화면에는 `panel`을 빼 둔다.

- `icon` — 앱 icon 이미지의 bundle 안 경로다(`"/assets/icon.svg"`). `.svg`, `.png`,
  `.webp`만 받고 64 KiB 이하여야 한다. 파일은 source에 commit해 두면 release에
  담기고, 선언했는데 파일이 없으면 release 준비가 거절한다. lophn이 탭과 앱 목록에서
  앱을 보일 때 쓴다. 없으면 기본 모양이다. 사람이 App details에서 올린 icon이 있으면
  그것이 먼저다.

- `skills` — 앱이 내놓는 skill 목록이다. 항목은 `{name, public, commands}`다. skill 본문은
  source의 `.lophn/skills/<name>/SKILL.md`에 commit한다(release 준비가 없으면 거절한다.
  `.gitignore`가 `.lophn/`을 통째로 빼면 `.lophn/sdk/`로 바꾼다). `name`은 skill 폴더 이름
  규칙(소문자·숫자·`-`, 64자까지)이고 겹치지 못한다. `commands`는 이 선언의 command 이름이다.
  `public`이 true인 skill은 다른 agent에게도 주므로 `commands`가 모두 public command여야
  한다. 없는 command나 비공개 command를 쓰는 public skill은 선언 오류다.
  공개 skill을 지우는 release는 막지 않고, 그 앱을 할당받은 agent가 있으면 준비 결과의
  `removed_public_skills`에 그 skill이 실린다.
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
- `permissions` — 앱이 바깥에 닿는 자원이다. 항목은 `{kind, scope, reason}`이고
  kind는 `fs.read`·`fs.write`(`{path, recursive}`), `net.fetch`·`net.listen`
  (`{host, port}`), `secret.use`(`{name, oauth?}`)다. 같은 `name`의
  `secret.use`는 하나뿐이다.
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
  sdk_dependencies: [{ name: "@lophn/declaration", version: "3.0.0" }],
});

const result = validateDeclaration(declaration);
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다. 새 helper나 새 type이 여기 더해진다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도
  major다(patch나 minor 절에 permission 증가를 두지 않는다).
