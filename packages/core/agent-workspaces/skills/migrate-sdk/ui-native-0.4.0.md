# @lophn/ui-native 0.4.0

Previous: 0.3.1
Breaking: no. Move together with `@lophn/app-ui-native` 1.9.2 if the app uses it.

Adds `MachineSelector` (along with `type MachineSelectorProps`, `type MachineOption`, and `type MachineOptionStatus`) to `@lophn/ui-native` so phone screens can branch or filter views by computer using the same API as `@lophn/ui/input`.

- `variant="select"` (default): pressable trigger that opens a kit `Sheet` with status dots (`online`, `offline`, `connecting`, `update`), optional `current` tag, and `detail` subtitle.
- `variant="pills"`: horizontal scrolling row of selectable machine chips with 44pt touch targets.
- `allowAll` + `allLabel`: optional "All machines" (`value === null`) choice.

```tsx
import { MachineSelector, type MachineOption } from "@lophn/ui-native";

const machines: MachineOption[] = [
  { id: "mch_a", name: "Studio", status: "online", current: true },
  { id: "mch_b", name: "Home server", status: "online", detail: "Direct" },
];

<MachineSelector
  allowAll
  variant="pills"
  machines={machines}
  value={selected}
  onValueChange={setSelected}
/>;
```

```json
// package.json, before
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.1",
// package.json, after
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.4.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app; a screen built with 0.4.0 requires a lophn phone app carrying `@lophn/ui-native` 0.4.0 or newer.

## Instruction diff

`@lophn/ui-native`'s `guide.md` now lists `MachineSelector` under `input` and pins `0.4.0`.

```diff
# @lophn/ui-native guide.md
@@ -71,2 +71,3 @@
 - `Chip`: A quiet pick in the composer's bottom row (model, workspace) that opens a sheet.
 - `Pill`: An outlined pick with a chevron: the computer in the top bar, the workspace of a new session.
+- `MachineSelector`: Picks a computer (or all machines) to scope a view: a sheet trigger by default, or horizontal pills.
@@ -146,3 +147,3 @@
-  "@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.1",
+  "@lophn/ui-native": "file:.lophn/sdk/ui-native/0.4.0",
@@ -159,2 +160,2 @@
-앱 `lophn.ts`의 `sdk_dependencies`에도 같은 판을 적는다: `{ name: "@lophn/ui-native", version: "0.3.1" }`.
+앱 `lophn.ts`의 `sdk_dependencies`에도 같은 판을 적는다: `{ name: "@lophn/ui-native", version: "0.4.0" }`.
```
