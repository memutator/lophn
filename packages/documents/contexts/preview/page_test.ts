// context.preview 읽기의 위반 문구: rule 위반은 계약이 규칙에 적은 message를 쓰고, 알 수 없으면 규칙 이름 문구다.
import { assertEquals } from "@std/assert";
import { evalContent } from "../api/testing.ts";
import { pagePreview } from "./page.ts";

const AS_OF = "7";
const violation = (rule: string | null, kind = "rule") => ({
  kind: kind as "rule",
  rule,
  path: "eval/experiments/exp-004-nostatus.md",
  section: null,
  type: "Experiment",
  target: null,
});

function messages(contract?: unknown): string[] {
  const page = pagePreview({
    context: "ctx_1",
    bundle: "cbn_1",
    as_of_seq: AS_OF,
    outcome: {
      types: [],
      findings: [],
      violation_count: 3,
      violations: [
        violation("Experiment.status-required"),
        violation("Experiment.no-such-rule"),
        violation(null, "unreadable"),
      ],
    },
    contract,
  });
  if (!page.ok) throw new Error(page.error.message);
  return page.value.violations.map((item) => item.message);
}

Deno.test("documents/contexts#R24 [ctx-T10b]: the preview reads a rule violation as the message the draft's contract gives that rule", () => {
  assertEquals(messages(evalContent().contract), [
    "Experiment.no-such-rule is violated",
    "Every experiment says its status",
    "eval/experiments/exp-004-nostatus.md cannot be read",
  ]);
});

Deno.test("documents/contexts#R24 [ctx-T10b]: without a contract the preview falls back to the generic rule wording", () => {
  assertEquals(messages(), [
    "Experiment.no-such-rule is violated",
    "Experiment.status-required is violated",
    "eval/experiments/exp-004-nostatus.md cannot be read",
  ]);
});
