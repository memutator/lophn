export const workspace = {
  "common.button.palette-dock-panel": "Dock panel",
  "common.button.palette-float-tab": "Float tab",
  "common.button.palette-home": "Go to Home",
  "common.button.palette-minimize-panel": "Minimize panel",
  "common.button.palette-open": "Search and commands",
  "common.button.palette-project-settings": "Project settings",
  "common.button.palette-settings": "Open Settings",
  "common.button.palette-terminal": "Open terminal",
  "common.heading.apps": "Apps",
  "common.heading.palette-actions": "Actions",
  "common.heading.palette-files": "Files",
  "common.heading.palette-tabs": "Open tabs",
  "common.heading.projects": "Projects",
  "common.label.window-close": "Close window",
  "common.label.window-maximize": "Maximize window",
  "common.label.window-minimize": "Minimize window",
  "common.label.window-restore": "Restore window",
  "common.title.palette-desktop": "Search projects and apps",
  "common.title.palette-workspace": "Search this project",
  "home.button.add-folder": "Add folder",
  "home.button.archive": "Archive",
  "home.button.choose-location": "Choose new location",
  "home.button.create-app": "Create",
  "home.button.delete": "Delete",
  "home.button.details": "Details",
  "home.button.hide-details": "Hide details",
  "home.button.identity-relink": "Relink {title} here",
  "home.button.more": "More actions for {name}",
  "home.button.new-app": "New app",
  "home.button.register": "Register",
  "home.button.register-project": "Register project",
  "home.button.remove-folder": "Remove folder",
  "home.button.show-details": "Show details",
  "home.button.unarchive": "Unarchive",
  "home.dialog.delete-app-conversations": "Conversations with the app's agent",
  "home.dialog.delete-app-intro":
    "This permanently deletes the app. It can't be undone.",
  "home.dialog.delete-app-kept": "Secret values you saved are kept.",
  "home.dialog.delete-app-package":
    "{name} — {count, plural, =0 {no other app uses it} one {used by # other app} other {used by # other apps}}",
  "home.dialog.delete-app-published": "These packages it published are kept:",
  "home.dialog.delete-app-published-note":
    "Their source code is deleted with the app. The next app that publishes one of them takes it over.",
  "home.dialog.delete-app-releases": "Releases and history of this app",
  "home.dialog.delete-app-source": "Source code and the app's data",
  "home.dialog.delete-app-title": "Delete {name}?",
  "home.dialog.delete-app-will": "These are deleted:",
  "home.dialog.new-app-note":
    "An app starts with a name and a one-line purpose. lophn builds it from there.",
  "home.dialog.register-note":
    "A project is a name, a purpose and the folders it works in, if any.",
  "home.empty.no-apps": "No apps yet.",
  "home.empty.no-folders":
    "No folder yet. A project can also hold just its apps' data.",
  "home.empty.no-projects": "No projects yet.",
  "home.error.app-create-failed":
    "{name} wasn't created, so nothing was saved. Try again.",
  "home.error.app-delete-failed":
    "{name} wasn't deleted, so nothing changed. Try again.",
  "home.error.app-delete-stopping":
    "{name} is still shutting down. Try again in a moment.",
  "home.error.app-name-taken":
    "{name} is already taken. Choose a different name.",
  "home.error.name-required": "Enter a name.",
  "home.error.picker-failed": "The folder picker didn't open. Try again.",
  "home.error.purpose-required": "Enter a purpose.",
  "home.error.register-failed":
    "{name} wasn't registered, so nothing was saved. Try again.",
  "home.error.relink-failed":
    "Couldn't relink the folder. Nothing changed. Try again.",
  "home.failure.check-damaged-original":
    "The data file failed its integrity check.",
  "home.failure.check-history-mismatch":
    "A saved step differs from the one this version expects.",
  "home.failure.check-newer-schema":
    "The data was written with a newer schema than this version reads.",
  "home.failure.damaged-original":
    "lophn did not start. The data file is damaged. lophn did not repair or replace it, so the original is still there.",
  "home.failure.history-mismatch":
    "lophn did not start. The history in your data differs from what this version expects, and lophn did not change it.",
  "home.failure.newer-schema":
    "lophn did not start. It left your data exactly as it was, and this version can't read it.",
  "home.failure.recovery":
    "Before lophn changes how your data is stored, it keeps a copy of the data from just before that change in the recovery folder inside your lophn data folder (~/.lophn unless you moved it). To go back to that copy, quit lophn, move lophn.db, lophn.db-wal and lophn.db-shm out of the data folder, copy ledger.db from the folder inside recovery into it as lophn.db, and start lophn. Anything recorded after that copy was made is lost.",
  "home.failure.start-failed":
    "lophn couldn't start in the background. Your projects and apps can't open until it does.",
  "home.failure.update-damaged-original":
    "Update lophn and try again. If it still fails, keep the folder as it is.",
  "home.failure.update-history-mismatch":
    "Update lophn, or start the version that wrote this data. Then try again.",
  "home.failure.update-newer-schema":
    "Update lophn to the newer version, then start it again.",
  "home.field.app-purpose-help":
    "One line about what the app is for. Agents working on it read this.",
  "home.field.purpose-help": "What the project is for. Agents read this.",
  "home.heading.apps": "Apps",
  "home.heading.archived": "Archived",
  "home.heading.projects": "Projects",
  "home.label.apps": "your apps",
  "home.label.folder-count":
    "{count, plural, one {# folder} other {# folders}}",
  "home.label.folder-description": "What's in this folder",
  "home.label.folder-missing": "Folder not found",
  "home.label.folders": "Folders",
  "home.label.name": "Name",
  "home.label.projects": "your projects",
  "home.label.purpose": "Purpose",
  "home.note.identity-not-git":
    "Not in git, so this project stays on this computer.",
  "home.note.identity-relink":
    "{title} lost its folder, and this looks like the same repository.",
  "home.note.identity-same-repository":
    "{title} on this computer uses the same repository, so lophn matches neither with your other computers.",
  "home.title.damaged-original": "Your data can't be read",
  "home.title.history-mismatch": "The saved history does not match",
  "home.title.new-app": "New app",
  "home.title.newer-schema": "This data is from a newer lophn",
  "home.title.register": "Register project",
  "home.title.start-failed": "lophn didn't start",
  "projects.button.add-folder": "Add folder",
  "projects.button.identity-more": "More actions for other computers",
  "projects.button.identity-separate": "Separate project",
  "projects.button.remove": "Remove",
  "projects.button.save": "Save changes",
  "projects.button.show-latest": "Show latest",
  "projects.dialog.identity-separate-note":
    "This project gets a new id here. lophn stops matching it with the same repository on your other computers, and won't match it again.",
  "projects.dialog.identity-separate-title": "Separate this project?",
  "projects.error.changed": "This changed since you opened it.",
  "projects.error.identity-failed":
    "Couldn't change this. Nothing changed. Try again.",
  "projects.error.name-missing": "Enter a name.",
  "projects.error.project-change-failed":
    "Couldn't change this project. Nothing changed. Try again.",
  "projects.heading.folders": "Folders",
  "projects.label.folder-description": "Folder description",
  "projects.label.name": "Name",
  "projects.label.not-found": "Not found",
  "projects.label.other-computers": "Other computers",
  "projects.label.purpose": "Purpose",
  "projects.link.button": "Link",
  "projects.link.empty":
    "No project on this computer can be linked to {title} on {machine}. Only projects outside git can be linked; a git project follows its repository.",
  "projects.link.error-failed": "Couldn't link. Nothing changed. Try again.",
  "projects.link.error-in-use":
    "Another project on this computer is already the same project. Nothing changed.",
  "projects.link.intro":
    "Choose the project on this computer that is the same as {title} on {machine}.",
  "projects.link.result":
    "{project} becomes the same project as {title} on {machine}.",
  "projects.link.title": "Link to a project on this computer",
  "projects.notice.saved": "Saved.",
  "projects.notice.tab-machine-offline":
    "{name} is offline. Last seen {time}. This tab continues when it is back.",
  "projects.notice.tab-machine-removed":
    "{name} is not in your devices. Close this tab.",
  "projects.state.identity-matched":
    "Matched by its repository on your other computers",
  "projects.state.identity-no-remote":
    "No git remote, so lophn can't find it on your other computers",
  "projects.state.identity-not-git":
    "Not in git, so this project stays on this computer.",
  "projects.state.identity-private":
    "Private, so lophn doesn't match it with your other computers",
  "projects.state.identity-same-repository":
    "{title} on this computer uses the same repository, so lophn matches neither",
  "projects.state.identity-separated":
    "Kept separate from your other computers",
} as const;
