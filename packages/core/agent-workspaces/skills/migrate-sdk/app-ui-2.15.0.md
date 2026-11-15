# @lophn/app-ui 2.15.0

Previous: 2.14.1
Breaking: no. Move together with `@lophn/declaration` 4.6.0.

The exact peer dependency is now `@lophn/declaration` 4.6.0, and the `Place` type that `usePlace()` returns gains `"phone"` (a screen drawn by the lophn phone app). Desktop screens never open in `phone`, so existing `place === ...` checks keep working. See the `@lophn/declaration` 4.6.0 note for the declaration change.

```json
// package.json, before
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.14.1",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.5.1",
// after
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.15.0",
"@lophn/declaration": "file:.lophn/sdk/declaration/4.6.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`). If your code has an exhaustive `switch` over `Place` that fails to compile, add a `"phone"` case. Nothing else is required of an existing app; existing supported SDK versions remain supported.
