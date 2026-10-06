import { assertEquals } from "@std/assert";
import { containerSpace } from "./space.ts";

Deno.test("apps/sdk#R37: container 폭으로 카드(240px~)·패널(320px~)·전체(640px~)를 고른다", () => {
  assertEquals(containerSpace(240), "card");
  assertEquals(containerSpace(319), "card");
  assertEquals(containerSpace(320), "panel");
  assertEquals(containerSpace(639), "panel");
  assertEquals(containerSpace(640), "full");
  assertEquals(containerSpace(1440), "full");
});
