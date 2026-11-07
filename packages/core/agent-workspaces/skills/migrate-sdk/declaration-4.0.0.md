# @lophn/declaration 4.0.0

Previous: 3.0.0
Breaking: yes. A release sealed with 3.x (screens with `sizes`) no longer starts; re-release from the migrated source. Move together with `@lophn/app-ui` 2.3.0.

A screen's `sizes` became `places`, and a screen can take `params`.

Before:

```ts
screens: [{ key: "home", label: "Home", path: "/home", sizes: ["full", "panel", "card"] }],
```

After:

```ts
screens: [{ key: "home", label: "Home", path: "/home", places: ["tab", "panel", "card"] }],
```

- Rename `full` to `tab`. The first screen that lists `tab` is the app's entry.
- Other places: `panel` (dock and float windows), `card` (inside an agent conversation), `sidebar` (right sidebar), `tray` (taskbar tray popup). `places` is not empty and has no duplicates.
- Optional `params`: a JSON schema (root type object) of what the screen receives when opened; read it with `usePlace()` from `@lophn/app-ui` 2.4.0 or later. For a part of one screen, make another screen instead of a param.
- Search the app for `sizes` (declaration, tests, `DESIGN.md`) and `ScreenSize` (the type is now `Place`).
