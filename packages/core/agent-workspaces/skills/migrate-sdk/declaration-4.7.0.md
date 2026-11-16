# @lophn/declaration 4.7.0

Previous: 4.6.0
Breaking: no. Move together with `@lophn/app-ui` 2.16.0 and `@lophn/app-ui-native` 1.1.0.

A declaration can now list the widgets the app shows on the lophn phone app (`widgets`) and can ask for the phone's capabilities (permission kind `phone.use`). Both are optional. A declaration without them is unchanged, including its hash. The new type is `WidgetDeclaration`, and `PermissionKind` gains `"phone.use"`.

- `widgets`: up to 4 entries `{key, label, screen?}`. `key` matches `^[a-z][a-z0-9_]{0,31}$` and is unique. `label` is one line of 1-40 characters. `screen`, if present, is the key of a screen of this declaration whose `places` is `["phone"]`. The declaration only names the list; the app process publishes the values (`setWidget` from `@lophn/cap-notify`), and core refuses a value for a `key` that is not declared.
- `phone.use`: scope is exactly `{capability}`, and `capability` is `"location.get"`. Declaring the same capability twice is an error. `@lophn/cap-phone` needs it.

A declaration that breaks these rules is `invalid_input`, for example `widget weather: screen must be the key of a screen whose places is ["phone"]` or `phone.use capability must be one of location.get`.

```ts
// widgets, in lophn.ts
widgets: [{ key: "weather", label: "Weather", screen: "home" }],

// phone.use, in lophn.ts permissions
{ kind: "phone.use", scope: { capability: "location.get" }, reason: "Find places near you." },
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.6.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.15.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.7.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.16.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`); if the app has phone screens, also move `@lophn/app-ui-native` to 1.1.0. Nothing is required of an existing app: existing declarations validate as before. Existing supported SDK versions remain supported. Add `widgets` or `phone.use` only when the app wants a phone widget or a phone capability.

## Instruction diff

Change nothing in the app's `AGENTS.md` unless the app wants a phone widget or a phone capability. Then read the `@lophn/cap-notify` guide and the `design-app` skill's Widgets, or `@lophn/cap-phone` and Phone location (see their notes). Do not point a widget `screen` at a screen that is not a `phone` screen. The SDK guide changed like this:

```diff
diff --git a/packages/sdk/declaration/guide.md b/packages/sdk/declaration/guide.md
--- a/packages/sdk/declaration/guide.md
+++ b/packages/sdk/declaration/guide.md
@@ -25,3 +25,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
 `name`, `description`, `screens`, `operations`, `commands`, `permissions`,
-`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`만 있다. 알 수 없는 칸은 거절한다.
+`app_connections`, `sdk_dependencies`와 선택 칸 `icon`, `skills`, `keys`, `events`, `subscriptions`, `widgets`만 있다. 알 수 없는 칸은 거절한다.
 
@@ -101,2 +103,7 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
     불렀는지 보인다. handler는 write로 기록되고 changeset을 떠서 rewind 대상이다.
+- `widgets` — 앱이 폰 widget 목록에 내는 줄이다. 항목은 `{key, label, screen?}`이고 4개까지다. `key`는
+  소문자로 시작하고 소문자·숫자·`_`로 32자까지이며 겹치지 못한다. `label`은 한 줄 1~40자이고 폰이 widget의 머리에 그린다.
+  `screen`은 widget을 누르면 열 화면의 key이고, 이 선언에서 `places`가 `["phone"]`인 화면이어야 한다(없으면 누르면 앱이 열린다).
+  선언은 목록만 정한다. 값은 앱 process가 `@lophn/cap-notify`의 `setWidget`으로 내고, 선언하지 않은 `key`의 값은 core가 거절한다.
+  값의 모양, 새로 하는 때, 작은 위젯에서 첫 줄이 중요한 까닭은 `@lophn/cap-notify` guide와 `design-app` skill의 Widgets를 읽는다.
 - `operations` — 앱 안의 operation 목록이다. 화면(`lophnApp.callOperation`)과 앱
@@ -128,3 +135,4 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   (`{host, port}`), `secret.use`(`{name, oauth?}`), `notify.send`(`{}`, scope 없음.
-  사람에게 알린다. `@lophn/cap-notify` guide)다. 같은 `name`의 `secret.use`는 하나뿐이다.
+  사람에게 알린다. `@lophn/cap-notify` guide), `phone.use`(`{capability}`, 연결된 폰의 기능을 쓴다.
+  `capability`는 `"location.get"`뿐이고 같은 capability를 두 번 선언하지 못한다. `@lophn/cap-phone`이 요구한다. 폰은 lophn 폰 앱이 앞에 있을 때만 답한다. `design-app` skill의 Phone location)다. 같은 `name`의 `secret.use`는 하나뿐이다.
   - `oauth`를 두면 그 secret은 사람이 sign-in해 받은 OAuth access token이다.
```
