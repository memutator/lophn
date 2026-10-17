# 계획: provider 구독 계정 OAuth 로그인을 끝까지 잇기

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py oauth build`). 통합 branch는 사람이 만든 `feat/oauth`(worktree `.claude/worktrees/oauth`)다. `lead.sh`가 만드는 `plan/oauth`를 쓰지 않으니 launch·merge는 `launch.sh`·`merge.sh`와 같은 단계를 `feat/oauth` 기준으로 손으로 밟는다.

## 이 계획

- 목표: 사람이 ChatGPT(Plus/Pro)와 SuperGrok 구독 계정으로 로그인하면, token이 `secrets.json`에 저장되고, provider가 연결되고, model 호출에 token이 실리고, 만료 전에 갱신되고, 갱신이 죽으면 credential이 `revoked`가 된다.
- 재료:
  - `research/lophn-now.md`: 지금 코드에 있는 것과 빠진 것(path, 함수, 줄). 이 계획의 사실 근거
  - `research/policy.md`: provider별 공식 입장(2026-10-17)
  - `research/ref-opencode.md`, `research/ref-hermes.md`, `research/ref-omp.md`: 참고 구현의 flow, endpoint, 실패 처리
  - OpenAI 공식 문서 `https://developers.openai.com/siwc/token-sharing-open-source/sign-in`, `.../models-and-inference`
  - `project-docs/issues/platform.md`의 "provider OAuth 로그인 길은 있지만 그 credential로 model을 부르는 길이 없다"
  - `project-docs/architecture/agent-definition.md`(secret 이름 공간, MCP OAuth), boundary-catalog의 `models`, `secrets`
- 범위 밖: Claude 구독 로그인(정한 것 1), ChatGPT의 옛 Codex 길(`chatgpt.com/backend-api`), 계정 여러 개, 다른 도구(Codex CLI, Claude Code, Grok CLI)의 credential file 읽기, ChatGPT 계정별 model 목록(`GET /v1/models`의 `visibility`), 401 뒤 강제 갱신·재전송, 429·403을 credential 상태로 남기기(API key에도 없는 길이다), core E2E(정한 것 10).
- 단위:
  - `oauth-login`: protocol의 OAuth 정의·login 입력, 발급자 요청 대기열을 MCP와 같이 쓰기, `providers/oauth.ts`·`login.ts` 다시 쓰기, token 저장과 Connect, daemon wiring.
  - `oauth-call`: runtime에 보내기 직전 갱신, `models/resolve.ts`의 OAuth 허용, ChatGPT 구독 오류 분류.
  - `oauth-ui`: 설정 화면의 sign in, device code 표시, 끊기 정리, wording.
- 순서: wave 1 `oauth-login`. wave 2 `oauth-call`, `oauth-ui`(서로 소유가 안 겹친다).
- 사람이 정할 것: 없음. 아래 "정한 것"의 추천으로 간다. 사람이 바꾸면 그 brief만 바꾼다.

## 정한 것

`(agent)`는 사람이 정하지 않고 근거로 정한 것이다.

1. **Claude 구독 로그인은 만들지 않는다. Anthropic은 API key만 둔다.** Anthropic의 legal-and-compliance 문서가 제3자 앱이 Claude.ai 로그인을 받거나 Free/Pro/Max credential로 요청을 보내는 것을 금지한다. 참고 구현(omp, hermes, opencode 옛 판)은 모두 Claude Code의 client_id를 빌리고 Claude Code인 척(system 머리말, user-agent, tool 이름 바꾸기)해야 model이 불렸다. opencode는 2026-03 Anthropic 법무 요청으로 지웠다. 지금 코드의 결정("Claude OAuth는 두지 않는다", `provider-values.ts`)과 같다. 사람이 로그인한 `claude` binary를 자식 process로 띄우는 길은 별도 roadmap 감이다. (agent)
2. **ChatGPT는 OpenAI 공식 "Sign in with ChatGPT"(token sharing, open-source flow)다.** PKCE + `127.0.0.1` loopback(`/auth/callback`, port는 OS가 고른다), 첫 등록은 `client_id=dynamic_agent_client`와 `agent_name_hint=lophn`, callback query의 발급 `client_id`를 저장해 교환·갱신에 쓴다, `ext_agent_host_id`(설치마다 하나, `urn:uuid:`), `resource=https://api.openai.com/v1`, `state`·`nonce`·verifier는 시도마다 새로, id_token은 JWKS 서명·issuer·audience(발급 client_id)·exp·nonce를 검증, token 응답의 granted scope에 `chatgpt.tokens.use.direct`가 없으면 실패. 호출은 API key와 같은 `https://api.openai.com/v1/responses`에 Bearer(`responses.ts`가 이미 `store:false`, `stream:true`)다. 지금 코드의 `POST /oauth/register`와 `/callback` 경로는 문서와 다르니 지운다. (agent)
3. **SuperGrok은 device code(RFC 8628) 하나다.** client_id는 Grok CLI의 공개 client `b1a00492-073a-47ea-816f-4c329264a828`, scope `openid profile email offline_access grok-cli:access api:access`, device endpoint `https://auth.x.ai/oauth2/device/code`, token endpoint `https://auth.x.ai/oauth2/token`, 요청은 모두 form이다. xAI가 Hermes·OpenCode 연동을 발표했지만 제3자 등록 길은 없어 참고 구현 모두가 이 client를 쓴다. 동의 화면에 Grok CLI로 보일 수 있고 xAI가 막으면 깨진다. 사람이 xAI 로그인을 원했다. OIDC discovery는 하지 않는다(endpoint는 정의 data다). 호출은 API key와 같은 `https://api.x.ai/v1`에 Bearer다. (agent)
4. **발급자 주소와 client 값은 모두 provider 정의 data다.** `OAuthDefinition`은 product별로 필요한 칸만 갖는다. chatgpt: `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `resource`, `scopes`. supergrok: `client_id`, `device_authorization_endpoint`, `token_endpoint`, `scopes`. `flow`는 product가 정한다(chatgpt `pkce_loopback`, supergrok `device_code`). `verified_for_lophn`, `allowed_call_origins`(읽는 곳 0), 상수 URL(`SIWC_AUTHORIZE`, `XAI_DISCOVERY`, JWKS), `xaiHostAllowed`를 지운다. `BeginProviderLogin`은 내장 정의 key가 아니라 `ConnectProvider`와 같은 정의 객체·endpoint·protocol을 받는다. 그래서 test는 정의의 주소를 loopback fake로 바꾸는 것만으로 돈다(e2e-design-2 요청: 제품에 test flag 없음). (agent)
5. **gate 셋을 지운다.** `LOPHN_LIVE_PROVIDER` 로그인 gate(`login.ts`), `verified_for_lophn`(정의, `oauth.ts`, 화면 `MethodButton`), wiring의 "http 없음". 실제 계정으로 확인하는 것은 사람이 앱에서 한다(AGENTS.md: 실제 provider 호출은 사람에게 묻는다). `LOPHN_LIVE_PROVIDER`는 `tools/dev.ts`와 live suite 쪽 쓰임만 남는다. (agent)
6. **발급자 HTTP는 runtime이 대신 보낸다.** core module graph에 외부 fetch를 두지 않는다(change-log 0.2.0 결정). MCP OAuth의 대기열(`extensions/mcp-auth-requests.ts`, runtime `mcp-auth-pump.ts`, machine route `TakeMcpAuthRequest`·`FinishMcpAuthRequest`)을 MCP와 provider가 같이 쓰는 하나로 만든다: 이름에서 `Mcp`를 빼고, GET을 받고(JWKS), `http:`는 host가 `127.0.0.1`·`[::1]`·`localhost`일 때만 받는다(fake 발급자). 대기열 instance는 하나다. 옛 이름은 남기지 않는다. (agent)
7. **로그인은 begin → (사람) → complete 되풀이다.** `BeginProviderLogin {id, name, definition, endpoint, protocol}` → `{login, flow, interval_ms, expires_at, sign_in:{url, user_code|null}}`. chatgpt는 begin이 listener를 열고 authorize URL을 낸다. supergrok은 begin이 device code를 받아 `verification_uri_complete`(없으면 `verification_uri`)와 `user_code`를 낸다. `CompleteProviderLogin {provider, login}`은 기다리지 않고 한 번 보고 돌아온다: `{state:"pending"}` 또는 `{state:"connected", provider: ProviderRecord}`. chatgpt는 listener가 callback을 받았으면 교환, supergrok은 token endpoint를 한 번 poll한다(`slow_down`이면 다음 간격을 늘린 `interval_ms`를 같이 낸다). 화면이 `interval_ms`마다 부른다. 기한이 지나면 세션을 지우고 listener를 닫고 `not_found`다. `submission`, `confirmation`(`secret_input`), 붙여넣기 창, `windowSecretOpener`를 지운다. writer 앞 처리기 구조(`withProviderLogin`)는 그대로 쓴다. (agent)
8. **token은 `secrets.json`에 이름 셋으로 둔다.** `provider.<id>`(access token, 지금 `secret_ref`와 목적지 규칙 그대로), `provider.<id>.refresh`, `provider.<id>.meta`(JSON: 발급 `client_id`(chatgpt), `subject`). `.refresh`·`.meta`는 어떤 provider의 `secret_name`과도 같지 않아 `providerSecretDestinations`가 보내지 않는다(위험 test로 본다). 만료 시각은 ledger `provider_credentials.expires_at`이다: `ConnectProvider`가 OAuth일 때 `expires_at`을 받는다. complete는 core 안에서 `ctx.secretStore.put` 셋 → `ConnectProvider`(`auth_kind:"oauth"`, `credential.secret = provider.<id>`) 순으로 한다. token은 renderer를 지나지 않는다. Connect가 실패하면 넣은 이름 셋을 지운다. (agent)
9. **갱신은 runtime이 token을 달라고 할 때 core가 한다.** `run-loop/runtime-secret.ts`의 `mcpOAuth` hook 옆에 provider OAuth hook을 둔다. `provider.<id>`이고 그 credential이 `oauth`이고 `expires_at`까지 5분 미만이면 provider별 single-flight로 token endpoint에 `grant_type=refresh_token`(chatgpt는 발급 `client_id`와 `resource`, supergrok은 정의 `client_id`)을 대기열로 보낸다. 성공하면 새 refresh(응답에 있으면)를 먼저 쓰고 access를 쓰고 `RefreshProviderCredential {expires_at}`. 400·401과 `invalid_grant`면 `RefreshProviderCredential {unavailable_reason:"refresh_revoked"}`(→ `revoked`)이고 token을 내주지 않는다. 그 밖 실패면 아직 안 지난 token은 그대로 내주고 지났으면 `unavailable`이다. `OAUTH_REFRESH_LEAD_MS`를 5분으로 바꾼다. (agent)
10. **test는 위험 셋만, unit으로 쓴다.** (a) complete가 state 불일치, nonce·audience가 틀린 id_token, `chatgpt.tokens.use.direct` 없는 scope를 거절하고 secret과 provider row를 남기지 않는다. (b) 갱신이 회전된 refresh token을 저장하고, `invalid_grant`면 credential이 `revoked`가 되고 token을 내주지 않는다. (c) `.refresh`·`.meta`는 어떤 목적지로도 안 나간다(`secret-refs_test.ts` 표에 행 추가). fake 발급자는 HTTP fn 주입(handler 하나 층)이다. 서버를 띄우는 fake 발급자(`tests/support/fake-oauth/`)와 core E2E는 e2e-design-2 session의 다음 계획 `e2e-coverage`가 만든다. 이 계획은 그쪽에 flow 명세를 넘긴다. (agent)
11. **model 호출: `credential.kind === "oauth"`를 허용하고 header는 `authorization: Bearer`, `billing_route`는 `subscription`이다.** ChatGPT 구독 오류 code(`subscription_sharing_usage_limit_exceeded`, `subscription_sharing_user_not_eligible`, `subscription_sharing_unsupported_capability`, `subscription_sharing_route_not_supported`, `subscription_sharing_invalid_user`, `chatpass_v2_scope_not_authorized`, `chatpass_v2_invalid_authorization_context`)는 HTTP body와 stream `response.failed` 모두에서 retry하지 않는 credential 실패로 분류한다(한도는 `quota`, 나머지는 `plan_access` 또는 `authentication`). (agent)
12. **`ext_agent_host_id`는 처음 ChatGPT 로그인 때 `IdSource`로 만들어 data root에 한 번 저장하고 다시 쓴다.** 지금 lophn에 설치 id가 없다(grep 0). 어디에 두나는 `oauth-login` brief가 지금 있는 저장 자리 가운데 가장 단순한 것으로 정한다. (agent)
13. **화면: ChatGPT 단추 문구는 "Continue with ChatGPT"(OpenAI branding 규칙), SuperGrok은 device code를 dialog 안에 보이고 browser를 연다.** 끊기는 이름 셋을 다 지운다. (agent)

## 알아 둘 위험(사람에게 이미 알렸다)

- ChatGPT plan usage는 open-source client에 self-serve로 열려 있고 상업 앱은 신청이 필요하다. lophn이 open-source로 배포되지 않으면 로그인은 돼도 `chatgpt.tokens.use.direct`가 안 올 수 있다. 그때 complete는 "plan usage 없음"으로 실패한다(정한 것 2).
- SuperGrok은 남의 client(Grok CLI)라 xAI가 막으면 하루아침에 깨진다. 등급에 따라 로그인 뒤 403이 난다는 보고가 있다(Hermes issue #26847).
- refresh token은 회전한다. 같은 token을 두 곳에서 쓰면 서로 폐기한다. 갱신은 core 한 곳, provider별 single-flight다.

## 지켜야 할 것(worker brief에 그대로 넣는다)

- 실제 provider endpoint를 부르지 않는다. fake 발급자는 HTTP fn 주입이다. `~/.lophn`과 사람 home의 credential file(`~/.codex`, `~/.claude`, `~/.grok`)을 열지 않는다.
- token, code, verifier, device_code, refresh token은 ledger·event·log·route 출력·오류 메시지에 남기지 않는다. renderer를 지나지 않는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. 옛 이름, `v2`, 호환 장치를 두지 않는다.
- 시각, id, 무작위 값은 인자(`Clock`, `IdSource`, `RandomSource`)로 받는다.

## lead가 할 일

- 이 계획 문서와 research를 `feat/oauth`에 commit한다. e2e-design-2 session에 flow 명세(정한 것 2~10, command·route 이름과 actor, fake가 흉내 낼 endpoint, secret 이름, 불변 조건)를 보낸다.
- merge 때마다 brief의 "끝남"을 대고, 보고의 "무겁게 짠 것"·"알려진 미완 동작"을 `issue` skill대로 올린다.
- 모두 merged면: `project-docs/architecture/provider-oauth.md`(로그인 순서, 대기열, secret 이름 셋, 갱신, 지키는 것)를 쓰고 registry에 올린다. `agent-definition.md`의 secret 이름 공간 줄을 고친다. `issues/platform.md`의 provider OAuth 절을 닫는다. changelog 열린 판에 항목을 덧붙인다. 계획 폴더를 지운다. main에 올리는 것은 사람에게 묻는다.
