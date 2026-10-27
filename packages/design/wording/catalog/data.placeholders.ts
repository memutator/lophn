// catalog/data.ts에서 생성한다. 직접 고치지 않고 `npm run wording`로 다시 만든다.
import type { data } from "./data.ts";

export type DataPlaceholders = {
  "launcher.connection.confirmed-at": {
    when: "string";
  };
  "launcher.connection.disconnected": Record<never, never>;
  "launcher.connection.failed": Record<never, never>;
  "launcher.connection.starting": Record<never, never>;
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
  "waiting.button.answer-in-terminal": Record<never, never>;
  "waiting.button.cancel": Record<never, never>;
  "waiting.button.deny": Record<never, never>;
  "waiting.button.open-session": Record<never, never>;
  "waiting.button.show-finished": Record<never, never>;
  "waiting.button.skip": Record<never, never>;
  "waiting.button.start-now": Record<never, never>;
  "waiting.label.activation-first": Record<never, never>;
  "waiting.label.activation-new": Record<never, never>;
  "waiting.label.agent-app-engineer": Record<never, never>;
  "waiting.label.agent-coding": Record<never, never>;
  "waiting.label.agent-lophn": Record<never, never>;
  "waiting.label.agent-operator": Record<never, never>;
  "waiting.label.agent-project-manager": Record<never, never>;
  "waiting.label.declared-tool": Record<never, never>;
  "waiting.label.declared-file-read": Record<never, never>;
  "waiting.label.declared-file-write": Record<never, never>;
  "waiting.label.declared-listen": Record<never, never>;
  "waiting.label.declared-network": Record<never, never>;
  "waiting.label.declared-other": Record<never, never>;
  "waiting.label.declared-secret": Record<never, never>;
  "waiting.label.effect-external": Record<never, never>;
  "waiting.label.effect-read": Record<never, never>;
  "waiting.label.effect-write": Record<never, never>;
  "waiting.label.fact-effect": Record<never, never>;
  "waiting.label.fact-always": Record<never, never>;
  "waiting.label.fact-command": Record<never, never>;
  "waiting.label.fact-target": Record<never, never>;
  "waiting.label.group-activation": Record<never, never>;
  "waiting.label.group-finished": Record<never, never>;
  "waiting.label.group-permission": Record<never, never>;
  "waiting.label.group-question": Record<never, never>;
  "waiting.label.group-job": Record<never, never>;
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
  "waiting.label.settled": Record<never, never>;
  "waiting.label.settled-cancelled": Record<never, never>;
  "waiting.label.settled-allowed": Record<never, never>;
  "waiting.label.settled-denied": Record<never, never>;
  "waiting.label.show-details": Record<never, never>;
  "waiting.label.target-tool": {
    app: "string";
    tool: "string";
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
  "waiting.notice.tool-external": {
    target: "string";
  };
  "waiting.notice.tool-read": {
    target: "string";
  };
  "waiting.notice.tool-write": {
    target: "string";
  };
  "waiting.notice.coding": Record<never, never>;
  "waiting.notice.coding-start": Record<never, never>;
  "waiting.notice.decide-failed": Record<never, never>;
  "waiting.notice.empty": Record<never, never>;
  "waiting.notice.job-agent": {
    agent: "string";
  };
  "waiting.notice.job-conflict": Record<never, never>;
  "waiting.notice.job-missed": {
    count: "plural";
    due: "string";
  };
  "waiting.notice.job-tool": {
    tool: "string";
    app: "string";
  };
  "waiting.notice.job-workflow": {
    workflow: "string";
  };
  "waiting.notice.mcp-tool": {
    target: "string";
  };
  "waiting.notice.shell": Record<never, never>;
  "waiting.notice.question-in-session": Record<never, never>;
  "waiting.notice.question-loading": Record<never, never>;
  "waiting.notice.question-multiple": {
    count: "plural";
  };
  "waiting.notice.reason-help": {
    agent: "string";
  };
  "waiting.notice.settled-cancelled": Record<never, never>;
  "waiting.notice.settled-allowed": Record<never, never>;
  "waiting.notice.settled-denied": Record<never, never>;
  "waiting.notice.settled-denied-reason": {
    agent: "string";
  };
  "waiting.toast-activation.body": Record<never, never>;
  "waiting.toast-activation.button": Record<never, never>;
  "waiting.toast-activation.title": {
    app: "string";
  };
  "waiting.toast-kind-violation.body": {
    count: "plural";
  };
  "waiting.toast-kind-violation.title": Record<never, never>;
  "waiting.toast-restart-halted.button": Record<never, never>;
  "waiting.toast-restart-halted.body": {
    app: "string";
  };
  "waiting.toast-restart-halted.title": Record<never, never>;
  "waiting.title.activation": {
    app: "string";
  };
  "waiting.title.tool": {
    tool: "string";
    app: "string";
  };
  "waiting.title.coding": Record<never, never>;
  "waiting.title.coding-start": Record<never, never>;
  "waiting.title.mcp-tool": {
    tool: "string";
  };
  "waiting.title.question": Record<never, never>;
  "waiting.title.shell": Record<never, never>;
};

type Area = typeof data;
type _SameKeys =
  | Exclude<keyof Area, keyof DataPlaceholders>
  | Exclude<keyof DataPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
