# Provider 구독 OAuth 정책 조사

조사일: 2026-10-17. 조사 방법: WebSearch + WebFetch. provider auth endpoint는 부르지 않았고 home 아래 credential file도 열지 않았다.

읽는 법. 출처 등급을 이렇게 나눈다.
- **[공식]** provider가 직접 낸 문서·약관·공지·공식 계정 글
- **[2차]** 기사·블로그·GitHub issue·제3자 project 문서. provider의 말을 옮긴 것이거나 추측일 수 있다.

WebFetch는 작은 model이 페이지를 요약해 돌려주므로 아래 인용은 그 요약 안에 나온 문구다. 길을 고르기 전에 핵심 문장은 원문으로 한 번 더 확인하는 것이 좋다. 날짜는 출처마다 어긋나는 곳이 있어 그대로 적었다.

## 한눈에

| Provider | 지금 상태 | 한 줄 |
|---|---|---|
| Anthropic | **회색에 가까운 금지** | 문서는 제3자 앱이 구독 login을 받거나 구독 credential로 요청을 보내는 것을 금지한다. 같은 회사의 help 문서는 "third-party apps도 구독 한도로 쓸 수 있다"고 해서 문서끼리 어긋난다. 공식 허용 길은 "사람이 수정 없는 Claude Code binary에 직접 login"뿐이다. |
| OpenAI | **허용 (공식 길 있음)** | 2026-09-29 DevDay에서 "Sign in with ChatGPT"의 plan usage를 공식 출시했다. open-source 앱은 self-serve로 client가 등록된다. 그 전의 Codex CLI client 재사용은 문서 없는 묵인이었다. |
| xAI | **허용에 가까운 회색** | xAI가 Hermes(5/15)와 OpenCode(5/21)에 SuperGrok OAuth를 공식 발표했다. 하지만 제3자 일반 등록 program이나 약관 문구는 못 찾았고, 공유 Grok CLI client를 쓰며 allowlist와 tier 제한(403) 보고가 있다. |

---

## 1. Anthropic

### 지금 상태

**회색에 가까운 금지.** 문서가 서로 어긋난다.

- 가장 강한 문서는 `code.claude.com` "Legal and compliance"다. 구독 OAuth는 Claude Code와 "other native Anthropic applications"용이고, 제3자 개발자가 Claude.ai login을 자기 앱에 넣거나 Free/Pro/Max credential로 사용자 요청을 라우팅하는 것을 금지한다. 2026-10-17에 직접 읽은 내용이다.
- 반면 help center "Use the Claude Agent SDK with your Claude plan"(2026-10-07 갱신)은 "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits"라고 쓴다. 이 둘이 같은 날 기준으로 공존한다. 어느 쪽이 우선인지 Anthropic이 설명한 글은 못 찾았다. 추측: help 문서는 "Claude Code binary 또는 Agent SDK(안에서 Claude Code를 띄움)를 경유한 사용"을 말하고, legal 문서는 "제3자가 token을 직접 잡는 것"을 금지하는 것으로 읽는 것이 둘을 가장 덜 모순되게 맞춘다. 이 해석은 확인된 것이 아니다.

### 근거

1. **[공식] Legal and compliance** — https://code.claude.com/docs/en/legal-and-compliance (2026-10-17 읽음)
   - "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
   - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
   - Agent SDK를 쓰는 개발자도 API key(Claude Console 또는 cloud provider)를 쓰라고 한다.
   - 예외: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". 단, binary를 수정하면 안 되고, 로그인 방식을 제거·제한하면 안 되며, 사용 요금을 대신 내거나 중개하면 안 된다("Each end user must authenticate with their own ... Claude subscription plan credentials").
   - "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
   - 2월 판에 있던 "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service ... violation of the Consumer Terms" 문장은 10-17에 읽은 판에는 없다. (2차 출처 하나도 10월에 그 문구가 빠졌다고 한다. 정확한 삭제 날짜는 확인 못 함.)
2. **[공식] Consumer Terms** — https://www.anthropic.com/legal/consumer-terms (효력 2025-10-08)
   - 3절 7항: bot·script 등 자동화/비인간 수단으로 서비스에 접속하는 것을 금지하되, Anthropic API key로 하거나 Anthropic이 명시적으로 허용한 경우는 예외다. The Register는 이 조항이 2024-02부터 같았다고 쓴다.
   - 2절: 로그인 정보를 타인과 공유하거나 계정을 타인에게 줄 수 없다.
   - 12절: 위반 시 구독을 포함한 접속을 언제든 일시 중단·해지할 수 있고 통지 없이 할 수 있다.
3. **[공식] Help center, Agent SDK와 plan** — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
   - 2026-06-15 노트: "We've paused the previously-announced changes to Claude Agent SDK usage." 지금은 아무것도 안 바뀌었다.
   - 2026-10-07 노트: Max와 Team 요금제에 monthly API credit이 생겼다. 위 "still use ... third-party apps with your subscription limits" 문장이 여기 있다.
4. **[공식] Monthly API credits** — https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
   - Max 5x $100, Max 20x $200, Team Standard $20 / Premium $100 (Free, Pro, Enterprise 제외). 이 credit은 Console API(API key)에 쓰인다.
   - "API credits cover claude -p and the Claude Agent SDK when you run them yourself with an API key. If you sign in with your plan instead, that usage draws from plan limits."
   - 제3자 앱에 대한 일반 규칙은 이 페이지에 없다. (BigGo 기사는 이 credit이 제3자 앱에 쓰인다고 쓰지만 이 페이지와 맞지 않고 기사에 formal program/OAuth 설명도 없다. 신뢰하지 않는다.)
5. **[공식] 인증 문서** — https://code.claude.com/docs/en/authentication: 구독 login은 Claude Code가 하는 것으로만 설명된다. 제3자 앱용 OAuth client 등록이나 "Sign in with Claude" 같은 program은 없다. `claude setup-token`이 1년짜리 token을 주지만 CI와 script에서 Claude Code를 돌리는 용도(`CLAUDE_CODE_OAUTH_TOKEN`)로 적혀 있다.

공식 허용 program(제3자용 OAuth client 등록, "Sign in with Claude")은 이번 조사에서 찾지 못했다. 없다고 단정하지는 않지만 공식 문서에는 안 보인다.

### 시간 순 사건

| 날짜 | 사건 | 출처 |
|---|---|---|
| 2024-02 | Consumer Terms 3.7(자동화 접속 금지)이 이때부터 같은 문구라고 보도됨 | [2차] The Register 2026-02-20 |
| 2026-01-09 | 서버 쪽 차단. Claude Code client를 흉내 내 구독 OAuth로 붙던 OpenCode 등이 일제히 실패. Claude Code 팀 Thariq Shihipar가 X에서 "tightened our safeguards against spoofing the Claude Code harness"라 함. abuse filter로 일부 계정이 자동 ban 됐고 되돌리는 중이라고 인정. 차단 자체는 의도적 | [2차] VentureBeat 2026-01 https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses (Thariq 발언은 X 원문을 직접 못 봄) |
| 2026-01 | Thariq: 이런 harness는 "unusual traffic patterns without any of the usual telemetry"라서 rate limit·ban 문의를 debug하기 어렵다 | [2차] The Register |
| 2026-02-19 | Legal and compliance 문서 개정. "OAuth tokens ... in any other product, tool, or service"는 Consumer Terms 위반이고 Agent SDK도 해당한다고 명시. Anthropic은 "docs clean up", 기존 정책 문구를 일관되게 한 것이라 설명. Thariq는 혼란을 사과하고 Agent SDK로 사업하려면 API key를 쓰라고 조언 | [2차] WinBuzzer https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/ , The Register https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/ |
| 2026-02-19 (또는 03-19) | OpenCode가 Claude Pro/Max OAuth 코드를 제거. commit이 "anthropic legal requests"를 인용. 날짜가 The Register는 02-19, 다른 블로그는 03-19로 다름. Anthropic이 법적 요청을 보냈다고 하나 요청 원문은 못 봄 | [2차] The Register, lilting.ch |
| 2026-04-03/04 | Boris Cherny(Claude Code 책임)가 X에 공지. 04-04 12:00 PT(15:00 ET)부터 Pro/Max 구독은 OpenClaw 같은 제3자 harness를 덮지 않고, usage bundle을 사거나 API key를 써야 함. 이유: 용량 부담, 제3자 tool은 prompt caching을 못 씀. 이 단계는 계정 정지가 아니라 한도·과금 차단 | [2차] AlternativeTo https://alternativeto.net/news/2026/4/anthropic-ends-free-claude-access-for-third-party-tools-like-openclaw , dev.to |
| 2026-04-10 | OpenClaw 제작자 Peter Steinberger의 Claude 계정이 "suspicious activity"로 정지됐다가 몇 시간 뒤 복구. Anthropic 엔지니어는 "OpenClaw 때문에 ban한 적 없다"고 답함. 원인은 공개 안 됨 | [2차] TechCrunch https://techcrunch.com/2026/04/10/anthropic-temporarily-banned-openclaws-creator-from-accessing-claude/ |
| 2026-05-13 | Anthropic이 @ClaudeDevs로 변경 공지. 제3자·`claude -p`·SDK 사용을 구독 한도에서 떼어 월 "Agent SDK credit"(Pro $20, Max 5x $100, Max 20x $200)으로 옮기고 6/15 시행. 다 쓰면 extra usage(API 요금). VentureBeat는 이를 "제3자 agent 사용 재개, 단 catch 있음"으로 보도 | [2차] VentureBeat https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch (원 공지는 X라서 직접 못 봄) |
| 2026-06-15 | 위 변경을 시행 하루 전후로 보류. 지금은 SDK, `claude -p`, 제3자 앱이 이전처럼 구독 한도를 쓴다. "advance notice before any future change"를 약속 | [공식] help 문서(위 3번), [2차] Zed 블로그 https://zed.dev/blog/anthropic-subscription-changes |
| 2026-10-07 | Max/Team에 monthly API credit 추가. 위 help 문서 문구 갱신. legal 문서에서 "any other product" 문장이 빠진 것으로 보임 | [공식] help 문서 |

### API key와 구독의 구분 (Anthropic)

- API key(Console, pay-per-token)는 제3자 앱에 쓰는 정식 길이다. 어떤 앱이든 사용자가 자기 key를 넣을 수 있다.
- 구독 OAuth token은 "Claude Code와 Claude.ai용"으로 한정된다. Agent SDK를 써도 제품은 API key를 쓰라는 것이 legal 문서의 입장이다.
- 구독으로 갈 수 있는 유일한 문서상 길: 사용자가 수정 안 된 `claude` binary에 직접 login하고, 앱은 그 binary를 띄우기만 한다(앱이 token을 만지지 않음). 이 길이 안전하다고 Anthropic이 보증한 것은 아니다. 2026-05 공지에서는 ACP로 Claude Code를 쓰는 경우(Zed)도 "제3자 pool"로 분류하려 했고, 그 변경은 보류됐을 뿐 철회가 아니다.

### 계정 위험 보고

- 2026-01-09 차단 때 abuse filter로 자동 ban된 계정이 있었고 Anthropic이 되돌린다고 했다 [2차, VentureBeat]. 개별 사례로는 Claude Code 사용량 추적 Mac 앱을 만들었다가 ban됐다는 사용자 주장이 있다 [2차, WinBuzzer 인용, 검증 안 됨].
- 2026-04-10 Steinberger 정지는 몇 시간 만에 복구됐다. 정지 원인은 불명.
- 대량의 ban 통계나 "OAuth token 재사용 → 영구 정지" 같은 확인된 사례는 못 찾았다. 일반적으로 보고된 피해는 "token 거부(4xx)"와 "과금 전환"이 대부분이다.
- Consumer Terms 12절은 통지 없는 정지를 허용하므로 위험은 약관상 존재한다.

---

## 2. OpenAI

### 지금 상태

**허용 (공식 길 있음).** 두 시기로 나뉜다.

- 2026-09-29 이전: 문서에 안 적힌 묵인. Codex CLI의 OAuth flow를 재사용하는 방식을 제3자 도구(OpenCode, OpenClaw, pi 등)가 썼고, OpenAI 직원이 말로 환영했다. 약관에는 명시 허락이 없다.
- 2026-09-29 이후: "Sign in with ChatGPT"의 plan usage가 공식 기능이 됐다.

### 근거

1. **[공식] Sign in with ChatGPT 문서** — https://developers.openai.com/siwc
   - 개요: 사용자가 ChatGPT 계정으로 앱에 login하고 "eligible AI requests"에 자기 ChatGPT plan을 쓰게 한다. 세 가지 통합: website, ChatGPT plugin, open-source app.
2. **[공식] 접근 조건** — https://developers.openai.com/siwc/quickstart , https://developers.openai.com/siwc/request-client-id
   - "ChatGPT plan usage is available to all open-source partners and selected private clients." 상업 앱은 "limited trial for selected commercial partners"이고 interest form으로 신청한다.
   - 사용자는 ChatGPT Plus 또는 Pro. Free는 login만 되고 plan usage는 안 된다 [2차, dev.to 인용].
3. **[공식] open-source 앱 flow** — https://developers.openai.com/siwc/token-sharing-open-source
   - client 등록은 첫 login 때 동적(`dynamic_agent_client`)이고 client secret도 partner API key도 필요 없다. OAuth는 state, nonce, PKCE에 loopback listener. 발급된 `client_id`는 그 사용자와 workspace에 묶인다.
   - host마다 안정적이고 불투명한 `ext_agent_host_id`를 만들어야 한다 (jwk-thumbprint 권장, `urn:uuid`, `did:key`).
   - "This does not grant access to their ChatGPT conversations or other account context."
   - 사용자는 ChatGPT 설정에서 앱별 사용을 관리·해지할 수 있다.
4. **[공식] 제약 (preview limitations)** — https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations , https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
   - `https://api.openai.com/v1` Responses API로 보내야 하고 ChatGPT `backend-api`로 보내면 안 된다. `store: false`, `stream: true` 필수. `previous_response_id`, `temperature`, `max_output_tokens`, file search, Code Interpreter, hosted MCP, image generation 등은 안 된다. function/custom tool은 된다.
   - Codex app-server를 이 token으로 쓰는 길도 문서화돼 있다 (https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server). app이 token 갱신을 맡고 app-server를 재시작해야 한다.
5. **[2차] scope, token 수명, 한도** — dev.to https://dev.to/hassann/sign-in-with-chatgpt-for-developers-the-oauth-flow-plan-usage-and-what-it-means-for-your-api-bill-48f7 (OpenAI 문서 인용이라 하나 이 글만으로는 검증 못 함)
   - identity scope `openid profile email`, plan usage scope `offline_access resource.invoke chatgpt.tokens.use.direct` + `resource=https://api.openai.com/v1`.
   - access token 1시간, refresh token 30일(사용 때마다 교체).
   - 사용자가 앱별 주간 cap을 plan 대비 퍼센트로 정한다(10~100%). 한도가 차면 멈추고 API 과금으로 자동 전환되지 않는다. Plus에는 앱 전체가 공유하는 5시간 한도가 있고 Pro에는 없다. 에러 코드 `subscription_sharing_usage_limit_exceeded`(429), `subscription_sharing_user_not_eligible`(403) 등.
6. **[2차] DevDay 발표** — daily.dev https://daily.dev/posts/openai-makes-sign-in-with-chatgpt-a-way-to-use-your-subscription-in-third-party-developer-tools-7ewaoo6ze (The New Stack 기사 요약, 날짜 2026-09-29 표기. The New Stack 원문은 내용을 못 읽음)
   - 16개 launch partner에 OpenCode, Devin, Amp, Warp, Notion, Vercel 등이 있고 Lovable은 "coming soon". "Sign in with ChatGPT"는 7월에 identity용 beta로 먼저 나왔다.
   - OpenAI 자체의 DevDay 공지 페이지는 이번 조사에서 못 찾았다.
7. **[공식, 약관은 모호] Codex CLI client를 다른 도구가 써도 되나** — https://github.com/openai/codex/discussions/8338
   - 유지보수자(etraut-openai)가 2025-12-19에 "you're welcome to fork the repo", 2026-02-09에 "I'm an engineer, not a lawyer", 약관과 code license가 "quite permissive"하고 "OSS projects like OpenCode are doing things similar"라고 답했다. 법적 허락은 아니다.
   - 같은 discussion에서 사용자가 지적한 약관 문구: 서비스를 "automatically or programmatically" 쓰거나 추출하는 것을 금지(2025-12 시점 질문). 2026-08-27 댓글: 기업 통합을 "known clients list"에 올리려 해도 등록 경로를 못 찾았고 답이 없었다.
   - Codex 문서/app-server README에서 "known clients list"나 제3자 client 등록 문구는 찾지 못했다.
8. **[2차] OpenAI 직원 발언** — The Register 2026-02-20 및 Zylos https://zylos.ai/research/2026-07-13-subscription-auth-boundaries-official-cli-agent-automation : Codex 책임자 Thibault Sottiaux(와 Sam Altman)가 ChatGPT Plus 이상 구독을 pi, OpenCode 같은 제3자 harness에서 쓰는 것을 공개 지지했다고 한다. 발언 원문은 못 봄. 약관상 구속력은 없다는 해설이 같이 붙는다.
9. **[2차, 제3자 문서] OpenClaw** — https://docs.openclaw.ai/providers/openai : "OpenAI explicitly supports subscription OAuth usage in external tools"라고 쓰지만 OpenAI 문서가 아니라 project 주장이다.

### 시간 순 사건

| 날짜 | 사건 |
|---|---|
| 2025-12-19 | openai/codex discussion 질문, 유지보수자 "fork 환영" |
| 2026-01 | OpenCode가 OpenAI와 Codex 구독 지원을 추진한다고 보도 [2차, VentureBeat 1월 기사 내 한 줄]. 공식 공지는 못 찾음 |
| 2026-02 | Sottiaux가 제3자 harness 사용을 공개 지지했다고 보도 [2차]. 02-09 유지보수자 "OpenCode 같은 OSS project가 비슷한 일을 하고 있다" |
| 2026-04 | Anthropic이 막은 시점에 OpenAI는 같은 조치를 하지 않았다고 보도 [2차, Puter 등] |
| 2026-07 | "Sign in with ChatGPT" beta 출시 (identity 용) [2차] |
| 2026-09-29 | DevDay: plan usage 공식 출시, 파트너 16곳 [2차 + 공식 문서] |
| 2026-10 (조사일) | 문서는 "preview"이고 상업 앱은 limited trial |

### 계정 위험

- Codex OAuth를 제3자 도구에서 썼다는 이유로 OpenAI가 ban했다는 보고는 못 찾았다. 하나 있던 "Codex + ChatGPT Pro account banned" forum 글은 사용자가 VPN/병원 망 때문이라고 보고 있고 제3자 도구와 무관해 보인다 [2차, community.openai.com 검색 결과 요약만 봄].
- 공식 길(SIWC plan usage)을 쓰면 위험은 한도 소진(429)과 사용자가 해지하는 경우 정도다.
- 비공식 길(Codex CLI client를 흉내 내고 `chatgpt.com/backend-api` Codex backend를 부름)은 요청 모양(system prompt 등)이 바뀌면 깨질 수 있다는 지적이 있다 [2차, Puter]. 위 preview 문서는 backend-api로 보내지 말라고 쓴다.

---

## 3. xAI

### 지금 상태

**허용에 가까운 회색.** 공식 발표는 있지만 일반 제3자 program이나 정책 문서는 못 찾았다.

### 근거

1. **[공식] Hermes** — https://x.ai/news/grok-hermes (2026-05-15): "Use your Grok account and subscription inside Nous Research's open-source, self-improving Hermes agent." 연결은 "available on every tier". 한도·약관 내용은 없다.
2. **[공식] OpenCode** — https://x.ai/news/grok-opencode (2026-05-21): "Use your SuperGrok or X Premium subscription inside OpenCode." 설치 후 `/connect`에서 xAI 선택. 브라우저 login과 headless용 device code login 두 가지. "More open-source agents and integrations are coming soon." 한도·약관 내용은 없다.
3. **[2차] 확장 시점** — AgentRiot https://agentriot.com/news/ai-tools/xai-grok-oauth-agents-v2 : OpenClaw 5/19에 native OAuth plugin(device code 포함). 이 기사는 1차 출처 링크를 안 달았다.
4. **[공식] Grok Build CLI 인증 문서** — https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md : 기본 browser login은 `auth.x.ai` OAuth, `grok login --device-auth`로 device code. API key는 console.x.ai에서 받아 CI·자동화용. 이 페이지는 제3자 사용, 구독, 과금에 대해 말하지 않는다. 구독 OAuth scope 목록도 없다(문서에 나온 `openid profile email offline_access api:access`는 enterprise OIDC 설정의 기본값).
5. **[2차, 제3자 문서] 구현 사실**
   - OpenClaw 문서 https://docs.openclaw.ai/providers/xai : xAI의 "shared OAuth client"를 쓰고 consent 화면에 "Grok Build"가 뜰 수 있다. OAuth API token을 받을 수 있는 계정은 xAI가 정한다("xAI alone decides which accounts can receive OAuth API tokens"). 구독 traffic은 `https://cli-chat-proxy.grok.com/v1`로 간다. client ID, scope, endpoint는 문서화돼 있지 않다.
   - pi-xai-supergrok https://pi.dev/packages/pi-xai-supergrok : "Not affiliated with xAI", 공개 Grok CLI client ID를 재사용, 이유는 xAI가 "loopback OAuth from allowlisted clients"만 받기 때문. 일부 SuperGrok tier에서 login 후 403이 날 수 있음. (소스가 README라서 allowlist 주장은 검증 못 함.)
   - Hermes 문서 https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth : "xAI's backend enforces its own allowlist on the OAuth API surface". xAI가 보증한다는 문구는 없다.
   - Hermes issue #26847 https://github.com/NousResearch/hermes-agent/issues/26847 : 표준 SuperGrok($30)에서 inference 403("Beta is only available for SuperGrok Heavy users"라는 대시보드 문구). 8월 댓글은 $30 plan이 몇 주째 잘 된다고 했다. "Closed as not planned". xAI의 공식 답은 없다. 원인은 reporter의 가설이다.
6. **약관/정책**: 위 xAI 공지 둘 다 footer에 Terms, AUP 링크만 있고 구독 token을 제3자 앱에서 쓰는 것에 대한 문구는 없다. xAI 개발자 문서(docs.x.ai)에서 제3자 OAuth client 등록, device code, scope를 설명한 페이지는 못 찾았다. 있는데 못 찾았을 가능성이 있다.

### 시간 순 사건

| 날짜 | 사건 |
|---|---|
| 2026-05-15 | xAI, Hermes Agent 공식 연동 발표 |
| 2026-05-16 | Hermes issue #26847: 일부 SuperGrok에서 403 |
| 2026-05-19 | OpenClaw에 xAI plugin(OAuth, device code) |
| 2026-05-21 | xAI, OpenCode 공식 연동 발표 |
| 2026-08-10 | #26847에 "$30 plan 정상" 댓글 |

### 계정 위험

- 구독 OAuth 때문에 xAI가 계정을 정지했다는 보고는 못 찾았다. 관찰된 실패는 403(tier·allowlist)뿐이다.
- (Anthropic 사건과 별개) 2026-01 보도: xAI 직원이 Cursor 경유로 Claude를 쓰다 Anthropic에 접근을 잃었다 [2차, VentureBeat]. xAI 자체의 정책과 무관하니 참고만.
- 위험 요소: 공유 client(Grok Build) 의존, 문서화 안 된 `cli-chat-proxy` endpoint, allowlist. 공식 연동이 "등록된 파트너"에게만 열려 있고 lophn은 그 목록에 없을 가능성이 있다. 이것은 추측이다.

---

## 4. 요약: lophn이 provider별로 고를 수 있는 길

각 길은 (A) 공식 허용, (B) 사람이 위험을 지고 켜는 길, (C) 안 하는 길로 나눈다.

### Anthropic
- **A. 공식 허용에 가장 가까운 길**: lophn은 token을 만지지 않는다. 사용자가 수정 없는 `claude` binary에 직접 login하고 lophn은 그 binary를 자식 process로 띄운다(또는 사용자 API key). legal 문서가 "end user가 수정 안 된 Claude Code binary에 자기 구독으로 login하는 것"을 막지 않는다고 쓴다. 다만 이 길도 6/15 보류된 "제3자 pool" 분류 대상이었고, SDK 사용 시 API key를 권하는 문장과 공존한다. 보증은 아니다.
- **A'. API key**: 사용자가 Console key를 넣는다. 가장 분명하다. Max/Team은 monthly API credit을 이 key에 쓸 수 있다.
- **B. 사람이 스스로 켜는 길**: Claude Code OAuth client를 lophn이 직접 흉내 내 쓰는 것. 문서가 명시 금지하고(2026-01 서버 차단, 02 문서 개정) 약관상 정지 사유가 된다. 켜려면 "금지된 사용이고 계정이 정지될 수 있다"는 경고와 사용자 동의를 받아야 한다. 권하지 않는다.
- **C**: lophn이 Anthropic 구독 login을 아예 제공하지 않고 API key만 받는 것. 가장 안전하다.

### OpenAI
- **A. 공식 허용 길 있음**: "Sign in with ChatGPT" plan usage의 open-source 앱 flow. lophn이 open-source로 배포되고 loopback listener, PKCE, host id를 쓰면 self-serve로 client가 등록된다. 제약: `store:false`, `stream:true`, hosted tool 불가, Plus/Pro만, 사용자별 주간 cap, 429를 앱이 처리, preview 상태라 바뀔 수 있다. lophn이 open-source가 아니거나 상업 배포면 interest form과 승인이 필요하다 (제품 배포 형태를 정해야 한다).
- **A'. API key**
- **B. 사람이 스스로 켜는 길**: 옛 방식(Codex CLI client_id 재사용, `backend-api`). 이제 공식 길이 있으니 이 길을 쓸 이유가 약하다. 문서화된 허락이 없고 깨질 수 있다.
- **C**: 안 함.

### xAI
- **A. 공식 연동**: 현재 공식 연동은 Hermes와 OpenCode를 이름으로 지목한 것뿐이고 lophn용 등록 경로는 못 찾았다. xAI에 직접 문의해 "더 많은 open-source agent가 온다"는 공지의 등록 방법을 확인하는 것이 먼저다.
- **B. 사람이 스스로 켜는 길**: 공개 Grok CLI/shared client로 OAuth device code 또는 browser login. 타 project들이 이미 하고 있고 계정 정지 보고는 없다. 하지만 client가 lophn 소유가 아니고 allowlist, 403, 문서 없는 endpoint 위험이 있다.
- **A'. API key**: console.x.ai key. 구독이 아니라 별도 과금(OpenClaw 문서도 "Console credits and subscription quota are separate billing buckets"라고 구분).
- **C**: 안 함.

### 결정 때 확인할 것 (정할 수 없어서 추천안만)
1. 추천안: 기본은 API key. 구독 login은 OpenAI(공식 SIWC)를 먼저, Anthropic은 "사용자가 login한 `claude` binary를 띄우는" 길만, xAI는 B를 사람이 켜는 실험 기능으로 둔다. Anthropic의 token 직접 사용은 넣지 않는다.
2. lophn이 open-source로 배포되는가. OpenAI SIWC plan usage의 가능 범위가 여기서 갈린다.
3. Anthropic 문서의 모순(legal 문서 vs 10/07 help 문서)은 Anthropic에 문의하지 않고는 풀리지 않는다. 문의 대상은 sales/support, legal 문서가 안내하는 `contact sales`.
4. 이 조사는 2026-10-17 기준이다. Anthropic은 6월에 "advance notice before any future change"를 약속했고, OpenAI는 preview, xAI는 공지만 있다. 셋 다 몇 주 안에 바뀔 수 있다.

## 출처 목록 (주요)

- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/authentication
- https://www.anthropic.com/legal/consumer-terms
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
- https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses
- https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/
- https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/
- https://alternativeto.net/news/2026/4/anthropic-ends-free-claude-access-for-third-party-tools-like-openclaw
- https://techcrunch.com/2026/04/10/anthropic-temporarily-banned-openclaws-creator-from-accessing-claude/
- https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch
- https://zed.dev/blog/anthropic-subscription-changes
- https://developers.openai.com/siwc (및 quickstart, request-client-id, token-sharing-open-source, preview-limitations, models-and-inference, codex-app-server)
- https://github.com/openai/codex/discussions/8338
- https://daily.dev/posts/openai-makes-sign-in-with-chatgpt-a-way-to-use-your-subscription-in-third-party-developer-tools-7ewaoo6ze
- https://dev.to/hassann/sign-in-with-chatgpt-for-developers-the-oauth-flow-plan-usage-and-what-it-means-for-your-api-bill-48f7
- https://zylos.ai/research/2026-07-13-subscription-auth-boundaries-official-cli-agent-automation
- https://x.ai/news/grok-hermes
- https://x.ai/news/grok-opencode
- https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md
- https://docs.openclaw.ai/providers/xai
- https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth
- https://github.com/NousResearch/hermes-agent/issues/26847
- https://pi.dev/packages/pi-xai-supergrok
- https://agentriot.com/news/ai-tools/xai-grok-oauth-agents-v2
