// Words the phone's home screen widgets show. The phone's TS makes them (the native widget only draws), so the keys are here
// and not in Kotlin. Keys start with `mobile.widget.`.
export const mobileWidgets = {
  "mobile.widget.computer-removed": "Computer removed",
  "mobile.widget.empty": "Nothing to show yet",
  "mobile.widget.gone": "This widget is no longer available",
  "mobile.widget.menu.add": "Add widget",
  "mobile.widget.offline": "Offline {time}",
  "mobile.widget.offline-never": "Offline",
  "mobile.widget.pick.failed": "Could not read its widgets",
  "mobile.widget.pick.none": "None of your apps has a widget yet.",
  "mobile.widget.pick.not-placed":
    "Your launcher did not offer to place it. Add a lophn widget from the launcher's widget list, then tap it to choose.",
  "mobile.widget.pick.title": "Choose a widget",
  "mobile.widget.pick.under": "{app} · {computer}",
  "mobile.widget.tap-to-choose": "Tap to choose",
  "mobile.widget.title": "{app} · {widget}",
  "mobile.widget.updated": "Updated {time}",
  "mobile.widget.waiting": "Waiting for your computer",
} as const;
