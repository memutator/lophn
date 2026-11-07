# @lophn/app-ui 2.7.0

Previous: 2.6.0
Breaking: no

`useTabHead` actions take an optional `icon`, and the tray popup head now shows only the `actions`, as icon buttons (the label is the tooltip). The tray popup no longer draws `status`, `crumbs`, `tabs` or the menu, so anything a tray screen puts only in those is not visible there.

`icon` is one of `refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`, `stop`, `download` (type `TabHeadIcon`). lophn draws its own icon for the name. An unknown name is ignored and the action stays a text button. In the tab, panel, sidebar and card heads the icon is drawn in front of the label.

```tsx
// before
useTabHead(
  { status: "Updated 2 min ago", actions: [{ id: "refresh", label: "Refresh" }] },
  { onAction: (id) => id === "refresh" && refresh() },
);

// after: the tray popup shows one refresh icon button
useTabHead(
  {
    status: "Updated 2 min ago",
    actions: [{ id: "refresh", label: "Refresh", icon: "refresh" }],
  },
  { onAction: (id) => id === "refresh" && refresh() },
);
```

Nothing is required of an existing app. Without `icon`, the tray popup shows the action as a small text button, and its `status` is no longer shown there. For a `tray` screen, give the one or two actions that matter at a glance (such as refresh) an `icon` and put them first, and keep the screen itself compact.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits and your app's `AGENTS.md`:

- In the app's `AGENTS.md`, replace the lines that came from the template with the new template line below (the added `tray` line under the `useTabHead` bullet). If the app edited that part, keep the app's own additions and add the same `tray` line.
- From now on, a `tray` screen is a glanceable status and stays compact. Its head shows only `useTabHead` actions as icon buttons, so give the important one or two actions an `icon` and put them first.

```diff
# design-app skill
@@ -129,3 +129,7 @@ Each screen declares `places`. They decide where people can open it:
 - `tray`: the taskbar tray popup. Shown as soon as the app declares it; the
-  person can turn it off in Settings.
+  person can turn it off in Settings. A `tray` screen is a glanceable status,
+  so keep the screen itself compact. lophn's popup head shows only the
+  `useTabHead` actions, as icon buttons (no status, crumbs, tabs or menu): give
+  the one or two actions that matter at a glance, such as refresh, an `icon`
+  and put them first.
 

# app template AGENTS.md
@@ -35,2 +35,3 @@ Package를 쓴다.
   `useTabHead`가 false를 돌려줄 때(앱 전용 창)만 최소로 준다. 자기 머리 줄(제목 줄, 새로 고침 줄)을 그리지 않는다.
+  `tray` 화면의 머리 줄은 `actions`만 아이콘 단추로 그리니, 한눈에 필요한 한두 개(예: 새로 고침)에 `icon`을 주고 맨 앞에 둔다.
 - 앱 화면에서 agent와 이야기할 때는 `@lophn/agent`다(`useAgentSession`, `contextBlock`,

# @lophn/app-ui guide.md
@@ -59,4 +59,13 @@ import {
     있고 다른 자리는 그리지 않는다). 항목은 `{id, label}`이고 글은 80자,
-    항목은 24개까지 보인다. 아이콘과 React 요소는 싣지 못한다. 좁은 자리(tray,
-    sidebar, float)는 `crumbs`·`tabs`보다 `status`와 `actions` 몇 개를 올린다.
+    항목은 24개까지 보인다. React 요소는 싣지 못하고 아이콘은 이름으로만
+    준다(아래 `icon`). 좁은 자리(sidebar, float)는 `crumbs`·`tabs`보다
+    `status`와 `actions` 몇 개를 올린다.
+  - `actions` 항목의 `icon`은 lophn이 자기 아이콘으로 그리는 이름이다:
+    `refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`, `stop`,
+    `download`. 모르는 이름은 무시하고 글 단추로 그린다. **tray popup의 머리
+    줄은 `actions`만 아이콘 단추로 그린다**(label은 tooltip). `status`·`crumbs`·
+    `tabs`·`menu`는 tray에서 그리지 않는다. 그러니 한눈에 필요한 한두 개
+    (예: 새로 고침)를 `actions` 맨 앞에 `icon`과 함께 준다. `icon`이 없는
+    단추는 작은 글 단추로 남는다. 다른 자리(탭, panel, sidebar, 카드)는 label
+    글 앞에 아이콘을 붙인다.
   - `handlers`는 `onTab(id)`·`onAction(id)`·`onMenu(id)`·`onBack()`·
```
