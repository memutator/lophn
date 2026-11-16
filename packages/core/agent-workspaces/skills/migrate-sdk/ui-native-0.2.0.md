# @lophn/ui-native 0.2.0

Previous: 0.1.0
Breaking: no. Move together with `@lophn/app-ui-native` 1.2.0 if the app uses it.

`Input` now names itself for accessibility: the `label` of the `Field` around it, or its `placeholder` when it is not inside a `Field`. Before, the name was the placeholder only. When lophn drives a phone screen on the person's phone, it finds an input by this name, so give every input on a phone screen a `Field` label (a placeholder alone still works but is a hint, not a name). A secure input is named the same way; its value is never the name.

```tsx
// Before: the input is found as "type here"
<Input value={title} onChangeText={setTitle} placeholder="type here" />
// After: the input is found as "Title"
<Field label="Title">
  <Input value={title} onChangeText={setTitle} placeholder="type here" />
</Field>
```

To move, change the pins in `package.json` and `lophn.ts` (`sdk_dependencies`) in both places, and `@lophn/app-ui-native` with them:

```json
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.2.0",
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.2.0",
```

Nothing is required of an existing app: no API changed, so existing screens build and look the same. Add a `Field` label around inputs that have none when you next touch the screen.

A screen built with 0.2.0 does not open on a lophn phone app whose kit is still 0.1.0 (the phone shows "update the phone app"). A screen built with 0.1.0 keeps opening on a phone app with 0.2.0.
