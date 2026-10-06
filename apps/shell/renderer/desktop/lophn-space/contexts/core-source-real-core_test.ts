// 실제 core 위의 contexts 통로. fake core는 route 이름과 응답 모양을 잘못 흉내 내도 통과하므로
// temp LOPHN_HOME core에 Focus를 만들고 목록·목차·watch·뜻 정하기·export를 그대로 읽는지 본다.
import { assert, assertEquals } from "@std/assert";

import { startRealCore } from "../../../testdata/real-core.ts";
import { newId } from "../model.ts";
import { coreContextsSource } from "./core-source.ts";

Deno.test("shell/desktop#R28: 실제 core에서 Focus 목록·항목·watch 결과·뜻 정하기·export를 contract 그대로 읽는다", async () => {
  const core = await startRealCore();
  try {
    const id = newId("ctx");
    const created = await core.source.call({
      kind: "command",
      resource: "contexts",
      method: "create",
      body: {
        input: {
          id,
          title: "Grocery budget",
          purpose: "Keep food spending under the plan.",
          items: [],
        },
        idempotency_key: `create-${id}`,
        compare: {},
        prepared: [],
      },
    });
    assert(created.ok, JSON.stringify(created));
    const source = coreContextsSource(core.source);
    const list = await source.list("active");
    assert(list.ok, JSON.stringify(list));
    assertEquals(list.value.map((row) => [row.id, row.title, row.items]), [
      [id, "Grocery budget", 0],
    ]);
    const focus = await source.focus(id);
    assert(focus.ok, JSON.stringify(focus));
    assertEquals(focus.value.purpose, "Keep food spending under the plan.");
    assertEquals(focus.value.items, []);
    assertEquals(focus.value.partial, false);
    const watch = await source.watch(id);
    // derived store가 아직 없으면 미확인을 읽지 못한 것이라 unavailable이다.
    if (watch.ok) assertEquals(watch.value, { changes: [], unverified: [] });
    else assertEquals(watch.code, "unavailable");
    const defined = await source.define({
      focus: id,
      name: "eating out",
      definition: "Any meal we pay someone else to cook.",
    });
    assert(defined.ok, JSON.stringify(defined));
    const meanings = await source.meanings(id);
    assert(meanings.ok, JSON.stringify(meanings));
    assertEquals(
      meanings.value.definitions.map((term) => [term.name, term.definition]),
      [["eating out", "Any meal we pay someone else to cook."]],
    );
    assertEquals(meanings.value.candidates, []);
    const exported = await source.exportFocus(id);
    assert(exported.ok, JSON.stringify(exported));
    assertEquals(exported.value.glossary, [{
      name: "eating out",
      definition: "Any meal we pay someone else to cook.",
    }]);
    const archived = await source.setArchived(focus.value, true);
    assert(archived.ok, JSON.stringify(archived));
    const all = await source.list("all");
    assert(all.ok);
    assertEquals(all.value.map((row) => row.archived), [true]);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- core ---\n${core.log()}`);
  } finally {
    await core.stop();
  }
});
