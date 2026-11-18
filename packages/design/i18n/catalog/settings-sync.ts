// Settings › Sync: the folders files travel through, which way each computer's files last arrived, and when each app last caught up.
export const settingsSync = {
  "settings-sync.label.tab": "Sync",
  "settings-sync.intro":
    "How your apps' files reach your other computers. lophn picks the way by itself: a direct connection, your phone carrying them, or a folder your computers all see. You choose only the folders.",
  "settings-sync.heading.folders": "Folders",
  "settings-sync.heading.computers": "Computers",
  "settings-sync.heading.apps": "Apps",
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
  "settings-sync.button.open-remote": "Open Remote",
  "settings-sync.label.folder-name": "Name",
  "settings-sync.label.folder-path": "Folder",
  "settings-sync.state.missing": "Folder not found",
  "settings-sync.state.not-writable": "Can't write to this folder",
  "settings-sync.warning.plain":
    "lophn writes your apps' data into this folder as plain files. If a tool such as Google Drive uploads it, the files go up unencrypted.",
  "settings-sync.error.load-failed": "Couldn't read the sync settings.",
  "settings-sync.label.this-computer": "This computer",
  "settings-sync.note.no-other-computers":
    "No other computers yet. Add one in Settings › Remote.",
  "settings-sync.note.remote-off": "Turn on Remote to connect your computers.",
  "settings-sync.note.received":
    "Last files received {via, select, link {over the connection} phone {via your phone} other {via the shared folder}}, {time}",
  "settings-sync.label.destination-computers": "all my computers",
  "settings-sync.note.syncs-to": "Syncs to {folder}",
  "settings-sync.note.synced": "Last synced {time}",
  "settings-sync.note.never-synced": "Never synced",
  "settings-sync.note.apps-empty": "No app syncs to other computers yet.",
} as const;
