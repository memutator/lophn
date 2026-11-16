// protocol/acp의 AcpState·AcpUpdate·AcpInput을 zod 없이 옮긴 type이다. 설치 사본은 앱 bundle 안에서 저장소 없이
// 읽히고 앱에는 zod가 없어서, 사본이 vendor하는 reduce.ts의 type import가 여기로 닿는다(vendor.ts의 @lophn/agent 규칙).
// 정본과 같은지는 agent_test.ts가 type 수준에서 양쪽 대입으로 본다. 그러니 이 file은 mod.ts 밖 protocol을 import하지 않는다.

export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      blob: string;
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string | undefined;
      description?: string | undefined;
    }
  | {
      type: "resource";
      uri: string;
      mimeType?: string | undefined;
      text: string;
    };

type ToolEffect = "read" | "write" | "external";

type GateCall =
  | { kind: "app_tool"; app: string; tool: string; effect: ToolEffect }
  | { kind: "mcp_tool"; server: string; tool: string; effect: ToolEffect }
  | { kind: "shell"; command: string }
  | { kind: "setting"; key: string; lines: string[] };

type AcpApprovalSubject =
  | GateCall
  | {
      kind: "file_change";
      changes: {
        path: string;
        change: "create" | "update" | "delete";
        added: number | null;
        removed: number | null;
      }[];
    }
  | { kind: "plan"; plan: string; modes: { id: string; label: string }[] };

type InputDelivery = "next_turn" | "steer";

type RewindReason =
  | "edited_outside"
  | "chain_broken"
  | "no_pre_image"
  | "link_path"
  | "rename_blocked"
  | "created_edited"
  | "external_effect"
  | "already_reverted"
  | "answered_fact"
  | "later_edit";

export type AskQuestion = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};

export type AcpReasoning = { text: string; duration_ms: number | null };
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AcpCard = {
  app: string;
  view: string;
  /** 카드 화면에 넘긴 인자. 없으면 인자 없이 열린다. */
  params?: { [key: string]: JsonValue };
};

export type AcpMessageItem = {
  id: string;
  seq: number;
  at: string;
  kind: "message";
  actor: "user" | "agent" | "received";
  sender:
    | { kind: "agent"; agent: string | null; name: string | null }
    | { kind: "program" }
    | { kind: "app"; app: string | null; name: string }
    | null;
  /** 앱 화면이 보낸 사람 메시지의 표시(이름표일 뿐 보낸 쪽이 아니다. name은 보낼 때의 앱 slug). */
  via?: { app: string; name: string };
  call: string | null;
  reply_to: string | null;
  delivery: InputDelivery;
  turn: string | null;
  origin: string | null;
  content: ContentBlock[];
  reasoning: AcpReasoning | null;
  cards: AcpCard[];
  complete: boolean;
};

export type AcpToolDetail =
  | {
      kind: "edit";
      document: string;
      path: string;
      added: number;
      removed: number;
    }
  | {
      kind: "call";
      call: string | null;
      to: string;
      task: string;
      reply: "none" | "result" | "conversation";
      state: "accepted" | "done" | "failed" | "cancelled" | null;
      fail_reason:
        | "not_found"
        | "closed"
        | "receiver_ended"
        | "lophn_restarted"
        | null;
      session: string | null;
    }
  | {
      kind: "question";
      group: string | null;
      outcome:
        | "submitted"
        | "cancelled"
        | "human_message"
        | "parent_reply"
        | null;
      /** `parent_reply`일 때 부모가 `call reply`로 한 답 글. */
      reply?: string;
      lines: { header: string; answer: string | null }[];
    }
  | { kind: "consent"; release: string }
  | {
      kind: "subagent";
      agent: string;
      description: string;
      child: string | null;
      state: "running" | "done" | "failed" | "cancelled";
      model: string | null;
      last: string | null;
    }
  | { kind: "generic" };

export type AcpToolState = "running" | "ok" | "error" | "denied" | "cancelled";

export type AcpToolBody = {
  input: string | null;
  output: string | null;
  truncated: boolean;
};

export type AcpToolItem = {
  id: string;
  seq: number;
  at: string;
  kind: "tool";
  by: "agent" | "user";
  turn: string | null;
  tool: string;
  category: "read" | "list" | "search" | "command" | "web" | "other";
  title: string;
  state: AcpToolState;
  duration_ms: number | null;
  detail: AcpToolDetail;
  body: AcpToolBody | null;
};

export type AcpApprovalItem = {
  id: string;
  seq: number;
  at: string;
  kind: "approval";
  subject: AcpApprovalSubject;
  outcome: "allowed" | "denied" | "cancelled";
  choice: "once" | "session" | "always" | null;
  reason: string | null;
  mode: string | null;
};

export type AcpNoticeItem = {
  id: string;
  seq: number;
  at: string;
  kind: "notice";
  turn: string | null;
  notice:
    | {
        type: "turn_end";
        outcome: "completed" | "stopped" | "failed";
        active_ms: number;
        waited_ms: number;
      }
    | {
        type: "error";
        code: string;
        message: string;
        evidence?: { verdict_path: string | null; request_id: string | null };
      }
    | { type: "info"; text: string; level: "info" | "warning" }
    | {
        type: "command_output";
        command: string;
        text: string;
        format: "markdown" | "preformatted";
      };
};

export type AcpEntry =
  | AcpMessageItem
  | AcpToolItem
  | AcpApprovalItem
  | AcpNoticeItem;

export type AcpHiddenItem = {
  id: string;
  seq: number;
  at: string;
  kind: "hidden";
  checkpoint: string;
  choice: "restore_all" | "messages_only";
  count: number;
  restored: number;
  left: {
    kind: "file" | "fact";
    target: string;
    result: "skipped" | "remained" | "failure" | "uncertain" | "unchanged";
    reason: RewindReason | null;
  }[];
  items: AcpEntry[];
};

export type AcpItem = AcpEntry | AcpHiddenItem;

export type AcpTurn = {
  id: string;
  phase: "working" | "waiting" | "ended";
  started_at: string | null;
  elapsed: { active_ms: number; at: string } | null;
};

export type AcpQueued = {
  id: string;
  at: string;
  content: ContentBlock[];
  /** 앱 화면이 보낸 사람 메시지의 표시(이름표일 뿐 보낸 쪽이 아니다). */
  via?: { app: string; name: string };
};

export type AcpApproval = {
  id: string;
  subject: AcpApprovalSubject;
  choices: ("once" | "session" | "always" | "reject")[];
  always_patterns: string[];
};

export type AcpPending = {
  approval: AcpApproval | null;
  question: {
    group: string;
    tool_call: string;
    questions: AskQuestion[] | null;
  } | null;
};

export type AcpWriting = {
  turn: string;
  model_call: string;
  text: string;
  reasoning: string;
  at: string;
};

export type AcpChoice = {
  id: string;
  label: string;
  description: string | null;
};

export type AcpModelAxis = {
  id: string;
  label: string;
  kind: "choice" | "switch";
  values: { value: string; label: string }[];
};

export type AcpModelGroup = {
  id: string;
  label: string;
  models: { id: string; label: string; axes: AcpModelAxis[] }[];
};

export type AcpCommandOpens =
  | "new"
  | "rename"
  | "archive"
  | "compact"
  | "fork"
  | "rewind"
  | "model"
  | "effort"
  | "mode"
  | "permissions"
  | "status"
  | "usage"
  | "context"
  | "mcp"
  | "skills"
  | "subagents"
  | "tasks"
  | "goal"
  | "resume";

export type AcpCommand = {
  name: string;
  aliases: string[];
  description: string;
  argument_hint: string | null;
  source:
    | "app"
    | "harness"
    | "skill"
    | "plugin"
    | "mcp"
    | "custom_user"
    | "custom_project";
  opens: AcpCommandOpens | null;
};

export type AcpUsage = {
  context: {
    tokens: number;
    limit: number;
    parts: { label: string; tokens: number }[];
  } | null;
  limits: {
    id: string;
    label: string;
    used_percent: number | null;
    left: string | null;
    resets_at: string | null;
  }[];
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  turns: number | null;
  costs: {
    kind: "reported" | "estimated" | "subscription" | "free" | "unknown";
    currency: string | null;
    amount: string | null;
  }[];
  provider: {
    name: string;
    definition: string;
    account: string | null;
    state: "available" | "rejected" | "usage_wait" | "revoked";
    until: string | null;
  } | null;
};

export type AcpCapabilities = {
  model: boolean;
  effort: boolean;
  mode: boolean;
  commands: boolean;
  rewind: boolean;
  rewind_files: boolean;
  fork: boolean;
  compact: boolean;
  rename: boolean;
  usage: boolean;
  steer: boolean;
  background: boolean;
  queue_edit: boolean;
  images: boolean;
  retry: boolean;
  sessions: boolean;
  stop_child: boolean;
  steer_child: boolean;
  tasks: boolean;
  toggles: boolean;
  goal: boolean;
  roles: boolean;
  shell: boolean;
  resume: boolean;
};

export type AcpSessionMeta = {
  title: string | null;
  cli_session: string | null;
  capabilities: AcpCapabilities;
  models: AcpModelGroup[];
  model: {
    model: string;
    label: string;
    options: Record<string, string>;
    layer: "global" | "project" | "agent" | "session" | null;
  } | null;
  modes: AcpChoice[];
  mode: string | null;
  commands: AcpCommand[];
  usage: AcpUsage | null;
  toggles: {
    id: string;
    label: string;
    description: string | null;
    on: boolean;
  }[];
  goal: {
    objective: string;
    status: "active" | "paused" | "blocked" | "done";
    detail: string | null;
  } | null;
  roles:
    | {
        id: string;
        label: string;
        kind: "chat" | "model";
        model: string | null;
      }[]
    | null;
  harness: string | null;
};

export type AcpPlan = {
  entries: {
    text: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
  }[];
};

export type AcpTask = {
  id: string;
  kind: "agent" | "shell" | "other";
  description: string;
  state: "running" | "done" | "failed" | "stopped";
  started_at: string | null;
  output: string | null;
};

export type AcpChildState = {
  seq: number;
  items: AcpItem[];
  turn: AcpTurn | null;
  queued: AcpQueued[];
  pending: AcpPending;
  writing: AcpWriting | null;
  dropped: { model_call: string | null; turn: string | null };
  session: AcpSessionMeta | null;
  plan: AcpPlan | null;
  reread: boolean;
};

export type AcpState = AcpChildState & {
  children: Record<string, AcpChildState>;
  tasks: AcpTask[];
  draft: { key: string; content: ContentBlock[] } | null;
};

export type AcpChildUpdate =
  | { type: "message_added"; item: AcpMessageItem }
  | { type: "message_queued"; queued: AcpQueued }
  | { type: "message_removed"; message: string }
  | {
      type: "message_taken";
      message: string;
      seq: number;
      delivery: InputDelivery;
      turn: string | null;
    }
  | { type: "turn_started"; turn: string; at: string }
  | { type: "turn_resumed"; turn: string; active_ms: number; at: string }
  | {
      type: "turn_ended";
      turn: string;
      at: string;
      outcome: "completed" | "stopped" | "failed";
      active_ms: number | null;
      error: { code: string; message: string } | null;
      messages: { message: string; seq: number }[];
      seq: number;
    }
  | {
      type: "writing_streamed";
      turn: string;
      model_call: string;
      kind: "text" | "reasoning";
      offset: number;
      text: string;
      at: string;
    }
  | {
      type: "message_recorded";
      turn: string;
      message: string;
      model_call: string | null;
      seq: number;
      at: string;
      body: {
        content: ContentBlock[];
        reasoning: AcpReasoning | null;
        cards: AcpCard[];
      } | null;
    }
  | { type: "tool_started"; item: AcpToolItem }
  | {
      type: "tool_ended";
      tool_call: string;
      state: Exclude<AcpToolState, "running">;
      at: string;
      detail: AcpToolDetail | null;
      body: AcpToolBody | null;
    }
  | { type: "tool_detail_changed"; tool_call: string; detail: AcpToolDetail }
  | { type: "approval_opened"; approval: AcpApproval }
  | {
      type: "approval_closed";
      request: string;
      outcome: "allowed" | "denied" | "cancelled";
      choice: "once" | "session" | "always" | null;
      reason: string | null;
      mode: string | null;
      seq: number;
      at: string;
    }
  | {
      type: "question_asked";
      group: string;
      tool_call: string;
      questions: AskQuestion[] | null;
    }
  | {
      type: "question_resolved";
      group: string;
      outcome: "submitted" | "cancelled" | "human_message" | "parent_reply";
    }
  | { type: "session_changed"; session: Partial<AcpSessionMeta> }
  | { type: "plan_changed"; entries: AcpPlan["entries"] }
  | { type: "notice_added"; item: AcpNoticeItem }
  | { type: "hidden_added"; item: AcpHiddenItem }
  | { type: "hidden_restored"; hidden: string }
  | { type: "origin_set"; message: string; origin: string };

export type AcpUpdate =
  | AcpChildUpdate
  | { type: "child_update"; child: string; update: AcpChildUpdate }
  | { type: "tasks_changed"; tasks: AcpTask[] }
  | { type: "draft_set"; key: string; content: ContentBlock[] }
  | { type: "session_reset" };

export type AcpAnswer = {
  question: string;
  status: "answered" | "unanswered";
  answer: string[];
};

// 이 SDK가 보내는 입력만 싣는다(앱 bridge가 받는 입력 send·stop·answer·rename과 같다). 정본 AcpInput의 부분이라는 것은 agent_test.ts가 본다.
export type AcpInput =
  | {
      type: "send";
      session: string;
      id: string;
      key: string;
      content: ContentBlock[];
      delivery: InputDelivery;
    }
  | { type: "stop"; session: string; turn: string; key: string }
  | {
      type: "answer";
      session: string;
      tool_call: string;
      answers: AcpAnswer[];
    }
  | { type: "rename"; session: string; key: string; title: string };
