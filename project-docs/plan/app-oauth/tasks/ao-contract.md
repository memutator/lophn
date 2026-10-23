# ao-contract

앱 선언의 `secret.use` 칸에 선택 `oauth` 블록을 더하고, 사람이 쓰는 앱 OAuth route 넷, `app-oauth.` 이름 공간 상수, `netFetch` 요청의 `body`·`headers` 칸을 protocol에 고정한다. 구현은 하지 않는다. 뒤 task가 이 모양을 그대로 쓴다.

- 단위: ao-contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/permissions.ts`
  - `packages/protocol/apps/blueprint/types.ts`
  - `packages/protocol/apps/blueprint/scope.ts`
  - `packages/protocol/apps/blueprint/value.ts`
  - `packages/protocol/apps/blueprint/mod.ts`
  - `packages/protocol/apps/blueprint/validate_test.ts`
  - `packages/protocol/apps/oauth.ts`(새 file)
  - `packages/protocol/apps/broker.ts`
  - `packages/protocol/apps/registry.ts`
  - `packages/protocol/apps/mod.ts`
  - `packages/protocol/secrets/secrets.ts`(앞머리 목록 주석 한 줄)
- 읽을 것:
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"(선언, 토큰, 네트워크)
  - architecture: `project-docs/architecture/app-call.md`("앱이 바깥으로 나가는 길", secret), `project-docs/architecture/activation.md`(넓어진 선언), `project-docs/architecture/agent-definition.md`(secret 저장소 이름 공간)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `app-spi`, `app-capability`, `project-docs/module-catalog.yaml`의 `packages/protocol`
  - 본보기: `packages/protocol/apps/secret-use.ts`(`defineMemory` route 꼴), `packages/protocol/lophn-agent/mcp-settings.ts`(`mcpAuthBegin`·`mcpAuthState`: 상태와 이유 enum), `packages/protocol/lophn-agent/issuer-requests.ts`의 `issuerUrlAllowed`(https 또는 loopback http)
  - 코드: `packages/protocol/apps/blueprint/{types,scope,value}.ts`(의존성 없는 손 사본. Zod를 쓰지 않는다), `packages/protocol/apps/permissions.ts`(Zod 사본 `permissionRequirementSchema`·`appGrantScopeSchema`가 `hostOf`를 `blueprint/scope.ts`에서 가져온다), `tools/deps-blueprint.ts`(`blueprint/` file이 지키는 의존 규칙)
- 계약:
  - 쓰는 것: 없다. 이 task가 고정한다.
  - 내놓는 것: 아래 "고정할 모양".

## 고정할 모양

선언(`secret.use`의 scope). 앱이 선언하는 모양이다.

```ts
// blueprint/types.ts (의존성 없는 type)
export type OAuthDeclaration = {
  authorization_endpoint: string;   // https, 또는 loopback http(localhost, 127.0.0.1, [::1])
  token_endpoint: string;           // 같은 규칙
  scopes: string[];                 // 정규화 때 정렬하고 중복을 없앤다
  params?: Record<string, string>;  // authorize URL에 더할 추가 parameter. 비면 칸을 두지 않는다
};
export type PermissionScope =
  | { path: string; recursive: boolean }
  | { host: string; port: number }
  | { name: string; oauth?: OAuthDeclaration };
```

`oauth` 검사 규칙(한 곳, `blueprint/scope.ts`에 순수 함수로 두고 Zod 사본이 `superRefine`으로 같은 함수를 부른다):
- 두 끝점: 2048자 이하, `new URL`로 읽히고, username·password·fragment가 없고, `https:`이거나 `http:`이면서 hostname이 `localhost`·`127.0.0.1`·`[::1]`.
- `scopes`: 0~32개, 항목은 1~200자이고 공백·제어 문자·`"`·`\`가 없다.
- `params`: 0~8개. key는 `^[A-Za-z0-9_.-]{1,64}$`, value는 1~256자에 제어 문자 없음. 예약 key는 거절한다: `response_type`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method`, `code_verifier`, `client_secret`, `grant_type`. 예약 key 목록은 `blueprint/types.ts`의 `OAUTH_RESERVED_PARAMS`로 내보낸다(core가 URL을 만들 때도 같은 목록으로 덮어쓰기를 막는다).
- 정규화(`permissionScope`가 돌려주는 값): `oauth`는 위 키 순서로, `scopes`는 정렬·중복 제거, `params`는 비면 뺀다. 순서만 바뀐 선언이 동의를 다시 묻지 않게 하려는 것이다. 같은 `name`의 `secret.use`가 둘 이상이면 `duplicate permission`으로 거절한다(`value.ts`. secret 이름 하나에 인증 방식 하나다. 상태가 이름마다 하나라서다).
- `oauth`가 있는 scope도 grant scope(`appGrantScopeSchema`의 `secret.use`)에 그대로 남는다. 그래서 `canonicalize(scope)`로 비교하는 activation의 선언 비교가 끝점·scope 변경을 "넓어진 선언"으로 본다(`activation.md`). 이 task는 비교 code를 고치지 않는다.

route와 상수(`packages/protocol/apps/oauth.ts`, `defineMemory`, actors는 `["user"]`):

```ts
export const APP_OAUTH_PREFIX = "app-oauth.";
// 이 이름들은 core 밖으로 나가지 않는다. access token은 선언한 이름 그대로 둔다.
export function appOAuthNames(name: string): {
  refresh: string;    // `app-oauth.<name>.refresh`
  meta: string;       // `app-oauth.<name>.meta`
  client: string;     // `app-oauth.<name>.client`     (client secret, 보호된 입력 창이 넣는다)
  client_id: string;  // `app-oauth.<name>.client_id`  (글로 넣는다)
};
export const APP_OAUTH_STATES = ["none", "in_progress", "signed_in", "failed"] as const;
// MCP의 McpAuthFailure와 같은 여섯 값이다. 화면이 같은 문구를 쓴다.
export const APP_OAUTH_FAILURES = [
  "callback_timeout", "state_mismatch", "exchange_failed",
  "refresh_rejected", "expired", "store_failed",
] as const;
// 값을 받을 수 없을 때 `apps.secret_value`가 앱 쪽으로 돌려주는 오류의 message. code는 `conflict`다.
export const APP_OAUTH_SIGN_IN_REQUIRED = "oauth sign-in required";

apps.oauth_client_set  // resource "apps", method "oauth_client_set"
  input  { app, name: secretName, client_id: string(1..200, 공백·제어 문자 없음) }
  output { stored: true }
  errors invalid_input | forbidden | not_found | unavailable   // forbidden/not_found: 현재 선언에 이 이름의 oauth 블록이 없다
apps.oauth_begin
  input  { app, name }
  output { url: string }             // 사람이 OS browser로 열 authorize URL
  errors invalid_input(client id 없음) | forbidden(선언 ∩ active grant 밖) | not_found | conflict(이미 진행 중) | unavailable
apps.oauth_cancel
  input  { app, name }
  output { cancelled: boolean }
  errors invalid_input | forbidden | unavailable
apps.oauth_state
  input  { app }
  output { secrets: { name, client_id: string | null, client_secret_set: boolean,
                      state: APP_OAUTH_STATES[number], reason: APP_OAUTH_FAILURES[number] | null }[] }
  // 현재 release 선언에서 oauth 블록이 있는 secret.use마다 한 줄. token·client secret 값은 없다.
  errors invalid_input | not_found | unavailable
```

`state`의 뜻은 MCP와 같다: `none`(로그인한 적 없거나 선언·client가 바뀌어 옛 token을 쓰지 않음), `in_progress`(사람이 browser에서 돌아오기를 기다림), `signed_in`(쓸 수 있는 token이 있음), `failed`(마지막 시도나 refresh가 실패, `reason`이 이유). `reason`은 `failed`일 때만 값이 있다.

plain secret(OAuth 없음)의 값 넣기는 새 route가 없다. 보호된 입력 창이 이미 있는 `secrets/put`으로 올리고 설정 여부는 `secrets/status`로 읽는다. client secret도 같은 길이다(`appOAuthNames(name).client`).

`netFetch` 요청(`broker.ts`의 `brokerNetFetchInputSchema`에 선택 칸 둘):

```ts
export const NET_FETCH_BODY_MAX_BYTES = 10 * 1024 * 1024;   // 본문 10 MiB(풀어 쓴 byte)
export const NET_FETCH_HEADERS_MAX = 32;
export const NET_FETCH_FORBIDDEN_HEADERS = ["authorization", "cookie", "host", "content-length", "proxy-authorization"];
  headers?: Record<string, string>   // key `^[A-Za-z0-9-]{1,64}$`, value 4096자 이하·CR/LF/NUL 없음, 최대 32개
  body?: string | { base64: string } // 글 또는 bytes. 풀어 쓴 크기가 NET_FETCH_BODY_MAX_BYTES 이하
```
- `headers` key를 소문자로 보아 `NET_FETCH_FORBIDDEN_HEADERS`에 들면 schema가 거절한다(`proxy-authorization`은 README의 네 이름과 같은 뜻이라 더했다). 인증은 core가 `useSecret`으로 붙인다.
- `GET`·`HEAD`(method는 대소문자 무관)에 `body`가 있으면 거절한다. 같은 schema를 운영 broker와 preview 대역(`packages/core/apps/preview/adapters/external.ts`)이 둘 다 쓰므로 한 곳에서 막힌다.
- 응답 schema와 한도(1 MiB)는 그대로다.

## 할 일

1. `blueprint/types.ts`: `OAuthDeclaration`, `OAUTH_RESERVED_PARAMS`, 위 `PermissionScope`. `blueprint/mod.ts`가 type을 내보낸다.
2. `blueprint/scope.ts`: `oauthScope(value)`(검사와 정규화, 실패면 `invalid(...)`)를 더하고 `permissionScope`의 `secret.use` 갈래가 `name`(필수)과 `oauth`(선택) 키를 받게 한다. `exactKeys`의 허용 키를 고친다. 의존성 import를 더하지 않는다(`tools/deps-blueprint.ts`).
3. `blueprint/value.ts`: 같은 `name`의 `secret.use` 중복을 거절한다.
4. `permissions.ts`: `secretScopeSchema`를 `z.strictObject({ name, oauth: oauthSchema.optional() })`로. `oauthSchema`는 strictObject이고 `superRefine`이 `oauthScope`를 부른다. 정규화는 하지 않는다(저장된 값은 이미 정규화돼 있다). `appGrantScopeSchema`와 `permissionRequirementSchema`가 그대로 이 schema를 쓰는지 확인한다.
5. `oauth.ts`(새 file): 위 상수·함수·route 넷. `registry.ts`의 `ROUTES`에 넷을 더하고 `mod.ts`가 `oauth.ts`를 내보낸다. `appId`는 `channel-values.ts`의 `appIdSchema`, 이름은 `../secrets/secrets.ts`의 `secretNameSchema`를 쓴다.
6. `broker.ts`: 위 상수와 `headers`·`body` 칸, 금지 header와 GET/HEAD 본문 거절을 schema(`superRefine`)에 둔다. 크기 계산은 순수 함수 한 개(`fetchBodyBytes(body)`)로 내보내 broker와 SDK 쪽이 같은 규칙을 보게 한다(SDK는 protocol을 import할 수 없어 값만 사본으로 둔다. 사본임을 주석에 쓴다).
7. `protocol/secrets/secrets.ts`의 앞머리 목록 주석에 `app-oauth.`와 그 뜻(앱 OAuth의 갱신 token·meta·client, 어디로도 보내지 않음)을 한 줄 더한다.
8. `validate_test.ts`가 새 규칙 때문에 깨지면 고친다. 새 test를 더하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(검사 규칙은 뒤 task의 위험 test가 지나간다).
- 남지 않음: 옛 `{ name }`만 받는 secret scope 가정이 이 task의 file에 없다. `grep -rn "scope.*name: z.string" packages/protocol/apps`로 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task의 route 넷은 core 쪽 등록(`packages/core/apps/register.ts` memoryRoutes와 wiring)이 `ao-oauth-wiring`에 있다. 그때까지 core는 이 route를 모르는 것이 정상이다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(type 변경으로 깨진 곳)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
