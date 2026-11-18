// Words about another lophn version: a computer that cannot be reached until one side updates. `client` is this app (the
// phone app, or lophn on this desktop), `host` is lophn on the computer it views.
export const machineUpdate = {
  "machine-update.viewer.desktop-client":
    "{name} runs a newer lophn. Update lophn on this computer to view it.",
  "machine-update.viewer.desktop-host":
    "{name} runs an older lophn. Update lophn on {name} to view it from this computer.",
  "machine-update.viewer.pair-note":
    "After the update, try again. If the invite has expired by then, make a new one on that computer.",
  "machine-update.viewer.phone-client":
    "Update the lophn app on this phone to reach {name}.",
  "machine-update.viewer.phone-host":
    "{name} runs an older lophn. Update lophn on {name} to reach it from this phone.",
  "machine-update.viewer.status-desktop-client":
    "Update lophn on this computer",
  "machine-update.viewer.status-host": "Update lophn on {name}",
  "machine-update.viewer.status-phone-client": "Update this app",
  // App details "Machines": each machine's release and lophn, what waits and why. Each machine updates itself.
  "machine-update.status.heading": "Machines",
  "machine-update.status.target": "machines",
  "machine-update.status.this-computer": "This computer",
  "machine-update.status.lophn-version": "lophn {version}",
  "machine-update.status.newer-release": "a newer release",
  "machine-update.status.follow-updating": "Updating to {release}…",
  "machine-update.status.follow-waiting-consent": "Needs your OK to update",
  "machine-update.status.open-waiting": "Open waiting list",
  "machine-update.status.follow-declined": "You declined this update",
  "machine-update.status.follow-lophn-update":
    "Update lophn on this computer to run this release",
  "machine-update.status.follow-failed":
    "Couldn't update here: {reason}. It stays on {release}.",
  "machine-update.status.follow-diverged":
    "Two machines released different versions. Ask the app's agent to combine them.",
  "machine-update.status.held-newer":
    "Needs an update here: {count, plural, =0 {the latest data from {machine} waits} one {# change from {machine} waits} other {# changes from {machine} wait}} for it",
  "machine-update.status.held-older":
    "{machine} is on an older release; its changes arrive when it updates",
  "machine-update.status.held-diverged":
    "{machine}'s changes arrive after the app's agent combines the two releases",
  "machine-update.status.held-full": "More from {machine} wait in the folder",
  "machine-update.status.exchange-update-this":
    "Update lophn on this computer to exchange with {machine}",
  "machine-update.status.exchange-update-peer":
    "{machine} runs an older lophn. Update it on that machine.",
  "machine-update.status.keeps-running":
    "While changes wait, the app keeps running on this computer's data.",
} as const;
