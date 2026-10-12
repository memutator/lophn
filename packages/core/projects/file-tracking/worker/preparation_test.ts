import { assertEquals } from "@std/assert";
import { lineDiff } from "./preparation.ts";

Deno.test("documents/file-tracking#R5: 줄 diff는 같은 줄은 두고 바뀐 줄만 표시한다", () => {
  const changes = lineDiff("a\nb\nc", "a\nx\nc");
  assertEquals(changes, [
    { kind: "same", line: "a" },
    { kind: "removed", line: "b" },
    { kind: "added", line: "x" },
    { kind: "same", line: "c" },
  ]);
});

Deno.test("documents/file-tracking#R5: 맨 앞 삽입과 빈 파일의 diff도 줄을 빠뜨리지 않는다", () => {
  assertEquals(lineDiff("b", "a\nb"), [
    { kind: "added", line: "a" },
    { kind: "same", line: "b" },
  ]);
  assertEquals(lineDiff("", ""), []);
  assertEquals(lineDiff("a", ""), [{ kind: "removed", line: "a" }]);
});

Deno.test("documents/file-tracking#R5: 계산 한도를 넘는 diff는 결과를 내지 않는다", () => {
  const left = Array.from({ length: 600 }, (_, index) => `l${index}`).join(
    "\n",
  );
  const right = Array.from({ length: 600 }, (_, index) => `r${index}`).join(
    "\n",
  );
  assertEquals(lineDiff(left, right), null);
});
