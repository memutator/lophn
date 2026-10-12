// 미참조 확인 기록 순수 규칙의 요구 테스트(platform/blob-store#R9). 유예기간은
// 기록의 처음 확인 시각부터 센다: 기록 없는 hash는 지우지 않고, 모양이 다른
// 기록도 기록 없음으로 본다. 경로는 sha256 64-hex 밖을 거절한다.

import { assert, assertEquals } from "@std/assert";
import {
  isSha256Hash,
  parseUnreferencedRecord,
  unreferencedGracePassed,
  unreferencedPathFor,
} from "./mod.ts";

const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const GRACE = 7 * 24 * 60 * 60 * 1000;

// R9: 경로는 sha256 64-hex만 받는다. 다른 모양은 invalid_input이다.
Deno.test("platform/blob-store#R9: 경로는 sha256 64-hex 밖을 거절한다", () => {
  const good = unreferencedPathFor("/root", "a".repeat(64));
  assert(good.ok);
  if (good.ok) {
    assertEquals(
      good.value,
      `/root/blobs/unreferenced/${"a".repeat(2)}/${"a".repeat(62)}.json`,
    );
  }
  const short = unreferencedPathFor("/root", "a".repeat(63));
  assertEquals(short.ok, false);
  const upper = unreferencedPathFor("/root", "A".repeat(64));
  assertEquals(upper.ok, false);
  const slash = unreferencedPathFor("/root", `../${"a".repeat(56)}`);
  assertEquals(slash.ok, false);
  assert(!isSha256Hash("a".repeat(63)));
  assert(isSha256Hash("a".repeat(64)));
});

// R9: 기록은 처음 확인 시각 하나다. 모양이 다르면 기록 없음이다(fail-closed).
Deno.test("platform/blob-store#R9: 기록 JSON은 처음 확인 시각만 받는다", () => {
  assert(parseUnreferencedRecord({ unreferenced_at_ms: 1000 }) !== undefined);
  assertEquals(parseUnreferencedRecord({ unreferenced_at_ms: -1 }), undefined);
  assertEquals(
    parseUnreferencedRecord({ unreferenced_at_ms: "1000" }),
    undefined,
  );
  assertEquals(parseUnreferencedRecord({ at: 1000 }), undefined);
  assertEquals(parseUnreferencedRecord(null), undefined);
  assertEquals(parseUnreferencedRecord("x"), undefined);
});

// R9: 유예기간 판정은 기록만 본다. 기록 없는 hash는 지금부터 미참조라
// 지우지 않는다.
Deno.test("platform/blob-store#R9: 유예기간은 기록의 처음 확인 시각부터 센다", () => {
  const fresh = { unreferencedAtMs: NOW - GRACE + 1000 };
  const aged = { unreferencedAtMs: NOW - GRACE - 1000 };
  assert(!unreferencedGracePassed(fresh, NOW, GRACE));
  assert(unreferencedGracePassed(aged, NOW, GRACE));
  // 기록 없는 hash는 삭제 자격이 없다(R9 fail-closed).
  assertEquals(unreferencedGracePassed(undefined, NOW, GRACE), false);
});
