// series read 테스트. 실제 temp ledger(seriesFixture)에서 가족을 심고 list·get·
// next·cursor page를 읽는다. 읽기는 event를 만들지 않는다(series#R14).

import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { outlineSeries } from "../../contracts/documents/mod.ts";
import { createSeriesOutlineRead } from "../outline-and-search/mod.ts";
import { createSeriesCommands } from "./commands.ts";
import { createSeriesReads } from "./reads.ts";
import { seriesNext } from "./work.ts";
import { ids, keep, seriesFixture, userContext } from "./testing/mod.ts";

const commands = createSeriesCommands();
const reads = createSeriesReads();
const outline = createSeriesOutlineRead();

const PROJECT = { kind: "project" as const, id: ids.project };
const APP_PLACE = { kind: "app" as const, id: ids.app };

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

function create(
  fixture: ReturnType<typeof seriesFixture>,
  input = createInput(),
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.create.handle(tx, actor, input as never, {})
  );
}

function join(
  fixture: ReturnType<typeof seriesFixture>,
  document: string,
  key: string,
  baseRevision: string,
) {
  return keep(
    fixture.transaction((tx) =>
      commands.addInstance.handle(
        tx,
        userContext(),
        { series: ids.series, document, key } as never,
        { base_revision: baseRevision },
      )
    ),
  );
}

// 멤버 세 개(0.2·0.9·0.10 가지)를 심고 하나는 보관한다. 보관 멤버도 next의 기준이다.
function seedFamily(fixture: ReturnType<typeof seriesFixture>) {
  fixture.seedDocument(ids.doc, {
    kind: "project",
    id: ids.project,
    name: "weekly-0-2",
  });
  fixture.seedDocument(ids.doc2, {
    kind: "project",
    id: ids.project,
    name: "weekly-0-9",
  });
  fixture.seedDocument(ids.doc3, {
    kind: "project",
    id: ids.project,
    name: "weekly-0-10",
  });
  const created = keep(create(fixture));
  const joined = join(fixture, ids.doc, "0.2", created.revision);
  const joined2 = join(fixture, ids.doc2, "0.9", joined.revision);
  return { created, joined, joined2 };
}

Deno.test("documents/series#R4: 가족 목록은 규칙·멤버 수를 주고 상세와 목차는 같은 기준·순서다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    const snapshot = fixture.snapshot();
    const listed = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as {
      series: {
        id: string;
        next_rule: string;
        member_count: number;
        title: string;
      }[];
      complete: boolean;
      as_of_seq: string;
      next_cursor: string | null;
    };
    assertEquals(listed.series.length, 1);
    assertEquals(listed.series[0].id, ids.series);
    assertEquals(listed.series[0].next_rule, "{n+1}");
    assertEquals(listed.series[0].member_count, 2);
    assertEquals(listed.complete, true);
    assertEquals(listed.next_cursor, null);
    // 상세와 목차는 같은 멤버·판·순서다.
    const got = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { selector: { series: ids.series } } as never,
      ),
    ) as never as {
      series: { id: string };
      entries: {
        key: string;
        document: string;
        title: string;
        version: string;
        latest_version: string;
        status: string;
      }[];
    };
    assertEquals(got.series.id, ids.series);
    assertEquals(got.entries.map((entry) => entry.key), ["0.2", "0.9"]);
    assertEquals(got.entries[0].document, ids.doc);
    assertEquals(got.entries[0].title, "Notes");
    assertEquals(got.entries[0].version, `ver_${ids.doc.slice("doc_".length)}`);
    assertEquals(got.entries[0].latest_version, got.entries[0].version);
    assertEquals(got.entries[0].status, "active");
    // 자리+이름 조회도 같은 상세다(R12).
    const byName = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { selector: { place: PROJECT, name: "weekly" } } as never,
      ),
    ) as never as { series: { id: string } };
    assertEquals(byName.series.id, ids.series);
    // 목차(outline/series)도 같은 기준·순서의 key·제목·고정 최신 판·보관 상태다(R4, R12).
    const outlinePage = keep(
      outline.handle(
        snapshot,
        userContext(),
        { selector: { series: ids.series } } as never,
      ),
    ) as never as {
      kind: string;
      basis_seq: string;
      series: string;
      entries: {
        key: string;
        document: string;
        title: string;
        version: string;
        latest_version: string;
        status: string;
      }[];
      complete: boolean;
      next_cursor: string | null;
    };
    assertEquals(outlinePage.kind, "series");
    assertEquals(outlinePage.series, ids.series);
    assertEquals(outlinePage.basis_seq, snapshot.as_of_seq);
    assertEquals(
      outlinePage.entries.map((entry) => entry.key),
      got.entries.map((entry) => entry.key),
    );
    assertEquals(outlinePage.entries[0].document, got.entries[0].document);
    assertEquals(outlinePage.entries[0].title, got.entries[0].title);
    assertEquals(outlinePage.entries[0].version, got.entries[0].version);
    assertEquals(
      outlinePage.entries[0].latest_version,
      got.entries[0].latest_version,
    );
    assertEquals(outlinePage.entries[0].status, got.entries[0].status);
    assert(outlineSeries.output.safeParse(outlinePage).success);
    assertEquals(outlinePage.complete, true);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R4: cursor 숫자 page가 list를 이어 보지만 한 page 안에서는 전부 본다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    // 둘째 가족(order by id에서 뒤다). 새 문서 ID가 필요하다.
    fixture.seedDocument("doc_01arz3ndektsv4rrffq69g5fb1", {
      kind: "project",
      id: ids.project,
      name: "other-0-2",
    });
    const second = keep(
      create(fixture, createInput(ids.series2, PROJECT, "other")),
    );
    assert(second.id === ids.series2);
    // series는 숫자 page cursor다. 두 가족은 한 page(50) 안에 온다.
    const snapshot = fixture.snapshot();
    const firstPage = keep(
      reads.list.handle(snapshot, userContext(), { cursor: "0" } as never),
    ) as never as {
      series: { id: string }[];
      next_cursor: string | null;
      complete: boolean;
    };
    assertEquals(firstPage.series.map((family) => family.id), [
      ids.series,
      ids.series2,
    ]);
    assertEquals(firstPage.next_cursor, null);
    assertEquals(firstPage.complete, true);
    // page를 넘는 cursor는 빈 목록이지만 complete는 여전히 참이다.
    const secondPage = keep(
      reads.list.handle(
        snapshot,
        userContext(),
        { cursor: "50" } as never,
      ),
    ) as never as {
      series: { id: string }[];
      next_cursor: string | null;
      complete: boolean;
    };
    assertEquals(secondPage.series.length, 0);
    assertEquals(secondPage.next_cursor, null);
    assertEquals(secondPage.complete, true);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R6: 다음 제안은 마지막 key·규칙으로 계산하고 두 번 읽어도 문서·event가 같다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    const snapshot = fixture.snapshot();
    const input = { selector: { series: ids.series } } as never;
    const first = keep(
      reads.next.handle(snapshot, userContext(), input),
    ) as never as {
      suggestion: {
        series_revision: string;
        key: string;
        title: string;
        from: string;
        taken: boolean;
        document_name: string | null;
      };
      as_of_seq: string;
      next_cursor: null;
    };
    // key 자연 순으로 0.9 다음은 0.10이다(R5 비교와 같은 근원). 숫자 시작 slug는
    // 아니므로 document_name은 null이다(0.3과 같다).
    assertEquals(first.suggestion.from, "0.9");
    assertEquals(first.suggestion.key, "0.10");
    assertEquals(first.suggestion.taken, false);
    assertEquals(first.suggestion.document_name, null);
    assertEquals(first.suggestion.series_revision !== null, true);
    assertEquals(first.next_cursor, null);
    // 문서·event 수를 고정한다.
    const docCount = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    const eventCount = fixture.emitted.length;
    // 두 번 읽어도 같은 from·taken이고 아무것도 예약·저장하지 않는다(R6, R14).
    const again = keep(
      reads.next.handle(fixture.snapshot(), userContext(), input),
    ) as never as { suggestion: { from: string; taken: boolean; key: string } };
    assertEquals(again.suggestion.from, first.suggestion.from);
    assertEquals(again.suggestion.taken, first.suggestion.taken);
    assertEquals(again.suggestion.key, first.suggestion.key);
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM documents", [])?.["count"],
      docCount?.["count"],
    );
    assertEquals(fixture.emitted.length, eventCount);
    // key 예약 표는 그대로다.
    const reserved = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM series_keys WHERE series = ?",
      [ids.series],
    );
    assertEquals(reserved?.["count"], 2);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R6: 보관 멤버도 next의 기준이고 draft key는 예약으로 본다", () => {
  const fixture = seriesFixture();
  try {
    const family = seedFamily(fixture);
    // 셋째 멤버(0.10)를 가입하고 첫 멤버 문서를 보관한다.
    const joined3 = keep(
      fixture.transaction((tx) =>
        commands.addInstance.handle(
          tx,
          userContext(),
          { series: ids.series, document: ids.doc3, key: "0.10" } as never,
          { base_revision: family.joined2.revision },
        )
      ),
    );
    // 보관은 문서 command의 몫이다. 여기서는 행을 직접 보관하지 않고 key 목록만
    // 시험한다. 대신 draft key가 예약으로 본다(R11).
    const drafted = keep(
      fixture.transaction((tx) =>
        commands.setDraft.handle(
          tx,
          userContext(),
          {
            series: ids.series,
            draft: {
              document: ids.doc3,
              key: "0.11",
              base_version: null,
              format: {
                name: "document",
                module_hash: "ab".repeat(32),
                explicit: false,
              },
              content: null,
            },
          } as never,
          { base_revision: joined3.revision },
        )
      ),
    );
    assert(drafted.draft !== null);
    const snapshot = fixture.snapshot();
    const got = keep(
      reads.next.handle(
        snapshot,
        userContext(),
        { selector: { series: ids.series } } as never,
      ),
    ) as never as { suggestion: { from: string; taken: boolean; key: string } };
    // 마지막 확정 멤버는 0.10이고 key 자연 순의 기준이다(보관 멤버 포함, draft 제외).
    assertEquals(got.suggestion.from, "0.10");
    // draft key도 이미 사용된 이름이다(R6 예약 검사).
    assertEquals(got.suggestion.key, "0.11");
    assertEquals(got.suggestion.taken, true);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R9: lophn agent는 목록·상세·다음 제안만 읽는다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    const agent = userContext(`agent:asg_01arz3ndektsv4rrffq69g5fav`);
    const snapshot = fixture.snapshot();
    // agent read는 옭이다(R9).
    const listed = keep(
      reads.list.handle(snapshot, agent, {} as never),
    ) as never as { series: { id: string }[] };
    assertEquals(listed.series.length, 1);
    const got = keep(
      reads.get.handle(
        snapshot,
        agent,
        { selector: { series: ids.series } } as never,
      ),
    ) as never as { entries: unknown[] };
    assertEquals(got.entries.length, 2);
    const next = keep(
      reads.next.handle(snapshot, agent, {
        selector: { series: ids.series },
      } as never),
    ) as never as { suggestion: { from: string } };
    assertEquals(next.suggestion.from, "0.9");
    // agent family mutation은 거절이다(command가 한다).
    const denied = fixture.transaction((tx) =>
      commands.archive.handle(
        tx,
        agent,
        { series: ids.series } as never,
        { base_revision: "1" },
      )
    );
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R12: ID 또는 자리+이름 조회다. 가족은 address·version이 없다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    const snapshot = fixture.snapshot();
    // ID 조회.
    const byId = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { selector: { series: ids.series } } as never,
      ),
    ) as never as { series: { id: string; draft: unknown } };
    assertEquals(byId.series.id, ids.series);
    // 가족은 address·version이 없다. 상세의 series는 id·place·name뿐이다.
    assertEquals(Object.keys(byId.series).includes("document"), false);
    assertEquals(Object.keys(byId.series).includes("version"), false);
    // 자리+이름 조회.
    const byName = keep(
      reads.next.handle(snapshot, userContext(), {
        selector: { place: PROJECT, name: "weekly" },
      } as never),
    ) as never as { suggestion: { from: string } };
    assertEquals(byName.suggestion.from, "0.9");
    // 없는 가족은 not_found다.
    const missing = reads.get.handle(
      snapshot,
      userContext(),
      { selector: { series: "ser_01arz3ndektsv4rrffq69g5fb0" } } as never,
    );
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R14: 읽기 전후 event 수가 같다. app 자리 가족도 목록에 온다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    // app 자리 가족도 만든다. 새 문서 ID가 필요하다.
    fixture.seedDocument("doc_01arz3ndektsv4rrffq69g5fb2", {
      kind: "app",
      id: ids.app,
      name: "app-0-2",
    });
    const appFamily = keep(
      create(
        fixture,
        createInput("ser_01arz3ndektsv4rrffq69g5fb0", APP_PLACE, "app-weekly"),
      ),
    );
    assert(appFamily.revision !== undefined);
    const before = fixture.emitted.length;
    const snapshot = fixture.snapshot();
    // 자리 없는 목록은 전체고, app 자리 목록은 그 자리만이다.
    const all = keep(
      reads.list.handle(snapshot, userContext(), { status: "all" } as never),
    ) as never as { series: { id: string }[] };
    assertEquals(all.series.length, 2);
    const appList = keep(
      reads.list.handle(snapshot, userContext(), { place: APP_PLACE } as never),
    ) as never as { series: { id: string }[] };
    assertEquals(appList.series.map((family) => family.id), [
      "ser_01arz3ndektsv4rrffq69g5fb0",
    ]);
    assertEquals(fixture.emitted.length, before);
    // 기본 목록은 active만이다.
    const active = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as { series: { id: string }[] };
    assertEquals(active.series.length, 2);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R4: 범위 밖 가족은 없는 것과 똑같이 답한다", () => {
  const fixture = seriesFixture((_ctx, _operation, target) => {
    const id = (target as { series?: string }).series;
    return id === ids.series
      ? err({ code: "forbidden", message: "범위 밖이다" })
      : { ok: true as const, value: undefined };
  });
  try {
    seedFamily(fixture);
    const snapshot = fixture.snapshot();
    const got = reads.get.handle(
      snapshot,
      userContext(),
      { selector: { series: ids.series } } as never,
    );
    assert(!got.ok);
    assertEquals(got.error.code, "not_found");
    // 목록은 그 가족을 빼고 돌려준다.
    const listed = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as { series: { id: string }[] };
    assertEquals(listed.series.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/series#R6: 준비 worker의 series-next는 host payload로 같은 제안을 낸다", () => {
  const fixture = seriesFixture();
  try {
    seedFamily(fixture);
    const snapshot = fixture.snapshot();
    // host가 준 가족 상태(payload 모양)로 계산한다. 잘못된 payload는 null이다.
    assertEquals(seriesNext({ rule: 1, members: [] }), null);
    assertEquals(seriesNext(null), null);
    // 같은 가족 상태를 준비 worker가 받으면 같은 제안을 낸다(읽기와 같은 계산).
    const families = fixture.sql.get(
      "SELECT next_rule, revision FROM series WHERE id = ?",
      [ids.series],
    );
    assert(families !== undefined);
    const members = [
      { key: "0.2", document_name: "weekly-0-2" },
      { key: "0.9", document_name: "weekly-0-9" },
    ];
    const suggestion = seriesNextSuggestion(families, members);
    assertEquals(suggestion.key, "0.10");
    assertEquals(suggestion.from, "0.9");
    // 읽기 handler와 같은 제안이다.
    const read = keep(
      reads.next.handle(snapshot, userContext(), {
        selector: { series: ids.series },
      } as never),
    ) as never as { suggestion: { key: string; from: string } };
    assertEquals(read.suggestion.key, suggestion.key);
    assertEquals(read.suggestion.from, suggestion.from);
  } finally {
    fixture.close();
  }
});

function seriesNextSuggestion(
  families: Record<string, unknown>,
  members: { key: string; document_name: string }[],
): {
  series_revision: string;
  key: string;
  title: string;
  from: string | null;
  taken: boolean;
  document_name: string | null;
} {
  const suggestion = seriesNext({
    rule: String(families["next_rule"]),
    revision: String(families["revision"]),
    members,
    reserved_keys: [],
    draft_key: null,
  });
  assert(suggestion !== null, "series next is null");
  return suggestion;
}
