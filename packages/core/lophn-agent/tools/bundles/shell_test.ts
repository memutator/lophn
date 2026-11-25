import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type {
  TurnRequest,
  TurnRequestOutcome,
} from "../../../../protocol/approvals/mod.ts";
import {
  createToolGate,
  type ToolGateApprovals,
} from "../../tool-judgment/mod.ts";
import type { ToolContext } from "../tool-context.ts";
import { executeToolCall } from "../work.ts";
import { SHELL_TOOLS } from "./shell.ts";

const SES = "ses_0000000000000000000000000a";
const TRN = "trn_0000000000000000000000000a";
const TCL = "tcl_0000000000000000000000000a";
const APR = "apr_0000000000000000000000000a";

test("attended turn에서 ask 판정에 걸린 shell 명령은 사람이 허락하기 전에 실행되지 않는다", async () => {
  const waiters = new Map<string, (outcome: TurnRequestOutcome) => void>();
  const opened: TurnRequest[] = [];
  const approvals: ToolGateApprovals = {
    judge: async () =>
      ok({
        kind: "ask",
        reason: "shell command requires approval",
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
      }),
    openTurnRequest(origin, subject, options) {
      const request: TurnRequest = {
        id: APR,
        session: origin.session as TurnRequest["session"],
        turn: origin.turn as TurnRequest["turn"],
        tool_call: origin.tool_call as TurnRequest["tool_call"],
        subject,
        always_patterns: [],
        allowed_choices: [...(options?.allowedChoices ?? ["once", "reject"])],
        reason: options?.reason ?? null,
        outside_rewind: options?.outsideRewind ?? true,
        to_parent: origin.toParent,
        created_at: "2026-01-01T00:00:00.000Z",
      };
      opened.push(request);
      return ok(request);
    },
    waitTurnDecision(request) {
      return new Promise<TurnRequestOutcome>((resolve) => {
        waiters.set(request, resolve);
      });
    },
  };
  const toolGate = createToolGate({ approvals });
  let ran = 0;
  const definition = {
    ...SHELL_TOOLS[0]!,
    handler: () => {
      ran++;
      return Promise.resolve(
        ok({
          status: "success" as const,
          summary: "ran",
          content: null,
          complete: true,
          source: null,
          continuation: null,
          pending: [],
        }),
      );
    },
  };
  const agent = "lophn_home";
  const ctx = {
    listed: [definition],
    agent,
    session: SES,
    turn: TRN,
    tool_call: TCL,
    mode: "attended",
    workspace: null,
    gate: {
      check: (input: { tool_call: string; tool: string; call: never }) =>
        toolGate.check({
          session: SES,
          turn: TRN,
          toolCall: input.tool_call,
          tool: input.tool,
          call: input.call,
          agent,
          workspace: null,
          mode: "attended",
          toParent: false,
        }),
    },
  } as unknown as ToolContext;

  const call = async (outcome: TurnRequestOutcome) => {
    opened.length = 0;
    const running = executeToolCall(ctx, "shell_run", {
      command: "rm -r build",
    });
    while (opened.length === 0) {
      await Promise.resolve();
    }
    assert.deepStrictEqual(ran, 0);
    const resolve = waiters.get(opened[0]!.id)!;
    waiters.delete(opened[0]!.id);
    resolve(outcome);
    return await running;
  };

  const rejected = await call({ outcome: "reject", reason: null });
  assert.deepStrictEqual(rejected.outcome, {
    kind: "not_executed",
    code: "rejected",
  });
  assert.deepStrictEqual(ran, 0);

  const allowed = await call({ outcome: "allow", scope: "once" });
  assert.deepStrictEqual(allowed.executed, true);
  assert.deepStrictEqual(ran, 1);
});
