# provider-failures

provider 실패 분류와 구독 token 갱신을 고친다: reset 정보가 없는 429를 일시 제한으로, 너무 넓은 overflow 문구를 좁게, refresh 실패의 일시·영구를 가르고, 요청 중 401이면 token을 바로 갱신해 한 번 다시 보낸다.

- 단위: provider (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/providers/{failures,oauth-refresh}.ts`
  - `packages/core/lophn-agent/providers/oauth-refresh_test.ts`
  - `packages/core/lophn-agent/providers/adapters/auth-transport.ts`
  - `packages/core/lophn-agent/run-loop/runtime-secret.ts`
  - `packages/core/main/agent-runtime/secret-link.ts`
  - `packages/protocol/supervision/supervision.ts`(`secret_send_request`의 `refresh` 칸만)
  - `tests/harness/wire/http_test.ts`
- 읽을 것:
  - 계획 README "정한 것"의 429 줄
  - architecture: `project-docs/architecture/agent-definition.md` 지키는 것 64(구독 OAuth access token 갱신), "경계와 계약"의 오류 코드
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `child-supervision-protocol`, `secrets`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/provider-values.ts`의 `PROVIDER_FAILURES`(바꾸지 않는다), `USAGE_WAIT_DEFAULT_MS`(지우지 않는다).
  - 내놓는 것(`provider-error-text`의 문구가 이 분류를 따른다): HTTP 429와 rate-limit code(`RATE_CODES`)는 reset 근거가 없거나 30초 안이면 `temporary`, reset이 30초를 넘으면 `credential_unavailable`·`quota`다. 잔액·plan 한도 code(`CREDENTIAL_CODES`, `SUBSCRIPTION_CODES`의 quota)와 402는 지금처럼 `credential_unavailable`·`quota`다.
  - 내놓는 것: `failures.ts`는 wave 2 `loop-stop`이 이어 고친다(server가 거절한 image 분류).
  - 내놓는 것: 감독 pipe `secret_send_request`에 optional `refresh: boolean`. 보내는 쪽(`secret-link.ts`)과 받는 쪽(`runtime-secret.ts`)을 이 task가 같이 고친다. `packages/core/lophn-agent/run-loop/runtime.ts`는 message를 그대로 넘기므로 고치지 않는다.
  - `createAgentRuntimeSecrets`의 `providerOAuth`와 `createProviderRefresher().prepareToken`에 두 번째 인자 `options?: { force?: boolean }`를 더한다. `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(같은 wave `runtime-children` 소유)는 `providerOAuth: refresher.prepareToken`으로 함수 참조를 넘기므로 고치지 않는다.

## 할 일

1. **429 분류(loop #7).** 지금 `failures.ts`의 `rateVerdict`는 reset을 모르는 HTTP 429(`retry-after` 없는 OpenAI 호환·OpenRouter 등)를 바로 `credential_unavailable`·`quota`(1시간 `until`)로 보내, 첫 429에 turn이 "model을 쓸 수 없다"(`configuration_unavailable`)로 끝난다. README "정한 것": reset 정보가 없는 429는 일시 제한이다.
   - `rateVerdict`: `reset === null`이면 `kind`와 상관없이 `temporary`(`retry_at_ms: null`, loop 기본 대기 2초·4초)다. reset이 30초 안이면 지금처럼 그 시각의 `temporary`, 30초를 넘으면 `until_ms: nowMs + reset`의 `credential_unavailable`·`quota`다. `reset ?? USAGE_WAIT_DEFAULT_MS`는 이제 닿지 않으므로 지우고, 안 쓰게 된 import를 지운다.
   - `retryAfterMs`가 OpenAI의 `x-ratelimit-reset-requests`·`x-ratelimit-reset-tokens`(값 꼴 `20s`, `1m30s`, `6ms`, `1h2m`)를 읽게 한다. 둘 다 있으면 작은 값이다.
   - `messageResetMs`가 "try again in N(ms|s|seconds|m|minutes)"(소수 초 `1.5s` 포함)을 읽게 한다.
   - 두 번 다시 보내도 429면 loop가 지금처럼 turn을 끝낸다(`model_error`, 실패한 call의 `http_status`는 429로 남는다).

2. **overflow 문구(tools #2).** 지금 `OVERFLOW_PATTERNS`의 `/max_tokens/i`와 `/request entity too large/i`가 `max_tokens` 인자가 틀렸다는 400이나 byte 크기 413까지 `context_exceeded`로 만들어, turn이 tool 결과를 두 번 줄여 다시 보낸 뒤 `context_limit`으로 끝난다. 두 줄을 지운다. `input length and \`max_tokens\``처럼 더 좁은 문구는 남긴다. `payload_too_large` 같은 새 분류는 만들지 않는다(문구 없는 413은 지금처럼 `unknown`).

3. **refresh 실패의 일시·영구(loop #13b).** 지금 `oauth-refresh.ts`의 `refresh`는 `status === 400 || status === 401 || body.error === "invalid_grant"`면 credential을 `refresh_revoked`로 기록해 사람이 다시 로그인해야 한다. WAF·proxy가 낸 JSON 아닌 400·401도 영구로 본다.
   - 발급자가 grant를 거절했다고 확인될 때만 revoked다: `body.error`가 `invalid_grant`, `invalid_client`, `unauthorized_client` 가운데 하나. 그 밖의 400·401은 `still()`(지금 token이 살아 있으면 그대로 건넨다)이다.
   - 회전한 refresh token의 저장이 `SAVE_ATTEMPTS`번 모두 실패하면 지금은 오류를 돌려주고 새 refresh token을 잃는다(옛 것은 이미 썼다). provider마다 아직 저장하지 못한 refresh token을 `createProviderRefresher` 안 `Map`에 둔다. 다음 `refresh`는 store에서 읽은 것보다 이 값을 먼저 쓰고, 보내기 전에 한 번 더 저장해 본다. 저장되면 지운다. 메모리에만 두고 log·오류에 싣지 않는다.

4. **요청 중 401에 갱신 뒤 한 번 다시 보내기(loop #12).** 지금 구독 OAuth token은 만료 5분 전에만 갱신하고(`prepareToken`의 lead 검사), 요청이 401을 받으면 `credential_unavailable`·`authentication`으로 turn이 끝난다. 다시 보내도 lead 검사가 갱신을 건너뛰어 같은 401이다.
   - `auth-transport.ts`: `SecretAttachLike.send`에 세 번째 인자 `options?: { refresh?: boolean }`을 더한다. `createAuthTransport().send`는 첫 응답이 401이면 같은 요청을 `refresh: true`로 한 번만 다시 부른다. 다시 부르기가 오류(갱신할 수 없음, 거절)면 첫 401 응답을 그대로 돌려준다. 두 번째 응답은 무엇이든 그대로 돌려준다. 401 응답은 `stream: null`이고 본문은 이미 상한 안에서 읽혔으므로 다시 보내도 된다. 다시 보내는 일은 transport 안이라 `invoke.ts`와 ModelCall 행은 하나 그대로다.
   - `secret-link.ts`: `attach.send`가 받은 `options.refresh`를 `secret_send_request`의 `refresh: true`로 싣는다.
   - `supervision.ts`: `secretSendRequestSchema`에 `refresh: z.boolean().optional()`.
   - `runtime-secret.ts`: `request.refresh === true`면 `deps.providerOAuth?.(request.use, { force: true })`를 부른다. 결과가 `undefined`(구독 OAuth credential이 아니다: API key, MCP 이름)면 값 없이 `conflict`("this credential cannot be refreshed")로 답해 child가 두 번째 요청을 보내지 않게 한다. 오류면 그 오류로 답한다. `refresh`가 없으면 지금 그대로다.
   - `oauth-refresh.ts`: `prepareToken(use, options?)`가 `force`면 만료 lead 검사를 건너뛰고 갱신한다. 같은 provider에 도는 갱신이 있으면 그것을 기다린다(지금 single-flight). revoked·API key·OAuth 아닌 credential은 지금처럼 `undefined`다.

## 정한 것

- 401 재시도는 `AuthTransport` 안에 둔다. 이유: credential을 붙이는 자리가 이 하나이고, `invoke.ts`를 고치지 않아 ModelCall 행·idle 기한·분류가 그대로다. 그래서 이 task는 `providers/invoke.ts`를 고치지 않는다.
- 갱신할 것이 없는 credential(API key)은 core가 `conflict`로 답하고 child는 첫 401을 돌려준다. 401마다 같은 요청을 한 번 더 보내 낭비하지 않는다.
- force 갱신에 최소 간격은 두지 않는다. 요청 하나에 한 번뿐이고 401이 아닌 실패에는 force가 없다.
- revoked로 보는 code는 OAuth 2.0 token endpoint 오류 가운데 `invalid_grant`, `invalid_client`, `unauthorized_client`다. 나머지(`invalid_request`, `temporarily_unavailable`, 본문 없음)는 일시로 본다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`tests/harness/wire/http_test.ts`):
  - `ROWS`의 "429 header 없음"을 `temporary`(retry_at 없음)로 고치고, "429 x-ratelimit-reset-requests 20s"(temporary, 20초), "429 try again in 1.5s"(temporary), "400 max_tokens 인자 오류"(invalid_request, context_exceeded 아님) 행을 더한다.
  - "요청 중 401이면 token을 새로 받아 한 번만 다시 보내고, 갱신할 수 없으면 처음 401을 그대로 돌려준다"(`createAuthTransport`에 가짜 attach와 가짜 transport를 꽂은 test 하나)
- 위험 test(`packages/core/lophn-agent/providers/oauth-refresh_test.ts`):
  - "JSON이 아닌 400은 credential을 revoked로 하지 않고 살아 있는 token을 건넨다"
  - "회전한 refresh token을 저장하지 못하면 다음 갱신이 옛 token이 아니라 그 token을 보낸다"
  - "force면 만료가 멀어도 갱신한다"
- 남지 않음: `grep -rn "request entity too large" packages/core/lophn-agent/providers tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴(바꾼 file, 통과한 check, 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청, **무겁게 짠 것**, **알려진 미완 동작**).

- 등록할 것: lead가 `project-docs/architecture/agent-definition.md` 지키는 것 64(발급자가 grant를 거절했다고 보는 code, 요청 중 401의 강제 갱신)를 고치고, `project-docs/flows/areas/models.yaml`에 401 재시도와 429 분류를 적는다.
