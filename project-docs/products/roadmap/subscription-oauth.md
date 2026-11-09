# subscription-oauth: Claude·Antigravity 구독 provider의 남은 일

상태: 로드맵. 첫 구현은 main에 있다(commit `0dbf3658f`, `project-docs/products/change-log/0.9/claude-antigravity-subscription-oauth.yaml`). 실제 계정으로는 아직 아무것도 확인하지 않았다. 이 문서는 그 뒤에 남은 일을 모은다.
배경 문서: `project-docs/architecture/agent-definition.md`, `project-docs/products/change-log/0.2/chatgpt-supergrok-subscription-login.yaml`, `project-docs/products/change-log/0.9/claude-antigravity-subscription-oauth.yaml`, `research_notes/omp-subscription-oauth/README.md`.

## 왜

- 사람이 Claude와 Antigravity 구독으로 lophn의 model 호출을 하려 했다(2026-10-29). 0.2.0의 "Claude 구독 로그인은 두지 않는다"와 이 문서의 옛 추천(A, 넣지 않는다)을 사람이 뒤집었다.
- 두 길 모두 OAuth보다 그 뒤가 본체다. Claude는 Claude Code client profile, Antigravity는 Cloud Code Assist adapter와 project onboarding이다. 첫 구현은 로그인, refresh, inference까지 했고 quota와 실계정 확인이 남았다.
- Anthropic은 제3자 앱의 Claude.ai 로그인과 구독 credential 사용을 허락하지 않고, Cloud Code `v1internal`도 공개 API가 아니다. 계정 제재 위험은 그대로다.

## 지금 코드

- 정의: `anthropic`이 `api_key`와 `oauth`(product `claude`)를 받는다. 새 `google-antigravity`는 `oauth`(product `antigravity`)만 받고 protocol `cloud-code-assist`다(`packages/core/lophn-agent/providers/definitions.json`). `google-gemini`는 그대로 API key다.
- 로그인: `providers/oauth.ts`가 세션을 쥐고 `oauth-claude.ts`, `oauth-antigravity.ts`가 발급자·control plane 요청을 만든다. callback은 정의의 `redirect_uri` port에 고정이다. 계정(id, email, 조직, project)은 credential의 `account` 칸이다.
- refresh: `providers/oauth-refresh.ts`가 product별 grant를 보낸다. 늦게 온 답은 연결이 바뀌었으면 버린다.
- 호출: Claude는 `providers/adapters/claude-code.ts`, Antigravity는 `providers/adapters/cloud-code.ts`.
- 계정 model 목록: Antigravity는 `fetchAvailableModels`를 `reported_models`에 둔다(`providers/reported-models.ts`의 `readAccountModels`).
- test: `providers/login_test.ts`(두 로그인), `providers/oauth-refresh_test.ts`(Claude grant, 늦은 답), `providers/adapters/claude-code_test.ts`(cch fixture, profile), `providers/adapters/cloud-code_test.ts`(SSE, tool 결과 순서, envelope).

## 남은 일

1. **실계정 확인.** 같은 계정으로 로그인 → refresh → text 한 번 → custom tool 한 왕복을 확인한다. Antigravity는 project와 roster까지 보고, roster에 Claude가 있으면 Claude도 한 번 부른다. 사람이 계정을 쓰도록 허락해야 한다. 끝남 기준: 두 product가 lophn turn에서 tool 한 왕복을 끝낸다. 틀린 header·body는 이때 고친다.
2. **subscription quota.** Claude `GET /api/oauth/usage`와 inference 응답의 `anthropic-ratelimit-unified-*` header, Antigravity `retrieveUserQuotaSummary`(없으면 roster의 quota 칸)를 읽어 보여 준다. 받을 route와 화면이 아직 없다. quota 조회 실패가 credential 상태를 바꾸지 않아야 한다. scale이 다르다: Claude JSON은 0~100, header는 0~1, Antigravity는 남은 비율이다.
3. **401 뒤 한 번 다시 보내기.** 지금은 기존처럼 credential을 rejected로 둔다. 명세는 갱신 owner를 거쳐 한 번 replay한다.
4. **Antigravity roster profile.** model별 `maxOutputTokens`, `thinkingLevel`·`thinkingBudget`, `model_enum` label을 쓰지 않는다. effort는 `low`·`medium`·`high`만 thinkingLevel로 간다.
5. **Antigravity endpoint failover.** daily → sandbox 넘기기와 마지막 성공 host 기억이 없다.
6. **Thought signature.** lophn 이력에 signature가 남지 않아 Gemini functionCall에 서명 검사를 건너뛰는 표시를 싣는다. 이력에 signature를 두려면 message part 꼴이 바뀐다.
7. **발급자 대기열 본문 64 KiB 상한.** `fetchAvailableModels` 응답이 이보다 크면 목록을 못 읽고 거르지 않는다. 실계정 응답 크기를 보고 정한다.
8. **client version.** Claude CLI `2.1.280`과 Antigravity `2.26.0`이 고정이다. 서버가 낮은 version을 거절하면 올리는 길이 없다.

## 정한 것

- (사람, 2026-10-29) Claude 구독 OAuth와 Antigravity를 provider로 넣는다. 0.2.0의 Claude 배제 결정과 이 문서의 옛 추천 A를 뒤집는다.
- (사람, 2026-10-29) 구현은 `research_notes/omp-subscription-oauth/`의 README와 구현자용 문서 넷(implementation-spec, claude-code, google-antigravity, fixtures)만 보고 했다. 원본 코드, 분석 문서, 웹은 보지 않았다.
- (agent, 2026-10-25) `~/.claude/.credentials.json`, macOS keychain, `~/.gemini/antigravity-cli/...`를 읽어 쓰는 방식은 채택하지 않는다. refresh token rotation과 secret 경계가 깨진다.
- 첫 구현의 나머지 결정은 `change-log/0.9/claude-antigravity-subscription-oauth.yaml`에 있다.

## 하지 않는 것

- vendor native credential 파일 읽기.
- 여러 계정 자동 rotation, reset credit 소비, overage 설정 바꾸기.
- OAuth만 붙이고 Cloud Code adapter 없이 "Antigravity 지원"이라고 부르기.

## 2026-10-25 조사 기록

아래는 첫 구현 전에 서드파티 harness/proxy 15개를 읽은 기록이다. 구현은 이 기록이 아니라 위 명세를 따랐다.

### 밖의 구현체는 어떻게 붙였나

#### Claude

공통 상수:
- `client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- authorize `https://claude.ai/oauth/authorize`, 비표준 `code=true`
- PKCE S256, callback은 `code#state`, 교환은 JSON POST이고 client secret은 보내지 않는다.
- token endpoint는 최신 구현이 `https://platform.claude.com/v1/oauth/token`; omp만 `https://api.anthropic.com/v1/oauth/token`을 쓴다. hermes는 platform → console fallback.
- redirect는 loopback `http://localhost:54545/callback`, `https://console.anthropic.com/oauth/code/callback`, `https://platform.claude.com/oauth/code/callback` 세 가지가 쓰인다.
- scope는 6개(`org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`)가 흔하고, hermes는 3개만 받는다.

본체는 요청 위장이다:
- 첫 system block을 정확히 `You are Claude Code, Anthropic's official CLI for Claude.`로 둔다.
- `anthropic-beta: oauth-2025-04-20`과 `claude-code-20250219`를 기본으로 붙인다.
- tool 이름을 `_`, `mcp__`, `mcp_` 꼴로 바꾼다. single underscore `mcp_`가 제3자 classifier에 걸린다는 관찰 때문이다.
- `x-anthropic-billing-header: cc_version=<ver>.<3hex>; cc_entrypoint=<cli|sdk-cli>; cch=<5hex>;`를 넣는다.
- `metadata.user_id`를 JSON `{device_id, account_uuid, session_id}`로 넣는다.
- Stainless header set, `x-app: cli`, `user-agent: claude-cli/<ver> (external, cli)`를 맞춘다.

구현마다 넣는 층이 다르고, `cch` 계산도 두 진영이 다르다:
- omp/CLIProxyAPI: `xxHash64(body, seed=0x4d659218e32a3268)` 하위 20bit.
- opencode plugin/hermes-claude-auth: `sha256(first user text)[:5]`.
- hermes-agent와 mixdog는 billing header와 `metadata.user_id` 없이 동작한다고 가정한다.

즉 **필수 조합은 공개되지 않았고, 구현체들은 400/429 관찰로 맞춘다.** 어느 쪽도 실호출로 검증된 값이 아니다. version 문자열도 서버가 모델 접근을 gate하므로 계속 낡는다.

#### Antigravity

공통 상수:
- `client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`
- authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`
- scopes 5: `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs`
- `access_type=offline`, `prompt=consent`, callback `http://localhost:51121/oauth-callback` (또는 `127.0.0.1`)
- 교환은 form-urlencoded + `client_secret`. PKCE는 구현마다 있거나 없다.
- `client_secret`은 omp, mixdog, badri, cortexkit, CLIProxyAPI가 같은 공개 installed-app 상수를 박아 둔다. hermes PyPI 플러그인만 사용자에게 자기 Google client 등록을 요구한다.

OAuth 다음이 본체다:
- `POST {host}/v1internal:loadCodeAssist` body `{metadata:{ideType:"ANTIGRAVITY"}}`
- project가 없으면 `onboardUser` → LRO `GET /v1internal/{operation}` poll → `loadCodeAssist` 재확인
- `fetchAvailableModels`, `retrieveUserQuotaSummary`
- `POST {host}/v1internal:streamGenerateContent?alt=sse`
- host는 `daily-cloudcode-pa.googleapis.com`가 primary, `cloudcode-pa.googleapis.com`가 prod. hermes 플러그인만 prod 고정("daily sandbox가 free-tier Claude를 거절").
- envelope는 `{project, model, request, requestId, userAgent:"antigravity", requestType:"agent"}`. 구현에 따라 `sessionId`, `labels`, JSON key 순서까지 맞춘다. 최신 구현은 content 요청에 사실상 User-Agent만 보낸다.
- Claude도 Anthropic Messages가 아니라 Gemini `generateContent` wire로 간다. 구현체들이 맞춘 것: `functionCallingConfig.mode="VALIDATED"`, snake_case `thinking_budget`, `anthropic-beta: interleaved-thinking-2025-05-14`, Claude output cap 64,000, tool call `id`와 `functionResponse` FIFO 매칭, thought signature 캐시 또는 `skip_thought_signature_validator`.

구현체별:

| repo | OAuth | Cloud Code | 특징 |
|---|---|---|---|
| omp | 자체 | daily + sandbox failover | KDL 선언형 엔진, project onboarding, 동적 roster, UA version 자동 갱신 |
| mixdog | 자체 | daily 고정 | `127.0.0.1:51121`, PKCE, dev gate OFF |
| hermes PyPI 플러그인 | 자체, 사용자 client | prod 고정 | Electron fingerprint, 계정 rotation, quota 이중 풀 |
| cortexkit/antigravity-auth | 자체, PKCE | daily → prod | OpenCode/Pi 플러그인, Claude transform, sticky/hybrid 계정 |
| CLIProxyAPI | 자체, PKCE 없음 | daily 고정 | uTLS, header 순서, Anthropic↔Antigravity translator |
| badri/luislobo | 자체 + Antigravity app DB + `:9092` scrape | daily → prod | Anthropic `/v1/messages` ingress, account pool, identity scrub |
| usamashehab | 로그인 없음 | prod | `agy` CLI token file 재사용, OpenAI ingress만 |

주의할 것:
- model 접근이 UA의 client version에 gate된다. 낮은 version은 최신 model 목록을 못 본다.
- `onboardUser` body가 repo마다 다르다. CLIProxyAPI는 `tier_id` + metadata, cortexkit은 `tierId`만 보낸다. repo 안에 실측 캡처가 없어 어느 key가 맞는지 확정할 수 없다.
- 429가 quota가 아닐 수 있다. Claude Code의 billing header 줄, 제3자 vendor 이름, `requestType`, `cache_control`이 원인이라는 관찰이 있다.
- project를 못 찾으면 cortexkit/badri는 `rising-fact-p41fc`로 fallback하고, CLIProxyAPI는 hard fail한다.
- badri는 403 + "violation of terms of service"를 `ACCOUNT_BANNED`로 처리한다. repo README도 계정 ban을 경고한다.
- refresh token은 single-use로 rotate된다. naive concurrent refresh는 grant를 죽인다.

### 참고한 repo

조사는 repo를 `--depth=1`로 clone해 코드만 읽었고 provider 호출은 하지 않았다.

| repo | commit | 핵심 file |
|---|---|---|
| `can1357/oh-my-pi` | `0b5c27ab` | `packages/catalog/src/compat/rules/auth/{anthropic,google-antigravity}.kdl`, `packages/ai/src/providers/anthropic.ts`, `packages/ai/src/registry/oauth/google-antigravity.ts` |
| `NousResearch/hermes-agent` | `4ea8d23c` | `agent/anthropic_credentials.py`, `agent/anthropic_adapter.py`, `agent/account_usage.py` |
| `Vibhav-Aggarwal/hermes-claude-auth` | `5c33e3e9` | `src/hermes_claude_auth/adapter.py` |
| `kristianvast/hermes-claude-auth` | `6525928e` | `anthropic_billing_bypass.py` |
| `Meapri/hermes-claude-auth` | `b1cb93ba` | `anthropic_billing_bypass.py` |
| `tribgames/mixdog` | `d141c52f` | `src/runtime/agent/orchestrator/providers/anthropic-oauth*.mjs`, `antigravity-oauth-*.mjs` |
| `router-for-me/CLIProxyAPI` | `bc064340` | `internal/auth/claude/anthropic_auth.go`, `internal/auth/antigravity/{constants.go,auth.go}`, `internal/runtime/executor/claude_executor_cloaking.go` |
| `cortexkit/antigravity-auth` | `d17ca2e8` | `packages/core/src/{constants.ts,oauth.ts,project.ts,request.ts}`, `packages/opencode/src/plugin/request.ts` |
| `badrisnarayanan/antigravity-claude-proxy` | `aa568767` | `src/auth/oauth.js`, `src/cloudcode/request-builder.js`, `src/format/request-converter.js` |
| `luislobo9b/antigravity-proxy` | `772c9d30` | `src/auth/oauth.js` (badri와 동일), `src/constants.js` |
| `usamashehab/antigravity-proxy` | `9db90a53` | `antigravity_proxy.py` |
| `ex-machina-co/opencode-anthropic-auth` | `93cdd23b` | `plugin/src/{auth.ts,constants.ts,cch.ts,transform.ts}` |
| `musistudio/claude-code-router` | `057abaa1` | `packages/core/src/agents/local-providers/claude-code.ts` |
| `sst/opencode` | `32b57015` | `packages/web/src/content/docs/providers.mdx:356` |
| `hermes-antigravity-auth` (PyPI 1.8.0) | n/a | `antigravity_auth/{constants.py,oauth.py,project_context.py,envelope.py}` |
