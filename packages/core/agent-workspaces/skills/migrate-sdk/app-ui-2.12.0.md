# @lophn/app-ui 2.12.0

Previous: 2.11.0
Breaking: no. Release prepare now rejects two mistakes in the committed source, so an app that has them must fix them before its next release.

No API changed. Release prepare now fails when:

- a `.tsx` or `.jsx` screen puts the HTML `title` attribute on a lowercase element (`<button title="Save">`, `<span title={x}>`). The browser draws its own tooltip. Use `Tooltip` from `@lophn/ui/overlay`. `<iframe title>` is allowed, and so is `title` on a capitalized component (`<Card title="…">`).
- a `useTabHead` action in a file that imports `@lophn/app-ui` has `icon: "<name>"` with a name outside `refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`, `stop`, `download`. lophn used to drop such a name silently.

```tsx
// before
<button type="button" onClick={copy} title="Copy">
  <CopyIcon />
</button>
useTabHead({ actions: [{ id: "reload", label: "Reload", icon: "reload" }] });

// after
import { Tooltip } from "@lophn/ui/overlay";

<Tooltip content="Copy">
  <button type="button" onClick={copy}>
    <CopyIcon />
  </button>
</Tooltip>
useTabHead({ actions: [{ id: "reload", label: "Reload", icon: "refresh" }] });
```

Search the app's `src/` for `title=` on lowercase elements and for `icon:` inside `actions` arrays.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.11.0",

// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.12.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app, but its next release is refused until the two mistakes above are gone.

## Instruction diff

lophn changed the instruction text it gives app agents in this version. Update your own habits:

- A hover hint is `Tooltip` from `@lophn/ui/overlay`, never the HTML `title` attribute.
- A tab-head action `icon` is one of the listed names only.
- The app's `AGENTS.md` does not change in this version.

```diff
# design-app skill
@@ -111,2 +111,5 @@ kit does the job, and style it with the token variables.
 - The same thing sits in the same place on every screen.
+- A hover hint is `Tooltip` from `@lophn/ui/overlay`. Never the HTML `title`
+  attribute: the browser draws its own tooltip, and release prepare rejects it
+  (`<iframe title>` is the one exception).
 - Spacing, type size and color come from the token variables. Do not invent
# @lophn/app-ui guide.md
@@ -65,3 +65,4 @@ import {
     `refresh`, `add`, `open`, `edit`, `delete`, `copy`, `run`, `stop`,
-    `download`. 모르는 이름은 무시하고 글 단추로 그린다. **tray popup의 머리
+    `download`. 모르는 이름은 무시하고 글 단추로 그리고, release 준비는 목록에 없는
+    이름의 `icon`을 거절한다. **tray popup의 머리
     줄은 `actions`만 아이콘 단추로 그린다**(label은 tooltip). `status`·`crumbs`·
@@ -201,2 +202,5 @@ return (
 
+hover 설명은 `@lophn/ui/overlay`의 `Tooltip`으로 만든다. HTML `title` 속성은 쓰지
+않는다(브라우저 기본 tooltip이 뜬다. release 준비가 거절한다. `<iframe title>`만 예외다).
+
 자리마다 다른 꼴로 그리고, 크기는 자리가 아니라 CSS container query로 맞춘다.
```
