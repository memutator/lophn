import { z } from "zod";
import { absolutePathSchema, projectIdSchema } from "../documents/values.ts";
import { idSchema } from "../platform/ids.ts";
import { atSchema, seqSchema } from "../platform/values.ts";
import {
  connectionIdSchema,
  connectionScopeSchema,
  connectionStateSchema,
} from "./connections.ts";
import { harnessIdSchema } from "./harnesses.ts";
import { ticketScreenStateSchema } from "./ticket-screen.ts";
import { sourceRelativePathSchema, ticketIdSchema } from "./ticket-values.ts";

// TUI 프로세스 env에는 connection 참조 값만 넘긴다(→ coding-agent/connection).
export const LOPHN_CONNECTION = "LOPHN_CONNECTION";

// 끝난 방식은 자기 터미널 안내와 terminal_tui 둘뿐이다(sessions#R1).
export const LAUNCH_METHODS = ["terminal_tui"] as const;

export const launchMethodSchema = z.literal("terminal_tui");

export type LaunchMethod = (typeof LAUNCH_METHODS)[number];

// 자기 터미널 안내는 lophn이 process를 열지 않는 방식이다(sessions#R1). plan이 아니라 안내를 낸다.
export const OWN_TERMINAL_METHOD = "own_terminal";

// 결과 유실·재시작은 실패도 성공도 아니다. 이유와 함께 unknown으로 둔다.
export const LAUNCH_RESULTS = ["started", "unknown", "failed"] as const;

export const launchResultSchema = z.enum(LAUNCH_RESULTS);

export type LaunchResult = z.infer<typeof launchResultSchema>;

// one-use handle·local key다. approval entity 아니다(→ coding-agent/sessions).
const sessionKeySchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value) && !value.startsWith("-"),
  { message: "session key" },
);

// 잘못된 대상을 재검사 없이 spawn하지 않는다. shell main이 검증한 값을 받는다.
export const launchResultBodySchema = z.object({
  result: launchResultSchema,
  terminal_ref: z.string().min(1).nullable(),
  runtime_ref: z.string().min(1).nullable(),
  generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reason: z.string().min(1).nullable(),
}).refine(
  (value) =>
    (value.result === "started") === (value.runtime_ref !== null) &&
    ((value.result === "unknown") || (value.result === "failed")) ===
      (value.reason !== null),
  { message: "launch result needs a runtime_ref or a reason" },
).refine(
  (value) => (value.result === "started") === (value.generation !== 0),
  { message: "generation follows the result" },
);

export type LaunchResultBody = z.infer<typeof launchResultBodySchema>;

// readiness 신호는 adapter가 정하고 기한은 spawn부터 센다(sessions#R5).
export const PROMPT_DELIVERY_MODES = ["argv", "stdin_after_ready"] as const;

export const promptDeliveryModeSchema = z.enum(PROMPT_DELIVERY_MODES);

export type PromptDeliveryMode = z.infer<typeof promptDeliveryModeSchema>;

export const PROMPT_DELIVERY_DEADLINE_MS = 10_000;

export const promptDeliverySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("argv") }),
  z.strictObject({
    mode: z.literal("stdin_after_ready"),
    readiness: z.string().min(1),
    deadline_ms: z.literal(
      PROMPT_DELIVERY_DEADLINE_MS,
    ),
  }),
]);

export type PromptDelivery = z.infer<typeof promptDeliverySchema>;

export const CODING_AGENT_LAUNCH_METHOD = "terminal_tui";

const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

// 시작 대상이지 claim 아니다. 실제 작업 권리는 → coding-agent/tickets다.
export const codingAgentLaunchPlanSchema = z.object({
  ticket: ticketIdSchema,
  ticket_revision: seqSchema,
  harness_id: harnessIdSchema,
  catalog_revision: z.string().min(1),
  adapter_revision: z.string().min(1),
  environment: z.object({
    kind: z.enum(["host", "wsl", "remote"]),
    identity: z.string().min(1),
  }),
  profile_id: z.string().min(1).nullable(),
  connection: connectionIdSchema,
  project: projectIdSchema,
  folder_ref: z.string().min(1),
  cwd: absolutePathSchema,
  method: launchMethodSchema,
  executable: absolutePathSchema,
  argv: z.array(z.string()).min(1),
  env_names: z.array(envNameSchema).min(1),
  // env_names가 가리키는 overlay 값이다(TERM 같은 안전 값과 `LOPHN_CONNECTION` 참조). token 원문은 없다.
  // `LOPHN_TERMINAL_OBSERVE`는 host가 더한다. 없으면 overlay 없음이다.
  env_overlay: z.record(
    envNameSchema,
    z.string().refine((value) => !/\p{Cc}/u.test(value)),
  ).optional(),
  // 상속된 다른 terminal·connection 식별 값을 지울 이름이다. host는 overlay 뒤에 한 번 더 지운다.
  env_delete: z.array(envNameSchema).optional(),
  first_prompt: z.string().min(1),
  prompt_delivery: promptDeliverySchema,
  human_start_handle: sessionKeySchema,
  operation_id: sessionKeySchema,
});

export type CodingAgentLaunchPlan = z.infer<typeof codingAgentLaunchPlanSchema>;

// shell main이 user 자격으로 다시 읽은 현재 사실이다. plan child는 core를 읽지 않고(connection credential
// 전달은 등록된 child만 받는다) 이 값을 쓴다. 없으면 plan은 시작하지 않는다(sessions#R4).
export const sessionPlanFactsSchema = z.object({
  ticket_app: idSchema("app"),
  screen_state: ticketScreenStateSchema,
  connection_state: connectionStateSchema,
  connection_scope: connectionScopeSchema,
  // 첫 prompt의 근거 읽을 곳이다. 본문이 아니라 참조뿐이다.
  problems: z.array(idSchema("prb")).max(12),
  inspect: z.array(sourceRelativePathSchema).max(20),
});

export type SessionPlanFacts = z.infer<typeof sessionPlanFactsSchema>;

// `lophn session plan --json`의 stdin. shell main이 클릭을 검증한 뒤 넘긴다.
export const sessionPlanInputSchema = z.object({
  ticket: ticketIdSchema,
  ticket_revision: seqSchema,
  connection: connectionIdSchema,
  harness_id: harnessIdSchema.optional(),
  profile_id: z.string().min(1).nullable().optional(),
  project: projectIdSchema.optional(),
  folder_ref: z.string().min(1).optional(),
  cwd: absolutePathSchema,
  method: z.string().min(1),
  facts: sessionPlanFactsSchema.optional(),
  human_start_handle: sessionKeySchema,
  operation_id: sessionKeySchema,
});

export type SessionPlanInput = z.infer<typeof sessionPlanInputSchema>;

export const sessionPlanOutputSchema = z.object({
  plan: codingAgentLaunchPlanSchema,
});

export type SessionPlanOutput = z.infer<typeof sessionPlanOutputSchema>;

// 자기 터미널 방식의 안내다. 사람이 직접 harness를 열고 아래 prompt로 시작한다.
export const sessionGuideSchema = z.object({
  method: z.literal(OWN_TERMINAL_METHOD),
  ticket: ticketIdSchema,
  harness_id: harnessIdSchema.nullable(),
  first_prompt: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
});

export type SessionGuide = z.infer<typeof sessionGuideSchema>;

export const sessionPlanGuideOutputSchema = z.object({
  guide: sessionGuideSchema,
});

export const sessionStartInputSchema = z.strictObject({
  plan: codingAgentLaunchPlanSchema,
});

export const sessionStartOutputSchema = z.object({
  result: launchResultBodySchema,
});

export const sessionStartAtSchema = atSchema;
