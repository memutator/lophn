export const workspaceSettings = {
  "settings.agents-model-catalog_auto_update.help":
    "Fetch the list of models each provider offers.",
  "settings.agents-model-catalog_auto_update.name":
    "Update the model catalog automatically",
  "settings.agents-run-fallback_model.help":
    "Used when the chosen model isn't available.",
  "settings.agents-run-fallback_model.name": "Fallback model",
  "settings.agents-run-max_minutes.help":
    "A turn is interrupted after this long.",
  "settings.agents-run-max_minutes.name": "Minutes per turn",
  "settings.agents-run-max_tool_calls.help":
    "A turn stops after this many tool calls.",
  "settings.agents-run-max_tool_calls.name": "Tool calls per turn",
  "settings.agents-run-on_limit.help":
    "What lophn does when a turn hits the tool call or time limit.",
  "settings.agents-run-on_limit.name": "When a turn reaches its limit",
  "settings.appearance.density-help":
    "How much room lists and tables leave between rows.",
  "settings.appearance.reading-width-help":
    "How wide documents are laid out when you read them.",
  "settings.appearance.text-size-help": "The size of text across lophn.",
  "settings.appearance.theme-help":
    "Light, dark, or follow the system setting.",
  "settings.backup.app-export-failed":
    "The copy couldn't be made. Nothing changed. Try again.",
  "settings.backup.app-export-heading": "Take an app's data out.",
  "settings.backup.app-export-note":
    "This makes a separate copy of one app's records. It is not part of a backup, and app data outside the app (like attached files) is not included.",
  "settings.backup.app-export-ready":
    "The copy is ready in the folder lophn made for it.",
  "settings.backup.created":
    "Backup {time} holds your records and settings. You can restore it.",
  "settings.backup.created-failed":
    "The backup couldn't be read. Use the latest backup that passed its check.",
  "settings.backup.excluded-heading": "Not included in backups.",
  "settings.backup.excluded-note":
    "App data, projects and app files, the OS keychain, and credentials are not part of a backup.",
  "settings.backup.expand-unavailable":
    "This backup can't be restored. Nothing changed.",
  "settings.backup.heading": "Backup and restore",
  "settings.backup.intro":
    "Backups hold your records and settings. Restoring replaces what is here now with a backup.",
  "settings.backup.lost-count":
    "{count, plural, one {# record} other {# records}} made after this backup will be lost.",
  "settings.backup.lost-heading":
    "This restores to {time} and drops records after that.",
  "settings.backup.lost-none":
    "No records were made after this backup. Nothing is lost.",
  "settings.backup.none": "No backups are available yet.",
  "settings.backup.reconnect":
    "Credentials aren't restored. Sign in to each connection again to use it.",
  "settings.backup.reconnect-heading": "After a restore.",
  "settings.backup.restore-complete":
    "Restored. Your records now match the backup. Check connections that need signing in again.",
  "settings.backup.restore-failed":
    "The restore didn't finish. Your records are unchanged. Try again.",
  "settings.backup.restore-failed-plan":
    "The restore couldn't start. Your records are unchanged. Try again.",
  "settings.backup.restore-restarted":
    "The restore is working. lophn restarts when it is done.",
  "settings.backup.retained":
    "The last {count, plural, one {# checked backup} other {# checked backups}} are kept. Newer backups that failed a check are replaced by the latest one that passed.",
  "settings.backup.secrets-heading": "Secrets.",
  "settings.backup.secrets-note":
    "Passwords and keys aren't in backups. Move them separately with a passphrase-protected file.",
  "settings.backup.secrets-window":
    "Finish in the window that opened. It holds the secret value.",
  "settings.backup.tab-not-restoreable":
    "This backup failed a check or was made while lophn was busy. The latest checked backup stays usable.",
  "settings.button.add-entry": "Add",
  "settings.button.before-restore": "Restore",
  "settings.button.check-security": "Check security",
  "settings.button.choose-in-agents": "Choose in Agents",
  "settings.button.choose-package": "Choose update file",
  "settings.button.connect-with": "Connect {name}",
  "settings.button.detect-again": "Detect again",
  "settings.button.export-app": "Export",
  "settings.button.export-secrets": "Export secrets",
  "settings.button.import-secrets": "Import secrets",
  "settings.button.remove-entry": "Remove {item}",
  "settings.button.reset-default": "Reset to default",
  "settings.button.restore-again": "Try the restore again",
  "settings.button.revoke": "Revoke",
  "settings.button.run-checks": "Run checks",
  "settings.button.stop-and-update": "Stop for the update",
  "settings.check.clean": "No problems were found in the security check.",
  "settings.diagnostics.check-failed":
    "The check couldn't start right now. Try again.",
  "settings.diagnostics.check-failed-no":
    "The check hasn't run yet. Check the access connections use.",
  "settings.diagnostics.checked-at": "Checked {time}.",
  "settings.diagnostics.clean-row": "No problem was found in this check.",
  "settings.diagnostics.heading": "Diagnose problems",
  "settings.diagnostics.intro":
    "Check the access connections use and how records save names and keys.",
  "settings.diagnostics.last-run": "Last run at {time}.",
  "settings.diagnostics.next-raw-key":
    "Replace the key to keep it out of records.",
  "settings.diagnostics.next-wide-grant":
    "Give the connection a smaller scope.",
  "settings.diagnostics.not-run":
    "No check has run yet. Checks run only when you press the button.",
  "settings.diagnostics.raw-failed":
    "The raw results couldn't load. Try again.",
  "settings.diagnostics.raw-heading": "Raw check results.",
  "settings.diagnostics.raw-intro":
    "The same results as the check above, with the exact names and codes.",
  "settings.diagnostics.raw-key":
    "A record holds a key that looks like a saved password.",
  "settings.diagnostics.wide-grant":
    "A connection can read more than it needs.",
  "settings.empty.general": "No settings are declared yet.",
  "settings.error.coding-conflict":
    "A connection like this already exists, so nothing was connected.",
  "settings.error.coding-defaults":
    "The options weren't saved. Nothing changed. Try again.",
  "settings.error.coding-detect":
    "Couldn't check again. The earlier results are still shown.",
  "settings.error.coding-not-detected":
    "That product wasn't found on this computer, so nothing was connected.",
  "settings.error.coding-refused":
    "lophn didn't accept that choice. Nothing was connected.",
  "settings.error.coding-revoke-window":
    "The confirmation window didn't open. Try again.",
  "settings.error.coding-unavailable": "Couldn't connect right now. Try again.",
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
  "settings.heading.coding-access": "Connections to lophn",
  "settings.heading.coding-agents": "Coding agents",
  "settings.heading.coding-defaults": "Default run options",
  "settings.heading.values": "Settings",
  "settings.intro.appearance":
    "How lophn looks. Changes apply as soon as you choose.",
  "settings.intro.coding":
    "Products on this computer that App Engineers can hand a task to.",
  "settings.intro.diagnostics":
    "Whether each part of lophn can be used right now. Checks run only when you press the button.",
  "settings.intro.general":
    "Settings that lophn declares. Only values you change are saved; every other value follows its default.",
  "settings.intro.reactions":
    "When something happens, lophn can open a new agent session for it. Choose what happens for each event. By default lophn opens the session without asking.",
  "settings.intro.screen":
    "Connect your accounts, add skills and tool servers, and review your settings.",
  "settings.label.add-entry": "Add an entry",
  "settings.label.appearance-target": "your appearance settings",
  "settings.label.applies": "Applies",
  "settings.label.apply-next-call": "Starting with the next call",
  "settings.label.apply-next-work": "Starting with new work",
  "settings.label.apply-now": "Right away",
  "settings.label.available": "Available",
  "settings.label.available-no": "Unavailable",
  "settings.label.available-yes": "Available",
  "settings.label.backup-target": "your backups",
  "settings.label.checked-at": "Checked",
  "settings.label.chosen-default": "Set by you · Default: {value}",
  "settings.label.coding-check-failed": "Couldn't check",
  "settings.label.coding-check-failed-stage": "Doesn't work",
  "settings.label.coding-check-line": "{stage}: {result}",
  "settings.label.coding-check-ok": "Works",
  "settings.label.coding-check-unknown": "Not confirmed",
  "settings.label.coding-col-executable": "Executable",
  "settings.label.coding-col-product": "Product",
  "settings.label.coding-col-sign-in": "Sign-in",
  "settings.label.coding-col-skill": "Skill",
  "settings.label.coding-col-takes-task": "Takes a task",
  "settings.label.coding-col-turn-end": "Turn-end signal",
  "settings.label.coding-connections-target": "your coding agent connections",
  "settings.label.coding-default-name": "{name} on this computer",
  "settings.label.coding-default-none": "No default",
  "settings.label.coding-default-product": "Default product",
  "settings.label.coding-detail-candidate": "{path} (from {source})",
  "settings.label.coding-detail-executable": "Found at {path}",
  "settings.label.coding-detail-probe": "{probe}: {outcome}",
  "settings.label.coding-detail-resource": "{place}: {outcome}",
  "settings.label.coding-details": "Details",
  "settings.label.coding-found": "Found",
  "settings.label.coding-install-complete": "Set up",
  "settings.label.coding-install-details": "Where it was set up",
  "settings.label.coding-install-error": "Setup didn't finish",
  "settings.label.coding-install-failed": "Not set up",
  "settings.label.coding-install-partial": "Partly set up",
  "settings.label.coding-launch-no": "Can't take a task",
  "settings.label.coding-launch-yes": "Ready",
  "settings.label.coding-model": "Model",
  "settings.label.coding-not-checked": "Not checked",
  "settings.label.coding-not-found": "Not found",
  "settings.label.coding-scope-all": "All apps",
  "settings.label.coding-scope-one-app": "Only {name}",
  "settings.label.coding-scope-one-app-unknown": "One app",
  "settings.label.coding-scope-pick-app": "One app",
  "settings.label.coding-sign-in-not-found": "No sign-in found",
  "settings.label.coding-sign-in-unknown": "Sign-in not checked",
  "settings.label.coding-signal-no": "No signal",
  "settings.label.coding-signal-yes": "Has signal",
  "settings.label.coding-signed-in": "Signed in",
  "settings.label.coding-stage-connect": "Connects to lophn",
  "settings.label.coding-stage-guide": "Reads the app guide",
  "settings.label.coding-stage-other": "Another check",
  "settings.label.coding-stage-skills": "Finds the lophn skills",
  "settings.label.coding-stage-tools": "Finds the lophn tools",
  "settings.label.coding-state-active": "Active",
  "settings.label.coding-state-revoked": "Revoked",
  "settings.label.coding-target": "your coding agents",
  "settings.label.coding-version": "Version {version}",
  "settings.label.coding-version-unknown": "Version unknown",
  "settings.label.component": "Component",
  "settings.label.component-agent-runtime": "Agent runtime",
  "settings.label.component-app-runtime": "App runtime",
  "settings.label.component-core": "Core service",
  "settings.label.component-events": "Event stream",
  "settings.label.component-ledger": "Ledger",
  "settings.label.component-sandbox": "Sandbox",
  "settings.label.connection-name": "Connection name",
  "settings.label.connection-scope": "What it can reach",
  "settings.label.default": "Default",
  "settings.label.density": "Density",
  "settings.label.density-comfortable": "Comfortable",
  "settings.label.density-compact": "Compact",
  "settings.label.general-target": "your settings",
  "settings.label.group-agents": "Agents",
  "settings.label.group-general": "General",
  "settings.label.group-integrations": "Integrations",
  "settings.label.group-preferences": "Preferences",
  "settings.label.group-system": "System",
  "settings.label.harness-claude": "Claude Code",
  "settings.label.harness-codex": "Codex",
  "settings.label.harness-gemini": "Gemini CLI",
  "settings.label.harness-hermes": "Hermes",
  "settings.label.harness-openclaw": "OpenClaw",
  "settings.label.harness-opencode": "OpenCode",
  "settings.label.harness-pi": "pi",
  "settings.label.integrity": "Check",
  "settings.label.integrity-failed": "Failed",
  "settings.label.integrity-passed": "Passed",
  "settings.label.nav": "Settings sections",
  "settings.label.notifications-target": "notification settings",
  "settings.label.reaction-activation-failed": "Activation failed",
  "settings.label.reaction-ask": "Ask",
  "settings.label.reaction-context-violation": "Context violation",
  "settings.label.reaction-off": "Off",
  "settings.label.reaction-open": "Open without asking",
  "settings.label.reaction-problem-opened": "Problem opened",
  "settings.label.reaction-problem-reopened": "Problem reopened",
  "settings.label.reaction-restart-halted": "App restart halted",
  "settings.label.reactions-target": "your reaction settings",
  "settings.label.reading-width": "Reading width",
  "settings.label.reason": "Reason",
  "settings.label.retained-through": "Holds records through",
  "settings.label.size-default": "Default",
  "settings.label.size-large": "Large",
  "settings.label.size-small": "Small",
  "settings.label.source": "Where it comes from",
  "settings.label.source-default": "lophn's default",
  "settings.label.source-you": "Changed by you",
  "settings.label.state": "State",
  "settings.label.state-ready": "Ready",
  "settings.label.tab-agents": "Agents",
  "settings.label.tab-appearance": "Appearance",
  "settings.label.tab-coding": "Coding agents",
  "settings.label.tab-diagnostics": "Diagnostics",
  "settings.label.tab-extensions": "Tools and skills",
  "settings.label.tab-general": "General",
  "settings.label.tab-notifications": "Notifications",
  "settings.label.tab-providers": "Providers",
  "settings.label.tab-reactions": "Reactions",
  "settings.label.tab-update": "Update lophn",
  "settings.label.text-size": "Text size",
  "settings.label.theme": "Theme",
  "settings.label.theme-dark": "Dark",
  "settings.label.theme-light": "Light",
  "settings.label.theme-system": "System",
  "settings.label.value-custom": "Custom",
  "settings.label.value-items": "{count, plural, one {# item} other {# items}}",
  "settings.label.value-no-default": "None",
  "settings.label.value-not-set": "Not set",
  "settings.label.value-off": "Off",
  "settings.label.value-on": "On",
  "settings.label.way-local": "On this computer",
  "settings.label.way-sign-in": "Sign in with an account",
  "settings.label.width-narrow": "Narrow",
  "settings.label.width-standard": "Standard",
  "settings.label.width-wide": "Wide",
  "settings.note.allowed-max": "Allowed: up to {max, number}.",
  "settings.note.allowed-min": "Allowed: at least {min, number}.",
  "settings.note.allowed-range": "Allowed: {min, number} to {max, number}.",
  "settings.note.coding-checked-again": "Checked again just now.",
  "settings.note.coding-checks-unavailable":
    "lophn couldn't check yet whether it loads.",
  "settings.note.coding-connect-note":
    "Pressing Connect is your permission. There's no token to create or paste.",
  "settings.note.coding-connected": "{name} is connected.",
  "settings.note.coding-default-used":
    "Used when an App Engineer does not pick one.",
  "settings.note.coding-defaults-saved": "Saved.",
  "settings.note.coding-detect-note":
    "These are the results from the last check. lophn only checks again when you ask.",
  "settings.note.coding-intro":
    "Connect the coding agent you already use. lophn only sets up the product you pick.",
  "settings.note.coding-model":
    "Leave it empty to use the product's own default model.",
  "settings.note.coding-name-help":
    "A name you'll recognize. It tells connections apart.",
  "settings.note.coding-no-connections": "No coding agent is connected yet.",
  "settings.note.coding-revoke-waiting":
    "Waiting for your decision in the confirmation window.",
  "settings.note.coding-revoked-note":
    "lophn no longer accepts this connection. Anything already running in your coding agent keeps running.",
  "settings.note.coding-scope-all-note": "It can work on any of your apps.",
  "settings.note.coding-scope-app-note":
    "It can only work on the app you pick.",
  "settings.note.coding-signal":
    "Without a turn-end signal, lophn sends only the first prompt and no follow-up messages. A product that can't take the first prompt is not offered as a default.",
  "settings.note.coding-start-note":
    "Setting up isn't the same as starting. Start a task from its Tasks tab, or from your own terminal.",
  "settings.note.not-set":
    "That feature won't start. Everything else keeps working.",
  "settings.note.reactions-ask":
    "Ask puts a request in the waiting list and opens the session when you allow it. Events that close a task handed to an App Engineer are not listed; they always reach that App Engineer.",
  "settings.notifications.changed": "Saved. Notifications follow this choice.",
  "settings.notifications.changed-failed":
    "The choice wasn't saved. Nothing changed. Try again.",
  "settings.notifications.heading": "Notifications",
  "settings.notifications.help":
    "The notification opens lophn. It doesn't include message contents.",
  "settings.notifications.intro":
    "lophn can show a system notification when something needs your attention.",
  "settings.notifications.label": "System notifications",
  "settings.problems-detail_collection.help":
    "Keep a snapshot with each reported problem.",
  "settings.problems-detail_collection.name": "Collect problem details",
  "settings.projects-search-skip_patterns.help":
    "Added to the patterns from .gitignore.",
  "settings.projects-search-skip_patterns.name":
    "Extra patterns to skip in project search",
  "settings.reaction.activation-failed-when":
    "A new release could not be activated.",
  "settings.reaction.context-violation-when":
    "A project gets a context violation it did not have at the last check.",
  "settings.reaction.opens-app-engineer":
    "Opens: a new session for that app's App Engineer.",
  "settings.reaction.opens-project-manager":
    "Opens: a new session for that project's Project Manager.",
  "settings.reaction.opens-release-engineer":
    "Opens: a new session for that release's App Engineer.",
  "settings.reaction.problem-opened-when":
    "An app reports a problem for the first time.",
  "settings.reaction.problem-reopened-when":
    "A problem marked resolved shows up again in the active release.",
  "settings.reaction.restart-halted-when":
    "An app kept crashing and lophn stopped restarting it.",
  "settings.shell-density.help":
    "How much room lists and tables leave between rows.",
  "settings.shell-density.name": "Density",
  "settings.shell-reading_width.help":
    "How wide documents are laid out when you read them.",
  "settings.shell-reading_width.name": "Reading width",
  "settings.shell-text_size.help": "The size of text across lophn.",
  "settings.shell-text_size.name": "Text size",
  "settings.shell-theme.help": "Light, dark, or follow the system setting.",
  "settings.shell-theme.name": "Theme",
  "settings.title.not-set": "{name} is not set",
  "settings.title.screen": "Settings",
  "settings.update.deployment-unverified":
    "Updates on your system aren't checked by lophn yet. Check the file before applying it.",
  "settings.update.heading": "Update lophn",
  "settings.update.intro":
    "You choose when to update. lophn doesn't download or restart by itself.",
  "settings.update.new-version":
    "Update file is version {version} for {os}. This version is {current}.",
  "settings.update.no-package": "No update file is chosen yet.",
  "settings.update.package-unreadable":
    "That file isn't an update file lophn can read. Choose the update file again.",
  "settings.update.restart-required":
    "lophn stops cleanly before the update and you start it again.",
  "settings.update.schema-compatible":
    "Your records keep working with this update.",
  "settings.update.schema-migration":
    "Your records are converted the first time lophn starts after the update. Going back later won't convert them back.",
  "settings.update.schema-newer":
    "This update is older than your records. It isn't applied.",
  "settings.update.stop-failed":
    "lophn couldn't confirm it stopped cleanly, so nothing was changed. Close your work and try again.",
  "settings.update.stopped": "lophn stopped cleanly. Start lophn again.",
  "settings.update.system-mismatch":
    "That file installs on a different system, so it isn't applied.",
  "settings.usage.loading": "Reading use and cost.",
} as const;
