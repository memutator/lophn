// catalog/app-space.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { appSpace } from "./app-space.ts";

export type AppSpacePlaceholders = {
  "app-detail.button.all-issues": Record<never, never>;
  "app-detail.button.back-to-activity": Record<never, never>;
  "app-detail.button.cancel": Record<never, never>;
  "app-detail.button.go-back": {
    release: "string";
  };
  "app-detail.button.issue-ignored": Record<never, never>;
  "app-detail.button.issue-reopen": Record<never, never>;
  "app-detail.button.issue-resolved": Record<never, never>;
  "app-detail.button.revoke": Record<never, never>;
  "app-detail.button.rewind-app": {
    name: "string";
  };
  "app-detail.button.rewind-from-here": Record<never, never>;
  "app-detail.error.go-back-failed": {
    release: "string";
  };
  "app-detail.error.issue-state-failed": Record<never, never>;
  "app-detail.error.revoke-failed": Record<never, never>;
  "app-detail.error.rewind-failed": Record<never, never>;
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
  "app-detail.heading.earlier-releases": Record<never, never>;
  "app-detail.heading.evidence": Record<never, never>;
  "app-detail.heading.last-activation": Record<never, never>;
  "app-detail.heading.occurrences": Record<never, never>;
  "app-detail.heading.other-apps": Record<never, never>;
  "app-detail.heading.outside-resources": Record<never, never>;
  "app-detail.heading.progress": Record<never, never>;
  "app-detail.heading.rewind-before": {
    name: "string";
    time: "string";
  };
  "app-detail.heading.rewind-cancelled": Record<never, never>;
  "app-detail.heading.rewinds-together": Record<never, never>;
  "app-detail.heading.rewound": Record<never, never>;
  "app-detail.heading.what-was-rewound": Record<never, never>;
  "app-detail.label.access-target": Record<never, never>;
  "app-detail.label.activity-target": Record<never, never>;
  "app-detail.label.all-statuses": Record<never, never>;
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
  "app-detail.label.cancelled": Record<never, never>;
  "app-detail.label.changes-app-api": Record<never, never>;
  "app-detail.label.changes-loss": Record<never, never>;
  "app-detail.label.changes-resource": Record<never, never>;
  "app-detail.label.changes-wider": Record<never, never>;
  "app-detail.label.cleaning-up": Record<never, never>;
  "app-detail.label.col-call": Record<never, never>;
  "app-detail.label.col-caller": Record<never, never>;
  "app-detail.label.col-effect": Record<never, never>;
  "app-detail.label.col-result": Record<never, never>;
  "app-detail.label.col-time": Record<never, never>;
  "app-detail.label.commit": {
    commit: "string";
  };
  "app-detail.label.data-schema": {
    schema: "string";
  };
  "app-detail.label.done": Record<never, never>;
  "app-detail.label.everyone-together": Record<never, never>;
  "app-detail.label.evidence-error": Record<never, never>;
  "app-detail.label.evidence-log": Record<never, never>;
  "app-detail.label.evidence-reports": Record<never, never>;
  "app-detail.label.fact-applied": Record<never, never>;
  "app-detail.label.fact-called-by": Record<never, never>;
  "app-detail.label.fact-commit": Record<never, never>;
  "app-detail.label.fact-first": Record<never, never>;
  "app-detail.label.fact-input-fingerprint": Record<never, never>;
  "app-detail.label.fact-last": Record<never, never>;
  "app-detail.label.fact-reason": Record<never, never>;
  "app-detail.label.fact-release": Record<never, never>;
  "app-detail.label.fact-reports": Record<never, never>;
  "app-detail.label.fact-result": Record<never, never>;
  "app-detail.label.fact-schema": Record<never, never>;
  "app-detail.label.fact-tried": Record<never, never>;
  "app-detail.label.fact-undo": Record<never, never>;
  "app-detail.label.failed-still-active": {
    release: "string";
  };
  "app-detail.label.filter-period": Record<never, never>;
  "app-detail.label.filter-status": Record<never, never>;
  "app-detail.label.from-release": {
    release: "string";
  };
  "app-detail.label.in-progress": Record<never, never>;
  "app-detail.label.input-none": Record<never, never>;
  "app-detail.label.issue-last": {
    when: "string";
  };
  "app-detail.label.issue-reports": {
    count: "plural";
  };
  "app-detail.label.issue-status-ignored": Record<never, never>;
  "app-detail.label.issue-status-open": Record<never, never>;
  "app-detail.label.issue-status-resolved": Record<never, never>;
  "app-detail.label.issues-target": Record<never, never>;
  "app-detail.label.loss-drop-column": Record<never, never>;
  "app-detail.label.loss-drop-table": Record<never, never>;
  "app-detail.label.loss-narrow-type": Record<never, never>;
  "app-detail.label.nothing-changed": Record<never, never>;
  "app-detail.label.occurrence-app-error": Record<never, never>;
  "app-detail.label.occurrence-report": Record<never, never>;
  "app-detail.label.outcome-cannot": Record<never, never>;
  "app-detail.label.outcome-done": Record<never, never>;
  "app-detail.label.outcome-not-changed": Record<never, never>;
  "app-detail.label.outcome-stays": Record<never, never>;
  "app-detail.label.outcome-undone": Record<never, never>;
  "app-detail.label.period-all": Record<never, never>;
  "app-detail.label.period-day": Record<never, never>;
  "app-detail.label.period-month": Record<never, never>;
  "app-detail.label.period-week": Record<never, never>;
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
  "app-detail.label.session-unnamed": Record<never, never>;
  "app-detail.label.state-done": Record<never, never>;
  "app-detail.label.state-failed": Record<never, never>;
  "app-detail.label.state-running": Record<never, never>;
  "app-detail.label.state-undone": Record<never, never>;
  "app-detail.label.state-unknown": Record<never, never>;
  "app-detail.label.state-waiting": Record<never, never>;
  "app-detail.label.status-applied": Record<never, never>;
  "app-detail.label.status-applying": Record<never, never>;
  "app-detail.label.status-failed": Record<never, never>;
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
  "app-detail.label.tab-issues": Record<never, never>;
  "app-detail.label.tab-version": Record<never, never>;
  "app-detail.label.time-unknown": Record<never, never>;
  "app-detail.label.tool-call": Record<never, never>;
  "app-detail.label.turn": Record<never, never>;
  "app-detail.label.undo-none": Record<never, never>;
  "app-detail.label.version-target": Record<never, never>;
  "app-detail.label.went-back": {
    release: "string";
  };
  "app-detail.note.access-intro": Record<never, never>;
  "app-detail.note.activity-scope": Record<never, never>;
  "app-detail.note.applying-first": Record<never, never>;
  "app-detail.note.applying-keeps": {
    previous: "string";
    next: "string";
  };
  "app-detail.note.applying-waiting-approval": Record<never, never>;
  "app-detail.note.calls-held": {
    name: "string";
  };
  "app-detail.note.came-back": {
    resolved: "string";
    release: "string";
  };
  "app-detail.note.changes-none": Record<never, never>;
  "app-detail.note.conflict": {
    reason: "string";
  };
  "app-detail.note.conflict-unknown": Record<never, never>;
  "app-detail.note.failed-called": Record<never, never>;
  "app-detail.note.failed-unchanged": Record<never, never>;
  "app-detail.note.go-back-busy": Record<never, never>;
  "app-detail.note.go-back-schema": {
    schema: "string";
    current: "string";
  };
  "app-detail.note.go-back-scope": Record<never, never>;
  "app-detail.note.input-fingerprint": Record<never, never>;
  "app-detail.note.issues-unavailable": Record<never, never>;
  "app-detail.note.may-call": Record<never, never>;
  "app-detail.note.no-activity": Record<never, never>;
  "app-detail.note.no-issues": Record<never, never>;
  "app-detail.note.no-log": Record<never, never>;
  "app-detail.note.no-other-apps": Record<never, never>;
  "app-detail.note.no-reports": Record<never, never>;
  "app-detail.note.no-resources": Record<never, never>;
  "app-detail.note.no-stack": Record<never, never>;
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
  "app-detail.note.undo-recorded": Record<never, never>;
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
  "app-space.empty.no-version": Record<never, never>;
  "app-space.empty.not-found": Record<never, never>;
  "app-space.empty.screen-not-ready": Record<never, never>;
  "app-space.error.annotations-archived": Record<never, never>;
  "app-space.error.annotations-failed": Record<never, never>;
  "app-space.heading.agents": Record<never, never>;
  "app-space.heading.annotations": {
    count: "number";
  };
  "app-space.heading.app-details": Record<never, never>;
  "app-space.label.agent-select": Record<never, never>;
  "app-space.label.annotations": Record<never, never>;
  "app-space.label.remove-annotation": {
    number: "string";
  };
  "app-space.label.sending-annotations": Record<never, never>;
  "app-space.label.this-app": Record<never, never>;
  "app-space.text.annotate-on": Record<never, never>;
  "app-space.text.annotations-note": Record<never, never>;
  "app-space.text.annotations-sent": Record<never, never>;
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
