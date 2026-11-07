# @lophn/app-ui 2.8.0

Previous: 2.7.0
Breaking: no. Move together with `@lophn/declaration` 4.1.0.

This version only changes the `@lophn/declaration` dependency to 4.1.0, which adds the optional `tray` size on a screen (see the `@lophn/declaration` 4.1.0 note). The app-ui API is unchanged.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.7.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.0.0",

// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.8.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.1.0",
```

Change the same two versions in `lophn.ts` (`sdk_dependencies`). Nothing else is required of an existing app.
