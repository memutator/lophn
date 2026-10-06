// 기본 harness 선택 시험이다(harnesses#R5). 감지·설치 관측은 값으로 준다.
import { assert, assertEquals } from "@std/assert";
import type { HarnessDetection } from "../../contracts/coding-agent/mod.ts";
import {
  decideDefaultHarness,
  runnableOf,
  type SelectionEntry,
} from "./selection.ts";

const CANDIDATE = {
  path: "/usr/bin/claude",
  source: "path",
  executable_result: "ok",
};

function entry(
  harness: SelectionEntry["harness"],
  over: Partial<SelectionEntry> = {},
): SelectionEntry {
  return {
    harness,
    enabled: true,
    runnable: true,
    connected: true,
    candidates: [CANDIDATE],
    ...over,
  };
}

Deno.test("coding-agent/harnesses#R5: 저장 선택이 비었을 때 연결된 실행 가능 후보가 하나면 그 후보를 제안만 하고 저장하지 않는다", () => {
  const decision = decideDefaultHarness({
    saved: null,
    entries: [
      entry("claude"),
      entry("codex", { connected: false }),
      entry("gemini", { runnable: false }),
      entry("pi", { enabled: false }),
    ],
  });
  assertEquals(decision.state, "suggest");
  assertEquals(decision.suggestion.suggested_harness, "claude");
  assertEquals(decision.suggestion.reason, null);
  // 제안일 뿐 쓰는 기본값이 아니다.
  assertEquals(decision.harness, null);
});

Deno.test("coding-agent/harnesses#R5: 후보가 여럿이면 이름 순서로 고르지 않고 사람이 고르게 한다", () => {
  const decision = decideDefaultHarness({
    saved: null,
    entries: [entry("codex"), entry("claude")],
  });
  assertEquals(decision.state, "choose");
  assertEquals(decision.suggestion.suggested_harness, null);
  assertEquals(decision.choices, ["codex", "claude"]);
  assertEquals(decision.harness, null);
});

Deno.test("coding-agent/harnesses#R5: 후보가 없으면 연결 안내만 보인다", () => {
  const decision = decideDefaultHarness({
    saved: null,
    entries: [
      entry("claude", { connected: false }),
      entry("codex", { runnable: false }),
    ],
  });
  assertEquals(decision.state, "connect");
  assertEquals(decision.suggestion.suggested_harness, null);
  assertEquals(decision.choices, []);
  assert(decision.next.includes("connection install"));
});

Deno.test("coding-agent/harnesses#R5: 저장 선택이 실행 불가가 되어도 다른 제품으로 자동 교체하지 않고 다시 고르는 행동을 안내한다", () => {
  const decision = decideDefaultHarness({
    saved: "claude",
    entries: [entry("claude", { runnable: false }), entry("codex")],
  });
  assertEquals(decision.state, "chosen_unavailable");
  assertEquals(decision.harness, null);
  assertEquals(decision.suggestion.suggested_harness, null);
  assert(decision.next.includes("다시 고르"));
  // 저장 선택이 감지 목록에서 사라져도 같다.
  const gone = decideDefaultHarness({ saved: "pi", entries: [entry("codex")] });
  assertEquals(gone.state, "chosen_unavailable");
  assertEquals(gone.suggestion.suggested_harness, null);
});

Deno.test("coding-agent/harnesses#R5: 저장 선택이 실행 가능하면 그대로 쓴다", () => {
  const decision = decideDefaultHarness({
    saved: "codex",
    entries: [entry("claude"), entry("codex", { connected: false })],
  });
  assertEquals(decision.state, "chosen");
  assertEquals(decision.harness, "codex");
});

Deno.test("coding-agent/harnesses#R5 coding-agent/harnesses#R3: 실행 가능은 실행 파일 발견과 verified version이 함께일 때만이다", () => {
  const base = {
    discovery: "detected",
    version: { result: "verified", value: "1.0.0", reason: null },
  } as unknown as HarnessDetection;
  assert(runnableOf(base));
  assert(
    !runnableOf({
      ...base,
      version: { result: "unknown", value: null, reason: "timeout" },
    } as unknown as HarnessDetection),
  );
  assert(
    !runnableOf(
      { ...base, discovery: "not_found" } as unknown as HarnessDetection,
    ),
  );
});
