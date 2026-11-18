export const workspaceSettings = {
  "jobs.button.delete": "Delete",
  "jobs.button.hide-history": "Hide history",
  "jobs.button.open-all": "Open all jobs",
  "jobs.button.open-project": "Open project",
  "jobs.button.open-tab": "Open in tab",
  "jobs.button.show-history": "Show history",
  "jobs.button.take-over": "Run on this computer",
  "jobs.empty.all": "No jobs yet.",
  "jobs.empty.list":
    "No jobs yet. Ask an agent to set one up, for example by saying “Every morning at 9, summarize what changed” or “When my usage app hits its limit, wrap up”.",
  "jobs.empty.sidebar": "No jobs for this project.",
  "jobs.empty.sidebar-ask": "Ask an agent to set one up.",
  "jobs.error.delete": "Could not delete the job.",
  "jobs.error.history": "Could not read the history.",
  "jobs.error.save": "Could not save the changes.",
  "jobs.error.take-over": "Could not move the job to this computer.",
  "jobs.heading.delete": "Delete {title}?",
  "jobs.heading.edit": "Edit job",
  "jobs.label.action-agent": "Asks {agent}",
  "jobs.label.action-tool": "Uses an app tool",
  "jobs.label.action-tool-detail": "{app} · {tool}",
  "jobs.label.action-workflow": "Starts a workflow",
  "jobs.label.action-workflow-detail": "{project} / {workflow}",
  "jobs.label.agent-lophn": "lophn",
  "jobs.label.agent-unnamed": "an agent",
  "jobs.label.at": "At",
  "jobs.label.belongs-elsewhere": "Belongs to another computer",
  "jobs.label.belongs-to": "Belongs to {name}",
  "jobs.label.created-by": "Created by {agent}",
  "jobs.label.created-by-workspace": "Created by {agent} · {workspace}",
  "jobs.label.every": "Every",
  "jobs.label.every-days": "{n, plural, one {Every day} other {Every # days}}",
  "jobs.label.every-days-at":
    "{n, plural, one {Every day at {time}} other {Every # days at {time}}}",
  "jobs.label.every-hours":
    "{n, plural, one {Every hour} other {Every # hours}}",
  "jobs.label.every-minutes":
    "{n, plural, one {Every minute} other {Every # minutes}}",
  "jobs.label.event-last-fired": "Last fired {time}",
  "jobs.label.skip-busy": "the previous run was still going",
  "jobs.label.skip-too-soon": "too soon after the last start",
  "jobs.label.skipped-last": "last skipped: {reason}",
  "jobs.label.source-gone":
    "The source no longer publishes this event, so this job will not run.",
  "jobs.label.trigger-pass-event":
    "The event's data is passed to the tool as input.",
  "jobs.label.trigger-field": "When",
  "jobs.label.event-stats":
    "Fired {fired, plural, one {# time} other {# times}} · skipped {skipped, plural, one {# time} other {# times}}",
  "jobs.label.history": "History",
  "jobs.label.interval-days": "{n, plural, one {day} other {# days}}",
  "jobs.label.interval-hours": "{n, plural, one {hour} other {# hours}}",
  "jobs.label.interval-minutes": "{n, plural, one {minute} other {# minutes}}",
  "jobs.label.trigger-app":
    "When {source} publishes {event}, at most every {interval}",
  "jobs.label.trigger-app-on":
    "When app {source} on {machine} publishes {event}, at most every {interval}",
  "jobs.label.trigger-lophn":
    "When lophn reports {event}, at most every {interval}",
  "jobs.label.if-missed": "If missed",
  "jobs.label.missed-hold": "If missed: asks you first",
  "jobs.label.missed-option-hold": "Ask me first",
  "jobs.label.missed-option-run": "Start once when lophn turns on",
  "jobs.label.missed-run": "If missed: starts once",
  "jobs.label.next": "Next {time}",
  "jobs.label.not-yet": "Has not started yet",
  "jobs.label.sidebar-tab": "Jobs",
  "jobs.label.state-cancelled": "Cancelled",
  "jobs.label.state-done": "Done",
  "jobs.label.state-failed": "Failed",
  "jobs.label.state-held": "Waiting",
  "jobs.label.state-interrupted": "Interrupted",
  "jobs.label.state-queued": "Queued",
  "jobs.label.state-running": "Running",
  "jobs.label.state-skipped": "Skipped",
  "jobs.label.target": "your jobs",
  "jobs.label.title": "Title",
  "jobs.label.turned-off": "Turned off",
  "jobs.label.waiting-approval": "Waiting for your approval",
  "jobs.label.unit": "Unit",
  "jobs.label.unit-days": "Days",
  "jobs.label.unit-hours": "Hours",
  "jobs.label.unit-minutes": "Minutes",
  "jobs.label.waiting-decision": "Waiting for your decision",
  "jobs.note.at-help": "The time of day on this computer.",
  "jobs.note.belongs-elsewhere":
    "It was created on another computer and does not run here.",
  "jobs.note.delete":
    "This deletes the job and its history. Anything that is running keeps going until it finishes.",
  "jobs.note.edit-readonly":
    "What the job does cannot be changed here. Ask {agent} to change it.",
  "jobs.note.intro":
    "Jobs that your agents set up to start work on a schedule or when an event happens. They start only while lophn is on.",
  "jobs.note.no-history": "Nothing has started yet.",
  "jobs.note.run-cancelled": "Cancelled before it finished.",
  "jobs.note.run-done": "Finished.",
  "jobs.note.run-done-missed":
    "{count, plural, one {Missed once, started once} other {Missed # times, started once}}.",
  "jobs.note.run-failed": "Failed while running.",
  "jobs.note.run-failed-start": "Could not start. {message}.",
  "jobs.note.run-held": "Waiting for your decision.",
  "jobs.note.run-held-missed":
    "{count, plural, one {Missed once. Waiting for your decision} other {Missed # times. Waiting for your decision}}.",
  "jobs.note.run-interrupted": "Interrupted because lophn was turned off.",
  "jobs.note.run-queued": "Waiting to start.",
  "jobs.note.run-running": "Running now.",
  "jobs.note.run-running-missed":
    "{count, plural, one {Missed once, running now} other {Missed # times, running now}}.",
  "jobs.note.run-skipped-overlap":
    "Skipped because the previous turn was still going.",
  "jobs.note.run-skipped-person": "You skipped it.",
  "jobs.note.run-skipped-superseded": "Replaced by the turn that came on time.",
  "settings.appearance.accent-help":
    "The color of main buttons, focus rings, and selections. lophn adjusts the shade so text stays readable.",
  "settings.appearance.dark-theme-help": "The colors lophn uses in dark mode.",
  "settings.appearance.light-theme-help":
    "The colors lophn uses in light mode.",
  "settings.appearance.mode-help": "Light, dark, or follow the system setting.",
  "settings.appearance.theme-broken":
    "themes/{id}.json can't be used: {reason}",
  "settings.appearance.theme-missing":
    "{name} isn't in your themes folder, so lophn uses its default theme.",
  "settings.appearance.theme-more": "And {count} more.",
  "settings.appearance.theme-problem-bad-value":
    "{path} isn't a hex color like #1a1b26, so it keeps the inherited color.",
  "settings.appearance.theme-problem-contrast":
    "{foreground} on {background} has {ratio}:1 contrast; readable text needs {minimum}:1.",
  "settings.appearance.theme-problem-unknown-path":
    "{path} isn't a color lophn knows, so it's ignored.",
  "settings.appearance.themes-folder-help":
    "Add a theme as a JSON file. lophn picks up changes as soon as you save.",
  "settings.appearance.code-font-help":
    "The font of code, terminals, and file paths.",
  "settings.appearance.density-help":
    "How much room lists and tables leave between rows.",
  "settings.appearance.font-help": "The font of text across lophn.",
  "settings.appearance.font-missing":
    "{name} isn't installed on this computer, so lophn uses its default font.",
  "settings.appearance.reading-font-help":
    "The font of documents and agent replies. Interface text keeps its own font.",
  "settings.appearance.reading-width-help":
    "How wide documents are laid out when you read them.",
  "settings.appearance.taskbar-help":
    "A bar at the bottom of the window that holds your floating panels.",
  "settings.appearance.text-size-help": "The size of text across lophn.",
  "settings.button.add-entry": "Add",
  "settings.button.computer-name-reset": "Use computer name",
  "settings.button.open-keep-running-settings": "Open settings",
  "settings.button.turn-on-again": "Turn on again",
  "settings.button.back-to": "Back to {workspace}",
  "settings.button.back-to-home": "Back to Home",
  "settings.button.this-computer-settings": "This computer's settings",
  "settings.button.add-rule": "Add rule",
  "settings.button.add-call-rule": "Add",
  "settings.button.choose-in-agents": "Choose in Agents",
  "settings.button.coding-favorite": "Add to favorites",
  "settings.button.coding-unfavorite": "Remove from favorites",
  "settings.button.coding-unshare": "Remove",
  "settings.button.connect-with": "Connect {name}",
  "settings.button.detect-again": "Detect again",
  "settings.button.extension-install": "Install",
  "settings.button.extension-remove": "Remove",
  "settings.button.extension-turn-off": "Turn off",
  "settings.button.extension-turn-on": "Turn on",
  "settings.button.install-hooks": "Install hooks",
  "settings.button.key-change": "Change {name}",
  "settings.button.key-clear": "Remove the shortcut for {name}",
  "settings.button.key-clear-visible": "Remove",
  "settings.button.key-conflicts-only": "Show conflicts only",
  "settings.button.key-reset": "Reset {name}",
  "settings.button.key-take": "Replace",
  "settings.button.key-search-by-key": "Search by pressing keys",
  "settings.button.keys-reset-all": "Reset all shortcuts",
  "settings.button.remote-make-primary": "Make primary",
  "settings.button.remote-invite-computer": "Invite a computer",
  "settings.button.remote-invite-phone": "Invite a phone",
  "settings.button.remote-join": "Join with an invite",
  "settings.button.remote-join-send": "Join",
  "settings.button.remote-new-invite": "New invite",
  "settings.button.remote-remove": "Remove",
  "settings.button.remote-rename": "Rename",
  "settings.button.remote-show-text": "Show as text",
  "settings.button.remove-entry": "Remove {item}",
  "settings.button.reset-default": "Reset to default",
  "settings.button.revoke": "Revoke",
  "settings.button.run-checks": "Run checks",
  "settings.button.uninstall-hooks": "Uninstall hooks",
  "settings.diagnostics.check-failed":
    "The check couldn't start right now. Try again.",
  "settings.diagnostics.last-run": "Last run at {time}.",
  "settings.diagnostics.trace-help":
    "Records event names, ids, timings and sizes to the logs folder of your lophn data folder ('<'data root>/logs). Typed text, terminal output, prompts and model replies are never recorded. Takes effect right away.",
  "settings.diagnostics.not-run":
    "No check has run yet. Checks run only when you press the button.",
  "settings.empty.coding-search": "No product matches your search.",
  "settings.empty.coding-shared-apps": "No apps are shared with coding agents.",
  "settings.empty.extension-packages":
    "No extensions come with this version of lophn.",
  "settings.empty.general": "No settings are declared yet.",
  "settings.empty.key-apps":
    "No app has a panel screen yet. Install an app with one to give it a shortcut.",
  "settings.empty.key-search": "No shortcut matches your search.",
  "settings.empty.shell-rules": "No rules here yet.",
  "settings.empty.call-private": "No private workspaces.",
  "settings.empty.call-rules": "No rules. Every call is allowed.",
  "settings.error.coding-detect":
    "Couldn't check again. The earlier results are still shown.",
  "settings.error.coding-hooks-install":
    "The hooks weren't installed. Nothing changed. Try again.",
  "settings.error.coding-hooks-uninstall":
    "The hooks weren't uninstalled. Try again.",
  "settings.error.coding-unshare": "Couldn't remove the app. Try again.",
  "settings.error.extension-action": "Could not change {name}. Try again.",
  "settings.error.extension-turn-off-first":
    "Turn {name} off before removing it.",
  "settings.error.key-needs-modifier":
    "Hold {modifiers} with the key. A key on its own would stop you typing it.",
  "settings.error.key-numbered-needs-modifier":
    "Hold {modifiers}. The numbers are added for you.",
  "settings.error.key-reserved":
    "lophn or your OS already uses this key for something else.",
  "settings.error.key-unsupported": "That key can't be used for a shortcut.",
  "settings.error.remote-device-failed":
    "Could not change the device. Try again.",
  "settings.error.remote-invite-failed": "Could not make an invite.",
  "settings.error.remote-join-expired":
    "This invite has expired. Make a new one on the other computer.",
  "settings.error.remote-join-failed": "Could not join. Try again.",
  "settings.error.remote-join-id-taken":
    "Another device in that list already has this computer's id.",
  "settings.error.remote-join-invalid-text":
    "That is not an invite for a computer. Copy the whole text again with “Show as text” after “Invite a computer”.",
  "settings.error.remote-join-key-taken":
    "This computer's key is already in that list as another device.",
  "settings.error.remote-join-removed":
    "This computer was removed from that list, so it cannot join it again.",
  "settings.error.remote-join-this-computer":
    "This invite was made on this computer. Paste it on the other computer.",
  "settings.error.remote-join-unavailable":
    "Connections are still starting or are off. Try again in a moment.",
  "settings.error.remote-join-update-client":
    "The other computer runs a newer lophn. Update lophn on this computer, then join again.",
  "settings.error.remote-join-update-host":
    "The other computer runs an older lophn. Update lophn there, then join again. If the invite has expired by then, make a new one.",
  "settings.error.remote-join-untrusted":
    "This invite does not check out. Copy the whole text again, or make a new one.",
  "settings.error.remote-join-used":
    "Another device already used this invite. Make a new one on the other computer.",
  "settings.error.remote-devices-failed": "Could not read your devices.",
  "settings.error.remote-load-failed":
    "Could not read the phone connection setting.",
  "settings.error.value-invalid":
    "That value isn't accepted. Nothing was saved, and the setting keeps its value.",
  "settings.error.value-not-saved":
    "The change wasn't saved. Nothing changed. Try again.",
  "settings.error.value-out-of-range":
    "That value is outside the allowed range. Nothing was saved, and the setting keeps its value.",
  "settings.error.value-unknown":
    "lophn doesn't know this setting. Nothing was saved.",
  "settings.error.value-wrong-type":
    "That isn't the kind of value this setting takes. Nothing was saved, and the setting keeps its value.",
  "settings.heading.call-policy": "Calls between workspaces",
  "settings.heading.key-section-agent": "Agent",
  "settings.heading.key-section-app": "App panels",
  "settings.heading.key-section-browser": "Browser",
  "settings.heading.key-section-contributed": "Extensions and apps",
  "settings.heading.key-section-desk": "Desks",
  "settings.heading.key-section-float": "Floating tabs",
  "settings.heading.key-section-open": "Open",
  "settings.heading.key-section-pane": "Splits",
  "settings.heading.key-section-tab": "Tabs",
  "settings.heading.key-section-terminal": "Terminal",
  "settings.heading.key-section-view": "View",
  "settings.heading.quick-app-panels": "App panels",
  "settings.heading.quick-buttons": "Buttons",
  "settings.heading.quick-sidebar-panels": "Sidebar panels",
  "settings.heading.quick-tray": "Tray",
  "settings.heading.this-computer": "This computer",
  "settings.heading.keep-running": "Keep running",
  "settings.heading.remote-devices": "My devices",
  "settings.heading.remote-add": "Add a device",
  "settings.heading.shell-rules-built-in": "Built in",
  "settings.heading.shell-rules-project": "Project: {name}",
  "settings.heading.shell-rules-global": "Global",
  "settings.intro.appearance":
    "How lophn looks. Changes apply as soon as you choose.",
  "settings.intro.coding":
    "Coding agents on this computer that lophn can set up.",
  "settings.intro.diagnostics":
    "Whether each part of lophn can be used right now. Checks run only when you press the button.",
  "settings.intro.extension-packages":
    "Features you turn on separately. Removing an extension deletes only the files it wrote on this computer.",
  "settings.intro.general":
    "Settings that lophn declares. Only values you change are saved; every other value follows its default.",
  "settings.intro.keyboard":
    "Shortcuts for tabs, the split, and the sidebar. Changes apply on this computer's system only, as soon as you press the new key.",
  "settings.intro.quick-launch":
    "The buttons at the bottom of the left sidebar. Hover Terminal, Browser or App to open a favorite coding agent, a bookmark or an app panel directly. A project can keep its own buttons in Project settings.",
  "settings.intro.remote":
    "Use lophn from your phone or from lophn on your other computers. Your devices form one list: a device you invite here joins every computer in it, and they connect over your local network or the relay.",
  "settings.intro.shell-rules":
    "Before lophn runs a command for an agent, it checks these rules. Deny blocks the command, Ask waits for your answer, and Allow lets it run. The last matching rule wins, and project rules come after global rules. A command that matches no rule runs. In a pattern, * matches any text.",
  "settings.label.machine-picker": "Settings of",
  "settings.notice.this-computer-only":
    "The other settings belong to this computer.",
  "settings.label.accent": "Accent",
  "settings.label.accent-custom": "Pick a color",
  "settings.label.accent-theme": "From theme",
  "settings.label.accent-blue": "Blue",
  "settings.label.accent-green": "Green",
  "settings.label.accent-orange": "Orange",
  "settings.label.accent-purple": "Purple",
  "settings.label.add-entry": "Add an entry",
  "settings.label.appearance-target": "your appearance settings",
  "settings.label.dark-theme": "Dark theme",
  "settings.label.computer-name": "Name",
  "settings.label.keep-awake": "Keep this computer awake",
  "settings.label.keep-running": "Keep lophn running on this computer",
  "settings.label.device-linux": "Linux",
  "settings.label.device-kind-computer": "Computer",
  "settings.label.device-kind-phone": "Phone",
  "settings.label.device-macos": "macOS",
  "settings.label.device-windows": "Windows",
  "settings.label.light-theme": "Light theme",
  "settings.label.mode": "Mode",
  "settings.label.mode-dark": "Dark",
  "settings.label.mode-light": "Light",
  "settings.label.mode-system": "System",
  "settings.label.open-themes-folder": "Open folder",
  "settings.label.remote-device-name": "Name",
  "settings.label.remote-disputed": "Disputed",
  "settings.label.remote-enabled": "Allow phone and computer connections",
  "settings.label.remote-expires": "Expires in {time}",
  "settings.label.remote-expires-later": "Expires {time}",
  "settings.label.remote-invite-long":
    "The new device can't be on at the same time as this computer",
  "settings.label.remote-invite-terminal-input":
    "Let the new device type in this computer's terminals",
  "settings.label.remote-invite-text": "Invite",
  "settings.label.remote-last-connected": "Last connected {time}",
  "settings.label.remote-never-connected": "Never connected",
  "settings.label.remote-pending": "Waiting",
  "settings.label.remote-primary": "Primary",
  "settings.label.remote-qr": "Invite code",
  "settings.label.remote-relay-connected":
    "Reachable from anywhere through the relay",
  "settings.label.remote-relay-unreachable": "Can't reach the relay",
  "settings.label.remote-join-terminal-input":
    "Let the inviting computer type in this computer's terminals",
  "settings.label.remote-terminal-input":
    "Allow typing in this computer's terminals",
  "settings.label.remote-this-computer": "This computer",
  "settings.label.tab-remote": "Remote",
  "settings.label.theme-file": "{name} (file)",
  "settings.label.theme-not-found": "{name} (not found)",
  "settings.label.themes-folder": "Themes folder",
  "settings.note.computer-name-follows":
    "Follows this computer's name ({hostname})",
  "settings.note.computer-name-next-connect":
    "Your other devices see the new name.",
  "settings.note.keep-awake":
    "Stops this computer from going to sleep on its own while lophn runs. Closing the lid or choosing Sleep still puts it to sleep.",
  "settings.note.keep-running":
    "lophn starts when you log in and keeps running after you close its window, so scheduled jobs run and your phone can reach this computer. Stop lophn stops it until you log in again or open lophn.",
  "settings.note.login-off-launchd":
    "Change it in System Settings › General › Login Items.",
  "settings.note.login-off-systemd": "Change it with systemctl --user.",
  "settings.note.login-off-windows": "Change it in Settings › Apps › Startup.",
  "settings.notice.keep-running-moved":
    "lophn now keeps running on this computer after you close its window, and starts when you log in. You can turn this off in Settings › Remote.",
  "settings.reason.development-build": "Not available in a development build",
  "settings.reason.no-inhibitor":
    "This system has no way for lophn to keep it awake.",
  "settings.reason.no-service-manager":
    "This computer has no systemd user session, so lophn can't start at login.",
  "settings.reason.os-failed": "The system refused the change.",
  "settings.reason.unverified-path":
    "lophn is installed in a path it can't register safely.",
  "settings.status.starts-at-login": "Starts when you log in",
  "settings.warning.login-not-registered":
    "lophn couldn't set itself to start at login.",
  "settings.warning.login-off-in-system":
    "Turned off in your system's startup settings.",
  "settings.warning.login-still-registered":
    "lophn is still set to start at login.",
  "settings.note.remote-enabled":
    "While on, lophn listens for your phones and computers on every network interface, connects to your other computers, and keeps running when idle.",
  "settings.note.remote-add":
    "Invite a phone or another computer. It joins every computer in your devices. To bring this computer into another computer's devices, join with an invite made there.",
  "settings.note.remote-invite-computer":
    "On the other computer, open Settings › Remote, press “Join with an invite” and paste the text. Or run lophn remote join there. The invite works once, until it expires.",
  "settings.note.remote-invite-long":
    "The invite lasts 7 days instead of 30 minutes. Use it for the other system of a dual-boot computer, or for a home and a work computer.",
  "settings.note.remote-disputed":
    "Two computers removed each other and this computer cannot tell which one to trust, so both are out. Remove the one you don't trust here and the other comes back.",
  "settings.note.remote-invite-phone":
    "Scan this code with the lophn phone app, or enter it there with “Show as text”. The invite works once, until it expires.",
  "settings.note.remote-invite-terminal-input":
    "On by default: the new device can type into terminals on this computer and run commands as you. Other computers in your devices decide for themselves. Changing this makes a new invite. You can change it later for each device.",
  "settings.note.remote-join-terminal-input":
    "On by default: the inviting computer can type into terminals on this computer and run commands as you. The inviting computer decides separately whether this computer may type into its terminals.",
  "settings.note.remote-join":
    "On the other computer, open Settings › Remote, press “Invite a computer”, then “Show as text”. Copy the text and paste it here.",
  "settings.note.remote-join-start":
    "Bring this computer into the devices of another computer with an invite made there.",
  "settings.note.remote-pending":
    "The computer that invited it was off. It finishes when a device that knows that computer, such as your phone, connects.",
  "settings.note.remote-remove":
    "{name} is cut off on every computer in your devices and cannot join again with its current key. To add it back, invite it again: it joins as a new device.",
  "settings.note.remote-device-terminal-input":
    "While “Allow typing in this computer's terminals” is on for a device, anyone holding that device can type into terminals on this computer and run commands as you. Each computer keeps its own choice: turn it on in Settings › Remote on every computer the device should reach. New versions of your apps made on a computer with this switch on are installed on this computer without asking.",
  "settings.notice.computer-cloned":
    "This lophn was copied from another computer, so it is now a new computer. Invite it again from a computer in your devices.",
  "settings.notice.remote-devices-empty": "No devices yet. Invite one below.",
  "settings.notice.remote-device-joined": "{name} joined your devices.",
  "settings.notice.remote-join-done":
    "This computer joined the devices of the other computer.",
  "settings.notice.remote-join-pending":
    "This computer joined, but the inviting computer was not reached yet. It finishes when a device that knows that computer, such as your phone, connects to this one.",
  "settings.notice.remote-expired": "This invite expired. Make a new one.",
  "settings.notice.remote-off":
    "Turn on connections to see your devices and add one.",
  "settings.notice.remote-this-removed":
    "Another computer removed this computer from your devices {time}. This computer now starts its own list. To join again, use a new invite from a computer in your devices.",
  "settings.notice.remote-starting": "Starting connections…",
  "settings.reason.theme-bad_id":
    "the file name can only use lowercase letters, digits, and -.",
  "settings.reason.theme-bad_shape":
    "it needs an object with name, mode, extends, and colors.",
  "settings.reason.theme-extends_cycle":
    "its extends chain loops back to itself.",
  "settings.reason.theme-id_taken": "a built-in theme already uses this name.",
  "settings.reason.theme-no_mode":
    'it needs "mode": "light" or "dark", or an extends.',
  "settings.reason.theme-not_json": "it isn't valid JSON.",
  "settings.reason.theme-too_large": "it's larger than 256 KB.",
  "settings.reason.theme-unknown_extends":
    "the theme it extends doesn't exist.",
  "settings.label.available": "Available",
  "settings.label.available-no": "Unavailable",
  "settings.label.available-yes": "Available",
  "settings.label.call-agents": "Agent pairs",
  "settings.label.call-allow": "Allow",
  "settings.label.call-effect": "Rule",
  "settings.label.call-from": "From",
  "settings.label.call-home": "Home",
  "settings.label.call-pair": "{from} to {to}",
  "settings.label.call-private": "Private workspaces",
  "settings.label.call-private-workspace": "Workspace",
  "settings.label.call-workspaces": "Workspace pairs",
  "settings.label.call-refuse": "Refuse",
  "settings.label.call-to": "To",
  "settings.label.checked-at": "Checked",
  "settings.label.chosen-default": "Set by you · Default: {value}",
  "settings.label.code-font": "Code font",
  "settings.label.code-font-jetbrains": "JetBrains Mono (built in)",
  "settings.label.code-font-system": "System monospace",
  "settings.label.coding-check-failed": "Couldn't check",
  "settings.label.coding-col-command": "Command",
  "settings.label.coding-col-executable": "Executable",
  "settings.label.coding-col-favorite": "Favorite",
  "settings.label.coding-col-hooks": "Hooks",
  "settings.label.coding-col-product": "Product",
  "settings.label.coding-col-turn-end": "Turn-end signal",
  "settings.label.coding-found": "Found",
  "settings.label.coding-hooks-failed": "Couldn't read or write",
  "settings.label.coding-hooks-installed": "Installed",
  "settings.label.coding-hooks-missing": "Not installed",
  "settings.label.coding-not-checked": "Not checked",
  "settings.label.coding-not-found": "Not found",
  "settings.label.coding-signal-no": "No signal",
  "settings.label.coding-signal-yes": "Has signal",
  "settings.label.coding-shared-apps": "Apps shared with coding agents",
  "settings.label.extension-not-installed": "Not installed",
  "settings.label.extension-off": "Off",
  "settings.label.extension-on": "On",
  "settings.label.extension-problem": "Problem",
  "settings.label.extension-target": "your extensions",
  "settings.label.coding-target": "your coding agents",
  "settings.label.coding-version": "Version {version}",
  "settings.label.coding-version-unknown": "Version unknown",
  "settings.label.component": "Component",
  "settings.label.component-agent-runtime": "Agent runtime",
  "settings.label.component-app-runtime": "App runtime",
  "settings.label.component-core": "Core service",
  "settings.label.component-ledger": "Ledger",
  "settings.label.component-sandbox": "Sandbox",
  "settings.label.default": "Default",
  "settings.label.density": "Density",
  "settings.label.density-comfortable": "Comfortable",
  "settings.label.density-compact": "Compact",
  "settings.label.font": "Font",
  "settings.label.font-not-installed": "Not installed",
  "settings.label.font-weight": "{name} weight",
  "settings.label.font-pretendard": "Pretendard (built in)",
  "settings.label.font-system": "System UI",
  "settings.label.general-target": "your settings",
  "settings.label.group-agents": "Agents",
  "settings.label.group-general": "General",
  "settings.label.group-system": "System",
  "settings.label.key-conflicts":
    "{n, plural, one {# key is used by more than one shortcut.} other {# keys are used by more than one shortcut.}}",
  "settings.label.key-capture": "Press the new keys for {name}",
  "settings.label.key-agent-background":
    "Send the running tool to the background",
  "settings.label.key-agent-clear-input": "Clear the input",
  "settings.label.key-agent-cycle-mode": "Change the mode",
  "settings.label.key-agent-find": "Find in the conversation",
  "settings.label.key-agent-history-next": "Next input",
  "settings.label.key-agent-history-previous": "Previous input",
  "settings.label.key-agent-history-search": "Search the input history",
  "settings.label.key-agent-interrupt": "Stop the agent",
  "settings.label.key-agent-jump-next": "Next message",
  "settings.label.key-agent-jump-previous": "Previous message",
  "settings.label.key-agent-model-picker": "Choose the model",
  "settings.label.key-agent-newline": "New line in the message",
  "settings.label.key-agent-queue": "Queue the message",
  "settings.label.key-agent-rewind": "Rewind the conversation",
  "settings.label.key-agent-scroll-bottom": "Scroll to the latest message",
  "settings.label.key-agent-scroll-page-down": "Scroll the conversation down",
  "settings.label.key-agent-scroll-page-up": "Scroll the conversation up",
  "settings.label.key-agent-scroll-top":
    "Scroll to the start of the conversation",
  "settings.label.key-agent-send": "Send the message",
  "settings.label.key-agent-send-now": "Send the message now",
  "settings.label.key-agent-toggle-details": "Show or hide tool details",
  "settings.label.key-browser-bookmark": "Bookmark this page",
  "settings.label.key-context": "Works in {context}.",
  "settings.label.key-keymap-item": "{name}: {keys}",
  "settings.label.key-home-open": "Go to Home",
  "settings.label.key-missing-command": "{id} (not available)",
  "settings.label.key-palette-open": "Open the command palette",
  "settings.label.key-terminal-copy": "Copy the selection",
  "settings.label.key-terminal-paste": "Paste into the terminal",
  "settings.label.key-desk-close": "Close the desk",
  "settings.label.key-desk-new": "New desk",
  "settings.label.key-desk-next": "Next desk",
  "settings.label.key-desk-nth": "Go to a desk by number",
  "settings.label.key-desk-prev": "Previous desk",
  "settings.label.key-desk-rename": "Rename the desk",
  "settings.label.key-explorer-focus": "Focus the file explorer",
  "settings.label.key-files-quick-open": "Open a file",
  "settings.label.key-float-dock": "Dock the floating panel",
  "settings.label.key-float-minimize": "Fold the floating panels",
  "settings.label.key-inbox-open": "Open Inbox",
  "settings.label.key-jobs-open": "Open Jobs",
  "settings.label.key-agents-save": "Save the agent",
  "settings.label.key-agents-back": "Back in Agents",
  "settings.label.key-agents-forward": "Forward in Agents",
  "settings.label.key-nav-back": "Go back",
  "settings.label.key-nav-forward": "Go forward",
  "settings.label.key-new-agent": "New session",
  "settings.label.key-new-browser": "New browser tab",
  "settings.label.key-new-document": "Open a document",
  "settings.label.key-new-terminal": "New terminal",
  "settings.label.key-missing-app": "{name} (app not found)",
  "settings.label.key-none": "Not set",
  "settings.label.key-numbered": "{modifier}+number",
  "settings.label.key-numbered-mixed": "Changed for some numbers",
  "settings.label.key-pane-close-group": "Close the split",
  "settings.label.key-pane-close-others": "Close other tabs in the pane",
  "settings.label.key-pane-focus": "Focus a pane of the split",
  "settings.label.key-pane-focus-down": "Focus the pane below",
  "settings.label.key-pane-focus-left": "Focus the pane on the left",
  "settings.label.key-pane-focus-right": "Focus the pane on the right",
  "settings.label.key-pane-focus-up": "Focus the pane above",
  "settings.label.key-pane-remove": "Remove the tab from the split",
  "settings.label.key-pane-split": "Split right with the next tab",
  "settings.label.key-pane-split-down": "Split down with the next tab",
  "settings.label.key-pane-stack-next": "Show the next stacked tab",
  "settings.label.key-pane-stack-prev": "Show the previous stacked tab",
  "settings.label.key-pane-swap-down": "Swap with the pane below",
  "settings.label.key-pane-swap-left": "Swap with the pane on the left",
  "settings.label.key-pane-swap-right": "Swap with the pane on the right",
  "settings.label.key-pane-swap-up": "Swap with the pane above",
  "settings.label.key-pane-unsplit": "Unsplit",
  "settings.label.key-pane-unstack": "Move the tab out of the pane",
  "settings.label.key-search": "Search shortcuts",
  "settings.label.key-search-by-key": "Press a shortcut",
  "settings.label.key-search-open": "Search in files",
  "settings.label.key-settings-open": "Open Settings",
  "settings.label.key-sidebar-toggle": "Show or hide the sidebar",
  "settings.label.key-sidebar-toggle-right": "Show or hide the right sidebar",
  "settings.label.key-tab-close": "Close the tab",
  "settings.label.key-tab-close-all": "Close all tabs",
  "settings.label.key-tab-close-others": "Close other tabs",
  "settings.label.key-tab-close-right": "Close tabs to the right",
  "settings.label.key-tab-close-saved": "Close saved tabs",
  "settings.label.key-tab-copy-path": "Copy the file path",
  "settings.label.key-tab-copy-relative-path": "Copy the relative path",
  "settings.label.key-tab-detach": "Detach the tab",
  "settings.label.key-tab-float": "Float the tab",
  "settings.label.key-tab-keep-open": "Keep the tab open",
  "settings.label.key-tab-move-left": "Move the tab left",
  "settings.label.key-tab-move-right": "Move the tab right",
  "settings.label.key-tab-next": "Next tab",
  "settings.label.key-tab-nth": "Go to a tab by number",
  "settings.label.key-tab-prev": "Previous tab",
  "settings.label.key-tab-rename": "Rename the tab",
  "settings.label.key-tab-reopen": "Reopen the closed tab",
  "settings.label.key-tab-reveal": "Reveal in the explorer",
  "settings.label.key-terminal-focus": "Open or focus the terminal",
  "settings.label.quick-open-as": "Open as",
  "settings.label.quick-open-float": "Float",
  "settings.label.quick-open-tab": "Tab",
  "settings.label.quick-show": "Show {name}",
  "settings.label.quick-sidebar-show": "Show {name} in the right sidebar",
  "settings.label.quick-tray-show": "Show {name} in the tray",
  "settings.label.shell-action-allow": "Allow",
  "settings.label.shell-action-ask": "Ask",
  "settings.label.shell-action-deny": "Deny",
  "settings.label.shell-rule-action": "Action",
  "settings.label.shell-rule-pattern": "Command pattern",
  "settings.label.shell-rules-ask-first": "Ask first ({count, number})",
  "settings.label.shell-rules-blocked": "Always blocked ({count, number})",
  "settings.label.shell-rules-target": "your shell rules",
  "settings.label.reading-font": "Reading font",
  "settings.label.reading-font-serif": "Serif",
  "settings.label.reading-font-ui": "Same as interface",
  "settings.label.reading-width": "Reading width",
  "settings.label.reason": "Reason",
  "settings.label.size-default": "Default",
  "settings.label.size-large": "Large",
  "settings.label.size-small": "Small",
  "settings.label.tab-agents": "Agents",
  "settings.label.tab-appearance": "Appearance",
  "settings.label.tab-coding": "Coding agents",
  "settings.label.diagnostics-trace": "Trace",
  "settings.label.tab-diagnostics": "Diagnostics",
  "settings.label.tab-extension-packages": "Extensions",
  "settings.label.tab-extensions": "Tools and skills",
  "settings.label.tab-general": "General",
  "settings.label.tab-keyboard": "Keyboard",
  "settings.label.tab-providers": "Providers",
  "settings.label.tab-quick-launch": "Quick launch",
  "settings.label.tab-shell-rules": "Shell rules",
  "settings.label.taskbar": "Taskbar",
  "settings.label.text-size": "Text size",
  "settings.label.value-custom": "Custom",
  "settings.label.value-items": "{count, plural, one {# item} other {# items}}",
  "settings.label.value-no-default": "None",
  "settings.label.value-not-set": "Not set",
  "settings.label.value-off": "Off",
  "settings.label.value-on": "On",
  "settings.label.way-local": "On this computer",
  "settings.label.way-sign-in": "Sign in with an account",
  "settings.label.weight-100": "Thin",
  "settings.label.weight-200": "Extra light",
  "settings.label.weight-300": "Light",
  "settings.label.weight-400": "Regular",
  "settings.label.weight-500": "Medium",
  "settings.label.weight-600": "Semibold",
  "settings.label.weight-700": "Bold",
  "settings.label.weight-800": "Extra bold",
  "settings.label.weight-900": "Black",
  "settings.label.width-narrow": "Narrow",
  "settings.label.width-standard": "Standard",
  "settings.label.width-wide": "Wide",
  "settings.note.allowed-max": "Allowed: up to {max, number}.",
  "settings.note.allowed-min": "Allowed: at least {min, number}.",
  "settings.note.allowed-range": "Allowed: {min, number} to {max, number}.",
  "settings.note.call-policy":
    "Agents may call each other across workspaces unless you make a workspace private or add a refuse rule here. A workspace pair refuses or allows calls between two workspaces and beats private; an agent pair beats both.",
  "settings.note.call-private":
    "A private project or app takes no calls from other workspaces and sends none to them, home included. Calls inside it still work.",
  "settings.note.coding-detect-note":
    "These are the results from the last check. lophn only checks again when you ask.",
  "settings.note.coding-favorites":
    "Favorites appear under New session and when you hover Terminal in the left sidebar. Command is what the terminal runs; leave it empty for the default.",
  "settings.note.coding-hooks":
    "Hooks let lophn show when a coding agent you start in a terminal is working or waiting for you. Installing them adds lines to the product's own settings file, and uninstalling removes only those lines.",
  "settings.note.coding-shared-apps":
    "Public skills of these apps are copied into the skill folders of the coding agents that have hooks installed. Removing an app deletes those copies.",
  "settings.note.key-agent-background":
    "Keeps the running tool going without waiting for it.",
  "settings.note.key-agent-clear-input": "Clears what you typed.",
  "settings.note.key-agent-cycle-mode": "Cycles through the agent's modes.",
  "settings.note.key-agent-find": "Searches the text of this conversation.",
  "settings.note.key-agent-history": "Brings back input you sent before.",
  "settings.note.key-agent-history-search": "Searches input you sent before.",
  "settings.note.key-agent-interrupt": "Stops the running turn.",
  "settings.note.key-agent-jump": "Moves to that message in the conversation.",
  "settings.note.key-agent-model-picker": "Opens the model picker.",
  "settings.note.key-agent-newline": "Adds a new line without sending.",
  "settings.note.key-agent-queue":
    "Keeps what you typed to send after the running turn.",
  "settings.note.key-agent-rewind":
    "Takes the conversation back to an earlier point.",
  "settings.note.key-agent-scroll":
    "Scrolls the conversation while the cursor stays in the input.",
  "settings.note.key-agent-send": "Sends what you typed to the agent.",
  "settings.note.key-agent-send-now":
    "Sends what you typed without queueing it behind the turn.",
  "settings.note.key-agent-toggle-details":
    "Expands or folds tool details in the conversation.",
  "settings.note.key-app-panel":
    "Opens that app's panel, whether or not it is pinned to the sidebar.",
  "settings.note.key-browser-bookmark": "Adds the open page to bookmarks.",
  "settings.note.key-contributed": "From {source}.",
  "settings.note.key-home-open": "Goes to the Home workspace.",
  "settings.note.key-missing-command":
    "This command isn't available now. Remove the shortcut, or leave it for when the extension or app comes back.",
  "settings.note.key-palette-open":
    "Opens search and commands from anywhere in the window.",
  "settings.note.key-terminal-copy":
    "Copies the selected text in the terminal. With nothing selected, the key still isn't sent to the shell.",
  "settings.note.key-terminal-paste": "Pastes the clipboard into the terminal.",
  "settings.note.key-conflict-reserved":
    "lophn or your OS uses this key first.",
  "settings.note.key-conflict-with": "Also used by {names}.",
  "settings.note.key-capture":
    "Press the new keys. For two keys in a row, press the second within 1.5 seconds. Press Esc to cancel. Press Backspace to remove the shortcut.",
  "settings.note.key-capture-numbered":
    "Press the modifier keys with any number. Press Esc to cancel. Press Backspace to remove the shortcut.",
  "settings.note.key-desk-close":
    "Closes the desk you are on after asking. The main desk can't be closed.",
  "settings.note.key-desk-new": "Opens a new desk.",
  "settings.note.key-desk-next":
    "Goes to the next desk in the list. After the last desk it goes back to the first.",
  "settings.note.key-desk-nth":
    "Goes to desk 1 to 9 in the desk list by its place.",
  "settings.note.key-desk-prev":
    "Goes to the previous desk in the list. Before the first desk it goes to the last.",
  "settings.note.key-desk-rename": "Renames the desk you are on.",
  "settings.note.key-explorer-focus":
    "Opens the sidebar and moves to the list of files and folders.",
  "settings.note.key-files-quick-open":
    "Opens search and commands, where you can type a file name.",
  "settings.note.key-float-dock":
    "Puts the topmost floating panel back into the desk as a card.",
  "settings.note.key-float-minimize":
    "Folds every floating panel that isn't pinned.",
  "settings.note.key-inbox-open": "Opens the Inbox.",
  "settings.note.key-jobs-open": "Opens Jobs.",
  "settings.note.key-nav-back":
    "Goes back to where you were before in this window.",
  "settings.note.key-agents-save":
    "Saves the agent you are editing in the Agents tab.",
  "settings.note.key-agents-back":
    "Goes back to the previous agent or the list in the Agents tab.",
  "settings.note.key-agents-forward":
    "Goes forward again after going back in the Agents tab.",
  "settings.note.key-nav-forward": "Goes forward again after going back.",
  "settings.note.key-new-agent": "Opens a new lophn session.",
  "settings.note.key-new-browser": "Opens a new browser tab.",
  "settings.note.key-new-document":
    "Opens a file picker and opens the file you choose.",
  "settings.note.key-new-terminal": "Opens a new terminal tab.",
  "settings.note.key-pane-close-group":
    "Closes every tab in the current split.",
  "settings.note.key-pane-close-others":
    "Closes the other tabs stacked in the current pane.",
  "settings.note.key-pane-focus":
    "Moves to the first to fourth pane of the split, in left-to-right, top-to-bottom order.",
  "settings.note.key-pane-focus-direction":
    "Moves to the neighbouring pane of the split in that direction. It stops at the edge. It works inside the editor and terminal too.",
  "settings.note.key-pane-remove":
    "Takes the current tab out of its split and leaves the rest as is.",
  "settings.note.key-pane-split":
    "Joins the current tab with the next tab into a split on its right.",
  "settings.note.key-pane-split-down":
    "Joins the current tab with the next tab into a split below it.",
  "settings.note.key-pane-stack-next":
    "Cycles forward through the tabs stacked in the current pane.",
  "settings.note.key-pane-stack-prev":
    "Cycles back through the tabs stacked in the current pane.",
  "settings.note.key-pane-swap-down":
    "Swaps the current tab with the tab in the pane below it.",
  "settings.note.key-pane-swap-left":
    "Swaps the current tab with the tab in the pane on its left.",
  "settings.note.key-pane-swap-right":
    "Swaps the current tab with the tab in the pane on its right.",
  "settings.note.key-pane-swap-up":
    "Swaps the current tab with the tab in the pane above it.",
  "settings.note.key-pane-unsplit":
    "Breaks the split of the current tab into separate tabs.",
  "settings.note.key-pane-unstack":
    "Takes the current tab out of the tabs stacked in its pane.",
  "settings.note.key-missing-app":
    "This app or screen is gone. Remove the shortcut.",
  "settings.note.key-taken": "{key} is used by {name}.",
  "settings.note.key-search-by-key":
    "Press keys to find what uses them. Backspace clears.",
  "settings.note.key-search-open":
    "Opens the sidebar's search to find text across this project's files.",
  "settings.note.key-settings-open": "Opens Settings.",
  "settings.note.key-sidebar-toggle":
    "Folds the sidebar to its icons, or opens it again.",
  "settings.note.key-sidebar-toggle-right":
    "Folds the right sidebar to its icons, or opens it again.",
  "settings.note.key-tab-close": "Closes the tab you're looking at.",
  "settings.note.key-tab-close-all": "Closes every tab in the tab strip.",
  "settings.note.key-tab-close-others":
    "Closes every tab except the one you are looking at.",
  "settings.note.key-tab-close-right":
    "Closes the tabs after the current one in the tab strip.",
  "settings.note.key-tab-close-saved":
    "Closes tabs that have no unsaved changes.",
  "settings.note.key-tab-copy-path":
    "Copies the full path of the current tab's file.",
  "settings.note.key-tab-copy-relative-path":
    "Copies the path of the current tab's file relative to the project folder.",
  "settings.note.key-tab-detach": "Moves the current tab into its own window.",
  "settings.note.key-tab-float": "Moves the current tab into a floating panel.",
  "settings.note.key-tab-keep-open":
    "Turns a preview tab into a regular tab that stays open.",
  "settings.note.key-tab-move-left":
    "Moves the current tab one place to the left in the tab strip.",
  "settings.note.key-tab-move-right":
    "Moves the current tab one place to the right in the tab strip.",
  "settings.note.key-tab-next": "Goes to the next tab in the tab strip.",
  "settings.note.key-tab-nth":
    "Goes to tab 1 to 9 in the tab strip by its place. 0 goes to the last tab.",
  "settings.note.key-tab-prev": "Goes to the previous tab in the tab strip.",
  "settings.note.key-tab-rename": "Renames the tab you are looking at.",
  "settings.note.key-tab-reopen":
    "Opens the tab you closed most recently, where it was.",
  "settings.note.key-tab-reveal":
    "Shows the current tab's file in the file explorer.",
  "settings.note.key-terminal-focus":
    "Goes to a terminal tab in this project, or opens one if there is none.",
  "settings.note.not-set":
    "That feature won't start. Everything else keeps working.",
  "settings.note.quick-app-panels":
    "Pin an app panel to give it its own button. Tab opens it as a tab; Float opens it as a floating panel where you last left it.",
  "settings.note.quick-no-tray": "No installed app has a tray screen.",
  "settings.note.quick-sidebar-panels":
    "Installed app screens show as a tab in the right sidebar of every workspace by default. Turn one off to hide it.",
  "settings.note.quick-tray":
    "Installed app screens show as an item in the taskbar tray by default (next to the right sidebar tabs when the taskbar is off). Click one to open the screen as a popup. Turn one off to hide it.",
  "settings.note.shell-rules-built-in":
    "Rules you add can't unblock anything that is always blocked.",
  "settings.note.shell-rules-project":
    "Applies only to this project, after the global rules.",
  "settings.note.shell-rules-global":
    "Applies to every project. A new rule goes at the end of the list.",
  "settings.shell-density.help":
    "How much room lists and tables leave between rows.",
  "settings.shell-density.name": "Density",
  "settings.shell-reading_width.help":
    "How wide documents are laid out when you read them.",
  "settings.shell-reading_width.name": "Reading width",
  "settings.shell-text_size.help": "The size of text across lophn.",
  "settings.shell-text_size.name": "Text size",
  "settings.shell-mode.help": "Light, dark, or follow the system setting.",
  "settings.shell-mode.name": "Mode",
  "settings.note.extension-remove":
    "This deletes the files {name} wrote on this computer. Files you put in its folder stay.",
  "settings.title.extension-remove": "Remove {name}?",
  "settings.title.not-set": "{name} is not set",
  "settings.title.remote-remove": "Remove {name}?",
  "settings.title.screen": "Settings",
} as const;
