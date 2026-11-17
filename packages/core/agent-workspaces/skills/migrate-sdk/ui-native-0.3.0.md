# @lophn/ui-native 0.3.0

Previous: 0.2.0
Breaking: no. Move together with `@lophn/app-ui-native` 1.5.0 if the app uses it.

Three parts changed how they behave in an app's phone screen. No API was removed or renamed.

- `Sheet` and `Menu` open inside the screen, under lophn's head row, instead of over the whole phone app. lophn can now read and press them when it checks the screen on the person's phone. A sheet reaches over the whole `Screen` wherever in the screen it is opened. The phone's Back button no longer closes it; give the sheet a way to close (dragging down and the scrim still close it).
- `TopBar` draws no left button when it has no `onLeft`. Before, it drew a sidebar button that did nothing in an app screen.
- `Button` `sm` (34) and `md` (42) press at 44: the area you can press reaches above and below the box. They look the same.

lophn draws the head row above every app screen on the phone (the app's mark and name, its menu), as on the desktop. A screen that draws its own `TopBar` shows a second row with the app's name again. Drop it:

```tsx
// Before
import { Group, Row, Screen, TopBar } from "@lophn/ui-native";
<Screen scroll top={<TopBar left="none" title="Orders" />}>
// After
import { Group, Row, Screen } from "@lophn/ui-native";
<Screen scroll>
```

Put what the `TopBar` carried in the body: view tabs (`Tabs`) at the top of the body, the main action in `footer`. Search the screens for `TopBar` and for React Native's `Modal`; replace a `Modal` with a kit `Sheet`.

To move, change the pins in `package.json` and `lophn.ts` (`sdk_dependencies`) in both places, and `@lophn/app-ui-native` with them:

```json
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.0",
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.5.0",
```

Nothing is required of an existing app: a screen built with 0.2.0 keeps opening on a phone app with 0.3.0 and gets the new `Sheet`, `TopBar` and `Button` from the phone. If it draws its own `TopBar`, it keeps showing two head rows until you drop it. A screen built with 0.3.0 does not open on a lophn phone app whose kit is still 0.2.0 (the phone shows "update the lophn app").

## Instruction diff

The lophn instructions for phone screens changed. Update the lophn-managed part of your `AGENTS.md` to match the new lines below if it carries the old ones. From now on: a phone screen's root is `Screen` with no `top`, and the screen draws no `TopBar` or title row of its own; use the kit `Sheet` and `Menu`, never React Native's `Modal`. When you check a screen on the person's phone, a snapshot of a long list has only the rows near the screen (scroll and take a new snapshot), and `type` and `fill` do not press the input (`click` it first when pressing it matters).

```diff
# design-app skill
@@ -231,9 +231,10 @@ Rules:
-- The root is `Screen`. Give it `top={<TopBar left="none" title="Orders" />}`:
-  `TopBar` shows lophn's sidebar button by default (`left="menu"`), and an app
-  screen has no sidebar.
-- A touch target is 44 or more. `Row` and `IconButton` already are. A `Button`
-  is 34 (`sm`) or 42 (`md`) high, so use `size="lg"` (54) for the main action of
-  a screen, and give a `Pressable` of your own `minHeight: 44`. Nothing depends
-  on hover.
+- The root is `Screen`, with no `top`: lophn draws the head row (the app's
+  name and menu), so draw no `TopBar` or title row. View tabs go at the top of
+  the body, the main action in `footer`.
+- `Sheet` and `Menu` open inside the screen. Do not use React Native's `Modal`:
+  it covers all of lophn and the phone tab cannot read it.
+- A touch target is 44 or more. `Row`, `IconButton` and `Button` already are.
+  Use `size="lg"` (54) for a screen's main action, and give a `Pressable` of
+  your own `minHeight: 44`. Nothing depends on hover.
@@ -258,3 +259,3 @@ An example, `src/screens/orders/phone.tsx`:
-import { Group, Row, Screen, TopBar } from "@lophn/ui-native";
+import { Group, Row, Screen } from "@lophn/ui-native";
@@ -274,3 +275,3 @@ export default function Orders() {
-    <Screen scroll tone="floor" top={<TopBar left="none" title="Orders" />} footer={main}>
+    <Screen scroll tone="floor" footer={main}>
# design-app skill, phone-check.md
@@ -50,6 +50,13 @@ placeholder. Put every input in a `Field` with a label so you can find it.
-- A kit `Sheet` or any `Modal` on the screen cannot be read or driven from the
-  phone tab: while one is open the calls are `unavailable` and say something
-  covers the preview. Design the check so the step under test is on the
-  screen itself, and tell the person what you could not check.
+- A kit `Sheet` or `Menu` opens inside the screen: read and drive it like the
+  rest. A React Native `Modal` cannot be read or driven from the phone tab:
+  while one is open the calls are `unavailable` and say something covers the
+  preview. Tell the person what you could not check.
+- A snapshot of a long list (`FlatList`, `SectionList`) has only the rows near
+  the screen, not the whole list. To reach the rows below, `scroll --dy` and
+  take a new snapshot. A cell of a horizontal list that is not drawn yet cannot
+  be reached; `scroll --ref` brings in one that is.
+- `type` and `fill` do not press the input: its `onPress` does not run and the
+  soft keyboard does not open. When pressing the input changes the screen
+  (a button that shows up, a hint), `click` it first and check that.
# @lophn/ui-native guide.md
@@ -166,9 +166,12 @@
-- **화면 root는 `Screen`이다.** 안전 영역, 위 줄(`TopBar`), 본문, 키보드 위로 오르는 아래 줄이 거기서 난다.
+- **화면 root는 `Screen`이고 `top`을 주지 않는다.** 안전 영역, 본문, 키보드 위로 오르는 아래 줄이 거기서 난다.
   `UiProvider`는 폰 앱의 root가 이미 둔다. 화면이 다시 두지 않는다(desktop preview도 같은 진입이 둔다).
-  앱 화면의 `TopBar`는 `left="none"`을 준다. 기본값 `"menu"`는 lophn 폰 앱의 sidebar를 여는 단추인데 앱 화면에는
-  sidebar가 없다.
-- **누르는 곳은 44 이상이다.** `IconButton`·`Row`·`Tabs`는 그렇게 준다. `Button`은 `sm` 34, `md` 42, `lg` 54라서
-  화면의 주 행동은 `lg`를 쓴다. 직접 만드는 `Pressable`도 `minHeight: 44` 아래로 두지 않는다. hover가 없으니
-  hover로만 보이는 설명·단추를 두지 않는다.
+  앱 화면의 머리 줄(앱 mark와 이름, ⋯ menu)은 lophn이 그린다. desktop과 같다. 앱은 `TopBar`나 제목 줄을
+  그리지 않는다(앱 이름이 lophn의 줄 아래에 한 번 더 선다). view 탭은 본문 맨 위, 주 행동은 `footer`에 둔다.
+  `TopBar`는 `onLeft`가 없으면 왼쪽 단추를 그리지 않는다.
+- **`Sheet`·`Menu`는 화면 안에 뜬다**(lophn의 머리 줄 아래). React Native의 `Modal`을 직접 쓰지 않는다. lophn
+  앱 전체를 덮고, phone 탭이 그 안을 읽지도 누르지도 못한다.
+- **누르는 곳은 44 이상이다.** `IconButton`·`Row`·`Tabs`·`Button`은 그렇게 준다. `Button`은 `sm` 34, `md` 42,
+  `lg` 54로 보이지만 눌리는 곳은 위아래로 넓혀 44 이상이다. 화면의 주 행동은 `lg`를 쓴다. 직접 만드는
+  `Pressable`도 `minHeight: 44` 아래로 두지 않는다. hover가 없으니 hover로만 보이는 설명·단추를 두지 않는다.
@@ -216,3 +215,3 @@
-data는 preview의 throwaway data이고, `Sheet`와 `Modal`은 읽지도 누르지도 못한다. 자세한 길은 skill `design-app`의
+data는 preview의 throwaway data이고, `Modal`은 읽지도 누르지도 못한다. 자세한 길은 skill `design-app`의
```
