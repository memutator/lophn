# @lophn/cap-fs 1.1.0

Previous: 1.0.0
Breaking: no. Move together with `@lophn/declaration` 4.12.0 if you declare `~/…` paths in `lophn.ts`.

Every function that takes a path (`readFile`, `readTextFile`, `writeFile`, `writeTextFile`, `watch`) now expands a leading `~` or `~/` to the home folder of the computer it runs on. Use the same string as the `fs.read`/`fs.write` declaration, so one release runs on every computer. Absolute paths still work.

```ts
// Before: /home/alice only exists on one computer
await readTextFile("/home/alice/.claude/projects/notes.md");
// After
await readTextFile("~/.claude/projects/notes.md");
```

```ts
// lophn.ts, before
{ kind: "fs.read", scope: { path: "/home/alice/.claude/projects", recursive: true }, reason: "Read agent records." }
// lophn.ts, after (needs `@lophn/declaration` 4.12.0; the string is stored and shown to the person as written)
{ kind: "fs.read", scope: { path: "~/.claude/projects", recursive: true }, reason: "Read agent records." }
```

Change the same version in `package.json` (`file:.lophn/sdk/cap-fs/1.1.0`) and in `lophn.ts` (`sdk_dependencies`). Required of an existing app: replace home-absolute `fs.read`/`fs.write` paths (in the declaration and in the code) with `~/…`. Changing the declaration is a new release, and the person is asked once again for that permission on each computer (grants are per computer and keyed by the path string). An app that keeps its absolute paths keeps working on that one computer only. Keep absolute paths only for places outside the home folder (`/var/log`). Only `~` and `~/…` are expanded: `~user/…` is not, and `~\…` is refused in a declaration.

## Instruction diff

```diff
# @lophn/cap-fs guide.md
@@ -21,2 +21,5 @@ import {
 
+- 경로는 절대 경로이거나 맨 앞이 `~`·`~/`인 home 기준 경로다. `~`는 이 컴퓨터의 home(`os.homedir()`)으로 펴지고 모든 함수가 같게 편다.
+  사람의 home 아래는 `~/…`로 쓰고(선언의 `fs.read`·`fs.write`의 `path`에도 같은 글을 적는다) 절대 경로는 home 밖(`/var/log`)에만 쓴다. 그러면 한
+  release가 `/home/alice`, `/home/ubuntu`, `C:\Users\bob`에서 다 돈다. `~user/…`는 펴지 않는다.
 - `readFile(path)`, `readTextFile(path)` — 파일을 읽는다.
@@ -48,4 +51,5 @@ import { readTextFile, writeTextFile } from "@lophn/cap-fs";
 
-const text = await readTextFile("/home/me/notes/todo.md");
-await writeTextFile("/home/me/notes/todo.md", `${text}\n- 새 할 일`);
+// lophn.ts: { kind: "fs.write", scope: { path: "~/notes", recursive: true }, reason: "..." }
+const text = await readTextFile("~/notes/todo.md");
+await writeTextFile("~/notes/todo.md", `${text}\n- 새 할 일`);
 ```
```
