// catalog/app-space.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { appSpace } from "./app-space.ts";

export type AppSpacePlaceholders = {
  "app-detail.button.all-issues": Record<never, never>;
  "app-detail.button.back-to-activity": Record<never, never>;
  "app-detail.button.cancel": Record<never, never>;
  "app-detail.button.cancel-create": Record<never, never>;
  "app-detail.button.change-access": Record<never, never>;
  "app-detail.button.check-result": Record<never, never>;
  "app-detail.button.close-preview": Record<never, never>;
  "app-detail.button.copy-request": Record<never, never>;
  "app-detail.button.export-app": Record<never, never>;
  "app-detail.button.go-back": {
    release: "string";
  };
  "app-detail.button.hide-activity": Record<never, never>;
  "app-detail.button.hide-changes": Record<never, never>;
  "app-detail.button.issue-back": Record<never, never>;
  "app-detail.button.issue-dismiss": Record<never, never>;
  "app-detail.button.issue-fixed": Record<never, never>;
  "app-detail.button.issue-ignored": Record<never, never>;
  "app-detail.button.issue-not-fixed": Record<never, never>;
  "app-detail.button.issue-not-visible": Record<never, never>;
  "app-detail.button.issue-reopen": Record<never, never>;
  "app-detail.button.issue-resolved": Record<never, never>;
  "app-detail.button.issue-tried": Record<never, never>;
  "app-detail.button.open-preview": Record<never, never>;
  "app-detail.button.review-connection": Record<never, never>;
  "app-detail.button.revoke": Record<never, never>;
  "app-detail.button.rewind-app": {
    name: "string";
  };
  "app-detail.button.rewind-from-here": Record<never, never>;
  "app-detail.button.see-changes": Record<never, never>;
  "app-detail.button.show-activity": Record<never, never>;
  "app-detail.button.start": Record<never, never>;
  "app-detail.button.turn-off": Record<never, never>;
  "app-detail.button.turn-on": Record<never, never>;
  "app-detail.button.use-version": Record<never, never>;
  "app-detail.error.apply-failed": {
    number: "string";
  };
  "app-detail.error.cancel-changed": Record<never, never>;
  "app-detail.error.cancel-failed": Record<never, never>;
  "app-detail.error.copy-failed": Record<never, never>;
  "app-detail.error.create-failed": Record<never, never>;
  "app-detail.error.decision-failed": Record<never, never>;
  "app-detail.error.go-back-failed": {
    release: "string";
  };
  "app-detail.error.issue-state-failed": Record<never, never>;
  "app-detail.error.issue-tried-failed": Record<never, never>;
  "app-detail.error.preview-failed": Record<never, never>;
  "app-detail.error.revoke-failed": Record<never, never>;
  "app-detail.error.rewind-failed": Record<never, never>;
  "app-detail.error.start-connection-unavailable": Record<never, never>;
  "app-detail.error.start-failed": Record<never, never>;
  "app-detail.error.start-folder-changed": Record<never, never>;
  "app-detail.error.start-host-refused": Record<never, never>;
  "app-detail.error.start-own-terminal": Record<never, never>;
  "app-detail.error.start-refused": Record<never, never>;
  "app-detail.error.turn-off-failed": {
    name: "string";
  };
  "app-detail.heading.access-agents": Record<never, never>;
  "app-detail.heading.access-asks": Record<never, never>;
  "app-detail.heading.access-documents": Record<never, never>;
  "app-detail.heading.access-files-read": Record<never, never>;
  "app-detail.heading.access-files-write": Record<never, never>;
  "app-detail.heading.access-listen": Record<never, never>;
  "app-detail.heading.access-network": Record<never, never>;
  "app-detail.heading.access-removed": Record<never, never>;
  "app-detail.heading.access-secrets": Record<never, never>;
  "app-detail.heading.active-release": Record<never, never>;
  "app-detail.heading.active-release-named": {
    release: "string";
  };
  "app-detail.heading.being-applied": Record<never, never>;
  "app-detail.heading.changes": {
    from: "string";
    to: "string";
  };
  "app-detail.heading.changes-first": {
    to: "string";
  };
  "app-detail.heading.current-version": Record<never, never>;
  "app-detail.heading.detail-access": Record<never, never>;
  "app-detail.heading.detail-actions": Record<never, never>;
  "app-detail.heading.detail-data": Record<never, never>;
  "app-detail.heading.detail-screens": Record<never, never>;
  "app-detail.heading.earlier-releases": Record<never, never>;
  "app-detail.heading.evidence": Record<never, never>;
  "app-detail.heading.issue-checks": Record<never, never>;
  "app-detail.heading.issue-decide": Record<never, never>;
  "app-detail.heading.last-activation": Record<never, never>;
  "app-detail.heading.occurrences": Record<never, never>;
  "app-detail.heading.other-apps": Record<never, never>;
  "app-detail.heading.other-versions": Record<never, never>;
  "app-detail.heading.outside-resources": Record<never, never>;
  "app-detail.heading.progress": Record<never, never>;
  "app-detail.heading.rewind-before": {
    name: "string";
    time: "string";
  };
  "app-detail.heading.rewind-cancelled": Record<never, never>;
  "app-detail.heading.rewinds-together": Record<never, never>;
  "app-detail.heading.rewound": Record<never, never>;
  "app-detail.heading.what-changes": Record<never, never>;
  "app-detail.heading.what-was-rewound": Record<never, never>;
  "app-detail.label.access-target": Record<never, never>;
  "app-detail.label.activity-target": Record<never, never>;
  "app-detail.label.all-projects": Record<never, never>;
  "app-detail.label.all-statuses": Record<never, never>;
  "app-detail.label.an-action": Record<never, never>;
  "app-detail.label.another-app": Record<never, never>;
  "app-detail.label.applied-before": Record<never, never>;
  "app-detail.label.applied-failed": Record<never, never>;
  "app-detail.label.applied-no": Record<never, never>;
  "app-detail.label.applied-working": Record<never, never>;
  "app-detail.label.applied-yes": Record<never, never>;
  "app-detail.label.by-agent": Record<never, never>;
  "app-detail.label.by-app": Record<never, never>;
  "app-detail.label.by-applying": Record<never, never>;
  "app-detail.label.by-direct": Record<never, never>;
  "app-detail.label.by-restart": Record<never, never>;
  "app-detail.label.call-data-change": Record<never, never>;
  "app-detail.label.call-start": Record<never, never>;
  "app-detail.label.called-by-activation": Record<never, never>;
  "app-detail.label.called-by-app": {
    name: "string";
    release: "string";
  };
  "app-detail.label.called-by-person": Record<never, never>;
  "app-detail.label.called-by-restart": Record<never, never>;
  "app-detail.label.caller-app": {
    name: "string";
  };
  "app-detail.label.caller-app-unnamed": Record<never, never>;
  "app-detail.label.caller-person": Record<never, never>;
  "app-detail.label.caller-start": Record<never, never>;
  "app-detail.label.calls-held": Record<never, never>;
  "app-detail.label.came-back": Record<never, never>;
  "app-detail.label.cancel-reason": Record<never, never>;
  "app-detail.label.cancelled": Record<never, never>;
  "app-detail.label.change-access-added": {
    count: "plural";
  };
  "app-detail.label.change-access-removed": {
    count: "plural";
  };
  "app-detail.label.change-actions-added": {
    count: "plural";
  };
  "app-detail.label.change-actions-changed": {
    count: "plural";
  };
  "app-detail.label.change-actions-external": {
    count: "plural";
  };
  "app-detail.label.change-actions-removed": {
    count: "plural";
  };
  "app-detail.label.change-data": {
    from: "string";
    to: "string";
  };
  "app-detail.label.change-screens": {
    count: "plural";
  };
  "app-detail.label.changes-app-api": Record<never, never>;
  "app-detail.label.changes-loss": Record<never, never>;
  "app-detail.label.changes-resource": Record<never, never>;
  "app-detail.label.changes-target": Record<never, never>;
  "app-detail.label.changes-wider": Record<never, never>;
  "app-detail.label.check-fail": Record<never, never>;
  "app-detail.label.check-inconclusive": Record<never, never>;
  "app-detail.label.check-line": {
    condition: "string";
    result: "string";
  };
  "app-detail.label.check-pass": Record<never, never>;
  "app-detail.label.checked-at": {
    age: "string";
  };
  "app-detail.label.cleaning-up": Record<never, never>;
  "app-detail.label.col-call": Record<never, never>;
  "app-detail.label.col-caller": Record<never, never>;
  "app-detail.label.col-effect": Record<never, never>;
  "app-detail.label.col-result": Record<never, never>;
  "app-detail.label.col-time": Record<never, never>;
  "app-detail.label.commit": {
    commit: "string";
  };
  "app-detail.label.condition-human": Record<never, never>;
  "app-detail.label.condition-issues-closed": Record<never, never>;
  "app-detail.label.condition-number": {
    number: "number";
  };
  "app-detail.label.condition-reproduction": Record<never, never>;
  "app-detail.label.condition-version-in-use": Record<never, never>;
  "app-detail.label.connection-actions": {
    count: "plural";
  };
  "app-detail.label.connection-allowed": Record<never, never>;
  "app-detail.label.connection-asks": Record<never, never>;
  "app-detail.label.connection-partly": Record<never, never>;
  "app-detail.label.connections-target": Record<never, never>;
  "app-detail.label.create-title": Record<never, never>;
  "app-detail.label.create-what": Record<never, never>;
  "app-detail.label.create-why": Record<never, never>;
  "app-detail.label.data-format": {
    number: "string";
  };
  "app-detail.label.data-schema": {
    schema: "string";
  };
  "app-detail.label.data-target": Record<never, never>;
  "app-detail.label.details": Record<never, never>;
  "app-detail.label.did-action": {
    action: "string";
  };
  "app-detail.label.did-action-unnamed": Record<never, never>;
  "app-detail.label.did-data-change": Record<never, never>;
  "app-detail.label.did-start": Record<never, never>;
  "app-detail.label.done": Record<never, never>;
  "app-detail.label.everyone-together": Record<never, never>;
  "app-detail.label.evidence-error": Record<never, never>;
  "app-detail.label.evidence-log": Record<never, never>;
  "app-detail.label.evidence-reports": Record<never, never>;
  "app-detail.label.fact-action": Record<never, never>;
  "app-detail.label.fact-applied": Record<never, never>;
  "app-detail.label.fact-called-by": Record<never, never>;
  "app-detail.label.fact-can-start": Record<never, never>;
  "app-detail.label.fact-commit": Record<never, never>;
  "app-detail.label.fact-first": Record<never, never>;
  "app-detail.label.fact-input": Record<never, never>;
  "app-detail.label.fact-input-fingerprint": Record<never, never>;
  "app-detail.label.fact-last": Record<never, never>;
  "app-detail.label.fact-project": Record<never, never>;
  "app-detail.label.fact-reason": Record<never, never>;
  "app-detail.label.fact-release": Record<never, never>;
  "app-detail.label.fact-reports": Record<never, never>;
  "app-detail.label.fact-result": Record<never, never>;
  "app-detail.label.fact-saved": Record<never, never>;
  "app-detail.label.fact-schedule": Record<never, never>;
  "app-detail.label.fact-schema": Record<never, never>;
  "app-detail.label.fact-seen": Record<never, never>;
  "app-detail.label.fact-start": Record<never, never>;
  "app-detail.label.fact-tried": Record<never, never>;
  "app-detail.label.fact-undo": Record<never, never>;
  "app-detail.label.failed-still-active": {
    release: "string";
  };
  "app-detail.label.filter-period": Record<never, never>;
  "app-detail.label.filter-project": Record<never, never>;
  "app-detail.label.filter-status": Record<never, never>;
  "app-detail.label.from-release": {
    release: "string";
  };
  "app-detail.label.in-progress": Record<never, never>;
  "app-detail.label.input-none": Record<never, never>;
  "app-detail.label.input-saved": Record<never, never>;
  "app-detail.label.issue-basis": Record<never, never>;
  "app-detail.label.issue-claim": Record<never, never>;
  "app-detail.label.issue-closed": Record<never, never>;
  "app-detail.label.issue-collected": Record<never, never>;
  "app-detail.label.issue-dismiss-reason": Record<never, never>;
  "app-detail.label.issue-first-seen": {
    age: "string";
  };
  "app-detail.label.issue-human": Record<never, never>;
  "app-detail.label.issue-last": {
    when: "string";
  };
  "app-detail.label.issue-last-seen": {
    age: "string";
  };
  "app-detail.label.issue-needed": Record<never, never>;
  "app-detail.label.issue-needs": Record<never, never>;
  "app-detail.label.issue-owner": Record<never, never>;
  "app-detail.label.issue-remaining": Record<never, never>;
  "app-detail.label.issue-repair": Record<never, never>;
  "app-detail.label.issue-reports": {
    count: "plural";
  };
  "app-detail.label.issue-scope": Record<never, never>;
  "app-detail.label.issue-seen": {
    count: "plural";
  };
  "app-detail.label.issue-status-closed": Record<never, never>;
  "app-detail.label.issue-status-fixing": Record<never, never>;
  "app-detail.label.issue-status-ignored": Record<never, never>;
  "app-detail.label.issue-status-open": Record<never, never>;
  "app-detail.label.issue-status-resolved": Record<never, never>;
  "app-detail.label.issue-version": Record<never, never>;
  "app-detail.label.issues-target": Record<never, never>;
  "app-detail.label.last-activity": {
    status: "string";
    age: "string";
  };
  "app-detail.label.loss-drop-column": Record<never, never>;
  "app-detail.label.loss-drop-table": Record<never, never>;
  "app-detail.label.loss-narrow-type": Record<never, never>;
  "app-detail.label.mode-preview": Record<never, never>;
  "app-detail.label.no": Record<never, never>;
  "app-detail.label.no-project": Record<never, never>;
  "app-detail.label.no-project-level": Record<never, never>;
  "app-detail.label.not-yet": Record<never, never>;
  "app-detail.label.nothing-changed": Record<never, never>;
  "app-detail.label.occurrence-app-error": Record<never, never>;
  "app-detail.label.occurrence-report": Record<never, never>;
  "app-detail.label.outcome-cannot": Record<never, never>;
  "app-detail.label.outcome-done": Record<never, never>;
  "app-detail.label.outcome-not-changed": Record<never, never>;
  "app-detail.label.outcome-stays": Record<never, never>;
  "app-detail.label.outcome-undone": Record<never, never>;
  "app-detail.label.own-terminal": Record<never, never>;
  "app-detail.label.period-all": Record<never, never>;
  "app-detail.label.period-day": Record<never, never>;
  "app-detail.label.period-month": Record<never, never>;
  "app-detail.label.period-week": Record<never, never>;
  "app-detail.label.preview-banner": {
    number: "string";
  };
  "app-detail.label.recurred": Record<never, never>;
  "app-detail.label.recurred-in": {
    release: "string";
  };
  "app-detail.label.replaced": {
    when: "string";
  };
  "app-detail.label.resource-file": Record<never, never>;
  "app-detail.label.resource-network": Record<never, never>;
  "app-detail.label.resource-secret": Record<never, never>;
  "app-detail.label.result-none": Record<never, never>;
  "app-detail.label.revoked": Record<never, never>;
  "app-detail.label.rewind-blocked": Record<never, never>;
  "app-detail.label.rewind-drain": Record<never, never>;
  "app-detail.label.rewind-drain-calls": {
    count: "plural";
    calls: "string";
  };
  "app-detail.label.rewind-stopped": Record<never, never>;
  "app-detail.label.rewind-target": Record<never, never>;
  "app-detail.label.rewind-undo": Record<never, never>;
  "app-detail.label.rewound-title": {
    name: "string";
    time: "string";
  };
  "app-detail.label.role-app-engineer": Record<never, never>;
  "app-detail.label.role-lophn": Record<never, never>;
  "app-detail.label.role-operator": Record<never, never>;
  "app-detail.label.role-project-manager": Record<never, never>;
  "app-detail.label.schedule-interval": {
    minutes: "plural";
  };
  "app-detail.label.schedule-start": Record<never, never>;
  "app-detail.label.session-unnamed": Record<never, never>;
  "app-detail.label.start-connection": Record<never, never>;
  "app-detail.label.start-folder": Record<never, never>;
  "app-detail.label.start-folder-option": {
    project: "string";
    path: "string";
  };
  "app-detail.label.start-harness": Record<never, never>;
  "app-detail.label.start-not-chosen": Record<never, never>;
  "app-detail.label.start-ok": Record<never, never>;
  "app-detail.label.state-done": Record<never, never>;
  "app-detail.label.state-failed": Record<never, never>;
  "app-detail.label.state-running": Record<never, never>;
  "app-detail.label.state-undone": Record<never, never>;
  "app-detail.label.state-unknown": Record<never, never>;
  "app-detail.label.state-waiting": Record<never, never>;
  "app-detail.label.status-applied": Record<never, never>;
  "app-detail.label.status-applying": Record<never, never>;
  "app-detail.label.status-blocked": Record<never, never>;
  "app-detail.label.status-current": Record<never, never>;
  "app-detail.label.status-didnt-finish": Record<never, never>;
  "app-detail.label.status-done": Record<never, never>;
  "app-detail.label.status-failed": Record<never, never>;
  "app-detail.label.status-older": Record<never, never>;
  "app-detail.label.status-prepared": Record<never, never>;
  "app-detail.label.status-result-unknown": Record<never, never>;
  "app-detail.label.status-waiting": Record<never, never>;
  "app-detail.label.status-working": Record<never, never>;
  "app-detail.label.step-drain": Record<never, never>;
  "app-detail.label.step-hold": Record<never, never>;
  "app-detail.label.step-hold-count": {
    count: "plural";
  };
  "app-detail.label.step-migrate": Record<never, never>;
  "app-detail.label.step-migrate-count": {
    count: "plural";
  };
  "app-detail.label.step-start": {
    release: "string";
  };
  "app-detail.label.step-stop": Record<never, never>;
  "app-detail.label.tab-access": Record<never, never>;
  "app-detail.label.tab-activity": Record<never, never>;
  "app-detail.label.tab-data": Record<never, never>;
  "app-detail.label.tab-issues": Record<never, never>;
  "app-detail.label.tab-version": Record<never, never>;
  "app-detail.label.time-unknown": Record<never, never>;
  "app-detail.label.tool-call": Record<never, never>;
  "app-detail.label.tui-ended": Record<never, never>;
  "app-detail.label.tui-ready": Record<never, never>;
  "app-detail.label.tui-starting": Record<never, never>;
  "app-detail.label.tui-unknown": Record<never, never>;
  "app-detail.label.tui-waiting-input": Record<never, never>;
  "app-detail.label.tui-working": Record<never, never>;
  "app-detail.label.turn": Record<never, never>;
  "app-detail.label.undo-none": Record<never, never>;
  "app-detail.label.version-target": Record<never, never>;
  "app-detail.label.versions-target": Record<never, never>;
  "app-detail.label.went-back": {
    release: "string";
  };
  "app-detail.label.yes": Record<never, never>;
  "app-detail.note.access-empty": Record<never, never>;
  "app-detail.note.access-intro": Record<never, never>;
  "app-detail.note.access-removal-scope": Record<never, never>;
  "app-detail.note.access-removed": Record<never, never>;
  "app-detail.note.access-removing": Record<never, never>;
  "app-detail.note.access-removing-stop": Record<never, never>;
  "app-detail.note.activity-scope": Record<never, never>;
  "app-detail.note.applying-first": Record<never, never>;
  "app-detail.note.applying-keeps": {
    previous: "string";
    next: "string";
  };
  "app-detail.note.applying-queued": Record<never, never>;
  "app-detail.note.applying-waiting-approval": Record<never, never>;
  "app-detail.note.calls-held": {
    name: "string";
  };
  "app-detail.note.came-back": {
    resolved: "string";
    release: "string";
  };
  "app-detail.note.cancel-reason": Record<never, never>;
  "app-detail.note.changes-none": Record<never, never>;
  "app-detail.note.conflict": {
    reason: "string";
  };
  "app-detail.note.conflict-unknown": Record<never, never>;
  "app-detail.note.connection-scope": Record<never, never>;
  "app-detail.note.connections-empty": Record<never, never>;
  "app-detail.note.create": Record<never, never>;
  "app-detail.note.data-converts": Record<never, never>;
  "app-detail.note.decision-waiting": Record<never, never>;
  "app-detail.note.export": Record<never, never>;
  "app-detail.note.export-failed": Record<never, never>;
  "app-detail.note.export-preparing": Record<never, never>;
  "app-detail.note.export-ready": Record<never, never>;
  "app-detail.note.failed-called": Record<never, never>;
  "app-detail.note.failed-unchanged": Record<never, never>;
  "app-detail.note.go-back-busy": Record<never, never>;
  "app-detail.note.go-back-schema": {
    schema: "string";
    current: "string";
  };
  "app-detail.note.go-back-scope": Record<never, never>;
  "app-detail.note.input-fingerprint": Record<never, never>;
  "app-detail.note.issue-check-failed": Record<never, never>;
  "app-detail.note.issue-checks-scope": Record<never, never>;
  "app-detail.note.issue-choice-blocked": Record<never, never>;
  "app-detail.note.issue-human-no": Record<never, never>;
  "app-detail.note.issue-human-yes": Record<never, never>;
  "app-detail.note.issue-tried": Record<never, never>;
  "app-detail.note.issues-empty": Record<never, never>;
  "app-detail.note.issues-unavailable": Record<never, never>;
  "app-detail.note.may-call": Record<never, never>;
  "app-detail.note.no-activity": Record<never, never>;
  "app-detail.note.no-changes": Record<never, never>;
  "app-detail.note.no-current": Record<never, never>;
  "app-detail.note.no-issues": Record<never, never>;
  "app-detail.note.no-log": Record<never, never>;
  "app-detail.note.no-other-apps": Record<never, never>;
  "app-detail.note.no-other-versions": Record<never, never>;
  "app-detail.note.no-reports": Record<never, never>;
  "app-detail.note.no-resources": Record<never, never>;
  "app-detail.note.no-stack": Record<never, never>;
  "app-detail.note.own-terminal": Record<never, never>;
  "app-detail.note.prompt-delivered": Record<never, never>;
  "app-detail.note.prompt-not-delivered": Record<never, never>;
  "app-detail.note.prompt-pending": Record<never, never>;
  "app-detail.note.prompt-unknown": Record<never, never>;
  "app-detail.note.request-copied": Record<never, never>;
  "app-detail.note.resource-file-read": {
    when: "string";
  };
  "app-detail.note.resource-file-write": {
    when: "string";
  };
  "app-detail.note.resource-listen": {
    when: "string";
  };
  "app-detail.note.resource-network": {
    when: "string";
  };
  "app-detail.note.resource-secret": Record<never, never>;
  "app-detail.note.review-needed": Record<never, never>;
  "app-detail.note.revoke-cleaned": Record<never, never>;
  "app-detail.note.revoke-requested": Record<never, never>;
  "app-detail.note.revoke-waiting": Record<never, never>;
  "app-detail.note.rewind-blocked": {
    time: "string";
  };
  "app-detail.note.rewind-confirm": {
    name: "string";
    time: "string";
  };
  "app-detail.note.rewind-counts": {
    undone: "plural";
    stays: "plural";
    cannot: "plural";
  };
  "app-detail.note.rewound": {
    undone: "plural";
  };
  "app-detail.note.secret-deleted": Record<never, never>;
  "app-detail.note.secret-missing": Record<never, never>;
  "app-detail.note.secret-still-stored": Record<never, never>;
  "app-detail.note.secret-stored": Record<never, never>;
  "app-detail.note.start-no-connection": Record<never, never>;
  "app-detail.note.start-no-folder": Record<never, never>;
  "app-detail.note.start-no-harness": Record<never, never>;
  "app-detail.note.start-opened": Record<never, never>;
  "app-detail.note.start-with": {
    harness: "string";
    folder: "string";
  };
  "app-detail.note.tui-separate": Record<never, never>;
  "app-detail.note.undo-recorded": Record<never, never>;
  "app-detail.note.warning-other": Record<never, never>;
  "app-detail.note.warning-outside-link": Record<never, never>;
  "app-detail.note.warning-read-network": Record<never, never>;
  "app-detail.note.went-back": Record<never, never>;
  "app-space.button.annotate": Record<never, never>;
  "app-space.button.annotate-done": Record<never, never>;
  "app-space.button.app-details": Record<never, never>;
  "app-space.button.clear-annotations": Record<never, never>;
  "app-space.button.manage-agents": Record<never, never>;
  "app-space.button.send-annotations": Record<never, never>;
  "app-space.button.show-terminal": Record<never, never>;
  "app-space.empty.agent-not-ready": Record<never, never>;
  "app-space.empty.archived": Record<never, never>;
  "app-space.empty.no-projects": Record<never, never>;
  "app-space.empty.no-version": Record<never, never>;
  "app-space.empty.not-found": Record<never, never>;
  "app-space.empty.screen-not-ready": Record<never, never>;
  "app-space.error.annotations-archived": Record<never, never>;
  "app-space.error.annotations-failed": Record<never, never>;
  "app-space.error.project-failed": Record<never, never>;
  "app-space.heading.agents": Record<never, never>;
  "app-space.heading.annotations": {
    count: "number";
  };
  "app-space.heading.app-details": Record<never, never>;
  "app-space.heading.choose-project": Record<never, never>;
  "app-space.label.agent-select": Record<never, never>;
  "app-space.label.annotations": Record<never, never>;
  "app-space.label.in-project": {
    project: "string";
  };
  "app-space.label.remove-annotation": {
    number: "string";
  };
  "app-space.label.sending-annotations": Record<never, never>;
  "app-space.label.this-app": Record<never, never>;
  "app-space.label.your-projects": Record<never, never>;
  "app-space.notice.no-project-list": Record<never, never>;
  "app-space.text.annotate-on": Record<never, never>;
  "app-space.text.annotations-note": Record<never, never>;
  "app-space.text.annotations-sent": Record<never, never>;
  "app-space.text.choose-project": {
    app: "string";
  };
  "app-space.title.annotate-on": Record<never, never>;
  "app-space.title.annotations-sent": {
    count: "plural";
  };
  "app-space.title.coding-opened": {
    product: "string";
    ticket: "string";
  };
  "common.button.open-again": Record<never, never>;
  "common.button.report-problem": Record<never, never>;
  "common.label.app-mode-live": Record<never, never>;
  "common.label.app-mode-preview": Record<never, never>;
  "common.label.app-state-preparing": Record<never, never>;
  "common.label.app-state-running": Record<never, never>;
  "common.label.app-state-stopped": Record<never, never>;
  "common.label.app-state-unavailable": Record<never, never>;
  "common.label.app-view-crashed": Record<never, never>;
  "common.label.app-view-unresponsive": Record<never, never>;
  "report-problem.button.open": Record<never, never>;
  "report-problem.empty.no-problems": Record<never, never>;
  "report-problem.hint.text-only": Record<never, never>;
  "report-problem.label.option-existing": Record<never, never>;
  "report-problem.label.option-new": Record<never, never>;
  "report-problem.label.report-count": {
    count: "plural";
  };
  "report-problem.label.send-as": Record<never, never>;
  "report-problem.label.which-problem": Record<never, never>;
  "report-problem.notice.open-failed": Record<never, never>;
  "report-problem.placeholder.describe": Record<never, never>;
};

type Area = typeof appSpace;
type _SameKeys =
  | Exclude<keyof Area, keyof AppSpacePlaceholders>
  | Exclude<keyof AppSpacePlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
