import { z } from "zod";
import { acpApprovalSubjectSchema } from "../approvals/gate-call.ts";
import { shellPatternSchema } from "../approvals/shell-rules.ts";
import { atSchema } from "../base/values.ts";
import { askInputSchema } from "../lophn-agent/ask-tool.ts";
import { contentBlockSchema } from "../lophn-agent/content-block.ts";
import { inputDeliverySchema } from "../lophn-agent/inputs.ts";
import {
  acpApprovalItemSchema,
  acpCardSchema,
  acpHiddenItemSchema,
  acpItemSchema,
  acpMessageItemSchema,
  acpNoticeItemSchema,
  acpReasoningSchema,
  acpToolBodySchema,
  acpToolDetailSchema,
  acpToolItemSchema,
  acpToolStateSchema,
} from "./items.ts";
import { acpSessionMetaSchema } from "./session.ts";

// ACP의 상태(snapshot)와 갱신(stream). core가 만들고 화면은 읽기만 한다. `reduceAcp`가 갱신을 상태에 접는다.

const id = z.string().min(1);
const seq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ms = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const acpTurnSchema = z.strictObject({
  id,
  /** 사람이 답할 것(`pending`)이 남았으면 waiting이다. */
  phase: z.enum(["working", "waiting", "ended"]),
  /** 걸린 시간을 셀 때 쓴다. 모르면 null. */
  started_at: atSchema.nullable(),
  /** 도는 turn이 `at`까지 일한 시간(사람 기다림 제외). 일하는 중 줄은 `active_ms + (now − at)`을 보인다. */
  elapsed: z.strictObject({ active_ms: ms, at: atSchema }).nullable(),
});
export type AcpTurn = z.infer<typeof acpTurnSchema>;

/** 다음 turn을 기다리는 사람 메시지. 도는 중에 보냈다. 순번이 없고 turn이 가져가면 항목이 된다. */
export const acpQueuedSchema = z.strictObject({
  id,
  at: atSchema,
  content: z.array(contentBlockSchema),
});
export type AcpQueued = z.infer<typeof acpQueuedSchema>;

const acpAskedQuestionsSchema = askInputSchema.shape.questions;

export const acpPendingSchema = z.strictObject({
  /** composer 위의 승인 카드. harness 물음은 이 대화에 오지 않는다. */
  approval: z
    .strictObject({
      id,
      subject: acpApprovalSubjectSchema,
      /**
       * 이 카드가 낼 수 있는 범위. `session`은 그 CLI session 안에서만이고 `always`는 어디서나 영구 규칙이다
       * (lophn은 할당 규칙, Codex "비슷한 명령", OpenCode·omp always).
       */
      choices: z.array(z.enum(["once", "session", "always", "reject"])),
      always_patterns: z.array(shellPatternSchema),
    })
    .nullable(),
  /** 답을 기다리는 질문 묶음. 질문 내용을 모르면 questions가 null이다. */
  question: z
    .strictObject({
      group: id,
      tool_call: id,
      questions: acpAskedQuestionsSchema.nullable(),
    })
    .nullable(),
});
export type AcpPending = z.infer<typeof acpPendingSchema>;

/** lophn core 승인 카드의 범위. `always`는 allow 규칙으로 더할 pattern이 있을 때만이고 `session`은 core에 없다. */
export function acpCoreApprovalChoices(
  alwaysPatterns: readonly string[],
): NonNullable<AcpPending["approval"]>["choices"] {
  return alwaysPatterns.length === 0
    ? ["once", "reject"]
    : ["once", "always", "reject"];
}

/** 아직 저장되지 않은 model 호출 하나의 글(redaction을 거친 것). 저장되면 그 message 항목으로 바뀐다. */
export const acpWritingSchema = z.strictObject({
  turn: id,
  model_call: id,
  text: z.string(),
  reasoning: z.string(),
  /** 이 글이 새 묶음을 열 때 위에 보일 시각. */
  at: atSchema,
});
export type AcpWriting = z.infer<typeof acpWritingSchema>;

export const acpPlanSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      text: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    }),
  ),
});
export type AcpPlan = z.infer<typeof acpPlanSchema>;

/** harness의 background task(subagent, shell 등). 목록은 통째로 바뀐다(`tasks_changed`). */
export const acpTaskSchema = z.strictObject({
  id,
  kind: z.enum(["agent", "shell", "other"]),
  description: z.string(),
  state: z.enum(["running", "done", "failed", "stopped"]),
  started_at: atSchema.nullable(),
  /** 출력의 꼬리. `ACP_TOOL_BODY_LIMIT` 안이다. */
  output: z.string().nullable(),
});
export type AcpTask = z.infer<typeof acpTaskSchema>;

const stateShape = {
  /** 가진 항목 중 가장 큰 순번. 비었으면 0. 다음 항목은 이보다 1 크다. */
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  /** 순번 순서. */
  items: z.array(acpItemSchema),
  /** 가장 늦게 시작한 turn. 멈춤과 다시 하기의 대상이다. */
  turn: acpTurnSchema.nullable(),
  queued: z.array(acpQueuedSchema),
  pending: acpPendingSchema,
  writing: acpWritingSchema.nullable(),
  /**
   * 마지막으로 글을 버린 model 호출(저장됐거나 tool call이 시작된)과 끝난 turn. 그 늦은 조각이 새 글로
   * 보이지 않게 한다(core의 live-turns와 같은 규칙).
   */
  dropped: z.strictObject({ model_call: id.nullable(), turn: id.nullable() }),
  /** source의 session 기능과 capability. 아직 모르면 null이고 화면은 대화만 그린다. */
  session: acpSessionMetaSchema.nullable(),
  /** agent의 계획(todo). lophn agent는 todo가 없어 null이다. */
  plan: acpPlanSchema.nullable(),
  /** 순번이 빠졌거나 글의 offset이 맞지 않았다. 읽은 상태가 맞지 않으니 snapshot을 다시 읽는다. */
  reread: z.boolean(),
};

/**
 * 자식 대화(subagent)의 상태. 바깥 상태에서 `children`·`tasks`만 없다. 자식은 한 층이다: 손자 subagent도 바깥
 * `children`에 평평하게 들고, 자식 상태 안 subagent tool 줄의 `child`가 바깥 key를 가리킨다.
 */
export const acpChildStateSchema = z.strictObject(stateShape);
export type AcpChildState = z.infer<typeof acpChildStateSchema>;

export const acpStateSchema = z.strictObject({
  ...stateShape,
  /** subagent의 대화. key는 subagent tool 줄의 `child`. */
  children: z.record(id, acpChildStateSchema),
  /** background task 목록. */
  tasks: z.array(acpTaskSchema),
  /**
   * 화면이 composer에 한 번 채울 글(OpenCode `/undo`가 되돌린 사람 메시지). `key`가 새 값일 때만 채운다. lophn은 늘 null.
   */
  draft: z
    .strictObject({ key: id, content: z.array(contentBlockSchema) })
    .nullable(),
});
export type AcpState = z.infer<typeof acpStateSchema>;

// 갱신. 같은 갱신을 두 번 접어도 같다(항목은 id로 한 번만 든다). `acpChildUpdateSchema`는 자식 대화에도 접히는 갱신이다.
export const acpChildUpdateSchema = z.discriminatedUnion("type", [
  /** 순번이 있는 message 항목(사람 말, 받은 메시지, steer). 이미 있는 id는 무시한다. */
  z.strictObject({
    type: z.literal("message_added"),
    item: acpMessageItemSchema,
  }),
  /** 사람이 도는 중에 다음 turn으로 보낸 메시지가 줄을 섰다. */
  z.strictObject({
    type: z.literal("message_queued"),
    queued: acpQueuedSchema,
  }),
  /** 다음 turn 줄의 메시지를 뺐다. */
  z.strictObject({ type: z.literal("message_removed"), message: id }),
  /**
   * 줄을 선 메시지를 turn이 가져가거나(next_turn) 도는 turn에 steer로 올렸다. 줄에서 빠져 `seq`의 항목이
   * 된다. `turn`이 null이면 도는 turn이다.
   */
  z.strictObject({
    type: z.literal("message_taken"),
    message: id,
    seq,
    delivery: inputDeliverySchema,
    turn: id.nullable(),
  }),
  z.strictObject({ type: z.literal("turn_started"), turn: id, at: atSchema }),
  /** 마지막 사람 기다림이 닫혀 다시 도는 순간이다. */
  z.strictObject({
    type: z.literal("turn_resumed"),
    turn: id,
    active_ms: ms,
    at: atSchema,
  }),
  /**
   * turn이 끝났다. `messages`는 그 turn의 agent message(본문은 snapshot이 준다)이고, `seq`는 꼬리(notice)의
   * 순번이다. error가 있으면 꼬리는 시간 대신 오류다.
   */
  z.strictObject({
    type: z.literal("turn_ended"),
    turn: id,
    at: atSchema,
    outcome: z.enum(["completed", "stopped", "failed"]),
    active_ms: ms.nullable(),
    error: z
      .strictObject({ code: z.string().min(1), message: z.string() })
      .nullable(),
    messages: z.array(z.strictObject({ message: id, seq })),
    seq,
  }),
  /** 흘러나온 글의 조각. offset은 같은 model_call·kind에서 앞서 낸 글의 UTF-16 길이다. */
  z.strictObject({
    type: z.literal("writing_streamed"),
    turn: id,
    model_call: id,
    kind: z.enum(["text", "reasoning"]),
    offset: ms,
    text: z.string().min(1),
    at: atSchema,
  }),
  /**
   * model 응답의 agent message가 저장됐다. `body`가 있으면 저장된 본문이라 항목은 `complete`이고 snapshot과
   * 같다. 없으면(core가 본문을 읽지 못했다) 그 model 호출의 흘러나온 글이 항목의 첫 글이 되고 `complete`가
   * false라 snapshot을 다시 읽는다. harness session의 메시지는 lophn model 호출이 없어 `model_call`이 null이고
   * 흘러나온 글도 없다.
   */
  z.strictObject({
    type: z.literal("message_recorded"),
    turn: id,
    message: id,
    model_call: id.nullable(),
    seq,
    at: atSchema,
    body: z
      .strictObject({
        content: z.array(contentBlockSchema),
        reasoning: acpReasoningSchema.nullable(),
        cards: z.array(acpCardSchema),
      })
      .nullable(),
  }),
  /** tool call이 시작됐다. 그 turn의 흘러나온 글을 버린다(글이 있는 응답은 tool보다 먼저 저장된다). */
  z.strictObject({ type: z.literal("tool_started"), item: acpToolItemSchema }),
  /** `detail`이 null이면 시작 때 정해진 종류를 그대로 둔다. */
  z.strictObject({
    type: z.literal("tool_ended"),
    tool_call: id,
    state: acpToolStateSchema.exclude(["running"]),
    at: atSchema,
    detail: acpToolDetailSchema.nullable(),
    /** null이면 시작 때 본문을 그대로 둔다. */
    body: acpToolBodySchema.nullable(),
  }),
  /** 끝난 tool 줄의 detail이 나중에 바뀐다(background로 돈 subagent가 끝남, Codex `wait`·`closeAgent`). 없는 tool이면 그대로다. */
  z.strictObject({
    type: z.literal("tool_detail_changed"),
    tool_call: id,
    detail: acpToolDetailSchema,
  }),
  z.strictObject({
    type: z.literal("approval_opened"),
    approval: acpPendingSchema.shape.approval.unwrap(),
  }),
  /** 결정으로 카드가 닫히고 결과 항목이 생긴다. choice와 reason은 core가 알면 싣는다. */
  z.strictObject({
    type: z.literal("approval_closed"),
    request: id,
    outcome: z.enum(["allowed", "denied", "cancelled"]),
    choice: acpApprovalItemSchema.shape.choice,
    reason: acpApprovalItemSchema.shape.reason,
    mode: acpApprovalItemSchema.shape.mode,
    seq,
    at: atSchema,
  }),
  z.strictObject({
    type: z.literal("question_asked"),
    group: id,
    tool_call: id,
    questions: acpAskedQuestionsSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("question_resolved"),
    group: id,
    outcome: z.enum(["submitted", "cancelled", "human_message"]),
  }),
  /** session 칸의 일부가 바뀌었다. 맨 위 칸만 덮어 합치고 `capabilities`는 통째로 바꾼다. */
  z.strictObject({
    type: z.literal("session_changed"),
    session: acpSessionMetaSchema.partial(),
  }),
  /** 계획이 통째로 바뀌었다. */
  z.strictObject({
    type: z.literal("plan_changed"),
    entries: acpPlanSchema.shape.entries,
  }),
  /** turn 중간의 한 줄 알림. 순번은 다른 항목과 같은 규칙이다. */
  z.strictObject({
    type: z.literal("notice_added"),
    item: acpNoticeItemSchema,
  }),
  /** rewind가 구간을 숨겼다. 구간의 항목이 top-level에서 빠져 이 항목 안으로 든다. */
  z.strictObject({
    type: z.literal("hidden_added"),
    item: acpHiddenItemSchema,
  }),
  /** 숨긴 구간이 다시 보인다(OpenCode redo, 다른 client의 revert 풀기). 그 hidden의 항목이 제자리(같은 `seq`)로 돌아온다. */
  z.strictObject({ type: z.literal("hidden_restored"), hidden: id }),
  /** 사람 메시지의 CLI id를 늦게 안다(Codex `userMessage` item, omp entry id는 보낸 뒤에 온다). */
  z.strictObject({
    type: z.literal("origin_set"),
    message: id,
    origin: z.string().min(1),
  }),
]);
export type AcpChildUpdate = z.infer<typeof acpChildUpdateSchema>;

export const acpUpdateSchema = z.discriminatedUnion("type", [
  ...acpChildUpdateSchema.options,
  /** subagent 대화의 갱신. 같은 reducer로 `children[child]`에 접힌다. */
  z.strictObject({
    type: z.literal("child_update"),
    child: id,
    update: acpChildUpdateSchema,
  }),
  /** background task 목록이 통째로 바뀌었다. */
  z.strictObject({
    type: z.literal("tasks_changed"),
    tasks: z.array(acpTaskSchema),
  }),
  z.strictObject({
    type: z.literal("draft_set"),
    key: id,
    content: z.array(contentBlockSchema),
  }),
]);
export type AcpUpdate = z.infer<typeof acpUpdateSchema>;
