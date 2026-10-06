import { assertEquals } from "@std/assert";
import { runWith, withRevert } from "./mod.ts";
import { COMMAND_REVERT } from "./revert.ts";

const EVIDENCE = { receipt: "change:7", revision: "7" };

Deno.test("apps/blueprint#R21: withRevert는 현재 invocation과 되돌림 근거로 {result, revert}를 만든다", async () => {
  const value = await runWith(
    {
      app: "app_a",
      release: "rel_a",
      mode: "live",
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw3",
    },
    () => withRevert({ id: 3 }, EVIDENCE),
  );
  assertEquals(value.result, { id: 3 });
  assertEquals(value.revert, {
    invocation: "inv_01h455vb4pex5v6nkc6gd5fdw3",
    receipt: "change:7",
    expected_revision: "7",
  });
  assertEquals(value[COMMAND_REVERT], true);
  // 심볼은 JSON에 실리지 않는다.
  assertEquals(Object.keys(JSON.parse(JSON.stringify(value))).sort(), [
    "result",
    "revert",
  ]);
});

Deno.test("apps/blueprint#R21: invocation이 없는 실행은 되돌림 근거를 꾸미지 않는다", async () => {
  const outside = withRevert({ id: 3 }, EVIDENCE);
  assertEquals(outside.revert, undefined);
  const preview = await runWith(
    { app: "app_a", release: null, mode: "preview", invocation: null },
    () => withRevert({ id: 3 }, EVIDENCE),
  );
  assertEquals(preview.revert, undefined);
  assertEquals(preview.result, { id: 3 });
});
