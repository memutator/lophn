import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import { createLedgerHarness } from "../../../../apps/core/testing/ledger.ts";
import type { SeriesDraft } from "../../../protocol/projects/mod.ts";
import { listInstances, listReservedKeys, loadSeries } from "./store.ts";
import { createSeriesCommands } from "./commands.ts";
import { ids, keep, seriesFixture, userContext } from "./testing/mod.ts";

const commands = createSeriesCommands();

const PROJECT = { kind: "project" as const, id: ids.project };
const APP_PLACE = { kind: "app" as const, id: ids.app };

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "series.create",
  "series.update",
  "series.set_draft",
  "series.clear_draft",
  "series.add_instance",
  "series.update_instance",
  "series.remove_instance",
  "series.archive",
  "series.unarchive",
];

function cred(actor = "user") {
  return {
    actor,
    principal: "test" + actor,
    credential_ref: `test:${actor}:cred`,
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

function createInput(
  id = ids.series,
  place: { kind: "project" | "app"; id: string } = PROJECT,
  name = "weekly",
  order = { kind: "key" as const, direction: "ascending" as const },
) {
  return {
    id,
    place,
    name,
    title: "주간 보고",
    format: "document",
    order,
    next_rule: "{n+1}",
  };
}

function draft(
  document = ids.doc,
  key = "0.4",
  base_version: string | null = null,
): SeriesDraft {
  return {
    document,
    key,
    base_version,
    format: { name: "document", module_hash: "ab".repeat(32), explicit: false },
    content: null,
  };
}

function create(
  fixture: ReturnType<typeof seriesFixture>,
  input = createInput(),
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.create.handle(tx, actor, input as never, {})
  );
}

function seedFamily(fixture: ReturnType<typeof seriesFixture>) {
  fixture.seedDocument(ids.doc, {
    kind: "project",
    id: ids.project,
    name: "weekly-2026-39",
  });
  const created = keep(create(fixture));
  return keep(
    fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        {
          series: ids.series,
          document: ids.doc,
          key: "2026-39",
        } as never,
        { base_revision: created.revision },
      )
    ),
  );
}

Deno.test("documents/series#R1: 사람이 가족을 만들고 멤버 key를 가입하며 event를 남긴다", () => {
  const fixture = seriesFixture();
  try {
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    const created = keep(create(fixture));
    assertEquals(created.id, ids.series);
    assertEquals(created.status, "active");
    assertEquals(created.draft, null);
    assertEquals(fixture.emitted[0].type, "SeriesCreated");
    assertEquals(fixture.emitted[0].subject, ids.series);
    // 첫 가입.
    const joined = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          {
            series: ids.series,
            document: ids.doc,
            key: "2026-39",
          } as never,
          { base_revision: created.revision },
        )
      ),
    );
    assertEquals(BigInt(joined.revision) > BigInt(created.revision), true);
    assertEquals(fixture.emitted.at(-1)?.type, "SeriesInstanceAdded");
    // 가입 행과 key 예약이 남는다.
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM series_instances WHERE series = ?",
      [ids.series],
    );
    assertEquals(count?.["count"], 1);
    const reserved = fixture.sql.get(
      "SELECT document FROM series_keys WHERE series = ? AND key = ?",
      [ids.series, "2026-39"],
    );
    assertEquals(reserved?.["document"], ids.doc);
    // lophn agent는 mutation이 거절된다(R9).
    const agent = userContext(`agent:asg_01arz3ndektsv4rrffq69g5fav`, ids.run);
    const denied = fixture.transaction((tx) =>
      commands.create.handle(tx, agent, createInput(ids.series2) as never, {})
    );
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    // coding_agent·app은 만들 수 있다.
    const codingAgent = userContext(
      `coding_agent:cac_01arz3ndektsv4rrffq69g5fav`,
    );
    const byAgent = keep(
      create(
        fixture,
        createInput(ids.series2, PROJECT, "agent-weekly"),
        codingAgent,
      ),
    );
    assertEquals(byAgent.id, ids.series2);
    const app = userContext(`app:${ids.app}`);
    const byApp = keep(
      create(
        fixture,
        createInput("ser_01arz3ndektsv4rrffq69g5fb0", APP_PLACE, "app-weekly"),
        app,
      ),
    );
    assertEquals(byApp.id, "ser_01arz3ndektsv4rrffq69g5fb0");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R1: first save + first join은 같은 transaction에서 남는다(leftover)", () => {
  const fixture = seriesFixture();
  try {
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    // versions concern의 save가 series의 첫 가입을 같은 transaction에 남기는 seam은
    // T17 자리 밖이다. 여기서는 fixture 재사용 없이 addInstance가 transaction 안에서
    // 시험됨을 확인한다.
    const created = keep(create(fixture));
    const joined = fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        {
          series: ids.series,
          document: ids.doc,
          key: "2026-39",
        } as never,
        { base_revision: created.revision },
      )
    );
    assert(joined.ok);
    // rollback 시 event와 쓰기가 같이 사라진다(fixture transaction helper).
    assert(
      fixture.emitted.some((entry) => entry.type === "SeriesInstanceAdded"),
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R2: key는 가족 안 유일하고 멤버를 빼도 예약이 남는다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture));
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    fixture.seedDocument(ids.doc2, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-40",
    });
    const joined = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc, key: "2026-39" } as never,
          { base_revision: created.revision },
        )
      ),
    );
    // 같은 key 다른 문서 가입은 거절이다.
    const sameKey = fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        { series: ids.series, document: ids.doc2, key: "2026-39" } as never,
        { base_revision: joined.revision },
      )
    );
    assert(!sameKey.ok);
    assertEquals(sameKey.error.code, "conflict");
    // 멤버를 빼도 key 예약은 남는다.
    const removed = keep(
      fixture.transaction((tx) =>
        commands.removeInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc } as never,
          { base_revision: joined.revision },
        )
      ),
    );
    // 제거 뒤 같은 key 다른 문서 가입은 여전히 거절이다.
    const rejoin = fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        { series: ids.series, document: ids.doc2, key: "2026-39" } as never,
        { base_revision: removed.revision },
      )
    );
    assert(!rejoin.ok);
    assertEquals(rejoin.error.code, "conflict");
    // 예약 행은 남는다.
    const reserved = fixture.sql.get(
      "SELECT document FROM series_keys WHERE series = ? AND key = ?",
      [ids.series, "2026-39"],
    );
    assertEquals(reserved?.["document"], ids.doc);
    // 같은 문서의 재가입은 옭이다(예약이 자기 것이라 멤버가 다시 된다).
    const rejoinSelf = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc, key: "2026-39" } as never,
          { base_revision: removed.revision },
        )
      ),
    );
    assertEquals(rejoinSelf.status, "active");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R2: 같은 place·format의 문서만 멤버고 key는 주소 이름과 별개다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture));
    // 다른 place의 문서 가입은 거절이다.
    fixture.seedDocument(ids.doc, {
      kind: "app",
      id: ids.app,
      name: "elsewhere",
    });
    const wrongPlace = fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        { series: ids.series, document: ids.doc, key: "w-1" } as never,
        { base_revision: created.revision },
      )
    );
    assert(!wrongPlace.ok);
    assertEquals(wrongPlace.error.code, "invalid_input");
    // 같은 place, 다른 format의 문서 가입도 거절이다.
    fixture.seedDocument(ids.doc2, {
      kind: "project",
      id: ids.project,
      name: "other",
    }, "spec");
    const wrongFormat = fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        { series: ids.series, document: ids.doc2, key: "w-2" } as never,
        { base_revision: created.revision },
      )
    );
    assert(!wrongFormat.ok);
    assertEquals(wrongFormat.error.code, "invalid_input");
    // 같은 place·format의 문서 가입은 옭이다. key는 문서 address 이름과 별개 값이다.
    fixture.seedDocument(ids.doc3, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    const joined = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          {
            series: ids.series,
            document: ids.doc3,
            key: "data-2026-39",
          } as never,
          { base_revision: created.revision },
        )
      ),
    );
    assertEquals(joined.status, "active");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R3: 판 저장은 멤버 key를 바꾸지 않고 새 판으로 남는다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture));
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    const joined = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc, key: "2026-39" } as never,
          { base_revision: created.revision },
        )
      ),
    );
    // 같은 문서, 다른 판을 가입하면 conflict다(멤버 수정은 같은 doc의 새 판이므로
    // add_instance가 아니라 document.save가 latest_version을 옮긴다).
    const dup = fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        { series: ids.series, document: ids.doc, key: "2026-40" } as never,
        { base_revision: joined.revision },
      )
    );
    assert(!dup.ok);
    assertEquals(dup.error.code, "conflict");
    assertEquals(dup.error.message, "document is already a member");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R8: 다음 rule 가지로 다음 key가 나온다", () => {
  const fixture = seriesFixture();
  try {
    // P001→P002 가족을 만든다.
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "paper-p001",
    });
    const pSeries = keep(
      create(
        fixture,
        createInput(ids.series, PROJECT, "papers", {
          kind: "key",
          direction: "ascending",
        }),
      ),
    );
    // 다음 rule로 제안을 얻는 건 read(T18)다. 여기서는 rule 바꾸기(update)만 시험한다.
    const updated = keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          userContext(),
          { series: ids.series, next_rule: "{n+1:03}" } as never,
          { base_revision: pSeries.revision },
        )
      ),
    );
    assertEquals(updated.next_rule, "{n+1:03}");
    assertEquals(updated.revision !== pSeries.revision, true);
    // version 가족의 rule 가지도 바꾼다.
    const vSeries = keep(
      create(fixture, createInput(ids.series2, PROJECT, "releases")),
    );
    const updatedV = keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          userContext(),
          { series: ids.series2, next_rule: "{major}" } as never,
          { base_revision: vSeries.revision },
        )
      ),
    );
    assertEquals(updatedV.next_rule, "{major}");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R8: 5자리 폭·해석 불가 rule은 등록이 거절된다", async () => {
  // route.input schema 검사는 executor에서 한다(platform/ledger). leaf handle은
  // schema 뒤의 input을 받으므로 등록 거절은 harness command로만 본다.
  const opened = await createLedgerHarness({
    registrationModules: [new URL("./registration_test.ts", import.meta.url)],
    credentials: [cred()],
    nowMs: Date.UTC(2026, 0, 1),
  });
  const harness = keep(opened);
  try {
    let sequence = 0;
    const envelope = (input: unknown) => {
      sequence += 1;
      return {
        command: "series.create",
        input,
        compare: {},
        idempotency_key: `k-${sequence}`,
        prepared: [],
      };
    };
    // 5자리 폭은 nextRuleSchema 폭 가지{0?[1-4]}를 통과하지 못한다.
    code(
      await harness.command(
        cred(),
        envelope({
          ...createInput(ids.series, PROJECT, "wide"),
          next_rule: "{n+1:000005}",
        }),
      ),
      "invalid_input",
    );
    // 해석 불가 placeholder는 거절이다.
    code(
      await harness.command(
        cred(),
        envelope({
          ...createInput(ids.series, PROJECT, "wide"),
          next_rule: "{week+1}",
        }),
      ),
      "invalid_input",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("documents/series#R10: 보관은 user만 하고 문서 상태와 독립이다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture));
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    const joined = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc, key: "2026-39" } as never,
          { base_revision: created.revision },
        )
      ),
    );
    // coding_agent 보관은 거절이다.
    const byAgent = fixture.transaction((tx) =>
      commands.archive.handle(
        tx,
        userContext("coding_agent:cac_01arz3ndektsv4rrffq69g5fav"),
        { series: ids.series } as never,
        { base_revision: joined.revision },
      )
    );
    assert(!byAgent.ok);
    assertEquals(byAgent.error.code, "forbidden");
    // user 보관은 옭이다.
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { series: ids.series } as never,
          { base_revision: joined.revision },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    // 보관 뒤 family 변경은 거절이다.
    const changed = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext(),
        { series: ids.series, title: "새 제목" } as never,
        { base_revision: archived.revision },
      )
    );
    assert(!changed.ok);
    assertEquals(changed.error.code, "conflict");
    // user 해제는 옭이다.
    const unarchived = keep(
      fixture.transaction((tx) =>
        commands.unarchive.handle(
          tx,
          userContext(),
          { series: ids.series } as never,
          { base_revision: archived.revision },
        )
      ),
    );
    assertEquals(unarchived.status, "active");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R11: 가족 draft는 하나고 멤버와는 별개다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture));
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    const joined = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc, key: "2026-39" } as never,
          { base_revision: created.revision },
        )
      ),
    );
    // coding_agent draft는 거절이다.
    const byAgent = fixture.transaction((tx) =>
      commands.setDraft.handle(
        tx,
        userContext("coding_agent:cac_01arz3ndektsv4rrffq69g5fav"),
        { series: ids.series, draft: draft() } as never,
        { base_revision: joined.revision },
      )
    );
    assert(!byAgent.ok);
    assertEquals(byAgent.error.code, "forbidden");
    // user draft는 옭이다.
    const set = keep(
      fixture.transaction((tx) =>
        commands.setDraft.handle(
          tx,
          userContext(),
          { series: ids.series, draft: draft(ids.doc, "2026-40") } as never,
          { base_revision: joined.revision },
        )
      ),
    );
    // draft는 가족 값이다. 멤버 수에는 포함되지 않는다.
    assert(set.draft !== null);
    assertEquals(set.draft.key, "2026-40");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM series_instances WHERE series = ?",
      [ids.series],
    );
    assertEquals(count?.["count"], 1);
    // 두 번째 draft set은 이전 draft를 덮는다(하나뿐이다).
    const again = keep(
      fixture.transaction((tx) =>
        commands.setDraft.handle(
          tx,
          userContext(),
          { series: ids.series, draft: draft(ids.doc, "2026-41") } as never,
          { base_revision: set.revision },
        )
      ),
    );
    assertEquals(again.draft?.key, "2026-41");
    // clear_draft는 draft를 비운다.
    const cleared = keep(
      fixture.transaction((tx) =>
        commands.clearDraft.handle(
          tx,
          userContext(),
          { series: ids.series } as never,
          { base_revision: again.revision },
        )
      ),
    );
    assertEquals(cleared.draft, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R11: 멤버가 아닌 문서의 일치 draft는 가입과 함께 비운다", () => {
  const fixture = seriesFixture();
  try {
    const created = keep(create(fixture));
    fixture.seedDocument(ids.doc, {
      kind: "project",
      id: ids.project,
      name: "weekly-2026-39",
    });
    const joined = keep(
      fixture.transaction((tx) =>
        commands.setDraft.handle(
          tx,
          userContext(),
          { series: ids.series, draft: draft(ids.doc, "2026-40") } as never,
          { base_revision: created.revision },
        )
      ),
    );
    assert(joined.draft !== null);
    // 일치 draft의 document·key로 가입하면 draft는 가입과 함께 비운다(T17).
    const added = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc, key: "2026-40" } as never,
          { base_revision: joined.revision },
        )
      ),
    );
    assertEquals(added.draft, null);
    assertEquals(added.revision !== joined.revision, true);
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM series_instances WHERE series = ?",
      [ids.series],
    );
    assertEquals(count?.["count"], 1);
    const events = fixture.emitted.filter((entry) =>
      entry.subject === ids.series
    ).map((entry) => entry.type);
    assertEquals(events.at(-2), "SeriesDraftCleared");
    assertEquals(events.at(-1), "SeriesInstanceAdded");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R13: 가족 영구 삭제는 없고 보관 뒤에도 멤버·key를 읽는다", () => {
  const fixture = seriesFixture();
  try {
    const family = seedFamily(fixture);
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { series: ids.series } as never,
          { base_revision: family.revision },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    // DELETE는 no-delete trigger로 막는다. 표에서 직접 지우면 오류다.
    let deleted: Error | undefined;
    try {
      fixture.db.exec(
        "DELETE FROM series WHERE id = 'ser_01arz3ndektsv4rrffq69g5fav'",
      );
    } catch (error) {
      deleted = error as Error;
    }
    assert(deleted !== undefined);
    assert(deleted.message.includes("series are archived, not deleted"));
    // 보관 뒤에도 멤버와 예약 key를 읽는다.
    const members = fixture.db.prepare(
      "SELECT COUNT(*) AS count FROM series_instances WHERE series = ?",
    ).get(ids.series) as { count: number };
    assertEquals(members.count, 1);
    const reserved = fixture.db.prepare(
      "SELECT COUNT(*) AS count FROM series_keys WHERE series = ?",
    ).get(ids.series) as { count: number };
    assertEquals(reserved.count, 1);
    // 보관 뒤에도 (place, name) 예약은 남는다. 같은 이름은 conflict다.
    const recreated = fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput(ids.series2, PROJECT, "weekly") as never,
        {},
      )
    );
    assert(!recreated.ok);
    assertEquals(recreated.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R14: 가족 구성은 ledger에 남고 읽기는 event를 만들지 않는다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    const before = fixture.emitted.length;
    // 행 재조회(읽기와 같은 근원)는 event를 만들지 않는다.
    const current = keep(loadSeries(fixture.sql, ids.series));
    assert(current !== null);
    const reserved = keep(listReservedKeys(fixture.sql, ids.series));
    assertEquals(reserved.length, 1);
    const members = keep(listInstances(fixture.sql, ids.series));
    assertEquals(members.length, 1);
    assertEquals(fixture.emitted.length, before);
  } finally {
    fixture.close();
  }
});
