# oauth-token

`tests/e2e/oauth_test.ts`에 구독 provider token 사용 행 넷을 더한다: 로그인한 provider로 model을 부르면 요청이 `authorization: Bearer <access>`로 나간다(`bearer-on-model-call`), 만료가 가까우면 runtime이 청할 때 core가 먼저 갱신한다(`refresh-before-call`), 발급자가 갱신을 거절하면 credential이 `revoked`가 되고 model 요청이 나가지 않는다(`refresh-revoked`), 어느 경로로도 token이 `secrets.json` 밖에 남지 않는다(`no-leak`).

**시작 조건: branch `feat/oauth`가 main에 land한 뒤.** 그 전에는 시작하지 말고 보고한다. 이 brief의 route·이름·상태는 `feat/oauth`(commit `af5387ad5`)의 코드에서 읽은 것이다. 시작하면 먼저 main 코드로 "다시 확인할 것"을 확인하고 어긋나면 main을 따른다.

- 단위: oauth (wave 3)
- 선행: oauth-login
- 소유(이 task만 고친다):
  - `tests/e2e/oauth_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다. 아래는 `feat/oauth`의 path이고 main에서 같은지 확인한다):
  - `packages/core/lophn-agent/providers/oauth-refresh.ts`
  - `packages/core/lophn-agent/providers/oauth-secrets.ts`
  - `packages/core/lophn-agent/providers/commands.ts`(`RefreshProviderCredential`)
  - `packages/core/lophn-agent/run-loop/runtime-secret.ts`
  - `packages/core/lophn-agent/run-loop/runtime-redaction.ts`
  - `packages/core/lophn-agent/models/resolve.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-oauth.md`(이 단위의 case. 여기 없는 case를 만들지 않는다)
  - architecture: `project-docs/architecture/testing.md`, `project-docs/architecture/agent-definition.md`("구독 OAuth access token은 runtime에 건네기 직전에 갱신한다", "secret 저장소는 `secrets.json` 하나")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `secrets`, `run-loop`
  - 코드: `packages/core/lophn-agent/providers/oauth-refresh.ts`와 `oauth-refresh_test.ts`(이미 보는 것), `packages/core/lophn-agent/run-loop/runtime-secret.ts`(`providerOAuth` hook), `packages/core/lophn-agent/models/resolve.ts`(OAuth는 `authorization: Bearer`), `packages/core/lophn-agent/run-loop/turn.ts`(`callModel`: secret 부착이 막히면 turn이 `configuration_unavailable`), `packages/protocol/lophn-agent/provider-values.ts`(`CREDENTIAL_STATES`, `UNAVAILABLE_REASONS`, `OAUTH_REFRESH_LEAD_MS`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`openSession`, `say`, `waitTurnEnd`), `tests/support/fake-server/mod.ts`(`FakeServer.script/journal`), `tests/support/fake-oauth/{mod,login}.ts`(`connectOAuthProvider`, `FakeIssuer.script/journal`), `tests/e2e/secret_test.ts`(route 출력 모음의 본보기), 이 file 위쪽의 `withFakes`와 `filesWith`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/e2e/oauth_test.ts`의 `withFakes`, `filesWith`(`oauth-login`이 만든 것), `connectOAuthProvider`, `packages/protocol/lophn-agent/mod.ts`의 `providerRead`·`providerList`·`modelCallList`, `packages/protocol/secrets/mod.ts`의 `secretStatus`·`SECRET_FILE_NAME`.
  - 내놓는 것: 없음(test file만)

## 다시 확인할 것(main 코드로)

`feat/oauth`에서 코드로 읽은 사실이다(돌려 보지 않았다). main에서 다르면 main을 따르고 "정한 것"에 적는다.

- 갱신은 turn 시작이 아니라 **runtime이 model 요청에 붙일 token을 core에 청할 때**(요청 하나마다) 일어난다. `runtime-secret.ts`가 `providerOAuth.prepareToken`을 부르고, credential의 `expires_at`까지 5분(`OAUTH_REFRESH_LEAD_MS`) 미만이면 발급자 요청 대기열로 `refresh_token` grant를 보낸다. 그래서 `expires_in: 60`으로 로그인하면 첫 model 요청 직전에 갱신된다. 갱신 form은 `grant_type·refresh_token(저장된 옛 값)·client_id(supergrok은 정의의 client_id)`다.
- 성공이면 회전한 `refresh`를 먼저, 그 뒤 새 access를 `secrets.json`에 저장하고 `RefreshProviderCredential`로 `expires_at`을 올린다. `providerRead`의 `credential.expires_at`이 올라가고 `refreshed_at`이 생긴다.
- 거절(HTTP 400·401 또는 `invalid_grant`)이면 credential이 `state: "revoked"`, `unavailable_reason: "refresh_revoked"`가 되고 token을 건네지 않는다. 그 요청의 secret 부착이 막히므로 model 요청은 나가지 않고 `callModel`이 turn을 `failed`, `reason: "configuration_unavailable"`로 닫는다(provider revoke 신호로 runtime이 호출을 끊는 경로도 같은 이유로 닫는다). test는 `turnRead`·`waitTurnEnd`가 돌려주는 `outcome`(`{kind: "failed", reason}`)에서 읽는다.
- OAuth credential은 provider protocol이 `anthropic-messages`여도 header가 `x-api-key`가 아니라 `authorization: Bearer <access>`다. fake model server journal에서 `headers["authorization"]`을 본다(헤더 이름은 소문자).
- model 호출까지 가려면 정의 `key`가 catalog에 있는 `"anthropic"`이고 기본 model이 catalog의 `claude-sonnet-4-5`여야 한다(`connectOAuthProvider`가 한다).
- 같은 provider의 갱신은 한 번에 하나(`oauth-refresh.ts`의 flights)다. `oauth-refresh_test.ts`에는 이 동시성을 보는 단정이 없다. **이 task는 E2E도 unit도 만들지 않는다.** 보고에 "unit에 없음"만 적는다(두 session이 같은 순간 청해야 하는 시간 경쟁이다).

## 할 일

1. `tests/e2e/oauth_test.ts`에 행마다 `Deno.test`를 더한다. 이 task가 `withFakes`·`filesWith`를 다시 쓰지 않는다. 근거: testing.md 규칙 3, 5.
2. 행 표. 값은 `connectOAuthProvider`가 돌려주는 test 고유 값이다. session은 `openSession(core, {role: "lophn"})`이다(project가 필요 없다).

| 행 | 준비 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|---|
| `bearer-on-model-call` | `withFakes`, `connectOAuthProvider`(기본 `expires_in`) | `openSession` → `say` → `waitTurnEnd` | model ① text | fake model: 요청 하나의 `authorization`이 `Bearer <access>`이고 `x-api-key`가 없고, 본문 전체에 access·refresh 값이 없음 / ledger: turn이 completed(`outcome.kind` `completed`) / 발급자 journal: `/token` 요청이 로그인 때 것(`device_code` grant) 하나뿐(만료가 멀어 갱신 안 함) | access token이 core → runtime child → model 요청으로 간다 |
| `refresh-before-call` | `withFakes`, `connectOAuthProvider({expires_in: 60})`, 이어서 `issuer.script({refresh_token: [{kind: "tokens", access: NEW_A, refresh: NEW_R}]})` | `openSession` → `say` → `waitTurnEnd` → `core.stop()` | issuer ① refresh 성공, model ② text | 발급자 journal: `refresh_token` grant 하나, form의 `refresh_token`이 로그인 때 refresh이고 `client_id`가 정의의 `e2e-client` / fake model: 요청 하나의 `authorization`이 `Bearer <NEW_A>` / disk: `core.stop()` 뒤 `secrets.json`의 `.refresh`가 `NEW_R`, `provider.<id 뒤>`가 `NEW_A` | runtime이 청할 때 core가 갱신한다(child ↔ core ↔ child의 issuer pump). 갱신이 요청보다 먼저인지는 요청이 새 access를 싣는 것으로 본다 |
| `refresh-revoked` | `withFakes`, `connectOAuthProvider({expires_in: 60})`, 이어서 `issuer.script({refresh_token: [{kind: "error", status: 400, error: "invalid_grant"}]})` | `openSession` → `say` → `waitTurnEnd` | issuer ① invalid_grant | ledger: `providerRead`의 `credential.state` `revoked`, `unavailable_reason` `refresh_revoked` / ledger: turn `outcome`이 `{kind: "failed", reason: "configuration_unavailable"}` / fake model: journal이 0개 | 거절된 grant의 token을 runtime에 건네지 않는다 |
| `no-leak` | `withFakes`, `connectOAuthProvider` | `openSession` → `say` → `waitTurnEnd` → route 출력 모음 → `core.stop()` | model ① text | route: `providerRead`·`providerList`·`modelCallList({session})`·`secretStatus`의 JSON에 access·refresh·device_code가 없고 provider id는 있음 / disk: `core.stop()` 뒤 `secrets.json`을 뺀 `run.dir` 전체(`core.log` 포함)에 access·refresh·device_code가 byte로 없음 | `secret_test.ts`와 같은 꼴. 이름 공간(`provider.<id>.refresh`·`.meta`)이 새로 생겼다. code와 verifier는 `pkce-login` 행이 본다 |

3. `refresh-before-call`의 `connectOAuthProvider`가 끝난 뒤에 refresh 줄을 건다(`script`는 앞 queue를 모두 대체하고 `connectOAuthProvider`는 끝날 때 `script({})`로 비운다).
4. 이미 unit이 보는 것은 단정하지 않는다: 회전 저장·`invalid_grant`→revoked·만료가 멀면 갱신 안 함(`oauth-refresh_test.ts`), `.refresh`·`.meta`의 목적지 없음(`secret-refs_test.ts`).
5. `refresh-revoked`에서 turn이 다른 이유로 닫히면(예: `model_error`) 제품의 이름이 `feat/oauth`와 다른 것이므로 test를 맞추지 말고 main 코드를 읽어 의도를 확인한 뒤 보고한다. 단정이 어긋나면 제품 bug다(secret·credential 경계). 추가 소유 안에서 고치고 고치기 전 코드에서 그 행이 실패한 것을 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `models`(구독 credential은 `revoked`면 token을 건네지 않고, OAuth 요청은 Bearer다), `secrets`(token은 `secrets.json`에만 있고 전송 직전에 붙는다), `run-loop`(secret 부착이 막히면 turn은 `configuration_unavailable`로 닫힌다).
- 현실적 회귀: 갱신 hook이 runtime의 청함에 안 걸려 만료된 token으로 요청이 나가는 것, 회전한 refresh를 저장하기 전에 access만 쓰는 것, 거절된 갱신 뒤에도 옛 token을 건네는 것, header가 protocol에 따라 `x-api-key`로 나가는 것, 새 이름(`.refresh`·`.meta`)이 log·ledger에 새는 것.
- 왜 지금 test로 못 잡나: `oauth-refresh_test.ts`는 refresher를 함수로만 부른다. runtime child가 secret을 청하는 감독 pipe, core의 hook, 발급자 pump, 실제 model HTTP 요청의 header는 process를 건너야만 이어진다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/oauth_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/oauth_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "구독 token은 model 요청 header에만 실리고, 거절된 갱신 뒤에는 요청이 나가지 않으며, 어느 경로로도 secrets.json 밖에 남지 않는다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것, main 코드로 다시 확인해 위 표를 바꾼 곳
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- "갱신이 provider마다 하나"를 보는 unit이 있는지(만들지 않는다)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
