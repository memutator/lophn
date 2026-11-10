# @lophn/declaration 4.5.0

Previous: 4.4.0
Breaking: no. Move together with `@lophn/cap-tool` 2.1.0 and `@lophn/app-ui` 2.14.0.

A declaration can now list the events the app publishes (`events`) and the events it listens to (`subscriptions`). Both are optional. A declaration without them is unchanged, including its hash.

An event is a notification that something already happened. It is delivered once to the subscribers that are running at that moment and is never stored or retried. So the publishing app must also expose a read command for the current value, and a subscriber reads it once when it starts.

- `events`: `{name, description, payloadSchema}`. `name` is 1-64 characters of letters, digits, `_ - .` and unique. `payloadSchema` has the same rules as a command `inputSchema` with an `object` root. Core refuses a publish of an event the active release did not declare, or with a payload that does not match the schema (`invalid_input`).
- `subscriptions`: `{source, event}`. `source` is the publisher app's slug (or `"lophn"` for events lophn itself publishes). No person approval is needed. The handler name is `on.<source>.<event>`. It lives in the same handler namespace as operations and commands, so it must be at most 64 characters and must not equal an operation or command name. Register the handler with `subscribe` from `@lophn/cap-tool` 2.1.0. Registering the handler is optional: an app that declares a subscription but does not register a handler (a screen-only subscriber) simply gets no call in its process; its screens still receive the event. Registering a handler for a subscription that is not declared stops the app from starting.

```ts
// before
export default defineApp({
  name: "masup",
  // ...
});

// after: the publisher (slug "masup")
export default defineApp({
  name: "masup",
  // ...
  events: [
    {
      name: "usage.limit",
      description: "A subscription usage limit was reached.",
      payloadSchema: {
        type: "object",
        properties: {
          provider: { type: "string", description: "Provider name." },
          percent: { type: "integer", description: "Percent of the limit used." },
        },
        required: ["provider", "percent"],
        additionalProperties: false,
      },
    },
  ],
});

// after: a subscriber
export default defineApp({
  name: "guard",
  // ...
  subscriptions: [{ source: "masup", event: "usage.limit" }],
});
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.4.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`), and `@lophn/cap-tool` to `2.1.0` and `@lophn/app-ui` to `2.14.0` in both places. Nothing else is required of an existing app. `"lophn"` is now a reserved app slug (it names the publisher of events lophn itself publishes); an app slug is never changed by this.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, add the lophn-managed event bullet shown below, and change the guide path example to `4.5.0`. If the app edited that part, keep the app's own additions.
- If the app adds a subscription, update `tests/declaration_test.ts` as shown below: the handler registered by `subscribe` is named `on.<source>.<event>` and the old test would report it as a handler that is not declared. The new test also stops requiring a handler for each declared subscription.
- When one app has a fact that several other apps react to (a usage limit, a state change), publish it as an event and give the publisher a read command for the current value. Do not make the subscribers poll, and do not build state from events alone: delivery is once, not stored, and only reaches running subscribers.

```diff
# @lophn/declaration guide.md
@@ -20,3 +20,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   `CommandDeclaration`, `Place`, `ToolEffect`, `AppCommandUseDeclaration`, `PermissionRequirement`, `OAuthDeclaration`,
-  `SkillDeclaration`, `AppKeyDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
+  `SkillDeclaration`, `AppKeyDeclaration`, `EventDeclaration`, `SubscriptionDeclaration`, `SDKDependency`, `TraySide`, `TraySize`, `ValidationResult`, `ValidationError`
 
@@ -25,3 +25,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
 `name`, `description`, `screens`, `operations`, `commands`, `permissions`,
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`만 있다. 알 수 없는 칸은 거절한다.
 
@@ -86,2 +86,15 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     `main`이 먼저 받는 key(탭 닫기 Ctrl+W 등)는 앱에 닿기 전에 shell이 가져가므로 앱 key로 주지 않는다.
+- `events` — 이 앱이 내는 event 목록이다. 항목은 `{name, description, payloadSchema}`다. `name`은 1~64자
+  (영문·숫자·`_ - .`)이고 겹치지 못한다. `payloadSchema`는 payload의 schema이고 root type은 object이며 command
+  `inputSchema`와 같은 규칙(설명을 단다)이다. 앱 process가 `@lophn/cap-tool`의 `publish(name, payload)`로 내고, 선언하지 않았거나
+  payload가 schema와 맞지 않으면 core가 `invalid_input`으로 거절한다.
+  - event는 일이 일어난 **뒤의 알림**이다. 한 번 전달되고 저장되지 않는다. 그 순간 켜져 있는 구독 앱만 받는다.
+    그래서 event만으로 상태를 만들지 말고, 발행 앱은 지금 값을 읽는 read command를 따로 내놓는다. 구독 앱은 켜질 때 그 command를
+    한 번 읽는다.
+- `subscriptions` — 이 앱이 듣는 event 목록이다. 항목은 `{source, event}`다. `source`는 event를 낸 앱의 slug이거나
+  lophn이 내는 event의 `"lophn"`이다(lophn이 내는 event는 session lifecycle의 `session.started|running|waiting|idle|ended`다. `@lophn/agent` guide). 사람 허락은 없다. 받는 handler 이름은 `on.<source>.<event>`로 정해지고
+  operation·command와 같은 handler 이름 공간을 쓴다(64자 안, 겹치면 선언 오류). 앱 process가 `@lophn/cap-tool`의
+  `subscribe(source, event, handler)`로 그 handler를 등록한다. handler 등록은 필수가 아니다: 등록하지 않은 앱(화면만 구독하는 앱)의 process에는 그 event가 가지 않는다. 선언하지 않은 구독의 handler를 등록하면 앱이 시작하지 못한다.
+  - 전달은 구독 앱의 handler 호출(invocation) 하나다. 앱 호출 기록(`lophn app invocations`)에 어느 앱의 어느 event가
+    불렀는지 보인다. handler는 write로 기록되고 changeset을 떠서 rewind 대상이다.
 - `operations` — 앱 안의 operation 목록이다. 화면(`lophnApp.callOperation`)과 앱
# app template AGENTS.md
@@ -33,2 +33,6 @@ Package를 쓴다.
   단축키는 `lophn.ts`의 `keys`에 선언하고 같은 `id`로 `useCommand`를 건다. 화면이 맞추지 않은 단축키는 shell이 돈다.
+- 한 앱의 사실을 여러 앱이 듣는 일대다는 event다. 발행 앱은 `lophn.ts`의 `events`에 선언하고 `@lophn/cap-tool`의
+  `publish`로 내며, 구독 앱은 `subscriptions`에 선언하고 `subscribe`(화면은 `@lophn/app-ui`의 `useEvent`)로 받는다.
+  event는 일이 일어난 뒤의 알림이고 한 번만 전달되며 저장되지 않는다. 그래서 발행 앱은 지금 값을 읽는 read
+  command를 따로 내놓고, 구독 앱은 켜질 때 그것을 한 번 읽는다.
 - project별로 나뉘는 data(작업, 일정)는 앱 안에 project를 따로 만들지 않고 lophn project `id`를 key로 붙인다.
# app template lophn.ts
@@ -7,3 +7,3 @@ export default defineApp({
   description: "A lophn app.",
-  // 화면, operation, command, key(단축키)는 필요할 때 더한다. 화면은 src/screens/<key>/, handler는 src/handlers.ts에 둔다.
+  // 화면, operation, command, key(단축키), event·subscription(앱 사이의 알림)은 필요할 때 더한다. 화면은 src/screens/<key>/, handler는 src/handlers.ts에 둔다.
   // operation은 화면과 앱 자신이 쓰는 동작이다(agent는 못 본다). command는 agent와 다른 앱이 부르는 의미 단위다.
# app template tests/declaration_test.ts
@@ -19,9 +19,23 @@ test("declaration: the declaration is valid and already canonical", () => {
 
-test("declaration: every declared operation and command has a registered handler and nothing else is registered", () => {
+test("declaration: every declared operation and command has a registered handler and only declared subscriptions are registered besides", () => {
   registerHandlers();
+  const registered = [...registeredHandlers()];
+  const required = [
+    ...declaration.operations.map((entry) => entry.name),
+    ...declaration.commands.map((entry) => entry.name),
+  ];
+  // 구독 handler의 이름은 `on.<source>.<event>`다(`subscribe`가 등록한다). 등록은 필수가 아니다(화면만 구독하는 앱).
+  const allowed = new Set([
+    ...required,
+    ...(declaration.subscriptions ?? []).map(
+      (entry) => `on.${entry.source}.${entry.event}`,
+    ),
+  ]);
   assert.deepStrictEqual(
-    [...registeredHandlers()].sort(),
-    [...declaration.operations, ...declaration.commands]
-      .map((entry) => entry.name)
-      .sort(),
+    required.filter((name) => !registered.includes(name)),
+    [],
+  );
+  assert.deepStrictEqual(
+    registered.filter((name) => !allowed.has(name)),
+    [],
   );
```
