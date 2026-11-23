# Phone native capabilities, app files, and cross-machine sync

Breaking: no
Areas: app, home

Apps can now use native phone capabilities, store and display immutable app
files, run offline-capable phone backends, and sync tables and events across the
person's computers.

## What is newly possible

- **Phone native capabilities (`@lophn/cap-phone`)**: declare `phone.use` per
  capability for location, network state, haptics, clipboard read/write, QR and
  barcode scanning, opening links, share sheet, camera photo capture, photo/file
  pickers, and sharing app files. Phone screens (`@lophn/ui-native`,
  `@lophn/app-ui-native`) can use all capabilities; computer backends can call
  location and network state while the phone app is in front.
- **Immutable app files (`@lophn/cap-store`)**: camera capture and photo/file
  pickers return small JSON file handles (`{ file, type, size, ... }`), never
  raw bytes. Store handles in rows, display them with `useAppFile` on desktop or
  phone screens, and read/create bytes on computer backends with `readAppFile`
  and `putAppFile`.
- **Phone widgets & `runs_on` backends**: declare glanceable phone home-screen
  widgets (`setWidget` via `@lophn/cap-notify`) and optional offline-capable
  phone backends (`runs_on: ["computer", "phone"]` or `["phone"]`).
- **Cross-computer `sync` & `across_machines` events**: declare per-table `sync`
  (prefer `"computers"`, handle `lophn` `data.changed`) and mark declared events
  with `across_machines: true` when other computers running the same release
  should receive them.

## When to adopt

Only propose these for existing active apps where they deliver concrete value
(for example, adding QR scanning, receipt photo capture, a phone widget, or
cross-computer table sync to an app the person already uses). If there are no
matching active apps, do not ask—mention this briefly in the one-line summary at
the end of `/update`.

## Instruction diff

Remove stale notes claiming apps cannot access phone camera/scanner/clipboard/
files, cannot sync selected tables across computers, or cannot send events
across machines:

- Edit agent-owned `memory.md` (`agent.memory`) and generated skills directly
  and report what changed.
- For person-owned `LOPHN.md`, propose edits only; never edit it directly.
