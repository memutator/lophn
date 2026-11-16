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

## Instruction diff

Use `getLocation` only from app code (never a screen). Treat `unavailable` as the normal case: show the person the next step and never loop or block on it. The `design-app` skill gained these rules (the SDK guide is new in this version, so read it with `lophn package read @lophn/cap-phone`):

```diff
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -299,2 +299,8 @@ tell the person.
 
+## Widgets and phone location
+
+When the app should show a value on the person's phone home screen (`widgets`)
+or read their location from the phone (`phone.use`), read the bundled file with
+`skill.read({ name: "design-app", path: "phone-features.md" })` first.
+
 ## Talking to an agent from a screen
--- /dev/null
+++ b/packages/core/agent-workspaces/skills/design-app/phone-features.md
@@ -0,0 +1,32 @@
+# Phone location
+
+An app can read the person's location from their phone, once per call. Use it
+only for something the person asks for (near me, the trip they are on). There is
+no background or continuous location.
+
+1. Declare `{ kind: "phone.use", scope: { capability: "location.get" },
+   reason: "<why, in the person's words>" }` in `permissions` and
+   `@lophn/cap-phone` in `sdk_dependencies`. The person allows it once when the
+   release is activated, and the phone asks for its OS location permission on
+   the first use. Read the `@lophn/cap-phone` guide.
+2. Call `getLocation({ accuracy?, maxAgeMs? })` from the app's code (a command,
+   an operation or start code), never from a screen. It returns
+   `{ lat, lon, accuracyM, at }`. `accuracy: "high"` can take several seconds;
+   use the default unless you need it. Set `maxAgeMs` when a position a minute
+   old is enough.
+3. The phone answers only while the lophn app is in front on the phone. So
+   `unavailable` is the normal case, not a bug: `reason` is `phone_in_background`,
+   `phone_unreachable`, `no_phone`, `unsupported`, `location_off` or `timeout`.
+   Handle it by showing the person the next step ("Open lophn on your phone"),
+   and call again only when they ask (a button, the next run). Do not retry in a
+   loop and do not make a screen or a command wait for a location it cannot get:
+   the rest of the app works without it.
+4. `forbidden` with `reason: "os_permission_denied"` means the person refused
+   location on the phone; tell them to allow it in the phone's settings. A
+   `forbidden` without that reason means the `phone.use` permission is not
+   granted.
+5. In the preview and tests the call returns a fixed stand-in position
+   (`standIn: true`), so you cannot see a real location there. Say so when you
+   report, and that the person makes the last check on their phone.
+6. Write the use under Model or Journeys in DESIGN.md, including what the app
+   does when there is no location.
```
