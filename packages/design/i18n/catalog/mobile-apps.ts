// Words only the mobile app shows: a user app's phone screen, its menu and its states. A sentence the desktop already has
// is not repeated here; the mobile screen uses the desktop key. Keys start with `mobile.`.
export const mobileApps = {
  "mobile.apps.annotate.failed": "Couldn't send the annotation. Try again.",
  "mobile.apps.annotate.hint":
    "Tap the screen to mark a spot, then write what should change.",
  "mobile.apps.annotate.placeholder": "What should change here?",
  "mobile.apps.annotate.send": "Send",
  "mobile.apps.button.what-changed": "What changed",
  "mobile.apps.failed.body":
    "Something went wrong while it started. Try again, or ask lophn to look at it.",
  "mobile.apps.failed.title": "This screen couldn't open",
  "mobile.apps.menu.activity-sub": "Runs and logs",
  "mobile.apps.menu.annotate": "Annotate this screen",
  "mobile.apps.menu.annotate-sub": "Mark the spot and send it to the agent",
  "mobile.apps.menu.ask-sub": "Say what should be different",
  "mobile.apps.menu.runs-on": "Runs on {computer}",
  "mobile.apps.menu.sessions": "Sessions about this app",
  "mobile.apps.new.name": "Name",
  "mobile.apps.new.note":
    "An app starts with a name and one line about what it is for. lophn builds it from there.",
  "mobile.apps.new.prompt":
    'Build a new app named "{name}". What it is for: {purpose}. Register it with `lophn app create` and start building it in its workspace.',
  "mobile.apps.new.purpose": "Purpose",
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
  "mobile.apps.what-changed.ask":
    "What changed in {release}? Tell me in a few lines.",
  "mobile.apps.updated": "Updated to {release}",
} as const;
