// 보호 창 IPC. 모양은 contracts shell confirmation과 같다. shell tsc는 packages를 보지 않으므로
// 통로에 필요한 schema만 여기 둔다. 일반 preload는 창 열기만, 보호 preload는 표시·제출·취소만 한다.
import { z } from "zod";

export {
  CONFIRMATION_CANCEL_CHANNEL,
  CONFIRMATION_DISPLAY_CHANNEL,
  CONFIRMATION_ENDED_CHANNEL,
  CONFIRMATION_ENDED_KINDS,
  CONFIRMATION_OPEN_CHANNEL,
  CONFIRMATION_SUBMIT_CHANNEL,
  type ConfirmationEnded,
  type ConfirmationEndedKind,
} from "./confirmation-channels.ts";

const ID = /^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const CONCERN = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)+$/;
const DECISION = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const NONBLANK = /\S/;
// 공백만이 아닌 한 줄(problems/closing#R8).
const ONE_LINE = /^[^\r\n]*\S[^\r\n]*$/;

function prefixed(prefix: string) {
  return z.string().regex(ID).refine((value) => value.startsWith(`${prefix}_`));
}

const credentialSchema = z.object({
  key: z.string().regex(NONBLANK),
  kind: z.enum(["api_key", "oauth"]),
  label: z.string().regex(NONBLANK),
  account: z.string().regex(NONBLANK).nullable(),
  organization: z.string().regex(NONBLANK).nullable(),
  plan: z.string().regex(NONBLANK).nullable(),
  dedup_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict();

// 창을 열 때 보내는 참조. command 본문·HTML·허락 값은 받지 않는다.
export const confirmationIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approval_request"), approval: prefixed("apr") })
    .strict(),
  z.object({
    kind: z.literal("question_option_action"),
    question: prefixed("qst"),
    option_key: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("owner_decision"),
    concern: z.string().regex(CONCERN),
    decision: z.string().regex(DECISION),
    targets: z.array(z.string().regex(ID)).min(1).refine((values) =>
      new Set(values).size === values.length
    ).optional(),
    automation: z.string().min(1).optional(),
    requirement: z.number().int().nonnegative().optional(),
    choice: z.enum(["fixed", "not_fixed", "not_visible", "dismiss"]).optional(),
    note: z.string().regex(ONE_LINE).optional(),
  }).strict(),
  z.object({
    kind: z.literal("secret_input"),
    owner: z.string().min(1),
    purpose: z.string().min(1),
    credential: credentialSchema.optional(),
    change: z.object({
      key: z.string().regex(NONBLANK),
      action: z.enum(["replace", "revoke"]),
    }).strict().optional(),
  }).strict().refine(
    (value) =>
      (value.credential === undefined && value.change === undefined) ||
      (value.purpose === "provider_credential" &&
        (value.credential === undefined || value.change === undefined)),
  ),
]);

export const confirmationOpenSchema = z.object({
  request: confirmationIntentSchema,
  parentWindow: z.string().min(1),
}).strict();

// input은 그 결정의 입력이다(거절 이유, secret 값). 결과로 나가지 않는다.
export const confirmationSubmitSchema = z.object({
  displayId: z.string().min(1),
  decision: z.string().regex(DECISION),
  input: z.record(z.string(), z.unknown()).optional(),
  confirmedSecond: z.boolean().optional(),
}).strict();

export type ConfirmationOpen = z.infer<typeof confirmationOpenSchema>;
export type ConfirmationSubmitInput = z.infer<typeof confirmationSubmitSchema>;
