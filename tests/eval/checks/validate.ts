import { parseRef, type Scenario } from "../types.ts";
import { runProgramChecks } from "./run.ts";

// provider 없이 core: null로 fixture를 확인한다. right는 모두 통과, wrong은 fails가 떨어져야 한다.
export async function validateFixtures(
  scenarios: Scenario[],
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  for (const sc of scenarios) {
    const bad = (msg: string) => problems.push(`${sc.id}@${sc.n}: ${msg}`);
    const programs = new Set<string>();
    const seen = new Set<string>();
    for (const c of sc.checks) {
      if (seen.has(c.id)) bad(`check id 겹침 ${c.id}`);
      seen.add(c.id);
      if (c.kind === "program") programs.add(c.id);
    }
    for (const c of sc.checks) {
      if (c.kind !== "judge") continue;
      for (const p of c.premise) {
        if (!programs.has(p)) {
          bad(`judge ${c.id}의 premise ${p}가 program check 아님`);
        }
      }
      try {
        parseRef(c.criterion, "criterion");
      } catch {
        bad(`judge ${c.id}의 criterion ${c.criterion}이 name@n 꼴 아님`);
      }
    }

    if (sc.fixtures.right.length === 0) bad("right fixture 없음");
    for (const [i, trial] of sc.fixtures.right.entries()) {
      for (
        const r of await runProgramChecks(sc.checks, { trial, core: null })
      ) {
        if (!r.pass) bad(`right[${i}]에서 ${r.id} 떨어짐: ${r.reason}`);
      }
      for (const c of sc.checks) {
        if (c.kind !== "judge") continue;
        try {
          if ((await c.input({ trial, core: null })).trim() === "") {
            bad(`right[${i}]에서 judge ${c.id}의 input이 빈 글`);
          }
        } catch (e) {
          bad(
            `right[${i}]에서 judge ${c.id}의 input 오류: ${
              e instanceof Error ? e.message : e
            }`,
          );
        }
      }
    }

    if (sc.fixtures.wrong.length === 0) bad("wrong fixture 없음");
    for (const [i, w] of sc.fixtures.wrong.entries()) {
      if (w.fails.length === 0) bad(`wrong[${i}]의 fails가 빔`);
      const results = await runProgramChecks(sc.checks, {
        trial: w.trial,
        core: null,
      });
      for (const id of w.fails) {
        const r = results.find((x) => x.id === id);
        if (r === undefined) {
          bad(`wrong[${i}]의 fails ${id}가 program check 아님`);
        } else if (r.pass) bad(`wrong[${i}]에서 ${id}가 통과함`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
