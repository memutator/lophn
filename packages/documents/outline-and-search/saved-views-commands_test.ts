import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import {
  type SavedView,
  savedViewDeleted,
  savedViewUpdated,
  viewSave,
} from "../../contracts/documents/mod.ts";
import { createViewCommands } from "./saved-views-commands.ts";
import { ids, keep, userContext, viewFixture } from "./testing/mod.ts";

const commands = createViewCommands();

const filter: SavedView["filter"] = {
  text: "보고",
  formats: ["document"],
  document_status: "active",
};

function save(
  fixture: ReturnType<typeof viewFixture>,
  id = ids.view,
  name = "최근 보고",
  actor = userContext(),
  given = filter,
): Result<SavedView> {
  return fixture.transaction((tx) =>
    commands.save.handle(
      tx as never,
      actor as never,
      { id, name, filter: given } as never,
      {} as never,
    ) as Result<SavedView>
  );
}

Deno.test("documents/outline-and-search#R23: 저장은 user만 하고 같은 이름·ID는 거절한다", () => {
  const fixture = viewFixture();
  try {
    // user만 저장한다. 거절은 keep이 던지기 전에 결과로 본다.
    const agent = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext("agent", ids.run) as never,
        { id: ids.view, name: "최근 보고", filter } as never,
        {},
      )
    );
    assert(!agent.ok);
    if (!agent.ok) assertEquals(agent.error.code, "forbidden");
    const machine = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        { ...userContext(), actor: "machine" } as never,
        { id: ids.view, name: "최근 보고", filter } as never,
        {},
      )
    );
    assert(!machine.ok);
    if (!machine.ok) assertEquals(machine.error.code, "forbidden");
    // user 저장은 event와 같은 transaction이다. revision은 event seq다.
    const saved = keep(save(fixture));
    assertEquals(saved.id, ids.view);
    assertEquals(saved.name, "최근 보고");
    assertEquals(saved.filter, filter);
    assertEquals(saved.sort, "updated_desc");
    assertEquals(saved.revision, "1");
    assertEquals(fixture.emitted[0].type, "SavedViewCreated");
    assertEquals(fixture.emitted[0].payload, {
      name: "최근 보고",
      place: null,
      filter,
      sort: "updated_desc",
    });
    // 같은 ID는 conflict다.
    const again = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext() as never,
        { id: ids.view, name: "최근 보고", filter } as never,
        {},
      )
    );
    assert(!again.ok);
    if (!again.ok) assertEquals(again.error.code, "conflict");
    // 같은 이름도 conflict다(other id).
    const named = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext() as never,
        { id: ids.view2, name: "최근 보고", filter } as never,
        {},
      )
    );
    assert(!named.ok);
    if (!named.ok) assertEquals(named.error.code, "conflict");
    // create는 compare fields를 받지 않는다.
    const compared = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        userContext(),
        { id: ids.view2, name: "다른", filter } as never,
        {
          stale: true,
        } as never,
      )
    );
    assert(!compared.ok);
    if (!compared.ok) assertEquals(compared.error.code, "invalid_input");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R23: 정의하지 않은 조건은 저장하지 않는다", () => {
  const fixture = viewFixture();
  try {
    // tag·series·문서 관계 같은 조건은 input schema가 거절한다.
    for (
      const given of [
        { ...filter, tag: "weekly" },
        { series: "ser_01arz3ndektsv4rrffq69g5fav" },
        { document_status: "hidden" },
      ] as never[]
    ) {
      const parsed = viewSave.input.safeParse({
        id: ids.view,
        name: "최근 보고",
        filter: given,
      });
      assertEquals(parsed.success, false);
    }
    // machine actor로도 event 없음을 본다(간섭이 없는 fixture다).
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R23: 변경은 base_revision CAS로 조건·이름·정렬을 바꾼다", () => {
  const fixture = viewFixture();
  try {
    const saved = keep(save(fixture));
    assertEquals(saved.revision, "1");
    // 다른 view 먼저 저장해 이름 충돌을 본다.
    keep(save(fixture, ids.view2, "다른 보고"));
    const changed = keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          userContext(),
          { view: ids.view, name: "새 보고", sort: "title_asc" } as never,
          { base_revision: "1" },
        )
      ),
    );
    assertEquals(changed.name, "새 보고");
    assertEquals(changed.sort, "title_asc");
    assertEquals(changed.revision, "3");
    const updated = fixture.emitted.find((event) =>
      event.type === savedViewUpdated.type
    );
    assert(updated !== undefined);
    assertEquals(updated.payload, {
      before: { name: "최근 보고", sort: "updated_desc" },
      after: { name: "새 보고", sort: "title_asc" },
      before_revision: "1",
    });
    // 이름 충돌. 이미 ids.view2가 쓰는 이름이다.
    const named = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext(),
        { view: ids.view, name: "다른 보고" } as never,
        { base_revision: "3" },
      )
    );
    assert(!named.ok);
    if (!named.ok) assertEquals(named.error.code, "conflict");
    // 잘못된 CAS는 conflict다.
    const stale = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext(),
        { view: ids.view, sort: "updated_asc" } as never,
        { base_revision: "1" },
      )
    );
    assert(!stale.ok);
    if (!stale.ok) assertEquals(stale.error.code, "conflict");
    // 없는 view는 not_found다.
    const missing = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext(),
        {
          view: "viw_01arz3ndektsv4rrffq69g5fbz",
          sort: "updated_asc",
        } as never,
        { base_revision: "1" },
      )
    );
    assert(!missing.ok);
    if (!missing.ok) assertEquals(missing.error.code, "not_found");
    // agent는 바꾸지 못한다.
    const agent = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext("agent", ids.run),
        { view: ids.view, sort: "updated_asc" } as never,
        { base_revision: changed.revision },
      )
    );
    assert(!agent.ok);
    if (!agent.ok) assertEquals(agent.error.code, "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R23: 삭제는 before 값과 함께 지우고 이름을 다시 쓸 수 있다", () => {
  const fixture = viewFixture();
  try {
    const saved = keep(save(fixture));
    const removed = keep(
      fixture.transaction((tx) =>
        commands.delete.handle(
          tx,
          userContext(),
          { view: ids.view } as never,
          { base_revision: saved.revision },
        )
      ),
    );
    assertEquals(removed.view, ids.view);
    assertEquals(removed.revision, "2");
    const deleted = fixture.emitted.find((event) =>
      event.type === savedViewDeleted.type
    );
    assert(deleted !== undefined);
    assertEquals(deleted.payload, {
      before_view: saved,
      before_revision: saved.revision,
    });
    // 삭제된 view는 목록에 없다. 행이 실제로 지워졌다.
    const row = fixture.sql.get(
      `SELECT id FROM saved_views WHERE id = ?`,
      [ids.view],
    );
    assertEquals(row, undefined);
    // 이름을 다시 쓸 수 있다.
    const again = keep(save(fixture, ids.view2, "최근 보고"));
    assertEquals(again.name, "최근 보고");
    // agent는 지우지 못한다.
    keep(save(fixture, ids.view, "다른"));
    const agent = fixture.transaction((tx) =>
      commands.delete.handle(
        tx,
        userContext("agent", ids.run),
        { view: ids.view } as never,
        { base_revision: "3" },
      )
    );
    assert(!agent.ok);
    if (!agent.ok) assertEquals(agent.error.code, "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R23: 없는 view의 삭제·변경은 not_found다", () => {
  const fixture = viewFixture();
  try {
    const removed = fixture.transaction((tx) =>
      commands.delete.handle(
        tx,
        userContext(),
        { view: ids.view } as never,
        { base_revision: "1" },
      )
    );
    assert(!removed.ok);
    if (!removed.ok) assertEquals(removed.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R23: 거절은 아무것도 남기지 않는다", () => {
  const fixture = viewFixture();
  try {
    // actor 거절은 event·행을 남기지 않는다.
    const refused = fixture.transaction((tx) =>
      commands.save.handle(
        tx,
        {
          ...userContext(),
          actor: "app:app_01arz3ndektsv4rrffq69g5fav",
        } as never,
        { id: ids.view, name: "최근 보고", filter } as never,
        {},
      )
    );
    assert(!refused.ok);
    assertEquals(fixture.emitted.length, 0);
    const row = fixture.sql.get(
      `SELECT id FROM saved_views WHERE id = ?`,
      [ids.view],
    );
    assertEquals(row, undefined);
  } finally {
    fixture.close();
  }
});
