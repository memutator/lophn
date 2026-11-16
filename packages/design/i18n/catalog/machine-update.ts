// Words about another lophn version: a computer that cannot be reached until one side updates. `client` is this app (the
// phone app, or lophn on this desktop), `host` is lophn on the computer it views.
export const machineUpdate = {
  "machine-update.viewer.desktop-client":
    "{name} runs a newer lophn. Update lophn on this computer to view it.",
  "machine-update.viewer.desktop-host":
    "{name} runs an older lophn. Update lophn on {name} to view it from this computer.",
  "machine-update.viewer.pair-client":
    "That computer runs a newer lophn. Update lophn on this computer, then pair again.",
  "machine-update.viewer.pair-host":
    "That computer runs an older lophn. Update lophn there, then pair again.",
  "machine-update.viewer.pair-note":
    "After the update, try again. If the code has expired by then, make a new one on that computer.",
  "machine-update.viewer.phone-client":
    "Update the lophn app on this phone to reach {name}.",
  "machine-update.viewer.phone-host":
    "{name} runs an older lophn. Update lophn on {name} to reach it from this phone.",
  "machine-update.viewer.status-desktop-client":
    "Update lophn on this computer",
  "machine-update.viewer.status-host": "Update lophn on {name}",
  "machine-update.viewer.status-phone-client": "Update this app",
} as const;
