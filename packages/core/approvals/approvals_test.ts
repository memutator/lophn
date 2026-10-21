import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { AgentGrant, Intent } from "../../protocol/approvals/mod.ts";
import { createApprovals, createSessionAllowances, gate } from "./mod.ts";

const APP = "app_0000000000000000000000000a";
const AGENT = { role: "lophn" } as const;
const SES = "ses_0000000000000000000000000a";
const OTHER_SES = "ses_0000000000000000000000000b";

function externalCall(session: string, input = {}): Intent {
  return {
    kind: "app_tool",
    actor: { kind: "agent", agent: AGENT, session },
    target: { kind: "app_tool", app: APP, tool: "mail.send" },
    effect: "external",
    input,
    origin: {
      kind: "turn",
      session,
      turn: "trn_0000000000000000000000000a",
      tool_call: "tcl_0000000000000000000000000a",
    },
  };
}

function makeKit() {
  const clock = manualClock(Date.UTC(2026, 0, 1));
  const ids = createIdSource({ clock, random: seededRandom(1) });
  const grant: AgentGrant = {
    agent: AGENT,
    entries: [{ kind: "app", app: APP, tools: [] }],
  };
  // 같은 메모리를 새로 만들어 재시작을 흉내 낸다.
  const build = () =>
    createApprovals({
      gate,
      grants: {
        appGrants: () => Promise.resolve(ok([])),
        agentGrant: () => Promise.resolve(ok(grant)),
        reactionGrant: () =>
          Promise.resolve(ok({
            ReleaseActivationFailed: "on",
          })),
        setAlways: () => Promise.resolve(ok(undefined)),
      },
      allowances: createSessionAllowances(),
      bus: { publish: () => {} },
      clock,
      ids,
    });
  return { build };
}

Deno.test("이 session 동안 허락은 같은 session에서만 쓰이고 재시작에 남지 않는다", async () => {
  const { build } = makeKit();
  const approvals = build();
  const asks = async (session: string, from = approvals) => {
    const verdict = await from.judge(externalCall(session));
    assert(verdict.ok);
    return verdict.value.verdict;
  };
  assertEquals(await asks(SES), "ask");

  const opened = approvals.openTurnRequest(externalCall(SES));
  assert(opened.ok);
  const decided = await approvals.decideTurn({ actor: "user" }, {
    session: SES,
    request: opened.value.id,
    choice: { kind: "session" },
  });
  assert(decided.ok);
  assertEquals(await asks(SES), "run");
  assertEquals(await asks(OTHER_SES), "ask");

  // 재시작: 메모리가 사라진다.
  assertEquals(await asks(SES, build()), "ask");

  // 사람이 아니면 결정하지 못한다. 요청은 그대로 기다린다.
  const waiting = approvals.openTurnRequest(externalCall(SES, { to: "x" }));
  assert(waiting.ok);
  const forbidden = await approvals.decideTurn({ actor: "agent" }, {
    session: SES,
    request: waiting.value.id,
    choice: { kind: "once" },
  });
  assert(!forbidden.ok && forbidden.error.code === "forbidden");
  assertEquals(approvals.turnRequests(SES).map((one) => one.id), [
    waiting.value.id,
  ]);
});

Deno.test("허락은 그 intent에 한 번만 쓰인다", async () => {
  const { build } = makeKit();
  const approvals = build();
  const allowOnce = async (intent: Intent) => {
    const opened = approvals.openTurnRequest(intent);
    assert(opened.ok);
    const decided = await approvals.decideTurn({ actor: "user" }, {
      session: SES,
      request: opened.value.id,
      choice: { kind: "once" },
    });
    assert(decided.ok);
    return opened.value.id;
  };
  const codeOf = (result: { ok: boolean; error?: { code: string } }) =>
    result.ok ? "ok" : result.error?.code;

  const intent = externalCall(SES);
  const id = await allowOnce(intent);
  assertEquals(codeOf(await approvals.consumeTurnAllow(id, intent)), "ok");
  assertEquals(
    codeOf(await approvals.consumeTurnAllow(id, intent)),
    "conflict",
  );

  const changed = await allowOnce(intent);
  assertEquals(
    codeOf(
      await approvals.consumeTurnAllow(
        changed,
        externalCall(SES, { to: "y" }),
      ),
    ),
    "conflict",
  );
});
