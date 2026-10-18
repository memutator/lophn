# rd-cap-net-live

앱이 `@lophn/cap-net`과 `@lophn/cap-secret`으로 loopback 서버를 부르면 broker를 지나 응답이 오고 secret이 붙는 것을 기존 앱 E2E 한 행으로 확인한다(사람이 허락한 행이다). 이 행이 첫 실제 실행이라 막는 곳이 나오면 그 task의 소유 범위 밖이라도 고치지 말고 보고한다.

- 단위: rd-cap-live (wave 4)
- 선행: rd-cap-net-transport, rd-cap-secret-supervisor, rd-cap-fs. 앞의 둘이 net과 secret을 열었다.
- 소유(이 task만 고친다):
  - `tests/e2e/app-call_test.ts`
  - `tests/support/app/**`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"의 정한 것(확인: 앱 E2E 한 행, loopback 목적지)
  - architecture: `project-docs/architecture/testing.md`("앱 길", "case 고르는 규칙" 1~9), `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`(approval이 grant를 만든다)
  - skill: `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-capability`, `sdk`
  - 본보기: `tests/e2e/app-call_test.ts`(step 구조, 머리 주석 세 질문), `tests/support/app/patch-call.ts`(blueprint와 handler를 함께 더하는 patch), `tests/support/app/activate.ts`의 `activateTestApp`·`approveActivation`, `tests/e2e/secret_test.ts`(secret을 넣는 사람 길: `secrets/put`)
  - 코드: `packages/core/apps/permissions/broker/access.ts`(`liveOnly`: live 자식만 외부에 닿는다. test mode의 app test는 stand-in), `packages/core/apps/packages/template/app/blueprint.ts.tmpl`·`deno.json.tmpl`(의존은 blueprint와 import map이 같아야 한다. template test가 비교한다)
- 계약:
  - 쓰는 것: `@lophn/cap-net`의 `netFetch`, `@lophn/cap-secret`의 `useSecret`, route `apps/call_api`(`appCallApi`, 사람 caller), `secrets/put`, blueprint `permissions`의 `net.fetch`·`secret.use`, `sdk_dependencies`
  - 내놓는 것: `tests/support/app/patch-net.ts`의 `netFetchPatch(dir, { port, secret })` — `fetch_local`(effect `external`, 입력 없음) app-api. handler는 `useSecret({ name, destination: { host: "127.0.0.1", port } })` 뒤 `netFetch({ host: "127.0.0.1", port, path: "/" })`의 `{ status, body }`를 돌려준다. blueprint에 두 SDK 의존, `net.fetch`(127.0.0.1, port)와 `secret.use`(name) 권한, app `deno.json` import map 항목을 함께 더한다. app test가 handler를 test mode에서 부를 때(broker 거절, `liveOnly`) platform app test가 통과해야 한다. 어떻게 통과시킬지는 app test가 external handler를 어떻게 부르는지 읽고 정한다(`external_ping` 선례).

## 할 일

1. `patch-net.ts`를 만든다. `app-call_test.ts`에서 앱 activation 전에 loopback 서버(`Deno.serve`, `127.0.0.1`, port 0, http)를 띄우고 port를 patch에 준다. 서버는 받은 요청 수와 `Authorization` header를 기록하고 JSON `{ "hello": "net" }`을 돌려준다. `finally`에서 닫는다. 이 서버는 README가 허락한 이 행의 loopback 상대다. 앱은 지금 쓰는 `Calls` 앱에 `callPatch`·`projectScopePatch`와 함께 얹는다. 사람 길로 secret을 넣는다: activation 전에 `secrets/put`(이름 `e2e.net.token`, 값은 test가 만든 무작위 문자열).
2. 행을 `t.step("net-fetch-loopback", …)` 하나로 더한다(`testing.md` 규칙 4: 단계 6, fake 대답 3, 단정 3 이하. 사람 caller라 model 대답이 없다). 흐름: `appCallApi`(target live, api `fetch_local`, caller `user`) → outcome `succeeded`이고 결과가 `{ status: 200, body: { hello: "net" } }`. 단정은 서로 다른 곳에서 셋: (route) 호출 결과가 맞고 직렬화된 응답에 secret 값이 없다, (loopback 서버) 받은 요청이 정확히 1건이고 `Authorization`이 `Bearer <값>`이다, (ledger) `appInvocation`의 status `succeeded`.
3. 머리 주석 세 질문에 이 행의 contract(`app-capability`: broker가 요청마다 선언∩grant를 보고 lophn이 secret을 붙인다), 회귀(net/fetch가 실제 core에서 나가지 못하고 secret이 늘 `unavailable`이었던 것), 왜 test로 못 잡나(unit은 `transport`를 끼워 넣어 supervisor 권한·process 경계를 지나지 않는다)를 더한다.
4. `deno task e2e:deps` 한 번 뒤 `deno test -A tests/e2e/app-call_test.ts`를 세 번 돌려 통과함을 본다(lead가 10번 연속을 본다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 없어야 한다. 기다림은 신호를 읽는 poll만 쓴다.
5. 이 행이 실패하면 test를 맞추지 않는다(`testing.md` 규칙 8). 원인 task의 file이면 고치지 말고 보고에 어느 줄이 왜 막는지 적는다.

## 끝남

- `deno task check`가 통과한다(`tests/support`는 check에 든다).
- 위험 test: "앱이 broker를 지나 loopback 목적지로 net 요청을 보내 응답을 받고 lophn이 secret을 붙인다"(`app-call_test.ts`의 step `net-fetch-loopback`)
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check, e2e를 돌린 횟수
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: test mode에서 handler를 통과시킨 방법
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `cap-fs`는 이 행에 포함되지 않는다(사람이 행 하나로 정했다).
