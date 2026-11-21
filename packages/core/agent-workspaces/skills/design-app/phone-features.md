# Widgets and phone features

## Widgets

A widget is one value or one short list on the person's phone home screen, seen
without opening the phone app: the weather now, the time left of a limit, the
next three events. Add one only when a glance is worth it. It does not replace a
screen: it cannot take input, show an image or draw a chart.

1. Declare it in `lophn.ts`, at most 4 per app:
   `widgets: [{ key: "weather", label: "Weather", screen: "home" }]`. `key` is
   lowercase letters, digits and `_`, starting with a letter. `label` is the
   widget's title on the phone. `screen` is optional: the key of a screen of
   this app whose `places` is `["phone"]`; a tap on the widget opens it (with no
   `screen`, a tap opens the app). Declare `notify.send` too and read the
   `@lophn/cap-notify` guide.
2. Publish the value from the app's code (a handler or start code, never a
   screen): `setWidget("weather", { v: 1, rows })` from `@lophn/cap-notify`.
   `rows` are 1 to 6 nodes of four kinds: `stat` (a big value and a label),
   `progress` (0 to 1), `text` and `list` (up to 5 items). You cannot choose
   the layout, and the whole value is at most 4 KiB. The phone draws the title
   and the time the value was fetched.
3. Put the most important row first: the small widget (2x2) shows only the first
   few rows. Make the first row enough on its own.
4. Publish again in the start code and whenever the value changes. lophn keeps
   the value in memory only, so after a restart the widget has nothing until the
   app publishes. `clearWidget(key)` removes it.
5. Do not make the widget up to date by the second. The phone fetches best
   effort: when the person opens the lophn app, when a value changes while the
   phone is connected, and about every 30 minutes. The widget shows the time it
   was fetched and "Offline" when the computer cannot be reached. So never put
   a clock, a countdown or a seconds-level value in a widget, and do not write
   "just now" or "N minutes ago"; publish the fact and let the phone show the
   age. Publish a value that stays true for minutes.
6. The person places the widget on their phone home screen and picks it from
   the app's widgets there. Tell them it exists; the app cannot place it.
7. Write the widget under Screens in DESIGN.md: its key, rows, when it is
   published, and the screen a tap opens.

In the preview and tests `setWidget` does nothing, so you cannot see the widget
there. Say so when you report: the person makes the last check on their phone.

## Phone features

An app can use these features of the person's phone. Each needs its own
declaration; none is background work.

| Capability | Function (`@lophn/cap-phone`) | Who can call it |
| --- | --- | --- |
| `location.get` | `getLocation({ accuracy?, maxAgeMs? })` | screen, backend |
| `network.get` | `getNetwork()`: `{ online, type }` | screen, backend |
| `haptics.play` | `playHaptic(kind)` | screen |
| `clipboard.read` | `readClipboard()`: `{ text }`, text only, `null` when empty | screen |
| `clipboard.write` | `writeClipboard(text)` | screen |
| `code.scan` | `scanCode()`: QR codes and barcodes | screen |
| `link.open` | `openLink(url)`: `https`, `http`, `tel`, `sms`, `mailto`, `geo` | screen |
| `share.text` | `shareText(text, { title? })`: the phone's share sheet | screen |
| `camera.capture` | `capturePhoto()`: the camera; a file handle | screen |
| `photos.pick` | `pickPhotos({ max? })`: the photo picker (1 to 10); file handles | screen |
| `files.pick` | `pickFiles({ types?, max? })`: the file picker; file handles | screen |
| `share.file` | `shareFile(handle, { title? })`: the share sheet for an app file | screen |

"Screen" means a phone screen, and a backend that runs on the phone. A backend
that runs on the computer can call only `location.get` and `network.get`. In a
backend that runs on the phone an operation must finish within 3 seconds or it
is rolled back (`unavailable`) and the screen dies soon after. So call
`getLocation`, `scanCode`, `shareText`, `openLink`, `capturePhoto`,
`pickPhotos`, `pickFiles` and `shareFile` (anything slow or that shows UI) from
the screen (a button handler or an effect) and pass the result
to an operation. `getNetwork`, `playHaptic` and the clipboard are quick enough
inside an operation. Every call answers only while the lophn phone app is in
front. There
is no video, audio recording, saving to the photo gallery, contact, calendar,
fingerprint or sensor feature, and nothing runs in the background or wakes the
phone. Do not
promise what is not in the table; tell the person it does not exist yet.

1. Declare one `{ kind: "phone.use", scope: { capability: "<name>" },
   reason: "<why, in the person's words>" }` in `permissions` for each
   capability you use, and `@lophn/cap-phone` in `sdk_dependencies`. The person
   allows each once when the release is activated. The phone asks for its OS
   permission on the first use of location, of the scanner and of the camera
   (the photo and file pickers need none). A grant the
   person takes back later reaches the phone when it next reads the computer (an
   app that runs on the phone keeps its last list until then). Read the
   `@lophn/cap-phone` guide.
2. Import the functions from `@lophn/cap-phone` in a phone screen, or call them
   from the app's code. Use them only for what the person asks for. There is
   still no network in a screen: a link opens in the phone's own app, and
   `link.open`, `share.text` and `share.file` can send the app's data out, so say
   that in the `reason`.
3. A screen can hide a button the app cannot use now:
   `getPhoneAccess().capabilities` lists what is allowed and present on this
   phone. It is read when the screen opens and does not change while the screen
   stays open; each request is checked against the current grants, so it can
   still be `forbidden`. Handle failures. `forbidden` is a missing grant (`permission`
   is `phone.use`) or the person refusing the OS permission (`reason` is
   `os_permission_denied`): show a line that says what to allow and where.
   `unavailable` is normal: from the computer's backend `reason` is
   `phone_in_background`, `phone_unreachable`, `no_phone`, `unsupported`,
   `location_off` or `timeout`; in a screen `unsupported` means this phone app
   does not have the feature. Show the next step, call again only when the
   person asks, never in a loop, and do not let the rest of the app wait for it.
4. `scanCode()` opens a full-screen scanner over the screen. If the person
   closes it you get `{ cancelled: true }`: that is not an error, so keep the
   screen as it was. One scanner at a time; a second call while it is open is
   `conflict`.
5. In the preview (the desktop and the phone's "Preview from lophn") a call
   returns a fixed stand-in value with `standIn: true` (Seoul for location, online
   on wifi, the text `Sample text from the clipboard`, a QR code that reads
   `https://example.com`, a small blue picture for `capturePhoto` and
   `pickPhotos`, a short text file for `pickFiles`) and does nothing on the
   phone: no vibration, no copy, no link, no camera, no picker, no share sheet. In both previews a capability you did not
   declare is `forbidden`, exactly as it will be live, so a `forbidden` in
   preview means "add it to the declaration". Say so when you report, and that
   the person makes the last check on their phone.
6. Write each use under Model or Journeys in DESIGN.md, including what the app
   does when the feature is missing or refused.

## App files: photos and picked files

An app file is immutable bytes (a photo, a PDF) named by its sha256 and kept in
the app's own data, not in the database. A small JSON handle names it:
`{ file, type, size, name?, width?, height? }`. The handle is what travels.

1. `capturePhoto()`, `pickPhotos()` and `pickFiles()` answer
   `{ cancelled: true }` (the person just closed it: not an error, keep the
   screen as it was) or file handles, never bytes. `shareFile(handle)` hands a
   file to the share sheet. Each of the four needs its own `phone.use`
   declaration with a `reason` (`camera.capture`, `photos.pick`, `files.pick`,
   `share.file`). A file over 64 MiB is `invalid_input`: show the message. One
   picker or camera at a time.
2. Pass handles through operations and keep them in rows as JSON text. Never put
   file bytes in an operation input (the input limit is 64 KiB), a row or an
   event: put the handle there.
3. Show a file in a screen with `useAppFile(handle)` from `@lophn/app-ui` (a
   desktop screen, `<img src={uri}>`) or `@lophn/app-ui-native` (a phone screen,
   `<Image source={{ uri }}>`). It answers `loading`, `ready` with `uri` or
   `failed` with a code; a phone screen draws only its own app's files. The phone
   may have to fetch the file from the computer first. Images are what works
   (`<img>`, `<Image>`): do not promise audio or video playback, and a PDF is a
   link, not an embedded view. `react-native-svg` is imported by name (`import { Svg, Circle } from
   "react-native-svg"`; a default import `import Svg from ...` is refused when
   the release is prepared), and its `Image` does
   not exist in a phone screen (it would fail), so draw pictures with React
   Native's `Image`.
   A photo picked on the phone carries the system's media name (like `19.jpg`),
   not the original file name: do not show a photo's `name` as if it meant
   something.
4. A backend on the computer reads the bytes with `readAppFile(handle)` and can
   make a file with `putAppFile(bytes, { type, name? })` from `@lophn/cap-store`.
   A backend that runs on the phone cannot read or write bytes; it keeps the
   handle in a row and passes it on.
5. For an app that runs on the computer, a photo or picked file reaches the
   screen only after it is on the computer: with the computer unreachable the
   call is `unavailable` (after waiting up to a minute for the computer; the
   `reason` says no connection, a broken transfer or a refusal) and there is no
   handle. Tell the person to try again when the computer is on. An app that runs on the phone keeps the file on the
   phone at once; if it also runs on the computer every computer it syncs with
   gets the files it lacks before it gets any row.
6. Files are never deleted (they go when the app is deleted), so a removed row
   leaves its bytes on disk until the app is deleted, and a rewind finds a handle
   alive. Do not promise
   "deleted for good". Files of an app that lists tables in `sync` do not travel to the other
   computers: a row of a listed table does and the picture is empty there.
7. Not there yet: video, audio recording, saving to the photo gallery, giving a
   photo to an agent or a model, picking files in a desktop screen. Say so.
