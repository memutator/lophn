// 실제 core 위의 Context 화면 통로. fake core는 응답 모양을 잘못 흉내 내도 통과하므로 temp
// LOPHN_HOME core에 프로젝트와 context를 만들어 source가 응답을 그대로 읽는지 본다. 적용된 판은
// agent·worker 자격으로만 만들어져 여기서는 만드는 중(drafting) context를 쓴다. 색인(context
// worker)이 필요한 search·input_options는 적용된 판이 없는 context에서 실패로 돌아와야 하고
// 화면은 그 실패를 상태로 보인다(crash가 아니다).
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../testdata/real-core.ts";
import { newId } from "../../desktop/lophn-space/model.ts";
import { coreLauncherSource } from "../../desktop/launcher/core-source.ts";
import { coreContextsSource } from "./core-source.ts";

Deno.test("[ctx-I39b] 실제 core: context를 만들면 목록·get·contract·draft·bundles·overview·violations를 source로 읽는다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-ctx-project-" });
  const core = await startRealCore();
  try {
    const project = newId("prj");
    const registered = await coreLauncherSource(core.source, undefined)
      .register({
        id: project,
        name: "ctx-project",
        title: "Ctx project",
        purpose: "Context screens.",
        folders: [{ path: folder, description: "Docs" }],
      });
    assert(registered.ok, JSON.stringify(registered));
    const source = coreContextsSource(core.source);
    assertEquals(await source.list(project), { ok: true, value: [] });

    const id = newId("ctx");
    const created = await core.source.call({
      kind: "command",
      resource: "contexts",
      method: "create",
      body: {
        input: { id, project, title: "Eval", purpose: "Why we evaluate" },
        idempotency_key: `contexts-create-${id}`,
        compare: {},
        prepared: [],
      },
    });
    assert(created.ok, JSON.stringify(created));

    const list = await source.list(project);
    assert(list.ok, JSON.stringify(list));
    assertEquals(list.value.map((item) => [item.id, item.title, item.status]), [
      [id, "Eval", "drafting"],
    ]);
    assertEquals(list.value[0]!.applied_number, null);
    assertEquals(list.value[0]!.draft_bundle, null);

    const detail = await source.get(id);
    assert(detail.ok, JSON.stringify(detail));
    assertEquals(detail.value.context.purpose, "Why we evaluate");
    assertEquals(detail.value.applied, null);
    assertEquals(Object.keys(detail.value).sort(), ["applied", "context"]);

    assertEquals(await source.contract(id), {
      ok: true,
      value: { context: id, bundle: null, bundle_hash: null, content: null },
    });
    assertEquals(await source.draft(id), {
      ok: true,
      value: {
        context: id,
        draft: { step: 1, bundle: null, content: null, check: null },
      },
    });
    assertEquals(await source.bundles(id), { ok: true, value: [] });
    assertEquals(await source.violations(id), {
      ok: true,
      value: { violations: [], complete: true, next_cursor: null },
    });
    const overview = await source.overview(id);
    assert(overview.ok, JSON.stringify(overview));
    assertEquals(overview.value.types, []);
    assertEquals(overview.value.bundle_hash, null);
    assertEquals(overview.value.violation_count, 0);

    assertEquals(await source.containing(project, "a.md"), {
      ok: true,
      value: [],
    });
    assertEquals(await source.operatorCount(id), { ok: true, value: 0 });

    // 없는 context는 not_found로 읽힌다.
    assertEquals(await source.get(newId("ctx")), {
      ok: false,
      message: "not_found",
    });
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("[ctx-I39b] 실제 core: 용어는 새로 넣고 고치고 지우며, 낡은 revision은 conflict로 돌아온다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-ctx-glossary-" });
  const core = await startRealCore();
  try {
    const project = newId("prj");
    const registered = await coreLauncherSource(core.source, undefined)
      .register({
        id: project,
        name: "ctx-glossary",
        title: "Ctx glossary",
        purpose: "",
        folders: [{ path: folder, description: "Docs" }],
      });
    assert(registered.ok, JSON.stringify(registered));
    const id = newId("ctx");
    const created = await core.source.call({
      kind: "command",
      resource: "contexts",
      method: "create",
      body: {
        input: { id, project, title: "Eval", purpose: "Why" },
        idempotency_key: `contexts-create-${id}`,
        compare: {},
        prepared: [],
      },
    });
    assert(created.ok, JSON.stringify(created));
    const source = coreContextsSource(core.source);

    assertEquals(await source.glossary(id), { ok: true, value: [] });
    assertEquals(await source.savedViews(id), { ok: true, value: [] });

    const entryId = newId("trm");
    const added = await source.glossarySet({
      id: entryId,
      context: id,
      term: "Harness",
      meaning: "The test rig.",
    });
    assert(added.ok, JSON.stringify(added));
    assertEquals(added.value.set_by, "user");

    const edited = await source.glossarySet(
      { entry: entryId, meaning: "The runner." },
      { base_revision: added.value.revision },
    );
    assert(edited.ok, JSON.stringify(edited));
    assertEquals(edited.value.meaning, "The runner.");

    const stale = await source.glossarySet(
      { entry: entryId, meaning: "Stale." },
      { base_revision: added.value.revision },
    );
    assertEquals(stale, { ok: false, message: "conflict" });

    const listed = await source.glossary(id);
    assert(listed.ok, JSON.stringify(listed));
    assertEquals(listed.value.map((entry) => [entry.term, entry.meaning]), [
      ["Harness", "The runner."],
    ]);

    const removed = await source.glossaryRemove(
      { entry: entryId },
      { base_revision: edited.value.revision },
    );
    assertEquals(removed, { ok: true, value: { entry: entryId } });
    assertEquals(await source.glossary(id), { ok: true, value: [] });
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("[ctx-I39b] 실제 core: 적용된 판이 없는 context의 search·input_options·rollback·넘기기는 crash 없이 실패로 읽힌다", async () => {
  const folder = await Deno.makeTempDir({ prefix: "lophn-ctx-unavailable-" });
  const core = await startRealCore();
  try {
    const project = newId("prj");
    const registered = await coreLauncherSource(core.source, undefined)
      .register({
        id: project,
        name: "ctx-unavailable",
        title: "Ctx unavailable",
        purpose: "",
        folders: [{ path: folder, description: "Docs" }],
      });
    assert(registered.ok, JSON.stringify(registered));
    const id = newId("ctx");
    const created = await core.source.call({
      kind: "command",
      resource: "contexts",
      method: "create",
      body: {
        input: { id, project, title: "Eval", purpose: "Why" },
        idempotency_key: `contexts-create-${id}`,
        compare: {},
        prepared: [],
      },
    });
    assert(created.ok, JSON.stringify(created));
    const source = coreContextsSource(core.source);

    const search = await source.search({
      context: id,
      search: "all",
      inputs: {},
    });
    assert(!search.ok);
    assert(search.message.length > 0);
    const options = await source.inputOptions({
      context: id,
      search: "all",
      input: "who",
    });
    assert(!options.ok);
    assert(options.message.length > 0);
    const rollback = await source.rollback({
      context: id,
      bundle: newId("cbn"),
    });
    assertEquals(rollback, { ok: false, message: "not_found" });
    // 넘길 위반이 없으면 core가 거절한다.
    const handOff = await source.handOffViolations({ context: id });
    assert(!handOff.ok);
  } finally {
    await core.stop();
    await Deno.remove(folder, { recursive: true });
  }
});
