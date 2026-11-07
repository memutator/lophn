# @lophn/cap-notify 1.1.0

Previous: 1.0.0
Breaking: no

Adds `setTray({ text, tone? })` and `clearTray()`: a short text (1 to 16 characters; tone `neutral`, `good`, `warn` or `bad`) in the taskbar tray, one value per app, kept in memory only. Call from app process code (start code, timers), not from a screen; set it again at start. It shows only if the person turned on the app's `tray` screen (declaration 4.0.0 `places`). Same `notify.send` permission. Nothing is required of an existing app.
