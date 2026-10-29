// catalog/project.ts에서 생성한다. 직접 고치지 않고 `npm run wording`로 다시 만든다.
import type { project } from "./project.ts";

export type ProjectPlaceholders = {
  "app-card.notice.contract-changed": Record<never, never>;
  "app-card.notice.not-card": Record<never, never>;
  "app-card.notice.unavailable": Record<never, never>;
  "app-panel.button.open-app-space": Record<never, never>;
  "app-panel.empty.no-apps": Record<never, never>;
  "app-panel.label.screen": {
    app: "string";
    screen: "string";
  };
  "app-panel.notice.app-gone": Record<never, never>;
  "app-panel.notice.app-space-only": {
    app: "string";
  };
  "app-panel.notice.no-version": Record<never, never>;
  "app-panel.notice.not-panel": Record<never, never>;
  "app-panel.title.choose": Record<never, never>;
  "conversation.notice.visual-app-card": Record<never, never>;
  "conversation.notice.visual-unavailable-drawing": Record<never, never>;
  "document.button.check-task": Record<never, never>;
  "document.button.compare": Record<never, never>;
  "document.button.delete": Record<never, never>;
  "document.button.discard-changes": Record<never, never>;
  "document.button.edit": Record<never, never>;
  "document.button.find-close": Record<never, never>;
  "document.button.find-match-case": Record<never, never>;
  "document.button.find-next": Record<never, never>;
  "document.button.find-previous": Record<never, never>;
  "document.button.hide-comparison": Record<never, never>;
  "document.button.info": Record<never, never>;
  "document.button.instructions": Record<never, never>;
  "document.button.keep-editing": Record<never, never>;
  "document.button.keep-mine": Record<never, never>;
  "document.button.menu": Record<never, never>;
  "document.button.replace": Record<never, never>;
  "document.button.replace-all": Record<never, never>;
  "document.button.uncheck-task": Record<never, never>;
  "document.button.use-disk": Record<never, never>;
  "document.dialog.delete-body": Record<never, never>;
  "document.dialog.unsaved-many": Record<never, never>;
  "document.dialog.unsaved-one": {
    name: "string";
  };
  "document.error.compare-failed": Record<never, never>;
  "document.error.delete-failed": Record<never, never>;
  "document.error.forbidden": Record<never, never>;
  "document.error.not-found": Record<never, never>;
  "document.error.text-unsupported": Record<never, never>;
  "document.label.compare-disk": Record<never, never>;
  "document.label.compare-mine": Record<never, never>;
  "document.label.conflict": Record<never, never>;
  "document.label.find": Record<never, never>;
  "document.label.find-count": {
    current: "number";
    total: "number";
  };
  "document.label.find-count-capped": {
    current: "number";
    total: "number";
  };
  "document.label.find-none": Record<never, never>;
  "document.label.find-query": Record<never, never>;
  "document.label.image": Record<never, never>;
  "document.label.info-modified": Record<never, never>;
  "document.label.info-outline": Record<never, never>;
  "document.label.info-path": Record<never, never>;
  "document.label.info-size": Record<never, never>;
  "document.label.line": {
    line: "number";
  };
  "document.label.not-saved": Record<never, never>;
  "document.label.outside": Record<never, never>;
  "document.label.properties": Record<never, never>;
  "document.label.replace-with": Record<never, never>;
  "document.label.saved": Record<never, never>;
  "document.label.these-instructions": Record<never, never>;
  "document.label.this-document": Record<never, never>;
  "document.label.view-only": Record<never, never>;
  "document.notice.conflict": Record<never, never>;
  "document.notice.info-outside": Record<never, never>;
  "document.notice.reloaded": Record<never, never>;
  "document.notice.too-large": Record<never, never>;
  "document.title.compare-disk": Record<never, never>;
  "document.title.conflict": Record<never, never>;
  "document.title.delete": {
    name: "string";
  };
  "document.title.info": Record<never, never>;
  "document.title.reloaded": Record<never, never>;
  "document.title.unsaved": Record<never, never>;
  "file-search.label.all-folders": Record<never, never>;
  "file-search.label.folder": Record<never, never>;
  "file-search.label.matches": {
    matches: "plural";
    files: "plural";
  };
  "file-search.label.query": Record<never, never>;
  "file-search.label.query-hint": Record<never, never>;
  "file-search.label.tab": Record<never, never>;
  "file-search.notice.no-matches": Record<never, never>;
  "file-search.notice.type-text": Record<never, never>;
  "file-search.notice.unavailable": Record<never, never>;
  "project-workspace.button.detached-dock": Record<never, never>;
  "project-workspace.button.explorer-collapse-all": Record<never, never>;
  "project-workspace.button.explorer-copy-path": Record<never, never>;
  "project-workspace.button.explorer-copy-relative-path": Record<never, never>;
  "project-workspace.button.explorer-delete": Record<never, never>;
  "project-workspace.button.explorer-move": Record<never, never>;
  "project-workspace.button.explorer-new-file": Record<never, never>;
  "project-workspace.button.explorer-new-folder": Record<never, never>;
  "project-workspace.button.explorer-refresh": Record<never, never>;
  "project-workspace.button.explorer-rename": Record<never, never>;
  "project-workspace.button.explorer-reveal": Record<never, never>;
  "project-workspace.button.explorer-trash": Record<never, never>;
  "project-workspace.button.float-close": Record<never, never>;
  "project-workspace.button.float-detach": Record<never, never>;
  "project-workspace.button.float-dock": Record<never, never>;
  "project-workspace.button.float-minimize": Record<never, never>;
  "project-workspace.button.float-restore": Record<never, never>;
  "project-workspace.button.launcher": Record<never, never>;
  "project-workspace.button.manage-agents": Record<never, never>;
  "project-workspace.button.minimized-close": {
    title: "string";
  };
  "project-workspace.button.minimized-count": {
    count: "string";
  };
  "project-workspace.button.minimized-more": {
    count: "plural";
  };
  "project-workspace.button.move-pane": Record<never, never>;
  "project-workspace.button.new-session-with": {
    agent: "string";
  };
  "project-workspace.button.new-tab": Record<never, never>;
  "project-workspace.button.remove-recent": Record<never, never>;
  "project-workspace.button.show-notices": Record<never, never>;
  "project-workspace.button.split-pane": Record<never, never>;
  "project-workspace.button.tab-close": Record<never, never>;
  "project-workspace.button.tab-close-all": Record<never, never>;
  "project-workspace.button.tab-close-others": Record<never, never>;
  "project-workspace.button.tab-close-right": Record<never, never>;
  "project-workspace.button.tab-close-saved": Record<never, never>;
  "project-workspace.button.tab-copy-path": Record<never, never>;
  "project-workspace.button.tab-copy-relative-path": Record<never, never>;
  "project-workspace.button.tab-detach": Record<never, never>;
  "project-workspace.button.tab-float": Record<never, never>;
  "project-workspace.button.tab-keep-open": Record<never, never>;
  "project-workspace.button.tab-minimize": Record<never, never>;
  "project-workspace.button.tab-rename": Record<never, never>;
  "project-workspace.button.tab-reveal": Record<never, never>;
  "project-workspace.empty.no-folders": Record<never, never>;
  "project-workspace.empty.no-tabs": Record<never, never>;
  "project-workspace.error.explorer-action-failed": Record<never, never>;
  "project-workspace.error.explorer-move-exists": {
    folder: "string";
    name: "string";
  };
  "project-workspace.error.explorer-move-failed": {
    name: "string";
  };
  "project-workspace.error.explorer-name-exists": {
    name: "string";
  };
  "project-workspace.error.explorer-name-invalid": {
    name: "string";
  };
  "project-workspace.error.explorer-name-required": Record<never, never>;
  "project-workspace.error.explorer-trash-failed": {
    name: "string";
  };
  "project-workspace.error.files-failed": Record<never, never>;
  "project-workspace.error.load-failed": Record<never, never>;
  "project-workspace.heading.agents": Record<never, never>;
  "project-workspace.heading.current": Record<never, never>;
  "project-workspace.label.activity-bar": Record<never, never>;
  "project-workspace.label.agent-waiting": Record<never, never>;
  "project-workspace.label.choose-app": Record<never, never>;
  "project-workspace.label.desk-default": Record<never, never>;
  "project-workspace.label.desk-invalid": Record<never, never>;
  "project-workspace.label.desk-selector": Record<never, never>;
  "project-workspace.label.explorer-actions": Record<never, never>;
  "project-workspace.label.explorer-name": Record<never, never>;
  "project-workspace.label.files-in": {
    folder: "string";
  };
  "project-workspace.label.folder-missing": Record<never, never>;
  "project-workspace.label.kind-agent": Record<never, never>;
  "project-workspace.label.kind-agents": Record<never, never>;
  "project-workspace.label.kind-app-panel": Record<never, never>;
  "project-workspace.label.kind-document-editor": Record<never, never>;
  "project-workspace.label.kind-terminal": Record<never, never>;
  "project-workspace.label.menu-agent": Record<never, never>;
  "project-workspace.label.menu-app-panel": Record<never, never>;
  "project-workspace.label.menu-document": Record<never, never>;
  "project-workspace.label.menu-search": Record<never, never>;
  "project-workspace.label.menu-terminal": Record<never, never>;
  "project-workspace.label.minimized": Record<never, never>;
  "project-workspace.label.path": Record<never, never>;
  "project-workspace.label.project-selector": Record<never, never>;
  "project-workspace.label.rail-agent": Record<never, never>;
  "project-workspace.label.rail-browser": Record<never, never>;
  "project-workspace.label.rail-search": Record<never, never>;
  "project-workspace.label.rail-shortcuts": Record<never, never>;
  "project-workspace.label.rail-terminal": Record<never, never>;
  "project-workspace.label.recent": Record<never, never>;
  "project-workspace.label.root-folder": Record<never, never>;
  "project-workspace.label.sidebar-tab-agent": Record<never, never>;
  "project-workspace.label.sidebar-tab-artifact": Record<never, never>;
  "project-workspace.label.sidebar-tab-explorer": Record<never, never>;
  "project-workspace.label.tab-finished": Record<never, never>;
  "project-workspace.label.tab-rename": Record<never, never>;
  "project-workspace.label.tab-tooltip": {
    title: "string";
    state: "string";
  };
  "project-workspace.label.tab-unsaved": Record<never, never>;
  "project-workspace.notice.explorer-delete-file": {
    name: "string";
  };
  "project-workspace.notice.explorer-delete-folder": {
    name: "string";
  };
  "project-workspace.notice.explorer-move": {
    name: "string";
    folder: "string";
  };
  "project-workspace.sidebar.label": Record<never, never>;
  "project-workspace.title.explorer-delete": {
    name: "string";
  };
  "project-workspace.title.explorer-move": {
    name: "string";
  };
  "run-list.button.background": Record<never, never>;
  "run-list.empty.none": Record<never, never>;
  "run-list.heading.background": Record<never, never>;
  "run-list.label.cancelled": Record<never, never>;
  "run-list.label.failed": Record<never, never>;
  "terminal.button.close-terminal": Record<never, never>;
  "terminal.button.keep-open": Record<never, never>;
  "terminal.button.start-again": Record<never, never>;
  "terminal.button.try-again": Record<never, never>;
  "terminal.dialog.close-text": Record<never, never>;
  "terminal.error.no-folder": Record<never, never>;
  "terminal.error.not-directory": Record<never, never>;
  "terminal.error.spawn-failed": Record<never, never>;
  "terminal.error.unavailable": Record<never, never>;
  "terminal.error.unreadable": Record<never, never>;
  "terminal.heading.choose-folder": Record<never, never>;
  "terminal.label.folders": Record<never, never>;
  "terminal.label.output": Record<never, never>;
  "terminal.label.session-ended": Record<never, never>;
  "terminal.notice.next-handoff": Record<never, never>;
  "terminal.status.ended": Record<never, never>;
  "terminal.status.exited": {
    code: "string";
  };
  "terminal.status.output-missing": Record<never, never>;
  "terminal.status.start-failed": Record<never, never>;
  "terminal.status.stop-unconfirmed": Record<never, never>;
  "terminal.status.unknown": Record<never, never>;
  "terminal.title.close": Record<never, never>;
};

type Area = typeof project;
type _SameKeys =
  | Exclude<keyof Area, keyof ProjectPlaceholders>
  | Exclude<keyof ProjectPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
