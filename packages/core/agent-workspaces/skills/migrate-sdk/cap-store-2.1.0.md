# @lophn/cap-store 2.1.0

Previous: 2.0.0
Breaking: no. Nothing existing changed.

New: app files. An app file is immutable bytes (a photo, a picked file) named by its sha256, kept in the app's own data area. A small JSON handle `{ file, type, size, name?, width?, height? }` names it, and the handle travels unchanged through operation inputs and outputs, DB rows and screens. New functions: `putAppFile(bytes, { type, name? })` returns a handle (at most 64 MiB; putting the same bytes again changes nothing), `readAppFile(handleOrSha256)` returns the bytes (`not_found` when absent), `hasAppFile(handleOrSha256)` returns a boolean. Files are never deleted by the app (deleting the app deletes them), so a handle in a row stays readable, including after a rewind. A backend that runs on the phone (`runs_on` has `phone`) can pass handles through but all three functions are `unavailable` there. `CapabilityError` has a new code `not_found`.

```ts
import { putAppFile, readAppFile } from "@lophn/cap-store";

const handle = await putAppFile(bytes, { type: "image/png", name: "receipt.png" });
// Return `handle` from an operation or keep it in a row; the screen shows it with useAppFile.
const again = await readAppFile(handle);
```

Do not put file bytes in operation inputs or outputs (the input limit is 64 KiB) or in a database column for photos and picked files; keep the handle. Nothing is required of an existing app. Change the version in `package.json` (`file:.lophn/sdk/cap-store/2.1.0`) and in `lophn.ts` (`sdk_dependencies`) when you want to use files.

## Instruction diff

When the app needs to keep a photo or a picked file, use an app file and keep its handle, not the bytes. The `@lophn/cap-store` guide now has a section for it:

```diff
--- a/packages/sdk/cap-store/guide.md
+++ b/packages/sdk/cap-store/guide.md
@@ -49,3 +49,31 @@ import { openStore } from "@lophn/cap-store";
 - DB를 열지 못하면 `CapabilityError`(`unavailable`)다.
-- type: `Store`, `StoreDb`, `StoreStatement`, `Migration`, `OpenStoreOptions`, `CapabilityError`
+- 앱 file(아래 "앱 file")을 넣고 읽는 `putAppFile`, `readAppFile`, `hasAppFile`.
+- type: `Store`, `StoreDb`, `StoreStatement`, `Migration`, `OpenStoreOptions`, `CapabilityError`, `AppFileHandle`,
+  `AppFileMeta`, `AppFileOptions`
+
+## 앱 file
+
+앱 file은 사진 같은 바뀌지 않는 bytes다. 이름은 내용의 sha256이고, 앱 data 영역 안 `files/`에 있다(앱을 지우면 같이 지워진다).
+file 하나는 64 MiB(`APP_FILE_MAX_BYTES`)까지다. 지우는 길과 용량 한도가 없고 같은 bytes를 다시 넣어도 하나다. file은 바뀌지
+않으므로 rewind가 되살린 row의 손잡이가 늘 살아 있다. 사람에게는 이렇게 말한다: 앱에서 사진을 지워도(row를 지워도) 그 사진의 bytes는 앱을 지울 때까지 컴퓨터에 남는다. 화면과 operation에는 bytes가 아니라 손잡이(`AppFileHandle`:
+`{ file, type, size, name?, width?, height? }`, 작은 JSON)를 넘기고, 화면은 `@lophn/app-ui`의 `useAppFile`로 그린다.
+
+- `putAppFile(bytes, { type, name? })` — `Uint8Array`를 file로 넣고 손잡이를 돌려준다. `type`은 content type(127자까지),
+  `name`은 255자까지다. 64 MiB를 넘으면 `invalid_input`이다. 이미 있는 file이면 아무것도 쓰지 않는다.
+- `readAppFile(handleOrSha256)` — 손잡이나 sha256으로 bytes(`Uint8Array`)를 읽는다. 없으면 `not_found`다.
+- `hasAppFile(handleOrSha256)` — 있는지 `boolean`으로 답한다.
+- 폰에서 도는 backend(`runs_on`에 `phone`)는 손잡이를 받아 row에 두고 넘기기만 한다. 세 함수 모두 `unavailable`이다.
+- 앱 file이 생기는 길은 둘이다: 컴퓨터의 backend가 `putAppFile`로 넣거나, 폰 화면이 `@lophn/cap-phone`의 사진·file 기능(`capturePhoto`,
+  `pickPhotos`, `pickFiles`)으로 받아 손잡이를 operation에 넘긴다. 컴퓨터에서 도는 앱은 폰이 file을 컴퓨터에 올린 뒤에 손잡이를 주므로
+  backend가 받은 손잡이는 곧바로 `readAppFile`로 읽힌다.
+- 앱 process 안에서만 쓴다(없으면 `unavailable`). 앱 test는 `{ dataPath }`로 영역을 준다. preview의 영역에는 sample file 둘(PNG
+  그림 하나와 짧은 글 하나)이 들어 있다.
+
+```ts
+import { putAppFile, readAppFile } from "@lophn/cap-store";
+
+const handle = await putAppFile(bytes, { type: "image/png", name: "receipt.png" });
+// handle을 operation의 결과나 DB row에 둔다.
+const again = await readAppFile(handle);
+```
 
```
