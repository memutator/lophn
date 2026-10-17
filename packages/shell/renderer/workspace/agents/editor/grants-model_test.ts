import { assertEquals } from "@std/assert";

import type { AgentGrantEntry } from "../../../../../protocol/approvals/grants.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import { agentEntryOf, callPick, KEPT, withCallPick } from "./grants-model.ts";

const agent = { role: "coding_agent", app: "app_a" } as CallAgent;

Deno.test("agent 부르기를 끄면 줄이 excluded로 남고, 줄 없는 agent는 켜진 것으로 읽힌다", () => {
  assertEquals(callPick(agentEntryOf([], agent)), KEPT);

  const off = withCallPick([], agent, { removed: true });
  assertEquals(off, [{ kind: "agent", agent, setting: "excluded" }]);
  assertEquals(callPick(agentEntryOf(off, agent)), { removed: true });

  const on = withCallPick(off, agent, { removed: false });
  assertEquals(on as AgentGrantEntry[], []);
});
