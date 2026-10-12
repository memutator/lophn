// Agent view core source가 core 응답에서 읽는 field. lophn-agent contract의 record(assignment, session,
// message, run, question group, approval, tool call)에서 이 화면이 쓰는 칸만 옮겼다.
export type Role = "lophn" | "app_engineer" | "context_engineer" | "operator";

export interface AssignmentValue {
  id: string;
  role: Role;
  state: "enabled" | "paused" | "withdrawn";
  revision: number;
}

export interface SessionValue {
  id: string;
  assignment: string;
  work_place: { kind: "project" | "app"; id: string };
  title: string | null;
  archived: boolean;
  state: "open" | "closed";
  model_selection: ModelChoiceValue | null;
  state_seq: string;
}

export interface ModelChoiceValue {
  provider: string;
  model_name: string;
  option_values: Record<string, string>;
}

export interface MessageLinkValue {
  kind: string;
  document?: string;
  version?: string;
  context?: string;
}

export interface MessageSnapshot {
  message: {
    id: string;
    actor: string;
    run: string | null;
    mode: "request" | "correction" | null;
    applied_at_call: string | null;
    links: MessageLinkValue[];
    copied_from: string | null;
  };
  created_seq: string;
}

export interface RunValue {
  id: string;
  session: string | null;
  state: "accepted" | "running" | "waiting_user" | "finished";
  waiting_on: string | null;
  started_at: string | null;
  elapsed: { active_ms: number };
  finished_at: string | null;
  outcome: { kind: "completed" | "failed" | "stopped" } | null;
  state_seq: string;
  accepted_seq: string;
}

export interface QuestionValue {
  id: string;
  options: {
    key: string;
    label: string;
    action: { command: string } | null;
  }[];
  recommendation: { option_key: string | null } | null;
  answer:
    | { kind: "option"; option_key: string }
    | { kind: "text" }
    | null;
  applied: boolean;
}

export interface GroupValue {
  id: string;
  expires_at: string | null;
  status: "pending" | "answered" | "expired" | "cancelled";
  closed_reason: "deferred" | "cancelled" | "superseded" | "expired" | null;
  created_seq: string;
  closed_seq: string | null;
  questions: QuestionValue[];
}

export interface GroupTextValue {
  questions: {
    question: string;
    prompt: string;
    reason: string;
    options: { key: string; description: string }[];
    recommendation: { explanation: string } | null;
    answer_text: string | null;
  }[];
}

export interface ToolCallValue {
  id: string;
  tool: string;
  retry_of: string | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: { kind: string } | null;
}

/** `rewind/preview`의 항목. 이 화면은 receipt 원문이 든 `app_revert`를 읽지 않는다. */
export interface PreviewItemValue {
  class: "file" | "app" | "fact";
  target: string;
  plan: "restore" | "skip" | "remain";
  reason: string | null;
}

export interface PreviewValue {
  restore: PreviewItemValue[];
  skip: PreviewItemValue[];
  remain: PreviewItemValue[];
  redo: boolean;
  preview_hash: string;
}

export interface CheckpointValue {
  message: string;
  files_restorable: boolean;
  files_reason: string | null;
  created_seq: string;
  hidden: boolean;
}

export interface RevertItemValue extends PreviewItemValue {
  result: string;
}

/** `rewind/list`의 rewind·Undo 한 번. */
export interface RevertValue {
  id: string;
  kind: "rewind" | "undo";
  choice: "restore_all" | "messages_only" | "summarize" | null;
  checkpoint: string | null;
  tool_call: string | null;
  boundary_seq: string | null;
  outcome: "applying" | "applied" | "partial" | "uncertain" | "blocked";
  redo: "none" | "available" | "done" | "closed";
  items: RevertItemValue[];
  result_seq: string | null;
}
