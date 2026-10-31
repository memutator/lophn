import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../base/mod.ts";
import type { ToolContext } from "../../lophn-agent/tools/spi.ts";
import { RUNTIME_TOOLS } from "./runtime.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

// 요약은 state 객체가 아니라 상태 이름을 보이고, unavailable이면 그 이유도 보인다.
test("app.status 요약이 상태 이름과 이유를 보이고 [object Object]를 싣지 않는다", async () => {
  const handler = RUNTIME_TOOLS.find((t) => t.name === "app.status")!.handler!;
  const cases = [
    {
      state: { state: "running", termination_pending: false },
      shows: ["running"],
    },
    {
      state: { state: "stopped", termination_pending: true },
      shows: ["stopped"],
    },
    {
      state: {
        state: "unavailable",
        termination_pending: false,
        reason: {
          code: "crash_loop",
          summary: "unexpected exits exceeded five within ten minutes",
        },
      },
      shows: [
        "unavailable",
        "crash_loop",
        "unexpected exits exceeded five within ten minutes",
      ],
    },
  ];
  for (const item of cases) {
    const result = await handler({ app: APP }, {
      core: () =>
        Promise.resolve(
          ok({
            app: APP,
            state: item.state,
            observation: null,
            observed_at: null,
            as_of_seq: "1",
            next_cursor: null,
          }),
        ),
    } as unknown as ToolContext);
    if (!result.ok) throw new Error("app.status failed");
    const line = result.value.summary;
    for (const shows of item.shows) {
      assert.ok(line.includes(shows), `${line} does not show ${shows}`);
    }
    assert.ok(!line.includes("[object Object]"), line);
  }
});
