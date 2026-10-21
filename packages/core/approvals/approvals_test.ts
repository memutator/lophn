import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import { createApprovals } from "./mod.ts";

const SES = "ses_0000000000000000000000000a";

Deno.test("사람이 아닌 자격은 turn request를 결정하지 못한다", async () => {
  const clock = manualClock(Date.UTC(2026, 0, 1));
  const approvals = createApprovals({
    assignmentOf: (agent) => Promise.resolve(ok({ agent, entries: [] })),
    shellRules: () => ({ floor: [], layers: [] }),
    bus: { publish: () => {} },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const opened = approvals.openTurnRequest({
    session: SES,
    turn: "trn_0000000000000000000000000a",
    tool_call: "tcl_0000000000000000000000000a",
    place: null,
  }, { kind: "shell", command: "rm -r x" });
  assert(opened.ok);

  for (const actor of [`agent:${SES}`, `coding_agent:${SES}`, "machine"]) {
    const refused = await approvals.decide({ actor }, {
      session: SES,
      request: opened.value.id,
      choice: { kind: "once" },
    });
    assert(!refused.ok && refused.error.code === "forbidden");
  }
  // 요청은 그대로 기다린다.
  assertEquals(approvals.turnRequests(SES).map((one) => one.id), [
    opened.value.id,
  ]);
});
