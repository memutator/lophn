// Installing on this computer an app that another of your computers shares (sidebar row menu and Settings › Sync).
export const takeIn = {
  "take-in.button.install": "Install on this computer",
  "take-in.note.installing": "Installing {name}…",
  "take-in.note.installed":
    "{name} is installed on this computer but not running yet. Open it from this computer's list and ask lophn to activate it; you will be asked to allow it here.",
  "take-in.note.sync-off":
    "Sync is off for {name} on {machine}, so it can't be installed here. Turn on sync for the app on that computer, then try again.",
  "take-in.note.sdk-missing":
    "{name} needs a newer lophn than this computer has. Update lophn here, then try again.",
  "take-in.note.slug-in-use":
    "Another app on this computer already has the same short name as {name}.",
  "take-in.note.dependency-missing":
    "{name} uses one of your own packages that is not on this computer yet.",
  "take-in.note.source-incomplete":
    "The files of {name} have not fully arrived yet. Try again in a moment.",
  "take-in.note.failed": "Could not install {name}. Try again, or ask lophn.",
} as const;
