import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { canonicalize } from "./canonical-json.ts";
import { fingerprint, sha256Hex } from "./hash.ts";

Deno.test("platform/ledger#R13: SHA-256 matches known vectors", async () => {
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals(
    await sha256Hex(new Uint8Array([97, 98, 99])),
    await sha256Hex("abc"),
  );
  assertEquals(
    await sha256Hex("€😀"),
    await sha256Hex(new TextEncoder().encode("€😀")),
  );
  assertMatch(await sha256Hex("abc"), /^[0-9a-f]{64}$/);
});

Deno.test("platform/ledger#R13: fingerprint ignores only object key order", async () => {
  const first = { z: 1, a: [{ b: true, a: "value" }] };
  const second = { a: [{ a: "value", b: true }], z: 1 };
  assertEquals(await fingerprint(first), await fingerprint(second));
  assertEquals(await fingerprint(first), await sha256Hex(canonicalize(first)));
  assertNotEquals(
    await fingerprint(first),
    await fingerprint({ ...second, z: 2 }),
  );
  assertNotEquals(await fingerprint([1, 2]), await fingerprint([2, 1]));
});
