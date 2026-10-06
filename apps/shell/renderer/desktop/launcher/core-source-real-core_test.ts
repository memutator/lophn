// 실제 core 위의 프로젝트 등록과 작업대 열기. fake core는 command 응답 모양을 잘못 흉내 내도
// 통과하므로 temp LOPHN_HOME core에 temp 폴더를 등록해 응답을 그대로 읽는지 본다. 추적 미리보기
// (`/v1/projects/preview_tracking`)는 아직 제품 core가 서빙하지 않아 여기서 부르지 않는다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../testdata/real-core.ts";
import { coreWorkspaceSource } from "../../workspace/core-source.ts";
import { coreTrackingSource } from "../../workspace/tracking/core-source.ts";
import { newId } from "../lophn-space/model.ts";
import { coreLauncherSource } from "./core-source.ts";
import { registerFailure, shortNameOf } from "./model.ts";

Deno.test("shell/desktop#R25, documents/projects#R1, R3: 실제 core에 temp 폴더 프로젝트를 등록하면 카드와 작업대가 그 프로젝트를 추적 꺼짐으로 읽는다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-launcher-project-" });
  await Deno.writeTextFile(`${folder}/goals.md`, "# Goals\n");
  const core = await startRealCore();
  try {
    const launcher = coreLauncherSource(core.source, undefined);
    const before = await launcher.projects();
    assert(before.ok, JSON.stringify(before));
    assertEquals(before.value, []);

    const id = newId("prj");
    const registered = await launcher.register({
      id,
      name: shortNameOf("Quarter plan", []),
      title: "Quarter plan",
      purpose: "Plan the quarter.",
      folders: [{ path: folder, description: "Plans" }],
    });
    assert(registered.ok, JSON.stringify(registered));
    assertEquals(registered.value, {
      id,
      name: "quarter-plan",
      title: "Quarter plan",
      purpose: "Plan the quarter.",
      folders: [{ path: folder }],
      tracking: { enabled: false, patterns: [], useGitignore: false },
      documentCount: 0,
    });

    const cards = await launcher.projects();
    assert(cards.ok);
    assertEquals(cards.value.map((card) => [card.id, card.title]), [
      [id, "Quarter plan"],
    ]);
    assertEquals(cards.value[0]!.tracking.enabled, false);

    // 같은 짧은 이름은 core가 거절하고 화면은 이름 겹침으로 읽는다.
    const again = await launcher.register({
      id: newId("prj"),
      name: "quarter-plan",
      title: "Quarter plan",
      purpose: "",
      folders: [],
    });
    assert(!again.ok);
    assertEquals(registerFailure(again.code), "name-taken");

    const workspace = coreWorkspaceSource(core.source);
    assertEquals(await workspace.project(id), {
      ok: true,
      value: { id, title: "Quarter plan", folders: [{ path: folder }] },
    });
    assertEquals(await workspace.documents(id), { ok: true, value: [] });
    assertEquals(await workspace.contexts(id), { ok: true, value: [] });

    const tracking = coreTrackingSource(core.source);
    const project = await tracking.project(id);
    assert(project.ok, JSON.stringify(project));
    assertEquals(project.value.tracking.enabled, false);
    assertEquals(project.value.folders, [{
      path: folder,
      description: "Plans",
    }]);
    assertEquals(project.value.proposal, {
      enabled: true,
      patterns: [{ effect: "include", glob: "**/*.md" }],
      useGitignore: true,
    });
    assertEquals(await tracking.trackedRoots(id), { ok: true, value: [] });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
