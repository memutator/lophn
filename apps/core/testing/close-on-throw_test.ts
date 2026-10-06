import { assert, assertEquals, assertRejects } from "@std/assert";
import { closeUnlessKept } from "./close-on-throw.ts";

Deno.test("platform/responsiveness#R3: 준비가 던지면 띄운 core의 정리가 돌고 처음 오류가 그대로 올라간다", async () => {
  let cleaned = 0;
  const prepare = async () => {
    await using _guard = closeUnlessKept(() => {
      cleaned += 1;
      return Promise.resolve();
    });
    throw new Error("seed failed");
  };
  await assertRejects(prepare, Error, "seed failed");
  assertEquals(cleaned, 1);
});

Deno.test("platform/responsiveness#R3: 준비가 끝나 keep하면 정리는 돌지 않는다", async () => {
  let cleaned = 0;
  const prepare = async () => {
    await using guard = closeUnlessKept(() => {
      cleaned += 1;
      return Promise.resolve();
    });
    guard.keep();
    return "core";
  };
  assertEquals(await prepare(), "core");
  assertEquals(cleaned, 0);
});

Deno.test("platform/responsiveness#R3: 정리가 던져도 처음 오류를 가리지 않는다", async () => {
  const prepare = async () => {
    await using _guard = closeUnlessKept(() =>
      Promise.reject(new Error("shutdown failed"))
    );
    throw new Error("seed failed");
  };
  const caught = await assertRejects(prepare, Error);
  assert(caught.message === "seed failed", caught.message);
});
