# rd-cap-secret-supervisor

앱 supervisor의 broker가 `secrets/use`를 받으면 값을 core에서 받아 둬 같은 invocation의 `net/fetch`에 `Authorization` header로 붙이게 한다. 앱은 값을 보지 못한다. 지금은 `closedSecretDelivery`가 기본이고 아무도 adapter를 꽂지 않아 늘 `unavailable`이다.

- 단위: rd-cap-secret (wave 3)
- 선행: rd-cap-secret-core. route `apps.secret_value`와 broker 입력의 http scheme을 먼저 만든다.
- 소유(이 task만 고친다):
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/core/main/app-supervisor/broker.ts`
  - `packages/core/main/app-supervisor/secret-delivery.ts`
  - `packages/core/apps/permissions/broker/secrets.ts`
  - `packages/core/apps/permissions/broker/net-fetch.ts`
  - `packages/core/apps/permissions/broker/net-fetch_test.ts`
  - `packages/core/apps/permissions/broker/invocations.ts`
  - `packages/sdk/cap-secret/**`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"의 정한 것(secret)
  - architecture: `project-docs/architecture/agent-definition.md`("provider credential…은 ledger, event, log, 오류, model 입력에 없다"와 같은 원칙: 값은 로그·오류·응답에 없다), `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `supervision`, `app-capability`, `sdk`
  - 코드: `packages/core/main/app-supervisor/broker.ts`(`closedSecretDelivery`·`closedRedaction`, `brokerAdapters.secrets`), `packages/core/main/app-supervisor/assembly.ts`(`brokerAdapters`, `post(path, bearer, body)`로 core를 부르는 곳, `appAppApi`를 읽는 `access.ts` 본보기), `packages/core/apps/permissions/broker/secrets.ts`의 `SecretDelivery`·`RedactionGate`, `packages/sdk/cap-secret/secret.ts`·`host.ts`
- 계약:
  - 쓰는 것: route `apps.secret_value`(machine, `rd-cap-secret-core`), broker 입력 `secrets/use`·`net/fetch`(둘 다 `invocation`을 싣는다)
  - 내놓는 것: 앱의 `useSecret({ name, destination })`가 live에서 성공하고, 같은 invocation에서 그 destination으로 `netFetch`하면 broker가 `Authorization: Bearer <값>`을 붙여 보낸다. 앱 응답·오류·log에 값이 없다.

## 할 일

1. `secret-delivery.ts`에 `createSecretDelivery(deps)`를 만든다. `deps`는 core를 부르는 함수(assembly의 `post`와 machine credential)와 clock이다. `use(request)`: core의 `apps.secret_value`를 `{ app, release, process_nonce, name, destination }`으로 불러 값을 받고 메모리 map `invocation|name|destination → value`에 둔다. `{ sent: true }`를 돌려준다(이름은 그대로 두고 의미는 "붙일 준비가 됐다"다. `broker/secrets.ts`의 주석을 맞춘다). invocation이 `null`이면 `invalid_input`: 값을 붙일 자리가 없다.
   - 값은 invocation이 끝날 때 지운다. 끝났음을 supervisor가 아는 곳(호출 상태를 쥐는 `apps/permissions/broker/invocations.ts`의 흐름)을 읽고 거기에 붙인다. 안 되면 가장 작게: 값마다 만료 시각(60초)을 두고 `net/fetch`가 쓸 때와 만료 때 지운다. 어느 쪽인지 "정한 것"에 적는다.
2. `net-fetch.ts`: 요청에 `invocation`이 있고 map에 같은 invocation·같은 목적지(host·port)의 값이 있으면 `headers`에 `Authorization: Bearer <값>`을 넣는다. redirect를 따라갈 때는 목적지가 바뀌면(host/port/scheme) header를 빼고 다시 판정한다(`secrets.ts`의 `recheck`와 같은 규칙). 값 map은 `createNetFetchService`의 인자(`secrets` lookup)로 받는다. 전역 상태를 두지 않는다.
3. `broker.ts`·`assembly.ts`: `closedSecretDelivery`를 기본에서 빼고 `createSecretDelivery`를 꽂는다. `RedactionGate.ensure(name)`은 core가 값을 내보내기 전에 등록하므로(`rd-cap-secret-core`) supervisor 쪽은 성공을 돌려주는 얇은 gate면 된다. 이유 한 줄을 주석에 쓴다. `closedSecretDelivery`·`closedRedaction`은 더 쓰지 않으면 지운다.
4. SDK: `packages/sdk/cap-secret/deno.json`(판 1.0.0, `cap-project`와 같은 꼴)을 둔다. destination이 loopback이면 `scheme: "http"`로 broker에 보낸다(`secret.ts`가 지금 `https` 고정). `deno check packages/sdk/cap-secret`. `guide.md`를 지금 동작에 맞게 고친다: "`useSecret`을 부른 같은 command 안에서 그 destination으로 `netFetch`하면 lophn이 `Authorization: Bearer`로 붙인다. 값은 앱에 없다. 사람이 `secrets/put`으로 넣은 이름과 blueprint의 `secret.use`·`net.fetch`, 사람의 허락이 필요하다".
5. 위험 test 하나(아래).
6. 기동을 본다(commit하지 않는다): `.dev-data/rd-cap-secret-supervisor/`에 core를 띄워 supervisor가 뜨고 `cap-secret/1.0.0`이 설치됨을 본다. 실제 흐름은 `rd-cap-net-live`의 E2E 행이 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "secret 값은 같은 invocation의 정확한 목적지 요청에만 붙고, 다른 invocation·다른 목적지·redirect로 바뀐 목적지에는 붙지 않는다"(`net-fetch_test.ts`의 행. `rd-cap-net-transport`가 만든 file에 행을 더한다. 가짜 transport가 받은 header를 본다)
- 남지 않음: `grep -rn "closedSecretDelivery" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 값을 지우는 시점, 붙이는 방식(`Authorization: Bearer`)
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 상대 서버가 응답 본문에 secret을 되돌려 주면 앱 응답에 들어간다(redaction은 core 경계에서만 한다). 없으면 "없음"
