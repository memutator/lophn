# @lophn/cap-notify 1.3.0

Previous: 1.2.0
Breaking: no

Adds `setWidget(key, value)` and `clearWidget(key)`: an app publishes the value of a widget it declared in `lophn.ts` `widgets`, and the person's phone draws it on the home screen. Same `notify.send` permission. The value is `{ v: 1, tone?, rows }` with 1 to 6 nodes (`text`, `stat`, `progress`, `list`), at most 4 KiB. The core keeps only the last value per widget in memory, so publish it again from your start code. A key you did not declare is rejected with `invalid_input`. Nothing is required of an existing app.

Optional: when the app has something worth glancing at on a phone, declare a widget and publish it.

```ts
// before: nothing
// after (lophn.ts declares widgets: [{ key: "weather", label: "Weather" }])
await setWidget("weather", {
  v: 1,
  rows: [{ kind: "stat", value: "21°", label: "Seoul" }],
});
```

## Instruction diff

Change nothing in the app's `AGENTS.md`. If you adopt widgets, follow these rules: declare `widgets` in `lophn.ts`, put the most important row first, publish again from the start code and when the value changes, and never put a seconds-level value in a widget (the phone fetches best effort and shows when it did). The SDK guide and the `design-app` skill changed like this:

```diff
diff --git a/packages/sdk/cap-notify/guide.md b/packages/sdk/cap-notify/guide.md
--- a/packages/sdk/cap-notify/guide.md
+++ b/packages/sdk/cap-notify/guide.md
@@ -12,3 +12,9 @@ operation·flow·시작 코드에서 부른다. import는 grant를 주지 않는
 ```ts
-import { clearTray, notify, setTray } from "@lophn/cap-notify";
+import {
+  clearTray,
+  clearWidget,
+  notify,
+  setTray,
+  setWidget,
+} from "@lophn/cap-notify";
 ```
@@ -35,6 +41,22 @@ import { clearTray, notify, setTray } from "@lophn/cap-notify";
   - 앱 process가 시작 코드나 timer에서 부른다. 사용량 앱이 몇 분마다 값을 바꾸는 식이다(아래 예제).
+- `setWidget(key, value)`, `clearWidget(key)` — 사람 폰의 홈 화면 위젯에 보이는 값을 바꾸거나 지운다.
+  - `key`는 선언의 `widgets`에 적은 key여야 한다(소문자로 시작하는 `a-z0-9_` 32자까지). 선언하지 않은 key는 `invalid_input`이다.
+  - `value`는 `{ v: 1, tone?, rows }`다. `rows`는 1~6개이고 node는 넷뿐이다. 앱은 모양을 정하지 못한다. 머리(앱 이름,
+    위젯 label)와 꼬리(가져온 시각)는 폰이 그린다.
+    - `{ kind: "text", text, style: "title" | "body" | "caption", tone? }` — `text` 1~48자.
+    - `{ kind: "stat", value, label, tone? }` — 큰 값 `value` 1~12자와 설명 `label` 1~24자.
+    - `{ kind: "progress", value, label?, tone? }` — `value`는 0~1, `label` 1~24자.
+    - `{ kind: "list", items }` — `items`는 1~5개이고 각 `{ text, trail?, tone? }`다. `text` 1~32자, `trail` 1~12자.
+    - `tone`은 `"neutral"`, `"good"`, `"warn"`, `"bad"`다. JSON으로 4 KiB(4096 bytes)를 넘는 값은 `invalid_input`이다.
+    - 작은 위젯(2x2)은 앞의 몇 줄만 보인다. 가장 중요한 줄을 맨 앞에 두고 그 줄만으로 뜻이 되게 한다.
+  - 값은 (앱, key)마다 하나이고 마지막 값만 남는다. core 메모리에만 있어 lophn을 다시 켜면 사라지므로 앱이 시작 코드에서
+    다시 낸다. 앱을 보관하거나 선언에서 key를 빼면 그 값은 보이지 않는다.
+  - 사람이 폰 홈 화면에 그 위젯을 놓았을 때만 보인다. 누르면 선언한 `screen`의 폰 화면이 열리고, `screen`이 없으면 앱이 열린다.
+  - 폰은 늘 새로 하지 못한다(best effort). 폰이 값을 가져오는 때는 lophn 폰 앱을 열 때, 폰이 연결된 동안 값이 바뀔 때, 그리고
+    대략 30분마다다. 위젯에 가져온 시각이 보이고 컴퓨터에 닿지 않으면 "Offline"이 보인다. 그러니 시계·카운트다운 같은 초 단위 값을
+    위젯에 두지 않고, 값에 "방금"이나 "N분 전" 같은 말을 넣지 말고 사실만 낸다. 몇 분 동안 참인 값을 낸다. 앱 UI view에서는 부르지 못한다.
 - `createNotifyClient({ host? })` — 시험이나 preview에서 host를 바꿔 끼운다. live가 아닌
-  mode에서는 사람에게 닿지 않고 `notify`는 `{ notified: true, standIn: true }`만 돌려주며 `setTray`와
-  `clearTray`는 아무것도 하지 않는다.
-- 거절은 `CapabilityError`다(`setTray`와 `clearTray`도 같다). grant가 없으면 `forbidden`이고 `permission`은
+  mode에서는 사람에게 닿지 않고 `notify`는 `{ notified: true, standIn: true }`만 돌려주며 `setTray`,
+  `clearTray`, `setWidget`, `clearWidget`은 아무것도 하지 않는다.
+- 거절은 `CapabilityError`다(`setTray`·`clearTray`·`setWidget`·`clearWidget`도 같다). grant가 없으면 `forbidden`이고 `permission`은
   `notify.send`다. 입력이 한도를 넘으면 `invalid_input`이다.
@@ -42,3 +64,3 @@ import { clearTray, notify, setTray } from "@lophn/cap-notify";
   검사한다.
-- type: `NotifyClient`, `NotifyRequest`, `NotifyResult`, `TrayRequest`, `TrayTone`, `CapabilityError`,
+- type: `NotifyClient`, `NotifyRequest`, `NotifyResult`, `TrayRequest`, `TrayTone`, `WidgetValue`, `WidgetNode`, `WidgetTone`, `CapabilityError`,
   `DeclarationCheck`
@@ -81,2 +103,20 @@ setInterval(() => void refresh().catch(() => {}), 5 * 60_000);
 
+```ts
+import { setWidget } from "@lophn/cap-notify";
+
+// 선언: widgets에 { key: "weather", label: "Weather", screen: "detail" }. 시작 코드에서 내고 주기로 갱신한다.
+async function refresh() {
+  const { temp, rain } = await readForecast();
+  await setWidget("weather", {
+    v: 1,
+    rows: [
+      { kind: "stat", value: `${temp}°`, label: "Seoul" },
+      { kind: "progress", value: rain, label: "Rain", tone: rain > 0.6 ? "warn" : "neutral" },
+    ],
+  });
+}
+await refresh();
+setInterval(() => void refresh().catch(() => {}), 15 * 60_000);
+```
+
 ## version 정책
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -299,2 +299,8 @@ tell the person.
 
+## Widgets and phone location
+
+When the app should show a value on the person's phone home screen (`widgets`)
+or read their location from the phone (`phone.use`), read the bundled file with
+`skill.read({ name: "design-app", path: "phone-features.md" })` first.
+
 ## Talking to an agent from a screen
--- /dev/null
+++ b/packages/core/agent-workspaces/skills/design-app/phone-features.md
@@ -0,0 +1,39 @@
+# Widgets
+
+A widget is one value or one short list on the person's phone home screen, seen
+without opening the phone app: the weather now, the time left of a limit, the
+next three events. Add one only when a glance is worth it. It does not replace a
+screen: it cannot take input, show an image or draw a chart.
+
+1. Declare it in `lophn.ts`, at most 4 per app:
+   `widgets: [{ key: "weather", label: "Weather", screen: "home" }]`. `key` is
+   lowercase letters, digits and `_`, starting with a letter. `label` is the
+   widget's title on the phone. `screen` is optional: the key of a screen of
+   this app whose `places` is `["phone"]`; a tap on the widget opens it (with no
+   `screen`, a tap opens the app). Declare `notify.send` too and read the
+   `@lophn/cap-notify` guide.
+2. Publish the value from the app's code (a handler or start code, never a
+   screen): `setWidget("weather", { v: 1, rows })` from `@lophn/cap-notify`.
+   `rows` are 1 to 6 nodes of four kinds: `stat` (a big value and a label),
+   `progress` (0 to 1), `text` and `list` (up to 5 items). You cannot choose
+   the layout, and the whole value is at most 4 KiB. The phone draws the title
+   and the time the value was fetched.
+3. Put the most important row first: the small widget (2x2) shows only the first
+   few rows. Make the first row enough on its own.
+4. Publish again in the start code and whenever the value changes. lophn keeps
+   the value in memory only, so after a restart the widget has nothing until the
+   app publishes. `clearWidget(key)` removes it.
+5. Do not make the widget up to date by the second. The phone fetches best
+   effort: when the person opens the lophn app, when a value changes while the
+   phone is connected, and about every 30 minutes. The widget shows the time it
+   was fetched and "Offline" when the computer cannot be reached. So never put
+   a clock, a countdown or a seconds-level value in a widget, and do not write
+   "just now" or "N minutes ago"; publish the fact and let the phone show the
+   age. Publish a value that stays true for minutes.
+6. The person places the widget on their phone home screen and picks it from
+   the app's widgets there. Tell them it exists; the app cannot place it.
+7. Write the widget under Screens in DESIGN.md: its key, rows, when it is
+   published, and the screen a tap opens.
+
+In the preview and tests `setWidget` does nothing, so you cannot see the widget
+there. Say so when you report: the person makes the last check on their phone.
```
