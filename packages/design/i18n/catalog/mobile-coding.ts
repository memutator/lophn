// Words only the mobile app shows: the computer's coding agents (the project's coding list, a session running in a
// terminal, switching it to chat). A sentence the desktop already has is not repeated here; the mobile screen uses the
// desktop key. Keys start with `mobile.`.
export const mobileCoding = {
  "mobile.coding.button.switch-to-chat": "Switch to chat",
  "mobile.coding.error.switch-conflict":
    "{harness} has already switched on {computer}.",
  "mobile.coding.error.switch-failed": "Couldn't switch {harness} to chat.",
  "mobile.coding.error.switch-not-found":
    "This session is gone from {computer}.",
  "mobile.coding.error.switch-unavailable":
    "lophn or its coding agents extension on {computer} didn't answer. Try again in a moment.",
  "mobile.coding.heading.in-terminal": "{harness} is running in a terminal",
  "mobile.coding.label.idle": "Idle",
  "mobile.coding.label.idle-since": "Idle · {when}",
  "mobile.coding.notice.blocked-extension-off":
    "The coding agents extension is off on {computer}.",
  "mobile.coding.notice.blocked-no-session":
    "{harness} hasn’t reported its session yet. Send it a message in the terminal first, then switch.",
  "mobile.coding.notice.blocked-not-running":
    "No coding agent is running in this terminal now.",
  "mobile.coding.notice.blocked-unsupported-os":
    "Switching to chat doesn’t work on Windows yet.",
  "mobile.coding.notice.in-terminal":
    "This chat is open in a terminal on the computer. Switch to chat to reply here.",
  "mobile.coding.notice.not-running": "lophn is not running on {computer}",
  "mobile.coding.notice.not-running-sub":
    "Coding agents run in the desktop app.",
  "mobile.coding.notice.switch":
    "{turn, select, yes {The running turn will be interrupted, {tasks, plural, =0 {} one {# background task stops, } other {# background tasks stop, }}and the terminal tab on {computer} becomes the chat view.} other {{harness} keeps the same conversation, {tasks, plural, =0 {} one {# background task stops, } other {# background tasks stop, }}and the terminal tab on {computer} becomes the chat view.}}",
  "mobile.coding.title.switch": "Switch {harness} to chat?",
} as const;
