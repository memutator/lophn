import { assertEquals } from "@std/assert";
import {
  agentResolveDecision,
  type ProblemState,
  reopenDecision,
} from "./model.ts";
import type { ReleaseFact } from "../ports.ts";

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

function release(id: string, activatedAt: string | null): ReleaseFact {
  return {
    id,
    app: "app",
    number: 1,
    code_commit: "c",
    activated_at: activatedAt,
    resources: [],
  };
}

const resolveCases: [
  string,
  ReleaseFact | null,
  ReleaseFact | null,
  "allow" | "no_fix_release",
][] = [
  [
    "더 늦게 activate된 다른 release는 허용",
    release("r1", BEFORE),
    release("r2", AFTER),
    "allow",
  ],
  [
    "같은 release는 막는다",
    release("r1", BEFORE),
    release("r1", BEFORE),
    "no_fix_release",
  ],
  [
    "더 일찍 activate된 release는 막는다",
    release("r1", AFTER),
    release("r2", BEFORE),
    "no_fix_release",
  ],
  [
    "active release가 없으면 막는다",
    release("r1", BEFORE),
    null,
    "no_fix_release",
  ],
  [
    "마지막 발생의 release가 없으면 막는다",
    null,
    release("r2", AFTER),
    "no_fix_release",
  ],
  [
    "activated_at이 없으면 막는다",
    release("r1", null),
    release("r2", AFTER),
    "no_fix_release",
  ],
];

for (const [name, last, active, expected] of resolveCases) {
  Deno.test(`agentResolveDecision: ${name}`, () => {
    assertEquals(agentResolveDecision({ last, active }), expected);
  });
}
