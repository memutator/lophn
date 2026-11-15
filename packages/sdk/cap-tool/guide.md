# @lophn/cap-tool

## 목적

operation·command handler 등록, 실제 invocation 문맥, 읽기 결과 모양, 다른 앱의
command 호출, 앱 event의 발행과 구독을 제공한다. 모든 호출은 core를 거치고, 앱 process는 core가 보낸
호출을 handler로 돌려준다.

operation(화면과 앱 자신이 쓰는 동작)과 command(agent·다른 앱·job·flow가 부르는
바깥 명령)는 선언에서 갈리고, handler는 이름 하나로 등록한다. 두 목록을 합쳐
이름이 하나다.

## 공개 API와 type

```ts
import {
  currentContext,
  handle,
  publish,
  runWith,
  subscribe,
  traceName,
} from "@lophn/cap-tool";
```

- `handle(name, run)` — 선언의 `operations`나 `commands`에 있는 `name`의 handler를
  등록한다. 같은 이름을 두 번 등록하면 던진다. handler는 입력 하나를 받고 결과를
  돌려주거나 `HandlerRejection`을 던진다. command의 입력은 선언의 `inputSchema`로
  검사하고 default를 채워 준다. operation의 입력은 검사하지 않으므로 handler가
  직접 확인한다.
- `runWith(context, work)` — invocation 문맥 안에서 업무를 돌린다.
- `currentContext()` — 현재 invocation 문맥(앱·release·mode·invocation·대상
  `kind`와 `name`·부른 쪽)을 읽는다.
- `registeredHandlers()` — 등록된 handler 이름 목록이다.
- `traceName(name)` — 내부 trace 이름을 만든다(최대 64자,
  `TRACE_NAME_MAX_CHARS`).
- `readResult(source, query)` — 읽기 결과를 coverage·freshness와 함께
  돌려준다.
- `HandlerRejection(code, message)` — handler가 효과 전에 호출을 받지 않겠다고
  알린다(`invalid_input|forbidden|conflict|unavailable`). 안내 문장에 입력·상태
  값을 넣지 않는다.
- `connectCommands(app, commands)` — 다른 앱의 command를 부르는 client를 준비한다.
  `call(name, input?)`은 core를 거쳐 간다. 열지 않은 이름은 `forbidden`
  결과다. 다른 앱의 operation은 부를 수 없다. 현재 invocation이 부모로 자동으로
  붙고 부른 쪽의 신원은 core가 정한다.
  돌려주는 `{ invocation, outcome }`의 `outcome`은 `succeeded`, `failed`(대상
  handler 오류), `denied`(Gate 막음 등 handler까지 가지 못함), `unknown`(결과
  모름) 가운데 하나다. `unknown`은 자동으로 다시 부르지 않는다. 호출 자체가
  실패하면 `ok: false`다.
- `publish(name, payload)` — 선언의 `events`에 있는 event를 낸다(아래 "앱 event"). `{ok, value: {publication,
  reachable, unreachable, refused}}`나 `{ok: false, error}`를 돌려준다. 선언하지 않은 event나 `payloadSchema`와 맞지 않는
  payload는 `invalid_input`이다. 구독자의 답을 기다리지 않는다. 부모 invocation이 돌고 있지 않아도 된다(시작 코드,
  timer). preview·test에서는 core에 가지 않고 `standIn: true`를 돌려준다.
- `subscribe(source, event, handler)` — 선언의 `subscriptions`에 있는 구독의 handler를 등록한다. `source`는 event를 낸 앱의
  slug이거나 lophn이 내는 event의 `"lophn"`이다. `handler(payload)`가 event 하나마다 한 번 불리고 반환값은 쓰이지 않는다.
  선언하지 않은 구독의 handler를 등록하면 앱이 시작하지 못한다. 선언만 하고 등록하지 않으면(화면만 구독하는 앱) process에는 그 event가 가지 않고 화면(`useEvent`)만 받는다. 내부적으로 이름 `on.<source>.<event>`의 `handle`이다.
- type: `InvocationContext`, `AppCaller`, `HandlerPort`, `RegisteredHandler`,
  `ReadQuery`, `ReadSource`, `ReadCoverage`, `ReadFreshness`, `ReadContinuation`,
  `RejectionCode`, `CommandClient`, `CallOutcome`, `CallOutput`, `AppResult`, `PublishOutput`

## 앱 event

앱 하나가 사실을 내고 여러 앱이 듣는 일대다에 쓴다. 예: 구독 사용량 앱이 한도 90%를 감지해 `usage.limit`을 내면 다른 앱이
듣고 반응한다.

```ts
// 발행 앱: lophn.ts의 events에 {name: "usage.limit", description, payloadSchema}를 선언한다.
await publish("usage.limit", { provider: "claude", percent: 91 });

// 구독 앱: lophn.ts의 subscriptions에 {source: "masup", event: "usage.limit"}를 선언한다. source는 발행 앱의 slug다.
subscribe("masup", "usage.limit", async (event: { percent: number }) => {
  if (event.percent < 90) return;
  // ... 반응
});
```

- event는 일이 일어난 **뒤의 알림**이다. 시작 전에 막거나 답을 받는 hook이 아니다. core는 구독자의 답을 기다리지 않는다.
- 전달은 **한 번이고 저장하지 않는다**. 재시도도 구독자별 cursor도 없다. 그 순간 켜져 있지 않은 구독 앱은 그 event를 받지 못한다.
  놓쳐도 되게 짠다: **발행 앱은 지금 값을 읽는 read command를 따로 내놓고**, 구독 앱은 켜질 때 그 command를 한 번 읽은 뒤
  event로 고친다(event만으로 상태를 만들지 않는다). payload는 알림에 필요한 작은 값만 담는다(16 KiB까지).
- 구독 handler 호출은 앱 호출 하나로 기록된다(`lophn app invocations`에 어느 앱의 어느 event가 불렀는지 보인다). write로
  기록되어 앱 DB 변경이 rewind 대상이다. 구독에 사람 허락은 없다. 발행 앱은 낸 기록(누가 어느 event를 몇 구독자에게 냈나.
  payload는 없다)을 `lophn app event-publications`로 읽는다.
- 자기가 받은 event 때문에 도는 handler 안에서 다시 event를 내 고리가 생기면(A → B → A) core가 끊는다. event가 부른 앱들의
  chain을 싣고 가므로 chain에 이미 있는 앱에는 넘기지 않고(깊이 한도 8도 같다) 그 수를 발행 기록의 `refused`에 센다.

## write와 DB 변경

write·external handler가 도는 동안 SDK가 앱 DB 변경을 changeset으로 떠서 core에
돌려준다(rewind가 쓴다). 앱은 `@lophn/cap-store`가 주는 DB 연결 하나만 쓴다.
read handler는 DB를 바꾸지 않는다고 선언을 믿는다.

앱 backend가 폰에서 돌 때도 같은 API이고, 호출은 하나씩 돈다. 폰에서는 다른 앱 호출
(`connectCommands`)과 event 발행·구독(`publish`, `subscribe`)이 `unavailable`로 끝난다.
handler가 `node:` module을 import하면 폰에서 뜨지 않는다.

## 요구 permission

handler 등록과 문맥 전달, event 발행·구독은 요구 permission이 없다(event는 발행 앱이 선언해 내놓는 것이다). `connectCommands`는 import만으로
아무것도 열지 않는다. 선언의 `app_connections`에 대상 앱과 command와 목적을
선언하고 사람이 방향 있는 앱 쌍과 범위를 허락해야 한다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { handle } from "@lophn/cap-tool";

// 선언의 operation 또는 command와 같은 이름으로 등록한다.
handle("usage.sync", async (input) => {
  return await sync(input);
});
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
