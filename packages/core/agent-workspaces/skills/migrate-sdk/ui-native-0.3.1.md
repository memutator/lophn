# @lophn/ui-native 0.3.1

Previous: 0.3.0
Breaking: no. Move together with `@lophn/app-ui-native` 1.9.1 if the app uses it.

`Markdown` now formats inline and display TeX math as readable Unicode math (with a toggle to inspect raw TeX) and renders common Mermaid diagrams (`flowchart`, `graph`, `sequenceDiagram`, `stateDiagram`) as native diagram cards (with a toggle to view raw Mermaid source and fallback to a code block for other diagram types). No API changed.

```json
// package.json, before
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.0",
// package.json, after
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.1",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app.
