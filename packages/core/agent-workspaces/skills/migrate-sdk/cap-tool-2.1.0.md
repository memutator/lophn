# @lophn/cap-tool 2.1.0

Previous: 2.0.0
Breaking: no. Move together with `@lophn/declaration` 4.5.0.

Adds `publish(name, payload)` and `subscribe(source, event, handler)` for app events (declared in `events` and `subscriptions` of `lophn.ts`, see the `@lophn/declaration` 4.5.0 note).

- `publish` sends an event declared in `events`. It returns `{ ok: true, value: { publication, reachable, unreachable, refused } }` or `{ ok: false, error }`. An undeclared event or a payload that does not match `payloadSchema` is `invalid_input`. It does not wait for subscribers and does not need a running invocation (start code and timers can publish). In preview and test it does not reach core and returns `standIn: true`.
- `subscribe` registers the handler of a declared subscription. `source` is the publisher's slug. The handler is called once per event with the payload. It is recorded as a write invocation of your app (its DB changes can be rewound). Internally it is `handle("on.<source>.<event>", ...)`.

```ts
// before: no way to tell other apps something happened
// after (publisher)
import { publish } from "@lophn/cap-tool";
await publish("usage.limit", { provider: "claude", percent: 91 });

// after (subscriber)
import { subscribe } from "@lophn/cap-tool";
subscribe("masup", "usage.limit", async (event: { percent: number }) => {
  if (event.percent < 90) return;
  // react
});
```

```json
// package.json, before
"@lophn/cap-tool": "file:.lophn/sdk/cap-tool/2.0.0",
// after
"@lophn/cap-tool": "file:.lophn/sdk/cap-tool/2.1.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- Events are after-the-fact notifications. Delivery is once and not stored, and a subscriber that is not running does not get it. A publisher must also expose a read command for the current value; a subscriber reads it once when it starts and then follows events.

```diff
# @lophn/cap-tool guide.md
@@ -5,3 +5,3 @@
 operation·command handler 등록, 실제 invocation 문맥, 읽기 결과 모양, 다른 앱의
-command 호출을 제공한다. 모든 호출은 core를 거치고, 앱 process는 core가 보낸
+command 호출, 앱 event의 발행과 구독을 제공한다. 모든 호출은 core를 거치고, 앱 process는 core가 보낸
 호출을 handler로 돌려준다.
@@ -15,3 +15,10 @@ operation(화면과 앱 자신이 쓰는 동작)과 command(agent·다른 앱·j
 ```ts
-import { currentContext, handle, runWith, traceName } from "@lophn/cap-tool";
+import {
+  currentContext,
+  handle,
+  publish,
+  runWith,
+  subscribe,
+  traceName,
+} from "@lophn/cap-tool";
 ```
@@ -42,5 +49,38 @@ import { currentContext, handle, runWith, traceName } from "@lophn/cap-tool";
   실패하면 `ok: false`다.
+- `publish(name, payload)` — 선언의 `events`에 있는 event를 낸다(아래 "앱 event"). `{ok, value: {publication,
+  reachable, unreachable, refused}}`나 `{ok: false, error}`를 돌려준다. 선언하지 않은 event나 `payloadSchema`와 맞지 않는
+  payload는 `invalid_input`이다. 구독자의 답을 기다리지 않는다. 부모 invocation이 돌고 있지 않아도 된다(시작 코드,
+  timer). preview·test에서는 core에 가지 않고 `standIn: true`를 돌려준다.
+- `subscribe(source, event, handler)` — 선언의 `subscriptions`에 있는 구독의 handler를 등록한다. `source`는 event를 낸 앱의
+  slug이거나 lophn이 내는 event의 `"lophn"`이다. `handler(payload)`가 event 하나마다 한 번 불리고 반환값은 쓰이지 않는다.
+  선언하지 않은 구독의 handler를 등록하면 앱이 시작하지 못한다. 선언만 하고 등록하지 않으면(화면만 구독하는 앱) process에는 그 event가 가지 않고 화면(`useEvent`)만 받는다. 내부적으로 이름 `on.<source>.<event>`의 `handle`이다.
 - type: `InvocationContext`, `AppCaller`, `HandlerPort`, `RegisteredHandler`,
   `ReadQuery`, `ReadSource`, `ReadCoverage`, `ReadFreshness`, `ReadContinuation`,
-  `RejectionCode`, `CommandClient`, `CallOutcome`, `CallOutput`, `AppResult`
+  `RejectionCode`, `CommandClient`, `CallOutcome`, `CallOutput`, `AppResult`, `PublishOutput`
+
+## 앱 event
+
+앱 하나가 사실을 내고 여러 앱이 듣는 일대다에 쓴다. 예: 구독 사용량 앱이 한도 90%를 감지해 `usage.limit`을 내면 다른 앱이
+듣고 반응한다.
+
+```ts
+// 발행 앱: lophn.ts의 events에 {name: "usage.limit", description, payloadSchema}를 선언한다.
+await publish("usage.limit", { provider: "claude", percent: 91 });
+
+// 구독 앱: lophn.ts의 subscriptions에 {source: "masup", event: "usage.limit"}를 선언한다. source는 발행 앱의 slug다.
+subscribe("masup", "usage.limit", async (event: { percent: number }) => {
+  if (event.percent < 90) return;
+  // ... 반응
+});
+```
+
+- event는 일이 일어난 **뒤의 알림**이다. 시작 전에 막거나 답을 받는 hook이 아니다. core는 구독자의 답을 기다리지 않는다.
+- 전달은 **한 번이고 저장하지 않는다**. 재시도도 구독자별 cursor도 없다. 그 순간 켜져 있지 않은 구독 앱은 그 event를 받지 못한다.
+  놓쳐도 되게 짠다: **발행 앱은 지금 값을 읽는 read command를 따로 내놓고**, 구독 앱은 켜질 때 그 command를 한 번 읽은 뒤
+  event로 고친다(event만으로 상태를 만들지 않는다). payload는 알림에 필요한 작은 값만 담는다(16 KiB까지).
+- 구독 handler 호출은 앱 호출 하나로 기록된다(`lophn app invocations`에 어느 앱의 어느 event가 불렀는지 보인다). write로
+  기록되어 앱 DB 변경이 rewind 대상이다. 구독에 사람 허락은 없다. 발행 앱은 낸 기록(누가 어느 event를 몇 구독자에게 냈나.
+  payload는 없다)을 `lophn app event-publications`로 읽는다.
+- 자기가 받은 event 때문에 도는 handler 안에서 다시 event를 내 고리가 생기면(A → B → A) core가 끊는다. event가 부른 앱들의
+  chain을 싣고 가므로 chain에 이미 있는 앱에는 넘기지 않고(깊이 한도 8도 같다) 그 수를 발행 기록의 `refused`에 센다.
 
@@ -54,3 +94,3 @@ read handler는 DB를 바꾸지 않는다고 선언을 믿는다.
 
-handler 등록과 문맥 전달은 요구 permission이 없다. `connectCommands`는 import만으로
+handler 등록과 문맥 전달, event 발행·구독은 요구 permission이 없다(event는 발행 앱이 선언해 내놓는 것이다). `connectCommands`는 import만으로
 아무것도 열지 않는다. 선언의 `app_connections`에 대상 앱과 command와 목적을
```
