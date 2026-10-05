// 실제 core의 platform settings 위에서 읽기 폭 저장을 본다. fake core는 command 응답 모양을
// 잘못 흉내 내도 통과하므로, 저장한 판을 실제 응답에서 읽는지 temp LOPHN_HOME core로 확인한다.
// reading-width.ts가 design 컴포넌트를 불러 component test bundle(editor_test.ts)에서 돈다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../testdata/real-core.ts";
import { coreSettingsPort, readingWidthStore } from "./reading-width.ts";

async function until(
  label: string,
  check: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`기다림 초과: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

Deno.test("shell/design-system#R23: 실제 core에서 읽기 폭을 저장하고 응답의 판으로 다음 저장을 이어 간다", async () => {
  const core = await startRealCore();
  try {
    let n = 0;
    const port = coreSettingsPort(core.source, () => `reading-width-${++n}`);
    const before = await port.get();
    assert(before !== null);
    // 저장 응답은 route output(SettingsApplyResult) 그대로다. 그 판이 다음 get의 판과 같다.
    const applied = await port.apply("wide", before.revision);
    assert(applied.ok, JSON.stringify(applied));
    const after = await port.get();
    assertEquals(after, { value: "wide", revision: applied.revision });
    assert(applied.revision > before.revision);
    // 지난 판으로 저장하면 core가 conflict로 거절한다.
    assertEquals(await port.apply("narrow", before.revision), {
      ok: false,
      conflict: true,
    });

    // store는 응답의 판을 이어 써서 두 번 연달아 바꿔도 실패하지 않는다.
    const store = readingWidthStore(port);
    await store.load();
    assertEquals(store.read(), "wide");
    store.write("narrow");
    await until("첫 저장", async () => (await port.get())?.value === "narrow");
    store.write("default");
    await until(
      "두 번째 저장",
      async () => (await port.get())?.value === "default",
    );
    assertEquals(store.failed(), false);
    // 재시작은 같은 settings를 새 store로 다시 읽는 것이다.
    const restarted = readingWidthStore(port);
    await restarted.load();
    assertEquals(restarted.read(), "default");
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
