# 참고 구현 조사: omp / pi-mono의 provider 구독 OAuth

* 조사 시점: 2026-10-17
* 조사 대상과 확인한 commit (둘 다 `git clone --depth 1`, 읽기만 함)
  * omp = `can1357/oh-my-pi` main, `58195a453b8627421f1119a60586e3c17d76a27e` (2026-10-17)
  * pi-mono = `badlogic/pi-mono` main, `8efd314fa3d3232ce197d8d7a6a5660530b9d83e` (2026-10-16). CHANGELOG 링크와 package 이름(`@earendil-works/pi-ai`)을 보면 레포가 `earendil-works/pi` 쪽으로 옮겨 간 듯하다. 이름은 달라도 같은 코드로 본다.
* clean room: 코드를 옮겨 적지 않았다. 이름, path, endpoint, 값, 구조, 설계만 적었다. omp가 Claude Code 요청을 흉내 내려고 쓰는 hash salt·seed 같은 상수는 일부러 적지 않았다(따라 하면 안 되는 쪽이다).
* 실행·설치·build하지 않았다. 실제 provider endpoint를 부르지 않았다. 사람의 home 아래 credential file은 열지 않았다. 공개 문서만 WebSearch/WebFetch로 읽었다.
* 경로 표기: `omp:` = oh-my-pi 레포, `pi:` = pi-mono 레포. 둘 다 `packages/ai` 아래가 중심이다.

## 0. 구조 한눈에

| | pi-mono | omp |
|---|---|---|
| OAuth flow 코드 | `pi:packages/ai/src/auth/oauth/{anthropic,openai-codex,openai-chatgpt,xai,github-copilot,...}.ts`. provider마다 file 하나, 손으로 짠 코드 | 선언형. `omp:packages/catalog/src/compat/rules/auth/*.kdl`가 flow를 선언하고, `omp:packages/ai/src/registry/engine/{oauth-code,device-code,refresh}.ts`가 실행. provider별 잔여 코드는 `omp:packages/ai/src/registry/oauth/*.ts`(hook) |
| 저장 | `CredentialStore` interface를 앱이 주입. coding-agent는 `auth.json` (§8) | SQLite `agent.db`, 계정 여러 개 pool + 회전 (§8) |
| refresh | `modify(providerId, fn)` lock 안에서 한 번만 (`pi:packages/ai/src/auth/resolve.ts`) | single-flight + lease + compare-and-set (`omp:packages/ai/src/auth/refresh.ts`) |
| 요청 위장 | Anthropic만 "Claude Code인 척"(stealth). Codex는 자기 이름(`originator: pi`) | Anthropic은 Claude Code fingerprint를 깊이 흉내. Codex도 codex-rs의 header를 많이 흉내 |

두 구현의 공통 모양: 로그인은 `login(interaction)`이 URL/code를 사용자에게 보여 주고 값을 받는 protocol이고(`notify`/`prompt`), 결과는 `{access, refresh, expires(ms epoch)}` 한 벌이다. 요청 때는 access token을 그냥 "apiKey" 자리에 넣어 provider 쪽 stream 코드가 알아서 header를 붙인다.

## 1. Anthropic (Claude Pro/Max)

### 1.1 flow 종류
* PKCE + loopback callback. 로그인 때 사용자가 고르게 하는 대체 flow가 하나 더 있다.
  * pi-mono: "Browser login(기본)" / "Copy code login(headless)" 두 방법을 `select`로 묻는다 (`pi:.../oauth/anthropic.ts`).
    * browser: loopback 서버를 띄운다. 선호 port 53692, path `/callback`, 못 열면 빈 port(0)로 물러나고, 그것도 실패하면 서버 없이 사용자가 redirect URL을 붙여넣게 한다(같은 입력창에서 callback과 붙여넣기를 경주시킴). 주석에 "Anthropic은 아무 loopback port나 받는다(#10571)"고 적혀 있다. host는 `PI_OAUTH_CALLBACK_HOST` env로 바꿀 수 있고 기본 127.0.0.1, redirect URI의 host 글자는 `localhost`.
    * copy code: redirect URI를 Anthropic 쪽 고정 페이지로 두고, 로그인 뒤 그 페이지가 보여 주는 code를 사용자가 붙여넣는다. SSH/container 같은 headless 용.
  * omp: 선언은 callback port 54545, path `/callback` 하나. 서버를 못 열거나 사용자가 브라우저를 다른 기계에서 쓰면 redirect URL 또는 code 붙여넣기로 대체한다(`manualOnly` 옵션, `PASTE_CODE_LOGIN_PROVIDERS`). (`omp:packages/catalog/src/compat/rules/auth/anthropic.kdl`, `omp:packages/ai/src/registry/oauth/callback-server.ts`)

### 1.2 client_id
* `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. 두 구현 모두 base64로 박아 둔다(주석: secret scanner 방지). 이것은 **Claude Code의 공개 client**다. 자기 것을 등록한 게 아니라 빌려 쓴다. omp 주석도 "Public OAuth client id"라고 적었다.

### 1.3 URL, scope, param
* authorize: `https://claude.ai/oauth/authorize` (omp 주석: platform.claude.com은 console token만 주고, 직접 inference는 claude.ai endpoint가 필요하다)
* token: pi는 `https://platform.claude.com/v1/oauth/token`, omp는 `https://api.anthropic.com/v1/oauth/token`. 둘 다 동작하는 것으로 보이나 어느 쪽이 정본인지는 확인 못 함.
* redirect URI: loopback이면 `http://localhost:<port>/callback`, copy code면 `https://platform.claude.com/oauth/code/callback`
* scope(공백으로 이음): `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`
* authorize 추가 param: `code=true` (이게 있어야 Anthropic 페이지가 "code를 복사하라" 화면도 보여 주는 것으로 보임), `response_type=code`, `code_challenge_method=S256`
* PKCE: 32바이트(pi) 또는 96바이트(omp) 난수를 base64url로 verifier, SHA-256의 base64url이 challenge.
* state: **pi는 verifier를 그대로 state로 쓴다**(따로 안 만듦). omp는 16바이트 난수의 hex.
* 붙여넣는 값의 꼴: `code#state`, 전체 redirect URL, `code=...&state=...` query, code 단독. 네 가지를 다 받는다. `#`로 쪼개 앞이 code, 뒤가 state. state가 있고 기대값과 다르면 거부(pi), omp는 fragment의 state를 callback state보다 우선한다.

### 1.4 token 교환 / refresh
* 교환: `POST` **JSON** body. 필드 `grant_type=authorization_code`, `client_id`, `code`, `state`, `redirect_uri`, `code_verifier`. 헤더 `Content-Type`/`Accept: application/json`, timeout 30초(pi).
* 응답: `access_token`, `refresh_token`, `expires_in`(초). omp는 추가로 `account.uuid`, `account.email_address`, `organization.uuid`, `organization.name`을 읽는다(응답에 있으면).
* 만료 계산: `now + expires_in*1000 - 5분`. 즉 저장하는 `expires`에 이미 5분 여유를 뺀다(pi, omp `skew-ms=300000`).
* refresh: `POST` JSON, `grant_type=refresh_token`, `client_id`, `refresh_token`. **scope를 보내지 않는다**(pi CHANGELOG: scope를 빼서 고침, issue #2169). omp는 refresh 때만 `anthropic-beta: oauth-2025-04-20`과 Anthropic SDK 모양의 User-Agent(`anthropic-sdk-typescript/<ver> userOAuthProvider`)를 붙인다(Claude Code가 그렇게 보낸다고 주석에 적음). 최초 교환에는 안 붙인다.
* refresh token **회전함**. 응답의 새 `refresh_token`으로 갈아 끼운다. 동시에 두 번 refresh하면 한쪽이 죽으므로 두 구현 다 lock/lease를 쓴다(§4.1).
* 수명(omp 주석, 실측): access token은 8시간 안팎. grant 가족 전체는 로그인 시점부터 **약 30일 절대 수명**이고 회전해도 늘어나지 않는다. 30일이 지나면 `invalid_grant: Refresh token expired`가 나오고 새로 로그인해야 한다. 이 상수는 `omp:packages/ai/src/registry/oauth/anthropic-constants.ts`에 "경고 표시용 heuristic"으로 있다.
* refresh 시점: pi는 남은 시간이 5분 미만이면 요청 전에(`resolveStoredOAuth`), omp는 `OAUTH_REFRESH_SKEW_MS=60초` 전에 + 401 뒤 복구(§7).

### 1.5 계정 식별
* pi: 안 한다(account id를 저장하지 않음).
* omp: token 응답에 account/organization이 있으면 그것을 쓰고, 없으면 `GET https://api.anthropic.com/api/claude_cli/bootstrap?entrypoint=cli&model=...`를 Bearer로 불러 `oauth_account.{account_uuid, account_email, organization_uuid, organization_name}`를 얻는다. org는 **로그인 때 한 번만** 기록하고 refresh 때는 갱신하지 않는다(주석: 백그라운드 refresh가 identity를 바꾸면 저장된 credential의 key가 흔들릴 수 있음). 한 email이 Team 자리와 개인 Max를 함께 가질 수 있어 org가 구독 pool의 구분자다.

### 1.6 token으로 model 부르기
* base URL `https://api.anthropic.com`, path `/v1/messages` (omp는 OAuth일 때 `?beta=true`를 붙임), `stream: true`.
* 판별: apiKey 문자열에 `sk-ant-oat`가 들어 있으면 OAuth token으로 본다(pi `anthropic-messages.ts`, omp `utils/anthropic-auth.ts`). 즉 access token 자체가 `sk-ant-oat...` 꼴이다.
* header (pi): `Authorization: Bearer <token>`(x-api-key 대신), `anthropic-beta`에 `claude-code-20250219`, `oauth-2025-04-20`(+ 필요한 다른 beta), `user-agent: claude-cli/<Claude Code 버전>`, `x-app: cli`, `anthropic-dangerous-direct-browser-access: true`, `accept: application/json`. 버전은 2.1.280으로 박혀 있다.
* header (omp): 위에 더해 `User-Agent: claude-cli/<ver> (external, cli)`, `anthropic-version: 2023-06-01`, `X-Stainless-*` 일체(Lang/OS/Arch/Runtime/Runtime-Version/Package-Version/Retry-Count/Timeout), `X-Claude-Code-Session-Id`, `Accept-Encoding`. 호출자가 넘긴 값은 이 header들에 한해 덮어쓰지 못하게 막는다(enforced header). 
* 요청 몸에 강제되는 것
  * **system 머리말**: `system`의 첫 block이 정확히 `You are Claude Code, Anthropic's official CLI for Claude.`여야 한다. 그 뒤에 자기 system prompt를 별도 block으로 붙인다(pi 주석: "OAuth tokens에는 Claude Code identity를 MUST 포함").
  * **tool 이름**: pi는 Claude Code의 tool 이름(Read, Write, Edit, Bash, Grep, Glob, Task, TodoWrite, WebFetch 등 17개)과 대소문자만 다른 이름을 그 표기로 바꿔 보내고, 응답에서 되돌린다. omp는 OAuth일 때 tool 이름 앞에 접두사 `_`를 붙여 내장 tool과 섞이지 않게 하고 응답에서 뗀다(`claudeToolPrefix`).
  * omp 전용: system[0]에 `x-anthropic-billing-header: cc_version=<버전>.<3자리 suffix>; cc_entrypoint=cli; cch=<5자리>;` 꼴의 text block을 넣는다. suffix는 첫 user turn의 몇 글자와 버전으로 만든 hash이고, `cch`는 요청 body 전체의 xxHash64 하위 20비트다(body를 직렬화한 뒤 fetch를 감싸 자리 표시자 `00000`을 덮어씀). 이 모든 것이 Claude Code의 계산을 역으로 따라 한 것이다. gzip은 이 hash 아래에서 한다.
  * omp: 서버가 `claude_code_version_too_old` 오류로 최소 버전을 알려 주면 그 버전으로 올려 한 번 재시도한다(`adoptRequiredClaudeCodeVersion`). 즉 서버가 **client 버전을 검사한다**.
  * omp: 구독 credential에는 long context beta(`context-1m-...`)를 안 보낸다. 보내면 `Usage credits are required for long context requests` 429로 전부 죽었다(omp CHANGELOG #7238).
  * model 허용 목록: 코드에서 막지는 않는다. 계정 plan이 못 쓰는 model은 403(permission_error)으로 온다.
* API key 길과의 차이: key는 `x-api-key`, OAuth는 `Authorization: Bearer`. OAuth만 위 beta, UA, system 머리말, tool 이름 처리, (omp) billing header가 붙는다. key 길에는 이런 위장이 없다.

### 1.7 실패 처리
* pi: refresh 실패는 `ModelsError("oauth")`로 올리고 credential은 **지우지 않고 보존**("재로그인 가능"). 저장된 credential이 있으면 env key로 조용히 떨어지지 않는다("stored credential owns the provider"). 요청의 401 뒤 재시도는 pi 쪽에서 확인 못 함.
* omp (`omp:packages/ai/src/auth-retry.ts`, `error/auth-classify.ts`): a/b/c 정책. (a) 첫 요청, (b) 401이면 같은 계정 token을 강제 refresh 한 번, (c) 그래도 안 되면 다른 계정(sibling)으로 회전. 403(plan·model·org 정책 거부)은 refresh 없이 바로 회전하고 해당 credential을 60초 soft-block만 한다(지우지 않음). 429 중 usage limit(계정 한도)은 회전, 일시적 429("Too many requests")는 backoff. refresh가 `invalid_grant`/revoked/`refresh token expired` 꼴이면 "definitive"로 보고 credential을 비활성화한다. 같은 token을 5분 안에 다시 mint하지 않는 cooldown도 있다.
* 사용량 한도 header를 읽는다(omp). `anthropic-ratelimit-unified-*` 계열(reset, 5h/7d window utilization, status, overage-status, slow-*)로 "한도 도달 · 마무리 중" 상태를 status line에 보여 준다. 별도로 usage endpoint도 불러 5시간/주간/model별(Fable·Mythos) 한도와 extra usage 지출을 표시한다(`omp:packages/ai/src/usage/claude.ts`, `providers/anthropic-slow-mode.ts`). pi는 읽지 않는다.

### 1.8 저장
§8 참조.

### 1.9 정책 흔적
* **Anthropic 공식 문서** (`code.claude.com/docs/en/legal-and-compliance`, 2026-10-17에 직접 읽음): "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications." 개발자는 API key를 쓰라. "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users." "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." 그리고 "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." 이 문서가 허용하는 것은 사용자가 **수정하지 않은 Claude Code binary**에 자기 구독으로 로그인하는 경우다. 
* 2026-02경부터 보도·커뮤니티에서 "구독 token의 third-party 사용 금지, 서버 측에서 차단"이 퍼졌고, 한 안내글은 정책이 두 달 사이에 두 번 뒤집혔다고 한다(2026-04 말 기준 OpenClaw 문서는 "CLI 방식 사용은 다시 허용됨"). 2차 자료라서 현재 상태는 확인 못 함.
* pi-mono CHANGELOG: 0.40.1(2026-01-08)에 Anthropic OAuth를 **제거**했다가 0.41.0(2026-01-09)에 "back!"으로 되살렸다. 이후 interactive 시작 때 경고를 띄운다: "Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits." (`pi:packages/coding-agent/src/modes/interactive/interactive-mode.ts`, 끄는 설정 `warnings.anthropicExtraUsage`). 즉 구독 한도가 아니라 **extra usage(종량 과금)**로 청구된다는 안내다.
* omp CHANGELOG: "Anthropic Claude subscription OAuth requests being rejected by the upstream service (#9801)", "Anthropic authentication for newer models by updating the Claude Code request fingerprint" 등. 서버가 요청의 모양을 검사하고, 검사가 바뀔 때마다 위장을 고쳐야 한다는 흔적이다.
* omp README에는 ToS 경고 문구가 없다(grep 확인). omp는 `oauth` 태그만 단다.

## 2. OpenAI (ChatGPT Plus/Pro, Codex)

pi-mono에 **OAuth flow가 둘** 있고 omp는 하나(옛 Codex 길)다.

* (A) 옛 길 = "OpenAI Codex (legacy)": Codex CLI의 client를 빌려 `chatgpt.com/backend-api/codex/responses`에 보낸다. pi `openai-codex.ts`, omp `openai-codex.kdl`/`registry/oauth/openai-codex.ts`.
* (B) 새 길 = "Sign in with ChatGPT": OpenAI가 만든 공식 third-party 로그인. token을 `api.openai.com/v1`에 직접 쓴다. pi `openai-chatgpt.ts`만 구현(provider id `openai`에 OAuth로 붙음). omp는 `dynamic_agent_client`나 `chatgpt.tokens.use.direct`를 찾지 못했다. pi README: (A)는 "Superseded by Sign in with ChatGPT".

### 2.1 flow 종류
* (A) 두 가지. 사용자가 고른다.
  * browser: PKCE + loopback, **port 1455 고정**, path `/auth/callback`, redirect URI는 `http://localhost:1455/auth/callback`. 이 port는 Codex CLI와 공유한다. pi는 서버를 못 열면(이미 점유) 붙여넣기로 물러난다. omp는 "OpenAI가 이 URI 하나만 allowlist 한다"고 보고 busy port 시 **물러나지 않고 실패**시킨다(`port-fallback=false`).
  * device code(headless): 아래 2.3. omp 주석: 1455를 못 쓰거나 browser callback이 403으로 실패할 때 쓴다.
* (B) PKCE + loopback만. 127.0.0.1:1455 `/auth/callback`. 서버를 못 열면(EADDRINUSE) 다른 port로 안 물러나고 "Codex CLI나 다른 pi 세션이 쓰는 중"이라는 오류를 낸다. 붙여넣기는 **전체 callback URL**만 받는다(`code#state` 꼴 아님).

### 2.2 client_id
* (A) `app_EMoamEEZ73f0CkXaXp7hrann`. **Codex CLI의 공개 client**를 빌린 것.
* (B) 고정 client_id가 없다. 로그인마다 `client_id=dynamic_agent_client`로 authorize에 가서 **동적 등록**하고, OpenAI가 callback query에 발급한 `client_id`를 돌려준다. 그 값을 token 교환·refresh에 쓰고 credential에 저장한다(`clientId`). 즉 자기 client를 등록하는 구조다. 로그인 때 설치 단위 id가 필요하다: `ext_agent_host_id=urn:uuid:<설치 UUID>`, 그리고 `agent_name_hint`(앱 이름).

### 2.3 URL, scope, param
(A)
* authorize `https://auth.openai.com/oauth/authorize`, token `https://auth.openai.com/oauth/token`
* scope: pi는 `openid profile email offline_access`, omp는 `openid profile email offline_access api.connectors.read api.connectors.invoke`.
* 추가 param: `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=<앱 이름>` (pi `pi`, omp `omp`. 기본값을 Codex CLI 이름으로 두는 것은 omp의 상수 `ORIGINATOR_CODEX`가 "omp"). `response_type=code`, `code_challenge_method=S256`.
* state: 16바이트 난수 hex. PKCE는 위와 같은 방식.
* device code: `POST https://auth.openai.com/api/accounts/deviceauth/usercode` (JSON `{client_id}`) → `{device_auth_id, user_code, interval}`. 사용자는 `https://auth.openai.com/codex/device`에서 user_code를 입력. 폴링 `POST .../api/accounts/deviceauth/token` (JSON `{device_auth_id, user_code}`): 403/404는 대기, `deviceauth_authorization_pending`도 대기, `slow_down`이면 간격을 늘림, 성공하면 `{authorization_code, code_verifier}`. 이것을 일반 token 교환에 넣되 `redirect_uri=https://auth.openai.com/deviceauth/callback`. 제한 15분(pi), 폴링 120회(omp).
(B)
* authorize `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`
* scope `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1` (authorize·교환·refresh 모두), `nonce` 포함, state는 32바이트 base64url.
* 응답 scope에 `chatgpt.tokens.use.direct`가 없으면 거부한다(사용자가 consent 상자를 안 체크한 경우를 걸러냄).

### 2.4 token 교환 / refresh
* (A) **form**(`application/x-www-form-urlencoded`). 교환: `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri`. 응답 `access_token`, `refresh_token`, `id_token`, `expires_in`(초). 만료 = `now + expires_in*1000`(여유를 빼지 않음. 여유는 resolve 쪽 5분/omp 60초 skew가 처리). refresh: `grant_type=refresh_token`, `refresh_token`, `client_id` form. 응답에 `refresh_token`이 항상 있어야 한다(없으면 오류) = **회전**. 요청 timeout 15초(omp).
* (B) form. 교환·refresh 모두 `resource` 포함, refresh는 저장된 `client_id` 사용. 응답 `access_token`, `refresh_token`, `expires_in`, `scope`, `id_token`(교환 때 없으면 오류). 만료 = `now + expires_in - 3분`. 2차 자료(2026-10-13 글)에 따르면 access 1시간, refresh 30일 sliding. 저장된 credential에 `clientId`가 없으면 "다시 연결하라"고 실패한다.
* refresh 시점: pi는 남은 5분 미만이면 요청 전에, lock 안에서 재확인. refresh 중에는 caller의 abort를 무시하고 timeout(15초)만 건다(회전된 refresh token을 잃지 않으려고).

### 2.5 계정 식별
* (A) access token(JWT, **서명 검증 없이 payload만 디코드**)의 claim `https://api.openai.com/auth` 아래 `chatgpt_account_id`. 이것을 요청마다 `chatgpt-account-id` header로 보낸다. 못 꺼내면 로그인 실패(pi). omp는 access token과 `id_token` 양쪽에서 찾고, `chatgpt_plan_type`(→ 표시용 org 이름), claim `https://api.openai.com/profile`의 `email`도 꺼낸다. 한 email이 개인 Pro와 Team 자리를 함께 가질 수 있어 account id가 구독 pool 구분자다(omp 주석). 지역 고정 enterprise workspace용으로 `chatgpt_data_residency`(없으면 `chatgpt_compute_residency`) claim도 읽어 `x-openai-internal-codex-residency` header로 보낸다.
* (B) pi는 id_token을 사용자 식별에 쓰지 않는다. 존재 확인만 한다. account id header도 없다.

### 2.6 token으로 model 부르기
(A) `POST https://chatgpt.com/backend-api/codex/responses` (SSE) 또는 같은 path의 WebSocket(`wss://`). base URL 설정이 `.../backend-api`, `.../codex`, `.../codex/responses` 어느 것으로 와도 마지막을 `/codex/responses`로 맞춘다.
* header (pi): `Authorization: Bearer <access>`, `chatgpt-account-id`, `originator: pi`, `User-Agent: pi/...`, `OpenAI-Beta: responses=experimental`(WebSocket은 별도 값 `responses_websockets=...`), `accept: text/event-stream`, `content-type: application/json`, `session-id`·`x-client-request-id`(session id).
* header (omp)는 위에 더해 `originator: omp`, `version: <Codex CLI 버전>`(현재 pin 0.159.0), `conversation_id`, `session_id`, `x-codex-routing-hint: model=<slug>;tier=<service tier>`, `x-codex-installation-id` 계열, `x-codex-turn-metadata`, `x-codex-window-id`, `x-oai-attestation`(DeviceCheck 증명. host가 provider 함수를 주입해야 값이 있다. 없으면 생략), `x-codex-beta-features`. omp 주석: backend가 **`version` 값으로 model 노출을 gate한다**(옛 version이면 신형 model이 `/models`에서 안 보임).
* body에 강제되는 것: `store: false`(코드 주석: "ChatGPT Codex Responses rejects `store: true`"), `stream: true`, `instructions`(필수. system prompt가 없으면 pi는 `You are a helpful assistant.`를 넣는다. omp는 첫 system prompt를 `instructions`로, 나머지를 developer message로 보냄), `input`, `include: ["reasoning.encrypted_content"]`, `prompt_cache_key`(session id), `tool_choice`, `parallel_tool_calls: true`, `text.verbosity`, 필요하면 `reasoning.{effort, summary}`. omp 주석: Codex backend는 `temperature`, `top_p`, `max_output_tokens`, `max_completion_tokens` 등 sampling·길이 param을 전부 `400 Unsupported parameter`로 거부한다(codex-rs도 안 보냄). 요청 body를 zstd로 압축해 보낼 수 있다(pi, Codex client와 같은 방식).
* 허용 model 목록: backend가 plan과 client `version`으로 gate한다. 코드는 목록을 catalog로 갖되(`openai-codex.models.ts`), 서버 응답이 최종이다.
* API key 길과의 차이: key 길은 `https://api.openai.com/v1/responses`, `Authorization: Bearer sk-...`, 대부분의 param 허용, `store: true`/`previous_response_id` 가능. Codex 길은 host가 `chatgpt.com`이고 `chatgpt-account-id`/`originator`/`OpenAI-Beta`가 붙고 위 body 제약이 있다.

(B) `POST https://api.openai.com/v1/responses`에 `Authorization: Bearer <access>`만. 2차 자료: `store:false`, `stream:true`, sampling param과 built-in tool(code interpreter, file search, image generation, computer use 등)·file upload·서버 쪽 대화 이어가기가 미지원(preview). `gpt-6-luna` 같은 classifier(Decisions API) model은 OAuth token을 거부해 pi가 OAuth일 때 목록에서 숨긴다.

### 2.7 실패 처리
* pi (Codex): 429/5xx와 `rate limit`/`overloaded` 글자가 있으면 재시도 대상이지만 기본 최대 재시도는 0이고(호출자가 올림), 지수 backoff 1초에서 시작, `retry-after-ms`/`retry-after` header 존중, 서버가 요구한 지연이 상한(기본 60초)을 넘으면 포기. 돈·한도 소진(`Monthly usage limit reached`, `insufficient_quota`, billing 등)은 재시도 안 함. 오류 body의 `usage_limit_reached`/`usage_not_included`/`rate_limit_exceeded` 또는 429면 "You have hit your ChatGPT usage limit (<plan> plan). Try again in ~N min."으로 풀어 쓴다(`resets_at`, `plan_type` 사용). 이때 `Failed to extract accountId`가 token이 깨진 신호다.
* omp: pi와 같은 a/b/c 회전(§1.7). Codex 전용으로 `cyber_policy` 같은 계정 정책 거부도 회전. 응답 header `x-codex-primary-*`/`x-codex-secondary-*` (`used-percent`, `window-minutes`, `reset-at`)를 읽어 5시간/주간 window 사용률을 기록하고, 별도로 `GET <origin>/backend-api/wham/usage`로 plan 한도·reset credit을 조회한다. `region`이 안 맞는 enterprise workspace는 401 `Workspace is not authorized in this region.`.

### 2.8 저장 → §8. 

### 2.9 정책 흔적
* pi README: (A)를 "legacy"로 표시, "Superseded by Sign in with ChatGPT". 코드 주석에 (B)는 "public-client flow, client secret 없음, user access token을 api.openai.com에 직접"이라고 적혀 있다 = OpenAI가 third-party용으로 연 공식 길.
* 2차 자료(yage.ai, 2026-10-13): "Sign in with ChatGPT"은 2026-09-29 DevDay 발표. open-source·local client는 시작부터 접근 가능하고 commercial app은 limited trial. 구독 plan 한도에 합산되고 사용자가 설정에서 revoke 가능. 2026-02-09에 OpenAI Codex maintainer가 GitHub Discussions에서 비공식으로 Codex client id 재사용에 호의적으로 답했으나 약관상 모호. 소비자 구독은 이용약관의 "credential 공유 금지, rate limit 우회 금지" 아래에 있다. 구독을 API처럼 되파는 proxy(sub2api류)는 anti-fraud 대상이라는 보도가 있다(출처 약함). 공식 약관 문구는 직접 확인 못 함.
* omp/pi 코드에서 OpenAI의 차단·경고 문구는 못 찾았다.

## 3. xAI (SuperGrok / X Premium+)

### 3.1 flow 종류
* **device code (RFC 8628)** 하나. loopback callback·붙여넣기 없음. pi `xai.ts`, omp `xai-oauth.kdl` + device-code engine. omp 주석: device 승인과 refresh는 NousResearch/hermes-agent(MIT)에서 가져왔다.

### 3.2 client_id
* `b1a00492-073a-47ea-816f-4c329264a828`. **Grok CLI(Grok Build)의 공개 client를 빌린 것**. scope에 `grok-cli:access`가 들어 있어 consent 화면에 "Grok Build/Grok CLI"로 보인다는 2차 자료가 있다. 자기 등록이 아니다.

### 3.3 URL, scope, param
* device code: `POST https://auth.x.ai/oauth2/device/code` (form: `client_id`, `scope`; pi는 추가로 `referrer=pi`)
* token: `POST https://auth.x.ai/oauth2/token`. omp는 `https://auth.x.ai/.well-known/openid-configuration`(OIDC discovery)에서 `token_endpoint`를 받아 쓰되 **https이고 host가 `x.ai`/`*.x.ai`일 때만** 받아들인다(이 endpoint로 이후 refresh token이 다 가기 때문). pi는 고정 URL.
* scope `openid profile email offline_access grok-cli:access api:access`
* 폴링: form `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id`, `device_code`. `authorization_pending` 대기, `slow_down` 간격 증가(응답에 `interval` 있으면 그 값), `access_denied`/`authorization_denied`/`expired_token`은 실패. 첫 폴링 전에 interval만큼 기다린다. 응답 필드 `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`(있으면 그것을 열 URL로), `interval`, `expires_in`. pi는 verification URI가 `https`가 아니면 거부한다(브라우저를 여는 `open`이 다른 것을 실행하지 못하게).
* PKCE·state·redirect URI 없음.

### 3.4 token 교환 / refresh
* 모두 form. 응답 `access_token`, `refresh_token`, `expires_in`(없으면 3600초로 가정). 만료 = `now + expires_in*1000 - 5분`.
* refresh: `grant_type=refresh_token`, `client_id`, `refresh_token`. **refresh 응답이 `refresh_token`을 생략할 수 있다**(회전 안 할 때). 생략되면 이전 값을 유지한다(pi). omp는 JWT `exp`로 만료 임박(skew)을 판단하는 helper도 갖고 있다.

### 3.5 계정 식별
* access token이 JWT. payload의 `sub`(안정적인 xAI subject UUID)를 account id로 쓴다. omp는 `GET https://auth.x.ai/oauth2/userinfo`(Bearer, redirect는 오류 처리)로 `sub`/`email`/`name`을 선택적으로 보강한다. pi는 식별 안 함.

### 3.6 token으로 model 부르기
* **API key 길과 같은 endpoint.** `https://api.x.ai/v1`, OpenAI Responses 형식(`openai-responses`), `Authorization: Bearer <access token>`. 특별한 header·system 머리말 강제는 못 찾았다. omp는 User-Agent를 omp로 둔다.
* omp 세부: `XAI_BASE_URL` env로 base URL을 바꿔도 **OAuth token(JWT)은 그 override로 안 보내고** 기본 `api.x.ai`에만 보낸다(token 유출 방지). `reasoning.effort`를 거부하는 model이 있어(Grok Build 등) model별로 effort param을 뺀다(`supports-reasoning-effort false`). 요청 body 50 MiB 제한과 이미지 개수 예산이 있다. SuperGrok model 일부는 문서보다 작은 context에서 거부한다(CHANGELOG: grok-4.20 계열이 1M 초과 시 `input_too_large`).
* 허용 model 목록: omp가 `xai-oauth` provider에 curated catalog를 갖는다(grok-build, grok-4.3/4.5/4.6/4.7 등, 비용 0으로 표시). 서버 `/v1/models`가 최종.
* API key 길과의 차이: key는 `XAI_API_KEY`(console 발급, 종량 과금), OAuth는 구독 한도에 합산. omp는 두 길을 별도 provider(`xai`, `xai-oauth`)로 분리했다.

### 3.7 실패 처리
* device code 실패 분기는 위. refresh 실패는 다른 provider와 같은 공통 경로. 사용량: omp는 `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`를 Bearer + `X-XAI-Token-Auth: xai-grok-cli` header로 불러 주간 credit 사용률(없으면 월 included quota)을 표시한다. host는 `grok.com`/`*.grok.com`만 허용. **OAuth token에만** 보내고 API key는 절대 이 endpoint에 보내지 않는다(주석). 이 header·host는 공식 Grok CLI가 쓰는 것을 따라 한 것이다.

### 3.8 저장 → §8.

### 3.9 정책 흔적
* 코드·README에 ToS 경고나 차단 이야기는 못 찾았다.
* 2차 자료(community extension README, OmniRoute issue): xAI는 loopback OAuth를 allowlist된 client에만 열어 주므로 Grok CLI의 공개 client id를 재사용한다고 한다. OpenCode, Hermes Agent, 공식 Grok Build CLI가 같은 방법을 쓴다는 주장이 있다. xAI의 공식 입장·약관은 확인 못 함.

## 4. 공통 메커니즘

### 4.1 refresh 동시성
* pi: `CredentialStore.modify(providerId, fn)` 안에서 refresh하고, `needsRefresh`를 lock 안에서 다시 확인한다(double-checked locking). 그래서 요청 여러 개·process 여러 개가 와도 한 번만 refresh. lock 대기만 caller signal로 취소할 수 있고, refresh 자체는 timeout 15초로만 끊는다. 실패해도 credential은 남긴다.
* omp: single-flight(process 안) + lease(여러 process, TTL 15초, 5초마다 갱신) + 저장 시 compare-and-set. refresh 직후 mint한 token을 5분 동안 재사용(provider 장애 때 refresh token만 회전시키는 것을 막음).

### 4.2 callback server
* pi: `node:http`, 기본 `127.0.0.1` bind, `localhost`로 redirect, path와 state가 맞아야 처리, 한 번만 처리(409), 응답 HTML 제공, timeout. omp는 Rust native(`crates/pi-natives/src/oauth_callback/`)와 macOS native scheme 처리까지 갖고 있다(과함).
* 붙여넣기와 callback을 **경주**시킨다: 같은 입력창이 URL/code 붙여넣기를 받고, 서버가 먼저 받으면 입력을 취소한다.

## 5. 그 밖 provider (flow 종류만)

| provider | flow |
|---|---|
| GitHub Copilot | device code (`github.com/login/device/code`), 이후 Copilot token을 따로 교환, 계정별 base URL |
| Google Gemini CLI / Antigravity (omp) | PKCE + loopback(각각 port 8085 `/oauth2callback`, 51121 `/oauth-callback`). Google 공개 client 빌림. project 발견·onboarding 호출 있음 |
| Kimi Coding (pi/omp), Qwen Portal, Z.AI, Xiaomi 등 | device code 또는 구독용 API key 붙여넣기(`plan`) |
| OpenRouter | PKCE + loopback(omp port 54549). **API key를 발급받는** 방식이라 refresh가 없음 |
| Cursor, Devin, GitLab Duo, Snowflake, Perplexity 등 (omp) | provider별 custom hook (browser PKCE, session 붙여넣기 등) |
| Radius, Meta (pi) | provider별 OAuth (확인 안 함) |

## 8. credential 저장 위치와 꼴

* pi-mono coding-agent: `~/.pi/agent/auth.json` (디렉터리는 `PI_CODING_AGENT_DIR`로 바꿈, `pi:packages/coding-agent/src/config.ts`·`core/auth-storage.ts`). file mode **0600**, 디렉터리 0700. provider id를 key로 provider당 credential 하나. OAuth 꼴: `{type:"oauth", access, refresh, expires(ms epoch), ...추가}`. Codex는 `accountId`, ChatGPT는 `clientId`·`scopes`가 붙는다. API key 꼴은 `{type:"api_key", key, env?}`. 별도로 MCP OAuth는 `mcp-auth.json`. 라이브러리(`packages/ai`)는 file을 모르고 `CredentialStore` interface만 두며 기본 구현은 메모리다.
* omp: `~/.omp/agent/agent.db` (SQLite, 설정과 auth 공용; XDG 환경이면 `$XDG_DATA_HOME/omp/agent.db`). DB 파일 0600, 디렉터리 0700 (`omp:packages/ai/src/auth/sqlite-credential-store.ts`). credential이 row 하나씩이고 provider당 **여러 계정**을 갖는다. 필드: access, refresh, expires, accountId, email, orgId, orgName, authorizedAt 등. 사용량 report cache(TTL 5분)·block 상태·refresh lease도 같은 DB에 있다. 별도 "auth broker/gateway" 프로세스가 credential을 쥐고 client에는 broker token만 주는 구성도 있다(`omp:docs/auth-broker-gateway.md`).
* 평문 저장이다. OS keychain 등 암호화는 두 구현 모두 없다.

## 9. lophn이 가져갈 만한 것

* login protocol의 모양: `login(interaction)`에 `notify(auth_url / device_code / progress)`와 `prompt(select / manual_code)`만 두고 UI는 바깥에서 그리기. 결과는 `{access, refresh, expires}` + 식별 필드.
* callback과 붙여넣기를 경주시키기. loopback 서버를 못 열어도(port 점유, SSH, container) 같은 화면에서 URL/code를 붙여넣어 끝낼 수 있다. 붙여넣는 꼴은 `code#state`, 전체 URL, query, code 단독 네 가지를 다 받는다.
* 만료 5분 전에 refresh하되 refresh token이 회전하므로 **lock 안에서 재확인 + 저장까지 한 번에**. refresh 중에는 caller 취소를 무시(회전된 token을 잃지 않으려고). 실패해도 credential을 지우지 않고 "재로그인 필요" 상태로 둔다. 저장된 credential이 있으면 env key로 몰래 떨어지지 않는다.
* provider별로 "token을 보낼 수 있는 host"를 고정하기(omp의 xAI: override base URL에는 OAuth token을 안 보냄, billing host를 `grok.com`으로 제한, OIDC discovery의 token endpoint를 `x.ai`로 제한, device code의 verification URI가 `https`인지 검사). lophn 원칙(인터넷에서 온 것을 막음)과 맞는다.
* 오류 분류: 401(refresh 한 번) / 403(plan·정책, 재시도 무의미) / 429 usage limit(계정 한도, 대기 또는 회전) / 429 일시 / `invalid_grant`(definitive, 재로그인). lophn 공통 오류 코드 일곱에 매핑하기 쉽다(`unauthorized`, `forbidden`, `unavailable`, `conflict`).
* 사용량 한도를 header로 읽어 보여 주기: Codex `x-codex-primary/secondary-*`, Claude `anthropic-ratelimit-unified-*`. 읽는 것은 제품 가치가 있고 위험이 작다.
* 계정 구분자: Codex는 `chatgpt_account_id`, Claude는 organization uuid, xAI는 `sub`. 한 email이 개인과 Team 자리를 함께 가질 수 있으므로 email이 아니라 이것을 key로.
* OpenAI는 (B) "Sign in with ChatGPT"(동적 등록, `api.openai.com` 직접)이 공식 길이므로 OpenAI 쪽은 (A)보다 (B)를 먼저 검토할 만하다. 단 preview 제한(sampling param, built-in tool 없음)이 있다.
* 시간·난수·fetch를 인자로 받는 구조는 pi의 `CredentialStore`/`AuthContext` 주입 방식이 AGENTS.md 규칙과 맞다.

## 10. 따라 하면 안 되는 것

* **Claude Code인 척하기.** pi의 stealth(`claude-cli/<ver>` UA, Claude Code tool 이름 표기, `You are Claude Code...` system 머리말), omp의 `X-Stainless-*`, `x-anthropic-billing-header`와 body hash(`cch`) 위조, 서버가 요구하는 최소 버전 따라가기는 모두 Anthropic의 client 판별을 속이는 일이다. Anthropic 공식 문서는 구독 OAuth를 "Claude Code와 native Anthropic 앱의 일반 사용"에 한정하고, third-party가 Pro/Max credential로 요청을 대신 보내는 것과 Claude.ai credential을 수집·저장·중개하는 것을 명시적으로 금지하며, 예고 없이 막을 수 있다고 한다. 유지보수도 영구 숨바꼭질이다(omp CHANGELOG의 반복되는 fingerprint 수리). lophn이 Anthropic 구독 로그인을 제품에 넣는다면 정책 판단을 사람에게 올려야 하고, 위장은 기본 선택지에서 뺀다.
* **Codex/Grok CLI의 공개 client id를 빌려 쓰기.** (A)의 `app_EMoam...`, xAI의 `b1a00492-...`, Claude Code의 `9d1c250a-...`는 각 회사 CLI의 것이다. 빌려 쓰면 consent 화면이 그 CLI 이름으로 뜨고, 회사가 allowlist·차단을 바꾸면 깨진다. 자기 client를 등록하거나(OpenAI (B)는 동적 등록이 공식) 공식으로 열린 길을 쓰는 쪽이 안전하다.
* **비공식 backend 직접 호출.** `chatgpt.com/backend-api/codex/responses`는 SLA·문서가 없고, `version`/`originator`/`x-oai-attestation`/`x-codex-*` header와 body 제약(`store:false`, sampling param 거부)을 Codex CLI에 맞춰 따라가야 한다. `x-oai-attestation`은 DeviceCheck 증명을 흉내 내는 부분이다. 따라 하지 않는다.
* 평문 token file. pi는 0600이라도 평문이다. lophn은 secret 경계(AGENTS.md: 권한·secret·sandbox)를 따로 정해야 한다. token이 model 요청의 header 말고 다른 곳(log, session, event)에 새지 않도록 하는 것이 먼저다.
* JWT를 **서명 검증 없이** 디코드해서 신뢰하는 것(account id, residency, `exp`). 표시·header 용도로만 쓰고 권한 판단에 쓰지 않는다.
* pi는 PKCE verifier를 state로 재사용한다. state와 verifier는 따로 만든다.
* omp의 규모를 흉내 내지 않는다(Rust native callback server, 계정 pool 회전, auth broker, KDL 선언 DSL, usage 예측). 프로토타입에는 과하다. 계정이 하나인 pi식 구조(provider당 credential 하나, lock 안 refresh)로 시작한다.

## 11. 확인 못 한 것

* Anthropic token endpoint가 `platform.claude.com`과 `api.anthropic.com` 중 정본이 어느 쪽인지.
* pi-mono가 요청의 401 뒤에 자동으로 refresh를 다시 하는지(resolve 단계의 선제 refresh만 확인).
* OpenAI/xAI의 공식 약관 문구, xAI의 third-party 허용 여부. 위 2차 자료는 출처가 약하다.
* omp에 OpenAI "Sign in with ChatGPT" (B)가 없는 이유(아직 안 넣은 것으로 보이나 확인 못 함).
* 이 조사 시점에 Anthropic이 third-party 구독 token을 실제로 차단 중인지(2026-02~04 보도뿐).

## 근거 path (레포 안)

* pi-mono (commit `8efd314f`)
  * `packages/ai/src/auth/oauth/{anthropic,openai-codex,openai-chatgpt,xai,pkce,callback-server,device-code,github-copilot}.ts`
  * `packages/ai/src/auth/{resolve,credential-store,types}.ts`, `packages/ai/src/providers/{anthropic,openai,openai-codex,xai}.ts`
  * `packages/ai/src/api/{anthropic-messages,openai-codex-responses}.ts`
  * `packages/coding-agent/src/core/auth-storage.ts`, `src/config.ts`, `src/modes/interactive/interactive-mode.ts`(경고), `CHANGELOG.md`
  * `packages/ai/README.md` ("OAuth Providers")
* omp (commit `58195a45`)
  * `packages/catalog/src/compat/rules/auth/{anthropic,openai-codex,openai-codex-device,xai-oauth,xai}.kdl`
  * `packages/catalog/src/compat/rules/providers/xai-oauth.kdl`, `packages/catalog/src/wire/codex.ts`
  * `packages/ai/src/registry/engine/{oauth-code,device-code,refresh}.ts`, `packages/ai/src/registry/oauth/{anthropic,anthropic-constants,openai-codex,xai-oauth,callback-server,pkce}.ts`
  * `packages/ai/src/providers/{anthropic,claude-code-fingerprint,openai-codex-responses,openai-codex-attestation,openai-shared,xai-base-url,anthropic-slow-mode}.ts`, `providers/openai-codex/request-transformer.ts`
  * `packages/ai/src/auth/{refresh,sqlite-credential-store}.ts`, `src/auth-retry.ts`, `src/error/auth-classify.ts`, `src/usage/{claude,openai-codex,xai-oauth}.ts`
  * `packages/utils/src/dirs.ts`, `docs/auth-broker-gateway.md`, `packages/ai/CHANGELOG.md`
* 공개 문서 (WebSearch/WebFetch, 2026-10-17)
  * https://code.claude.com/docs/en/legal-and-compliance (1차)
  * https://yage.ai/share/chatgpt-subscription-oauth-en-20261013.html (2차, 앞 10만 자만 읽음)
  * https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use (2차)
  * https://github.com/diegosouzapw/OmniRoute/issues/2760, `pi-xai-supergrok` README (2차, xAI)
