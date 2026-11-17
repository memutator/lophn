# @lophn/app-ui-native 1.5.0

Previous: 1.4.0
Breaking: no. Move together with `@lophn/ui-native` 0.3.0.

The exact peer is now `@lophn/ui-native` 0.3.0. Nothing else changed in this package's code. See the `@lophn/ui-native` 0.3.0 note: a phone screen no longer draws its own `TopBar` (lophn draws the head row), `Sheet` opens inside the screen, and a `Button` of any size (so an `OperationButton` too) presses at 44.

```json
// package.json, before
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.4.0",
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.2.0",
// after
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.5.0",
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app beyond what the `@lophn/ui-native` 0.3.0 note says.

## Instruction diff

The guide's example drops the screen's own `TopBar`, and the note that `md` is under 44 is gone. Follow the `@lophn/ui-native` 0.3.0 note.

```diff
# @lophn/app-ui-native guide.md
@@ -38,3 +38,3 @@
   - `variant`·`size`는 kit `Button`의 것이다(`primary`·`secondary`·`ghost`·`danger`, `sm`·`md`·`lg`).
-    기본 `md`는 42라 누르는 곳 44에 못 미친다. 화면의 주 행동은 `size="lg"`(54)를 준다.
+    화면의 주 행동은 `size="lg"`(54)를 준다.
@@ -52,3 +52,4 @@
 `useTabHead`·`useCommand`·`useProjects`·`useKeepAlive`·`AppErrorBoundary`는 없다. 폰에 그 bridge가 없고,
-root의 오류 경계는 폰 앱의 base가 둔다.
+root의 오류 경계는 폰 앱의 base가 둔다. 폰 화면의 머리 줄은 lophn이 그리고 앱은 머리 줄을 그리지 않는다
+(`@lophn/ui-native` guide의 폰 규칙).
@@ -102,3 +103,3 @@
-import { Group, Row, Screen, Text, TopBar } from "@lophn/ui-native";
+import { Group, Row, Screen, Text } from "@lophn/ui-native";
@@ -129,3 +130,3 @@
-    <Screen scroll top={<TopBar left="none" title="Orders" />}>
+    <Screen scroll>
```
