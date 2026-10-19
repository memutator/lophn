# @lophn/blueprint

## 목적

모든 앱이 같은 apps/blueprint 계약으로 선언을 작성하고 검사하는 도우미다. 앱마다
blueprint schema의 다른 사본을 만들지 않는다.

## 공개 API와 type

```ts
import { defineBlueprint, validateBlueprint } from "@lophn/blueprint";
```

- `defineBlueprint(declaration)` — blueprint 선언을 만든다.
- `validateBlueprint(value)` — blueprint 값을 검사한다(`ValidationResult`).
- `validateInput(schema, value)` — tool 입력을 검사한다.
- `canonicalInputHash(schema, value)` — 정규 입력 hash를 낸다.
- type: `Blueprint`, `ScreenDeclaration`, `ToolDeclaration`, `ToolEffect`,
  `AppToolUseDeclaration`, `PermissionRequirement`, `SDKDependency`,
  `ValidationResult`, `ValidationError`

## blueprint 칸

`name`, `description`, `screens`, `tools`, `permissions`, `app_connections`,
`sdk_dependencies`만 있다. 알 수 없는 칸은 거절한다.

- `tools` — 다른 앱과 화면이 부르는 tool 목록이다. 항목은
  `{name, title, description, inputSchema, outputSchema?, effect, public, domain}`다.
  `name`은 MCP tool 이름 문자(1~64자)이고, `inputSchema`는 입력 schema나 입력이
  없으면 `null`이다(`null`이 아니면 root type은 object). `outputSchema`는 없으면
  칸을 두지 않는다. `effect`는 `read`·`write`·`external`이다. `public`은 필수
  boolean이고 다른 project에 보이는지를 뜻한다(읽는 쪽은 이 계획 밖이다).
  `domain`은 필수이고 tool이 다루는 객체의 domain이다. 이 앱의 domain 이름 중
  하나이고, 앱을 만들면 앱 이름의 domain이 하나 생긴다. 다른 domain은 사람이나
  App Engineer가 `domain.create`로 만든 뒤 쓴다.
- `app_connections` — 이 앱이 부를 다른 앱의 tool이다. 항목은
  `{app, tools: string[], reason}`이고 자기 앱은 대상이 될 수 없다.

## 요구 permission

없다. 검사 도우미는 앱 밖 접근을 하지 않는다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { defineBlueprint, validateBlueprint } from "@lophn/blueprint";

const blueprint = defineBlueprint({
  name: "notes",
  description: "메모 앱",
  screens: [],
  tools: [],
  permissions: [],
  app_connections: [],
  sdk_dependencies: [{ name: "@lophn/blueprint", version: "1.0.0" }],
});

const result = validateBlueprint(blueprint);
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다. 새 helper나 새 type이 여기 더해진다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도
  major다(patch나 minor 절에 permission 증가를 두지 않는다).
