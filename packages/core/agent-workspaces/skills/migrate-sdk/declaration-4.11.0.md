# @lophn/declaration 4.11.0

Previous: 4.10.0
Breaking: no. Move together with `@lophn/app-ui` 2.22.0 and, if the app has phone screens, `@lophn/app-ui-native` 1.9.0.

A subscription can name another computer: `subscriptions: [{ source, event, machine }]`. `machine` is the computer's name as the person sees it in Settings (1-64 characters, no surrounding spaces; you do not know the computer ids), and `source` is the slug the app has on that computer. The app process receives that computer's event in the same handler as before, `subscribe(source, event, handler)`, with the event's payload. The event's caller in the app's invocation record carries `machine`, the id of the computer it came from.

```ts
// lophn.ts
subscriptions: [{ source: "masup", event: "usage.limit", machine: "Work laptop" }],
// app process (@lophn/cap-tool)
subscribe("masup", "usage.limit", async (payload) => { /* react to the laptop's event */ });
```

What the other computer hands over: only events the app there declared in `events`, never from an app whose workspace the person made private on that computer. An app whose own workspace is private on this computer neither subscribes to other computers nor receives their events. A name that does not resolve (no such computer, or two computers with that name) or that names this computer gives a subscription that never fires; a name check is not part of validation, the computers change. The name is looked up again whenever the apps, the jobs or the computer list change: if the person renames that computer or another computer takes the name, the subscription stops (lophn logs it; nothing is shown to the person), and if the name moves to a different computer the subscription follows that computer. The sealed release cannot be re-pointed. A connection carries only events that happen while both computers run and are connected; nothing is stored, so an event while the other computer is off or unreachable is lost (an event the app marked `across_machines` also reaches a computer that runs the same app later, as before).

A handler that runs because of another computer's event, like one that serves a call from another computer, cannot call an app on a third computer (`forbidden`), and an event it publishes, or one published while serving such a call, stays on this computer: it reaches this computer's subscribers but is not given to other computers. This keeps two computers from calling each other's apps in a loop.

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

The SDK guide describes the subscription field `machine`. There is nothing to change in the app's `AGENTS.md`; when you add a subscription to another computer's app, follow the lines below: the name is the computer's name, `source` is the app's slug there, the event can be lost while that computer is off, a rename of the computer stops the subscription, and the handler cannot call a third computer.

```diff
# @lophn/declaration guide.md
@@ -102,3 +102,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     않고, 다른 기계에서 온 event도 그 기계에서 나지 않는다. 다른 기계에서 온 data의 변경은 이 칸 없이 `data.changed`로 안다.
-- `subscriptions` — 이 앱이 듣는 event 목록이다. 항목은 `{source, event}`다. `source`는 event를 낸 앱의 slug이거나
+- `subscriptions` — 이 앱이 듣는 event 목록이다. 항목은 `{source, event, machine?}`다. `source`는 event를 낸 앱의 slug이거나
   lophn이 내는 event의 `"lophn"`이다(lophn이 내는 event는 session lifecycle의 `session.started|running|waiting|idle|ended`(`@lophn/agent` guide)와
@@ -108,2 +108,10 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   `subscribe(source, event, handler)`로 그 handler를 등록한다. handler 등록은 필수가 아니다: 등록하지 않은 앱(화면만 구독하는 앱)의 process에는 그 event가 가지 않는다. 선언하지 않은 구독의 handler를 등록하면 앱이 시작하지 못한다.
+  - `machine`은 다른 컴퓨터의 앱 event를 받겠다는 뜻이고 값은 그 컴퓨터의 이름이다(1~64자, 앞뒤 공백 없음. 앱 code는 사람의 컴퓨터 id를
+    모르므로 이름이다). 이때 `source`는 그 컴퓨터에서의 앱 slug다. 그 컴퓨터가 앱이 선언해 낸 event만 내주고(그 앱 workspace가 private이면 안 준다),
+    이 앱 workspace가 private이면 이 앱은 다른 컴퓨터에 구독을 걸지 않고 그 event도 받지 않는다. 이름이 풀리지 않거나(없는 컴퓨터, 같은 이름이 둘) 이 컴퓨터를 가리키면 그 구독은
+    받지 못한다. 연결은 그 순간의 event만 나르고 저장하지 않는다: 그 컴퓨터를 끈 사이나 닿지 않는 사이에 난 event는 받지 못한다(`across_machines` event가
+    아닌 한 늦게 오지 않는다). `machine`이 없는 구독은 이 컴퓨터의 앱 event를 받고, 같은 앱이 이 컴퓨터에도 있을 때 그 앱의 `across_machines` event도 받는다.
+    이름은 앱·job·명단이 바뀔 때마다 다시 푼다: 그 컴퓨터의 이름이 바뀌거나 다른 컴퓨터가 그 이름을 가지면 구독이 멈추고(log만 남는다) 이름이 다른 컴퓨터로 옮겨 가면 그 컴퓨터를 따라간다.
+    같은 `source`와 `event`는 컴퓨터 하나만 고른다(handler 이름이 하나다). 다른 컴퓨터의 event가 부른 handler는 받은 call처럼 세 번째 컴퓨터의 앱을 부르지 못하고(`forbidden`), 그 handler가 낸 event는 이 컴퓨터에 머문다. `source`가 `"lophn"`이면 `machine`을 쓰지 못한다.
+    다른 컴퓨터의 event는 앱 process의 handler로만 온다(앱 화면의 `useEvent`는 받지 않는다).
   - 전달은 구독 앱의 handler 호출(invocation) 하나다. 앱 호출 기록(`lophn app invocations`)에 어느 앱의 어느 event가
```
