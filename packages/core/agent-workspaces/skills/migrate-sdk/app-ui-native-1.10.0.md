# @lophn/app-ui-native 1.10.0

Previous: 1.9.3
Breaking: no. Move together with `@lophn/declaration` 4.13.0. A screen built with this version needs a lophn phone app that has the phone features (older phone apps show "update the lophn app").

The exact dependency is now `@lophn/declaration` 4.13.0, and the guide now says that a phone screen uses the phone's features (vibration, clipboard text, scanning, links, share, location, network state) through `@lophn/cap-phone`, not through this package. No code changed in this package.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.9.3",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.12.0",
// package.json, after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.10.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.13.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app. Use the phone features only when the person asks for them (see the `@lophn/cap-phone` 1.1.0 note).

## Instruction diff

Do not say or assume that a phone screen can only call operations. A phone screen can import `@lophn/cap-phone` (it is bundled into the screen) and use the features there, each with its own `phone.use` declaration. There is still no network in a screen, and photos, files and camera capture do not exist yet.

```diff
# @lophn/app-ui-native guide.md
@@ -7,3 +7,4 @@ hook과 단추다. 선언한 operation 하나를 부르는 `OperationButton`·`u
 자리·인자·workspace를 읽는 `usePlace`, 앱 event를 받는 `useEvent`다. 화면은 operation만 부르고, 호출은
-`lophnApp.callOperation` 하나로만 한다. 호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에
+`lophnApp.callOperation` 하나로만 한다. 폰 기능(진동, 클립보드, code 스캔, 링크, 공유, 위치, 연결 상태)은 이 package가
+아니라 `@lophn/cap-phone`의 함수로 쓴다(화면 bundle에 묶이는 순수 JS이고 `phone.use` 선언이 필요하다). 호출이 허락되는지, 사람이 정해야 하는지는 lophn이 정하고 앱 안에
 따로 확인 dialog를 두지 않는다.
@@ -57,3 +58,4 @@ root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은
 
-- 화면은 operation만 부른다. data는 bridge(operation의 결과와 event)로만 받는다. network가 없다.
+- 화면은 operation만 부른다. data는 bridge(operation의 결과와 event)로만 받는다. network가 없다. 폰 기능은
+  `@lophn/cap-phone`이 낸다(`phone.use` 선언). 사진, file, 카메라 촬영은 아직 없다.
 - 선언에 없는 operation 이름과 command는 `forbidden`이다.
```
