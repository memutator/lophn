// catalog/workflow.ts에서 생성한다. 직접 고치지 않고 `npm run wording`로 다시 만든다.
import type { workflow } from "./workflow.ts";

export type WorkflowPlaceholders = {
  "workflow.button.open-artifact": Record<never, never>;
  "workflow.button.open-conversation": Record<never, never>;
  "workflow.button.open-instance-artifact": Record<never, never>;
  "workflow.button.refresh": Record<never, never>;
  "workflow.button.start": Record<never, never>;
  "workflow.button.stop": Record<never, never>;
  "workflow.empty.instances": Record<never, never>;
  "workflow.empty.not-found": Record<never, never>;
  "workflow.empty.sidebar": Record<never, never>;
  "workflow.error.instances-failed": Record<never, never>;
  "workflow.error.load-failed": Record<never, never>;
  "workflow.error.start-failed": Record<never, never>;
  "workflow.error.stop-failed": Record<never, never>;
  "workflow.heading.instances": Record<never, never>;
  "workflow.heading.list": Record<never, never>;
  "workflow.heading.start": {
    workflow: "string";
  };
  "workflow.label.assignee-with": {
    by: "string";
    with: "string";
  };
  "workflow.label.at-step": {
    step: "string";
  };
  "workflow.label.finished-at": {
    when: "string";
  };
  "workflow.label.first-step": Record<never, never>;
  "workflow.label.input": Record<never, never>;
  "workflow.label.instance": Record<never, never>;
  "workflow.label.invalid": Record<never, never>;
  "workflow.label.job-meta": {
    title: "string";
  };
  "workflow.label.job-meta-untitled": Record<never, never>;
  "workflow.label.kind": Record<never, never>;
  "workflow.label.line-edit-add-step": {
    step: "string";
  };
  "workflow.label.line-edit-end": Record<never, never>;
  "workflow.label.line-edit-hand-now": {
    step: "string";
  };
  "workflow.label.line-edit-remove-step": {
    step: "string";
  };
  "workflow.label.line-edit-update-step": {
    step: "string";
  };
  "workflow.label.line-edited": Record<never, never>;
  "workflow.label.line-handed": {
    participant: "string";
    turn: "string";
    session: "string";
  };
  "workflow.label.line-started": {
    text: "string";
  };
  "workflow.label.lines": {
    count: "number";
  };
  "workflow.label.list-target": Record<never, never>;
  "workflow.label.note-line": {
    who: "string";
    text: "string";
  };
  "workflow.label.note-stopped": Record<never, never>;
  "workflow.label.notes": Record<never, never>;
  "workflow.label.report-by": {
    who: "string";
    when: "string";
  };
  "workflow.label.role-app-engineer": Record<never, never>;
  "workflow.label.role-harness": Record<never, never>;
  "workflow.label.role-human": Record<never, never>;
  "workflow.label.role-job": {
    title: "string";
  };
  "workflow.label.role-job-untitled": Record<never, never>;
  "workflow.label.role-lophn": Record<never, never>;
  "workflow.label.role-operator": Record<never, never>;
  "workflow.label.role-program": Record<never, never>;
  "workflow.label.role-project-manager": Record<never, never>;
  "workflow.label.role-unknown": Record<never, never>;
  "workflow.label.running-count": {
    count: "plural";
  };
  "workflow.label.sidebar-tab": Record<never, never>;
  "workflow.label.started-at": {
    when: "string";
  };
  "workflow.label.started-by-job": {
    title: "string";
  };
  "workflow.label.started-by-job-untitled": Record<never, never>;
  "workflow.label.state-ended": Record<never, never>;
  "workflow.label.state-human": Record<never, never>;
  "workflow.label.state-running": Record<never, never>;
  "workflow.label.state-stopped": Record<never, never>;
  "workflow.label.step-current": Record<never, never>;
  "workflow.label.step-reported": Record<never, never>;
  "workflow.label.step-stopped": Record<never, never>;
  "workflow.label.step-waiting": Record<never, never>;
  "workflow.label.steps": Record<never, never>;
  "workflow.label.sub-agent": {
    count: "number";
  };
  "workflow.label.sub-flow": {
    count: "number";
  };
  "workflow.label.sub-unreadable": Record<never, never>;
  "workflow.label.target": Record<never, never>;
  "workflow.note.input-help": Record<never, never>;
  "workflow.note.input-help-flow": Record<never, never>;
  "workflow.note.not-handed-harness": Record<never, never>;
  "workflow.note.not-handed-no-with": Record<never, never>;
  "workflow.note.not-handed-unknown-participant": Record<never, never>;
  "workflow.note.not-handed-unknown-step": Record<never, never>;
  "workflow.note.not-handed-unresolved": Record<never, never>;
  "workflow.note.program-exited": {
    code: "string";
  };
  "workflow.note.program-signal": Record<never, never>;
  "workflow.note.restarted": Record<never, never>;
  "workflow.note.restarted-flow": Record<never, never>;
  "workflow.note.your-turn": {
    step: "string";
    agent: "string";
  };
  "workflow.title.read-failed": {
    workflow: "string";
  };
  "workflow.title.start-failed": {
    workflow: "string";
  };
  "workflow.title.stop-failed": {
    workflow: "string";
  };
};

type Area = typeof workflow;
type _SameKeys =
  | Exclude<keyof Area, keyof WorkflowPlaceholders>
  | Exclude<keyof WorkflowPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
