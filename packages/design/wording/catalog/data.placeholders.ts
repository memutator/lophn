// catalog/data.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { data } from "./data.ts";

export type DataPlaceholders = {
  "confirmation-window.approval.no-external": Record<never, never>;
  "confirmation-window.approval.title": Record<never, never>;
  "confirmation-window.automation.effect": Record<never, never>;
  "confirmation-window.automation.effect-external": Record<never, never>;
  "confirmation-window.automation.not-ready": Record<never, never>;
  "confirmation-window.automation.now": Record<never, never>;
  "confirmation-window.automation.subject-minutes": {
    app: "string";
    command: "string";
    minutes: "plural";
  };
  "confirmation-window.automation.subject-seconds": {
    app: "string";
    command: "string";
    seconds: "number";
  };
  "confirmation-window.automation.subject-start": {
    app: "string";
    command: "string";
  };
  "confirmation-window.body.checking": Record<never, never>;
  "confirmation-window.body.expired": Record<never, never>;
  "confirmation-window.body.review": Record<never, never>;
  "confirmation-window.body.second": Record<never, never>;
  "confirmation-window.body.stale": Record<never, never>;
  "confirmation-window.body.unknown": Record<never, never>;
  "confirmation-window.button.allow-access": Record<never, never>;
  "confirmation-window.button.allow-once": Record<never, never>;
  "confirmation-window.button.allow-session": Record<never, never>;
  "confirmation-window.button.back": Record<never, never>;
  "confirmation-window.button.cancel": Record<never, never>;
  "confirmation-window.button.cancel-request": Record<never, never>;
  "confirmation-window.button.choose": Record<never, never>;
  "confirmation-window.button.close": Record<never, never>;
  "confirmation-window.button.connection-revoke": Record<never, never>;
  "confirmation-window.button.decide": Record<never, never>;
  "confirmation-window.button.delete-file": Record<never, never>;
  "confirmation-window.button.disconnect": Record<never, never>;
  "confirmation-window.button.problem-dismiss": Record<never, never>;
  "confirmation-window.button.problem-fixed": Record<never, never>;
  "confirmation-window.button.problem-not-fixed": Record<never, never>;
  "confirmation-window.button.problem-not-visible": Record<never, never>;
  "confirmation-window.button.refresh": Record<never, never>;
  "confirmation-window.button.reject": Record<never, never>;
  "confirmation-window.button.rewind": Record<never, never>;
  "confirmation-window.button.rewind-anyway": Record<never, never>;
  "confirmation-window.button.save": Record<never, never>;
  "confirmation-window.button.summarize": Record<never, never>;
  "confirmation-window.button.turn-on": Record<never, never>;
  "confirmation-window.button.use-version": Record<never, never>;
  "confirmation-window.change.missing": Record<never, never>;
  "confirmation-window.change.none": Record<never, never>;
  "confirmation-window.change.omitted": Record<never, never>;
  "confirmation-window.confirm.input-note": Record<never, never>;
  "confirmation-window.confirm.now": Record<never, never>;
  "confirmation-window.confirm.preview-none": Record<never, never>;
  "confirmation-window.confirm.subject": {
    caller: "string";
    app: "string";
    command: "string";
    name: "string";
  };
  "confirmation-window.connection.already-revoked": Record<never, never>;
  "confirmation-window.connection.effect-revoke": Record<never, never>;
  "confirmation-window.connection.note-revoke": Record<never, never>;
  "confirmation-window.error.save": Record<never, never>;
  "confirmation-window.error.send": Record<never, never>;
  "confirmation-window.error.too-long": Record<never, never>;
  "confirmation-window.error.unavailable": Record<never, never>;
  "confirmation-window.file-delete.effect": Record<never, never>;
  "confirmation-window.file-delete.subject": Record<never, never>;
  "confirmation-window.file-delete.title": Record<never, never>;
  "confirmation-window.grant-effect.agent-commands": Record<never, never>;
  "confirmation-window.grant-effect.app-call": Record<never, never>;
  "confirmation-window.grant-effect.document-save": Record<never, never>;
  "confirmation-window.grant-effect.fs-read": Record<never, never>;
  "confirmation-window.grant-effect.fs-write": Record<never, never>;
  "confirmation-window.grant-effect.net-fetch": Record<never, never>;
  "confirmation-window.grant-effect.net-listen": Record<never, never>;
  "confirmation-window.grant-effect.secret-use": Record<never, never>;
  "confirmation-window.grant-effect.unknown": Record<never, never>;
  "confirmation-window.grant.already": Record<never, never>;
  "confirmation-window.grant.limit-cpu": Record<never, never>;
  "confirmation-window.grant.limit-disk": Record<never, never>;
  "confirmation-window.grant.limit-not-isolated": Record<never, never>;
  "confirmation-window.grant.limit-path-secrets": Record<never, never>;
  "confirmation-window.grant.limit-rss": Record<never, never>;
  "confirmation-window.grant.limit-symlink": Record<never, never>;
  "confirmation-window.grant.limit-unknown": Record<never, never>;
  "confirmation-window.grant.subject": {
    app: "string";
  };
  "confirmation-window.grant.warning-file-read-network": Record<never, never>;
  "confirmation-window.grant.warning-outside-link": Record<never, never>;
  "confirmation-window.grant.warning-unknown": Record<never, never>;
  "confirmation-window.heading.access": Record<never, never>;
  "confirmation-window.heading.automations": Record<never, never>;
  "confirmation-window.heading.commands": Record<never, never>;
  "confirmation-window.heading.data": Record<never, never>;
  "confirmation-window.heading.effect": Record<never, never>;
  "confirmation-window.heading.preview": Record<never, never>;
  "confirmation-window.heading.problems": Record<never, never>;
  "confirmation-window.heading.revert": Record<never, never>;
  "confirmation-window.heading.screens": Record<never, never>;
  "confirmation-window.heading.subject": Record<never, never>;
  "confirmation-window.input.blob": Record<never, never>;
  "confirmation-window.label.action": Record<never, never>;
  "confirmation-window.label.added": Record<never, never>;
  "confirmation-window.label.app": Record<never, never>;
  "confirmation-window.label.automation": Record<never, never>;
  "confirmation-window.label.change-confirm": Record<never, never>;
  "confirmation-window.label.change-effect": Record<never, never>;
  "confirmation-window.label.change-input": Record<never, never>;
  "confirmation-window.label.change-revert": Record<never, never>;
  "confirmation-window.label.changed": Record<never, never>;
  "confirmation-window.label.close-reason": Record<never, never>;
  "confirmation-window.label.command": Record<never, never>;
  "confirmation-window.label.commands": Record<never, never>;
  "confirmation-window.label.comparison": Record<never, never>;
  "confirmation-window.label.connection-all": Record<never, never>;
  "confirmation-window.label.connection-app": {
    name: "string";
  };
  "confirmation-window.label.connection-scope": Record<never, never>;
  "confirmation-window.label.current": Record<never, never>;
  "confirmation-window.label.data-version": Record<never, never>;
  "confirmation-window.label.details": Record<never, never>;
  "confirmation-window.label.document-key": Record<never, never>;
  "confirmation-window.label.effect-external": Record<never, never>;
  "confirmation-window.label.effect-read": Record<never, never>;
  "confirmation-window.label.effect-write": Record<never, never>;
  "confirmation-window.label.exact-request": Record<never, never>;
  "confirmation-window.label.expires": Record<never, never>;
  "confirmation-window.label.full": Record<never, never>;
  "confirmation-window.label.host": Record<never, never>;
  "confirmation-window.label.input": Record<never, never>;
  "confirmation-window.label.input-fingerprint": Record<never, never>;
  "confirmation-window.label.input-shape": Record<never, never>;
  "confirmation-window.label.limits": Record<never, never>;
  "confirmation-window.label.name-only": Record<never, never>;
  "confirmation-window.label.new-inputs": Record<never, never>;
  "confirmation-window.label.next": Record<never, never>;
  "confirmation-window.label.no": Record<never, never>;
  "confirmation-window.label.owner": Record<never, never>;
  "confirmation-window.label.path": Record<never, never>;
  "confirmation-window.label.port": Record<never, never>;
  "confirmation-window.label.problem-reason": Record<never, never>;
  "confirmation-window.label.problem-seen": Record<never, never>;
  "confirmation-window.label.problem-version": Record<never, never>;
  "confirmation-window.label.question": Record<never, never>;
  "confirmation-window.label.reaches-outside": Record<never, never>;
  "confirmation-window.label.reason": Record<never, never>;
  "confirmation-window.label.recommended": Record<never, never>;
  "confirmation-window.label.removed": Record<never, never>;
  "confirmation-window.label.requested-by": Record<never, never>;
  "confirmation-window.label.schedule": Record<never, never>;
  "confirmation-window.label.secret-code": Record<never, never>;
  "confirmation-window.label.secret-key": Record<never, never>;
  "confirmation-window.label.secret-name": Record<never, never>;
  "confirmation-window.label.secret-value": Record<never, never>;
  "confirmation-window.label.subfolders": Record<never, never>;
  "confirmation-window.label.target-app": Record<never, never>;
  "confirmation-window.label.targets": Record<never, never>;
  "confirmation-window.label.yes": Record<never, never>;
  "confirmation-window.option-action.effect": Record<never, never>;
  "confirmation-window.option-action.title": {
    option: "string";
  };
  "confirmation-window.problem.effect-dismiss": Record<never, never>;
  "confirmation-window.problem.effect-fixed": Record<never, never>;
  "confirmation-window.problem.effect-not-fixed": Record<never, never>;
  "confirmation-window.problem.effect-not-visible": Record<never, never>;
  "confirmation-window.problem.note-dismiss": Record<never, never>;
  "confirmation-window.problem.note-fixed": Record<never, never>;
  "confirmation-window.problem.note-not-fixed": Record<never, never>;
  "confirmation-window.problem.note-not-visible": Record<never, never>;
  "confirmation-window.release.effect": Record<never, never>;
  "confirmation-window.release.effect-data": Record<never, never>;
  "confirmation-window.release.first": Record<never, never>;
  "confirmation-window.release.none": Record<never, never>;
  "confirmation-window.release.preview-none": Record<never, never>;
  "confirmation-window.release.preview-ready": Record<never, never>;
  "confirmation-window.release.review": Record<never, never>;
  "confirmation-window.release.subject": {
    app: "string";
    number: "number";
  };
  "confirmation-window.result.allowed": Record<never, never>;
  "confirmation-window.result.answered": Record<never, never>;
  "confirmation-window.result.cancelled": Record<never, never>;
  "confirmation-window.result.connection-revoked": Record<never, never>;
  "confirmation-window.result.decision-received": Record<never, never>;
  "confirmation-window.result.decision-saved": Record<never, never>;
  "confirmation-window.result.rejected": Record<never, never>;
  "confirmation-window.result.removed": {
    name: "string";
  };
  "confirmation-window.result.rewind-blocked": Record<never, never>;
  "confirmation-window.result.rewind-partly": Record<never, never>;
  "confirmation-window.result.rewind-started": Record<never, never>;
  "confirmation-window.result.rewind-unknown": Record<never, never>;
  "confirmation-window.result.rewound": Record<never, never>;
  "confirmation-window.result.saved": {
    name: "string";
  };
  "confirmation-window.revert.impossible": Record<never, never>;
  "confirmation-window.revert.possible": Record<never, never>;
  "confirmation-window.revert.unknown": Record<never, never>;
  "confirmation-window.revoke.effect": Record<never, never>;
  "confirmation-window.revoke.subject": {
    app: "string";
  };
  "confirmation-window.rewind.second-body": Record<never, never>;
  "confirmation-window.rewind.subject-messages-only": Record<never, never>;
  "confirmation-window.rewind.subject-restore-all": Record<never, never>;
  "confirmation-window.rewind.subject-summarize": Record<never, never>;
  "confirmation-window.secret-app.title": {
    name: "string";
  };
  "confirmation-window.secret-code.title": Record<never, never>;
  "confirmation-window.secret-disconnect.effect": Record<never, never>;
  "confirmation-window.secret-disconnect.revert": Record<never, never>;
  "confirmation-window.secret-disconnect.subject": Record<never, never>;
  "confirmation-window.secret-disconnect.title": {
    name: "string";
  };
  "confirmation-window.secret-key.title": {
    name: "string";
  };
  "confirmation-window.secret.configured": {
    name: "string";
  };
  "confirmation-window.secret.effect": Record<never, never>;
  "confirmation-window.secret.revert": Record<never, never>;
  "confirmation-window.secret.subject": Record<never, never>;
  "confirmation-window.title.automation": {
    automation: "string";
    app: "string";
  };
  "confirmation-window.title.confirm": Record<never, never>;
  "confirmation-window.title.confirm-command": {
    command: "string";
    app: "string";
  };
  "confirmation-window.title.connection-revoke": Record<never, never>;
  "confirmation-window.title.grant-agent-commands": {
    app: "string";
  };
  "confirmation-window.title.grant-app-call": {
    app: "string";
  };
  "confirmation-window.title.grant-document-save": {
    app: "string";
  };
  "confirmation-window.title.grant-fs-read": {
    app: "string";
  };
  "confirmation-window.title.grant-fs-write": {
    app: "string";
  };
  "confirmation-window.title.grant-net-fetch": {
    app: "string";
  };
  "confirmation-window.title.grant-net-listen": {
    app: "string";
  };
  "confirmation-window.title.grant-secret-use": {
    app: "string";
  };
  "confirmation-window.title.problem-dismiss": Record<never, never>;
  "confirmation-window.title.problem-fixed": Record<never, never>;
  "confirmation-window.title.problem-not-fixed": Record<never, never>;
  "confirmation-window.title.problem-not-visible": Record<never, never>;
  "confirmation-window.title.release": {
    number: "number";
    app: "string";
  };
  "confirmation-window.title.revoke-access": {
    app: "string";
  };
  "confirmation-window.title.rewind-messages-only": Record<never, never>;
  "confirmation-window.title.rewind-restore-all": Record<never, never>;
  "confirmation-window.title.rewind-second": Record<never, never>;
  "confirmation-window.title.rewind-summarize": Record<never, never>;
  "launcher.connection.confirmed-at": {
    when: "string";
  };
  "launcher.connection.disconnected": Record<never, never>;
  "launcher.connection.failed": Record<never, never>;
  "launcher.connection.starting": Record<never, never>;
  "report-problem.button.copy-text": Record<never, never>;
  "report-problem.button.send": Record<never, never>;
  "report-problem.button.view-issue": Record<never, never>;
  "report-problem.error.rejected": Record<never, never>;
  "report-problem.error.too-long": Record<never, never>;
  "report-problem.error.unreachable": Record<never, never>;
  "report-problem.heading.sent-with": Record<never, never>;
  "report-problem.hint.draft-memory": Record<never, never>;
  "report-problem.label.screen-details": Record<never, never>;
  "report-problem.label.screenshot": Record<never, never>;
  "report-problem.label.what-happened": Record<never, never>;
  "report-problem.notice.capturing": Record<never, never>;
  "report-problem.notice.copy-text": Record<never, never>;
  "report-problem.notice.existing-issue": Record<never, never>;
  "report-problem.notice.new-issue": Record<never, never>;
  "report-problem.notice.screen-not-sent": Record<never, never>;
  "report-problem.notice.screenshot-failed": Record<never, never>;
  "report-problem.notice.screenshot-hidden": Record<never, never>;
  "report-problem.notice.screenshot-not-selected": Record<never, never>;
  "report-problem.notice.screenshot-protected": Record<never, never>;
  "report-problem.status.received": Record<never, never>;
  "report-problem.status.sending": Record<never, never>;
  "report-problem.title.report": Record<never, never>;
  "waiting.button.allow": Record<never, never>;
  "waiting.button.allow-always": Record<never, never>;
  "waiting.button.allow-once": Record<never, never>;
  "waiting.button.allow-session": Record<never, never>;
  "waiting.button.answer-in-terminal": Record<never, never>;
  "waiting.button.cancel": Record<never, never>;
  "waiting.button.deny": Record<never, never>;
  "waiting.button.open-session": Record<never, never>;
  "waiting.label.activation-first": Record<never, never>;
  "waiting.label.activation-new": Record<never, never>;
  "waiting.label.agent-app-engineer": Record<never, never>;
  "waiting.label.agent-coding": Record<never, never>;
  "waiting.label.agent-lophn": Record<never, never>;
  "waiting.label.agent-operator": Record<never, never>;
  "waiting.label.agent-project-manager": Record<never, never>;
  "waiting.label.agent-reaction": Record<never, never>;
  "waiting.label.declared-app-api": Record<never, never>;
  "waiting.label.declared-file-read": Record<never, never>;
  "waiting.label.declared-file-write": Record<never, never>;
  "waiting.label.declared-listen": Record<never, never>;
  "waiting.label.declared-network": Record<never, never>;
  "waiting.label.declared-other": Record<never, never>;
  "waiting.label.declared-secret": Record<never, never>;
  "waiting.label.effect-external": Record<never, never>;
  "waiting.label.effect-read": Record<never, never>;
  "waiting.label.effect-write": Record<never, never>;
  "waiting.label.event-activation-failed": Record<never, never>;
  "waiting.label.event-app-restart-halted": Record<never, never>;
  "waiting.label.event-context-violation": Record<never, never>;
  "waiting.label.event-problem-opened": Record<never, never>;
  "waiting.label.event-problem-reopened": Record<never, never>;
  "waiting.label.fact-detail": Record<never, never>;
  "waiting.label.fact-effect": Record<never, never>;
  "waiting.label.fact-event": Record<never, never>;
  "waiting.label.fact-input": Record<never, never>;
  "waiting.label.fact-opens": Record<never, never>;
  "waiting.label.fact-target": Record<never, never>;
  "waiting.label.group-approval": Record<never, never>;
  "waiting.label.group-permission": Record<never, never>;
  "waiting.label.group-question": Record<never, never>;
  "waiting.label.hide-details": Record<never, never>;
  "waiting.label.loss-drop-column": Record<never, never>;
  "waiting.label.loss-drop-table": Record<never, never>;
  "waiting.label.loss-heading": Record<never, never>;
  "waiting.label.loss-narrow-type": Record<never, never>;
  "waiting.label.panel": Record<never, never>;
  "waiting.label.panel-scope": Record<never, never>;
  "waiting.label.pill": {
    count: "number";
  };
  "waiting.label.place-app": {
    id: "string";
  };
  "waiting.label.place-project": {
    id: "string";
  };
  "waiting.label.reason": Record<never, never>;
  "waiting.label.session": {
    id: "string";
  };
  "waiting.label.settings-agent-definition": Record<never, never>;
  "waiting.label.settings-grant": Record<never, never>;
  "waiting.label.settings-instructions": Record<never, never>;
  "waiting.label.settings-setting": Record<never, never>;
  "waiting.label.settings-skill": Record<never, never>;
  "waiting.label.settled": Record<never, never>;
  "waiting.label.settled-accepted": Record<never, never>;
  "waiting.label.settled-applied": Record<never, never>;
  "waiting.label.settled-cancelled": Record<never, never>;
  "waiting.label.settled-denied": Record<never, never>;
  "waiting.label.settled-failed": Record<never, never>;
  "waiting.label.show-details": Record<never, never>;
  "waiting.label.target-app-api": {
    app: "string";
    api: "string";
  };
  "waiting.label.target-mcp-tool": {
    server: "string";
    tool: "string";
  };
  "waiting.notice.activation-fine": Record<never, never>;
  "waiting.notice.activation-first": {
    declared: "plural";
    lost: "plural";
  };
  "waiting.notice.activation-since": {
    declared: "plural";
    lost: "plural";
  };
  "waiting.notice.agent-call": {
    agent: "string";
  };
  "waiting.notice.app-api-external": {
    target: "string";
  };
  "waiting.notice.app-api-read": {
    target: "string";
  };
  "waiting.notice.app-api-write": {
    target: "string";
  };
  "waiting.notice.app-resource": {
    target: "string";
  };
  "waiting.notice.coding": Record<never, never>;
  "waiting.notice.decide-failed": Record<never, never>;
  "waiting.notice.empty": Record<never, never>;
  "waiting.notice.mcp-tool": {
    target: "string";
  };
  "waiting.notice.question-in-session": Record<never, never>;
  "waiting.notice.question-loading": Record<never, never>;
  "waiting.notice.question-multiple": {
    count: "plural";
  };
  "waiting.notice.reason-help": {
    agent: "string";
  };
  "waiting.notice.settings-edit": {
    what: "string";
  };
  "waiting.notice.settled-accepted": Record<never, never>;
  "waiting.notice.settled-applied": Record<never, never>;
  "waiting.notice.settled-cancelled": Record<never, never>;
  "waiting.notice.settled-denied": Record<never, never>;
  "waiting.notice.settled-denied-reason": {
    agent: "string";
  };
  "waiting.notice.settled-failed": Record<never, never>;
  "waiting.title.activation": {
    app: "string";
  };
  "waiting.title.agent-call": Record<never, never>;
  "waiting.title.app-api": {
    api: "string";
    app: "string";
  };
  "waiting.title.app-resource": Record<never, never>;
  "waiting.title.coding": Record<never, never>;
  "waiting.title.mcp-tool": {
    tool: "string";
  };
  "waiting.title.question": Record<never, never>;
  "waiting.title.reaction": {
    agent: "string";
  };
  "waiting.title.settings-edit": Record<never, never>;
};

type Area = typeof data;
type _SameKeys =
  | Exclude<keyof Area, keyof DataPlaceholders>
  | Exclude<keyof DataPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
