# ao-oauth-service

앱 OAuth service를 만든다: 선언한 secret마다 client 저장, sign-in 시작(background로 반환을 받아 교환), 상태, 취소, 값을 보내기 직전의 refresh. 그리고 `app-oauth.`·`provider-oauth.` 이름이 어디로도 보내지지 않게 `file-attach`를 막고, 동의 화면의 자원 이름에 OAuth 끝점과 scope를 싣는다. 조립(wiring)은 `ao-oauth-wiring`이 한다.

- 단위: ao-oauth (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/oauth/service.ts`(새 file)
  - `packages/core/apps/oauth/service_test.ts`(새 file)
  - `packages/core/apps/oauth/mod.ts`(새 file)
  - `packages/core/apps/permissions/secret-value.ts`
  - `packages/core/apps/permissions/secret-value_test.ts`
  - `packages/core/apps/permissions/declarations.ts`
  - `packages/core/apps/permissions/app-grants_test.ts`
  - `packages/core/secrets/file-attach.ts`
  - `packages/core/secrets/file-attach_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"의 선언, client, 화면(sign-in), token, "위험 test"
  - architecture: `project-docs/architecture/app-call.md`("앱이 바깥으로 나가는 길"의 secret), `project-docs/architecture/agent-definition.md`(secret 저장소 이름 공간, 발급자 호출 대기열), `project-docs/architecture/activation.md`(넓어진 선언), `project-docs/architecture/layers.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `secrets`, `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/secrets`
  - 계약: `packages/protocol/apps/oauth.ts`(`ao-contract`: route 넷, `appOAuthNames`, `APP_OAUTH_PREFIX`, `APP_OAUTH_SIGN_IN_REQUIRED`), `packages/protocol/apps/blueprint/types.ts`(`OAuthDeclaration`, `OAUTH_RESERVED_PARAMS`)
  - 코드:
    - `packages/core/lophn-agent/extensions/mcp-oauth.ts`·`mcp-oauth-vault.ts`·`mcp-auth.ts`(`ao-oauth-core`가 연 인자: `endpoints`, `clientSecret`, `params`, `binding`, `refreshRejected`, `refreshSkewMs`, `keepValidOnUnavailable`, vault `names`)
    - `packages/core/apps/permissions/secret-value.ts`·`secret-value_test.ts`(값 내보내는 handler와 test 본보기), `secret-allowance.ts`, `effective.ts`, `declarations.ts`(`resourceLabel`, `compareDeclarations`)
    - `packages/core/secrets/file-attach.ts`·`file-attach_test.ts`
    - `packages/core/lophn-agent/providers/oauth-refresh.ts`(refresh 실패 규칙의 본보기), `tests/support/fake-oauth/mod.ts`(`createFakeIssuerHandler`: `script({ refresh_token: [...] })`, `handle(Request)`, `journal()`. 토큰 끝점은 `${url}/token`)
    - `packages/base/clock.ts`(주입하는 시각)
- 계약:
  - 쓰는 것: `ao-contract`의 이름·route·상수, `ao-oauth-core`의 `createMcpOAuth`·`createMcpOAuthVault`.
  - 내놓는 것: `ao-oauth-wiring`이 아래 이름과 모양으로 부른다. 바꾸지 않는다.

```ts
// packages/core/apps/oauth/mod.ts
export type AppOAuthDeclared = {
  name: string;                 // secret 이름. access token은 이 이름에 둔다
  oauth: OAuthDeclaration;
  granted: boolean;             // 현재 선언 ∩ active grant에 이 scope(oauth 포함)가 들어 있다
};
export type AppOAuthDeps = {
  secrets: Pick<SecretStorePort, "get" | "put" | "delete">;
  fetch: HttpFetch;                                   // 발급자 호출 대기열의 fetch
  openListener(): Promise<Result<CallbackListener>>;  // openCallbackListener
  declared(app: string): Promise<Result<readonly AppOAuthDeclared[]>>;
  nowMs(): number;
  random?: RandomSource; waitMs?: number; deadline?: AuthDeadline;   // test용 주입
};
export type AppOAuth = {
  // "apps/oauth_client_set" | "apps/oauth_begin" | "apps/oauth_cancel" | "apps/oauth_state"
  handlers: ReadonlyMap<string, MemoryHandler>;
  // secretValueHandler의 prepare hook. OAuth 선언이 아닌 이름이면 undefined.
  prepare(input: { app: string; name: string }): Promise<Result<void> | undefined>;
  endAll(): Promise<void>;
};
export function createAppOAuth(deps: AppOAuthDeps): AppOAuth;
```

## 할 일

1. `file-attach.ts`: `purposeOf`가 앞머리로 용도를 정하기 전에 이름이 `APP_OAUTH_PREFIX`(`app-oauth.`, protocol에서 import)나 `provider-oauth.`로 시작하면 어떤 호출이든 `FORBIDDEN`으로 막는다. 지금은 두 앞머리가 "앞머리 없음 = 앱 secret"으로 떨어져 앱 호출이 allowance만 맞으면 보낼 수 있다(`provider-oauth.host-id`가 그렇다. 이 이름의 정의는 `lophn-agent/providers/oauth-secrets.ts`의 `HOST_ID_NAME`이고 secrets module은 harness를 import할 수 없으니 literal을 주석과 함께 둔다). 파일 머리 주석의 용도 설명을 맞춘다.
2. `secret-value.ts`: `secretValueHandler`의 deps에 `prepare?(input: { app: string; name: string }): Promise<Result<void> | undefined>`를 더하고, `attach.send` **앞**에서 `input.app`, `input.name`으로 부른다. `undefined`면 그대로 진행, 실패면 그 오류를 돌려주고 `attach.send`를 부르지 않는다. 오류 code는 service가 정한다(아래). 이유: refresh는 값을 보내는 바로 직전에 해야 하고(앞 줄에서 값을 60초 쥐므로) 이 handler가 그 자리다.
3. `declarations.ts`: `resourceLabel`이 `oauth`가 있는 `secret.use`에 대해 `secret.use:<name> oauth:<authorize host> → <token host> scopes:<scope들을 공백으로>`를 낸다(host는 `new URL(...).host`. loopback이면 port 포함). `oauth`가 없으면 지금 문자열 그대로다. 이 label이 동의 화면의 "늘어난 선언"에 그대로 보이므로 사람이 refresh token이 갈 token 끝점의 host를 본다. `app-grants_test.ts`가 label을 단언하면 비OAuth 쪽은 그대로 통과해야 한다.
4. `apps/oauth/service.ts`: `createAppOAuth`. `createMcpOAuthVault({ secrets, names: (key) => ({ access: key.name, refresh: appOAuthNames(key.name).refresh, meta: appOAuthNames(key.name).meta }) })`와 `createMcpOAuth({ vault, fetch, nowMs, random, waitMs, deadline, refreshSkewMs: 5 * 60_000, keepValidOnUnavailable: true })`를 쓴다. key는 `{ place: null, name }`이다(앱 secret 이름은 전역이다). 이름마다 `McpOAuthServer`를 만든다: `endpoints`는 선언의 두 끝점, `clientId`는 `secrets.get(client_id)`, `clientSecret`은 `secrets.get(client)`(없으면 null), `params`, `binding`은 `{ authorization_endpoint, token_endpoint, scopes: JSON, params: JSON, client_id }`, `refreshRejected = (status, body) => status === 400 || status === 401 || body?.error === "invalid_grant"`.
   - `oauth_client_set`: 선언에 이 이름의 oauth 블록이 있으면(grant는 아직 없어도 된다) `secrets.put(client_id 이름, 값)`. 없으면 `not_found`.
   - `oauth_begin`: `declared`에서 이름을 찾고(없으면 `not_found`) `granted`가 아니면 `forbidden`. client id가 없으면 `invalid_input`. `openListener` 뒤 `oauth.begin(server, { scopes, listener })`를 하고 **기다리지 않고** `oauth.complete(server)`를 background로 돌린다(결과는 `oauth.report`가 상태로 보인다. 던지거나 거절돼도 unhandled rejection이 없게 잡는다). 응답은 `{ url }`뿐이다. 이미 진행 중이면 `conflict`.
   - `oauth_cancel`, `oauth_state`: 계약 모양대로. `oauth_state`는 현재 선언의 oauth secret마다 `oauth.report(server)`와 `client_id`·`client_secret_set`(값을 읽어 비어 있지 않은지만)을 낸다. 값은 응답에 없다.
   - `prepare`: `declared(app)`에서 이름을 찾는다. 없거나 `granted`가 아니면 `undefined`(grant 판정은 `attach`가 이어서 한다). 있으면 client id가 있어야 하고(없으면 sign-in 필요) `oauth.access(server)`를 부른다. 오류 대응: 재인증 필요(`forbidden`, 지워졌거나 refresh가 거절됨, token이 없음) → `err({ code: "conflict", message: APP_OAUTH_SIGN_IN_REQUIRED })`; 발급자에 닿지 못했고 지금 token도 만료 → `unavailable`. 이름마다 한 번에 하나(single-flight)는 `createMcpOAuth.access`가 한다.
   - refresh가 거절되면 `createMcpOAuth`가 access·refresh·meta를 지우고 상태를 `failed`/`refresh_rejected`로 둔다. client id·client secret은 지우지 않는다.
5. `apps/oauth/mod.ts`가 위 계약을 내보낸다.
6. 위험 test 둘(아래 "끝남"). 새 test file은 `service_test.ts` 하나뿐이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 1 (`packages/core/secrets/file-attach_test.ts`): "`app-oauth.<이름>.refresh|meta|client|client_id`와 `provider-oauth.host-id`는 allowance가 무엇이든 허락해도, 앱을 대신하는 호출에도 아닌 호출에도 `transmit`이 불리지 않고 `forbidden`이다." allowance를 늘 `ok`로 하는 가짜로 `purposeOf` 쪽 막기만 증명한다. 기존 test의 행 표(`rows`)에 이 이름들을 더하는 정도로 쓴다.
- 위험 test 2 (`packages/core/apps/oauth/service_test.ts`): "refresh가 400·401·`invalid_grant`로 거절되면 access·refresh·meta가 지워지고 상태가 `failed`/`refresh_rejected`가 되며, `secretValueHandler`(prepare 연결)는 값을 주지 않고 `conflict`(`APP_OAUTH_SIGN_IN_REQUIRED`)를 낸다. 발급자에 닿지 못하거나(fetch가 throw) 5xx면 token이 만료 전일 때 값을 그대로 주고 token을 지우지 않으며, 이미 만료됐으면 `unavailable`이다." 가짜 발급자(`createFakeIssuerHandler`)를 `HttpFetch`로 감싸 쓰고(`(url, init) => issuer.handle(new Request(url, init))`), 시각은 주입한 `nowMs`(`packages/base/clock.ts`의 수동 시계), token은 메모리 secrets에 미리 넣는다. 서버·Worker·subprocess를 띄우지 않는다. `tests/support`를 `packages/core`에서 import하는 것을 `check-deps`가 막으면 그 file을 쓰지 말고 `(url, init) => Response`를 인라인으로 쓰고 보고에 적는다.
- 남지 않음: `grep -rn "provider-oauth" packages/core/secrets`는 `file-attach.ts`의 막는 줄과 그 test뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). `ao-oauth-wiring`이 service를 `packages/core/main/daemon/wiring/apps.ts`에 끼운다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(오류 code `conflict`, 상태 보관, binding 값)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 예상: 발급자 호출 대기열은 agent runtime child가 있어야 돈다(없으면 sign-in 교환과 refresh가 `unavailable`). 대기열 기한(8초)이 `apps.secret_value`를 부르는 supervisor의 control 기한보다 긴지도 확인해 적는다.
