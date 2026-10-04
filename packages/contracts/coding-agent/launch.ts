import { z } from "zod";
import { absolutePathSchema, projectIdSchema } from "../documents/values.ts";
import { atSchema, seqSchema } from "../platform/values.ts";
import { connectionIdSchema } from "./connections.ts";
import { harnessIdSchema } from "./harnesses.ts";
import { ticketIdSchema } from "./ticket-values.ts";

// TUI 프로세스 env에는 connection 참조 값만 넘긴다(→ coding-agent/connection).
export const LOPHN_CONNECTION = "LOPHN_CONNECTION";

// 끝난 방식은 자기 터미널 안내와 terminal_tui 둘뿐이다(sessions#R1).
export const LAUNCH_METHODS = ["terminal_tui"] as const;

export const launchMethodSchema = z.literal("terminal_tui");

export type LaunchMethod = (typeof LAUNCH_METHODS)[number];

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
  env_names: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).min(1),
  first_prompt: z.string().min(1),
  prompt_delivery: promptDeliverySchema,
  human_start_handle: sessionKeySchema,
  operation_id: sessionKeySchema,
});

export type CodingAgentLaunchPlan = z.infer<typeof codingAgentLaunchPlanSchema>;

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
  human_start_handle: sessionKeySchema,
  operation_id: sessionKeySchema,
});

export type SessionPlanInput = z.infer<typeof sessionPlanInputSchema>;

export const sessionPlanOutputSchema = z.object({
  plan: codingAgentLaunchPlanSchema,
});

export type SessionPlanOutput = z.infer<typeof sessionPlanOutputSchema>;

export const sessionStartInputSchema = z.strictObject({
  plan: codingAgentLaunchPlanSchema,
});

export const sessionStartOutputSchema = z.object({
  result: launchResultBodySchema,
});

export const sessionStartAtSchema = atSchema;
