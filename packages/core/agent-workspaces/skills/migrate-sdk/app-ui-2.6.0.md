# @lophn/app-ui 2.6.0

Previous: 2.5.0
Breaking: no

No API change. What changed is where lophn draws `useTabHead`. Before, only an app screen tab and an app panel tab drew it; everywhere else `useTabHead` returned `false`. Now lophn draws the head in every frame it puts around a screen, and `useTabHead` returns `true` there:

- app screen tab and app panel tab (docked)
- app panel float (desk float and global float): in the float bar, beside the title and the pin, minimize, dock and close buttons
- app sidebar panel: in the panel head row, right of the title
- tray popup: in the popup head, between the title and the pin button
- chat app card: at the end of the card's chrome row

The back and forward arrows (`nav`) are drawn only in a tab. `useTabHead` returns `false` only in the dedicated app window.

## What to change

Stop drawing your own header row. In each screen, delete the title bar, the refresh button row and any status line that sits in a header of your own, and move what they carry into `useTabHead`:

- state text, such as "3 open" or "Updated 2 min ago", goes in `status`
- the screen's main action goes in `actions` (`primary` for the main one)
- less common actions go in `menu`
- view switches go in `tabs`

Where the places are narrow (tray, sidebar, float), put `status` and one or two `actions` in the head; leave `crumbs` and `tabs` to the tab. Draw something yourself only when `useTabHead` returns `false` (the dedicated app window), and then only the minimum.

```tsx
// before: the screen draws its own header
<AppShell title="Orders" actions={<Button onClick={refresh}>Refresh</Button>}>
  <p>{open} open</p>
  ...
</AppShell>

// after: lophn draws the head in tab, panel, sidebar, tray and card
const inHead = useTabHead(
  { status: `${open} open`, actions: [{ id: "refresh", label: "Refresh" }] },
  { onAction: (id) => id === "refresh" && refresh() },
);
<AppShell {...(inHead ? {} : { title: "Orders", actions: <Button onClick={refresh}>Refresh</Button> })}>
  ...
</AppShell>
```

Nothing breaks if you do not migrate. An old screen that draws its own header still works; in tray, sidebar, float and card it just shows two header rows (yours and lophn's frame).

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, replace the lines that came from the template with the new template lines below (the `useTabHead` bullet). If the app edited that part, keep the app's own additions and make the `useTabHead` bullet say the same as the new one.
- From now on, do not draw a header row of your own in a new screen; put status and the main action in `useTabHead`.

```diff
# design-app skill
@@ -103,7 +103,7 @@ kit does the job, and style it with the token variables.
   the tab title when a screen is opened as a panel. Do not repeat it.
-- One header row per screen. What changes the whole view, such as the period,
-  the view mode or the main action, goes in that row. Do not stack bars.
-- A screen opened as a lophn tab already has lophn's head row above it. Put the
-  screen's view tabs, status and main action in that row with `useTabHead` from
-  `@lophn/app-ui`, and draw them yourself only where it returns false.
+- Do not draw a header row of your own (title bar, refresh button row).
+  lophn draws a head row wherever it frames a screen: tab, panel (dock, float),
+  sidebar, tray and chat card. Put the screen's view tabs, status and main
+  action in it with `useTabHead` from `@lophn/app-ui`, and draw the minimum
+  yourself only where it returns false (the dedicated app window).
 - Show what the journeys need. No heading that restates another, no text that

# app template AGENTS.md
@@ -32,5 +32,5 @@ Package를 쓴다.
   bridge component(OperationButton, useOperation, AppErrorBoundary, useTabHead)는 `@lophn/app-ui`다.
-- 화면이 lophn 탭으로 열리면 그 위에 lophn 탭 머리 줄(← →, 앱 이름, ⋯ 메뉴)이 이미 있다.
+- lophn은 탭, panel(dock·float), sidebar, tray, 세션 카드 어디에서나 화면 위에 자기 머리 줄을 그린다.
   화면의 보기 탭·상태 글·주 행동은 `useTabHead`로 그 줄에 올리고, `AppShell`의 `title`·`actions`는
-  `useTabHead`가 false를 돌려줄 때(앱 창, 떠 있는 패널, 세션 카드)만 준다. 자기 머리 줄을 따로 쌓지 않는다.
+  `useTabHead`가 false를 돌려줄 때(앱 전용 창)만 최소로 준다. 자기 머리 줄(제목 줄, 새로 고침 줄)을 그리지 않는다.
 - 앱 화면에서 agent와 이야기할 때는 `@lophn/agent`다(`useAgentSession`, `contextBlock`,

# @lophn/app-ui guide.md
@@ -49,16 +49,20 @@ import {
   값이 없으면(앱 view 밖) en이다. 앱 자기 화면의 문구는 앱이 그대로 쓴다.
-- `useTabHead(head, handlers?, app?)` — 화면이 lophn 탭(앱 화면 탭, 앱 panel
-  탭)으로 열렸을 때 그 탭의 머리 줄(← →, 경로, ⋯ 메뉴가 있는 줄)에 `head`를
-  올린다. 앱 머리 줄과 lophn 머리 줄이 두 줄로 쌓이지 않게 한다.
+- `useTabHead(head, handlers?, app?)` — 화면이 열린 lophn 프레임의 머리 줄에
+  `head`를 올린다. lophn이 앱 화면을 감싸는 모든 곳(앱 화면 탭, 앱 panel 탭과
+  dock·desk float·전역 float, 앱 sidebar panel, tray popup, 세션 앱 카드)이
+  머리 줄을 그린다. 자기 머리 줄(제목 줄, 새로 고침 단추 줄)을 따로 그리지 않는다.
+  화면의 상태 글과 주 행동은 여기에 올린다.
   - `head`는 글과 id뿐이다. `crumbs`(앱 이름 뒤 경로), `tabs`(`{items,
-    selected}`, 경로 뒤 탭), `status`(오른쪽 상태 글), `actions`(⋯ 앞 단추.
+    selected}`, 경로 뒤 탭), `status`(상태 글), `actions`(⋯ 앞 단추.
     `primary`·`busy`·`disabled`), `menu`(⋯ 메뉴 맨 위 묶음), `nav`(`{canBack,
-    canForward}`. 주면 ← →가 앱 안의 뒤로·앞으로가 된다). 항목은 `{id, label}`
-    이고 글은 80자, 항목은 24개까지 보인다. 아이콘과 React 요소는 싣지 못한다.
+    canForward}`. 주면 ← →가 앱 안의 뒤로·앞으로가 된다. ← →는 앱 화면 탭에만
+    있고 다른 자리는 그리지 않는다). 항목은 `{id, label}`이고 글은 80자,
+    항목은 24개까지 보인다. 아이콘과 React 요소는 싣지 못한다. 좁은 자리(tray,
+    sidebar, float)는 `crumbs`·`tabs`보다 `status`와 `actions` 몇 개를 올린다.
   - `handlers`는 `onTab(id)`·`onAction(id)`·`onMenu(id)`·`onBack()`·
     `onForward()`다.
-  - 돌려주는 값은 lophn이 지금 그 머리 줄을 그리는지다. 앱 창, 떠 있는 패널,
-    세션 카드처럼 머리 줄이 없는 곳이면 false이고, 화면이 같은 조작을 스스로
-    그린다. `null`이나 화면이 사라지면 내린다. `head`는 값이 바뀔 때만 다시
-    올린다.
+  - 돌려주는 값은 lophn이 지금 그 머리 줄을 그리는지다. 앱 전용 창처럼 lophn
+    프레임의 머리 줄이 없는 곳이면 false이고, 그때만 화면이 꼭 필요한 조작을
+    스스로 그린다(최소한으로). `null`이나 화면이 사라지면 내린다. `head`는 값이
+    바뀔 때만 다시 올린다.
 - `usePlace()` — 이 화면이 열릴 때 정해진 `{place, params, workspace}`다. 읽기만
```
