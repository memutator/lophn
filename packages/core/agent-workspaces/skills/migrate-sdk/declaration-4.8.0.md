# @lophn/declaration 4.8.0

Previous: 4.7.0
Breaking: no. Move together with `@lophn/app-ui` 2.17.0 and `@lophn/app-ui-native` 1.2.0.

A declaration can now say where the app's backend and data run (`runs_on`). It is optional. A declaration without it is unchanged, including its hash, and means `["computer"]`. The new type is `RunsOn`.

- `["computer"]`: remote. The app runs on the computer only. This is the default.
- `["computer","phone"]`: sync. The computer is the source of truth and the phone also has a copy of the data and a backend.
- `["phone"]`: standalone. The app runs on the phone only.

Any other value, an empty list, a repeated entry or another order is `invalid_input`. Having a phone screen does not make an app run on the phone: only `runs_on` does. Two more checks, both `invalid_input`:

- `runs_on: phone needs a screen with the phone place`: `runs_on` has `"phone"` but no screen has `places` equal to `["phone"]`.
- `runs_on ["phone"]: commands, subscriptions, external operations, widgets and places other than phone have nothing to run them`: a standalone app has none of `commands`, `subscriptions`, operations with effect `external`, `widgets`, or a screen with a place other than `phone`.

```ts
// runs_on, in lophn.ts
runs_on: ["computer", "phone"],
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.7.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.16.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.8.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.17.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`); if the app has phone screens, also move `@lophn/app-ui-native` to 1.2.0. Nothing is required of an existing app: existing declarations validate as before and keep running on the computer only. Existing supported SDK versions remain supported. Add `runs_on` only when the app should also run on the phone, or only on the phone.

## Instruction diff

If the app runs only on the computer, add nothing: leave `runs_on` out.

If the app should run on the phone too (or only there), or when you build such an app later:

- Read the new bundled file of the `design-app` skill: `skill.read({ name: "design-app", path: "phone-apps.md" })`, section "Apps that run on the phone". Follow it when you design the data and the backend: text ids from `newId()`, no integer or autoincrement key, no trigger, no `UNIQUE` or `CHECK` outside the primary key, no table or column rename, no `node:` import, no `@lophn/cap-fs` or `@lophn/flow`, no write when the module loads, `store.transaction` instead of `BEGIN`/`COMMIT`, computer-only work (network, secrets, notices, agents) in `external` operations, and screens that handle `unavailable`.
- Set `runs_on` in `lophn.ts` only for such an app: `["computer", "phone"]` when it must work on the phone while the computer is off, `["phone"]` when its data may live only on the phone. Needs `@lophn/cap-store` 2.0.0 and `@lophn/cap-tool` 2.2.0 or later.
- In your app's `AGENTS.md`, bring the part that came from the template in line with the new lines below (the `runs_on` lines after the `phone` place lines; the comment in the `lophn.ts` template is optional).

```diff
# @lophn/declaration guide.md
@@ -26 +26 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`, `runs_on`만 있다. 알 수 없는 칸은 거절한다.
@@ -108,0 +109,9 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
+- `runs_on` — 앱의 backend와 data가 어디서 도는가. 셋 중 하나다: `["computer"]`(remote. 컴퓨터에서만 돈다),
+  `["computer","phone"]`(sync. 컴퓨터가 정본이고 폰에도 data 복사본과 backend가 있다), `["phone"]`(standalone.
+  폰에서만 돈다). 칸이 없으면 `["computer"]`와 같고 칸이 없는 옛 선언의 hash는 그대로다. 다른 값과 다른 순서는
+  거절한다. 폰 화면이 있다고 폰에서 도는 앱이 되지 않으니 폰에서 돌릴 앱만 이 칸에 `"phone"`을 쓴다. 검사 둘:
+  `phone`이 있는데 `places`가 `["phone"]`인 화면이 없으면 거절하고, `["phone"]`인데 `commands`, `subscriptions`,
+  effect가 `external`인 operation, `widgets`, 폰 밖 자리의 화면 가운데 하나가 있으면 거절한다(돌릴 컴퓨터가 없다).
+  폰에서 도는 backend는 text id(`newId()`)를 쓰고, `node:` import·trigger·정수 PK·PK 밖의 UNIQUE와 CHECK를 쓰지 못하며
+  (release 준비가 거절한다), 컴퓨터 전용 일(network, secret, 알림, event 발행, agent)은 `external` operation에 둔다.
+  `external`은 컴퓨터에 닿지 않으면 `unavailable`이다. 규칙 전부는 `design-app` skill의 bundled file `phone-apps.md`("Apps that run on the phone")다.
# design-app skill, SKILL.md
@@ -300,5 +300,4 @@ tell the person.
-## Widgets and phone location
-
-When the app should show a value on the person's phone home screen (`widgets`)
-or read their location from the phone (`phone.use`), read the bundled file with
-`skill.read({ name: "design-app", path: "phone-features.md" })` first.
+For home screen widgets (`widgets`) and phone location (`phone.use`), first read
+the bundled `phone-features.md`; when the app's backend and data also run on the
+phone (`runs_on`), first read `phone-apps.md`. Read each with
+`skill.read({ name: "design-app", path: "<file>" })`.
# AGENTS.md of a new app
@@ -69,0 +70,4 @@ Package를 쓴다.
+  `runs_on`은 앱의 backend와 data가 어디서 도는가다. 없으면 컴퓨터에서만 돌고(`["computer"]`),
+  폰에서도 돌릴 앱만 `["computer", "phone"]`, 폰에서만 돌 앱만 `["phone"]`을 쓴다(폰 화면이 있다는 이유로 쓰지 않는다).
+  폰에서 도는 앱은 `design-app` skill의 "Apps that run on the phone"(bundled file `phone-apps.md`, `skill.read`)를 먼저 읽고 따른다:
+  text id(`newId()`), `node:` import·trigger·정수 PK 금지, 컴퓨터 전용 일은 `external` operation.
# lophn.ts of a new app
@@ -18,0 +19 @@ export default defineApp({
+  // 폰에서도 돌릴 앱은 `runs_on: ["computer", "phone"]`, 폰에서만 돌 앱은 `["phone"]`을 더한다. 없으면 컴퓨터에서만 돈다. 규칙은 `design-app` skill의 "Apps that run on the phone"이다.
```
