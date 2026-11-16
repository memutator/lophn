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

The SDK guide now documents the `runs_on` field. Add nothing to your app's `AGENTS.md` unless the app should run on the phone. Do not write `"phone"` in `runs_on` just because the app has a phone screen.

```diff
# @lophn/declaration guide.md
@@ -26 +26 @@
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`, `runs_on`만 있다. 알 수 없는 칸은 거절한다.
@@ -105,0 +106,6 @@
+- `runs_on` — 앱의 backend와 data가 어디서 도는가. 셋 중 하나다: `["computer"]`(remote. 컴퓨터에서만 돈다),
+  `["computer","phone"]`(sync. 컴퓨터가 정본이고 폰에도 data 복사본과 backend가 있다), `["phone"]`(standalone.
+  폰에서만 돈다). 칸이 없으면 `["computer"]`와 같고 칸이 없는 옛 선언의 hash는 그대로다. 다른 값과 다른 순서는
+  거절한다. 폰 화면이 있다고 폰에서 도는 앱이 되지 않으니 폰에서 돌릴 앱만 이 칸에 `"phone"`을 쓴다. 검사 둘:
+  `phone`이 있는데 `places`가 `["phone"]`인 화면이 없으면 거절하고, `["phone"]`인데 `commands`, `subscriptions`,
+  effect가 `external`인 operation, `widgets`, 폰 밖 자리의 화면 가운데 하나가 있으면 거절한다(돌릴 컴퓨터가 없다).
```
