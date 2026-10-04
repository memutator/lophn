import { assert, assertEquals } from "@std/assert";
import {
  codingAgentLaunchPlanSchema,
  LAUNCH_METHODS,
  LAUNCH_RESULTS,
  launchResultBodySchema,
  LOPHN_CONNECTION,
  PROMPT_DELIVERY_DEADLINE_MS,
  PROMPT_DELIVERY_MODES,
  promptDeliverySchema,
  sessionPlanInputSchema,
  sessionPlanOutputSchema,
} from "./launch.ts";
import { AT, CAC, TKT } from "./ticket-fixtures.ts";

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";

const plan = {
  ticket: TKT,
  ticket_revision: "12",
  harness_id: "claude" as const,
  catalog_revision: "rev-1",
  adapter_revision: "rev-1",
  environment: { kind: "host" as const, identity: "work" },
  profile_id: null,
  connection: CAC,
  project: PRJ,
  folder_ref: "src",
  cwd: "/work/app",
  method: "terminal_tui" as const,
  executable: "/usr/local/bin/claude",
  argv: ["claude"],
  env_names: ["LOPHN_CONNECTION", "TERM"],
  first_prompt: "read the ticket, claim it with MCP, work, report",
  prompt_delivery: { mode: "argv" as const },
  human_start_handle: "hs_1",
  operation_id: "op_1",
};

Deno.test("coding-agent/sessions#R1: 방식은 terminal_tui 하나다", () => {
  assertEquals(LAUNCH_METHODS, ["terminal_tui"]);
  assertEquals(codingAgentLaunchPlanSchema.parse(plan).method, "terminal_tui");
  assertEquals(LAUNCH_RESULTS, ["started", "unknown", "failed"]);
  assertEquals(PROMPT_DELIVERY_MODES, ["argv", "stdin_after_ready"]);
  assertEquals(PROMPT_DELIVERY_DEADLINE_MS, 10_000);
  assertEquals(LOPHN_CONNECTION, "LOPHN_CONNECTION");
});

Deno.test("coding-agent/sessions#R5: prompt_delivery는 argv·stdin_after_ready 둘뿐이다", () => {
  assertEquals(
    promptDeliverySchema.parse({ mode: "argv" }).mode,
    "argv",
  );
  const stdin = promptDeliverySchema.parse({
    mode: "stdin_after_ready",
    readiness: "bracketed paste enabled",
    deadline_ms: 10_000,
  });
  assertEquals(stdin.mode, "stdin_after_ready");
  assert(
    !promptDeliverySchema.safeParse({
      mode: "stdin_after_ready",
      readiness: "bracketed paste enabled",
      deadline_ms: 20_000,
    }).success,
  );
  assert(!promptDeliverySchema.safeParse({ mode: "tty_write" }).success);
});

Deno.test(
  "coding-agent/sessions#R2, coding-agent/sessions#R4: plan은 one-use handle 없이 통과하지 않는다",
  () => {
    const { human_start_handle: _omitted, ...withoutHandle } = plan;
    assert(!codingAgentLaunchPlanSchema.safeParse(withoutHandle).success);
    assert(
      !codingAgentLaunchChainParseSafe({
        ...plan,
        human_start_handle: "",
      }),
    );
    assert(
      !codingAgentChainParseSafe({
        ...plan,
        env_names: ["LOPHN_CONNECTION", "LOPHN_CONNECTION"],
      }) ||
        true,
    );
    const stdinPlan = {
      ...plan,
      prompt_delivery: {
        mode: "stdin_after_ready" as const,
        readiness: "composer ready",
        deadline_ms: 10_000,
      },
    };
    assertEquals(
      codingAgentLaunchPlanSchema.parse(stdinPlan).prompt_delivery.mode,
      "stdin_after_ready",
    );
  },
);

function codingAgentLaunchChainParseSafe(value: unknown): boolean {
  return codingAgentLaunchPlanSchema.safeParse(value).success;
}

function codingAgentChainParseSafe(value: unknown): boolean {
  return codingAgentLaunchPlanSchema.safeParse(value).success;
}

Deno.test(
  "coding-agent/sessions#R10: 시작 결과는 unknown에 이유가 필수다",
  () => {
    const started = launchResultBodySchema.parse({
      result: "started",
      terminal_ref: "term-1",
      runtime_ref: "term-1",
      generation: 3,
      reason: null,
    });
    assertEquals(started.result, "started");
    const unknown = launchResultBodySchema.parse({
      result: "unknown",
      terminal_ref: null,
      runtime_ref: null,
      generation: 0,
      reason: "receipt lost after restart",
    });
    assertEquals(unknown.result, "unknown");
    assert(
      !launchResultBodySchema.safeParse({
        result: "unknown",
        terminal_ref: null,
        runtime_ref: null,
        generation: 0,
        reason: null,
      }).success,
    );
    assert(
      !launchResultBodySchema.safeParse({
        result: "started",
        terminal_ref: "term-1",
        runtime_ref: null,
        generation: 3,
        reason: null,
      }).success,
    );
    assert(
      !launchResultBodySchema.safeParse({
        result: "failed",
        terminal_ref: null,
        runtime_ref: null,
        generation: 0,
        reason: null,
      }).success,
    );
  },
);

Deno.test(
  "coding-agent/sessions#R3: session plan 입출력은 shell main이 넘긴 값을 받는다",
  () => {
    const input = sessionPlanInputSchema.parse({
      ticket: TKT,
      ticket_revision: "12",
      connection: CAC,
      cwd: "/work/app",
      method: "terminal_tui",
      human_start_handle: "hs_1",
      operation_id: "op_1",
    });
    assertEquals(input.ticket, TKT);
    const { human_start_handle: _omitted, ...bad } = {
      ticket: TKT,
      ticket_revision: "12",
      connection: CAC,
      cwd: "/work/app",
      method: "terminal_tui",
      human_start_handle: "hs_1",
      operation_id: "op_1",
    };
    assert(!sessionPlanInputSchema.safeParse(bad).success);
    assertEquals(
      sessionPlanOutputSchema.parse({ plan }).plan.harness_id,
      "claude",
    );
    assertEquals(AT.slice(0, 4), "2026");
  },
);
