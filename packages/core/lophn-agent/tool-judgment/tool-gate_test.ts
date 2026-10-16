import { assertEquals } from "@std/assert";
import { canonicalize, err, ok } from "../../../base/mod.ts";
import type {
  GateVerdict,
  Intent,
  TurnDecision,
} from "../../../protocol/approvals/mod.ts";
import { createToolGate, type ToolGateCall } from "./tool-gate.ts";

const APP = "app_0000000000000000000000000a";
const call = {
  session: "ses_0000000000000000000000000a",
  turn: "trn_0000000000000000000000000a",
  toolCall: "tcl_0000000000000000000000000a",
  agent: { role: "lophn" },
  tool: `app__${APP}__notes.add`,
  input: { text: "hi" },
} as ToolGateCall;

// 열 때의 지문과 실행 직전의 지문을 비교하는 Approvals fake. 허락은 한 번만 쓰인다.
function setup(verdict: GateVerdict, decision: TurnDecision) {
  const live = { api: "notes.add" };
  let opened = "";
  let used = false;
  const gate = createToolGate({
    approvals: {
      judge: () => Promise.resolve(ok(verdict)),
      openTurnRequest: (intent: Intent) => {
        opened = canonicalize(intent);
        return ok({ id: "apr_0000000000000000000000000a" } as never);
      },
      waitTurnDecision: () => Promise.resolve(decision),
      consumeTurnAllow: (_request: string, current: Intent) => {
        if (used || canonicalize(current) !== opened) {
          return Promise.resolve(err({ code: "conflict", message: "changed" }));
        }
        used = true;
        return Promise.resolve(ok(undefined));
      },
    },
    resolve: () =>
      ok({
        kind: "app_api" as const,
        target: { kind: "app_api", app: APP, api: live.api } as never,
        effect: "write" as const,
      }),
  });
  return { gate, live };
}

Deno.test("허락은 그 intent에 한 번만 쓰이고 실행 직전에 달라졌으면 실행하지 않는다", async () => {
  const ask: GateVerdict = { verdict: "ask" };
  const once: TurnDecision = { outcome: "allow", scope: "once" };

  assertEquals(await setup(ask, once).gate.check(call), { kind: "run" });

  // 허락을 기다리는 동안 대상이 달라졌다.
  const moved = setup(ask, once);
  const wait = moved.gate;
  const pending = wait.check(call);
  moved.live.api = "notes.remove";
  assertEquals(await pending, { kind: "changed" });

  assertEquals(
    await setup(ask, { outcome: "reject", reason: "no" }).gate.check(call),
    { kind: "rejected", reason: "no" },
  );
  assertEquals(
    await setup(ask, { outcome: "cancelled", cause: "turn_ended" }).gate.check(
      call,
    ),
    { kind: "cancelled", cause: "turn_ended" },
  );
  assertEquals(
    await setup({ verdict: "deny", reason: "excluded" }, once).gate.check(call),
    { kind: "denied", reason: "excluded" },
  );
});
