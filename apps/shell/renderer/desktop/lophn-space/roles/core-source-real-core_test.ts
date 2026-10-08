// 실제 core 위의 roles 통로. fake core는 route 답의 모양을 잘못 흉내 내도 통과하므로 새 temp
// LOPHN_HOME core가 같은 통로로 역할·Preset·선택지를 답하고, 사람 전용 본문 읽기가 없는 일에는
// 없다고 답하는지 본다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../../testdata/real-core.ts";
import { coreRolesSource } from "./core-source.ts";

const UNKNOWN_RUN = "run_01h455vb4pex5v6nkc6gd5fd77";

Deno.test("shell/desktop#R4, lophn-agent/observability#R20: 실제 core에서 역할 목록과 Preset·선택지를 읽고 없는 일의 본문은 없다고 답한다", async () => {
  const core = await startRealCore();
  try {
    const source = coreRolesSource(core.source, {
      picker: undefined,
      openDecision: undefined,
    });
    const roles = await source.roles();
    assert(roles.ok, JSON.stringify(roles));
    for (const row of roles.value) {
      assert(
        ["lophn", "app_engineer", "context_engineer", "operator"].includes(
          row.role,
        ),
      );
      assert(["enabled", "paused", "withdrawn"].includes(row.state));
    }
    const first = roles.value[0];
    if (first !== undefined) {
      const presets = await source.presets(first);
      assert(presets.ok, JSON.stringify(presets));
      assert(
        presets.value.every((entry) => entry.definition.role === first.role),
      );
      const works = await source.works(first);
      assert(works.ok, JSON.stringify(works));
    }
    const choices = await source.choices();
    assert(choices.ok, JSON.stringify(choices));
    // 사람 전용 본문 읽기: 없는 일은 없는 대상과 같은 not_found다.
    const body = await source.body("run_basis", UNKNOWN_RUN);
    assertEquals(body, { ok: false, code: "not_found" });
    // route가 core에 등록돼 있다: 종류와 맞지 않는 id는 없는 route의 not_found가 아니라 invalid_input이다.
    const mismatched = await core.source.call({
      kind: "read",
      resource: "runs",
      method: "body-view",
      body: { kind: "run_basis", id: "tcl_01h455vb4pex5v6nkc6gd5fd77" },
    });
    assertEquals(mismatched.ok, false);
    assertEquals(mismatched.error?.code, "invalid_input");
    const trace = await source.trace(UNKNOWN_RUN);
    assertEquals(trace.ok, false);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
