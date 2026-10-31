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
- `validateInput(schema, value)` — tool 입력을 검사한다.
- `canonicalInputHash(schema, value)` — 정규 입력 hash를 낸다.
- type: `AppDeclaration`, `ScreenDeclaration`, `ToolDeclaration`, `ToolEffect`,
  `AppToolUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
  `SDKDependency`, `ValidationResult`, `ValidationError`

## 선언의 칸

`name`, `description`, `screens`, `tools`, `permissions`, `app_connections`,
`sdk_dependencies`와 선택 칸 `icon`만 있다. 알 수 없는 칸은 거절한다.

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

- `tools` — 다른 앱과 화면이 부르는 tool 목록이다. 항목은
  `{name, title, description, inputSchema, outputSchema?, effect, public, domain}`다.
  `name`은 MCP tool 이름 문자(1~64자)이고, `inputSchema`는 입력 schema나 입력이
  없으면 `null`이다(`null`이 아니면 root type은 object). `outputSchema`는 없으면
  칸을 두지 않는다. `effect`는 `read`·`write`·`external`이다. `public`은 필수
  boolean이고 다른 domain에 보이는지를 뜻한다(읽는 쪽은 이 계획 밖이다).
  `domain`은 필수이고 tool이 다루는 객체의 domain이다. 이 앱의 domain 이름 중
  하나이고, 앱을 만들면 앱 이름의 domain이 하나 생긴다. 다른 domain은 사람이나 그
  앱 place의 session이 `domain.create`로 만든 뒤 쓴다.
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
- `app_connections` — 이 앱이 부를 다른 앱의 tool이다. 항목은
  `{app, tools: string[], reason}`이고 자기 앱은 대상이 될 수 없다.

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
  tools: [],
  permissions: [],
  app_connections: [],
  sdk_dependencies: [{ name: "@lophn/declaration", version: "1.0.0" }],
});

const result = validateDeclaration(declaration);
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다. 새 helper나 새 type이 여기 더해진다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도
  major다(patch나 minor 절에 permission 증가를 두지 않는다).
