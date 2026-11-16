// Words only the mobile app shows: a user app's phone screen, its menu and its states. A sentence the desktop already has
// is not repeated here; the mobile screen uses the desktop key. Keys start with `mobile.`.
export const mobileApps = {
  "mobile.apps.failed.body":
    "Something went wrong while it started. Try again, or ask lophn to look at it.",
  "mobile.apps.failed.title": "This screen couldn't open",
  "mobile.apps.menu.activity-sub": "Runs and logs",
  "mobile.apps.menu.ask-sub": "Say what should be different",
  "mobile.apps.menu.runs-on": "Runs on {computer}",
  "mobile.apps.menu.sessions": "Sessions about this app",
  "mobile.apps.offline.body":
    "That computer is offline, so {app} cannot open right now. It comes back by itself when the computer does.",
  "mobile.apps.offline.title": "{app} runs on {computer}",
  "mobile.apps.phone-too-old.body":
    "This screen was built for a newer lophn app than the one on this phone.",
  "mobile.apps.phone-too-old.title": "Update the lophn app to open this screen",
  "mobile.apps.screen-too-old.body":
    "This screen was built for an older lophn app and can't open on this one.",
  "mobile.apps.screen-too-old.title":
    "Ask lophn on your computer to update this app",
  "mobile.apps.stopped.body":
    "It opens here by itself when it runs on that computer again.",
  "mobile.apps.stopped.title": "{app} isn't running on {computer}",
  "mobile.apps.updated": "Updated to {release}",
} as const;
