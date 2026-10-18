# cs-models-account

ChatGPT로 로그인한 provider를 연결한 뒤와 token을 갱신할 때 core가 `GET /v1/models`를 읽어, 그 계정이 쓸 수 있는 model 이름 목록(`account_models`)을 credential에 저장한다. turn을 시작할 때 resolver가 이 목록을 본다. 화면은 다음 task(`cs-models-picker`)가 고친다.

- 단위: cs-models (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/provider-values.ts`
  - `packages/protocol/lophn-agent/provider-inputs.ts`
  - `packages/protocol/lophn-agent/providers.ts`
  - `packages/protocol/lophn-agent/model-picker.ts`
  - `packages/protocol/lophn-agent/issuer-requests.ts`
  - `packages/core/lophn-agent/providers/**`
  - `packages/core/lophn-agent/models/resolve.ts`
  - `tests/live/suite.ts`
  - `tests/support/wire/binding.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "ChatGPT로 로그인한 provider가 그 계정이 못 쓰는 model도 고르게 둔다" (닫는 일은 계획 끝에 lead가 한다)
  - architecture: `project-docs/architecture/agent-definition.md`의 "OAuth 발급자 호출(MCP와 provider)은 대기열 하나로 runtime이 대신 보낸다" 줄, `project-docs/architecture/testing.md`
  - 본보기: `providers/oauth-refresh.ts`(갱신 흐름과 deps 모양), `providers/oauth-refresh_test.ts`(가짜 http로 provider 표를 실제로 쓰는 test), `providers/login.ts`(`complete`), `core/lophn-agent/issuer-requests.ts`(요청 대기열)
  - boundary·module: `project-docs/boundary-catalog.yaml`과 `project-docs/module-catalog.yaml`에서 `packages/core/lophn-agent`와 provider command를 가리키는 ID를 찾아 읽는다.
- 계약:
  - 쓰는 것: `HttpFetch`/`IssuerFetch`(발급자 요청 대기열, `ctx.issuerRequests.fetch`), `ProviderDefinition.models_endpoint`(openai 내장 정의: `https://api.openai.com/v1/models`), `ProviderRecord`, `providerRead`/`providerList`
  - 내놓는 것: `ProviderCredential.account_models: string[] | null`(`null`은 "아직 못 읽음"), 새 command `RecordProviderAccountModels`, 순수 규칙 `accountAllows(accountModels, modelName)`(model-picker.ts). 모양은 아래 "할 일" 1.

## 외부 data (실제 응답을 못 본 채 쓴 것)

실제 `GET /v1/models`를 이 task를 쓸 때 부르지 못했다(AGENTS.md: 진짜 provider 호출은 사람이 한다). 아래 칸 이름은 이슈가 옮긴 OpenAI 문서에서 가져왔고 repo에 응답 fixture는 없다.

- 요청: `GET <definition.models_endpoint>`, header `authorization: Bearer <access token>`, `accept: application/json`.
- 응답: JSON 객체의 `data` 배열. 항목의 `id`(model 이름)와 `visibility`(문서: `"list"`인 것만 보인다).
- 표준 OpenAI API 응답(`{object:"list", data:[{id, object:"model", created, owned_by}]}`)에는 `visibility`가 없다. ChatGPT 계정의 응답이 어느 쪽인지, `id`가 맞는지는 모른다. **lead가 첫 진짜 실행(cs-live)에서 확인한다.** 틀리면 파서의 칸 이름 상수 한 곳만 고친다.
- 그래서 규칙은 이렇게 정한다(정한 것).
  - 항목이 보이는 조건: `visibility`가 없거나 `"list"`. 다른 문자열(`"hide"` 등)이면 뺀다.
  - 보이는 `id`가 하나도 없으면(칸 이름이 틀렸거나 body가 다른 모양, 빈 목록) 목록을 모른다고 본다(`null`). 잘못 읽어서 model을 전부 숨기는 쪽이 못 읽는 쪽보다 나쁘다.
  - HTTP 비-200, 던짐(발급자 대기열 기한 8초, runtime 없음), body가 JSON이 아님, body가 `ISSUER_REQUEST_BODY_MAX`(64KiB)를 넘어 `null`이 옴: 모두 "못 읽음"이다. 앞서 저장한 목록은 지우지 않고 그대로 둔다.

## 할 일

1. protocol(근거: 계약 task 규칙. 옛 계약을 지우지 않고 옆에 더한다).
   - `provider-values.ts`: `credentialFields`에 `account_models: z.array(nonblank).nullable()`. `credentialShape`는 바꾸지 않는다(model block과 달리 state 규칙이 없다).
   - `provider-inputs.ts`: `recordProviderAccountModelsInputSchema = strictObject({ provider: idSchema("pvd"), models: z.array(nonblank).min(1).max(2000) })`. 중복은 core가 접는다.
   - `providers.ts`: `recordProviderAccountModels = defineCommand({ resource: "provider-credentials", method: "record-account-models", name: "RecordProviderAccountModels", input, output: providerOutput, compare: providerRevisionCompareSchema, actors: ["user", "machine"], errors: [...machineErrors, "not_found"] })`를 더하고 `PROVIDER_ROUTES`에도 넣는다. `user`가 들어가는 이유: login 처리기(`login.ts`)가 사람의 context로 이 command를 부르고, executor가 writer에서도 actors를 검사한다(`storage/ledger/executor.ts:135`).
   - `model-picker.ts`: `export function accountAllows(accountModels: readonly string[] | null, modelName: string): boolean`. `null`이면 true, 아니면 목록에 있는지. 화면과 core가 같은 규칙을 쓰려고 이 파일에 둔다(이 파일의 머리 주석 취지).
   - `issuer-requests.ts`: `issuerRequestSchema.headers` 값 상한 `max(512)`를 `max(4096)`으로 올린다. 이유: Bearer + ChatGPT access token(JWT, 1KB 이상일 가능성이 크다)이 512자를 넘으면 runtime이 요청을 가져가는 출력 검사에서 막힌다. 갱신 요청은 token을 body에 실어서 지금까지 header 상한에 걸린 적이 없다. 첫 진짜 실행에서 실제 길이를 확인한다.
2. core 저장(근거: `providers/schema.ts` 머리 주석, AGENTS.md "호환성": migration 없이 step을 고친다).
   - `providers/schema.ts`: `provider_credentials`에 `account_models text`(JSON 배열 또는 null) 열을 같은 step 안에서 더한다. 새 step을 만들지 않는다. **이 변경으로 지금 있는 `.dev-data/`의 ledger는 `history_mismatch`로 안 뜬다. lead가 `.dev-data/`를 지우고 새로 만든다**(AGENTS.md: 개발 data는 schema가 바뀌면 지운다). `.dev-data/live/`는 cs-live 전에는 없으니 로그인 전에 이 task를 끝낸다.
   - `providers/model.ts`: `credentialFromRow`의 select에 열을 넣고 JSON.parse해 `account_models`로 낸다(깨진 JSON은 `invalidStored`).
   - `providers/commands.ts`: 새 command handler `recordAccountModels`. 처리 순서는 기존 `refreshCredential`과 같다(provider 읽기 → `checkRevision` → 쓰기). 목록은 중복을 접어 정렬해 저장하고, provider의 `revision`만 올린다(`credential.revision`은 올리지 않는다. 그 판은 token/상태가 바뀔 때 쓰는 것이고, 목록은 turn 중간의 호출 고정(`credential_revision`)을 깨면 안 된다. `credential_revision`을 읽는 곳을 grep으로 확인한다). Disconnect는 credential row와 같이 지워지므로 따로 지우지 않는다. `createProviderCommands`의 반환 type에 `recordAccountModels`를 더한다.
3. 목록 읽기. 새 file `providers/account-models.ts`.
   - `parseAccountModels(body: string): string[] | null`: 위 "외부 data"의 규칙. 칸 이름(`data`, `id`, `visibility`, `"list"`)은 이 file의 상수 한 곳에 둔다.
   - `readAccountModels(http: IssuerFetch, endpoint: string, access: string): Promise<string[] | null>`: GET을 보내고 `parseAccountModels`를 부른다. 던져도 `null`이다. token을 오류·log에 싣지 않는다.
   - 읽는 대상: `provider.definition.oauth?.product === "chatgpt" && provider.definition.models_endpoint !== null`인 provider만. SuperGrok·API key provider·fake 발급자 정의(`models_endpoint: null`)는 읽지 않는다. 그래서 E2E의 fake 발급자 test는 요청 하나도 더 받지 않는다.
4. 연결 직후(`providers/login.ts`의 `complete`): `connectProvider`가 성공한 뒤 `readAccountModels(deps.http, definition.models_endpoint, tokens.access)`를 기다려 `null`이 아니면 `recordProviderAccountModels`를 같은 `writer`와 `ctx`로 부른다(compare는 방금 연결한 record의 `revision`). 실패는 삼키고 로그인 결과(connected)는 그대로 낸다. 최대 대기는 발급자 대기열 기한 8초다.
5. 갱신 직후(`providers/oauth-refresh.ts`): `refresh()`가 새 access를 저장하고 `recordWithRetry`가 성공한 뒤, 같은 조건의 provider면 새 access로 읽는다. `null`이 아니면 `readProvider`로 provider를 다시 읽어 그 `revision`으로 새 deps `recordModels(provider, models)`를 부른다. 목록 읽기·기록이 실패해도 갱신 결과(token을 건넴)는 바뀌지 않는다. deps 인자를 하나 더하는 것이 이 task의 유일한 `createProviderRefresher` 계약 변경이다.
6. 조립(lead가 고친다. 아래 "등록할 것").
7. resolver(`models/resolve.ts`): `resolveSelection`에 넘기는 `{ modelListed: () => true }`를 `{ modelListed: (name) => accountAllows(provider.credential.account_models, name) }`로 바꾼다. 목록이 `null`이면 true라 API key provider와 못 읽은 경우는 지금과 같다. 목록 밖 model이면 `resolveSelection`이 `not_found`로 거절한다(이미 있는 길).
8. 손으로 `ProviderRecord`를 짓는 곳이 `account_models: null`을 갖게 한다: `tests/support/wire/binding.ts`, `tests/live/suite.ts`, `providers/login_test.ts` 등 `deno task check`가 가리키는 곳. 한 줄씩만 고친다.
9. 위험 test 둘(아래 "끝남").

## 끝남

- `deno task check`가 통과한다.
- 위험 test 1, `providers/account-models_test.ts`(순수 함수 표 하나, server 없음): "목록 응답이 어떤 모양이든 보이는 model을 숨기지 않는다. `visibility`가 `list`인 것과 없는 것은 남고 `hide`는 빠지며, 비-200·JSON 아님·`data` 없음·`id` 없음·보이는 항목 0개는 모두 `null`이고, `accountAllows`는 `null`이면 모든 이름을 통과시킨다." 가짜 `fetch`(`Response`를 돌려주는 함수)로 `readAccountModels`까지 한 표에서 본다.
- 위험 test 2, `providers/oauth-refresh_test.ts`에 test 하나를 더한다(그 file의 `setup`을 쓴다): "갱신하면 새 access로 읽은 계정 model 목록이 provider에 저장되고, 목록 읽기가 실패하거나 모양이 틀려도 갱신(새 token 저장, 만료 올림)은 성공하며 앞서 저장한 목록은 남는다."
- 둘 말고 test를 더하지 않는다(write-test: 위험 하나에 test 하나). `login.ts`의 연결 직후 읽기는 같은 `readAccountModels`/`record`를 쓰므로 따로 test하지 않는다.
- 남지 않음: `grep -rn "modelListed: () => true" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것(lead가 고친다):
  - `packages/core/lophn-agent/register.ts`: `commands: [...]`에 `commands.recordAccountModels`를 `commands.recordAvailability` 옆에 더한다.
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`: `PROVIDER_REFRESH_CONTEXT.scope.operations`에 `recordProviderAccountModels.name`을 더하고, `createProviderRefresher({...})`에 `recordModels`를 꽂는다(`ctx.writer.command(PROVIDER_REFRESH_CONTEXT, { command: recordProviderAccountModels.name, input: { provider: provider.id, models }, idempotency_key: crypto.randomUUID(), compare: { revision: provider.revision }, prepared: [] })`).
  - 사람의 context로 부르는 login 길(`wiring/lophn-agent.ts`의 `withProviderLogin`)은 deps를 더 받지 않는다. 사람의 scope가 이 operation을 허락하는지 첫 실행에서 본다. 막히면 login 처리기에 machine context를 따로 꽂는다.
  - `project-docs/architecture/agent-definition.md` 56줄: 발급자 대기열이 "연결·갱신 직후 계정 model 목록 GET(Bearer)"도 나른다고 한 문장 더한다.
  - 이슈 파일은 계획 끝에 닫는다(이 task에서 옮기지 않는다).
- 안 쓰게 된 export: 없음
- 정한 것: 위 "외부 data"의 규칙 셋, `account_models`를 credential에 둠(provider의 `revision`만 올림), actors에 `user` 포함, header 상한 4096
- 넘길 줄: 손으로 `ProviderRecord`를 짓는 test/support 한 줄씩
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없음이어야 한다. 갱신 흐름 안에서 목록 읽기를 기다리므로 token을 건네는 시간이 최대 8초 늘 수 있다(`무엇 / 왜 / 줄인다면 / 어디`로 보고).
- **알려진 미완 동작**(그대로 이슈 후보):
  - 연결 직후 runtime이 새 목적지(api.openai.com)로 다시 뜨는 중이면 첫 읽기가 실패해 목록이 `null`로 남고, 다음 갱신(약 1시간 뒤)까지 모든 catalog model이 보인다. cs-live의 로그인 task가 이것을 보여 준다. 고친다면 `account_models`가 `null`일 때 `prepareToken`에서도 읽는다.
  - 목록 밖 model이 이미 기본값으로 저장돼 있으면 화면은 숨기고 turn은 `not_found`로 실패한다. 저장 검사(`models/commands.ts`의 `checkChoice`)는 이 목록을 보지 않는다.
