import assert from "node:assert/strict";
import { test } from "node:test";

import { serial } from "./mutex.ts";

test("serial: 앞 호출이 끝나기 전에 다음 호출을 시작하지 않고, 앞이 던져도 다음이 돈다", async () => {
  const log: string[] = [];
  let finishFirst!: () => void;
  const first = serial(async () => {
    log.push("a start");
    await new Promise<void>((r) => finishFirst = r);
    log.push("a end");
    throw new Error("a failed");
  });
  const second = serial(() => {
    log.push("b start");
    return Promise.resolve("b");
  });
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepStrictEqual(log, ["a start"]);
  finishFirst();
  await first.catch(() => {});
  assert.deepStrictEqual(await second, "b");
  assert.deepStrictEqual(log, ["a start", "a end", "b start"]);
});
