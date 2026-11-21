import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { contentBlocksSchema } from "./content-block.ts";
import {
  agentCallSend,
  callFailReasonSchema,
  callReplySchema,
  remoteAddressSchema,
} from "./calls.ts";
import { agentAddressSchema } from "./workspaces.ts";

export {
  MAIL_DELIVERIES,
  type MailDelivery,
  mailDeliverySchema,
  type RemoteAddress,
  remoteAddressSchema,
  type RemoteWorkspace,
  remoteWorkspaceSchema,
} from "./calls.ts";

// 기계 사이 mail이다. 다른 컴퓨터의 agent에게 보내는 call과 그 답·실패·취소·받은 상태가 이 봉투 하나로 오간다.
// 보내는 기계는 outbox에 넣고 call id를 바로 돌려준다. 받는 기계는 mail id마다 한 번만 적용한다.

export const MAIL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
// 보낸 시각보다 이만큼 넘게 늦게 닿은 mail은 돌지 않고 대기 목록에 선다(job의 hold가 놓친 차례를 가르는 10분과 같다).
export const MAIL_LATE_MS = 10 * 60 * 1000;
// 한 mail 본문 글의 UTF-8 byte 합.
export const MAIL_TEXT_MAX_BYTES = 64 * 1024;
// 한 mail 본문의 block 수.
const MAIL_BLOCKS_MAX = 64;

// mail을 쓴 쪽이다. 받는 기계는 machine만 믿고(link의 기기나 폴더의 기계 폴더와 같아야 한다) 나머지는 표시다.
// name은 `requesterName`으로 만든다.
export const mailAuthorSchema = z.strictObject({
  machine: idSchema("mch"),
  agent: z.string().min(1).max(64),
  session: idSchema("ses").nullable(),
  name: z.string().min(1).max(64),
});
export type MailAuthor = z.infer<typeof mailAuthorSchema>;

const encoder = new TextEncoder();

// 본문은 글만이다(image blob은 기계를 건너지 않는다).
export const mailBodySchema = contentBlocksSchema.max(MAIL_BLOCKS_MAX).refine(
  (blocks) => {
    let bytes = 0;
    for (const block of blocks) {
      if (block.type !== "text") return false;
      bytes += encoder.encode(block.text).length;
    }
    return bytes <= MAIL_TEXT_MAX_BYTES;
  },
  {
    message: `a mail body is text of at most ${MAIL_TEXT_MAX_BYTES} bytes`,
  },
);

const common = {
  id: idSchema("mal"),
  call: idSchema("cal"),
  from: mailAuthorSchema,
  to_machine: idSchema("mch"),
  seq: z.number().int().min(1),
  sent_at: atSchema,
  expires_at: atSchema,
};

// reply의 outcome: 결과 답은 body와 `{done, null}`, conversation의 말은 body와 outcome null, 실패 알림은 body null과
// `{failed, <이유>}`(받는 쪽이 자기 글로 만든다). body null과 `{done}`이나 `{cancelled}`는 행만 닫고 입력을 넣지 않는다.
export const mailSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("call"),
    ...common,
    address: remoteAddressSchema,
    reply: callReplySchema,
    body: mailBodySchema,
    unattended: z.boolean(),
    // workflow의 step이면 그 instance와 step. 받는 기계는 call이 아니라 step 입력으로 넣는다(`architecture/workflow.md`).
    step: z
      .strictObject({
        instance: idSchema("wfi"),
        name: z.string().min(1).max(63),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("reply"),
    ...common,
    body: mailBodySchema.nullable(),
    outcome: z
      .strictObject({
        state: z.enum(["done", "failed", "cancelled"]),
        reason: callFailReasonSchema.nullable(),
      })
      .nullable(),
    unattended: z.boolean(),
    // step call에 받은 참가자가 낸 report. 글은 body다. next가 있으면 outcome이 done이다. step 이름의 꼴은 시작한 컴퓨터의
    // ApplyWorkflowChange가 본다(protocol의 workflows를 import하면 최상위 사이 순환이다).
    report: z
      .strictObject({
        next: z.string().min(1).max(63).nullable(),
        session: z.enum(["new", "same"]),
      })
      .optional(),
  }),
  z.strictObject({ kind: z.literal("cancel"), ...common }),
  // 받는 기계가 call mail을 어떻게 받았는지 보낸 기계에 알린다.
  z.strictObject({
    kind: z.literal("state"),
    ...common,
    delivery: z.enum(["held", "running"]),
    session: idSchema("ses").nullable(),
  }),
]);
export type Mail = z.infer<typeof mailSchema>;

// 받는 기계가 mail 하나를 적용한 결과. call mail이 아니면 delivery는 null이다.
export const mailAppliedSchema = z.strictObject({
  delivery: z.enum(["running", "held", "failed"]).nullable(),
  reason: callFailReasonSchema.nullable(),
  session: idSchema("ses").nullable(),
});
export type MailApplied = z.infer<typeof mailAppliedSchema>;

// 받는 기계의 mail 입구. 다른 컴퓨터의 core만 부른다(기기 자격). not_found를 내지 않는다: 보낸 쪽은 not_found를
// "이 route를 모르는 옛 판"으로 읽는다.
export const a2aMail = defineMemory({
  resource: "a2a",
  method: "mail",
  name: "a2a.mail",
  input: z.strictObject({ mail: mailSchema }),
  output: mailAppliedSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "conflict", "unavailable", "internal"],
});

const machineRef = { machine: z.string().min(1) };

// 다른 컴퓨터의 agent에게 call을 보낸다. 받는 곳은 이 기계의 call 주소 꼴에 컴퓨터를 더한 것이다(workspace는 이 기계의 이름 꼴).
export const callSendRemote = defineMemory({
  resource: "calls",
  method: "send_remote",
  name: "SendRemoteCall",
  input: z.strictObject({
    to: z.union([
      z.strictObject({ session: idSchema("ses"), ...machineRef }),
      agentAddressSchema.extend(machineRef),
      agentAddressSchema.extend({
        session: idSchema("ses"),
        fallback: z.literal("new"),
        ...machineRef,
      }),
    ]),
    reply: callReplySchema,
    body: contentBlocksSchema,
    dedup: z.string().min(1),
  }),
  output: agentCallSend.output,
  actors: ["agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "unavailable",
    "unauthorized",
  ],
});

export const MAIL_ROUTES = [a2aMail, callSendRemote] as const;

// 늦게 닿아 받는 기계의 대기 목록에 선 call mail 하나. 사람이 [Start now]나 [Skip]으로 정한다. text는 본문 글을 500자까지 자른 것이다.
export const mailHoldSchema = z.strictObject({
  origin: idSchema("mch"),
  mail: idSchema("mal"),
  computer: z.string(),
  from: mailAuthorSchema,
  address: remoteAddressSchema,
  // 주소가 project(기계 사이 이름 `pri_`)일 때 이 컴퓨터에서 그 id를 지금이나 옛 id로 가진 project의 이름이다. 없거나 private이면 null이다.
  project_name: z.string().nullable(),
  reply: callReplySchema,
  text: z.string(),
  sent_at: atSchema,
  arrived_at: atSchema,
  expires_at: atSchema,
});
export type MailHold = z.infer<typeof mailHoldSchema>;

// 대기 목록의 mail. 오래된 것부터다.
export const mailHolds = defineMemory({
  resource: "mail",
  method: "holds",
  name: "mail.holds",
  input: z.strictObject({}),
  output: z.strictObject({ holds: z.array(mailHoldSchema) }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 받는 기계의 사람이 대기 중인 mail을 정한다. 이미 정했거나 만료됐으면 conflict, 없으면 not_found다.
export const mailDecideHold = defineMemory({
  resource: "mail",
  method: "decide_hold",
  name: "mail.decide_hold",
  input: z.strictObject({
    origin: idSchema("mch"),
    mail: idSchema("mal"),
    decision: z.enum(["run_now", "skip"]),
  }),
  output: mailAppliedSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const MAIL_HOLD_ROUTES = [mailHolds, mailDecideHold] as const;
