# ao-net-fetch

앱의 `netFetch`가 요청 본문(글 또는 bytes, 10 MiB까지)과 header를 보내게 한다(Drive upload 같은 파일 올리기에 필요). 인증 header는 앱이 정하지 못한다: `Authorization`·`Cookie`·`Host`·`Content-Length`(와 `Proxy-Authorization`)는 거절한다. 응답 한도(1 MiB)는 그대로다.

- 단위: ao-net (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/permissions/broker/net-fetch.ts`
  - `packages/core/apps/permissions/broker/net-fetch_test.ts`
  - `packages/core/apps/permissions/broker/server.ts`
  - `packages/sdk/cap-net/fetch.ts`
  - `packages/sdk/cap-net/mod.ts`
  - `packages/sdk/cap-net/guide.md`
- 읽을 것:
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"의 네트워크, "위험 test"의 셋째
  - architecture: `project-docs/architecture/app-call.md`("앱이 바깥으로 나가는 길"의 net, secret: redirect 한 단계마다 같은 검사, 값은 같은 invocation의 같은 (host, port) 요청에만 붙음)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-capability`, `sdk-api`, `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/sdk`
  - 계약: `packages/protocol/apps/broker.ts`의 `brokerNetFetchInputSchema`(`headers`, `body`, `NET_FETCH_BODY_MAX_BYTES`, `NET_FETCH_FORBIDDEN_HEADERS`, `fetchBodyBytes`. `ao-contract`)
  - 코드: `net-fetch.ts`(`createNetFetchService.request`: 목적지 검사, redirect 루프, `secrets` hook으로 붙는 `Authorization`), `net-fetch_test.ts`(`setup`·`fetch` helper와 가짜 `transport`), `server.ts`(`BROKER_BODY_MAX_BYTES = 1 MiB`가 모든 broker 요청의 JSON 본문 상한), `packages/sdk/cap-net/fetch.ts`(`createNetClient`, `check`, 재시도 규칙), `packages/core/apps/preview/adapters/external.ts`(같은 schema를 쓰는 preview 대역. 이 task에서 고치지 않는다)
- 계약:
  - 쓰는 것: `ao-contract`가 고정한 `headers`·`body` 칸과 상수. 바꾸지 않는다.
  - 내놓는 것: SDK `NetRequest`에 선택 칸 `headers?: Record<string, string>`, `body?: string | Uint8Array`.

## 할 일

1. `server.ts`: net/fetch 경로만 JSON 본문 상한을 올린다. 10 MiB bytes의 base64는 약 13.4 MiB이므로 `Math.ceil(NET_FETCH_BODY_MAX_BYTES / 3) * 4`에 envelope 여유(64 KiB)를 더한 값으로 한다. 다른 broker 경로는 1 MiB 그대로다(경로별 상한 표 하나로). 앱 process에서 broker까지 가는 다른 크기 한도가 있는지 `packages/core/apps/runtime/entrypoint/{broker-client,http,cap-host}.ts`와 `packages/core/main/app-supervisor/broker.ts`를 읽어 확인하고 있으면 보고에 적는다.
2. `net-fetch.ts`: 요청을 보낼 때 `input.headers`를 그대로 header로 싣고(이미 schema가 금지 이름을 거절했다), `input.body`를 `string`이면 글로, `{ base64 }`면 bytes로 풀어 `body`에 싣는다. 인증은 지금처럼 `secrets` hook이 `Authorization: Bearer`를 붙이고 앱 header와 겹치지 않는다(앱은 `Authorization`을 못 실으므로 덮어쓰기 문제가 없다).
   - redirect: 301·302(비GET/HEAD)·303은 method를 `GET`으로 바꾸고 body와 앱 header의 `content-type`을 버린다(지금 method 바꾸는 줄 옆). 307·308은 method와 body를 그대로 다시 보낸다. **앱 header는 처음 목적지와 같은 origin으로만 다시 보낸다**(다른 origin으로 가면 앱 header를 모두 버린다. API key 같은 header가 새지 않게. secret은 지금처럼 목적지마다 `secrets` hook이 다시 찾는다).
   - 응답 읽기·한도·decode는 그대로다.
3. `packages/sdk/cap-net/fetch.ts`: `NetRequest`에 `headers`·`body`를 더한다. `check`가 보내기 전에 거른다: `GET`·`HEAD`에 body 금지, 금지 header(`authorization`, `cookie`, `host`, `content-length`, `proxy-authorization`, 대소문자 무관) 금지, body 크기 10 MiB 이하, header 32개 이하, key `^[A-Za-z0-9-]{1,64}$`. 모두 `invalid_input` `CapabilityError`다. `Uint8Array`는 base64로 `{ base64 }`, 글은 그대로 요청 body에 싣는다. SDK는 standalone으로 설치되는 package라 protocol을 import하지 못한다. 상수는 사본으로 두고 `packages/protocol/apps/broker.ts`와 같아야 한다는 주석을 단다. broker가 정본으로 한 번 더 거절한다.
   - 재시도 규칙은 그대로다(GET·HEAD만 기본 2회). body가 있는 요청은 어차피 POST·PUT·PATCH·DELETE라 기본 0회다. 시도 하나의 기본 timeout 10초는 큰 본문에 짧을 수 있으니 guide에 `timeoutMs`를 쓰라고 적는다. 기본값은 바꾸지 않는다.
   - `mod.ts`에서 새 type이 나가게 한다.
4. `packages/sdk/cap-net/guide.md`: "header·body·credential은 앱이 붙이지 않는다" 문장이 틀려진다. 다음으로 고친다: body(글 또는 `Uint8Array`, 10 MiB)와 header를 보낼 수 있다, 앱이 못 쓰는 header 목록, 인증이 필요하면 `@lophn/cap-secret`의 `useSecret`(Authorization은 lophn이 붙인다), 응답은 여전히 1 MiB 이하의 글·JSON이다, 큰 본문은 `timeoutMs`를 키운다. 예제에 `POST`로 JSON 본문과 header를 보내는 것 하나. version 정책 절은 그대로 두고 `deno.json` version은 올리지 않는다(이 저장소는 SDK 변경에 version을 올리지 않아 왔다. 같은 version의 byte가 바뀌면 이미 만든 개발 data root에서 기동이 conflict가 나니 보고에 적는다).
5. 위험 test 하나를 `net-fetch_test.ts`에 더한다(아래). 기존 test는 `headers`·`body` 없는 요청이라 그대로 통과해야 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test (`packages/core/apps/permissions/broker/net-fetch_test.ts`): "`Authorization`·`Cookie`·`Host`·`Content-Length` header(대소문자를 섞어도)를 실은 net/fetch 요청은 `invalid_input`으로 거절되고 transport가 불리지 않는다. 같은 요청에서 허용된 header(`content-type`)와 body는 그대로 나가고, `useSecret`으로 받은 값은 앱 header 없이 `Authorization: Bearer`로만 붙는다." 가짜 `transport`만 쓴다. 서버·subprocess를 띄우지 않는다.
- 남지 않음: `grep -rn "header·body·credential은 앱이 붙이지 않는다" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(redirect 때 앱 header·body 처리, 경로별 상한)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(예: 응답은 글·JSON만 읽는다. bytes 응답 내려받기는 없다). 없으면 "없음"
