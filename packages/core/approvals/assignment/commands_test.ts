import { assertEquals } from "@std/assert";
import { agentAssignmentSetCommand } from "./commands.ts";

const rows = [
  ["agent:ses_0000000000000000000000000a"],
  ["coding_agent:ses_0000000000000000000000000a"],
  ["app:app_0000000000000000000000000a"],
  ["machine"],
];

Deno.test("사람이 아닌 자격으로 SetAgentAssignment를 부르면 forbidden이다", () => {
  for (const [actor] of rows) {
    const result = agentAssignmentSetCommand.handle(
      undefined as never,
      { actor } as never,
      { agent: { role: "lophn" }, entries: [] },
      { revision: 0 },
    );
    assertEquals(!result.ok && result.error.code, "forbidden", actor);
  }
});
