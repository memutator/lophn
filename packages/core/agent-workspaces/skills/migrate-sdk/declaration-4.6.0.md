# @lophn/declaration 4.6.0

Previous: 4.5.1
Breaking: no. Move together with `@lophn/app-ui` 2.15.0.

A screen can now list the `phone` place: `places: ["phone"]`. `phone` is a screen the lophn phone app draws, and it stands alone: combining it with `tab`, `panel`, `card`, `sidebar` or `tray` in one screen's `places` is a declaration error (`screen <key>: phone is its own place; it cannot be combined with tab, panel, card, sidebar or tray`). The `Place` type gains `"phone"`.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.1",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.1",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.6.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.15.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app: existing screens and declarations validate as before. Existing supported SDK versions remain supported.

## Instruction diff

The SDK guide now lists `phone` among the places. Add nothing to your app's `AGENTS.md` unless the app wants a phone screen; how to write and build one is told by the guide of the SDK version that supports phone screens. Do not mix `phone` with other places in one screen.

```diff
# @lophn/declaration guide.md
@@ -35,4 +35,6 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   - `sidebar` — 오른쪽 sidebar다.
   - `tray` — 작업 표시줄 tray popup이다.
+  - `phone` — 폰 앱이 그리는 화면이다. 혼자 서는 자리라 `places`에 다른 자리와 같이 쓰면 선언 오류다.
+    소스와 빌드 방법은 폰 화면을 지원하는 판의 지침이 말한다.
   - `tray` 칸 — tray popup의 크기다. `{width?, height?}`이고 단위는 px다. 둘 중 하나는
```
