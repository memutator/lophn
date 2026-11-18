// 다른 기계를 보는 화면(기계 고르기, Settings › Remote의 시작 기계, 다른 기계 창의 gate·자리 표시).
export const remoteDesk = {
  "machines.button.open-this-computer": "Open this computer",
  "machines.button.pair-another": "Add a computer…",
  "machines.button.switcher": "Computer: {name}",
  "machines.button.this-computer": "This computer",
  "machines.gate.connecting": "Connecting to {name}…",
  "machines.gate.offline": "{name} is offline",
  "machines.gate.removed":
    "{name} is not in your devices. To view it again, invite it from Settings › Remote on this computer.",
  "machines.label.start": "Open at start",
  "machines.note.remove-start":
    "lophn opens {name} at start. After removing it, lophn opens the computer you used last.",
  "machines.note.start":
    "The computer lophn opens when it starts. If it is offline, its window says so and lets you open this computer.",
  "machines.notice.only-here": "This opens only on {name}.",
  "machines.notice.settings-elsewhere":
    "{name}'s settings are changed on {name}.",
  "machines.option.last": "The computer I used last",
  "machines.status.connected": "Connected",
  "machines.status.connecting": "Connecting…",
  "machines.status.direct": "Direct",
  "machines.status.last-seen": "Last seen {time}",
  "machines.status.offline": "Offline",
  "machines.status.relay": "Relay",
  "machines.status.removed": "Not in your devices",
  "machines.status.with-detail": "{label} · {detail}",
  "machines.group.also-here": "Also on this computer",
  "machines.group.also-here-as": "Also on this computer as {title}",
  "machines.group.clone-failed": "Could not clone it here: {message}",
  "machines.group.clone-here": "Clone here",
  "machines.group.cloned": "Cloned to {path}",
  "machines.group.cloning": "Cloning…",
  "machines.group.git-auth":
    "Run `{command}` in a terminal on this computer, then try again",
  "machines.group.looks-like": "Looks like {title}",
  "machines.group.looks-like-note":
    "Set it up on one computer and commit .lophn-project.json. The other links after git pull.",
  "machines.group.no-remote":
    "Not on this computer. It has no git remote to clone from.",
  "machines.group.no-sessions": "No sessions",
  "machines.group.not-here": "Not on this computer",
  "machines.group.sessions-failed": "Could not read the sessions",
  "machines.group.sessions-on": "On {name}",
  "machines.title.clone-parent": "Choose a folder for projects you clone",
} as const;
