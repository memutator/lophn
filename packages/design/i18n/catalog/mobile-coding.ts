// Words only the mobile app shows: the computer's coding agents (the project's coding list, a session running in a
// terminal, switching it to chat). A sentence the desktop already has is not repeated here; the mobile screen uses the
// desktop key. Keys start with `mobile.`.
export const mobileCoding = {
  "mobile.coding.button.continue": "Continue as chat",
  "mobile.coding.button.switch-to-chat": "Switch to chat",
  "mobile.coding.button.to-sessions": "Go to sessions",
  "mobile.coding.error.open-conflict":
    "{harness} is already open on {computer}.",
  "mobile.coding.error.open-failed": "Couldn't open {harness} on {computer}.",
  "mobile.coding.error.read-failed":
    "Couldn't read the coding agents on {computer}.",
  "mobile.coding.error.send-failed":
    "{harness} opened on {computer}, but the message didn't go through. Try again.",
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
  "mobile.coding.notice.ended":
    "This session ended on {computer}. Continue it there as a chat to keep working from here.",
  "mobile.coding.notice.in-terminal":
    "This chat is open in a terminal on the computer. Switch to chat to reply here.",
  "mobile.coding.notice.new-terminal":
    "Starts in a new terminal on the computer",
  "mobile.coding.notice.opening": "Opening on {computer}…",
  "mobile.coding.notice.switch":
    "{turn, select, yes {The running turn will be interrupted, {tasks, plural, =0 {} one {# background task stops, } other {# background tasks stop, }}and the terminal tab on {computer} becomes the chat view.} other {{harness} keeps the same conversation, {tasks, plural, =0 {} one {# background task stops, } other {# background tasks stop, }}and the terminal tab on {computer} becomes the chat view.}}",
  "mobile.coding.title.switch": "Switch {harness} to chat?",
} as const;
