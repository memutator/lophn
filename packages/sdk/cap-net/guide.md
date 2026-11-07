# @lophn/cap-net

## 목적

timeout과 retry가 있는 외부 fetch client다. 요청은 broker의 전송부가 매번 정확한
host·port·redirect를 선언과 grant로 검사한 뒤 보낸다. 앱 process의 network는 막지
않으므로 이 검사는 이 client를 지나는 요청에만 걸린다.

loopback 듣기는 별도 package가 없다. `node:http`로 직접 listen한다.

## 공개 API와 type

```ts
import { createNetClient, netFetch } from "@lophn/cap-net";
```

- `netFetch({ host, port, path, method?, headers?, body? }, options?)` — command
  안에서 부른다. `{ status, body }`를 돌려준다. host·port는 grant에 적힌 정확한
  값이다. 요청은 https이고, loopback host는 http다. 사람이 켠 host·port만
  나간다.
  - `body`는 글 또는 `Uint8Array`이고 10 MiB까지다. `GET`·`HEAD`에는 못 싣는다.
    `headers`는 32개까지다.
  - 앱이 못 쓰는 header는 `Authorization`, `Cookie`, `Host`, `Content-Length`,
    `Proxy-Authorization`이다(대소문자 무관). 인증이 필요하면
    `@lophn/cap-secret`의 `useSecret`을 쓴다. `Authorization`은 lophn이 붙인다.
  - redirect에서 앱 header는 처음 목적지와 같은 origin으로만 다시 간다.
    301·302·303은 `GET`으로 바꾸고 body와 `content-type`을 버린다.
  - 응답은 여전히 1 MiB 이하의 글·JSON이다.
  - 큰 본문은 시도 하나의 기본 timeout(10초)이 짧을 수 있다. `timeoutMs`를
    키운다.
- `createNetClient({ host?, sleep? })` — 시험이나 preview에서 host를 바꿔
  끼운다.
- options: `timeoutMs`(시도 하나, 기본 10000), `retries`, `retryDelaysMs` (기본
  200·400ms).
- 재시도는 `GET`·`HEAD`에만 기본 2회다. 일시 실패(전송 실패, timeout,
  `unavailable`, 상대의 429·502·503·504)에서만 다시 부른다.
  `POST`·`PUT`·`PATCH`·`DELETE`는 기본 0회이고, 실패하면
  `error.outcome === "unknown"`이다. 쓰기에 `retries`를 직접 주려면 상대가 같은
  요청을 두 번 받아도 되는지(멱등)를 앱의 계약으로 확인한다.
- 거절은 `CapabilityError`다. `forbidden`이면 `permission`(`net.fetch`)과
  `scope`(`{ host, port }`)를 알린다. 거절은 다시 부르지 않는다.
- `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `net.fetch`를
  빠뜨렸는지 검사한다.
- type: `NetClient`, `NetRequest`, `NetFetchOptions`, `NetResponse`,
  `CapabilityError`, `DeclarationCheck`

## 요구 permission

`net.fetch` — 정확한 host와 port. wildcard host·port 0·전체 port는 선언할 수
없다. 플랫폼의 loopback port는 grant가 있어도 막힌다.

## peer 의존

정확한 peer는 없다(단독 사용). command 문맥은 `@lophn/cap-tool`의 handler 안에서
이어진다.

## 예제

```ts
import { netFetch } from "@lophn/cap-net";

const { status, body } = await netFetch(
  { host: "api.example.com", port: 443, path: "/v1/usage" },
  { timeoutMs: 5000 },
);

// JSON 본문과 header를 보내는 쓰기. 큰 본문이면 timeoutMs를 키운다.
await netFetch({
  host: "api.example.com",
  port: 443,
  path: "/v1/items",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "a" }),
}, { timeoutMs: 30_000 });
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
