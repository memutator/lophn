import { assert } from "@std/assert";
import { ROLE_CAPS } from "../../packages/core/lophn-agent/agents/mod.ts";
import { roleOperations } from "../../packages/core/lophn-agent/run-loop/mod.ts";
import { agentRuntimePolicies } from "./agent-runtime.ts";

Deno.test("lophn-agent/harness/run-loop#R15 [ctx-I55c]: 모든 역할의 operation 상한은 agent runtime의 agent 발급 policy 안에 있다", () => {
  const policy = new Set(
    agentRuntimePolicies([])
      .filter((entry) => entry.actors.includes("agent"))
      .map((entry) => entry.name),
  );
  assert(ROLE_CAPS.size > 0);
  for (const role of ROLE_CAPS.keys()) {
    const operations = roleOperations(role);
    assert(operations.length > 0, role);
    for (const name of operations) {
      assert(policy.has(name), `${role}: ${name}`);
    }
  }
});
