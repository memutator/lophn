import { assert, assertEquals } from "@std/assert";
import { cryptoRandom, seededRandom } from "./random.ts";

Deno.test(
  "platform/ledger#R8: 테스트용 random은 같은 seed에서 같은 바이트를 낸다",
  () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    seededRandom(1).fill(a);
    seededRandom(1).fill(b);
    assertEquals(a, b);

    const other = new Uint8Array(16);
    seededRandom(2).fill(other);
    assert(!other.every((byte, i) => byte === a[i]));

    const live = new Uint8Array(16);
    cryptoRandom.fill(live);
    assertEquals(live.length, 16);
  },
);
