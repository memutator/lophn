import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../../base/mod.ts";
import { createApprovals } from "../../../approvals/mod.ts";
import { shellRuleLayers } from "../../../approvals/shell-rules/mod.ts";
import { createToolGate } from "../../tool-judgment/mod.ts";
import type { ToolContext } from "../tool-context.ts";
import { executeToolCall } from "../work.ts";
import { SHELL_TOOLS } from "./shell.ts";

const SES = "ses_0000000000000000000000000a";
const TRN = "trn_0000000000000000000000000a";
const TCL = "tcl_0000000000000000000000000a";

Deno.test("attended turn에서 ask 규칙에 걸린 shell 명령은 사람이 허락하기 전에 실행되지 않는다", async () => {
  const clock = manualClock(Date.UTC(2026, 0, 1));
  const approvals = createApprovals({
    assignmentOf: (agent) => Promise.resolve(ok({ agent, entries: [] })),
    shellRules: (place) => shellRuleLayers({ global: [], projects: {} }, place),
    bus: { publish: () => {} },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const toolGate = createToolGate({ approvals });
  let ran = 0;
  const definition = {
    ...SHELL_TOOLS[0]!,
    handler: () => {
      ran++;
      return Promise.resolve(ok({
        status: "success" as const,
        summary: "ran",
        content: null,
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      }));
    },
  };
  const agent = { role: "lophn" as const };
  const ctx = {
    listed: [definition],
    agent,
    session: SES,
    turn: TRN,
    tool_call: TCL,
    mode: "attended",
    place: null,
    gate: {
      check: (input: { tool_call: string; tool: string; call: never }) =>
        toolGate.check({
          session: SES,
          turn: TRN,
          toolCall: input.tool_call,
          tool: input.tool,
          call: input.call,
          agent,
          place: null,
          mode: "attended",
        }),
    },
  } as unknown as ToolContext;

  // request가 열릴 때까지 microtask만 넘긴다.
  const call = async (choice: { kind: "once" } | { kind: "reject" }) => {
    const running = executeToolCall(ctx, "shell_run", {
      command: "rm -r build",
    });
    while (approvals.turnRequests(SES).length === 0) {
      await Promise.resolve();
    }
    assertEquals(ran, 0);
    const [request] = approvals.turnRequests(SES);
    const decided = await approvals.decide({ actor: "user" }, {
      session: SES,
      request: request!.id,
      choice,
    });
    assert(decided.ok);
    return await running;
  };

  const rejected = await call({ kind: "reject" });
  assertEquals(rejected.outcome, { kind: "not_executed", code: "rejected" });
  assertEquals(ran, 0);

  const allowed = await call({ kind: "once" });
  assertEquals(allowed.executed, true);
  assertEquals(ran, 1);
});
