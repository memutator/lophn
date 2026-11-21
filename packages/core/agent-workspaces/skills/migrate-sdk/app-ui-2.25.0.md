# @lophn/app-ui 2.25.0

Previous: 2.24.2
Breaking: no. Move together with `@lophn/declaration` 5.1.0 (this package depends on that exact version), and `@lophn/cap-store` 2.1.0 when a backend puts files.

New hook `useAppFile(handle)` shows an app file (a photo, a picked file) in a desktop screen. Pass the handle (`{ file, ... }`, or `null`/`undefined` while you have none); it returns `{ status: "loading" }`, `{ status: "ready", uri }` or `{ status: "failed", code }`, and runs again when the handle's `file` changes. Use `uri` in an ordinary `<img src>` (images work; audio and video are not promised). Only files of the screen's own app load. The bridge it uses is `lophnApp.files.locate(file)`.

```tsx
import { useAppFile } from "@lophn/app-ui";

function Receipt({ handle }: { handle: { file: string; name?: string } }) {
  const shown = useAppFile(handle);
  if (shown.status === "loading") return null;
  if (shown.status === "failed") return <p>Couldn't show the photo.</p>;
  return <img src={shown.uri} alt={handle.name ?? ""} />;
}
```

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.24.2",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.0.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.25.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.1.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.

## Instruction diff

Do not put file bytes in an operation input or output (the input limit is 64 KiB); pass the handle and show it with `useAppFile`:

```diff
--- a/packages/sdk/app-ui/guide.md
+++ b/packages/sdk/app-ui/guide.md
@@ -41,2 +41,5 @@ import {
   입력은 앱 process가 검사하지 않으므로 handler가 직접 확인한다.
+- `useAppFile(handle, bridge?)` — 앱 file(사진, 고른 file)의 손잡이(`{ file, ... }`, null·undefined도 된다)를 그릴 주소로
+  바꾼다. `{status: "loading"}`, `{status: "ready", uri}`, `{status: "failed", code}` 중 하나이고 손잡이의 `file`이 바뀌면
+  다시 푼다. `uri`는 `<img src>`에 그대로 쓴다. 이미지가 확인된 것이고, 소리·영상(`<audio>`, `<video>`)은 약속하지 않는다(이 주소는 Range 요청을 받지 않는다). PDF는 링크로 연다. 아래 "앱 file 보이기".
 - `AppErrorBoundary({children})` — 앱 화면 root의 오류 경계다. 앱 진입에서
@@ -157,3 +160,3 @@ import {
 | `lucide-react`       | 1.51.0  |
-| `@lophn/declaration` | 5.0.0   |
+| `@lophn/declaration` | 5.1.0   |
 | `@lophn/ui`          | 1.2.0   |
@@ -254,2 +257,22 @@ function Orders() {
 
+## 앱 file 보이기
+
+사진이나 file은 operation의 입력·출력과 DB row에 bytes로 넣지 않는다. operation 입력은 64 KiB까지다. 앱 file은 바뀌지 않는
+bytes이고, 화면과 operation에는 그 file을 가리키는 손잡이(`{ file, type, size, name?, width?, height? }`, 작은 JSON)만
+지나간다. backend가 `@lophn/cap-store`의 `putAppFile`로 file을 넣고 손잡이를 operation의 결과나 DB row로 내주면 화면이
+`useAppFile`로 그린다. 이 앱 것이 아닌 file과 없는 file은 `failed`다. 사진을 폰에서 고른 손잡이의 `name`은 시스템이 붙인 미디어 이름(`19.jpg` 같은 것)이라 원래 file 이름이 아닐 수 있다: 사진의 `name`을 사람에게 의미 있는 글로 보이지 않는다.
+
+```tsx
+import { useAppFile } from "@lophn/app-ui";
+
+function Receipt({ handle }: { handle: { file: string; name?: string } }) {
+  const shown = useAppFile(handle);
+  if (shown.status === "loading") return null;
+  if (shown.status === "failed") return <p>Couldn't show the photo.</p>;
+  return <img src={shown.uri} alt={handle.name ?? ""} />;
+}
+```
+
+`lophnApp.files.locate(file)`가 같은 일을 하는 bridge(`file`은 sha256)이고 hook이 쓴다. 앱 view 밖이면 hook은 `failed`다.
+
 ## project에 붙는 앱
```
