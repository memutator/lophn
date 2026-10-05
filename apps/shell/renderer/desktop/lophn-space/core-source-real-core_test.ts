// 실제 core 위의 lophn 공간 command. fake core는 command 응답 모양을 잘못 흉내 내도 통과하므로
// saved view 저장을 temp LOPHN_HOME core로 보내 응답을 그대로 읽는지 본다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../testdata/real-core.ts";
import { coreLophnSource } from "./core-source.ts";

Deno.test("shell/desktop#R1: 실제 core에서 saved view 저장 응답을 그대로 읽고 목록에서 같은 view를 본다", async () => {
  const core = await startRealCore();
  try {
    const source = coreLophnSource(core.source);
    const saved = await source.saveView("Weekly plans", {
      query: "plan",
      place: null,
      context: null,
      format: null,
      includeArchived: false,
    });
    assert(saved.ok, JSON.stringify(saved));
    assert(saved.value.id.startsWith("viw_"));
    assertEquals(saved.value.name, "Weekly plans");
    assertEquals(saved.value.filter, {
      text: "plan",
      context: null,
      format: null,
      status: "active",
    });
    const views = await source.views();
    assert(views.ok);
    assertEquals(views.value, [saved.value]);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
