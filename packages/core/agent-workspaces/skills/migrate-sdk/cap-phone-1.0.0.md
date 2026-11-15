# @lophn/cap-phone 1.0.0

Previous: none
Breaking: no

Initial version: `getLocation({ accuracy?, maxAgeMs? })` reads the person's location once from their primary phone (needs the `phone.use` permission in the declaration). The phone answers only while the lophn phone app is in front; handle `CapabilityError` with code `unavailable` by showing the person a next step ("Open lophn on your phone") and do not retry in a loop.

```ts
import { getLocation } from "@lophn/cap-phone";

const { lat, lon, accuracyM } = await getLocation({ accuracy: "balanced" });
```

Declare the dependency and the permission in `lophn.ts`:

```ts
sdk_dependencies: [{ name: "@lophn/cap-phone", version: "1.0.0" }],
permissions: [
  { kind: "phone.use", scope: { capability: "location.get" }, reason: "Find places near the person" },
],
```

Nothing is required of an existing app.
