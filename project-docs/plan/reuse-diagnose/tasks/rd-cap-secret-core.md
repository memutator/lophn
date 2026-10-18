# rd-cap-secret-core

앱이 쓴 secret의 값을 core가 supervisor에게 건네는 길을 만든다. 값은 core의 `secrets.json`에만 있고, 건네기 전에 core가 현재 grant로 다시 판정한다. 앱은 값을 보지 못한다. supervisor 쪽 연결은 뒤 task(`rd-cap-secret-supervisor`)가 한다.

- 단위: rd-cap-secret (wave 2)
- 선행: rd-cap-net-transport. net이 먼저 나가야 secret을 붙일 곳이 있다. 이 task는 `net-fetch.ts`의 loopback 규칙(`isLoopbackHost`)을 쓰는 `secretAllowed`를 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/broker.ts`
  - `packages/protocol/apps/secret-use.ts`
  - `packages/protocol/apps/mod.ts`
  - `packages/protocol/apps/registry.ts`
  - `packages/core/apps/permissions/broker/secrets.ts`
  - `packages/core/apps/permissions/secret-allowance.ts`
  - `packages/core/apps/control.ts`
  - `packages/core/secrets/file-attach.ts`
  - `packages/core/secrets/file-attach_test.ts`
  - `packages/core/apps/permissions/secret-value.ts`
  - `packages/core/apps/permissions/mod.ts`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"의 정한 것(secret: supervisor 조립이 전달 adapter를 꽂는다, 비밀값은 lophn이 붙여 보내며 앱은 값을 보지 못한다)
  - architecture: `project-docs/architecture/agent-definition.md`의 "secret 저장소는 `secrets.json` 하나이고 이름의 앞머리가 이름 공간이다", "provider credential…은 ledger, event, log, 오류, model 입력에 없다"; `project-docs/architecture/activation.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `secrets`, `app-runtime`, `app-capability`
  - 코드(읽고 시작한다): `packages/core/secrets/file-attach.ts`(`createFileSecretAttach`: context 확인 → process 확인 → 용도 → allowance → 목적지 → 값 읽기 → transmit callback. `purposeOf`는 `provider.`·`mcp.`·`mcp-oauth.`만 알아 앱 이름은 `forbidden`이다), `packages/protocol/secrets/{ports,secrets}.ts`(`SecretAllowance`, `app_secret` 용도, `loopback_http` 목적지), `packages/core/apps/permissions/secret-allowance.ts`와 `broker/secrets.ts`의 `secretAllowed`(목적지 kind가 `https`가 아니면 거절한다), `packages/core/main/daemon/wiring/secrets.ts`(`secretAttach`·`knownSecrets`를 조립에 내놓는 곳), `packages/core/apps/control.ts`의 `SUPERVISOR_OPERATIONS`·`appsOperationPolicies`(supervisor machine credential이 닿는 operation)
- 계약:
  - 쓰는 것: `SecretAttachPort`, `SecretAllowance`, 알려진 값 registry(`knownSecrets`: 값이 core 경계를 나가기 전에 등록해야 redaction이 된다)
  - 내놓는 것(모양을 여기서 정한다):
    - route `apps.secret_value`(`defineMemory`, `packages/protocol/apps/secret-use.ts`, actors `["machine"]`, errors `invalid_input` `forbidden` `not_found` `unavailable`). input `{ app, release, process_nonce, name, destination: { scheme: "http" | "https", host, port } }`, output `{ value: string }`. 값은 응답 본문에만 있고 ledger·event·log·오류에 없다.
    - `brokerSecretUseInputSchema.destination.scheme`이 `"http" | "https"`가 된다(loopback 목적지만 http. 판정은 `secretAllowed`).
    - `secretAllowed`가 loopback host의 http 목적지를 받는다(`net-fetch.ts`의 규칙과 같다. loopback이 아닌 http는 거절).
    - `createFileSecretAttach`가 용도 `app_secret`을 받는다(앱 이름은 앞머리가 없다. 이름 공간은 `provider.`·`mcp.`·`mcp-oauth.`를 앱이 쓰지 못하게 막는다: 앱의 secret 이름이 그 앞머리면 거절).

## 할 일

1. 먼저 읽어서 막히는 곳을 정한다: `createFileSecretAttach`는 context가 machine이고 `conditions.process`·`task`가 있어야 하는데(`admit`), `SecretAllowance` 구현은 principal이 `app:<id>`여야 한다(`secret-allowance.ts`). 이 둘이 한 context에서 만나려면 어떤 context를 만들어야 하는지 코드로 확인한다. 추천: supervisor의 machine credential 요청을 받은 core handler가 `secret.send`를 부를 때 context는 machine(supervisor 신원)으로 두고, allowance에는 `app:<id>` principal을 가진 context를 따로 넘기도록 `SecretAttachPort`의 입력을 고치지 않는 방법을 먼저 찾고, 안 되면 `SecretAllowanceCheck`의 입력에 `app`을 더하는 가장 작은 변경을 한다(provider·MCP 쪽 호출은 그대로 통과해야 한다). 어느 쪽이든 보고의 "정한 것"에 적는다.
2. `secret-use.ts`에 route를 만들고 `mod.ts`·`registry.ts`에 넣는다. `broker.ts`의 `destination.scheme`을 넓힌다.
3. `secretAllowed`(`broker/secrets.ts`)와 `secret-allowance.ts`가 `loopback_http` 목적지를 받게 한다. `SecretDestination`을 만드는 쪽(`secretAllowed`가 받는 `destination`)이 scheme으로 `https`/`loopback_http`를 고르게 한다.
4. `file-attach.ts`의 `purposeOf`에 `app_secret`을 더한다: 알려진 앞머리 셋이 아니면 `app_secret`. 값이 읽히려면 앞의 allowance(현재 release 선언 ∩ active grant ∩ 목적지)를 통과해야 하고 `destinations.allowed(name)`는 앱에 대해서는 목적지를 allowance가 이미 정했으므로 그 호출이 `app_secret`에서 통과하도록 맞춘다.
5. core의 handler를 만든다: `apps.secret_value`가 입력의 app·release가 supervisor가 보는 live 자식과 맞는지(`ProcessLivenessCheck`) 확인한 뒤 `secretAttach.send`로 값을 읽고, **응답을 내보내기 전에** `knownSecrets`에 값을 등록(redaction)한다. 등록에 실패하면 값을 내지 않고 `unavailable`. handler는 `packages/core/apps/permissions/` 안 새 file(`secret-value.ts`)에 두고 만드는 함수만 내보낸다.
6. `control.ts`의 `SUPERVISOR_OPERATIONS`와 `appsOperationPolicies`에 `apps.secret_value`를 machine policy로 더한다. 이유: supervisor의 machine credential이 부를 수 있어야 한다.
7. agent·coding agent에게는 이 operation이 닿지 않아야 한다: route `actors`가 `["machine"]`이고 tool·CLI 표에 없음을 확인한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "앱 secret 값은 현재 grant가 이름과 목적지를 허락할 때만 core 밖으로 나가고, 허락 없는 이름·목적지는 forbidden이며 응답·오류에 값이 없다"(`packages/core/secrets/file-attach_test.ts`의 `app_secret` 표. 가짜 file store와 가짜 allowance·processes를 쓴다. 이미 `file-attach` test가 있으면 그 표에 행을 더한다)
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `packages/core/main/daemon/wiring/apps.ts`의 `memory:` 목록에 `["apps/secret_value", <handler>({ attach: ctx.secretAttach, known: ctx.knownSecrets, ... })]`를 더한다(필요한 인자를 보고에 적는다).
- 안 쓰게 된 export
- 정한 것: 1번의 context 문제를 푼 방법
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 값이 supervisor 메모리에서 어떻게 지워지는지는 `rd-cap-secret-supervisor`의 몫이다
