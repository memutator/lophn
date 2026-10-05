// saved view read test. viewFixture의 실제 temp ledger 위에서 list·get·open을
// 본다. open은 매번 조건으로 다시 만들고(R24), 항목은 outline place 항목 모양이다
// (R25), cursor는 위치·basis 검사를 거친다.
import { assert, assertEquals } from "@std/assert";
import { canonicalize, err, ok } from "../../base/mod.ts";
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import type { SavedView } from "../../contracts/documents/mod.ts";
import { createViewOpenHandler, createViewReads } from "./saved-views-reads.ts";
import { createViewCommands } from "./saved-views-commands.ts";
import { ids, keep, userContext, viewFixture } from "./testing/mod.ts";

const reads = createViewReads();
const commands = createViewCommands();

const filter: SavedView["filter"] = {
  document_status: "active",
};

function save(
  fixture: ReturnType<typeof viewFixture>,
  id = ids.view,
  name = "모든 문서",
  given: SavedView["filter"] = filter,
): SavedView {
  const result = fixture.transaction((tx) =>
    commands.save.handle(
      tx as never,
      userContext() as never,
      { id, name, filter: given } as never,
      {} as never,
    ) as never
  ) as { ok: boolean; error?: { code: string; message: string } };
  if (!result.ok) {
    throw new Error(
      `${result.error?.code}: ${result.error?.message}`,
    );
  }
  return loadView(fixture, id);
}

function loadView(
  fixture: ReturnType<typeof viewFixture>,
  id: string,
): SavedView {
  const get = keep(reads.get.handle(
    fixture.snapshot() as never,
    userContext() as never,
    { view: id } as never,
  ) as never as { ok: true; value: { view: SavedView } });
  return get.view;
}

type Opened = {
  kind: "view";
  basis_seq: string;
  view: string;
  revision: string;
  filter: SavedView["filter"];
  opened_at_ms: number;
  entries: {
    document: string;
    name: string | null;
    title: string;
    version: string;
    latest_version: string;
    format: { name: string; module_hash: string; explicit: boolean };
    saved_by: string;
    saved_at: string;
    section_count: number;
  }[];
  coverage: unknown;
  complete: boolean;
  next_cursor: string | null;
};

function openAllowed(
  fixture: ReturnType<typeof viewFixture>,
  ctx = userContext(),
  input: { view: string; estimated_token_budget?: number; cursor?: string } = {
    view: ids.view,
  },
  nowMs: () => number = () => 1000,
) {
  const handler = createViewOpenHandler({
    read: fixture.derivedRead(),
    snapshot: fixture.snapshot(),
    ports: {
      port: <T>(key: never): T => {
        if (key !== (TargetAuthorization as never)) {
          throw new Error("unregistered port");
        }
        return fixture.authorizer.current as T;
      },
    },
    nowMs,
  });
  const result = handler.open(ctx as never, input as never) as {
    ok: boolean;
    error?: { code: string; message: string };
    value?: Opened;
  };
  if (!result.ok) {
    throw new Error(`${result.error?.code}: ${result.error?.message}`);
  }
  return result.value as Opened;
}

function openRaw(
  fixture: ReturnType<typeof viewFixture>,
  ctx = userContext(),
  input: { view: string; estimated_token_budget?: number; cursor?: string } = {
    view: ids.view,
  },
  nowMs: () => number = () => 1000,
) {
  const handler = createViewOpenHandler({
    read: fixture.derivedRead(),
    snapshot: fixture.snapshot(),
    ports: {
      port: <T>(key: never): T => {
        if (key !== (TargetAuthorization as never)) {
          throw new Error("unregistered port");
        }
        return fixture.authorizer.current as T;
      },
    },
    nowMs,
  });
  return handler.open(ctx as never, input as never);
}

type CursorBasis = {
  view: string;
  revision: string;
  filter: SavedView["filter"];
  sort: "updated_desc" | "updated_asc" | "title_asc" | "address_asc";
  credential: string;
};

// cursor를 만들어 open에 넣는다. open이 거절하면 그 code를 본다.
function openCursorError(
  fixture: ReturnType<typeof viewFixture>,
  bound: CursorBasis,
  decoded: CursorBasis,
): string {
  const bytes = new TextEncoder().encode(
    canonicalize({ page: { after: ids.doc }, basis: decoded }),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const cursor = btoa(binary);
  const result = openRaw(
    fixture,
    userContext(),
    { view: bound.view, cursor },
  ) as { ok: boolean; error?: { code: string } };
  if (result.ok) return "ok";
  return result.error?.code ?? "unknown";
}

Deno.test("documents/outline-and-search#R23: 목록은 cursor pagination으로 window를 준다", () => {
  const fixture = viewFixture();
  try {
    save(fixture, ids.view, "첫");
    save(fixture, ids.view2, "둘");
    const listed = reads.list.handle(
      fixture.snapshot() as never,
      userContext() as never,
      {} as never,
    ) as {
      ok: boolean;
      value?: { views: SavedView[]; complete: boolean; next_cursor: unknown };
      error?: { code: string; message: string };
    };
    assert(listed.ok);
    assert(listed.value !== undefined);
    assertEquals(listed.value.views.length, 2);
    assertEquals(listed.value.complete, true);
    assertEquals(listed.value.next_cursor, null);
    // 잘못된 cursor는 invalid_input이다.
    const bad = reads.list.handle(
      fixture.snapshot() as never,
      userContext() as never,
      { cursor: "abc" } as never,
    );
    assert(!bad.ok);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R24: open은 저장한 조건으로 현재 허용 문서를 다시 만든다", () => {
  const fixture = viewFixture();
  try {
    fixture.seedDocument(ids.doc);
    fixture.seedDocument(ids.doc2);
    save(fixture);
    const allowed = openAllowed(fixture);
    assertEquals(allowed.entries.map((entry) => entry.document), [
      ids.doc,
      ids.doc2,
    ]);
    // 조건은 문서·판·Context 행을 새로 만들지 않는다. 읽기다.
    const before = fixture.count("versions");
    const again = openAllowed(fixture);
    assertEquals(again.entries.length, 2);
    assertEquals(fixture.count("versions"), before);
    // archived 문서는 document_status active 조건에서 빠진다.
    fixture.archiveDocument(ids.doc);
    const after = openAllowed(fixture);
    assertEquals(after.entries.map((entry) => entry.document), [ids.doc2]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R24: 범위 밖 문서는 없는 문서와 같이 없다", () => {
  const fixture = viewFixture();
  try {
    fixture.seedDocument(ids.doc);
    fixture.seedDocument(ids.doc2);
    save(fixture);
    // doc만 허용한다.
    fixture.useAuthorizer((_ctx, _operation, target) => {
      const document = (target as { document?: string }).document;
      if (document === ids.doc2) {
        return err({ code: "forbidden", message: "out of scope" });
      }
      return ok(undefined);
    });
    const opened = openAllowed(fixture);
    assertEquals(opened.entries.map((entry) => entry.document), [ids.doc]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R24: text 조건이 있으면 coverage가 붙고 없으면 null이다", () => {
  const fixture = viewFixture();
  try {
    fixture.seedDocument(ids.doc);
    save(fixture, ids.view, "본문 조건", {
      text: "보고",
      formats: ["document"],
      document_status: "active",
    });
    const withText = openAllowed(fixture);
    assert(withText.coverage !== null);
    save(fixture, ids.view2, "본문 없음", {
      document_status: "active",
    });
    const withoutText = openAllowed(fixture, undefined, {
      view: ids.view2,
    });
    assertEquals(withoutText.coverage, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R24: 상대 기간은 open 시각에 고정된다", () => {
  const fixture = viewFixture();
  try {
    // saved_at이 open 시각보다 5분 전이다. 10분 안이면 있다.
    fixture.seedDocument(
      ids.doc,
      undefined,
      "document",
      "2026-10-05T00:05:00.000Z",
    );
    save(fixture, ids.view, "최근", {
      changed_within_ms: 600_000,
      document_status: "active",
    });
    // open 시각 00:10:00.000Z. saved_at은 그 안이다.
    const opened = openAllowed(
      fixture,
      undefined,
      { view: ids.view },
      () => 600_000,
    );
    assertEquals(opened.opened_at_ms, 600_000);
    assertEquals(opened.entries.map((entry) => entry.document), [ids.doc]);
    // 같은 cursor의 open 시각이 아니라, 이번 open의 시각이 기준이다. 00:10:01에
    // 다시 열면(그대로 cursor 없이) 여전히 간다.
    const reopened = openAllowed(
      fixture,
      undefined,
      { view: ids.view },
      () => 610_000,
    );
    assertEquals(reopened.entries.map((entry) => entry.document), [ids.doc]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R25: open 항목은 outline place 항목 모양이다", () => {
  const fixture = viewFixture();
  try {
    fixture.seedDocument(ids.doc);
    save(fixture);
    const opened = openAllowed(fixture);
    assert(opened.entries.length === 1);
    const entry = opened.entries[0];
    // R25의 항목 필드. name은 place 목록의 문서 목록 슬러그다.
    assertEquals(entry.document, ids.doc);
    assertEquals(entry.name, null);
    assertEquals(entry.title, "Notes");
    assertEquals(entry.version, `ver_${ids.doc.slice("doc_".length)}`);
    assertEquals(entry.latest_version, entry.version);
    assertEquals(entry.format.name, "document");
    assertEquals(entry.saved_by, "user");
    assertEquals(entry.saved_at, "2026-10-05T00:00:00.000Z");
    assertEquals(entry.section_count, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R25: cursor는 revision·조건·정렬·credential에 묶인다", () => {
  const fixture = viewFixture();
  try {
    fixture.seedDocument(ids.doc);
    save(fixture);
    const opened = openAllowed(fixture);
    assertEquals(opened.complete, true);
    // open을 계속하는 cursor는 revision이 같으면 그대로 간다.
    const bound = {
      view: ids.view,
      revision: opened.revision,
      filter,
      sort: "updated_desc" as const,
      credential: "current",
    };
    // 다른 view id로 디코딩하면 invalid_input이다.
    const others = openCursorError(
      fixture,
      bound,
      { ...bound, view: ids.view2 },
    );
    assertEquals(others, "invalid_input");
    // 조건이 바뀌어도 invalid_input이다.
    assertEquals(
      openCursorError(fixture, bound, {
        ...bound,
        filter: { document_status: "all" },
      }),
      "invalid_input",
    );
    // revision이 바뀌면 conflict다(삭제·변경 포함).
    assertEquals(
      openCursorError(fixture, bound, { ...bound, revision: "9" }),
      "conflict",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/outline-and-search#R25: 없는 view의 open은 not_found다", () => {
  const fixture = viewFixture();
  try {
    const opened = openRaw(
      fixture,
      userContext(),
      { view: "viw_01arz3ndektsv4rrffq69g5fbz" },
    ) as { ok: boolean; error?: { code: string } };
    assert(!opened.ok);
    assertEquals(opened.error?.code, "not_found");
  } finally {
    fixture.close();
  }
});
