---
type: research
concerns: [lophn-agent/harness/provider]
---
# provider OAuth와 credential

## 질문

구독 OAuth를 lophn 이름으로 허용받아 로그인·갱신·text/tool call할 수 있는가?
회전 refresh token, 사람 순서의 여러 credential, 계정 신원, secret 저장 실패를 어떻게 처리하는가?
기존 harness에서 가져올 구현과 위장·credential 수입·자동 fallback처럼 버릴 구현은 무엇인가?

### 먼저 볼 제품 위험

- **[확인·코드] 조사된 Pi/Hermes Claude inference는 Claude Code identity·User-Agent·beta를 쓴다.** Hermes에는 과금 분류를 바꾸려는 tool/prose alias도 있다. R15로 모두 버린다. **[미확인] 위장 없는 Claude OAuth text/tool call은 실제로 검증하지 않았다.** Pi의 “MUST include Claude Code identity” 주석만으로 모든 backend에서 기술적으로 불가능하다고 단정하지 않는다. 근거: `pi:packages/ai/src/api/anthropic-messages.ts` `createClient`, `buildParams`(약1013–1034,1106,1167–1185); `hermes-agent:agent/anthropic_adapter.py` `_CLAUDE_CODE_SYSTEM_PREFIX`, `_OAUTH_TOOL_NAME_ALIASES`.
- **[확인·공식] Anthropic은 제3자 개발자가 자기 앱에 Claude.ai login을 제공하거나 사용자 구독 credential을 중개하는 것을 허용하지 않는다.** 추가 사용량 과금이라는 분류만으로 login 제공 허용이 생기지 않는다(A1/A2).
- **[확인·공식/코드] OpenAI에는 실제 앱 이름으로 등록하는 Sign in with ChatGPT(SIWC)가 있다.** 최초 `dynamic_agent_client`→발급 client_id→public Responses API다. 공식 문서는 ChatGPT backend-api 사용을 금지한다. R12/R16의 Codex client·device 우선·listener 없음·Codex backend와 다르므로 **open-issues 후보**다(O1–O5; Pi `openai-chatgpt.ts`).
- **[확인·공식] xAI는 Hermes/OpenCode 구독 연결과 discovery를 공개한다. [미확인] lophn의 공용 Grok CLI client 사용 허용·등록 절차·실제 text/tool 성공은 확인하지 못했다.** 공개 client_id는 임의 앱 사용 허가가 아니다(X1–X3).
- **활성화:** 이번 조사는 코드·문서 조사이며 실제 계정 login/refresh/유료 text/tool test를 하지 않았다. 세 OAuth의 `verified_for_lophn`은 모두 false로 둔다(R1). API key 지원과 OAuth 지원 대상/활성 상태를 구별한다.

조사일 **2026-10-04**. `[확인]`은 코드 또는 명시한 공식 문서의 범위, `[추측]`은 구현 제안, `[미확인]`은 확인하지 못한 범위다. 경로는 프로젝트 clone 루트 기준이다. Claude Code clone에는 harness source가 없어 프로젝트 수에 넣지 않았다. 요구 번호는 모두 `lophn-agent/harness/provider` concern이다.

## 프로젝트별

### Pi (`83692682f095528f8b71652ddacff7075e36e893`)

#### Claude

[확인] 다음은 `pi:packages/ai/src/auth/oauth/anthropic.ts` constants, `parseAuthorizationInput`, `exchangeAuthorizationCode`, `loginAnthropic`, `loginAnthropicCopyCode`, `refreshAnthropicToken`(14–55,94–267)에서 읽었다.

| 항목 | 코드 |
|---|---|
| client_id | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| authorize/token | `https://claude.ai/oauth/authorize` / `https://platform.claude.com/v1/oauth/token` |
| redirect | browser `http://localhost:53692/callback`; copy `https://platform.claude.com/oauth/code/callback` |
| scope | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |
| PKCE/state | S256, verifier를 state로도 사용; pasted state가 **있을 때만** mismatch 검사 |
| code 입력 | URL, `code#state`, query, bare code. missing state는 expected verifier로 보완 |
| exchange | JSON `{grant_type:"authorization_code",client_id,code,state,redirect_uri,code_verifier}` |
| token | access_token/refresh_token/expires_in; 실제 expiry에서 **5분** 차감 |
| refresh | JSON grant; 반환 refresh 누락 시 old 유지 없음; `postJson` timeout **30초** |

R11은 state 누락 거절·profile/inference만 요구하므로 parser/scope를 그대로 가져올 수 없다. [확인] inference는 Bearer, SDK `apiKey:null`/`authToken`, `user-agent:claude-cli/<Claude Code version>`, `x-app:cli`, `anthropic-dangerous-direct-browser-access:true`, beta `claude-code-20250219`/`oauth-2025-04-20`, system `You are Claude Code, Anthropic's official CLI for Claude.`를 쓴다. “Stealth mode” tool naming도 있다. 근거: `pi:packages/ai/src/api/anthropic-messages.ts` `createClient`, `buildParams`, tool naming 주석(약95,1013–1034,1106,1167–1185).

#### ChatGPT 두 경로

[확인] **legacy Codex-compatible**는 `pi:packages/ai/src/auth/oauth/openai-codex.ts` constants, `createAuthorizationFlow`, `startOpenAICodexDeviceAuth`, `pollOpenAICodexDeviceAuth`, `credentialsFromToken`, `loginOpenAICodex`(22–40,187–400)에서 읽었다.

- client_id `app_EMoamEEZ73f0CkXaXp7hrann`; authorize/token `https://auth.openai.com/oauth/authorize`, `/oauth/token`; redirect `http://localhost:1455/auth/callback`; scope `openid profile email offline_access`; query `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=pi`.
- device 시작 POST `/api/accounts/deviceauth/usercode` JSON `{client_id}`; approval `https://auth.openai.com/codex/device`; poll POST `/api/accounts/deviceauth/token` JSON `{device_auth_id,user_code}`. 성공 authorization_code/code_verifier를 `/oauth/token`에 exchange; redirect `https://auth.openai.com/deviceauth/callback`.
- 최대 **15분**, interval number/string 검사. **시작404**는 not enabled; **poll403/404** 또는 deviceauth_authorization_pending은 pending. 사람이 browser/device를 고르므로 device-first 자동 전환은 아니다.
- token access/refresh/expires 필수. account id는 **access JWT**의 `https://api.openai.com/auth.chatgpt_account_id`; unsigned decode다. 포트 실패 paste fallback은 있지만 missing state를 허용한다(`parseAuthorizationInput`, `getAccountId` 69–97,310–330).
- legacy inference base `https://chatgpt.com/backend-api`, body `store:false`, nonempty fallback instructions, header chatgpt-account-id/originator=pi/Pi UA. store=true 거절은 주석 근거이며 live server 재현은 아니다. residency header는 inspected adapter에서 못 찾았다. 근거: `pi:packages/ai/src/api/openai-codex-responses.ts` default base, `buildRequestBody`, `processWebSocketStream`, `buildBaseCodexHeaders`(약1519,1640–1659).

[확인] **신규 own-name SIWC**는 `pi:packages/ai/src/auth/oauth/openai-chatgpt.ts` constants, `authorizationResultFromCallback`, `startCallbackServer`, `credentialFromTokenResponse`, `exchangeAuthorizationCode`, `refreshAccessToken`, `agentHostId`, `loginOpenAIChatGPT`(16–29,53–132,162–298)에서 읽었다.

| 항목 | 코드 |
|---|---|
| 등록 identity | 최초 dynamic_agent_client; agent_name_hint=Pi; install UUID→ext_agent_host_id=urn:uuid:… |
| authorize/token | `https://auth.openai.com/api/accounts/authorize` / `/api/accounts/oauth/token` |
| resource/scope | `https://api.openai.com/v1`; `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` |
| callback | `http://127.0.0.1:1455/auth/callback`; listener 필수; EADDRINUSE는 에러 |
| 검증 | exact origin/path, missing/mismatched state 거절, 발급 client_id 필수, 반환 direct scope 확인 |
| exchange/refresh | 발급 client_id+resource 사용; expiry margin **3분** |

[미확인] nonce 생성/id_token 존재 검사는 있지만 이 파일에서 signature/issuer/audience/nonce 검증은 확인 못했다. 주석상 profile 읽기에 id_token을 쓰지 않는다. 매 login 새 client 등록이라는 코드 주석은 공식 issued client 재사용 안내와 다르다(O2). 새 경로와 legacy claims/header/backend를 섞지 않는다.

#### xAI·refresh·저장

- [확인] xAI client `b1a00492-073a-47ea-816f-4c329264a828`, scope `openid profile email offline_access grok-cli:access api:access`, fixed `https://auth.x.ai/oauth2/device/code`, `/oauth2/token` form POST, referrer=pi. runtime discovery 없음; verification URI는 HTTPS만 검사하고 host 제한 없음. device expiry positive number 필수, first poll 전 interval wait. pending/slow_down/denied/expired 분리. refresh 누락은 old 유지, token expiry 누락 **3600초**, expiry **5분** 차감. 근거: `pi:packages/ai/src/auth/oauth/xai.ts` constants, `validateVerificationUri`, `parseDeviceCode`, `credentialsFromTokenResponse`, `requestDeviceCode`, `pollForTokens`, `refreshXaiToken`(8–16,51–62,108–227).
- [확인] 공통 poll 기본 **5초**, 최소 **1초**, expiry 없으면 Infinity. slow_down positive 서버 interval 우선, 없으면 **+5초**. abortable sleep. success 뒤 deadline 재검사 없음. 근거: `pi:packages/ai/src/auth/oauth/device-code.ts` `abortableSleep`, `pollOAuthDeviceCodeFlow`(1–104).
- [확인] resolver margin **5분**, refresh timeout **15초**; store.modify 안 latest secret/expiry double-check→refresh→저장 뒤 access. stored auth refresh 실패 후 env silent fallback 없음. `InMemoryCredentialStore` provider별 Promise chain은 task settlement까지 유지; persistent protection은 앱 storage가 맡는다. 근거: `pi:packages/ai/src/auth/resolve.ts` `resolveProviderAuth`, `resolveStoredOAuth`(33–92,102–163); `credential-store.ts` `InMemoryCredentialStore.modify`.
- [확인] coding-agent는 **평문 JSON**, 새 file **0600**, 새 dir **0700**; proper-lockfile stale/acquire deadline **30초**, ELOCKED exponential+jitter delay 최대 **2초**. lock 안 read→fn→write. rotating POST 성공 뒤 signal abort가 write를 막을 수 있어 settlement가 과제다. 근거: `pi:packages/coding-agent/src/core/auth-storage.ts` `FileAuthStorageBackend`, `AUTH_FILE_WRITE_OPTIONS`, `acquireLockAsync`, `withLockAsync`(48–67,115–200).

### Codex (`3a69ec3ef8fb87b41e99b8942af061ad58ae6732`)

- [확인] browser port 기본 **1455**, issuer `/oauth/authorize`/`/oauth/token`, scope `openid profile email offline_access api.connectors.read api.connectors.invoke`; S256/state/originator, id_token_add_organizations/codex_cli_simplified_flow/선택 workspace 제한. code exchange는 one-time code 소비 위험 때문에 response timeout 후 재POST하지 않는다. proxy fallback이 허용되고 **connect failure·redirect 미관측일 때만1회**, connect timeout **10초**. Codex 자기 identity는 위장이 아니지만 lophn이 복제하는 것은 별개다. 근거: `codex:codex-rs/login/src/server.rs` `DEFAULT_PORT`, `build_authorize_url`, `exchange_code_for_tokens`(78,586–617,711–773).
- [확인] device endpoint/callback은 Pi legacy와 같다. interval string→u64, 누락 default **0초**, deadline **15분**; poll403/404 pending, 나머지 status terminal. inspected poll에는 slow_down 별도 처리 없음. workspace 검사 후 persist. 근거: `codex:codex-rs/login/src/device_code_auth.rs` response types, interval deserializer, device request/poll/run 함수.
- [확인] IdTokenInfo는 email, chatgpt_user_id, chatgpt_account_id(workspace/org), plan free/plus/pro/business/enterprise/edu/unknown, FedRAMP flag. parser는 JWT payload decode이지 signature 검증이 아니다. 근거: `codex:codex-rs/login/src/token_data.rs` `IdTokenInfo`, `ChatgptPlanType`, `parse_chatgpt_jwt_claims`, `parse_chatgpt_account_user_id`.
- [확인] proactive refresh: JWT exp 있으면 **5분 전**, 없으면 last_refresh **8일**. manager Semaphore1 permit→source reread→changed credential이면 skip; expected account mismatch permanent. 조사한 함수에서 network 전체 cross-process file lock은 미확인. 근거: `codex:codex-rs/login/src/auth/manager.rs` constants(203–204), `AuthManager.refresh_token`(2845–2882), `should_refresh_proactively`(3001–3023).
- [확인] persist는 optional id/access/refresh 각각 있는 값만 교체하고 old refresh 유지, storage.save 뒤 반환. expired/reused/invalidated/account mismatch permanent, cache는 auth snapshot scoped **in-memory**. `UnauthorizedRecovery` managed는 **Reload→RefreshToken→Done**으로 각각 retry 가능; external은 provider refresh1회. R18의 영속 차단·전체 retry1회와 차이. 근거: 같은 파일 `persist_tokens`(1600–1625), `classify_refresh_token_failure`(1680–1725), `UnauthorizedRecoveryStep/Mode/UnauthorizedRecovery`(1828 이후), AuthManager cache.
- [확인] default originator codex_cli_rs, UA, 선택적 `x-openai-internal-codex-residency`; ChatGPT helper account header·OAI-Product-Sku:codex; Responses instructions/store=false. 근거: `codex:codex-rs/login/src/auth/default_client.rs` `DEFAULT_ORIGINATOR`, default headers(약462–466); `codex:codex-rs/model-provider-info/src/lib.rs` `RESIDENCY_HEADER_NAME`; `codex:codex-rs/chatgpt/src/chatgpt_client.rs` `ChatGptClient`; `codex:codex-rs/core/src/client.rs` Responses request(약1000–1006). 새 SIWC가 이 internal header를 요구하는지는 미확인.
- [확인] `$CODEX_HOME/auth.json` file backend는 plaintext·Unix 새 file **0600**·truncate/write/flush. inspected save에는 atomic rename 없음. keyring도 있으며 auto는 keyring 실패 시 file fallback. 기존 file permission 재설정 전체는 미확인. 근거: `codex:codex-rs/login/src/auth/storage.rs` `AuthDotJson`, `FileAuthStorage.save`, `DirectKeyringAuthStorage`, `SecretsKeyringAuthStorage`, `AutoAuthStorage`.

### OpenCode (`907b3bc518fa48e90e8ec24dd327d13eee71c36c`)

- [확인] provider ID당 auth 하나, OAuth `{type,refresh,access,expires,accountId?,enterpriseUrl?}`. data/auth.json plaintext·write mode **0600**; OPENCODE_AUTH_CONTENT env 지원. login pending은 provider Map, auto/code callback 뒤 auth.set. multiple credential/account+org dedup은 inspected store에서 미확인. 근거: `opencode:packages/opencode/src/auth/index.ts` `Auth.Oauth`, `Auth.set`; `opencode:packages/opencode/src/provider/auth.ts` `ProviderAuth`.
- [확인] Codex plugin public client·1455·originator=opencode. account는 id_token 우선, top-level/namespace account 또는 organizations[0].id, 이어 access fallback. residency chatgpt_compute_residency, no_constraint 생략. unsigned decode. 근거: `opencode:packages/opencode/src/plugin/openai/codex.ts` `parseJwtClaims`, `extractAccountIdFromClaims`, `extractAccountId`, `extractResidency`, `buildAuthorizeUrl`(38–106).
- [확인] refreshPromise는 loader-instance 범위, expiry 경과/access 없음일 때 refresh(margin0), auth.set await 뒤 사용, missing account는 old 유지. inspected 구간 account mismatch 거절 미확인. `/v1/responses`/`/chat/completions`를 Codex endpoint로 rewrite하고 Bearer/account/residency 붙임. device403/404 pending, interval `max(parseInt(interval)||5,1)`초+margin, **while(true)**이며 inspected callback deadline/cancel 없음. 근거: 같은 파일 `CodexAuthPlugin` loader/device(341–427,약490–548). built-in Anthropic OAuth는 검색 범위에서 못 찾았고 제거 이유/역사는 단정하지 않는다.
- [확인] xAI는 동일 공용 client·여섯 scope·fixed endpoints, referrer=opencode, real opencode UA. discovery 설명은 주석이지 runtime fetch 아님. interval 기본 **5초/최소1초**, slow_down **+5초**, expiry 기본 **5분**, sleep margin **3초**를 remaining으로 cap. now/sleep 주입 가능. 근거: `opencode:packages/opencode/src/plugin/xai.ts` constants, `authHeaders`, `requestDeviceCode`, `pollDeviceCodeToken`(1–204).
- [확인] xAI skew **120초**, JWT exp는 scheduling decode, loader single-flight, missing refresh old 유지. **auth.set 실패를 삼킨 뒤 새 token을 사용**하며 테스트도200을 기대한다. baseURL override를 안 해 사용자 gateway에도 OAuth가 갈 수 있다. inspected fetch의 명시401 refresh는 미확인. 근거: 같은 파일 `accessTokenIsExpiring`, `XaiAuthPlugin`; `opencode:packages/opencode/test/plugin/xai.test.ts` persistence failure test(303–319). R16/R17에서 버린다.

### OpenClaw (`37efa0b4a644b66a5987a07841e9707e1de2a7d8`)

- [확인] explicit order/explicit empty 우선; 자동 순서는 **OAuth→token→API key**, expiry/lastUsed 회전. available 뒤 cooldown earliest-until, preferred session profile 앞 배치. 설정 drift 복구 때 store 후보로 넓힌다. 근거: `openclaw:src/agents/auth-profiles/order.ts` `resolveAuthProfileOrderWithMetadata`, `prependAuthProfilePin`.
- [확인] transient **30초→60초→5분**, rate_limit **30초 exponential→24시간**, billing **10분→24시간**, auth_permanent도 **10분→1시간** 뒤 재후보. 실패 window **24시간**, active window 유지; rate-limit count는 실제 성공까지 half-open 보존; subscription_limit reset을 generic429가 덮지 않음. model scope가 섞이면 profile-wide. 근거: `openclaw:src/agents/auth-profiles/usage-failure-state.ts` `calculateAuthProfileCooldownMs`, `DISABLED_FAILURE_BACKOFF_POLICIES`, `computeNextProfileUsageStats`(17–179).
- [확인] refresh usable margin **5분**, caller timeout **120초**; file lock stale **180초**, retry **20**, factor2,min100ms,max10초,randomize; keyed queue+cross-process profile lock. 근거: `openclaw:src/agents/auth-profiles/constants.ts` refresh/lock constants; `credential-state.ts` margin; `oauth-profile-lock.ts` `withOAuthProfileLock(s)`(10–41); `oauth-manager.ts` `createOAuthManager`.
- [확인] lock 안 authoritative reread→durable generation/fence claim→network→lock settlement. network 동안 short claim lock은 놓지만 pending generation 소비를 막는다. caller cancel/timeout 뒤 owner settlement/queue admission 유지, refreshed identity 확인, owner/peer 저장 후 access. persist 실패/terminal fence는 fail closed. 근거: `openclaw:src/agents/auth-profiles/oauth-manager.ts` `validateSettlementCredential`, `settleOAuthRefreshClaim`, `markOAuthRefreshClaimFailed`, `claimOAuthRefresh`, `refreshOAuthTokenWithLock`(185–195,309–370,418 이후).
- [확인] foreign bootstrap/peer mirror도 처리한다. R6 때문에 lophn은 이 복사 복잡성이 불필요하다. model/provider candidate fallback도 R10으로 버린다. 근거: 같은 파일 `adoptNewerMainOAuthCredential`, `settlePeerClaimsUnderRefreshLock`; `openclaw:src/agents/model-fallback-runner.ts` fallback runner.
- [확인] auth SQLite store/state JSON cell writer가 있다. **[미확인] 저장 전체 keychain/encryption/permission은 확정 못했다.** secrets-store라는 이름만으로 안전/평문을 단정하지 않는다. 근거: `openclaw:src/agents/auth-profiles/sqlite.ts` `writePersistedAuthProfileStoreRaw`, `writePersistedAuthProfileStateRaw`(330–374).

### Hermes Agent (`343500b3547e12530457c2fda60ec687e25118b4`)

#### Claude·다른 CLI 수입

- [확인] Claude는 동일 public client, random state,32-byte verifier/S256, paste code#state 누락/mismatch 거절. scope org:create_api_key/user:profile/user:inference, redirect `https://console.anthropic.com/oauth/code/callback`; platform token/legacy console endpoint. exchange timeout **15초**, token UA axios/1.7.9, lifetime default **3600초**. 근거: `hermes-agent:agent/anthropic_credentials.py` constants, `_generate_pkce`, `run_hermes_oauth_login_pure`(36부근,747–807), `_post_oauth_token`.
- [확인] validity **60초**, pure refresh timeout **10초**, old refresh 유지. shared source는 path cross-process lock 안 reread→POST→write; outer default **20초**, lock timeout refresh+5초 이상. newer token adopt, invalid_grant/invalid_token/reused terminal fingerprint 차단. 성공 뒤 write 실패는 consumed-uncommitted durable sidecar로 막고 새 token을 반환하지 않는다. 근거: 같은 파일 `is_claude_code_token_valid`, `refresh_anthropic_oauth_pure`, `_refresh_oauth_token`, `mark_rotation_consumed_uncommitted`, `is_rotation_consumed_uncommitted`(145–225,371이후,450–533).
- [확인] macOS security 명령으로 service **Claude Code-credentials** account/payload를 읽는다. CLAUDE_CONFIG_DIR 또는 ~/.claude/.credentials.json도 읽어 valid/latest expiry 선택. refresh 후 file/keychain에 되쓰며 subscriptionType/rateLimitTier/scopes 보존; keychain value는 argv 대신 stdin batch. 근거: 같은 파일 `_find_claude_code_keychain_item`, `_keychain_mirror_command`, `claude_code_credentials_path`, `read_claude_code_credentials`, `_write_claude_code_credentials`, `_merge_keychain_credential_payload`(255–369,535–609).
- [확인] ~/.codex/auth.json 등 foreign source도 조회. 제거 시 foreign 소유 file을 지우지 않고 suppression으로 재seed 방지. R6으로 수입/mirror/source registry 모두 버림. 근거: `hermes-agent:agent/credential_sources.py` `adopt_external_logins_enabled`, Codex/Claude discovery/removal/suppression.
- [확인] file commit은 **0600 temp→fsync→atomic replace**, 외부 parent mode는 그대로. file은 평문 JSON, spent in-memory registry 상한 **64**+durable sidecar. borrowed pool payload만 raw secret 제거/sha256:16hex fingerprint, owned/manual은 그대로. account+org dedup이 아니다. 근거: `hermes-agent:agent/anthropic_credentials.py` `_atomic_write_private_json`, `_commit_private_json`, `_SPENT_ROTATION_MAX_TRACKED`(113–145); `hermes-agent:agent/credential_persistence.py` `fingerprint_secret_value`, `sanitize_borrowed_credential_payload`(12–120).
- [확인] inference system Claude Code prefix·UA `claude-code/<version> (external, cli)`·Claude/OAuth beta. session_search→chat_history_lookup, memory→context_notes, prose/model-product alias는 third-party extra-usage classifier 회피 의도를 주석에 명시. **[미확인] 주석의 live A/B 과금 결과는 재현 못했다.** R15로 버림. 근거: `hermes-agent:agent/anthropic_adapter.py` `_CLAUDE_CODE_SYSTEM_PREFIX`, `_OAUTH_TOOL_NAME_ALIASES`, OAuth 변환.

#### Pool·Codex·xAI

- [확인] pool default fill_first, round_robin/random/least_used 지원. first available 선택, round-robin은 tail 이동/priority 재작성. current 유지 가능하지만 strict run fixed-list affinity는 미확인. singleton/env/model_config/foreign auto seed 존재. model failure는 pair cooldown, whole-key failure는 same-key twins로 전파/rotate. 근거: `hermes-agent:agent/credential_pool.py` `PooledCredential`, strategy constants, `_select_unlocked`, `mark_exhausted_and_rotate`.
- [확인] 401 **5분**,429/default/403/5xx/unknown **1시간**; sole credential transient **cap60초**, unverified billing도402 아니면60초 완화; true billing은 긴 bench. server model reset 우선. Anthropic generic429 model scope; Codex model entitlement400은 **365일** pair bench/explicit auth reset 해제. 근거: 같은 pool의 `EXHAUSTED_TTL_*`; `hermes-agent:agent/credential_pool_model_cooldowns.py` cooldown helpers. R18/R24와 다름.
- [확인] `_refresh_credentials_after_401` provider별 one-shot 후 retry. 별도 fallback chain/restart가 있어 전체 retry 상한은 이것만으로 증명 못함. 근거: `hermes-agent:agent/turn_recovery.py` 해당 함수; `agent_init.py` `_init_fallback_chain`; `turn_api_error.py` fallback restart.
- [확인] official `https://chatgpt.com/backend-api/codex`에는 real HermesAgent UA/originator=hermes-agent, account header, residency(chatgpt_data_residency→compute fallback)를 강제. custom proxy는 codex_cli_rs UA/originator 호환 위장 branch. malformed unsigned JWT는 header 생략/401에 맡김. 근거: `hermes-agent:agent/codex_headers.py` official URL/header helpers, `apply_required_headers`.
- [확인] xAI discovery GET fixed `https://auth.x.ai/.well-known/openid-configuration`, auth/token HTTPS+x.ai/subdomain 검사·cached refresh endpoint 재검사. device는 discovery 대신 fixed constant. inference default `https://api.x.ai/v1`; invalid override는 warn/default. 여섯 scope 동일. 근거: `hermes-agent:hermes_cli/auth_xai.py` `_xai_oauth_discovery`, `_xai_validate_oauth_endpoint`, `_xai_validate_inference_base_url`, `_xai_oauth_request_device_code`; `auth_constants.py` constants(73,94–102).
- [확인] device response의 code/user_code/verification_uri/**verification_uri_complete**/expires_in/interval 모두 필수; token access/refresh 요구. short JWT skew 최대 **120초**, long 기본 **3600초**, pure refresh **20초**, missing refresh old 유지; root write-through best effort. refresh403 전체를 tier denied/relogin=false로 분류. **[미확인] 모든403이 plan이라는 공식 근거는 없다.** R19/R21은 확인된 code만 plan_access, WAF/unknown은 추측 금지. 근거: `hermes-agent:hermes_cli/auth_xai.py` expiry helpers, token/device helpers, `refresh_xai_oauth_pure`(300–350), write-through; constants `XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS`.
- [확인] 공유 poll slow_down **+1초/cap30초**; non-JSON408/429/5xx/WAF403는 Retry-After/backoff **cap60초**와 remaining cap. pending은 interval sleep, 성공 후 deadline 재검사 없음. R14의 +5초와 다름. 근거: `hermes-agent:hermes_cli/auth_device_flow.py` `_poll_device_token_generic`(315–366).

### Gemini CLI (`fb972b2f87fe7d5b06d37eac711490162d98de2c`)

- [확인] service gemini-cli-oauth/main-account, HybridTokenStorage. save는 missing refresh/scope/type/expiry를 existing과 merge; legacy file migrate 후 삭제. 근거: `gemini-cli:packages/core/src/code_assist/oauth-credential-storage.ts` `OAuthCredentialStorage.saveCredentials`, `migrateFromFileStorage`(19–155).
- [확인] hybrid 초기화 single Promise, keychain 또는 **ENCRYPTED_FILE** fallback 구분. legacy cache **0600**, temp/rename writer. encrypted fallback key 보관/threat model 전체는 미확인. 근거: `gemini-cli:packages/core/src/mcp/token-storage/hybrid-token-storage.ts` `initializeStorage`, `getStorage`(18–63); `code_assist/oauth2.ts` cache writer.
- [확인] Google library tokens event 저장, cached access/getTokenInfo 검증, Google userinfo 조회. library refresh single-flight/window는 repo-owned code만으로 미확인. Google OAuth는 지원 대상 아니며 storage 참고만 함. 근거: `gemini-cli:packages/core/src/code_assist/oauth2.ts` OAuth 초기화/tokens/cached validation/userinfo(`https://www.googleapis.com/oauth2/v2/userinfo`).

## 비교

### 로그인·허용·신원·과금

| 경로 | 코드/공식 확인 | 미확인·lophn 차이 |
|---|---|---|
| Claude public client | S256/paste 가능; 조사된 inference는 Claude Code 위장; A1은 제3자 login 제공 금지 | profile/inference-only 성공·own-name text/tool. extra usage는 사용 허가 아님 |
| ChatGPT legacy Codex | device→code exchange,1455,account/residency claims,backend,store=false/instructions | Codex 문서를 own-name 허용 증거로 대체 불가 |
| ChatGPT 공식 SIWC | 실제 이름/dynamic 등록/public Responses,stream=true/store=false,function/custom tools | R12/R16 변경, lophn eligibility·actual test·workspace dedup·residency 계약 |
| SuperGrok | device discovery/여섯 scope, named Hermes/OpenCode 구독 지원 | 임의 lophn client 사용 허가·등록·actual test |

근거: 프로젝트별 auth/inference 함수; A1/A2,O1–O6,X1–X3. real originator/UA가 있다는 것과 그 앱의 public OAuth client를 재사용해도 된다는 것은 별개다.

- [확인] legacy Codex/OpenCode claims에는 account/workspace/plan이 있지만 unsigned decode도 있다. Hermes Claude subscription metadata는 주로 foreign CLI payload. 신규 SIWC token metadata는 opaque `encrypted_auth_metadata`/`per_user_salt`. 기존 claims를 새 flow에 가정 금지. O2는 verified id_token **sub** 신원과 workspace를 구별하며 email/sub가 workspace ID가 아니라고 명시한다.
- [미확인] inspected Pi/OpenCode singleton·Hermes pool/fingerprint에서 R9와 동일한 **제품+검증 account+organization 중복 거절**은 못 찾았다. twins cooldown/rotation fingerprint는 dedup 아님. OpenClaw settlement identity 검사는 refresh mismatch 방어이지 register dedup 증거 아님. 근거: 각 auth store, Hermes `mark_exhausted_and_rotate`/`fingerprint_secret_value`, OpenClaw `validateSettlementCredential`.
- [확인·공식] SIWC는 ChatGPT allowance 권한이고 기존 conversation 접근권 아님(O1/O3); xAI는 named subscription 통합(X2/X3); Claude usage credits는 구독과 별도·API pricing(A2). API key=API 과금, 구독=청구액0으로 계산하지 않음. usage endpoint/header만으로 실제 청구액 확정 금지(R27). Hermes `account_usage.py` OAuth usage 조회도 billing amount 증거는 아님.

### refresh·여러 credential

| 구현 | 비교 |
|---|---|
| Pi/Codex | 저장 뒤 사용; Pi store lock, Codex manager semaphore |
| OpenCode | loader single-flight; xAI는 unsaved token 사용 |
| OpenClaw/Hermes | durable fence/spent generation; 자동 순서·fallback은 버림 |
| lophn | **60초/15초,machine lock,저장+CAS 뒤 사용,exact preset/run sticky** |

근거: 위 refresh/store/order/pool 함수와 R8/R10/R17/R18/R24. `[추측]` expiry 차감+resolver margin의 이중 여유를 피하려면 actual expiry와 refresh_due_at을 구별한다.

## lophn에 가져올 것과 버릴 것

requirements/domain model/open-issues는 이 조사에서 고치지 않는다.

| 요구 | 가져올 것 | 버릴 것·open-issues 후보 |
|---|---|---|
| R1 | verified_for_lophn=false,허용/login/refresh/text/tool evidence gate | fake/타 앱 성공을 실제 lophn 지원으로 안내 금지 |
| R6/R7 | platform/secrets opaque ref,durable 저장+ledger,redaction | foreign keychain/auth.json/env/plaintext fallback/import/mirror |
| R8/R10 | preset exact keys,run cursor,같은 provider/model 뒤 항목 | 종류 우선/round-robin/random/least-used/auto seed/drift 후보/fallback |
| R9 | secret 경계 key fingerprint,verified account+org,refresh mismatch 검사 | **open-issues 후보:** SIWC opaque workspace dedup 계약 미확인. 추천: field null/추정 금지·검증 전 gate 유지 |
| R11/R15/R27 | state missing 거절,실제 제품 identity,최소 scope | Claude identity/tool/prose/model alias. **open-issues 후보:** extra usage 요구는 A1 login 허용을 해결하지 않음. 추천: Claude OAuth disabled/API key,허용 확인 전 우회 금지 |
| R12/R16 | state/nonce/S256,exact audience/origin,store=false | **open-issues 후보:** 공식 own-name flow는 dynamic 등록/public Responses/loopback listener. device/no1455/backend 요구 변경 판단 후 별도 정의; legacy를 몰래 대체하지 않음 |
| R13/R14 | HTTPS+x.ai discovery/refresh 재검사,device-only,+5초,bounded deadline | fixed-only discovery/Infinity/Hermes+1초. **open-issues 후보:** xAI lophn client 허용 확인 전 disabled |
| R17 | double-check,durable generation/settlement,consumed-uncommitted fail closed | unsaved token 사용. **open-issues 후보:** 15초 뒤 POST 결과 미확정·저장 실패의 pending/spent/restart contract 필요; old refresh 자동 재POST 금지 |
| R18 | recovery budget refresh1+retry1,영속 human-reset block | Codex reload+refresh 추가 retry,auth_permanent 시간 복귀,4015분 복귀 |
| R19–R24 | server reset/model pair/safe code | 모든403 plan 추정/unknown auth/sole60초 예외. 긴·미상429는1시간 |
| R29/R30 | explicit 별도 text/tool test,30초,usage actual attempt | 설정 조회/usage_wait 중 probe,fake success gate 승격 |

## 구현 메모

### 자료 구조·상태

[추측·구현 제안] 기존 `ProviderCredential`의 secret_ref/revision/account/organization/plan/dedup/state/until/model_blocks와 `OAuthDefinition` endpoints/scopes/origins/gate를 쓴다.

1. Login state/nonce/verifier/device_code/expected exact callback/monotonic deadline은 메모리에만 둔다. raw 값을 ledger/trace/error에 남기지 않는다. secret bundle은 access/refresh/id_token,actual expiry,issued client_id/resource,verified identity를 함께 교체한다.
2. Refresh 순서는 lock→latest secret/revision reread→expiry check→POST1회→secret 저장→`RefreshProviderCredential` CAS→unlock/use. missing refresh는 old 유지, 빈/malformed 값은 contract 검증. secret save/ledger CAS 실패는 inference 금지·latest reread. concurrent revoke/relogin을 stale refresh가 덮지 못한다.
3. Caller cancel과 owner settlement를 분리한다. 서버 도달 가능 timeout/crash/write 실패를 단순 retry로 처리하지 않고 durable pending/spent generation으로 old refresh 재POST를 막는다. **15초 상한의 network/관측/settlement 의미 결정이 필요하다.**
4. Preset snapshot keys/cursor 고정,앞 회복 시 복귀 없음. refresh revision 교체와 계정 이동은 별개. identity가 바뀐 relogin을 진행 run이 자동 채택하지 않는다.
5. Auth/inference exact origin/path·redirect 검증. OAuth gateway 금지,caller가 identity/required header override 금지,SDK retry0. provider recovery 외 retry는 run-loop 소유. URL/exception nested cause까지 redaction한다.

### 기본값·오류 표

| 항목 | lophn contract |
|---|---|
| refresh | expiry60초 전,15초,machine credential lock |
| OAuth401 |refresh1+동일 request retry1 |
| expired/reused/revoked/account mismatch |rejected/revoked,human reset만 |
| device |missing interval5초,xAI slow_down+5초 |
| deadline |ChatGPT max900초,xAI missing expiry300초,late success 등록0 |
|429 |확인 retry≤30초 temporary,그 외 usage_wait |
|quota/billing |reset까지,모르면3600초,sole test 예외 없음 |
|model 불가 |credential+model pair만 block |
|SuperGrok403 |확인 plan code만 plan_access,unknown 추측 금지 |
|test |explicit user/별도 재료/30초/usage actual attempt |

근거: R14/R17–R24/R29/R30. 모르는 code는 unknown,raw body 보존 금지.

### fake server 테스트

[확인·테스트 코드] 테스트를 읽었지만 프로젝트 테스트 전체를 실행하지 않았다.

- Codex Wiremock issuer 주입: usercode→첫404 pending→success→code exchange, interval "0"로 real wait 제거,workspace allowed/disallowed·endpoint/exchange failure. `make_jwt`의 alg=none은 테스트 helper이지 운영 OIDC 방식 아님. 근거: `codex:codex-rs/login/tests/suite/device_code_login.rs` `make_jwt`, `mock_usercode_success`, `mock_poll_token_two_step`, login tests(29–88이후).
- OpenCode Bun.serve port0,URLs/now/sleep/auth.set failure 주입. concurrent2requests→refresh1 테스트와 **loader간 single-flight 공유 안 함** 테스트 구분. persist failure 후 새 Bearer200 기대는 lophn에서 inference0으로 반전. 근거: `opencode:packages/opencode/test/plugin/xai.test.ts` `makeInput/Server`, `serverOptions`, refresh tests(207–319),poll tests(451–565).
- Pi provider OAuth/device/callback/store tests 분리. 전체 coverage는 미확인. 근거: `pi:packages/ai/test/anthropic-oauth.test.ts`, `openai-codex-oauth.test.ts`, `openai-chatgpt-oauth.test.ts`, `xai-oauth.test.ts`, `oauth-device-code.test.ts`, `oauth-callback-server.test.ts`, `oauth-auth.test.ts`; `pi:packages/coding-agent/test/auth-storage.test.ts`.

[추측·fixtures] 테스트 이름은 요구 번호로 시작한다. fake HTTP 주입으로 production validator를 바꾸지 않는다.

1. **R11/R12:** missing/mismatch/중복 state,wrong callback origin/path,code#state 잘림,empty code,cancel,consumed one-time code timeout. 실패 token 등록0/safe error만.
2. **R12/R14:** 확인된 device-disabled 시작 응답만 fallback; poll403/404와 시작403/WAF 혼동 금지. pending→slow_down2회→success,denied,expired,cancel,missing expiry,deadline 뒤 response success 등록0.
3. **R13/R16:** HTTP/x.ai.evil.example/userinfo@evil/bad port/cached endpoint 변경/redirect/gateway에 token0bytes; trusted host만으로 임의 path 허용 금지.
4. **R9/R17:** same account+org concurrent registration2개,same email/different org,unknown identity,mismatch,10requests/2processes,re-read,missing refresh,stale lock/fence,refresh/revoke/relogin CAS race.
5. **R17/R18:** old refresh 소비 직후 crash,secret write/CAS failure,caller timeout late success,restart pending/spent recovery,stale refresh 재POST0,re401. retransmit body/tool/idempotency 동일,ModelCall actual attempts2개.
6. **R8/R10/R22/R24:** 등록A/B/C,preset[A,C],A quota→C,B0call,A복귀0,model pair 격리,sole reset 전test0,다른 provider/model fallback0.
7. **R15/R19/R27:** key/OAuth system/product/tool/model 동일,real lophn UA/originator,SDK retry0,billing/plan/WAF/auth 분류,body/query/nested exception/token prefix 노출0.
8. **R1/R29/R30:** fake 성공 gate 변경0. 실제 verification은 허용 근거 뒤 사람의 명시 요청·별도 고정 재료로 text+harmless tool 둘 다 확인;login/refresh/목적지/revision/usage evidence. 이번 조사에서는 안 했다.

### 공식 문서 확인 기록

모두 **확인일2026-10-04**. xAI publication만 별도 표기. activation 전에 재확인한다. 검색의 제3자 과금 우회 경험담은 정책 근거로 쓰지 않았다.

|표기|주소·확인 범위|
|---|---|
|A1|[Anthropic Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance): “Anthropic does not permit third-party developers to offer Claude.ai login into their own applications”; credential/session token collect/store/intermediate 금지,API key/cloud 권장. unmodified Claude Code binary hosting 예외는 lophn native OAuth 허가 아님|
|A2|[Claude usage credits](https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans): paid individual plan 후 표준 API pricing 별도 credits. third-party login 제공 허용 내용 없음|
|O1|[SIWC token sharing](https://developers.openai.com/siwc/token-sharing-open-source): open-source/locally hosted 앱,plan allowance,remote/paid는 [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/),ext_agent_host_id·user/workspace별 client|
|O2|[SIWC sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): actual app name,최초 dynamic client/issued client 저장·재사용,127.0.0.1 listener,state/nonce/S256,id_token signature/issuer/audience/expiry/nonce·reconnect match. device/listener-less 대안 미확인|
|O3|[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): public api.openai.com/v1/responses,**backend-api 금지**,store=false/stream=true,인증 models,response.completed,mid-stream sharing limit/unavailable|
|O4|[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference):access3600초,refresh30일·매 refresh 새30일,earliest_refresh_at,opaque metadata. earliest_refresh_at 의미/clear workspace/plan/residency는 이 페이지에서 확정 못함|
|O5|[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations):function/custom tools,full-context input array,explicit system item 거절(instructions/developer),HTTP previous_response_id 불가. residency 미확인|
|O6|[Codex auth](https://learn.chatgpt.com/docs/auth):developers.openai.com/codex/auth redirect 대상. 계정/workspace에서 device enable;불가 시 cache 복사/SSH1455 forwarding. R6/R12 own-name 증거 아님|
|X1|[xAI discovery](https://auth.x.ai/.well-known/openid-configuration):issuer/auth/token/device endpoints,device/code/refresh grants/scopes. registration_endpoint는 확인 response에서 없음|
|X2|[Grok in OpenCode](https://x.ai/news/grok-opencode),2026-05-21:SuperGrok/X Premium named integration/browser-headless device. 임의 lophn 계약 미확인|
|X3|[Grok in Hermes](https://x.ai/news/grok-hermes),2026-05-15:named Grok subscription integration. 임의 앱 공용 client 허가 미확인|

### 남은 확인

lophn actual OAuth evidence,SIWC workspace/refresh scheduling/residency,R11 최소 scope,R12 listener-less 지원,API key identity,plan/billing codes,OpenClaw storage 전체,Google library 내부는 미확인이다. CLI 위장/import로 메우지 않는다.
