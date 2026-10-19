// catalog/data.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { data } from "./data.ts";

export type DataPlaceholders = {
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
  "report-problem.label.what-happened": Record<never, never>;
  "report-problem.notice.copy-text": Record<never, never>;
  "report-problem.status.received": Record<never, never>;
  "report-problem.status.sending": Record<never, never>;
  "report-problem.title.report": Record<never, never>;
  "secret-input.button.cancel": Record<never, never>;
  "secret-input.button.save": Record<never, never>;
  "secret-input.error.invalid": Record<never, never>;
  "secret-input.error.unavailable": Record<never, never>;
  "secret-input.help.configured": Record<never, never>;
  "secret-input.help.value": Record<never, never>;
  "secret-input.label.field-app": Record<never, never>;
  "secret-input.label.field-mcp": Record<never, never>;
  "secret-input.label.field-provider": Record<never, never>;
  "secret-input.label.saved-as": {
    name: "string";
  };
  "secret-input.label.subject-app": {
    subject: "string";
  };
  "secret-input.label.subject-mcp": {
    subject: "string";
  };
  "secret-input.label.subject-provider": {
    subject: "string";
  };
  "secret-input.title.app": Record<never, never>;
  "secret-input.title.bar": Record<never, never>;
  "secret-input.title.mcp": Record<never, never>;
  "secret-input.title.provider": Record<never, never>;
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
  "waiting.label.agent-domain-owner": Record<never, never>;
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
  "waiting.label.event-kind-violation": Record<never, never>;
  "waiting.label.event-public-tools-changed": Record<never, never>;
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
  "waiting.label.trigger": {
    count: "plural";
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
  "waiting.notice.coding-start": Record<never, never>;
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
  "waiting.toast-approval.button": Record<never, never>;
  "waiting.toast-approval.body": Record<never, never>;
  "waiting.toast-approval.title": {
    intent: "string";
  };
  "waiting.toast-permission.button": Record<never, never>;
  "waiting.toast-permission.body": Record<never, never>;
  "waiting.toast-permission.title": {
    agent: "string";
  };
  "waiting.toast-question.button": Record<never, never>;
  "waiting.toast-question.body": Record<never, never>;
  "waiting.toast-kind-violation.button": Record<never, never>;
  "waiting.toast-kind-violation.body": {
    count: "plural";
  };
  "waiting.toast-kind-violation.title": Record<never, never>;
  "waiting.toast-question.title": {
    agent: "string";
  };
  "waiting.toast-restart-halted.button": Record<never, never>;
  "waiting.toast-restart-halted.body": {
    app: "string";
  };
  "waiting.toast-restart-halted.title": Record<never, never>;
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
  "waiting.title.coding-start": Record<never, never>;
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
