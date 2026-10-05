import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { type ContextCommandDeps, createContextCommands } from "./commands.ts";
import { contextItemSchema } from "../../contracts/documents/mod.ts";
import { createContextOutlineSource, createContextReads } from "./reads.ts";
import { contextFixture, ids, keep, userContext } from "./testing/mod.ts";

// apps blueprint read가 들어오기 전 test double. read command만 허용한다.
const deps: ContextCommandDeps = {
  appCommand: (app, command) => app === ids.app && command === "read_notes",
};
const commands = createContextCommands(deps);
const reads = createContextReads();

function item(
  document: string,
  section: string | null,
  perspective: "basis" | "reference" | "watch",
  reason = "판단 근거",
) {
  return {
    target: { kind: "document" as const, document, section },
    perspective,
    reason,
  };
}

function appItem(perspective: "basis" | "reference" | "watch" = "reference") {
  return {
    target: {
      kind: "app_command" as const,
      app: ids.app,
      command: "read_notes",
    },
    perspective,
    reason: "앱 자료",
  };
}

function seedTwo(fixture: ReturnType<typeof contextFixture>) {
  fixture.seedDocument(ids.doc);
  keep(
    fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: ids.context,
          title: "기준",
          purpose: "판단 기준 자료",
          items: [
            item(ids.doc, null, "basis"),
            item(ids.doc, "요약", "watch", "변화 확인"),
            appItem(),
          ],
        } as never,
        {},
      )
    ),
  );
  keep(
    fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: ids.context2,
          title: "참고",
          purpose: "참고 자료",
          items: [appItem("watch")],
        } as never,
        {},
      )
    ),
  );
}

Deno.test("documents/contexts#R1: context 읽기는 제목·목적·관점·이유를 같은 관점 순서로 돌려준다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    const got = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as {
      context: {
        id: string;
        items: {
          perspective: string;
          target: { section: string | null };
          reason: string;
        }[];
      };
    };
    assertEquals(got.context.id, ids.context);
    assertEquals(got.context.items.length, 3);
    // position 순서(생성 순서)대로 관점이 구별된다.
    assertEquals(
      got.context.items.map((entry) => entry.perspective),
      ["basis", "watch", "reference"],
    );
    assertEquals(got.context.items[1].reason, "변화 확인");
    // 전체 문서는 section: null로 정규화된다.
    assertEquals(got.context.items[0].target.section, null);
    // list는 둘 다 돌려준다.
    const listed = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as {
      contexts: { id: string }[];
      complete: boolean;
      next_cursor: string | null;
    };
    assertEquals(listed.contexts.map((context) => context.id), [
      ids.context,
      ids.context2,
    ]);
    assertEquals(listed.complete, true);
    assertEquals(listed.next_cursor, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R2: 읽기는 metadata만 주고 본문·앱 데이터는 대상 read가 연다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    const got = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as {
      context: { items: unknown[]; revision: string; status: string };
    };
    // item은 target·perspective·reason뿐이다. 본문·앱 응답 데이터는 없다.
    for (const entry of got.context.items) {
      assertEquals(Object.keys(entry as never).sort(), [
        "perspective",
        "reason",
        "target",
      ]);
    }
    assertEquals(got.context.status, "active");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R8: related는 직접 든 context를 항목에서 계산하고 app_command target도 연다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    // 문서 target: 첫 context만 직접 든다.
    const byDocument = keep(
      reads.related.handle(
        snapshot,
        userContext(),
        {
          target: { kind: "document", document: ids.doc, section: null },
        } as never,
      ),
    ) as never as { contexts: { id: string }[]; complete: boolean };
    assertEquals(byDocument.contexts.map((context) => context.id), [
      ids.context,
    ]);
    // section target은 전체와 다른 canonical target이다.
    const bySection = keep(
      reads.related.handle(
        snapshot,
        userContext(),
        {
          target: { kind: "document", document: ids.doc, section: "요약" },
        } as never,
      ),
    ) as never as { contexts: { id: string }[] };
    assertEquals(bySection.contexts.map((context) => context.id), [
      ids.context,
    ]);
    // app_command target: 두 context가 직접 든다.
    const byCommand = keep(
      reads.related.handle(
        snapshot,
        userContext(),
        {
          target: { kind: "app_command", app: ids.app, command: "read_notes" },
        } as never,
      ),
    ) as never as { contexts: { id: string }[] };
    assertEquals(byCommand.contexts.map((context) => context.id), [
      ids.context,
      ids.context2,
    ]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R5: status 필터와 cursor가 list를 좁히고 보관 context를 숨긴다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context },
          { base_revision: "1" },
        )
      ),
    );
    const snapshot = fixture.snapshot();
    const active = keep(
      reads.list.handle(snapshot, userContext(), { status: "active" } as never),
    ) as never as { contexts: { id: string }[] };
    assertEquals(active.contexts.map((context) => context.id), [ids.context2]);
    const all = keep(
      reads.list.handle(snapshot, userContext(), { status: "all" } as never),
    ) as never as { contexts: { id: string }[] };
    assertEquals(all.contexts.length, 2);
    void archived;
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R6: 범위 밖 context 읽기는 없는 것과 똑같이 답한다", () => {
  const fixture = contextFixture((_ctx, _operation, target) => {
    const id = (target as { context?: string }).context;
    return id === ids.context
      ? err({ code: "forbidden", message: "범위 밖이다" })
      : { ok: true as const, value: undefined };
  });
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    const got = reads.get.handle(
      snapshot,
      userContext(),
      { context: ids.context } as never,
    );
    assert(!got.ok);
    assertEquals(got.error.code, "not_found");
    // 목록은 그 context를 빼고 돌려준다.
    const listed = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as { contexts: { id: string }[] };
    assertEquals(listed.contexts.map((context) => context.id), [ids.context2]);
  } finally {
    fixture.close();
  }
});

const HASH = "a".repeat(64);
const NEW_VERSION = "ver_01arz3ndektsv4rrffq69g5fb1";

// seedDocument는 판 행 없이 문서 행만 심는다. 새 판은 immutable versions 표에 더한다.
function saveNewVersion(
  fixture: ReturnType<typeof contextFixture>,
  version: string,
  number: number,
): void {
  fixture.db.prepare(
    `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
       content_hash, format_name, module_hash, format_explicit, saved_by, saved_at)
     VALUES (?, ?, ?, ?, 'a.md', 1, ?, 'document', ?, 1, 'user', '2026-10-05T00:00:00.000Z')`,
  ).run(version, ids.doc, number, HASH, HASH, HASH);
  fixture.db.prepare(`UPDATE documents SET latest_version = ? WHERE id = ?`)
    .run(version, ids.doc);
}

Deno.test("documents/contexts#R4: context 항목은 최신 판을 따르고 읽은 시점의 고정 판 id를 근거로 준다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const source = createContextOutlineSource(fixture.sql);
    const before = keep(source.get(ids.context));
    assert(before !== null);
    const itemBefore = before.items[0];
    assertEquals(itemBefore.target.kind, "document");
    assertEquals(itemBefore.document?.version, `ver_${"0".repeat(26)}`);
    // 새 판이 저장되면 같은 항목이 새 최신 판을 가리킨다. 항목은 바뀌지 않는다.
    saveNewVersion(fixture, NEW_VERSION, 1);
    const after = keep(source.get(ids.context));
    assert(after !== null);
    assertEquals(after.items[0].document?.version, NEW_VERSION);
    assertEquals(after.items.length, before.items.length);
    // 이미 읽은 근거는 그때 고른 고정 판 그대로다.
    assertEquals(itemBefore.document?.version, `ver_${"0".repeat(26)}`);
    // ledger의 항목 행에는 판이 저장되지 않는다.
    const stored = fixture.db.prepare(
      `SELECT * FROM context_items WHERE context = ?`,
    ).get(ids.context) as Record<string, unknown>;
    assertEquals(
      Object.keys(stored).filter((column) => column.includes("version")),
      [],
    );
    // 항목별 옛 판 고정 옵션은 입력에 없다.
    const pinned = contextItemSchema.safeParse({
      target: { kind: "document", document: ids.doc, section: null },
      perspective: "basis",
      reason: "옛 판 고정",
      version: `ver_${"0".repeat(26)}`,
    });
    assertEquals(pinned.success, false);
    // 앱 항목은 문서 판 정보 없이 대상만 준다.
    const app = after.items.find((item) => item.target.kind === "app_command");
    assert(app !== undefined);
    assertEquals(app.document, undefined);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R4: context outline 근원은 보관 context를 활성 목록에서 빼고 항목 순서를 유지한다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const source = createContextOutlineSource(fixture.sql);
    const active = keep(source.active());
    assertEquals(active.map((record) => record.id), [
      ids.context,
      ids.context2,
    ]);
    assertEquals(
      active[0].items.map((item) => item.perspective),
      ["basis", "watch", "reference"],
    );
    const row = fixture.sql.get(
      `SELECT revision FROM contexts WHERE id = ?`,
      [ids.context2],
    );
    keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context2 } as never,
          { base_revision: String(row?.["revision"]) } as never,
        )
      ),
    );
    assertEquals(
      keep(source.active()).map((record) => record.id),
      [ids.context],
    );
    // 보관 context도 id로는 읽는다(보관은 삭제가 아니다).
    assertEquals(keep(source.get(ids.context2))?.status, "archived");
    assertEquals(keep(source.get("ctx_01arz3ndektsv4rrffq69g5fzz")), null);
  } finally {
    fixture.close();
  }
});
