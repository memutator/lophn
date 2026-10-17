# oauth-issuer

`tests/support/fake-oauth/`에 fake OAuth 발급자를 만든다: loopback port 0, device authorization·token·jwks endpoint, 줄로 정하는 대답, test가 만든 RSA 키로 서명하는 RS256 id_token, 받은 요청을 모두 남기는 journal. 그리고 `connectFakeProvider`처럼 device code로 로그인해 provider를 연결해 두는 helper `connectOAuthProvider` 하나. 구독 provider 로그인 E2E(`oauth-login`, `oauth-token`)가 쓴다.

**시작 조건: branch `feat/oauth`가 main에 land한 뒤.** 그 전에는 시작하지 말고 보고한다. 이 brief의 route·이름·정의 모양은 `feat/oauth`(commit `af5387ad5`)의 코드에서 읽은 것이다. 시작하면 먼저 main 코드로 아래 "다시 확인할 것"을 확인하고 어긋나면 main을 따른다.

- 단위: oauth (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/fake-oauth/`
- 읽을 것:
  - main의 `tests/support/core/{mod,process,human}.ts`(`connectFakeProvider`가 본보기: provider를 연결하고 기본 model을 정하고 `settle`로 runtime child가 다시 뜨기를 기다린다)
  - `project-docs/plan/e2e-coverage/research/candidates-oauth.md`("support" 절)
  - architecture: `project-docs/architecture/testing.md`("가짜 셋", "`tests/support`"), `project-docs/architecture/agent-definition.md`("구독 provider 로그인", "OAuth 발급자 호출")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `secrets`
  - 본보기: main의 `tests/support/fake-server/{mod,types,reply,server_test}.ts`(socket 없는 `createFakeHandler`와 `Deno.serve` 감싸기, journal, 차이 설명으로 400, 자기 점검 unit의 모양)
  - 코드(main에 land한 path): `packages/protocol/lophn-agent/provider-values.ts`(`providerDefinitionSchema`, `OAuthDefinition`: chatgpt는 `issuer`·`authorization_endpoint`·`token_endpoint`·`jwks_uri`·`resource`·`scopes`, supergrok은 `client_id`·`device_authorization_endpoint`·`token_endpoint`·`scopes`), `packages/core/lophn-agent/providers/oauth.ts`(발급자에 보내는 form 값, 읽는 응답 칸, id_token 검증), `packages/core/lophn-agent/providers/login_test.ts`(RS256 id_token을 만드는 본보기. 그 file을 import하지 않는다), `packages/core/lophn-agent/providers/oauth-refresh.ts`(refresh grant form)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/mod.ts`의 `OAuthDefinition`·`ProviderDefinition` type만. Web Crypto, `Deno.serve`.
  - 내놓는 것: 아래 모양. `oauth-login`, `oauth-token`이 이 이름으로 부른다.

## 내놓는 것

```ts
// tests/support/fake-oauth/mod.ts
startFakeIssuer(): Promise<FakeIssuer>                 // Deno.serve, 127.0.0.1, port 0
createFakeIssuerHandler(): IssuerHandler               // socket 없는 몸체. unit이 쓴다. FakeIssuer = IssuerHandler + url + close

// tests/support/fake-oauth/login.ts
// 지금 core에 fake 발급자로 device code 로그인을 끝내 provider를 연결해 둔다(supergrok 정의, anthropic-messages, endpoint는 fake model server).
// 하는 일: runtimePids → script(device 시작 + device_code queue [tokens]) → loginBegin → until loginComplete가 connected →
// modelDefaultChange({provider, model_name: "claude-sonnet-4-5"}) → settle(core, before). 끝나면 script를 비운다(`script({})`).
// access·refresh·device_code는 `core.ids.newId("key")`에서 만든 test 고유 값이다. 호출하는 test는 그 값을 그대로 받는다.
connectOAuthProvider(core: Core, issuer: FakeIssuer, fake: { url: string }, options?: { expires_in?: number }):
  Promise<{ provider: string; access: string; refresh: string; device_code: string }>

type FakeIssuer = {
  url: string;                                         // "http://127.0.0.1:<port>"
  // provider 정의. key는 catalog에 있는 "anthropic", protocols ["anthropic-messages"], auth_kinds ["oauth"],
  // models_endpoint null, revision "e2e", oauth는 이 발급자 주소로 채운 product 정의.
  definition(product: "chatgpt" | "supergrok"): ProviderDefinition;
  script(steps: IssuerScript): void;                   // 앞에 있던 queue를 모두 대체한다
  idToken(claims: { aud: string; nonce: string; sub?: string; exp?: number }): Promise<string>;   // RS256, iss는 this.url, kid "e2e"
  journal(): readonly IssuerJournalEntry[];
  close(): Promise<void>;
};

type IssuerScript = {
  device?: { device_code: string; user_code: string; interval?: number; expires_in?: number };   // 기본 interval 0.1(초), expires_in 300
  authorization_code?: IssuerReply[];                  // token endpoint grant별 queue
  device_code?: IssuerReply[];
  refresh_token?: IssuerReply[];
};
type IssuerReply =
  | { kind: "tokens"; access: string; refresh: string; expires_in?: number; scope?: string; id_token?: string }   // 기본 expires_in 3600, scope는 정의의 scopes를 공백으로 이은 것
  | { kind: "pending" }                                // 400 {"error":"authorization_pending"}
  | { kind: "error"; status: number; error: string };  // 예: {status: 400, error: "invalid_grant"}

type IssuerJournalEntry = {
  n: number;                                           // 1부터
  at: number;                                          // Date.now()
  method: string;
  path: string;                                        // "/device/code" | "/token" | "/jwks" | 그 밖
  form: Record<string, string>;                        // POST 본문(application/x-www-form-urlencoded)을 푼 값
  step: number | null;                                 // 쓴 queue 자리. 못 쓰면 null
  mismatch: string | null;                             // 기대와 다르게 답했으면 그 설명
};
```

- 정의의 주소: `issuer` = `<url>`, `authorization_endpoint` = `<url>/authorize`(서버가 열지 않는다. test는 browser를 흉내 낼 때 이 주소를 열지 않고 `sign_in.url`의 `redirect_uri`로 바로 간다), `token_endpoint` = `<url>/token`, `jwks_uri` = `<url>/jwks`, `device_authorization_endpoint` = `<url>/device/code`, `resource` = `<url>/resource`, supergrok의 `client_id` = `"e2e-client"`. scopes는 chatgpt는 `["openid","offline_access","chatgpt.tokens.use.direct"]`, supergrok은 `["openid","offline_access"]`다(제품이 요구하는 것은 chatgpt의 `chatgpt.tokens.use.direct` 하나뿐이다).
- 줄을 못 맞춘 요청(queue가 비었거나 모르는 path, 모르는 grant)은 HTTP 400 `{"error":"invalid_request","error_description":"<차이 설명>"}`로 답하고 journal의 `mismatch`에 같은 설명을 남긴다. 500 계열은 쓰지 않는다(core가 `unavailable`로 읽어 test가 헷갈린다).
- jwks는 `{"keys":[{...공개키 jwk, "kid":"e2e","alg":"RS256","use":"sig"}]}`다. 키쌍은 `startFakeIssuer`·`createFakeIssuerHandler`를 부를 때마다 새로 만든다(module 전역에 두지 않는다).

## 다시 확인할 것(main 코드로)

`feat/oauth`에서 읽은 사실이다. main에서 다르면 위 모양을 맞추고 "정한 것"에 적는다.

- core가 보내는 token 요청의 form 값: `authorization_code`는 `grant_type·client_id·code·code_verifier·redirect_uri·resource`, `device_code`는 `grant_type=urn:ietf:params:oauth:grant-type:device_code·client_id·device_code`, `refresh_token`은 `grant_type·refresh_token·client_id`(chatgpt는 `resource`도). device 시작은 `client_id·scope`.
- device 시작 응답 칸: `device_code`, `user_code`, `verification_uri`(또는 `verification_uri_complete`), `interval`(초, 소수 가능), `expires_in`(초). 이 fake는 `verification_uri`를 `<url>/verify`로 낸다.
- token 응답은 JSON 본문의 `access_token·refresh_token·expires_in·scope`(+ chatgpt는 `id_token`)만 읽는다. id_token은 `alg` RS256, `iss`가 정의의 `issuer`, `aud`가 callback의 `client_id`, `nonce`가 `sign_in.url`의 `nonce`, `exp`(초)가 미래, `sub`가 비어 있지 않음을 요구한다(`kid`는 header에 있으면 jwks의 `kid`와 맞아야 한다).
- `login-begin`·`ConnectProvider`는 정의를 내장 목록과 대조하지 않는다. 검사는 `protocols`에 `protocol`이 있음, `auth_kinds`에 `oauth`가 있음, `oauth`가 null인 것과 `auth_kinds`의 oauth 유무가 맞음, endpoint가 https이거나 loopback http임, 발급자 주소가 https이거나 loopback http임뿐이다. `protocols: ["anthropic-messages"]`와 `oauth.product: "chatgpt"|"supergrok"`는 통과한다(구현 session이 smoke로 확인했다). 대조가 생겼다면 보고한다.

## 할 일

1. `tests/support/fake-oauth/mod.ts`와 `login.ts`를 위 모양으로 만든다. `connectOAuthProvider`의 loop는 `until`(제한 30초, sleep 아님)로 `loginComplete`를 되풀이해 부른다. device 시작의 `interval`은 0.1초라 첫 complete가 일찍 와도 poll 간격 전이면 core가 발급자에 묻지 않고 `pending`을 돌려준다. `fake-server`의 `createFakeHandler`/`startFakeServer` 구분을 따른다. 근거: testing.md "가짜 셋", 규칙 9(lophn 밖의 것만 가짜).
2. 자기 점검 unit `tests/support/fake-oauth/issuer_test.ts` 하나(`login.ts`는 Core가 있어야 돌아 unit이 아니라 `oauth-token`의 E2E 행이 쓰면서 점검한다). `createFakeIssuerHandler`로 `Request`를 직접 넘긴다(socket을 열지 않는다). 한 `Deno.test`에서: device 시작 → token poll이 `pending` 뒤 `tokens` → `idToken`이 jwks의 키로 Web Crypto 검증을 통과하고 `iss·aud·nonce`가 맞음 → 빈 queue에 요청하면 400과 `mismatch` → journal의 `form`·`path`·`at` 순서. 이 이상 늘리지 않는다.
3. `deno task check`가 `tests` 전체의 fmt·lint·`deno check`와 이 unit을 돌린다. E2E는 이 task에서 만들지 않는다(쓰는 쪽이 `oauth-login`이다).
4. 제품 코드는 고치지 않는다.

## 세 질문(support의 자기 점검 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `models`(구독 provider 로그인은 발급자 주소가 정의 data라 fake 발급자도 정의만 바꿔 돈다), `secrets`.
- 현실적 회귀: 발급자 쪽 모양(form 값, `authorization_pending`, 회전한 refresh, id_token 검증 값)이 제품의 읽기와 어긋나는 것을 E2E가 잡으려면 fake가 제품이 실제로 보내는 값을 그대로 받고 틀린 요청을 숨기지 않아야 한다.
- 왜 지금 test로 못 잡나: `login_test.ts`·`oauth-refresh_test.ts`는 발급자를 함수 인자로 가짜로 만든다. 발급자 요청이 core 대기열 → runtime child의 pump → HTTP로 가는 길은 process를 건너야만 돈다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(support의 자기 점검 unit 하나는 쓰는 쪽이 발급자 대답을 믿게 하는 최소다)
- 남지 않음: 열린 port와 Deno.serve가 없다(unit은 socket을 열지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것, main 코드로 다시 확인해 위 모양을 바꾼 곳
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
