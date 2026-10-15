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
  DECISION_HANDLE_CHANNEL,
} from "./confirmation-channels.ts";

const ID = /^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const CONCERN = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)+$/;
const DECISION = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const NONBLANK = /\S/;
// 공백만이 아닌 한 줄.
const ONE_LINE = /^[^\r\n]*\S[^\r\n]*$/;

function prefixed(prefix: string) {
  return z.string().regex(ID).refine((value) => value.startsWith(`${prefix}_`));
}

// provider 연결(Connect)의 값 아닌 등록 정보. provider는 아직 없고 정의는 core의 RegisterProvider가
// 다시 검사하므로 여기서는 모양만 본다. OAuth는 시작한 login handle을 싣는다.
const connectSchema = z.object({
  name: z.string().regex(NONBLANK),
  definition: z.record(z.string(), z.unknown()),
  endpoint: z.string().min(1),
  protocol: z.enum([
    "anthropic-messages",
    "openai-responses",
    "openai-chat-completions",
  ]),
  kind: z.enum(["api_key", "oauth"]),
  login: z.string().regex(NONBLANK).optional(),
}).strict().refine((value) =>
  (value.kind === "oauth") === (value.login !== undefined)
);

const ownerDecisionSchema = z.object({
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
}).strict();

// 창을 열 때 보내는 참조. command 본문·HTML·허락 값은 받지 않는다.
export const confirmationIntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approval_request"),
    approval: prefixed("apr"),
    preselect: z.enum(["allow_once", "allow_session", "deny"]).optional(),
  }).strict(),
  z.object({
    kind: z.literal("question_option_action"),
    group: prefixed("qgr"),
    option_key: z.string().min(1),
  }).strict(),
  ownerDecisionSchema,
  z.object({
    kind: z.literal("secret_input"),
    owner: z.string().min(1),
    purpose: z.string().min(1),
    connect: connectSchema.optional(),
    disconnect: z.literal(true).optional(),
  }).strict().refine(
    (value) =>
      (value.connect === undefined && value.disconnect === undefined) ||
      (value.purpose === "provider_credential" &&
        (value.connect === undefined || value.disconnect === undefined)),
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

// 창 없는 사람 결정 handle 요청. owner_decision 참조와 같은 칸이다.
export const decisionHandleRequestSchema = ownerDecisionSchema.omit({
  kind: true,
});

export type DecisionHandleRequest = z.infer<typeof decisionHandleRequestSchema>;

export type DecisionHandleReply =
  | { confirmation: string; expires_at: string }
  | { code: string; message: string };

export interface DecisionHandleApi {
  requestDecisionHandle(
    request: DecisionHandleRequest,
  ): Promise<DecisionHandleReply>;
}

export type ConfirmationOpen = z.infer<typeof confirmationOpenSchema>;
export type ConfirmationSubmitInput = z.infer<typeof confirmationSubmitSchema>;
