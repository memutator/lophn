# rd-cap-net-live

> **띄우기 전에 사람 확인.** lead는 이 brief를 띄우기 전에 사람에게 한 번 묻는다. 묻는 것은 셋이다.
> 1. (README 정한 것 1) 기존 `tests/e2e/app-call_test.ts`에 broker를 지나 loopback 목적지로 가는 `@lophn/cap-net` 호출 한 행을 더해도 되는가. 새 E2E file은 아니다.
> 2. (코드에서 찾은 것) 지금 실제 core에서는 `net/fetch`가 어떤 목적지로도 나가지 못한다. broker 전송부를 실행하는 apps supervisor의 launch spec(`packages/core/apps/control.ts`의 `appSupervisorSpec`)의 `allow_net`이 core API port, `lophn.invalid`, socket뿐이고, `net_any`는 agent runtime만 쓸 수 있다(`packages/core/supervision/security/launch-spec.ts`). 그래서 허락된 요청도 Deno 권한 오류로 `unavailable("request failed")`가 된다. 추천: apps supervisor에도 `net_any`를 허락한다. 목적지 판정은 broker가 요청마다 하고(선언 ∩ grant의 정확한 host·port, 플랫폼 port 거절, redirect마다 재검사) supervisor의 Deno 권한은 그 뒤의 마지막 문이 아니게 된다. 보안 경계를 넓히는 일이다.
> 3. (코드에서 찾은 것) broker 전송부는 https만 보낸다(`net-fetch.ts`의 `scheme` 기본값. production에서 바꾸는 곳이 없다). loopback E2E 서버를 https로 세우려면 supervisor가 믿는 인증서가 필요하다. 추천: 목적지 host가 loopback(`isLoopbackHost`)일 때만 http로 보낸다. loopback은 기계 밖으로 나가지 않고, 같은 기계의 서비스를 grant로 부르는 앱(예: 로컬 서버)에도 쓰인다. 나머지는 https 그대로다.
>
> 2와 3을 사람이 허락하지 않으면 이 task는 할 수 없다. 그때는 `blocked`로 두고 `project-docs/issues/reuse.md`에 "cap-net이 실제 core에서 나가지 못한다"를 올린다. 1만 허락하면 행을 쓰되 실패하는 것을 보고에 적는다(`testing.md` case 규칙 8: bug를 찾은 E2E는 test를 맞추지 말고 bug를 고친 뒤 넣는다).

앱이 `@lophn/cap-net`으로 loopback 서버를 부르면 broker를 지나 응답이 오는 것을 앱 E2E 한 행으로 확인한다. 이 행이 첫 실제 실행이라 막는 곳이 있으면(위 2·3) 최소로 고친다.

- 단위: rd-cap (wave 2)
- 선행: rd-cap-sdk. `@lophn/cap-net`이 설치되어야 앱이 의존으로 선언할 수 있다.
- 소유(이 task만 고친다):
  - `tests/e2e/app-call_test.ts`
  - `tests/support/app/**`
  - `packages/core/apps/control.ts`
  - `packages/core/supervision/security/launch-spec.ts`
  - `packages/core/apps/permissions/broker/net-fetch.ts`
  - `packages/sdk/cap-net/guide.md`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"(정한 것: 앱 E2E 한 행으로 broker를 지나는 호출을 loopback 목적지로 확인)
  - architecture: `project-docs/architecture/testing.md`("앱 길", "case 고르는 규칙" 1~9, "E2E 실행 폴더"), `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`(approval이 grant를 만든다)
  - skill: `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-capability`, `supervision`, `sdk`
  - 본보기: `tests/e2e/app-call_test.ts`(step 구조, 머리 주석 세 질문), `tests/support/app/patch-call.ts`(blueprint와 handler를 함께 더하는 patch), `tests/support/app/activate.ts`의 `activateTestApp`·`approveActivation`
  - 코드: `packages/core/apps/permissions/broker/net-fetch.ts`(`destinationAllowed`: loopback이라도 platform port만 막는다), `packages/core/apps/permissions/broker/access.ts`(`liveOnly`: live 자식만 외부에 닿는다), `packages/sdk/cap-net/fetch.ts`, `packages/core/apps/packages/template/app/blueprint.ts.tmpl`·`deno.json.tmpl`(의존은 blueprint와 import map이 같아야 한다. template test가 비교한다)
- 계약:
  - 쓰는 것: `@lophn/cap-net`의 `netFetch`(앱 handler 안에서 부른다), route `apps/call_api`(`appCallApi`, 사람 caller), blueprint `permissions`의 `net.fetch`(host·port·reason), `sdk_dependencies`
  - 내놓는 것: `tests/support/app/patch-net.ts`의 `netFetchPatch(dir, { port })` — `fetch_local`(effect `external`, 입력 없음) app-api를 template에 더한다. handler는 `netFetch({ host: "127.0.0.1", port, path: "/" })`의 `{ status, body }`를 돌려준다. blueprint에 `@lophn/cap-net` 의존, `net.fetch` 권한(`127.0.0.1`, port), app `deno.json` import map 항목을 함께 더한다. test mode(app test가 handler를 부를 때)에서 broker가 거절해도 platform app test가 통과해야 한다(`liveOnly`). 어떻게 통과시킬지는 app test가 external handler를 어떻게 부르는지 읽고 정한다(`external_ping` 선례).

## 할 일

1. 먼저 사실을 확인한다(commit하지 않는다): 위 2·3이 실제로 막는지를 행을 먼저 써서 본다. 행이 `unavailable`로 실패하고 core.log나 응답에서 권한 오류가 보이면 2가 맞다. 사람이 허락한 만큼만 고친다.
2. `patch-net.ts`를 만들고 `app-call_test.ts`에서 앱 activation 전에 loopback 서버(`Deno.serve`, `127.0.0.1`, port 0, http)를 띄워 port를 patch에 준다. 서버는 받은 요청 수와 header를 기록하고 JSON `{ "hello": "net" }`을 돌려준다. `finally`에서 닫는다. 서버가 뜨는 것은 새 서버 test가 아니라 이 행의 loopback 상대이고 README가 정한 행이다. 앱은 지금 쓰는 `Calls` 앱에 `callPatch`·`projectScopePatch`와 함께 얹는다(`patch`에서 셋을 부른다).
3. 허락(2번 사람 확인 뒤): `appSupervisorSpec`에 `net_any: true`를 주고 `checkLaunchSpec`이 `apps/supervisor`도 받게 한다(`lophn-agent/runtime`과 `apps/supervisor`만). 주석에 이유를 쓴다: 목적지 판정은 broker가 요청마다 한다. broker 판정이 마지막 문이므로 그 판정이 틀리면 supervisor가 아무 곳이나 간다는 점도 같이 적는다.
4. 허락(3번 사람 확인 뒤): `net-fetch.ts`의 `scheme`을 요청 host가 loopback이면 `http`로 한다. redirect 검사(`next.protocol !== `${scheme}:``)도 같은 규칙으로 맞춘다(loopback에서 loopback으로만 http). `cap-net/guide.md`의 "요청은 https이고"를 "요청은 https이고, loopback host는 http다"로 고친다.
5. 행을 `app-call_test.ts`에 `t.step("net-fetch-loopback", …)` 하나로 더한다(`testing.md` 규칙 4: 단계 6, fake 대답 3, 단정 3 이하. 이 행은 사람 caller라 model 대답이 없다). 흐름: `appCallApi`(target live, api `fetch_local`, caller `user`) → outcome `succeeded`이고 결과가 `{ status: 200, body: { hello: "net" } }`. 단정은 서로 다른 곳에서 셋: (route) 호출 결과, (loopback 서버) 받은 요청이 정확히 1건이고 `Authorization` 등 앱이 붙이지 않은 header가 없음, (ledger) `appInvocation`의 status `succeeded`. 머리 주석 세 질문에 이 행의 contract(`app-capability`·broker가 요청마다 선언∩grant를 본다), 회귀(net/fetch가 실제 core에서 나가지 못한다 — 2번), 왜 test로 못 잡나(unit은 `transport`를 끼워 넣어 supervisor 권한과 https를 지나지 않는다)를 더한다.
6. `deno task e2e:deps` 한 번 뒤 `deno test -A tests/e2e/app-call_test.ts`를 세 번 돌려 통과함을 본다(lead가 10번 연속을 본다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 없어야 한다. 기다림은 신호를 읽는 poll만 쓴다.

## 끝남

- `deno task check`가 통과한다(`tests/support`는 check에 든다).
- 위험 test: "앱이 broker를 지나 loopback 목적지로 `@lophn/cap-net` 요청을 보내 응답을 받는다"(`app-call_test.ts`의 step `net-fetch-loopback`)
- 남지 않음: 없음. 허락받지 않은 2·3의 고침은 하지 않는다.

## 보고

- 바꾼 file
- 통과한 check, e2e를 돌린 횟수
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: test mode에서 handler를 통과시킨 방법, 2·3의 고침 범위
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `cap-fs`는 이 행에 포함되지 않는다. `cap-secret`의 전달 통로는 이어지지 않았다(`rd-cap-sdk` 보고).
