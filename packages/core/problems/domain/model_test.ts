import { assertEquals } from "@std/assert";
import type { Violation } from "../../../protocol/projects/mod.ts";
import {
  diffDomainProblems,
  type ExistingDomainProblem,
  violationIdentity,
} from "./model.ts";

const violation = (path: string, message = "m"): Violation => ({
  source: "document",
  rule: "required",
  kind: "note",
  path,
  field: "title",
  message,
});
const row = (
  path: string,
  state: "open" | "resolved",
): ExistingDomainProblem => ({
  id: `prb_${path}`,
  identity: violationIdentity(violation(path)),
  state,
  message: "m",
});

Deno.test("diffDomainProblems: 처음 보이면 열고 사라지면 닫고 닫혔다 보이면 다시 연다", () => {
  const diff = diffDomainProblems({
    existing: [row("a", "open"), row("b", "open"), row("c", "resolved")],
    incoming: [
      { id: "prb_new", violation: violation("a", "changed") },
      { id: "prb_n", violation: violation("c") },
      { id: "prb_x", violation: violation("d") },
      { id: "prb_y", violation: violation("d") },
    ],
    truncated: false,
  });
  assertEquals(diff.insert.map((i) => i.id), ["prb_x"]);
  assertEquals(diff.reopen.map((r) => r.id), ["prb_c"]);
  assertEquals(diff.resolve.map((r) => r.id), ["prb_b"]);
  assertEquals(diff.touch, [{ id: "prb_a", message: "changed" }]);
});

Deno.test("diffDomainProblems: 같은 집합이면 열거나 닫을 것이 없고 truncated이면 닫지 않는다", () => {
  const existing = [row("a", "open"), row("b", "open")];
  const same = diffDomainProblems({
    existing,
    incoming: [
      { id: "1", violation: violation("a") },
      { id: "2", violation: violation("b") },
    ],
    truncated: false,
  });
  assertEquals(
    [same.insert.length, same.reopen.length, same.resolve.length],
    [0, 0, 0],
  );
  const partial = diffDomainProblems({
    existing,
    incoming: [{ id: "1", violation: violation("a") }],
    truncated: true,
  });
  assertEquals(partial.resolve, []);
});
