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
  "home.button.details": "Details",
  "home.button.hide-details": "Hide details",
  "home.button.more": "More actions for {name}",
  "home.button.new-app": "New app",
  "home.button.register": "Register",
  "home.button.register-project": "Register project",
  "home.button.remove-folder": "Remove folder",
  "home.button.show-details": "Show details",
  "home.button.unarchive": "Unarchive",
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
  "home.error.app-name-taken":
    "{name} is already taken. Choose a different name.",
  "home.error.name-required": "Enter a name.",
  "home.error.picker-failed": "The folder picker didn't open. Try again.",
  "home.error.purpose-required": "Enter a purpose.",
  "home.error.register-failed":
    "{name} wasn't registered, so nothing was saved. Try again.",
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
  "home.failure.sandbox-failed":
    "Your system's security settings stopped lophn from starting. Check that lophn is allowed to open, then try again.",
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
  "home.label.wordmark": "lophn",
  "home.title.damaged-original": "Your data can't be read",
  "home.title.history-mismatch": "The saved history does not match",
  "home.title.new-app": "New app",
  "home.title.newer-schema": "This data is from a newer lophn",
  "home.title.register": "Register project",
  "home.title.sandbox-failed": "lophn is blocked by your system",
  "home.title.start-failed": "lophn didn't start",
  "projects.button.add-folder": "Add folder",
  "projects.button.remove": "Remove",
  "projects.button.save": "Save changes",
  "projects.button.show-latest": "Show latest",
  "projects.error.changed": "This changed since you opened it.",
  "projects.error.name-missing": "Enter a name.",
  "projects.error.project-change-failed":
    "Couldn't change this project. Nothing changed. Try again.",
  "projects.heading.folders": "Folders",
  "projects.label.folder-description": "Folder description",
  "projects.label.name": "Name",
  "projects.label.not-found": "Not found",
  "projects.label.purpose": "Purpose",
  "projects.notice.saved": "Saved.",
} as const;
