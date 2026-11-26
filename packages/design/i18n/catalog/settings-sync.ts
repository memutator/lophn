// Settings › My computers (sync, app policies, transfers, staged settings, and folders).
export const settingsSync = {
  "settings-sync.label.tab": "My computers",
  "settings-sync.intro":
    "How your apps' files reach your other computers. lophn picks the way by itself: a direct connection, your hub, your phone carrying them, or a folder your computers all see.",
  "settings-sync.heading.folders": "Sync folders",
  "settings-sync.heading.computers": "Computers",
  "settings-sync.heading.apps": "App data sync",
  "settings-sync.heading.available": "Available from other computers",
  "settings-sync.heading.transfers": "Received & sent files",
  "settings-sync.heading.staged": "Staged settings & workflows",
  "settings-sync.label.shared": "Folder all my computers see",
  "settings-sync.note.shared-empty":
    "Not set. Pick a folder that Google Drive or Syncthing moves between your computers, or a disk both systems of a dual boot see. You can also ask lophn to set one up.",
  "settings-sync.note.shared-set":
    "Each computer puts the files it carries here and takes in the others' after checking their signatures.",
  "settings-sync.note.named-empty":
    "No named folders. An app can keep its data in one so other tools can move it.",
  "settings-sync.button.choose": "Choose…",
  "settings-sync.button.edit": "Edit",
  "settings-sync.button.remove": "Remove",
  "settings-sync.button.add": "Add a folder",
  "settings-sync.button.open-remote": "Open My computers",
  "settings-sync.button.open-inbox": "Open inbox",
  "settings-sync.button.clear-transfer": "Clear",
  "settings-sync.button.apply-held": "Apply held",
  "settings-sync.button.discard-held": "Discard held",
  "settings-sync.button.staged-apply": "Apply",
  "settings-sync.button.staged-dismiss": "Dismiss",
  "settings-sync.label.folder-name": "Name",
  "settings-sync.label.folder-path": "Folder",
  "settings-sync.state.missing": "Folder not found",
  "settings-sync.state.not-writable": "Can't write to this folder",
  "settings-sync.warning.plain":
    "lophn writes your apps' data into this folder as plain files. If a tool such as Google Drive uploads it, the files go up unencrypted.",
  "settings-sync.warning.duplicate-machine":
    "Sync is paused for this computer because two entries in your devices share its machine ID. Remove the duplicate in Settings › My computers.",
  "settings-sync.warning.held-changes":
    "{count, plural, one {# held change} other {# held changes}}",
  "settings-sync.warning.staged-permissions":
    "Includes permission rules or locked settings",
  "settings-sync.error.load-failed": "Couldn't read the sync settings.",
  "settings-sync.error.held-failed":
    "Couldn't resolve held changes. Try again.",
  "settings-sync.error.staged-confirm-required":
    "Confirm the permission rules checkbox before applying.",
  "settings-sync.error.staged-failed":
    "Couldn't update the staged settings. Try again.",
  "settings-sync.label.this-computer": "This computer",
  "settings-sync.note.no-other-computers":
    "No other computers yet. Add one above.",
  "settings-sync.note.remote-off":
    "Turn on connections above to connect your computers.",
  "settings-sync.note.received":
    "Last files received {via, select, link {over the connection} phone {via your phone} other {via the shared folder}}, {time}",
  "settings-sync.label.destination-computers": "all my computers",
  "settings-sync.label.policy-computers": "My computers",
  "settings-sync.label.policy-local": "This computer only",
  "settings-sync.label.policy-mixed": "Mixed",
  "settings-sync.label.override-default": "Default",
  "settings-sync.label.override-computers": "My computers",
  "settings-sync.label.override-local": "This computer only",
  "settings-sync.label.override-label": "Sync policy for {app}",
  "settings-sync.note.conflict-keep-both": "Conflicts: Keep both",
  "settings-sync.note.syncs-to": "Syncs to {folder}",
  "settings-sync.note.synced": "Last synced {time}",
  "settings-sync.note.never-synced": "Never synced",
  "settings-sync.note.apps-empty": "No apps installed on this computer yet.",
  "settings-sync.note.available-empty":
    "Nothing to install. An app shows up here when another computer shares it and it is not on this computer yet.",
  "settings-sync.note.available-from": "From {machine}",
  "settings-sync.note.transfers-empty":
    "No file transfers yet. Send files with lophn send or attach them to a handoff.",
  "settings-sync.label.transfer-from": "From {computer}",
  "settings-sync.label.transfer-to": "To {computer}",
  "settings-sync.state.transfer-queued": "Waiting to deliver",
  "settings-sync.state.transfer-held": "Held at @{hub}",
  "settings-sync.state.transfer-held-generic": "Held at hub",
  "settings-sync.state.transfer-delivered": "Delivered",
  "settings-sync.state.transfer-expired": "Expired",
  "settings-sync.state.transfer-failed": "Failed",
  "settings-sync.note.executable-stripped": "Executable bit stripped",
  "settings-sync.note.staged-empty":
    "No staged settings or workflows waiting to be reviewed.",
  "settings-sync.label.staged-from": "From {computer} · {time}",
  "settings-sync.label.staged-kind-agent": "Agent",
  "settings-sync.label.staged-kind-skill": "Skill",
  "settings-sync.label.staged-kind-project_command": "Project command",
  "settings-sync.label.staged-kind-permission_rules": "Permission rules",
  "settings-sync.label.staged-kind-workflow": "Workflow",
  "settings-sync.label.staged-files":
    "{count, plural, one {# file} other {# files}}",
  "settings-sync.label.staged-confirm-permissions":
    "I reviewed the permission rules and locked settings and want to apply them on this computer",
  "settings-sync.label.staged-overwrite":
    "Overwrite existing items with the same name",
  "settings-sync.note.staged-applied":
    "Applied {applied, plural, one {# item} other {# items}}.",
  "settings-sync.note.staged-applied-conflicts":
    "Applied {applied, number}, skipped {skipped, number} existing. Check overwrite to replace.",
  "settings-sync.label.attachments-count":
    "{count, plural, one {# file attached} other {# files attached}}",
  "settings-sync.label.attachment-inbox": "inbox/{transfer}/{path}",
} as const;
