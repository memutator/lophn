import { assertEquals } from "@std/assert";
import { createFocusGate } from "./focus.ts";

// 풀리지 않으면 App Engineer의 입력이 사람이 치는 키와 섞여 TUI가 망가진다.
Deno.test("whenFree waits while held and resolves when all holds are released", async () => {
  const gate = createFocusGate();
  const a = gate.hold("term_1");
  const b = gate.hold("term_1");
  let free = false;
  const waiting = gate.whenFree("term_1").then(() => free = true);
  await gate.whenFree("term_2");

  a();
  a();
  await Promise.resolve();
  assertEquals(free, false);
  b();
  await waiting;
  assertEquals(free, true);
  await gate.whenFree("term_1");
});
