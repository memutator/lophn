# @lophn/app-ui-native 1.11.0

Previous: 1.10.1
Breaking: no. Move together with `@lophn/declaration` 5.1.0 (this package depends on that exact version), `@lophn/cap-phone` 1.2.0 for the photo and file features, and `@lophn/cap-store` 2.1.0 when a backend puts files. A screen built with this version needs a lophn phone app that has the photo and file features (an older phone app shows "update the lophn app").

New hook `useAppFile(handle)` (the same file as in `@lophn/app-ui`) turns an app file handle (`{ file, ... }`, or `null`/`undefined` while you have none) into `{ status: "loading" }`, `{ status: "ready", uri }` or `{ status: "failed", code }`, and runs again when the handle's `file` changes. Use `uri` in React Native `<Image source={{ uri }}>`.

```tsx
import { Image } from "react-native";
import { useAppFile } from "@lophn/app-ui-native";

function Receipt({ handle }: { handle: { file: string } }) {
  const shown = useAppFile(handle);
  if (shown.status !== "ready") return null;
  return <Image source={{ uri: shown.uri }} style={{ width: 200, height: 200 }} />;
}
```

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.10.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.0.0",
// package.json, after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.11.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/5.1.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.

## Instruction diff

Do not put file bytes in an operation input or output (the input limit is 64 KiB); pass the handle and show it with `useAppFile`:

```diff
--- a/packages/sdk/app-ui-native/guide.md
+++ b/packages/sdk/app-ui-native/guide.md
@@ -7,3 +7,3 @@ hook과 단추다. 선언한 operation 하나를 부르는 `OperationButton`·`u
 자리·인자·workspace를 읽는 `usePlace`, 앱 event를 받는 `useEvent`다. 화면은 operation만 부르고, 호출은
-`lophnApp.callOperation` 하나로만 한다. 폰 기능(진동, 클립보드, code 스캔, 링크, 공유, 위치, 연결 상태)은 이 package가
+`lophnApp.callOperation` 하나로만 한다. 폰 기능(진동, 클립보드, code 스캔, 링크, 공유, 위치, 연결 상태, 카메라, 사진·file 고르기, file 공유)은 이 package가
 아니라 `@lophn/cap-phone`의 함수로 쓴다(화면 bundle에 묶이는 순수 JS이고 `phone.use` 선언이 필요하다). 호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에
@@ -49,4 +49,10 @@ import {
   내는 event의 `"lophn"`이다. listener는 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다.
+- `useAppFile(handle, bridge?)` — 앱 file(사진, 고른 file)의 손잡이(`{ file, ... }`)를 `<Image source={{ uri }}>`에 쓸 주소로
+  바꾼다. `{status: "loading"}`, `{status: "ready", uri}`, `{status: "failed", code}` 중 하나이고 손잡이의 `file`이 바뀌면
+  다시 푼다. 폰 화면은 자기 앱의 file만 그린다(폰에 없으면 컴퓨터에서 받아 오느라 `loading`이 길 수 있고, 컴퓨터에 닿지 못하면
+  `failed`의 `unavailable`, 컴퓨터에도 없으면 `not_found`). 폰 화면이 그릴 수 있는 file 주소는 이것뿐이다(다른 `file:`·`content:`
+  주소와 network 주소는 그려지지 않는다). `react-native-svg`의 `Image`(SVG 안의 그림)는 폰 화면에 없다(`import { Svg, Circle } from "react-native-svg"`처럼 이름으로 가져온다. 기본 import `import Svg from "react-native-svg"`는 release 준비가 거절한다): 그것으로 그림을 그리는 화면은 처음부터 실패한다. 그림은 React Native의 `Image`로 그린다. operation 입력은 64 KiB까지라 bytes를 넣지 않고 손잡이를 넘긴다. 손잡이는 `@lophn/cap-phone`의
+  사진·file 기능(`capturePhoto`, `pickPhotos`, `pickFiles`)이나 컴퓨터 backend의 `putAppFile`에서 온다. 아래 "앱 file 보이기".
 - type: `OperationSpec`, `OperationInput`, `OperationResult`, `OperationState`, `UseOperation`, `AppBridge`,
-  `EventBridge`, `Place`, `PlaceValue`, `PlaceWorkspace`, `OperationButtonProps`
+  `EventBridge`, `FilesBridge`, `AppFileState`, `Place`, `PlaceValue`, `PlaceWorkspace`, `OperationButtonProps`
 
@@ -59,3 +65,3 @@ root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은
 - 화면은 operation만 부른다. data는 bridge(operation의 결과와 event)로만 받는다. network가 없다. 폰 기능은
-  `@lophn/cap-phone`이 낸다(`phone.use` 선언). 사진, file, 카메라 촬영은 아직 없다.
+  `@lophn/cap-phone`이 낸다(`phone.use` 선언). 사진과 file은 그 기능이 낸 손잡이를 `useAppFile`로 그린다. 영상과 녹음은 아직 없다.
 - 선언에 없는 operation 이름과 command는 `forbidden`이다.
@@ -81,3 +87,3 @@ root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은
 | `react`              | 19.3.0  |
-| `@lophn/declaration` | 5.0.0 (이 package가 의존으로 가져온다) |
+| `@lophn/declaration` | 5.1.0 (이 package가 의존으로 가져온다) |
 | `@lophn/i18n`        | 1.0.0 (이 package가 의존으로 가져온다) |
@@ -88,3 +94,3 @@ root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은
 "devDependencies": {
 }
@@ -94,3 +100,3 @@ root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은
 sdk_dependencies: [
 ],
@@ -152,2 +158,20 @@ export default function Orders() {
 
+## 앱 file 보이기
+
+앱 file은 바뀌지 않는 bytes이고 이름은 내용의 sha256이다. 화면과 operation에는 그 file의 손잡이(`{ file, type, size, name?,
+width?, height? }`, 작은 JSON)만 지나간다. operation 입력은 64 KiB까지라 사진 bytes를 넣지 않고 손잡이를 넘긴다. 컴퓨터의
+backend가 `@lophn/cap-store`의 `putAppFile`로 넣은 file이나 폰 기능이 낸 file의 손잡이를 operation 결과나 DB row(JSON 글)로 받아 그린다.
+사진을 폰에서 고른 손잡이의 `name`은 시스템이 붙인 미디어 이름(`19.jpg` 같은 것)이라 원래 file 이름이 아닐 수 있다. 컴퓨터에서 도는 앱의 file은 컴퓨터가 갖고 폰은 받아 둔다(폰의 cache). 폰에서 도는 앱의 file은 폰의 앱 폴더에 있다.
+
+```tsx
+import { Image } from "react-native";
+import { useAppFile } from "@lophn/app-ui-native";
+
+function Receipt({ handle }: { handle: { file: string } }) {
+  const shown = useAppFile(handle);
+  if (shown.status !== "ready") return null;
+  return <Image source={{ uri: shown.uri }} style={{ width: 200, height: 200 }} />;
+}
+```
+
 ## version 정책
```
