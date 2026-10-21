import type { Scenario, Settle, TrialRecord } from "../../types.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../../../support/fake-server/mod.ts";
import type { AssemblyReport } from "../spec/mod.ts";
import { firstDivergence, sideStat } from "./compare.ts";
import { type Boundary, prefixBoundaries } from "./prefix.ts";
import { scriptOf } from "./script.ts";

// ex-cli가 구현한다. checkout의 core를 새 data root에 띄워 시나리오를 runner와 똑같이 돌리고,
// `real` 참가자의 model이 endpoint(fake provider)를 향하게 한다. judge와 program check는 돌리지 않는다.
export type ReplayPort = {
  run(args: {
    scenario: Scenario;
    checkout: string | null;
    model: string;
    endpoint: string;
  }): Promise<{ settle: Settle }>;
};

type Args = {
  run: string;
  trial: TrialRecord;
  scenario: Scenario;
  model: string;
  checkout: string | null;
};

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export async function measureAssembly(
  deps: { port: ReplayPort; startFake?: () => Promise<FakeServer> },
  args: Args,
): Promise<AssemblyReport> {
  const { run, trial, scenario } = args;
  const base: AssemblyReport = {
    run,
    trial: trial.index,
    session: null,
    status: "not_replayable",
    reason: null,
    diverged_at: null,
    compared_calls: 0,
    identical_calls: 0,
    baseline: null,
    variant: null,
  };
  // 사람 역할은 fake provider 재생에 없다.
  if (scenario.human !== undefined) {
    return {
      ...base,
      reason: "scenario has a human role; not replayed",
    };
  }
  const script = scriptOf(trial);
  if (!script.ok) return { ...base, reason: script.error.message };
  const { session, requests, replies } = script.value;
  const withSession = { ...base, session };

  const fake = await (deps.startFake ?? startFakeServer)();
  let settle: Settle;
  try {
    fake.script(replies.map((reply) => ({ reply })));
    settle = (await deps.port.run({
      scenario,
      checkout: args.checkout,
      model: args.model,
      endpoint: fake.url,
    })).settle;
  } catch (error) {
    return { ...withSession, reason: `replay failed: ${message(error)}` };
  } finally {
    await fake.close();
  }

  const replayed = fake.journal().map((entry) => entry.body);
  const divergence = firstDivergence(requests, replayed);
  const compared = divergence === null ? requests.length : divergence.at - 1;
  const boundaries = (bodies: unknown[]): Promise<Boundary[][]> =>
    Promise.all(bodies.slice(0, compared).map(prefixBoundaries));
  const [recordedSide, replayedSide] = await Promise.all([
    boundaries(requests),
    boundaries(replayed),
  ]);
  const key = (call: Boundary[]) =>
    JSON.stringify(call.map((b) => [b.layer, b.prefix_hash]));
  const identical =
    recordedSide.filter((call, k) => key(call) === key(replayedSide[k])).length;

  const reasons: string[] = [];
  if (divergence !== null) reasons.push(divergence.reason);
  if (settle.kind === "timeout") reasons.push("replay timed out");
  if (compared < 2) reasons.push("too few calls to compare");
  return {
    ...withSession,
    status: reasons.length === 0 ? "ok" : "diverged",
    reason: reasons.length === 0 ? null : reasons.join("; "),
    diverged_at: divergence?.at ?? null,
    compared_calls: compared,
    identical_calls: identical,
    baseline: sideStat(recordedSide),
    variant: sideStat(replayedSide),
  };
}
