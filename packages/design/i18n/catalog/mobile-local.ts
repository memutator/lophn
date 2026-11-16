// Words only the mobile app shows: apps that run on the phone (the line under the app's name, installing, Home while
// the computer is away). A sentence the desktop already has is not repeated here. Keys start with `mobile.`.
export const mobileLocal = {
  "mobile.local.install-failed.body":
    "Something went wrong while it was put here. Try again, or ask lophn to look at it.",
  "mobile.local.install-failed.title": "{app} couldn't be put on this phone",
  "mobile.local.installing.body": "It opens here when it is ready.",
  "mobile.local.installing.title": "Putting {app} on this phone",
  "mobile.local.note.offline":
    "Sessions and apps that run on it are paused here. Apps that live on this phone keep working and sync when it is back.",
  "mobile.local.under.not-synced": "On this phone · not synced since {time}",
  "mobile.local.under.not-synced-now":
    "On this phone · not synced since just now",
  "mobile.local.under.standalone": "Only on this phone · not backed up",
  "mobile.local.under.synced": "On this phone · synced {time}",
  "mobile.local.under.synced-now": "On this phone · synced just now",
  "mobile.local.under.syncing": "On this phone · syncing",
  "mobile.local.updating.title": "Updating {app} on this phone",
} as const;
