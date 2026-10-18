import { assertEquals } from "@std/assert";
import type { Metrics, TrialResult } from "../types.ts";
import { createCap } from "./cap.ts";
import { runTrials } from "./trials.ts";

function trial(index: number, cost: number): { result: TrialResult } {
  return {
    result: {
      index,
      settle: { kind: "idle", unstarted: [] },
      checks: [],
      judge: [],
      metrics: { cost_usd: cost, unpriced_calls: 0 } as Metrics,
    },
  };
}

Deno.test("runTrials: stops launching trials past the cap and keeps finished ones", async () => {
  const cap = createCap(1);
  const out = await runTrials(5, (i) => Promise.resolve(trial(i, 0.6)), cap);
  assertEquals(out.outcomes.map((o) => o.result.index), [0, 1]);
  assertEquals(out.stoppedByCap, true);
  assertEquals(cap.total(), 1.2);
});
