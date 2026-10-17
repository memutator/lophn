# oauth-login

`tests/e2e/oauth_test.ts`를 만들고 구독 provider 로그인 행 셋을 둔다: device code 로그인(`device-login`), PKCE loopback 로그인(`pkce-login`), 취소하면 callback listener가 닫힘(`cancel-closes-listener`). 발급자 왕복이 core와 agent runtime child(issuer pump)를 건너는 것을 본다.

**시작 조건: branch `feat/oauth`가 main에 land한 뒤.** 그 전에는 시작하지 말고 보고한다. 이 brief의 route·이름·정의 모양은 `feat/oauth`(commit `af5387ad5`)의 코드에서 읽은 것이다. 시작하면 먼저 main 코드로 "다시 확인할 것"을 확인하고 어긋나면 main을 따른다. `oauth-issuer`(`tests/support/fake-oauth/`)가 merged여야 한다.

- 단위: oauth (wave 3)
- 선행: oauth-issuer
- 소유(이 task만 고친다):
  - `tests/e2e/oauth_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다. 아래는 `feat/oauth`의 path이고 main에서 같은지 확인한다):
  - `packages/core/lophn-agent/providers/oauth.ts`
  - `packages/core/lophn-agent/providers/login.ts`
  - `packages/core/lophn-agent/providers/oauth-secrets.ts`
  - `packages/core/lophn-agent/issuer-requests.ts`
  - `packages/core/main/agent-runtime/issuer-pump.ts`
  - `packages/core/main/daemon/wiring/lophn-agent.ts`
  - `packages/core/lophn-agent/extensions/mcp-auth-control.ts`(`openCallbackListener`. MCP OAuth도 쓰므로 고치면 MCP 쪽 unit을 같이 돌린다)
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-oauth.md`(이 단위의 case. 여기 없는 case를 만들지 않는다)
  - architecture: `project-docs/architecture/testing.md`, `project-docs/architecture/agent-definition.md`("구독 provider 로그인", "OAuth 발급자 호출", "secret 저장소는 `secrets.json` 하나")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `secrets`, `core-api`
  - 코드: `packages/protocol/lophn-agent/providers.ts`(`loginBegin`·`loginComplete`·`loginCancel`·`providerRead`), `provider-inputs.ts`(입출력 schema), `provider-values.ts`(`OAuthDefinition`, `CREDENTIAL_STATES`), `packages/core/lophn-agent/providers/{oauth,login,oauth-secrets}.ts`, `login_test.ts`(이미 보는 것), `packages/core/lophn-agent/extensions/mcp-auth-control.ts`(`openCallbackListener`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/stop/kill/ids`, `connectFakeProvider`, `settle`, `until`, `runtimePids`), `tests/support/fake-server/mod.ts`, `tests/support/fake-oauth/mod.ts`, `tests/e2e/secret_test.ts`(`filesWith`의 본보기)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`, `tests/support/fake-server/mod.ts`(`startFakeServer`: provider의 `endpoint`가 될 뿐 이 task의 행은 model 요청을 보내지 않는다), `tests/support/fake-oauth/mod.ts`(`startFakeIssuer`, `FakeIssuer.definition/script/idToken/journal`), `packages/protocol/lophn-agent/mod.ts`의 `loginBegin`·`loginComplete`·`loginCancel`·`providerRead`, `packages/protocol/secrets/mod.ts`의 `SECRET_FILE_NAME`.
  - 내놓는 것: `oauth_test.ts` 위쪽의 file 안 준비 `withFakes(fn)`(run, fake model server, fake 발급자, core를 띄우고 `finally`에서 `core.kill()`, 서버 `close()`, `run.remove()`) 하나. `oauth-token`이 같은 준비를 쓴다.

## 다시 확인할 것(main 코드로)

`feat/oauth`에서 코드로 읽은 사실이다(돌려 보지 않았다). main에서 다르면 main을 따르고 "정한 것"에 적는다.

- route 이름과 입력: `providers/login-begin`(`BeginProviderLogin`) 입력 `{provider: pvd_ id, name, definition, endpoint, protocol}`, 출력 `{login, flow: "pkce_loopback"|"device_code", interval_ms, expires_at, sign_in: {url, user_code|null}}`. `providers/login-complete` 입력 `{provider, login}`, 출력 `{state: "pending", interval_ms}` 또는 `{state: "connected", provider}`. `providers/login-cancel` 입력 `{provider, login}`, 출력 `{cancelled: true}`. 셋 다 `user` actor, decision handle 없음.
- test가 만든 정의를 `login-begin`이 받는다: 검사는 `protocols`에 `protocol`이 있음, `auth_kinds`에 `oauth`가 있음, oauth 유무가 맞음, endpoint가 https이거나 loopback http임뿐이고 내장 정의와 대조하지 않는다. `FakeIssuer.definition(product)`(`key: "anthropic"`, `protocols: ["anthropic-messages"]`, `auth_kinds: ["oauth"]`, `oauth.product`)가 통과한다. endpoint는 fake model server의 loopback http 주소다. 거절되면 `invalid_input`이다.
- 발급자 주소가 loopback http여도 된다(`issuerUrlAllowed`, `provider-values.ts`의 `issuerUrlSchema`). agent runtime child는 `net_any`라 `--allow-net`에 발급자 port를 따로 더하지 않아도 pump가 닿는다.
- PKCE: `sign_in.url`은 `authorization_endpoint`에 query `response_type·client_id(dynamic_agent_client)·agent_name_hint·ext_agent_host_id·redirect_uri·scope·resource·state·nonce·code_challenge·code_challenge_method`를 붙인 것이다. test는 `redirect_uri`(`http://127.0.0.1:<port>/auth/callback`), `state`, `nonce`를 거기서 읽는다. callback listener는 core process 안(`openCallbackListener`, `Deno.serve`)에 있고 query `code`·`state`·`client_id`(·`iss`)를 받는다. `client_id`가 없으면 complete는 `forbidden`이다. complete는 callback이 오기 전에는 `pending`이다.
- device: complete는 `next_poll`(= begin 시각 + 발급자가 준 `interval`) 전에 부르면 발급자에게 묻지 않고 `pending`을 돌려준다. poll마다 `authorization_pending`이면 `pending`, 그 뒤 간격이 다시 걸린다.
- connected면 core가 secret 셋(`provider.<id 뒤>`, `.refresh`, `.meta`)을 `secrets.json`에 쓰고 사람의 context로 `ConnectProvider`(`auth_kind: "oauth"`)를 부른다. chatgpt begin은 `provider-oauth.host-id`도 `secrets.json`에 쓴다(비밀 아님, 이름만 확인).
- provider가 새 endpoint 목적지로 연결되면 core가 1초 polling으로 agent runtime child를 다시 띄운다(`settle`).

## 할 일

1. `tests/e2e/oauth_test.ts`를 만든다. 위쪽에 `withFakes`와 `filesWith(dir, needle)`(`secret_test.ts`의 것과 같은 일. secrets.json을 뺀 모든 file에서 byte로 찾는다. 그 file의 helper를 import하지 않고 복사한다)를 둔다. 행마다 `Deno.test` 하나. 근거: testing.md 규칙 3(process 경계를 건너야만 깨지는 것), 5(변형은 table 한 줄).
2. 행 표. 모든 값(access·refresh·device_code·code)은 `core.ids.newId("key")`에서 만든 test 고유 값이다. provider id는 `core.ids.newId("pvd")`, secret 이름의 `<id 뒤>`는 id에서 `pvd_`를 뗀 것이다.

| 행 | 준비 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|---|
| `device-login` | `withFakes`. 발급자 `script({device: {device_code, user_code, interval: 1}, device_code: [{kind: "pending"}, {kind: "tokens", access, refresh}]})` | `loginBegin`(supergrok 정의, endpoint = fake model url, protocol anthropic-messages) → 바로 `loginComplete` → `until`로 `loginComplete`가 connected → `settle` | ① device 시작 ② token `authorization_pending` ③ token 성공 | ledger: `providerRead`가 `credential.kind` `oauth`, `state` `available`, `secret_ref.name` `provider.<id 뒤>`, `expires_at`가 있음 / disk: `secrets.json`에 `provider.<id 뒤>`(= access), `.refresh`(= refresh), `.meta` 세 이름이 있고 값이 맞음 / 발급자 journal: `/device/code` 하나, 바로 부른 첫 `loginComplete`의 결과는 `pending`이었고 그때까지 `/token` 요청이 0이었음, `/token` 요청 둘의 `at` 간격이 `interval_ms`(1000) 이상 | 발급자 왕복이 runtime child의 issuer pump를 건넌다. `interval: 1`은 첫 complete가 poll 간격 안에 오는 것을 느린 machine에서도 보장하려는 값이다 |
| `pkce-login` | `withFakes` | `loginBegin`(chatgpt 정의) → `script({authorization_code: [{kind: "tokens", access, refresh, id_token}]})`(`id_token`은 `idToken({aud: clientId, nonce: sign_in.url의 nonce})`) → `fetch(redirect_uri + "?code=…&state=<sign_in.url의 state>&client_id=<clientId>")`(본문을 읽어 닫는다) → `until`로 `loginComplete`가 connected → `settle` → `core.stop()` | ① token 성공(+ jwks는 고정 응답이라 세지 않는다) | 발급자 journal: `/token` form에 `grant_type` `authorization_code`, `code`, 비어 있지 않은 `code_verifier`, `redirect_uri`(= `sign_in.url`의 `redirect_uri`)가 있고 `/jwks` GET이 하나 있음 / ledger: `providerRead`가 `oauth`·`available` / disk: `core.stop()` 뒤 `secrets.json`에 세 이름과 `provider-oauth.host-id`가 있고, `secrets.json`을 뺀 `run.dir` 전체(`core.log` 포함)에 code, `code_verifier`, access, refresh, id_token 값이 byte로 없음 | loopback callback listener(core)와 pump(runtime child)가 process를 건넌다. code와 verifier의 누출은 이 행이 본다 |
| `cancel-closes-listener` | `withFakes` | `loginBegin`(chatgpt 정의) → `loginCancel` → `fetch(redirect_uri + "?code=x&state=<state>&client_id=y")` → `tryCall(loginComplete)` | 없음 | 연결: fetch가 연결 거절(TypeError)로 reject됨 / route: `loginComplete`가 `not_found` / disk: `secrets.json`(있다면)에 `provider.` 이름이 없음 | loopback listener는 process 밖에서만 보인다 |

3. `pkce-login`의 `client_id`는 test가 고른 임의 값(`oaiapp_<id>`)이고 id_token의 `aud`와 같아야 한다. `idToken`의 `nonce`는 `sign_in.url`에서 읽은 값이다. 이 순서는 begin이 먼저이므로 token 줄(`script`)은 begin 뒤에 건다.
4. 이미 unit이 보는 것은 단정하지 않는다: `login_test.ts`(state·nonce·aud·scope 거절, Connect 실패 때 아무것도 안 남음), `oauth-refresh_test.ts`(회전 저장, `invalid_grant`), `secret-refs_test.ts`(`.refresh`·`.meta`의 목적지 없음).
5. 단정이 어긋나면 제품 bug다(secret 경계). 추가 소유 안에서 고치고 고치기 전 코드에서 그 행이 실패한 것을 보고에 적는다. 고칠 수 없는 크기이면 고치지 말고 보고한다(`issue` skill은 lead가 쓴다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `models`(`BeginProviderLogin`·`CompleteProviderLogin`·`CancelProviderLogin`, 연결된 provider의 credential), `secrets`(token·code·verifier·device_code는 `secrets.json` 밖 어디에도 없다).
- 현실적 회귀: issuer pump나 대기열을 건드려 발급자 왕복이 끊기는 것, complete가 간격 전에 발급자를 두드리는 것, 취소해도 listener가 열려 있는 것, 로그인 도중 값이 log·blob에 남는 것.
- 왜 지금 test로 못 잡나: `login_test.ts`는 발급자·listener·writer를 가짜로 꽂은 함수 호출이다. 요청이 core 대기열 → runtime child의 pump → HTTP로, callback이 실제 loopback socket으로 오는 길은 process를 건너야만 돈다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/oauth_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/oauth_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다. fake 발급자와 fake model server가 test 끝에 닫혀 있다(sanitizer를 끄지 않는다).
- 위험 test: "구독 로그인 도중 받은 code·verifier·token은 secrets.json 밖 어디에도 남지 않고, 취소한 로그인의 callback listener는 닫힌다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것, main 코드로 다시 확인해 위 표를 바꾼 곳
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
