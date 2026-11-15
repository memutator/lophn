# @lophn/app-ui-native 1.0.0

Previous: none
Breaking: no

New SDK part: the hooks and the operation button for phone screens (`src/screens/<key>/phone.tsx`, `places: ["phone"]` in the declaration). It is separate from `@lophn/app-ui`, which stays the SDK for desktop screens (`main.tsx`); never mix them in one screen. It exports `OperationButton`, `useOperation`, `appBridge`, `useEvent`, `usePlace` and their types. `useTabHead`, `useCommand`, `useProjects`, `useKeepAlive` and `AppErrorBoundary` do not exist here: the phone has no such bridge, and the phone app owns the root error boundary.

To call operations from a phone screen, pin this version next to `@lophn/ui-native` (see `ui-native-0.1.0.md`) in both places. It goes in `devDependencies`, like the kit.

`package.json`:

```json
"devDependencies": {
  "@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.0.0"
}
```

`lophn.ts`:

```ts
sdk_dependencies: [
  // ...the entries the app already has
  { name: "@lophn/app-ui-native", version: "1.0.0" },
],
```

Use it in `phone.tsx`:

```tsx
import { Screen, TopBar } from "@lophn/ui-native";
import { OperationButton, usePlace } from "@lophn/app-ui-native";

export default function Orders() {
  const { params } = usePlace();
  return (
    <Screen top={<TopBar left="none" title="Orders" />}>
      <OperationButton
        operation={{ name: "archive-shipped", title: "Archive shipped" }}
        input={{ status: params.status ?? "open" }}
      />
    </Screen>
  );
}
```

The screen only calls operations the declaration lists (any other name is `forbidden`) and gets data through the bridge: operation results and events listed in the declaration's `subscriptions`. There is no network.

Nothing is required of an existing app: an app without phone screens does not need this part and keeps working as is.

## Instruction diff

There is no diff to apply: this is the first version of the guide. When a phone screen calls operations or reads events, read the installed `.lophn/sdk/app-ui-native/1.0.0/guide.md` (or `lophn package read @lophn/app-ui-native`) first.
