# @lophn/ui-native 0.1.0

Previous: none
Breaking: no

New SDK part: the phone UI kit for phone screens (`src/screens/<key>/phone.tsx`, `places: ["phone"]` in the declaration). It is separate from `@lophn/ui`, which stays the kit for desktop screens (`main.tsx`); never mix them in one screen.

To write a phone screen, pin this version in both places and add its peers. All of them go in `devDependencies` (the phone app already carries the kit, and release preparation drops `devDependencies` from the bundle; a kit in `dependencies` makes preparation refuse).

`package.json`:

```json
"devDependencies": {
  "@lophn/ui-native": "file:.lophn/sdk/ui-native/0.1.0",
  "@types/react": "19.3.0",
  "expo-clipboard": "58.0.4",
  "lucide-react-native": "1.73.0",
  "react-dom": "19.3.0",
  "react-native": "0.88.1",
  "react-native-keyboard-controller": "1.22.7",
  "react-native-safe-area-context": "5.11.1",
  "react-native-svg": "15.16.0",
  "react-native-web": "0.21.2"
}
```

`lophn.ts`:

```ts
sdk_dependencies: [
  // ...the entries the app already has
  { name: "@lophn/ui-native", version: "0.1.0" },
],
```

The two places must hold the same version. Add `@lophn/app-ui-native` the same way when the screen calls operations. `@lophn/ui-native` also needs `react` 19.3.0 and `@lezer/markdown` 1.7.2, which the app template already has in `dependencies`.

Nothing is required of an existing app: an app without phone screens does not need this part and keeps working as is.

## Instruction diff

There is no diff to apply: this is the first version of the guide. When the app gets a phone screen, read the installed `.lophn/sdk/ui-native/0.1.0/guide.md` (or `lophn package read @lophn/ui-native`) first: it lists every kit piece, the phone rules (44 or larger touch targets, no hover, drawn for the registered reference phone's width with no responsive layout, `Screen` as the root, only the listed host modules, no network) and how to check the screen in the desktop preview.
