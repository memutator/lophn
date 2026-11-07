# @lophn/app-ui 2.9.0

Previous: 2.8.0
Breaking: no. Move together with `@lophn/declaration` 4.2.0.

This version only changes the `@lophn/declaration` dependency to 4.2.0, which lets a screen's `tray` size be a range that fits the content (see the `@lophn/declaration` 4.2.0 note). The app-ui API is unchanged.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.8.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.1.0",

// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.9.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.2.0",
```

Change the same two versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.
