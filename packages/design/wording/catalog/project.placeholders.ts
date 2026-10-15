// catalog/project.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
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
  "conversation.button.save-visual": Record<never, never>;
  "conversation.button.visual-read-description": Record<never, never>;
  "conversation.empty.visual-no-data": Record<never, never>;
  "conversation.label.visual-axes": {
    y: "string";
    x: "string";
  };
  "conversation.label.visual-document-unavailable": Record<never, never>;
  "conversation.label.visual-no": Record<never, never>;
  "conversation.label.visual-observed": {
    at: "string";
  };
  "conversation.label.visual-saved": Record<never, never>;
  "conversation.label.visual-source-app": {
    command: "string";
  };
  "conversation.label.visual-source-estimate": {
    label: "string";
  };
  "conversation.label.visual-sources": Record<never, never>;
  "conversation.label.visual-untitled": Record<never, never>;
  "conversation.label.visual-yes": Record<never, never>;
  "conversation.notice.visual-app-card": Record<never, never>;
  "conversation.notice.visual-as-table": Record<never, never>;
  "conversation.notice.visual-not-saved": Record<never, never>;
  "conversation.notice.visual-save-failed": Record<never, never>;
  "conversation.notice.visual-save-requested": Record<never, never>;
  "conversation.notice.visual-save-sending": Record<never, never>;
  "conversation.notice.visual-unavailable-drawing": Record<never, never>;
  "conversation.notice.visual-unavailable-kind": Record<never, never>;
  "conversation.notice.visual-unavailable-markup": Record<never, never>;
  "conversation.notice.visual-unavailable-shape": Record<never, never>;
  "conversation.placeholder.new-context": Record<never, never>;
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
  "document.empty.contexts": Record<never, never>;
  "document.error.compare-failed": Record<never, never>;
  "document.error.delete-failed": Record<never, never>;
  "document.error.forbidden": Record<never, never>;
  "document.error.not-found": Record<never, never>;
  "document.error.text-unsupported": Record<never, never>;
  "document.label.compare-disk": Record<never, never>;
  "document.label.compare-mine": Record<never, never>;
  "document.label.conflict": Record<never, never>;
  "document.label.contexts": Record<never, never>;
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
  "document.label.info-file": Record<never, never>;
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
  "document.notice.no-document": Record<never, never>;
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
  "project-workspace.button.file-delete": Record<never, never>;
  "project-workspace.button.file-open": Record<never, never>;
  "project-workspace.button.file-rename": Record<never, never>;
  "project-workspace.button.launcher": Record<never, never>;
  "project-workspace.button.manage-agents": Record<never, never>;
  "project-workspace.button.move-pane": Record<never, never>;
  "project-workspace.button.new-session-with": {
    agent: "string";
  };
  "project-workspace.button.new-tab": Record<never, never>;
  "project-workspace.button.show-notices": Record<never, never>;
  "project-workspace.button.split-pane": Record<never, never>;
  "project-workspace.empty.no-folders": Record<never, never>;
  "project-workspace.empty.no-tabs": Record<never, never>;
  "project-workspace.error.file-action-failed": Record<never, never>;
  "project-workspace.error.file-exists": Record<never, never>;
  "project-workspace.error.files-failed": Record<never, never>;
  "project-workspace.error.load-failed": Record<never, never>;
  "project-workspace.heading.agents": Record<never, never>;
  "project-workspace.label.agent-waiting": Record<never, never>;
  "project-workspace.label.choose-app": Record<never, never>;
  "project-workspace.label.file-new-name": Record<never, never>;
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
  "project-workspace.label.menu-context": Record<never, never>;
  "project-workspace.label.menu-document": Record<never, never>;
  "project-workspace.label.menu-search": Record<never, never>;
  "project-workspace.label.menu-terminal": Record<never, never>;
  "project-workspace.label.path": Record<never, never>;
  "project-workspace.label.rail-agent": Record<never, never>;
  "project-workspace.label.rail-contexts": Record<never, never>;
  "project-workspace.label.rail-saved": Record<never, never>;
  "project-workspace.label.rail-search": Record<never, never>;
  "project-workspace.label.rail-shortcuts": Record<never, never>;
  "project-workspace.label.rail-terminal": Record<never, never>;
  "project-workspace.label.recent": Record<never, never>;
  "project-workspace.label.root-folder": Record<never, never>;
  "project-workspace.label.sidebar-tab-agent": Record<never, never>;
  "project-workspace.label.sidebar-tab-context": Record<never, never>;
  "project-workspace.label.sidebar-tab-explorer": Record<never, never>;
  "project-workspace.notice.file-delete": Record<never, never>;
  "project-workspace.sidebar.label": Record<never, never>;
  "project-workspace.title.file-delete": {
    name: "string";
  };
  "project-workspace.title.file-rename": {
    name: "string";
  };
  "terminal.button.close-terminal": Record<never, never>;
  "terminal.button.hide-notice": Record<never, never>;
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
  "terminal.notice.account": Record<never, never>;
  "terminal.notice.folder": Record<never, never>;
  "terminal.notice.next-handoff": Record<never, never>;
  "terminal.status.ended": Record<never, never>;
  "terminal.status.exited": {
    code: "string";
  };
  "terminal.status.not-started": Record<never, never>;
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
