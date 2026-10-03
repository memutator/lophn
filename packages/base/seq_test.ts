import { assert, assertEquals, assertThrows } from "@std/assert";
import { formatSeq, nextFromSeq, parseSeq } from "./seq.ts";

const MAX = (1n << 63n) - 1n;

Deno.test(
  "platform/ledger#R9: seq는 앞자리 0 없는 십진 문자열이고 2^63-1까지다",
  () => {
    const pastSafe = 2n ** 53n + 1n;
    const parsed = parseSeq(pastSafe.toString());
    assert(parsed.ok);
    if (parsed.ok) assertEquals(parsed.value, pastSafe);
    assertEquals(formatSeq(pastSafe), pastSafe.toString());

    const zero = parseSeq("0");
    assert(zero.ok);
    if (zero.ok) assertEquals(zero.value, 0n);
    const top = parseSeq(MAX.toString());
    assert(top.ok);
    if (top.ok) assertEquals(top.value, MAX);

    for (const bad of ["01", "-1", "1.5", "1e2", "", " 1", "1 ", "abc"]) {
      const result = parseSeq(bad);
      assert(!result.ok);
      if (!result.ok) assertEquals(result.error.code, "invalid_input");
    }
    const over = parseSeq((MAX + 1n).toString());
    assert(!over.ok);
    if (!over.ok) assertEquals(over.error.code, "invalid_input");
    assertThrows(() => formatSeq(-1n));
    assertThrows(() => formatSeq(MAX + 1n));
  },
);

Deno.test("platform/ledger#R15: 처리 위치 P 다음은 P+1이다", () => {
  const next = nextFromSeq("0");
  assert(next.ok);
  if (next.ok) assertEquals(next.value, "1");

  const afterGap = nextFromSeq("7");
  assert(afterGap.ok);
  if (afterGap.ok) assertEquals(afterGap.value, "8");

  const end = nextFromSeq(MAX.toString());
  assert(!end.ok);
  if (!end.ok) assertEquals(end.error.code, "invalid_input");
});
