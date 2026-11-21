# @lophn/declaration 5.1.0

Previous: 5.0.0
Breaking: no. Move together with `@lophn/app-ui` 2.25.0 or `@lophn/app-ui-native` 1.11.0 (they depend on this exact version), and `@lophn/cap-phone` 1.2.0 for the code that uses the new capabilities.

`phone.use` accepts four more capabilities: `camera.capture`, `photos.pick`, `files.pick` and `share.file`. They take a photo, pick photos, pick files and share an app file with the phone's share sheet. Declare one `phone.use` permission per capability you use; the person allows each once when the release is activated. A capability outside the list is `invalid_input`, as before.

```ts
// lophn.ts, after
permissions: [
  { kind: "phone.use", scope: { capability: "camera.capture" }, reason: "Photograph a receipt to keep with the expense" },
],
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/5.0.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/5.1.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app: existing declarations validate as before and keep their hash. A copy of this SDK older than 5.1.0 in the app's own `validateDeclaration` test refuses the new capabilities.

## Instruction diff

The `phone.use` line of the declaration guide lists the four new capabilities. Declare each one you use on its own, with a `reason` in the person's words (`share.file` can send the app's files out of lophn, so say so). Read the `@lophn/cap-phone` 1.2.0 note for the functions.

```diff
--- a/packages/sdk/declaration/guide.md
+++ b/packages/sdk/declaration/guide.md
@@ -181,3 +181,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   사람에게 알린다. `@lophn/cap-notify` guide), `phone.use`(`{capability}`, 연결된 폰의 기능을 쓴다.
-  `capability`는 `"location.get"`, `"network.get"`, `"haptics.play"`, `"clipboard.read"`, `"clipboard.write"`, `"code.scan"`, `"link.open"`, `"share.text"` 가운데 하나이고 기능마다 따로 선언하며 같은 capability를 두 번 선언하지 못한다. `@lophn/cap-phone`이 요구한다. 폰 화면은 모든 기능을, 컴퓨터의 backend는 위치와 연결 상태만 부르고 컴퓨터 쪽은 lophn 폰 앱이 앞에 있을 때만 답한다. `design-app` skill의 Phone features)다. 같은 `name`의 `secret.use`는 하나뿐이다.
+  `capability`는 `"location.get"`, `"network.get"`, `"haptics.play"`, `"clipboard.read"`, `"clipboard.write"`, `"code.scan"`, `"link.open"`, `"share.text"`, `"camera.capture"`, `"photos.pick"`, `"files.pick"`, `"share.file"` 가운데 하나이고 기능마다 따로 선언하며 같은 capability를 두 번 선언하지 못한다. `@lophn/cap-phone`이 요구한다. 폰 화면은 모든 기능을, 컴퓨터의 backend는 위치와 연결 상태만 부르고 컴퓨터 쪽은 lophn 폰 앱이 앞에 있을 때만 답한다. `design-app` skill의 Phone features)다. 같은 `name`의 `secret.use`는 하나뿐이다.
   - `fs.read`·`fs.write`의 `path`는 절대 경로(`/home/alice`, `C:\Users\bob`)이거나 사람의 home 기준 `~`·`~/…`다(슬래시만.
@@ -219,3 +219,3 @@ const declaration = defineApp({
   app_connections: [],
 });
```
