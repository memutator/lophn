# @lophn/ui 1.2.0

Previous: 1.1.0
Breaking: no. Move together with `@lophn/app-ui` 2.22.1 if the app uses it.

Adds `MachineSelector` (along with `type MachineSelectorProps`, `type MachineOption`, and `type MachineOptionStatus`) to `@lophn/ui/input` so apps can cleanly scope or branch views by computer.

- `variant="select"` (default): compact dropdown with computer icon, semantic status dot (`online`, `offline`, `connecting`, `update`), optional `current` tag, and optional `detail` subtitle. Works inside `Field` or standalone with `ariaLabel`.
- `variant="pills"`: inline horizontal chip row for quick switching across 2–4 machines.
- `allowAll` + `allLabel`: optional "All machines" (`value === null`) choice for filtering across machines.

```tsx
import { MachineSelector, type MachineOption } from "@lophn/ui/input";

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
"@lophn/ui": "file:.lophn/sdk/ui/1.1.0",
// package.json, after
"@lophn/ui": "file:.lophn/sdk/ui/1.2.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
