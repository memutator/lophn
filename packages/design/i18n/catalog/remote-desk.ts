// 다른 기계를 보는 화면(기계 고르기, Settings › Remote의 Computers you view, 다른 기계 창의 gate·자리 표시).
export const remoteDesk = {
  "machines.button.add": "Add computer",
  "machines.button.open-this-computer": "Open this computer",
  "machines.button.pair": "Pair",
  "machines.button.pair-another": "Pair another computer…",
  "machines.button.remove": "Remove",
  "machines.button.rename": "Rename",
  "machines.button.switcher": "Computer: {name}",
  "machines.button.this-computer": "This computer",
  "machines.button.use-own-name": "Use its own name",
  "machines.error.action-failed":
    "Could not change the list of computers you view. Try again.",
  "machines.error.pair-closed":
    "The connection closed while pairing. Try again.",
  "machines.error.pair-expired":
    "This code has expired or was already used. Make a new one on that computer.",
  "machines.error.pair-invalid-text":
    "That is not a lophn pairing text. Copy it again with “Show as text”.",
  "machines.error.pair-refused":
    "That computer refused to pair. Make a new code there and try again.",
  "machines.error.pair-this-computer":
    "This is the pairing code of this computer",
  "machines.error.pair-unavailable":
    "Viewing other computers is not available right now.",
  "machines.error.pair-unreachable":
    "Could not reach that computer. Check that lophn is running there and that you can connect to it.",
  "machines.error.unreadable":
    "Could not read the list of computers you view. lophn left the file as it is.",
  "machines.gate.connecting": "Connecting to {name}…",
  "machines.gate.offline": "{name} is offline",
  "machines.gate.removed":
    "{name} removed this desktop. Pair again in Settings › Remote on this computer.",
  "machines.heading.viewed": "Computers you view",
  "machines.label.announced-name": "Name on that computer: {name}",
  "machines.label.name": "Name",
  "machines.label.pairing-text": "Pairing text",
  "machines.label.start": "Open at start",
  "machines.note.add":
    "On that computer, open Settings › Remote, press “Add phone or computer”, and copy “Show as text”. Paste it here.",
  "machines.note.remove":
    "{name} disappears from this list. To view it again, pair it again with a new code.",
  "machines.note.remove-start":
    "lophn opens {name} at start. After removing it, lophn opens the computer you used last.",
  "machines.note.start":
    "The computer lophn opens when it starts. If it is offline, its window says so and lets you open this computer.",
  "machines.notice.only-here": "This opens only on {name}.",
  "machines.notice.paired": "Paired with {name}",
  "machines.notice.settings-elsewhere":
    "{name}'s settings are changed on {name}.",
  "machines.notice.starting": "Starting…",
  "machines.option.last": "The computer I used last",
  "machines.status.connected": "Connected",
  "machines.status.connecting": "Connecting…",
  "machines.status.direct": "Direct",
  "machines.status.last-seen": "Last seen {time}",
  "machines.status.offline": "Offline",
  "machines.status.relay": "Relay",
  "machines.status.removed": "Removed this desktop",
  "machines.status.with-detail": "{label} · {detail}",
  "machines.title.remove": "Remove {name}?",
} as const;
