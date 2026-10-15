import { assertEquals } from "@std/assert";
import { type ProblemState, reopenDecision } from "./model.ts";

const RESOLVED_AT = "2026-10-10T00:00:00.000Z";
const BEFORE = "2026-10-09T00:00:00.000Z";
const AFTER = "2026-10-11T00:00:00.000Z";

const cases: [
  string,
  ProblemState,
  string | null,
  "reopen" | "accumulate",
][] = [
  ["열린 문제는 어느 release든 쌓기만 한다", "open", AFTER, "accumulate"],
  [
    "해결 뒤에 활성화된 release의 발생은 다시 연다",
    "resolved",
    AFTER,
    "reopen",
  ],
  [
    "해결 전에 활성화된 release의 늦은 발생은 쌓기만 한다",
    "resolved",
    BEFORE,
    "accumulate",
  ],
  [
    "무시한 문제는 재발해도 열지 않는다",
    "ignored",
    AFTER,
    "accumulate",
  ],
  ["release를 모르면 쌓기만 한다", "resolved", null, "accumulate"],
];

for (const [name, state, activatedAt, expected] of cases) {
  Deno.test(`reopenDecision: ${name}`, () => {
    assertEquals(
      reopenDecision({ state, state_changed_at: RESOLVED_AT }, activatedAt),
      expected,
    );
  });
}
