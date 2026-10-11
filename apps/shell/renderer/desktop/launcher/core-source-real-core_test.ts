// 실제 core 위의 프로젝트 등록과 작업대 열기. fake core는 command 응답 모양을 잘못 흉내 내도
// 통과하므로 temp LOPHN_HOME core에 temp 폴더를 등록해 응답을 그대로 읽는지 본다. 추적 미리보기
// (`/v1/projects/preview_tracking`)·켜기·사람 파일 목록(`/v1/files/list`)도 실제 core로 본다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../testdata/real-core.ts";
import { coreWorkspaceSource } from "../../workspace/core-source.ts";
import { coreTrackingSource } from "../../workspace/tracking/core-source.ts";
import { newId } from "../lophn-space/model.ts";
import { coreLauncherSource } from "./core-source.ts";
import { registerFailure, shortNameOf } from "./model.ts";

async function until<T>(
  label: string,
  read: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const found = await read();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`기다림 초과: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

Deno.test("shell/desktop#R25, documents/projects#R1, R3, R6, R7: 실제 core에 temp 폴더 프로젝트를 등록하면 카드와 작업대가 그 프로젝트를 추적 꺼짐으로 읽고, 미리본 구성 그대로 추적을 켠다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-launcher-project-" });
  await Deno.writeTextFile(`${folder}/goals.md`, "# Goals\n");
  await Deno.writeTextFile(`${folder}/scratch.txt`, "scratch\n");
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

    // 추적 미리보기와 켜기(shell#T15에서 넘어옴, documents#T12가 서빙). 미리보기는 폴더를
    // 실제로 scan해 포함·제외와 그 이유를 돌려주고, 켜기는 미리 본 구성을 그대로 보낸다.
    const preview = await tracking.preview(
      project.value,
      project.value.proposal,
    );
    assert(preview.ok, JSON.stringify(preview));
    const goals = preview.value.entries.find((entry) =>
      entry.path === "goals.md"
    );
    assertEquals(goals?.included, true);
    assert((goals?.reason ?? "").length > 0);
    const scratch = preview.value.entries.find((entry) =>
      entry.path === "scratch.txt"
    );
    if (scratch) {
      assertEquals(scratch.included, false);
      assert(scratch.reason.length > 0);
    }
    const turnedOn = await tracking.apply(project.value, preview.value);
    assert(turnedOn.ok, JSON.stringify(turnedOn));
    assertEquals(turnedOn.value.tracking.enabled, true);
    // 다른 프로젝트에서 보면 이 폴더가 켜진 폴더다(겹침 검사).
    const roots = await tracking.trackedRoots(newId("prj"));
    assert(roots.ok);
    assertEquals(roots.value.map((root) => root.path), [folder]);
    // 켠 폴더의 파일이 사람 파일 목록에 오고, 작업대 팔레트 파일 묶음 읽기는 실패하지 않는다.
    const listed = await until("files.list", async () => {
      const reply = await core.source.call({
        kind: "read",
        resource: "files",
        method: "list",
        body: { project: id },
      });
      const targets = reply.ok
        ? (reply.value as { targets: { path?: string }[] }).targets
        : [];
      return targets.length > 0 ? targets : undefined;
    });
    assertEquals(listed.map((target) => target.path), [`${folder}/goals.md`]);
    const files = await workspace.files(id);
    assert(files.ok, JSON.stringify(files));
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
