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
  | { kind: "shell"; command: string };

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
export type AcpCard = { app: string; view: string };

export type AcpMessageItem = {
  id: string;
  seq: number;
  at: string;
  kind: "message";
  actor: "user" | "agent" | "received";
  sender:
    | { kind: "agent"; agent: string | null; name: string | null }
    | { kind: "program" }
    | null;
  call: string | null;
  reply_to: string | null;
  delivery: InputDelivery;
  turn: string | null;
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
      outcome: "submitted" | "cancelled" | "human_message" | null;
      lines: { header: string; answer: string | null }[];
    }
  | { kind: "consent"; release: string }
  | { kind: "generic" };

export type AcpToolState = "running" | "ok" | "error" | "denied" | "cancelled";

export type AcpToolItem = {
  id: string;
  seq: number;
  at: string;
  kind: "tool";
  turn: string;
  tool: string;
  category: "read" | "list" | "search" | "command" | "web" | "other";
  title: string;
  state: AcpToolState;
  duration_ms: number | null;
  detail: AcpToolDetail;
};

export type AcpApprovalItem = {
  id: string;
  seq: number;
  at: string;
  kind: "approval";
  subject: GateCall;
  outcome: "allowed" | "denied" | "cancelled";
  choice: "once" | "always" | null;
  reason: string | null;
};

export type AcpNoticeItem = {
  id: string;
  seq: number;
  at: string;
  kind: "notice";
  turn: string;
  notice:
    | {
        type: "turn_end";
        outcome: "completed" | "stopped" | "failed";
        active_ms: number;
        waited_ms: number;
      }
    | { type: "error"; code: string; message: string };
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

export type AcpQueued = { id: string; at: string; content: ContentBlock[] };

export type AcpApproval = {
  id: string;
  subject: GateCall;
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

export type AcpState = {
  seq: number;
  items: AcpItem[];
  turn: AcpTurn | null;
  queued: AcpQueued[];
  pending: AcpPending;
  writing: AcpWriting | null;
  dropped: { model_call: string | null; turn: string | null };
  reread: boolean;
};

export type AcpUpdate =
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
    }
  | { type: "approval_opened"; approval: AcpApproval }
  | {
      type: "approval_closed";
      request: string;
      outcome: "allowed" | "denied" | "cancelled";
      choice: "once" | "always" | null;
      reason: string | null;
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
      outcome: "submitted" | "cancelled" | "human_message";
    }
  | { type: "hidden_added"; item: AcpHiddenItem };

export type AcpAnswer = {
  question: string;
  status: "answered" | "unanswered";
  answer: string[];
};

// 이 SDK가 보내는 입력만 싣는다. 정본 AcpInput의 부분이라는 것은 agent_test.ts가 본다.
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
    };
