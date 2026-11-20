# @lophn/app-ui 2.22.1

Previous: 2.22.0
Breaking: no. Move together with `@lophn/ui` 1.2.0.

Pins `@lophn/ui` 1.2.0 (which adds `MachineSelector` to `@lophn/ui/input`). Nothing else changed in this package.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.22.0",
"@lophn/ui": "file:.lophn/sdk/ui/1.1.0",
// package.json, after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.22.1",
"@lophn/ui": "file:.lophn/sdk/ui/1.2.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
