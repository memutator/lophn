import { z } from "zod";
import { gateCallSchema } from "../approvals/gate-call.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { agentIdSchema } from "../lophn-agent/places.ts";
import {
  CALL_FAIL_REASONS,
  CALL_REPLIES,
  CALL_STATES,
} from "../lophn-agent/calls.ts";
import { contentBlockSchema } from "../lophn-agent/content-block.ts";
import { inputDeliverySchema } from "../lophn-agent/inputs.ts";
import { previewItemFields } from "../lophn-agent/session-rewinds.ts";
import { TOOL_CALL_CATEGORIES } from "../lophn-agent/tool-values.ts";

// ACP의 항목이다. session의 대화 줄 하나이고 `seq`(session 안의 순번, 1부터)로 순서를 정한다.
// 화면이 그리는 모양이 아니라 agent가 낸 것의 모양이다. 흐름과 불변 조건은 architecture/acp.md다.

const id = z.string().min(1);
const seq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const itemBase = { id, seq, at: atSchema };

export const acpSenderSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("agent"),
    agent: agentIdSchema.nullable(),
    name: z.string().nullable(),
  }),
  z.strictObject({ kind: z.literal("program") }),
]);
export type AcpSender = z.infer<typeof acpSenderSchema>;

export const acpReasoningSchema = z.strictObject({
  text: z.string(),
  duration_ms: count.nullable(),
});
export type AcpReasoning = z.infer<typeof acpReasoningSchema>;

/** `visual.show`가 대화에 올린 앱 카드. content block이 아니라 message의 따로 칸이다. */
export const acpCardSchema = z.strictObject({
  app: idSchema("app"),
  view: id,
});
export type AcpCard = z.infer<typeof acpCardSchema>;

/**
 * 메시지 하나. `complete`가 false면 `content`는 흘러나온 글(최종 본문의 앞부분)이거나 비어 있고, 최종 본문은
 * snapshot을 다시 읽어야 안다(stream이 최종 본문을 싣지 않는다).
 */
export const acpMessageItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("message"),
  /** user: 사람이 쓴 말. agent: 이 agent의 답. received: 다른 쪽이 보낸 메시지. */
  actor: z.enum(["user", "agent", "received"]),
  /** received일 때만 있다. */
  sender: acpSenderSchema.nullable(),
  /** 이 메시지가 맡긴 call. */
  call: id.nullable(),
  /** 이 메시지가 답하는 call. */
  reply_to: id.nullable(),
  delivery: inputDeliverySchema,
  /** 이 메시지를 가져간 turn. 아직이면 null. */
  turn: id.nullable(),
  content: z.array(contentBlockSchema),
  reasoning: acpReasoningSchema.nullable(),
  cards: z.array(acpCardSchema),
  complete: z.boolean(),
});
export type AcpMessageItem = z.infer<typeof acpMessageItemSchema>;

// tool의 종류. 종류마다 화면에 필요한 칸만 싣고 큰 본문(입력, 출력, diff)은 따로 읽는다.
export const acpToolDetailSchema = z.discriminatedUnion("kind", [
  /** 문서를 바꾼 tool. 끝나야 안다. */
  z.strictObject({
    kind: z.literal("edit"),
    document: id,
    path: z.string(),
    added: count,
    removed: count,
  }),
  /** 다른 session에 일을 맡긴 call. 상태는 읽은 때의 것이다. */
  z.strictObject({
    kind: z.literal("call"),
    call: id,
    to: z.string(),
    task: z.string(),
    reply: z.enum(CALL_REPLIES),
    state: z.enum(CALL_STATES),
    fail_reason: z.enum(CALL_FAIL_REASONS).nullable(),
    session: id.nullable(),
  }),
  /** 사람에게 묻는 `ask`. 풀리기 전에는 outcome이 null이고, 답 줄은 모르면 answer가 null이다. */
  z.strictObject({
    kind: z.literal("question"),
    group: id.nullable(),
    outcome: z.enum(["submitted", "cancelled", "human_message"]).nullable(),
    lines: z.array(
      z.strictObject({ header: z.string(), answer: z.string().nullable() }),
    ),
  }),
  /** 사람의 동의를 기다리는 호출(`release.activate`). */
  z.strictObject({ kind: z.literal("consent"), release: id }),
  z.strictObject({ kind: z.literal("generic") }),
]);
export type AcpToolDetail = z.infer<typeof acpToolDetailSchema>;

export const ACP_TOOL_STATES = [
  "running",
  "ok",
  "error",
  "denied",
  "cancelled",
] as const;
export const acpToolStateSchema = z.enum(ACP_TOOL_STATES);
export type AcpToolState = z.infer<typeof acpToolStateSchema>;

/** tool call 하나. `at`은 시작한 때이고 이어진 call을 묶는 것은 화면의 일이다. */
export const acpToolItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("tool"),
  turn: id,
  /** 정본 이름(`file.read`, `shell.run`). */
  tool: z.string().min(1),
  category: z.enum(TOOL_CALL_CATEGORIES),
  /** 지금의 redaction을 거친 한 줄 제목. */
  title: z.string().min(1),
  state: acpToolStateSchema,
  duration_ms: count.nullable(),
  detail: acpToolDetailSchema,
});
export type AcpToolItem = z.infer<typeof acpToolItemSchema>;

/** 승인 결정 뒤 대화에 남는 줄. cancelled(원래 일이 끝남)는 거절이 아니다. */
export const acpApprovalItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("approval"),
  subject: gateCallSchema,
  outcome: z.enum(["allowed", "denied", "cancelled"]),
  /** 사람이 고른 허락 범위. 모르면 null. */
  choice: z.enum(["once", "always"]).nullable(),
  reason: z.string().nullable(),
});
export type AcpApprovalItem = z.infer<typeof acpApprovalItemSchema>;

/** turn의 꼬리. 정상 종료와 멈춤은 시간이고 실패는 오류다. */
export const acpNoticeItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("notice"),
  turn: id,
  notice: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("turn_end"),
      outcome: z.enum(["completed", "stopped", "failed"]),
      /** agent가 일한 시간(사람 기다림 제외). */
      active_ms: count,
      /** 사람을 기다린 시간(wall − active). */
      waited_ms: count,
    }),
    z.strictObject({
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string(),
    }),
  ]),
});
export type AcpNoticeItem = z.infer<typeof acpNoticeItemSchema>;

/** hidden이 품을 수 있는 항목. */
export const acpEntrySchema = z.discriminatedUnion("kind", [
  acpMessageItemSchema,
  acpToolItemSchema,
  acpApprovalItemSchema,
  acpNoticeItemSchema,
]);
export type AcpEntry = z.infer<typeof acpEntrySchema>;

/**
 * rewind가 숨긴 구간. 숨긴 항목은 지워지지 않고 `items`에 든다(앞서 숨은 구간의 항목도 평평하게 든다).
 * `seq`는 숨긴 첫 항목의 순번이라 대화 안의 자리가 그대로다.
 */
export const acpHiddenItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("hidden"),
  /** 그 rewind가 고른 사람 메시지. */
  checkpoint: id,
  choice: z.enum(["restore_all", "messages_only"]),
  count,
  /** 실제로 복원한 문서 파일 수. */
  restored: count,
  /** 복원하지 못했거나 남은 항목. */
  left: z.array(
    z.strictObject({
      kind: z.enum(["file", "fact"]),
      target: z.string(),
      result: z.enum([
        "skipped",
        "remained",
        "failure",
        "uncertain",
        "unchanged",
      ]),
      reason: previewItemFields.reason,
    }),
  ),
  items: z.array(acpEntrySchema),
});
export type AcpHiddenItem = z.infer<typeof acpHiddenItemSchema>;

export const acpItemSchema = z.discriminatedUnion("kind", [
  ...acpEntrySchema.options,
  acpHiddenItemSchema,
]);
export type AcpItem = z.infer<typeof acpItemSchema>;
