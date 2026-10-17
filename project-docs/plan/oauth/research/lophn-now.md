# provider OAuth: 지금 코드에 있는 것과 빠진 것

조사 기준: branch `feat/oauth`, HEAD `65ac9b312`. 코드는 읽기만 했다(core를 띄우지 않았고 provider를 부르지 않았다). 1~9절은 사실이고 의견은 10절에만 있다.

## 0. 한 줄 요약 (사실)

- 로그인 flow(`providers/oauth.ts`, `providers/login.ts`)와 화면의 sign in 단추는 있다. 그러나 daemon wiring이 `http`를 안 줘서 `BeginProviderLogin`은 항상 `unavailable`이다.
- 로그인이 끝나도 token을 받는 쪽이 없다. `login.ts`의 `completeCommand`가 `OAuthTokenBundle`을 버리고 `{completed:true}`만 돌려준다.
- `credential.kind === "oauth"`로 `ConnectProvider`를 부르는 곳이 없고, `secrets.json`에 provider OAuth token을 쓰는 곳이 없다.
- `models/resolve.ts`가 `kind !== "api_key"`를 `unavailable`로 거절한다. refresh 코드는 없다(`providers/refresh.ts` 222줄은 commit `bcb7a9c3d`에서 "쓰이지 않는 export"로 지워졌다).
- 화면은 `lophnShell.openConfirmation`을 찾는데 preload에 없고, `verified_for_lophn:false`라 단추가 `disabled`다.

## 1. 로그인 flow

### 1.1 파일과 줄 수

| path | 줄 | 내용 |
|---|---|---|
| `packages/core/lophn-agent/providers/oauth.ts` | 1030 | `createProviderOAuth(deps)` → `{begin, complete, cancel}`. PKCE, JWT 검증, device polling 전부 |
| `packages/core/lophn-agent/providers/login.ts` | 163 | `withProviderLogin(writer, deps)`: writer queue 앞 처리기. login command 셋만 가로챈다 |
| `packages/core/lophn-agent/providers/adapters/oauth-transport.ts` | 243 | `oauthHttp`(HTTPS만, `redirect:"manual"`, 본문 64KiB 상한), `xaiHostAllowed`, `openCallbackListener`(127.0.0.1 listener), `OAuthListener`/`OAuthCallback` type |
| `packages/core/lophn-agent/providers/definitions.json` | 97 | 내장 정의 7개. oauth가 있는 것은 openai(`product:"chatgpt"`), xai(`product:"supergrok"`) 둘 |
| `packages/protocol/lophn-agent/provider-values.ts` | 256 | `OAuthDefinition`, `OAUTH_FLOWS`, `ProviderCredential`, `OAUTH_REFRESH_LEAD_MS=60_000`, `USAGE_WAIT_DEFAULT_MS` |
| `packages/protocol/lophn-agent/provider-inputs.ts` | - | `loginBeginInputSchema`, `loginBeginOutputSchema`, `loginCompleteInputSchema`, `loginCompleteOutputSchema`, `loginCancelInputSchema` |

`OAUTH_PRODUCTS = ["chatgpt","supergrok"]`. `oauthShape`가 product로 flow를 강제한다(chatgpt는 `device_code_then_pkce_paste_url`, supergrok은 `device_code`). `provider-values.ts` 주석: "Claude OAuth는 두지 않는다". `credentials.ts` 주석도 "Claude OAuth 자리는 없다". anthropic 정의는 `auth_kinds:["api_key"]`, `oauth:null`.

### 1.2 순서: begin → (사람) → complete → token

```
renderer signIn()                    core (writer 앞 처리기, 메모리)              외부
 providers/login-begin ───────────▶ BeginProviderLogin
   {provider: pvd_*, definition}       gate 3개 → builtin 정의 → createProviderOAuth.begin
                                       chatgpt: listener 열기 → DCR register → authorize URL
                                       supergrok: discovery → device code 시작
 ◀── {login, flow, interval_ms, expires_at, sign_in:{url, user_code|null}}
 openExternal(sign_in.url) ── OS browser ──────────────────────────────▶ 사람이 로그인
 (chatgpt) 붙여넣기 창 openProtected() ─ 지금 열리지 않음
 providers/login-complete ────────▶ CompleteProviderLogin
   {provider, login, submission}       complete() → OAuthTokenBundle
 ◀── {completed:true}                  ★ bundle은 여기서 버려진다(login.ts completeCommand)
```

세션(`LoginSession`: state, nonce, verifier, device_code, listener)과 `issuedClientId`(DCR로 받은 client_id)는 `createProviderOAuth` 클로저의 `Map`/변수에만 있다. ledger·event·log·`secrets.json`에 안 간다. core가 재시작하면 사라진다. 만료된 chatgpt 세션을 치우는 코드는 없다(deadline은 device polling에서만 본다). `complete`/`cancel`이 안 불리면 listener가 열린 채 남는다.

### 1.3 provider별 구현된 단계

chatgpt (`beginChatGpt`, `completeChatGpt`):
1. `openCallbackListener()`로 127.0.0.1 임의 port listener를 연다.
2. `registerClient`: `POST https://auth.openai.com/api/accounts/oauth/register`, JSON `{client_name:"lophn", redirect_uris:["http://127.0.0.1:<port>/callback"], token_endpoint_auth_method:"none", grant_types:["authorization_code","refresh_token"]}`. 응답 `client_id`를 `issuedClientId`에 캐시(메모리만). 400/404면 `unavailable "client registration is not enabled"`.
3. state, nonce, PKCE verifier(32 byte base64url), S256 challenge. authorize URL은 상수 `SIWC_AUTHORIZE`(`https://auth.openai.com/api/accounts/authorize`)에 `response_type=code, client_id, redirect_uri, scope(정의의 scopes 공백 join), state, nonce, code_challenge, code_challenge_method=S256, resource(=definition.issuer)`를 붙인다. 정의의 `authorization_endpoint`는 이 경로에서 읽지 않는다.
4. `complete`: `submission`이 비어 있지 않으면 `parsePastedSubmission`(URL의 `code`/`state` query, `code#state`), 비어 있으면 `listener.receive()`를 기다린다. state 비교 → `tokenExchange`: `POST definition.token_endpoint`, form(`grant_type=authorization_code, client_id, code, redirect_uri, state, nonce, code_verifier, resource`) → `identityOf`: id_token 필수, RS256, `exp`, `iss==="https://auth.openai.com"`, `aud`에 client_id, `nonce`, JWKS(`https://auth.openai.com/.well-known/jwks.json`, 60초 캐시)로 서명 검증 → `sub`.
5. 반환 `OAuthTokenBundle {access_token, refresh_token|null, expires_in, issued_client_id, resource, subject, earliest_refresh_at}`. `expires_in` 없으면 3600. `earliest_refresh_at`은 응답 값이거나 `now + expires_in - 60s`.
- 코드가 가정하는 것(맞는지는 판단하지 않는다): OpenAI auth가 DCR(`/oauth/register`)을 열어 둔다, public client(auth method none)에 loopback redirect를 허용한다, token 응답에 `id_token`이 있다, `resource`와 `nonce`, `state`를 token 요청에 받는다, 정의 `flow` 이름은 `device_code_then_pkce_paste_url`이지만 chatgpt 구현에 device code 단계는 없다(PKCE + listener/paste만).

supergrok (`beginDevice`, `completeDevice`):
1. `GET https://auth.x.ai/.well-known/openid-configuration`(상수 `XAI_DISCOVERY`). `authorization_endpoint`, `token_endpoint`, `device_authorization_endpoint`가 모두 `xaiHostAllowed`(https, `x.ai` 또는 `*.x.ai`)여야 한다.
2. `POST device_authorization_endpoint` form(`client_id=definition.issuer`, scope = `XAI_SCOPES` 상수). 코드는 client_id로 issuer 문자열(`https://auth.x.ai`)을 그대로 쓴다. `user-agent: lophn/cli`. 응답 `device_code`, `user_code`, `verification_uri|verification_url`, `expires_in`, `interval`.
3. discovery 값이 정의와 같은지 검사(`tokenEndpoint===definition.token_endpoint`, `deviceEndpoint===definition.authorization_endpoint`).
4. `complete`는 한 번의 호출 안에서 `urn:ietf:params:oauth:grant-type:device_code`로 token endpoint를 poll한다(기본 5초, `slow_down`마다 +5초, 최대 5분, `deps.wait`로 대기 주입). id_token 검증은 없다(`subject:null`, `issued_client_id:null`, `earliest_refresh_at:null`).
- 가정: `client_id`가 issuer URL 문자열이다.
- UI의 `signIn`은 device flow일 때 `login-begin` 뒤 `openExternal`만 하고 `login-complete`를 부르지 않는다(`core-source.ts` 약 330줄: `flow !== "device_code_then_pkce_paste_url"`이면 `{ok:true}`로 끝). 따라서 supergrok의 poll을 시작하는 호출자는 없다.

### 1.4 gate 셋의 정확한 위치

| # | gate | 위치 | 지금 값 |
|---|---|---|---|
| 1 | daemon wiring에 `http` 없음 | `packages/core/main/daemon/wiring/lophn-agent.ts` 마지막 줄 `lophnAgentProviderLoginWiring`: `withProviderLogin(inner)`(deps 없음). `login.ts`는 `deps.http`를 `createProviderOAuth`에 그대로 넘기고, `oauth.ts`의 `gate()`가 `deps.http === undefined || !deps.liveGate()`면 `unavailable "OAuth login is not enabled in this build yet"` | 항상 닫힘 |
| 2 | `LOPHN_LIVE_PROVIDER=1` | `login.ts`의 `PROVIDER_LOGIN_LIVE_ENV`, `liveGateOf(env = Deno.env.get(...))`. `deps.liveGate`로 주입 가능 | 값이 1일 때만 열림. 단 packaged core의 `--allow-env`(`packages/shell/main/desktop/core/supervise.ts`)에 이 이름이 없다(gate 1이 먼저 걸려 지금은 안 읽힌다). `tools/dev.ts`는 이 값이 1이면 fake provider를 안 띄운다 |
| 3 | `verified_for_lophn` | `definitions.json`(openai, xai 둘 다 `false`), `oauth.ts`의 `validDefinition`이 `!== true`면 `unavailable`. 화면도 읽는다(`connect-dialog.tsx` `MethodButton`의 `blocked`, `core-source.ts`의 `signIn.verified`) | 둘 다 `false` |

`complete`는 추가로 `deps.currentDefinition`(세션 뒤 정의 변경 검사용 read port)이 필요하다. `withProviderLogin`이 이것을 `createProviderOAuth`에 넘기지 않아, gate를 모두 열어도 `complete`는 `"definition read port is missing"`으로 `unavailable`이다.

또 `oauth.ts`의 모든 외부 URL 중 `definition.token_endpoint`만 정의에서 오고 나머지(authorize, register, discovery, JWKS)는 상수라서, `tools/fake-provider/oauth.ts`(경로 `/oauth/*`, http)로는 이 코드를 돌릴 수 없다(`oauthHttp`는 https만 받는다). 테스트하려면 `deps.http`로 URL을 바꿔 쳐야 한다.

## 2. command와 route

`packages/protocol/lophn-agent/providers.ts`(181줄)가 정의, `packages/core/lophn-agent/providers/commands.ts`(382줄)가 handler.

| 이름 (route) | kind | actor | input | output | 비고 |
|---|---|---|---|---|---|
| `ConnectProvider` (`providers/connect`) | command | user | `{id:pvd_*, name, definition, endpoint, protocol, auth_kind, credential:{secret}|null}` | `{provider: ProviderRecord}` | `PROVIDER_ROUTES`에는 없고 `registry.ts`에서 따로 등록. `credential.secret`은 정확히 `provider.<id의 pvd_ 뒤>`만 받는다. `kind`가 `oauth`여도 같은 길(handler가 kind별로 가르지 않음) |
| `DisconnectProvider` (`providers/disconnect`) | command | user | `{provider}` + `compare:{revision}` | `{provider}` | `confirmation:"required"`, `confirmation_kind:"secret_input"`, binding `["provider"]`. 결정 handle 필요(shell main `decision-handle/provider-disconnect.ts`) |
| `RefreshProviderCredential` (`provider-credentials/refresh-result`) | command | machine | `{provider, expires_at|null, unavailable_reason: authentication|refresh_revoked|null}` (둘 중 하나만) + `compare:{revision}` | `{provider}` | handler 있음. 호출자 0(grep `packages tests tools`). `RUNTIME_MACHINE_ROUTES`(`run-loop/runtime-access.ts`)에도 없다 |
| `RecordProviderAvailability` (`provider-credentials/record-availability`) | command | machine | `{provider, state, unavailable_reason, until, model_block}` + `compare` | `{provider}` | handler 있음. 호출자 0. `runtime-access.ts` 목록에도 없다. 그래서 401/429 판정(`failures.ts`)은 `ModelCall` 결과에만 남고 credential 상태는 안 바뀐다 |
| `BeginProviderLogin` (`providers/login-begin`) | command | user | `{provider:pvd_*, definition:<내장 정의 key>}` | `{login, flow, interval_ms, expires_at, sign_in?:{url, user_code|null}}` | provider가 아직 없는 상태에서 시작한다 |
| `CompleteProviderLogin` (`providers/login-complete`) | command | user | `{provider, login, submission}` (`submission`은 `nonblankSchema`) | `{completed:true}` | `confirmation:"required"`, `confirmation_kind:"secret_input"`, binding `["provider","login","submission"]` |
| `CancelProviderLogin` (`providers/login-cancel`) | command | user | `{provider, login}` | `{cancelled:boolean}` | |
| `ReadProvider`, `ListProviders` (`providers/read`, `providers/list`) | read | user, agent, machine, coding_agent | `{provider}` / `{cursor?}` | `ProviderRecord` (+ read common) | credential 값은 없고 `secret_ref.name`만 있다 |
| `ListProviderDefinitions` (`providers/definitions`) | read | 위와 같음 | `{}` | `{definitions}` | `definitions.json`을 module import로 읽음 |

login 셋의 처리기 구조:
- `commands.ts`의 `beginLogin/completeLogin/cancelLogin`은 route만 열고 `handle()`이 `unavailable "provider login runs outside the ledger writer"`를 돌려준다(registry 자리 채우기).
- 실제 처리는 `withProviderLogin(writer)`가 `envelope.command` 이름이 `BeginProviderLogin`/`CompleteProviderLogin`/`CancelProviderLogin`이면 `writer.command`로 안 넘기고 가로챈다. 결과를 `CommandSuccess{result, replayed:false, first_seq:null, last_seq:null, wake:false}`로 포장. 즉 ledger transaction, idempotency, event를 안 탄다.
- 조립: `assembly.ts` 113줄 `lophnAgentProviderLoginWiring`. 같은 module의 `lophnAgentWiring`이 `withAppEngineer`로 따로 writer를 감싼다(wiring이 둘인 이유: 접는 순서).
- HTTP `command` dispatch(`packages/core/server/dispatch.ts`)는 `commandRequestSchema(route)`로 입력을 검사한다. `CompleteProviderLogin`은 `confirmation:"required"`라서 요청 body에 `confirmation` ref가 없으면 schema에서 `invalid_input`이다. 가로채기가 executor 앞이라 handle을 소비(consume)하는 검사는 안 일어난다(`executor.ts`의 `reserveConfirmation`을 안 지나므로).
- shell main이 handle을 발급하는 결정은 둘뿐이다: `issue.ts`의 `readCanonical`이 `problem decision`, `provider_disconnect`만 알고 나머지는 `forbidden "handle을 받을 수 없는 결정이다"`. login-complete용 reader는 없다.
- 입력 문제: `loginCompleteInputSchema.submission`은 nonblank인데 `completeChatGpt`는 빈 `submission`이면 listener를 기다린다. 지금 schema로는 빈 값을 보낼 수 없어 listener 경로는 도달 불가다.

## 3. credential 모델

### 3.1 `ProviderCredential` (`provider-values.ts`)

필드: `kind` (`api_key|oauth|none`), `secret_ref:{name}|null`, `revision`(양의 정수), `state` (`available|rejected|usage_wait|revoked`), `unavailable_reason` (`authentication|quota|plan_access|refresh_revoked`|null), `until`, `expires_at`, `logged_in_at`, `refreshed_at`, `model_blocks[]` (`{model_name, reason: not_found|retired|account_model_access, until}`).

`credentialShape` 불변식: `kind==="none"` ⇔ `secret_ref===null`; `state==="available"` ⇔ `unavailable_reason===null`; `state==="usage_wait"` ⇔ `until!==null`; model_blocks 이름 유일. `ProviderRecord` = `{id, name, definition, endpoint, protocol, credential(하나), revision}`. provider당 credential 하나.

### 3.2 상태 기계

- `connect`가 `state:"available"`, `revision:1`, `logged_in_at: tx.now()`, `expires_at:null`, `refreshed_at:null`로 만든다.
- `refreshCredential`: `expires_at!==null`이면 `available`로 되돌리고 `expires_at`, `refreshed_at=now`, revision+1. `expires_at===null`이면 `unavailable_reason`을 요구하고 `refresh_revoked`→`revoked`, `authentication`→`rejected`.
- `recordAvailability` → `nextCredentialState`: `revoked`에서 다른 상태로 가는 것은 `conflict`(Disconnect 뒤 Connect로만 벗어남). `rejected`↔`usage_wait`↔`available`은 자유.
- 사용 판정 `credentials.ts` `credentialUsable(credential, {modelName, nowMs})`: revoked/rejected 불가, `usage_wait`는 `until` 이후 가능, model_block도 `until`로 푼다.
- `failures.ts`(602줄)는 HTTP/stream 실패를 `FailureVerdict`로 분류(401/403→`credential_unavailable authentication`, 402/429 reset 길면→quota 등)하지만, 이를 credential 상태로 쓰는 코드는 없다(`recordProviderAvailability` 호출자 0).

### 3.3 ledger 표 (`providers/schema.ts`, schema step `lophn-agent.harness-provider.tables`)

- `providers(id pk, name, definition_key, definition json, endpoint, protocol, revision)`. `id` 변경 trigger 금지.
- `provider_credentials(provider pk, kind, secret_name, revision, state, unavailable_reason, until, expires_at, logged_in_at, refreshed_at)`. check: `(kind in (api_key,oauth)) = (secret_name is not null)`. `provider`, `kind` 변경 trigger 금지(그래서 api_key→oauth 전환은 Disconnect 뒤 Connect).
- `provider_credential_model_blocks(provider, model_name, reason, until)`.
- `secret_name`은 정확히 한 이름이다. 값은 어느 열에도 없다.

### 3.4 `secret_ref`가 가리키는 것

`secret_ref.name` = `provider.<id의 pvd_ 뒤>`(`commands.ts` `secretNameForProvider`). `secrets.json`의 key다. OAuth를 위한 추가 이름(refresh, meta)을 둘 자리는 표에도 schema에도 없다.

## 4. secret 저장

### 4.1 `secrets.json`

- 위치 `<data root>/secrets.json`, 0600, 평평한 JSON object `{ "<이름>": "<문자열 값>" }`(`packages/core/secrets/file-store.ts` 248줄 주석). 쓰기는 임시 파일 → fsync → rename. 읽을 수 없으면 secret 기능만 `unavailable`. env/다른 파일 fallback 없음.
- 이름 schema `secretNameSchema = /^[A-Za-z0-9_.:-]+$/`(`protocol/secrets/secrets.ts`). 값 상한 `SECRET_INPUT_MAX_BYTES = 64 KiB`.
- 이름 공간(앞머리), `core/secrets/file-attach.ts` `purposeOf`:

| 앞머리 | 용도 | 쓰는 쪽 | 보낼 수 있는 목적지 (`lophn-agent/secret-destinations.ts`) |
|---|---|---|---|
| `provider.` | `provider_credential` | 사람 → 보호 입력 창 → `secrets/put` | `provider_credentials.secret_name = <이름>`이고 `state != 'revoked'`인 provider의 endpoint origin 하나(`providers/secret-refs.ts` `providerSecretDestinations`). 정확히 일치 비교 |
| `mcp.` | `external_mcp_credential` | 사람 → 보호 입력 창 | 그 이름을 header/bearer/api_key로 보내는 켜진 http MCP 서버 URL origin |
| `mcp-oauth.<scope>.<server>.access|.refresh|.meta` | `external_mcp_credential` | core의 `McpOAuthVault`가 `ctx.secretStore`로 직접 | `.access`만, meta의 `binding.server_url` origin. `.refresh`, `.meta`는 목적지 빈 목록(core 밖으로 안 나감) |
| 그 밖 | - | - | 보내지 않음(`forbidden`) |

### 4.2 route와 store 경계

- `secrets/status`(memory; user는 전부, 그 밖은 이름 지정 시 `forbidden`), `secrets/delete`(memory; user), `secrets/put`(upload; user만. shell main이 `core.upload("secrets","put",...)`로 보낸다). `packages/core/secrets/routes.ts`.
- core 안에서는 `SecretStorePort {put,get,delete}`(`protocol/secrets/secret-file.ts`, 구현 `core/secrets/secret-store.ts` `openSecretStore`)를 쓴다. `secretsWiring`이 `ctx.provide("secretStore", store)`, `ctx.provide("knownSecrets", store.known)`, `ctx.provide("secretAttach", ...)`로 낸다. `put`은 파일에 쓰기 전에 값을 "알려진 값"(redaction 입력, reader pool 통로)으로 먼저 올린다.
- 누가 읽나: (a) agent runtime의 `secret_send_request` 응답 하나(4.3), (b) core 안에서 `store.get`(MCP vault, 현재 provider는 없음).

### 4.3 runtime으로 건너가는 길

```
agent-runtime(child)                         감독 pipe                         core
 models/resolve.ts createAuthTransport
  attach.send({use:{name,destination}, operation:"model.call", body:{url,method}}, transmit)
 → main/agent-runtime/secret-link.ts createSecretLink.attach
      ChildMessage secret_send_request {request_id, use, operation, url, method} ─▶ runtime-secret.ts createAgentRuntimeSecrets.answer
                                                                                     alive()? → mcpOAuth hook(mcp-oauth. 이름만) →
                                                                                     secretAttach.send(machine context) =
                                                                                       admit → process 생존 → purposeOf → allowance
                                                                                       → destinations.allowed(name) 대조 → file.get(name)
                                                                                     value가 knownSecrets에 "전체 일치"로 등록돼 있어야 함
      ◀── ParentMessage secret_send_response {ok:true, value} (또는 error 코드)
 transmit(value) → headers[headerName] = (bearer? "Bearer "+value : value) → fetch
```

- 값은 JSON payload 한 번(`secret_send_response.value`)으로만 건너가고 child의 `transmit` callback 인자로만 쓰인다. 결과·오류·log·ModelCall blob에는 없다.
- `createAgentRuntimeSecrets`의 `mcpOAuth` 인자(`ctx.mcpAuthControl.prepareToken`)가 "보내기 직전 서버 설정 대조 + 만료 임박 시 core가 갱신"을 하는 hook이다. provider 이름에는 이런 hook이 없다.
- `provider.` 값이 child에 닿으려면 `knownSecrets` 등록(= `secretStore.put` 경유)이어야 한다. 파일을 직접 고치면 `sync()` 전까지 거절.

## 5. model 호출

### 5.1 credential이 adapter에 닿는 길

`product-driver.ts`(274줄, 89~100줄) `createModelResolver({machine, attach: calls.secrets, catalog, fetch?})` → `models/resolve.ts`(236줄) `resolveModel`:
1. `providerRead`(machine 자격 read)로 `ProviderRecord`를 읽는다. 없으면 `unavailable "the provider is not connected"`.
2. `credentialUsable(...)` 아니면 `unavailable "no usable credential"`.
3. `credential.kind !== "none"`일 때(resolve.ts 약 100~118줄): `credential.kind !== "api_key" || secret_ref===null || attach===undefined || destination===undefined`면 `unavailable "this credential cannot be sent from the runtime yet"`. 즉 OAuth는 여기서 막힌다. 통과하면 `createAuthTransport({attach, transport: fetching, context: {} as never, use:{name: secret_ref.name, destination: secretDestinationOf(provider.endpoint)}, operation:"model.call", headerName, kind})`.
4. header 선택은 `provider.protocol`만 본다: `anthropic-messages` → `x-api-key`(kind `api_key`, 값 그대로), 그 밖(`openai-responses`, `openai-chat-completions`) → `authorization`(kind `bearer`, `Bearer <값>`). `credential.kind`나 `auth_kinds`는 보지 않는다. Anthropic 쪽 고정 header는 `invoke.ts`의 `anthropic-version: 2023-06-01`뿐이다.
5. `invoke.ts`(413줄) `createInvokeModelCall`: `url = joinEndpoint(input.endpoint, PATHS[protocol])`(`/messages`, `/responses`, `/chat/completions`), 본문은 `{...body, stream:true}`, 한 번 호출(SDK retry 없음), 재시도는 run-loop.
6. `billing_route`: `credential.kind === "api_key" ? "api" : "unknown"`(resolve.ts 213줄). protocol의 `BILLING_ROUTES`는 `api|subscription|extra_usage|unknown`을 이미 갖고 있다.
7. `available()`(turn 중 재확인)은 `kind`, `secret_ref.name`, `logged_in_at`이 같은지 본다. revision은 비교하지 않는다.

### 5.2 `oauth-transport.ts`는 model 호출과 무관하다

`providers/adapters/oauth-transport.ts`는 로그인 HTTP(`oauthHttp`), xAI host 검사, loopback listener다. model 호출의 인증 header 부착은 `adapters/auth-transport.ts`(104줄) `createAuthTransport`가 하며 callback 안에서만 `headers[headerName] = kindValue(...)`를 한다. `transport.ts`(129줄)가 `createFetchTransport`(`redirect:"manual"`, 성공 SSE만 stream)와 `withRequestHeaders`.

### 5.3 base URL

`provider.endpoint`가 정한다. 값은 `ConnectProvider` 입력이고 화면 `core-source.ts`의 `routeOf`가 `models_endpoint`에서 `/models`를 뗀 값을 쓴다. openai 정의: `https://api.openai.com/v1`, protocol은 `protocols[0]`=`openai-responses`. xai: `https://api.x.ai/v1`, `openai-chat-completions`. `definition.oauth.allowed_call_origins`(`["https://api.openai.com"]`, `["https://api.x.ai"]`)는 스키마 검사만 하고 읽는 코드가 없다(grep 0). 목적지 검사는 `secret_name`이 가리키는 provider의 `endpoint` origin이다.

### 5.4 runtime의 network

agent runtime child는 `net_any:true`(`tools/runtime-permissions.ts`, `--allow-net` 전체)라 auth host에도 나갈 수 있다. core는 packaged에서 `--allow-net=127.0.0.1,[::1]`뿐이고(`supervise.ts`), "core module graph에는 외부 fetch를 두지 않는다"가 이 repo의 규칙이다(`change-log/0.2.0.md` 435줄의 결정, `mcp-auth-requests.ts` 주석). 개발은 `--allow-all`이다. 그래서 provider 로그인의 `http`를 core에서 직접 주는 길은 이 규칙과 부딪친다(MCP는 6절의 대기열을 쓴다).

## 6. 화면

- 위치: `packages/shell/renderer/desktop/lophn-space/settings/providers/` — `connect-dialog.tsx`(343줄), `provider-list.tsx`(277), `core-source.ts`(444), `settings-source.ts`(74), `provider-name.tsx`(18). `../core-call.ts`(156).
- 흐름(`core-source.ts` `connect(definition, way)`): `way==="oauth"`면 `signIn(definition)`.
  1. `routeOf`가 endpoint/protocol을 못 만들면 `UNAVAILABLE`.
  2. `login-begin` command `{provider: idFor(def.key), definition: def.key}`.
  3. `sign_in.url`이 있고 `openLink`(preload `lophnShell.openExternal` → `shell/main/desktop/open-external.ts` `createOpenExternal`: desktop 창만, http/https, userinfo 없음, 8192자 이하, 기록에는 origin/path만)가 있으면 OS browser로 연다. 못 열면 `login-cancel` 뒤 `UNAVAILABLE`.
  4. `flow !== "device_code_then_pkce_paste_url"`(supergrok)이면 여기서 끝낸다(`{ok:true}`): `login-complete`도 `connect`도 안 부른다.
  5. chatgpt는 `openProtected(openWindow, intent)`로 붙여넣기 창을 연다. intent는 `{kind:"secret_input", owner: <pvd id>, purpose:"provider_credential", connect:{name, definition, endpoint, protocol, kind:"oauth", login}}`.
- 왜 지금 창이 안 열리나: `openWindow`의 기본값 `windowSecretOpener()`(`core-call.ts` 66~73줄)가 `globalThis.lophnShell.openConfirmation`을 찾는데, preload `packages/shell/preload/shell.ts`는 `openSecretInput`, `requestDecisionHandle`, `openExternal` 등만 내고 `openConfirmation`은 어디에도 없다(grep 전체에서 `core-call.ts` 한 곳뿐). 그래서 `openProtected`가 `{ok:false, code:"unavailable"}`.
- 붙여넣기 창 자체가 없다: 보호 입력 창(`shell/main/secret-input/window.ts` 241줄, `submit.ts`, renderer `secret-input/secret-input.tsx` 106줄)은 `secretInputOpenSchema {name, purpose: app|provider|mcp, subject}`를 받아 값을 `secrets/put`으로 `name`에 올리는 것만 한다. OAuth submission을 `login-complete`에 싣는 창, 결정 handle과 묶는 창은 없다. 창에서 `SecretIntent.connect`를 읽는 main 쪽 코드도 없다.
- 단추는 아예 못 누른다: `MethodButton`의 `blocked = way==="oauth" && definition.signIn?.verified !== true`이고 `verified`는 `verified_for_lophn`이다. 둘 다 `false`라 `disabled`, hint는 `settings.notice.method-unverified`.
- `provider-list.tsx`는 `way==="oauth"`를 "Signed in"으로, `state`/`reason`을 `usage-limit`, `plan-access`, `sign-in-problem` 문구로 보인다.
- 끊기: `disconnect`는 결정 handle(`provider_disconnect`)을 받아 `DisconnectProvider`에 싣고, 끝나면 `secrets/delete {name:"provider.<id>"}`를 best-effort로 부른다(OAuth의 refresh/meta 이름은 지우지 않는다. 지금 그런 이름이 없다).
- API key 연결은 같은 파일 `connectWithKey`: `windowSecretInputOpener()`(`openSecretInput`, 있음) → `stored` → `providers/connect {credential:{secret}}`, 실패(conflict 제외)면 `secrets/delete`.

## 7. 지금 있는 test 중 OAuth와 닿는 것

provider 로그인(`oauth.ts`, `login.ts`)을 직접 보는 test는 없다. `oauth_test.ts`, `refresh_test.ts` 등은 commit `13a7365e9`("Delete all tests and the e2e suite")에서 지워졌다. `refresh.ts`는 `bcb7a9c3d`에서 지워졌다.

| path | 무엇을 보나 (OAuth와의 관계) |
|---|---|
| `packages/core/lophn-agent/extensions/mcp-oauth-vault_test.ts` (99줄, 1 test) | MCP OAuth token 세 이름이 각자 알려진 값이 되고, 갱신 거절 시 세 이름이 지워진다. MCP 전용 |
| `packages/protocol/lophn-agent/mcp-settings_test.ts` (1 test) | MCP 설정 schema가 `mcp.` 밖 secret 이름과 stdio env의 secret을 거절. oauth2 client의 `provider.` 이름 거절 사례 포함 |
| `packages/core/lophn-agent/providers/secret-refs_test.ts` (205줄, 2 tests) | attach가 허락한 provider endpoint origin이 아닌 목적지에 값을 붙이지 않음; secret 값은 자기 이름 공간 목적지로만 감(`provider.`, `mcp.`, `mcp-oauth.`) |
| `packages/core/lophn-agent/providers/commands_test.ts` (53줄, 1 test) | `Connect`가 `provider.<id>` 아닌 secret 이름을 거절하고 row를 안 남김 |
| `packages/core/secrets/file-store_test.ts` (175줄, 2 tests) | secrets.json 0600, 쓰기 실패 시 이전 값 유지, 값이 오류/log/status에 안 나감 |
| `tests/e2e/secret_test.ts` (1 test) | E2E: API key가 model 요청 header(`x-api-key`)에만 실리고 `secrets.json` 밖 어디에도 안 남음. `tests/support/core/human.ts` `connectFakeProvider`가 `oauth:null` 정의로 `secrets/put` → `providers/connect` |
| `tests/live/{anthropic,openai}_test.ts`, `suite.ts` | live suite(API key만, env에서 읽음). OAuth 없음 |

test fake:
- `tests/support/fake-server/` : `anthropic-messages` 한 protocol(`/messages`)만 말하는 fake. OAuth 없음.
- `tools/fake-provider/oauth.ts` (214줄, 곧 지워질 예정): class `OAuth`가 `tools/fake-provider/server.ts`(`options.oauth`)에 꽂혀 있다. 경로: `GET /.well-known/openid-configuration`, `POST /oauth/register`(201 + `client-N`), `GET /oauth/authorize`(302로 `redirect?code=synthetic-auth-code&state=`), `POST /oauth/device`(`device_code`, `user_code`, `interval:0`), `POST /oauth/token`(grant `authorization_code`: `state`로 challenge 찾아 PKCE 검증 후 access/refresh 발급, `refresh_token`: `refresh-`로 시작하는 token 받아 새 access(옵션 `rotateRefresh`면 새 refresh), device code poll(`devicePolls`: `authorization_pending`/`slow_down`, `deviceExpiresAtMs`)). 호출자는 `server.ts`뿐이고 `id_token`/JWKS 없음. `providers/oauth.ts`의 상수 https URL과 맞지 않아 이 fake로 `createProviderOAuth`를 돌린 test는 현재 없다.

## 8. MCP OAuth와의 비교

MCP OAuth는 이미 끝까지 돈다(begin → browser → complete → vault 저장 → 연결 때 만료 임박 갱신 → 저장). 구성:

| 조각 | path | provider OAuth와 비교 |
|---|---|---|
| 업무 규칙 | `core/lophn-agent/extensions/mcp-oauth.ts`(270) `createMcpOAuth`: `begin`, `complete`, `cancel`, `report`, `access`(= ensureFresh), `endAll` | provider는 `oauth.ts`의 `createProviderOAuth` 안에 로그인만 있고 `access`/refresh에 해당하는 것이 없다 |
| PKCE/로그인 세션 | `extensions/mcp-auth.ts`(611) `createMcpAuth`, `pkceVerifier`, `refreshToken(...)`(`grant_type=refresh_token`, 거절 4xx → `forbidden`) | `oauth.ts`에 PKCE는 따로 한 벌 더 있다(`pkceChallengeS256`, `base64url` 중복). refresh 요청 코드는 provider 쪽에 없고 `mcp-auth.ts`의 `refreshToken`이 `tokenEndpoint, refreshToken, clientId, clientSecret`을 받는 일반 형태다 |
| listener | `extensions/mcp-auth-control.ts` `openMcpCallbackListener`(127.0.0.1, port 0, 요청 하나) / `adapters/oauth-transport.ts` `openCallbackListener`(provider용) | 같은 일을 하는 구현이 둘이다. type도 `CallbackListener` vs `OAuthListener` |
| 보관 | `extensions/mcp-oauth-vault.ts`(213) `createMcpOAuthVault`: `<base>.access`, `.refresh`, `.meta`(JSON: `expires_at_ms`, `token_endpoint`, `binding{issuer, server_url, client_id}`) 세 이름, 서버별 직렬화, binding이 설정과 다르면 token을 안 씀. `McpVaultSecrets = {get,put,delete}` | provider는 `secret_name` 한 열과 `provider.<id>` 한 이름뿐 |
| 목적지 | `mcpOAuthSecretDestinations`: `.access`만, meta의 server_url origin | `providerSecretDestinations`는 `secret_name` 일치 + endpoint origin |
| 보내기 직전 hook | `McpAuthControl.prepareToken(use)` → `createAgentRuntimeSecrets({mcpOAuth})`. 이름이 `mcp-oauth.`가 아니면 `undefined`. 서버 설정 대조 + `oauth.access`(만료 60초 전 갱신, 서버별 single-flight `flights`) | provider용 hook 없음 |
| core의 network | `extensions/mcp-auth-requests.ts` `createMcpAuthRequests`: `fetch`(HttpFetch 모양, https POST만, 본문 상한 `MCP_AUTH_REQUEST_BODY_MAX`)가 요청을 메모리 대기열에 놓고 8초 안에 답이 없으면 실패. runtime이 machine route `TakeMcpAuthRequest`/`FinishMcpAuthRequest`로 가져가 대신 보냄 | provider는 `http` 주입 자리만 있고 채우는 곳이 없다 |
| runtime 쪽 pump | `core/main/agent-runtime/mcp-auth-pump.ts`(98) `startMcpAuthPump`(250ms idle poll, `redirect:"manual"`, 6초 timeout). `agent-runtime/main.ts` 274줄에서 `pump:true`일 때 시작 | 재사용 가능(요청 모양이 URL/method/headers/body라 provider 로그인·refresh 요청도 실을 수 있음). 단 `McpAuthRequest`는 POST만 받고, 지금 provider 로그인은 GET(discovery, JWKS)도 씀 |
| route 종류 | `agent-mcp-auth/{begin,complete,state,cancel}`: `defineMemory`(user), writer를 안 탐 | provider 로그인은 `defineCommand`인데 writer 앞에서 가로챔 |
| 조립 | `wiring/lophn-agent-extensions.ts`: `createMcpAuthRequests`, `createMcpAuthControl({fetch: requests.fetch, openListener: openMcpCallbackListener, vault: createMcpOAuthVault({secrets: ctx.secretStore}), ...})`, `ctx.provide("mcpAuthControl", ...)`, `closeIntake`에서 `endAll` | provider용 대응물 없음 |
| 화면 | `settings/core-source.ts`, `extension-settings.ts`가 `agent-mcp-auth/*`를 부른다. 호출 모양은 begin → `openExternal` → complete(core가 listener로 기다림) | provider는 붙여넣기 방식과 device 방식을 섞어 놨다 |

provider OAuth가 같은 길을 쓰려고 할 때 정확히 겹치는 것: listener, PKCE 한 벌, `refreshToken`, vault의 3-이름 저장 패턴, `createMcpAuthRequests` 대기열 + `mcp-auth-pump`, `prepareToken` hook 자리(`runtime-secret.ts`). 겹치지 않는 것: MCP는 `McpOAuthServer` key(place+이름)와 사람이 등록한 `client_id`가 전제이고, binding은 `issuer, server_url, client_id`다. provider는 `ProviderRecord` key와 DCR로 받은 client_id(chatgpt)이다.

## 9. 빠진 것 (end-to-end로 돌리려면 고칠 곳)

1. 로그인의 network 길: `wiring/lophn-agent.ts` `lophnAgentProviderLoginWiring`이 `withProviderLogin(inner)`에 `http`를 안 준다. core가 외부 fetch를 못 갖는 규칙 때문에 `mcp-auth-requests.ts` 대기열(+ `mcp-auth-pump.ts`)로 연결하거나 규칙을 바꿔야 한다. `McpAuthRequest`는 POST만 받으므로 GET(xAI discovery, chatgpt JWKS)을 실을 방법이 없다(`requestFetch`가 `init.method !== "POST"`를 거절).
2. `createProviderOAuth`의 `currentDefinition`을 `withProviderLogin`이 안 넘긴다(`login.ts` 48~54줄). `complete`가 항상 실패한다.
3. `CompleteProviderLogin`의 결과가 버려진다(`login.ts` `completeCommand`). token을 `secrets.json`에 쓰고(이름 정책 필요: 지금 `provider.<id>` 하나), `ConnectProvider`(`auth_kind:"oauth"`, `credential.secret`)를 부르는 연결 단계가 없다. `ctx.secretStore`는 wiring `build(ctx)`에서 쓸 수 있지만 `lophnAgentProviderLoginWiring.build`는 ctx를 안 쓴다.
4. 그 연결 단계는 `provider_credentials`에 `expires_at`, `refreshed_at`을 채워야 한다(`connect`는 `expires_at:null`로 만든다). refresh 후 revision 갱신은 `RefreshProviderCredential`(machine)로만 가능한데 호출자가 없다.
5. refresh 전체: 만료 임박 판정, token endpoint 호출(provider별 `grant_type=refresh_token` 요청: chatgpt는 `client_id`가 DCR 발급값, 메모리에만 있어 core 재시작에 사라짐 → 어딘가 저장 필요), 새 token 저장, 거절 시 `revoked`/`rejected` 반영. `OAUTH_REFRESH_LEAD_MS`(60초)는 protocol에 있고 사용처는 `oauth.ts`의 `earliestOf`뿐이다. 과거 구현 `providers/refresh.ts`(222줄, `createOAuthRefresher`, single-flight, 401 시 refresh 한 번 + 재전송 한 번)는 `git show bcb7a9c3d^:packages/core/lophn-agent/providers/refresh.ts`로 볼 수 있다.
6. runtime의 보내기 직전 hook: `createAgentRuntimeSecrets`는 `mcp-oauth.` 이름에만 `mcpOAuth`를 부른다. provider OAuth 접근 token은 보내기 전에 갱신해야 하므로 같은 모양의 hook이 필요하다.
7. `models/resolve.ts`(약 100~118줄)의 `credential.kind !== "api_key"` 거절을 풀고, `billing_route`를 `subscription`으로(`resolve.ts` 213줄), header 선택을 kind까지 보게(지금은 protocol만) 해야 한다. refresh로 토큰이 바뀌면 `available()`는 `logged_in_at`/`secret_ref.name`만 보므로 재로그인(Disconnect→Connect)과 구분된다.
8. 401/429 결과를 credential 상태로 반영하는 길: `RecordProviderAvailability`, `RefreshProviderCredential`이 machine route인데 `RUNTIME_MACHINE_ROUTES`(`run-loop/runtime-access.ts`)에 둘 다 없다. runtime이 부르게 하려면 목록에 더해야 한다. core 내부에서 부르려면 `SESSION_INPUTS_CONTEXT`(`wiring/lophn-agent-runtime.ts`)처럼 machine context를 기동 때 `runtime.record`로 기록하는 패턴이 있다.
9. 화면: `core-call.ts` `windowSecretOpener`(`openConfirmation`) 삭제 또는 preload에 새 창 API 추가; 붙여넣기 창은 shell main(`secret-input/window.ts`류)과 renderer에 없다; submission을 `CompleteProviderLogin`에 싣는 길(`confirmation_kind: secret_input`, binding `provider, login, submission`)의 handle 발급 reader(`decision-handle/issue.ts` `readCanonical`)가 없다. supergrok은 begin 뒤 `login-complete`(poll)를 누가 부르는지 정해야 한다. `submission` nonblank 제약(`loginCompleteInputSchema`)과 listener 경로(빈 submission)가 모순이다.
10. `verified_for_lophn` 둘 다 `false`, packaged core의 `--allow-env`에 `LOPHN_LIVE_PROVIDER` 없음(gate 2를 제품에서 읽으려면).
11. 끊기 때 `secrets/delete`가 `provider.<id>` 하나만 지운다(`core-source.ts` `disconnect`). refresh/meta 이름을 더하면 같이 지워야 한다. `Disconnect` command(`commands.ts`)는 ledger row만 지우고 secret은 안 건드린다.
12. Claude: `OAUTH_PRODUCTS`에 없다(`provider-values.ts`), 정의 anthropic `oauth:null`, `oauthShape`이 product→flow를 고정한다. header는 `x-api-key`가 anthropic protocol의 고정값이다(5.1의 4). 추가하려면 product enum, flow, 정의, header 선택, `oauth.ts`의 chatgpt/else 분기(`product === "chatgpt" ? ... : beginDevice`)를 손봐야 한다.
13. test: provider OAuth를 보는 test가 0. `tools/fake-provider/oauth.ts`는 지워질 예정이고 `tests/support/fake-server`에는 OAuth가 없다.
14. `project-docs/issues/platform.md`의 "provider OAuth 로그인 길은 있지만 그 credential로 model을 부르는 길이 없다"가 열려 있고 "정할 것: 구독 계정(OAuth) provider 연결을 제품에 둘지"로 끝난다. architecture 문서 중 provider/secret/runtime만 다루는 것은 없고(`project-docs/architecture/agent-definition.md` 52~53줄에 secret 이름 공간과 MCP OAuth 설명), `boundary-catalog.yaml`에는 `models`("model catalog와 provider 연결"), `module-catalog.yaml`에는 `packages/core/secrets`→`secrets`, `packages/core/lophn-agent`→`lophn-agent`가 있다.

## 10. (의견) 단순하게 잇는 길

- 구조는 MCP를 따라가는 것이 가장 짧다. 이미 도는 길(대기열 + pump + vault 3-이름 + `prepareToken` hook)이 core 밖 network 규칙과 refresh token 비반출 규칙을 풀어 둔 상태다. provider용으로 `createProviderAuth`(가칭)를 하나 두고 `McpOAuthVault`와 `refreshToken`을 그대로 쓰는 편이 `oauth.ts`의 중복 PKCE/listener를 늘리지 않는다.
- 가장 큰 설계 결정 둘: (1) `secret_name` 하나로는 access/refresh/meta를 못 담는다. `provider.<id>`(access), `provider.<id>.refresh`, `provider.<id>.meta`로 가면 `purposeOf`/`providerSecretDestinations`는 그대로 쓰되 `.refresh`/`.meta`는 `destinations`가 빈 목록이 되도록 한 줄 조건만 더하면 된다. (2) 로그인 결과를 누가 `ConnectProvider`로 이으나: login-complete 처리기 안에서 `ctx.secretStore.put` 후 `inner.command(ConnectProvider)`를 core가 부르는 쪽이 renderer에 secret이 안 지나고 화면 흐름도 짧아진다.
- 화면 쪽은 chatgpt의 listener를 core가 이미 연다(`openCallbackListener`)는 점을 쓰면 붙여넣기 창을 없애고 `login-begin` → `openExternal` → `login-complete`(listener 대기)로 MCP 화면과 같은 모양이 된다. 그러면 `windowSecretOpener`, `CompleteProviderLogin`의 `confirmation`/binding, nonblank `submission`을 같이 지울 수 있다. 붙여넣기가 꼭 필요한 이유(원격 환경 등)가 있으면 그때 남긴다.
- gate는 `verified_for_lophn` 하나를 제품 gate로 두고 `LOPHN_LIVE_PROVIDER`는 live suite 전용으로 돌려 놓는 쪽이 헷갈림이 적다. 지금은 세 gate가 서로 다른 층(wiring, env, 정의)에 있다.
- 순서 제안: (a) core 내부 네트워크 길 + secret 저장 + Connect 연결, (b) resolve에서 oauth 허용 + header/billing, (c) refresh(`prepareToken` 짝), (d) 화면, (e) Claude. 먼저 supergrok(device flow, id_token 검증 없음)으로 (a)~(c)를 닫고 chatgpt의 DCR/JWKS/id_token을 얹으면 한 번에 큰 가정을 검증하지 않아도 된다. 실제 provider 호출은 `AGENTS.md`상 사람 허락이 필요하다.
