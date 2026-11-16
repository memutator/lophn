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

Add the widget section to the app's `AGENTS.md` only if you adopt widgets. The SDK guide changed like this:

```diff
@@ -10,7 +10,13 @@ operation·flow·시작 코드에서 부른다. import는 grant를 주지 않는
 ## 공개 API와 type
 
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
 
 - `notify({ title, body?, key?, persistent? })` — `{ notified: true }`를 돌려준다.
@@ -33,14 +39,27 @@ import { clearTray, notify, setTray } from "@lophn/cap-notify";
     자리 화면을 켜 두었을 때만 보인다. 누르면 그 화면이 popup으로 뜬다. 앱 UI view에서는 부르지 못한다.
   - 값은 core 메모리에만 있어 lophn을 다시 켜면 사라진다. 앱이 시작 코드에서 다시 낸다.
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
+  - 값은 (앱, key)마다 하나이고 마지막 값만 남는다. core 메모리에만 있어 lophn을 다시 켜면 사라지므로 앱이 시작 코드에서
+    다시 낸다. 앱을 보관하거나 선언에서 key를 빼면 그 값은 보이지 않는다.
+  - 사람이 폰 홈 화면에 그 위젯을 놓았을 때만 보인다. 폰은 늘 새로 하지 못하므로 위젯에 가져온 시각이 같이 보인다.
+    그러니 값에 "방금" 같은 말을 넣지 말고 사실만 낸다. 앱 UI view에서는 부르지 못한다.
 - `createNotifyClient({ host? })` — 시험이나 preview에서 host를 바꿔 끼운다. live가 아닌
-  mode에서는 사람에게 닿지 않고 `notify`는 `{ notified: true, standIn: true }`만 돌려주며 `setTray`와
-  `clearTray`는 아무것도 하지 않는다.
-- 거절은 `CapabilityError`다(`setTray`와 `clearTray`도 같다). grant가 없으면 `forbidden`이고 `permission`은
+  mode에서는 사람에게 닿지 않고 `notify`는 `{ notified: true, standIn: true }`만 돌려주며 `setTray`,
+  `clearTray`, `setWidget`, `clearWidget`은 아무것도 하지 않는다.
+- 거절은 `CapabilityError`다(`setTray`·`clearTray`·`setWidget`·`clearWidget`도 같다). grant가 없으면 `forbidden`이고 `permission`은
   `notify.send`다. 입력이 한도를 넘으면 `invalid_input`이다.
 - `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `notify.send`를 빠뜨렸는지
   검사한다.
-- type: `NotifyClient`, `NotifyRequest`, `NotifyResult`, `TrayRequest`, `TrayTone`, `CapabilityError`,
+- type: `NotifyClient`, `NotifyRequest`, `NotifyResult`, `TrayRequest`, `TrayTone`, `WidgetValue`, `WidgetNode`, `WidgetTone`, `CapabilityError`,
   `DeclarationCheck`
 
 ## 요구 permission
@@ -79,6 +98,24 @@ await refresh();
 setInterval(() => void refresh().catch(() => {}), 5 * 60_000);
 ```
 
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
 
 판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).
```
