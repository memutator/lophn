# 참고 구현 조사: Hermes Agent의 provider 구독 OAuth

* 조사 시점: 2026-10-17
* 레포: `NousResearch/hermes-agent` (Python), `git clone --depth 1`, commit `868b9f244f5aa3ad238e494048046fe4f29c28ba` (2026-10-17). shallow라 history(도입 시점, 옛 구현)는 못 봤다.
* clean room: 코드를 옮겨 적지 않았다. 이름, path, endpoint, 값, 구조, 설계만 적는다. 받은 코드는 읽기만 했고 실행·설치·import하지 않았다. 사람 home의 credential file은 열지 않았다. 실제 provider endpoint도 부르지 않았다.
* 외부 근거(WebSearch/WebFetch)는 해당 항목에 "외부"라고 표시했다. 제3자 글이라 확정이 아니다.
* 근거 path는 모두 레포 루트 기준이다. 핵심 파일: `hermes_cli/auth_constants.py`(상수), `hermes_cli/auth_xai.py`, `hermes_cli/auth_codex.py`, `hermes_cli/auth_codex_browser.py`, `hermes_cli/auth_device_flow.py`(PKCE, loopback, device 공용), `agent/anthropic_credentials.py`, `agent/anthropic_adapter.py`, `agent/codex_headers.py`, `agent/codex_responses_adapter.py`, `agent/credential_pool.py`, `agent/turn_recovery.py`, `agent/error_classifier.py`, `website/docs/guides/xai-grok-oauth.md`, `website/docs/integrations/providers.md`, `website/docs/user-guide/security.md`.

## 한눈에 보기

| provider | 기본 flow | 대체 flow | client | 다른 도구 credential 읽기 |
|---|---|---|---|---|
| Anthropic (Claude Pro/Max) | PKCE + code 붙여넣기 (loopback 없음) | 없음 (env token, `claude setup-token`) | Claude Code의 client_id를 빌림 | 있음: `~/.claude/.credentials.json`, macOS Keychain |
| OpenAI Codex (ChatGPT) | device code (기본) | PKCE + loopback `:1455` (opt-in) | Codex CLI의 client_id를 빌림 | 있음: `~/.codex/auth.json` (묻고 가져오기, refresh 실패 시 자동 복구) |
| xAI (SuperGrok) | device code (OIDC discovery) | 없음 (옛 버전은 loopback PKCE였던 흔적) | Grok CLI의 client_id로 보임 | 코드에는 없음 (`~/.grok/auth.json`은 외부 도구에서 확인) |
| Nous Portal | device code | 없음 | 자기 것 (`hermes-cli`) | 없음 |
| GitHub Copilot | device code (GitHub) | `gh auth token` 등 env | VS Code의 GitHub App client_id를 빌림 | `gh` CLI token |
| Qwen | 외부 파일 읽기 (qwen-cli token file) | - | - | 있음 |
| MiniMax | user_code(device 변형) + PKCE | - | 자기 것으로 보이는 UUID | 없음 |
| OpenRouter | PKCE, token 대신 API key를 받음 | - | - | 없음 |

공통 설계: refresh token은 모두 single-use 회전으로 취급하고, 저장·refresh를 lock 안에서 한다. 다른 도구와 같은 token family를 공유하면 서로 무효화하므로 "별도 login을 따로 받는 것"을 권한다.

---

## 1. Anthropic (Claude Pro/Max)

### 1.1 flow 종류
* 기본: authorization code + PKCE(S256). **loopback 서버 없음.** 브라우저로 authorize URL을 열고, 승인 후 화면에 보이는 code를 사용자가 터미널에 **붙여넣는다**. 브라우저는 `webbrowser.open`으로 자동으로 열되 못 열면 URL만 출력한다. (`agent/anthropic_credentials.py`의 Hermes PKCE login 함수)
* 대체: (a) env `ANTHROPIC_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`에 `claude setup-token`이 만든 token을 넣는다. `claude` CLI가 있으면 `claude setup-token`을 subprocess로 띄우는 함수도 있다. (b) Claude Code가 이미 로그인해 둔 credential을 빌린다. (c) 일반 API key.
* web dashboard에서는 일부러 Connect 단추를 안 만들었다. 이유가 코드 주석에 있다: HTTP endpoint로 Claude 구독 token을 발급할 수 있게 두면 Anthropic의 OAuth 사용 정책에 어긋난다 (`hermes_cli/web_server_oauth.py`, provider 목록의 `flow: external` 항목 위 주석).

### 1.2 client_id
* `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. Claude Code의 public client다. 코드 주석이 "Claude Code / pi-ai / OpenCode를 따른다"고 직접 적었다. 자기 client를 등록한 것이 아니다.
* 다른 도구 credential 읽기: Claude Code의 `~/.claude/.credentials.json`(`CLAUDE_CONFIG_DIR`가 있으면 그 아래), macOS Keychain의 `Claude Code-credentials` 항목. 둘 다 `claudeAiOauth` 객체 안에 `accessToken`, `refreshToken`, `expiresAt`(ms)가 있는 꼴. 둘이 어긋나면 만료 안 된 쪽, 둘 다면 더 늦은 `expiresAt`을 쓴다. refresh를 하면 원본 file과 Keychain에 **다시 써 준다**(single-use 회전 때문에 둘이 갈라지지 않게). 끄는 설정은 `auth.adopt_external_logins: false`.
* 우선순위: env token, `ANTHROPIC_API_KEY`, Hermes가 직접 받은 OAuth(credential pool), 마지막이 빌린 Claude Code login.

### 1.3 URL, scope, param
* authorize: `https://claude.ai/oauth/authorize` (console.anthropic.com이 아니다).
* redirect URI: `https://console.anthropic.com/oauth/code/callback` (사용자 PC로 오지 않는다. 그 페이지가 code를 화면에 보여 준다).
* scope: `org:create_api_key user:profile user:inference`.
* authorize query: `code=true`, `client_id`, `response_type=code`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method=S256`, `state`.
* PKCE verifier: 랜덤 32바이트를 base64url(패딩 없음). challenge: SHA-256의 base64url(패딩 없음). state: `secrets.token_urlsafe(32)`.
* **붙여넣는 값의 꼴: `<code>#<state>`**. `#`로 쪼개서 뒤쪽 state를 우리가 만든 state와 비교하고, 다르면 중단한다.

### 1.4 token 교환, refresh
* token URL: 먼저 `https://platform.claude.com/v1/oauth/token`, 실패하면 `https://console.anthropic.com/v1/oauth/token`(코드 주석: 후자는 404지만 fallback으로 둠). 단 dead grant(`invalid_grant` 등)는 다음 endpoint로 넘기지 않는다.
* 교환 요청: **JSON** body. 필드: `grant_type=authorization_code`, `client_id`, `code`, `state`, `redirect_uri`, `code_verifier`.
* **User-Agent 주의**: token endpoint는 UA가 `claude-code/`로 시작하거나 Mozilla면 429를 준다고 주석에 있다. 실제 CLI처럼 `axios/1.7.9`를 보낸다. 반대로 inference 쪽은 `claude-code/<버전>`이 필요하다.
* refresh 요청: 기본 form(`application/x-www-form-urlencoded`), 옵션으로 JSON. 필드: `grant_type=refresh_token`, `refresh_token`, `client_id`. 응답에 새 refresh token이 없으면 옛 것을 유지.
* 응답 필드: `access_token`, `refresh_token`, `expires_in`(없으면 3600초로 간주). 만료 계산: 받은 시각 + `expires_in`을 ms epoch(`expiresAt`)로 저장. access token은 JWT가 아닌 `sk-ant-oat...` 불투명 문자열이라 exp를 읽을 수 없다.
* refresh 시점: 저장한 `expiresAt` 기준 만료 임박(60초 buffer)이면 refresh. 그 전에 live source(Claude Code file/Keychain)를 다시 읽어 **다른 process가 이미 회전시켰으면 그 새 token을 채택**한다. 401을 받으면 1회 강제 refresh 후 재시도.
* refresh token은 single-use. 회전은 성공했는데 새 값을 디스크에 못 쓴 경우를 위해 "소비됨" 지문 registry(process 내부 + file 옆 sidecar)를 둬서 이미 쓴 token을 다시 보내지 않는다. 쓰기 실패는 `CredentialPersistError`로 올린다.
* 죽은 grant 판정: HTTP 400/401 + error가 `invalid_grant` / `invalid_token` / `refresh_token_reused`.

### 1.5 계정 식별
* 하지 않는다. `sk-ant-oat` token은 claim이 없다. 코드 주석: "Anthropic token carry none". id_token도 안 쓴다.

### 1.6 token으로 model 부르기 (일반 API key와의 차이)
* base: `https://api.anthropic.com`, native Messages API(`/v1/messages`)만. 코드 주석에 따르면 OpenAI 호환 shim(`/chat/completions`)을 타면 별도 "extra usage" pool로 계산되어 400이 난다.
* 판별: key가 `sk-ant-api` / `-usr` / `-svc` / `-admin` 접두면 API key(`x-api-key`), 그 밖의 `sk-ant-*`, `eyJ`, `cc-`는 OAuth로 본다. host가 정확히 `api.anthropic.com`(또는 provider가 anthropic)일 때만 OAuth 변환을 적용한다. 제3자 Anthropic 호환 endpoint에는 절대 적용하지 않는다.
* OAuth일 때 header: `Authorization: Bearer <token>` (SDK의 auth_token), `anthropic-beta`에 `claude-code-20250219`, `oauth-2025-04-20`을 공통 beta(`interleaved-thinking-2025-05-14`, `fine-grained-tool-streaming-2025-05-14`, 필요시 `context-1m-2025-08-07`)에 더한다. `user-agent: claude-code/<설치된 claude --version, 못 찾으면 fallback 2.1.74> (external, cli)`, `x-app: cli`. 코드 주석: 이 identity가 없으면 간헐적으로 500, UA 버전이 실제보다 너무 낮으면 거절("Claude Code X does not support this model").
* 요청 몸 변환(OAuth 때만):
  * `system` 맨 앞에 별도 text block `You are Claude Code, Anthropic's official CLI for Claude.`를 추가한다.
  * 나머지 system 문구의 자기 이름("Hermes Agent", "Nous Research" 등)을 "Claude Code", "Anthropic"으로 바꾼다 (서버 content filter 회피 목적이라고 주석).
  * tool 이름을 `mcp__<이름>` 꼴로 바꾼다. 단일 밑줄 `mcp_`는 제3자 앱 지문으로 분류되어 400 "Third-party apps now draw from extra usage". 특정 tool 이름(`session_search`, `memory`)은 다른 이름으로 alias하고 응답에서 되돌린다. 과거 tool_use block의 이름도 같이 바꾼다.
  * system prompt의 특정 한 문장이 "billing처럼 보이는 400(You're out of extra usage)"을 일으킨 사례가 있어 문장을 고쳤다(`agent/prompt_builder.py` 주석: bisect로 확인, "원인은 이해 못 함").
* 즉 구독 token 길은 "Claude Code인 척하는 변환"을 요구한다. 모델 허용 목록 제약은 코드에서 못 찾았고, model 이름은 일반 정규화만 한다.

### 1.7 실패 처리
* 401: 1회 refresh 후 재시도, 안 되면 진단 메시지(`hermes auth reset/list` 안내). credential pool 쪽에서 401은 5분 cooldown.
* 429: pool에서 해당 credential을 60분 cooldown 후 rotate. 단 429 + "extra usage" + "long context"는 long-context tier gate로 보고 1M context beta를 빼서 재시도.
* 400 "out of extra usage": **billing으로 분류하되 "unverified"**. 같은 body가 content filter 거절에도 나오기 때문. 사용자에게 `claude.ai/settings/usage` 확인을 안내한다. unverified billing은 짧은 cooldown.
* 이 오류 때문에 Hermes docs는 "Max 플랜 + 구매한 extra usage credit이 있어야만 되고, 기본 포함량은 소비되지 않으며, Pro는 안 된다"고 적는다 (`website/docs/integrations/providers.md`).

### 1.8 저장
* Hermes 자체 PKCE 결과: `~/.hermes/.anthropic_oauth.json` — `{accessToken, refreshToken, expiresAt(ms)}`, mode 0600, 임시 file + fsync + atomic replace.
* 그 외 credential pool(`~/.hermes/auth.json`의 `credential_pool.anthropic`)에 source `hermes_pkce` / `claude_code` 등으로 행을 둔다. 빌린 행(`claude_code`)은 secret을 `auth.json`에 쓰지 않고 참조만 남긴다(디스크 경계에서 제거).
* auth.json 자체: 0600, 부모 dir 0700, atomic write, 프로세스 간 flock.

### 1.9 정책 흔적
* 코드: "Anthropic's OAuth usage policies"를 이유로 dashboard 단추를 뺌. 위 billing classifier 우회 주석들("third-party app으로 지문 인식", "extra usage lane으로 reroute").
* docs: "Claude Pro는 불가, Max + extra usage credit만 가능".
* 외부(제3자 보도, 확정 아님): 2026-01-09경부터 제3자 client의 구독 OAuth를 막기 시작했고, 2026-02-19/20 문서와 Consumer Terms 개정으로 Free/Pro/Max 구독 token은 Claude Code와 claude.ai 전용이라고 명시했다는 보도가 여럿 있다. OpenCode, Goose 등이 OAuth를 접고 API key로 돌아갔다고 한다. Anthropic 원문은 확인 못 함. 출처: gigazine, winbuzzer, letsdatascience, docs.moltis.org/anthropic-oauth.html.
* Hermes 자체도 "구독 token으로는 이제 extra usage만 쓸 수 있다"는 동작을 문서화하고 있어, 위 보도와 방향이 맞는다.

---

## 2. OpenAI (ChatGPT Plus/Pro, "Codex")

### 2.1 flow 종류
* **기본: device code** (OpenAI 전용 변형, RFC 8628 표준 아님). 사용자는 `https://auth.openai.com/codex/device`를 열고 user code를 입력한다.
* **opt-in: PKCE + loopback.** `--browser` 또는 config `auth.codex_login_flow: browser`. 사용처: device-code grant를 끈 조직. `localhost:1455`가 막혀 있으면(Codex CLI가 로그인 중이면) 안내하고 device code로 fallback.
* SSH: loopback은 포트 터널(`ssh -L 1455:127.0.0.1:1455`) 안내를 출력.

### 2.2 client_id
* `app_EMoamEEZ73f0CkXaXp7hrann`. Codex CLI의 public client 등록이다(코드 주석 "public Codex client registration", redirect URI도 그 client에 고정). 자기 것이 아니다.
* 다른 도구 credential 읽기: `$CODEX_HOME` 또는 `~/.codex/auth.json`의 `tokens.access_token` / `tokens.refresh_token`을 읽는다. (1) login 때 "가져올까요? (별도 로그인을 권장) [y/N]" 하고 묻는다. (2) 자체 refresh가 `invalid_grant`/`refresh_token_reused`/401로 죽었을 때 Codex CLI file의 새 token을 **자동 채택**(compare-and-swap, 다른 ChatGPT workspace면 거부). (3) 만료된 token은 가져오지 않는다. 쓰기는 하지 않는다. `auth.adopt_external_logins`로 끌 수 있다.
* Hermes의 기본 철학: 자기 session을 따로 받는다. 이유는 docs에 있다: single-use 회전이라 한 앱이 refresh하면 다른 앱 session이 무효가 된다.

### 2.3 URL, param
* issuer: `https://auth.openai.com`.
* device flow:
  1. `POST {issuer}/api/accounts/deviceauth/usercode` — JSON `{client_id}`. 응답 `device_auth_id`, `user_code`, `interval`(최소 3초로 올림). 429는 최대 4번 재시도(2, 4, 8초 backoff, `Retry-After` 우선).
  2. `POST {issuer}/api/accounts/deviceauth/token` — JSON `{device_auth_id, user_code}`를 interval마다. **403/404는 "아직 승인 안 됨"**, 200이면 `authorization_code`와 `code_verifier`를 돌려준다(서버가 PKCE를 대신 한다). 총 15분, 일시 네트워크 오류는 연속 6번까지 허용.
  3. `POST https://auth.openai.com/oauth/token` (form) — `grant_type=authorization_code`, `code`, `redirect_uri={issuer}/deviceauth/callback`, `client_id`, `code_verifier`.
* browser flow: authorize `https://auth.openai.com/oauth/authorize`, redirect `http://localhost:1455/auth/callback`(리스너는 127.0.0.1에 bind, URI 문자열만 localhost, port 고정), scope `openid profile email offline_access`, 추가 param `id_token_add_organizations=true`, `code_challenge_method=S256`, `state`. state는 `hmac.compare_digest`로 비교. PKCE verifier는 `os.urandom(64)` base64url(최대 128자), challenge는 SHA-256 base64url.
* device scope는 코드에 명시 없음(요청 몸에 scope 필드가 없다).

### 2.4 token 교환, refresh
* 교환: **form**. 응답에서 `access_token`, `refresh_token` 두 개만 저장한다(id_token은 저장 안 함).
* refresh: `POST https://auth.openai.com/oauth/token` form `grant_type=refresh_token`, `refresh_token`, `client_id`. UA는 `hermes-cli/<버전>`. 응답에 새 refresh_token이 있으면 교체. **single-use + rotation family reuse detection**: 같은 refresh token을 두 번 쓰면 family 전체가 revoke된다고 주석에 있다.
* 만료: access token이 **JWT**라 `exp` claim으로 판단. 만료 120초 전에 refresh. lock 안에서 다시 읽어 다른 process가 이미 회전했으면 그 pair를 채택.
* 오류 코드 해석: `refresh_token_reused`는 "다른 client(Codex CLI, VS Code)가 이미 소비" 메시지. 401/403, `invalid_grant`, `invalid_token`, `invalid_request`는 relogin 필요.

### 2.5 계정 식별
* access token(JWT) claim: 중첩 객체 `https://api.openai.com/auth` 아래 `chatgpt_account_id`, `chatgpt_data_residency`(없으면 `chatgpt_compute_residency`). 최상위 `sub`, `email`.
* "같은 주체" 판정은 `(chatgpt_account_id, sub)` 쌍. 한 workspace 구성원은 account id가 같고 sub와 quota가 다르기 때문.
* 서명 검증은 하지 않는다(보유한 두 credential이 같은 주체인지 보려는 용도뿐).

### 2.6 token으로 model 부르기
* base: `https://chatgpt.com/backend-api/codex`(env `HERMES_CODEX_BASE_URL`로 override 가능, 단 공식 URL일 때만 특별 header를 붙임). Responses API(`/responses`) 형식. 일반 `api.openai.com` API key 길과 **host부터 다르다**. 모델 목록은 `GET {base}/models`(account header 필요, 없으면 200인데 `{"models":[]}`).
* header:
  * `Authorization: Bearer <access_token>`
  * `ChatGPT-Account-ID: <chatgpt_account_id>` (JWT에서 꺼냄)
  * `x-openai-internal-codex-residency: <residency>` (residency 강제 workspace는 이게 없으면 401 "Workspace is not authorized in this region")
  * `originator: hermes-agent`, `User-Agent: HermesAgent/<버전>` (코드 주석: "OpenAI requires third-party harnesses to identify themselves"). 공식 URL이 아닌 custom endpoint에는 `originator: codex_cli_rs`, UA `codex_cli_rs/0.0.0 (Hermes Agent)`.
  * 요청 header가 user override로 지워지지 않게 "필수 header 재적용" 함수가 있다.
  * 공식 backend에는 `/responses` POST body를 **zstd 압축**(`Content-Encoding: zstd`)해서 보낸다(공식 client와 동일하게. Python 3.14 stdlib codec이 있을 때만).
* 요청 몸 강제:
  * `store: false` 고정(아니면 에러). 그래서 이전 response id를 참조하지 않고 매 요청 전체 input을 보낸다(store=false라 server id 조회는 404).
  * `instructions` 필수. 비어 있으면 기본 agent identity 문구로 채운다.
  * `input`은 Responses input item 배열. reasoning은 `include: ["reasoning.encrypted_content"]`로 암호화 reasoning을 받아 다음 turn에 되돌려 보낸다.
  * 스트리밍: 응답을 raw SSE event 스트림(`responses.create(stream=True)`)으로 받아 직접 조립한다(SDK helper가 `response.completed.response.output`이 null이면 깨짐). 이 backend가 non-stream을 거부하는지는 코드에서 명시적 주석을 못 찾았다(확인 못 함). 
  * 허용 model: 구독 backend는 API의 `-pro` 변형과 일부 retired slug를 400("not supported when using Codex with a ChatGPT account")으로 거절. Hermes는 curated 목록(이 시점 `gpt-6-sol`, `gpt-5.5` 등, Pro 전용 `gpt-5.3-codex-spark`)과 live `/models` 발견을 함께 쓴다. `supported_in_api: false` 모델도 Codex에선 쓸 수 있다고 주석.
  * tool 이름 제약은 못 찾았다.

### 2.7 실패 처리
* 401: 1회 강제 refresh 후 재시도 (`codex_auth_retry_attempted`). 그래도 안 되면 재로그인 안내.
* 429: 별도 코드 `codex_rate_limited`. **credential은 유효하니 재로그인 시키지 않는다.** pool에서 cooldown(60분), pool에 다른 계정이 있으면 rotate. 사용량 endpoint(quota probe)로 reset 여부를 확인해 stale cooldown을 풀기도 한다.
* 403: token endpoint의 403은 relogin 필요로 분류.
* 로그인 요청의 429: "OpenAI가 login을 rate-limit하는 중, credential 문제 아님" 메시지.

### 2.8 저장
* `~/.hermes/auth.json`: `providers.openai-codex` 아래 `{tokens:{access_token, refresh_token}, last_refresh(UTC ISO), auth_mode:"chatgpt", label?}`. 여러 계정은 `credential_pool.openai-codex` 배열. profile이 root의 grant를 빌린 경우 회전 결과를 root에 write-through. 모두 lock + atomic.
* `~/.codex/`에는 절대 쓰지 않는다.

### 2.9 정책 흔적
* 코드/docs에 ToS·차단 이야기는 없다. 대신 "third-party harness는 자기를 식별해야 한다(originator)"는 주석. 어떤 플랜이 되고 한도가 어떻게 계산되는지는 docs도 "아직 문서화 안 됨"이라고 적는다 (`providers.md`의 구독 표).
* 외부 확인은 이번에 안 했다.

---

## 3. xAI (SuperGrok / X Premium+) — 자세히

### 3.1 flow 종류
* **device code (RFC 8628) + OIDC discovery.** 현재 구현의 유일한 login 경로. loopback callback이 없고, headless/SSH에서도 URL과 code만 보여 주면 된다. `--no-browser`, 원격 session 감지 시 브라우저를 열지 않는다. dashboard/desktop은 background poller로 같은 flow를 돌린다 (`hermes_cli/web_server_oauth.py`).
* 옛 흔적: refresh 시 저장된 `auth_mode`가 `oauth_pkce`면 그대로 유지하고(relabel 금지), 저장 상태에 `redirect_uri`(예: `http://127.0.0.1:<port>/callback`) 필드가 남아 있다. test fixture에도 `127.0.0.1:56121/callback` 같은 값이 있다. 즉 이전에는 loopback PKCE였고 지금은 device code로 옮겼다고 추정되나 shallow clone이라 확정 못 함.
* 대체 flow: OAuth 대신 `XAI_API_KEY`(`provider: xai`). 403이면 이것을 권한다.

### 3.2 client_id
* `b1a00492-073a-47ea-816f-4c329264a828`.
* 누구의 client인가: 코드와 docs는 출처를 말하지 않는다. 다만 scope에 `grok-cli:access`가 있다. 외부(제3자 npm package `pi-xai` / `pi-xai-supergrok`)는 같은 client_id를 "Grok CLI의 public client_id"로 적고, "xAI가 loopback OAuth를 allowlist된 client에만 허용해서 빌린다, 동의 화면에 Grok Build/Grok CLI로 뜰 수 있다"고 한다. → **Grok CLI의 client를 빌린 것으로 보인다. 확정은 아니다.** Hermes 자체 문구는 "Hermes creates its own local OAuth session"이다(token은 Hermes 소유로 따로 발급).
* 다른 도구 credential 읽기: Hermes 코드에는 Grok CLI file을 읽는 길이 **없다**. 외부(pi-xai)는 `~/.grok/auth.json`을 읽는다고 한다: 최상위 JSON 객체, key가 `https://auth.x.ai::...<client_id>` 꼴이거나 옛 `https://accounts.x.ai/sign-in`, 값에 `key`/`access_token`, `refresh_token`, `email`. (이 file은 열어 보지 않았다.)

### 3.3 URL, scope, param
* issuer: `https://auth.x.ai`
* discovery: `https://auth.x.ai/.well-known/openid-configuration`. 거기서 `authorization_endpoint`, `token_endpoint`만 읽는다. 값 자체는 코드에 하드코딩이 없고, test fixture에는 `https://auth.x.ai/oauth2/token`, `.../oauth2/authorize`가 쓰인다.
* device code URL: `https://auth.x.ai/oauth2/device/code` (하드코딩).
* docs는 "accounts.x.ai"에서 로그인한다고 적고, verification URL은 device 응답이 준다(`verification_uri_complete` 우선).
* scope: `openid profile email offline_access grok-cli:access api:access` (외부 pi-xai는 `conversations:read conversations:write`도 더 요청).
* redirect URI: device flow라 없음(저장 시 빈 문자열).
* 보안 처리: discovery에서 온 endpoint는 **HTTPS이고 host가 `x.ai` 또는 `*.x.ai`**일 때만 받는다(auth.json에 cache되어 MITM이 token endpoint를 심으면 refresh token이 영구 유출되기 때문). 저장된 endpoint도 refresh 때 다시 검증. inference base URL override(`HERMES_XAI_BASE_URL`, `XAI_BASE_URL`)도 같은 규칙으로 막고 어기면 default로 돌아간다 — bearer가 다른 곳으로 새지 않게.

### 3.4 token 교환, refresh
* device code 요청: `POST device_code_url`, **form**(`application/x-www-form-urlencoded`) `client_id`, `scope`. 응답 필수 필드: `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, `interval`.
* polling: `POST token_endpoint` form `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id`, `device_code`. `authorization_pending`이면 interval만큼 sleep, `slow_down`이면 +1초(최대 30초). 비JSON 408/429/5xx 또는 `x-vercel-mitigated` 달린 403은 edge/WAF 장애로 보고 backoff(`Retry-After` 존중, 최대 60초)하며 계속 polling. 그 외 오류와 `expires_in` 초과는 실패. 성공 응답에 `access_token`과 `refresh_token`이 둘 다 있어야 한다.
* 응답 저장 필드: `access_token`, `refresh_token`, `id_token`, `expires_in`, `token_type`(기본 Bearer).
* 만료 계산: access token이 **JWT**고 `exp` claim으로 판단(저장된 `expires_in`은 표시용). 수명: 주석에 "~6시간", 또 "device-code login은 ~15분짜리 JWT를 주기도 한다"는 말도 있다(수명이 계정/flow마다 다름).
* refresh 요청: token_endpoint로 **form** `grant_type=refresh_token`, `client_id`, `refresh_token`. **refresh token은 매번 회전**한다("xAI rotates refresh_token on every refresh"). 응답에 새 refresh가 없으면 옛 것 유지.
* refresh 시점(proactive): 만료 1시간 전부터. 단 남은 수명이 45분 이하로 짧게 발급된 token이면 2분 전으로 줄인다(안 그러면 매 호출마다 refresh해서 single-use token을 소모하고 race로 `invalid_grant`). 401을 받으면 1회 강제 refresh 후 재시도. lock 안에서 재확인해 동시 호출이 이미 회전했으면 건너뛴다.
* 죽은 refresh 처리("quarantine"): refresh가 400/401/403으로 영구 실패하면 저장소에서 access/refresh token을 **지우고** `last_auth_error` 표식을 남겨, 이후 호출이 같은 실패를 반복하지 않게 한다. 다음 login 성공 때 풀린다.
* 회전 chain 보호: profile이 root grant를 빌려 쓰는 중이면 회전 결과를 root file에 write-through.

### 3.5 계정 식별
* 전용 처리는 없다. 공용 함수가 access_token 또는 id_token JWT에서 `sub`, `email`(그리고 openai용 중첩 claim)을 꺼내 "같은 계정 lineage" 판정에 쓴다. 로그인 시 계정을 표시하거나 식별하는 별도 단계는 없다.

### 3.6 token으로 model 부르기
* base URL: `https://api.x.ai/v1` — **일반 API와 같은 host·같은 prefix.** Hermes는 `provider: xai-oauth`일 때 이 값을 config에 써 넣고, Authorization에 access token을 bearer로 넣어 부른다(API key 자리에 token이 들어가는 구조: 런타임 credential의 `api_key` 필드가 access token).
* 형식: Responses API(`/responses`)를 쓴다(`codex_responses` adapter 재사용). proxy adapter가 허용하는 path는 `/responses`, `/chat/completions`, `/completions`, `/embeddings`, `/models`.
* 구독 token이 일반 API와 같은 model을 부르나: docs 표는 `grok-4.6`(기본), `grok-build-0.1`, `grok-4.3`, `grok-4.20-*`를 OAuth picker에 나열하고 "chat catalog는 models.dev cache에서 파생"이라고 한다. 즉 같은 catalog를 쓴다. 다만 `grok-composer` 계열(Grok Build CLI)은 **OAuth 전용**(주석, context 200k)이라는 표시가 있어 구독 token에서만 보이는 model이 있다. TTS, 이미지/비디오, 전사, X Search도 같은 bearer를 쓴다(구독 quota 사용, API key 있어도 OAuth 우선).
* header: 별도 identity 강제는 못 찾았다. UA `Hermes-Agent/<버전>`만. cache 고정용 `x-grok-conv-id`와 body 필드 `prompt_cache_key`를 쓴다(xAI는 server slot을 이 key로 고정해서 같은 key로 갈라진 두 stream이 서로 evict한다).
* 요청 몸: Responses 형식 그대로 `store:false`, `instructions` 필수는 codex adapter 계약을 같이 쓴다. xAI는 encrypted reasoning을 되돌려 보내 주길 **원한다**(코드 주석: 한때 막아 놨다가 틀렸음을 확인). `reasoning.effort`는 xAI 허용 목록 밖이면 400. tool schema의 slash 포함 enum은 제거(xAI가 거부). 일부 grok-4.x는 최종 답을 reasoning item 안 `<response>` 구분자 뒤에 넣어서 보정한다. server-side `*_call` item이 `in_progress`로 남는 것도 보정.
* 일반 API key 길과의 차이: host는 같고 인증 header 값만 token이다. model 노출과 quota(구독 vs 종량)가 다르다. xAI 쪽이 OAuth API 접근에 **tier allowlist**를 건다(3.7).

### 3.7 실패 처리
* 401: 1회 `force refresh` 후 재시도 → 그래도 거부면 "xAI Grok OAuth에서 재인증" 안내.
* **403**: 두 가지가 섞인다.
  * token endpoint(refresh)의 403: `xai_oauth_tier_denied`, relogin 하지 않는다("로그인해도 안 바뀐다. `XAI_API_KEY`+`provider: xai`를 쓰거나 구독을 올려라").
  * inference의 403 중 body 코드가 `personal-team-blocked:spending-limit`이면 billing으로 분류(402가 아니라 403으로 옴). SSE 오류 frame으로 "do not have an active grok subscription" / "out of available resources ... grok"가 오면 auth 문제로 보고 fallback 처리.
* 429: pool credential을 cooldown 후 rotate(401은 refresh, 429는 refresh 안 함).
* 사용자 보고(issue #26847, 외부 확인 + 이번에 WebFetch): 표준 SuperGrok($30) 계정이 login은 성공하고 inference/refresh에서 403. 계정 dashboard에 "Beta is only available for SuperGrok Heavy users" 문구가 있었고, 보고자는 Grok Build와 backend가 같아 Heavy만 되는 것 같다고 추정. xAI 직원 답은 없음. 2026-08 댓글에는 표준 SuperGrok으로 몇 주째 된다는 반대 사례. issue는 "not planned"로 닫혔고 Hermes는 403을 entitlement error로 취급해 재시도를 멈추는 변경과 docs 경고를 넣었다. → **tier 제한은 xAI 쪽 정책이고 시간에 따라 바뀐다.**

### 3.8 저장
* `~/.hermes/auth.json`의 `providers.xai-oauth`: `{tokens:{access_token, refresh_token, id_token, expires_in, token_type}, last_refresh, auth_mode, discovery:{token_endpoint,...}, redirect_uri, last_auth_error?}`. 다중 계정은 `credential_pool.xai-oauth`. 파일 0600, 부모 0700, lock + atomic. 로그인 때 `active_provider`를 바꾸지만 side tool(TTS 등) refresh는 바꾸지 않는다.
* discovery의 endpoint를 같이 저장해서 refresh마다 discovery를 다시 부르지 않는다(대신 매번 host 재검증).

### 3.9 정책 흔적
* 코드/docs에 ToS·차단 문구는 없다. xAI가 이 OAuth 길을 공개적으로 허용하는지에 대한 xAI 공식 문서 링크는 Hermes 레포에 없다(`docs.x.ai`의 모델 retirement 가이드만 있음). 외부: 제3자 도구 여러 개가 같은 client로 이 길을 쓰고 있다고 한다(OmniRoute issue 목록에 "Official Grok Build CLI" 포함). 공식 문서 확인은 못 했다.

---

## 4. 그 밖 provider (이름과 flow 한 줄)

* Nous Portal: device code(`/api/oauth/device/code`, `/api/oauth/token`), 자기 client `hermes-cli`, scope `inference:invoke`. 짧은 JWT로 inference. 자기 서비스라 정책 이슈 없음.
* GitHub Copilot: GitHub device code(`github.com/login/device/code`, scope `read:user`), VS Code의 GitHub App client_id `Iv1.b507a08c87ecfe98`를 빌림. 얻은 `ghu_` token을 `api.github.com/copilot_internal/v2/token`에서 Copilot API JWT로 교환. env `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` → `gh auth token` 순. 클래식 PAT(`ghp_`)는 거부.
* Qwen: qwen-cli가 만든 token file을 읽는다(자체 login 없음). refresh용 client `f0304373...`, token URL `chat.qwen.ai/api/v1/oauth2/token`.
* MiniMax: user_code grant(device 변형) + PKCE, global/cn host 분리.
* OpenRouter: PKCE 후 token이 아니라 사용자 소유 API key를 받음(refresh 없음).
* Google Gemini: 구독 login 없음(docs가 명시). Vertex는 service account/ADC.

---

## 5. lophn이 가져갈 만한 것

* **flow 선택은 provider별로 다르게, 기본은 headless 친화적인 것.** Codex와 xAI는 device code를 기본으로, Anthropic은 code 붙여넣기. loopback은 Codex처럼 opt-in으로 두고 포트(`1455`)가 고정이라는 점을 주의. xAI는 device code라 callback listener가 필요 없다.
* **자기 session을 따로 받는 것을 기본으로.** 다른 도구(Codex CLI, Claude Code, Grok CLI) file을 가져오는 건 사용자에게 묻고 한 번만. refresh token이 single-use 회전이라 같은 family를 공유하면 서로를 죽인다. 읽기 전용으로도 위험하고, refresh한 결과를 되돌려 쓰는 순간 남의 file을 건드린다.
* **refresh 설계**: lock 안에서 다시 읽고(다른 process가 이미 회전했으면 그 pair 채택), 회전 응답을 쓰기 전에는 옛 token을 버리지 않으며, 쓰기 실패를 감추지 않는다. 영구 실패(400/401/403 + `invalid_grant` 류)는 token을 지우고 표식을 남겨 반복 호출을 막고, 일시 실패(429, 5xx, 비JSON)와 구분한다.
* **만료는 JWT `exp`로** (Codex, xAI). Anthropic은 `expires_in`으로 계산해 저장. proactive refresh skew는 token 수명에 맞춰 줄인다(짧은 수명 token에 긴 skew를 쓰면 매번 refresh).
* **discovery 결과를 신뢰하지 말고 host를 고정 검증**(`x.ai`, `*.x.ai`, HTTPS). bearer를 보내는 base URL override도 같은 규칙. lophn의 "인터넷에서 온 것은 공격자" 원칙과 맞는다.
* **401은 refresh 1회 후 재시도, 429는 credential 폐기 없이 cooldown, 403은 원인별 분리**(entitlement는 재로그인으로 안 풀림).
* **저장은 0600 + atomic write + lock**, secret을 빌린 credential에는 복사하지 않고 참조만.
* **구독 token 길은 일반 API와 계약이 다르다**는 것을 provider adapter 경계에 명시: Codex는 host부터 다르고(`chatgpt.com/backend-api/codex`), `store:false`, `instructions` 필수, account header가 JWT에서 나옴. xAI는 host는 같지만 tier에 따라 403.
* **구독 token으로 나오는 오류 body를 정직하게 분류**: Anthropic처럼 같은 400이 "usage 소진"과 "content filter"에 같이 쓰이면 단정하지 말고 "unverified"로 표시.
* 계정 식별은 JWT claim(`sub`, `email`, Codex는 `chatgpt_account_id`)으로 같은 주체 판정에만 쓰고 서명 검증은 하지 않는다는 선을 지키면 단순하다.

## 6. 따라 하면 안 되는 것

* **Claude Code인 척하기**: system 맨 앞에 "You are Claude Code" 블록, 자기 이름을 "Claude Code"로 치환, tool 이름을 `mcp__`로 위장·alias, UA를 `claude-code/<버전>`으로 보내기, 설치된 `claude --version`을 읽어 맞추기, `axios` UA 위장. 이것은 제3자 사용을 막으려는 서버 분류기를 회피하려는 것이고, Hermes 스스로 "bisect로 맞췄고 원인은 이해 못 한다"고 적는다. 외부 보도에 따르면 Anthropic은 구독 OAuth를 Claude Code·claude.ai 전용으로 못 박았다. 구독 token 길 자체를 기본 기능으로 가져가지 않는 편이 안전하고, 가져간다면 위장 없이 거절당하는 것을 받아들이는 설계여야 한다.
* **다른 도구의 client_id를 빌리기**: Anthropic(Claude Code), Codex(Codex CLI), xAI(Grok CLI로 보임) 모두 빌린 public client다. 동의 화면이 다른 앱 이름으로 뜨고, client 소유자가 allowlist·차단·id 폐기를 하면 바로 깨진다. 자기 client 등록이 가능한 곳(Nous, MiniMax류)과 구분해서 다뤄야 한다.
* **다른 도구의 refresh token을 읽고 회전시켜 되쓰기**(`~/.claude/.credentials.json`, Keychain 수정, `~/.codex/auth.json` 자동 채택). single-use 회전 때문에 상대 도구를 로그아웃시킨다. lophn은 사람 home의 외부 도구 file을 건드리지 않는 선이 맞다.
* **원본 로그인 상태가 항상 유효하다고 가정하는 자동 복구**(refresh 실패 시 몰래 다른 token 채택): workspace가 다른 계정으로 바뀔 수 있어 Hermes도 compare-and-swap과 principal 비교로 겨우 막는다. 단순한 prototype에 들이면 과하다.
* **코드에 박힌 상수 가정**: Anthropic의 token endpoint 이중화(`platform.claude.com`, `console.anthropic.com`)와 UA 규칙, Codex의 `1455` 포트, xAI scope 문자열은 모두 변동 흔적이 있다. 값을 박되 한곳에 모으고 바뀌었다는 가정으로 실패 메시지를 분명히.
* **구독 한도·플랜 자격을 코드로 단정하기**: Hermes도 "Pro는 불가", "403은 tier 제한" 같은 문구를 docs로 고쳐 가며 유지한다. 정책은 provider가 바꾼다. 확인된 사실과 추정을 분리해 UI에 적어야 한다.
* **Hermes의 과한 장치**: multi-profile write-through, credential pool, 다중 계정 rotate, 상태 migration, quota probe는 prototype 범위 밖이다. lophn에는 "provider 하나당 token pair 하나 + lock + 회전 안전 쓰기"면 충분하다.
