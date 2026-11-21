# @lophn/cap-phone 1.1.0

Previous: 1.0.0
Breaking: no. Move together with `@lophn/declaration` 4.13.0 when you declare the new capabilities (the older declaration refuses them).

Phone screens (and a backend that runs on the phone) now use phone features through this package: the request goes straight to the person's phone, so it works with the computer off. New functions: `getNetwork()`, `playHaptic(kind)`, `readClipboard()`, `writeClipboard(text)`, `scanCode()`, `openLink(url)`, `shareText(text, { title? })`, and `getPhoneAccess()` (what is usable now, to hide a button). `getLocation` also works in a phone screen. From the computer's backend only `getLocation` and `getNetwork` work; the others are `unavailable` there. Calls answer only while the lophn phone app is in front (`unavailable`, `reason: "phone_in_background"` otherwise). In a backend that runs on the phone an operation must finish within 3 seconds, so call the slow or UI ones (`getLocation`, `scanCode`, `shareText`, `openLink`) from the screen and pass the result to an operation; `getNetwork`, `playHaptic` and the clipboard are fine inside one. `getPhoneAccess()` is read when the screen opens and does not change while it stays open. Every result carries `standIn: true` in the preview, and in both previews (the desktop's and the phone's) a capability the app did not declare is `forbidden` like live. Errors are `CapabilityError` as before; `conflict` means a scanner is already open.

```ts
import { getPhoneAccess, scanCode, writeClipboard } from "@lophn/cap-phone";

if (getPhoneAccess().capabilities.includes("code.scan")) {
  const scan = await scanCode(); // { cancelled: true } when the person closes the scanner
  if (!scan.cancelled) await writeClipboard(scan.text);
}
```

Declare one `phone.use` permission for each capability you use (`reason` is required), and bump the dependency:

```ts
sdk_dependencies: [{ name: "@lophn/cap-phone", version: "1.1.0" }],
permissions: [
  { kind: "phone.use", scope: { capability: "code.scan" }, reason: "Read a code to add it" },
  { kind: "phone.use", scope: { capability: "clipboard.write" }, reason: "Copy what the code says" },
],
```

Nothing is required of an existing app: `getLocation` behaves as before. A phone screen that imports this package is built into the screen with the rest of its code. Photos, files, camera capture, audio, contacts, calendar, fingerprint, sensors and background work still do not exist.

## Instruction diff

The phone features are now a table, not only location. Each capability needs its own `phone.use` declaration with a reason; phone screens can use all of them, the computer's backend only location and network state; `forbidden` and `unavailable` are normal and the app shows the person what to do; `scanCode` can come back `cancelled`; a phone-run operation must stay under 3 seconds, so slow or UI capabilities are called from the screen; the preview returns stand-in values and both previews refuse an undeclared capability with `forbidden` (add it to the declaration); there is still no network in a screen. The `design-app` skill and the app prompt changed:

```diff
--- a/packages/core/agent-workspaces/prompts/app.md
+++ b/packages/core/agent-workspaces/prompts/app.md
@@ -116,6 +116,10 @@ information). Use `lophn app link-source` only for an existing git repo with a c
   "Widgets", and the `@lophn/cap-notify` guide).
-- When the app needs the person's location from their phone, declare `phone.use`
-  and read the skill `design-app`, "Phone location", and the `@lophn/cap-phone`
-  guide. It answers only while the lophn phone app is in front, so handle
-  `unavailable`.
+- When the app needs the person's phone (location, network state, vibration,
+  clipboard text, a QR or barcode scan, opening a link, the share sheet), declare
+  `phone.use` once per capability and read the skill `design-app`, "Phone
+  features", and the `@lophn/cap-phone` guide. A phone screen can use all of
+  them; the computer's backend only location and network state, and only while
+  the lophn phone app is in front. Handle `forbidden` and `unavailable`, the
+  preview returns stand-in values, and photos, files, camera capture and
+  background work do not exist.
 - When the app must tell other apps that something happened (one fact, many
--- a/packages/core/agent-workspaces/skills/design-app/SKILL.md
+++ b/packages/core/agent-workspaces/skills/design-app/SKILL.md
@@ -236,10 +236,9 @@ Rules:
   `Modal`: it covers lophn and the phone tab cannot read it.
-- A touch target is 44 or more. `Row`, `IconButton` and `Button` already are.
-  Use `size="lg"` (54) for a screen's main action, and give a `Pressable` of
-  your own `minHeight: 44`. Nothing depends on hover.
-- Text sits in `Text`, with its `variant` and `tone`; do not set `fontSize`
-  (the person's text scale applies). Chrome takes its colors from `useTheme()`,
-  not from color values. The kit gives the fonts.
-- Native modules come only from this list, imported by their package name (no
-  sub-path such as `react-native/...`): `react`, `react/jsx-runtime`,
+- A touch target is 44 or more (`Row`, `IconButton`, `Button` already are;
+  `size="lg"` is 54, for the main action). Give your own `Pressable`
+  `minHeight: 44`. Nothing depends on hover.
+- Text sits in `Text` (its `variant` and `tone`; no `fontSize`: the person's
+  text scale applies). Colors come from `useTheme()`, fonts from the kit.
+- Native modules come only from this list, imported by package name (no
+  sub-path like `react-native/...`): `react`, `react/jsx-runtime`,
   `react-native`, `react-native-svg`, `react-native-safe-area-context`,
@@ -253,3 +252,4 @@ Rules:
   the declaration must list them. Images are the kit's `Icon` and `data:`
-  URIs.
+  URIs. Phone features come from `@lophn/cap-phone` (`phone.use`, see
+  `phone-features.md`).
 
@@ -301,3 +301,3 @@ First read the bundled `phone-check.md` to check those on the person's
 phone (`lophn tab open --phone`); `phone-features.md` for home screen widgets
-and phone location (`phone.use`); `phone-apps.md` when the app's backend and
+and phone features (`phone.use`); `phone-apps.md` when the app's backend and
 data also run on the phone (`runs_on`); `folder-sync.md` when its data must
--- a/packages/core/agent-workspaces/skills/design-app/phone-features.md
+++ b/packages/core/agent-workspaces/skills/design-app/phone-features.md
@@ -1,2 +1,2 @@
-# Widgets and phone location
+# Widgets and phone features
 
@@ -42,33 +42,69 @@ there. Say so when you report: the person makes the last check on their phone.
 
-## Phone location
+## Phone features
 
-An app can read the person's location from their phone, once per call. Use it
-only for something the person asks for (near me, the trip they are on). There is
-no background or continuous location.
+An app can use these features of the person's phone. Each needs its own
+declaration; none is background work.
 
-1. Declare `{ kind: "phone.use", scope: { capability: "location.get" },
-   reason: "<why, in the person's words>" }` in `permissions` and
-   `@lophn/cap-phone` in `sdk_dependencies`. The person allows it once when the
-   release is activated, and the phone asks for its OS location permission on
-   the first use. Read the `@lophn/cap-phone` guide.
-2. Call `getLocation({ accuracy?, maxAgeMs? })` from the app's code (a command,
-   an operation or start code), never from a screen. It returns
-   `{ lat, lon, accuracyM, at }`. `accuracy: "high"` can take several seconds;
-   use the default unless you need it. Set `maxAgeMs` when a position a minute
-   old is enough.
-3. The phone answers only while the lophn app is in front on the phone. So
-   `unavailable` is the normal case, not a bug: `reason` is `phone_in_background`,
-   `phone_unreachable`, `no_phone`, `unsupported`, `location_off` or `timeout`.
-   Handle it by showing the person the next step ("Open lophn on your phone"),
-   and call again only when they ask (a button, the next run). Do not retry in a
-   loop and do not make a screen or a command wait for a location it cannot get:
-   the rest of the app works without it.
-4. `forbidden` with `reason: "os_permission_denied"` means the person refused
-   location on the phone; tell them to allow it in the phone's settings. A
-   `forbidden` without that reason means the `phone.use` permission is not
-   granted.
-5. In the preview and tests the call returns a fixed stand-in position
-   (`standIn: true`), so you cannot see a real location there. Say so when you
-   report, and that the person makes the last check on their phone.
-6. Write the use under Model or Journeys in DESIGN.md, including what the app
-   does when there is no location.
+| Capability | Function (`@lophn/cap-phone`) | Who can call it |
+| --- | --- | --- |
+| `location.get` | `getLocation({ accuracy?, maxAgeMs? })` | screen, backend |
+| `network.get` | `getNetwork()`: `{ online, type }` | screen, backend |
+| `haptics.play` | `playHaptic(kind)` | screen |
+| `clipboard.read` | `readClipboard()`: `{ text }`, text only, `null` when empty | screen |
+| `clipboard.write` | `writeClipboard(text)` | screen |
+| `code.scan` | `scanCode()`: QR codes and barcodes | screen |
+| `link.open` | `openLink(url)`: `https`, `http`, `tel`, `sms`, `mailto`, `geo` | screen |
+| `share.text` | `shareText(text, { title? })`: the phone's share sheet | screen |
+
+"Screen" means a phone screen, and a backend that runs on the phone. A backend
+that runs on the computer can call only `location.get` and `network.get`. In a
+backend that runs on the phone an operation must finish within 3 seconds or it
+is rolled back (`unavailable`) and the screen dies soon after. So call
+`getLocation`, `scanCode`, `shareText` and `openLink` (anything slow or that
+shows UI) from the screen (a button handler or an effect) and pass the result
+to an operation. `getNetwork`, `playHaptic` and the clipboard are quick enough
+inside an operation. Every call answers only while the lophn phone app is in
+front. There
+is no photo, file, camera capture, audio, contact, calendar, fingerprint or
+sensor feature, and nothing runs in the background or wakes the phone. Do not
+promise what is not in the table; tell the person it does not exist yet.
+
+1. Declare one `{ kind: "phone.use", scope: { capability: "<name>" },
+   reason: "<why, in the person's words>" }` in `permissions` for each
+   capability you use, and `@lophn/cap-phone` in `sdk_dependencies`. The person
+   allows each once when the release is activated. The phone asks for its OS
+   permission on the first use of location and of the scanner. A grant the
+   person takes back later reaches the phone when it next reads the computer (an
+   app that runs on the phone keeps its last list until then). Read the
+   `@lophn/cap-phone` guide.
+2. Import the functions from `@lophn/cap-phone` in a phone screen, or call them
+   from the app's code. Use them only for what the person asks for. There is
+   still no network in a screen: a link opens in the phone's own app, and
+   `link.open` and `share.text` can send the app's data out, so say that in the
+   `reason`.
+3. A screen can hide a button the app cannot use now:
+   `getPhoneAccess().capabilities` lists what is allowed and present on this
+   phone. It is read when the screen opens and does not change while the screen
+   stays open; each request is checked against the current grants, so it can
+   still be `forbidden`. Handle failures. `forbidden` is a missing grant (`permission`
+   is `phone.use`) or the person refusing the OS permission (`reason` is
+   `os_permission_denied`): show a line that says what to allow and where.
+   `unavailable` is normal: from the computer's backend `reason` is
+   `phone_in_background`, `phone_unreachable`, `no_phone`, `unsupported`,
+   `location_off` or `timeout`; in a screen `unsupported` means this phone app
+   does not have the feature. Show the next step, call again only when the
+   person asks, never in a loop, and do not let the rest of the app wait for it.
+4. `scanCode()` opens a full-screen scanner over the screen. If the person
+   closes it you get `{ cancelled: true }`: that is not an error, so keep the
+   screen as it was. One scanner at a time; a second call while it is open is
+   `conflict`.
+5. In the preview (the desktop and the phone's "Preview from lophn") a call
+   returns a fixed stand-in value with `standIn: true` (Seoul for location, online
+   on wifi, the text `Sample text from the clipboard`, a QR code that reads
+   `https://example.com`) and does nothing on the phone: no vibration, no
+   copy, no link, no share sheet. In both previews a capability you did not
+   declare is `forbidden`, exactly as it will be live, so a `forbidden` in
+   preview means "add it to the declaration". Say so when you report, and that
+   the person makes the last check on their phone.
+6. Write each use under Model or Journeys in DESIGN.md, including what the app
+   does when the feature is missing or refused.
```
