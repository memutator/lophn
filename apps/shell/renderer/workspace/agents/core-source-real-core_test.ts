// 실제 core 위의 Agents 탭 통로. fake core는 응답 모양을 잘못 흉내 내도 통과하므로 temp LOPHN_HOME core에
// 프로젝트를 만들고 새 Operator를 저장·읽기·거절·삭제까지 source로 해 본다. 저장이 만드는 assignment와
// 항목별 거절 이유(details)가 renderer 통로를 지나도 그대로 나오는지가 이 시험의 핵심이다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../testdata/real-core.ts";
import { newId } from "../../desktop/lophn-space/model.ts";
import { coreLauncherSource } from "../../desktop/launcher/core-source.ts";
import { coreAgentsSource } from "./core-source.ts";

Deno.test("lophn-agent/agents#R4 shell/workspace#R38 [agent-I34]: 실제 core: 새 Operator를 저장하면 목록에 나타나 읽히고, 예약 이름은 항목별 이유로 거절되고, 지우면 목록에서 사라진다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-agents-project-" });
  const core = await startRealCore();
  try {
    const project = newId("prj");
    const registered = await coreLauncherSource(core.source, undefined)
      .register({
        id: project,
        name: "agents-project",
        title: "Agents project",
        purpose: "Agents tab.",
        folders: [{ path: folder, description: "Docs" }],
      });
    assert(registered.ok, JSON.stringify(registered));
    const source = coreAgentsSource(core.source, { instructions: undefined });
    const operators = async () => {
      const overview = await source.overview(project);
      assert(overview.ok, JSON.stringify(overview));
      return overview.value.agents.filter((row) => row.kind === "operator");
    };
    assertEquals(await operators(), []);

    const blank = await source.newOperator(project);
    assert(blank.ok, JSON.stringify(blank));
    assertEquals(blank.value.assignment, null);
    assertEquals(blank.value.hash, null);

    // 예약된 이름은 저장 전체가 거절되고 이유가 칸 이름과 함께 나온다.
    const refused = await source.saveAgent(project, {
      assignment: null,
      hash: null,
      definition: { name: "lophn", body: "x" },
    });
    assert(!refused.ok);
    assertEquals(refused.message, "invalid_input");
    assertEquals(refused.issues, [{ field: "name", code: "reserved_name" }]);
    assertEquals(await operators(), []);

    const saved = await source.saveAgent(project, {
      assignment: null,
      hash: null,
      definition: { name: "Release notes", body: "Watch the releases." },
    });
    assert(saved.ok, JSON.stringify(saved));
    assertEquals(saved.value.role, "operator");
    const rows = await operators();
    assertEquals(rows.map((row) => [row.assignment, row.name]), [
      [saved.value.assignment, "Release notes"],
    ]);

    const read = await source.readAgent(project, saved.value.assignment);
    assert(read.ok, JSON.stringify(read));
    assertEquals(read.value.definition, {
      name: "Release notes",
      body: "Watch the releases.",
    });
    assertEquals(read.value.hash, saved.value.hash);
    assertEquals(read.value.issues, []);

    // 낡은 hash로 고치면 conflict다.
    const stale = await source.saveAgent(project, {
      assignment: saved.value.assignment,
      hash: "0".repeat(64),
      definition: { name: "Release notes", body: "Changed." },
    });
    assert(!stale.ok);
    assertEquals(stale.message, "conflict");

    const deleted = await source.deleteAgent(
      project,
      saved.value.assignment,
      saved.value.hash,
    );
    assertEquals(deleted, { ok: true, value: null });
    assertEquals(await operators(), []);
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("shell/workspace#R37 [agent-I34]: 실제 core: 자리 설정의 권한과 role model은 바꾼 칸만 쓰여 overview로 다시 읽힌다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-agents-settings-" });
  const core = await startRealCore();
  try {
    const project = newId("prj");
    const registered = await coreLauncherSource(core.source, undefined)
      .register({
        id: project,
        name: "agents-settings",
        title: "Agents settings",
        purpose: "",
        folders: [{ path: folder, description: "Docs" }],
      });
    assert(registered.ok, JSON.stringify(registered));
    const source = coreAgentsSource(core.source, { instructions: undefined });

    const first = await source.overview(project);
    assert(first.ok, JSON.stringify(first));
    assertEquals(first.value.chosenModels, {});
    assertEquals(first.value.permissions, []);

    const permitted = await source.setPermission(
      project,
      "document.list",
      true,
    );
    assertEquals(
      permitted,
      { ok: true, value: null },
      JSON.stringify(permitted),
    );
    const model = {
      provider: newId("pvd"),
      model_name: "Sonnet 5.5",
      option_values: {},
    };
    const chosen = await source.changeRoleModel(project, "operator", model);
    assertEquals(chosen, { ok: true, value: null }, JSON.stringify(chosen));

    const after = await source.overview(project);
    assert(after.ok, JSON.stringify(after));
    assertEquals(after.value.chosenModels, { operator: model });
    assertEquals(
      after.value.permissions.map((rule) => rule.tool),
      ["document.list"],
    );

    // 비우면 칸이 사라지고 권한은 그대로다.
    assertEquals(await source.changeRoleModel(project, "operator", null), {
      ok: true,
      value: null,
    });
    const cleared = await source.overview(project);
    assert(cleared.ok);
    assertEquals(cleared.value.chosenModels, {});
    assertEquals(cleared.value.permissions.length, 1);
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
