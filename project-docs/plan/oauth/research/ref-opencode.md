# 참고 구현 조사: opencode의 provider 구독 계정 OAuth

## 머리

* 조사 시점: 2026-10-17
* 대상 레포: GitHub `sst/opencode` (현재 `anomalyco/opencode`로 옮겨짐, API가 리다이렉트함). 얕은 clone의 HEAD는 `a49f179170b620f719fc6c25986e971af47b5268` (2026-10-17, dev branch). 이 판은 "v2" core(`packages/core`, effect 기반)다.
* 지워진 기능(Anthropic plugin)은 npm `opencode-anthropic-auth@0.0.13`(2026-01-28 publish, 마지막 판)을 `npm pack`으로 받아 tar를 풀어 읽었다. 그리고 GitHub PR/issue/release를 `gh`로 읽었다. 받은 코드는 실행·설치·build하지 않았다.
* OpenAI 쪽은 공개 문서(`developers.openai.com/siwc/...`, `learn.chatgpt.com/docs/auth`)도 읽었다.
* clean room: 코드를 옮겨 적지 않았다. 이름, path, endpoint, 값, 구조, 설계만 적는다. 실제 provider endpoint는 부르지 않았다. 사람의 home 아래 credential file은 열지 않았다.
* 확인 못 한 것은 "확인 못 함"으로 적는다. 정책 쪽 Anthropic 사정 중 뉴스·블로그에서만 본 것은 "2차 출처"로 표시한다.

## 0. 먼저 알아둘 것 (전체 구조)

* opencode는 두 세대다. v1(`packages/opencode`, auth를 plugin으로 두고 `auth.loader`가 provider `fetch`를 가로채 URL/header/body를 바꿈)과 v2(`packages/core`, 지금 dev). v2는 가로채기 대신 "integration + credential + provider settings 덮어쓰기 + `model.request` hook"으로 바뀌었다.
* v2 구조: integration(provider 계정 묶음) 아래 method(`oauth`/`key`)가 있고, oauth method는 `authorize`(url/instructions/callback)와 `refresh` 함수를 가진다. credential은 `oauth{methodID, refresh, access, expires, metadata}` / `key` / `external` 세 꼴이다.
* **refresh는 요청 때 lazy하게**: 연결을 resolve할 때 `expires`가 지금+5분보다 작으면 method의 `refresh`를 부르고 결과를 저장한다 (`packages/core/src/integration.ts`). 모델 SDK에는 access token이 "API key" 자리에 그대로 들어간다(`packages/core/src/model-resolver.ts`의 token settings: 일반 provider는 `apiKey`, anthropic은 `authToken`, vertex는 `accessToken`). 그래서 OAuth 계정과 API key 계정이 같은 SDK 길을 탄다. 다른 점은 provider plugin이 baseURL/header/model 목록을 덮어쓰는 부분뿐이다.
* credential 저장: sqlite `credential` table(`packages/core/src/credential/sql.ts`), `value` 열에 JSON. DB 파일은 `0600`으로 만든다(`packages/core/src/database/database.ts`). v1은 `auth.json`이었다(issue #37059 본문 기준 `~/.local/share/opencode/auth.json`; 이 file은 열지 않았고 issue 글에서만 봤다).
* 공통 실패 처리: `Authentication` 오류(401/403류)는 재시도 불가로 분류, `RateLimit`(429)과 `ProviderInternal`은 재시도 가능(`packages/ai/src/provider-error.ts`의 `isRetryable`, `x-should-retry` header 우선). 401을 받고 refresh를 다시 해 재시도하는 길은 v2에서 못 찾았다. refresh는 만료 5분 전 lazy 시점에만 일어난다.
* 계정 여러 개: 한 integration에 credential 여러 개를 두고 하나를 active로 고른다(`Credential.activate`, "multiple integration accounts" PR #45072).

---

## 1. Anthropic (Claude Pro/Max)

### 결론: 지금 opencode에는 Claude 구독 OAuth가 없다. 2026-03에 법무 요청으로 지웠다.

* 지운 PR: `anomalyco/opencode` #18186 "anthropic legal requests", 작성자 thdxr, 2026-03-19 merge, merge commit `1ac1a0287ccc7ee75b1ba6a0801bc18b74f502cb`. PR 본문: "Remove anthropic references per legal requests" 하고 네 가지 — `anthropic-20250930.txt` prompt file 삭제, provider hint에서 anthropic 제거, `opencode-anthropic-auth` builtin plugin 제거, provider enum에서 anthropic 제거. 건드린 file: `packages/opencode/src/plugin/index.ts`(builtin plugin 목록에서 빠짐), `session/llm.ts`(anthropic이 아닐 때만 붙던 header 분기 정리), `provider/provider.ts`(anthropic-beta header에서 oauth beta 빠짐), `cli/cmd/providers.ts`(hint), docs `providers.mdx`.
* 공지: release v1.3.0 (2026-03-22) 노트 맨 위 "Important"에 "Removed anthropic oauth plugin, see: PR 18186". docs `packages/web/src/content/docs/providers.mdx`의 Anthropic 절에 현재도 "There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this. Previous versions of OpenCode came bundled with these plugins but that is no longer the case as of 1.3.0" 라고 적혀 있고, 대신 "구독을 제로 설정으로 쓸 수 있는 곳"으로 ChatGPT Plus, GitHub Copilot, GitLab Duo를 안내한다. 번역 docs 일부(ja 등)는 옛 문구("공식 허용은 아니지만 대체로 동작")가 남아 있다.
* 후속: PR #15402(2026-02-27, 닫힘) "Remove remaining Claude Pro/Max references"는 `legal-req` branch 후속이라고 밝힌다. PR #19408(2026-03-27, 닫힘)은 API key 만드는 flow 복원 시도, PR #18674(2026-03-22 생성, 2026-05-15 닫힘)는 npm package를 vendoring하고 PKCE state 버그를 고치려던 외부 PR인데 모두 merge되지 않았다.
* 그 전 사정 (issue):
  * #6930 (2026-01-05): "OAuth로 opencode를 쓰다가 Claude Max 20으로 올리자 계정이 ban됐다"는 제보. 댓글에서 ban 원인이 oh-my-opencode plugin이라는 추측, appeal로 풀렸다는 사례도 있다.
  * #7410 "Broken Claude Max" (2026-01-09, v1.1.8): 구독 token으로 호출이 갑자기 막힘. 같은 시기 npm plugin이 0.0.7(2026-01-09)~0.0.13(2026-01-28)까지 빠르게 판을 올렸다. 이것은 서버 쪽 차단과 그에 맞춘 우회 반복으로 보인다(아래 6절 우회 요소가 그 흔적). 어느 판이 어떤 차단에 대응했는지는 확인 못 함.
  * #18329 (2026-03-20): 로그인 token 교환이 429로 실패.
* Anthropic 측 문서 (1차, 현재): `code.claude.com/docs/en/legal-and-compliance`의 "Authentication and credential use". 요지: OAuth는 Claude Free/Pro/Max/Team/Enterprise 구매자를 위한 것이고 Claude Code와 "다른 native Anthropic 앱"의 일반 사용을 위한 것이다. 제품·서비스를 만드는 개발자는 Claude Console 또는 지원되는 cloud provider의 API key를 써야 한다. "third-party developers가 자기 앱에 Claude.ai 로그인을 제공하거나 Free/Pro/Max credential로 사용자 요청을 routing하는 것을 허용하지 않는다", "개발자는 Claude.ai credential이나 session token을 수집·저장·중개할 수 없다 — 로그인은 Anthropic 자신의 flow로 끝나야 한다", "사전 통지 없이 집행할 수 있다". 수정 없는 Claude Code binary에 사용자가 자기 구독으로 로그인하는 것은 허용된다고 명시.
* 2차 출처(블로그·뉴스, Anthropic 원문 아님): 2026-01-09쯤 서버 쪽 차단, 2026-02 중순 약관/문서 갱신, 2026-03-19 opencode 제거, 2026-04 third-party harness 구독 한도 제외 보도. 날짜와 정도는 출처마다 다름(예: 1월 차단이 되돌려졌다는 글과 아니라는 글이 섞임). 확인 못 함.

### 1.1 flow 종류 (제거 전, npm `opencode-anthropic-auth@0.0.13` 기준)

* PKCE + **code 붙여넣기**. 사용자가 브라우저에서 승인하면 화면에 코드가 뜨고, 그것을 터미널에 붙여넣는다. loopback server 없음. method 이름은 "Claude Pro/Max". 같은 plugin에 "Create an API Key"(console 계정으로 로그인해 API key를 발급) method와 수동 API key 입력 method가 함께 있었다.
* 대체 flow: device code 없음.

### 1.2 client_id

* `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. 이것은 Claude Code CLI의 공개 client로 알려져 있다(scope 이름 `org:create_api_key`, 발급 endpoint 이름 `claude_cli/create_api_key`, user-agent 위장이 이를 뒷받침). opencode 자기 등록이 아니라 **Claude Code의 것을 빌렸다**. 코드 주석으로 직접 밝힌 것은 없다. 확인 못 함(추정).

### 1.3 authorize / token / redirect / scope / param

* authorize URL: `https://claude.ai/oauth/authorize` (Pro/Max). API key 발급 method는 host만 `console.anthropic.com`.
* token URL: `https://console.anthropic.com/v1/oauth/token`. device code URL 없음.
* redirect URI: `https://console.anthropic.com/oauth/code/callback` (Anthropic 호스팅 페이지가 코드를 보여줌).
* scope: `org:create_api_key user:profile user:inference` (한 문자열, 공백 구분).
* 추가 param: `code=true` (코드 표시 모드), `response_type=code`, `code_challenge_method=S256`.
* PKCE: openauth 라이브러리의 `generatePKCE`로 verifier/challenge 생성. **state를 verifier와 같은 값으로 보냈다.** 이것이 보안 결함이었고, 이후 서버가 `state == verifier`인 요청을 `400 invalid_grant`로 거절하게 됐다고 PR #18674가 주장한다(그 PR 본문 주장이며 직접 확인 못 함).
* 붙여넣는 값의 꼴: `code#state`. `#`로 쪼개 앞이 code, 뒤가 state.

### 1.4 token 교환 / refresh

* 교환: POST, **JSON body**, 필드 `code`, `state`, `grant_type=authorization_code`, `client_id`, `redirect_uri`, `code_verifier`.
* 응답 필드: `access_token`, `refresh_token`, `expires_in`. 만료 = 지금 + `expires_in`초.
* refresh: POST JSON, `grant_type=refresh_token`, `refresh_token`, `client_id`. 응답에서 refresh_token도 새로 받아 저장 → **회전하는 것으로 취급**(응답의 새 refresh를 항상 덮어씀).
* 시점: 요청 직전, `access`가 비었거나 `expires < now`일 때(skew 없음). 실패하면 예외 `Token refresh failed: <status>`.

### 1.5 계정 식별

* 하지 않았다(id_token 없음, 계정 id 저장 없음).

### 1.6 token으로 model을 부르는 법

* v1의 `auth.loader`가 provider의 `fetch`를 통째로 바꿔 끼우는 구조. SDK는 빈 `apiKey`로 만들고, 바꾼 fetch가 요청마다 아래를 한다.
  * base URL은 그대로 `https://api.anthropic.com`. `/v1/messages`로 가는 요청에 query `beta=true`를 붙인다.
  * `authorization: Bearer <access>`를 넣고 `x-api-key`는 지운다.
  * `anthropic-beta`에 `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`를 반드시 넣고, 들어온 beta 값과 합친다.
  * `user-agent`를 Claude Code CLI처럼 보이는 문자열(`claude-cli/2.1.2 (external, cli)`)로 고정.
  * system prompt 머리에 고정 문장 "You are Claude Code, Anthropic's official CLI for Claude."를 앞에 붙인다(`experimental.chat.system.transform` hook). 첫 system 항목에는 이 문장+빈 줄을 접두로도 붙인다.
  * system 텍스트에서 "OpenCode"/"opencode"를 "Claude Code"/"Claude"로 치환 — 주석 이유: "서버가 OpenCode 문자열을 막는다".
  * tool 이름 앞에 `mcp_`를 붙여 보내고(요청의 tools 정의와 messages의 tool_use block 모두), 응답 stream에서 `mcp_`를 정규식으로 떼어 돌려준다.
  * model cost를 전부 0으로 만든다(구독이라 과금 안 함 표시).
* API key 길과 다른 점: API key는 `x-api-key`로 가고 위 위장이 없다. 즉 구독 token은 "Claude Code인 척하는" 요청 모양을 서버가 요구했다는 뜻이다. 이것이 곧 ToS 쟁점의 핵심이었다.

### 1.7 실패 처리

* 401/403/429 전용 처리 없음. refresh 실패는 예외. 일반 SDK 오류 경로로 흘렀다.

### 1.8 저장

* v1 `auth.json`에 `{type:"oauth", refresh, access, expires}`. plugin이 `client.auth.set`으로 갱신 저장.

### 1.9 정책 흔적

* 위 결론 절 참고. 요약: 법무 요청으로 제거(2026-03-19), 코드 주석/PR이 "Anthropic explicitly prohibits this"(docs), 계정 ban 제보(#6930), 서버가 `OpenCode` 문자열과 비-Claude-Code 요청을 막은 흔적(plugin 주석). npm package는 npm이 "Package no longer supported"로 deprecated 처리했다(`npm view`의 deprecated 필드). 마지막 publish 2026-01-28, 소스 repo 링크 없음.

### 1.10 근거

* npm `opencode-anthropic-auth@0.0.13` `index.mjs` (전체 약 12KB, 한 file).
* `anomalyco/opencode` PR #18186 (merge `1ac1a0287`), release `v1.3.0`, PR #15402, #18674, #19408, issue #6930, #7410, #18329.
* 현재 dev(`a49f17917`) `packages/web/src/content/docs/providers.mdx` Anthropic 절(약 L337~L370). 현재 코드에는 구독 OAuth 흔적 없음(grep으로 확인). 모델 호출에 쓰는 토큰 설정은 `packages/core/src/model-resolver.ts`에 anthropic용 `authToken` 분기가 남아 있으나 OAuth method는 없다.
* 외부: `code.claude.com/docs/en/legal-and-compliance`(1차), 블로그 요약들(2차).

---

## 2. OpenAI (ChatGPT Plus/Pro)

opencode v2 dev에는 OpenAI 구독 로그인이 **세 가지 method**로 공존한다. 한 integration(`openai`) 아래 method id만 다르다.

| method id | 라벨 | 성격 |
|---|---|---|
| `chatgpt-token-sharing` | "Sign in with ChatGPT" | **OpenAI 공식 파트너 flow** (2026-09-29 도입). 현재 기본. |
| `chatgpt-browser` | "Codex browser (legacy)" | Codex CLI의 client를 빌린 옛 flow |
| `chatgpt-headless` | "Codex device code (legacy)" | 위와 같은 client의 device code |

### 2.A 공식 flow: `chatgpt-token-sharing`

#### 2.A.1 flow 종류
* PKCE + **loopback callback**. port는 OS가 고른 임의 빈 port(listen 0), host는 `127.0.0.1`, path `/auth/callback`. 대체 flow(device code)는 이 method에는 없다. 막히면 API key나 legacy method로 안내하는 오류 문구만 있다. OpenAI 문서는 "`localhost` 말고 `127.0.0.1`", "재로그인 때는 port만 달라도 됨, scheme/host/path는 같아야 함", "listener를 브라우저 열기 전에 시작"을 요구한다.

#### 2.A.2 client_id
* **자기 것을 동적으로 등록한다.** 첫 로그인에는 고정 문자열 `dynamic_agent_client`를 client_id로 보내면, callback 쿼리에 OpenAI가 발급한 client_id(예 `oaiapp_...` 꼴)가 돌아온다. 이것을 저장해 이후 모든 로그인/token 교환/refresh에 쓴다. 앱 이름 힌트(`agent_name_hint`)는 첫 등록 때만 보낸다(opencode는 "OpenCode"). client secret, 파트너 API key 없음. 재인증 callback에 client_id가 없을 수 있어 시작할 때 쥐고 있던 값을 쓰고, 다른 값이 오면 거절한다(PR #52162).
* 공식 문서 문구: 현재 open-source 클라이언트와 일부 private 클라이언트에 plan usage 허용, 상업 파트너는 별도 trial. opencode는 16개 launch partner 중 하나로 보도됨(2차 출처).

#### 2.A.3 endpoint / param
* authorize: `https://auth.openai.com/api/accounts/authorize`
* token: `https://auth.openai.com/api/accounts/oauth/token`
* JWKS: `https://auth.openai.com/.well-known/jwks.json`, issuer `https://auth.openai.com`
* redirect URI: `http://127.0.0.1:<port>/auth/callback`
* scope: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`
* authorize param: `response_type=code`, `client_id`, `redirect_uri`, `scope`, `resource=https://api.openai.com/v1`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, `ext_agent_host_id`(필수: 이 설치에 고유하고 안정적인 `urn:uuid:...`; plugin storage에 한 번 만들어 저장), 첫 등록 때만 `agent_name_hint`. `id_token_hint`/`login_hint`는 문서상 선택(opencode는 안 보냄). `force_reconsent`는 주석 처리됨.
* PKCE: verifier는 43자 unreserved 문자 랜덤, challenge는 SHA-256 base64url. state, nonce는 각각 32바이트 랜덤 base64url. 매 시도마다 새로 만든다.
* 완료 검사: token 응답의 `scope`에 `chatgpt.tokens.use.direct`가 없으면 실패("token sharing 없이 끝남, 다시 로그인하거나 API key로"). id_token 없으면 실패.

#### 2.A.4 token 교환 / refresh
* 교환: POST, **form(urlencoded)**, `grant_type=authorization_code`, `client_id`(발급받은 것), `code`, `code_verifier`, `redirect_uri`(authorize와 port까지 동일), `resource`. 응답: `access_token`, `refresh_token`, `id_token`, `expires_in`, `scope`. 만료 = 지금 + `expires_in`(없으면 3600초).
* refresh: POST form, `grant_type=refresh_token`, `client_id`, `refresh_token`, `resource`. 응답에서 scope가 오면 갱신. OpenAI 문서: **refresh token은 회전**하므로 성공 후 access, 만료, scope, refresh를 한꺼번에 교체해야 한다.
* 시점: 위 0절의 lazy(만료 5분 전). 동시 refresh 보호는 이 plugin에서는 못 봄(확인 못 함).

#### 2.A.5 계정 식별
* id_token을 **서명 검증**(JWKS, RS256, issuer 일치, audience == 발급 client_id, `exp`·`nonce`·`sub` 필수, nonce가 이번 시도 값과 일치, `sub` 공백 아님). 식별 값은 검증된 `sub`. OpenAI 문서: email과 sub는 workspace id가 아니니 client_id를 같이 저장하라. (opencode는 현재 `sub`를 credential에 따로 저장하지 않고 client_id와 scopes만 metadata에 둠.)

#### 2.A.6 model 호출
* base URL `https://api.openai.com/v1`, 일반 `/responses`. **public API endpoint**를 쓴다. 문서가 "ChatGPT의 `backend-api`를 가리키지 말라"고 명시. 이것이 legacy Codex 길(2.B)과 가장 큰 차이다.
* `Authorization: Bearer <access>`. opencode는 추가로 Codex 클라이언트처럼 `session-id`(prompt cache affinity용), `thread-id`, `x-client-request-id` header를 보낸다.
* 문서상 요청 몸에 `store: false`, `stream: true` 강제(opencode route 기본이 stateless). 허용 model은 계정마다 다르다: 문서는 `GET /v1/models`(같은 Bearer)에서 `visibility == "list"`만 보이라고 한다. opencode는 `/models` 동기화를 2026-10-06부터 **꺼두고**(OpenAI 쪽 버그 때문, PR #53466 / issue #52878) 하드코딩 허용 목록(gpt-5.5, gpt-5.6-*, gpt-6-*, gpt-6.1-sol 및 `-fast` 변형)과 models.dev catalog 교집합만 연다. "pro" reasoning mode model은 끈다. cost는 비움.
* 요청 body 압축: ChatGPT 쪽이 비압축 약 1MiB 초과를 거절하고 **zstd**를 푼다 → opencode가 zstd `content-encoding`을 기본으로 켠다(사용자가 baseURL을 바꾸면 안 켬).
* 안 되는 것: native `/responses/compact`(요약 방식 compaction으로 대체), 세션 중 reasoning effort 변경(PR #54085로 막음), 출력 한도(maxTokens)는 보내지 않는 쪽이 안전(legacy 쪽 주석).
* 전송: HTTP(`transport: "http"`)로 고정.

#### 2.A.7 실패 처리
* 오류 code를 body에서 부분 문자열로 찾는다. **재시도 금지** 목록: `subscription_sharing_usage_limit_exceeded`, `..._user_not_eligible`, `..._unsupported_capability`, `..._route_not_supported`, `..._invalid_user`, `chatpass_v2_scope_not_authorized`, `chatpass_v2_invalid_authorization_context`. 429여도 위 code면 재시도 안 한다. stream 도중 `response.failed`로도 올 수 있어 HTTP body와 stream 둘 다 본다. 사용자 문구: 한도 도달 → "ChatGPT Settings → Usage 확인", 부적격 → "API key로 연결하거나 다른 provider", invalid_user → "다시 연결". 그 밖 `subscription_sharing_usage_unavailable`, `..._user_unavailable`은 안내 문구만(재시도 목록엔 없음).
* 401/403 일반 처리는 0절의 공통(재시도 안 함). 자동 재로그인 없음.

#### 2.A.8 저장
* credential `oauth` 값의 `metadata`에 `{clientID, scopes}`. `refresh/access/expires`는 일반 필드. 별도로 plugin storage에 `ext_agent_host_id`를 저장. 모델 목록 cache는 `models:<clientID>` key(현재 `/models` 동기화 꺼짐).

#### 2.A.9 정책 흔적
* **OpenAI가 공식으로 허용하는 길**이다. 도입 PR #52147(2026-09-29, 작성자 rekram1-node), 후속 #52162 "align with updated partner guide" — "partner guide"라는 말을 쓰고 guide가 오류 code를 개정했다고 한다. PR #52147 본문에 "Live sign-in and inference have not been verified"라는 문구가 있다(당시 기준).
* OpenAI 공식 문서(1차): `developers.openai.com/siwc/quickstart` — 앱이 사용자 ChatGPT 계정으로 로그인하고, 허용되면 plan 사용량으로 요청을 보낸다. 권한이 둘로 나뉜다(신원 sign-in / "Use your ChatGPT plan"). plan usage는 open-source 파트너 전체와 선별된 private 클라이언트에 열려 있고, 사용자가 ChatGPT 설정에서 앱별 주간 한도를 둘 수 있으며, 한도에 닿으면 멈춘다(2차 보도 포함). 로그인 button 문구 "Continue with ChatGPT". 대화나 API key에 대한 접근은 주지 않는다. 약관 세부(어느 plan이 되는지)는 문서에 없음.
* 이 flow는 "지금은 open-source 클라이언트 대상"이라는 조건이 붙는다. 상업 앱 적용 가능성은 확인 못 함.

#### 2.A.10 근거
* `packages/core/src/plugin/provider/chatgpt.ts`(544줄), `packages/core/src/session/to-session-error.ts`, 테스트 `packages/core/test/plugin/provider-chatgpt.test.ts`.
* PR #52147, #52162, #53466, #53767(session header), #54085(effort), #54932(body encoding); 파일 history `chatgpt.ts` 첫 commit `4d9090790`(2026-09-29).
* 외부 1차: `developers.openai.com/siwc/token-sharing-open-source/sign-in`, `.../models-and-inference`, `.../siwc/quickstart`.

### 2.B legacy: Codex client 빌린 길 (`chatgpt-browser` / `chatgpt-headless`)

#### 2.B.1 flow 종류
* browser: PKCE + loopback. 고정 port **1455**, 실패하면 port 1457. 이미 쓰는 중이면 `/cancel`을 먼저 호출해 옛 Codex CLI의 listener를 내리게 하고 재시도(최대 10회, 200ms 간격). 둘 다 쓰는 중이면 오류 문구로 "device code로" 안내. redirect host는 `localhost`.
* headless: Codex의 device code 흐름(OpenAI 자체 endpoint, RFC 8628과 꼴이 다름). 원격/SSH용 대체.

#### 2.B.2 client_id
* `app_EMoamEEZ73f0CkXaXp7hrann` — **Codex CLI의 공개 client**로 알려진 값. 자기 등록 아님, 빌림. 코드에 출처 주석은 없음(Codex CLI 것이라는 점은 `codex_cli_simplified_flow` param, 포트 1455, 문서의 `localhost:1455`로 추정).

#### 2.B.3 endpoint / param
* authorize: `https://auth.openai.com/oauth/authorize`, token: `https://auth.openai.com/oauth/token`
* redirect: `http://localhost:<1455|1457>/auth/callback`
* scope: `openid profile email offline_access`
* 추가 param: `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=opencode`, `state`, `code_challenge(S256)`.
* device: `POST https://auth.openai.com/api/accounts/deviceauth/usercode`(JSON `{client_id}`) → `device_auth_id`, `user_code`, `interval`(문자열). 사용자는 `https://auth.openai.com/codex/device`에서 code 입력. 폴링 `POST .../api/accounts/deviceauth/token`(JSON `{device_auth_id, user_code}`): 403/404면 대기, 성공하면 `authorization_code`와 `code_verifier`를 서버가 돌려줌 → 다시 `/oauth/token`에 교환(redirect_uri `https://auth.openai.com/deviceauth/callback`). 폴링 간격 = interval + 3초 안전 여유.

#### 2.B.4 token 교환 / refresh
* 교환: form, `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`. 응답 `id_token`, `access_token`, `refresh_token`, `expires_in`. 만료 = 지금+`expires_in`(없으면 3600). refresh: form, `grant_type=refresh_token`, `refresh_token`, `client_id`. 회전 여부는 코드가 새 refresh를 항상 덮어쓰므로 회전을 가정한 구조.

#### 2.B.5 계정 식별
* id_token(없으면 access_token) JWT payload를 **서명 검증 없이** 디코드해 `chatgpt_account_id`, 또는 `https://api.openai.com/auth` claim 안의 `chatgpt_account_id`, 없으면 `organizations[0].id`를 꺼냄. metadata `accountID`로 저장.

#### 2.B.6 model 호출
* base URL을 `https://chatgpt.com/backend-api/codex`로 바꾼다(provider settings 덮어쓰기 + `model.request` hook에서 `api.openai.com` origin이면 교체). 경로는 그 아래 `/responses`.
* header: `Authorization: Bearer <access>`, `chatgpt-account-id: <accountID>`, `originator: opencode`, `x-codex-beta-features: remote_compaction_v2`, `session-id`.
* model 제한: ChatGPT 계정 token은 codex 적격 model만 허용 → 허용 이름(gpt-5.5, gpt-5.3-codex-spark)과 "gpt-5.5 초과 버전" 규칙으로 걸러 나머지를 끔(주석: 2026-08-31에 gpt-5.4, gpt-5.4-mini가 ChatGPT 계정 Codex에서 빠짐). pro 계열 끔. context/input 한도를 Codex CLI와 맞춤(400k/272k 등, gpt-6.1-sol은 628k/500k). 비압축 약 1MiB 초과 거절 → zstd. 출력 maxTokens 제거(백엔드가 거절하고 rate limit에 합산된다는 주석). 전송 기본 websocket.
* API key 길과의 차이: API key는 `api.openai.com/v1`, 구독 token은 `chatgpt.com/backend-api/codex`와 계정 header. 즉 비공식 내부 endpoint다.

#### 2.B.7 실패 처리
* 공통(0절)만. token-sharing 오류 code 처리는 없음.

#### 2.B.8 저장
* 같은 credential 꼴, metadata는 `{accountID}`. 옛 `chatgpt-browser` credential을 새 `chatgpt-token-sharing`으로 "옮기는" 코드가 chatgpt.ts에 있다(client id가 있는 것만).

#### 2.B.9 정책 흔적
* 라벨이 PR #53451/#53467(2026-10-05~06)에서 "legacy"로 바뀜. Codex client를 빌리는 길이라 공식 길이 생기자 legacy로 강등된 것으로 보임(이유는 PR 본문에 명시 안 됨, 추정). v1.3.0 노트에 "Codex Access (#18337): OAuth plan users can now access codex instructions freely without the previous whitelisting restrictions" 한 줄. docs는 "ChatGPT Plus는 제로 설정으로 쓸 수 있다"고 안내.

#### 2.B.10 근거
* `packages/core/src/plugin/provider/openai.ts`(438줄). release v1.3.0. 최신 관련 commit `d318cf412`(label 변경), `5673bfa4a`(body encoding).

---

## 3. xAI (SuperGrok)

### 3.1 flow 종류
* 현재: **device code만**(RFC 8628). method id `device`, 라벨 "SuperGrok Subscription". 로컬/원격 모두 이것 하나.
* 이전(v1, 2026-05-21 PR #28557 ~ 2026-08-05): PKCE + loopback(고정 `127.0.0.1:56121/callback`)과 device code 두 가지. 2026-08-05 PR #40538이 "browser와 device 둘이 있어 혼란이 더 컸다, device UX도 동등하다"며 browser를 지움. 옛 `browser` credential은 데이터 그대로 `device` method로 옮긴다.

### 3.2 client_id
* `b1a00492-073a-47ea-816f-4c329264a828` — **Grok CLI의 공개 client를 빌림**. v1 코드 주석: "xAI auth server는 allowlist에 없는 client의 loopback OAuth를 거절하므로, xAI가 desktop OAuth용으로 배포하는 Grok-CLI client_id를 재사용한다. 근거: hermes-agent PR #26534". 자기 등록 아님. 고정 port 56121도 그 client의 등록 redirect에 묶여 있어 지켜야 했다.

### 3.3 endpoint / param
* issuer 기준 `https://auth.x.ai/oauth2`: authorize `/authorize`(옛 browser), token `/token`, device code `/device/code`.
* scope: `openid profile email offline_access grok-cli:access api:access`.
* device 요청: POST form(`client_id`, `scope`, `referrer=opencode`) → `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`(선택), `expires_in`, `interval`. 사용자에게 `verification_uri_complete`(없으면 `verification_uri`)를 열고 `user_code` 입력하게 안내.
* 폴링: POST `/token` form, `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id`, `device_code`. 오류 `authorization_pending`이면 대기, `slow_down`이면 간격 +5초, `access_denied`/`authorization_denied`면 거부, `expired_token`이면 만료. 대기 = interval + 3초 여유, 기본 interval 5초, 기본 만료 5분.
* 옛 browser: authorize param에 `plan=generic`(주석: 없으면 accounts.x.ai가 non-allowlist client의 loopback OAuth를 거절), `referrer=opencode`, `nonce`, `state`, S256. `referrer=opencode`는 xAI가 opencode 발 로그인을 구분하게 하는 attribution 용도로 주석에 적혀 있다.

### 3.4 token 교환 / refresh
* form 전부. 응답: `access_token`, `refresh_token`(선택), `expires_in`(선택). 만료 = `expires_in`이 있으면 지금+그 값, 없으면 access token(JWT)의 `exp` claim, 그것도 없으면 1시간.
* refresh: form `grant_type=refresh_token`, `refresh_token`, `client_id`. 응답에 refresh_token이 없으면 기존 것을 유지.
* **refresh token 회전함**(issue #37059): 한 process가 refresh하면 옛 token이 폐기되어 다른 process가 `invalid_grant "Refresh token has been revoked"`를 받는다. 이슈 보고에 따르면 process 내 single-flight는 있고 process 간 조정은 없었다(60일 무활동으로 자동 닫힘, 해결 안 됨). access token 수명은 이슈에서 약 6시간이라 함. Grok CLI와 같은 client를 쓰므로 Grok CLI와도 충돌 가능(이슈 주장).
* 시점: v2는 0절 lazy(만료 5분 전). v1은 만료 120초 전 또는 JWT exp 근접 시 fetch 안에서.

### 3.5 계정 식별
* 하지 않음(id_token 안 읽음, metadata 비어 있음).

### 3.6 model 호출
* base URL 기본 `https://api.x.ai/v1`을 **그대로** 쓴다. v1 주석: baseURL을 덮어쓰면 SDK 기본값을 조용히 바꾸므로 일부러 설정 안 함. access token을 API key 자리(`Authorization: Bearer`)에 넣는다. v1은 fetch를 가로채 Bearer를 교체하고 `User-Agent: opencode/<버전>`을 붙였다.
* API: `/responses`(+ websocket 전송, 기본 `store:false`, `include reasoning.encrypted_content`) 또는 `/chat/completions`. websocket은 약 24분마다 연결 회전. 즉 구독 token도 **API key와 같은 공개 API endpoint, 같은 경로**를 쓴다. 별도 header나 몸 강제는 없다. 허용 model 제한도 코드에서 못 찾음(확인 못 함).

### 3.7 실패 처리
* device 폴링 오류는 위 분기. refresh 실패 문구 "xAI token refresh failed (status)". 401/403/429 전용 처리 없음(공통).

### 3.8 저장
* credential `oauth{methodID: "device", refresh, access, expires, metadata}`.

### 3.9 정책 흔적
* 코드에서 약관·제휴 언급은 못 찾음. 다만 Grok CLI client를 빌렸고 `referrer=opencode`로 출처를 밝히는 방식이다. xAI가 이 사용을 공식 허용한다는 문구는 확인 못 함. PR #40538은 "다른 XAI integration들의 방식과도 맞다"고만 적음.

### 3.10 근거
* `packages/core/src/plugin/provider/xai.ts`(236줄), `packages/ai/src/providers/xai.ts`, v1 `packages/opencode/src/plugin/xai.ts`(tag `v1.18.1`, 626줄), PR #28557, #36955, #40538, issue #34778, #36917, #37059.

---

## 4. 그 밖 provider (이름과 flow 한 줄)

* GitHub Copilot: GitHub OAuth app의 **device code** (client `Ov23li8tweQw6odWQebz`, scope `read:user`), github.com 또는 Enterprise 도메인 선택, 로그인 후 `copilot_internal/user`로 Copilot 권한 확인, 호출은 `api.githubcopilot.com`(Enterprise는 `copilot-api.<도메인>`). docs가 "제로 설정으로 쓸 수 있는 구독"으로 안내.
* GitLab(Duo): 인스턴스별 OAuth, PKCE + loopback, 번들 client_id 또는 `GITLAB_OAUTH_CLIENT_ID` 환경변수로 자기 앱.
* DigitalOcean: OAuth(브라우저), scope `genai:read inference:query`.
* Poe: 브라우저 OAuth, 응답의 `api_key`를 access로 저장(refresh 없음).
* OpenCode Console(자체 서비스): device code, client `opencode-cli`.
* Snowflake Cortex: 로컬 loopback OAuth, 내장 client `LOCAL_APPLICATION`.

---

## 5. lophn이 가져갈 만한 것

* **OpenAI는 token-sharing(공식 partner flow)을 1순위로 본다.** 동적 client 등록(`dynamic_agent_client` → 발급 client_id 저장), `ext_agent_host_id`, `resource`, `chatgpt.tokens.use.direct` scope 확인, id_token 서명·nonce·audience 검증, public `api.openai.com/v1/responses`로 부름(`store:false`, `stream:true`), 오류 code별 재시도 금지. 정책 위험이 가장 낮다. 단 대상이 "open-source 클라이언트 / 선별 클라이언트"라서 lophn이 해당되는지는 OpenAI 쪽에 확인이 필요하다(사람이 정할 일).
* 구조: method(`oauth`/`key`)가 `authorize`와 `refresh`를 가지고, credential은 한 꼴(`oauth{refresh, access, expires, metadata}`)로 통일. refresh는 요청 직전 lazy(만료 5분 전). OAuth 계정과 API key 계정이 같은 model SDK 길을 타고, 다른 건 provider plugin이 덮어쓰는 설정(baseURL, header, 허용 model)뿐이다.
* 시도(attempt) 상태 기계: authorize가 url+callback을 돌려주고, 시도마다 만료 시각을 두며(기본 10분, provider가 정할 수 있게) 취소·완료가 분리됨. loopback server는 시도가 끝나면 닫는다(finalizer).
* loopback: `127.0.0.1` 고정, 임의 port(공식 flow) 또는 고정 port(빌린 client는 등록 redirect에 묶임). 콜백 `state` 불일치·code 없음은 즉시 실패 + 사용자에게 오류 페이지.
* device code(RFC 8628): `authorization_pending`/`slow_down`(+5초)/`expired_token`/`access_denied` 처리, 폴링 간격에 안전 여유 3초. 원격·SSH 환경용 대체로 좋다. xAI는 아예 device만 쓰는 쪽이 UX와 지원 면에서 낫다고 판단해 browser를 지웠다.
* 만료 계산: `expires_in` 우선, 없으면 JWT `exp`, 그것도 없으면 1시간.
* refresh token 회전 가정: 응답의 새 refresh를 항상 저장하고, 없으면 기존 것 유지. **한 refresh token을 여러 process가 쓰면 서로 폐기한다**(xAI issue #37059). lophn은 refresh를 한 곳(single-flight, process 간이면 file lock이나 한 process만)에서만 하게 설계해야 한다.
* 오류 code를 body에서 찾아 "재시도 금지"로 분류, 사용자 문구는 행동 지시(다시 연결 / API key로 / 한도 확인).
* DB 파일 `0600`, token은 DB의 JSON 열. 로그에 token 안 남김.
* 계정 여러 개와 active 선택.

## 6. 따라 하면 안 되는 것

* **Anthropic 구독 OAuth 전체.** Claude Code client_id 빌리기, `claude.ai` authorize + code 붙여넣기, `anthropic-beta: oauth-...` 강제, user-agent를 Claude Code CLI로 위장, system prompt를 "You are Claude Code..."로 시작하게 하기, "OpenCode" 문자열 치환, tool 이름 `mcp_` 접두 우회. Anthropic이 문서로 금지한다고 밝혔고(`legal-and-compliance`), 계정 ban 제보가 있었고, opencode는 법무 요청으로 2026-03에 지웠다. lophn은 Anthropic은 API key(또는 Anthropic이 허용하는 길)만 둔다. 구독 OAuth가 필요하면 Anthropic 정책 변화를 따로 확인한 뒤 결정(이 조사로는 허용 길을 확인 못 함).
* state에 PKCE verifier를 재사용하는 것(opencode Anthropic plugin의 결함). state·nonce·verifier는 각각 독립 랜덤.
* 다른 제품의 공개 client_id를 빌리는 것(Codex CLI `app_...`, Grok CLI `b1a00492-...`, Claude Code `9d1c250a-...`). 해당 vendor가 막으면 하루아침에 깨지고, 고정 port·redirect에 묶이며, 정책상 위험하다. xAI는 `referrer=opencode`로 출처만 밝히는 정도라 허용 근거가 못 된다. 쓴다면 "비공식, 언제든 깨짐"으로 격리해야 한다.
* ChatGPT 내부 endpoint(`chatgpt.com/backend-api/codex`)로 보내기. 공식 문서가 "backend-api를 가리키지 말라"고 한다. `chatgpt-account-id`, `originator`, `x-codex-beta-features` 같은 Codex 모사 header에 의존하는 것도 마찬가지.
* id_token을 서명 검증 없이 payload만 디코드해 계정 id로 쓰는 것(legacy Codex 길). 쓰려면 검증(JWKS, issuer, audience, nonce)을 하는 token-sharing 쪽을 따른다.
* fetch를 통째로 가로채 URL/header/body를 바꾸는 v1식 구조. 요청 변조가 숨은 곳에 퍼져 추적이 어렵다. v2처럼 provider 설정 덮어쓰기와 명시적 hook으로 한정하는 편이 낫다.
* 구독 token의 과금을 0으로 표시해 사용량 한도를 숨기는 것. OpenAI는 사용자가 앱별 한도를 정하고 한도에서 멈추는 모델이므로 한도·사용량 오류를 그대로 사용자에게 보여야 한다.
