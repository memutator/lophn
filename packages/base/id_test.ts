import { assert, assertEquals, assertThrows } from "@std/assert";
import { manualClock } from "./clock.ts";
import { createIdSource, parseId } from "./id.ts";
import type { RandomSource } from "./random.ts";

const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const MAX_MS = 2 ** 48 - 1;

function bytes(hex: string): RandomSource {
  return {
    fill(out: Uint8Array) {
      for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
    },
  };
}

function source(ms: number, hex: string) {
  return createIdSource({ clock: manualClock(ms), random: bytes(hex) });
}

Deno.test(
  "platform/ledger#R8: ID는 소문자 ULID 26자이고 첫 글자가 0~7이다",
  () => {
    const id = source(0, "00000000000000000000").newId("prj");
    assertEquals(id, "prj_00000000000000000000000000");
    const parsed = parseId(id);
    assert(parsed.ok);
    if (parsed.ok) {
      assertEquals(parsed.value.prefix, "prj");
      assert(ULID.test(parsed.value.ulid));
      assertEquals(parsed.value.ulid.length, 26);
    }

    const high = source(MAX_MS, "ff".repeat(10)).newId("doc");
    assertEquals(high.slice(0, 14), "doc_7zzzzzzzzz");
    assert(ULID.test(high.slice(4)));
  },
);

Deno.test(
  "platform/ledger#R8: 같은 밀리초의 ID는 random 부분이 " +
    "단조 증가한다",
  () => {
    const ids = source(1_700_000_000_000, "0000000000000000000f");
    const first = ids.newId("doc");
    const second = ids.newId("doc");
    const third = ids.newId("ver");
    assert(first < second && second < third);
    assertEquals(first.slice(0, 14), second.slice(0, 14));
    assertEquals(first.slice(0, -1), second.slice(0, -1));

    const clock = manualClock(5);
    const mixed = createIdSource({
      clock,
      random: bytes("00000000000000000001"),
    });
    const before = mixed.newId("app");
    clock.advance(1);
    const after = mixed.newId("app");
    assert(before.slice(4, 14) < after.slice(4, 14));

    clock.set(5);
    const returned = mixed.newId("app");
    assertEquals(returned.slice(0, 14), before.slice(0, 14));
    assert(returned.slice(14) > after.slice(14));
  },
);

Deno.test("platform/ledger#R8: 틀린 prefix와 틀린 ID는 거절한다", () => {
  const ids = source(0, "00".repeat(10));
  assertThrows(() => ids.newId("PRJ"));
  assertThrows(() => ids.newId("pr"));
  assertThrows(() => ids.newId("proj"));
  assertThrows(() => ids.newId("p1j"));

  for (const bad of ["prj_", "prj_80000000000000000000000000", "nope"]) {
    const parsed = parseId(bad);
    assert(!parsed.ok);
    if (!parsed.ok) assertEquals(parsed.error.code, "invalid_input");
  }
});

Deno.test(
  "platform/ledger#R8: 같은 밀리초에서 random이 넘치면 throw한다",
  () => {
    const ids = source(0, "ff".repeat(10));
    assertEquals(ids.newId("prj").slice(-16), "zzzzzzzzzzzzzzzz");
    assertThrows(() => ids.newId("prj"));
  },
);
