# Widgets and phone location

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

## Phone location

An app can read the person's location from their phone, once per call. Use it
only for something the person asks for (near me, the trip they are on). There is
no background or continuous location.

1. Declare `{ kind: "phone.use", scope: { capability: "location.get" },
   reason: "<why, in the person's words>" }` in `permissions` and
   `@lophn/cap-phone` in `sdk_dependencies`. The person allows it once when the
   release is activated, and the phone asks for its OS location permission on
   the first use. Read the `@lophn/cap-phone` guide.
2. Call `getLocation({ accuracy?, maxAgeMs? })` from the app's code (a command,
   an operation or start code), never from a screen. It returns
   `{ lat, lon, accuracyM, at }`. `accuracy: "high"` can take several seconds;
   use the default unless you need it. Set `maxAgeMs` when a position a minute
   old is enough.
3. The phone answers only while the lophn app is in front on the phone. So
   `unavailable` is the normal case, not a bug: `reason` is `phone_in_background`,
   `phone_unreachable`, `no_phone`, `unsupported`, `location_off` or `timeout`.
   Handle it by showing the person the next step ("Open lophn on your phone"),
   and call again only when they ask (a button, the next run). Do not retry in a
   loop and do not make a screen or a command wait for a location it cannot get:
   the rest of the app works without it.
4. `forbidden` with `reason: "os_permission_denied"` means the person refused
   location on the phone; tell them to allow it in the phone's settings. A
   `forbidden` without that reason means the `phone.use` permission is not
   granted.
5. In the preview and tests the call returns a fixed stand-in position
   (`standIn: true`), so you cannot see a real location there. Say so when you
   report, and that the person makes the last check on their phone.
6. Write the use under Model or Journeys in DESIGN.md, including what the app
   does when there is no location.
