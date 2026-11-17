# setup-provider

provider 연결(id 만들기, 값 넣기, 충돌 확인, 연결)과 구독 로그인의 기다림을 core route로 옮긴다. desktop Settings › Providers, shell main의 보호 입력 창, agent가 청한 입력 card가 그 route를 부르고 화면과 shell main의 사본은 지운다.

- 단위: setup (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{providers,provider-inputs,provider-values,input-request}.ts`
  - `packages/core/lophn-agent/providers/`
  - `packages/core/lophn-agent/register.ts`, `packages/core/host-queue/register.ts`
  - `packages/core/main/daemon/wiring/{lophn-agent,input-request,secret-slot,secret-slot_test}.ts`
  - `packages/shell/ipc/secret-input.ts`, `packages/shell/main/secret-input/`, `packages/shell/main/desktop/wiring/secret-input.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`(renderer memory route 목록. `setup-project`가 보고한 이름도 lead가 여기 더한다)
  - `packages/shell/renderer/secret-input/`
  - `packages/shell/renderer/desktop/settings/{sign-in,core-call}.ts`, `packages/shell/renderer/desktop/settings/providers/`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sign-in.ts`
  - `packages/design/i18n/catalog/{agents,data}.ts`(문구가 바뀌면. Settings › Providers와 보호 입력 창의 key가 있다)
  - `tests/e2e/oauth_test.ts`, `tests/support/fake-oauth/login.ts`, `tests/live/login.ts`
  - `project-docs/flows/areas/{models,harness,shell-desktop,ipc}.yaml`, `project-docs/flows/tests/{lophn-agent,shell,e2e}.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 값, 순서, 구독 로그인의 기다림, loopback 로그인
  - architecture: `project-docs/architecture/agent-definition.md` 59(provider credential과 임시 이름), 60(secret 저장소와 agent의 secret 요청), 63(구독 로그인), `project-docs/architecture/approval.md` "사람 결정 handle"
  - 조사: `reports/multi-device/survey-s4-setup-tabs.md` 1.3, 1.4
  - 지금 순서: `packages/shell/renderer/desktop/settings/providers/core-source.ts`(`freshId`, `connectWithKey`, `signIn`), `packages/shell/renderer/desktop/settings/sign-in.ts`(`signInProvider`), `packages/shell/main/secret-input/request.ts`(`storeSecret`), `packages/core/main/daemon/wiring/secret-slot.ts`(`keySlot`, `providerSignIn`, `baseOf`), `packages/core/lophn-agent/providers/login.ts`(`withProviderLogin`)
- 계약:
  - 쓰는 것: `ConnectProvider`(`providers/connect`. core가 사람의 context로 writer에 부르는 ledger command로 남는다), `CancelProviderLogin`(`providers/login-cancel`), `ctx.secretStore`, `ctx.questionWaits`의 `readRequest`·`finishRequest`, `customBaseUrl`·`customDefinition`·`customNeedsKey`(`packages/protocol/lophn-agent/custom-provider.ts`)
  - 내놓는 것(`setup-scope`, `setup-viewer`, `setup-phone`이 이 이름으로 쓴다):
    - `providerConnectTargetSchema`(`provider-inputs.ts`): `{definition: string}`(내장 정의 key) | `{custom: {key, name, base_url, protocol}}`(key는 `CUSTOM_ID_SHAPE`, protocol은 `customProtocolSchema`). type `ProviderConnectTarget`.
    - `providers/connect-key`: upload, name `ConnectProviderKey`, actors user. input `{target: ProviderConnectTarget, bytes: 1..SECRET_INPUT_MAX_BYTES}`, body는 key의 UTF-8, `max_bytes`는 `SECRET_INPUT_MAX_BYTES`. 결과 `{provider: ProviderRecord}`. 모르는 정의는 `not_found`, 그 정의가 이미 연결돼 있으면 `conflict`, custom 주소가 `customBaseUrl`에 맞지 않으면 `invalid_input`. changes `providers`, `models`, `secrets`.
    - `providers/connect-local`: memory, name `ConnectLocalProvider`, actors user. input `{custom: {key, name, base_url, protocol}}`. 이 기계의 http 주소(`customNeedsKey`가 false)만 받고 auth `none`으로 잇는다. 결과 `{provider}`.
    - `providers/sign-in`: memory, name `SignInProvider`, actors user. input `{definition: string}` | `{request: {session, tool_call}}`. 결과 `{provider, login, flow, expires_at, sign_in: {url, user_code}}`(`loginBeginOutputSchema`에 provider를 더한 것). OAuth가 없는 정의는 `invalid_input`, 이미 연결된 정의는 `conflict`, request가 provider sign_in 요청이 아니면 `invalid_input`. request로 시작하면 그 view의 `target.login`(core가 만든 id와 대상)을 그대로 쓴다. 시작한 뒤 기다림은 core가 한다.
    - `providers/sign-in-state`: memory, name `ReadProviderSignIn`, actors user, `reads: ["providers"]`. input `{login}`. 결과 `state`로 갈린다: `waiting`(provider, flow, expires_at, sign_in), `connected`(provider), `failed`(provider, code: 공통 오류 code), `cancelled`(provider). 모르는 login은 `not_found`. 상태가 바뀔 때마다 core가 `StateChanged{name: "providers", id: <provider>}`를 낸다.
    - `input_request/answer_secret`: upload, name `InputRequestAnswerSecret`, actors user. input `{session, tool_call, bytes}`, body는 값. `kind: secret` 요청만 받는다(아니면 `invalid_input`). 값을 core가 자리에서 정한 이름에 넣고, view의 `connect`가 있으면 `providers/connect-key`와 같은 함수로 잇는다. 요청은 `{stored: true}`나 오류로 끝나고 결과는 `{}`다. 값을 저장하지 못하면 오류를 내고 요청은 열린 채다.
    - 새 route가 안에서 부르는 `ConnectProvider`는 그 route를 부른 사람의 context(기기면 기기 자격)로 writer에 보낸다. core 안 machine 자격을 새로 만들지 않는다.
    - `oauthFlowOf(product): OAuthFlow`(`provider-values.ts`). 화면이 loopback 로그인을 가리는 데 쓴다.
    - shell IPC `secretInputOpenSchema`에 `{provider: ProviderConnectTarget, subject}` 갈래를 더한다. 이 갈래의 제출은 `providers/connect-key`로, `{request}` 갈래의 secret 제출은 `input_request/answer_secret`으로 간다. 이름 갈래(`purpose: provider`는 이미 이어진 provider의 key 바꾸기, `desktop-parts-impl.tsx`의 `enterProviderKey`)는 그대로 `secrets/put`이다. IPC file은 zod 말고 import하지 않으므로(머리 주석) target 모양을 그 file에 zod로 적고, shell main이 core에 보내기 전에 `providerConnectTargetSchema`로 한 번 더 검사한다.
    - `signInInputRequest`(`agent-tab-core-source-sign-in.ts`)의 provider 갈래는 `providers/sign-in {request}`를 부르고 상태를 따라간다. 요청을 끝내는 것은 core다(이 갈래는 `input_request/done`을 부르지 않는다).

## 정한 것

- `providers/login-begin`·`login-complete` route(`loginBegin`, `loginComplete`, `BeginProviderLogin`, `CompleteProviderLogin`)는 지운다. 시작과 한 번 보기는 `providers/sign-in`의 core 안 함수(`oauth.ts`의 begin·complete)로만 남는다(AGENTS.md "호환성"). 제품 code에서 이 route를 부르는 곳은 지울 화면 code(`settings/sign-in.ts`, `providers/core-source.ts`)뿐이다. `loginBeginInputSchema`는 input request view의 `target.login`이 쓰므로 schema는 남는다.
- 끊은 provider를 다시 이을 때 같은 id를 쓰는 표(정의 key → id)는 core 메모리에 둔다. 지금 창 메모리(`ids`)와 같은 범위를 core로 옮긴 것이다.
- sign_in 요청은 core가 끝낸다. 폰이 browser로 갔다 와도(앱이 뒤로 가도) 요청이 끝나야 하기 때문이다.
- 끝난 로그인 상태는 core가 사는 동안, 같은 정의로 새 로그인을 시작할 때까지 둔다.
- 기다림의 규칙은 지금 `signInProvider`의 것 그대로다: `interval_ms`마다 complete, `unavailable`은 연달아 3번까지 다시, 한 번 놓친 뒤의 `not_found`는 `unavailable`, `expires_at`이 지나면 `failed`. 시각과 기다림은 인자(`nowMs`, `wait`)로 받는다.

## 할 일

1. protocol: 위 schema와 route를 둔다. memory route는 `PROVIDER_ROUTES`·`INPUT_REQUEST_ROUTES`에, upload route는 memory 목록에 섞지 않는다(`packages/core/host-queue/register.ts`가 `INPUT_REQUEST_ROUTES`를 `memoryRoutes`로 펼친다). `oauthFlowOf`를 두고 `packages/core/lophn-agent/providers/oauth.ts`의 product→flow 판정이 이것을 쓰게 한다.
2. `packages/core/lophn-agent/providers/connect-key.ts`(새 file): `providerTargetOf(definition)`(endpoint는 `models_endpoint`의 base, protocol은 첫 것, ChatGPT 로그인은 `oauth.inference_endpoint`. `secret-slot.ts`의 `baseOf`와 renderer의 `routeOf`를 옮긴다)와 `connectWithKey(...)`: `provider.<id>.new.<무작위>`에 값을 넣고 그 이름으로 `ConnectProvider`를 writer에 보낸다. 옮기기와 버리기는 `withProviderLogin`의 `connect`가 한다. 어느 갈래로 실패해도(put 실패, writer 오류, 던짐) 임시 이름이 남지 않게 한다.
3. `login.ts`: 로그인 하나를 시작하고 core가 기다리는 `signIn`과 상태 읽기를 더한다. 연결되면 상태를 `connected`로 바꾸고, request로 시작했으면 `finishRequest(… ok({signed_in: true}))`, 실패면 그 오류로 끝낸다. `login-cancel`과 `endAll`이 기다림도 멈춘다.
4. `wiring/lophn-agent.ts`의 provider-login wiring에 handler를 붙인다(id는 `createIdSource`로 `pvd`, conflict 확인은 `providers/list`). `packages/core/lophn-agent/register.ts`의 `memoryRoutes`·`uploadRoutes`에 route를 더한다.
5. `wiring/input-request.ts`에 `input_request/answer_secret` handler를 둔다. `secret-slot.ts`는 `providerTargetOf`를 쓴다. `packages/core/host-queue/register.ts`에 `uploadRoutes`를 더한다.
6. shell main: `request.ts`의 `storeSecret`을 지우고 secret 요청 제출은 `core.upload("input_request", "answer_secret", …)`로, provider 갈래 제출은 `core.upload("providers", "connect-key", …)`로 보낸다. `ipc.ts`의 열기·display가 새 갈래를 받는다(`packages/shell/renderer/secret-input/`의 창은 provider 갈래를 이름 없이 그린다). 값을 log·오류·IPC 결과에 넣지 않는 지금 규칙을 지킨다.
7. renderer `providers/core-source.ts`: `freshId`, `ids`, `providerId`, `routeOf`, `baseOf`, `connectWithKey`, `signIn`과 `newProviderId` 사용을 지운다. key 연결은 `openSecret({provider: {definition}, subject})`, custom은 key가 있으면 `{provider: {custom}}`, 없으면 `providers/connect-local`. 로그인은 `providers/sign-in`, 주소 열기, `progress.started`, `providers/sign-in-state`를 `StateChanged{providers}`로 다시 읽어 따라가기(`signInApp`의 `followCoreRead`와 같은 꼴), signal이 끊기면 `providers/login-cancel`. 따라가는 함수는 `settings/sign-in.ts`에 두고 card와 같이 쓴다. `signInProvider`와 `core-call.ts`의 `newProviderId`를 지운다. `providers/testdata/fake-providers.ts`를 맞춘다.
8. `agent-tab-core-source-sign-in.ts`의 provider 갈래를 7의 함수로 바꾼다.
9. `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `providers/connect-local`, `providers/sign-in`, `providers/sign-in-state`를 더한다.
10. 옛 route를 지운다: `providers.ts`의 `loginBegin`, `loginComplete`와 `PROVIDER_ROUTES` 줄, `commands.ts`의 `beginLogin`·`completeLogin` 등록, `login.ts`의 두 command 가로채기, 쓰지 않게 된 `loginBeginOutputSchema`·`loginCompleteInputSchema`·`loginCompleteOutputSchema`(`providers/sign-in`이 쓰는 것은 남긴다). `packages/core/remote/host_test.ts`(`setup-scope` 소유)의 import와 route 목록에서 두 이름만 빼는 줄은 "넘길 줄"로 보고한다.
11. 있는 e2e를 새 설계로 다시 쓴다(새 e2e file은 만들지 않는다): `tests/support/fake-oauth/login.ts`와 `tests/e2e/oauth_test.ts`는 `providers/sign-in`으로 시작하고 `providers/sign-in-state`로 끝을 본다. 지금 test가 보던 결과(pending 뒤 연결, 교환 실패, 취소)는 상태(`waiting`, `connected`, `failed`, `cancelled`)로 본다. `tests/live/login.ts`도 같은 route로 고친다. `oauth_test.ts` 하나만 한 번 돌린다(`npm run e2e:deps`가 필요하면 먼저). `tests/live`는 고치기만 하고 돌리지 않는다. 실제 provider를 부르지 않는다.
12. test: `packages/shell/main/secret-input/request_test.ts`의 "새 provider 자리는 값을 저장한 뒤 연결을 보내고…" test는 지운다(지키던 것은 아래 위험 test가 core에서 본다). flows의 route·test 줄을 고친다(`flows` skill. 지운 `route:providers/login-begin`·`login-complete` 줄과 그것을 쓰는 flow, `tests/e2e.yaml`의 `oauth_test` covers).

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 선다. 다시 쓴 `tests/e2e/oauth_test.ts`가 한 번 통과한다.
- 위험 test(`packages/core/lophn-agent/providers/` 옆 `*_test.ts`, 가짜 writer와 임시 폴더의 secret store):
  - "provider 연결이 중간에 실패하면 임시 secret이 남지 않는다": `providers/connect-key`의 `ConnectProvider` conflict·writer 실패·모르는 정의와, `input_request/answer_secret`의 연결 실패 뒤 `secrets.json`에 `provider.*.new.*`도 새 `provider.<id>`도 없다.
  - "기기에서 넣은 값이 event, log, ledger의 명령 기록에 없다": `providers/connect-key`·`input_request/answer_secret` handler를 부른 뒤 가짜 writer가 받은 envelope, bus에 낸 event, logger 줄 어디에도 값 문자열이 없다. 기기의 길은 `createRemoteCall`의 `uploadRequest`가 같은 `dispatchHttp`·handler로 넘기므로 handler에서 본다.
  - subprocess나 core를 띄우는 test, 새 E2E file은 만들지 않는다(11의 고쳐 쓰기만). 실제 provider를 부르지 않는다.
- 남지 않음: `grep -rn "storeSecret" packages tests`, `grep -rn "newProviderId\|signInProvider\|freshId" packages/shell tools tests`, `grep -rn "function baseOf" packages/shell packages/core/main`, `grep -rn "loginBegin\b\|loginComplete\b\|login-begin\|login-complete\|BeginProviderLogin\|CompleteProviderLogin" packages tools tests project-docs/flows`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 기기 route 목록(`setup-scope`의 사람 route 목록)에 더할 이름: `providers/connect-key`, `providers/connect-local`, `providers/sign-in`, `providers/sign-in-state`, `input_request/answer_secret`. 이 route들이 안에서 부르는 `providers/connect`는 부른 기기의 자격으로 가므로 `setup-scope`가 이미 목록에 둔다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
