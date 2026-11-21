# @lophn/cap-phone 1.2.0

Previous: 1.1.0
Breaking: no. Move together with `@lophn/declaration` 5.1.0 when you declare the new capabilities (the older declaration refuses them), and with `@lophn/cap-store` 2.1.0 and `@lophn/app-ui` 2.25.0 or `@lophn/app-ui-native` 1.11.0 to read and show the files. A screen built with this version needs a lophn phone app that has the photo and file features (an older phone app shows "update the lophn app").

Photos and files. A phone screen (and a backend that runs on the phone, which should call these from the screen) can now take a photo, pick photos, pick files and share a file. New functions: `capturePhoto()`, `pickPhotos({ max? })` (1 to 10, default 1), `pickFiles({ types?, max? })` (`types` are up to 10 content types or patterns like `image/*`) and `shareFile(handle, { title? })`. The first three answer `{ cancelled: true }` when the person closes the camera or picker (not an error) or `{ cancelled: false, file }` / `{ cancelled: false, files }`: app file handles, never bytes. A handle is `{ file, type, size, name?, width?, height? }` (`PhoneFileHandle`). The file is an app file: immutable bytes named by their sha256 and kept in the app's own data. Pass the handle through operations and keep it in a row as JSON text; show it with `useAppFile(handle)` (`@lophn/app-ui`, `@lophn/app-ui-native`); a computer backend reads the bytes with `readAppFile(handle)` (`@lophn/cap-store`), a backend that runs on the phone cannot. Files are never deleted. A file over 64 MiB is `invalid_input`. For an app that runs on the computer the file is on the computer before the handle comes back; if the computer cannot be reached within a minute the call is `unavailable` (`reason` `no_connection`, `transfer_broken` or `refused`) and there is no handle (tell the person to try again). A photo picked with `pickPhotos` carries the system's media name (like `19.jpg`) in `name`, not the original file name. Import `react-native-svg` by name (`import { Svg, Circle } from "react-native-svg"`): a default import is refused when the release is prepared, and its `Image` does not exist in a phone screen. Results carry `standIn: true` in a preview (a small picture for photos, a short text file for `pickFiles`). Each function needs its own `phone.use` declaration with a `reason`; the phone asks for the OS camera permission on the first photo, the pickers need none. Only a phone screen can call them: a backend on the computer gets `unavailable`.

```tsx
import { capturePhoto, getPhoneAccess } from "@lophn/cap-phone";
import { useAppFile } from "@lophn/app-ui-native";

// permissions: { kind: "phone.use", scope: { capability: "camera.capture" }, reason: "Photograph a receipt" }
async function takeReceipt(save: (handle: unknown) => Promise<unknown>) {
  if (!getPhoneAccess().capabilities.includes("camera.capture")) return;
  const photo = await capturePhoto(); // { cancelled: true } when the person closes the camera
  if (!photo.cancelled) await save(photo.file); // an operation takes the handle, never bytes
}
```

```ts
// lophn.ts, after
sdk_dependencies: [{ name: "@lophn/cap-phone", version: "1.2.0" }],
permissions: [
  { kind: "phone.use", scope: { capability: "camera.capture" }, reason: "Photograph a receipt" },
],
```

Nothing is required of an existing app. Not there yet: video, audio recording, saving to the gallery, giving a photo to an agent, picking files on the desktop, and files travelling to another computer for an app with `sync_to`.

## Instruction diff

The phone features table has four more capabilities and a new section, "App files", says what a handle is and how to pass and show it. The app prompt and the `design-app` skill changed; the skill's `SKILL.md` only points at the file. Do not promise the person that photos or files are deleted for good, do not put file bytes in an operation input (the input limit is 64 KiB), and do not say photos and files do not exist.

```diff
--- a/packages/core/agent-workspaces/prompts/app.md
+++ b/packages/core/agent-workspaces/prompts/app.md
@@ -117,9 +117,13 @@ information). Use `lophn app link-source` only for an existing git repo with a c
 - When the app needs the person's phone (location, network state, vibration,
-  clipboard text, a QR or barcode scan, opening a link, the share sheet), declare
-  `phone.use` once per capability and read the skill `design-app`, "Phone
-  features", and the `@lophn/cap-phone` guide. A phone screen can use all of
-  them; the computer's backend only location and network state, and only while
-  the lophn phone app is in front. Handle `forbidden` and `unavailable`, the
-  preview returns stand-in values, and photos, files, camera capture and
-  background work do not exist.
+  clipboard text, a QR or barcode scan, opening a link, the share sheet, the
+  camera, picking photos or files), declare `phone.use` once per capability and
+  read the skill `design-app`, "Phone features" and "App files", and the
+  `@lophn/cap-phone` guide. A phone screen can use all of them; the computer's
+  backend only location and network state, and only while the lophn phone app is
+  in front. Handle `forbidden`, `unavailable` and a cancelled pick; the preview
+  returns stand-in values. A photo or file is an app file: the phone feature
+  answers a handle (never bytes), you pass the handle through operations and keep
+  it in a row, a screen shows it with `useAppFile` and a computer backend reads it
+  with `readAppFile` (`@lophn/cap-store`). Files are never deleted. Video, audio
+  recording, saving to the gallery and handing a photo to an agent do not exist.
 - When the app must tell other apps that something happened (one fact, many
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -251,5 +251,5 @@ Rules:
   operations (`useOperation`, `OperationButton`) and events (`useEvent`), and
-  the declaration must list them. Images are the kit's `Icon` and `data:`
-  URIs. Phone features come from `@lophn/cap-phone` (`phone.use`, see
-  `phone-features.md`).
+  the declaration must list them. Images are the kit's `Icon`, `data:` URIs
+  and app files (`useAppFile`). Phone features and files:
+  `phone-features.md`.
 
--- a/packages/core/agent-workspaces/skills/design-app/phone-features.md
+++ b/packages/core/agent-workspaces/skills/design-app/phone-features.md
@@ -57,2 +57,6 @@ declaration; none is background work.
 | `share.text` | `shareText(text, { title? })`: the phone's share sheet | screen |
+| `camera.capture` | `capturePhoto()`: the camera; a file handle | screen |
+| `photos.pick` | `pickPhotos({ max? })`: the photo picker (1 to 10); file handles | screen |
+| `files.pick` | `pickFiles({ types?, max? })`: the file picker; file handles | screen |
+| `share.file` | `shareFile(handle, { title? })`: the share sheet for an app file | screen |
 
@@ -62,4 +66,5 @@ backend that runs on the phone an operation must finish within 3 seconds or it
 is rolled back (`unavailable`) and the screen dies soon after. So call
-`getLocation`, `scanCode`, `shareText` and `openLink` (anything slow or that
-shows UI) from the screen (a button handler or an effect) and pass the result
+`getLocation`, `scanCode`, `shareText`, `openLink`, `capturePhoto`,
+`pickPhotos`, `pickFiles` and `shareFile` (anything slow or that shows UI) from
+the screen (a button handler or an effect) and pass the result
 to an operation. `getNetwork`, `playHaptic` and the clipboard are quick enough
@@ -67,4 +72,5 @@ inside an operation. Every call answers only while the lophn phone app is in
 front. There
-is no photo, file, camera capture, audio, contact, calendar, fingerprint or
-sensor feature, and nothing runs in the background or wakes the phone. Do not
+is no video, audio recording, saving to the photo gallery, contact, calendar,
+fingerprint or sensor feature, and nothing runs in the background or wakes the
+phone. Do not
 promise what is not in the table; tell the person it does not exist yet.
@@ -75,3 +81,4 @@ promise what is not in the table; tell the person it does not exist yet.
    allows each once when the release is activated. The phone asks for its OS
-   permission on the first use of location and of the scanner. A grant the
+   permission on the first use of location, of the scanner and of the camera
+   (the photo and file pickers need none). A grant the
    person takes back later reaches the phone when it next reads the computer (an
@@ -82,4 +89,4 @@ promise what is not in the table; tell the person it does not exist yet.
    still no network in a screen: a link opens in the phone's own app, and
-   `link.open` and `share.text` can send the app's data out, so say that in the
-   `reason`.
+   `link.open`, `share.text` and `share.file` can send the app's data out, so say
+   that in the `reason`.
 3. A screen can hide a button the app cannot use now:
@@ -103,4 +110,5 @@ promise what is not in the table; tell the person it does not exist yet.
    on wifi, the text `Sample text from the clipboard`, a QR code that reads
-   `https://example.com`) and does nothing on the phone: no vibration, no
-   copy, no link, no share sheet. In both previews a capability you did not
+   `https://example.com`, a small blue picture for `capturePhoto` and
+   `pickPhotos`, a short text file for `pickFiles`) and does nothing on the
+   phone: no vibration, no copy, no link, no camera, no picker, no share sheet. In both previews a capability you did not
    declare is `forbidden`, exactly as it will be live, so a `forbidden` in
@@ -110 +118,50 @@ promise what is not in the table; tell the person it does not exist yet.
    does when the feature is missing or refused.
+
+## App files: photos and picked files
+
+An app file is immutable bytes (a photo, a PDF) named by its sha256 and kept in
+the app's own data, not in the database. A small JSON handle names it:
+`{ file, type, size, name?, width?, height? }`. The handle is what travels.
+
+1. `capturePhoto()`, `pickPhotos()` and `pickFiles()` answer
+   `{ cancelled: true }` (the person just closed it: not an error, keep the
+   screen as it was) or file handles, never bytes. `shareFile(handle)` hands a
+   file to the share sheet. Each of the four needs its own `phone.use`
+   declaration with a `reason` (`camera.capture`, `photos.pick`, `files.pick`,
+   `share.file`). A file over 64 MiB is `invalid_input`: show the message. One
+   picker or camera at a time.
+2. Pass handles through operations and keep them in rows as JSON text. Never put
+   file bytes in an operation input (the input limit is 64 KiB), a row or an
+   event: put the handle there.
+3. Show a file in a screen with `useAppFile(handle)` from `@lophn/app-ui` (a
+   desktop screen, `<img src={uri}>`) or `@lophn/app-ui-native` (a phone screen,
+   `<Image source={{ uri }}>`). It answers `loading`, `ready` with `uri` or
+   `failed` with a code; a phone screen draws only its own app's files. The phone
+   may have to fetch the file from the computer first. Images are what works
+   (`<img>`, `<Image>`): do not promise audio or video playback, and a PDF is a
+   link, not an embedded view. `react-native-svg` is imported by name (`import { Svg, Circle } from
+   "react-native-svg"`; a default import `import Svg from ...` is refused when
+   the release is prepared), and its `Image` does
+   not exist in a phone screen (it would fail), so draw pictures with React
+   Native's `Image`.
+   A photo picked on the phone carries the system's media name (like `19.jpg`),
+   not the original file name: do not show a photo's `name` as if it meant
+   something.
+4. A backend on the computer reads the bytes with `readAppFile(handle)` and can
+   make a file with `putAppFile(bytes, { type, name? })` from `@lophn/cap-store`.
+   A backend that runs on the phone cannot read or write bytes; it keeps the
+   handle in a row and passes it on.
+5. For an app that runs on the computer, a photo or picked file reaches the
+   screen only after it is on the computer: with the computer unreachable the
+   call is `unavailable` (after waiting up to a minute for the computer; the
+   `reason` says no connection, a broken transfer or a refusal) and there is no
+   handle. Tell the person to try again when the computer is on. An app that runs on the phone keeps the file on the
+   phone at once; if it also runs on the computer every computer it syncs with
+   gets the files it lacks before it gets any row.
+6. Files are never deleted (they go when the app is deleted), so a removed row
+   leaves its bytes on disk until the app is deleted, and a rewind finds a handle
+   alive. Do not promise
+   "deleted for good". Files of an app that lists tables in `sync` do not travel to the other
+   computers: a row of a listed table does and the picture is empty there.
+7. Not there yet: video, audio recording, saving to the photo gallery, giving a
+   photo to an agent or a model, picking files in a desktop screen. Say so.
--- a/packages/sdk/cap-phone/guide.md
+++ b/packages/sdk/cap-phone/guide.md
@@ -15,3 +15,3 @@
 rollback되어 `unavailable`이 되며 곧 화면이 죽는다. 오래 걸리거나 화면을 띄우는 `getLocation`, `scanCode`, `shareText`,
-`openLink`는 화면(단추 handler나 effect)에서 부르고 결과를 operation에 넘긴다. `getNetwork`, `playHaptic`, 클립보드는 operation
+`openLink`, `capturePhoto`, `pickPhotos`, `pickFiles`, `shareFile`은 화면(단추 handler나 effect)에서 부르고 결과를 operation에 넘긴다. `getNetwork`, `playHaptic`, 클립보드는 operation
 안에서 불러도 된다.
@@ -19,3 +19,3 @@ rollback되어 `unavailable`이 되며 곧 화면이 죽는다. 오래 걸리거
 desktop 화면(`main.tsx`)에서는 부르지 못한다(`unavailable`). 폰 화면 bundle에는 이 package가 순수 JS로 묶인다.
-사진, file, 카메라 촬영, 녹음, 연락처, 달력, 지문, 센서, background 일은 아직 없다.
+녹음, 영상, 연락처, 달력, 지문, 센서, background 일은 아직 없다.
 
@@ -27,2 +27,3 @@ import {
   scanCode, openLink, shareText, getPhoneAccess,
+  capturePhoto, pickPhotos, pickFiles, shareFile,
 } from "@lophn/cap-phone";
@@ -40,2 +41,6 @@ import {
 | `shareText(text, { title? })` | `share.text` | 화면 | `{}`. 폰의 공유 sheet가 열린다 |
+| `capturePhoto()` | `camera.capture` | 화면 | `{ cancelled: true }` 또는 `{ cancelled: false, file }`. `file`은 앱 file의 손잡이 |
+| `pickPhotos({ max? })` | `photos.pick` | 화면 | `{ cancelled: true }` 또는 `{ cancelled: false, files }`. `max`는 1~10(기본 1) |
+| `pickFiles({ types?, max? })` | `files.pick` | 화면 | `pickPhotos`와 같다. `types`는 content type이나 `image/*` 같은 무늬 10개까지 |
+| `shareFile(file, { title? })` | `share.file` | 화면 | `{}`. 손잡이의 file을 폰의 공유 sheet로 보낸다 |
 | `getPhoneAccess()` | | 어디서나 | `{ capabilities, standIn }`(동기) |
@@ -48,3 +53,19 @@ import {
   화면은 그대로 두고, 한 번에 스캐너 하나라서 열린 동안의 두 번째 호출은 `conflict`다.
-- `openLink`·`shareText`는 앱의 data를 폰 밖으로 내보낼 수 있다. 선언의 `reason`에 그렇게 쓴다.
+- `openLink`·`shareText`·`shareFile`은 앱의 data를 폰 밖으로 내보낼 수 있다. 선언의 `reason`에 그렇게 쓴다.
+- **사진과 file(`capturePhoto`, `pickPhotos`, `pickFiles`, `shareFile`).** 이 기능들은 bytes가 아니라 앱 file의 손잡이(`{ file, type,
+  size, name?, width?, height? }`, 작은 JSON)를 답한다. 앱 file은 바뀌지 않는 bytes이고 이름은 내용의 sha256이다(`@lophn/cap-store`
+  guide). 손잡이를 operation의 입력·출력으로 넘기고 DB row에는 JSON 글로 둔다. operation 입력은 64 KiB까지라 bytes를 넣지 않는다.
+  화면은 `@lophn/app-ui-native`의 `useAppFile(handle)`로 그리고, 컴퓨터의 backend는 `@lophn/cap-store`의 `readAppFile(handle)`로
+  bytes를 읽는다(폰에서 도는 backend는 bytes를 못 읽고 손잡이만 넘긴다).
+  - `capturePhoto`는 카메라를, `pickPhotos`는 시스템 사진 선택기를(사진만, OS 권한 없이), `pickFiles`는 시스템 file 선택기를
+    연다. 사람이 그냥 닫으면 `cancelled: true`다(오류가 아니다). 사진은 JPEG 품질 0.8로 다시 압축해 넣는다.
+  - 사진을 `pickPhotos`로 고른 손잡이의 `name`은 시스템 사진 선택기가 붙인 미디어 이름(`19.jpg` 같은 것)이라 원래 file 이름이 아닐 수 있다: 사진의 `name`을 사람에게 의미 있는 글로 보이지 않는다(`pickFiles`의 `name`은 고른 file의 이름이다).
+  - file 하나는 64 MiB까지다. 넘으면 `invalid_input`이고 메시지로 사람에게 보인다.
+  - **컴퓨터에서 도는 앱**에서는 file이 컴퓨터에 올라간 뒤에 답한다. 컴퓨터에 1분 안에 닿지 못하거나 올리지 못하면 `unavailable`이고
+    손잡이가 없다(`reason`: `no_connection`은 1분 안에 연결이 없었다, `transfer_broken`은 올리다 끊겼다, `refused`는 컴퓨터가 받지 않았다. 컴퓨터의 말이 message에 있다): 사람에게 "컴퓨터에 닿을 때 다시 해 주세요"라고 알린다. 카메라나 선택기에서 돌아온 직후 연결이 잠깐 끊겨 있는 것은 이 1분 안에 이어진다. **폰에서 도는 앱**은 폰의 앱 폴더에 두고 손잡이를
+    바로 답한다. 컴퓨터에서도 도는 앱이면 다음에 컴퓨터와 맞출 때(row보다 먼저) 올라간다.
+  - 한 번에 하나만 연다(열린 동안의 두 번째 호출은 `conflict`). 응답 시한은 10분이다.
+  - 앱 file은 지우지 않는다(앱을 지울 때 같이 지워진다). "영구 삭제" 약속을 앱에 두지 않는다.
+  - 없는 것: 영상, 녹음, 사진 보관함에 저장, agent에 사진 넘기기, desktop에서 file 고르기, `sync`로 표를 보내는 앱의 file을 다른 컴퓨터로
+    옮기기. 사람에게 아직 없다고 말한다.
 - `getPhoneAccess()`: 지금 이 코드가 쓸 수 있는 기능의 이름(`capabilities`)이다(선언∩사람이 허락한 것∩이 폰 앱이
@@ -58,7 +79,8 @@ import {
   - `unavailable`이면 `reason`이 다음 중 하나다. `no_phone`(기준 폰이 짝지어져 있지 않다), `phone_unreachable`(폰과
-    연결이 없다), `unsupported`(이 폰 앱이 그 기능을 갖고 있지 않다), `phone_in_background`(폰 앱이 앞에 있지 않다), `location_off`(폰의 위치 서비스가 꺼져 있다), `timeout`(제때 답이 없다). 화면 전용 기능을
+    연결이 없다), `unsupported`(이 폰 앱이 그 기능을 갖고 있지 않다), `phone_in_background`(폰 앱이 앞에 있지 않다), `location_off`(폰의 위치 서비스가 꺼져 있다), `timeout`(제때 답이 없다), 컴퓨터에서 도는 앱의 사진·file에서는 `no_connection`·`transfer_broken`·`refused`(위). 화면 전용 기능을
     컴퓨터의 backend나 desktop 화면에서 부르면 `unavailable`(`reason` 없음)이다. 앱 process 밖이라 host가 없을 때도 같다.
-  - `conflict`는 스캐너가 이미 열려 있다는 뜻이다. 입력이 틀리면 `invalid_input`이고 폰에 묻기 전에 난다.
+  - `conflict`는 스캐너나 카메라·선택기가 이미 열려 있다는 뜻이다. 입력이 틀리면 `invalid_input`이고 폰에 묻기 전에 난다.
 - `checkDeclaration(declaration)` — 이 package를 쓰는 선언이 `phone.use`를 빠뜨렸는지 검사한다.
-- type: `PhoneClient`, `PhoneLocation`, `PhoneNetwork`, `PhoneClipboardText`, `PhoneScan`, `PhoneDone`, `PhoneAccess`,
+- type: `PhoneClient`, `PhoneLocation`, `PhoneNetwork`, `PhoneClipboardText`, `PhoneScan`, `PhoneCapture`, `PhonePicked`,
+  `PhoneFileHandle`, `PhoneDone`, `PhoneAccess`,
   `PhoneCapabilityName`, `HapticKind`, `LocationOptions`, `LocationAccuracy`, `CapabilityError`, `DeclarationCheck`
@@ -68,3 +90,3 @@ import {
 `phone.use` — scope는 `{ capability: "<이름>" }`이고 `reason`을 쓴다. **쓰는 기능마다 하나씩** 선언하고 activation 때
-사람이 기능마다 한 번 허락한다. 허락했어도 위치와 스캐너는 처음 부를 때 폰이 OS 권한을 따로 묻는다. 요청은 그 사람의
+사람이 기능마다 한 번 허락한다. 허락했어도 위치, 스캐너, 카메라는 처음 부를 때 폰이 OS 권한을 따로 묻는다(사진 선택기와 file 선택기는 묻지 않는다). 요청은 그 사람의
 기준 폰 하나로만 간다.
@@ -80,3 +102,4 @@ live가 아니면(desktop의 폰 화면 preview, 폰의 "Preview from lophn", te
 선언에 그 `phone.use`를 더하라는 뜻이다(desktop의 폰 화면 preview와 폰의 preview가 같다). 값은: 위치는 서울시청, 연결은 wifi로 online, 클립보드는 예시 글, 스캔은 `https://example.com`을
-읽은 QR이다. 진동, 복사, 링크 열기, 공유는 아무 일도 하지 않는다. 그래서 preview에서는 실제 폰의 반응을 볼 수 없다. 마지막
+읽은 QR이다. `capturePhoto`·`pickPhotos`는 64x64 단색 그림 하나의 손잡이를, `pickFiles`는 짧은 글 file 하나의 손잡이를 답한다(두 file은
+preview에 있어 `useAppFile`로 그릴 수 있다). 진동, 복사, 링크 열기, 공유(`shareText`, `shareFile`)는 아무 일도 하지 않는다. 그래서 preview에서는 실제 폰의 반응을 볼 수 없다. 마지막
 확인은 사람이 폰에서 한다. 이 모양은 화면과 backend 모두 같다.
@@ -85,4 +108,4 @@ live가 아니면(desktop의 폰 화면 preview, 폰의 "Preview from lophn", te
 
-폰 화면에는 여전히 network가 없다(`fetch`, WebSocket 없음). 링크는 폰의 다른 앱에서 열린다. 위 표에 없는 것(사진,
-file, 카메라 촬영, 녹음, 연락처, 달력, 지문, 센서, background 일)은 없다. 사람에게 아직 없다고 말한다.
+폰 화면에는 여전히 network가 없다(`fetch`, WebSocket 없음). 링크는 폰의 다른 앱에서 열린다. 위 표에 없는 것(영상,
+녹음, 연락처, 달력, 지문, 센서, background 일)은 없다. 사람에게 아직 없다고 말한다.
 
@@ -100,3 +123,3 @@ file, 카메라 촬영, 녹음, 연락처, 달력, 지문, 센서, background 
 ```tsx
-// src/screens/scan/phone.tsx. 선언: sdk_dependencies에 { name: "@lophn/cap-phone", version: "1.1.0" },
+// src/screens/scan/phone.tsx. 선언: sdk_dependencies에 { name: "@lophn/cap-phone", version: "1.2.0" },
 // permissions에 { kind: "phone.use", scope: { capability: "code.scan" }, reason: "Read a code to add it" }
```
