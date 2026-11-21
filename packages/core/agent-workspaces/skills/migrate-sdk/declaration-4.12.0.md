# @lophn/declaration 4.12.0

Previous: 4.11.0
Breaking: no. Move together with `@lophn/app-ui` 2.23.0, and `@lophn/cap-fs` 1.1.0 for the code that reads the files.

`fs.read` and `fs.write` accept a home-relative `path`: `~` or `~/…` (forward slashes only; `.` and `..` segments, `~user/…` and `~\…` are `invalid_input`). The string is stored, hashed and shown in the consent text as written; it is never expanded in the declaration or in a grant. `@lophn/cap-fs` expands it to the home folder of the computer the app runs on, so one release serves `/home/alice`, `/home/ubuntu` and `C:\Users\bob`.

```ts
// lophn.ts, before
permissions: [{ kind: "fs.read", scope: { path: "/home/alice/.claude/projects", recursive: true }, reason: "Read agent records." }],
// after
permissions: [{ kind: "fs.read", scope: { path: "~/.claude/projects", recursive: true }, reason: "Read agent records." }],
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.11.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.12.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Required of an existing app: nothing, existing declarations validate as before and keep their hash. Replace home-absolute `fs.read`/`fs.write` paths with `~/…` (and use `@lophn/cap-fs` 1.1.0 in the code) so the app runs on every computer; that is a new release and the person is asked once again for that permission on each computer. A copy of this SDK older than 4.12.0 in the app's own `validateDeclaration` test refuses `~` paths.

## Instruction diff

```diff
# @lophn/declaration guide.md
@@ -172,2 +172,7 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   `capability`는 `"location.get"`뿐이고 같은 capability를 두 번 선언하지 못한다. `@lophn/cap-phone`이 요구한다. 폰은 lophn 폰 앱이 앞에 있을 때만 답한다. `design-app` skill의 Phone location)다. 같은 `name`의 `secret.use`는 하나뿐이다.
+  - `fs.read`·`fs.write`의 `path`는 절대 경로(`/home/alice`, `C:\Users\bob`)이거나 사람의 home 기준 `~`·`~/…`다(슬래시만.
+    `.`·`..` 조각, `~user/…`, `~\…`는 `invalid_input`). 컴퓨터마다 home이 다르므로(`/home/alice`, `/home/ubuntu`, `C:\Users\bob`)
+    home 아래의 것은 `~/…`로 적는다: 한 release가 모든 컴퓨터에서 돈다. 절대 경로는 home 밖의 자리(`/var/log`)에만 쓴다. `~/…`는 선언·grant·동의
+    글에 적은 그대로 남고(펴지 않는다), 앱 code는 `@lophn/cap-fs`로 같은 글을 쓴다(그 package가 `~`를 이 컴퓨터의 home으로 편다). grant는 컴퓨터마다
+    따로라 사람은 컴퓨터마다 한 번씩 허락한다.
   - `oauth`를 두면 그 secret은 사람이 sign-in해 받은 OAuth access token이다.
@@ -204,3 +209,3 @@ const declaration = defineApp({
   app_connections: [],
-  sdk_dependencies: [{ name: "@lophn/declaration", version: "4.11.0" }],
+  sdk_dependencies: [{ name: "@lophn/declaration", version: "4.12.0" }],
 });
```
