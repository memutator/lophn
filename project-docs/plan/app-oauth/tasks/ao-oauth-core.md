# ao-oauth-core

MCP OAuth의 code(PKCE, loopback 반환, token 교환, refresh, vault)를 앱 OAuth도 쓸 수 있게 인자로 연다. MCP에 묶인 것(끝점을 issuer에서 만들기, 보관 이름, client secret을 늘 null로 보내기, 추가 authorize parameter 없음, 모든 4xx를 거절로 보기, 60초 skew)만 인자로 빼고 MCP 쪽 동작은 바뀌지 않는다.

- 단위: ao-oauth (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/mcp-auth.ts`
  - `packages/core/lophn-agent/extensions/mcp-oauth.ts`
  - `packages/core/lophn-agent/extensions/mcp-oauth-vault.ts`
  - `packages/core/lophn-agent/extensions/mcp-oauth-vault_test.ts`
  - `packages/core/lophn-agent/extensions/mcp-auth-control.ts`
  - `packages/core/lophn-agent/extensions/mod.ts`
- 읽을 것:
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"의 token, 화면(sign-in)
  - architecture: `project-docs/architecture/agent-definition.md`(secret 저장소 이름 공간, 구독 provider 로그인, 발급자 호출 대기열), `project-docs/architecture/layers.md`(feature module은 harness를 쓸 수 있고 harness는 feature module을 모른다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `secrets`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 코드(전부 읽는다): `mcp-auth.ts`(`createMcpAuth`, `authorizationUrl`, `exchangeToken`, `refreshToken`), `mcp-oauth.ts`(`createMcpOAuth`: begin·complete·cancel·report·access, `bound`, `ensureFresh`), `mcp-oauth-vault.ts`(`mcpTokenNames`, `createMcpOAuthVault`, `metaOf`), `mcp-auth-control.ts`(MCP가 이 code를 부르는 곳. `oauthServerOf`, `prepareToken`), `adapters/mcp-http.ts`(`endpointReason`, `httpRequest`: https 또는 loopback http만, redirect 거절)
  - 본보기: `packages/core/lophn-agent/providers/oauth-refresh.ts`(400·401·`invalid_grant`만 거절로 보고, 닿지 못함·5xx는 지금 token이 살아 있으면 그대로 쓴다)
- 계약:
  - 쓰는 것: 바뀌지 않는다. protocol(`McpAuthFailure` 등 `packages/protocol/lophn-agent/mcp-settings.ts`)을 고치지 않는다.
  - 내놓는 것: `ao-oauth-service`(wave 2)가 `createMcpOAuth`를 아래 인자로 부른다. 이름과 모양을 바꾸지 않는다.
    - `McpOAuthServer`에 선택 칸: `endpoints?: { authorization: string; token: string }`(주면 `${issuer}/authorize|token`을 만들지 않는다), `clientSecret?: string | null`(token 교환·refresh에 실린다. 기본 null), `params?: Record<string, string>`(authorize URL에 더할 parameter. 아래 "예약 key"는 덮지 못한다), `binding?: Record<string, string>`(token이 묶이는 조합. 없으면 지금처럼 `{ issuer, server_url, client_id }`), `refreshRejected?: (status: number, body: Record<string, unknown> | null) => boolean`(기본 `status >= 400`).
    - `createMcpOAuth` 옵션에 `refreshSkewMs?: number`(기본 60_000)과 `keepValidOnUnavailable?: boolean`(기본 false. true면 refresh가 `unavailable`이어도 지금 token이 아직 만료 전이면 `access`가 `ok`)를 더한다.
    - `createMcpOAuthVault({ secrets, names? })`: `names(key) => { access, refresh, meta }`(기본 `mcpTokenNames`). meta의 `binding`은 `Record<string, string>`이다.
    - 모두 `mod.ts`에서 내보낸다(`HttpFetch`, `CallbackListener`, `AuthDeadline`은 이미 나간다).

## 할 일

1. `mcp-auth.ts`
   - `authorizationUrl`·`exchangeToken`·`refreshToken`·`begin`이 끝점을 "https 또는 loopback http(`localhost`, `127.0.0.1`, `[::1]`)"로 받는다(`endpointReason`을 쓴다. 지금은 각자 `protocol !== "https:"`로 막는다). 이유: 앱 선언은 개발·test를 위해 loopback http 끝점을 받는다(provider OAuth와 같다). **MCP의 https-only는 `mcp-oauth.ts`의 `begin`이 발급자 끝점을 만들 때 지금 오류와 같은 오류로 막아 그대로 지킨다**(MCP 동작 불변).
   - `begin` 입력에 `clientSecret?`와 `params?`를 더하고 session이 쥐었다가 `complete`의 `exchangeToken`에 `clientSecret`을 싣는다(지금은 `clientSecret: null` 고정).
   - `authorizationUrl`: `params`를 먼저 `searchParams.set`하고 고정 parameter(`response_type`, `client_id`, `scope`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`)를 그 뒤에 set해 항상 이긴다. 예약 key(ao-contract의 `OAUTH_RESERVED_PARAMS`와 같은 목록. harness는 `protocol/apps`를 import할 수 없으니(`tools/check-deps.ts`의 `HARNESS_FEATURE_PROTOCOLS`) 값을 이 file에 주석과 함께 두고, 덮어쓰기는 "고정 parameter가 뒤에 set된다"로 막는다).
   - `refreshToken` 인자에 `rejected?: (status, body) => boolean`을 더한다. 기본은 지금 규칙(`status >= 400`이면 `forbidden`). 그 규칙이 아닌 응답에서 `status !== 200`이면 `unavailable`이다. 응답 본문을 JSON으로 읽을 수 있으면 `rejected`에 넘긴다(읽을 수 없으면 null).
2. `mcp-oauth-vault.ts`: `names` 옵션을 더하고(기본 `mcpTokenNames`), `McpGrantBinding`을 `Record<string, string>`로 넓힌다. `metaOf`는 `binding`의 모든 값이 문자열이면 받는다(지금 세 칸만 검사). MCP가 쓰는 binding은 그대로 `{ issuer, server_url, client_id }`다. `mcpOAuthSecretDestinations`가 `binding.server_url`을 읽는 곳을 맞춘다. `mcp-oauth-vault_test.ts`는 통과해야 하고 값만 맞춘다.
3. `mcp-oauth.ts`
   - `McpOAuthServer`와 `createMcpOAuth` 옵션에 위 "내놓는 것"을 더한다.
   - `begin`: `server.endpoints`가 있으면 그 끝점을, 없으면 지금처럼 `${issuer}/authorize|token`을 만든다(이때만 https-only). `clientSecret`, `params`를 `createMcpAuth.begin`에 넘긴다.
   - `bound(grant, server)`: `server.binding ?? { issuer, server_url: serverUrl, client_id }`와 `grant.binding`이 키·값 모두 같을 때만 true. complete가 vault에 쓰는 `binding`도 같은 값이다.
   - `ensureFresh`: `refreshSkewMs`를 `REFRESH_SKEW_MS` 대신 쓰고, `refreshToken`에 `clientSecret: server.clientSecret ?? null`과 `rejected: server.refreshRejected`를 넘긴다. 거절(`forbidden`)이면 지금처럼 `discard`(access·refresh·meta를 지움)하고 `failures`에 `refresh_rejected`를 둔다. 그 밖의 실패는 token을 건드리지 않고 `unavailable`이다. `keepValidOnUnavailable`이 true이고 `grant.expires_at_ms`가 아직 지나지 않았으면 그 `unavailable` 대신 `ok`를 돌려준다(일시 오류로 sign-in을 잃지 않게. provider refresh와 같은 규칙). 기본 false라 MCP는 지금처럼 `unavailable`이다. refresh token이 없는 grant도 같다: skew 안이어도 만료 전이면 `keepValidOnUnavailable`일 때는 지우지 않고 `ok`, 만료 뒤에야 지금처럼 `discard("expired")`한다.
4. `mcp-auth-control.ts`: 시그니처가 바뀐 곳만 맞춘다. MCP route 입력·출력·상태·이유는 바꾸지 않는다. `openCallbackListener`는 그대로 둔다(앱 wiring이 이 file에서 직접 import한다).
5. `mod.ts`: 새로 필요한 type export를 더한다.
6. MCP를 그대로 두었는지 확인한다: 기본값만으로 부른 경로(`oauthServerOf` → `begin`/`complete`/`report`/`access`)가 이전과 같은 URL, 같은 body, 같은 vault 이름, 같은 실패 이유를 낸다. MCP 쪽 test가 vault 하나뿐이라 코드 읽기로 대조하고 보고에 적는다. 새 test를 더하지 않는다(앱 쪽 refresh 규칙은 `ao-oauth-service`의 위험 test가 이 code를 지나간다).

## 끝남

- `deno task check`가 통과한다. `mcp-oauth-vault_test.ts`가 통과한다.
- 위험 test: 없음(refresh 거절·닿지 못함 규칙의 test는 이 code를 쓰는 `ao-oauth-service`에 있다).
- 남지 않음: `grep -n "clientSecret: null" packages/core/lophn-agent/extensions/mcp-auth.ts`가 0줄이다. `grep -n 'protocol !== "https:"' packages/core/lophn-agent/extensions/mcp-auth.ts`가 0줄이다(MCP의 https-only는 `mcp-oauth.ts`에 있다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 binding 일반화 모양, `keepValidOnUnavailable`)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(예: MCP 쪽 test가 vault뿐이라 불변은 코드 읽기로만 확인). 없으면 "없음"
