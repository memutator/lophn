# rd-cap-net-transport

`@lophn/cap-net`이 실제 core에서 밖으로 나가게 한다. 앱 supervisor(broker가 도는 process)에 host 없는 net을 주고, loopback 목적지에는 http를 허락한다. 목적지 검사는 지금처럼 broker가 요청마다 한다. 앱 process에는 여전히 net이 없다. lophn 자기 port는 loopback이라도 막는다.

- 단위: rd-cap (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/sdk/cap-net/**`
  - `packages/core/apps/control.ts`
  - `packages/core/supervision/security/launch-spec.ts`
  - `packages/core/supervision/security/launch-spec_test.ts`
  - `packages/core/apps/permissions/broker/net-fetch.ts`
  - `packages/core/apps/permissions/broker/net-fetch_test.ts`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"의 정한 것(net)
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `supervision`, `app-capability`, `sdk`
  - 코드(읽어 보고 확인한 사실):
    - `packages/core/apps/control.ts`의 `appSupervisorSpec`: `allow_net`이 `127.0.0.1:<core port>`, `lophn.invalid`, 앱 socket뿐이다. 그래서 허락된 요청도 Deno 권한 오류가 나 `net-fetch.ts`의 `catch`가 `unavailable("request failed")`로 바꾼다.
    - `packages/core/supervision/security/launch-spec.ts`의 `checkLaunchSpec`: `spec.net_any`는 `kind`가 `lophn-agent/runtime`일 때만 받고 `--allow-net`(host 없음)이 된다. 스키마는 `packages/protocol/supervision/supervision.ts`의 `net_any`.
    - `packages/core/apps/permissions/broker/net-fetch.ts`: `scheme` 기본값이 `https`다. production에서 바꾸는 곳이 없다(`packages/core/main/app-supervisor/broker.ts`가 `netScheme`을 넘길 때만 바뀐다). `destinationAllowed`는 loopback이라도 플랫폼 port만 막는다. redirect도 `next.protocol !== `${scheme}:``로 scheme이 같아야 한다.
    - 본보기 secret 목적지 모양: `packages/protocol/secrets/secrets.ts`의 `loopback_http`(같은 기계의 loopback HTTP origin)
- 계약:
  - 쓰는 것: broker의 `net/fetch`(그대로), `isLoopbackHost`(`net-fetch.ts`)
  - 내놓는 것: 앱의 `netFetch`가 grant된 외부 host·port와 loopback host·port로 나간다. 요청 목적지가 loopback host(`isLoopbackHost`)이면 `http`, 아니면 `https`다. 플랫폼 port 거절, 선언∩grant 검사, redirect마다 재검사는 그대로다. `rd-cap-secret-supervisor`가 같은 file을 이어서 고친다.

## 할 일

1. `launch-spec.ts`: `net_any`를 `lophn-agent/runtime`과 `apps/supervisor`(`packages/core/apps/control.ts`의 `APPS_SUPERVISOR_KIND`)에만 받는다. 거절 문구도 맞춘다. 주석에 이유를 쓴다: 목적지 판정은 broker가 요청마다 한다. supervisor는 lophn의 코드이고 앱 process가 아니다. broker 판정이 틀리면 supervisor가 아무 곳이나 간다는 점도 같이 적는다.
2. `control.ts`의 `appSupervisorSpec`에 `net_any: true`를 준다. `allow_net`의 기존 항목은 남긴다(host 없는 허락이 있어도 목록은 어디에 닿는지를 적는다. agent runtime이 같은 방식이다: `packages/core/lophn-agent/tools/runtime-permissions.ts`).
3. `net-fetch.ts`: 요청의 `host`가 loopback이면 origin을 `http://`로, 아니면 `https://`로 만든다. `deps.scheme`(시험이 넣는 값)이 있으면 그것이 이긴다. redirect 검사는 "다음 목적지의 scheme이 그 목적지 규칙과 같다"로 맞춘다(loopback에서 loopback으로만 http. https에서 http로 내려가는 redirect는 거절). 이유: 사람이 켠 같은 컴퓨터의 서비스(로컬 서버)를 부르려는 것이고, 기계 밖으로 나가지 않는 http만 허락한다.
4. 위험 test 둘(아래).
5. `packages/sdk/cap-net/deno.json`(판 1.0.0, `cap-project`와 같은 꼴)을 둔다. `deno check packages/sdk/cap-net`을 통과시킨다. `guide.md`의 "요청은 https이고"를 "요청은 https이고, loopback host는 http다. 사람이 켠 host·port만 나간다"로 고치고, 이제 실제 core에서 나간다는 사실에 맞게 어긋난 줄이 있으면 고친다.
6. 설치와 기동을 본다(commit하지 않는다): `.dev-data/rd-cap-net-transport/`에 core를 띄워 `<data root>/sdk/cap-net/1.0.0/guide.md`가 있고 apps supervisor가 뜨는 것(기동 로그에 launch spec 거절이 없음)을 본다. 실제로 나가는 확인은 `rd-cap-net-live`(앱 E2E 행)가 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(둘):
  - `launch-spec_test.ts`(새로 만든다): "net_any는 agent runtime과 apps supervisor에만 허락되고 다른 kind에는 거절된다"
  - `net-fetch_test.ts`(새로 만든다): "loopback host는 http로, 그 밖 host는 https로 보내고, 플랫폼 port는 loopback이라도 막으며, https에서 http로 내려가는 redirect를 거절한다". `createNetFetchService`에 가짜 `transport`(받은 URL을 기록)와 가짜 `access`를 끼운다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 실제로 나가는 것은 아직 E2E로 안 봤다(`rd-cap-net-live`)
