import { canonicalize } from "../../../../base/mod.ts";
import type { Verdict } from "./checks.ts";
import type { AppDriver, HarnessPlan } from "./driver.ts";

// frame 한도(TEST_OBSERVATION_FRAME_MAX_BYTES) 안에 들도록 evidence의 값마다 둔다. 앱이 큰 결과를
// 돌려줘도 frame이 거절되어 판정이 inconclusive가 되지 않게 한다.
const EVIDENCE_VALUE_MAX_BYTES = 2048;

// 예시 비교 규칙. 객체는 expect의 key가 다 있고 값이 맞아야 하며 actual의 나머지 key는 무시한다.
// 배열은 길이가 같고 원소가 차례로 맞아야 한다. 나머지는 `===`다.
export function exampleMatches(expect: unknown, actual: unknown): boolean {
  if (Array.isArray(expect)) {
    return Array.isArray(actual) && expect.length === actual.length &&
      expect.every((item, index) => exampleMatches(item, actual[index]));
  }
  if (expect !== null && typeof expect === "object") {
    if (
      actual === null || typeof actual !== "object" || Array.isArray(actual)
    ) {
      return false;
    }
    const record = actual as Record<string, unknown>;
    return Object.entries(expect).every(([key, value]) =>
      Object.hasOwn(record, key) && exampleMatches(value, record[key])
    );
  }
  return expect === actual;
}

function head(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalize(value));
  return new TextDecoder().decode(bytes.slice(0, EVIDENCE_VALUE_MAX_BYTES));
}

// 예시를 순서대로 불러 첫 불일치에서 멈춘다. reason에는 값이 아니라 위치와 tool만 쓴다.
// 모두 맞으면 write가 남긴 changeset을 뒤집어 첫 호출 전 상태로 돌아오는지 본다. 돌아온 write tool이 proven이다.
export async function examples(
  driver: AppDriver,
  plan: HarnessPlan,
): Promise<Verdict> {
  const steps = plan.examples.length;
  const changesets: string[] = [];
  const writers: string[] = [];
  for (const [index, example] of plan.examples.entries()) {
    const outcome = await driver.call(example.tool, example.input);
    const matched = outcome.status === "ok" &&
      exampleMatches(example.expect, outcome.result);
    if (matched) {
      if (outcome.status === "ok" && outcome.changeset !== undefined) {
        changesets.push(outcome.changeset);
        writers.push(example.tool);
      }
      continue;
    }
    const where = `step ${index + 1} ${example.tool}`;
    return {
      met: false,
      reason: outcome.status === "ok"
        ? `${where}: result does not match the expected value`
        : `${where}: the call ended with an error`,
      evidence: {
        steps,
        failed_step: index,
        tool: example.tool,
        expected: head(example.expect),
        actual: head(
          outcome.status === "ok" ? outcome.result : { error: outcome.code },
        ),
        restore: null,
        proven: [],
      },
    };
  }
  const evidence = {
    steps,
    failed_step: null,
    tool: null,
    expected: null,
    actual: null,
  };
  if (changesets.length === 0) {
    return {
      met: true,
      reason: "every example matches",
      evidence: { ...evidence, restore: null, proven: [] },
    };
  }
  const restore = await driver.restore(changesets);
  if (!restore.applied || !restore.restored) {
    return {
      met: false,
      reason: `예시의 write를 되돌리지 못했다: ${restore.reason}`,
      evidence: { ...evidence, restore, proven: [] },
    };
  }
  return {
    met: true,
    reason: "every example matches and the writes were restored",
    evidence: { ...evidence, restore, proven: [...new Set(writers)] },
  };
}
