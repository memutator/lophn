import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scenario } from "../types.ts";
import { callCount } from "./calls.ts";
import { fixtureSession, fixtureTrial } from "./fixtures.ts";
import { validateFixtures } from "./validate.ts";

const sent = fixtureTrial([
  fixtureSession({ role: "lophn" }, [
    { call: { to: { role: "lophn" }, reply: "none" } },
  ]),
]);
const empty = fixtureTrial([fixtureSession({ role: "lophn" }, [])]);

const scenario = (fx: Scenario["fixtures"]): Scenario => ({
  id: "x",
  n: 1,
  proposal: false,
  world: [],
  real: [],
  steps: [],
  checks: [callCount("one", { count: 1 })],
  fixtures: fx,
});

test("fixture가 check와 어긋나면 validateFixtures가 문제로 보고한다", async () => {
  const ok = await validateFixtures([
    scenario({ right: [sent], wrong: [{ trial: empty, fails: ["one"] }] }),
  ]);
  assert.deepStrictEqual(ok, { ok: true, problems: [] });

  const bad = await validateFixtures([
    scenario({
      right: [empty], // 떨어지는 right
      wrong: [
        { trial: sent, fails: ["one"] }, // 통과하는 wrong
        { trial: empty, fails: [] }, // fails가 빔
        { trial: empty, fails: ["nope"] }, // 없는 check
      ],
    }),
  ]);
  assert.deepStrictEqual(bad.ok, false);
  assert.deepStrictEqual(bad.problems.length, 4);
});
