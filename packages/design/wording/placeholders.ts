// en.ts에서 생성한다. 직접 고치지 않고 `deno run -A generate.ts --check`로 맞춘다.
import type { MessageKey } from "./en.ts";

export type PlaceholderKinds = {
  "apps.title.screen": Record<never, never>;
  "common.activity.agent": Record<never, never>;
  "common.activity.app": Record<never, never>;
  "common.author.label": {
    author: "string";
  };
  "common.button.cancel": Record<never, never>;
  "common.button.close": Record<never, never>;
  "common.button.columns": Record<never, never>;
  "common.button.copy-code": Record<never, never>;
  "common.button.copy-id": Record<never, never>;
  "common.button.next-page": Record<never, never>;
  "common.button.palette-go-to": {
    screen: "string";
  };
  "common.button.palette-info-panel": Record<never, never>;
  "common.button.palette-launcher": Record<never, never>;
  "common.button.palette-lophn": Record<never, never>;
  "common.button.palette-open": Record<never, never>;
  "common.button.palette-terminal": Record<never, never>;
  "common.button.previous-page": Record<never, never>;
  "common.button.quit": Record<never, never>;
  "common.button.reload": Record<never, never>;
  "common.button.retry": Record<never, never>;
  "common.button.show-chart": Record<never, never>;
  "common.button.show-table": Record<never, never>;
  "common.button.sort-ascending": Record<never, never>;
  "common.button.sort-descending": Record<never, never>;
  "common.button.view": Record<never, never>;
  "common.chart.too-many-groups": {
    max: "number";
  };
  "common.chart.unreadable": Record<never, never>;
  "common.copy.failed": Record<never, never>;
  "common.empty.not-ready": Record<never, never>;
  "common.error.load-failed": {
    target: "string";
  };
  "common.heading.column-unit": {
    header: "string";
    unit: "string";
  };
  "common.heading.count": Record<never, never>;
  "common.heading.group": Record<never, never>;
  "common.heading.palette-actions": Record<never, never>;
  "common.heading.palette-apps": Record<never, never>;
  "common.heading.palette-contexts": Record<never, never>;
  "common.heading.palette-documents": Record<never, never>;
  "common.heading.palette-files": Record<never, never>;
  "common.heading.palette-projects": Record<never, never>;
  "common.heading.palette-tabs": Record<never, never>;
  "common.label.date-with-weekday": {
    date: "string";
    weekday: "string";
  };
  "common.label.decisions-waiting": {
    count: "plural";
  };
  "common.label.lophn-space": Record<never, never>;
  "common.label.more-waiting": {
    count: "plural";
  };
  "common.label.on-this-page": Record<never, never>;
  "common.label.original-order": Record<never, never>;
  "common.label.other": Record<never, never>;
  "common.label.palette-key-close": Record<never, never>;
  "common.label.palette-key-move": Record<never, never>;
  "common.label.palette-key-open": Record<never, never>;
  "common.label.palette-left-pane": Record<never, never>;
  "common.label.palette-right-pane": Record<never, never>;
  "common.label.palette-tab-detail": {
    kind: "string";
    pane: "string";
  };
  "common.label.row-range": {
    start: "number";
    end: "number";
    total: "number";
  };
  "common.label.sort-by": Record<never, never>;
  "common.label.tray-global-search-unavailable": Record<never, never>;
  "common.label.tray-launcher": Record<never, never>;
  "common.label.tray-notifications-unavailable": Record<never, never>;
  "common.label.tray-open": Record<never, never>;
  "common.label.tray-quit": Record<never, never>;
  "common.label.tray-start-at-login": Record<never, never>;
  "common.label.tray-tooltip": Record<never, never>;
  "common.label.value-range": {
    start: "string";
    end: "string";
  };
  "common.notice.core-down": Record<never, never>;
  "common.notification.body": Record<never, never>;
  "common.notification.title": Record<never, never>;
  "common.overlay.unavailable": Record<never, never>;
  "common.palette.no-results": Record<never, never>;
  "common.quit.saves": Record<never, never>;
  "common.quit.terminals": Record<never, never>;
  "common.quit.terminals-and-saves": Record<never, never>;
  "common.stale.label": {
    age: "string";
  };
  "common.title.palette-lophn": Record<never, never>;
  "common.title.palette-workspace": Record<never, never>;
  "common.title.quit": Record<never, never>;
  "confirmation-window.body.checking": Record<never, never>;
  "confirmation-window.body.expired": Record<never, never>;
  "confirmation-window.body.review": Record<never, never>;
  "confirmation-window.body.second": Record<never, never>;
  "confirmation-window.body.stale": Record<never, never>;
  "confirmation-window.body.unknown": Record<never, never>;
  "confirmation-window.button.cancel": Record<never, never>;
  "confirmation-window.button.decide": Record<never, never>;
  "confirmation-window.button.refresh": Record<never, never>;
  "confirmation-window.title.confirm": Record<never, never>;
  "contexts.title.screen": Record<never, never>;
  "contexts.view.baseline": Record<never, never>;
  "contexts.view.follow-changes": Record<never, never>;
  "contexts.view.reference": Record<never, never>;
  "conversation.button.check-delivery": Record<never, never>;
  "conversation.button.close": Record<never, never>;
  "conversation.button.jump-latest": Record<never, never>;
  "conversation.button.mode-correction": Record<never, never>;
  "conversation.button.mode-request": Record<never, never>;
  "conversation.button.new-session": Record<never, never>;
  "conversation.button.next-request": Record<never, never>;
  "conversation.button.open": Record<never, never>;
  "conversation.button.previous-request": Record<never, never>;
  "conversation.button.resend": Record<never, never>;
  "conversation.button.send": Record<never, never>;
  "conversation.button.show-all-results": Record<never, never>;
  "conversation.button.stop": Record<never, never>;
  "conversation.empty.no-agent": Record<never, never>;
  "conversation.empty.no-messages": Record<never, never>;
  "conversation.empty.no-session": Record<never, never>;
  "conversation.error.load-failed": Record<never, never>;
  "conversation.error.message-body": Record<never, never>;
  "conversation.error.open-failed": Record<never, never>;
  "conversation.error.stop-failed": Record<never, never>;
  "conversation.error.too-long": Record<never, never>;
  "conversation.label.author-check": Record<never, never>;
  "conversation.label.author-lophn": Record<never, never>;
  "conversation.label.author-you": Record<never, never>;
  "conversation.label.composer-correction": Record<never, never>;
  "conversation.label.composer-request": Record<never, never>;
  "conversation.label.correction": Record<never, never>;
  "conversation.label.delivery-applied": Record<never, never>;
  "conversation.label.delivery-not-sent": Record<never, never>;
  "conversation.label.delivery-received": Record<never, never>;
  "conversation.label.delivery-saved": Record<never, never>;
  "conversation.label.delivery-sending": Record<never, never>;
  "conversation.label.delivery-unconfirmed": Record<never, never>;
  "conversation.label.document": Record<never, never>;
  "conversation.label.more-results": {
    count: "plural";
  };
  "conversation.label.request-position": {
    current: "number";
    total: "number";
  };
  "conversation.label.requests": Record<never, never>;
  "conversation.label.results": Record<never, never>;
  "conversation.label.session": {
    number: "number";
  };
  "conversation.label.session-ended": {
    number: "number";
  };
  "conversation.label.sessions": Record<never, never>;
  "conversation.label.status-done": Record<never, never>;
  "conversation.label.status-in-progress": Record<never, never>;
  "conversation.label.status-stopped": Record<never, never>;
  "conversation.label.status-waiting": Record<never, never>;
  "conversation.notice.ended": Record<never, never>;
  "conversation.notice.message-loading": Record<never, never>;
  "conversation.notice.not-found": Record<never, never>;
  "conversation.notice.not-sent": Record<never, never>;
  "conversation.notice.offline": Record<never, never>;
  "conversation.notice.paused": Record<never, never>;
  "conversation.notice.stale": {
    age: "string";
  };
  "conversation.notice.stale-never": Record<never, never>;
  "conversation.notice.unconfirmed": Record<never, never>;
  "conversation.notice.visual-pending": Record<never, never>;
  "conversation.title.dock": Record<never, never>;
  "document.button.back-to-editing": Record<never, never>;
  "document.button.check-again": Record<never, never>;
  "document.button.check-task": Record<never, never>;
  "document.button.compare": Record<never, never>;
  "document.button.discard-changes": Record<never, never>;
  "document.button.edit": Record<never, never>;
  "document.button.find-close": Record<never, never>;
  "document.button.find-match-case": Record<never, never>;
  "document.button.find-next": Record<never, never>;
  "document.button.find-previous": Record<never, never>;
  "document.button.keep-editing": Record<never, never>;
  "document.button.keep-mine": Record<never, never>;
  "document.button.menu": Record<never, never>;
  "document.button.read": Record<never, never>;
  "document.button.replace": Record<never, never>;
  "document.button.replace-all": Record<never, never>;
  "document.button.save-details": Record<never, never>;
  "document.button.show-problems": Record<never, never>;
  "document.button.uncheck-task": Record<never, never>;
  "document.button.use-disk": Record<never, never>;
  "document.button.use-newest": Record<never, never>;
  "document.dialog.unsaved-many": Record<never, never>;
  "document.dialog.unsaved-one": {
    name: "string";
  };
  "document.diff.identical": Record<never, never>;
  "document.empty.no-links": Record<never, never>;
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
  "document.label.compare-disk": Record<never, never>;
  "document.label.compare-newest": Record<never, never>;
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
  "document.label.link-count": {
    count: "plural";
  };
  "document.label.link-picker": Record<never, never>;
  "document.label.meta": {
    number: "number";
    when: "string";
  };
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
  "document.label.saved": Record<never, never>;
  "document.label.saving": Record<never, never>;
  "document.label.this-document": Record<never, never>;
  "document.label.version-confirmed": Record<never, never>;
  "document.label.version-conflict": Record<never, never>;
  "document.label.version-none": Record<never, never>;
  "document.label.version-not-requested": Record<never, never>;
  "document.label.version-preparing": Record<never, never>;
  "document.label.version-validation-failed": Record<never, never>;
  "document.label.version-waiting": Record<never, never>;
  "document.label.width-choice": {
    width: "string";
  };
  "document.label.width-current": {
    width: "string";
  };
  "document.notice.conflict": Record<never, never>;
  "document.notice.reloaded": Record<never, never>;
  "document.notice.version-conflict": Record<never, never>;
  "document.status.conflict": Record<never, never>;
  "document.status.failed": Record<never, never>;
  "document.status.format-failed": Record<never, never>;
  "document.status.not-tracked": Record<never, never>;
  "document.status.offline": Record<never, never>;
  "document.status.unknown": Record<never, never>;
  "document.status.version-conflict": Record<never, never>;
  "document.status.version-pending": Record<never, never>;
  "document.status.version-saved": Record<never, never>;
  "document.title.compare-disk": Record<never, never>;
  "document.title.compare-newest": Record<never, never>;
  "document.title.unsaved": Record<never, never>;
  "document.title.compare-versions": Record<never, never>;
  "document.button.compare-previous": Record<never, never>;
  "document.button.compare-newest": Record<never, never>;
  "document.button.compare-close": Record<never, never>;
  "document.button.compare-swap": Record<never, never>;
  "document.button.compare-unified": Record<never, never>;
  "document.button.compare-side-by-side": Record<never, never>;
  "document.button.compare-changes-only": Record<never, never>;
  "document.button.compare-all-lines": Record<never, never>;
  "document.button.restore-version": {
    number: "number";
  };
  "document.button.restore-confirm": Record<never, never>;
  "document.button.show-unchanged": {
    count: "plural";
  };
  "document.label.compare-before": Record<never, never>;
  "document.label.compare-after": Record<never, never>;
  "document.label.version-number": {
    number: "number";
  };
  "document.label.version-newest": Record<never, never>;
  "document.label.changed-sections": Record<never, never>;
  "document.label.section-counts": {
    added: "number";
    removed: "number";
  };
  "document.label.section-modified": Record<never, never>;
  "document.label.section-added": Record<never, never>;
  "document.label.section-missing": Record<never, never>;
  "document.label.section-unchanged": Record<never, never>;
  "document.label.section-filter": Record<never, never>;
  "document.label.section-whole": Record<never, never>;
  "document.label.saver-user": Record<never, never>;
  "document.label.saver-agent": Record<never, never>;
  "document.label.saver-coding-agent": Record<never, never>;
  "document.label.saver-app": Record<never, never>;
  "document.label.saver-machine": Record<never, never>;
  "document.label.saver-other": Record<never, never>;
  "document.label.info-file": Record<never, never>;
  "document.label.info-source": Record<never, never>;
  "document.label.info-linked": Record<never, never>;
  "document.label.info-unlinked": Record<never, never>;
  "document.label.info-format": Record<never, never>;
  "document.label.info-format-explicit": {
    name: "string";
  };
  "document.label.info-saved": Record<never, never>;
  "document.label.info-versions": {
    count: "plural";
  };
  "document.label.info-archived": Record<never, never>;
  "document.label.versions-target": Record<never, never>;
  "document.label.contexts-target": Record<never, never>;
  "document.label.info-target": Record<never, never>;
  "document.label.compare-target": Record<never, never>;
  "document.notice.no-document": Record<never, never>;
  "document.empty.versions": Record<never, never>;
  "document.empty.contexts": Record<never, never>;
  "document.notice.section-omitted": Record<never, never>;
  "document.notice.side-by-side-narrow": Record<never, never>;
  "document.notice.compare-pick-section": Record<never, never>;
  "document.notice.compare-omitted": Record<never, never>;
  "document.notice.compare-incomplete": Record<never, never>;
  "document.notice.compare-unreadable": Record<never, never>;
  "document.notice.restore-confirm": {
    number: "number";
  };
  "document.label.restoring": Record<never, never>;
  "document.notice.restore-saved": Record<never, never>;
  "document.notice.restore-unchanged": Record<never, never>;
  "document.notice.restore-conflict": Record<never, never>;
  "document.notice.restore-file-conflict": Record<never, never>;
  "document.notice.restore-pending": Record<never, never>;
  "document.notice.restore-file-unknown": Record<never, never>;
  "document.notice.restore-failed": Record<never, never>;
  "document.notice.restore-unsupported": Record<never, never>;
  "document.notice.restore-unsaved": Record<never, never>;
  "documents.button.add-member": Record<never, never>;
  "documents.button.archive-series": Record<never, never>;
  "documents.button.back-to-series": Record<never, never>;
  "documents.button.clear-conditions": Record<never, never>;
  "documents.button.confirm-save-view": Record<never, never>;
  "documents.button.go-search": Record<never, never>;
  "documents.button.include-archived": Record<never, never>;
  "documents.button.more-results": Record<never, never>;
  "documents.button.next-in-series": Record<never, never>;
  "documents.button.open-latest": Record<never, never>;
  "documents.button.open-latest-series": Record<never, never>;
  "documents.button.open-link": Record<never, never>;
  "documents.button.previous-in-series": Record<never, never>;
  "documents.button.read-more": Record<never, never>;
  "documents.button.register": Record<never, never>;
  "documents.button.register-series": Record<never, never>;
  "documents.button.save-view": Record<never, never>;
  "documents.button.search": Record<never, never>;
  "documents.button.search-again": Record<never, never>;
  "documents.button.unarchive-series": Record<never, never>;
  "documents.empty.no-candidates": Record<never, never>;
  "documents.empty.no-matches": Record<never, never>;
  "documents.empty.no-matches-active": Record<never, never>;
  "documents.empty.no-matches-not-yet": Record<never, never>;
  "documents.empty.no-members": Record<never, never>;
  "documents.empty.no-series": Record<never, never>;
  "documents.empty.no-views": Record<never, never>;
  "documents.empty.pick-document": Record<never, never>;
  "documents.empty.start": Record<never, never>;
  "documents.empty.view-empty": Record<never, never>;
  "documents.error.change-failed": Record<never, never>;
  "documents.error.changed": Record<never, never>;
  "documents.error.key-taken": Record<never, never>;
  "documents.error.link-unknown": Record<never, never>;
  "documents.error.name-invalid": Record<never, never>;
  "documents.error.read-failed": Record<never, never>;
  "documents.error.register-failed": Record<never, never>;
  "documents.error.rule-invalid": Record<never, never>;
  "documents.error.save-view-failed": Record<never, never>;
  "documents.error.section-missing": Record<never, never>;
  "documents.error.section-unsupported": Record<never, never>;
  "documents.error.section-unverified": Record<never, never>;
  "documents.error.series-taken": Record<never, never>;
  "documents.error.text-hidden": Record<never, never>;
  "documents.error.title-missing": Record<never, never>;
  "documents.error.view-name-taken": Record<never, never>;
  "documents.heading.members": Record<never, never>;
  "documents.heading.next": Record<never, never>;
  "documents.heading.register-series": Record<never, never>;
  "documents.label.any-focus": Record<never, never>;
  "documents.label.any-format": Record<never, never>;
  "documents.label.any-place": Record<never, never>;
  "documents.label.archived": Record<never, never>;
  "documents.label.archived-results": Record<never, never>;
  "documents.label.choose-document": Record<never, never>;
  "documents.label.choose-place": Record<never, never>;
  "documents.label.focus": Record<never, never>;
  "documents.label.format": Record<never, never>;
  "documents.label.format-name": {
    format: "string";
  };
  "documents.label.from-summary": Record<never, never>;
  "documents.label.include-archived": Record<never, never>;
  "documents.label.key": Record<never, never>;
  "documents.label.latest-version": Record<never, never>;
  "documents.label.link": Record<never, never>;
  "documents.label.link-help": Record<never, never>;
  "documents.label.member-document": Record<never, never>;
  "documents.label.name-help": Record<never, never>;
  "documents.label.newer-version": Record<never, never>;
  "documents.label.next-rule": Record<never, never>;
  "documents.label.next-rule-help": Record<never, never>;
  "documents.label.order-ascending": Record<never, never>;
  "documents.label.order-descending": Record<never, never>;
  "documents.label.place": Record<never, never>;
  "documents.label.query": Record<never, never>;
  "documents.label.saved-when": {
    when: "string";
  };
  "documents.label.series-meta": {
    place: "string";
    count: "plural";
  };
  "documents.label.series-name": Record<never, never>;
  "documents.label.series-order": Record<never, never>;
  "documents.label.series-rule": {
    rule: "string";
  };
  "documents.label.series-title": Record<never, never>;
  "documents.label.show-archived-series": Record<never, never>;
  "documents.label.tab-search": Record<never, never>;
  "documents.label.tab-series": Record<never, never>;
  "documents.label.tab-views": Record<never, never>;
  "documents.label.target-document": Record<never, never>;
  "documents.label.target-results": Record<never, never>;
  "documents.label.target-series": Record<never, never>;
  "documents.label.target-series-list": Record<never, never>;
  "documents.label.target-view": {
    name: "string";
  };
  "documents.label.target-views": Record<never, never>;
  "documents.label.view-name": Record<never, never>;
  "documents.label.whole-document": Record<never, never>;
  "documents.notice.archived-document": Record<never, never>;
  "documents.notice.first-key": Record<never, never>;
  "documents.notice.lagging": Record<never, never>;
  "documents.notice.link-moved": {
    address: "string";
  };
  "documents.notice.link-moved-unplaced": Record<never, never>;
  "documents.notice.no-suggestion": {
    from: "string";
  };
  "documents.notice.omissions": {
    count: "plural";
  };
  "documents.notice.pinned-version": {
    number: "number";
  };
  "documents.notice.rebuilding": Record<never, never>;
  "documents.notice.series-archived": Record<never, never>;
  "documents.notice.suggestion": {
    key: "string";
    from: "string";
    rule: "string";
  };
  "documents.notice.suggestion-taken": Record<never, never>;
  "documents.notice.view-rebuilt": Record<never, never>;
  "documents.notice.view-saved": {
    name: "string";
  };
  "documents.title.screen": Record<never, never>;
  "launcher.button.add-folder": Record<never, never>;
  "launcher.button.hide-details": Record<never, never>;
  "launcher.button.lophn": Record<never, never>;
  "launcher.button.reconnect": Record<never, never>;
  "launcher.button.register": Record<never, never>;
  "launcher.button.register-project": Record<never, never>;
  "launcher.button.remove-folder": Record<never, never>;
  "launcher.button.retry": Record<never, never>;
  "launcher.button.show-details": Record<never, never>;
  "launcher.connection.confirmed-at": {
    when: "string";
  };
  "launcher.connection.disconnected": Record<never, never>;
  "launcher.connection.failed": Record<never, never>;
  "launcher.connection.starting": Record<never, never>;
  "launcher.dialog.register-note": Record<never, never>;
  "launcher.empty.no-cards": Record<never, never>;
  "launcher.empty.no-folders": Record<never, never>;
  "launcher.empty.no-projects": Record<never, never>;
  "launcher.error.name-required": Record<never, never>;
  "launcher.error.name-taken": Record<never, never>;
  "launcher.error.picker-failed": Record<never, never>;
  "launcher.error.register-failed": {
    name: "string";
  };
  "launcher.field.purpose-help": Record<never, never>;
  "launcher.heading.projects": Record<never, never>;
  "launcher.label.detail-documents": {
    count: "plural";
  };
  "launcher.label.detail-gitignore": Record<never, never>;
  "launcher.label.detail-id": Record<never, never>;
  "launcher.label.detail-name": Record<never, never>;
  "launcher.label.detail-no-folders": Record<never, never>;
  "launcher.label.folder-description": Record<never, never>;
  "launcher.label.folders": Record<never, never>;
  "launcher.label.name": Record<never, never>;
  "launcher.label.projects": Record<never, never>;
  "launcher.label.purpose": Record<never, never>;
  "launcher.label.rule-exclude": {
    glob: "string";
  };
  "launcher.label.rule-include": {
    glob: "string";
  };
  "launcher.label.status-no-folder": Record<never, never>;
  "launcher.label.status-not-tracking": Record<never, never>;
  "launcher.label.status-tracking": Record<never, never>;
  "launcher.label.wordmark": Record<never, never>;
  "launcher.title.register": Record<never, never>;
  "project-workspace.button.add-rule": Record<never, never>;
  "project-workspace.button.close-tab": Record<never, never>;
  "project-workspace.button.collapse-sidebar": Record<never, never>;
  "project-workspace.button.edit-rules": Record<never, never>;
  "project-workspace.button.expand-sidebar": Record<never, never>;
  "project-workspace.button.info-panel": Record<never, never>;
  "project-workspace.button.launcher": Record<never, never>;
  "project-workspace.button.open-terminal": Record<never, never>;
  "project-workspace.button.preview-again": Record<never, never>;
  "project-workspace.button.remove-rule": Record<never, never>;
  "project-workspace.button.split-pane": Record<never, never>;
  "project-workspace.button.turn-on-tracking": Record<never, never>;
  "project-workspace.empty.no-contexts": Record<never, never>;
  "project-workspace.empty.no-documents": Record<never, never>;
  "project-workspace.empty.no-folders": Record<never, never>;
  "project-workspace.empty.no-tabs": Record<never, never>;
  "project-workspace.error.load-failed": Record<never, never>;
  "project-workspace.heading.contexts": Record<never, never>;
  "project-workspace.heading.documents": Record<never, never>;
  "project-workspace.heading.folders": Record<never, never>;
  "project-workspace.heading.left-out": Record<never, never>;
  "project-workspace.heading.tracked": Record<never, never>;
  "project-workspace.info.empty": Record<never, never>;
  "project-workspace.label.drop-here": Record<never, never>;
  "project-workspace.label.drop-side": Record<never, never>;
  "project-workspace.label.gitignore": Record<never, never>;
  "project-workspace.label.info-tab-contexts": Record<never, never>;
  "project-workspace.label.info-tab-info": Record<never, never>;
  "project-workspace.label.info-tab-versions": Record<never, never>;
  "project-workspace.label.kind-app-panel": Record<never, never>;
  "project-workspace.label.kind-document-editor": Record<never, never>;
  "project-workspace.label.kind-document-viewer": Record<never, never>;
  "project-workspace.label.kind-terminal": Record<never, never>;
  "project-workspace.label.more-files": {
    count: "plural";
  };
  "project-workspace.label.path": Record<never, never>;
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
  "project-workspace.label.rule-effect": Record<never, never>;
  "project-workspace.label.rule-exclude": Record<never, never>;
  "project-workspace.label.rule-include": Record<never, never>;
  "project-workspace.label.rule-pattern": Record<never, never>;
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
  "projects.button.archive": Record<never, never>;
  "projects.button.back-to-project": Record<never, never>;
  "projects.button.export": {
    count: "plural";
  };
  "projects.button.move": Record<never, never>;
  "projects.button.place": Record<never, never>;
  "projects.button.remove-file": Record<never, never>;
  "projects.button.rename": Record<never, never>;
  "projects.button.save": Record<never, never>;
  "projects.button.show-latest": Record<never, never>;
  "projects.button.unarchive": Record<never, never>;
  "projects.empty.documents": Record<never, never>;
  "projects.empty.none": Record<never, never>;
  "projects.empty.pick": Record<never, never>;
  "projects.error.changed": Record<never, never>;
  "projects.error.document-change-failed": Record<never, never>;
  "projects.error.document-name-taken": Record<never, never>;
  "projects.error.export-changed": Record<never, never>;
  "projects.error.export-failed": Record<never, never>;
  "projects.error.name-invalid": Record<never, never>;
  "projects.error.name-taken": Record<never, never>;
  "projects.error.project-change-failed": Record<never, never>;
  "projects.error.review-unavailable": Record<never, never>;
  "projects.error.title-missing": Record<never, never>;
  "projects.heading.document": Record<never, never>;
  "projects.heading.documents": Record<never, never>;
  "projects.heading.export": Record<never, never>;
  "projects.heading.export-included": Record<never, never>;
  "projects.heading.export-left-out": Record<never, never>;
  "projects.heading.file": Record<never, never>;
  "projects.label.archived": Record<never, never>;
  "projects.label.document-count": {
    count: "plural";
  };
  "projects.label.document-name": Record<never, never>;
  "projects.label.export-format": Record<never, never>;
  "projects.label.export-kept-original": Record<never, never>;
  "projects.label.export-no-files": Record<never, never>;
  "projects.label.export-not-picked": Record<never, never>;
  "projects.label.export-version": Record<never, never>;
  "projects.label.file-folder": Record<never, never>;
  "projects.label.file-linked": Record<never, never>;
  "projects.label.file-name": Record<never, never>;
  "projects.label.format-json": Record<never, never>;
  "projects.label.format-markdown": Record<never, never>;
  "projects.label.move-to": Record<never, never>;
  "projects.label.name": Record<never, never>;
  "projects.label.name-help": Record<never, never>;
  "projects.label.no-place": Record<never, never>;
  "projects.label.place-project": Record<never, never>;
  "projects.label.purpose": Record<never, never>;
  "projects.label.show-archived": Record<never, never>;
  "projects.label.step-done": Record<never, never>;
  "projects.label.step-failed": Record<never, never>;
  "projects.label.step-forbidden": Record<never, never>;
  "projects.label.step-move": Record<never, never>;
  "projects.label.step-not-attempted": Record<never, never>;
  "projects.label.step-skipped": Record<never, never>;
  "projects.label.step-source": Record<never, never>;
  "projects.label.step-tracking": Record<never, never>;
  "projects.label.step-unlink-move": Record<never, never>;
  "projects.label.step-unlink-source": Record<never, never>;
  "projects.label.target-documents": Record<never, never>;
  "projects.label.target-project": Record<never, never>;
  "projects.label.target-projects": Record<never, never>;
  "projects.label.title": Record<never, never>;
  "projects.label.tracking-off": Record<never, never>;
  "projects.label.tracking-on": Record<never, never>;
  "projects.label.version-latest": {
    number: "number";
  };
  "projects.label.version-number": {
    number: "number";
  };
  "projects.notice.archive-keeps": Record<never, never>;
  "projects.notice.archived": Record<never, never>;
  "projects.notice.export-pick": Record<never, never>;
  "projects.notice.file-none": Record<never, never>;
  "projects.notice.file-stays": Record<never, never>;
  "projects.notice.moved": {
    place: "string";
  };
  "projects.notice.moved-out": Record<never, never>;
  "projects.notice.place-help": Record<never, never>;
  "projects.notice.place-many-files": Record<never, never>;
  "projects.notice.place-no-project": Record<never, never>;
  "projects.notice.remove-help": Record<never, never>;
  "projects.notice.renamed": {
    name: "string";
  };
  "projects.notice.review-opened": Record<never, never>;
  "projects.notice.saved": Record<never, never>;
  "projects.notice.steps-incomplete": Record<never, never>;
  "projects.result.file-conflict": Record<never, never>;
  "projects.result.file-deleted": Record<never, never>;
  "projects.result.file-failed": Record<never, never>;
  "projects.result.file-gone": Record<never, never>;
  "projects.result.file-unknown": Record<never, never>;
  "projects.result.file-written": Record<never, never>;
  "projects.title.screen": Record<never, never>;
  "roles.title.screen": Record<never, never>;
  "settings.models.for-decisions": Record<never, never>;
  "settings.models.for-summaries": Record<never, never>;
  "settings.title.screen": Record<never, never>;
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
  "terminal.notice.account": Record<never, never>;
  "terminal.notice.folder": Record<never, never>;
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
  "things-to-confirm.button.answer-next": Record<never, never>;
  "things-to-confirm.button.cancel-question": Record<never, never>;
  "things-to-confirm.button.confirm-cancel": Record<never, never>;
  "things-to-confirm.button.keep-question": Record<never, never>;
  "things-to-confirm.button.later": Record<never, never>;
  "things-to-confirm.button.mark-read": Record<never, never>;
  "things-to-confirm.button.review": Record<never, never>;
  "things-to-confirm.button.review-next": Record<never, never>;
  "things-to-confirm.button.send-answer": Record<never, never>;
  "things-to-confirm.empty.filtered": Record<never, never>;
  "things-to-confirm.empty.notifications": Record<never, never>;
  "things-to-confirm.empty.past": Record<never, never>;
  "things-to-confirm.empty.pick": Record<never, never>;
  "things-to-confirm.empty.waiting": Record<never, never>;
  "things-to-confirm.error.cancel-failed": Record<never, never>;
  "things-to-confirm.error.changed": Record<never, never>;
  "things-to-confirm.error.decisions-unavailable": Record<never, never>;
  "things-to-confirm.error.later-failed": Record<never, never>;
  "things-to-confirm.error.load-failed": Record<never, never>;
  "things-to-confirm.error.mark-read-failed": Record<never, never>;
  "things-to-confirm.error.not-allowed": Record<never, never>;
  "things-to-confirm.error.notifications-unavailable": Record<never, never>;
  "things-to-confirm.error.question-text": Record<never, never>;
  "things-to-confirm.error.review-unavailable": Record<never, never>;
  "things-to-confirm.error.send-failed": Record<never, never>;
  "things-to-confirm.error.too-long": Record<never, never>;
  "things-to-confirm.label.blocking": Record<never, never>;
  "things-to-confirm.label.cancel-reason": Record<never, never>;
  "things-to-confirm.label.count-decisions": {
    count: "plural";
  };
  "things-to-confirm.label.count-questions": {
    count: "plural";
  };
  "things-to-confirm.label.decision": Record<never, never>;
  "things-to-confirm.label.decision-from": {
    role: "string";
  };
  "things-to-confirm.label.event-activation-failed": Record<never, never>;
  "things-to-confirm.label.event-decision": Record<never, never>;
  "things-to-confirm.label.event-focus-changed": Record<never, never>;
  "things-to-confirm.label.event-issue-closed": Record<never, never>;
  "things-to-confirm.label.event-issue-opened": Record<never, never>;
  "things-to-confirm.label.event-issue-reopened": Record<never, never>;
  "things-to-confirm.label.event-other": Record<never, never>;
  "things-to-confirm.label.event-paused": Record<never, never>;
  "things-to-confirm.label.event-question": Record<never, never>;
  "things-to-confirm.label.event-task-check-failed": Record<never, never>;
  "things-to-confirm.label.event-task-confirmed": Record<never, never>;
  "things-to-confirm.label.expires": {
    when: "string";
  };
  "things-to-confirm.label.not-in-conversation": Record<never, never>;
  "things-to-confirm.label.opens-review": Record<never, never>;
  "things-to-confirm.label.options": Record<never, never>;
  "things-to-confirm.label.own-answer": Record<never, never>;
  "things-to-confirm.label.period": Record<never, never>;
  "things-to-confirm.label.period-all": Record<never, never>;
  "things-to-confirm.label.period-day": Record<never, never>;
  "things-to-confirm.label.period-month": Record<never, never>;
  "things-to-confirm.label.period-week": Record<never, never>;
  "things-to-confirm.label.question": Record<never, never>;
  "things-to-confirm.label.question-from": {
    role: "string";
  };
  "things-to-confirm.label.read": Record<never, never>;
  "things-to-confirm.label.recommended": Record<never, never>;
  "things-to-confirm.label.role": Record<never, never>;
  "things-to-confirm.label.role-all": Record<never, never>;
  "things-to-confirm.label.role-app-engineer": Record<never, never>;
  "things-to-confirm.label.role-context-engineer": Record<never, never>;
  "things-to-confirm.label.role-lophn": Record<never, never>;
  "things-to-confirm.label.role-operator": Record<never, never>;
  "things-to-confirm.label.status-allowed": Record<never, never>;
  "things-to-confirm.label.status-answered": Record<never, never>;
  "things-to-confirm.label.status-cancelled": Record<never, never>;
  "things-to-confirm.label.status-declined": Record<never, never>;
  "things-to-confirm.label.status-deferred": Record<never, never>;
  "things-to-confirm.label.status-expired": Record<never, never>;
  "things-to-confirm.label.status-replaced": Record<never, never>;
  "things-to-confirm.label.status-waiting": Record<never, never>;
  "things-to-confirm.label.tab-notifications": Record<never, never>;
  "things-to-confirm.label.tab-past": Record<never, never>;
  "things-to-confirm.label.tab-waiting": Record<never, never>;
  "things-to-confirm.label.unread": Record<never, never>;
  "things-to-confirm.label.why-recommended": Record<never, never>;
  "things-to-confirm.notice.answer-applied": Record<never, never>;
  "things-to-confirm.notice.answer-not-applied": Record<never, never>;
  "things-to-confirm.notice.answered-option": {
    option: "string";
  };
  "things-to-confirm.notice.answered-text": Record<never, never>;
  "things-to-confirm.notice.decision-irreversible": Record<never, never>;
  "things-to-confirm.notice.decision-reversible": Record<never, never>;
  "things-to-confirm.notice.decision-text-unavailable": Record<never, never>;
  "things-to-confirm.notice.no-answer": Record<never, never>;
  "things-to-confirm.notice.question-loading": Record<never, never>;
  "things-to-confirm.notice.stale": {
    age: "string";
  };
  "things-to-confirm.notice.stale-never": Record<never, never>;
  "things-to-confirm.title.screen": Record<never, never>;
};

type ValueFor<T> = T extends "plural" | "number" ? number
  : T extends "date" ? Date
  : string;

export type ValuesOf<K extends MessageKey> = {
  [P in keyof PlaceholderKinds[K]]: ValueFor<PlaceholderKinds[K][P]>;
};

export type HasPlaceholders<K extends MessageKey> = [
  keyof PlaceholderKinds[K],
] extends [never] ? false
  : true;

type _SameKeys =
  | Exclude<MessageKey, keyof PlaceholderKinds>
  | Exclude<keyof PlaceholderKinds, MessageKey>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
