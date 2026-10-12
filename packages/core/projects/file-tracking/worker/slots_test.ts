// documents/file-tracking#R5: crash한 준비 slot은 새 프로세스로 다시 채운다.
// 재시작은 한도와 backoff 뒤고, 한도를 넘긴 slot은 다시 띄우지 않는다.
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ChildSession } from "../../../supervision/responsiveness/mod.ts";
import { supervisePreparationSlots } from "./slots.ts";

function session(id: string): ChildSession {
  return { id } as unknown as ChildSession;
}

Deno.test("documents/file-tracking#R5: 살아있는 slot은 같은 세션을 돌려준다", async () => {
  let spawned = 0;
  const slots = supervisePreparationSlots({
    spawn: () => {
      spawned += 1;
      return Promise.resolve(session(`s-${spawned}`));
    },
  });
  const first = await slots.acquire("preparation-human");
  const second = await slots.acquire("preparation-human");
  assertEquals(first, second);
  assertEquals(spawned, 1);
});

Deno.test("documents/file-tracking#R5: crash한 slot은 backoff 뒤 새 프로세스로 채운다", async () => {
  const sleeps: number[] = [];
  const spawned: string[] = [];
  const slots = supervisePreparationSlots({
    spawn: (name) => {
      spawned.push(name);
      return Promise.resolve(session(`s-${spawned.length}`));
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  const first = await slots.acquire("preparation-background");
  slots.release("preparation-background");
  const refilled = await slots.acquire("preparation-background");
  assert(first !== refilled, "refill은 새 세션이다");
  assertEquals(spawned, ["preparation-background", "preparation-background"]);
  assertEquals(sleeps, [1_000], "첫 재시작은 1초 backoff 뒤다");
});

Deno.test("documents/file-tracking#R5: 재시작 한도를 넘긴 slot은 다시 채우지 않는다", async () => {
  const sleeps: number[] = [];
  let spawned = 0;
  const slots = supervisePreparationSlots({
    spawn: () => {
      spawned += 1;
      return Promise.resolve(session(`s-${spawned}`));
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    restartLimit: 2,
  });
  await slots.acquire("preparation-human");
  slots.release("preparation-human");
  await slots.acquire("preparation-human");
  slots.release("preparation-human");
  await assertRejects(
    () => slots.acquire("preparation-human"),
    Error,
    "restart limit reached",
  );
  assertEquals(spawned, 2);
  assertEquals(slots.unavailable("preparation-human"), true);
  assertEquals(sleeps, [1_000], "한도를 넘긴 뒤에는 backoff도 없다");
});

Deno.test("documents/file-tracking#R5: 다른 slot의 crash는 살아있는 slot을 다시 띄우지 않는다", async () => {
  const spawned: string[] = [];
  const slots = supervisePreparationSlots({
    spawn: (name) => {
      spawned.push(name);
      return Promise.resolve(session(name));
    },
    sleep: () => Promise.resolve(),
  });
  await slots.acquire("preparation-human");
  await slots.acquire("preparation-background");
  slots.release("preparation-background");
  await slots.acquire("preparation-background");
  assertEquals(spawned, [
    "preparation-human",
    "preparation-background",
    "preparation-background",
  ]);
  assertEquals(slots.unavailable("preparation-human"), false);
});
