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
  "document.button.back-to-editing": Record<never, never>;
  "document.button.check-task": Record<never, never>;
  "document.button.compare": Record<never, never>;
  "document.button.compare-all-lines": Record<never, never>;
  "document.button.compare-changes-only": Record<never, never>;
  "document.button.compare-close": Record<never, never>;
  "document.button.compare-newest": Record<never, never>;
  "document.button.compare-previous": Record<never, never>;
  "document.button.compare-side-by-side": Record<never, never>;
  "document.button.compare-swap": Record<never, never>;
  "document.button.compare-unified": Record<never, never>;
  "document.button.discard-changes": Record<never, never>;
  "document.button.edit": Record<never, never>;
  "document.button.find-close": Record<never, never>;
  "document.button.find-match-case": Record<never, never>;
  "document.button.find-next": Record<never, never>;
  "document.button.find-previous": Record<never, never>;
  "document.button.instructions": Record<never, never>;
  "document.button.keep-editing": Record<never, never>;
  "document.button.keep-mine": Record<never, never>;
  "document.button.menu": Record<never, never>;
  "document.button.replace": Record<never, never>;
  "document.button.replace-all": Record<never, never>;
  "document.button.restore-confirm": Record<never, never>;
  "document.button.restore-version": {
    number: "number";
  };
  "document.button.save-details": Record<never, never>;
  "document.button.show-problems": Record<never, never>;
  "document.button.show-unchanged": {
    count: "plural";
  };
  "document.button.uncheck-task": Record<never, never>;
  "document.button.use-disk": Record<never, never>;
  "document.button.use-newest": Record<never, never>;
  "document.dialog.unsaved-many": Record<never, never>;
  "document.dialog.unsaved-one": {
    name: "string";
  };
  "document.empty.contexts": Record<never, never>;
  "document.empty.no-links": Record<never, never>;
  "document.empty.versions": Record<never, never>;
  "document.error.compare-failed": Record<never, never>;
  "document.error.edit-offline": Record<never, never>;
  "document.error.edit-too-large": Record<never, never>;
  "document.error.edit-unavailable": Record<never, never>;
  "document.error.edit-unsupported": Record<never, never>;
  "document.error.load-failed": Record<never, never>;
  "document.error.text-hidden": Record<never, never>;
  "document.error.text-unreadable": Record<never, never>;
  "document.error.text-unsupported": Record<never, never>;
  "document.error.width-failed": Record<never, never>;
  "document.label.changed-sections": Record<never, never>;
  "document.label.compare-after": Record<never, never>;
  "document.label.compare-before": Record<never, never>;
  "document.label.compare-disk": Record<never, never>;
  "document.label.compare-newest": Record<never, never>;
  "document.label.compare-target": Record<never, never>;
  "document.label.detail-file": Record<never, never>;
  "document.label.detail-format": Record<never, never>;
  "document.label.detail-record": Record<never, never>;
  "document.label.detail-version": Record<never, never>;
  "document.label.file-conflict": Record<never, never>;
  "document.label.file-failed": Record<never, never>;
  "document.label.file-none": Record<never, never>;
  "document.label.file-offline": Record<never, never>;
  "document.label.file-saved": Record<never, never>;
  "document.label.file-saving": Record<never, never>;
  "document.label.file-unknown": Record<never, never>;
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
  "document.label.format-failed": {
    count: "plural";
  };
  "document.label.format-none": Record<never, never>;
  "document.label.format-passed": Record<never, never>;
  "document.label.image": Record<never, never>;
  "document.label.info-archived": Record<never, never>;
  "document.label.info-file": Record<never, never>;
  "document.label.info-format": Record<never, never>;
  "document.label.info-format-explicit": {
    name: "string";
  };
  "document.label.info-linked": Record<never, never>;
  "document.label.info-saved": Record<never, never>;
  "document.label.info-source": Record<never, never>;
  "document.label.info-target": Record<never, never>;
  "document.label.info-unlinked": Record<never, never>;
  "document.label.info-versions": {
    count: "plural";
  };
  "document.label.link-count": {
    count: "plural";
  };
  "document.label.link-picker": Record<never, never>;
  "document.label.problem": {
    message: "string";
  };
  "document.label.problem-line": {
    line: "number";
  };
  "document.label.problem-whole": Record<never, never>;
  "document.label.problems": Record<never, never>;
  "document.label.properties": Record<never, never>;
  "document.label.reading-width": Record<never, never>;
  "document.label.record-none": Record<never, never>;
  "document.label.record-recorded": Record<never, never>;
  "document.label.record-unverified": Record<never, never>;
  "document.label.replace-with": Record<never, never>;
  "document.label.restoring": Record<never, never>;
  "document.label.saved": Record<never, never>;
  "document.label.saver-agent": Record<never, never>;
  "document.label.saver-app": Record<never, never>;
  "document.label.saver-coding-agent": Record<never, never>;
  "document.label.saver-machine": Record<never, never>;
  "document.label.saver-other": Record<never, never>;
  "document.label.saver-user": Record<never, never>;
  "document.label.section-added": Record<never, never>;
  "document.label.section-counts": {
    added: "number";
    removed: "number";
  };
  "document.label.section-filter": Record<never, never>;
  "document.label.section-missing": Record<never, never>;
  "document.label.section-modified": Record<never, never>;
  "document.label.section-unchanged": Record<never, never>;
  "document.label.section-whole": Record<never, never>;
  "document.label.these-instructions": Record<never, never>;
  "document.label.this-document": Record<never, never>;
  "document.label.version-confirmed": Record<never, never>;
  "document.label.version-conflict": Record<never, never>;
  "document.label.version-newest": Record<never, never>;
  "document.label.version-none": Record<never, never>;
  "document.label.version-not-requested": Record<never, never>;
  "document.label.version-number": {
    number: "number";
  };
  "document.label.version-preparing": Record<never, never>;
  "document.label.version-run": {
    id: "string";
  };
  "document.label.version-validation-failed": Record<never, never>;
  "document.label.version-waiting": Record<never, never>;
  "document.label.versions-target": Record<never, never>;
  "document.label.width-choice": {
    width: "string";
  };
  "document.label.width-current": {
    width: "string";
  };
  "document.notice.compare-incomplete": Record<never, never>;
  "document.notice.compare-omitted": Record<never, never>;
  "document.notice.compare-pick-section": Record<never, never>;
  "document.notice.compare-unreadable": Record<never, never>;
  "document.notice.conflict": Record<never, never>;
  "document.notice.no-document": Record<never, never>;
  "document.notice.reloaded": Record<never, never>;
  "document.notice.restore-confirm": {
    number: "number";
  };
  "document.notice.restore-conflict": Record<never, never>;
  "document.notice.restore-disconnected": Record<never, never>;
  "document.notice.restore-failed": Record<never, never>;
  "document.notice.restore-file-conflict": Record<never, never>;
  "document.notice.restore-file-unknown": Record<never, never>;
  "document.notice.restore-pending": Record<never, never>;
  "document.notice.restore-saved": Record<never, never>;
  "document.notice.restore-unchanged": Record<never, never>;
  "document.notice.restore-unsaved": Record<never, never>;
  "document.notice.restore-unsupported": Record<never, never>;
  "document.notice.restore-version-failed": Record<never, never>;
  "document.notice.section-omitted": Record<never, never>;
  "document.notice.side-by-side-narrow": Record<never, never>;
  "document.notice.version-conflict": Record<never, never>;
  "document.status.conflict": Record<never, never>;
  "document.status.failed": Record<never, never>;
  "document.status.format-failed": Record<never, never>;
  "document.status.not-tracked": Record<never, never>;
  "document.status.version-conflict": Record<never, never>;
  "document.title.app-instructions": Record<never, never>;
  "document.title.compare-disk": Record<never, never>;
  "document.title.compare-newest": Record<never, never>;
  "document.title.compare-versions": Record<never, never>;
  "document.title.global-instructions": Record<never, never>;
  "document.title.project-instructions": Record<never, never>;
  "document.title.unsaved": Record<never, never>;
  "project-workspace.button.add-rule": Record<never, never>;
  "project-workspace.button.agent": Record<never, never>;
  "project-workspace.button.close-tab": Record<never, never>;
  "project-workspace.button.edit-rules": Record<never, never>;
  "project-workspace.button.file-delete": Record<never, never>;
  "project-workspace.button.file-open": Record<never, never>;
  "project-workspace.button.file-rename": Record<never, never>;
  "project-workspace.button.info-panel": Record<never, never>;
  "project-workspace.button.launcher": Record<never, never>;
  "project-workspace.button.manage-agents": Record<never, never>;
  "project-workspace.button.new-session-with": {
    agent: "string";
  };
  "project-workspace.button.open-app-panel": Record<never, never>;
  "project-workspace.button.open-terminal": Record<never, never>;
  "project-workspace.button.preview-again": Record<never, never>;
  "project-workspace.button.remove-rule": Record<never, never>;
  "project-workspace.button.show-notices": Record<never, never>;
  "project-workspace.button.split-pane": Record<never, never>;
  "project-workspace.button.turn-on-tracking": Record<never, never>;
  "project-workspace.empty.no-documents": Record<never, never>;
  "project-workspace.empty.no-folder-documents": Record<never, never>;
  "project-workspace.empty.no-folders": Record<never, never>;
  "project-workspace.empty.no-tabs": Record<never, never>;
  "project-workspace.error.files-failed": Record<never, never>;
  "project-workspace.error.load-failed": Record<never, never>;
  "project-workspace.heading.agents": Record<never, never>;
  "project-workspace.heading.documents": Record<never, never>;
  "project-workspace.heading.folders": Record<never, never>;
  "project-workspace.heading.left-out": Record<never, never>;
  "project-workspace.heading.tracked": Record<never, never>;
  "project-workspace.info.empty": Record<never, never>;
  "project-workspace.label.agent-waiting": Record<never, never>;
  "project-workspace.label.choose-app": Record<never, never>;
  "project-workspace.label.drop-here": Record<never, never>;
  "project-workspace.label.drop-side": Record<never, never>;
  "project-workspace.label.files-in": {
    folder: "string";
  };
  "project-workspace.label.folder-missing": Record<never, never>;
  "project-workspace.label.gitignore": Record<never, never>;
  "project-workspace.label.info-tab-contexts": Record<never, never>;
  "project-workspace.label.info-tab-info": Record<never, never>;
  "project-workspace.label.info-tab-versions": Record<never, never>;
  "project-workspace.label.kind-agent": Record<never, never>;
  "project-workspace.label.kind-agents": Record<never, never>;
  "project-workspace.label.kind-app-panel": Record<never, never>;
  "project-workspace.label.kind-document-editor": Record<never, never>;
  "project-workspace.label.kind-terminal": Record<never, never>;
  "project-workspace.label.more-files": {
    count: "plural";
  };
  "project-workspace.label.path": Record<never, never>;
  "project-workspace.label.rail-agent": Record<never, never>;
  "project-workspace.label.rail-contexts": Record<never, never>;
  "project-workspace.label.rail-saved": Record<never, never>;
  "project-workspace.label.rail-search": Record<never, never>;
  "project-workspace.label.rail-shortcuts": Record<never, never>;
  "project-workspace.label.rail-terminal": Record<never, never>;
  "project-workspace.label.reason-excluded": {
    glob: "string";
  };
  "project-workspace.label.reason-gitignore": Record<never, never>;
  "project-workspace.label.reason-included": {
    glob: "string";
  };
  "project-workspace.label.reason-inside-git": Record<never, never>;
  "project-workspace.label.reason-inside-lophn": Record<never, never>;
  "project-workspace.label.reason-other": Record<never, never>;
  "project-workspace.label.reason-outside-link": Record<never, never>;
  "project-workspace.label.reason-tracking-off": Record<never, never>;
  "project-workspace.label.reason-unmatched": Record<never, never>;
  "project-workspace.label.recent": Record<never, never>;
  "project-workspace.label.root-folder": Record<never, never>;
  "project-workspace.label.rule-effect": Record<never, never>;
  "project-workspace.label.rule-exclude": Record<never, never>;
  "project-workspace.label.rule-include": Record<never, never>;
  "project-workspace.label.rule-pattern": Record<never, never>;
  "project-workspace.label.sidebar-tab-agent": Record<never, never>;
  "project-workspace.label.sidebar-tab-context": Record<never, never>;
  "project-workspace.label.sidebar-tab-explorer": Record<never, never>;
  "project-workspace.label.tabs": Record<never, never>;
  "project-workspace.sidebar.label": Record<never, never>;
  "project-workspace.title.tracking": {
    project: "string";
  };
  "project-workspace.tracking.apply-failed": {
    project: "string";
  };
  "project-workspace.tracking.changed": {
    project: "string";
  };
  "project-workspace.tracking.excluded-count": {
    count: "plural";
  };
  "project-workspace.tracking.included-count": {
    count: "plural";
  };
  "project-workspace.tracking.no-folder": Record<never, never>;
  "project-workspace.tracking.off": Record<never, never>;
  "project-workspace.tracking.overlap": {
    other: "string";
    path: "string";
  };
  "project-workspace.tracking.preparing": Record<never, never>;
  "project-workspace.tracking.preview-failed": {
    project: "string";
  };
  "project-workspace.tracking.stale": Record<never, never>;
  "project-workspace.tracking.unreadable-many": Record<never, never>;
  "project-workspace.tracking.unreadable-one": {
    folder: "string";
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
