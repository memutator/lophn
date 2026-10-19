// catalog/workspace.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { workspace } from "./workspace.ts";

export type WorkspacePlaceholders = {
  "common.button.palette-dock-panel": Record<never, never>;
  "common.button.palette-float-tab": Record<never, never>;
  "common.button.palette-launcher": Record<never, never>;
  "common.button.palette-minimize-panel": Record<never, never>;
  "common.button.palette-open": Record<never, never>;
  "common.button.palette-settings": Record<never, never>;
  "common.button.palette-terminal": Record<never, never>;
  "common.button.settings": Record<never, never>;
  "common.heading.palette-actions": Record<never, never>;
  "common.heading.palette-apps": Record<never, never>;
  "common.heading.palette-files": Record<never, never>;
  "common.heading.palette-projects": Record<never, never>;
  "common.heading.palette-tabs": Record<never, never>;
  "common.label.app-archived": Record<never, never>;
  "common.label.app-preparing": Record<never, never>;
  "common.label.app-running": Record<never, never>;
  "common.label.app-stopped": Record<never, never>;
  "common.label.app-unavailable": Record<never, never>;
  "common.label.app-unknown": Record<never, never>;
  "common.label.palette-left-pane": Record<never, never>;
  "common.label.palette-right-pane": Record<never, never>;
  "common.label.palette-tab-detail": {
    kind: "string";
    pane: "string";
  };
  "common.label.window-close": Record<never, never>;
  "common.label.window-maximize": Record<never, never>;
  "common.label.window-minimize": Record<never, never>;
  "common.label.window-restore": Record<never, never>;
  "common.title.palette-desktop": Record<never, never>;
  "common.title.palette-workspace": Record<never, never>;
  "launcher.button.add-folder": Record<never, never>;
  "launcher.button.archive": Record<never, never>;
  "launcher.button.choose-location": Record<never, never>;
  "launcher.button.details": Record<never, never>;
  "launcher.button.hide-details": Record<never, never>;
  "launcher.button.more": {
    name: "string";
  };
  "launcher.button.register": Record<never, never>;
  "launcher.button.register-project": Record<never, never>;
  "launcher.button.remove-folder": Record<never, never>;
  "launcher.button.show-details": Record<never, never>;
  "launcher.button.unarchive": Record<never, never>;
  "launcher.dialog.register-note": Record<never, never>;
  "launcher.empty.no-apps": Record<never, never>;
  "launcher.empty.no-cards": Record<never, never>;
  "launcher.empty.no-folders": Record<never, never>;
  "launcher.empty.no-projects": Record<never, never>;
  "launcher.error.name-required": Record<never, never>;
  "launcher.error.picker-failed": Record<never, never>;
  "launcher.error.register-failed": {
    name: "string";
  };
  "launcher.failure.check-damaged-original": Record<never, never>;
  "launcher.failure.check-history-mismatch": Record<never, never>;
  "launcher.failure.check-newer-schema": Record<never, never>;
  "launcher.failure.damaged-original": Record<never, never>;
  "launcher.failure.history-mismatch": Record<never, never>;
  "launcher.failure.newer-schema": Record<never, never>;
  "launcher.failure.sandbox-failed": Record<never, never>;
  "launcher.failure.start-failed": Record<never, never>;
  "launcher.failure.update-damaged-original": Record<never, never>;
  "launcher.failure.update-history-mismatch": Record<never, never>;
  "launcher.failure.update-newer-schema": Record<never, never>;
  "launcher.field.purpose-help": Record<never, never>;
  "launcher.heading.apps": Record<never, never>;
  "launcher.heading.archived": Record<never, never>;
  "launcher.heading.projects": Record<never, never>;
  "launcher.label.app-project": {
    name: "string";
  };
  "launcher.label.apps": Record<never, never>;
  "launcher.label.folder-count": {
    count: "plural";
  };
  "launcher.label.folder-description": Record<never, never>;
  "launcher.label.folder-missing": Record<never, never>;
  "launcher.label.folders": Record<never, never>;
  "launcher.label.name": Record<never, never>;
  "launcher.label.projects": Record<never, never>;
  "launcher.label.purpose": Record<never, never>;
  "launcher.label.wordmark": Record<never, never>;
  "launcher.note.archived": Record<never, never>;
  "launcher.title.damaged-original": Record<never, never>;
  "launcher.title.history-mismatch": Record<never, never>;
  "launcher.title.newer-schema": Record<never, never>;
  "launcher.title.register": Record<never, never>;
  "launcher.title.sandbox-failed": Record<never, never>;
  "launcher.title.start-failed": Record<never, never>;
  "projects.button.add-folder": Record<never, never>;
  "projects.button.add-subfolder": Record<never, never>;
  "projects.button.remove": Record<never, never>;
  "projects.button.save": Record<never, never>;
  "projects.button.show-latest": Record<never, never>;
  "projects.button.undo": Record<never, never>;
  "projects.empty.no-subfolders": Record<never, never>;
  "projects.error.changed": Record<never, never>;
  "projects.error.folders-unavailable": Record<never, never>;
  "projects.error.name-missing": Record<never, never>;
  "projects.error.project-change-failed": Record<never, never>;
  "projects.heading.folders": Record<never, never>;
  "projects.heading.subfolders": Record<never, never>;
  "projects.help.subfolder-edited": Record<never, never>;
  "projects.label.added": Record<never, never>;
  "projects.label.folder-description": Record<never, never>;
  "projects.label.name": Record<never, never>;
  "projects.label.not-found": Record<never, never>;
  "projects.label.purpose": Record<never, never>;
  "projects.label.subfolder-description": Record<never, never>;
  "projects.notice.pick-subfolder": Record<never, never>;
  "projects.notice.relocate-first": Record<never, never>;
  "projects.notice.saved": Record<never, never>;
  "projects.notice.subfolder-removed": {
    path: "string";
  };
  "projects.title.add-subfolder": Record<never, never>;
};

type Area = typeof workspace;
type _SameKeys =
  | Exclude<keyof Area, keyof WorkspacePlaceholders>
  | Exclude<keyof WorkspacePlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
