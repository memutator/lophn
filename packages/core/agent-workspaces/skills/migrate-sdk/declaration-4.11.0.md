# @lophn/declaration 4.11.0

Previous: 4.10.0
Breaking: no. Move together with `@lophn/app-ui` 2.22.0 and, if the app has phone screens, `@lophn/app-ui-native` 1.9.0.

A subscription can name another computer: `subscriptions: [{ source, event, machine }]`. `machine` is the computer's name as the person sees it in Settings (1-64 characters, no surrounding spaces; you do not know the computer ids), and `source` is the slug the app has on that computer. The app process receives that computer's event in the same handler as before, `subscribe(source, event, handler)`, with the event's payload. The handler cannot tell which computer sent it (the subscription names one computer).

```ts
// lophn.ts
subscriptions: [{ source: "masup", event: "usage.limit", machine: "Work laptop" }],
// app process (@lophn/cap-tool)
subscribe("masup", "usage.limit", async (payload) => { /* react to the laptop's event */ });
```

What the other computer hands over: only events the app there declared in `events`, never from an app whose workspace the person made private on that computer. An app whose own workspace is private on this computer does not subscribe to other computers. A name that does not resolve (no such computer, or two computers with that name) or that names this computer gives a subscription that never fires; a name check is not part of validation, the computers change. A connection carries only events that happen while both computers run and are connected; nothing is stored, so an event while the other computer is off or unreachable is lost (an event the app marked `across_machines` also reaches a computer that runs the same app later, as before).

Two new checks, `invalid_input`: `machine` must be 1-64 characters without surrounding spaces, and `machine` is not allowed when `source` is `"lophn"` (those events are about this computer). One `source` and `event` can name only one computer, because the handler name `on.<source>.<event>` stays the same.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.10.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.21.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.11.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.22.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`); if the app has phone screens, also move `@lophn/app-ui-native` to 1.9.0. Nothing is required of an existing app: existing declarations validate as before and keep their hash. Add `machine` only when the app must react to another computer's app, and subscribe from the app process: a screen's `useEvent` does not receive other computers' events.

## Instruction diff

The SDK guide describes the subscription field `machine`. There is nothing to change in the app's `AGENTS.md`; when you add a subscription to another computer's app, follow the lines below: the name is the computer's name, `source` is the app's slug there, and the event can be lost while that computer is off.

```diff
# @lophn/declaration guide.md
@@ -103 +103 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-- `subscriptions` — 이 앱이 듣는 event 목록이다. 항목은 `{source, event}`다.
+- `subscriptions` — 이 앱이 듣는 event 목록이다. 항목은 `{source, event, machine?}`다.
@@ -109,0 +109,8 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
+  - `machine`은 다른 컴퓨터의 앱 event를 받겠다는 뜻이고 값은 그 컴퓨터의 이름이다(1~64자, 앞뒤 공백 없음).
+    이때 `source`는 그 컴퓨터에서의 앱 slug다. 그 컴퓨터가 앱이 선언해 낸 event만 내주고(그 앱 workspace가 private이면 안 준다),
+    이 앱 workspace가 private이면 이 앱은 다른 컴퓨터에 구독을 걸지 않는다. 이름이 풀리지 않거나 이 컴퓨터를 가리키면 그 구독은
+    받지 못한다. 연결은 그 순간의 event만 나르고 저장하지 않는다: 그 컴퓨터를 끈 사이나 닿지 않는 사이에 난 event는 받지 못한다.
+    같은 `source`와 `event`는 컴퓨터 하나만 고른다. `source`가 `"lophn"`이면 `machine`을 쓰지 못한다.
+    다른 컴퓨터의 event는 앱 process의 handler로만 온다(앱 화면의 `useEvent`는 받지 않는다).
```
