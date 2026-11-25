import { z } from "zod";
import { permissionDenialSchema } from "../approvals/denial.ts";
import { acpApprovalSubjectSchema } from "../approvals/gate-call.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { atSchema } from "../base/values.ts";
import {
  CALL_FAIL_REASONS,
  CALL_REPLIES,
  CALL_STATES,
  MAIL_DELIVERIES,
} from "../lophn-agent/calls.ts";
import { contentBlockSchema } from "../lophn-agent/content-block.ts";
import { inputDeliverySchema } from "../lophn-agent/inputs.ts";
import { previewItemFields } from "../lophn-agent/session-rewinds.ts";
import { TOOL_CALL_CATEGORIES } from "../lophn-agent/tool-values.ts";
import { agentIdSchema } from "../lophn-agent/workspaces.ts";

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
  // 앱이 보낸 call이다. name은 그 앱의 slug(보낼 때의 것)다.
  z.strictObject({
    kind: z.literal("app"),
    // 앱 id. 앱 id를 모르는 곳(harness GUI가 tag에서 읽은 것)은 null이다.
    app: idSchema("app").nullable(),
    name: z.string(),
  }),
]);
export type AcpSender = z.infer<typeof acpSenderSchema>;

// 다른 컴퓨터의 agent가 보낸 입력의 보낸 쪽 이름이다. live 변환과 이력 만들기가 같은 글을 내도록 한 곳에 둔다.
// 새 sender kind를 더하면 phone의 sender 분기가 깨져서 kind는 agent로 두고 이름에 컴퓨터를 싣는다.
export function acpRemoteSenderName(from: {
  name: string;
  computer: string;
}): string {
  return `${from.name} on ${from.computer}`;
}

export const acpReasoningSchema = z.strictObject({
  text: z.string(),
  duration_ms: count.nullable(),
});
export type AcpReasoning = z.infer<typeof acpReasoningSchema>;

/** `visual.show`가 대화에 올린 앱 카드. content block이 아니라 message의 따로 칸이다. */
export const acpCardSchema = z.strictObject({
  app: idSchema("app"),
  view: id,
  params: jsonObjectSchema.optional(),
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
  /** 앱 화면이 보낸 사람 메시지의 표시다(이름표일 뿐 보낸 쪽이 아니다: 메시지는 사람의 것이고 model이 받는 글은 같다). name은 보낼 때의 앱 slug다. */
  via: z.strictObject({ app: idSchema("app"), name: z.string() }).optional(),
  /** 이 메시지가 맡긴 call. */
  call: id.nullable(),
  /** 이 메시지가 답하는 call. */
  reply_to: id.nullable(),
  delivery: inputDeliverySchema,
  /** 이 메시지를 가져간 turn. 아직이면 null. */
  turn: id.nullable(),
  /**
   * 그 CLI 자신의 message id. 같은 CLI session을 다시 열어도 같다(ACP id는 run마다 새로 만든다). thread index
   * bookmark의 key이고 사람 메시지만 쓴다. lophn은 null이다.
   */
  origin: z.string().min(1).nullable(),
  content: z.array(contentBlockSchema),
  reasoning: acpReasoningSchema.nullable(),
  cards: z.array(acpCardSchema),
  complete: z.boolean(),
});
export type AcpMessageItem = z.infer<typeof acpMessageItemSchema>;

// tool의 종류. 종류마다 화면에 필요한 칸만 싣고 큰 본문(입력, 출력, diff)은 따로 읽는다.
export const acpToolDetailSchema = z.discriminatedUnion("kind", [
  /** 문서를 바꾼 tool. 칸은 입력에서 뽑아 시작 때부터 있고, 실패한 편집도 이 종류를 지킨다(실패는 item의 state). */
  z.strictObject({
    kind: z.literal("edit"),
    document: id,
    path: z.string(),
    added: count,
    removed: count,
  }),
  /**
   * 다른 session에 일을 맡긴 call. 상태는 읽은 때의 것이다. to·task·reply는 입력에서 뽑아 시작 때부터 있고,
   * call id와 state는 보내져서 call이 생긴 뒤에야 안다(실패한 tool은 끝까지 null).
   */
  z.strictObject({
    kind: z.literal("call"),
    call: id.nullable(),
    to: z.string(),
    task: z.string(),
    reply: z.enum(CALL_REPLIES),
    state: z.enum(CALL_STATES).nullable(),
    fail_reason: z.enum(CALL_FAIL_REASONS).nullable(),
    session: id.nullable(),
    /** 다른 컴퓨터로 보낸 call이면 그 컴퓨터와 배달 상태, 그 컴퓨터에서 받은 session(알면). 이 기계 안의 call은 null. */
    remote: z
      .strictObject({
        machine: idSchema("mch"),
        computer: z.string(),
        delivery: z.enum(MAIL_DELIVERIES).nullable(),
        session: id.nullable(),
      })
      .nullable(),
  }),
  /**
   * 사람에게 묻는 `ask`. 풀리기 전에는 outcome이 null이고, 답 줄은 모르면 answer가 null이다.
   * 팀 자식의 질문을 부모가 `call reply`로 답했으면 outcome이 `parent_reply`이고 `reply`가 그 답 글이다.
   */
  z.strictObject({
    kind: z.literal("question"),
    group: id.nullable(),
    outcome: z
      .enum(["submitted", "cancelled", "human_message", "parent_reply"])
      .nullable(),
    reply: z.string().optional(),
    lines: z.array(
      z.strictObject({ header: z.string(), answer: z.string().nullable() }),
    ),
  }),
  /** 사람의 동의를 기다리는 호출(`release.activate`). */
  z.strictObject({ kind: z.literal("consent"), release: id }),
  /** 일을 맡긴 subagent. `child`는 `AcpState.children`의 key이고 아직 모르면 null이다. */
  z.strictObject({
    kind: z.literal("subagent"),
    /** agent 종류(general-purpose, explore, …). */
    agent: z.string(),
    /** 맡긴 일 한 줄. */
    description: z.string(),
    child: id.nullable(),
    state: z.enum(["running", "done", "failed", "cancelled"]),
    model: z.string().nullable(),
    /** 마지막 말이나 요약. */
    last: z.string().nullable(),
  }),
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

/** harness가 싣는 tool 본문 한 쪽의 글자 수 상한. core의 tool body 읽기(64 KiB)와 같다. */
export const ACP_TOOL_BODY_LIMIT = 65_536;

export const acpToolBodySchema = z.strictObject({
  input: z.string().nullable(),
  output: z.string().nullable(),
  /** 한 쪽이 상한을 넘어 잘랐다. */
  truncated: z.boolean(),
});
export type AcpToolBody = z.infer<typeof acpToolBodySchema>;

/**
 * tool call 하나. `at`은 시작한 때이고 이어진 call을 묶는 것은 화면의 일이다.
 * `by: "user"`는 사람이 돌린 명령(composer의 `!`, omp `bash`)이다: `tool: "shell"`, `category: "command"`, `title`은
 * 명령 첫 줄, `detail: {kind: "generic"}`, `body.input`은 명령 전체, `body.output`은 출력이다. 화면은 사람 쪽에 펼쳐 그린다.
 */
export const acpToolItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("tool"),
  by: z.enum(["agent", "user"]),
  /** null은 `by: "user"`이고 turn 밖에서 돈 명령일 때만이다. */
  turn: id.nullable(),
  /** 정본 이름(`file.read`, `shell.run`). */
  tool: z.string().min(1),
  category: z.enum(TOOL_CALL_CATEGORIES),
  /** 지금의 redaction을 거친 한 줄 제목. */
  title: z.string().min(1),
  state: acpToolStateSchema,
  duration_ms: count.nullable(),
  detail: acpToolDetailSchema,
  /**
   * harness adapter가 handle에 싣는 입력·출력 글(JSON이면 그 글). 한 쪽이 상한을 넘으면 잘라 `truncated`. handle이 창과
   * core에 내는 상태에서는 빠지고(`withoutToolBodies`. 사람이 친 명령은 `input`만 남는다) 화면이 펼칠 때 `acp/tool_body`나
   * GUI IPC로 읽는다. lophn은 null이고 본문은 blob read(`toolCallBody`)로 읽는다. lophn이 null인 것은 redaction 경계다
   * (`acp-build_test.ts`의 'tool 본문이 없다' case).
   */
  body: acpToolBodySchema.nullable(),
});
export type AcpToolItem = z.infer<typeof acpToolItemSchema>;

/** 승인 결정 뒤 대화에 남는 줄. cancelled(원래 일이 끝남)는 거절이 아니다. */
export const acpApprovalItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("approval"),
  subject: acpApprovalSubjectSchema,
  outcome: z.enum(["allowed", "denied", "cancelled"]),
  /** 사람이 고른 허락 범위. 모르면 null. */
  choice: z.enum(["once", "session", "always"]).nullable(),
  reason: z.string().nullable(),
  /** plan 승인에서 고른 `modes` id. 그 밖의 승인은 null. */
  mode: z.string().min(1).nullable(),
});
export type AcpApprovalItem = z.infer<typeof acpApprovalItemSchema>;

/**
 * turn의 꼬리. 정상 종료와 멈춤은 시간이고 실패는 오류다. `info`·`command_output`은 꼬리가 아니라 알림이다.
 * `turn`이 null이면 turn 밖의 명령 출력이다(화면은 "Worked for"를 붙이지 않는다). turn_end·error는 늘 turn이 있다.
 */
export const acpNoticeItemSchema = z.strictObject({
  ...itemBase,
  kind: z.literal("notice"),
  turn: id.nullable(),
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
      /** provider 호출이 실패한 turn에서 판정 길, provider request id, http status. DB를 열지 않고 원인 갈래를 알게 한다. */
      evidence: z
        .strictObject({
          verdict_path: z.string().min(1).nullable(),
          request_id: z.string().min(1).nullable(),
          /** 실패한 호출의 HTTP status. 문구가 사용량 한도·로그인 거절·rate limit을 가른다. */
          http_status: z.number().int().nullable().optional(),
        })
        .optional(),
    }),
    /** turn 중간의 한 줄 알림(compaction, 재시도, 명령 출력). turn의 끝이 아니다. */
    z.strictObject({
      type: z.literal("info"),
      text: z.string(),
      level: z.enum(["info", "warning"]),
    }),
    /** 슬래시 명령이 낸 글. `command`는 앞 `/` 없는 이름이고 `preformatted`는 ANSI를 지운 고정폭 글이다(adapter가 지운다). */
    z.strictObject({
      type: z.literal("command_output"),
      command: z.string().min(1),
      text: z.string(),
      format: z.enum(["markdown", "preformatted"]),
    }),
    /** 권한·범위·모드·정책으로 막힌 tool 호출. 일반 실패와 구별해 이유·규칙·복구 동작을 보인다. */
    z.strictObject({
      type: z.literal("permission_denied"),
      tool_call: id,
      denial: permissionDenialSchema,
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
