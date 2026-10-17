# provider OAuth 로그인 E2E 후보

구현 session(lophn-4a)이 보낸 명세에서 뽑았다. 구현은 branch `feat/oauth`(commit `af5387ad5`)에 있고 아직 main에 없다. **이 단위는 그 branch가 main에 land한 뒤에 시작한다.** route·이름은 그때 main 코드로 다시 확인한다.

## 명세 요약

- flow 둘. chatgpt는 PKCE S256과 `127.0.0.1` loopback `/auth/callback`(port는 OS가 고름), supergrok은 RFC 8628 device code. Claude는 없다.
- command 셋. 모두 user token으로 부르고 decision handle이 없다. writer 앞 처리기라 ledger·event가 없다.
  - `providers/login-begin`(`BeginProviderLogin`): `{provider, name, definition, endpoint, protocol}` → `{login, flow, interval_ms, expires_at, sign_in: {url, user_code}}`
  - `providers/login-complete`(`CompleteProviderLogin`): `{provider, login}` → `{state: "pending", interval_ms}` 또는 `{state: "connected", provider}`. 거절·검증 실패는 `forbidden`, 기한 지남·모르는 login은 `not_found`, 발급자에 못 닿음은 `unavailable`. connected면 core가 token을 저장하고 `ConnectProvider`(`auth_kind: "oauth"`)까지 부른다.
  - `providers/login-cancel`(`CancelProviderLogin`): 세션과 listener를 닫는다.
- 발급자 HTTP는 core가 직접 하지 않는다. 대기열에 놓으면 agent runtime이 machine route `issuer-requests/take`·`done`으로 대신 보낸다. **그래서 발급자 왕복이 core와 runtime child를 건넌다.**
- 발급자 주소는 정의의 `oauth` 칸(data)이다. 제품에 test flag가 없다.
- secret 이름: `provider.<id>`(access, model 호출 목적지는 provider endpoint origin뿐), `provider.<id>.refresh`·`.meta`(core 밖으로 안 나감), `provider-oauth.host-id`.
- 불변 조건: token·code·verifier·device_code·refresh token은 `secrets.json` 밖 어디에도 없다. 만료 5분 미만이면 runtime이 청할 때 core가 갱신하고 회전한 refresh를 먼저 저장한다. 갱신이 거절되면 credential이 `revoked`/`refresh_revoked`이고 token을 건네지 않는다. 갱신은 provider마다 한 번에 하나다. model 요청 header는 `authorization: Bearer <access>`다(anthropic protocol이어도).
- 이미 있는 unit(겹치지 않게): `providers/login_test.ts`(state·nonce·aud·scope 거절, Connect 실패 시 아무것도 안 남음), `providers/oauth-refresh_test.ts`(회전 저장, `invalid_grant` → revoked, 기한 밖이면 갱신 안 함), `providers/secret-refs_test.ts`(`.refresh`·`.meta`는 목적지 없음).

## support

`tests/support/fake-oauth/`: loopback port 0의 fake 발급자 하나.
- endpoint: device authorization(form POST), token(`authorization_code`, `device_code`, `refresh_token` grant), jwks(GET).
- 대답은 줄로 정한다: device token은 `authorization_pending`을 N번 낸 뒤 token, refresh는 새 token 또는 `invalid_grant`.
- id_token은 test가 만든 RSA 키로 RS256 서명한다(Web Crypto). `iss`, `aud`(발급 client_id), `exp`, `nonce`(authorize의 값), `sub`.
- 받은 요청을 모두 journal에 남긴다(form 값 포함).
- provider 정의는 test가 만든다: `protocols: ["anthropic-messages"]`, `auth_kinds: ["oauth"]`, `oauth`는 fake 발급자 주소, `endpoint`는 지금 fake server(`/messages`). 정의를 내장과 대조하지 않는지 main 코드로 확인한다. 대조한다면 fake server에 그 protocol이 필요한지 보고한다.

## core E2E 후보 (`tests/e2e/oauth_test.ts` 한 file)

| 행 | 단계 | 단정(서로 다른 곳) | 왜 E2E인가 |
|---|---|---|---|
| `device-login` | begin(supergrok 꼴) → 이른 complete(발급자에 poll하지 않음) → complete `pending`(발급자가 `authorization_pending`) → complete `connected` | ledger: provider가 `auth_kind: "oauth"`이고 credential이 available / disk: `secrets.json`에 `provider.<id>`, `.refresh`, `.meta`가 있다 / fake 발급자: device 요청 하나와 token 요청이 `interval_ms`보다 촘촘하지 않다 | 발급자 왕복이 runtime child의 issuer pump를 건넌다 |
| `pkce-login` | begin(chatgpt 꼴) → test가 `sign_in.url`의 `redirect_uri`로 `code`·`state`·`client_id`를 GET(browser 흉내) → complete `connected` | fake 발급자: token 요청에 `code_verifier`와 `redirect_uri`가 있고 jwks GET이 왔다 / ledger: provider connected / disk: secret 셋 | loopback callback listener와 pump가 process를 건넌다 |
| `bearer-on-model-call` | 로그인 뒤 session → turn 하나 | fake model: 요청 header가 `authorization: Bearer <access>`이고 `x-api-key`가 없다 / fake model: 본문에 token이 없다 / ledger: turn completed | access token이 core → runtime → model 요청으로 간다 |
| `refresh-before-call` | 발급자가 `expires_in: 60`으로 token → turn | fake 발급자: model 요청 전에 `refresh_token` grant 하나 / fake model: Bearer가 새 access다 / disk: `secrets.json`의 `.refresh`가 회전한 값이다 | runtime이 청할 때 core가 갱신한다(child ↔ core) |
| `refresh-revoked` | 갱신이 `invalid_grant` → turn | ledger: credential이 `revoked`(`refresh_revoked`) / ledger: turn이 `configuration_unavailable` / fake model: 요청 0 | 거절된 grant의 token을 runtime에 건네지 않는다 |
| `cancel-closes-listener` | pkce begin → cancel → `redirect_uri`로 GET | 연결이 거절된다(listener 닫힘) / complete가 `not_found` / disk: `secrets.json`에 그 provider 이름이 없다 | loopback listener는 process 밖에서만 보인다 |
| `no-leak` | 위 행들 뒤 `core.stop()` | disk: `secrets.json`을 뺀 `run.home` 전체와 `core.log`에 access·refresh·code·verifier·device_code 값이 byte로 없다 / route: `providers/read`·`list`·`model-calls/list` 출력에 없다 | `secret_test.ts`와 같은 꼴. 이름 공간이 새로 생겼다 |

## E2E로 하지 않는 것

- state·nonce·audience·scope 불일치 거절, Connect 실패 때 아무것도 안 남음, 회전 저장, `invalid_grant` 판정: 이미 unit(`login_test.ts`, `oauth-refresh_test.ts`)이 본다. process를 건너지 않는다.
- 갱신이 provider마다 하나: 두 session이 같은 순간 청해야 하는 시간 경쟁이다. unit에 있는지 brief가 확인하고, 없으면 unit으로 더하는 것을 보고한다.
- 끊기(`providers/disconnect`)가 이름 셋을 지움: decision handle(shell main의 parent pipe)이 필요하다. support에 handle 등록 helper가 생기면 더한다.
