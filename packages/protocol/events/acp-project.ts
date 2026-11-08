import type { AgentId } from "../lophn-agent/workspaces.ts";
import {
  ACP_TOOL_BODY_LIMIT,
  type AcpToolDetail,
  type AcpToolItem,
  type AcpCard,
  type AcpReasoning,
} from "../acp/items.ts";
import { acpNoticeId } from "../acp/reduce.ts";
import {
  type AcpPending,
  type AcpUpdate,
  acpCoreApprovalChoices,
} from "../acp/state.ts";
import type { AgentEvent } from "./agent.ts";
import type { ContentBlock } from "../lophn-agent/content-block.ts";

// AgentEvent 하나를 ACP 갱신으로 바꾸는 순수 projection이다. event는 core Bus에서 나온 것이라 흘러나온 글
// (`ModelOutputStreamed`)과 tool 제목(`display`)이 이미 redaction을 거쳤다. 이 함수는 redaction을 하지 않고
// 글의 출처를 더하지도 않는다: 갱신에 싣는 글은 event의 것과 `AcpContext`가 준 것뿐이고, context의 값도
// redaction을 거친 값이어야 한다. redaction 규칙은 core(`run-loop/live-turns.ts`)에 있다.

/**
 * event만으로는 알 수 없는 것을 core가 아는 대로 준다. 모두 이미 있는 값을 찾기만 하는 함수라 IO가 없다.
 */
export interface AcpContext {
  /**
   * 항목의 순번. core가 항목이 대화에 들어올 때 session마다 1부터 이어 붙여 저장하고(snapshot의 순번과
   * 같은 값) 여기서 찾아 준다. 아직 대화에 들지 않은 메시지(다음 turn 줄)는 null이다. 항목이 될 id에
   * null이 오면 그 갱신은 만들지 않는다.
   */
  seq(id: string): number | null;
  /** tool call의 종류와 칸. 아직 모르면(문서 편집은 끝나야 안다) null이고 generic으로 둔다. */
  tool(toolCall: string): AcpToolDetail | null;
  /** 대기 중인 질문 묶음의 내용(`ask` tool call로 찾는다). event는 내용을 싣지 않는다. */
  questions(toolCall: string): NonNullable<AcpPending["question"]>["questions"];
  /** 메시지를 보낸 session의 agent. 모르면 null. */
  agentOf(session: string): AgentId | null;
  /** agent의 이름. 모르면 null. */
  agentName(agent: AgentId): string | null;
  /** 저장된 agent message의 본문. 못 읽었으면 null이다(항목은 `complete` false로 서고 snapshot을 다시 읽는다). */
  body(message: string): {
    readonly content: ContentBlock[];
    readonly reasoning: AcpReasoning | null;
    readonly cards: AcpCard[];
  } | null;
  /** 승인 결정 때 사람이 고른 범위와 거절 이유. 모르면 null. */
  decision(request: string): {
    readonly choice: "once" | "always" | null;
    readonly reason: string | null;
  } | null;
}

/**
 * 사람이 `!`로 돌린 명령 한 줄. 출력은 저장 전에 redaction을 거친 값이라 여기서 다시 거치지 않는다(lophn의 agent
 * tool 본문이 null인 것과 다른 점이다). 입력과 출력은 `ACP_TOOL_BODY_LIMIT`까지만 싣는다.
 */
export function acpShellItem(
  shell: {
    message: string;
    command: string;
    exit_code: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    duration_ms: number | null;
  },
  seq: number,
  at: string,
): AcpToolItem {
  const joined =
    shell.stderr === "" ? shell.stdout : `${shell.stdout}\n${shell.stderr}`;
  const cut = (text: string) => text.slice(0, ACP_TOOL_BODY_LIMIT);
  const input = cut(shell.command);
  const output = cut(joined);
  return {
    kind: "tool",
    id: shell.message,
    seq,
    at,
    by: "user",
    turn: null,
    tool: "shell",
    category: "command",
    title: shell.command.split("\n", 1)[0]!.trim() || "shell",
    state: shell.exit_code === 0 ? "ok" : "error",
    duration_ms: shell.duration_ms,
    detail: { kind: "generic" },
    body: {
      input,
      output,
      truncated:
        shell.truncated ||
        input.length < shell.command.length ||
        output.length < joined.length,
    },
  };
}

export function acpUpdatesOf(
  event: AgentEvent,
  context: AcpContext,
): AcpUpdate[] {
  switch (event.type) {
    case "MessageReceived": {
      const { message, body, from, call, reply_to, steer } = event.payload;
      const seq = context.seq(message);
      if (seq === null) {
        // 사람이 도는 중에 다음 turn으로 보낸 말이다.
        return from.kind === "human" && !steer
          ? [
              {
                type: "message_queued",
                queued: { id: message, at: event.at, content: body },
              },
            ]
          : [];
      }
      const agent =
        from.kind === "agent" ? context.agentOf(from.session) : null;
      return [
        {
          type: "message_added",
          item: {
            kind: "message",
            id: message,
            seq,
            at: event.at,
            actor: from.kind === "human" ? "user" : "received",
            sender:
              from.kind === "human"
                ? null
                : from.kind === "program"
                  ? { kind: "program" }
                  : {
                      kind: "agent",
                      agent,
                      name: agent === null ? null : context.agentName(agent),
                    },
            call,
            reply_to,
            delivery: steer ? "steer" : "next_turn",
            turn: null,
            content: body,
            reasoning: null,
            cards: [],
            complete: true,
            origin: null,
          },
        },
      ];
    }
    case "MessageSteered": {
      const seq = context.seq(event.payload.message);
      return seq === null
        ? []
        : [
            {
              type: "message_taken",
              message: event.payload.message,
              seq,
              delivery: "steer",
              turn: null,
            },
          ];
    }
    case "MessageRemoved":
      return [{ type: "message_removed", message: event.payload.message }];
    case "ShellRan": {
      const seq = context.seq(event.payload.message);
      return seq === null
        ? []
        : [
            {
              type: "tool_started",
              item: acpShellItem(event.payload, seq, event.at),
            },
          ];
    }
    case "TurnStarted": {
      const { turn, input_message } = event.payload;
      const seq = context.seq(input_message);
      return [
        { type: "turn_started", turn, at: event.at },
        ...(seq === null
          ? []
          : [
              {
                type: "message_taken" as const,
                message: input_message,
                seq,
                delivery: "next_turn" as const,
                turn,
              },
            ]),
      ];
    }
    case "TurnResumed":
      return [
        {
          type: "turn_resumed",
          turn: event.payload.turn,
          active_ms: event.payload.active_ms,
          at: event.at,
        },
      ];
    case "TurnEnded": {
      const { turn, outcome, messages, active_ms, error } = event.payload;
      const seq = context.seq(acpNoticeId(turn));
      if (seq === null) return [];
      return [
        {
          type: "turn_ended",
          turn,
          at: event.at,
          outcome:
            outcome.kind === "completed"
              ? "completed"
              : outcome.kind === "failed"
                ? "failed"
                : "stopped",
          active_ms,
          error,
          messages: messages.flatMap((message) => {
            const messageSeq = context.seq(message);
            return messageSeq === null ? [] : [{ message, seq: messageSeq }];
          }),
          seq,
        },
      ];
    }
    case "ModelOutputStreamed": {
      const { turn, model_call, kind, offset, text } = event.payload;
      return [
        {
          type: "writing_streamed",
          turn,
          model_call,
          kind,
          offset,
          text,
          at: event.at,
        },
      ];
    }
    case "MessageRecorded": {
      const { turn, message, model_call } = event.payload;
      const seq = context.seq(message);
      return seq === null
        ? []
        : [
            {
              type: "message_recorded",
              turn,
              message,
              model_call,
              seq,
              at: event.at,
              body: context.body(message),
            },
          ];
    }
    case "ToolCallStarted": {
      const { turn, tool_call, tool, display } = event.payload;
      const seq = context.seq(tool_call);
      return seq === null
        ? []
        : [
            {
              type: "tool_started",
              item: {
                kind: "tool",
                id: tool_call,
                seq,
                at: event.at,
                by: "agent",
                turn,
                tool,
                category: display.category,
                title: display.title,
                state: "running",
                duration_ms: null,
                detail: context.tool(tool_call) ?? { kind: "generic" },
                body: null,
              },
            },
          ];
    }
    case "ToolCallEnded": {
      const { tool_call, outcome } = event.payload;
      return [
        {
          type: "tool_ended",
          tool_call,
          state: outcome,
          at: event.at,
          detail: context.tool(tool_call),
          body: null,
        },
      ];
    }
    case "TurnRequestOpened": {
      const { id, subject, always_patterns } = event.payload.request;
      // harness 물음은 이 대화에 그리지 않는다. 답은 터미널에서 한다.
      return subject.kind === "harness"
        ? []
        : [
            {
              type: "approval_opened",
              approval: {
                id,
                subject,
                choices: acpCoreApprovalChoices(always_patterns),
                always_patterns,
              },
            },
          ];
    }
    case "TurnRequestClosed": {
      const { request, outcome } = event.payload;
      const seq = context.seq(request);
      if (seq === null) return [];
      const decision = context.decision(request);
      return [
        {
          type: "approval_closed",
          request,
          outcome:
            outcome === "allow"
              ? "allowed"
              : outcome === "reject"
                ? "denied"
                : "cancelled",
          choice: outcome === "allow" ? (decision?.choice ?? null) : null,
          reason: outcome === "reject" ? (decision?.reason ?? null) : null,
          mode: null,
          seq,
          at: event.at,
        },
      ];
    }
    case "QuestionAsked": {
      const { group, tool_call } = event.payload;
      return [
        {
          type: "question_asked",
          group,
          tool_call,
          questions: context.questions(tool_call),
        },
      ];
    }
    case "QuestionResolved":
      return [
        {
          type: "question_resolved",
          group: event.payload.group,
          // parent_reply는 팀 자식의 질문이라 ACP에 나가지 않는다(core acp.ts가 거른다).
          outcome:
            event.payload.outcome === "parent_reply"
              ? "cancelled"
              : event.payload.outcome,
        },
      ];
    default:
      return [];
  }
}
