import { assertEquals, assertNotStrictEquals, assertThrows } from "@std/assert";
import { definePort, type PortKey } from "./ports.ts";

Deno.test("platform/ledger#R3: port key의 type과 object identity가 구현을 구별한다", () => {
  const key = definePort<{ reserve(name: string): boolean }>(
    "documents.reserve",
  );
  assertEquals(key.name, "documents.reserve");
  assertNotStrictEquals(key, definePort("documents.reserve"));
  assertThrows(() => definePort(""));
  // @ts-expect-error 다른 interface의 port로 주입할 수 없다.
  const wrong: PortKey<{ count: number }> = key;
  void wrong;
});
