import type { Check, CheckInput, CheckResult } from "../types.ts";

// program check만 돌린다. 던지거나 reject한 check는 떨어진 것으로 쳐서 다른 check를 막지 않는다.
export async function runProgramChecks(
  checks: Check[],
  input: CheckInput,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    if (check.kind !== "program") continue;
    try {
      const out = await check.run(input);
      results.push({ id: check.id, kind: "program", ...out });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({
        id: check.id,
        kind: "program",
        pass: false,
        reason: `check 오류: ${message.split("\n")[0]}`,
      });
    }
  }
  return results;
}
